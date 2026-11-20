// Step 59a3b: a Pattern round a construction axis. The axis is held by name
// ("construct:<id>", pattern-values.ts `TurnAxis`), the Pattern keeps no
// centre (the axis's line is where it turns), depends on its bodies' items
// then the axis (pattern.ts `insertPattern`, `changedPattern`), and the
// rebuild turns round the axis as answered in that build (rebuild.ts
// `patternRun`), greyed with it, failed in words when it is deleted or not
// built. Built on the real kernel; every place worked out by hand from the
// cube's corners: `partDocument("box", 10, 10, 10)` is x, y and z 0..10.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertConstruct } from "../src/construct.ts";
import type { ConstructAnswer } from "../src/construct-data.ts";
import { changePreset, DESIGN_VERSION, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedPattern, editablePattern, insertPattern, patternProblem, patternRequest, patternSummary, turnAxes, turnAxisProblem, type PatternValues } from "../src/pattern.ts";
import { deleteItem, moveMarker, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, followedDoc, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";

const kernel = nodeKernel();

const PLANE: ConstructAnswer = { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1], near: [0, 0, 0] };
const AXIS: ConstructAnswer = { kind: "axis", point: [0, 0, 0], direction: [1, 0, 0], near: [0, 0, 0] };
const RIGHT = "face:feature-1/right";
const TOP = "face:feature-1/top";
const BOTTOM = "face:feature-1/bottom";

async function settled(doc: DesignDocument): Promise<DesignDocument> {
  const cache = new BodyCache(kernel);
  try {
    return followedDoc(doc, await rebuildTimeline(doc, cache, kernel));
  } finally {
    await cache.close();
  }
}

/** The build, and each body's box [min x, min y, min z, max x, max y, max z] rounded to the nanometre, by body id. */
async function boxes(doc: DesignDocument): Promise<{ build: TimelineBuild; box: Record<string, number[]> }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const box: Record<string, number[]> = {};
    for (const [id, b] of Object.entries(build.bodies)) {
      const v = await cache.view(b.handle);
      box[id] = [...v.bounds[0], ...v.bounds[1]].map((x) => Math.round(x * 1e6) / 1e6 + 0);
    }
    return { build, box };
  } finally {
    await cache.close();
  }
}

/**
 * The cube, Plane 1 10 mm out from its right face (x = 10 + 10 = 20), and Axis 1 where Plane 1 meets the XZ plane (y = 0):
 * the line x = 20, y = 0, along z. Settled, so the design keeps the answers.
 */
async function cubeAndAxis(): Promise<{ doc: DesignDocument; plane: string; axis: string }> {
  const p = insertConstruct(partDocument("box", 10, 10, 10), "offset_plane", { plane: RIGHT }, 10, PLANE);
  const a = insertConstruct(p.doc, "axis_where_planes_meet", { first: `construct:${p.id}`, second: "XZ" }, undefined, AXIS);
  return { doc: await settled(a.doc), plane: p.id, axis: a.id };
}

const round = (axis: string, over: Partial<PatternValues> = {}): PatternValues => ({ kind: "circular", axis, count: 4, angle: 360, join: false, ...over }) as PatternValues;

