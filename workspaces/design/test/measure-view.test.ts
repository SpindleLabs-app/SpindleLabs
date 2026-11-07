// Measure on the page (step 35e2l2, measure-view.ts with measure-panel.ts) on
// the real kernel: two 10 mm cubes 15 mm apart, built by the real rebuild,
// clicked as the view would report the clicks, read back from the panel's
// words and the line it hands the view. Every expected number is worked out
// by hand from where the cubes are.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AnalysisOverlay, Unit, ViewportPick } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { MEASURE_FAILED, measureView, sceneCorners, targetOf, VIEW_HINTS } from "../src/measure-view.ts";
import { MEASURE_OVERLAY } from "../src/measure-tool.ts";
import { NOTHING_PICKED } from "../src/measure-panel.ts";

const kernel = nodeKernel();
const { Window } = await import("happy-dom");

/** Body 1 a 10 mm cube at the origin, Body 2 another moved 25 mm along x: the gap between them is 25 − 10 = 15 mm. */
async function twoCubes() {
  let doc: DesignDocument = partDocument("box", 10, 10, 10);
  const placed = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(placed.doc, [`body:${placed.id}`], { ...NO_MOVE, x: 25 }).doc;
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  return { scene, build, cache };
}

/** The joined index of shown body `b`'s face whose outward normal is `n` (the faces here are axis-aligned). */
function faceOf(scene: Scene, b: number, n: [number, number, number]): number {
  const v = scene.bodies[b].view;
  const k = v.face_normals.findIndex((m) => m !== null && m.every((c, j) => Math.abs(c - n[j]) < 1e-12));
  assert.ok(k >= 0, `body ${b} has a face facing ${n}`);
  return scene.faceStart[b] + k;
}

const click = (face: number | null, extra: Partial<ViewportPick> = {}): ViewportPick => ({ face, edge: null, shift: false, ...extra });

async function setup() {
  const { scene, build, cache } = await twoCubes();
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  let unit: Unit = "mm";
  let current: Scene | null = scene;
  const overlays = new Map<string, AnalysisOverlay>();
  let changes = 0;
  let reveals = 0;
  let corners: readonly (readonly number[])[] | null = null;
  const over = doc.createElement("div");
  doc.body.append(over);
  const view = measureView({
    slot,
    over,
    reveal: () => void reveals++,
    scene: () => current,
    handle: (b) => {
      const id = current?.bodies[b]?.body;
      return id === undefined ? null : (build.bodies[id]?.handle ?? null);
    },
    measure: (a, b) => kernel.call("body_measure", a, b),
    unit: () => unit,
    showOverlay: (o) => void overlays.set(o.id, o),
    clearOverlay: (id) => void overlays.delete(id),
    changed: () => void changes++,
    offerCorners: (c) => void (corners = c),
  });
  const text = (id: string) => doc.getElementById(id)?.textContent ?? null;
  return { scene, view, doc, text, overlays, changes: () => changes, reveals: () => reveals, setUnit: (u: Unit) => (unit = u), setScene: (s: Scene | null) => (current = s), cache, build, corners: () => corners };
}

test("hand-worked on the real kernel: the facing faces of two cubes are 15 mm apart, and 0.591 in", async () => {
  const s = await setup();
  s.view.open();
  assert.equal(s.view.shown, true);
  assert.equal(s.changes(), 1);
  assert.equal(s.text("measure-first-name"), NOTHING_PICKED);
  const hint = s.doc.getElementById("measure-view-hint") as HTMLElement;
  assert.deepEqual([hint.hidden, hint.textContent], [false, VIEW_HINTS[0]], "the view says what to click");
  // Body 1's +x face (x = 10), then Body 2's −x face (x = 25).
  s.view.pick(click(faceOf(s.scene, 0, [1, 0, 0])));
  await s.view.settled;
  assert.equal(s.text("measure-first-name"), "Flat face of Body 1");
  assert.equal(s.text("measure-second-name"), NOTHING_PICKED);
  assert.equal(s.text("measure-first-area"), "100 mm²"); // 10 × 10
  assert.equal(s.overlays.get(MEASURE_OVERLAY)?.places.length, 0, "one face: tinted, no line");
  assert.equal(s.overlays.get(MEASURE_OVERLAY)?.marks.length, 1);
  assert.deepEqual([hint.hidden, hint.textContent], [false, VIEW_HINTS[1]]);
  assert.equal(s.reveals(), 0, "a phone's sheet stays shut while picking");
  s.view.pick(click(faceOf(s.scene, 1, [-1, 0, 0])));
  await s.view.settled;
  assert.equal(s.text("measure-second-name"), "Flat face of Body 2");
  assert.equal(s.text("measure-distance"), "15 mm");
  assert.equal(hint.hidden, true, "two picked: the hint goes");
  assert.equal(s.reveals(), 1, "the distance opens a phone's sheet");
  assert.equal(s.text("measure-dx"), "15 mm");
  assert.equal(s.text("measure-dy"), "0 mm");
  assert.equal(s.text("measure-angle"), "180°"); // outward normals +x and −x
  const line = s.overlays.get(MEASURE_OVERLAY)!;
  assert.equal(line.label, "Distance 15 mm");
  const from = line.places[0] as { from: number[]; to: number[] };
  // The nearest points lie on x = 10 and x = 25, level with each other (any spot where the faces overlap in y and z).
  assert.ok(Math.abs(from.from[0] - 10) < 1e-9 && Math.abs(from.to[0] - 25) < 1e-9, `the line runs from x 10 to x 25: ${from.from} → ${from.to}`);
  assert.ok(Math.abs(from.from[1] - from.to[1]) < 1e-9 && Math.abs(from.from[2] - from.to[2]) < 1e-9);
  // Settings ▸ Units to inches: the same answer in the new unit, nothing asked of the kernel again. 15 / 25.4 = 0.5906 → 0.591.
  s.setUnit("in");
  s.view.unitChanged();
  assert.equal(s.text("measure-distance"), "0.591 in");
  assert.equal(s.text("measure-first-area"), "0.155 in²");
  assert.equal(s.overlays.get(MEASURE_OVERLAY)!.label, "Distance 0.591 in");
  // Close: the panel hides and the line goes.
  s.view.close();
  assert.equal(s.view.shown, false);
  assert.equal(s.overlays.has(MEASURE_OVERLAY), false);
  assert.equal((s.doc.getElementById("measure-panel") as HTMLElement).hidden, true);
  assert.equal(hint.hidden, true);
  s.view.dispose();
  assert.equal(s.doc.getElementById("measure-view-hint"), null);
  await s.cache.close();
});

