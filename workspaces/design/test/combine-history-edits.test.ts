// Combine bug hunt (2026-11-06): editing, reordering, suppressing and rolling back
// items around a Combine. Every volume worked out by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedCombine, insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { designBodies } from "../src/browser.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { deleteItem, moveMarker, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { partFailure } from "../src/part-failure.ts";
import { partFeature } from "../src/document.ts";

const kernel = nodeKernel();

function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[]; moves: (string | null)[] } {
  let doc: DesignDocument | null = null;
  const bodies: string[] = [];
  const moves: (string | null)[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (doc === null) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x !== 0 || y !== 0 || z !== 0) {
      const m = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z });
      doc = m.doc;
      moves.push(m.id);
    } else moves.push(null);
  }
  return { doc: doc!, bodies, moves };
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; volume: (body: string) => Promise<number>; doc: DesignDocument }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, doc: numberPieces(doc, Object.keys(build.bodies)), volume: async (body) => (await cache.view(build.bodies[body].handle)).volume };
}

const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);
const reopen = (d: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(d)));

// Bar x 0..100, y 0..20, z 0..10 (20,000 mm³). Slot tool 10 × 40 × 20 at (30, −10, −5): x 30..40 through.
// Cut: near piece x 0..30 (6,000) keeps the bar's id, far x 40..100 (12,000) is piece 1.
function slotted() {
  const { doc: two, bodies, moves } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const { doc, id } = insertCombine(two, bodies[0], [bodies[1]], "cut");
  return { doc, id, bodies, moves };
}

test("delete a Combine whose piece a second Combine uses: the file still reopens", async () => {
  const { doc: one, id: c1, bodies } = slotted();
  const first = await built(one);
  await first.cache.close();
  const piece = `body:${c1}/piece:1`;
  // Box 3: 10 × 10 × 10 at the origin, joined to the far piece by a second Combine.
  let { doc, id: box3 } = insertPreset(first.doc, "box", 10, 10, 10);
  const c2 = insertCombine(doc, piece, [`body:${box3}`], "join");
  doc = c2.doc;
  const after = await built(doc);
  assert.equal(after.build.results[c2.id].status, "built");
  await after.cache.close();
  const deleted = deleteItem(after.doc, c1);
  // The app's save then open: must not throw.
  assert.doesNotThrow(() => reopen(deleted));
  // And the rebuild fails Combine 2 in words, not with an exception.
  const again = await built(deleted);
  assert.equal(again.build.results[c2.id].status, "failed");
  await again.cache.close();
  void bodies;
});

test("suppress then unsuppress the tool: the cut comes back the same", async () => {
  const { doc, id, bodies } = slotted();
  const off = suppressItem(doc, bodies[1].slice(5), true);
  const a = await built(off);
  // Tool suppressed: the Combine is greyed, the bar whole: 20,000.
  assert.equal(a.build.results[id].status, "greyed");
  near(await a.volume(bodies[0]), 20000);
  assert.deepEqual(designBodies(a.doc, new Set()).map((b) => b.body), [bodies[0]]);
  await a.cache.close();
  const b = await built(suppressItem(off, bodies[1].slice(5), false));
  near(await b.volume(bodies[0]), 6000);
  near(await b.volume(`body:${id}/piece:1`), 12000);
  await b.cache.close();
});

test("marker before, at and after the Combine", async () => {
  const { doc, id, bodies, moves } = slotted();
  const at = (m: string | null) => built(moveMarker(doc, m));
  const before = await at(moves[1]!);
  // Before the Combine: bar whole, tool there: 20,000 and 10 × 40 × 20 = 8,000.
  near(await before.volume(bodies[0]), 20000);
  near(await before.volume(bodies[1]), 8000);
  assert.deepEqual(designBodies(before.doc, new Set()).map((b) => b.body), [bodies[0], bodies[1]]);
  await before.cache.close();
  const on = await at(id);
  near(await on.volume(bodies[0]), 6000);
  assert.equal(on.build.bodies[bodies[1]], undefined);
  await on.cache.close();
  // Rolled back after the pieces were numbered: the rows must not show the piece.
  const numbered = on.doc;
  const back = moveMarker(numbered, moves[1]!);
  assert.deepEqual(designBodies(back, new Set()).map((b) => b.body), [bodies[0], bodies[1]]);
});

