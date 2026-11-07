// Combine bug hunt 2026-11-06: a Move of a tool put after the Combine that used the tool up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { reorderItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

test("a Move of a used-up tool after the Combine fails saying the Combine used it up, not that the box isn't built", async () => {
  // Block 40 × 30 × 20; cube 10 mm moved (5, 5, 15) then cut from it (Combine 1, tool used up).
  const block = partDocument("box", 40, 30, 20);
  const blockBody = `body:${block.timeline.features[0].id}`;
  const { doc: two, id: cube } = insertPreset(block, "box", 10, 10, 10);
  const moved = insertMove(two, [`body:${cube}`], { ...NO_MOVE, x: 5, y: 5, z: 15 });
  const c = insertCombine(moved.doc, blockBody, [`body:${cube}`], "cut");
  // Drag the Move after the Combine: the timeline lets it (they share no dependency).
  const r = reorderItem(c.doc, moved.id, c.doc.timeline.features.length - 1);
  assert.ok("doc" in r, JSON.stringify(r));
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(r.doc, cache, kernel);
  const res = build.results[moved.id];
  await cache.close();
  // Box 2 built (its result says so); the Move fails because Combine 1 used Box 2 up.
  assert.equal(build.results[cube].status, "built");
  assert.equal(res.status, "failed");
  assert.doesNotMatch(res.status === "failed" ? res.message : "", /is not built/);
});
