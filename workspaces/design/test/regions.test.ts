// Step 48c: an extrude of a sketch region (regions.ts) on the real kernel.
// Hand-worked volumes with their working; the region found again by its
// curves' ids after edits elsewhere in the sketch; a lost region keeping
// the extrude's last shape; an old extrude without a region building
// exactly as before; side faces named, a curve passed twice by its runs;
// the file's checks on `region` (version 9 brought it). In the browser:
// apps/fission/e2e/extrude-regions.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls, SketchRegion } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { featureNames } from "../src/naming.ts";
import { BodyCache, builtBody, rebuildTimeline, REGION_GONE, settleKept, type CurveIds } from "../src/rebuild.ts";
import { findRegion, regionRef, sameLoop, sketchRegions, type RegionRef } from "../src/regions.ts";
import { addSketch, deleteCurve, drawCircle, drawLine, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a}, expected ${b}`);

/** Builds `doc` and gives each built item's volume (mm³) and the build, every body freed after. */
async function build(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const volumes: Record<string, number> = {};
    const views: Record<string, Awaited<ReturnType<KernelCalls["call"]>>> = {};
    for (const id of b.order) {
      const body = builtBody(b, id);
      if (body === undefined) continue;
      const view = await kernel.call("body_view", body.handle);
      volumes[id] = view.volume;
      views[id] = view;
    }
    return { build: b, volumes, views };
  } finally {
    await cache.close();
  }
}

/** A sketch on XY with a 40 × 30 rectangle from (0, 0) and a circle of radius 5 round (20, 15): two regions, the plate with a hole and the disc. */
function plateWithHole() {
  const s = addSketch({ ...partDocument("box", 10, 10, 10), timeline: { features: [] }, profiles: [], bodies: [], nextBody: 1 } as DesignDocument);
  const r = drawRectangle(s.doc, s.id, [0, 0], [40, 30]);
  const c = drawCircle(r.doc, s.id, [20, 15], 5);
  return { doc: c.doc, sketch: s.id, sides: r.ids, circle: c.id };
}

/** The region of `sketch` in `doc` whose outside is made of exactly the curves `ids` (any order), as an extrude saves it. */
async function pick(doc: DesignDocument, sketch: string, ids: string[]): Promise<{ region: SketchRegion; ref: RegionRef; all: SketchRegion[]; curveIds: CurveIds }> {
  const found = await sketchRegions(kernel, sketchOf(doc, sketch));
  const region = found.regions.find((r) => {
    const named = r.outer.map((p) => found.ids[p.curve][p.index]);
    return new Set(named).size === ids.length && ids.every((id) => named.includes(id));
  });
  assert.ok(region, `a region round ${ids.join(", ")}`);
  return { region, ref: regionRef(region, found.ids), all: found.regions, curveIds: found.ids };
}

test("hand-worked: a 40 × 30 plate with a radius 5 hole extrudes to 11214.60 mm³ by 10 mm, and the disc in the hole to 785.40 mm³", async () => {
  const { doc, sketch, sides, circle } = plateWithHole();
  const plate = await pick(doc, sketch, sides);
  const disc = await pick(doc, sketch, [circle]);
  assert.equal(plate.all.length, 2, "two regions: the plate round the hole and the disc");
  // The plate's area: 40 × 30 − π 5² = 1200 − 78.5398… = 1121.4602 mm²; the disc's π 5² = 78.5398 mm²; both centred at (20, 15) by symmetry.
  close(plate.region.area, 1200 - 25 * Math.PI, "plate area");
  close(disc.region.area, 25 * Math.PI, "disc area");
  close(plate.ref.centroid[0], 20, "centroid x");
  close(plate.ref.centroid[1], 15, "centroid y");
  // Holes come with the region: the plate's outline has the circle as its one hole.
  assert.equal(plate.region.holes.length, 1);
  const a = extrudeSketch(doc, sketch, 10, false, plate.ref);
  const b = extrudeSketch(a.doc, sketch, 10, false, disc.ref);
  const { volumes } = await build(b.doc);
  // Volume = area × 10: 11214.602 mm³ and 785.398 mm³.
  close(volumes[a.id], (1200 - 25 * Math.PI) * 10, "plate");
  close(volumes[b.id], 25 * Math.PI * 10, "disc");
});

test("the region is found again by its curves' ids: lines and a circle drawn elsewhere, or a curve deleted elsewhere, never change which region it extrudes", async () => {
  const { doc, sketch, sides } = plateWithHole();
  const plate = await pick(doc, sketch, sides);
  const e = extrudeSketch(doc, sketch, 10, false, plate.ref);
  // A triangle drawn to the right of the plate, and a circle in the plate's top-left corner: the plate now has two holes.
  let d = e.doc;
  const p = (x: number, y: number) => [x, y] as const;
  d = drawLine(d, sketch, p(50, 0), p(60, 0)).doc;
  const at = (x: number, y: number) => sketchOf(d, sketch).points.find((q) => q.x === x && q.y === y)!.id;
  d = drawLine(d, sketch, at(60, 0), p(55, 10)).doc;
  d = drawLine(d, sketch, at(55, 10), at(50, 0)).doc;
  const corner = drawCircle(d, sketch, [5, 25], 2);
  d = corner.doc;
  const { volumes } = await build(d);
  // (1200 − 25π − 4π) × 10 = (1200 − 29π) × 10 = 11088.938 mm³: the new circle is a second hole, as in Fusion.
  close(volumes[e.id], (1200 - 29 * Math.PI) * 10, "plate with two holes");
  // The new circle deleted again: back to one hole, 11214.602 mm³.
  const back = await build(deleteCurve(d, sketch, corner.id));
  close(back.volumes[e.id], (1200 - 25 * Math.PI) * 10, "plate with its one hole");
});

test("a region the sketch no longer makes (a line cuts it in two) keeps the extrude's last shape, with the words saying why", async () => {
  const { doc, sketch, sides } = plateWithHole();
  const plate = await pick(doc, sketch, sides);
  const e = extrudeSketch(doc, sketch, 10, false, plate.ref);
  const at = (x: number, y: number) => sketchOf(e.doc, sketch).points.find((q) => q.x === x && q.y === y)!.id;
  // A line from the bottom-left corner (0, 0) to the top-right (40, 30): it crosses the hole, so no region is round the four sides alone.
  const cut = drawLine(e.doc, sketch, at(0, 0), at(40, 30)).doc;
  const settled = await settleKept(kernel, e.doc, cut);
  assert.ok(settled.kept?.[e.id], "the rectangle and circle kept for the extrude");
  const { build: b, volumes } = await build(settled);
  const r = b.results[e.id];
  assert.equal(r.status, "built");
  assert.equal(r.status === "built" && r.warning?.message, `Sketch 1 ${REGION_GONE}`);
  close(volumes[e.id], (1200 - 25 * Math.PI) * 10, "the kept plate");
  // Without the kept shape it fails, with the same words.
  const { kept: _, ...bare } = settled;
  const failed = (await build(bare)).build.results[e.id];
  assert.deepEqual(failed.status === "failed" && [failed.cause, failed.message], ["open-outline", `Sketch 1 ${REGION_GONE}`]);
});

test("an old extrude with no region builds its sketch's one outline exactly as before, and still refuses a sketch with a circle inside", async () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [20, 10]);
  const old = extrudeSketch(r.doc, s.id, 10);
  assert.equal(Object.hasOwn(old.doc.timeline.features.find((f) => f.id === old.id)!.intent.parameters, "region"), false);
  const a = await build(old.doc);
  // The spec is sketch_outline's outline, field for field (no holePieces: named as before 48).
  const outline = await kernel.call("sketch_outline", [{ a: [0, 0], b: [20, 0] }, { a: [20, 0], b: [20, 10] }, { a: [20, 10], b: [0, 10] }, { a: [0, 10], b: [0, 0] }], [], []);
  assert.ok("closed" in outline);
  assert.deepEqual(builtBody(a.build, old.id)!.spec, { extrude: { profile: outline.closed, distance: 10 } });
  close(a.volumes[old.id], 2000, "20 × 10 × 10");
  // A circle inside: the one-outline rule refuses it, so the extrude keeps nothing and fails, as before 48.
  const withCircle = drawCircle(old.doc, s.id, [10, 5], 2).doc;
  const failed = (await build(withCircle)).build.results[old.id];
  assert.equal(failed.status, "failed");
});

test("side faces are named by their curves, a hole's too, and a curve the region passes twice by its runs", async () => {
  // A circle of radius 5 round (0, 0) with lines x = −2 and x = 2 across it: the middle band runs line, circle, line, circle.
  const s = addSketch({ ...partDocument("box", 10, 10, 10), timeline: { features: [] }, profiles: [], bodies: [], nextBody: 1 } as DesignDocument);
  const c = drawCircle(s.doc, s.id, [0, 0], 5);
  const l1 = drawLine(c.doc, s.id, [-2, -10], [-2, 10]);
  const l2 = drawLine(l1.doc, s.id, [2, -10], [2, 10]);
  const band = await pick(l2.doc, s.id, [l1.id, c.id, l2.id]);
  assert.equal(band.region.outer.length, 4, "line, circle, line, circle");
  const e = extrudeSketch(l2.doc, s.id, 10, false, band.ref);
  const { build: b, views, volumes } = await build(e.doc);
  // The band's area: the circle's strip |x| ≤ 2, ∫ 2√(25 − x²) dx from −2 to 2 = [x√(25 − x²) + 25 asin(x/5)] = 2(2√21 + 25 asin(0.4)) = 38.906 mm².
  close(volumes[e.id], 2 * (2 * Math.sqrt(21) + 25 * Math.asin(0.4)) * 10, "band");
  const names = featureNames(e.id, builtBody(b, e.id)!, views[e.id]);
  const sides = names.faces.filter((n) => n?.startsWith("side:")).sort();
  assert.deepEqual(sides, [`side:${c.id}#1`, `side:${c.id}#2`, `side:${l1.id}`, `side:${l2.id}`].sort());
  // The plate's hole side is named by its circle.
  const plate = plateWithHole();
  const ring = await pick(plate.doc, plate.sketch, plate.sides);
  const pe = extrudeSketch(plate.doc, plate.sketch, 10, false, ring.ref);
  const pb = await build(pe.doc);
  const plateNames = featureNames(pe.id, builtBody(pb.build, pe.id)!, pb.views[pe.id]);
  assert.ok(plateNames.faces.includes(`side:${plate.circle}`), plateNames.faces.join(" "));
  assert.equal(plateNames.faces.filter((n) => n?.startsWith("side:")).length, 5, "four sides and the hole's");
});

