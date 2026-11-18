// SL #632 item 2: a sketch on the top of an extrude's second profile was
// called lost after one side of that profile was deleted and drawn again
// between the same corners (fine with one profile). Every profile's caps
// were named alike ("end"), told apart only by a tag of the sides around
// them, so a redrawn side (a new curve id) changed the tag. Now a profile
// after the first names its caps by its place in the extrude ("end:2"),
// which no sketch edit changes. Real rebuild on the real kernel; every
// number from the squares' corners.

import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { BodyCache, rebuildTimeline, settleKept } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { addFaceSketch, addSketch, deleteCurve, drawLine, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { kernel, regionsOf } from "./several-hunt-helpers.ts";

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The joined index of the face facing +z at height `z` whose centroid's x is `x`. */
function topAt(scene: Scene, z: number, x: number): number {
  for (let b = 0; b < scene.bodies.length; b++) {
    const v = scene.bodies[b].view;
    const k = v.face_normals.findIndex((m, i) => m !== null && Math.abs(m[2] - 1) < 1e-12 && Math.abs(v.face_centroids[i][2] - z) < 1e-9 && Math.abs(v.face_centroids[i][0] - x) < 1e-9);
    if (k >= 0) return scene.faceStart[b] + k;
  }
  assert.fail(`no top at z ${z} with its middle at x ${x}`);
}

/**
 * Squares A (x 0..10) and B (x 30..40), y 0..10, of one sketch, extruded 5 mm as one item with `firstAt`'s square
 * first; a sketch on the top of the square whose middle is at x `onX` (z = 5); then that square's top side, y = 10,
 * deleted and drawn again between the same corners. The sketch's height and warning before and after.
 */
async function scenario(firstAt: 5 | 35, onX: 5 | 35) {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [30, 0], [40, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const first = rs.find((r) => Math.abs(r.c[0] - firstAt) < 1e-6)!.ref;
  const second = rs.find((r) => Math.abs(r.c[0] - (40 - firstAt)) < 1e-6)!.ref;
  const made = extrudeSketch(d, s.id, 5, false, first, null, [{ sketch: s.id, region: second }]);
  const before = await sceneOf(made.doc);
  const spot = sketchSpot({ face: topAt(before.scene, 5, onX), shift: false }, before.scene);
  await before.cache.close();
  assert.ok(spot?.kind === "face");
  const face = addFaceSketch(made.doc, spot.face, spot.drawn);
  let doc = face.doc;
  const placed = async () => {
    const { build, cache } = await sceneOf(doc);
    await cache.close();
    const r = build.results[face.id];
    assert.ok(r.status === "built", JSON.stringify(r));
    return { z: r.placement!.plane.origin[2], warning: r.plane?.message ?? null };
  };
  const was = await placed();
  // The top side of the square sketched on: from (onX - 5, 10) to (onX + 5, 10), deleted and drawn again.
  const sk = () => doc.sketches.find((x) => x.id === s.id)!;
  const at = (x: number, y: number) => sk().points.find((p) => p.x === x && p.y === y)!.id;
  const [l, r] = [at(onX - 5, 10), at(onX + 5, 10)];
  const top = sk().curves.find((c) => c.kind === "line" && [c.start, c.end].includes(l) && [c.start, c.end].includes(r))!;
  doc = await settleKept(kernel, doc, deleteCurve(doc, s.id, top.id));
  doc = await settleKept(kernel, doc, drawLine(doc, s.id, l, r).doc);
  return { plane: spot.face.plane, was, now: await placed() };
}

test("a sketch on the first profile's top survives its side redrawn (both tops were \"end\", so it was tagged too)", async () => {
  const { was, now } = await scenario(5, 5);
  assert.deepEqual(was, { z: 5, warning: null });
  assert.deepEqual(now, { z: 5, warning: null });
});

test("a sketch on the second profile's top survives its side redrawn, and its plane names the profile, not its sides", async () => {
  const { plane, was, now } = await scenario(5, 35);
  assert.match(plane, /\/end:2$/);
  assert.deepEqual(was, { z: 5, warning: null });
  assert.deepEqual(now, { z: 5, warning: null });
});

test("the same with the squares the other way round: profile 2 is A now", async () => {
  const { plane, now } = await scenario(35, 5);
  assert.match(plane, /\/end:2$/);
  assert.deepEqual(now, { z: 5, warning: null });
});

test("a file saved before: a sketch held by the second profile's top's old tagged name is found on that top, never on the first's", async () => {
  // A 10 mm box at the origin (top z = 10); square A (x 1..4, y 1..4) sketched on its top and square B (x 30..40, y 0..10)
  // on XY, extruded 5 mm as one item, A first: A's top at z = 15, B's at z = 5, so a height tells which top a sketch is on.
  const box = partDocument("box", 10, 10, 10);
  const onTop = addFaceSketch(box, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [2, 2, 10]));
  let d = drawRectangle(onTop.doc, onTop.id, [1, 1], [4, 4]).doc;
  const xy = addSketch(d);
  d = drawRectangle(xy.doc, xy.id, [30, 0], [40, 10]).doc;
  const [B] = await regionsOf(d, xy.id);
  const made = extrudeSketch(d, onTop.id, 5, false, undefined, null, [{ sketch: xy.id, region: B.ref }]);
  const before = await sceneOf(made.doc);
  const spot = sketchSpot({ face: topAt(before.scene, 5, 35), shift: false }, before.scene);
  await before.cache.close();
  assert.ok(spot?.kind === "face");
  assert.match(spot.face.plane, /\/end:2$/);
  // Before SL #632 both tops were "end", B's told apart by its sides: the name such a file holds.
  const f = encodeURIComponent(made.id);
  const old = `face:${f}/end#${B.ref.outer.map((c) => `face:${f}/side:${c.curve}`).sort().join(",")}`;
  const heightOf = async (plane: string) => {
    const face = addFaceSketch(made.doc, { ...spot.face, plane }, spot.drawn);
    const { build, cache } = await sceneOf(face.doc);
    await cache.close();
    const r = build.results[face.id];
    assert.ok(r.status === "built", JSON.stringify(r));
    return { z: r.placement!.plane.origin[2], warning: r.plane?.message ?? null };
  };
  assert.deepEqual(await heightOf(spot.face.plane), { z: 5, warning: null }, "the new name");
  assert.deepEqual(await heightOf(old), { z: 5, warning: null }, "the old name");
  // A's top's old name, tagged by A's sides (as drawn on the box's top: 4 lines), is still A's top at z = 15.
  const A = (await regionsOf(made.doc, onTop.id))[0];
  const oldA = `face:${f}/end#${A.ref.outer.map((c) => `face:${f}/side:${c.curve}`).sort().join(",")}`;
  assert.deepEqual(await heightOf(oldA), { z: 15, warning: null }, "the first profile's old name");
});
