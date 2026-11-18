// SL #624 item 3 (broken-solids hunt, 2026-11-12): a Combine's result and a
// Copy of it still lying on it are two bodies of the design that share one
// kernel body (a copy costs nothing to build). Combining them handed the
// kernel that one body as its own tool, so it refused with "a body can't be
// its own tool (tool 1 is the target)", which is not what the person
// picked. A plain box and its copy were fine: a second pick of an equal
// body with a spec is built again (35f1d). A second pick of a body with no
// spec (a Combine's result) now gets a kernel body of its own too. On the
// real kernel; each volume worked out by hand in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

// Cube A x/y/z 0..10 (feature-1); cube B the same (feature-2) moved 5 along x (feature-3); B joined to A (feature-4):
// body:feature-1 is x 0..15, y and z 0..10: 15 × 10 × 10 = 1,500 mm³. Then a Copy of it, in the same place.
function joinedAndCopied() {
  let doc = partDocument("box", 10, 10, 10);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 5 }).doc;
  doc = insertCombine(doc, "body:feature-1", ["body:feature-2"], "join").doc;
  const copy = insertDuplicates(doc, ["body:feature-1"]);
  return { doc: copy.doc, copy: `body:${copy.ids[0]}` };
}

async function built(doc: DesignDocument) {
  const before = await kernel.call("body_count");
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const volumes: Record<string, number> = {};
  for (const [id, b] of Object.entries(build.bodies)) volumes[id] = (await cache.view(b.handle)).volume;
  return { build, volumes, close: async () => (await cache.close(), assert.equal(await kernel.call("body_count"), before, "every body freed")) };
}

for (const operation of ["join", "intersect"] as const satisfies readonly CombineOperation[]) {
  test(`hand-worked: a Combine's result and its Copy in the same place, Combine ${operation}: one 1,500 mm³ body`, async () => {
    const { doc, copy } = joinedAndCopied();
    const c = insertCombine(doc, "body:feature-1", [copy], operation);
    const s = await built(c.doc);
    // Two equal solids in one place joined, or what they share, is that solid: x 0..15 × 10 × 10 = 1,500. The copy is used up.
    assert.equal(s.build.results[c.id].status, "built", JSON.stringify(s.build.results[c.id]));
    assert.deepEqual(Object.keys(s.volumes), ["body:feature-1"]);
    near(s.volumes["body:feature-1"], 1500);
    await s.close();
  });
}

test("a Combine's result cut by its Copy in the same place leaves nothing, and says that, not that the body is its own tool", async () => {
  const { doc, copy } = joinedAndCopied();
  const c = insertCombine(doc, "body:feature-1", [copy], "cut");
  const s = await built(c.doc);
  const r = s.build.results[c.id];
  // A solid minus an equal solid in the same place is nothing: refused, both bodies left as they were (1,500 each).
  assert.equal(r.status, "failed", JSON.stringify(r));
  assert.doesNotMatch((r as { message: string }).message, /its own tool|again/);
  assert.match((r as { message: string }).message, /nothing/);
  near(s.volumes["body:feature-1"], 1500);
  near(s.volumes[copy], 1500);
  await s.close();
});

test("hand-worked: a Combine's result and its Copy both joined to a third body as its tools: one body, and no word about a tool given twice", async () => {
  // A plate x −5..20, y 0..10, z −5..0 under both (feature-6): 25 × 10 × 5 = 1,250, touching their whole bottoms; the
  // join is the plate and the 1,500 block on it: 2,750 mm³.
  const { doc, copy } = joinedAndCopied();
  const plate = insertPreset(doc, "box", 25, 10, 5);
  const placed = insertMove(plate.doc, [`body:${plate.id}`], { ...NO_MOVE, x: -5, z: -5 }).doc;
  const c = insertCombine(placed, `body:${plate.id}`, ["body:feature-1", copy], "join");
  const s = await built(c.doc);
  assert.equal(s.build.results[c.id].status, "built", JSON.stringify(s.build.results[c.id]));
  assert.deepEqual(Object.keys(s.volumes), [`body:${plate.id}`]);
  near(s.volumes[`body:${plate.id}`], 2750);
  await s.close();
});

test("control: the same with a plain box and its Copy (a body with a spec) was right before and still is: 1,000 mm³", async () => {
  const copy = insertDuplicates(partDocument("box", 10, 10, 10), ["body:feature-1"]);
  const c = insertCombine(copy.doc, "body:feature-1", [`body:${copy.ids[0]}`], "join");
  const s = await built(c.doc);
  assert.equal(s.build.results[c.id].status, "built");
  near(s.volumes["body:feature-1"], 1000);
  await s.close();
});
