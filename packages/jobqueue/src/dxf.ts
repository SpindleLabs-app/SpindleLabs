// A laser job's DXF file read for the file check (step Q2): the drawing's outer box in millimetres, and which of the
// laser's layers each entity is on by its colour, the colour numbers Laser's own DXF uses (workspaces/laser ops.ts,
// kept equal by test/laser-check.test.ts): 1 red is cut, 5 blue is score, 7 (black or white) is engrave, an outline
// the laser program fills. The colour is the entity's own, else its layer's, as laser programs read it; the layer's
// name doesn't matter. Any other colour is refused in words.
//
// It reads text DXF of any version: LINE, CIRCLE, ARC, LWPOLYLINE and POLYLINE (with bulges), ELLIPSE, SPLINE (any
// degree, rational too) and INSERT of blocks (scaled, turned, nested). Units from $INSUNITS. Entities drawn upside
// down (extrusion 0, 0, −1, as some CAD programs mirror) are mirrored back. Text, hatches, dimensions and pictures are
// refused with what to do instead. Splines are boxed by sampling, with their control points' box as the most they
// can reach (a B-spline lies inside its control points' hull), so the check never claims more than it knows. Never
// throws.

import { addArc, addLine, Box, bulgeArc, compose, IDENTITY, map, type Affine, type Pt } from "./box2d.ts";
import type { DrawingRead, LaserLayer, Read } from "./svg.ts";

/** Most entities a DXF may hold (counting each block's every time it is inserted), and how deep blocks may nest. */
export const DXF_LIMITS = { entities: 200_000, depth: 16, splinePoints: 10_000 };

/** Laser's DXF colour numbers (ops.ts OP_LOOK's dxfColour) and the true colours that mean the same. */
export const LASER_DXF_COLOURS: Readonly<Record<LaserLayer, number>> = { cut: 1, score: 5, engrave: 7 };
const TRUE_COLOURS: Record<number, LaserLayer> = { 0xff0000: "cut", 0x0000ff: "score", 0x000000: "engrave", 0xffffff: "engrave" };

/** Millimetres in each $INSUNITS unit the check takes (0, no unit, is read as millimetres and said so). */
const MM_PER_UNIT: Record<number, { mm: number; name: string }> = {
  1: { mm: 25.4, name: "inches" },
  2: { mm: 304.8, name: "feet" },
  4: { mm: 1, name: "millimetres" },
  5: { mm: 10, name: "centimetres" },
  6: { mm: 1000, name: "metres" },
  8: { mm: 25.4e-6, name: "microinches" },
  9: { mm: 0.0254, name: "thousandths of an inch" },
  13: { mm: 0.001, name: "micrometres" },
  14: { mm: 100, name: "decimetres" },
};

type Pair = [number, string];

interface Entity {
  type: string;
  pairs: Pair[];
  /** A POLYLINE's VERTEX entities. */
  vertices: Entity[];
}

class DxfError extends Error {}

function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length % 2 === 1) throw new DxfError("its lines don't come in pairs");
  const out: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = (lines[i] as string).trim();
    if (!/^-?\d+$/.test(code)) throw new DxfError(`a line "${code.slice(0, 20)}" where a group code should be`);
    out.push([Number(code), (lines[i + 1] as string).trim()]);
  }
  return out;
}

const first = (e: Entity, code: number): string | undefined => e.pairs.find((p) => p[0] === code)?.[1];

function real(e: Entity, code: number, fallback?: number): number {
  const s = first(e, code);
  if (s === undefined) {
    if (fallback === undefined) throw new DxfError(`a ${e.type} without its group ${code}`);
    return fallback;
  }
  const v = Number(s);
  if (s === "" || !Number.isFinite(v)) throw new DxfError(`a ${e.type} with "${s.slice(0, 20)}" where a number should be`);
  return v;
}

function int(e: Entity, code: number, fallback: number): number {
  const v = real(e, code, fallback);
  if (!Number.isInteger(v)) throw new DxfError(`a ${e.type} with a whole number that isn't one`);
  return v;
}

