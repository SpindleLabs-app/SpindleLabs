// SL #583 item 2 (fourth Combine break-it check, 2026-11-11): an earlier
// edit that splits a body a later Move holds. The Move moved only the piece
// keeping the body's id and left the other where it was, as a new body,
// with no word. A Move holds what the person picked: the whole body, so it
// moves every piece split from it since, and holds them from then on (the
// rebuild names them, `followedDoc` takes them into the Move). A piece that
// was already there when the Move was made is still left alone unless
// picked. On the real kernel; each volume and box worked out by hand from
// the boxes' corners in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, insertMove, movedBodies, NO_MOVE } from "../src/move.ts";
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

/** Bar 100 × 40 × 10 (Box 1); Box 2 10 × `depth` × 30 moved (30, −10, −10) by Move 1; Combine 1 cuts Box 2 out of the bar. */
function slotted(depth: number) {
  let doc = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  let slot: string;
  ({ doc, id: slot } = insertPreset(doc, "box", 10, depth, 30));
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -10 }).doc;
  const c = insertCombine(doc, `body:${bar}`, [`body:${slot}`], "cut");
  return { doc: c.doc, bar, slot, combine: c.id };
}

test("hand-worked: an earlier edit that makes a Cut go right through a bar a Move lifts: the Move lifts both pieces and holds the new one from then on", async () => {
  const { doc, bar, slot, combine } = slotted(30);
  // The slot x 30..40, y −10..20, z −10..20 notches the bar (y 0..20 of its 40): 40,000 − 10 × 20 × 10 = 38,000, one body.
  const s0 = await built(doc);
  near(await s0.volume(`body:${bar}`), 38000);
  assert.deepEqual(Object.keys(s0.build.bodies), [`body:${bar}`]);
  await s0.cache.close();
  // Move 2 lifts the bar 50 up: z 50..60.
  const m = insertMove(s0.doc, [`body:${bar}`], { ...NO_MOVE, z: 50 });
  const s1 = await built(m.doc);
  assert.deepEqual(await s1.bounds(`body:${bar}`), [[0, 0, 50], [100, 40, 60]]);
  await s1.cache.close();
  // Box 2 made 60 deep: the slot y −10..50 crosses the whole bar (y 0..40), so the Cut leaves two pieces, the near end
  // x 0..30 (30 × 40 × 10 = 12,000, keeping the bar's id) and the far end x 40..100 (60 × 40 × 10 = 24,000, piece 1).
  // The person lifted the whole bar, so both are lifted: z 50..60 each, nothing left at z 0..10.
  const piece = `body:${combine}/piece:1`;
  const s2 = await built(changePreset(s1.doc, slot, "box", 10, 60, 30));
  near(await s2.volume(`body:${bar}`), 12000);
  near(await s2.volume(piece), 24000);
  assert.deepEqual(await s2.bounds(`body:${bar}`), [[0, 0, 50], [30, 40, 60]]);
  assert.deepEqual(await s2.bounds(piece), [[40, 0, 50], [100, 40, 60]], "the far piece is lifted with the near one");
  assert.deepEqual(s2.build.results[m.id], { status: "built", holds: (s2.build.results[m.id] as { holds: number[] }).holds, takes: [piece] });
  // Taken in: Move 2 holds the piece too (and depends on Combine 1, which makes it), so it stays lifted.
  const move2 = s2.doc.timeline.features.find((f) => f.id === m.id)!;
  assert.deepEqual(movedBodies(move2), [`body:${bar}`, piece]);
  assert.deepEqual(move2.dependsOn, [bar, combine]);
  assert.ok(s2.doc.bodies!.some((b) => b.id === piece), "the piece is numbered");
  await s2.cache.close();
  // Rebuilt again, and saved and opened again: the same, with nothing more to take.
  for (const again of [s2.doc, readDesignDocument(JSON.parse(JSON.stringify(s2.doc)))]) {
    const s3 = await built(again);
    assert.deepEqual(await s3.bounds(piece), [[40, 0, 50], [100, 40, 60]]);
    assert.equal((s3.build.results[m.id] as { takes?: string[] }).takes, undefined);
    assert.equal(s3.doc, again, "nothing more to take in");
    await s3.cache.close();
  }
  // Box 2 back to 30 deep: a notch again, one body (38,000) lifted whole; the piece Move 2 holds is the bar's again, which
  // Move 2 also holds, so it is no failure.
  const s4 = await built(changePreset(s2.doc, slot, "box", 10, 30, 30));
  assert.equal(s4.build.results[m.id].status, "built", JSON.stringify(s4.build.results[m.id]));
  near(await s4.volume(`body:${bar}`), 38000);
  assert.deepEqual(await s4.bounds(`body:${bar}`), [[0, 0, 50], [100, 40, 60]]);
  assert.equal(s4.build.bodies[piece], undefined);
  await s4.cache.close();
});

