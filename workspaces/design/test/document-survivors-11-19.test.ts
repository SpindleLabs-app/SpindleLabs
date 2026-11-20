// Survivors of the Design reader on main, 2026-11-19 (issue #220 again): the construction checks (document.ts
// `constructBase`, `constructNumberProblem`, `checkConstruct`, Design data version 27), a Mirror across a construction
// plane (`checkDuplicate`, version 28), the empty-name fallbacks for constructions and Patterns (`withRuledNames`),
// the version 28 and 29 field checks (`hasVersion28Fields`, `hasVersion29Fields`) and version 19's upgrade of kept
// shapes (`migrateDesignV19`) had no test for a value that is not text, a number exactly at a limit, an input after
// the item or deleted since, a wrong dependsOn, or a field another kind of item happens to carry. Each test names the
// change to the code it catches; the mutants no file can tell apart are explained in
// packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertConstruct } from "../src/construct.ts";
import { CONSTRUCT_ANGLE_MAX, CONSTRUCT_DISTANCE_MAX, type ConstructAnswer } from "../src/construct-data.ts";
import { constructBase, constructNumberProblem, migrateDesignV19, partDocument, readDesignDocument, type DesignDocument, type Feature } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { insertPattern } from "../src/pattern.ts";
import { addConstructSketch } from "../src/sketch.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

/** Placeholder answers (the reader checks only their shape; a rebuild makes them again from the names). */
const PLANE: ConstructAnswer = { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1], near: [0, 0, 0] };
const AXIS: ConstructAnswer = { kind: "axis", point: [0, 0, 0], direction: [1, 0, 0], near: [0, 0, 0] };
const POINT: ConstructAnswer = { kind: "point", point: [0, 0, 0] } as ConstructAnswer;

/** A 40 × 30 × 20 box (feature-1) with an offset plane 10 mm off XY, an axis along X and a point at the origin. */
function constructs(): { doc: DesignDocument; plane: string; axis: string; point: string } {
  const p = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: "XY" }, 10, PLANE);
  const a = insertConstruct(p.doc, "axis_along", { line: "X" }, undefined, AXIS);
  const o = insertConstruct(a.doc, "point_at", { point: "O" }, undefined, POINT);
  return { doc: o.doc, plane: p.id, axis: a.id, point: o.id };
}

/** The file `doc` as raw JSON with the item `id` changed by `patch`, read. */
function reading(doc: DesignDocument, id: string, patch: (f: Raw, p: Raw, d: Raw) => void): () => DesignDocument {
  const d = JSON.parse(JSON.stringify(doc));
  const f = d.timeline.features.find((x: Raw) => x.id === id);
  patch(f, f.intent.parameters, d);
  return () => readDesignDocument(d);
}

const label = (doc: DesignDocument, id: string) => doc.timeline.features.find((f) => f.id === id)!.provenance.self.label;

test("an empty-named construction opens as Plane 1, Axis 1 or Point 1 by what it makes (isConstructItem(f) => false, the names => \"\")", () => {
  const { doc, plane, axis, point } = constructs();
  const d = JSON.parse(JSON.stringify(doc));
  for (const f of d.timeline.features) if ([plane, axis, point].includes(f.id)) f.provenance.self.label = "";
  const back = readDesignDocument(d);
  // Without the construction's own base name, the fallback gives "Item 1", "Item 2", "Item 3".
  assert.deepEqual([label(back, plane), label(back, axis), label(back, point)], ["Plane 1", "Axis 1", "Point 1"]);
});

test("an empty-named Pattern opens as Pattern 1 (isPatternItem(f) => false, \"Pattern\" => \"\")", () => {
  const { doc, id } = insertPattern(partDocument("box", 10, 10, 10), ["body:feature-1"], { kind: "linear", direction: "X", spacing: 20, count: 3, join: false });
  const back = readDesignDocument(reading(doc, id, (f) => (f.provenance.self.label = ""))());
  assert.equal(label(back, id), "Pattern 1");
});

test("constructBase: a kind this SpindleLabs doesn't make is an Item, each known kind its shape's word (the whole block, !isConstructKind(make) either way)", () => {
  const item = (make: unknown) => ({ intent: { parameters: { make } } }) as unknown as Feature;
  assert.equal(constructBase(item("not_a_kind")), "Item");
  assert.equal(constructBase(item(undefined)), "Item");
  assert.equal(constructBase(item("mid_plane")), "Plane");
  assert.equal(constructBase(item("axis_where_planes_meet")), "Axis");
  assert.equal(constructBase(item("point_centre")), "Point");
});

