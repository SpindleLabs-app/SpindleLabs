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
  // Drag the Move after the Combine: refused since SL #506 item 1 (Combine 1 cuts Box 2 where the Move leaves it).
  const r = reorderItem(c.doc, moved.id, c.doc.timeline.features.length - 1);
  assert.deepEqual(r, { refused: "after-dependent", message: "Move 1 can't go after Combine 1: Combine 1 uses Box 2 as Move 1 leaves it" });
  // A file saved before #506 may hold that order (the drag was allowed then): the Move still fails in the right words.
  const [b1, b2, move1, combine1] = c.doc.timeline.features;
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline({ ...c.doc, timeline: { ...c.doc.timeline, features: [b1, b2, combine1, move1] } }, cache, kernel);
  const res = build.results[moved.id];
  await cache.close();
  // Box 2 built (its result says so); the Move fails because Combine 1 used Box 2 up.
  assert.equal(build.results[cube].status, "built");
  assert.equal(res.status, "failed");
  assert.doesNotMatch(res.status === "failed" ? res.message : "", /is not built/);
});
