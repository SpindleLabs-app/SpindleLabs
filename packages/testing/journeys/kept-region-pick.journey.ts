// Timeline hunt 2026-11-11 (A1): Edit feature picking a new region for an
// extrude that keeps its last shape must forget the kept shape (the owner's
// rule, rebuild.ts settleKept: an extrude whose sketch makes its outline
// forgets it), as every recorded edit leaves the design settled. It stayed in
// the file (the app skipped settling an edit made outside a sketch when no
// sketch lay on a body), so the next time the sketch lost the outline the
// extrude failed, or went back to the shape of two edits ago.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, designWorkspace, type DesignDocument } from "@fission/design";
import { regionRef, sketchRegions } from "../../../workspaces/design/src/regions.ts";
import { app, kernel } from "./design-app.ts";
import { deleteAt, dragPoint, drawLines, editSketch, empty, isSettled, pickRegion, seen } from "./kept-app.ts";

/** Sketch 1 on XY holding each rectangle of `rects` (corner to corner), and Extrude 1 of the first one's region by `distance`. */
async function design(rects: readonly [[number, number], [number, number]][], distance: number): Promise<{ doc: DesignDocument; sketch: string; extrude: string }> {
  const s = addSketch(empty());
  let doc = s.doc;
  for (const [a, b] of rects) doc = drawRectangle(doc, s.id, a, b).doc;
  const regions = await sketchRegions(kernel, doc.sketches[0]);
  const [[x0, y0], [x1, y1]] = rects[0];
  const first = regions.regions.find((r) => Math.hypot(r.centroid[0] - (x0 + x1) / 2, r.centroid[1] - (y0 + y1) / 2) < 1e-9)!;
  const made = extrudeSketch(doc, s.id, distance, false, regionRef(first, regions.ids));
  return { doc: made.doc, sketch: s.id, extrude: made.id };
}

/** Rectangle A (0,0)-(10,10) and rectangle B (20,0)-(40,10); Extrude 1 is A by 5 mm: 10 · 10 · 5 = 500 mm³. */
const twoRectangles = () => design([[[0, 0], [10, 10]], [[20, 0], [40, 10]]], 5);

test("A1: a region picked in Edit feature forgets the kept shape: the file is settled, and B's loss keeps B", async () => {
  const { doc, sketch, extrude } = await twoRectangles();
  const a = await app(doc, designWorkspace);
  assert.equal(seen(a).volume, 500); // A: 10 · 10 · 5
  // A's bottom side deleted: Extrude 1 keeps its last shape (by design), 500 mm³ with the warning.
  await editSketch(a, sketch);
  await deleteAt(a, 5, 0);
  await a.finish();
  assert.deepEqual({ volume: seen(a).volume, warned: seen(a).warning !== null, kept: a.doc().kept?.[extrude] !== undefined }, { volume: 500, warned: true, kept: true });
  // Edit feature: B, the only region left, picked. B is 20 · 10, by 5 mm: 1000 mm³, built from the sketch, so no warning
  // and nothing kept: the sketch makes the extrude's region again.
  await pickRegion(a, extrude);
  const picked = { ...seen(a), kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()), undo: a.history.undoLabel() };
  assert.deepEqual(picked, { volume: 1000, failed: [], warning: null, error: "", kept: false, settled: true, undo: "Edit Extrude 1" }, JSON.stringify(picked));
  // One undo step: Undo is back at the kept A (500, the kept shape in the file again), Redo at B with nothing kept.
  await a.undo();
  assert.deepEqual({ volume: seen(a).volume, kept: a.doc().kept?.[extrude] !== undefined }, { volume: 500, kept: true });
  await a.redo();
  assert.deepEqual({ volume: seen(a).volume, kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()) }, { volume: 1000, kept: false, settled: true });
  // B's right side deleted: the last shape was B, 1000 mm³, kept with the warning.
  await editSketch(a, sketch);
  await deleteAt(a, 40, 5);
  await a.finish();
  const lost = seen(a);
  assert.deepEqual({ volume: lost.volume, failed: lost.failed, warned: lost.warning !== null }, { volume: 1000, failed: [], warned: true }, JSON.stringify(lost));
  // The kept shape is the sketch as it was when B was lost: A's three sides and B's four, not the eight curves of before A's loss.
  assert.equal(a.doc().kept?.[extrude]?.curves.length, 7);
  assert.ok(await a.close());
});

