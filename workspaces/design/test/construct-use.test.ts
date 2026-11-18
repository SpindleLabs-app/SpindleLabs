// Step 59a3: using construction planes. A sketch on a construction plane
// (sketch.ts `addConstructSketch`, rebuild.ts `constructPlacement`) and a
// Mirror across one (duplicate.ts `insertDuplicates` with "construct:<id>",
// rebuild.ts `copyBody`), built by the real rebuild on the real kernel, with
// the data's checks (document.ts `checkConstructSketch`, `checkDuplicate`),
// the eyes (timeline-edits.ts `hideRow`, construct-draw.ts `drawnConstructs`)
// and the words. Every place is worked out by hand from the box's corners:
// `partDocument("box", w, d, h)` is x 0..w, y 0..d, z 0..h.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertConstruct } from "../src/construct.ts";
import type { ConstructAnswer } from "../src/construct-data.ts";
import { drawnConstructs } from "../src/construct-draw.ts";
import { bodyIdOf, changePreset, constructHidden, EYE_FOLDERS, greyedBy, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { duplicateSummary, insertDuplicates, mirrorPlaneProblem } from "../src/duplicate.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { addConstructSketch, constructXAxis, drawRectangle, sketchPlane } from "../src/sketch.ts";
import { deleteItem, hideRow, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { deleteWords } from "../src/delete-ask.ts";
import { mirrorMap } from "../src/move-tool.ts";
import { browserTree, eyeId, rowItem } from "../src/browser.ts";
import { BodyCache, followedDoc, rebuildTimeline, type FeatureResult, type TimelineBuild } from "../src/rebuild.ts";

const kernel = nodeKernel();

/** A placeholder answer for inserting before the first build (the rebuild makes it again from its names). */
const PLANE: ConstructAnswer = { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1], near: [0, 0, 0] };
const AXIS: ConstructAnswer = { kind: "axis", point: [0, 0, 0], direction: [1, 0, 0], near: [0, 0, 0] };

const TOP = "face:feature-1/top";
const RIGHT = "face:feature-1/right";

/** The design built and settled (its constructions' answers written back, as the app does after every rebuild). */
async function settled(doc: DesignDocument): Promise<DesignDocument> {
  const cache = new BodyCache(kernel);
  try {
    return followedDoc(doc, await rebuildTimeline(doc, cache, kernel));
  } finally {
    await cache.close();
  }
}

/** The design's build, and the box round each body it holds: [min x, min y, min z, max x, max y, max z], by body id. */
async function boxes(doc: DesignDocument): Promise<{ build: TimelineBuild; box: Record<string, number[]> }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const box: Record<string, number[]> = {};
    for (const [id, b] of Object.entries(build.bodies)) {
      const ps = (await cache.view(b.handle)).vertex_points;
      box[id] = [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k]))));
    }
    return { build, box };
  } finally {
    await cache.close();
  }
}

