// SL #506 items 1 to 3: an item that works on bodies (a Combine, a Move, a
// Duplicate, an operation extrude) depends on the Moves and Combines that
// placed or changed those bodies before it, read from the timeline
// (body-uses.ts), so reordering past one is refused, deleting one asks,
// and editing a Combine so it uses up a body a later item works on is
// refused, each in words naming the items.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodiesChanged, shapings } from "../src/body-uses.ts";
import { changedCombine, insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteWords, planDelete } from "../src/delete-ask.ts";
import { deleteItem, reorderItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/** #506's case: Box 1 and Box 2, 40 × 30 × 20 at the origin; Move 1 shifts Box 2 by (20, 15, 10); Combine 1 joins Box 2 to Box 1. */
function moveThenJoin(): { doc: DesignDocument; b1: string; b2: string; move: string; combine: string } {
  let doc = partDocument("box", 40, 30, 20);
  const b1 = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 40, 30, 20));
  const b2 = `body:${id}`;
  let move: string;
  ({ doc, id: move } = insertMove(doc, [b2], { ...NO_MOVE, x: 20, y: 15, z: 10 }));
  let combine: string;
  ({ doc, id: combine } = insertCombine(doc, b1, [b2], "join"));
  return { doc, b1, b2, move, combine };
}

const place = (doc: DesignDocument, id: string) => doc.timeline.features.findIndex((f) => f.id === id);

test("#506 item 1, by hand: the Join is 45000 mm³ after Move 1 and would be 24000 before it, so the drag is refused", async () => {
  const { doc, b1, move, combine } = moveThenJoin();
  // Box 1 is x 0..40, y 0..30, z 0..20; Box 2 after Move 1 is x 20..60, y 15..45, z 10..30. They overlap in
  // 20 × 15 × 10 = 3000 mm³, so the Join is 24000 + 24000 − 3000 = 45000 mm³. Before Move 1, Box 2 lies wholly on
  // Box 1 and the Join would be 24000 mm³: the drag would change the part with no warning, so it is refused.
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  near((await cache.view(build.bodies[b1].handle)).volume, 45000);
  await cache.close();
  // Timeline: Box 1, Box 2, Move 1, Combine 1. Combine 1 to place 2 puts it before Move 1.
  const before = reorderItem(doc, combine, place(doc, move));
  assert.equal(before.refused, "before-dependency");
  assert.equal(before.message, "Combine 1 can't go before Move 1: it uses Box 2 as Move 1 leaves it");
  // Move 1 to the end puts it after Combine 1.
  const after = reorderItem(doc, move, 3);
  assert.equal(after.refused, "after-dependent");
  assert.equal(after.message, "Move 1 can't go after Combine 1: Combine 1 uses Box 2 as Move 1 leaves it");
});

test("#506 item 1: a drag past items that shaped nothing it works on is still allowed", () => {
  const { doc, move } = moveThenJoin();
  // Box 3 put in at the end, then dragged to the start: no item before it changes a body it works on (it works on none).
  const { doc: three, id } = insertPreset(doc, "box", 10, 10, 10);
  const moved = reorderItem(three, id, 0);
  assert.equal(moved.refused, undefined);
  assert.equal(place(moved.doc!, id), 0);
  // Move 1 may go before Box 1: Box 1 shapes nothing (it is only made), and Move 1 is still after Box 2, which it is built from.
  const early = reorderItem(three, "feature-1", 1);
  assert.equal(early.refused, undefined, early.message);
  assert.ok(place(early.doc!, move) > place(early.doc!, "feature-2"));
});

test("#506 item 1: a Move after a Move of the same body can't swap with it (Centre of bodies reads where the first left it)", () => {
  let { doc } = moveThenJoin();
  // Move 2 shifts Box 2 again after Combine 1 used it up; it works on Box 2 as Move 1 and Combine 1 leave it.
  const b2 = "body:feature-2";
  const second = insertMove(doc, [b2], { ...NO_MOVE, x: 5 });
  doc = second.doc;
  const shaping = shapings(doc.timeline.features).filter((s) => s.of.id === second.id).map((s) => s.by.provenance.self.label);
  assert.deepEqual(shaping, ["Move 1", "Combine 1"]);
  const swap = reorderItem(doc, second.id, place(doc, "feature-3"));
  assert.equal(swap.message, "Move 2 can't go before Move 1: it uses Box 2 as Move 1 leaves it");
});

