// Step 48d3: seeded sessions of sketch edits elsewhere, on the real kernel,
// each step checked against a simple model of the region an extrude saved.
// The sketch starts as a 40 × 30 plate from (0, 0) with a radius 5 hole
// round (20, 15), and the extrude names the plate. Each step then draws or
// deletes something that never touches the plate's sides or its hole:
// circles and triangles inside the plate (new holes, as in Fusion), circles
// and lines outside it (nothing changes), a circle inside the hole (an
// island: the plate is unchanged), a curve turned to construction (left out
// of regions, so a hole it made is gone), a triangle losing one side (open,
// so no hole), a loose line's end moved (still outside). The model is the
// plate's area by hand, 1200 − 25π less each closed shape inside it that is
// not construction, from the shapes' own sizes (π r², or the shoelace sum of
// the triangle's corners); boxes round every shape inside the plate are kept
// apart by 0.5 mm, so no two of them touch. Each step builds the timeline
// and the extrude's volume must be that area × 10 mm. Seeded: a failing
// step names its seed and step, and replays exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { toggleConstruction } from "../src/construction.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { BodyCache, builtBody, rebuildTimeline } from "../src/rebuild.ts";
import { regionRef, sketchRegions } from "../src/regions.ts";
import { addSketch, deleteCurve, drawCircle, drawLine, drawRectangle, movePoint } from "../src/sketch.ts";

const kernel = nodeKernel();
const SEEDS = [1, 2, 3, 4, 5, 6, 48, 4803];
const STEPS = 40;

/** Mulberry32: a small seeded generator, so a failing session replays from its seed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shape the session drew: its curves, the box round it (inside the plate only), and the area it takes from the plate. */
interface Shape {
  curves: string[];
  box: [number, number, number, number] | null;
  area: number;
  /** A closed shape inside the plate, a curve outside it, the island in the hole, or a loose line outside. */
  kind: "hole" | "outside" | "island" | "line";
}

const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;

/** The extrude's volume (mm³) on the real kernel, or the build's words when it built nothing. */
async function volumeOf(doc: DesignDocument, id: string): Promise<number | string> {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const body = builtBody(b, id);
    if (body === undefined) return JSON.stringify(b.results[id]);
    return (await kernel.call("body_view", body.handle)).volume;
  } finally {
    await cache.close();
  }
}

