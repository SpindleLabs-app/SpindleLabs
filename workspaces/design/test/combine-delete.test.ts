// Combine bug hunt 2026-11-06: deleting items around a Combine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem } from "../src/timeline-edits.ts";
import { planDelete } from "../src/delete-ask.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[] } {
  let doc: DesignDocument | null = null;
  const bodies: string[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (doc === null) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x !== 0 || y !== 0 || z !== 0) doc = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z }).doc;
  }
  return { doc: doc!, bodies };
}

/** Bar x 0..100 cut by a slot at x 30..40: piece 1 is the far end x 40..100; then a post cut from that piece by Combine 2. */
function slotThenPiece() {
  const { doc: three, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]], [[5, 5, 30], [80, 5, -10]]);
  const first = insertCombine(three, bodies[0], [bodies[1]], "cut");
  const doc1 = numberPieces(first.doc, [`body:${first.id}/piece:1`]);
  const piece = `body:${first.id}/piece:1`;
  const second = insertCombine(doc1, piece, [bodies[2]], "cut");
  return { doc: second.doc, first: first.id, second: second.id, piece, bodies };
}

test("deleting Combine 1 whose piece Combine 2 uses: the confirmed document saves and opens again", async () => {
  const { doc, first, second } = slotThenPiece();
  const plan = await planDelete(kernel, doc, first);
  // Combine 2 is built from Combine 1, so the box asks first.
  assert.ok(plan.ask !== null);
  // What is left must be a document the app can save and open (Combine 2 then fails, naming Combine 1 as deleted).
  const saved = JSON.parse(JSON.stringify(plan.next));
  let reopened: DesignDocument | undefined;
  assert.doesNotThrow(() => { reopened = readDesignDocument(saved); });
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(reopened!, cache, kernel);
  assert.equal(build.results[second].status, "failed");
  await cache.close();
});

test("deleting a Combine whose piece's eye is shut: the confirmed document saves and opens again", async () => {
  // Bar cut by the slot (as above, without Combine 2): piece 1 is the far end, numbered Body 4 (bar 1, slot 2, post 3).
  const { doc: three, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const first = insertCombine(three, bodies[0], [bodies[1]], "cut");
  const piece = `body:${first.id}/piece:1`;
  const numbered = numberPieces(first.doc, [piece]);
  const { hideBody } = await import("../src/timeline-edits.ts");
  const hidden = hideBody(numbered, piece, true);
  assert.deepEqual(hidden.hidden, [piece]);
  // Before the delete the file opens.
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(hidden))));
  // No item is built from Combine 1, so the delete goes at once; the piece goes with it, so must its eye.
  const next = deleteItem(hidden, first.id);
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(next))));
});

test("deleting Combine 1 whose piece a Move moves: the confirmed document saves and opens again", async () => {
  const { doc: three, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const first = insertCombine(three, bodies[0], [bodies[1]], "cut");
  const piece = `body:${first.id}/piece:1`;
  const moved = insertMove(numberPieces(first.doc, [piece]), [piece], { ...NO_MOVE, x: 5 });
  const plan = await planDelete(kernel, moved.doc, first.id);
  assert.ok(plan.ask !== null);
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(plan.next))));
});

test("deleting Combine 1: the used-up slot comes back with its old number, the piece's number is never given again", async () => {
  // Bar Body 1, slot Body 2, the piece Body 3. Delete Combine 1: bar 1 and slot 2 stay, 3 goes; a new box is Body 4.
  const { doc: three, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const first = insertCombine(three, bodies[0], [bodies[1]], "cut");
  const piece = `body:${first.id}/piece:1`;
  const doc = numberPieces(first.doc, [piece]);
  assert.deepEqual(doc.bodies, [{ id: bodies[0], number: 1 }, { id: bodies[1], number: 2 }, { id: piece, number: 3 }]);
  const gone = deleteItem(doc, first.id);
  assert.deepEqual(gone.bodies, [{ id: bodies[0], number: 1 }, { id: bodies[1], number: 2 }]);
  const added = (await import("../src/document.ts")).numberBodies(insertPreset(gone, "box", 5, 5, 5).doc);
  assert.equal(added.bodies!.at(-1)!.number, 4);
});
