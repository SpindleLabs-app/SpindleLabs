// SL #624 item 2 (broken-solids hunt, 2026-11-12; SL #583 item 2 from a
// new side): a body a Move holds is split by an earlier Cut WHILE THE MOVE
// IS OFF (suppressed, or rolled back by the marker). The rebuild made then
// numbered the new piece, so when the Move came back on it took the piece
// for one that was there when the Move was made, and moved only half the
// body: one piece lifted, the other left on the ground, with no word, and
// a fresh open built the same. A Move holds what the person picked, the
// whole body, so it takes a piece split from it the first time the piece
// appears, on or off (`followedDoc`). On the real kernel; each volume and
// box worked out by hand from the boxes' corners in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, movedBodies, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { moveMarker, suppressItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/** `doc` rebuilt, then taken in as the workspace takes it in after a rebuild (workspace.ts: `numberPieces(followedDoc(…))`). */
async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const view = async (b: string) => cache.view(build.bodies[b].handle);
  return { build, cache, doc: numberPieces(followedDoc(doc, build), Object.keys(build.bodies), builtPieceFaces(build)), volume: async (b: string) => (await view(b)).volume, bounds: async (b: string) => (await view(b)).bounds };
}

/**
 * Bar 100 × 40 × 10 (Box 1); Box 2 10 × 30 × 30 moved (30, −10, −10) by Move 1: x 30..40, y −10..20, z −10..20;
 * Combine 1 cuts it out of the bar, a notch 10 × 20 × 10: 40,000 − 2,000 = 38,000, one body. Then the Moves asked
 * for, each lifting the bar by its z, in order.
 */
function slotted(...lifts: number[]) {
  let doc = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  let slot: string;
  ({ doc, id: slot } = insertPreset(doc, "box", 10, 30, 30));
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -10 }).doc;
  const c = insertCombine(doc, `body:${bar}`, [`body:${slot}`], "cut");
  doc = c.doc;
  const moves: string[] = [];
  for (const z of lifts) {
    const m = insertMove(doc, [`body:${bar}`], { ...NO_MOVE, z });
    doc = m.doc;
    moves.push(m.id);
  }
  return { doc, bar, slot, combine: c.id, moves, piece: `body:${c.id}/piece:1` };
}
/** Box 2 made 60 deep: the slot y −10..50 crosses the whole bar (y 0..40), so the Cut leaves the near end x 0..30 (30 × 40 × 10 = 12,000, the bar's id) and the far end x 40..100 (60 × 40 × 10 = 24,000, piece 1). */
const through = (doc: DesignDocument, slot: string) => changePreset(doc, slot, "box", 10, 60, 30);

for (const way of ["suppressed", "rolled back by the marker"] as const) {
  test(`hand-worked: a Cut goes right through a bar while the Move that lifts it is ${way}: the Move holds the new piece at once, and lifts both when it is back on`, async () => {
    const { doc, bar, slot, combine, moves: [move], piece } = slotted(50);
    const off = (d: DesignDocument) => (way === "suppressed" ? suppressItem(d, move, true) : moveMarker(d, combine));
    const on = (d: DesignDocument) => (way === "suppressed" ? suppressItem(d, move, false) : moveMarker(d, null));
    // Move 2 off: the notched bar back on the ground, z 0..10.
    const s1 = await built(off(doc));
    assert.deepEqual(await s1.bounds(`body:${bar}`), [[0, 0, 0], [100, 40, 10]]);
    near(await s1.volume(`body:${bar}`), 38000);
    await s1.cache.close();
    // The slot through, Move 2 still off: two pieces on the ground. Move 2 holds the whole bar, so it takes the new
    // piece now (and depends on Combine 1, which makes it), though it moves nothing while off.
    const s2 = await built(through(s1.doc, slot));
    assert.deepEqual(await s2.bounds(`body:${bar}`), [[0, 0, 0], [30, 40, 10]]);
    assert.deepEqual(await s2.bounds(piece), [[40, 0, 0], [100, 40, 10]]);
    const held = s2.doc.timeline.features.find((f) => f.id === move)!;
    assert.deepEqual(movedBodies(held), [`body:${bar}`, piece]);
    assert.deepEqual(held.dependsOn, [bar, combine]);
    assert.ok(s2.doc.bodies!.some((b) => b.id === piece), "the piece is numbered");
    await s2.cache.close();
    // Move 2 back on: both pieces lifted 50, z 50..60 each; 12,000 + 24,000 = 36,000; nothing left at z 0..10.
    const back = on(s2.doc);
    const s3 = await built(back);
    assert.equal(s3.build.results[move].status, "built", JSON.stringify(s3.build.results[move]));
    near(await s3.volume(`body:${bar}`), 12000);
    near(await s3.volume(piece), 24000);
    assert.deepEqual(await s3.bounds(`body:${bar}`), [[0, 0, 50], [30, 40, 60]]);
    assert.deepEqual(await s3.bounds(piece), [[40, 0, 50], [100, 40, 60]], "the far piece is lifted with the near one");
    assert.equal(s3.doc, back, "nothing more to take in");
    await s3.cache.close();
    // Saved and opened again: the same.
    const s4 = await built(readDesignDocument(JSON.parse(JSON.stringify(s3.doc))));
    assert.deepEqual(await s4.bounds(piece), [[40, 0, 50], [100, 40, 60]]);
    await s4.cache.close();
  });
}

