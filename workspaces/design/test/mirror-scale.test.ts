// Scale and Mirror body (step 35e2, on the kernel's scale and mirror
// motions, kernel 0.33.40). Scale is a Move that sizes its bodies by a
// factor about the pivot (`scale` in the Move's numbers, left out when 1);
// Mirror body is a Duplicate whose copy is mirrored across an origin plane
// (`mirror`). Checked here: the document changes and their words, the
// reader's checks (each broken one way), the panel's box reader, the
// preview's arithmetic, the body frame a face sketch is carried by, and
// the bodies the real rebuild builds on the real kernel, worked by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec, Motion } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { duplicateSummary, insertDuplicates, MIRROR_STEP, mirrorMotion, mirrorOf } from "../src/duplicate.ts";
import { editFeature } from "../src/feature-edit.ts";
import { changedMove, factorOf, insertMove, moveKindOf, moveMotions, moveSummary, moveValues, NO_MOVE, SCALE_STEP } from "../src/move.ts";
import { movedPoint, previewable, readMoveBoxes, unmovedPoint } from "../src/move-tool.ts";
import { bodyFrame } from "../src/face-sketch.ts";
import { featureNames } from "../src/naming.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { comingItems } from "../src/coming-soon.ts";

const kernel = nodeKernel();
const item = (d: DesignDocument, id: string) => d.timeline.features.find((f) => f.id === id)!;
const box = (): DesignDocument => partDocument("box", 40, 30, 20); // Box 1, feature-1: x 0..40, y 0..30, z 0..20
const roundTrip = (d: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(d)));

async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const view = async (body: string) => cache.view(build.bodies[body].handle);
  return { build, view, close: () => cache.close() };
}

