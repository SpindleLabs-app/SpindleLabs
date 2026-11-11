// SL #538 item 4 (hunt 2026-11-11): the Feature and Body sections describe
// the body a selected face or edge is ON. Until then they took the first
// shown body made by the item in the face's NAME, so a face picked on a
// split-off piece (whose faces keep the cut body's names) showed another
// body's name and volume. #501 fixed this for a selected body only. Built
// by the real rebuild on the real kernel; volumes by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { findInScene, joinBodies, sceneReference, shownBodies, type Scene } from "../src/scene.ts";
import { panelFocus } from "../src/selection.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();

/** `doc0` built and drawn as the workspace does: its pieces numbered, the scene of every body shown. */
async function drawn(doc0: DesignDocument): Promise<{ doc: DesignDocument; scene: Scene }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies), builtPieceFaces(build));
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  await cache.close();
  return { doc, scene };
}

/** The joined index of body `b`'s flat face whose every corner has coordinate `axis` equal to `at` (its top: axis 2 at the body's height). */
function faceAt(scene: Scene, b: number, axis: number, at: number): number {
  const m = scene.bodies[b].view.mesh;
  const flat = new Map<number, boolean>();
  m.triangle_faces.forEach((f, t) => {
    for (let k = 0; k < 3; k++) flat.set(f, (flat.get(f) ?? true) && Math.abs(m.positions[3 * m.indices[3 * t + k] + axis] - at) < 1e-9);
  });
  const found = [...flat].filter(([, all]) => all).map(([f]) => f);
  assert.equal(found.length, 1, `body ${b} has one flat face at ${"xyz"[axis]} = ${at}`);
  return scene.faceStart[b] + found[0];
}

/** What the panel describes for one selected face or edge: the Body section's name and volume. */
const described = (scene: Scene, doc: DesignDocument, kind: "face" | "edge", index: number) => {
  const ref = sceneReference(kind, scene, index);
  assert.ok(ref, `${kind} ${index} has a name`);
  const f = panelFocus([ref], scene, doc);
  return f && { body: f.body === null ? null : `Body ${f.body.place}`, volume: f.body === null ? null : Math.round(f.body.view.volume), feature: f.feature.id };
};

/** Every face and edge of every body shown that its name finds again: the panel must describe the body it is on. How many were checked. */
function everyPartOnItsBody(scene: Scene, doc: DesignDocument): number {
  let checked = 0;
  scene.bodies.forEach((body, b) => {
    for (const kind of ["face", "edge"] as const) {
      const count = kind === "face" ? body.view.faces : body.view.edge_faces.length;
      const start = kind === "face" ? scene.faceStart[b] : scene.edgeStart[b];
      for (let i = 0; i < count; i++) {
        const ref = sceneReference(kind, scene, start + i);
        if (ref === null || findInScene(ref, scene).status !== "found") continue;
        assert.equal(panelFocus([ref], scene, doc)?.body, body, `${ref.id} is on Body ${body.place}`);
        checked++;
      }
    }
  });
  return checked;
}

/** The bar 100 × 20 × 10 at the origin with the slot x 30..40, y −10..30 cut 20 up through it by Extrude 1. */
function cutBar() {
  const start = partDocument("box", 100, 20, 10);
  const bar = start.timeline.features[0].id;
  const s = addSketch(start);
  const e = extrudeSketch(drawRectangle(s.doc, s.id, [30, -10], [40, 30]).doc, s.id, 20, false, undefined, { operation: "cut", bodies: [`body:${bar}`] });
  return { doc: e.doc, bar, e: e.id };
}

