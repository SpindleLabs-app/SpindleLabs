// #499 (Combine check, 2026-11-11): a Combine's piece used as the tool of a
// later Combine. The piece is used up, so the rebuild no longer holds it;
// that is not a failure, and the later Combine's own new piece must be
// among the design's bodies (the Bodies rows and the STL come from them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { bodyRows, designBodies, failedIds } from "../src/browser.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

/** As workspace.ts buildPart: rebuild, number the pieces made, then what the browser lists against what the rebuild holds, with each held body's volume. */
async function settle(doc0: DesignDocument) {
  const cache = new BodyCache(kernel);
  const first = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(first.bodies), builtPieceFaces(first));
  const build = await rebuildTimeline(doc, cache, kernel);
  const failed = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
  const volumes: Record<string, number> = {};
  for (const [id, b] of Object.entries(build.bodies)) volumes[id] = Math.round((await cache.view(b.handle)).volume);
  await cache.close();
  return { doc, build, failed, volumes };
}

/** Box 1 a bar 100 × 20 × 10; Box 2 a slot 10 × 40 × 20 at x 45..55 through it; Box 3 a plate 20 × 60 × 4 at x 70..90, y -20..40, z 3..7. */
function bar() {
  let doc = partDocument("box", 100, 20, 10);
  const b1 = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 40, 20));
  const b2 = `body:${id}`;
  doc = insertMove(doc, [b2], { ...NO_MOVE, x: 45, y: -10, z: -5 }).doc;
  ({ doc, id } = insertPreset(doc, "box", 20, 60, 4));
  const b3 = `body:${id}`;
  doc = insertMove(doc, [b3], { ...NO_MOVE, x: 70, y: -20, z: 3 }).doc;
  return { doc, b1, b2, b3 };
}

test("a piece used as the next Combine's tool: that Combine's new piece is a body of the design", async () => {
  const { doc: d0, b1, b2, b3 } = bar();
  // Cut the slot from the bar: x 0..45 keeps Body 1 (45 · 20 · 10 = 9,000), x 55..100 is the new piece (45 · 20 · 10 = 9,000).
  const c1 = insertCombine(d0, b1, [b2], "cut", false);
  const one = await settle(c1.doc);
  const piece = `body:${c1.id}/piece:1`;
  assert.deepEqual(designBodies(one.doc, one.failed).map((b) => b.body), [b1, b3, piece]);
  assert.deepEqual([one.volumes[b1], one.volumes[piece], one.volumes[b3]], [9000, 9000, 4800]);
  // Cut that piece (y 0..20, right through the plate's z 3..7) from the plate: the plate is left as
  // y -20..0 and y 20..40, each 20 · 20 · 4 = 1,600; the piece is used up.
  const c2 = insertCombine(one.doc, b3, [piece], "cut", false);
  const two = await settle(c2.doc);
  const plate2 = `body:${c2.id}/piece:1`;
  assert.deepEqual(Object.keys(two.build.bodies).sort(), [b1, b3, plate2].sort(), "what the rebuild holds");
  assert.deepEqual([...two.failed], [], "nothing failed: the used-up piece is not a piece its Combine didn't make");
  assert.deepEqual(designBodies(two.doc, two.failed).map((b) => b.body).sort(), [b1, b3, plate2].sort());
  assert.deepEqual(bodyRows(two.doc, two.failed).map((r) => r.label), ["Body 1", "Body 3", "Body 5"]);
  assert.deepEqual([two.volumes[b1], two.volumes[b3], two.volumes[plate2]], [9000, 1600, 1600]);
});

test("a numbered piece the rebuild didn't make still counts as failed, and one a failed item would have used up does not", async () => {
  const { doc: d0, b1, b2, b3 } = bar();
  const c1 = insertCombine(d0, b1, [b2], "cut", false);
  const one = await settle(c1.doc);
  const piece = `body:${c1.id}/piece:1`;
  // The rebuild held no such piece (as after an edit that no longer splits the bar): it is failed, so it gets no row.
  const held = new Set(Object.keys(one.build.bodies).filter((b) => b !== piece));
  assert.deepEqual([...failedIds(one.doc, one.build.results, held)], [piece]);
  assert.deepEqual(designBodies(one.doc, failedIds(one.doc, one.build.results, held)).map((b) => b.body), [b1, b3]);
  // A later Combine that failed did not use the piece up: missing from the rebuild, it is failed too.
  const c2 = insertCombine(one.doc, b3, [piece], "cut", false);
  const results = { ...one.build.results, [c2.id]: { status: "failed" } };
  assert.deepEqual([...failedIds(c2.doc, results, held)].sort(), [c2.id, piece].sort());
  assert.deepEqual([...failedIds(c2.doc, results, new Set([...held, piece]))], [c2.id]);
});
