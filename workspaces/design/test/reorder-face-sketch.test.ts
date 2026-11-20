// SL #676 item 3: a sketch on a face (or snapped to an edge, or projecting
// one) is placed on its body as the items before it leave it, so dragging it
// past a Move or Combine that changes that body, or that Move or Combine past
// it, would quietly put the sketch (and the pad built from it) somewhere else.
// Refused in words, as #506 and #676 item 1 refuse the same for a Combine or
// a Copy. And SL #676 item 4: a refusal never shows a body's raw id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem, reorderItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { addFaceSketch, addSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";

const kernel = nodeKernel();
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The joined index of the shown face whose outward normal is `n` and whose centre is at height `z`. */
function faceAt(scene: Scene, n: readonly number[], z: number): number {
  for (let b = 0; b < scene.bodies.length; b++) {
    const v = scene.bodies[b].view;
    const k = v.face_normals.findIndex((m, i) => m !== null && Math.abs(dot(m, n) - 1) < 1e-9 && Math.abs(v.face_centroids[i][2] - z) < 1e-9);
    if (k >= 0) return scene.faceStart[b] + k;
  }
  assert.fail(`no face facing ${n} at z ${z}`);
}

/** Every body's lowest and highest z after a rebuild. */
async function heights(doc: DesignDocument): Promise<string> {
  const { build, cache } = await sceneOf(doc);
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of Object.values(build.bodies)) {
    for (const p of (await cache.view(b.handle)).vertex_points) {
      lo = Math.min(lo, p[2]);
      hi = Math.max(hi, p[2]);
    }
  }
  await cache.close();
  return `${lo}..${hi}`;
}

/** A 20 × 20 square sketched on the top face at height `z` of `doc` and extruded 10 mm: the sketch's and the pad's ids. */
async function padOnTop(doc: DesignDocument, z: number): Promise<{ doc: DesignDocument; sketch: string; pad: string }> {
  const { scene, cache } = await sceneOf(doc);
  const spot = sketchSpot({ face: faceAt(scene, [0, 0, 1], z), shift: false }, scene);
  await cache.close();
  assert.ok(spot?.kind === "face", "the top face can be sketched on");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  const drawn = drawRectangle(s.doc, s.id, [10, 5], [30, 25]).doc;
  const e = extrudeSketch(drawn, s.id, 10);
  return { doc: e.doc, sketch: s.id, pad: e.id };
}

const place = (doc: DesignDocument, id: string) => doc.timeline.features.findIndex((f) => f.id === id);

test("#676 item 3, by hand: a sketch on the top of a lifted box can't go above the Move that lifted it", async () => {
  // Box 1 is 40 × 30 × 20 at z 0..20; Move 1 lifts it by 30 to z 30..50. The square on its top (z = 50) extruded
  // 10 mm is a pad at z 50..60, so the bodies span z 30..60. Above Move 1 the sketch would lie on the top as it was
  // before the lift (z = 20) and the pad would be z 20..30, under the box: the part changes, so it is refused.
  const box = partDocument("box", 40, 30, 20);
  const moved = insertMove(box, [`body:${box.timeline.features[0].id}`], { ...NO_MOVE, z: 30 });
  const { doc, sketch } = await padOnTop(moved.doc, 50);
  assert.equal(await heights(doc), "30..60");
  // Timeline: Box 1, Move 1, Sketch 1, Extrude 1. Sketch 1 to place 1 puts it before Move 1.
  const r = reorderItem(doc, sketch, 1);
  assert.equal(r.refused, "before-dependency");
  assert.equal(r.message, "Sketch 1 can't go before Move 1: it is drawn on Box 1 as Move 1 leaves it");
  // Move 1 dragged after Sketch 1 is the same swap the other way round.
  const m = reorderItem(doc, moved.id, 2);
  assert.equal(m.refused, "after-dependent");
  assert.equal(m.message, "Move 1 can't go after Sketch 1: Sketch 1 is drawn on Box 1 as Move 1 leaves it");
});