test("hand-worked: a face picked on the split-off piece of a cut bar is described by that piece, not by the bar's other body", async () => {
  const c = cutBar();
  const { doc, scene } = await drawn(c.doc);
  // The bar's id stays on x 0..30 (its left end, x = 0, is whole there): Body 1, 30 × 20 × 10 = 6,000 mm³. The far
  // piece x 40..100 is Extrude 1's piece 1: Body 2, 60 × 20 × 10 = 12,000 mm³.
  assert.deepEqual(scene.bodies.map((b) => [b.body, b.place, Math.round(b.view.volume)]), [[`body:${c.bar}`, 1, 6000], [`body:${c.e}/piece:1`, 2, 12000]]);
  // Each chunk's top (z = 10) carries the bar's name, with its own tag: the far one is Body 2's.
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 0, 2, 10)), { body: "Body 1", volume: 6000, feature: c.bar });
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 1, 2, 10)), { body: "Body 2", volume: 12000, feature: c.bar });
  // The far end (x = 100) is the bar's own right face, whole, on Body 2.
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 1, 0, 100)), { body: "Body 2", volume: 12000, feature: c.bar });
  // The slot's walls carry the extrude's name: x = 30 is on Body 1 (the bar's own id), x = 40 on Body 2.
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 0, 0, 30)), { body: "Body 1", volume: 6000, feature: c.e });
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 1, 0, 40)), { body: "Body 2", volume: 12000, feature: c.e });
  // And every face and edge of both chunks: 6 faces and 12 edges each.
  assert.equal(everyPartOnItsBody(scene, doc), 36);
});

test("the same after a Combine cut: each piece's faces and edges are described by their own piece", async () => {
  // The bar, and a slot box 10 × 40 × 20 moved to x 30..40, y −10..30, z −5..15, cut out of it by Combine 1: the same
  // two chunks, 6,000 (Body 1, the bar's id) and 12,000 (the Combine's piece 1; the slot was Body 2, so Body 3).
  let doc = partDocument("box", 100, 20, 10);
  const bar = doc.timeline.features[0].id;
  const slot = insertPreset(doc, "box", 10, 40, 20);
  doc = insertMove(slot.doc, [`body:${slot.id}`], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const c = insertCombine(doc, `body:${bar}`, [`body:${slot.id}`], "cut");
  const d = await drawn(c.doc);
  assert.deepEqual(d.scene.bodies.map((b) => [b.body, b.place, Math.round(b.view.volume)]), [[`body:${bar}`, 1, 6000], [`body:${c.id}/piece:1`, 3, 12000]]);
  assert.deepEqual(described(d.scene, d.doc, "face", faceAt(d.scene, 1, 2, 10)), { body: "Body 3", volume: 12000, feature: bar });
  assert.deepEqual(described(d.scene, d.doc, "face", faceAt(d.scene, 1, 0, 40)), { body: "Body 3", volume: 12000, feature: slot.id });
  assert.equal(everyPartOnItsBody(d.scene, d.doc), 36);
});

test("the control: with nothing cut, a face or edge of each of two boxes is described by its own box", async () => {
  // Box 1 40 × 30 × 20 (24,000) and Box 2 10 × 10 × 10 (1,000) moved to x = 100: no item makes two bodies.
  const start = partDocument("box", 40, 30, 20);
  const two = insertPreset(start, "box", 10, 10, 10);
  const { doc, scene } = await drawn(insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, x: 100 }).doc);
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 0, 2, 20)), { body: "Body 1", volume: 24000, feature: start.timeline.features[0].id });
  assert.deepEqual(described(scene, doc, "face", faceAt(scene, 1, 2, 10)), { body: "Body 2", volume: 1000, feature: two.id });
  assert.equal(everyPartOnItsBody(scene, doc), 36);
});

test("a face whose body is not shown is described as having no body, never by another's numbers", async () => {
  const c = cutBar();
  const { doc, scene } = await drawn(c.doc);
  const farTop = sceneReference("face", scene, faceAt(scene, 1, 2, 10))!;
  // Only the near chunk drawn (the far one's eye shut): the far top's name finds no face, and no body is described by it.
  const near: Scene = joinBodies([scene.bodies[0]]);
  assert.equal(panelFocus([farTop], near, doc)?.body ?? null, null);
  // With nothing drawn yet (no scene), the feature is still named and no body is.
  assert.deepEqual(((f) => f && [f.feature.id, f.body])(panelFocus([farTop], null, doc)), [c.bar, null]);
});