/** One seeded session: `{ steps, counts }`, every step checked. */
async function session(seed: number) {
  const r = rng(seed);
  const below = (n: number) => Math.floor(r() * n);
  const round = (x: number) => Math.round(x * 10) / 10;
  const s = addSketch({ ...partDocument("box", 10, 10, 10), timeline: { features: [] }, profiles: [], bodies: [], nextBody: 1 } as DesignDocument);
  const sketch = s.id;
  const rect = drawRectangle(s.doc, sketch, [0, 0], [40, 30]);
  let doc = drawCircle(rect.doc, sketch, [20, 15], 5).doc;
  const found = await sketchRegions(kernel, sketchOf(doc, sketch));
  // The plate is the region whose outside is the rectangle's four sides.
  const plate = found.regions.find((g) => g.outer.length === 4)!;
  const e = extrudeSketch(doc, sketch, 10, false, regionRef(plate, found.ids));
  doc = e.doc;
  const shapes: Shape[] = [];
  const counts = { holes: 0, triangles: 0, outside: 0, islands: 0, lines: 0, deleted: 0, opened: 0, construction: 0, moved: 0 };
  // The hole round (20, 15) is a box too, with the plate's sides 0.5 mm in.
  const taken = (): [number, number, number, number][] => [[15, 10, 25, 20], ...shapes.flatMap((x) => (x.box ? [x.box] : []))];
  const apart = (b: [number, number, number, number]) =>
    b[0] >= 0.5 && b[1] >= 0.5 && b[2] <= 39.5 && b[3] <= 29.5 && taken().every((t) => b[2] + 0.5 <= t[0] || t[2] + 0.5 <= b[0] || b[3] + 0.5 <= t[1] || t[3] + 0.5 <= b[1]);
  for (let step = 0; step < STEPS; step++) {
    const at = `seed ${seed} step ${step}`;
    const k = r();
    if (k < 0.2) {
      // A circle inside the plate, apart from everything there: a new hole.
      const radius = round(0.5 + r() * 4);
      const [x, y] = [round(r() * 40), round(r() * 30)];
      const box: Shape["box"] = [x - radius, y - radius, x + radius, y + radius];
      if (apart(box)) {
        const c = drawCircle(doc, sketch, [x, y], radius);
        doc = c.doc;
        shapes.push({ curves: [c.id], box, area: Math.PI * radius * radius, kind: "hole" });
        counts.holes++;
      }
    } else if (k < 0.35) {
      // A triangle inside the plate: a hole of area |shoelace| / 2.
      const [x, y] = [round(r() * 36), round(r() * 26)];
      const p = [[x, y], [round(x + 1 + r() * 5), round(y + r() * 2)], [round(x + r() * 3), round(y + 1 + r() * 4)]] as [number, number][];
      const box: Shape["box"] = [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
      const area = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2;
      if (area > 0.5 && apart(box)) {
        const a = drawLine(doc, sketch, p[0], p[1]);
        const ends = sketchOf(a.doc, sketch).curves.find((c) => c.id === a.id) as { start: string; end: string };
        const b = drawLine(a.doc, sketch, ends.end, p[2]);
        const third = (sketchOf(b.doc, sketch).curves.find((c) => c.id === b.id) as { end: string }).end;
        const c = drawLine(b.doc, sketch, third, ends.start);
        doc = c.doc;
        shapes.push({ curves: [a.id, b.id, c.id], box, area, kind: "hole" });
        counts.triangles++;
      }
    } else if (k < 0.5) {
      // A circle wholly outside the plate (right of x = 45 or above y = 35): nothing changes.
      const radius = round(1 + r() * 10);
      const right = r() < 0.5;
      const c = drawCircle(doc, sketch, right ? [round(46 + radius + r() * 40), round(r() * 60 - 15)] : [round(r() * 60 - 10), round(36 + radius + r() * 40)], radius);
      doc = c.doc;
      shapes.push({ curves: [c.id], box: null, area: 0, kind: "outside" });
      counts.outside++;
    } else if (k < 0.6) {
      // A loose line outside the plate, crossing whatever is out there: nothing changes.
      const l = drawLine(doc, sketch, [round(50 + r() * 50), round(r() * 80 - 20)], [round(50 + r() * 50), round(r() * 80 - 20)]);
      doc = l.doc;
      shapes.push({ curves: [l.id], box: null, area: 0, kind: "line" });
      counts.lines++;
    } else if (k < 0.65 && !shapes.some((x) => x.kind === "island")) {
      // An island in the hole round (20, 15): a region of its own, the plate keeps its one hole there.
      const c = drawCircle(doc, sketch, [round(19 + r() * 2), round(14 + r() * 2)], round(0.5 + r() * 2.5));
      doc = c.doc;
      shapes.push({ curves: [c.id], box: null, area: 0, kind: "island" });
      counts.islands++;
    } else if (k < 0.8 && shapes.length > 0) {
      // A shape deleted, curve by curve: a hole gone fills in again.
      const i = below(shapes.length);
      for (const id of shapes[i].curves) doc = deleteCurve(doc, sketch, id);
      shapes.splice(i, 1);
      counts.deleted++;
    } else if (k < 0.87) {
      // A triangle loses one side: open, it is no hole, and its two lines are left loose inside the plate.
      const i = shapes.findIndex((x) => x.kind === "hole" && x.curves.length === 3);
      if (i >= 0) {
        const [gone, ...left] = shapes[i].curves;
        doc = deleteCurve(doc, sketch, gone);
        shapes[i] = { ...shapes[i], curves: left, area: 0 };
        counts.opened++;
      }
    } else if (k < 0.93) {
      // A hole's curves turned to construction: left out of regions, so the hole is gone (its box stays taken).
      const i = shapes.findIndex((x) => x.kind === "hole" && x.area > 0);
      if (i >= 0) {
        const turned = toggleConstruction(doc, sketch, shapes[i].curves);
        assert.ok("doc" in turned, `${at}: ${JSON.stringify(turned)}`);
        doc = turned.doc;
        shapes[i] = { ...shapes[i], area: 0 };
        counts.construction++;
      }
    } else {
      // A loose line's end moved, still outside the plate.
      const line = shapes.find((x) => x.kind === "line");
      if (line) {
        const c = sketchOf(doc, sketch).curves.find((x) => x.id === line.curves[0]) as { end: string };
        doc = movePoint(doc, sketch, c.end, round(50 + r() * 50), round(r() * 80 - 20));
        counts.moved++;
      }
    }
    // The model: 1200 − 25π less every closed, normal shape inside the plate.
    const want = (1200 - 25 * Math.PI - shapes.reduce((sum, x) => sum + x.area, 0)) * 10;
    const got = await volumeOf(doc, e.id);
    assert.equal(typeof got, "number", `${at}: the extrude built nothing: ${got}`);
    assert.ok(Math.abs((got as number) - want) <= 1e-9 * want, `${at}: ${got} mm³, the model ${want}`);
  }
  return counts;
}

test("seeded sketch edits elsewhere never change which region an extrude builds: its volume is the model's at every step", async () => {
  const total: Record<string, number> = {};
  for (const seed of SEEDS) for (const [k, n] of Object.entries(await session(seed))) total[k] = (total[k] ?? 0) + n;
  // Every kind of edit came up, or the sessions prove nothing about it.
  for (const [k, n] of Object.entries(total)) assert.ok(n >= 3, `only ${n} ${k}`);
});

test("the same seed gives the same session", async () => {
  assert.deepEqual(await session(7), await session(7));
});