/** The entities between the section's pairs, POLYLINEs gathering their VERTEXes up to SEQEND, ATTRIBs dropped after INSERT. */
function entitiesOf(pairs: Pair[]): Entity[] {
  const out: Entity[] = [];
  let cur: Entity | null = null;
  let poly: Entity | null = null;
  for (const [code, value] of pairs) {
    if (code === 0) {
      const ent: Entity = { type: value.toUpperCase(), pairs: [], vertices: [] };
      if (ent.type === "VERTEX" && poly) {
        poly.vertices.push(ent);
        cur = ent;
        continue;
      }
      if (ent.type === "SEQEND") {
        poly = null;
        cur = null;
        continue;
      }
      out.push(ent);
      cur = ent;
      poly = ent.type === "POLYLINE" ? ent : ent.type === "ATTRIB" ? poly : null;
      continue;
    }
    if (cur) cur.pairs.push([code, value]);
  }
  return out;
}

interface Layer {
  colour: number;
  off: boolean;
}

interface Doc {
  unit: number;
  layers: Map<string, Layer>;
  blocks: Map<string, { base: Pt; entities: Entity[] }>;
  entities: Entity[];
}

function docOf(text: string): Doc {
  if (text.startsWith("AutoCAD Binary DXF")) throw new DxfError("is a binary DXF; save it as a text (ASCII) DXF");
  const pairs = pairsOf(text);
  const doc: Doc = { unit: 0, layers: new Map(), blocks: new Map(), entities: [] };
  let i = 0;
  let sawEof = false;
  while (i < pairs.length) {
    const [code, value] = pairs[i] as Pair;
    if (code === 0 && value === "EOF") {
      sawEof = true;
      break;
    }
    if (!(code === 0 && value === "SECTION")) {
      i += 1;
      continue;
    }
    const nameAt = pairs[i + 1];
    if (!nameAt || nameAt[0] !== 2) throw new DxfError("a section with no name");
    let end = i + 2;
    while (end < pairs.length && !((pairs[end] as Pair)[0] === 0 && (pairs[end] as Pair)[1] === "ENDSEC")) end += 1;
    if (end >= pairs.length) throw new DxfError(`its ${nameAt[1]} section never ends`);
    const body = pairs.slice(i + 2, end);
    switch (nameAt[1]) {
      case "HEADER":
        for (let k = 0; k < body.length; k++) {
          if ((body[k] as Pair)[0] === 9 && (body[k] as Pair)[1] === "$INSUNITS") {
            const v = Number(body[k + 1]?.[1]);
            if (!Number.isInteger(v)) throw new DxfError("an $INSUNITS that isn't a whole number");
            doc.unit = v;
          }
        }
        break;
      case "TABLES":
        for (const e of entitiesOf(body)) {
          if (e.type !== "LAYER") continue;
          const name = first(e, 2);
          if (name === undefined) continue;
          const colour = int(e, 62, 7);
          const flags = int(e, 70, 0);
          doc.layers.set(name.toUpperCase(), { colour: Math.abs(colour), off: colour < 0 || (flags & 1) === 1 });
        }
        break;
      case "BLOCKS": {
        let block: { name: string; base: Pt; entities: Entity[] } | null = null;
        for (const e of entitiesOf(body)) {
          if (e.type === "BLOCK") {
            block = { name: (first(e, 2) ?? "").toUpperCase(), base: [real(e, 10, 0), real(e, 20, 0)], entities: [] };
          } else if (e.type === "ENDBLK") {
            if (block) doc.blocks.set(block.name, { base: block.base, entities: block.entities });
            block = null;
          } else if (block) block.entities.push(e);
        }
        break;
      }
      case "ENTITIES":
        doc.entities = entitiesOf(body);
        break;
    }
    i = end + 1;
  }
  if (!sawEof && doc.entities.length === 0) throw new DxfError("has no ENTITIES section");
  return doc;
}

