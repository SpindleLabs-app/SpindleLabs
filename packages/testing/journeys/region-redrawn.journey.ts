// Timeline hunt 2026-11-11 (A3): the region an extrude saves (regions.ts
// RegionRef: the curves round it and its centroid) describes the region as it
// is after every settled edit, so "a side deleted and drawn again between the
// same corners" (REDRAWN_CENTROID) is found again however the sketch was
// reshaped since the region was picked, and a region found again by its shape
// goes on following its sketch. The centroid and the names were saved at the
// pick and never refreshed: a dragged plate lost its region at the redraw, and
// a redrawn plate at the next drag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, extrudeSketch, type DesignDocument } from "@fission/design";
import { regionRef, sketchRegions, type RegionRef } from "../../../workspaces/design/src/regions.ts";
import { app, kernel } from "./design-app.ts";
import { deleteAt, dragPoint, drawLines, editSketch, empty, fileOf, isSettled, seen, type App } from "./kept-app.ts";

/** Sketch 1 on XY: the plate (0,0) (40,0) (40,30) (0,30) as four lines with no constraints; Extrude 1 of its region by 20: 40 · 30 · 20 = 24000 mm³. */
async function plate(): Promise<{ doc: DesignDocument; sketch: string; extrude: string }> {
  const s = addSketch(empty());
  const doc = drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc;
  const regions = await sketchRegions(kernel, doc.sketches[0]);
  assert.equal(regions.regions.length, 1);
  const made = extrudeSketch(doc, s.id, 20, false, regionRef(regions.regions[0], regions.ids));
  return { doc: made.doc, sketch: s.id, extrude: made.id };
}

const saved = (a: App, extrude: string) => a.doc().timeline.features.find((f) => f.id === extrude)!.intent.parameters.region as RegionRef;
const near = (got: readonly number[], want: readonly number[]) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) < 1e-9);
/** What the test reads: the volume, the warning, whether a shape is kept, whether the file is settled. */
const state = async (a: App) => ({ volume: seen(a).volume, warning: seen(a).warning, kept: a.doc().kept !== undefined, settled: await isSettled(a.doc()) });
const file = (a: App) => fileOf(a.doc());

test("control: the plate's right side deleted and drawn again between the same corners is the same region: 24000 mm³, no warning", async () => {
  const { doc, sketch, extrude } = await plate();
  const a = await app(doc, designWorkspace);
  assert.ok(near(saved(a, extrude).centroid, [20, 15])); // the middle of 40 × 30
  await editSketch(a, sketch);
  await deleteAt(a, 40, 15);
  await drawLines(a, [[40, 0], [40, 30]]);
  await a.finish();
  assert.deepEqual(await state(a), { volume: 24000, warning: null, kept: false, settled: true });
  assert.ok(await a.close());
});

test("A3: a corner dragged, then the moved side deleted and drawn again between the same corners: the same region, 30000 mm³, no warning", async () => {
  const { doc, sketch, extrude } = await plate();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await dragPoint(a, [40, 0], [60, 0]);
  await a.finish();
  // (0,0) (60,0) (40,30) (0,30). Shoelace: (60·30 − 40·0) + (40·30 − 0·30) = 1800 + 1200 = 3000, half 1500 mm²; × 20 = 30000 mm³.
  assert.deepEqual(await state(a), { volume: 30000, warning: null, kept: false, settled: true });
  // Its centroid: Cx = Σ(x_i + x_i+1)·cross / 6A = (100·1800 + 40·1200) / 9000 = 76/3, Cy = (30·1800 + 60·1200) / 9000 = 14.
  // The region saved says so now, not the (20, 15) of the plate as picked.
  const refreshed = near(saved(a, extrude).centroid, [76 / 3, 14]);
  await editSketch(a, sketch);
  await deleteAt(a, 50, 15); // the slanted side from (60,0) to (40,30), at its middle
  await drawLines(a, [[60, 0], [40, 30]]);
  await a.finish();
  assert.deepEqual({ ...(await state(a)), refreshed }, { volume: 30000, warning: null, kept: false, settled: true, refreshed: true }, JSON.stringify(seen(a)));
  assert.ok(await a.close());
});

test("a side drawn again, then a corner dragged: the region found by its shape is named by its curves as they are, so the extrude follows its sketch: 30000 mm³", async () => {
  const { doc, sketch, extrude } = await plate();
  const a = await app(doc, designWorkspace);
  const files = [file(a)];
  await editSketch(a, sketch);
  const old = saved(a, extrude).outer.map((p) => p.curve);
  await deleteAt(a, 40, 15);
  files.push(file(a));
  await drawLines(a, [[40, 0], [40, 30]]);
  files.push(file(a));
  // Three of the four sides are the old lines, the fourth the new one: the name saved is the loop as it is now.
  const now = saved(a, extrude).outer.map((p) => p.curve);
  const curves = a.doc().sketches[0].curves.map((c) => c.id);
  const named = { named: [...now].sort(), old: now.filter((c) => old.includes(c)).length };
  await dragPoint(a, [40, 0], [60, 0]);
  files.push(file(a));
  await a.finish();
  // The same four-sided shape as in the test above: 1500 mm² × 20.
  assert.deepEqual({ ...(await state(a)), ...named }, { volume: 30000, warning: null, kept: false, settled: true, named: [...curves].sort(), old: 3 }, JSON.stringify(seen(a)));
  assert.ok(near(saved(a, extrude).centroid, [76 / 3, 14]));
  // Undo and redo are the files recorded, byte for byte: the delete, the line and the drag are one step each.
  assert.equal(file(a), files[3]);
  for (const k of [2, 1, 0]) {
    await a.undo();
    assert.equal(file(a), files[k], `undone to step ${k}`);
  }
  for (const k of [1, 2, 3]) {
    await a.redo();
    assert.equal(file(a), files[k], `redone to step ${k}`);
  }
  assert.ok(await a.close());
});

test("by design, unchanged: a side drawn again somewhere else is another region, so the extrude keeps its last shape with the warning", async () => {
  const { doc, sketch, extrude } = await plate();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await deleteAt(a, 40, 15);
  await drawLines(a, [[40, 0], [60, 0], [60, 30], [40, 30]]); // the plate made 60 wide with three new lines
  await a.finish();
  const now = await state(a);
  assert.deepEqual({ ...now, warning: now.warning !== null }, { volume: 24000, warning: true, kept: true, settled: true });
  // Nothing found, nothing refreshed: the region saved is still the 40 × 30 plate's.
  assert.ok(near(saved(a, extrude).centroid, [20, 15]));
  assert.ok(await a.close());
});
