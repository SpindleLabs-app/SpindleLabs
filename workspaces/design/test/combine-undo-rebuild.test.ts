// Combine bug hunt 2026-11-06: an undo puts an older document back and the app rebuilds it with the same BodyCache it used since;
// the bodies, piece ids, volumes and face names must be those a fresh open (a new cache) gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedCombine, insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem, moveMarker } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";

const kernel = nodeKernel();

async function summary(build: TimelineBuild, cache: BodyCache) {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(build.bodies).sort()) {
    const b = build.bodies[id];
    const v = await cache.view(b.handle);
    out[id] = { feature: b.feature, volume: Math.round(v.volume * 1e6) / 1e6, faces: b.named?.faces ?? null };
  }
  return { bodies: out, results: Object.fromEntries(Object.entries(build.results).map(([k, r]) => [k, r.status])) };
}

test("cut -> join -> undo -> marker before -> undo, rebuilt with one cache, matches a fresh build each time", async () => {
  // Bar x 0..100 (feature-1), slot through x 30..40 (feature-2 moved by feature-3), Combine 1 cut (feature-4): bar left
  // x 0..30 (6,000 mm3) and piece 1 x 40..100 (12,000 mm3); Combine 2 (feature-6) joins box 3 (feature-5, 10 cube at origin)
  // to piece 1 (they don't touch: two bodies, a join of disjoint bodies).
  let d: DesignDocument = partDocument("box", 100, 20, 10);
  d = insertPreset(d, "box", 10, 40, 20).doc;
  d = insertMove(d, ["body:feature-2"], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const c1 = insertCombine(d, "body:feature-1", ["body:feature-2"], "cut");
  const cache = new BodyCache(kernel);
  let b = await rebuildTimeline(c1.doc, cache, kernel);
  d = numberPieces(c1.doc, Object.keys(b.bodies));
  d = insertPreset(d, "box", 10, 10, 10).doc;
  d = insertMove(d, ["body:feature-5"], { ...NO_MOVE, x: 60, y: 5, z: 10 }).doc;
  const c2 = insertCombine(d, "body:feature-4/piece:1", ["body:feature-5"], "join");
  const states: DesignDocument[] = [c2.doc];
  states.push(changedCombine(c2.doc, c1.id, "body:feature-1", ["body:feature-2"], "join", false));
  states.push(c2.doc); // undo
  states.push(moveMarker(c2.doc, "feature-3"));
  states.push(c2.doc); // undo
  states.push(changedCombine(c2.doc, c1.id, "body:feature-1", ["body:feature-2"], "cut", true));
  states.push(c2.doc); // undo
  states.push(deleteItem(c2.doc, c2.id));
  states.push(c2.doc); // undo
  for (const [i, s] of states.entries()) {
    b = await rebuildTimeline(s, cache, kernel);
    await cache.keepOnly(Object.values(b.bodies).map((x) => x.handle));
    const fresh = new BodyCache(kernel);
    const f = await rebuildTimeline(readDesignDocument(JSON.parse(JSON.stringify(s))), fresh, kernel);
    assert.deepEqual(await summary(b, cache), await summary(f, fresh), `state ${i}`);
    await fresh.clear();
  }
  // Hand check on the last (= c2.doc): Combine 1 left the bar (6,000) and piece 1 joined with box 3 (12,000 + 1,000 = 13,000).
  const s = await summary(b, cache);
  assert.equal((s.bodies["body:feature-1"] as { volume: number }).volume, 6000);
  assert.equal((s.bodies["body:feature-4/piece:1"] as { volume: number }).volume, 13000);
});