test("A1c: A loses a side and C is drawn in one Edit Sketch, Edit feature picks C, C loses a side: Extrude 1 keeps C, 1500 mm³", async () => {
  const { doc, sketch, extrude } = await twoRectangles();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await deleteAt(a, 5, 0); // A's bottom side: the kept shape is the sketch before it, which has no C
  await a.key("sketch-rectangle");
  await a.click(50, 0);
  await a.click(60, 30); // C: 10 · 30 = 300 mm², its middle (55, 15)
  await a.key("clear-selection");
  await a.finish();
  assert.equal(seen(a).volume, 500); // still the kept A
  await pickRegion(a, extrude, [55, 15]);
  assert.deepEqual({ volume: seen(a).volume, warning: seen(a).warning }, { volume: 1500, warning: null }); // 300 · 5
  const settled = await isSettled(a.doc());
  await editSketch(a, sketch);
  await deleteAt(a, 55, 0); // C's bottom side
  await a.finish();
  const lost = seen(a);
  // The last shape was C: 10 · 30 · 5 = 1500 mm³ (it failed with no body: C is not in the shape kept from before A's loss).
  assert.deepEqual({ volume: lost.volume, failed: lost.failed, warned: lost.warning !== null, settled }, { volume: 1500, failed: [], warned: true, settled: true }, JSON.stringify(lost));
  assert.ok(await a.close());
});

test("A1d: A loses a side and B is dragged to 30 wide in one Edit Sketch, Edit feature picks B, B loses a side: Extrude 1 keeps the 30 wide B, 1500 mm³", async () => {
  const { doc, sketch, extrude } = await twoRectangles();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await deleteAt(a, 5, 0);
  await dragPoint(a, [40, 0], [50, 0]);
  // The rectangle's own constraints may have taken the corner above along; if not, it is dragged too.
  if (a.doc().sketches[0].points.some((p) => p.x === 40 && p.y === 10)) await dragPoint(a, [40, 10], [50, 10]);
  assert.deepEqual(a.doc().sketches[0].points.filter((p) => p.x >= 20).map((p) => [p.x, p.y]).sort((p, q) => p[0] - q[0] || p[1] - q[1]), [[20, 0], [20, 10], [50, 0], [50, 10]]);
  await a.finish();
  assert.equal(seen(a).volume, 500);
  await pickRegion(a, extrude, [35, 5]); // B is (20,0)-(50,10): 30 · 10 · 5 = 1500 mm³
  assert.deepEqual({ volume: seen(a).volume, warning: seen(a).warning }, { volume: 1500, warning: null });
  const settled = await isSettled(a.doc());
  await editSketch(a, sketch);
  await deleteAt(a, 35, 0); // B's bottom side
  await a.finish();
  const lost = seen(a);
  // The last shape was the 30 wide B: 1500 mm³ (it went back to 20 · 10 · 5 = 1000, B as the stale kept shape had it).
  assert.deepEqual({ volume: lost.volume, failed: lost.failed, warned: lost.warning !== null, settled }, { volume: 1500, failed: [], warned: true, settled: true }, JSON.stringify(lost));
  assert.ok(await a.close());
});

test("A1e: a plate widened by redrawing a side, its new region picked in Edit feature, then its top side deleted: Extrude 1 keeps 60 · 30 · 20 = 36000 mm³", async () => {
  const { doc, sketch, extrude } = await design([[[0, 0], [40, 30]]], 20);
  const a = await app(doc, designWorkspace);
  assert.equal(seen(a).volume, 24000); // 40 · 30 · 20
  await editSketch(a, sketch);
  await deleteAt(a, 40, 15);
  await drawLines(a, [[40, 0], [60, 0], [60, 30], [40, 30]]);
  await a.finish();
  // By design (regions.ts REDRAWN_CENTROID): another shape is another region, so the old plate is kept with the warning.
  assert.deepEqual({ volume: seen(a).volume, warned: seen(a).warning !== null }, { volume: 24000, warned: true });
  await pickRegion(a, extrude);
  assert.deepEqual({ volume: seen(a).volume, warning: seen(a).warning }, { volume: 36000, warning: null }); // 60 · 30 · 20
  const picked = { kept: a.doc().kept !== undefined, settled: await isSettled(a.doc()) };
  await editSketch(a, sketch);
  await deleteAt(a, 20, 30); // the top side between (0,30) and (40,30)
  await a.finish();
  const lost = seen(a);
  // The last shape was the 60 wide plate (it failed with no body: "the kept shape makes no outline").
  assert.deepEqual({ volume: lost.volume, failed: lost.failed, warned: lost.warning !== null, picked }, { volume: 36000, failed: [], warned: true, picked: { kept: false, settled: true } }, JSON.stringify(lost));
  assert.ok(await a.close());
});

test("control: an edit outside a sketch that asks no extrude a new question (a typed distance) asks the kernel nothing more than its rebuild", async () => {
  const { doc, extrude } = await twoRectangles();
  const a = await app(doc, designWorkspace);
  assert.equal(await a.menu(extrude, "edit"), null);
  a.failCall(0); // counts the kernel's calls from here
  (a.$("#edit-height") as HTMLInputElement).value = "8";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.equal(seen(a).volume, 800); // A: 10 · 10 · 8
  // By hand: the size check asks the sketch's regions and makes the extrude (2 calls); the rebuild asks the regions,
  // builds the new body, frees the old one and asks for its view (4). 6 calls, as on main before the fix (9986ded):
  // settling this edit would ask the regions once more.
  assert.equal(a.calls().made, 6);
  assert.ok(await a.close());
});
