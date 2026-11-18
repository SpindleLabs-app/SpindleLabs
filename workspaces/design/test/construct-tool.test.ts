// Step 59a2: the Construct tool's pure rules (construct-tool.ts) and the
// drawing's maths (construct-draw.ts). Every expected value is worked out by
// hand in the comment beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSTRUCT_ANGLE_MAX, CONSTRUCT_DISTANCE_MAX, CONSTRUCT_KINDS, readConstructRef, type ConstructAnswer, type ConstructKind } from "../src/construct-data.ts";
import { insertConstruct } from "../src/construct.ts";
import { choicesFor, constructHint, KIND_GROUPS, ORIGIN_NAMES, readNumber, slotLegend, slotRole, targetRefusal, answerWords } from "../src/construct-tool.ts";
import { constructOverlay, constructPlanes, dashedLine, drawnConstructs, DASHES, PREVIEW_ITEM, squareTo } from "../src/construct-draw.ts";
import { partDocument } from "../src/document.ts";

const KINDS = Object.keys(CONSTRUCT_KINDS) as ConstructKind[];

test("the three groups hold all 14 kinds, once each, planes then axes then points", () => {
  // The kernel's table: 5 planes, 4 axes, 5 points.
  assert.deepEqual(KIND_GROUPS.map((g) => [g.shape, g.kinds.length]), [["plane", 5], ["axis", 4], ["point", 5]]);
  assert.deepEqual([...KIND_GROUPS.flatMap((g) => g.kinds)].sort(), [...KINDS].sort());
});

test("slot roles: first and second are points for the point kinds and planes for the others", () => {
  assert.equal(slotRole("plane_through_points", "third"), "point"); // three points
  assert.equal(slotRole("axis_through_points", "first"), "point");
  assert.equal(slotRole("mid_plane", "second"), "plane"); // midway between two planes
  assert.equal(slotRole("point_where_planes_meet", "third"), "plane"); // three planes meet at a point
  assert.equal(slotRole("angle_plane", "line"), "line");
  assert.equal(slotRole("point_centre", "round"), "round");
  assert.equal(slotLegend("plane_through_points", "second"), "Second point");
  assert.equal(slotLegend("offset_plane", "plane"), "Plane");
});

test("every slot of every kind has a role that a face, edge, corner or a list choice can fill", () => {
  for (const k of KINDS) for (const s of CONSTRUCT_KINDS[k].slots as readonly string[]) {
    const role = slotRole(k, s);
    const doc = partDocument("box", 10, 10, 10);
    const byList = choicesFor(doc, role).length > 0;
    const byPick = [targetRefusal(role, { kind: "corner" }), targetRefusal(role, { kind: "face", flat: true }), targetRefusal(role, { kind: "face", flat: false }), targetRefusal(role, { kind: "edge", straight: true }), targetRefusal(role, { kind: "edge", straight: false })].some((r) => r === null);
    assert.ok(byList || byPick, `${k}.${s} can be filled by nothing`);
  }
});

test("what a pick may fill: a flat face a plane, a straight edge a line, a corner a point, a round edge or face a centre", () => {
  assert.equal(targetRefusal("plane", { kind: "face", flat: true }), null);
  assert.match(targetRefusal("plane", { kind: "face", flat: false })!, /curved/);
  assert.equal(targetRefusal("line", { kind: "edge", straight: true }), null);
  assert.match(targetRefusal("line", { kind: "edge", straight: false })!, /curved/);
  assert.equal(targetRefusal("point", { kind: "corner" }), null);
  assert.match(targetRefusal("plane", { kind: "corner" })!, /a corner is a point/);
  assert.match(targetRefusal("point", { kind: "face", flat: true })!, /a face is not one/);
  assert.equal(targetRefusal("round", { kind: "edge", straight: false }), null);
  assert.equal(targetRefusal("round", { kind: "face", flat: false }), null);
  assert.match(targetRefusal("round", { kind: "edge", straight: true })!, /straight/);
  assert.equal(targetRefusal("edge", { kind: "edge", straight: true }), null);
});