const near = (got: readonly number[], want: readonly number[], what: string) =>
  assert.ok(got.length === want.length && got.every((x, i) => Math.abs(x - want[i]) <= 1e-9), `${what}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);

const status = (build: TimelineBuild, id: string): FeatureResult => build.results[id];

/** A box with a plane 10 mm out from its right face (x = 40 + 10 = 50), settled so the design keeps that answer. */
async function boxAndPlane(): Promise<{ doc: DesignDocument; plane: string }> {
  const { doc, id } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: RIGHT }, 10, PLANE);
  return { doc: await settled(doc), plane: id };
}

test("hand-worked: a Mirror across a plane 10 mm out from the box's right face lands at x 60..100, and follows the box made 60 wide", async () => {
  const start = await kernel.call("body_count");
  const { doc: d0, plane } = await boxAndPlane();
  const { doc, ids } = insertDuplicates(d0, ["body:feature-1"], `construct:${plane}`);
  const [mirror] = ids;
  const f = doc.timeline.features.find((x) => x.id === mirror)!;
  // The body's item first, then the plane: greyed with either, never before either.
  assert.deepEqual(f.dependsOn, ["feature-1", plane]);
  assert.equal(f.intent.summary, "Mirror of Box 1 across Plane 1");
  assert.equal(f.provenance.self.label, "Mirror 1");
  const { box } = await boxes(doc);
  // The right face is x = 40; the plane x = 50. Mirrored in x = 50: x ↦ 100 − x, so 0..40 goes to 60..100; y and z stay.
  near(box[bodyIdOf(mirror)], [60, 0, 0, 100, 30, 20], "mirror");
  near(box["body:feature-1"], [0, 0, 0, 40, 30, 20], "the box itself");
  // The box made 60 wide: its right face x = 60, the plane x = 70, x ↦ 140 − x: 0..60 goes to 80..140.
  const wider = changePreset(doc, "feature-1", "box", 60, 30, 20);
  near((await boxes(wider)).box[bodyIdOf(mirror)], [80, 0, 0, 140, 30, 20], "mirror after the edit");
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("a Mirror across a construction plane: greyed with it, failed in words when it is deleted, refused before it", async () => {
  const { doc: d0, plane } = await boxAndPlane();
  const { doc, ids } = insertDuplicates(d0, ["body:feature-1"], `construct:${plane}`);
  const [mirror] = ids;
  const off = suppressItem(doc, plane, true);
  assert.deepEqual(status((await boxes(off)).build, mirror), { status: "greyed", by: plane });
  assert.equal(greyedBy(off, off.timeline.features.find((f) => f.id === mirror)!), plane);
  const gone = deleteItem(doc, plane);
  const r = status((await boxes(gone)).build, mirror);
  assert.deepEqual(r, { status: "failed", cause: "deleted-input", input: plane, message: "Plane 1 was deleted, so Mirror 1 has no plane to mirror across" });
  // The file with the plane deleted still opens (the Mirror says why it fails), as one with its body deleted does.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(gone))), gone);
  // Dragged before its plane: refused in words naming the plane.
  assert.deepEqual(reorderItem(doc, mirror, 1), { refused: "before-dependency", message: "Mirror 1 can't go before Plane 1: it is mirrored across Plane 1" });
  // Deleting the plane asks first, saying what happens to the Mirror.
  const words = deleteWords(doc, gone, plane);
  assert.ok(words !== null && /Mirror 1/.test(words.words), JSON.stringify(words));
});

test("insertDuplicates refuses a plane that can't be mirrored across, in words, changing nothing", async () => {
  const { doc: d0, plane } = await boxAndPlane();
  const axis = insertConstruct(d0, "axis_along", { line: "X" }, undefined, AXIS);
  assert.equal(mirrorPlaneProblem(axis.doc, `construct:${axis.id}`), `"construct:${axis.id}" is not a construction plane in the design`);
  assert.throws(() => insertDuplicates(axis.doc, ["body:feature-1"], `construct:${axis.id}`), { message: `"construct:${axis.id}" is not a construction plane in the design` });
  assert.throws(() => insertDuplicates(d0, ["body:feature-1"], "construct:feature-9"), { message: `"construct:feature-9" is not a construction plane in the design` });
  assert.throws(() => insertDuplicates(d0, ["body:feature-1"], "top" as never), { message: `top is not an origin plane (XY, XZ or YZ) or a construction plane` });
  const off = suppressItem(d0, plane, true);
  assert.throws(() => insertDuplicates(off, ["body:feature-1"], `construct:${plane}`), { message: "Plane 1 is suppressed: turn it back on to mirror across it" });
  const rolled = { ...d0, timeline: { ...d0.timeline, marker: "feature-1" } };
  assert.throws(() => insertDuplicates(rolled, ["body:feature-1"], `construct:${plane}`), { message: "Plane 1 comes after the rollback marker, so a Mirror put in at the marker can't use it" });
  // An origin plane's Mirror is as before: one input, the old words.
  const xy = insertDuplicates(d0, ["body:feature-1"], "XY").doc.timeline.features.at(-1)!;
  assert.deepEqual(xy.dependsOn, ["feature-1"]);
  assert.equal(duplicateSummary("Box 1", "XY"), "Mirror of Box 1 across the XY plane");
});

test("the data: a Mirror across a construction plane reads back; every break of it is refused in words", async () => {
  const { doc: d0, plane } = await boxAndPlane();
  const { doc, ids } = insertDuplicates(d0, ["body:feature-1"], `construct:${plane}`);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
  const at = `Design duplicate ${ids[0]}`;
  const broken = (change: (p: Record<string, unknown>, f: Record<string, unknown>, d: Record<string, unknown>) => void) => () => {
    const d = JSON.parse(JSON.stringify(doc));
    const f = d.timeline.features.find((x: { id: string }) => x.id === ids[0]);
    change(f.intent.parameters, f, d);
    readDesignDocument(d);
  };
  assert.throws(broken((p) => (p.mirror = "construct:feature-1")), { message: `${at} mirrors across "construct:feature-1", which is not a construction plane before it in the timeline` });
  assert.throws(broken((p) => (p.mirror = "construct:")), { message: `${at} mirrors across "construct:", which is not an origin plane (XY, XZ or YZ) or a construction plane` });
  assert.throws(broken((_, f) => (f.dependsOn = ["feature-1"])), { message: `${at} must depend on exactly the item that made the body it mirrors (feature-1), then the construction it mirrors across (${plane})` });
  assert.throws(broken((_, f) => (f.dependsOn = [plane, "feature-1"])), { message: `${at} must depend on exactly the item that made the body it mirrors (feature-1), then the construction it mirrors across (${plane})` });
  // An axis is no plane to mirror across.
  const axis = insertConstruct(doc, "axis_along", { line: "X" }, undefined, AXIS);
  const moved = JSON.parse(JSON.stringify(axis.doc));
  const f = moved.timeline.features.find((x: { id: string }) => x.id === ids[0]);
  moved.timeline.features = [...moved.timeline.features.filter((x: { id: string }) => x.id !== ids[0]), f];
  f.intent.parameters.mirror = `construct:${axis.id}`;
  f.dependsOn = ["feature-1", axis.id];
  assert.throws(() => readDesignDocument(moved), { message: `${at} mirrors across "construct:${axis.id}", which is not a construction plane before it in the timeline` });
});

test("hand-worked: a sketch on a plane 5 mm above the box's top is drawn at z = 25 as XY is, and its extrude follows the box made 35 high", async () => {
  const start = await kernel.call("body_count");
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const d1 = await settled(d0);
  const s = addConstructSketch(d1, plane);
  const item = s.doc.timeline.features.find((f) => f.id === s.id)!;
  assert.equal(item.intent.parameters.plane, `construct:${plane}`);
  assert.deepEqual(item.dependsOn, [plane]);
  assert.equal(item.intent.summary, "Sketch 1 on Plane 1");
  // The plane z = 25 facing +z: its foot (0, 0, 25), x the world's X (X seen onto it is X itself), y = n × x = Y.
  assert.deepEqual(s.doc.sketches.at(-1)!.drawn, { origin: [0, 0, 25], xAxis: [1, 0, 0], normal: [0, 0, 1] });
  // A rectangle from (0, 0) to (10, 20) in the sketch is x 0..10, y 0..20 at z = 25; extruded 10 mm it is z 25..35.
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [10, 20]).doc;
  const ex = extrudeSketch(drawn, s.id, 10);
  const { build, box } = await boxes(ex.doc);
  near(box[bodyIdOf(ex.id)], [0, 0, 25, 10, 20, 35], "extrude on the plane");
  const placed = status(build, s.id) as Extract<FeatureResult, { status: "built" }>;
  assert.equal(placed.plane, undefined, "found: no warning");
  // The box made 35 high: the plane z = 40, the extrude z 40..50, the same x and y.
  const taller = changePreset(ex.doc, "feature-1", "box", 40, 30, 35);
  near((await boxes(taller)).box[bodyIdOf(ex.id)], [0, 0, 40, 10, 20, 50], "extrude after the edit");
  // sketchPlane with the rebuild's placement, and without it (a file just opened): the frame drawn.
  near(sketchPlane(ex.doc, s.id).origin, [0, 0, 25], "drawn frame");
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("hand-worked: a sketch on a tilted plane turns with it the shortest way, never spinning", async () => {
  // A plane at 30° to XY about the X axis: normal (0, −sin 30°, cos 30°), through the origin, so its foot is the origin.
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "angle_plane", { plane: "XY", line: "X" }, 30, PLANE);
  const d1 = await settled(d0);
  const s = addConstructSketch(d1, plane);
  const frame = s.doc.sketches.at(-1)!.drawn!;
  const n = (d1.timeline.features[1].intent.parameters.answer as { normal: number[] }).normal;
  // The kernel turns XY's normal about X: it stays square to X, |n_z| = cos 30°.
  assert.ok(Math.abs(n[0]) < 1e-12 && Math.abs(Math.abs(n[2]) - Math.cos(Math.PI / 6)) < 1e-12, `normal ${n}`);
  // X is square to the normal, so X seen onto the plane is X itself.
  near(frame.xAxis, [1, 0, 0], "x");
  // A point (10, 0) of the sketch is (10, 0, 0) in the world; extruded 10 mm, a 10 × 10 square's far cap is 10 along n.
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const ex = extrudeSketch(drawn, s.id, 10);
  const { box } = await boxes(ex.doc);
  const b = box[bodyIdOf(ex.id)];
  near([b[0], b[3]], [0, 10], "x along X, unturned");
  // y runs along n × X = (0, cos 30°, sin 30°)·sign: the square spans 10 cos 30° in y and 10 sin 30° in z, plus the 10 along n.
  const spanY = b[4] - b[1];
  const spanZ = b[5] - b[2];
  assert.ok(Math.abs(spanY - (10 * Math.cos(Math.PI / 6) + 10 * Math.sin(Math.PI / 6))) < 1e-9, `y span ${spanY}`);
  assert.ok(Math.abs(spanZ - (10 * Math.sin(Math.PI / 6) + 10 * Math.cos(Math.PI / 6))) < 1e-9, `z span ${spanZ}`);
  // The plane tilted to 60°: the sketch turns with it about X (the shortest way from the old normal to the new), so x
  // stays X and the spans swap their sines and cosines: y 10 cos 60° + 10 sin 60°, z the same.
  const steeper = { ...ex.doc, timeline: { ...ex.doc.timeline, features: ex.doc.timeline.features.map((f) => (f.id === plane ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, angle: 60 } } } : f)) } };
  const b2 = (await boxes(steeper)).box[bodyIdOf(ex.id)];
  near([b2[0], b2[3]], [0, 10], "x still along X");
  const s60 = 10 * Math.cos(Math.PI / 3) + 10 * Math.sin(Math.PI / 3);
  assert.ok(Math.abs(b2[4] - b2[1] - s60) < 1e-9 && Math.abs(b2[5] - b2[2] - s60) < 1e-9, `spans ${b2}`);
});

test("a sketch on a construction plane: greyed with it; with it deleted it stays where it was, its plane lost, and so does its extrude", async () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const s = addConstructSketch(await settled(d0), plane);
  const ex = extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [10, 20]).doc, s.id, 10);
  const off = suppressItem(ex.doc, plane, true);
  const offBuild = (await boxes(off)).build;
  assert.deepEqual(status(offBuild, s.id), { status: "greyed", by: plane });
  assert.deepEqual(status(offBuild, ex.id), { status: "greyed", by: plane });
  assert.equal(greyedBy(off, off.timeline.features.find((f) => f.id === ex.id)!), plane);
  const words = deleteWords(ex.doc, deleteItem(ex.doc, plane), plane);
  assert.ok(words !== null && /Sketch 1 is drawn on Plane 1/.test(words.words) && /stays where it is and shows its plane is lost/.test(words.words), JSON.stringify(words));
  const gone = deleteItem(ex.doc, plane);
  const { build, box } = await boxes(gone);
  const r = status(build, s.id) as Extract<FeatureResult, { status: "built" }>;
  assert.equal(r.status, "built");
  assert.deepEqual(r.plane, { cause: "plane-lost", face: `construct:${plane}`, message: "Sketch 1's construction plane was deleted, so its plane is lost: it stays where it was" });
  near(box[bodyIdOf(ex.id)], [0, 0, 25, 10, 20, 35], "the extrude stays where the plane was");
  assert.equal(status(build, ex.id).status, "built");
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(gone))), gone);
  // Dragged before its plane: refused in words.
  assert.deepEqual(reorderItem(ex.doc, s.id, 1), { refused: "before-dependency", message: "Sketch 1 can't go before Plane 1: it is drawn on Plane 1" });
});

test("addConstructSketch refuses anything but an on construction plane before the marker, in words", async () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const axis = insertConstruct(d0, "axis_along", { line: "X" }, undefined, AXIS);
  assert.throws(() => addConstructSketch(axis.doc, axis.id), { message: "Axis 1 is an axis, not a plane: pick a plane or a face to sketch on." });
  assert.throws(() => addConstructSketch(d0, "feature-9"), { message: "That construction is no longer in the design: pick another plane or a face." });
  assert.throws(() => addConstructSketch(d0, "feature-1"), { message: "That construction is no longer in the design: pick another plane or a face." });
  assert.throws(() => addConstructSketch(suppressItem(d0, plane, true), plane), { message: "Plane 1 is suppressed: turn it back on to sketch on it." });
  assert.throws(() => addConstructSketch({ ...d0, timeline: { ...d0.timeline, marker: "feature-1" } }, plane), { message: "Plane 1 comes after the rollback marker, so a sketch put in at the marker can't be on it" });
});

test("the data: a sketch on a construction plane reads back; every break of it is refused in words", async () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const { doc, id } = addConstructSketch(await settled(d0), plane);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
  const at = `Design sketch ${id}`;
  const broken = (change: (content: Record<string, unknown>, f: Record<string, unknown>, d: Record<string, unknown>) => void) => () => {
    const d = JSON.parse(JSON.stringify(doc));
    change(d.sketches.find((x: { id: string }) => x.id === id), d.timeline.features.find((x: { id: string }) => x.id === id), d);
    readDesignDocument(d);
  };
  assert.throws(broken((c) => delete c.drawn), { message: `${at} is on a construction plane but has no frame it was drawn with` });
  assert.throws(broken((c) => (c.drawn = { origin: [0, 0, 0], xAxis: [0, 0, 1], normal: [0, 0, 1] })), { message: `${at}'s frame has no frame: its normal is nothing or its xAxis lies along it` });
  assert.throws(broken((c) => (c.face = { frame: c.drawn, side: 1 })), { message: `${at} is on a construction plane but keeps a face's frame` });
  assert.throws(broken((_, f) => (f.dependsOn = [])), { message: `${at} is on construction ${plane} but does not depend on it` });
  assert.throws(broken((_, f) => (((f.intent as Record<string, Record<string, unknown>>).parameters.plane = "construct:feature-1"), (f.dependsOn = ["feature-1"]))), { message: `${at} is on "construct:feature-1", which is not a construction plane before it in the timeline` });
  // A sketch on an origin plane keeps no construction frame.
  assert.throws(broken((_, f) => (((f.intent as Record<string, Record<string, unknown>>).parameters.plane = "XY"), (f.dependsOn = []))), { message: `${at} is on "XY" but keeps a construction plane's frame` });
  // An axis is no plane to sketch on.
  const axis = insertConstruct(d0, "axis_along", { line: "X" }, undefined, AXIS);
  const onAxis = JSON.parse(JSON.stringify(addConstructSketch(await settled(d0), plane).doc));
  onAxis.timeline.features.splice(2, 0, axis.doc.timeline.features.at(-1));
  onAxis.nextId = 10;
  const sk = onAxis.timeline.features.find((x: { id: string }) => x.id === id);
  sk.intent.parameters.plane = `construct:${axis.id}`;
  sk.dependsOn = [axis.id];
  assert.throws(() => readDesignDocument(onAxis), { message: `${at} is on "construct:${axis.id}", which is not a construction plane before it in the timeline` });
});