test("#506 item 2: deleting Move 1 asks, naming Combine 1, which changes without it", async () => {
  const { doc, move } = moveThenJoin();
  // Combine 1 depends in the file only on Box 1 and Box 2, so the old box asked nothing and the Join quietly became 24000 mm³.
  const plan = await planDelete(kernel, doc, move);
  assert.deepEqual(plan.ask, { heading: "Delete Move 1?", words: "Combine 1 uses Box 2 as Move 1 leaves it, so Combine 1 changes without it. Undo brings Move 1 back." });
});

test("#506 item 2: deleting Combine 1 that a later Combine works on asks, beside what is built from it", () => {
  const { doc, b1 } = moveThenJoin();
  // Box 3 cut from Box 1 after the Join: Combine 2 works on Box 1 as Combine 1 leaves it.
  const box3 = insertPreset(doc, "box", 10, 10, 50);
  const second = insertCombine(box3.doc, b1, [`body:${box3.id}`], "cut");
  const ask = deleteWords(second.doc, deleteItem(second.doc, "feature-4"), "feature-4");
  assert.deepEqual(ask, { heading: "Delete Combine 1?", words: "Combine 2 uses Box 1 as Combine 1 leaves it, so Combine 2 changes without it. Undo brings Combine 1 back." });
  // An item that shapes nothing later still goes at once: Box 3 is only used by Combine 2, which is built from it (asked as ever).
  const box = deleteWords(second.doc, deleteItem(second.doc, box3.id), box3.id);
  assert.ok(box !== null && !box.words.includes("changes without it"), box?.words);
});

test("#506 item 3: unticking Keep tools on Combine 1 while Combine 2 uses its tool is refused in words", () => {
  // Box 1 and Box 2 (10 × 10 × 10 at the origin), Box 2 moved to x 5..15; Combine 1 cuts Box 2 from Box 1 keeping it;
  // Combine 2 joins Box 2 to Box 3. Unticking Keep tools would use Box 2 up, leaving Combine 2 nothing to join.
  let doc = partDocument("box", 10, 10, 10);
  const b1 = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const b2 = `body:${id}`;
  doc = insertMove(doc, [b2], { ...NO_MOVE, x: 5 }).doc;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const b3 = `body:${id}`;
  const c1 = insertCombine(doc, b1, [b2], "cut", true);
  const c2 = insertCombine(c1.doc, b3, [b2], "join");
  assert.throws(() => changedCombine(c2.doc, c1.id, b1, [b2], "cut", false), { message: "Combine 2 uses Body 2, which Combine 1 would use up: change or delete Combine 2 first" });
  // Changing only the operation, Keep tools still on, is allowed; and so is unticking it once nothing later uses Box 2.
  assert.doesNotThrow(() => changedCombine(c2.doc, c1.id, b1, [b2], "join", true));
  assert.doesNotThrow(() => changedCombine(c1.doc, c1.id, b1, [b2], "cut", false));
  // A new tool Combine 2 works on is used up too: Box 3 added to Combine 1's tools (Keep tools off) is refused.
  const plain = insertCombine(doc, b1, [b2], "cut");
  const later = insertMove(plain.doc, [b3], { ...NO_MOVE, x: 1 });
  assert.throws(() => changedCombine(later.doc, plain.id, b1, [b2, b3], "cut", false), { message: "Move 2 uses Body 3, which Combine 1 would use up: change or delete Move 2 first" });
});

test("what each item changes for the items after it (body-uses.ts), each kind by hand", () => {
  const { doc, b1, b2, move, combine } = moveThenJoin();
  const item = (id: string) => doc.timeline.features.find((f) => f.id === id)!;
  // A Move places its bodies; a Combine changes its target and uses up its tools (Keep tools off); a box makes, never changes.
  assert.deepEqual(bodiesChanged(item(move)), [b2]);
  assert.deepEqual(bodiesChanged(item(combine)), [b1, b2]);
  assert.deepEqual(bodiesChanged(item("feature-1")), []);
  const kept = insertCombine(doc, b1, [b2], "cut", true);
  assert.deepEqual(bodiesChanged(kept.doc.timeline.features.find((f) => f.id === kept.id)!), [b1]);
});