test("edit the slot narrower than... moved off the bar: the cut leaves the bar whole and the piece is gone", async () => {
  const { doc, id, bodies, moves } = slotted();
  const first = await built(doc);
  await first.cache.close();
  // Slot moved to x 200: no overlap. Cut of nothing: the bar stays 20,000.
  const moved = changedMove(first.doc, moves[1]!, { ...NO_MOVE, x: 200, y: -10, z: -5 });
  const b = await built(moved);
  const r = b.build.results[id];
  if (r.status === "built") {
    near(await b.volume(bodies[0]), 20000);
    assert.equal(b.build.bodies[`body:${id}/piece:1`], undefined);
  }
  // The part (the slot box, last body maker) is used up or the Combine failed: either way no wrong red line when built.
  const failure = partFailure(moved.timeline.features, partFeature(moved), b.build);
  if (r.status === "built") assert.equal(failure, undefined);
  await b.cache.close();
});

test("swap target and tool: Box 2 cut by Box 1", async () => {
  const { doc, id, bodies } = slotted();
  const swapped = changedCombine(doc, id, bodies[1], [bodies[0]], "cut", false);
  const b = await built(swapped);
  // Slot 10 × 40 × 20 minus the bar's part in it (x 30..40, y 0..20, z 0..10 = 2,000): 8,000 − 2,000 = 6,000, in pieces
  // y −10..0 and y 20..30 (each 10 × 10 × 20 = 2,000) joined by z −5..0 and z 10..15 slabs? No: the bar runs the slot's
  // whole x and z 0..10 of its z −5..15, y 0..20 of y −10..30, so the slot keeps a ring round the bar: one piece, 6,000.
  assert.equal(b.build.results[id].status, "built");
  near(await b.volume(bodies[1]), 6000);
  assert.equal(b.build.bodies[bodies[0]], undefined);
  await b.cache.close();
});

test("hide a Combine's piece, then delete the Combine: the file still reopens", async () => {
  const { doc, id } = slotted();
  const first = await built(doc);
  await first.cache.close();
  const { hideBody } = await import("../src/timeline-edits.ts");
  const hid = hideBody(first.doc, `body:${id}/piece:1`, true);
  assert.doesNotThrow(() => reopen(hid));
  const deleted = deleteItem(hid, id);
  assert.doesNotThrow(() => reopen(deleted));
});

test("a Move of a Combine's piece, then delete the Combine: the file still reopens", async () => {
  const { doc, id } = slotted();
  const first = await built(doc);
  await first.cache.close();
  const moved = insertMove(first.doc, [`body:${id}/piece:1`], { ...NO_MOVE, x: 5 }).doc;
  assert.doesNotThrow(() => reopen(moved));
  const deleted = deleteItem(moved, id);
  assert.doesNotThrow(() => reopen(deleted));
});

test("an upstream edit that stops the split, then undoes it: Combine 2 on the piece fails in words, then builds the same again", async () => {
  const { doc: one, id: c1, moves } = slotted();
  const first = await built(one);
  await first.cache.close();
  const piece = `body:${c1}/piece:1`;
  // Box 3: 10 × 10 × 10 moved to (95, 5, 5): x 95..105, y 5..15, z 5..15. The far piece x 40..100, y 0..20, z 0..10.
  // Overlap x 95..100, y 5..15, z 5..10 = 5 × 10 × 5 = 250. Join: 12,000 + 1,000 − 250 = 12,750.
  let { doc, id: box3 } = insertPreset(first.doc, "box", 10, 10, 10);
  doc = insertMove(doc, [`body:${box3}`], { ...NO_MOVE, x: 95, y: 5, z: 5 }).doc;
  const c2 = insertCombine(doc, piece, [`body:${box3}`], "join");
  const a = await built(c2.doc);
  assert.equal(a.build.results[c2.id].status, "built");
  near(await a.volume(piece), 12750);
  await a.cache.close();
  // Slot moved to x 100..110: it only touches the bar's far end face? Use x 95..105: cut takes x 95..100 off: one piece.
  const off = changedMove(a.doc, moves[1]!, { ...NO_MOVE, x: 95, y: -10, z: -5 });
  const b = await built(off);
  assert.equal(b.build.results[c1].status, "built");
  // Bar 100 − 5 = 95 long: 95 × 20 × 10 = 19,000, one piece.
  near(await b.volume(`body:${one.timeline.features[0].id}`), 19000);
  assert.equal(b.build.results[c2.id].status, "failed");
  await b.cache.close();
  const c = await built(changedMove(b.doc, moves[1]!, { ...NO_MOVE, x: 30, y: -10, z: -5 }));
  assert.equal(c.build.results[c2.id].status, "built");
  near(await c.volume(piece), 12750);
  await c.cache.close();
});

