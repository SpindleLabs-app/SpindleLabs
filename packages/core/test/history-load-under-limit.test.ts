// Kills a mutant the nightly TypeScript mutation run of 2026-11-11 found surviving in history.ts load (SpindleLabs
// #421): the cut to the limit, `if (entries.length > limit + 1)`, with `limit - 1` in its test. A load already within
// the limit must keep exactly what it was given; the mutant set the length to limit + 1 there, adding an empty step a
// redo away. (`>=` there is no change: at limit + 1 entries it sets the length it has; explained.json.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../src/model/history.ts";

test("a load within the limit, the present first, keeps exactly the steps it was given and redoes no further", () => {
  let doc = "s0";
  const h = createHistory({ capture: () => doc, restore: (s) => (doc = s), limit: 3 });
  const kept = (n: number) => Array.from({ length: n }, (_, i) => ({ snapshot: `s${i}`, label: `Step ${i}`, mergeKey: undefined, at: i }));
  // Worked by hand: limit 3 keeps up to 4 entries. Three given, present s0 at index 0: nothing is dropped, so the
  // steps are s0 (current), s1 and s2 (a redo away), and two redos reach s2, the last.
  assert.equal(h.load({ kept: kept(3), index: 0 }), true);
  assert.deepEqual(h.steps().map((s) => [s.label, s.state]), [["Step 0", "current"], ["Step 1", "undone"], ["Step 2", "undone"]]);
  h.redo();
  h.redo();
  assert.equal(doc, "s2");
  assert.equal(h.canRedo(), false);
});
