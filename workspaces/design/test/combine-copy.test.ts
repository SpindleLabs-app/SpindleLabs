// Step 35f1f2c: Duplicate and Mirror body of a Combine's result. The copy is
// the same kernel body (a mirror: the kernel's body_move across the plane),
// its faces the Duplicate's, each keeping its role with the feature it came
// from as its id (built-body.ts `copiedFaceName`). Every number is worked
// out by hand from the cubes' corners beside it, on the real rebuild and
// kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { XY_PLANE } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { copiedFaceName } from "../src/built-body.ts";
import { insertCombine } from "../src/combine.ts";
import { DESIGN_EDGE } from "../src/design-edges.ts";
import { insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { sketchEdgeTargets } from "../src/face-edges.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { addFaceSketch, addSketch, drawCircle, pinNewPoints } from "../src/sketch.ts";

const kernel = nodeKernel();

// Cube A x/y/z 0..10 (feature-1); cube B the same (feature-2) moved (5, 5, 5) (feature-3); B joined to A (feature-4):
// body:feature-1, x/y/z 0..15, 1000 + 1000 − 125 = 1875 mm³.
function joined(): DesignDocument {
  let doc = partDocument("box", 10, 10, 10);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 5, y: 5, z: 5 }).doc;
  return insertCombine(doc, "body:feature-1", ["body:feature-2"], "join").doc;
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; scene: Scene }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  return { build, cache, scene };
}
const rounded = (v: readonly number[]) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0);
const bAt = (doc: DesignDocument, d: number) => changedMove(doc, "feature-3", { ...NO_MOVE, x: d, y: d, z: d });

/** Body `id`'s bounds, volume and the centroid of the face carrying `name`, with every face's names. */
async function copyOf(doc: DesignDocument, id: string, name: string) {
  const { build, cache } = await built(doc);
  const b = build.bodies[id];
  assert.ok(b, `${id} built: ${JSON.stringify(Object.keys(build.bodies))}`);
  const view = await cache.view(b.handle);
  const k = b.named!.faces.findIndex((f) => f.names.includes(name));
  const out = { bounds: view.bounds.map(rounded), volume: Math.round(view.volume * 1e9) / 1e9, face: k < 0 ? null : rounded(view.face_centroids[k]), normal: k < 0 ? null : rounded(view.face_normals[k]!), names: b.named!.faces.flatMap((f) => f.names), results: build.results };
  await cache.close();
  return out;
}

test("copiedFaceName: each face keeps its role with the feature it came from, and no two inputs' faces read the same", () => {
  assert.equal(copiedFaceName("face:feature-1/top", "feature-9"), "face:feature-9/top:feature-1");
  assert.equal(copiedFaceName("face:feature-2/side:line-4", "feature-9"), "face:feature-9/side:feature-2~line-4");
  // A copy of a copy: the first copy's id, with its source's, so still one name each.
  assert.equal(copiedFaceName("face:feature-9/top:feature-1", "feature-12"), "face:feature-12/top:feature-9~feature-1");
  assert.notEqual(copiedFaceName("face:feature-1/top", "feature-9"), copiedFaceName("face:feature-2/top", "feature-9"));
  assert.throws(() => copiedFaceName("edge:feature-1/top+left", "feature-9"), /not a face name Design makes/);
});

test("hand-worked: a Duplicate of a Combine's result is the same 1,875 mm³ in the same place, every face named by the Duplicate", async () => {
  const { doc, ids } = insertDuplicates(joined(), ["body:feature-1"]);
  const [dup] = ids;
  const c = await copyOf(doc, `body:${dup}`, `face:${dup}/top:feature-2`);
  assert.equal(c.results[dup].status, "built", JSON.stringify(c.results[dup]));
  assert.deepEqual(c.bounds, [[0, 0, 0], [15, 15, 15]]);
  assert.equal(c.volume, 1875);
  // B's top is the square x/y 5..15 at z 15: centroid (10, 10, 15), facing up.
  assert.deepEqual(c.face, [10, 10, 15]);
  assert.deepEqual(c.normal, [0, 0, 1]);
  assert.ok(c.names.every((n) => n.startsWith(`face:${dup}/`)), JSON.stringify(c.names));
  assert.equal(new Set(c.names).size, c.names.length, "no two faces share a name");
  // Its source is still there, unchanged and its own.
  const s = await copyOf(doc, "body:feature-1", "face:feature-2/top");
  assert.deepEqual(s.face, [10, 10, 15]);
  // It follows its source: B moved to (8, 8, 8) makes B's top x/y 8..18 at z 18 on the copy too.
  const after = await copyOf(bAt(doc, 8), `body:${dup}`, `face:${dup}/top:feature-2`);
  assert.deepEqual(after.face, [13, 13, 18]);
});