test("a construction's number: exactly the limit either way reads, 1.1× doesn't (<= MAX => < MAX)", () => {
  // CONSTRUCT_DISTANCE_MAX is 1 km and CONSTRUCT_ANGLE_MAX a whole turn: both are allowed exactly, either way.
  for (const distance of [CONSTRUCT_DISTANCE_MAX, -CONSTRUCT_DISTANCE_MAX, 0.9 * CONSTRUCT_DISTANCE_MAX]) assert.equal(constructNumberProblem("offset_plane", { distance }), null);
  for (const angle of [CONSTRUCT_ANGLE_MAX, -CONSTRUCT_ANGLE_MAX, 0.9 * CONSTRUCT_ANGLE_MAX]) assert.equal(constructNumberProblem("angle_plane", { angle }), null);
  assert.equal(constructNumberProblem("offset_plane", { distance: 1.1 * CONSTRUCT_DISTANCE_MAX }), `its distance ${1.1 * CONSTRUCT_DISTANCE_MAX} is not a number of mm up to ${CONSTRUCT_DISTANCE_MAX} either way`);
  // 1.1 × 360 = 396 degrees, past a whole turn.
  assert.equal(constructNumberProblem("angle_plane", { angle: 1.1 * CONSTRUCT_ANGLE_MAX }), `its angle ${1.1 * CONSTRUCT_ANGLE_MAX} is not a number of degrees up to ${CONSTRUCT_ANGLE_MAX} either way`);
  assert.equal(constructNumberProblem("angle_plane", { angle: -400 }), "its angle -400 is not a number of degrees up to 360 either way");
});

test("a construction's number that is not a number is named as the reader shows it, text quoted (typeof v === \"string\" => true, isFiniteNumber && … => ||)", () => {
  assert.equal(constructNumberProblem("angle_plane", { angle: Infinity }), "its angle Infinity is not a number of degrees up to 360 either way");
  assert.equal(constructNumberProblem("angle_plane", { angle: "45" }), 'its angle "45" is not a number of degrees up to 360 either way');
  assert.equal(constructNumberProblem("offset_plane", { distance: [1] }), "its distance a list is not a number of mm up to 1000000 either way");
});

test("a construction's number its kind doesn't take is named as a distance or an angle (k === \"distance\" => false, the words => \"\")", () => {
  assert.equal(constructNumberProblem("angle_plane", { angle: 30, distance: 5 }), "it has a distance, which angle_plane doesn't take");
  assert.equal(constructNumberProblem("offset_plane", { distance: 5, angle: 30 }), "it has an angle, which offset_plane doesn't take");
  assert.equal(constructNumberProblem("mid_plane", { distance: 5 }), "it has a distance, which mid_plane doesn't take");
  assert.equal(constructNumberProblem("mid_plane", {}), null);
});

test("a construction's kind or input that is not text is named as the reader shows it (typeof make/name === \"string\" => true)", () => {
  const { doc, plane } = constructs();
  const at = `Design construction ${plane}`;
  assert.throws(reading(doc, plane, (_, p) => (p.make = [1])), { message: `${at} makes a list, which is not a construction this SpindleLabs makes` });
  assert.throws(reading(doc, plane, (_, p) => (p.make = "bend")), { message: `${at} makes "bend", which is not a construction this SpindleLabs makes` });
  assert.throws(reading(doc, plane, (_, p) => (p.inputs.plane = [1])), { message: `${at}'s plane a list is not a name of a plane, axis, point, face, edge or corner` });
  assert.throws(reading(doc, plane, (_, p) => (p.inputs.plane = "nowhere")), { message: `${at}'s plane "nowhere" is not a name of a plane, axis, point, face, edge or corner` });
});

test("a construction with no inputs says so (!isRecord(p.inputs) => false, the words => \"\")", () => {
  const { doc, plane } = constructs();
  assert.throws(reading(doc, plane, (_, p) => delete p.inputs), { message: `Design construction ${plane} has no inputs` });
  assert.throws(reading(doc, plane, (_, p) => (p.inputs = "XY")), { message: `Design construction ${plane} has no inputs` });
});