test("control: a Move made when the bar was already in two pieces, of the near piece only, still leaves the far piece where it is", async () => {
  // The slot 60 deep from the start: the near end x 0..30 (the bar's id) and the far end x 40..100 (piece 1) are both
  // there, numbered, when Move 2 is made of the near end alone. The far end stays at z 0..10, as picked.
  const { doc, bar, combine } = slotted(60);
  const s0 = await built(doc);
  await s0.cache.close();
  const piece = `body:${combine}/piece:1`;
  const m = insertMove(s0.doc, [`body:${bar}`], { ...NO_MOVE, z: 50 });
  const s1 = await built(m.doc);
  assert.deepEqual(await s1.bounds(`body:${bar}`), [[0, 0, 50], [30, 40, 60]]);
  assert.deepEqual(await s1.bounds(piece), [[40, 0, 0], [100, 40, 10]]);
  assert.equal((s1.build.results[m.id] as { takes?: string[] }).takes, undefined);
  assert.equal(s1.doc, m.doc);
  await s1.cache.close();
});

test("hand-worked: a Join whose tool an earlier edit moves apart: a Move of the joined body moves both lumps", async () => {
  // Box 1 40 × 30 × 20 at the origin; Box 2 the same, Move 1 (20, 15, 10): x 20..60, y 15..45, z 10..30. Joined:
  // 24,000 × 2 − 20 × 15 × 10 = 45,000, one body. Move 3 shifts it 100 along y.
  let doc = partDocument("box", 40, 30, 20);
  const box1 = doc.timeline.features[0].id;
  let box2: string;
  ({ doc, id: box2 } = insertPreset(doc, "box", 40, 30, 20));
  const m1 = insertMove(doc, [`body:${box2}`], { ...NO_MOVE, x: 20, y: 15, z: 10 });
  const j = insertCombine(m1.doc, `body:${box1}`, [`body:${box2}`], "join");
  const s0 = await built(j.doc);
  near(await s0.volume(`body:${box1}`), 45000);
  await s0.cache.close();
  const m3 = insertMove(s0.doc, [`body:${box1}`], { ...NO_MOVE, y: 100 });
  // Move 1 edited to (100, 0, 10): Box 2 x 100..140, y 0..30, z 10..30, apart from Box 1. The Join leaves two lumps,
  // Box 1's (keeping its id) and Box 2's (piece 1), 24,000 each; Move 3 shifts both 100 along y.
  const s1 = await built(changedMove(m3.doc, m1.id, { ...NO_MOVE, x: 100, z: 10 }));
  const piece = `body:${j.id}/piece:1`;
  near(await s1.volume(`body:${box1}`), 24000);
  near(await s1.volume(piece), 24000);
  assert.deepEqual(await s1.bounds(`body:${box1}`), [[0, 100, 0], [40, 130, 20]]);
  assert.deepEqual(await s1.bounds(piece), [[100, 100, 10], [140, 130, 30]], "Box 2's lump is moved with Box 1's");
  assert.deepEqual(movedBodies(s1.doc.timeline.features.find((f) => f.id === m3.id)!), [`body:${box1}`, piece]);
  await s1.cache.close();
});
