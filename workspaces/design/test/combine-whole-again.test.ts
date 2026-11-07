// Bug hunt D (2026-11-06, Combine naming): a sketch on a piece of a split face, tagged (rule 3), whose piece is gone
// after an upstream edit while one other face still carries the name (a kept tool's own face), is placed on that face
// with no warning, so it jumps to another body and slides with it. Hand-worked; every number from the boxes' corners.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { findInScene, joinBodies, sceneHit, shownBodies, type Scene } from "../src/scene.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { addFaceSketch } from "../src/sketch.ts";

const kernel = nodeKernel();

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The joined index of the face of body `body` facing `n` whose centroid's x is `x`. */
function faceAt(scene: Scene, body: string, n: number[], x: number): number {
  const b = scene.bodies.findIndex((s) => s.body === body);
  const v = scene.bodies[b].view;
  const k = v.face_normals.findIndex((m, i) => m !== null && m.every((c, j) => Math.abs(c - n[j]) < 1e-12) && Math.abs(v.face_centroids[i][0] - x) < 1e-9);
  assert.ok(k >= 0, `${body} has a face facing ${n} at x ${x}`);
  return scene.faceStart[b] + k;
}

test("a tagged sketch on a cut's wall whose wall is gone does not silently move onto the kept tool's own face", async () => {
  // The bar 100 × 20 × 10 (feature-1); the slot's tool 10 × 40 × 20 (feature-2) moved to (30, −10, −5) by feature-3,
  // so x 30..40; Cut with Keep tools on (feature-4). The near piece's wall at x = 30 (y 0..20, z 0..10, facing +x)
  // carries the tool's left (rule 2), as does the kept tool's own left (x = 30, facing −x): the wall is tagged by the
  // bar's faces it borders, "face:feature-2/left#face:feature-1/back,face:feature-1/bottom,face:feature-1/front,face:feature-1/top".
  let doc = partDocument("box", 100, 20, 10);
  const tool = insertPreset(doc, "box", 10, 40, 20);
  doc = insertMove(tool.doc, [`body:${tool.id}`], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  doc = insertCombine(doc, "body:feature-1", [`body:${tool.id}`], "cut", true).doc;
  const before = await sceneOf(doc);
  const spot = sketchSpot({ face: faceAt(before.scene, "body:feature-1", [1, 0, 0], 30), shift: false }, before.scene);
  assert.ok(spot?.kind === "face");
  assert.equal(spot.face.plane, "face:feature-2/left#face:feature-1/back,face:feature-1/bottom,face:feature-1/front,face:feature-1/top");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  await before.cache.close();
  // Drawn on the wall: the frame's origin is the plane x = 30's nearest point to the world's origin, (30, 0, 0).
  const placed = await sceneOf(s.doc);
  const r0 = placed.build.results[s.id];
  assert.ok(r0.status === "built" && r0.plane === undefined && r0.placement!.plane.origin[0] === 30, JSON.stringify(r0));
  await placed.cache.close();
  // The tool's Move edited to x −5: the tool (x −5..5) now cuts the bar's left end off. The bar keeps x 5..100, whose
  // only wall from the tool is at x = 5 (the tool's right); the wall at x = 30 the sketch was on is gone, and the
  // tool's left (x = −5) is on the kept tool alone, a face of another body that the sketch was never on.
  // Expected (the brief: stay, follow, or say it is lost; never jump silently): a plane warning. Today the reference,
  // its tag matching nothing, finds the one face left carrying the name as "whole again" and the sketch slides 35 mm
  // with the kept tool to x = −5, with no warning.
  const edited = changedMove(s.doc, "feature-3", { ...NO_MOVE, x: -5, y: -10, z: -5 });
  const after = await sceneOf(edited);
  const r = after.build.results[s.id];
  assert.ok(r.status === "built");
  const found = findInScene({ kind: "face", id: spot.face.plane as never }, after.scene);
  const on = found.status === "found" ? after.scene.bodies[sceneHit(after.scene, "face", found.index)!.body].body : found.status;
  assert.ok(r.plane !== undefined, `placed with no warning at x ${r.placement?.plane.origin[0]}, its face found on ${on}`);
  await after.cache.close();
});