test("#676 item 3: nor can a Move of its body go before a sketch drawn on it (the pad would follow the box up)", async () => {
  // Box 1 at z 0..20, the square on its top (z = 20) extruded to a pad z 20..30, then Move 1 lifts Box 1 alone by 30:
  // z 0..30 becomes box z 30..50 and pad z 20..30, so the bodies span z 20..50. Before the sketch, Move 1 would lift
  // the face the sketch lies on and the pad with it (z 50..60): refused.
  const box = partDocument("box", 40, 30, 20);
  const padded = await padOnTop(box, 20);
  const moved = insertMove(padded.doc, ["body:feature-1"], { ...NO_MOVE, z: 30 });
  assert.equal(await heights(moved.doc), "20..50");
  // Timeline: Box 1, Sketch 1, Extrude 1, Move 1. Move 1 to place 1 puts it before Sketch 1.
  const r = reorderItem(moved.doc, moved.id, 1);
  assert.equal(r.refused, "before-dependency");
  assert.equal(r.message, "Move 1 can't go before Sketch 1: Sketch 1 is drawn on Box 1 as it is before Move 1");
});

test("#676 item 3: the sketch is held to the joined body its face went into, so a Move of that body is not passed either", async () => {
  // Box 1 and Box 2 are 40 × 30 × 20; Move 1 lifts Box 2 by 10 (z 10..30, over all of Box 1's top). Combine 1 joins Box 2
  // to Box 1: the joined body keeps Box 1's id, and its top (z 30) is Box 2's face. Move 2 lifts that body by 30, so the
  // top is at z 60, and the sketch is drawn there. Its face is named after Box 2, but lies on Box 1's body, which Move 2
  // placed: dragged above Move 2 it would drop to z 30, so it is refused, naming the body Move 2 moved (Box 1).
  let doc = partDocument("box", 40, 30, 20);
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 40, 30, 20));
  ({ doc } = insertMove(doc, [`body:${id}`], { ...NO_MOVE, z: 10 }));
  ({ doc } = insertCombine(doc, "body:feature-1", [`body:${id}`], "join"));
  const moved = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, z: 30 });
  const { doc: padded, sketch } = await padOnTop(moved.doc, 60);
  assert.equal(await heights(padded), "30..70");
  const plane = padded.timeline.features.find((f) => f.id === sketch)!.intent.parameters.plane as string;
  assert.ok(plane.startsWith(`face:${id}/`), `drawn on Box 2's face, ${plane}`);
  const r = reorderItem(padded, sketch, place(padded, moved.id));
  assert.equal(r.refused, "before-dependency");
  assert.equal(r.message, "Sketch 1 can't go before Move 2: it is drawn on Box 1 as Move 2 leaves it");
  const m = reorderItem(padded, moved.id, place(padded, sketch));
  assert.equal(m.refused, "after-dependent");
  assert.equal(m.message, "Move 2 can't go after Sketch 1: Sketch 1 is drawn on Box 1 as Move 2 leaves it");
});

test("#676 item 3: drags that pass nothing changing the sketch's body are still allowed", async () => {
  // Box 1, Move 1 lifting Box 1, Box 2 (never moved), then the sketch on Box 1's top. Sketch 1 can go before Box 2,
  // which changes no body; a sketch on an origin plane holds to no body and goes anywhere.
  const box = partDocument("box", 40, 30, 20);
  const moved = insertMove(box, ["body:feature-1"], { ...NO_MOVE, z: 30 });
  const two = insertPreset(moved.doc, "box", 10, 10, 10);
  const { doc, sketch } = await padOnTop(two.doc, 50);
  const ok = reorderItem(doc, sketch, place(doc, two.id));
  assert.equal(ok.refused, undefined);
  assert.equal(place(ok.doc!, sketch), 2);
  const plain = addSketch(doc, "XY");
  const first = reorderItem(plain.doc, plain.id, 0);
  assert.equal(first.refused, undefined);
});

test("#676 item 4: a refusal names a deleted body's item by the name its users kept, never by its raw id", () => {
  // Box 1, Box 2, Combine 1 joins Box 2 to Box 1, Copy 1 of Box 1 after it. Box 1 is deleted (confirmed). Combine 1
  // dragged to the end would pass Copy 1, which copies Box 1 as Combine 1 leaves it: refused, naming "Box 1".
  let doc = partDocument("box", 40, 30, 20);
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 40, 30, 20));
  let combine: string;
  ({ doc, id: combine } = insertCombine(doc, "body:feature-1", [`body:${id}`], "join"));
  ({ doc } = insertDuplicates(doc, ["body:feature-1"]));
  doc = deleteItem(doc, "feature-1");
  const r = reorderItem(doc, combine, doc.timeline.features.length - 1);
  assert.equal(r.refused, "after-dependent");
  assert.ok(!r.message!.includes("body:"), r.message);
  assert.equal(r.message, "Combine 1 can't go after Copy 1: Copy 1 uses Box 1 as Combine 1 leaves it");
});