const REFUSED: Record<string, string> = {
  TEXT: "has text: turn the text into outlines (explode it to lines and arcs) in the CAD program first",
  MTEXT: "has text: turn the text into outlines (explode it to lines and arcs) in the CAD program first",
  ATTRIB: "has text (a block attribute): explode it to lines and arcs in the CAD program first",
  DIMENSION: "has a dimension: delete the dimensions (the laser would read their lines and numbers as cuts)",
  LEADER: "has a leader (a note's arrow): delete it first",
  MULTILEADER: "has a leader (a note's arrow): delete it first",
  HATCH: "has a hatch (a filled area): delete it and put the area's outline on colour 7 to engrave it",
  SOLID: "has a filled solid area: delete it and put the area's outline on colour 7 to engrave it",
  TRACE: "has a filled trace: draw it as an outline instead",
  IMAGE: "has a picture in it: the laser check reads only lines and curves (pictures come later)",
  "3DFACE": "has 3D faces: export a flat 2D drawing instead",
  "3DSOLID": "has a 3D solid: export a flat 2D drawing instead",
  REGION: "has a region: explode it to lines and arcs first",
  BODY: "has a 3D body: export a flat 2D drawing instead",
  MESH: "has a mesh: export a flat 2D drawing instead",
};

interface Walk {
  doc: Doc;
  box: Box;
  outer: Box;
  layers: Record<LaserLayer, number>;
  count: number;
  points: number;
  hidden: number;
  splines: number;
}

/** The colour an entity is drawn in: its own (62 or true colour 420), else its layer's; BYBLOCK and layer 0 inside a block take the insert's. */
function colourOf(e: Entity, doc: Doc, inherited: Colour): Colour | "off" {
  const layerName = (first(e, 8) ?? "0").toUpperCase();
  const layer = doc.layers.get(layerName) ?? { colour: 7, off: false };
  if (layer.off) return "off";
  const truecolour = first(e, 420);
  if (truecolour !== undefined) {
    const v = Number(truecolour);
    if (!Number.isInteger(v)) throw new DxfError(`a ${e.type} with a true colour that isn't a number`);
    return { true: v & 0xffffff };
  }
  const aci = int(e, 62, 256);
  if (aci < 0) return "off";
  if (aci === 0) return inherited;
  if (aci === 256) return layerName === "0" && inherited.inBlock ? inherited : { aci: layer.colour };
  return { aci };
}

type Colour = { aci?: number; true?: number; inBlock?: boolean };

function layerOf(c: Colour): LaserLayer | string {
  if (c.true !== undefined) return TRUE_COLOURS[c.true] ?? `the colour #${c.true.toString(16).padStart(6, "0")}`;
  const n = c.aci ?? 7;
  for (const [l, aci] of Object.entries(LASER_DXF_COLOURS)) if (aci === n) return l as LaserLayer;
  return `colour ${n}`;
}

/** The map from an entity's own coordinates (OCS) to the drawing's, for its extrusion: flat up, or flat and upside down. */
function ocs(e: Entity): Affine {
  const n: [number, number, number] = [real(e, 210, 0), real(e, 220, 0), real(e, 230, 1)];
  const len = Math.hypot(...n);
  if (len > 0 && Math.abs(n[0] / len) < 1e-9 && Math.abs(n[1] / len) < 1e-9) {
    // The arbitrary axis rule with N = (0, 0, −1): Ax = Wy × N = (−1, 0, 0), Ay = N × Ax = (0, 1, 0), so x turns.
    return n[2] > 0 ? IDENTITY : [-1, 0, 0, 1, 0, 0];
  }
  throw new DxfError(`has a ${e.type} not lying flat in the drawing's plane: export a flat 2D drawing`);
}

/** The vertices of an LWPOLYLINE (10, 20, 42 in turn) or a POLYLINE's VERTEXes, each with its bulge. */
function polyVertices(e: Entity): { p: Pt; bulge: number }[] {
  if (e.type === "LWPOLYLINE") {
    const out: { p: Pt; bulge: number }[] = [];
    for (const [code, value] of e.pairs) {
      const v = Number(value);
      if ((code === 10 || code === 20 || code === 42) && (value === "" || !Number.isFinite(v))) throw new DxfError("an LWPOLYLINE with a number that isn't one");
      if (code === 10) out.push({ p: [v, NaN], bulge: 0 });
      else if (code === 20 && out.length > 0) (out[out.length - 1] as { p: Pt }).p[1] = v;
      else if (code === 42 && out.length > 0) (out[out.length - 1] as { bulge: number }).bulge = v;
    }
    if (out.some((v) => Number.isNaN(v.p[1]))) throw new DxfError("an LWPOLYLINE with a corner missing its y");
    return out;
  }
  return e.vertices.filter((v) => (int(v, 70, 0) & 16) === 0).map((v) => ({ p: [real(v, 10), real(v, 20)] as Pt, bulge: real(v, 42, 0) }));
}