test("a construction made from another: one before it reads, itself or one after it doesn't, one deleted since does (there.at >= here => false or >, there === undefined => false, !ID_SHAPE => ID_SHAPE)", () => {
  const { doc, plane, axis } = constructs();
  // A second plane 5 mm off the first, then the first made from the second (after it) or from itself.
  const second = insertConstruct(doc, "offset_plane", { plane: `construct:${plane}` }, 5, PLANE);
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(second.doc))));
  const at = `Design construction ${plane}`;
  const from = (item: string) => reading(second.doc, plane, (f, p) => ((p.inputs.plane = `construct:${item}`), (f.dependsOn = [item])));
  assert.throws(from(second.id), { message: `${at}'s plane names ${second.id}, which is not a construction before it in the timeline` });
  assert.throws(from(plane), { message: `${at}'s plane names ${plane}, which is not a construction before it in the timeline` });
  // The box is before it but not a construction.
  assert.throws(from("feature-1"), { message: `${at}'s plane names feature-1, which is not a construction before it in the timeline` });
  // A construction deleted since: the item is held at its last answer, so the file opens.
  const gone = reading(second.doc, second.id, (f, p) => ((p.inputs.plane = "construct:feature-0"), (f.dependsOn = ["feature-0"])));
  assert.doesNotThrow(gone);
  void axis;
});

test("a construction depends on exactly its inputs, in order, the words naming them or none (the dependsOn checks, \"none\", \", \")", () => {
  const { doc, plane, axis } = constructs();
  // A plane through the axis and the first plane's... a mid plane between the first plane and a second one: two inputs.
  const second = insertConstruct(doc, "offset_plane", { plane: "XY" }, 20, PLANE);
  const mid = insertConstruct(second.doc, "mid_plane", { first: `construct:${plane}`, second: `construct:${second.id}` }, undefined, PLANE);
  assert.deepEqual(mid.doc.timeline.features.find((f) => f.id === mid.id)!.dependsOn, [plane, second.id]);
  const at = `Design construction ${mid.id}`;
  const both = `${at} must depend on exactly the items it is made from (${plane}, ${second.id})`;
  for (const dependsOn of [[second.id, plane], [plane], [plane, second.id, axis], [plane, axis]]) assert.throws(reading(mid.doc, mid.id, (f) => (f.dependsOn = dependsOn)), { message: both });
  // One on an origin plane depends on nothing.
  assert.throws(reading(doc, plane, (f) => (f.dependsOn = ["feature-1"])), { message: `Design construction ${plane} must depend on exactly the items it is made from (none)` });
});

test("a Mirror across a construction plane: one after it, an axis or not a construction is refused (the across checks)", () => {
  const { doc, plane, axis } = constructs();
  const { doc: m, ids } = insertDuplicates(doc, ["body:feature-1"], `construct:${plane}`);
  const id = ids[0];
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(m))));
  const at = `Design duplicate ${id}`;
  // A plane after the Mirror.
  const later = insertConstruct(m, "offset_plane", { plane: "XZ" }, 3, PLANE);
  const across = (item: string) => reading(later.doc, id, (f, p) => ((p.mirror = `construct:${item}`), (f.dependsOn = ["feature-1", item])));
  assert.throws(across(later.id), { message: `${at} mirrors across "construct:${later.id}", which is not a construction plane before it in the timeline` });
  assert.throws(across(axis), { message: `${at} mirrors across "construct:${axis}", which is not a construction plane before it in the timeline` });
  assert.throws(across("feature-1"), { message: `${at} mirrors across "construct:feature-1", which is not a construction plane before it in the timeline` });
  // A plane deleted since reads (the rebuild fails the Mirror in words).
  assert.doesNotThrow(across("feature-0"));
});

test("a Mirror across a construction plane depends on exactly its body's item, then the plane (each part of the dependsOn check)", () => {
  const { doc, plane, axis } = constructs();
  const { doc: m, ids } = insertDuplicates(doc, ["body:feature-1"], `construct:${plane}`);
  const words = `Design duplicate ${ids[0]} must depend on exactly the item that made the body it mirrors (feature-1), then the construction it mirrors across (${plane})`;
  for (const dependsOn of [["feature-1"], [plane, "feature-1"], ["feature-1", axis], [axis, plane], ["feature-1", plane, axis]]) assert.throws(reading(m, ids[0], (f) => (f.dependsOn = dependsOn)), { message: words });
});