test("constructXAxis: X seen onto the plane, or Y when X is within 30° of the normal (0.9× and 1.1× of the half-length threshold)", () => {
  // XY-like, XZ-like and YZ-like planes are drawn as those origin planes are.
  near(constructXAxis([0, 0, 1]), [1, 0, 0], "XY");
  near(constructXAxis([0, -1, 0]), [1, 0, 0], "XZ");
  near(constructXAxis([1, 0, 0]), [0, 1, 0], "YZ");
  // X seen onto a plane with normal (cos a, sin a, 0) is (sin² a, −sin a cos a, 0), of length |sin a|. The switch is at
  // length 0.5, a = 30°. At 0.9 × 0.5 = 0.45 (a = asin 0.45) Y is taken; at 1.1 × 0.5 = 0.55 still X.
  const at = (len: number) => {
    const a = Math.asin(len);
    return constructXAxis([Math.cos(a), Math.sin(a), 0]);
  };
  const short = at(0.45);
  // Y seen onto it: (−sin a cos a, cos² a, 0) / |cos a| = (−sin a, cos a, 0), with sin a = 0.45.
  near(short, [-0.45, Math.sqrt(1 - 0.45 ** 2), 0], "0.9 ×: Y");
  const long = at(0.55);
  // X seen onto it, made unit: (sin a, −cos a, 0), with sin a = 0.55.
  near(long, [0.55, -Math.sqrt(1 - 0.55 ** 2), 0], "1.1 ×: X");
});

