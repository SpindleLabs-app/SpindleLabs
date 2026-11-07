// The timeline item's card (Ben, 2026-11-05: "11. Box 4 box" told him
// nothing). Hovering an item with the mouse, focusing it with the keyboard,
// or picking it with a finger shows a small card above the bar: the item's
// name and number, what kind of item it is, its key values in words
// ("40 × 30 × 20 mm", "8 mm from Sketch 1"), why it isn't built when it
// isn't, and a rough picture of it: a sketch's own outline, drawn from the
// sketch's points and curves, or for a solid feature the bodies as they are
// now, its own picked out in the accent colour and the rest dimmed. A Move
// picks out the bodies it moves. Fusion's timeline tooltip, in our look.
//
// The pictures are drawn only when a card first shows (lazily) and kept by
// scene, item and colours, so a long timeline costs nothing until it is
// hovered, and the same hover again draws nothing. A body is painted on a
// 2D canvas with no WebGL: its display mesh's triangles, flat shaded, drawn
// with a depth buffer from the view the app opens with, and its edges.
// Works offline: nothing here asks the network. Styles:
// styles/timeline-card.css.

import { boxShown, summaryInUnit, type Feature, type Unit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { bodyIdOf, isSketchExtrude, type DesignDocument, type Sketch, type SketchPoint } from "./document.ts";
import { isFlipped } from "./extrude.ts";
import { moveKindOf, MOVE_VERBS } from "./move.ts";
import { mirrorOf } from "./duplicate.ts";
import type { Scene } from "./scene.ts";
import { itemName } from "./timeline-edits.ts";
import type { TimelineBarItem } from "./timeline-bar.ts";

/** What a card says about one item. */
export interface CardFacts {
  /** "Box 4": the item's own name. */
  name: string;
  /** Its place in build order, from 1. */
  number: number;
  /** What kind of item it is: "Box", "Sketch", "Extrude", "Move", "Rotate", "Combine: cut". */
  kind: string;
  /** Its key values, one line each, in words. */
  details: string[];
  /** Why it isn't built as it stands, or its warning; null when it builds. */
  status: { words: string; tone: "off" | "bad" } | null;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const num = (v: unknown) => (typeof v === "number" ? String(v) : "?");

/** A sketch's content in words: "2 lines and 2 arcs", or "Empty". */
export function sketchContent(sketch: Sketch | undefined): string {
  if (!sketch || sketch.curves.length === 0) return "Empty: nothing drawn yet";
  const count = (k: string) => sketch.curves.filter((c) => c.kind === k).length;
  const parts = [["line", count("line")], ["arc", count("arc")], ["circle", count("circle")]].filter(([, n]) => (n as number) > 0).map(([k, n]) => plural(n as number, k as string));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * The card's words for `item`, the timeline bar's view of feature `f`
 * (`timelineBarItems`), at place `index` (from 0). `slow` holds the items
 * that failed by taking the kernel too long.
 */
export function cardFacts(doc: DesignDocument, f: Feature, item: TimelineBarItem, index: number, slow: ReadonlySet<string> = new Set(), unit: Unit = "mm"): CardFacts {
  const p = f.intent.parameters;
  const name = itemName(f);
  const summary = summaryInUnit(f.intent.summary, unit);
  /** A length in millimetres as the card says it: "40 mm", or "1.575 in". */
  const len = (v: unknown) => (typeof v === "number" && unit === "in" ? `${boxShown(v, unit)} in` : `${num(v)} mm`);
  /** The same without its unit, for a row of sizes that ends with one. */
  const bare = (v: unknown) => (typeof v === "number" && unit === "in" ? boxShown(v, unit) : num(v));
  let kind = "Feature";
  let details: string[] = [summary];
  const type = f.intent.type;
  if (type === "box") {
    kind = "Box";
    details = [`${bare(p.width)} × ${bare(p.depth)} × ${bare(p.height)} ${unit}`, "width × depth × height"];
  } else if (type === "cylinder") {
    kind = "Cylinder";
    details = [`⌀${len(p.diameter)}, ${len(p.height)} high`];
  } else if (type === "sphere") {
    kind = "Sphere";
    details = [`⌀${len(p.diameter)}`];
  } else if (type === "sketch") {
    kind = "Sketch";
    // "Sketch 1 on the XY plane" / "Sketch 2 on a face of Box 1": the place, from its summary (renames follow there).
    const on = summary.match(/ (on (?:the|a) .*)$/);
    details = [on ? on[1][0].toUpperCase() + on[1].slice(1) : summary, sketchContent(doc.sketches.find((s) => s.id === f.id))];
  } else if (type === "extrude") {
    kind = "Extrude";
    if (isSketchExtrude(f)) {
      const from = doc.timeline.features.find((g) => g.id === p.sketch);
      details = [`${len(p.distance)} from ${from ? itemName(from) : "a sketch that is gone"}${isFlipped(f) ? ", flipped" : ""}`, "A new body"];
    } else details = [summary.replace(/^Extrude: /, "")];
  } else if (type === "move") {
    kind = MOVE_VERBS[moveKindOf(f)];
    details = [summary];
  } else if (type === "duplicate") {
    // Mirror body (35e2) is a Duplicate across a plane.
    kind = mirrorOf(f) === undefined ? "Duplicate" : "Mirror body";
    details = [summary, "A new body, following its source's sizes"];
  } else if (type === "combine") {
    const op = p.operation;
    kind = op === "cut" ? "Combine: cut" : op === "join" ? "Combine: join" : op === "intersect" ? "Combine: intersect" : "Combine";
    details = [summary];
  }
  let status: CardFacts["status"] = null;
  if (item.suppressed) status = { words: "Suppressed: not built", tone: "off" };
  else if (item.rolledBack) status = { words: "After the rollback marker: not built yet", tone: "off" };
  else if (item.greyed !== null) status = { words: `Not built: ${item.greyed} is suppressed`, tone: "off" };
  else if (item.failed) status = { words: slow.has(f.id) ? "Failed: took the kernel too long" : "Failed to build", tone: "bad" };
  else if (item.warning !== null) status = { words: `Warning: ${item.warning}`, tone: "bad" };
  return { name, number: index + 1, kind, details, status };
}

// ---------------------------------------------------------------- sketch outline

/** The gap (in the outline's own units, a share of its size) round a sketch's outline in its picture. */
export const OUTLINE_PAD = 0.08;

/**
 * A sketch's curves as one SVG path, in the sketch's own mm with y turned
 * down for the screen, and the view box round it (padded by OUTLINE_PAD of
 * its larger side); null when it has no curves. An arc runs
 * counter-clockwise from its start to its end round its centre (Fusion's
 * rule, document.ts): seen on screen with y down that is SVG's sweep 0.
 */
export function sketchOutline(sketch: Sketch | undefined): { viewBox: string; d: string } | null {
  if (!sketch || sketch.curves.length === 0) return null;
  const at = new Map<string, SketchPoint>(sketch.points.map((pt) => [pt.id, pt]));
  const parts: string[] = [];
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  const grow = (x: number, y: number) => {
    lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
    hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
  };
  const r6 = (v: number) => String(Math.round(v * 1e6) / 1e6);
  const xy = (pt: SketchPoint) => `${r6(pt.x)} ${r6(-pt.y)}`;
  for (const c of sketch.curves) {
    if (c.kind === "line") {
      const a = at.get(c.start);
      const b = at.get(c.end);
      if (!a || !b) continue;
      parts.push(`M${xy(a)}L${xy(b)}`);
      grow(a.x, a.y);
      grow(b.x, b.y);
    } else if (c.kind === "circle") {
      const o = at.get(c.centre);
      if (!o || !(c.radius > 0)) continue;
      const r = c.radius;
      // Two half circles: one SVG arc can't start and end at the same point.
      parts.push(`M${r6(o.x - r)} ${r6(-o.y)}A${r6(r)} ${r6(r)} 0 1 0 ${r6(o.x + r)} ${r6(-o.y)}A${r6(r)} ${r6(r)} 0 1 0 ${r6(o.x - r)} ${r6(-o.y)}`);
      grow(o.x - r, o.y - r);
      grow(o.x + r, o.y + r);
    } else {
      const a = at.get(c.start);
      const b = at.get(c.end);
      const o = at.get(c.centre);
      if (!a || !b || !o) continue;
      const r = Math.hypot(a.x - o.x, a.y - o.y);
      const from = Math.atan2(a.y - o.y, a.x - o.x);
      let span = Math.atan2(b.y - o.y, b.x - o.x) - from;
      while (span <= 0) span += 2 * Math.PI; // counter-clockwise, all the way round when the ends meet
      parts.push(`M${xy(a)}A${r6(r)} ${r6(r)} 0 ${span > Math.PI ? 1 : 0} 0 ${xy(b)}`);
      // Its box: the ends and every quarter point the arc passes.
      grow(a.x, a.y);
      grow(b.x, b.y);
      for (let q = 0; q < 4; q++) {
        let t = (q * Math.PI) / 2 - from;
        while (t < 0) t += 2 * Math.PI;
        if (t < span) grow(o.x + r * Math.cos((q * Math.PI) / 2), o.y + r * Math.sin((q * Math.PI) / 2));
      }
    }
  }
  if (parts.length === 0) return null;
  const w = hi[0] - lo[0];
  const h = hi[1] - lo[1];
  const pad = Math.max(w, h, 1e-9) * OUTLINE_PAD;
  return { viewBox: `${r6(lo[0] - pad)} ${r6(-hi[1] - pad)} ${r6(w + 2 * pad)} ${r6(h + 2 * pad)}`, d: parts.join("") };
}

// ---------------------------------------------------------------- body picture

/** The view the pictures are drawn from: looking down at the design from in front, to the right and above (as the app opens), z up. */
export const VIEW_FROM: readonly [number, number, number] = [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const RIGHT = [1 / Math.SQRT2, 1 / Math.SQRT2, 0]; // z × VIEW_FROM, made unit
const UP = [-1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)]; // VIEW_FROM × RIGHT
/** Where the light comes from: over the viewer's left shoulder, so the three faces a box shows differ. */
export const LIGHT = unit([VIEW_FROM[0] - 0.35 * RIGHT[0] + 0.5 * UP[0], VIEW_FROM[1] - 0.35 * RIGHT[1] + 0.5 * UP[1], VIEW_FROM[2] - 0.35 * RIGHT[2] + 0.5 * UP[2]]);

function unit(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? v.map((c) => c / l) : [0, 0, 0];
}

/** A world point (mm) on the picture's plane: [right, up] in mm, and its depth toward the viewer (bigger is nearer). */
export function project(p: readonly number[]): [number, number, number] {
  return [p[0] * RIGHT[0] + p[1] * RIGHT[1] + p[2] * RIGHT[2], p[0] * UP[0] + p[1] * UP[1] + p[2] * UP[2], p[0] * VIEW_FROM[0] + p[1] * VIEW_FROM[1] + p[2] * VIEW_FROM[2]];
}

/** One body to paint: its triangles' corners (x, y, z flat) and index triples, its edges' segments (two corners each, x, y, z flat), and whether it is the item's own. */
export interface PaintBody {
  positions: readonly number[];
  indices: readonly number[];
  edges?: readonly number[];
  own: boolean;
}

/** The share of the picture's smaller side left clear round the bodies. */
export const PICTURE_PAD = 0.08;

/** How many samples each way a picture's pixel is the mean of (so the edges are smooth). */
export const SAMPLES = 2;

/** How much darker an edge line is than its body's lit colour. */
export const EDGE_SHADE = 0.45;

/**
 * Where the bodies' corners land in a picture `width` × `height` px: the
 * scale (px per mm) and the shift that fit every corner the same scale
 * both ways, centred, PICTURE_PAD clear round them; null when there are none.
 */
export function pictureFit(bodies: readonly PaintBody[], width: number, height: number): { scale: number; x: number; y: number } | null {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const b of bodies) {
    for (let i = 0; i + 2 < b.positions.length; i += 3) {
      const q = project([b.positions[i], b.positions[i + 1], b.positions[i + 2]]);
      if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
      lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
      hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
    }
  }
  if (!(lo[0] <= hi[0])) return null;
  const pad = Math.min(width, height) * PICTURE_PAD;
  const scale = Math.min((width - 2 * pad) / Math.max(hi[0] - lo[0], 1e-9), (height - 2 * pad) / Math.max(hi[1] - lo[1], 1e-9));
  return { scale, x: width / 2 - ((lo[0] + hi[0]) / 2) * scale, y: height / 2 + ((lo[1] + hi[1]) / 2) * scale };
}

/** How brightly a face with unit normal `n` is lit: 0.35 facing away from the light to 1 facing it; the side toward the viewer counts, whichever way its triangle winds. */
export function shadeOf(n: readonly number[]): number {
  const toward = n[0] * VIEW_FROM[0] + n[1] * VIEW_FROM[1] + n[2] * VIEW_FROM[2] < 0 ? -1 : 1;
  const lit = Math.max(0, toward * (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]));
  return 0.35 + 0.65 * lit;
}

/**
 * The picture of `bodies`, `width` × `height` px, as RGBA bytes (row by row
 * from the top; clear where no body is): each triangle drawn with a depth
 * buffer, so the nearest surface shows at every point whatever the order,
 * bodies that pass through each other included, flat shaded (`shadeOf`) in
 * its body's colour; then each edge line, where nothing nearer hides it,
 * EDGE_SHADE darker. Each pixel is the mean of SAMPLES × SAMPLES samples.
 * Null when there is nothing to draw.
 */
export function rasterPicture(bodies: readonly PaintBody[], width: number, height: number, colours: PictureColours): Uint8ClampedArray | null {
  const fit = pictureFit(bodies, width, height);
  if (!fit || width < 1 || height < 1) return null;
  const S = SAMPLES;
  const W = width * S;
  const H = height * S;
  const depth = new Float64Array(W * H).fill(-Infinity);
  const colour = new Float32Array(W * H * 3);
  const own = rgbOf(colours.own) ?? [74, 168, 255];
  const rest = rgbOf(colours.rest) ?? [139, 149, 163];
  // To sample pixels: x right, y down, at S per picture pixel.
  const toPx = (p: readonly number[]) => {
    const q = project(p);
    return [(fit.x + q[0] * fit.scale) * S, (fit.y - q[1] * fit.scale) * S, q[2]];
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bodies) {
    const base = b.own ? own : rest;
    const at = (i: number) => [b.positions[3 * i], b.positions[3 * i + 1], b.positions[3 * i + 2]];
    for (let t = 0; t + 2 < b.indices.length; t += 3) {
      const [a, c, e] = [at(b.indices[t]), at(b.indices[t + 1]), at(b.indices[t + 2])];
      if (![...a, ...c, ...e].every(Number.isFinite)) continue;
      const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const v = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
      const n = unit([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
      const s = shadeOf(n);
      const rgb = [base[0] * s, base[1] * s, base[2] * s];
      const [p0, p1, p2] = [toPx(a), toPx(c), toPx(e)];
      lo = Math.min(lo, p0[2], p1[2], p2[2]);
      hi = Math.max(hi, p0[2], p1[2], p2[2]);
      const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (Math.abs(area) < 1e-12) continue; // edge on: covers no sample
      const x0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
      const y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          // The sample's barycentric weights; inside when all three are at least 0 (either winding).
          const w0 = ((p1[0] - px) * (p2[1] - py) - (p1[1] - py) * (p2[0] - px)) / area;
          const w1 = ((p2[0] - px) * (p0[1] - py) - (p2[1] - py) * (p0[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
          const k = y * W + x;
          if (z <= depth[k]) continue; // something nearer is there
          depth[k] = z;
          colour[3 * k] = rgb[0];
          colour[3 * k + 1] = rgb[1];
          colour[3 * k + 2] = rgb[2];
        }
      }
    }
  }
  if (!(lo <= hi)) return null;
  // Edges: stepped along each segment a sample at a time, a dot two samples across where nothing is nearer than a
  // little in front of it (so an edge on a face it bounds still shows).
  const bias = Math.max(hi - lo, 1e-9) * 0.01;
  for (const b of bodies) {
    const base = b.own ? own : rest;
    const edges = b.edges ?? [];
    for (let i = 0; i + 5 < edges.length; i += 6) {
      const p = toPx([edges[i], edges[i + 1], edges[i + 2]]);
      const q = toPx([edges[i + 3], edges[i + 4], edges[i + 5]]);
      if (![...p, ...q].every(Number.isFinite)) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
      for (let j = 0; j <= steps; j++) {
        const f = j / steps;
        const x = p[0] + (q[0] - p[0]) * f;
        const y = p[1] + (q[1] - p[1]) * f;
        const z = p[2] + (q[2] - p[2]) * f;
        for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const sx = Math.floor(x + dx);
          const sy = Math.floor(y + dy);
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          const k = sy * W + sx;
          if (depth[k] > z + bias) continue; // hidden behind a nearer face
          if (depth[k] === -Infinity) depth[k] = z; // a silhouette: the edge covers the background there
          colour[3 * k] = base[0] * EDGE_SHADE;
          colour[3 * k + 1] = base[1] * EDGE_SHADE;
          colour[3 * k + 2] = base[2] * EDGE_SHADE;
        }
      }
    }
  }
  // Each picture pixel the mean of its samples; a sample with no body is clear.
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const k = (y * S + sy) * W + x * S + sx;
          if (depth[k] === -Infinity) continue;
          r += colour[3 * k];
          g += colour[3 * k + 1];
          bl += colour[3 * k + 2];
          n++;
        }
      }
      if (n === 0) continue;
      const o = 4 * (y * width + x);
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = bl / n;
      out[o + 3] = (255 * n) / (S * S);
    }
  }
  return out;
}

