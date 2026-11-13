// SL #538 item 5: a copy's face keeps its name whether or not its source
// went through a Cut or Join. A sketch on a plain copy's top holds
// "face:<dup>/top"; a Cut put on the source before the Duplicate turned
// the copy into a copy of a Combine's result, whose faces were named
// "face:<dup>/top:feature-1" (built-body.ts `copiedFaceName`), so the same
// face changed name and the sketch was called lost. Every number is worked
// out by hand from the boxes' corners beside it, on the real rebuild and
// kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { copiedFaceName } from "../src/built-body.ts";
import { changePreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { addFaceSketch, addSketch, drawCircle, drawRectangle } from "../src/sketch.ts";
import { moveMarker, suppressItem } from "../src/timeline-edits.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";

const kernel = nodeKernel();
const r = (x: number) => Math.round(x * 1e6) / 1e6 + 0;

/** The design's bodies' bounds (rounded) and every item's result, from a fresh rebuild. */
async function build(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const bounds: Record<string, number[][]> = {};
    for (const [id, body] of Object.entries(b.bodies)) bounds[id] = (await cache.view(body.handle)).bounds.map((p) => p.map(r));
    return { bounds, results: b.results, names: Object.fromEntries(Object.entries(b.bodies).map(([id, body]) => [id, body.named?.faces.map((f) => f.names) ?? null])) };
  } finally {
    await cache.close();
  }
}

