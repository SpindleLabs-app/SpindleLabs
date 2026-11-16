// A sketch on a Chamfer's own face (Ben, 2026-11-16: Create sketch on a
// chamfered body's slanted face said "there is no solid item feature-19 to
// sketch on"). A Chamfer makes no body of its own, but its new faces are
// named after it (`face:<the Chamfer>/chamfer:<k>`, rebuild.ts
// `chamferRun`), so the face a click names belongs to the Chamfer. The
// sketch on it is placed by the rebuild like any face sketch, follows the
// face when the Chamfer's size is edited, is greyed while the Chamfer is
// suppressed, holds its plane when the Chamfer goes, and opens again from
// the file. Every refusal in `addFaceSketch` names items, never ids.
//
// The model the seeded sessions check against: a box [0, W] × [0, D] × [0, H]
// and an edge where faces with outward normals n1 and n2 (axis-aligned, at
// right angles) meet, through point P. An equal chamfer of d cuts the edge
// back d along each face, so its face passes through P − d·n1 and P − d·n2;
// its outward normal is (n1 + n2)/√2 and a point X lies on it exactly when
// (X − P)·(n1 + n2) + d = 0.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertChamfer, changedChamfer } from "../src/chamfer.ts";
import { partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { insertCombine } from "../src/combine.ts";
import { deleteItem, hideBody, suppressItem } from "../src/timeline-edits.ts";
import { faceHeld } from "../src/face-edges.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { sketchSpot, sketchableFaces } from "../src/face-pick.ts";
import { addFaceSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";
import { worldFrame } from "../src/face-sketch.ts";

const kernel = nodeKernel();
type V3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The held name of the one straight edge of `body` whose ends both satisfy `on`, as the screen names it. */
async function edgeWhere(doc: DesignDocument, body: string, on: (p: readonly number[]) => boolean): Promise<string> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const at = ids.indexOf(body);
  const view = list[at].view;
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a]) && on(view.vertex_points[b]) ? [e] : []));
  assert.equal(edges.length, 1, "one edge there");
  const held = heldEdgeNames(designNames(list), at)[edges[0]];
  await cache.close();
  assert.ok(held !== null, "the edge has a name");
  return held!;
}

/** The joined index of the shown face whose outward normal is `n` (to 1e-9). */
function faceFacing(scene: Scene, n: readonly number[]): number {
  for (let b = 0; b < scene.bodies.length; b++) {
    const v = scene.bodies[b].view;
    const k = v.face_normals.findIndex((m) => m !== null && Math.abs(dot(m, n) - 1) < 1e-9);
    if (k >= 0) return scene.faceStart[b] + k;
  }
  assert.fail(`no face facing ${n}`);
}

const S = Math.SQRT1_2;

/** The 10 mm cube with a 2 mm chamfer on its top front edge (y = 0, z = 10). */
async function chamferedCube(d = 2) {
  const doc = partDocument("box", 10, 10, 10);
  const edge = await edgeWhere(doc, "body:feature-1", (p) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9);
  return insertChamfer(doc, "body:feature-1", [edge], { equal: d });
}

/** Sketch `id`'s placement after a rebuild of `doc`. */
async function placed(doc: DesignDocument, id: string) {
  const { build, cache } = await sceneOf(doc);
  await cache.close();
  return build.results[id];
}

