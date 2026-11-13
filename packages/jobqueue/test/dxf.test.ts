// Reading a laser job's DXF (dxf.ts): hand-worked drawings with the working shown, units, colours by entity and by
// layer, blocks, mirrored entities, splines, every refusal, and seeded random drawings against a simple model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readDxf } from "../src/dxf.ts";
import type { DrawingRead } from "../src/svg.ts";

type Ent = (string | number)[];
/** A DXF from pairs: a header with $INSUNITS, an optional layer table and blocks, then the entities. */
function dxf(entities: Ent[], opts: { units?: number | null; layers?: [string, number, number?][]; blocks?: { name: string; base?: [number, number]; ents: Ent[] }[] } = {}): string {
  const out: (string | number)[] = [];
  if (opts.units !== null) out.push(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, opts.units ?? 4, 0, "ENDSEC");
  if (opts.layers) {
    out.push(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER");
    for (const [name, colour, flags] of opts.layers) out.push(0, "LAYER", 2, name, 70, flags ?? 0, 62, colour);
    out.push(0, "ENDTAB", 0, "ENDSEC");
  }
  if (opts.blocks) {
    out.push(0, "SECTION", 2, "BLOCKS");
    for (const b of opts.blocks) {
      out.push(0, "BLOCK", 8, "0", 2, b.name, 10, b.base?.[0] ?? 0, 20, b.base?.[1] ?? 0);
      for (const e of b.ents) out.push(...e);
      out.push(0, "ENDBLK");
    }
    out.push(0, "ENDSEC");
  }
  out.push(0, "SECTION", 2, "ENTITIES");
  for (const e of entities) out.push(...e);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}
const line = (x1: number, y1: number, x2: number, y2: number, colour = 1): Ent => [0, "LINE", 8, "0", 62, colour, 10, x1, 20, y1, 11, x2, 21, y2];
const circle = (x: number, y: number, r: number, colour = 1, extra: Ent = []): Ent => [0, "CIRCLE", 8, "0", 62, colour, 10, x, 20, y, 40, r, ...extra];

function ok(text: string): DrawingRead {
  const r = readDxf(text);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.drawing;
}
function no(text: string, words: RegExp): void {
  const r = readDxf(text);
  assert.ok(!r.ok, "read when it should be refused");
  assert.match(r.reason, words);
}
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("hand-worked: lines, arcs across 0°, bulges, ellipses and units", () => {
  let d = ok(dxf([line(0, 0, 30, 0), line(30, 0, 30, 20, 5), circle(100, 0, 10, 7)]));
  // Lines 0..30 and the circle 90..110 across; up to 20 and down to −10 (the circle).
  near(d.width, 110);
  near(d.height, 30);
  assert.deepEqual(d.layers, { cut: 1, score: 1, engrave: 1 });
  assert.match(d.notes.join(" "), /fill/);
  // An arc from 350° to 10° of radius 10 passes 0°, so it reaches x = 10, and is 2·10·sin 10° tall.
  d = ok(dxf([[0, "ARC", 8, "0", 62, 1, 10, 0, 20, 0, 40, 10, 50, 350, 51, 10]]));
  near(d.width, 10 - 10 * Math.cos((10 * Math.PI) / 180));
  near(d.height, 20 * Math.sin((10 * Math.PI) / 180));
  // An LWPOLYLINE from (0,0) to (20,0) with bulge 1 (a half circle of radius 10, dipping to y = −10), closed by a
  // straight line back: 20 × 10.
  d = ok(dxf([[0, "LWPOLYLINE", 8, "0", 62, 1, 90, 2, 70, 1, 10, 0, 20, 0, 42, 1, 10, 20, 20, 0]]));
  near(d.width, 20);
  near(d.height, 10);
  // The same as an R12 POLYLINE with VERTEXes and SEQEND.
  d = ok(dxf([[0, "POLYLINE", 8, "0", 62, 1, 66, 1, 70, 1, 0, "VERTEX", 8, "0", 10, 0, 20, 0, 42, 1, 0, "VERTEX", 8, "0", 10, 20, 20, 0, 0, "SEQEND"]]));
  near(d.height, 10);
  // A whole ellipse, major axis (20, 0), ratio 0.5: 40 × 20.
  d = ok(dxf([[0, "ELLIPSE", 8, "0", 62, 1, 10, 0, 20, 0, 11, 20, 21, 0, 40, 0.5, 41, 0, 42, 2 * Math.PI]]));
  near(d.width, 40);
  near(d.height, 20);
  // Its upper half (parameters 0 to π): 40 × 10.
  d = ok(dxf([[0, "ELLIPSE", 8, "0", 62, 1, 10, 0, 20, 0, 11, 20, 21, 0, 40, 0.5, 41, 0, 42, Math.PI]]));
  near(d.height, 10);
  // In inches: a 2-inch line is 50.8 mm; in centimetres 2 is 20 mm; with no units, millimetres and a note.
  d = ok(dxf([line(0, 0, 2, 0)], { units: 1 }));
  near(d.width, 50.8);
  assert.match(d.notes.join(" "), /inches/);
  near(ok(dxf([line(0, 0, 2, 0)], { units: 5 })).width, 20);
  d = ok(dxf([line(0, 0, 2, 0)], { units: 0 }));
  near(d.width, 2);
  assert.match(d.notes.join(" "), /doesn't say its units/);
  near(ok(dxf([line(0, 0, 2, 0)], { units: null })).width, 2);
});

test("hand-worked: entities drawn upside down are mirrored back", () => {
  // Extrusion (0, 0, −1): the entity's own x runs the other way, so a circle at own (50, 0) sits at (−50, 0). With a
  // line from 0 to 10 the drawing then spans −60..10: 70 wide. Read upright it would be 0..60.
  const d = ok(dxf([line(0, 0, 10, 0), circle(50, 0, 10, 1, [210, 0, 220, 0, 230, -1])]));
  near(d.width, 70);
  // An arc 0°..90° of radius 10 mirrored lies in x −10..0: with a line at x = 5 the span is 15, not 10.
  const a = ok(dxf([line(5, 0, 5, 1), [0, "ARC", 8, "0", 62, 1, 10, 0, 20, 0, 40, 10, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1]]));
  near(a.width, 15);
  no(dxf([circle(0, 0, 1, 1, [210, 1, 220, 0, 230, 0])]), /not lying flat/);
});

test("colours: the entity's own, then its layer's; layers off left out", () => {
  const layers: [string, number, number?][] = [["CUTS", 1], ["MARKS", 5], ["GONE", -1], ["FROZEN", 1, 1], ["GREEN", 3]];
  const byLayer = (layer: string, x: number): Ent => [0, "LINE", 8, layer, 10, x, 20, 0, 11, x + 1, 21, 0];
  let d = ok(dxf([byLayer("CUTS", 0), byLayer("MARKS", 10), byLayer("GONE", 100), byLayer("FROZEN", 200)], { layers }));
  assert.deepEqual(d.layers, { cut: 1, score: 1, engrave: 0 });
  near(d.width, 11);
  assert.match(d.notes.join(" "), /2 entities are hidden/);
  // An entity's own colour beats its layer's; a true colour of pure red is red.
  d = ok(dxf([[0, "LINE", 8, "GREEN", 62, 5, 10, 0, 20, 0, 11, 1, 21, 0], [0, "LINE", 8, "GREEN", 420, 0xff0000, 10, 0, 20, 0, 11, 1, 21, 0]], { layers }));
  assert.deepEqual(d.layers, { cut: 1, score: 1, engrave: 0 });
  no(dxf([byLayer("GREEN", 0)], { layers }), /colour 3.*1 \(red\).*5 \(blue\).*7/);
  no(dxf([[0, "LINE", 8, "0", 420, 0x00ff00, 10, 0, 20, 0, 11, 1, 21, 0]]), /#00ff00/);
  // A layer the table doesn't list is colour 7: engrave.
  assert.deepEqual(ok(dxf([byLayer("NOWHERE", 0)])).layers, { cut: 0, score: 0, engrave: 1 });
});

test("hand-worked: blocks placed, scaled, turned and nested; BYBLOCK colours", () => {
  // Block S: a 10 × 2 line pair with its base at (10, 0). Placed at (100, 100), scale 2, turned 90°: the base goes to
  // (100, 100); the far corner (0, 2), 10 left and 2 up of the base, becomes (−20, 4) scaled and (−4, −20) turned,
  // so the placed block spans 4 across and 20 up/down.
  const blocks = [
    { name: "S", base: [10, 0] as [number, number], ents: [line(0, 0, 10, 0), line(0, 2, 10, 2)] },
    { name: "OUTER", ents: [[0, "INSERT", 8, "0", 2, "S", 10, 0, 20, 0, 41, 1, 42, 1], [0, "LINE", 8, "0", 62, 0, 10, 5, 20, 0, 11, 5, 21, 1]] as Ent[] },
    { name: "SELF", ents: [[0, "INSERT", 8, "0", 2, "SELF", 10, 0, 20, 0]] as Ent[] },
  ];
  let d = ok(dxf([[0, "INSERT", 8, "0", 2, "S", 10, 100, 20, 100, 41, 2, 42, 2, 50, 90]], { blocks }));
  near(d.width, 4, 1e-9);
  near(d.height, 20, 1e-9);
  // Nested: OUTER holds S (unturned, 10 × 2, shifted left by its base to x −10..0) and a BYBLOCK line at x = 5 taking
  // the insert's colour 5 (score): −10..5 is 15 wide (with the base forgotten S would sit at 0..10, 10 wide).
  d = ok(dxf([[0, "INSERT", 8, "0", 62, 5, 2, "OUTER", 10, 0, 20, 0]], { blocks }));
  near(d.width, 15);
  assert.deepEqual(d.layers, { cut: 2, score: 1, engrave: 0 });
  no(dxf([[0, "INSERT", 8, "0", 2, "SELF", 10, 0, 20, 0]], { blocks }), /nested too deep/);
  no(dxf([[0, "INSERT", 8, "0", 2, "MISSING", 10, 0, 20, 0]], { blocks }), /block "MISSING"/);
  no(dxf([[0, "INSERT", 8, "0", 2, "S", 10, 0, 20, 0, 70, 3]], { blocks }), /array/);
});

test("hand-worked: a spline measured by sampling, with its control points' box as the most it reaches", () => {
  // A clamped quadratic B-spline with knots 0 0 0 1 1 1 is the Bézier (0,0) (10,20) (20,0): it rises to half the
  // control point's height, 10, at t = ½ (a sample, 32 of 64). Its control points reach 20, so it may be 10 more.
  const spline: Ent = [0, "SPLINE", 8, "0", 62, 1, 70, 8, 71, 2, 72, 6, 73, 3, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 10, 0, 20, 0, 10, 10, 20, 20, 10, 20, 20, 0];
  const d = ok(dxf([spline]));
  near(d.width, 20);
  near(d.height, 10, 1e-12);
  near(d.slack, 10);
  assert.match(d.notes.join(" "), /at most 10\.000 mm more/);
  // A rational quarter circle: controls (10,0) (10,10) (0,10), weights 1, √½, 1, is exactly the arc of radius 10, so
  // every sample lies on the circle: x² + y² = 100 at the samples, and the box is 10 × 10.
  const quarter: Ent = [0, "SPLINE", 8, "0", 62, 1, 70, 12, 71, 2, 72, 6, 73, 3, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 10, 10, 20, 0, 41, 1, 10, 10, 20, 10, 41, Math.SQRT1_2, 10, 0, 20, 10, 41, 1];
  const q = ok(dxf([quarter]));
  near(q.width, 10, 1e-12);
  near(q.height, 10, 1e-12);
  no(dxf([[0, "SPLINE", 8, "0", 62, 1, 71, 2, 40, 0, 40, 1, 10, 0, 20, 0, 10, 1, 20, 1, 10, 2, 20, 0]]), /knots don't match/);
  no(dxf([[0, "SPLINE", 8, "0", 62, 1, 71, 3, 11, 0, 21, 0, 11, 1, 21, 1]]), /fit points/);
});

test("every refusal says what to do", () => {
  no(dxf([[0, "TEXT", 8, "0", 10, 0, 20, 0, 1, "Hi"]]), /text.*outlines/);
  no(dxf([[0, "MTEXT", 8, "0", 10, 0, 20, 0, 1, "Hi"]]), /text/);
  no(dxf([[0, "HATCH", 8, "0"]]), /hatch.*colour 7/);
  no(dxf([[0, "DIMENSION", 8, "0"]]), /dimension/);
  no(dxf([[0, "IMAGE", 8, "0"]]), /picture/);
  no(dxf([[0, "XLINE", 8, "0"]]), /never ends/);
  no(dxf([[0, "WIDGET", 8, "0", 62, 1]]), /WIDGET.*explode/);
  no(dxf([line(0, 0, 1, 0)], { units: 3 }), /units.*millimetres/);
  no("AutoCAD Binary DXF\r\n\x1a\x00", /binary DXF/);
  no("0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n", /pairs/);
  no("zero\nSECTION\n", /group code/);
  no(dxf([[0, "LINE", 8, "0", 62, 1, 10, "x", 20, 0, 11, 1, 21, 0]]), /number/);
  no(dxf([[0, "CIRCLE", 8, "0", 62, 1, 10, 0, 20, 0, 40, 0]]), /radius/);
  no(dxf([]), /nothing for the laser/);
  no(dxf([[0, "POINT", 8, "0", 10, 0, 20, 0]]), /nothing for the laser/);
  no("0\nSECTION\n2\nENTITIES\n0\nLINE\n", /ENTITIES section never ends|pairs/);
});

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded random drawings: lines, circles and quarter arcs against their extreme points worked apart", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = mulberry(seed);
    const ents: Ent[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const n = 1 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const [x, y] = [Math.round((r() - 0.5) * 2000) / 4, Math.round((r() - 0.5) * 2000) / 4];
      const rad = 1 + Math.round(r() * 100);
      const pick = Math.floor(r() * 3);
      if (pick === 0) {
        const [x2, y2] = [x + Math.round((r() - 0.5) * 400), y + Math.round((r() - 0.5) * 400)];
        ents.push(line(x, y, x2, y2));
        xs.push(x, x2);
        ys.push(y, y2);
      } else if (pick === 1) {
        ents.push(circle(x, y, rad, 5));
        xs.push(x - rad, x + rad);
        ys.push(y - rad, y + rad);
      } else {
        // A quarter arc between two of the compass points: its box is the centre and those two points.
        const q = Math.floor(r() * 4);
        ents.push([0, "ARC", 8, "0", 62, 7, 10, x, 20, y, 40, rad, 50, 90 * q, 51, 90 * q + 90]);
        const pts = [[x + rad, y], [x, y + rad], [x - rad, y], [x, y - rad]];
        for (const p of [pts[q % 4]!, pts[(q + 1) % 4]!]) {
          xs.push(p[0]!);
          ys.push(p[1]!);
        }
      }
    }
    const d = ok(dxf(ents));
    near(d.width, Math.max(...xs) - Math.min(...xs), 1e-9);
    near(d.height, Math.max(...ys) - Math.min(...ys), 1e-9);
  }
});
