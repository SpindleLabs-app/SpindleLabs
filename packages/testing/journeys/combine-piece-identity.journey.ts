// Hunt 11-06: a Combine's numbered pieces keep their ids by their faces. A
// bar cut by two slots; Combine 2 joins Box 3 to Combine 1's far piece.
// Moving slot B makes the middle piece the bigger one: Combine 2 stays on
// the far piece, with no warning. Moving slot B so it only notches the bar
// leaves no piece with the far piece's faces: the number goes by rank order
// and Combine 1 warns on its row and in the panel; Undo takes it away. On
// the real kernel, in the app around Design (design-app.ts), the Move
// edited as a person does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BodyCache, designWorkspace, insertCombine, insertMove, insertPreset, NO_MOVE, numberPieces, partDocument, rebuildTimeline, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";
import { app, close } from "./design-app.ts";

const kernel = nodeKernel();

/**
 * Bar 100 × 20 × 10; slots A and B 10 × 40 × 20 at x 20 and 50 (Move 2 places B); Combine 1 cuts, built once so its
 * pieces are numbered (as a version 11 SpindleLabs did: no faces, which the app's first build gives them); Box 3 at
 * (95, 5, 5) joined to piece 1 by Combine 2.
 */
async function bar(): Promise<{ doc: DesignDocument; moveId: string; c1: string }> {
  let doc = partDocument("box", 100, 20, 10);
  const bar = `body:${doc.timeline.features[0].id}`;
  let a: string, b: string, box3: string;
  ({ doc, id: a } = insertPreset(doc, "box", 10, 40, 20));
  doc = insertMove(doc, [`body:${a}`], { ...NO_MOVE, x: 20, y: -10, z: -5 }).doc;
  ({ doc, id: b } = insertPreset(doc, "box", 10, 40, 20));
  const moveB = insertMove(doc, [`body:${b}`], { ...NO_MOVE, x: 50, y: -10, z: -5 });
  const c1 = insertCombine(moveB.doc, bar, [`body:${a}`, `body:${b}`], "cut");
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(c1.doc, cache, kernel);
  await cache.close();
  ({ doc, id: box3 } = insertPreset(numberPieces(c1.doc, Object.keys(build.bodies)), "box", 10, 10, 10));
  doc = insertMove(doc, [`body:${box3}`], { ...NO_MOVE, x: 95, y: 5, z: 5 }).doc;
  return { doc: insertCombine(doc, `body:${c1.id}/piece:1`, [`body:${box3}`], "join").doc, moveId: moveB.id, c1: c1.id };
}

test("hand-worked: Combine 2 stays on the far piece when a slot moves; a piece no longer there is warned about on Combine 1's row, and Undo takes the warning away", async () => {
  const { doc, moveId, c1 } = await bar();
  const a = await app(doc, designWorkspace);
  const row = () => [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((r) => r.dataset.node === c1)!;
  // Near x 0..20 (4,000), middle x 30..50 (4,000), far x 60..100 (8,000) joined with Box 3 (+ 1,000 − 250 overlap):
  // 4,000 + 4,000 + 8,750 = 16,750.
  assert.ok(close(a.volume(), 16750), `at first: ${a.volume()}`);
  assert.equal(a.warning(), null);
  assert.ok(a.doc().bodies!.some((b) => b.id === `body:${c1}/piece:1` && b.faces !== undefined), "piece 1's faces remembered");
  async function moveB(x: number, y: number) {
    await a.doubleClick(moveId);
    for (const [axis, v] of [["x", x], ["y", y], ["z", -5]] as const) {
      const box = a.$(`#move-${axis}`) as HTMLInputElement;
      box.value = String(v);
      box.dispatchEvent(new a.window.Event("input") as unknown as Event);
    }
    (a.$("#move-ok") as HTMLButtonElement).click();
    await a.settle();
  }
  // Slot B to x 80..90: middle x 30..80 (10,000), far x 90..100 (2,000) still joined with Box 3 (2,750): 4,000 +
  // 10,000 + 2,750 = 16,750 again. Had Combine 2 followed the rank order onto the middle piece, Box 3 would stand
  // apart from it: 4,000 + 10,000 + 1,000 + 2,000 = 17,000.
  await moveB(80, -10);
  assert.ok(close(a.volume(), 16750), `slot B at 80: ${a.volume()}`);
  assert.equal(a.warning(), null);
  assert.equal(row().classList.contains("kept"), false);
  // Slot B to x 50..60, y 5..45: it only notches the bar, which is in two pieces; no piece has the far piece's faces.
  const words = "Combine 1's pieces changed since they were numbered, so Body 4 may now be another piece: check the items that use it, then edit Combine 1 to keep its pieces as they are now.";
  await moveB(50, 5);
  // Near 4,000; the rest x 30..100 less the notch x 50..60, y 5..20: 14,000 − 1,500 = 12,500, which piece 1 is now, so
  // Combine 2 joins Box 3 to it: 12,500 + 1,000 − 250 = 13,250; 4,000 + 13,250 = 17,250.
  assert.ok(close(a.volume(), 17250), `slot B notching: ${a.volume()}`);
  assert.equal(a.warning(), words);
  assert.equal(row().title, words);
  assert.equal(row().classList.contains("kept"), true);
  // Undo puts slot B at 80 back: the far piece is there again, and the warning goes.
  await a.undo();
  assert.equal(a.warning(), null);
  assert.equal(row().classList.contains("kept"), false);
  assert.ok(close(a.volume(), 16750), `undone: ${a.volume()}`);
  assert.ok(await a.close());
});