test("a double-click picks the whole body; two bodies are 15 mm apart and each 1000 mm³", async () => {
  const s = await setup();
  s.view.open();
  s.view.pick(click(faceOf(s.scene, 0, [0, 0, 1]), { double: true }));
  s.view.pick(click(faceOf(s.scene, 1, [0, 1, 0]), { double: true }));
  await s.view.settled;
  assert.equal(s.text("measure-first-name"), "Body 1");
  assert.equal(s.text("measure-second-name"), "Body 2");
  assert.equal(s.text("measure-distance"), "15 mm");
  assert.equal(s.text("measure-first-volume"), "1000 mm³"); // 10³
  assert.equal(s.text("measure-second-area"), "600 mm²"); // 6 × 100
  await s.cache.close();
});

test("empty space keeps the picks; × lets one go; a rebuild lets both go; a refusal shows in words", async () => {
  const s = await setup();
  s.view.open();
  const a = faceOf(s.scene, 0, [1, 0, 0]);
  const b = faceOf(s.scene, 1, [-1, 0, 0]);
  s.view.pick(click(a));
  s.view.pick(click(b));
  s.view.pick(click(null));
  await s.view.settled;
  assert.equal(s.text("measure-distance"), "15 mm", "a click on nothing changes nothing");
  // × on the first: the second moves up and is measured alone.
  (s.doc.getElementById("measure-first-drop") as HTMLButtonElement).click();
  await s.view.settled;
  assert.equal(s.text("measure-first-name"), "Flat face of Body 2");
  assert.equal(s.text("measure-second-name"), NOTHING_PICKED);
  assert.equal(s.text("measure-distance"), null);
  assert.equal(s.overlays.get(MEASURE_OVERLAY)?.places.length ?? 0, 0, "no line with one pick");
  // A rebuild: the picks go, the panel stays open.
  s.view.rebuilt();
  assert.deepEqual(s.view.picks, { first: null, second: null });
  assert.equal(s.view.shown, true);
  assert.equal(s.overlays.has(MEASURE_OVERLAY), false);
  // Body 1's last face, measured alone: no refusal.
  s.view.pick(click(s.scene.faceStart[1] - 1));
  await s.view.settled;
  assert.equal((s.doc.getElementById("measure-error") as HTMLElement).hidden, true);
  // Body 1 freed in the kernel behind the view's back (as a stale handle would be): measuring it is refused, in words, never a crash.
  await kernel.call("body_free", s.build.bodies[s.scene.bodies[0].body].handle);
  s.view.rebuilt(); // (so the click below is a first pick, not the same face again)
  s.view.pick(click(a));
  await s.view.settled;
  const error = s.doc.getElementById("measure-error") as HTMLElement;
  assert.equal(error.hidden, false);
  assert.ok(error.textContent!.startsWith(`${MEASURE_FAILED}: `), error.textContent!);
  assert.equal(s.text("measure-distance"), null, "no numbers beside a refusal");
  await s.cache.close();
});

test("targetOf: an edge wins over the face under it, a double-click the body, nothing for empty space or no scene", async () => {
  const { scene, cache } = await twoCubes();
  // Body 2's faces start where Body 1's end; its edge 3 is joined edge edgeStart[1] + 3.
  assert.deepEqual(targetOf(click(scene.faceStart[1] + 2), scene), { body: 1, kind: "face", index: 2 });
  assert.deepEqual(targetOf(click(scene.faceStart[1] + 2, { edge: scene.edgeStart[1] + 3 }), scene), { body: 1, kind: "edge", index: 3 });
  assert.deepEqual(targetOf(click(4, { double: true }), scene), { body: 0, kind: "body" });
  assert.equal(targetOf(click(null), scene), null);
  assert.equal(targetOf(click(1), null), null);
  await cache.close();
});

