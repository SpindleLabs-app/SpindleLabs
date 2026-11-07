// Combine bug hunt (2026-11-06): two Combines with equal inputs share one cached
// result, so a third Combine of their results hands the kernel one body as
// target and tool (35f1d fixed this only for bodies with a spec).

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

test("two equal cut boxes joined by a third Combine: 500 mm³, not 'its own tool'", async () => {
  // Box 1 and Box 3: 10 × 10 × 10 at the origin. Box 2 the same moved to x 5..15. Combine 1 cuts Box 2 from Box 1, keeping
  // it; Combine 2 cuts Box 2 from Box 3. Each leaves x 0..5: 5 × 10 × 10 = 500 mm³, the two in the same place.
  // Combine 3 joins them: two equal bodies lying wholly on each other join to one 500 mm³ body (as 35f1d's two cubes do).
  let doc = partDocument("box", 10, 10, 10);
  const b1 = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const b2 = `body:${id}`;
  doc = insertMove(doc, [b2], { ...NO_MOVE, x: 5 }).doc;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const b3 = `body:${id}`;
  const c1 = insertCombine(doc, b1, [b2], "cut", true);
  const c2 = insertCombine(c1.doc, b3, [b2], "cut");
  const c3 = insertCombine(c2.doc, b1, [b3], "join");
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(c3.doc, cache, kernel);
  near((await cache.view(build.bodies[b1].handle)).volume, 500);
  const r = build.results[c3.id];
  assert.equal(r.status, "built", JSON.stringify(r));
  near((await cache.view(build.bodies[b1].handle)).volume, 500);
  await cache.close();
});
