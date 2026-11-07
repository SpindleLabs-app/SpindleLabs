// Fresh-eyes review of Extrude's operation (Design data version 10), each
// a test written before its fix: an Edit that changes the operation must
// never leave a file that won't open again, a Combine can pick a piece an
// extrude's Cut left, and the Edit panel keeps an extrude's own bodies on
// its list whether its box reaches them or not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { bodyChoices, type Bounds } from "../src/extrude-operation.ts";
import { extrudeSketch, setExtrudeOperation } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { hideBody } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const reopened = (doc: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(doc)));

/** A 10 mm cube (Body 1) and a square x 2..6, y 2..6 sketched on XY and extruded 20 mm up as a new body (Body 2). */
function cubeAndExtrude(): { doc: DesignDocument; cube: string; id: string } {
  const doc = partDocument("box", 10, 10, 10);
  const cube = `body:${doc.timeline.features[0].id}`;
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  const { doc: made, id } = extrudeSketch(drawn, s.id, 20, false);
  return { doc: made, cube, id };
}

test("a new body made Join by Edit: its shut eye goes with it, and the file opens again", () => {
  const { doc, cube, id } = cubeAndExtrude();
  const hidden = hideBody(doc, `body:${id}`, true);
  assert.deepEqual(hidden.hidden, [`body:${id}`]);
  const joined = setExtrudeOperation(hidden, id, { operation: "join", bodies: [cube] });
  // body:<extrude> is no body any more (it joins the cube), so nothing may hide it: the list goes, being empty.
  assert.equal(joined.hidden, undefined);
  assert.deepEqual(reopened(joined), joined);
  // Another eye shut stays shut: the cube's.
  const both = hideBody(hidden, cube, true);
  const kept = setExtrudeOperation(both, id, { operation: "join", bodies: [cube] });
  assert.deepEqual(kept.hidden, [cube]);
  assert.deepEqual(reopened(kept), kept);
});

test("a new body a later Move moves can't be made Join by Edit: refused naming the Move, nothing changed", () => {
  const { doc, cube, id } = cubeAndExtrude();
  const moved = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x: 30 }).doc;
  // The extrude is Body 2 (the cube Body 1), moved by Move 1.
  assert.throws(() => setExtrudeOperation(moved, id, { operation: "join", bodies: [cube] }), /^Error: Move 1 uses Body 2, which Extrude 1 would no longer make: change or delete Move 1 first$/);
  // A Move of the cube alone is no reason to refuse.
  const cubeMoved = insertMove(doc, [cube], { ...NO_MOVE, x: 30 }).doc;
  assert.doesNotThrow(() => reopened(setExtrudeOperation(cubeMoved, id, { operation: "cut", bodies: [cube] })));
});

/** A bar x 0..100, y 0..20, z 0..10 cut right through by a slot x 30..40: the bar keeps x 0..30, piece 1 of the cut is x 40..100 (Body 2). */
async function slotted(): Promise<{ doc: DesignDocument; bar: string; id: string; piece: string }> {
  const start = partDocument("box", 100, 20, 10);
  const bar = `body:${start.timeline.features[0].id}`;
  const s = addSketch(start);
  const drawn = drawRectangle(s.doc, s.id, [30, -10], [40, 30]).doc;
  const { doc, id } = extrudeSketch(drawn, s.id, 20, false, undefined, { operation: "cut", bodies: [bar] });
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  const piece = `body:${id}/piece:1`;
  assert.deepEqual(Object.keys(build.bodies).sort(), [bar, piece].sort());
  return { doc: numberPieces(doc, Object.keys(build.bodies)), bar, id, piece };
}

test("a Cut made New body by Edit: its pieces' eyes go with them; a later Move of a piece refuses it", async () => {
  const { doc, id, piece } = await slotted();
  const hidden = hideBody(doc, piece, true);
  const back = setExtrudeOperation(hidden, id, null);
  assert.equal(back.hidden, undefined);
  assert.deepEqual(reopened(back), back);
  const moved = insertMove(doc, [piece], { ...NO_MOVE, y: 50 }).doc;
  assert.throws(() => setExtrudeOperation(moved, id, null), /^Error: Move 1 uses Body 2, which Extrude 1 would no longer make: change or delete Move 1 first$/);
  // Cut to Intersect keeps the extrude a maker of pieces: the piece stays a body of the file (the rebuild says if it is gone).
  assert.doesNotThrow(() => reopened(setExtrudeOperation(moved, id, { operation: "intersect", bodies: [`body:${doc.timeline.features[0].id}`] })));
});

test("a Combine can pick a piece an extrude's Cut left, as it can a Combine's piece, and the file opens again", async () => {
  const { doc, bar, piece } = await slotted();
  // A box x 0..100 bridging both (the far piece x 40..100 too), joined with the piece as its tool.
  const { doc: withBox, id: box } = insertPreset(doc, "box", 100, 20, 10);
  const { doc: combined } = insertCombine(withBox, `body:${box}`, [piece], "join");
  assert.deepEqual(reopened(combined), combined);
  // And with the piece as the target.
  assert.doesNotThrow(() => insertCombine(withBox, piece, [bar], "join"));
});

test("hand-worked: the Edit panel's list keeps an extrude's own bodies, reached or not", () => {
  const far: Bounds = [[100, 0, 0], [110, 10, 10]];
  const bodies = [
    { body: "body:feature-1", label: "Body 1", bounds: [[0, 0, 0], [10, 10, 10]] as Bounds },
    { body: "body:feature-4", label: "Body 2", bounds: far },
  ];
  // The extrude x 2..6, y 2..6, z 0..20 reaches Body 1 (x 0..10) only; Body 2 starts at x 100.
  const reach: Bounds = [[2, 2, 0], [6, 6, 20]];
  assert.deepEqual(bodyChoices(reach, bodies, new Set()).map((b) => b.body), ["body:feature-1"]);
  // Body 2 one of its own: listed (and ticked) though its box is 94 mm away, so OK never drops it without the person seeing.
  assert.deepEqual(bodyChoices(reach, bodies, new Set(), new Set(["body:feature-4"])), [
    { body: "body:feature-1", label: "Body 1", ticked: true },
    { body: "body:feature-4", label: "Body 2", ticked: true },
  ]);
});