/** The click on the offered corner at `at` (its place among sceneCorners), as the view reports one. */
function cornerClick(scene: Scene, body: number, at: (pts: readonly (readonly number[])[]) => readonly number[], extra: Partial<ViewportPick> = {}): ViewportPick {
  const all = sceneCorners(scene);
  const want = at(scene.bodies[body].view.vertex_points);
  const k = all.findIndex((c) => c.body === body && c.at.every((x, j) => x === want[j]));
  assert.ok(k >= 0, `body ${body} offers the corner ${want}`);
  return { face: null, edge: null, vertex: k, shift: false, ...extra };
}
/** A cube's corner with the largest (or smallest) x + y + z: the one at its top far corner (or its bottom near one). */
const extreme = (sign: 1 | -1) => (pts: readonly (readonly number[])[]) => pts.reduce((a, b) => (sign * (b[0] + b[1] + b[2]) > sign * (a[0] + a[1] + a[2]) ? b : a));

test("35e2l3 hand-worked on the real kernel: corner to corner between the two cubes is √425 = 20.616 mm", async () => {
  const s = await setup();
  s.view.open();
  // Every corner of both cubes is offered: 8 + 8.
  assert.equal(s.corners()?.length, 16);
  // Body 1's top far corner A = (x1, y1, z1) + (10, 10, 10); Body 2's bottom near corner B = (x1, y1, z1) + (25, 0, 0)
  // (the same cube moved 25 mm along x). B − A = (15, −10, −10), so the distance is √(15² + 10² + 10²) = √425 = 20.6155… → 20.616 mm.
  s.view.pick(cornerClick(s.scene, 0, extreme(1)));
  await s.view.settled;
  assert.equal(s.text("measure-first-name"), "Corner of Body 1");
  const dot = s.overlays.get(MEASURE_OVERLAY)?.places ?? [];
  assert.equal(dot.length, 1, "one corner picked: a dot on it, no line yet");
  assert.deepEqual((dot[0] as { point: number[] }).point, extreme(1)(s.scene.bodies[0].view.vertex_points));
  s.view.pick(cornerClick(s.scene, 1, extreme(-1)));
  await s.view.settled;
  assert.equal(s.text("measure-second-name"), "Corner of Body 2");
  assert.equal(s.text("measure-distance"), "20.616 mm");
  assert.equal(s.text("measure-dx"), "15 mm");
  assert.equal(s.text("measure-dy"), "-10 mm");
  assert.equal(s.text("measure-dz"), "-10 mm");
  // A corner and a face: from A to Body 2's −x face (x = x1 + 25) is straight along x, 25 − 10 = 15 mm.
  // (Clicking A again now would let it go, so start afresh first.) And B, which lies on that face, is 0 from it.
  s.view.rebuilt();
  s.view.pick(cornerClick(s.scene, 0, extreme(1)));
  s.view.pick(click(faceOf(s.scene, 1, [-1, 0, 0])));
  await s.view.settled;
  assert.equal(s.text("measure-distance"), "15 mm");
  assert.equal(s.overlays.get(MEASURE_OVERLAY)?.marks.length, 1, "the face tinted");
  s.view.rebuilt();
  s.view.pick(cornerClick(s.scene, 1, extreme(-1)));
  s.view.pick(click(faceOf(s.scene, 1, [-1, 0, 0])));
  await s.view.settled;
  assert.equal(s.text("measure-distance"), "0 mm");
  // Closing takes the corners away from the view; a rebuild while open offers the new bodies' again.
  s.view.close();
  assert.equal(s.corners(), null);
  s.view.open();
  assert.equal(s.corners()?.length, 16);
  s.setScene(null);
  s.view.rebuilt();
  assert.equal(s.corners(), null, "no bodies: no corners");
  await s.cache.close();
});

test("35e2l3 targetOf: a corner by its place among those offered, a double-click on it the body, a stale place nothing", async () => {
  const { scene, cache } = await twoCubes();
  const all = sceneCorners(scene);
  // Body 1's 8 corners first, then Body 2's: place 8 + 3 is Body 2's corner 3.
  assert.equal(all.length, 16);
  assert.deepEqual(targetOf({ face: null, edge: null, vertex: 11, shift: false }, scene), { body: 1, kind: "vertex", index: 3 });
  assert.deepEqual(all[11].at, scene.bodies[1].view.vertex_points[3]);
  assert.deepEqual(targetOf({ face: null, edge: null, vertex: 2, shift: false, double: true }, scene), { body: 0, kind: "body" });
  assert.equal(targetOf({ face: null, edge: null, vertex: 16, shift: false }, scene), null, "past the corners offered");
  assert.equal(targetOf({ face: null, edge: null, vertex: 0, shift: false }, null), null);
  await cache.close();
});