test("two regions with one name are told apart by the centroid nearest the saved one; none with the name is undefined", () => {
  const piece = (index: number, reversed = false) => ({ curve: "line" as const, index, reversed });
  const region = (cx: number, start: number): SketchRegion => ({
    outer: [piece(start % 3), piece((start + 1) % 3), piece((start + 2) % 3)],
    holes: [],
    area: 1,
    centroid: [cx, 0],
    profile: { outer: { path: { corners: [], bulges: [] } }, holes: [], pieces: [] },
    holePieces: [],
    extrudes: true,
  });
  const ids: CurveIds = { line: ["a", "b", "c"], arc: [], circle: [] };
  const left = region(-10, 0);
  const right = region(10, 1);
  const name = [{ curve: "a", reversed: false }, { curve: "b", reversed: false }, { curve: "c", reversed: false }];
  // The same loop whichever piece the list starts at: b, c, a is a, b, c.
  assert.equal(findRegion([left, right], ids, { outer: name, centroid: [9, 0] }), right);
  assert.equal(findRegion([left, right], ids, { outer: name, centroid: [-9, 0] }), left);
  // Halfway, equally near both: the first listed.
  assert.equal(findRegion([left, right], ids, { outer: name, centroid: [0, 0] }), left);
  // Another order round (a, c, b) or a piece run the other way is another name.
  assert.equal(findRegion([left, right], ids, { outer: [name[0], name[2], name[1]], centroid: [9, 0] }), undefined);
  assert.equal(findRegion([left, right], ids, { outer: [{ curve: "a", reversed: true }, name[1], name[2]], centroid: [9, 0] }), undefined);
  assert.equal(sameLoop([], []), false, "no pieces is no loop");
  assert.equal(sameLoop(name, name.slice(0, 2)), false);
});

