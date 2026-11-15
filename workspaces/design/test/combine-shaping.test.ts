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
import { insertDuplicates } from "../src/duplicate.ts";
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
  // Box 1 shapes nothing (it is only made), so the shaping rule has nothing against Box 1 going after Box 2. Since
  // SL #760 item 2 the swap is refused for another reason: Combine 1 joins the two, and the joined body is the one made
  // first (join-reorder.test.ts).
  const early = reorderItem(three, "feature-1", 1);
  assert.equal(early.refused, "join-order");
  assert.equal(early.message, "Box 1 can't go after Box 2: Combine 1 joins their bodies, and the joined body is the one made first");
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

// SL #676 item 1 (final Combine hunt): the rule above was one-way. An item that reads a body (a Copy, a Mirror, a
// Combine keeping its tools) must also stay before a later item that changes that body, or it silently reads the
// changed body instead.

const volumeOf = async (doc: DesignDocument, body: string) => {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const v = (await cache.view(build.bodies[body].handle)).volume;
  await cache.close();
  return v;
};

test("#676 item 1, by hand: Move 2 of a kept tool can't go before the Combine that cut with it (Box 1 21000 → 19500 mm³)", async () => {
  // Box 1 and Box 2, 40 × 30 × 20; Move 1 shifts Box 2 by (20, 15, 10); Combine 1 cuts Box 2 from Box 1 keeping it;
  // Move 2 then shifts Box 2 by x −10.
  let doc = partDocument("box", 40, 30, 20);
  const b1 = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 40, 30, 20));
  const b2 = `body:${id}`;
  doc = insertMove(doc, [b2], { ...NO_MOVE, x: 20, y: 15, z: 10 }).doc;
  const wrong = insertMove(doc, [b2], { ...NO_MOVE, x: -10 }).doc;
  const combine = insertCombine(doc, b1, [b2], "cut", true);
  const move2 = insertMove(combine.doc, [b2], { ...NO_MOVE, x: -10 });
  doc = move2.doc;
  // As shown, Box 2 is cut at x 20..60, y 15..45, z 10..30: the bite is 20 × 15 × 10 = 3000, so Box 1 is 24000 − 3000 = 21000 mm³.
  near(await volumeOf(doc, b1), 21000);
  // With Move 2 first Box 2 is at x 10..50: the bite is 30 × 15 × 10 = 4500 and Box 1 would be 19500 mm³, a silent change.
  near(await volumeOf(insertCombine(wrong, b1, [b2], "cut", true).doc, b1), 19500);
  // Timeline: Box 1, Box 2, Move 1, Combine 1, Move 2.
  const early = reorderItem(doc, move2.id, place(doc, combine.id));
  assert.equal(early.refused, "before-dependency");
  assert.equal(early.message, "Move 2 can't go before Combine 1: Combine 1 uses Box 2 as it is before Move 2");
  const late = reorderItem(doc, combine.id, 4);
  assert.equal(late.refused, "after-dependent");
  assert.equal(late.message, "Combine 1 can't go after Move 2: it uses Box 2 as it is before Move 2");
});

test("#676 item 1, by hand: a Copy of Box 1 can't go after the Join that changes Box 1 (69000 → 90000 mm³)", async () => {
  const { doc: joined, b1, combine } = moveThenJoin();
  // Copy 1 of Box 1 put in before Combine 1: timeline Box 1, Box 2, Move 1, Copy 1, Combine 1.
  const copy = insertDuplicates({ ...joined, timeline: { ...joined.timeline, marker: "feature-3" } }, [b1]);
  const doc = { ...copy.doc, timeline: { ...copy.doc.timeline, marker: null } };
  const copyId = copy.ids[0];
  assert.deepEqual(doc.timeline.features.map((f) => f.id), ["feature-1", "feature-2", "feature-3", copyId, combine]);
  // Shown: the copy is of the plain box, 24000 mm³, beside the Join's 45000 (#506's working): 69000 in all. After the
  // Join it would be a copy of the 45000 mm³ Join: 90000 in all, a silent change.
  near(await volumeOf(doc, `body:${copyId}`), 24000);
  const after = reorderItem(doc, copyId, 4);
  assert.equal(after.refused, "after-dependent");
  assert.equal(after.message, "Copy 1 can't go after Combine 1: it uses Box 1 as it is before Combine 1");
  const before = reorderItem(doc, combine, 3);
  assert.equal(before.refused, "before-dependency");
  assert.equal(before.message, "Combine 1 can't go before Copy 1: Copy 1 uses Box 1 as it is before Combine 1");
});

test("#676 item 1: a Copy of a Join's tool can't go after the Join that uses it up", () => {
  const { doc: joined, b2, combine } = moveThenJoin();
  const copy = insertDuplicates({ ...joined, timeline: { ...joined.timeline, marker: "feature-3" } }, [b2]);
  const doc = { ...copy.doc, timeline: { ...copy.doc.timeline, marker: null } };
  const after = reorderItem(doc, copy.ids[0], 4);
  assert.equal(after.message, "Copy 1 can't go after Combine 1: it uses Box 2 as it is before Combine 1");
});

test("#676 item 1: Move 1 can't go before a Copy of the box it moves (the copy would sit on the moved box)", () => {
  let doc = partDocument("box", 40, 30, 20);
  const b1 = `body:${doc.timeline.features[0].id}`;
  const copy = insertDuplicates(doc, [b1]);
  const move = insertMove(copy.doc, [b1], { ...NO_MOVE, x: 50 });
  doc = move.doc;
  const early = reorderItem(doc, move.id, 1);
  assert.equal(early.refused, "before-dependency");
  assert.equal(early.message, "Move 1 can't go before Copy 1: Copy 1 uses Box 1 as it is before Move 1");
  // An item may still go past a Copy of a body it doesn't change: Box 2 and Copy 2 of it put in last, then Move 1 (of
  // Box 1) dragged to the end, after Copy 2.
  const box2 = insertPreset(doc, "box", 10, 10, 10);
  const other = insertDuplicates(box2.doc, [`body:${box2.id}`]);
  const last = reorderItem(other.doc, move.id, 4);
  assert.equal(last.refused, undefined, last.message);
  assert.equal(place(last.doc!, move.id), 4);
});
