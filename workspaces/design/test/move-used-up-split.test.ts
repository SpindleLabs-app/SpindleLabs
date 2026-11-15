// SL #430 (timeline fuzzing, seed 8907002656214478127): a Move holding a
// body that an earlier Combine uses up, when an earlier edit splits that
// body into pieces. The Move moved nothing split from it: the piece left
// over from the split stayed where it was, numbered as a new body, so the
// Move never held it, while the timeline model (and the same split with
// the Move off, SL #624 item 2) has the Move take it. A Move holds what the
// person picked, the whole body: every new piece split from it is moved
// and held, whether or not the piece keeping the body's id is still there
// to move. On the real kernel; each volume and box worked out by hand from
// the boxes' corners in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, movedBodies, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, followedDoc, rebuildTimeline } from "../src/rebuild.ts";

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
 * Bar 100 × 40 × 10 (Box 1); Box 2 10 × `depth` × 30 moved (30, −10, −10) by Move 1; Combine 1 cuts Box 2 out of the
 * bar; Box 3 20 × 20 × 20; Combine 2 cuts the bar out of Box 3 (using the bar up); Move 2, of the bar and of Box 4
 * (10 × 10 × 10, so the Move still has a body to move), lifts them 50.
 */
function design(depth: number, moveBar = true, withBox4 = true) {
  let doc = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  let slot: string, box3: string, box4: string;
  ({ doc, id: slot } = insertPreset(doc, "box", 10, depth, 30));
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -10 }).doc;
  const c1 = insertCombine(doc, `body:${bar}`, [`body:${slot}`], "cut");
  ({ doc, id: box3 } = insertPreset(c1.doc, "box", 20, 20, 20));
  doc = insertCombine(doc, `body:${box3}`, [`body:${bar}`], "cut").doc;
  ({ doc, id: box4 } = insertPreset(doc, "box", 10, 10, 10));
  const m2 = insertMove(doc, moveBar ? [`body:${bar}`, ...(withBox4 ? [`body:${box4}`] : [])] : [`body:${box4}`], { ...NO_MOVE, z: 50 });
  return { doc: m2.doc, bar, slot, box3, box4, combine: c1.id, move: m2.id };
}

test("hand-worked: an earlier edit splits a bar that an earlier Combine uses up and a Move holds: the Move lifts the piece left over and holds it", async () => {
  const { doc, bar, slot, box3, box4, combine, move } = design(30);
  // The slot x 30..40, y −10..20 notches the bar, one body; Combine 2 uses it up: Box 3 (x, y, z 0..20) less the bar's
  // x 0..20, y 0..20, z 0..10 is 8,000 − 4,000 = 4,000. Move 2 moves only Box 4 (z 50..60), warning about the bar.
  const s0 = await built(doc);
  near(await s0.volume(`body:${box3}`), 4000);
  assert.equal(s0.build.bodies[`body:${bar}`], undefined);
  assert.deepEqual(await s0.bounds(`body:${box4}`), [[0, 0, 50], [10, 10, 60]]);
  assert.equal(s0.build.results[move].status, "built");
  assert.deepEqual((s0.build.results[move] as { missing?: { bodies: string[] } }).missing?.bodies, [`body:${bar}`]);
  await s0.cache.close();
  // Box 2 made 60 deep: the slot y −10..50 crosses the whole bar, so Combine 1 leaves the near end x 0..30 (the bar's id,
  // which Combine 2 still uses up: Box 3 is 4,000 as before) and the far end x 40..100 (60 × 40 × 10 = 24,000, piece 1).
  // The person lifted the whole bar, so the far end is lifted: z 50..60, and Move 2 holds it from now on.
  const piece = `body:${combine}/piece:1`;
  const s1 = await built(changePreset(s0.doc, slot, "box", 10, 60, 30));
  near(await s1.volume(`body:${box3}`), 4000);
  near(await s1.volume(piece), 24000);
  assert.deepEqual(await s1.bounds(piece), [[40, 0, 50], [100, 40, 60]], "the far piece is lifted with the bar it was split from");
  assert.deepEqual((s1.build.results[move] as { takes?: string[] }).takes, [piece]);
  const move2 = s1.doc.timeline.features.find((f) => f.id === move)!;
  assert.deepEqual(movedBodies(move2), [`body:${bar}`, `body:${box4}`, piece]);
  assert.ok(s1.doc.bodies!.some((b) => b.id === piece), "the piece is numbered");
  await s1.cache.close();
  // Rebuilt again, and saved and opened again: the same, with nothing more to take.
  for (const again of [s1.doc, readDesignDocument(JSON.parse(JSON.stringify(s1.doc)))]) {
    const s2 = await built(again);
    assert.deepEqual(await s2.bounds(piece), [[40, 0, 50], [100, 40, 60]]);
    assert.equal((s2.build.results[move] as { takes?: string[] }).takes, undefined);
    assert.equal(s2.doc, again, "nothing more to take in");
    await s2.cache.close();
  }
});

test("control: a Move that never held the bar leaves the far piece where the split puts it", async () => {
  const { doc, slot, combine, move } = design(30, false);
  const s0 = await built(doc);
  await s0.cache.close();
  const piece = `body:${combine}/piece:1`;
  const s1 = await built(changePreset(s0.doc, slot, "box", 10, 60, 30));
  assert.deepEqual(await s1.bounds(piece), [[40, 0, 0], [100, 40, 10]]);
  assert.equal((s1.build.results[move] as { takes?: string[] }).takes, undefined);
  await s1.cache.close();
});

test("hand-worked (SL #760 item 1): a Move holding the used-up bar alone lifts the piece split from it, by the build that splits it as by the file opened again", async () => {
  const { doc, bar, slot, combine, move } = design(30, true, false);
  // Before the split the Move holds only the bar, which Combine 2 uses up: nothing to move, so it fails, naming the bar.
  const s0 = await built(doc);
  assert.equal(s0.build.results[move].status, "failed");
  await s0.cache.close();
  // Box 2 made 60 deep: the far end x 40..100 (24,000, piece 1) is split from the bar the Move holds, so it is lifted
  // 50 (z 50..60) by this very build, the Move built with a warning about the bar it can no longer move, and holds the
  // piece from now on. The screen and the file agree: built again from the saved file, the same.
  const piece = `body:${combine}/piece:1`;
  const s1 = await built(changePreset(s0.doc, slot, "box", 10, 60, 30));
  near(await s1.volume(piece), 24000);
  assert.deepEqual(await s1.bounds(piece), [[40, 0, 50], [100, 40, 60]], "lifted by the build that splits it");
  const r = s1.build.results[move] as { status: string; takes?: string[]; missing?: { bodies: string[] } };
  assert.deepEqual([r.status, r.takes, r.missing?.bodies], ["built", [piece], [`body:${bar}`]]);
  assert.deepEqual(movedBodies(s1.doc.timeline.features.find((f) => f.id === move)!), [`body:${bar}`, piece]);
  await s1.cache.close();
  const reopened = readDesignDocument(JSON.parse(JSON.stringify(s1.doc)));
  const s2 = await built(reopened);
  assert.deepEqual(await s2.bounds(piece), [[40, 0, 50], [100, 40, 60]]);
  assert.equal(s2.build.results[move].status, "built");
  assert.equal(s2.doc, reopened, "nothing more to take in");
  await s2.cache.close();
});