test("the list offers the origin and the constructions before the marker that make the right shape", () => {
  let doc = partDocument("box", 10, 10, 10);
  assert.deepEqual(choicesFor(doc, "plane").map((c) => c.ref), ["XY", "XZ", "YZ"]);
  assert.deepEqual(choicesFor(doc, "line").map((c) => c.ref), ["X", "Y", "Z"]);
  assert.deepEqual(choicesFor(doc, "point").map((c) => c.ref), ["O"]);
  assert.deepEqual(choicesFor(doc, "edge"), []);
  assert.ok(choicesFor(doc, "plane").every((c) => ORIGIN_NAMES.includes(c.ref) && readConstructRef(c.ref) !== null));
  const plane: ConstructAnswer = { kind: "plane", point: [0, 0, 7], normal: [0, 0, 1], near: [0, 0, 7] };
  const made = insertConstruct(doc, "offset_plane", { plane: "XY" }, 7, plane);
  doc = made.doc;
  // The new plane is offered where a plane is wanted, not where a line or point is.
  assert.deepEqual(choicesFor(doc, "plane").map((c) => c.ref), ["XY", "XZ", "YZ", `construct:${made.id}`]);
  assert.equal(choicesFor(doc, "line").length, 3);
  assert.equal(choicesFor(doc, "plane").at(-1)!.label, "Plane 1");
  // Suppressed: no longer offered.
  const off = { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === made.id ? { ...f, suppressed: true } : f)) } };
  assert.equal(choicesFor(off, "plane").length, 3);
});

test("the number: read strictly, limits at 0.9x and 1.1x of the data's", () => {
  assert.deepEqual(readNumber("mid_plane", ""), { none: true });
  assert.deepEqual(readNumber("offset_plane", "12.5"), { value: 12.5 });
  assert.deepEqual(readNumber("offset_plane", "-3"), { value: -3 }); // either side of the plane
  assert.match((readNumber("offset_plane", "") as { why: string }).why, /Type the distance in mm/);
  assert.match((readNumber("offset_plane", "0x10") as { why: string }).why, /not a number/);
  assert.match((readNumber("offset_plane", "Infinity") as { why: string }).why, /not a number/);
  assert.deepEqual(readNumber("offset_plane", String(0.9 * CONSTRUCT_DISTANCE_MAX)), { value: 0.9 * CONSTRUCT_DISTANCE_MAX });
  assert.ok("why" in readNumber("offset_plane", String(1.1 * CONSTRUCT_DISTANCE_MAX)));
  assert.deepEqual(readNumber("angle_plane", String(0.9 * CONSTRUCT_ANGLE_MAX)), { value: 0.9 * CONSTRUCT_ANGLE_MAX });
  assert.ok("why" in readNumber("angle_plane", String(1.1 * CONSTRUCT_ANGLE_MAX)));
  assert.match((readNumber("angle_plane", "") as { why: string }).why, /Type the angle in degrees/);
});

test("the hint says what to pick next, tap on a touch screen, and ready when everything is", () => {
  assert.equal(constructHint("offset_plane", "plane", 1, false), "Offset plane: click a plane in the view, or choose from the list");
  assert.equal(constructHint("offset_plane", "plane", 1, true), "Offset plane: tap a plane in the view, or choose from the list");
  assert.equal(constructHint("offset_plane", null, 1, false), "Offset plane: ready, press OK");
  assert.match(constructHint("point_midway", "edge", 0, false), /needs a body/);
  assert.match(constructHint("point_where_line_crosses", "line", 0, false), /a line/); // an axis needs no body
});

