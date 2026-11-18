// Step 59a1: construction planes, axes and points as timeline items, built by
// the real rebuild on the real kernel (rebuild.ts `constructRun`), their data
// (document.ts `checkConstruct`, Design data version 26) and `insertConstruct`
// (construct.ts). Every place is worked out by hand from the box's corners:
// `partDocument("box", w, d, h)` is x 0..w, y 0..d, z 0..h.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { CONSTRUCT_STEP, constructSummary, insertConstruct } from "../src/construct.ts";
import { CONSTRUCT_DISTANCE_MAX, constructInputs, cornerRef, readConstructRef, UNIT_SLACK, type ConstructAnswer } from "../src/construct-data.ts";
import { changePreset, DESIGN_VERSION, greyedBy, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { deleteItem, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, followedDoc, rebuildTimeline, type FeatureResult, type TimelineBuild } from "../src/rebuild.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

const kernel = nodeKernel();

async function built(doc: DesignDocument): Promise<TimelineBuild> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.clear();
  return build;
}

/** A construction's result, built. */
function made(build: TimelineBuild, id: string): Extract<FeatureResult, { status: "built" }> {
  const r = build.results[id];
  assert.equal(r.status, "built", JSON.stringify(r));
  return r as Extract<FeatureResult, { status: "built" }>;
}