test("regression (Ben 2026-11-16): Create sketch on a chamfer's slanted face makes a sketch on it, placed in that face's plane", async () => {
  const { doc, id: chamfer } = await chamferedCube();
  const { scene, cache } = await sceneOf(doc);
  // The chamfer's face: through (x, 2, 10) and (x, 0, 8), so its outward normal is (0, −1, 1)/√2.
  const spot = sketchSpot({ face: faceFacing(scene, [0, -S, S]), shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face", JSON.stringify(spot));
  assert.equal(spot.face.plane, `face:${chamfer}/chamfer:1`);
  assert.equal(spot.face.feature, chamfer);
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  const r = await placed(s.doc, s.id);
  assert.ok(r.status === "built", JSON.stringify(r));
  assert.equal(r.plane, undefined, "no warning");
  const { plane: { origin, normal }, side } = r.placement!;
  // Facing out of the body (its normal times its side), (0, −1, 1)/√2; on the face: (origin − (0, 0, 8))·(0, −1, 1) = 0, i.e. z − y = 8.
  assert.ok(Math.abs(side * dot(normal, [0, -S, S]) - 1) < 1e-12, `normal ${normal}, side ${side}`);
  assert.ok(Math.abs(origin[2] - origin[1] - 8) < 1e-9, `origin ${origin}`);
});

test("hand-worked: a 4 × 1 mm rectangle on the chamfer's face extruded 1 mm out is a new body of 4 mm³ standing on that face", async () => {
  const { doc } = await chamferedCube();
  const { scene, cache } = await sceneOf(doc);
  const spot = sketchSpot({ face: faceFacing(scene, [0, -S, S]), shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [4, 1]).doc;
  const e = extrudeSketch(drawn, s.id, 1);
  const built = await sceneOf(e.doc);
  const r = built.build.results[e.id];
  assert.ok(r.status === "built", JSON.stringify(r));
  const v = await built.cache.view(built.build.bodies[`body:${e.id}`].handle);
  await built.cache.close();
  // 4 × 1 × 1 = 4 mm³.
  assert.ok(Math.abs(v.volume - 4) < 1e-9, `volume ${v.volume}`);
  // Every corner is on the face's plane (z − y = 8) or 1 mm out along its normal: (z − y − 8)/√2 is 0 or 1.
  for (const p of v.vertex_points) {
    const h = (p[2] - p[1] - 8) * S;
    assert.ok(Math.abs(h) < 1e-9 || Math.abs(h - 1) < 1e-9, `corner ${p} is ${h} mm off the face`);
  }
});

test("the sketch follows the chamfer's face when the Chamfer is made 3 mm, greys while it is suppressed, holds when it is deleted, and opens again", async () => {
  const { doc, id: chamfer } = await chamferedCube();
  const { scene, cache } = await sceneOf(doc);
  const spot = sketchSpot({ face: faceFacing(scene, [0, -S, S]), shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  // 3 mm: the face now through (x, 3, 10) and (x, 0, 7), so z − y = 7.
  const bigger = await placed(changedChamfer(s.doc, chamfer, { equal: 3 }, false), s.id);
  assert.ok(bigger.status === "built" && bigger.plane === undefined, JSON.stringify(bigger));
  const o = bigger.placement!.plane.origin;
  assert.ok(Math.abs(o[2] - o[1] - 7) < 1e-9, `origin ${o}`);
  // Suppressed: greyed by the Chamfer (Q3), never failed.
  assert.deepEqual(await placed(suppressItem(s.doc, chamfer, true), s.id), { status: "greyed", by: chamfer });
  // Deleted: held where it was, with the plane-lost warning naming the sketch.
  const gone = await placed(deleteItem(s.doc, chamfer), s.id);
  assert.ok(gone.status === "built" && gone.plane?.cause === "plane-lost", JSON.stringify(gone));
  // The file opens again (the reader refused a face sketch on a Chamfer's face) and places the same.
  const again = readDesignDocument(JSON.parse(JSON.stringify(s.doc)));
  assert.deepEqual(again, s.doc);
});

test("every face of a chamfered body, then moved, can take a sketch: the chamfer's face, the box's own faces and the other box's", async () => {
  const { doc: d0 } = await chamferedCube();
  const moved = insertMove(d0, ["body:feature-1"], { ...NO_MOVE, x: 3 }).doc;
  const { scene, cache } = await sceneOf(moved);
  const all = sketchableFaces(scene);
  await cache.close();
  // The cube's six faces trimmed by the cut, and the cut's face: 7, all flat and named.
  assert.equal(all.length, 7);
  for (const face of all) {
    const spot = sketchSpot({ face, shift: false }, scene);
    assert.ok(spot?.kind === "face");
    const s = addFaceSketch(moved, spot.face, spot.drawn);
    const r = await placed(s.doc, s.id);
    assert.ok(r.status === "built" && r.plane === undefined, `${spot.face.plane}: ${JSON.stringify(r)}`);
  }
});

test("a chamfer's face after a Combine: still sketchable, and the sketch is placed on it", async () => {
  const { doc: d0 } = await chamferedCube();
  const { insertPreset } = await import("../src/document.ts");
  const two = insertPreset(d0, "box", 10, 10, 10);
  const away = insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, x: 10 }).doc;
  const joined = insertCombine(away, "body:feature-1", [`body:${two.id}`], "join", false).doc;
  const { scene, cache } = await sceneOf(joined);
  const spot = sketchSpot({ face: faceFacing(scene, [0, -S, S]), shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face", JSON.stringify(spot));
  const s = addFaceSketch(joined, spot.face, spot.drawn);
  const r = await placed(s.doc, s.id);
  assert.ok(r.status === "built" && r.plane === undefined, JSON.stringify(r));
  const o = r.placement!.plane.origin;
  assert.ok(Math.abs(o[2] - o[1] - 8) < 1e-9, `origin ${o}`);
});

test("refusals name items in plain words, never an id", async () => {
  const { doc, id: chamfer } = await chamferedCube();
  const drawn = { plane: worldFrame(), side: 1 as const };
  const moved = insertMove(doc, ["body:feature-1"], NO_MOVE);
  const words = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as Error).message;
    }
    assert.fail("not refused");
  };
  // A Move has no face of its own (its body keeps its faces' names): said by its name.
  const onMove = words(() => addFaceSketch(moved.doc, { plane: `face:${moved.id}/top`, feature: moved.id }, drawn));
  assert.equal(onMove, "Move 1 has no faces of its own to sketch on: pick a face of a body, or a plane.");
  // An item no longer in the design.
  const gone = words(() => addFaceSketch(doc, { plane: "face:feature-99/top", feature: "feature-99" }, drawn));
  assert.equal(gone, "The face picked belongs to an item that is no longer in the design: pick another face or a plane.");
  // A face's name and its item disagreeing.
  const mixed = words(() => addFaceSketch(doc, { plane: "face:feature-1/top", feature: chamfer }, drawn));
  assert.equal(mixed, "That face's name doesn't match the item it is on, so a sketch on it could not follow it: pick another face or a plane.");
  for (const w of [onMove, gone, mixed]) assert.doesNotMatch(w, /feature-\d|sketch-\d|face:/);
});

test("a sketch on a chamfer's face with the chamfered body hidden by its eye is not taken for held (face hunt 11-01's rule)", async () => {
  const { doc } = await chamferedCube();
  const { scene, cache } = await sceneOf(doc);
  const spot = sketchSpot({ face: faceFacing(scene, [0, -S, S]), shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  // Shown: found on the body, not held. Hidden: left out of the scene but still built, so still not held.
  const shown = await sceneOf(s.doc);
  await shown.cache.close();
  assert.equal(faceHeld(s.doc, s.id, shown.scene), false);
  const hidden = hideBody(s.doc, "body:feature-1", true);
  const off = await sceneOf(hidden);
  await off.cache.close();
  assert.equal(off.scene.bodies.length, 0, "nothing shown");
  assert.equal(faceHeld(hidden, s.id, off.scene), false);
});