test("a region the kernel can't extrude fails the extrude with its words and marks its curves", async () => {
  const { doc, sketch, sides } = plateWithHole();
  const plate = await pick(doc, sketch, sides);
  const e = extrudeSketch(doc, sketch, 10, false, plate.ref);
  // The kernel's answer with the region refused (as a doubtful one is), naming line 0 and the circle.
  const refusing: KernelCalls = {
    call: (async (op: string, ...args: unknown[]) => {
      const answer = await (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args);
      if (op !== "sketch_regions") return answer;
      const a = answer as { regions: SketchRegion[] };
      return { ...a, regions: a.regions.map((r) => ({ ...r, extrudes: false, refused: "the curves meet too closely near (0, 0) to tell the regions apart", invalid: [{ input: "line", index: 0 }, { input: "circle", index: 0 }] })) };
    }) as KernelCalls["call"],
  };
  const cache = new BodyCache(kernel);
  try {
    const r = (await rebuildTimeline(e.doc, cache, refusing)).results[e.id];
    assert.deepEqual(r.status === "failed" && [r.cause, r.message, r.curves], ["invalid-outline", "Sketch 1's region can't be extruded: the curves meet too closely near (0, 0) to tell the regions apart", [sides[0], plateWithHole().circle]]);
  } finally {
    await cache.close();
  }
});