test("hand-worked: mirrorMap reflects a point and a normal across a slanted construction plane", async () => {
  // A plane through (1, 2, 3), (4, 2, 3) and (1, 5, 7): normal ∝ (3,0,0) × (0,3,4) = (0, −12, 9) → (0, −0.8, 0.6) or its negative.
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "plane_through_points", { first: "O", second: "O", third: "O" }, undefined, PLANE);
  const answer: ConstructAnswer = { kind: "plane", point: [0, 2 * 0.8 * 0.8 - 3 * 0.6 * 0.8, -2 * 0.8 * 0.6 + 3 * 0.6 * 0.6], normal: [0, -0.8, 0.6], near: [1, 2, 3] };
  // The foot of the origin: (n·q) n with q = (1, 2, 3), n·q = −1.6 + 1.8 = 0.2, so (0, −0.16, 0.12).
  near(answer.point, [0, -0.16, 0.12], "foot by hand");
  const doc = { ...d0, timeline: { ...d0.timeline, features: d0.timeline.features.map((f) => (f.id === plane ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, answer } } } : f)) } };
  const map = mirrorMap(doc, `construct:${plane}`)!;
  // (1, 2, 3) lies on the plane: it stays.
  near(map([1, 2, 3], false), [1, 2, 3], "a point on it");
  // The origin: −2 (n·0 − 0.2) n = 0.4 n = (0, −0.32, 0.24).
  near(map([0, 0, 0], false), [0, -0.32, 0.24], "the origin");
  // A direction along n turns round; one in the plane stays.
  near(map([0, -0.8, 0.6], true), [0, 0.8, -0.6], "the normal");
  near(map([1, 0, 0], true), [1, 0, 0], "X, in the plane");
  // The kernel's mirror of the box's corner (40, 30, 20) agrees: n·(c − q) = −0.8·28 + 0.6·17 = −12.2, c + 24.4 n.
  const corner = map([40, 30, 20], false);
  near(corner, [40, 30 - 24.4 * 0.8, 20 + 24.4 * 0.6], "box corner");
  assert.equal(mirrorMap(deleteItem(doc, plane), `construct:${plane}`), null);
});