test("reorder the Combine above the Move of its tool: it cuts the tool where it was made", async () => {
  const { doc, id, bodies, moves } = slotted();
  // Timeline: Box 1, Box 2, Move 1 (of Box 2), Combine 1. Combine 1 to place 2 (before Move 1): refused since SL #506
  // item 1, since Combine 1 cuts Box 2 as Move 1 leaves it and the drag would change the cut with no warning.
  const r = reorderItem(doc, id, 2);
  assert.deepEqual(r, { refused: "before-dependency", message: "Combine 1 can't go before Move 1: it uses Box 2 as Move 1 leaves it" });
  // A file saved before #506 may hold that order (the drag was allowed then): it still builds as it says.
  const [box1, box2, move1, combine1] = doc.timeline.features;
  const b = await built({ ...doc, timeline: { ...doc.timeline, features: [box1, box2, combine1, move1] } });
  // Box 2 at the origin: x 0..10, y 0..40, z 0..20; bar's part in it x 0..10, y 0..20, z 0..10 = 2,000. Bar: 18,000, one piece.
  assert.equal(b.build.results[id].status, "built");
  near(await b.volume(bodies[0]), 18000);
  // Move 1 then has nothing to move: Box 2 is used up. It fails (in words).
  assert.equal(b.build.results[moves[1]!].status, "failed");
  await b.cache.close();
});

test("Keep tools on, a second Combine uses the kept tool, then Keep tools turned off on the first", async () => {
  const { doc: one, id: c1, bodies } = slotted();
  const kept = changedCombine(one, c1, bodies[0], [bodies[1]], "cut", true);
  let { doc, id: box3 } = insertPreset(kept, "box", 10, 10, 10);
  // Box 3 at the origin x 0..10, y 0..10, z 0..10; slot x 0..10 of... Box 2 is still at (30,-10,-5): no overlap with Box 3.
  // Join Box 3 to Box 2: 8,000 + 1,000 = 9,000 in two bodies? A join of separate bodies: two pieces. Use cut instead:
  // Box 2 cut by Box 3 changes nothing: 8,000.
  const c2 = insertCombine(doc, bodies[1], [`body:${box3}`], "cut");
  const a = await built(c2.doc);
  assert.equal(a.build.results[c2.id].status, "built");
  near(await a.volume(bodies[1]), 8000);
  await a.cache.close();
  // Turning Keep tools off would use up Box 2, which Combine 2 cuts: refused since SL #506 item 3.
  assert.throws(() => changedCombine(a.doc, c1, bodies[0], [bodies[1]], "cut", false), { message: "Combine 2 uses Body 2, which Combine 1 would use up: change or delete Combine 2 first" });
  // A file saved before #506 may hold it (the edit was allowed then): Combine 2 fails in words and the file reopens.
  const off: DesignDocument = { ...a.doc, timeline: { ...a.doc.timeline, features: a.doc.timeline.features.map((f) => (f.id === c1 ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, keepTools: false } } } : f)) } };
  const b = await built(off);
  assert.equal(b.build.results[c2.id].status, "failed");
  assert.doesNotThrow(() => reopen(b.doc));
  await b.cache.close();
});

test("delete the target's box or the tool's box of a Combine with a numbered piece: reopens, and the Combine fails in words", async () => {
  const { doc, id, bodies } = slotted();
  const first = await built(doc);
  await first.cache.close();
  for (const body of bodies) {
    const deleted = deleteItem(first.doc, body.slice(5));
    assert.doesNotThrow(() => reopen(deleted));
    const b = await built(deleted);
    assert.equal(b.build.results[id].status, "failed");
    // No row for a piece the failed Combine didn't make: designBodies with the failed ids.
    const failed = new Set(Object.keys(b.build.results).filter((k) => b.build.results[k].status === "failed"));
    assert.ok(!designBodies(b.doc, failed).some((x) => x.body.includes("piece")));
    await b.cache.close();
  }
});

test("Combine 2 uses Combine 1's piece, then Combine 1 changed to Join: Combine 2 fails in words, the file reopens", async () => {
  const { doc: one, id: c1, bodies } = slotted();
  const first = await built(one);
  await first.cache.close();
  let { doc, id: box3 } = insertPreset(first.doc, "box", 10, 10, 10);
  const c2 = insertCombine(doc, `body:${c1}/piece:1`, [`body:${box3}`], "join");
  const joined = changedCombine(c2.doc, c1, bodies[0], [bodies[1]], "join", false);
  const b = await built(joined);
  // Join: the bar and the slot, one body: 20,000 + 8,000 − 2,000 = 26,000.
  near(await b.volume(bodies[0]), 26000);
  assert.equal(b.build.results[c2.id].status, "failed");
  assert.doesNotThrow(() => reopen(b.doc));
  await b.cache.close();
});