test("version 27 data with a sketch on or a Mirror across a construction plane is refused, as is version 28 data with a Pattern round a construction axis", () => {
  const { doc, plane, axis } = constructs();
  const sketched = addConstructSketch(doc, plane).doc;
  const mirrored = insertDuplicates(doc, ["body:feature-1"], `construct:${plane}`).doc;
  const patterned = insertPattern(doc, ["body:feature-1"], { kind: "circular", axis: `construct:${axis}`, count: 4, angle: 360, join: false }).doc;
  const as = (d: DesignDocument, version: number) => () => readDesignDocument({ ...JSON.parse(JSON.stringify(d)), version });
  // An app-made sketch on a construction plane also keeps the frame `drawn`, which version 28 brought too: left out, the plane alone tells.
  const undrawn: Raw = JSON.parse(JSON.stringify(sketched));
  for (const s of undrawn.sketches) delete s.drawn;
  assert.throws(as(undrawn as DesignDocument, 27), { message: "Design data says version 27 but uses a construction plane or its eye, which version 28 brought" });
  assert.throws(as(sketched, 27), { message: "Design data says version 27 but uses a construction plane or its eye, which version 28 brought" });
  assert.throws(as(mirrored, 27), { message: "Design data says version 27 but uses a construction plane or its eye, which version 28 brought" });
  assert.throws(as(patterned, 28), { message: "Design data says version 28 but has a Pattern round a construction axis, which version 29 brought" });
});

test("only a sketch's plane, a Duplicate's mirror and a Pattern's axis tell version 28 or 29 data apart (f.intent.type === … => true or !==, !isRecord(p) => false)", () => {
  const { doc, plane, axis } = constructs();
  const v28 = "which version 28 brought";
  const v29 = "which version 29 brought";
  const old = (d: Raw, version: number) => () => readDesignDocument({ ...d, version });
  // A box carrying a construction's name in a sketch's, a Mirror's or a Pattern's field is never taken for the newer version.
  for (const [key, version, words] of [["plane", 27, v28], ["mirror", 27, v28], ["axis", 28, v29]] as const) {
    const d = JSON.parse(JSON.stringify(doc));
    d.timeline.features[0].intent.parameters[key] = `construct:${key === "axis" ? axis : plane}`;
    try {
      old(d, version)();
    } catch (e) {
      assert.ok(!(e as Error).message.includes(words), `${key}: ${(e as Error).message}`);
    }
  }
  // A sketch item whose intent has no parameters is refused in the reader's own words, never a TypeError from the version check.
  const bare = JSON.parse(JSON.stringify(addConstructSketch(doc, plane).doc));
  delete bare.timeline.features.find((f: Raw) => f.intent.type === "sketch").intent.parameters;
  assert.throws(old(bare, 27), (e: Error) => !(e instanceof TypeError) && e.message.startsWith("Design"));
  // Version 28 data: an item with no intent, and a Pattern whose axis is not text, are refused in the reader's words too.
  const noIntent = JSON.parse(JSON.stringify(doc));
  delete noIntent.timeline.features[0].intent;
  assert.throws(old(noIntent, 28), (e: Error) => !(e instanceof TypeError) && e.message.startsWith("Design"));
  const odd = JSON.parse(JSON.stringify(insertPattern(doc, ["body:feature-1"], { kind: "circular", axis: `construct:${axis}`, count: 4, angle: 360, join: false }).doc));
  odd.timeline.features.find((f: Raw) => f.intent.type === "pattern").intent.parameters.axis = 5;
  assert.throws(old(odd, 28), (e: Error) => !(e instanceof TypeError) && e.message.startsWith("Design"));
});

test("version 19's upgrade of kept shapes keeps a design with an extrude and no profile shape as it was (added = [] => [\"Stryker was here\"])", () => {
  // An extrude with a second profile from another sketch, the first profile's shape kept: nothing to copy, nothing added.
  const d: Raw = {
    version: 19,
    kept: { "feature-5": { curves: [] } },
    timeline: { features: [{ id: "feature-5", intent: { type: "extrude", parameters: { sketch: "sketch-1", more: [{ sketch: "sketch-2" }] } } }] },
  };
  assert.deepEqual(migrateDesignV19(d), { ...d, version: 20, kept: { "feature-5": { curves: [] } } });
  // The second sketch's shape, kept under "<extrude>/<sketch>", becomes the profile's own: "<extrude>/profile:1".
  const two: Raw = { ...d, kept: { "feature-5": { curves: [] }, "feature-5/sketch-2": { curves: ["two"] } } };
  assert.deepEqual(migrateDesignV19(two).kept, { "feature-5": { curves: [] }, "feature-5/profile:1": { curves: ["two"] } });
});