test("mirrorMap agrees with the kernel's Mirror across a tilted plane: every corner of the box lands on a corner of its mirror", async () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "angle_plane", { plane: "XZ", line: "Z" }, 20, PLANE);
  const d1 = await settled(d0);
  const { doc, ids } = insertDuplicates(d1, ["body:feature-1"], `construct:${plane}`);
  const map = mirrorMap(doc, `construct:${plane}`)!;
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const source = (await cache.view(build.bodies["body:feature-1"].handle)).vertex_points;
    const copy = (await cache.view(build.bodies[bodyIdOf(ids[0])].handle)).vertex_points;
    assert.equal(copy.length, 8);
    for (const p of source) {
      const q = map(p, false);
      assert.ok(copy.some((c) => c.every((x, i) => Math.abs(x - q[i]) < 1e-9)), `${p} mirrored to ${q}, not a corner of the copy`);
    }
  } finally {
    await cache.close();
  }
});

test("eyes: a construction's own and the Construction folder's hide it from the view and from Create sketch; the data keeps them", async () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const doc = await settled(d0);
  assert.deepEqual(drawnConstructs(doc, null).map((d) => d.item), [plane]);
  const tree = browserTree(doc);
  const folder = tree.find((n) => n.id === "constructions")!;
  assert.equal(folder.label, "Construction");
  assert.deepEqual(folder.children!.map((n) => [n.id, n.label, n.icon, n.hidden]), [[`constructions/${plane}`, "Plane 1", "plane", false]]);
  assert.equal(eyeId(doc, `constructions/${plane}`), plane);
  assert.equal(rowItem(`constructions/${plane}`, doc), plane);
  // No construction: no folder, as before 59.
  assert.equal(browserTree(partDocument("box", 40, 30, 20)).some((n) => n.id === "constructions"), false);
  const shut = hideRow(doc, plane, true);
  assert.deepEqual(shut.hidden, [plane]);
  assert.equal(constructHidden(shut, plane), true);
  assert.deepEqual(drawnConstructs(shut, null), []);
  assert.equal(browserTree(shut).find((n) => n.id === "constructions")!.children![0].hidden, true);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(shut))), shut);
  assert.equal(hideRow(shut, plane, false).hidden, undefined);
  const folderShut = hideRow(doc, EYE_FOLDERS.constructions, true);
  assert.deepEqual(folderShut.hidden, [EYE_FOLDERS.constructions]);
  assert.deepEqual(drawnConstructs(folderShut, null), []);
  assert.equal(browserTree(folderShut).find((n) => n.id === "constructions")!.children![0].folderHidden, true);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(folderShut))), folderShut);
  // Hidden, it is still built and still used: a Mirror across it builds.
  const mirrored = insertDuplicates(shut, ["body:feature-1"], `construct:${plane}`);
  assert.equal(status((await boxes(mirrored.doc)).build, mirrored.ids[0]).status, "built");
  // Deleted, its eye goes too.
  assert.equal(deleteItem(shut, plane).hidden, undefined);
});

