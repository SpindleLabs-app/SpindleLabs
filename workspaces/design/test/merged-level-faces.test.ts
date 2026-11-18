// SL #502: a sketch on a face that two joined blocks share (their tops level,
// merged into one face by the kernel, 36c1). Part 2: the merged face answers
// to both blocks' names (docs/document-model.md section 8), so a sketch on
// one block's top is found again on the merged top when the tops become
// level. Part 1: a sketch drawn on the merged top names the block under the
// click, so it follows that block when the tops part again, never the other
// one silently. Built by the real rebuild on the real kernel; every number
// from the boxes' corners.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { SAME_CORNER } from "../src/boolean-names.ts";
import { addFaceSketch } from "../src/sketch.ts";

const kernel = nodeKernel();

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The joined index of the face facing +z at height `z` whose centroid's x is `x` (on any shown body). */
function topAt(scene: Scene, z: number, x: number): number {
  for (let b = 0; b < scene.bodies.length; b++) {
    const v = scene.bodies[b].view;
    const k = v.face_normals.findIndex((m, i) => m !== null && Math.abs(m[2] - 1) < 1e-12 && Math.abs(v.face_centroids[i][2] - z) < 1e-9 && Math.abs(v.face_centroids[i][0] - x) < 1e-9);
    if (k >= 0) return scene.faceStart[b] + k;
  }
  assert.fail(`no top at z ${z} with its middle at x ${x}`);
}

/** Box 1 80 × 60 × `h1` at the origin, Box 2 80 × 60 × `h2` moved (80, 0, 0), joined: Box 1 is feature-1, Box 2 feature-2. */
function blocks(h1: number, h2: number): DesignDocument {
  const doc = partDocument("box", 80, 60, h1);
  const two = insertPreset(doc, "box", 80, 60, h2);
  const moved = insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, x: 80 }).doc;
  return insertCombine(moved, "body:feature-1", [`body:${two.id}`], "join", false).doc;
}

/** Sketch `id`'s placement after a rebuild: its plane's height and whether it warns. */
async function placed(doc: DesignDocument, id: string) {
  const { build, cache } = await sceneOf(doc);
  await cache.close();
  const r = build.results[id];
  assert.ok(r.status === "built", JSON.stringify(r));
  return { z: r.placement!.plane.origin[2], warning: r.plane?.message ?? null };
}

test("part 2: a sketch on Box 2's top is found on the merged top when the tops become level", async () => {
  // Box 2 50 tall: its top is z = 50 over x 80..160 (middle x 120), apart from Box 1's top at z = 40 (middle x 40).
  const doc = blocks(40, 50);
  const before = await sceneOf(doc);
  const spot = sketchSpot({ face: topAt(before.scene, 50, 120), shift: false }, before.scene);
  await before.cache.close();
  assert.ok(spot?.kind === "face");
  assert.equal(spot.face.plane, "face:feature-2/top");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  assert.deepEqual(await placed(s.doc, s.id), { z: 50, warning: null });
  // Box 2 made 40 tall: both tops at z = 40, one face x 0..160 that answers to both names, so the sketch is on it at
  // z = 40 with no warning (before: "Sketch 1's face is gone", held at z = 50).
  const level = changePreset(s.doc, "feature-2", "box", 80, 60, 40);
  assert.deepEqual(await placed(level, s.id), { z: 40, warning: null });
});

test("part 1: a sketch drawn on the merged top names the block under the click, and follows that block", async () => {
  // Both 40 tall: one top x 0..160 at z = 40 (middle x 80). Clicked at (150, 50, 40), over Box 2 (x 80..160).
  const doc = blocks(40, 40);
  const before = await sceneOf(doc);
  const top = topAt(before.scene, 40, 80);
  const overTwo = sketchSpot({ face: top, shift: false, point: [150, 50, 40] }, before.scene);
  const overOne = sketchSpot({ face: top, shift: false, point: [20, 10, 40] }, before.scene);
  await before.cache.close();
  assert.ok(overTwo?.kind === "face" && overOne?.kind === "face");
  assert.equal(overTwo.face.plane, "face:feature-2/top");
  assert.equal(overOne.face.plane, "face:feature-1/top");
  // Box 2 made 50 tall: the sketch drawn over it rises with it to z = 50; the one over Box 1 stays at 40.
  const two = addFaceSketch(doc, overTwo.face, overTwo.drawn);
  const one = addFaceSketch(two.doc, overOne.face, overOne.drawn);
  const taller = changePreset(one.doc, "feature-2", "box", 80, 60, 50);
  assert.deepEqual(await placed(taller, two.id), { z: 50, warning: null });
  assert.deepEqual(await placed(taller, one.id), { z: 40, warning: null });
  // Box 1 made 30 tall instead: the sketch over Box 2 stays at 40 (Box 2 unchanged); the one over Box 1 drops to 30.
  const lower = changePreset(one.doc, "feature-1", "box", 80, 60, 30);
  assert.deepEqual(await placed(lower, two.id), { z: 40, warning: null });
  assert.deepEqual(await placed(lower, one.id), { z: 30, warning: null });
});

test("part 1: with no click point (an older caller), the merged top still takes its first name, as before", async () => {
  const doc = blocks(40, 40);
  const before = await sceneOf(doc);
  const spot = sketchSpot({ face: topAt(before.scene, 40, 80), shift: false }, before.scene);
  await before.cache.close();
  assert.ok(spot?.kind === "face");
  assert.equal(spot.face.plane, "face:feature-1/top");
});

test("part 1: on a joined result moved since, the click is taken back through the Move first", async () => {
  // The joined blocks (both 40 tall) moved (0, 0, 10) by Move 2: the top is at z = 50. A click at (150, 50, 50) is
  // (150, 50, 40) as the Join saw it, over Box 2; one at (20, 10, 50) over Box 1. Without the Move taken off neither
  // point lies on an input top (z = 40), so both would fall back to Box 1's name.
  const doc = insertMove(blocks(40, 40), ["body:feature-1"], { ...NO_MOVE, z: 10 }).doc;
  const before = await sceneOf(doc);
  const top = topAt(before.scene, 50, 80);
  const overTwo = sketchSpot({ face: top, shift: false, point: [150, 50, 50] }, before.scene);
  const overOne = sketchSpot({ face: top, shift: false, point: [20, 10, 50] }, before.scene);
  await before.cache.close();
  assert.ok(overTwo?.kind === "face" && overOne?.kind === "face");
  assert.equal(overTwo.face.plane, "face:feature-2/top");
  assert.equal(overOne.face.plane, "face:feature-1/top");
});

test("part 1: a click on the seam goes to Box 1 (the first face it lies on) within SAME_CORNER of its edge, else to Box 2", async () => {
  // Box 1's top ends at x = 80. A point 0.9 × SAME_CORNER past it is still on Box 1's top (faceHolds' reach), so the
  // first origin, Box 1's, takes it; 1.1 × past it is on Box 2's alone.
  const doc = blocks(40, 40);
  const before = await sceneOf(doc);
  const top = topAt(before.scene, 40, 80);
  const at = (k: number) => sketchSpot({ face: top, shift: false, point: [80 + k * SAME_CORNER, 30, 40] }, before.scene);
  const [inside, outside] = [at(0.9), at(1.1)];
  await before.cache.close();
  assert.ok(inside?.kind === "face" && outside?.kind === "face");
  assert.equal(inside.face.plane, "face:feature-1/top");
  assert.equal(outside.face.plane, "face:feature-2/top");
});
