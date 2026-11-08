// A Duplicate of a piece (found by the Combine bug hunt, 2026-11-08, each a test before its fix): a copy of a piece a
// Combine left must not stop the file opening once the Combine is deleted (a Move's or a Combine's pick of such a piece
// never did), and an Edit that would stop an Extrude Cut making the piece a later Duplicate copies is refused, as one a
// later Move or Combine uses is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { extrudeSketch, setExtrudeOperation } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { deleteItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const reopened = (doc: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(doc)));

/** `doc` rebuilt, its pieces numbered as the app does. */
async function numbered(doc: DesignDocument): Promise<DesignDocument> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  return numberPieces(doc, Object.keys(build.bodies));
}

test("a copy of a Combine's piece, then the Combine deleted: the file opens again, and the copy fails naming what was deleted", async () => {
  // A bar 30 × 10 × 10 (feature-1) cut through by a slab 10 × 20 × 20 moved to x 10..20 (feature-2, feature-3): Combine 1
  // (feature-4) leaves the bar's x 0..10 and piece 1, x 20..30; Copy 1 (feature-5) copies piece 1.
  let doc = partDocument("box", 30, 10, 10);
  doc = insertPreset(doc, "box", 10, 20, 20).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 10, y: -5, z: -5 }).doc;
  doc = await numbered(insertCombine(doc, "body:feature-1", ["body:feature-2"], "cut").doc);
  const copied = insertDuplicates(doc, ["body:feature-4/piece:1"]);
  assert.deepEqual(reopened(copied.doc), copied.doc);
  const gone = deleteItem(copied.doc, "feature-4");
  assert.deepEqual(reopened(gone), gone);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(gone, cache, kernel);
  await cache.close();
  assert.equal(build.results[copied.ids[0]].status, "failed");
});

test("an Extrude Cut whose piece a later Duplicate copies can't be made New body by Edit: refused naming the copy, nothing changed", async () => {
  // A bar x 0..100, y 0..20, z 0..10 cut through by a slot x 30..40: piece 1 is x 40..100 (Body 2), copied by Copy 1.
  const start = partDocument("box", 100, 20, 10);
  const bar = `body:${start.timeline.features[0].id}`;
  const s = addSketch(start);
  const drawn = drawRectangle(s.doc, s.id, [30, -10], [40, 30]).doc;
  const { doc: cut, id } = extrudeSketch(drawn, s.id, 20, false, undefined, { operation: "cut", bodies: [bar] });
  const doc = insertDuplicates(await numbered(cut), [`body:${id}/piece:1`]).doc;
  assert.throws(() => setExtrudeOperation(doc, id, null), /^Error: Copy 1 uses Body 2, which Extrude 1 would no longer make: change or delete Copy 1 first$/);
  // Without the copy, the same Edit is allowed and the file opens.
  const plain = await numbered(cut);
  assert.doesNotThrow(() => reopened(setExtrudeOperation(plain, id, null)));
});