/** A circle r 1.5 at world (28, 8) drawn on the top (z = `z`) of body `body`, picked as the app picks it, extruded 3 up as a new body. */
async function pegOnTop(doc: DesignDocument, body: string, z: number) {
  const cache = new BodyCache(kernel);
  const b = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, b, cache), b);
  const at = scene.bodies.findIndex((s) => s.body === body);
  const v = scene.bodies[at].view;
  const k = v.face_normals.findIndex((q, i) => q !== null && q[2] === 1 && Math.abs(v.face_centroids[i][2] - z) < 1e-9);
  const spot = sketchSpot({ face: scene.faceStart[at] + k, shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face", JSON.stringify(spot));
  const sk = addFaceSketch(doc, spot.face, spot.drawn);
  // The top's sketch frame: its origin is the plane's nearest point to the world's origin (0, 0, z), its axes the world's x and y.
  const c = drawCircle(sk.doc, sk.id, [28, 8], 1.5);
  const peg = extrudeSketch(c.doc, sk.id, 3);
  return { doc: peg.doc, sketch: sk.id, plane: spot.face.plane, peg: `body:${peg.id}` };
}

/** A 4 × 4 hole (x/y 2..6) through Box 1, put in just after Box 1: a sketch on XY, extruded 15 up, cutting body:feature-1. */
function holeInBox1(doc: DesignDocument) {
  let d = moveMarker(doc, "feature-1");
  const sk = addSketch(d);
  d = drawRectangle(sk.doc, sk.id, [2, 2], [6, 6]).doc;
  const cut = extrudeSketch(d, sk.id, 15, false, undefined, { operation: "cut", bodies: ["body:feature-1"] });
  return { doc: moveMarker(cut.doc, null), cut: cut.id };
}

// Box 1 10 × 10 × 10 at 0..10 (feature-1); Copy 1 of it (feature-2) moved x 20 (feature-3): x 20..30.
function boxAndCopy(): DesignDocument {
  const dup = insertDuplicates(partDocument("box", 10, 10, 10), ["body:feature-1"]);
  return insertMove(dup.doc, [`body:${dup.ids[0]}`], { ...NO_MOVE, x: 20 }).doc;
}

test("copiedFaceName: a face of the copy's source's own keeps the name a plain copy gives it; one from another body keeps its feature", () => {
  // Source body:feature-1 made by feature-1, so its own top is the copy's top, as a plain copy names it: "face:feature-9/top".
  assert.equal(copiedFaceName("face:feature-1/top", "feature-9", "feature-1"), "face:feature-9/top");
  // Its own side on curve line-4: a plain copy's "face:feature-9/side:line-4".
  assert.equal(copiedFaceName("face:feature-1/side:line-4", "feature-9", "feature-1"), "face:feature-9/side:line-4");
  // A face from a tool (feature-2) still carries the feature it came from, as before.
  assert.equal(copiedFaceName("face:feature-2/top", "feature-9", "feature-1"), "face:feature-9/top:feature-2");
  // A copy (feature-9) of a copy of a joined body: the first copy's own top is plain, its tool's face carries the feature
  // (feature-2, an item: not a curve) and so is not its own plain face: it keeps the first copy's id too, as before.
  const isItem = (id: string) => id.startsWith("feature-");
  assert.equal(copiedFaceName("face:feature-9/top", "feature-12", "feature-9", isItem), "face:feature-12/top");
  assert.equal(copiedFaceName("face:feature-9/top:feature-2", "feature-12", "feature-9", isItem), "face:feature-12/top:feature-9~feature-2");
});

test("SL #538 item 5: a sketch on a copy's top stays on it when a hole is cut in the copy's source before the Duplicate", async () => {
  const peg = await pegOnTop(boxAndCopy(), "body:feature-2", 10);
  // A plain copy's top is named by the Duplicate (featureNames): the name the sketch holds.
  assert.equal(peg.plane, "face:feature-2/top");
  // The peg: circle centre (28, 8), r 1.5, on z = 10, 3 up: x 26.5..29.5, y 6.5..9.5, z 10..13.
  assert.deepEqual((await build(peg.doc)).bounds[peg.peg], [[26.5, 6.5, 10], [29.5, 9.5, 13]]);
  const { doc } = holeInBox1(peg.doc);
  const cut = await build(doc);
  // The copy still has its top: the 10 × 10 square at z = 10, x 20..30, with the hole's 22..26 × 2..6 clear of the circle's
  // 26.5..29.5 × 6.5..9.5. So the sketch is still on it, no word, and the peg still stands on z = 10.
  const s = cut.results[peg.sketch];
  assert.ok(s.status === "built" && s.plane === undefined, `the sketch's face is kept: ${JSON.stringify(s)}`);
  assert.deepEqual(cut.bounds[peg.peg], [[26.5, 6.5, 10], [29.5, 9.5, 13]]);
  // Box 1 made 20 tall: the copy's top is at z = 20, so the peg stands on it at z 20..23.
  const taller = await build(changePreset(doc, "feature-1", "box", 10, 10, 20));
  const t = taller.results[peg.sketch];
  assert.ok(t.status === "built" && t.plane === undefined, JSON.stringify(t));
  assert.deepEqual(taller.bounds[peg.peg], [[26.5, 6.5, 20], [29.5, 9.5, 23]]);
});

test("the other way round: a sketch on the top of a copy of a cut box stays on it when the Cut is suppressed", async () => {
  const { doc: cutDoc, cut } = holeInBox1(boxAndCopy());
  const peg = await pegOnTop(cutDoc, "body:feature-2", 10);
  // The same face's name as a plain copy's top, though the copy is of a Combine's result now.
  assert.equal(peg.plane, "face:feature-2/top");
  const off = await build(suppressItem(peg.doc, cut, true));
  const s = off.results[peg.sketch];
  assert.ok(s.status === "built" && s.plane === undefined, `the sketch's face is kept: ${JSON.stringify(s)}`);
  // Box 1 whole again, the copy x 20..30 with its top at z = 10: the peg z 10..13, x 26.5..29.5, y 6.5..9.5.
  assert.deepEqual(off.bounds[peg.peg], [[26.5, 6.5, 10], [29.5, 9.5, 13]]);
});

test("control: with no hole the sketch on the copy's top follows Box 1's height, z 20..23 (passes before and after the fix)", async () => {
  const peg = await pegOnTop(boxAndCopy(), "body:feature-2", 10);
  const taller = await build(changePreset(peg.doc, "feature-1", "box", 10, 10, 20));
  assert.deepEqual(taller.bounds[peg.peg], [[26.5, 6.5, 20], [29.5, 9.5, 23]]);
});

test("a name saved before (\"face:<dup>/top:feature-1\" on a copy of a cut box) still finds its face", async () => {
  const { doc } = holeInBox1(boxAndCopy());
  const b = await build(doc);
  const top = b.names["body:feature-2"]!.find((n) => n.includes("face:feature-2/top"));
  // The copy's top answers to the plain copy's name first (what a pick holds now) and still to the name it was saved by before.
  assert.deepEqual(top, ["face:feature-2/top", "face:feature-2/top:feature-1"]);
});