test("hand-worked: two Moves hold the bar, the first on and the second suppressed, when the Cut goes through: both take the piece, and it is lifted by both once the second is on", async () => {
  // Move 2 lifts the bar 50 and Move 3 another 7. Move 3 suppressed: the bar at z 50..60.
  const { doc, bar, slot, moves: [first, second], piece } = slotted(50, 7);
  const s1 = await built(through(suppressItem(doc, second, true), slot));
  // Move 2 (on) moved both pieces: z 50..60. Move 3 (off) holds the piece too.
  assert.deepEqual(await s1.bounds(piece), [[40, 0, 50], [100, 40, 60]]);
  for (const m of [first, second]) assert.deepEqual(movedBodies(s1.doc.timeline.features.find((f) => f.id === m)!), [`body:${bar}`, piece], m);
  await s1.cache.close();
  // Move 3 on: both pieces at z 57..67 (50 + 7).
  const s2 = await built(suppressItem(s1.doc, second, false));
  assert.deepEqual(await s2.bounds(`body:${bar}`), [[0, 0, 57], [30, 40, 67]]);
  assert.deepEqual(await s2.bounds(piece), [[40, 0, 57], [100, 40, 67]]);
  await s2.cache.close();
});

test("a suppressed Move takes only what is split from a body it holds, after it was made: not a piece that was already there, and not the pieces of another body", async () => {
  // The slot is through BEFORE the Move is made: the person lifts only the near end (the bar's id); the far end
  // (piece 1) was there to pick and was not picked, so it stays, on or off (SL #583 item 2's own rule).
  const s = slotted();
  const s0 = await built(through(s.doc, s.slot));
  assert.ok(s0.doc.bodies!.some((b) => b.id === s.piece), "the piece is numbered before the Move is made");
  await s0.cache.close();
  const m = insertMove(s0.doc, [`body:${s.bar}`], { ...NO_MOVE, z: 50 });
  const s1 = await built(suppressItem(m.doc, m.id, true));
  assert.deepEqual(movedBodies(s1.doc.timeline.features.find((f) => f.id === m.id)!), [`body:${s.bar}`], "a piece that was there when the Move was made is not taken");
  await s1.cache.close();
  const s2 = await built(suppressItem(s1.doc, m.id, false));
  assert.deepEqual(await s2.bounds(`body:${s.bar}`), [[0, 0, 50], [30, 40, 60]]);
  assert.deepEqual(await s2.bounds(s.piece), [[40, 0, 0], [100, 40, 10]], "the far end stays on the ground: it was not picked");
  await s2.cache.close();
  // A suppressed Move of ANOTHER body (Box 3, off to the side) takes nothing when the bar is split.
  const t = slotted();
  const other = insertPreset(t.doc, "box", 5, 5, 5);
  const far = insertMove(other.doc, [`body:${other.id}`], { ...NO_MOVE, x: 500 });
  const t1 = await built(through(suppressItem(far.doc, far.id, true), t.slot));
  assert.deepEqual(movedBodies(t1.doc.timeline.features.find((f) => f.id === far.id)!), [`body:${other.id}`]);
  await t1.cache.close();
});