test("hand-worked: Mirror body of a Combine's result across YZ: x 0..15 becomes −15..0, each face where its mirror image is", async () => {
  const { doc, ids } = insertDuplicates(joined(), ["body:feature-1"], "YZ");
  const [dup] = ids;
  const c = await copyOf(doc, `body:${dup}`, `face:${dup}/right:feature-2`);
  assert.equal(c.results[dup].status, "built", JSON.stringify(c.results[dup]));
  assert.deepEqual(c.bounds, [[-15, 0, 0], [0, 15, 15]]);
  assert.equal(c.volume, 1875);
  // B's right face is x = 15, y/z 5..15: centroid (15, 10, 10) facing +x; mirrored in x = 0 it is (−15, 10, 10) facing −x.
  assert.deepEqual(c.face, [-15, 10, 10]);
  assert.deepEqual(c.normal, [-1, 0, 0]);
  // A's left face (x = 0, y/z 0..10 whole) stays at x = 0 and now faces +x.
  const left = await copyOf(doc, `body:${dup}`, `face:${dup}/left:feature-1`);
  assert.deepEqual(left.face, [0, 5, 5]);
  assert.deepEqual(left.normal, [1, 0, 0]);
});

test("hand-worked: a sketch on the copy's face, and a pin on its corner, follow B through its Move", async () => {
  const { doc, ids } = insertDuplicates(joined(), ["body:feature-1"], "YZ");
  const [dup] = ids;
  const { scene, cache } = await built(doc);
  const b = scene.bodies.findIndex((s) => s.body === `body:${dup}`);
  const v = scene.bodies[b].view;
  // The mirrored B top: centroid (−10, 10, 15), facing up.
  const k = v.face_normals.findIndex((q, i) => q !== null && q[2] === 1 && Math.abs(v.face_centroids[i][2] - 15) < 1e-9);
  const spot = sketchSpot({ face: scene.faceStart[b] + k, shift: false }, scene);
  assert.ok(spot?.kind === "face", JSON.stringify(spot));
  assert.equal(spot.face.plane, `face:${dup}/top:feature-2`);
  const sk = addFaceSketch(doc, spot.face, spot.drawn);
  // And a sketch on XY after it pinned to the mirrored B's far corner: B's (15, 15, 15) mirrored, (−15, 15) from above.
  const xy = addSketch(sk.doc);
  const corner = sketchEdgeTargets(xy.doc, xy.id, scene, XY_PLANE).find((t) => t.kind === "endpoint" && t.feature === dup && t.at[0] === -15 && t.at[1] === 15 && t.name.includes(encodeURIComponent("feature-2")));
  await cache.close();
  assert.ok(corner, "the mirrored corner offered, named by the Duplicate");
  assert.ok(corner.name.split("&").every((p) => p.startsWith(DESIGN_EDGE)));
  let next = pinNewPoints(xy.doc, drawCircle(xy.doc, xy.id, corner.at, 2).doc, xy.id, [corner]);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(next))), next);
  // B moved to (8, 8, 8): its top is z 18, and its far corner (18, 18, 18) mirrored is (−18, 18) from above.
  next = bAt(next, 8);
  const after = await built(next);
  const s = after.build.results[sk.id];
  assert.ok(s.status === "built" && s.plane === undefined, JSON.stringify(s));
  // The sketch was drawn with its origin at (0, 0, 15), the top's plane's nearest point to the world's origin (26e), and moves
  // as the mirrored B moved: B went (+3, +3, +3), its mirror image across x = 0 (−3, +3, +3), so the origin is (−3, 3, 18).
  assert.deepEqual(rounded(s.placement!.plane.origin), [-3, 3, 18]);
  const p = after.build.results[xy.id];
  assert.ok(p.status === "built" && p.points === undefined, JSON.stringify(p));
  assert.deepEqual(p.pinned?.map((q) => rounded(q.at)), [[-18, 18]]);
  await after.cache.close();
});

test("a copy of a Combine's result can be combined again: the copy joined to its source over the YZ plane is one body of twice the volume", async () => {
  const { doc, ids } = insertDuplicates(joined(), ["body:feature-1"], "YZ");
  const both = insertCombine(doc, "body:feature-1", [`body:${ids[0]}`], "join");
  const c = await copyOf(both.doc, "body:feature-1", "face:feature-2/top");
  assert.equal(c.results[both.id].status, "built", JSON.stringify(c.results[both.id]));
  // The two touch along x = 0 (A's left and its mirror, the 10 × 10 square): joined, x −15..15, 2 · 1875 = 3750 mm³.
  assert.deepEqual(c.bounds, [[-15, 0, 0], [15, 15, 15]]);
  assert.equal(c.volume, 3750);
});