/** An "#rrggbb" or "rgb(r, g, b)" colour's numbers; null for anything else. */
export function rgbOf(colour: string): [number, number, number] | null {
  const c = colour.trim();
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as [number, number, number];
  const short = c.match(/^#([0-9a-f]{3})$/i);
  if (short) return [0, 1, 2].map((i) => parseInt(short[1][i] + short[1][i], 16)) as [number, number, number];
  const rgb = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** How far the other bodies' colour goes toward the picture's ground. */
export const REST_FADE = 1 / 3;

/** Colour `a` moved share `t` of the way to colour `b`, as "rgb(r, g, b)"; `a` as it is when either can't be read. */
export function mixed(a: string, b: string, t: number): string {
  const p = rgbOf(a);
  const q = rgbOf(b);
  if (!p || !q) return a;
  return `rgb(${p.map((c, i) => Math.round(c + (q[i] - c) * t)).join(", ")})`;
}

/** The two colours a picture is painted in: the item's own bodies and the rest. */
export interface PictureColours {
  own: string;
  rest: string;
}

/**
 * Which of the scene's bodies are item `f`'s own: the bodies a solid feature
 * built (a Combine's pieces too), or the bodies a Move moves; none for a
 * sketch or an item that built nothing.
 */
export function ownBodies(scene: Scene, f: Feature): Set<number> {
  const own = new Set<number>();
  let wanted: (b: Scene["bodies"][number]) => boolean = (b) => b.feature === f.id;
  if (f.intent.type === "move") {
    const ids = Array.isArray(f.intent.parameters.bodies) ? (f.intent.parameters.bodies as string[]) : f.dependsOn.map(bodyIdOf);
    wanted = (b) => ids.includes(b.body);
  } else if (f.intent.type === "sketch") return own;
  scene.bodies.forEach((b, i) => wanted(b) && own.add(i));
  return own;
}

// ---------------------------------------------------------------- the card on screen

/** The picture's size in CSS px. */
export const PICTURE_W = 200;
export const PICTURE_H = 112;

/** The pictures drawn, by scene, then by item and colours: drawn once, kept while the scene is the one shown. */
const pictures = new WeakMap<Scene, Map<string, string | null>>();
/** How many pictures have been painted (read by the tests: a second hover paints nothing). */
export const painted = { count: 0 };

/**
 * Item `f`'s picture of `scene` as an image URL, painted the first time it
 * is asked for with these colours and kept; null when there is nothing to
 * paint (no body in the scene) or no canvas to paint on.
 */
export function bodyPicture(doc: Document, scene: Scene, f: Feature, colours: PictureColours, ratio = 1): string | null {
  let kept = pictures.get(scene);
  if (!kept) pictures.set(scene, (kept = new Map()));
  const key = `${f.id}|${colours.own}|${colours.rest}|${ratio}`;
  if (kept.has(key)) return kept.get(key)!;
  const own = ownBodies(scene, f);
  const bodies: PaintBody[] = scene.bodies.map((b, i) => ({ positions: b.view.mesh.positions, indices: b.view.mesh.indices, edges: b.view.mesh.edge_lines, own: own.has(i) }));
  let url: string | null = null;
  const canvas = doc.createElement("canvas");
  canvas.width = Math.round(PICTURE_W * ratio);
  canvas.height = Math.round(PICTURE_H * ratio);
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (ctx && bodies.length > 0) {
    painted.count++;
    const rgba = rasterPicture(bodies, canvas.width, canvas.height, colours);
    if (rgba) {
      const image = ctx.createImageData(canvas.width, canvas.height);
      image.data.set(rgba);
      ctx.putImageData(image, 0, 0);
      url = canvas.toDataURL("image/png");
    }
  }
  kept.set(key, url);
  return url;
}

/** What the bar tells the card about the item it shows. */
export interface CardItem {
  feature: Feature;
  item: TimelineBarItem;
  index: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The card's element for this document: one, kept in the page's body, moved and refilled for each item. */
export function cardElement(doc: Document): HTMLElement {
  let card = doc.getElementById("timeline-card");
  if (!card) {
    card = doc.createElement("div");
    card.id = "timeline-card";
    card.className = "timeline-card";
    card.setAttribute("role", "tooltip");
    card.hidden = true;
    (doc.body ?? doc.documentElement).append(card);
  }
  return card;
}

/**
 * Fills the card for one item and shows it above `anchor` (the item on the
 * bar), inside the window. `scene` is what the view shows now, for a solid
 * item's picture; `slow` the items that took the kernel too long.
 */
export function showCard(anchor: HTMLElement, doc: DesignDocument, at: CardItem, scene: Scene | null, slow?: ReadonlySet<string>): HTMLElement {
  const page = anchor.ownerDocument;
  const card = cardElement(page);
  const facts = cardFacts(doc, at.feature, at.item, at.index, slow, currentUnit(page));
  card.replaceChildren();
  card.dataset.item = at.feature.id;
  const head = page.createElement("div");
  head.className = "timeline-card-head";
  const name = page.createElement("span");
  name.className = "timeline-card-name";
  name.textContent = facts.name;
  const number = page.createElement("span");
  number.className = "timeline-card-number";
  number.textContent = `#${facts.number}`;
  head.append(name, number);
  const kind = page.createElement("div");
  kind.className = "timeline-card-kind";
  kind.textContent = facts.kind;
  card.append(head, kind);
  // The picture: a sketch's outline, or the bodies with the item's own picked out.
  const picture = page.createElement("div");
  picture.className = "timeline-card-picture";
  if (at.feature.intent.type === "sketch") {
    const outline = sketchOutline(doc.sketches.find((s) => s.id === at.feature.id));
    if (outline) {
      const svg = page.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", outline.viewBox);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.setAttribute("aria-hidden", "true");
      const path = page.createElementNS(SVG_NS, "path");
      path.setAttribute("d", outline.d);
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(path);
      picture.append(svg);
      picture.dataset.picture = "outline";
    }
  } else if (scene && scene.bodies.length > 0 && !at.item.rolledBack && !at.item.suppressed && at.item.greyed === null) {
    const style = page.defaultView?.getComputedStyle(card);
    const read = (name: string, or: string) => style?.getPropertyValue(name).trim() || or;
    // The other bodies dimmed: their colour a third of the way to the picture's ground, in either theme.
    const colours = { own: read("--timeline-card-own", "#4aa8ff"), rest: mixed(read("--timeline-card-rest", "#8b95a3"), read("--timeline-card-ground", "#101216"), REST_FADE) };
    const url = bodyPicture(page, scene, at.feature, colours, Math.min(page.defaultView?.devicePixelRatio || 1, 3));
    if (url) {
      const img = page.createElement("img");
      img.src = url;
      img.alt = "";
      img.width = PICTURE_W;
      img.height = PICTURE_H;
      picture.append(img);
      picture.dataset.picture = ownBodies(scene, at.feature).size > 0 ? "bodies" : "others";
    }
  }
  if (picture.childElementCount > 0) card.append(picture);
  for (const line of facts.details) {
    const d = page.createElement("div");
    d.className = "timeline-card-detail";
    d.textContent = line;
    card.append(d);
  }
  if (picture.dataset.picture === "others") {
    const d = page.createElement("div");
    d.className = "timeline-card-note";
    d.textContent = "Its body isn't shown now (hidden, or used by a later item)";
    card.append(d);
  }
  if (facts.status) {
    const s = page.createElement("div");
    s.className = "timeline-card-status";
    s.dataset.tone = facts.status.tone;
    s.textContent = facts.status.words;
    card.append(s);
  }
  card.hidden = false;
  placeCard(card, anchor);
  anchor.setAttribute("aria-describedby", card.id);
  return card;
}

/** The gap (px) between the card and its item, and the least it keeps from the window's edges. */
const CARD_GAP = 8;
const CARD_EDGE = 6;

/** Puts the card above its item's row, centred on the item, kept inside the window (below it only when there is no room above). */
function placeCard(card: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const vw = anchor.ownerDocument.documentElement.clientWidth;
  card.style.left = "0px";
  card.style.top = "0px";
  const b = card.getBoundingClientRect();
  // Above the whole row, not just the item: at phone width the row is taller than its items.
  const row = anchor.closest(".timeline-bar")?.getBoundingClientRect();
  let top = Math.min(r.top, row?.top ?? r.top) - CARD_GAP - b.height;
  if (top < CARD_EDGE) top = r.bottom + CARD_GAP;
  const left = Math.min(Math.max(CARD_EDGE, r.left + r.width / 2 - b.width / 2), Math.max(CARD_EDGE, vw - CARD_EDGE - b.width));
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

/** Hides the card, if it shows. */
export function hideCard(page: Document) {
  const card = page.getElementById("timeline-card");
  if (!card || card.hidden) return;
  card.hidden = true;
  delete card.dataset.item;
  page.querySelector(`[aria-describedby="timeline-card"]`)?.removeAttribute("aria-describedby");
}
