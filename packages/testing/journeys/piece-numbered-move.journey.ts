// App-wide hunt 2026-11-14, T-2: OK numbers a boolean's new piece from its own check build (#691, SL #622 item 7) WITHOUT
// giving it to the Move that holds the body it was split from, so the rebuild after OK finds the piece already
// numbered and the Move no longer takes it (SL #583 item 2's rule): one end of the bar drops back to the ground,
// silently. Before #691 the OK recorded the un-numbered design and the rebuild's Move took the piece (control below).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, editFeature, extrudeSketch, insertCombine, insertMove, insertPreset, movedBodies, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";
import { built, editFeatureUI, failedItems, liveAgainstFile, meshBounds, setBox, show, unionBounds, type App } from "./piece-numbered-lib.ts";

setCombineShown(true);
const LIFTED = JSON.stringify([[0, 0, 50], [100, 40, 60]]);

/** Bar 100 × 40 × 10; Sketch 1 on XY x 45..55, y −10..50 (right across the bar); Extrude 1 cuts the bar by `d` (z 0..d); Move 2 lifts the bar 50. */
function extrudeCut(d: number, symmetric = false) {
  let doc = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [45, -10], [55, 50]).doc;
  const ex = extrudeSketch(doc, s.id, d, false, undefined, { operation: "cut", bodies: [`body:${bar}`] });
  doc = symmetric ? editFeature(ex.doc, ex.id, {}, undefined, undefined, true) : ex.doc;
  const m = insertMove(doc, [`body:${bar}`], { ...NO_MOVE, z: 50 });
  return { doc: m.doc, bar, sketch: s.id, extrude: ex.id, move: m.id };
}

for (const symmetric of [false, true]) {
  test(`A${symmetric ? "2 (symmetric)" : "1"}: Edit feature makes an Extrude Cut go right through the bar a later Move lifts: both ends stay lifted`, async () => {
    // One way 4: z 0..4, a notch 10 × 40 × 4 = 1,600, 38,400 left. Symmetric 10: z −5..5, 10 × 40 × 5 = 2,000, 38,000 left. One body at z 50..60.
    const d = extrudeCut(symmetric ? 10 : 4, symmetric);
    const a = await app(d.doc, designWorkspace);
    assert.ok(close(a.volume(), symmetric ? 38000 : 38400), `at first ${a.volume()}`);
    assert.equal(JSON.stringify(meshBounds(a.mesh())), LIFTED);
    // Distance 30: right through (z 0..30, or z −15..15): two ends 45 × 40 × 10 = 18,000 each, 36,000. The person
    // lifted the whole bar, so both ends are at z 50..60 (SL #583 item 2), and Move 2 holds the new piece.
    await editFeatureUI(a, d.extrude, { height: "30" });
    const bad = await liveAgainstFile(a, "after the edit");
    const got = JSON.stringify(meshBounds(a.mesh()));
    const vol = a.volume();
    const held = movedBodies(a.doc().timeline.features.find((f) => f.id === d.move)!);
    // Control: the very same edit as the document function makes it (what OK recorded before #691), rebuilt as the app rebuilds.
    const control = await built(editFeature(d.doc, d.extrude, { height: 30 } as never));
    assert.equal(JSON.stringify(unionBounds(control)), LIFTED, "control: both ends lifted");
    assert.ok(await a.close());
    assert.deepEqual(bad, []);
    assert.ok(close(vol, 36000), `volume ${vol}`);
    assert.equal(got, LIFTED, "both ends of the bar are lifted");
    assert.deepEqual(held, [`body:${d.bar}`, `body:${d.extrude}/piece:1`], "Move 2 holds the new piece");
  });
}

test("B: a Combine edited from Join to Cut splits the bar a later Move lifts: both ends stay lifted", async () => {
  // Bar 100 × 40 × 10; Box 2 10 × 60 × 30 moved (45, −10, −10): x 45..55, y −10..50, z −10..20, right across the bar.
  // Combine 1 joins them: 40,000 + 18,000 − 10 × 40 × 10 = 54,000, one body; Move 2 lifts it 50 (z 40..70).
  let doc = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 10, 60, 30);
  doc = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 45, y: -10, z: -10 }).doc;
  const c = insertCombine(doc, `body:${bar}`, [`body:${b2.id}`], "join");
  const m = insertMove(c.doc, [`body:${bar}`], { ...NO_MOVE, z: 50 });
  const a = await app(m.doc, designWorkspace);
  assert.ok(close(a.volume(), 54000), `joined ${a.volume()}`);
  assert.equal(JSON.stringify(meshBounds(a.mesh())), JSON.stringify([[0, -10, 40], [100, 50, 70]]));
  // Cut: the bar less the slot: two ends 45 × 40 × 10 = 18,000 each, 36,000, both at z 50..60.
  await a.doubleClick(c.id);
  const op = a.$("#combine-operation") as unknown as HTMLSelectElement;
  op.value = "cut";
  op.dispatchEvent(new a.window.Event("change") as never);
  await a.settle();
  a.$("#combine-ok")!.click();
  await a.settle();
  const bad = await liveAgainstFile(a, "after the edit");
  const got = JSON.stringify(meshBounds(a.mesh()));
  const vol = a.volume();
  assert.ok(await a.close());
  assert.deepEqual(bad, []);
  assert.ok(close(vol, 36000), `volume ${vol}`);
  assert.equal(got, LIFTED, "both ends of the bar are lifted");
});

test("C: a new Extrude Cut through the bar, made with the marker rolled back to before the Move that lifts the bar", async () => {
  // Bar 100 × 40 × 10; Sketch 1 on XY x 45..55, y −10..50; Move 2 lifts the bar 50. The marker put after Sketch 1,
  // Extrude ▸ Cut 30 through the bar made there (two ends 18,000 each), then the marker put back at the end:
  // the person lifted the whole bar, so both ends at z 50..60 (SL #624 item 2: a Move that is off takes the pieces).
  let doc: DesignDocument = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [45, -10], [55, 50]).doc;
  const m = insertMove(doc, [`body:${bar}`], { ...NO_MOVE, z: 50 });
  const a = await app(m.doc, designWorkspace);
  assert.equal(await a.menu(s.id, "marker"), null);
  a.$("#extrude")!.click();
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: s.id });
  const op = a.$("#extrude-operation") as unknown as HTMLSelectElement;
  op.value = "cut";
  op.dispatchEvent(new a.window.Event("change", { bubbles: true }) as never);
  await a.settle();
  await setBox(a, "#extrude-distance", "30");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const ex = a.doc().timeline.features.find((f) => f.intent.type === "extrude")!;
  assert.ok(ex, "the extrude was made");
  // the marker back to the end
  assert.equal(await a.menu(m.id, "marker"), null);
  const bad = await liveAgainstFile(a, "marker at the end");
  const got = JSON.stringify(meshBounds(a.mesh()));
  const vol = a.volume();
  assert.ok(await a.close());
  assert.deepEqual(bad, []);
  assert.ok(close(vol, 36000), `volume ${vol}`);
  assert.equal(got, LIFTED, "both ends of the bar are lifted");
});
