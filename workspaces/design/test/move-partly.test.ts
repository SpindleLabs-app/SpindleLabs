// SL #506 item 4: a Move of several bodies, one of which is no longer there,
// moves the rest and says which it can't move, so an unrelated body never
// jumps back. With none left it fails as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteWords } from "../src/delete-ask.ts";
import { deleteItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const rounded = (p: readonly number[]) => p.map((x) => Math.round(x * 1e6) / 1e6);

async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const bounds = async (body: string) => (await cache.view(build.bodies[body].handle)).bounds.map(rounded);
  return { build, cache, bounds };
}

/**
 * #506's case: Box 1, a bar 100 × 20 × 10 (x 0..100, y 0..20, z 0..10); Box 2, a slot 10 × 40 × 20 moved to (30, −10, −5),
 * so x 30..40, y −10..30, z −5..15, through the bar; Combine 1 cuts it: the near end x 0..30 keeps the bar's id, the far end
 * x 40..100 is piece 1. Box 3, a 10 mm cube at the origin. Move 2 lifts the far piece and Box 3 together by z 30.
 */
async function liftedTogether() {
  let doc = partDocument("box", 100, 20, 10);
  const bar = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 40, 20));
  const slot = id;
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const cut = insertCombine(doc, bar, [`body:${slot}`], "cut");
  const piece = `body:${cut.id}/piece:1`;
  doc = numberPieces(cut.doc, [piece]);
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const cube = `body:${id}`;
  const lift = insertMove(doc, [piece, cube], { ...NO_MOVE, z: 30 });
  return { doc: lift.doc, slot, piece, cube, move: lift.id, cut: cut.id };
}

test("#506 item 4, by hand: the slot made a notch, so the far piece is gone; Box 3 still rises to z 30..40 and Move 2 says why", async () => {
  const { doc, slot, piece, cube, move } = await liftedTogether();
  const first = await built(doc);
  // Both lifted by 30: the far piece x 40..100, y 0..20, z 30..40; the cube x 0..10, y 0..10, z 30..40.
  assert.deepEqual(await first.bounds(piece), [[40, 0, 30], [100, 20, 40]]);
  assert.deepEqual(await first.bounds(cube), [[0, 0, 30], [10, 10, 40]]);
  assert.equal(first.build.results[move].status, "built");
  await first.cache.close();
  // The slot made 10 × 20 × 20: moved, y −10..10, so it notches the bar's front half and the bar stays in one piece.
  const notched = changePreset(doc, slot, "box", 10, 20, 20);
  const after = await built(notched);
  const r = after.build.results[move];
  assert.equal(r.status, "built", JSON.stringify(r));
  // Box 3 is still lifted (it dropped back to z 0..10 before): x 0..10, y 0..10, z 30..40.
  assert.deepEqual(await after.bounds(cube), [[0, 0, 30], [10, 10, 40]]);
  assert.ok(r.status === "built" && r.missing !== undefined);
  assert.deepEqual(r.missing, { message: "Move 2 moves only Box 3: an earlier Combine or extrude used up a piece of Combine 1 or left no such piece", bodies: [piece] });
  await after.cache.close();
});

test("#506 item 4: with every body it moves gone the Move still fails, naming the first", async () => {
  const { doc, slot, cube, move } = await liftedTogether();
  // Box 3 deleted, and the piece gone with the notch: nothing left to move.
  const both = changePreset(deleteItem(doc, cube.slice(5)), slot, "box", 10, 20, 20);
  const b = await built(both);
  const r = b.build.results[move];
  assert.equal(r.status, "failed");
  assert.ok(r.status === "failed" && r.message === "Move 2 can't move a piece: an earlier Combine or extrude used it up or left no such piece", r.status === "failed" ? r.message : "");
  await b.cache.close();
});

test("#506 item 4: deleting one of two boxes a Move lifts asks, saying the Move moves only the other; the other stays lifted", async () => {
  // Box 1 and Box 2, 10 mm cubes; Box 2 at x 20..30 (Move 1). Move 2 lifts both by z 5.
  let doc = partDocument("box", 10, 10, 10);
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  doc = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x: 20 }).doc;
  const lift = insertMove(doc, ["body:feature-1", `body:${id}`], { ...NO_MOVE, z: 5 });
  const ask = deleteWords(lift.doc, deleteItem(lift.doc, "feature-1"), "feature-1");
  assert.ok(ask !== null && ask.words.includes("Move 2 moves only Box 2 and shows a warning"), ask?.words);
  const b = await built(deleteItem(lift.doc, "feature-1"));
  // Box 2 lifted by 5 after its shift by 20: x 20..30, y 0..10, z 5..15.
  assert.deepEqual(await b.bounds(`body:${id}`), [[20, 0, 5], [30, 10, 15]]);
  const r = b.build.results[lift.id];
  assert.ok(r.status === "built" && r.missing?.message === "Move 2 moves only Box 2: Box 1 was deleted", JSON.stringify(r));
  await b.cache.close();
});