const sorted = (bs: number[][]) => [...bs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test("hand-worked: 4 cubes over a full turn round the line x = 20, y = 0 land at x 10..20, 20..30 and 30..40", async () => {
  const start = await kernel.call("body_count");
  const { doc: d0, axis } = await cubeAndAxis();
  const { doc, id } = insertPattern(d0, ["body:feature-1"], round(`construct:${axis}`));
  const f = doc.timeline.features.find((x) => x.id === id)!;
  // Its body's item, then the axis; named in its from; no centre saved.
  assert.deepEqual(f.dependsOn, ["feature-1", axis]);
  assert.deepEqual(f.provenance.from.map((r) => r.label), ["Box 1", "Axis 1"]);
  assert.equal(f.intent.summary, "4 of Box 1 round Axis 1");
  assert.equal(Object.hasOwn(f.intent.parameters, "centre"), false);
  const { build, box } = await boxes(doc);
  assert.equal(build.results[id].status, "built");
  // Turning about (20, 0) by 90°: (x, y) → (20 − y, x − 20); by 180°: (40 − x, −y); by 270°: (20 + y, 20 − x).
  // The cube x 0..10, y 0..10 goes to x 10..20, y −20..−10; x 30..40, y −10..0; x 20..30, y 10..20. Which of the quarter
  // turns comes first follows the axis's direction (±z), so the three are compared as a set; z stays 0..10.
  const copies = [1, 2, 3].map((k) => box[`body:${id}/piece:${k}`]);
  assert.deepEqual(sorted(copies), [[10, -20, 0, 20, -10, 10], [20, 10, 0, 30, 20, 10], [30, -10, 0, 40, 0, 10]]);
  // The 180° copy is second either way round.
  assert.deepEqual(copies[1], [30, -10, 0, 40, 0, 10]);
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("hand-worked: one copy over 90° goes the way the axis points (counter-clockwise looking down it), and −90° the other way", async () => {
  const { doc: d0, axis } = await cubeAndAxis();
  const answer = (d0.timeline.features.find((f) => f.id === axis)!.intent.parameters.answer as Extract<ConstructAnswer, { kind: "axis" }>);
  // The axis lies along z, one way or the other: the kernel's choice, read here so the expected box follows from it.
  assert.equal(Math.abs(answer.direction[2]), 1);
  const up = answer.direction[2] > 0;
  // Counter-clockwise about +z by 90° about (20, 0): x 10..20, y −20..−10 (worked above); about −z it is clockwise: x 20..30, y 10..20.
  const ccw = [10, -20, 0, 20, -10, 10];
  const cw = [20, 10, 0, 30, 20, 10];
  const plus = insertPattern(d0, ["body:feature-1"], round(`construct:${axis}`, { count: 2, angle: 90 }));
  assert.deepEqual((await boxes(plus.doc)).box[`body:${plus.id}/piece:1`], up ? ccw : cw);
  const minus = insertPattern(d0, ["body:feature-1"], round(`construct:${axis}`, { count: 2, angle: -90 }));
  assert.deepEqual((await boxes(minus.doc)).box[`body:${minus.id}/piece:1`], up ? cw : ccw);
});

test("the copies follow the axis: the cube made 20 wide moves Plane 1 to x = 30, and the half-turn copy to x 40..60", async () => {
  const { doc: d0, axis } = await cubeAndAxis();
  const { doc, id } = insertPattern(d0, ["body:feature-1"], round(`construct:${axis}`, { count: 2 }));
  assert.deepEqual((await boxes(doc)).box[`body:${id}/piece:1`], [30, -10, 0, 40, 0, 10]);
  // Box 20 wide: its right face at x = 20, Plane 1 at 30, the axis x = 30, y = 0. Half a turn: (60 − x, −y), so x 0..20 → 40..60.
  const wider = changePreset(doc, "feature-1", "box", 20, 10, 10);
  assert.deepEqual((await boxes(wider)).box[`body:${id}/piece:1`], [40, -10, 0, 60, 0, 10]);
});

test("the axis deleted fails the Pattern in words; suppressed greys it by the axis; not built fails it as an input", async () => {
  const { doc: d0, axis } = await cubeAndAxis();
  const { doc, id } = insertPattern(d0, ["body:feature-1"], round(`construct:${axis}`));
  const gone = await boxes(deleteItem(doc, axis));
  assert.deepEqual(gone.build.results[id], { status: "failed", cause: "deleted-input", input: axis, message: "Axis 1 was deleted, so Pattern 1 has no axis to turn round" });
  assert.equal(Object.keys(gone.build.bodies).some((b) => b.startsWith(`body:${id}/`)), false, "no copy made");
  assert.deepEqual((await boxes(suppressItem(doc, axis, true))).build.results[id], { status: "greyed", by: axis });
  // The Pattern can't be dragged before the axis it turns round.
  const at = doc.timeline.features.findIndex((f) => f.id === axis);
  assert.deepEqual(reorderItem(doc, id, at), { refused: "before-dependency", message: "Pattern 1 can't go before Axis 1: it is built from Axis 1" });
  // An axis where the cube's top and bottom meet: never built (they are parallel), so the Pattern has no axis.
  const never = insertConstruct(partDocument("box", 10, 10, 10), "axis_where_planes_meet", { first: TOP, second: BOTTOM }, undefined, AXIS);
  const p = insertPattern(never.doc, ["body:feature-1"], round(`construct:${never.id}`));
  const r = (await boxes(p.doc)).build.results[p.id];
  assert.deepEqual(r, { status: "failed", cause: "failed-input", input: never.id, message: "Axis 1 is not built, so Pattern 1 has no axis to turn round" });
});

test("only a construction axis before it, not suppressed, can be turned round; a plane, a later axis and words for each", async () => {
  const { doc: d0, plane, axis } = await cubeAndAxis();
  assert.deepEqual(turnAxes(d0, d0.timeline.features.length).map((a) => [a.axis, a.label]), [[`construct:${axis}`, "Axis 1"]]);
  assert.equal(turnAxisProblem(d0, "Z", 0), null);
  assert.throws(() => insertPattern(d0, ["body:feature-1"], round(`construct:${plane}`)), { message: `"construct:${plane}" is not a construction axis in the design` });
  assert.throws(() => insertPattern(d0, ["body:feature-1"], round("construct:feature-99")), { message: '"construct:feature-99" is not a construction axis in the design' });
  // The marker before the axis: a Pattern put in there can't use it, and the list leaves it out.
  const before = moveMarker(d0, plane);
  assert.throws(() => insertPattern(before, ["body:feature-1"], round(`construct:${axis}`)), { message: "Axis 1 comes after the Pattern, so it can't turn round it" });
  assert.deepEqual(turnAxes(before, 2), []);
  const off = suppressItem(d0, axis, true);
  assert.throws(() => insertPattern(off, ["body:feature-1"], round(`construct:${axis}`)), { message: "Axis 1 is suppressed: turn it back on to pattern round it" });
  // A centre with a construction axis is a second answer to where it turns: refused.
  assert.equal(patternProblem(round(`construct:${axis}`, { centre: [0, 0, 0] } as Partial<PatternValues>)), "A construction axis says where it turns: a pattern round one has no centre.");
  assert.equal(patternProblem(round("W")), "W is not X, Y, Z or a construction axis.");
});

test("hand-worked request: round a construction axis the kernel turns about its point and direction; a full turn the other way flips it", () => {
  const axis: ConstructAnswer = { kind: "axis", point: [20, 0, 0], direction: [0, 0, 1], near: [20, 0, 5] };
  const v = round("construct:feature-3");
  assert.deepEqual(patternRequest(v, axis), { circular: { pivot: [20, 0, 0], axis: [0, 0, 1], count: 4 } });
  assert.deepEqual(patternRequest(round("construct:feature-3", { angle: -360 }), axis), { circular: { pivot: [20, 0, 0], axis: [-0, -0, -1], count: 4 } });
  // 90° is π/2 radians.
  assert.deepEqual(patternRequest(round("construct:feature-3", { count: 2, angle: 90 }), axis), { circular: { pivot: [20, 0, 0], axis: [0, 0, 1], count: 2, angle: Math.PI / 2 } });
  // No axis answered (or a plane's): refused, never guessed.
  assert.throws(() => patternRequest(v), /turned round with no axis answered/);
  assert.throws(() => patternRequest(v, PLANE), /turned round with no axis answered/);
  assert.equal(patternSummary(["Box 1"], round("construct:feature-3", { count: 3, angle: 90 }), "Axis 2"), "3 of Box 1 over 90° round Axis 2");
});

test("Edit feature changes what it turns round, and what it depends on with it; an unchanged edit records nothing", async () => {
  const { doc: d0, axis } = await cubeAndAxis();
  const { doc, id } = insertPattern(d0, ["body:feature-1"], { kind: "circular", axis: "Z", centre: [0, 0, 0], count: 4, angle: 360, join: false });
  const f = (d: DesignDocument) => d.timeline.features.find((x) => x.id === id)!;
  assert.deepEqual(f(doc).dependsOn, ["feature-1"]);
  const onAxis = changedPattern(doc, id, round(`construct:${axis}`));
  assert.deepEqual(f(onAxis).dependsOn, ["feature-1", axis]);
  assert.deepEqual(f(onAxis).provenance.from.map((r) => r.id), ["feature-1", axis]);
  assert.equal(f(onAxis).intent.summary, "4 of Box 1 round Axis 1");
  assert.deepEqual(editablePattern(onAxis, id).axisName, "Axis 1");
  assert.equal(changedPattern(onAxis, id, round(`construct:${axis}`)), onAxis, "nothing changed");
  // And back to Z through (5, 5, 0): the axis let go.
  const back = changedPattern(onAxis, id, { kind: "circular", axis: "Z", centre: [5, 5, 0], count: 4, angle: 360, join: false });
  assert.deepEqual(f(back).dependsOn, ["feature-1"]);
  assert.deepEqual(f(back).provenance.from.map((r) => r.id), ["feature-1"]);
  assert.equal(f(back).intent.summary, "4 of Box 1 round the Z axis");
  // Its axis deleted since: the edit keeps it (the rebuild says it is gone) while the axis stays; a new deleted one is refused.
  const deleted = deleteItem(onAxis, axis);
  assert.equal(editablePattern(deleted, id).axisName, "Axis 1");
  const fewer = changedPattern(deleted, id, round(`construct:${axis}`, { count: 3 }));
  assert.deepEqual(f(fewer).dependsOn, ["feature-1", axis]);
  assert.throws(() => changedPattern(back, id, round("construct:feature-77")), { message: '"construct:feature-77" is not a construction axis in the design' });
  // Each saved and opened again reads back the same (as JSON: a file has no −0).
  const asJson = (d: DesignDocument) => JSON.parse(JSON.stringify(d));
  for (const d of [onAxis, back, deleted, fewer]) assert.deepEqual(readDesignDocument(asJson(d)), asJson(d));
});

test("the data: version 29 holds a Pattern round an axis and reads back the same; version 28 holding one is refused; every break is refused", async () => {
  assert.equal(DESIGN_VERSION, 30);
  const { doc: d0, plane, axis } = await cubeAndAxis();
  const { doc, id } = insertPattern(d0, ["body:feature-1"], round(`construct:${axis}`));
  const json = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(readDesignDocument(json), JSON.parse(JSON.stringify(doc)));
  assert.throws(() => readDesignDocument({ ...json, version: 28 }), { message: "Design data says version 28 but has a Pattern round a construction axis, which version 29 brought" });
  // Round an origin axis it is version 25's: version 28 data with one opens as the current version.
  const plain = insertPattern(d0, ["body:feature-1"], { kind: "circular", axis: "Z", centre: [0, 0, 0], count: 4, angle: 360, join: false }).doc;
  assert.equal(readDesignDocument({ ...JSON.parse(JSON.stringify(plain)), version: 28 }).version, 30);
  const at = doc.timeline.features.findIndex((f) => f.id === id);
  const broken = (change: (p: Record<string, unknown>, f: Record<string, unknown>, d: Record<string, any>) => void) => () => {
    const d = JSON.parse(JSON.stringify(doc));
    change(d.timeline.features[at].intent.parameters, d.timeline.features[at], d);
    readDesignDocument(d);
  };
  assert.throws(broken((p) => (p.centre = [0, 0, 0])), /it has a value "centre" a circular pattern doesn't have/);
  assert.throws(broken((p) => (p.axis = `construct:${plane}`)), new RegExp(`turns round "construct:${plane}", which is not a construction axis before it in the timeline`));
  assert.throws(broken((p) => (p.axis = "construct:Feature-1")), /is not X, Y, Z or a construction axis/);
  assert.throws(broken((p) => (p.axis = "construct:__proto__")), /is not X, Y, Z or a construction axis/);
  assert.throws(broken((_p, f) => (f.dependsOn = ["feature-1"])), new RegExp(`then the construction it turns round \\(${axis}\\)`));
  assert.throws(broken((_p, f) => (f.dependsOn = [axis, "feature-1"])), /must depend on exactly/);
  // The axis after the Pattern: moved there in the file.
  assert.throws(broken((_p, _f, d) => d.timeline.features.push(d.timeline.features.splice(2, 1)[0])), /which is not a construction axis before it in the timeline/);
  // A deleted axis still opens: the rebuild fails the Pattern in words.
  const gone = deleteItem(doc, axis);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(gone))), JSON.parse(JSON.stringify(gone)));
});