test("squareTo: a unit direction square to the normal, for every axis-aligned and a slanted normal", () => {
  for (const n of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [Math.SQRT1_2, 0, Math.SQRT1_2], [0.6, 0.8, 0]]) {
    const x = squareTo(n);
    assert.ok(Math.abs(Math.hypot(...x) - 1) < 1e-12, "unit");
    assert.ok(Math.abs(x[0] * n[0] + x[1] * n[1] + x[2] * n[2]) < 1e-12, "square to the normal");
  }
  // Normal +z: x is the smallest-|component| axis (x, ties first) crossed in: (0,0,1) × (1,0,0) is not it; n × axis with axis = (1,0,0) gives (0*0-1*0, 1*1-0*0, 0) = (0,1,0).
  assert.deepEqual(squareTo([0, 0, 1]), [0, 1, 0]);
});

test("dashedLine: 12 pieces each as long as the gap after it, the first starting `half` behind the point", () => {
  // half 12 along +x through (1,2,3): 24 mm in 24 equal parts of 1 mm, a drawn piece then a gap: pieces at -12..-11, -10..-9, ... 10..11.
  const d = dashedLine([1, 2, 3], [1, 0, 0], 12);
  assert.equal(d.length, DASHES);
  assert.deepEqual(d[0], { from: [-11, 2, 3], to: [-10, 2, 3] }); // 1 - 12 = -11 to 1 - 11 = -10
  assert.deepEqual(d[11], { from: [11, 2, 3], to: [12, 2, 3] }); // -12 + 22 = 10 -> 1 + 10 = 11 to 12
  for (let k = 1; k < d.length; k++) assert.equal(d[k].from[0] - d[k - 1].to[0], 1, "a gap as long as a piece");
});

test("what is drawn: planes by their answer's near point, axes dashed, points as dots, the preview last and in amber", () => {
  let doc = partDocument("box", 10, 10, 10);
  const plane: ConstructAnswer = { kind: "plane", point: [0, 0, 7], normal: [0, 0, 1], near: [3, 4, 7] };
  const axis: ConstructAnswer = { kind: "axis", point: [0, 0, 0], direction: [0, 0, 1], near: [5, 5, 0] };
  const point: ConstructAnswer = { kind: "point", point: [1, 2, 3] };
  const a = insertConstruct(doc, "offset_plane", { plane: "XY" }, 7, plane);
  const b = insertConstruct(a.doc, "axis_along", { line: "Z" }, undefined, axis);
  const c = insertConstruct(b.doc, "point_at", { point: "O" }, undefined, point);
  doc = c.doc;
  const drawn = drawnConstructs(doc, point);
  assert.deepEqual(drawn.map((d) => d.item), [a.id, b.id, c.id, PREVIEW_ITEM]);
  const planes = constructPlanes(drawn);
  assert.equal(planes.length, 1);
  assert.deepEqual(planes[0].plane.origin, [3, 4, 7]); // centred on near, not on the foot (0,0,7)
  assert.equal(planes[0].centred, true);
  const overlay = constructOverlay(drawn, 12)!;
  const lines = overlay.places!.filter((p) => "from" in p);
  const dots = overlay.places!.filter((p) => "point" in p);
  assert.equal(lines.length, DASHES); // one axis
  assert.equal(dots.length, 2); // the kept point and the preview's
  assert.deepEqual(dots.map((p) => p.severity), ["info", "warning"]);
  assert.equal(constructOverlay(drawnConstructs(partDocument("box", 1, 1, 1), null), 12), null);
  // Not before the marker, not suppressed: nothing drawn.
  const rolled = { ...doc, timeline: { ...doc.timeline, marker: "start" as const } };
  assert.deepEqual(drawnConstructs(rolled, null), []);
});

test("the answer in words", () => {
  assert.equal(answerWords({ kind: "plane", point: [0, 0, 10], normal: [0, 0, 1], near: [1.23456, 0, 10] }), "A plane through (1.235, 0, 10), facing (0, 0, 1)");
  assert.equal(answerWords({ kind: "point", point: [1, 2, 3] }), "A point at (1, 2, 3)");
});