test("version 28 (59a3): version 27 data using a construction plane, a Mirror across one or a construction's eye is refused; without, it opens as 28", async () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const settledDoc = await settled(d0);
  const as27 = (d: DesignDocument) => ({ ...JSON.parse(JSON.stringify(d)), version: 27 });
  const refused = (what: string) => ({ message: "Design data says version 27 but uses a construction plane or its eye, which version 28 brought", what });
  // A plane alone, no sketch on it, no Mirror, no eye: 26 brought it, so version 27 data with it opens as 28.
  assert.equal(readDesignDocument(as27(settledDoc)).version, 28);
  const sketched = addConstructSketch(settledDoc, plane).doc;
  assert.throws(() => readDesignDocument(as27(sketched)), { message: refused("sketch").message });
  // Its `drawn` alone is enough: a version 27 reader never wrote it (the plane put back to XY, so only `drawn` says 28).
  const drawnOnly = as27(sketched);
  const sk = drawnOnly.timeline.features.at(-1);
  sk.intent.parameters.plane = "XY";
  sk.dependsOn = [];
  assert.throws(() => readDesignDocument(drawnOnly), { message: refused("drawn").message });
  const mirrored = insertDuplicates(settledDoc, ["body:feature-1"], `construct:${plane}`).doc;
  assert.throws(() => readDesignDocument(as27(mirrored)), { message: refused("mirror").message });
  // A Mirror across an origin plane is version 12's: still opens.
  assert.equal(readDesignDocument(as27(insertDuplicates(settledDoc, ["body:feature-1"], "XY").doc)).version, 28);
  assert.throws(() => readDesignDocument(as27(hideRow(settledDoc, plane, true))), { message: refused("eye").message });
  assert.throws(() => readDesignDocument(as27(hideRow(settledDoc, EYE_FOLDERS.constructions, true))), { message: refused("folder").message });
  // Another eye (the Bodies folder's) is older than 28: still opens.
  assert.equal(readDesignDocument(as27(hideRow(settledDoc, EYE_FOLDERS.bodies, true))).version, 28);
  // Each read back at 28 as saved.
  for (const d of [sketched, mirrored, hideRow(settledDoc, plane, true)]) assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(d))), d);
});
