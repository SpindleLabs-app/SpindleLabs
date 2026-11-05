// 36d: a Join of two bodies that touch only along an edge or at a corner is
// refused by the kernel; Design fails its row with the kernel's words and
// points at the very place in the view (refusal-overlay.ts), and the
// pointer goes as soon as the bodies overlap, sit flush or move apart, even
// by a few micrometres. Edited as a person does: Move 1's boxes, then Undo.
// On the real kernel, in the app around Design (design-app.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertCombine, insertMove, insertPreset, NO_MOVE, partDocument, REFUSAL_OVERLAY, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

/** Two 10 mm cubes, Box 2 moved by Move 1 to (x, y, z), then Combine 1 joining Box 2 to Box 1. */
function cubes(x: number, y: number, z: number): { doc: DesignDocument; move: string; combine: string } {
  let doc = partDocument("box", 10, 10, 10);
  const a = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const m = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z });
  const c = insertCombine(m.doc, a, [`body:${id}`], "join");
  return { doc: c.doc, move: m.id, combine: c.id };
}

test("hand-worked: a Join of cubes meeting at an edge points at the edge; flush, nearly touching and apart point at nothing; a corner is a dot", async () => {
  // Box 1 spans 0..10 on every axis. Box 2 moved (11, 0, 10): x 11..21, 1 mm clear of Box 1, so the Join keeps both
  // pieces, 1000 + 1000 = 2000 mm³.
  const { doc, move, combine } = cubes(11, 0, 10);
  const a = await app(doc, designWorkspace);
  const failed = () => a.$(`.timeline-bar-item[data-item="${combine}"]`)!.dataset.failed === "true";
  const places = () => a.overlay(REFUSAL_OVERLAY)?.places ?? null;
  assert.ok(close(a.volume(), 2000), `apart: ${a.volume()}`);
  assert.equal(failed(), false);
  assert.equal(a.overlay(REFUSAL_OVERLAY), null, "nothing refused, nothing pointed at");
  /** Move 1's boxes set as typed, then OK. */
  async function moveTo(x: number, y: number, z: number) {
    await a.doubleClick(move);
    for (const [axis, v] of [["x", x], ["y", y], ["z", z]] as const) {
      const box = a.$(`#move-${axis}`) as HTMLInputElement;
      box.value = String(v);
      box.dispatchEvent(new a.window.Event("input") as unknown as Event);
    }
    (a.$("#move-ok") as HTMLButtonElement).click();
    await a.settle();
  }
  // (10, 0, 10): Box 2 spans x 10..20, z 10..20. Both hold only where x = 10 and z = 10, for y 0..10 (both span it):
  // the edge from (10, 0, 10) to (10, 10, 10). The Join is refused, Box 1 and Box 2 stay as they are (2000 mm³).
  await moveTo(10, 0, 10);
  assert.equal(failed(), true, "Combine 1 fails on its row");
  assert.ok(close(a.volume(), 2000), `refused: ${a.volume()}`);
  assert.deepEqual(places(), [{ severity: "error", from: [10, 0, 10], to: [10, 10, 10] }]);
  assert.equal(a.overlay(REFUSAL_OVERLAY)!.label, "Where Combine 1 can't be made");
  // (10, 0, 0): flush, sharing the whole face x = 10: one 20 × 10 × 10 block, 2000 mm³, nothing to point at.
  await moveTo(10, 0, 0);
  assert.equal(failed(), false);
  assert.ok(close(a.volume(), 2000), `flush: ${a.volume()}`);
  assert.equal(a.overlay(REFUSAL_OVERLAY), null, "flush: the pointer went");
  // (10.002, 0, 10): 2 µm clear of the edge, twice the kernel's 1 µm smallest gap: two pieces, nothing refused.
  await moveTo(10.002, 0, 10);
  assert.equal(failed(), false);
  assert.ok(close(a.volume(), 2000), `nearly touching: ${a.volume()}`);
  assert.equal(a.overlay(REFUSAL_OVERLAY), null, "nearly touching: nothing pointed at");
  // (10, 10, 10): Box 2 spans 10..20 on every axis; the only point both hold is (10, 10, 10), drawn as a dot.
  await moveTo(10, 10, 10);
  assert.equal(failed(), true);
  assert.deepEqual(places(), [{ severity: "error", point: [10, 10, 10] }]);
  // Undo puts the nearly touching design back, and the dot goes with the refusal.
  await a.undo();
  assert.equal(failed(), false);
  assert.equal(a.overlay(REFUSAL_OVERLAY), null, "undone: the dot went");
  // Redo brings it back.
  await a.redo();
  assert.deepEqual(places(), [{ severity: "error", point: [10, 10, 10] }]);
  // Closing Design takes its pointer off the shared view.
  assert.ok(await a.close());
  assert.equal(a.overlay(REFUSAL_OVERLAY), null, "closed: nothing left on the view");
});
