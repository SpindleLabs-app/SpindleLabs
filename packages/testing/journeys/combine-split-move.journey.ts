// SL #583 item 2, in the app around Design (design-app.ts) on the real
// kernel: Box 2's depth edited as a person does (Edit feature) makes the Cut
// go right through the bar Move 2 lifts. Both pieces are lifted, Move 2
// holds the new piece from then on (taken into the edit's own undo step),
// and Undo puts the notch back. Unit cases: workspaces/design
// test/combine-split-move.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertCombine, insertMove, insertPreset, movedBodies, NO_MOVE, partDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

test("hand-worked: editing the slot so the Cut goes through the bar Move 2 lifts lifts both pieces, and Undo puts the notch back", async () => {
  // Bar 100 × 40 × 10; Box 2 10 × 30 × 30 moved (30, −10, −10): x 30..40, y −10..20, z −10..20, a notch of 10 × 20 × 10;
  // Combine 1 cuts it: 40,000 − 2,000 = 38,000. Move 2 lifts the bar 50.
  let doc = partDocument("box", 100, 40, 10);
  let slot: string;
  ({ doc, id: slot } = insertPreset(doc, "box", 10, 30, 30));
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -10 }).doc;
  const c = insertCombine(doc, "body:feature-1", [`body:${slot}`], "cut");
  const m = insertMove(c.doc, ["body:feature-1"], { ...NO_MOVE, z: 50 });
  const a = await app(m.doc, designWorkspace);
  const lowest = () => {
    const p = a.mesh()!.positions;
    let z = Infinity;
    for (let i = 2; i < p.length; i += 3) z = Math.min(z, p[i]);
    return z;
  };
  assert.ok(close(a.volume(), 38000), `at first: ${a.volume()}`);
  assert.equal(lowest(), 50);
  // Box 2 60 deep: y −10..50 crosses the bar, two pieces x 0..30 (12,000) and x 40..100 (24,000): 36,000, both z 50..60.
  assert.equal(await a.menu(slot, "edit"), null);
  (a.$("#edit-depth") as HTMLInputElement).value = "60";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.ok(close(a.volume(), 36000), `slot through: ${a.volume()}`);
  assert.equal(lowest(), 50, "no piece left on the ground");
  const move2 = () => a.doc().timeline.features.find((f) => f.id === m.id)!;
  assert.deepEqual(movedBodies(move2()), ["body:feature-1", `body:${c.id}/piece:1`]);
  assert.equal(a.warning(), null);
  // Undo: the notch again (38,000, lifted whole), and Move 2 holds the bar alone, as before the edit.
  await a.undo();
  assert.ok(close(a.volume(), 38000), `undone: ${a.volume()}`);
  assert.equal(lowest(), 50);
  assert.deepEqual(movedBodies(move2()), ["body:feature-1"]);
  assert.ok(await a.close(), "every body freed");
});