const near = (got: readonly number[], want: readonly number[], what: string) =>
  assert.ok(got.length === want.length && got.every((x, i) => Math.abs(x - want[i]) <= 1e-9), `${what}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);

/** A placeholder answer for inserting before the first build (the rebuild makes it again from its names). */
const PLANE: ConstructAnswer = { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1], near: [0, 0, 0] };
const AXIS: ConstructAnswer = { kind: "axis", point: [0, 0, 0], direction: [1, 0, 0], near: [0, 0, 0] };
const POINT: ConstructAnswer = { kind: "point", point: [0, 0, 0] };

/** Held names of the straight edges of the design's first body whose two ends both satisfy `on` (as the screen gives them). */
async function edgesWhere(doc: DesignDocument, on: (p: readonly number[]) => boolean): Promise<string[]> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const names = designNames(list);
  const view = list[0].view;
  const held = heldEdgeNames(names, 0);
  const out = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a]) && on(view.vertex_points[b]) ? [held[e]!] : []));
  await cache.clear();
  return out;
}

/** The held names of every edge with an end at `p`. */
async function edgesAt(doc: DesignDocument, p: readonly number[]): Promise<string[]> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const view = list[0].view;
  const held = heldEdgeNames(designNames(list), 0);
  const v = view.vertex_points.findIndex((q) => q.every((x, i) => Math.abs(x - p[i]) < 1e-9));
  await cache.clear();
  return view.edge_vertices.flatMap((ends, e) => (ends.includes(v) ? [held[e]!] : []));
}

const TOP = "face:feature-1/top";
const BOTTOM = "face:feature-1/bottom";

test("hand-worked: a plane offset 5 mm from the 40 × 30 × 20 box's top lies at z = 25, facing up, its foot (0, 0, 25)", async () => {
  const start = await kernel.call("body_count");
  const { doc, id } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const r = made(await built(doc), id);
  // The top is z = 20 facing +z; 5 mm along its normal is z = 25. The foot of the origin on z = 25 is (0, 0, 25).
  assert.equal(r.construct!.kind, "plane");
  const p = r.construct as Extract<ConstructAnswer, { kind: "plane" }>;
  near(p.normal, [0, 0, 1], "normal");
  near(p.point, [0, 0, 25], "foot");
  // Drawn beside the top: some point of z = 25 (where exactly is the kernel's choice of beside).
  assert.ok(Math.abs(p.near[2] - 25) < 1e-9, `near ${p.near}`);
  assert.equal(r.held, undefined);
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("hand-worked: the plane follows the box made 35 high (z = 40), and the design keeps that answer as its last", async () => {
  const { doc: d0, id } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const d1 = changePreset(d0, "feature-1", "box", 40, 30, 35);
  const build = await built(d1);
  // 35 + 5 = 40.
  near((made(build, id).construct as { point: number[] }).point, [0, 0, 40], "foot after the edit");
  const kept = followedDoc(d1, build);
  near((kept.timeline.features[1].intent.parameters.answer as { point: number[] }).point, [0, 0, 40], "kept answer");
  // Unchanged again: the same document back.
  assert.equal(followedDoc(kept, await built(kept)), kept);
});

test("a lost face holds the plane at its last answer with words; a suppressed box greys it", async () => {
  const { doc: d0, id } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, PLANE);
  const kept = followedDoc(d0, await built(d0));
  // A sphere has no top: the name is found nowhere.
  const sphere = changePreset(kept, "feature-1", "sphere", 40, 40, 40);
  const r = made(await built(sphere), id);
  assert.deepEqual(r.held, { cause: "lost", slot: "plane", message: "Plane 1 can't find its plane any more: an edit before it changed or removed it, so it stays where it was" });
  near((r.construct as { point: number[] }).point, [0, 0, 25], "held where it was");
  // Held answers are never written in as new ones.
  assert.equal(followedDoc(sphere, await built(sphere)), sphere);
  // Deleted: the same.
  const gone = deleteItem(kept, "feature-1");
  assert.equal(made(await built(gone), id).held?.cause, "lost");
  // Suppressed: greyed by the box, from the data and in the rebuild alike.
  const off = suppressItem(kept, "feature-1", true);
  assert.deepEqual((await built(off)).results[id], { status: "greyed", by: "feature-1" });
  assert.equal(greyedBy(off, off.timeline.features[1]), "feature-1");
});

test("hand-worked: the midplane of the box's top and bottom is z = 10; one of the XY plane and the top is too", async () => {
  const box = partDocument("box", 40, 30, 20);
  const { doc, id } = insertConstruct(box, "mid_plane", { first: TOP, second: BOTTOM }, undefined, PLANE);
  const p = made(await built(doc), id).construct as Extract<ConstructAnswer, { kind: "plane" }>;
  // Halfway between z = 0 and z = 20; the normal ±z.
  near(p.point, [0, 0, 10], "foot");
  near([Math.abs(p.normal[2])], [1], "normal along z");
  const xy = insertConstruct(box, "mid_plane", { first: "XY", second: TOP }, undefined, PLANE);
  near((made(await built(xy.doc), xy.id).construct as { point: number[] }).point, [0, 0, 10], "XY and top");
});

test("hand-worked: an axis along the box's top front edge runs along x through (0, 0, 20); a point at its corner (0, 0, 20)", async () => {
  const box = partDocument("box", 40, 30, 20);
  // The top front edge: y = 0, z = 20, x 0..40.
  const [edge] = await edgesWhere(box, (p) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 20) < 1e-9);
  const a = insertConstruct(box, "axis_along", { line: edge }, undefined, AXIS);
  const axis = made(await built(a.doc), a.id).construct as Extract<ConstructAnswer, { kind: "axis" }>;
  near([Math.abs(axis.direction[0]), axis.direction[1], axis.direction[2]], [1, 0, 0], "direction ±x");
  // The foot of the origin on the line y = 0, z = 20 along x is (0, 0, 20).
  near(axis.point, [0, 0, 20], "foot");
  // The corner (0, 0, 20): three edges meet there.
  const edges = await edgesAt(box, [0, 0, 20]);
  assert.equal(edges.length, 3);
  const c = insertConstruct(box, "point_at", { point: cornerRef(edges) }, undefined, POINT);
  near((made(await built(c.doc), c.id).construct as { point: number[] }).point, [0, 0, 20], "corner");
  // The edge's middle: (20, 0, 20).
  const m = insertConstruct(box, "point_midway", { edge }, undefined, POINT);
  near((made(await built(m.doc), m.id).construct as { point: number[] }).point, [20, 0, 20], "middle");
  // The corner follows the box made 50 wide? It is at x = 0, so it stays; the middle moves to (25, 0, 20).
  const wider = changePreset(m.doc, "feature-1", "box", 50, 30, 20);
  near((made(await built(wider), m.id).construct as { point: number[] }).point, [25, 0, 20], "middle of the wider box");
});

test("hand-worked: constructions from constructions and the origin", async () => {
  const box = partDocument("box", 40, 30, 20);
  const one = insertConstruct(box, "offset_plane", { plane: TOP }, 5, PLANE);
  // Plane 2: 5 more from Plane 1, z = 30.
  const two = insertConstruct(one.doc, "offset_plane", { plane: `construct:${one.id}` }, 5, PLANE);
  assert.deepEqual(two.doc.timeline.features[2].dependsOn, [one.id]);
  near((made(await built(two.doc), two.id).construct as { point: number[] }).point, [0, 0, 30], "plane on a plane");
  // XY offset −3: z = −3, nothing depended on.
  const low = insertConstruct(box, "offset_plane", { plane: "XY" }, -3, PLANE);
  assert.deepEqual(low.doc.timeline.features[1].dependsOn, []);
  near((made(await built(low.doc), low.id).construct as { point: number[] }).point, [0, 0, -3], "XY − 3");
  // XZ faces −y, as a sketch on it does (x along X, y along Z): 5 mm from it is y = −5.
  const front = insertConstruct(box, "offset_plane", { plane: "XZ" }, 5, PLANE);
  near((made(await built(front.doc), front.id).construct as { point: number[] }).point, [0, -5, 0], "XZ + 5");
  // XZ meets YZ along Z: direction ±z through the origin.
  const z = insertConstruct(box, "axis_where_planes_meet", { first: "XZ", second: "YZ" }, undefined, AXIS);
  const ax = made(await built(z.doc), z.id).construct as Extract<ConstructAnswer, { kind: "axis" }>;
  near([Math.abs(ax.direction[2])], [1], "along z");
  near(ax.point, [0, 0, 0], "through the origin");
  // Plane 1 deleted: Plane 2 is held at its last answer, saying its plane was deleted.
  const kept = followedDoc(two.doc, await built(two.doc));
  const r = made(await built(deleteItem(kept, one.id)), two.id);
  assert.equal(r.held?.message, "Plane 2's plane was deleted, so it stays where it was");
  near((r.construct as { point: number[] }).point, [0, 0, 30], "held");
  // The box suppressed greys Plane 1 by it, and so Plane 2 by it too, through Plane 1.
  assert.deepEqual((await built(suppressItem(kept, "feature-1", true))).results[two.id], { status: "greyed", by: "feature-1" });
  // Plane 2 can't go before Plane 1.
  assert.deepEqual(reorderItem(kept, two.id, 1), { refused: "before-dependency", message: "Plane 2 can't go before Plane 1: it is built from Plane 1" });
});

test("a construction the kernel can't make fails in its words: the top and the bottom never meet", async () => {
  const { doc, id } = insertConstruct(partDocument("box", 40, 30, 20), "axis_where_planes_meet", { first: TOP, second: BOTTOM }, undefined, AXIS);
  const r = (await built(doc)).results[id];
  assert.equal(r.status, "failed");
  assert.ok(r.status === "failed" && r.message.length > 0 && r.cause === "error", JSON.stringify(r));
});

test("the data: a construction saves and reads back as version 26; every break of it is refused in words", () => {
  const { doc } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: TOP }, 5, { kind: "plane", point: [0, 0, 25], normal: [0, 0, 1], near: [20, 15, 25] });
  assert.equal(DESIGN_VERSION, 29);
  const json = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(readDesignDocument(json), doc);
  assert.equal(doc.timeline.features[1].provenance.self.label, "Plane 1");
  assert.equal(doc.timeline.features[1].intent.summary, "Offset plane, 5 mm");
  const broken = (change: (p: Record<string, unknown>, f: Record<string, unknown>) => void, version = 28) => () => {
    const d = JSON.parse(JSON.stringify(doc));
    d.version = version;
    change(d.timeline.features[1].intent.parameters, d.timeline.features[1]);
    readDesignDocument(d);
  };
  const at = "Design construction feature-2";
  assert.throws(broken(() => {}, 25), { message: "Design data says version 25 but has a construction plane, axis or point, which version 26 brought" });
  assert.throws(broken((p) => (p.make = "fillet")), { message: `${at} makes "fillet", which is not a construction this SpindleLabs makes` });
  assert.throws(broken((p) => (p.extra = 1)), { message: `${at} has a parameter "extra" a construction doesn't have` });
  assert.throws(broken((p) => (p.inputs = { plane: TOP, line: "X" })), { message: `${at} has an input "line", which offset_plane doesn't take` });
  assert.throws(broken((p) => (p.inputs = {})), { message: `${at} has no plane` });
  assert.throws(broken((p) => (p.inputs = { plane: "top" })), { message: `${at}'s plane "top" is not a name of a plane, axis, point, face, edge or corner` });
  assert.throws(broken((p) => (p.inputs = { plane: "construct:feature-1" })), { message: `${at}'s plane names feature-1, which is not a construction before it in the timeline` });
  // A deleted construction may be named (the item is held), but never one the counter could give again.
  assert.throws(broken((p, f) => ((p.inputs = { plane: "construct:feature-9" }), (f.dependsOn = ["feature-9"]))), { message: "Design data's nextId 3 is not above feature-9, so a new id could repeat it" });
  assert.throws(broken((p) => delete p.distance), { message: `${at}: its distance undefined is not a number of mm up to 1000000 either way` });
  assert.throws(broken((p) => (p.angle = 30)), { message: `${at}: it has an angle, which offset_plane doesn't take` });
  assert.throws(broken((p) => (p.distance = "5")), { message: `${at}: its distance "5" is not a number of mm up to 1000000 either way` });
  // The distance limit, 1 km either way: 0.9 × reads, 1.1 × is refused.
  assert.doesNotThrow(broken((p) => (p.distance = -0.9 * CONSTRUCT_DISTANCE_MAX)));
  assert.throws(broken((p) => (p.distance = 1.1 * CONSTRUCT_DISTANCE_MAX)), /its distance 1100000 is not/);
  // The kept answer: its kind, its keys, a unit normal (within UNIT_SLACK: 0.9 × reads, 1.1 × is refused).
  assert.throws(broken((p) => ((p.answer as Record<string, unknown>).kind = "axis")), { message: `${at}'s last answer: it is not a plane` });
  assert.throws(broken((p) => ((p.answer as Record<string, unknown>).direction = [1, 0, 0])), { message: `${at}'s last answer: it has "direction", which a plane doesn't have` });
  assert.doesNotThrow(broken((p) => ((p.answer as Record<string, unknown>).normal = [0, 0, 1 + 0.9 * UNIT_SLACK])));
  assert.throws(broken((p) => ((p.answer as Record<string, unknown>).normal = [0, 0, 1 + 1.1 * UNIT_SLACK])), { message: `${at}'s last answer: its normal is not three numbers of length 1` });
  assert.throws(broken((p) => ((p.answer as Record<string, unknown>).near = [0, 0, 2e8])), { message: `${at}'s last answer: its near is not three numbers within 173 km of the origin` });
  // dependsOn exactly what its names are named after.
  assert.throws(broken((_, f) => (f.dependsOn = [])), { message: `${at} must depend on exactly the items it is made from (feature-1)` });
});

