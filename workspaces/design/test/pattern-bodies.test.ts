// Step 61c's regression: a Pattern's copies are bodies of the design. The
// browser's Bodies rows, the STL and Slice for printing take the bodies from
// browser.ts `designBodies`, which listed no Pattern's pieces (61b), so a
// row of 3 cubes drew three cubes and exported one (the e2e check's 1,000
// mm³ for 3,000). Worked by hand from the 10 mm cube and the spacing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertPattern, type PatternValues } from "../src/pattern.ts";
import { numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { bodyRows, designBodies, failedIds } from "../src/browser.ts";
import { suppressItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const row = (over: Partial<PatternValues & { kind: "linear" }> = {}): PatternValues => ({ kind: "linear", direction: "X", spacing: 15, count: 3, join: false, ...over }) as PatternValues;
const CUBE = "body:feature-1";

/** The design after its build, its pieces numbered as an OK records them, with the bodies `designBodies` lists. */
async function listed(doc0: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies));
  const failed = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
  const bodies = designBodies(doc, failed).map((b) => b.body);
  const rows = bodyRows(doc, failed).map((r) => r.label);
  await cache.close();
  return { bodies, rows, build };
}

test("a row of 3 cubes 15 apart: the cube and both copies are bodies (Body 1, 2 and 3), so the STL holds 3,000 mm³", async () => {
  const { doc, id } = insertPattern(partDocument("box", 10, 10, 10), [CUBE], row());
  const { bodies, rows } = await listed(doc);
  // Counts include the original: the cube and 2 copies, numbered after it.
  assert.deepEqual(bodies, [CUBE, `body:${id}/piece:1`, `body:${id}/piece:2`]);
  assert.deepEqual(rows, ["Body 1", "Body 2", "Body 3"]);
});

test("Join of 3 cubes 5 apart (touching): one block, the cube's id, no copy left as a body", async () => {
  const { doc } = insertPattern(partDocument("box", 10, 10, 10), [CUBE], row({ spacing: 5, join: true }));
  const { bodies } = await listed(doc);
  // 5 apart with 10 wide: each copy overlaps the one before by 5, so all three join into x 0..20 under the cube's id.
  assert.deepEqual(bodies, [CUBE]);
});

test("Join of 3 cubes 15 apart (a 5 mm gap each): nothing joins, so the copies stay bodies of their own", async () => {
  const { doc, id } = insertPattern(partDocument("box", 10, 10, 10), [CUBE], row({ join: true }));
  const { bodies, build } = await listed(doc);
  const made = build.results[id];
  assert.equal(made.status, "built");
  // The listed bodies are exactly the ones the build holds of the cube and the Pattern.
  assert.deepEqual([...bodies].sort(), [CUBE, ...(made.status === "built" ? (made.bodies ?? []) : [])].filter((b, k, all) => all.indexOf(b) === k).sort());
  assert.equal(bodies.length, 3);
});

test("controls: a suppressed Pattern lists the cube alone, and so does one the rebuild failed", async () => {
  const { doc, id } = insertPattern(partDocument("box", 10, 10, 10), [CUBE], row());
  assert.deepEqual((await listed(suppressItem(doc, id, true))).bodies, [CUBE]);
  assert.deepEqual(designBodies(doc, new Set([id])).map((b) => b.body), [CUBE]);
});