/** A point of the B-spline at t by de Boor's steps in weighted (homogeneous) coordinates. */
function deBoor(t: number, p: number, U: readonly number[], P: readonly Pt[], w: readonly number[]): Pt {
  const n = P.length;
  let k = p;
  while (k < n - 1 && (U[k + 1] as number) <= t) k += 1;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const q = P[j + k - p] as Pt;
    const wt = w[j + k - p] as number;
    d.push([q[0] * wt, q[1] * wt, wt]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const lo = U[j + k - p] as number;
      const hi = U[j + 1 + k - r] as number;
      const a = hi === lo ? 0 : (t - lo) / (hi - lo);
      const A = d[j - 1] as [number, number, number];
      const B = d[j] as [number, number, number];
      d[j] = [(1 - a) * A[0] + a * B[0], (1 - a) * A[1] + a * B[1], (1 - a) * A[2] + a * B[2]];
    }
  }
  const r = d[p] as [number, number, number];
  return [r[0] / r[2], r[1] / r[2]];
}

/** Samples per knot span of a spline: enough that the sampled box is within a hair of the true one for a part's curves. */
export const SPLINE_SAMPLES = 64;

function addSpline(w: Walk, e: Entity, m: Affine): void {
  const p = int(e, 71, 3);
  const knots = e.pairs.filter((x) => x[0] === 40).map((x) => Number(x[1]));
  const xs = e.pairs.filter((x) => x[0] === 10).map((x) => Number(x[1]));
  const ys = e.pairs.filter((x) => x[0] === 20).map((x) => Number(x[1]));
  const ws = e.pairs.filter((x) => x[0] === 41).map((x) => Number(x[1]));
  if (xs.length === 0) throw new DxfError("a SPLINE given only by fit points: save it with control points (most programs do)");
  if (p < 1 || p > 25 || xs.length !== ys.length || xs.length < p + 1 || xs.length > DXF_LIMITS.splinePoints) throw new DxfError("a SPLINE whose degree and control points don't agree");
  if (knots.length !== xs.length + p + 1) throw new DxfError("a SPLINE whose knots don't match its control points");
  const weights = ws.length === 0 ? xs.map(() => 1) : ws;
  if (weights.length !== xs.length || !weights.every((v) => v > 0 && Number.isFinite(v))) throw new DxfError("a SPLINE with weights that aren't positive numbers, one each");
  if (![...knots, ...xs, ...ys].every(Number.isFinite)) throw new DxfError("a SPLINE with a number that isn't one");
  for (let k = 1; k < knots.length; k++) if ((knots[k] as number) < (knots[k - 1] as number)) throw new DxfError("a SPLINE whose knots go backwards");
  const P = xs.map((x, k) => [x, ys[k] as number] as Pt);
  const lo = knots[p] as number;
  const hi = knots[P.length] as number;
  if (!(hi > lo)) throw new DxfError("a SPLINE with no length to its knots");
  // Every point of the curve lies inside the hull of its control points (weights positive), so their box is the most it reaches.
  for (const q of P) w.outer.add(map(m, q));
  for (let s = p; s < P.length; s++) {
    const a = knots[s] as number;
    const b = knots[s + 1] as number;
    if (!(b > a)) continue;
    for (let k = 0; k <= SPLINE_SAMPLES; k++) w.box.add(map(m, deBoor(a + ((b - a) * k) / SPLINE_SAMPLES, p, knots, P, weights)));
  }
  w.splines += 1;
}