test("the file's checks on region: saved and read back exactly; version 8 holding one, and every broken shape, refused with its message", async () => {
  const { doc, sketch, sides } = plateWithHole();
  const plate = await pick(doc, sketch, sides);
  const e = extrudeSketch(doc, sketch, 10, false, plate.ref);
  const data = JSON.parse(JSON.stringify(e.doc));
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(data))), e.doc);
  const refused = (change: (region: Record<string, unknown>, d: Record<string, unknown>) => void, message: string) => {
    const d = JSON.parse(JSON.stringify(data));
    change(d.timeline.features.find((f: { id: string }) => f.id === e.id).intent.parameters.region, d);
    assert.throws(() => readDesignDocument(d), { message });
  };
  const where = `Design feature ${e.id}'s region`;
  refused((_, d) => (d.version = 8), "Design data says version 8 but has an extrude naming its sketch region, which version 9 brought");
  refused((r) => (r.extra = 1), `${where} has extra, which a region never holds`);
  refused((r) => (r.outer = []), `${where}'s outer is not a list of the curves round it`);
  refused((r) => (r.outer = "line-5"), `${where}'s outer is not a list of the curves round it`);
  refused((r) => ((r.outer as unknown[])[1] = { curve: 5, reversed: false }), `${where}'s curve 2 is not { curve: an id, reversed: true or false }`);
  refused((r) => ((r.outer as unknown[])[0] = { curve: "line-5", reversed: "no" }), `${where}'s curve 1 is not { curve: an id, reversed: true or false }`);
  refused((r) => ((r.outer as unknown[])[0] = { curve: "line-5", reversed: false, more: 1 }), `${where}'s curve 1 is not { curve: an id, reversed: true or false }`);
  refused((r) => (r.centroid = [1, null]), `${where}'s centroid a list is not two numbers of mm`);
  refused((r) => (r.centroid = [1, 2, 3]), `${where}'s centroid a list is not two numbers of mm`);
  refused((r, d) => ((d.timeline as { features: { intent: { parameters: Record<string, unknown> } }[] }).features.find((f) => f.intent.parameters.region === r)!.intent.parameters.region = null), `${where} is not an object with outer and centroid`);
  // Version 8 data without a region reads as version 9, unchanged.
  const v8 = JSON.parse(JSON.stringify(extrudeSketch(doc, sketch, 10).doc));
  assert.equal(readDesignDocument({ ...v8, version: 8 }).version, 9);
});