function nearBox(got: readonly (readonly number[])[], want: number[][], what: string, within = 1e-9) {
  for (const k of [0, 1]) for (const a of [0, 1, 2]) assert.ok(Math.abs(got[k][a] - want[k][a]) <= within, `${what}: ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// ---------------------------------------------------------------- Scale

test("a new Scale by hand: named Scale 1, its factor in the file only when it scales, its words, and it opens as Scale", () => {
  const { doc, id } = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 2 }, "scale");
  const f = item(doc, id);
  assert.equal(f.provenance.self.label, "Scale 1");
  assert.deepEqual(f.intent.parameters, { ...NO_MOVE, scale: 2, bodies: ["body:feature-1"] });
  assert.equal(f.intent.summary, "Scale Box 1 by 2× about (0, 0, 0) mm");
  assert.equal(moveKindOf(f), "scale");
  assert.deepEqual(moveValues(f), { ...NO_MOVE, scale: 2 });
  assert.equal(SCALE_STEP, "Scale bodies");
  assert.deepEqual(roundTrip(doc), doc);
  // A Scale of 1 (nothing typed yet) writes no factor, so the file is what an older Move's was; it still opens as Scale by its words.
  const idle = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 1 }, "scale");
  const g = item(idle.doc, idle.id);
  assert.equal(Object.hasOwn(g.intent.parameters, "scale"), false);
  assert.equal(g.intent.summary, "Scale Box 1 (not scaled yet)");
  assert.equal(moveKindOf(g), "scale");
  // A second Scale counts the Scales, a Move after them the Moves.
  const two = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, scale: 3 }, "scale").doc;
  const moved = insertMove(two, ["body:feature-1"], { ...NO_MOVE, x: 5 });
  assert.deepEqual(two.timeline.features.map((x) => x.provenance.self.label), ["Box 1", "Scale 1", "Scale 2"]);
  assert.equal(item(moved.doc, moved.id).provenance.self.label, "Move 1");
  // A factor of 0 or less, or not a number, is refused before anything changes.
  assert.throws(() => insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 0 }, "scale"), { message: "a scale needs a factor above 0, not 0" });
  assert.throws(() => insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: -2 }, "scale"), { message: "a scale needs a factor above 0, not -2" });
  assert.throws(() => insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: Number.NaN }, "scale"), { message: "a scale needs a factor above 0, not NaN" });
});

test("a Move's words say a scale wherever it is: shifted and scaled, turned and scaled", () => {
  assert.equal(moveSummary(["Box 1"], { ...NO_MOVE, x: 10, scale: 0.5, pivotX: 20 }), "Move Box 1 by (10, 0, 0) mm, scaled 0.5× about (20, 0, 0) mm");
  assert.equal(moveSummary(["Box 1", "Box 2"], { ...NO_MOVE, turnZ: 90, scale: 2 }, "Scale"), "Scale 2 bodies by 2× about (0, 0, 0) mm, turned 90° about Z");
  assert.equal(moveSummary(["Box 1"], { ...NO_MOVE, x: 1, scale: 2 }, "Scale"), "Scale Box 1 by 2× about (0, 0, 0) mm, moved by (1, 0, 0) mm");
  // Older Moves' words are as they were.
  assert.equal(moveSummary(["Box 1"], { ...NO_MOVE, x: 10, turnZ: 90 }), "Move Box 1 by (10, 0, 0) mm, turned 90° about Z");
  assert.equal(moveSummary(["Box 1"], NO_MOVE, "Rotate"), "Rotate Box 1 (not turned yet)");
});

test("changedMove changes a Scale's factor (back to 1 drops it), and the same factor changes nothing", () => {
  const { doc, id } = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 2 }, "scale");
  assert.equal(changedMove(doc, id, { ...NO_MOVE, scale: 2 }), doc, "nothing changed");
  const bigger = changedMove(doc, id, { ...NO_MOVE, scale: 3 });
  assert.equal(item(bigger, id).intent.parameters.scale, 3);
  assert.equal(item(bigger, id).intent.summary, "Scale Box 1 by 3× about (0, 0, 0) mm");
  const none = changedMove(doc, id, NO_MOVE);
  assert.equal(Object.hasOwn(item(none, id).intent.parameters, "scale"), false);
  assert.equal(item(none, id).intent.summary, "Scale Box 1 (not scaled yet)", "still a Scale by its words");
  assert.throws(() => changedMove(doc, id, { ...NO_MOVE, scale: 0 }), { message: "a scale needs a factor above 0, not 0" });
});

test("hand-worked: what the kernel is asked, in order: the turns, then the scale about the pivot, then the shift", () => {
  assert.deepEqual(moveMotions({ ...NO_MOVE, scale: 2, pivotX: 5 }), [{ scale: { about: [5, 0, 0], factor: 2 } }]);
  const q = Math.PI / 2;
  assert.deepEqual(moveMotions({ ...NO_MOVE, x: 1, turnZ: 90, scale: 2 }), [{ turn: { pivot: [0, 0, 0], axis: [0, 0, 1], angle: q } }, { scale: { about: [0, 0, 0], factor: 2 } }, { move: [1, 0, 0] }]);
  assert.deepEqual(moveMotions({ ...NO_MOVE, scale: 1 }), [], "a scale of 1 asks nothing");
  assert.equal(factorOf(NO_MOVE), 1);
});

test("hand-worked: the preview's point map scales about the pivot after the turns, and undoes it exactly", () => {
  // (40, 30, 20) turned 90° about Z through the origin: (a, b) → (−b, a) gives (−30, 40, 20); twice as far from the
  // origin: (−60, 80, 40); then shifted (1, 0, 0): (−59, 80, 40).
  const v = { ...NO_MOVE, x: 1, turnZ: 90, scale: 2 };
  const p = movedPoint([40, 30, 20], v);
  [-59, 80, 40].forEach((want, k) => assert.ok(Math.abs(p[k] - want) < 1e-12, `${p}`));
  // A normal is only turned: a scale above 0 turns no direction. (1, 0, 0) turned 90° is (0, 1, 0).
  const n = movedPoint([1, 0, 0], v, true);
  [0, 1, 0].forEach((want, k) => assert.ok(Math.abs(n[k] - want) < 1e-12, `${n}`));
  // Scaled by 0.5 about the box's middle (20, 15, 10): the corner (40, 30, 20) comes halfway in, (30, 22.5, 15).
  assert.deepEqual(movedPoint([40, 30, 20], { ...NO_MOVE, scale: 0.5, pivotX: 20, pivotY: 15, pivotZ: 10 }), [30, 22.5, 15]);
  const back = unmovedPoint(p, v);
  [40, 30, 20].forEach((want, k) => assert.ok(Math.abs(back[k] - want) < 1e-12, `${back}`));
  // A factor past a billion times either way isn't drawn (the kernel refuses it all told); a billion is.
  assert.equal(previewable({ ...NO_MOVE, scale: 1e9 }), true);
  assert.equal(previewable({ ...NO_MOVE, scale: 1e-9 }), true);
  assert.equal(previewable({ ...NO_MOVE, scale: 1.1e9 }), false);
  assert.equal(previewable({ ...NO_MOVE, scale: 0.9e-9 }), false);
});

test("the panel's factor box: empty scales by 1, a number above 0 is the factor, 0, a minus or text is not", () => {
  const typed = (scale: string) => ({ x: "0", y: "0", z: "0", turnX: "0", turnY: "0", turnZ: "0", pivotX: "0", pivotY: "0", pivotZ: "0", scale });
  assert.deepEqual(readMoveBoxes(typed("")), { values: NO_MOVE });
  assert.deepEqual(readMoveBoxes(typed("1")), { values: NO_MOVE });
  assert.deepEqual(readMoveBoxes(typed(" 2.5 ")), { values: { ...NO_MOVE, scale: 2.5 } });
  assert.deepEqual(readMoveBoxes(typed("0")), { bad: "scale" });
  assert.deepEqual(readMoveBoxes(typed("-2")), { bad: "scale" });
  assert.deepEqual(readMoveBoxes(typed("?")), { bad: "scale" });
  // A panel without the box (an older caller) reads as before.
  const { scale: _, ...old } = typed("");
  assert.deepEqual(readMoveBoxes(old), { values: NO_MOVE });
});

test("the reader takes a Scale as written and refuses its factor broken in each way, saying how", () => {
  const good = JSON.parse(JSON.stringify(insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 2 }, "scale").doc));
  assert.equal(readDesignDocument(good).timeline.features[1].intent.parameters.scale, 2);
  const broken = (scale: unknown) => {
    const d = JSON.parse(JSON.stringify(good));
    d.timeline.features[1].intent.parameters.scale = scale;
    return d;
  };
  for (const bad of [0, -1, 1, "2", null]) assert.throws(() => readDesignDocument(broken(bad)), { message: `Design move feature-2: scale ${bad === "2" ? '"2"' : String(bad)} is not a number above 0 other than 1` }, String(bad));
  // A number a Move never had is still refused.
  const odd = JSON.parse(JSON.stringify(good));
  odd.timeline.features[1].intent.parameters.squash = 2;
  assert.throws(() => readDesignDocument(odd), { message: 'Design move feature-2 has a number "squash" a move doesn\'t have' });
});

test("hand-worked on the real kernel: Scale sizes the box about the pivot, follows its sizes, and is refused past the limits in words", async () => {
  // Twice the 40 × 30 × 20 box about the origin: x 0..80, y 0..60, z 0..40, 8 times the volume: 192,000 mm³.
  const twice = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 2 }, "scale").doc;
  const a = await built(twice);
  try {
    assert.equal(a.build.results["feature-2"].status, "built");
    nearBox((await a.view("body:feature-1")).bounds, [[0, 0, 0], [80, 60, 40]], "twice");
    assert.ok(Math.abs((await a.view("body:feature-1")).volume - 192_000) < 1e-6);
  } finally {
    await a.close();
  }
  // Half about its middle (20, 15, 10): every corner halfway in, x 10..30, y 7.5..22.5, z 5..15; volume an eighth, 3,000 mm³.
  const half = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 0.5, pivotX: 20, pivotY: 15, pivotZ: 10 }, "scale").doc;
  const b = await built(half);
  try {
    nearBox((await b.view("body:feature-1")).bounds, [[10, 7.5, 5], [30, 22.5, 15]], "half");
    assert.ok(Math.abs((await b.view("body:feature-1")).volume - 3_000) < 1e-6);
  } finally {
    await b.close();
  }
  // Turned 90° about Z, twice the size, then shifted 1 along X (the preview's corner above): x −59..1, y 0..80, z 0..40.
  const all = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, x: 1, turnZ: 90, scale: 2 }).doc;
  const c = await built(all);
  try {
    nearBox((await c.view("body:feature-1")).bounds, [[-59, 0, 0], [1, 80, 40]], "turned, scaled, shifted");
  } finally {
    await c.close();
  }
  // The box made 60 wide: the Scale follows, x 0..120.
  const wider = await built(editFeature(twice, "feature-1", { width: 60, depth: 30, height: 20 }));
  try {
    nearBox((await wider.view("body:feature-1")).bounds, [[0, 0, 0], [120, 60, 40]], "wider");
  } finally {
    await wider.close();
  }
  // Past the kernel's limits: 1e5 times is 4 km across, past the 1 km a body may be; a millionth makes it 40 nm, under a micrometre.
  // The rebuild gives the kernel's own words: what the factor did, which size broke which limit, and by how much.
  const words = { 100000: "scaled by 100000 overall, width must be between 0.001 and 1000000 mm, got 4000000", 0.000001: "scaled by 0.000001 overall, width must be between 0.001 and 1000000 mm, got 0.000039999999999999996" };
  for (const factor of [1e5, 1e-6] as const) {
    const far = await built(insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: factor }, "scale").doc);
    try {
      const r = far.build.results["feature-2"];
      assert.equal(r.status, "failed", String(factor));
      assert.equal((r as { message: string }).message, words[factor], String(factor));
    } finally {
      await far.close();
    }
  }
});

test("hand-worked: a face sketch's body frame moves with a scale (its origin, and its size) and turns over with a mirror", () => {
  const SHAPE = { box: { size: [40, 30, 20] } } as unknown as BodySpec;
  const movedBy = (moves: Motion[]): BodySpec => ({ moved: { body: SHAPE as never, moves } });
  // Twice as far from (10, 0, 0): the origin, 10 from it on the minus side, ends 20 from it: (−10, 0, 0). Axes as they were (unit).
  // SL #539 (the owner's rule, 2026-11-11): the frame also records the body's size, 2, so a sketch on it can scale its position.
  assert.deepEqual(bodyFrame(movedBy([{ scale: { about: [10, 0, 0], factor: 2 } }])), { origin: [-10, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1], size: 2 });
  // Then halved about (−10, 0, 0) itself: the origin stays, the size is 2 × 0.5 = 1 again, so none is written.
  assert.deepEqual(bodyFrame(movedBy([{ scale: { about: [10, 0, 0], factor: 2 } }, { scale: { about: [-10, 0, 0], factor: 0.5 } }])), { origin: [-10, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] });
  // Shifted to (5, 0, 0), then mirrored in the YZ plane: (−5, 0, 0), x reversed, the normal (in the plane) kept.
  const m = bodyFrame(movedBy([{ move: [5, 0, 0] }, mirrorMotion("YZ")]))!;
  assert.deepEqual([m.origin, m.xAxis, m.normal].map((v) => v.map((x) => x + 0)), [[-5, 0, 0], [-1, 0, 0], [0, 0, 1]]);
  // Mirrored in XY through the origin: the normal (0, 0, 1) goes to (0, 0, −1), x stays.
  const z = bodyFrame(movedBy([mirrorMotion("XY")]))!;
  assert.deepEqual([z.origin, z.xAxis, z.normal].map((v) => v.map((x) => x + 0)), [[0, 0, 0], [1, 0, 0], [0, 0, -1]]);
});

// ---------------------------------------------------------------- Mirror body

test("Mirror body by hand: a Duplicate across an origin plane, named Mirror n, its words, and its refusals", () => {
  const d = insertPreset(box(), "cylinder", 10, 10, 10).doc;
  const { doc, ids } = insertDuplicates(d, ["body:feature-2", "body:feature-1"], "YZ");
  assert.deepEqual(ids, ["feature-3", "feature-4"]);
  const [a, b] = ids.map((id) => item(doc, id));
  assert.deepEqual([a.intent, a.dependsOn, a.provenance.self.label], [{ type: "duplicate", parameters: { body: "body:feature-2", mirror: "YZ" }, summary: "Mirror of Cylinder 1 across the YZ plane" }, ["feature-2"], "Mirror 1"]);
  assert.equal(b.provenance.self.label, "Mirror 2");
  assert.equal(mirrorOf(a), "YZ");
  assert.equal(MIRROR_STEP, "Mirror bodies");
  // A plain copy after them counts the copies: Copy 1.
  const copy = insertDuplicates(doc, ["body:feature-1"]);
  assert.equal(item(copy.doc, copy.ids[0]).provenance.self.label, "Copy 1");
  assert.equal(mirrorOf(item(copy.doc, copy.ids[0])), undefined);
  assert.equal(duplicateSummary("Box 1"), "Copy of Box 1");
  assert.deepEqual(roundTrip(doc), doc);
  assert.throws(() => insertDuplicates(d, [], "XY"), { message: "pick at least one body to mirror" });
  assert.throws(() => insertDuplicates(d, ["body:feature-1"], "AB" as never), { message: "AB is not an origin plane (XY, XZ or YZ)" });
  // No longer listed as coming soon.
  assert.equal(comingItems("Modify").some((i) => i.label === "Mirror body"), false);
});

test("the reader takes a Mirror as written and refuses its plane broken in each way, saying how", () => {
  const good = JSON.parse(JSON.stringify(insertDuplicates(box(), ["body:feature-1"], "XZ").doc));
  assert.equal(readDesignDocument(good).timeline.features[1].intent.parameters.mirror, "XZ");
  const broken = (mirror: unknown) => {
    const d = JSON.parse(JSON.stringify(good));
    d.timeline.features[1].intent.parameters.mirror = mirror;
    return d;
  };
  assert.throws(() => readDesignDocument(broken("xy")), { message: 'Design duplicate feature-2 mirrors across "xy", which is not an origin plane (XY, XZ or YZ)' });
  assert.throws(() => readDesignDocument(broken(3)), { message: "Design duplicate feature-2 mirrors across 3, which is not an origin plane (XY, XZ or YZ)" });
  assert.throws(() => readDesignDocument(broken(null)), { message: "Design duplicate feature-2 mirrors across null, which is not an origin plane (XY, XZ or YZ)" });
});

test("hand-worked on the real kernel: the mirrored copy is the box's mirror image, not inside out, named by the Mirror, following its sizes", async () => {
  // Box 1 shifted 10 along X (x 10..50), then mirrored across YZ (x → −x): x −50..−10, y and z as they were.
  const moved = insertMove(box(), ["body:feature-1"], { ...NO_MOVE, x: 10 }).doc;
  const across = insertDuplicates(moved, ["body:feature-1"], "YZ").doc; // Mirror 1 is feature-3
  const a = await built(across);
  try {
    assert.equal(a.build.results["feature-3"].status, "built");
    const v = await a.view("body:feature-3");
    nearBox(v.bounds, [[-50, 0, 0], [-10, 30, 20]], "across YZ");
    // Its volume is the box's, 40 · 30 · 20 = 24,000 mm³, and above 0: a body turned inside out would measure minus that.
    assert.ok(Math.abs(v.volume - 24_000) < 1e-6, `${v.volume}`);
    // The box itself stays where Move 1 put it.
    nearBox((await a.view("body:feature-1")).bounds, [[10, 0, 0], [50, 30, 20]], "source");
    // The copy's faces have the box's own names (the Left face stays Left, on the other hand), under the Mirror (its feature).
    const copy = a.build.bodies["body:feature-3"];
    const source = a.build.bodies["body:feature-1"];
    const names = featureNames(copy.feature, { spec: copy.spec!, curves: copy.curves }, v);
    const sourceNames = featureNames(source.feature, { spec: source.spec!, curves: source.curves }, await a.view("body:feature-1"));
    assert.equal(copy.feature, "feature-3");
    assert.deepEqual(names.faces, sourceNames.faces);
  } finally {
    await a.close();
  }
  // Across XY (z → −z): z −20..0. Across XZ (y → −y): y −30..0.
  for (const [plane, want] of [["XY", [[10, 0, -20], [50, 30, 0]]], ["XZ", [[10, -30, 0], [50, 0, 20]]]] as const) {
    const b = await built(insertDuplicates(moved, ["body:feature-1"], plane).doc);
    try {
      const v = await b.view("body:feature-3");
      nearBox(v.bounds, want as unknown as number[][], plane);
      assert.ok(Math.abs(v.volume - 24_000) < 1e-6, `${plane}: ${v.volume}`);
    } finally {
      await b.close();
    }
  }
  // Box 1 made 60 wide: the mirror follows, x −70..−10.
  const wider = await built(editFeature(across, "feature-1", { width: 60, depth: 30, height: 20 }));
  try {
    nearBox((await wider.view("body:feature-3")).bounds, [[-70, 0, 0], [-10, 30, 20]], "wider");
  } finally {
    await wider.close();
  }
});

test("Design data version 12 brought Scale and Mirror: version 11 holding either is refused, naming both; without them it opens as 12", () => {
  const scaled = JSON.parse(JSON.stringify(insertMove(box(), ["body:feature-1"], { ...NO_MOVE, scale: 2 }, "scale").doc));
  const mirrored = JSON.parse(JSON.stringify(insertDuplicates(box(), ["body:feature-1"], "XY").doc));
  assert.equal(scaled.version, 16);
  for (const d of [scaled, mirrored]) assert.throws(() => readDesignDocument({ ...d, version: 11 }), { message: "Design data says version 11 but has a Scale or a Mirror, which version 12 brought" });
  // A version 11 Move that doesn't scale and a plain copy open as they were, read as version 13.
  const moved = JSON.parse(JSON.stringify(insertMove(box(), ["body:feature-1"], { ...NO_MOVE, x: 5 }).doc));
  const copied = JSON.parse(JSON.stringify(insertDuplicates(box(), ["body:feature-1"]).doc));
  for (const d of [moved, copied]) assert.equal(readDesignDocument({ ...d, version: 11 }).version, 16);
});