test("insertConstruct's refusals, words and names", () => {
  const box = partDocument("box", 40, 30, 20);
  assert.throws(() => insertConstruct(box, "offset_plane", { plane: TOP }, undefined, PLANE), /The offset plane can't be made: its distance undefined is not a number/);
  assert.throws(() => insertConstruct(box, "offset_plane", { plane: TOP, line: "X" }, 5, PLANE), { message: "Offset plane takes no line" });
  assert.throws(() => insertConstruct(box, "mid_plane", { first: TOP }, undefined, PLANE), { message: "Midplane needs its second" });
  assert.throws(() => insertConstruct(box, "point_at", { point: "construct:feature-1" }, undefined, POINT), { message: "feature-1 is not a construction before the marker" });
  assert.throws(() => insertConstruct(box, "point_at", { point: "O" }, undefined, PLANE), { message: "The kernel's answer can't be kept: it is not a point" });
  assert.equal(constructSummary("angle_plane", 30), "Plane at an angle, 30°");
  assert.equal(CONSTRUCT_STEP, "Construct");
  // Names: Plane, Axis and Point counted apart.
  const a = insertConstruct(box, "offset_plane", { plane: "XY" }, 1, PLANE);
  const b = insertConstruct(a.doc, "axis_along", { line: "X" }, undefined, AXIS);
  const c = insertConstruct(b.doc, "offset_plane", { plane: "XY" }, 2, PLANE);
  assert.deepEqual(c.doc.timeline.features.map((f) => f.provenance.self.label), ["Box 1", "Plane 1", "Axis 1", "Plane 2"]);
});

test("names: each kind read, and the items each depends on", () => {
  assert.deepEqual(readConstructRef("XZ"), { kind: "origin", name: "XZ" });
  assert.deepEqual(readConstructRef("construct:feature-3"), { kind: "construct", item: "feature-3" });
  assert.equal(readConstructRef("construct:__proto__"), null);
  assert.deepEqual(readConstructRef(TOP), { kind: "face", name: TOP });
  assert.equal(readConstructRef("face:"), null);
  assert.equal(readConstructRef("edge:a+b"), null, "a rule 5 name not held");
  const e1 = "design:" + encodeURIComponent("face:feature-1/top+face:feature-4/side:line-2");
  const e2 = "design:" + encodeURIComponent("face:feature-1/front+face:feature-1/top");
  assert.deepEqual(readConstructRef(e1), { kind: "edge", held: e1 });
  // A corner's edges sorted, each once; written otherwise it is not a name SpindleLabs writes.
  assert.equal(cornerRef([e2, e1, e2]), `corner:${[e1, e2].sort().join("&")}`);
  assert.equal(readConstructRef(`corner:${[e1, e2].sort().reverse().join("&")}`), null);
  // Depends on: the items after each "face:", once, in slot order; none for the origin.
  assert.deepEqual(constructInputs({ first: e1, second: TOP, third: "XY" }, "plane_through_points"), ["feature-1", "feature-4"]);
  assert.deepEqual(constructInputs({ line: "construct:feature-7", plane: "YZ" }, "point_where_line_crosses"), ["feature-7"]);
});