function drawEntity(w: Walk, e: Entity, m: Affine, inherited: Colour, depth: number): void {
  if (int(e, 67, 0) === 1) return; // paper space: the sheet's layout, not the drawing
  w.count += 1;
  if (w.count > DXF_LIMITS.entities) throw new DxfError(`has more than ${DXF_LIMITS.entities} entities`);
  const refused = REFUSED[e.type];
  if (refused !== undefined) {
    if (e.type === "ATTRIB" && (int(e, 70, 0) & 1) === 1) return; // an invisible attribute draws nothing
    throw new DxfError(refused);
  }
  if (["ATTDEF", "VIEWPORT", "XLINE", "RAY", "OLE2FRAME", "WIPEOUT"].includes(e.type)) {
    if (e.type === "XLINE" || e.type === "RAY") throw new DxfError("has a construction line that never ends (XLINE or RAY): delete it first");
    return;
  }
  if (e.type === "POINT") {
    w.points += 1;
    return;
  }
  if (int(e, 60, 0) === 1) {
    w.hidden += 1;
    return;
  }
  if (e.type === "INSERT") {
    const name = (first(e, 2) ?? "").toUpperCase();
    const block = w.doc.blocks.get(name);
    if (!block) throw new DxfError(`places a block "${name.slice(0, 30)}" that isn't in the file`);
    if (int(e, 70, 1) > 1 || int(e, 71, 1) > 1) throw new DxfError("has a block placed as an array: explode the array first");
    if (depth >= DXF_LIMITS.depth) throw new DxfError("has blocks nested too deep (or a block inside itself)");
    const colour = colourOf(e, w.doc, inherited);
    if (colour === "off") return;
    const [sx, sy] = [real(e, 41, 1), real(e, 42, 1)];
    const r = (real(e, 50, 0) * Math.PI) / 180;
    const [cos, sin] = [Math.cos(r), Math.sin(r)];
    const [ix, iy] = [real(e, 10, 0), real(e, 20, 0)];
    // OCS ∘ translate(insertion) ∘ rotate ∘ scale ∘ translate(−base)
    const place: Affine = [cos * sx, sin * sx, -sin * sy, cos * sy, ix, iy];
    const inner = compose(compose(m, compose(ocs(e), place)), [1, 0, 0, 1, -block.base[0], -block.base[1]]);
    for (const child of block.entities) drawEntity(w, child, inner, { ...colour, inBlock: true }, depth + 1);
    return;
  }
  const colour = colourOf(e, w.doc, inherited);
  if (colour === "off") {
    w.hidden += 1;
    return;
  }
  const layer = layerOf(colour);
  const known = ["LINE", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE", "ELLIPSE", "SPLINE"];
  if (!known.includes(e.type)) throw new DxfError(`has a ${e.type} entity, which the check doesn't read: explode it to lines and arcs first`);
  if (layer !== "cut" && layer !== "score" && layer !== "engrave") {
    throw new DxfError(`has a ${e.type} in ${layer}: the laser reads colour 1 (red) as cut, 5 (blue) as score and 7 (black or white) as engrave, so put every line on one of those`);
  }
  const before = new Box();
  const exact = new Box();
  const sub: Walk = { ...w, box: exact, outer: before };
  switch (e.type) {
    case "LINE":
      addLine(exact, m, [real(e, 10), real(e, 20)], [real(e, 11), real(e, 21)]);
      break;
    case "CIRCLE": {
      const r = real(e, 40);
      if (!(r > 0)) throw new DxfError("a CIRCLE whose radius isn't above 0");
      addArc(exact, compose(m, ocs(e)), [real(e, 10), real(e, 20)], [r, 0], [0, r], 0, 2 * Math.PI);
      break;
    }
    case "ARC": {
      const r = real(e, 40);
      if (!(r > 0)) throw new DxfError("an ARC whose radius isn't above 0");
      const a0 = real(e, 50);
      let sweep = real(e, 51) - a0;
      sweep = ((sweep % 360) + 360) % 360;
      if (sweep === 0) sweep = 360;
      addArc(exact, compose(m, ocs(e)), [real(e, 10), real(e, 20)], [r, 0], [0, r], (a0 * Math.PI) / 180, (sweep * Math.PI) / 180);
      break;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const flags = int(e, 70, 0);
      if (e.type === "POLYLINE" && (flags & (16 | 64)) !== 0) throw new DxfError("has a polygon mesh or polyface: export a flat 2D drawing instead");
      const own = e.type === "POLYLINE" && (flags & 8) !== 0 ? m : compose(m, ocs(e)); // a 3D polyline is in world coordinates
      const vs = polyVertices(e);
      const closed = (flags & 1) === 1;
      for (let k = 0; k < vs.length; k++) {
        const a = vs[k] as { p: Pt; bulge: number };
        const last = k === vs.length - 1;
        if (last && !closed) {
          addLine(exact, own, a.p, a.p);
          break;
        }
        const b = (last ? vs[0] : vs[k + 1]) as { p: Pt };
        const arc = bulgeArc(a.p, b.p, a.bulge);
        if (arc) addArc(exact, own, arc.c, [arc.r, 0], [0, arc.r], arc.theta0, arc.sweep);
        else addLine(exact, own, a.p, b.p);
      }
      break;
    }
    case "ELLIPSE": {
      const c: Pt = [real(e, 10), real(e, 20)];
      const major: Pt = [real(e, 11), real(e, 21)];
      const ratio = real(e, 40);
      if (!(ratio > 0 && ratio <= 1) || (major[0] === 0 && major[1] === 0)) throw new DxfError("an ELLIPSE whose axes aren't right");
      const flip = ocs(e)[0] < 0;
      // The minor axis is N × major times the ratio: a quarter turn left with N up, right with N down.
      const minor: Pt = flip ? [major[1] * ratio, -major[0] * ratio] : [-major[1] * ratio, major[0] * ratio];
      const t0 = real(e, 41, 0);
      let sweep = real(e, 42, 2 * Math.PI) - t0;
      sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (sweep === 0) sweep = 2 * Math.PI;
      addArc(exact, m, c, major, minor, t0, flip ? -sweep : sweep);
      break;
    }
    case "SPLINE":
      addSpline(sub, e, m);
      w.splines = sub.splines;
      break;
  }
  if (exact.empty) return;
  if (!exact.finite || !before.finite) throw new DxfError(`has a ${e.type} with a number that isn't one`);
  w.box.addBox(exact);
  w.outer.addBox(exact);
  w.outer.addBox(before);
  w.layers[layer] += 1;
}

/** The DXF file's text read as a laser drawing, or why it can't be. */
export function readDxf(text: string): Read {
  try {
    const doc = docOf(text);
    const notes: string[] = [];
    const unit = MM_PER_UNIT[doc.unit];
    if (doc.unit === 0) notes.push("The DXF doesn't say its units; read as millimetres. If it looks the wrong size, save it with units set to millimetres.");
    else if (!unit) throw new DxfError(`gives its units as code ${doc.unit}, which the check doesn't take: save it in millimetres`);
    else if (doc.unit !== 4) notes.push(`The DXF is in ${unit.name}; turned into millimetres.`);
    const mm = unit?.mm ?? 1;
    const w: Walk = { doc, box: new Box(), outer: new Box(), layers: { cut: 0, score: 0, engrave: 0 }, count: 0, points: 0, hidden: 0, splines: 0 };
    for (const e of doc.entities) drawEntity(w, e, [mm, 0, 0, mm, 0, 0], { aci: 7 }, 0);
    if (w.points > 0) notes.push(`${w.points} point${w.points === 1 ? "" : "s"} left out: a point is nothing to cut.`);
    if (w.hidden > 0) notes.push(`${w.hidden} entit${w.hidden === 1 ? "y is" : "ies are"} hidden or on a layer turned off, so left out.`);
    if (w.layers.engrave > 0) notes.push("Engraved outlines (colour 7) come as lines: set that layer to fill in the laser's program.");
    if (w.box.empty) return { ok: false, reason: "The DXF has nothing for the laser: no line, arc or curve." };
    const slack = Math.max(w.outer.width - w.box.width, w.outer.height - w.box.height, 0);
    if (w.splines > 0 && slack > 0) notes.push(`Curves (splines) were measured by sampling: the true size is at most ${slack.toFixed(3)} mm more.`);
    const drawing: DrawingRead = { width: w.box.width, height: w.box.height, slack, layers: w.layers, notes };
    return { ok: true, drawing };
  } catch (e) {
    if (e instanceof DxfError) {
      const m = e.message;
      const said = m.startsWith("its ") ? `The DXF's ${m.slice(4)}` : `The DXF ${/^(has|is|gives|places)\b/.test(m) ? m : `has ${m}`}`;
      return { ok: false, reason: `${said}.` };
    }
    return { ok: false, reason: "The DXF couldn't be read." };
  }
}
