// More sketch shapes (step 52c, sketch-shapes.ts): each shape worked out by
// hand, every size limit at 0.9× (refused) and 1.1× (drawn), every refusal
// in its words, the constraints a slot and a centre rectangle get held by
// the kernel's real solver, the outline the kernel finds, the sketch point
// that outlives the curves round it, the typed sizes, and seeded random
// shapes checked against a plain model of each shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { seeded } from "../../../packages/testing/src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, deleteCurve, drawLine, drawRectangle, sketchOutline } from "../src/sketch.ts";
import { addConstraint } from "../src/constraints.ts";
import { clickAt, curveCount, drawStep, previewSegments, sketchDrawings, startTool, toolBusy, unfinishedWords } from "../src/sketch-tool.ts";
import { DEFAULT_SIDES, FLAT_CENTRE_RECTANGLE, IN_LINE, MAX_SIDES, NO_HEIGHT, NO_WIDTH, POINT_THERE, SAME_CLICK, SAME_SHAPE, SHAPE_CLICKS, SHAPE_KINDS, shapePlan, SHORT_FIRST_SIDE, SHORT_OVERALL_SLOT, SHORT_SLOT, SIDES_WORDS, SMALL_CENTRE_RECTANGLE, SMALL_HEIGHT, SMALL_POLYGON, SMALL_SLOT, SMALL_THREE_CIRCLE, type ShapeKind, type ShapeTool } from "../src/sketch-shapes.ts";
import { aimOf, anchorOf, liveValues, readSides, typedFields, withLocks } from "../src/typed-entry.ts";
import { deleteCurves, pickedWords, stillPicked } from "../src/sketch-select.ts";
import { selectAt } from "../src/constraint-tool.ts";
import { hintOf } from "../src/pointer-hint.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const at = (s: Sketch, id: string): SketchXY => {
  const p = s.points.find((q) => q.id === id)!;
  return [p.x, p.y];
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const nearXY = (p: SketchXY, q: SketchXY, tol = 1e-9) => near(p[0], q[0], tol) && near(p[1], q[1], tol);

/** A box, then Sketch 1 (sketch-2) on XY, and a shape tool of `kind` on it. */
function fresh(kind: ShapeKind) {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return { doc: s.doc, id: s.id, tool: startTool(kind, s.id) as ShapeTool };
}

/** The clicks made in turn: the document, the tool after, how many drew, and the last note. */
function clicks(doc: DesignDocument, tool: ShapeTool, ps: SketchXY[]) {
  let drew = 0;
  let note: string | undefined;
  for (const p of ps) {
    const r = clickAt(doc, tool, p);
    doc = r.doc;
    tool = r.tool;
    note = r.note;
    if (r.drew) drew++;
  }
  return { doc, tool, drew, note };
}

/** The lines of the sketch as [start, end] places, and how many are construction lines. */
const linesOf = (s: Sketch) => s.curves.flatMap((c) => (c.kind === "line" ? [{ a: at(s, c.start), b: at(s, c.end), construction: c.construction === true }] : []));
const kinds = (s: Sketch) => s.constraints.map((c) => `${c.kind}${"a" in c ? ` ${c.a} ${c.b}` : ""}`);

test("hand-worked centre rectangle: centre (10, 5), corner (16, 9) is 12 × 8, level and upright, with its diagonals as construction lines", async () => {
  // d = (16, 9) − (10, 5) = (6, 4), the far corner (10, 5) − d = (4, 1): corners (16, 9), (4, 9), (4, 1), (16, 1),
  // 12 wide and 8 high. Each new end takes an id before its line: point-3, point-4, line-5, point-6, line-7, point-8,
  // line-9, line-10 back to point-3; then the diagonals (16, 9)–(4, 1) and (4, 9)–(16, 1), dashed. Then the constraints:
  // the top side level, the left upright, the bottom level, the right upright, as Fusion's rectangle.
  const f = fresh("centre-rectangle");
  const r = clicks(f.doc, f.tool, [[10, 5], [16, 9]]);
  assert.equal(r.drew, 1);
  const s = sketchOf(r.doc, f.id);
  assert.deepEqual(s.points.map((p) => [p.x, p.y]), [[16, 9], [4, 9], [4, 1], [16, 1]]);
  const lines = linesOf(s);
  assert.deepEqual(lines.filter((l) => !l.construction).map((l) => [l.a, l.b]), [[[16, 9], [4, 9]], [[4, 9], [4, 1]], [[4, 1], [16, 1]], [[16, 1], [16, 9]]]);
  assert.deepEqual(lines.filter((l) => l.construction).map((l) => [l.a, l.b]), [[[16, 9], [4, 1]], [[4, 9], [16, 1]]]);
  assert.deepEqual(kinds(s), ["horizontal point-3 point-4", "vertical point-4 point-6", "horizontal point-6 point-8", "vertical point-8 point-3"]);
  assert.equal(drawStep(f.tool), "Draw rectangle");
  // The kernel finds one closed outline: the four sides (the diagonals left out, 47f).
  const outline = await sketchOutline(kernel, r.doc, f.id);
  assert.ok(outline, "closed");
  // The real solver keeps it a rectangle: a width of 20 on the top side moves only its end, (4, 9) → (−4, 9), and the
  // left side follows, upright: (4, 1) → (−4, 1). (The top side's start (16, 9) stays: Fusion keeps the first pick.)
  // point-3 is (16, 9), point-4 (4, 9), point-6 (4, 1), point-8 (16, 1).
  const sized = await addConstraint(kernel, r.doc, f.id, { kind: "distance", a: "point-3", b: "point-4", value: 20 });
  assert.ok("doc" in sized, "refused" in sized ? sized.refused : "");
  const t = sketchOf(sized.doc, f.id);
  assert.ok(nearXY(at(t, "point-4"), [-4, 9], 1e-6) && nearXY(at(t, "point-6"), [-4, 1], 1e-6), JSON.stringify(t.points));
  assert.ok(nearXY(at(t, "point-8"), [16, 1], 1e-6) && nearXY(at(t, "point-3"), [16, 9], 1e-6));
});

test("centre rectangle refusals and its 0.9× / 1.1× size limit", () => {
  const f = fresh("centre-rectangle");
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [5, 0]]).note, FLAT_CENTRE_RECTANGLE);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0, 5]]).note, FLAT_CENTRE_RECTANGLE);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0, 0]]).note, SAME_CLICK);
  // Width 2·|dx|: 0.9 µm is under the 1 µm piece, 1.1 µm is not.
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.00045, 5]]).note, SMALL_CENTRE_RECTANGLE);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.00055, 5]]).drew, 1);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [5, -0.00045]]).note, SMALL_CENTRE_RECTANGLE);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [5, -0.00055]]).drew, 1);
  // A refused click keeps the centre, so the next one can finish it.
  const kept = clicks(f.doc, f.tool, [[0, 0], [5, 0], [5, 3]]);
  assert.equal(kept.drew, 1);
});

test("hand-worked 3-point rectangle: first side (0, 0) → (3, 4), third click (−4, 3) is a 5 × 5 square at an angle", async () => {
  // u = (3, 4)/5 = (0.6, 0.8), n = u turned left = (−0.8, 0.6), h = (−4, 3)·n = 3.2 + 1.8 = 5. Corners: (0, 0), (3, 4),
  // (3, 4) + 5n = (−1, 7), (0, 0) + 5n = (−4, 3). Each side 5, each corner square; tilted, so no level or upright constraint.
  const f = fresh("three-rectangle");
  const r = clicks(f.doc, f.tool, [[0, 0], [3, 4], [-4, 3]]);
  assert.equal(r.drew, 1);
  const s = sketchOf(r.doc, f.id);
  const want: SketchXY[] = [[0, 0], [3, 4], [-1, 7], [-4, 3]];
  s.points.forEach((p, i) => assert.ok(nearXY([p.x, p.y], want[i], 1e-12), `${p.id} at ${p.x}, ${p.y}`));
  assert.equal(s.constraints.length, 0);
  assert.ok(await sketchOutline(kernel, r.doc, f.id));
});

test("hand-worked 3-point rectangle along x: (0, 0) → (10, 0), third (3, 4) gives (10, 4) and (0, 4) exactly, level and upright", () => {
  // u = (1, 0) exactly, n = (0, 1), h = 4: the far corners are (10, 0 + 4) and (0, 0 + 4), worked with n's 0 adding nothing.
  const f = fresh("three-rectangle");
  const r = clicks(f.doc, f.tool, [[0, 0], [10, 0], [3, 4]]);
  const s = sketchOf(r.doc, f.id);
  assert.deepEqual(s.points.map((p) => [p.x, p.y]), [[0, 0], [10, 0], [10, 4], [0, 4]]);
  assert.deepEqual(s.constraints.map((c) => c.kind), ["horizontal", "vertical", "horizontal", "vertical"]);
  // Below the side instead: h = −4, (10, −4) and (0, −4).
  const below = sketchOf(clicks(f.doc, f.tool, [[0, 0], [10, 0], [3, -4]]).doc, f.id);
  assert.deepEqual(below.points.map((p) => [p.x, p.y]), [[0, 0], [10, 0], [10, -4], [0, -4]]);
});

test("3-point rectangle refusals and its 0.9× / 1.1× limits", () => {
  const f = fresh("three-rectangle");
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0, 0]]).note, SAME_CLICK);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [10, 0], [4, 0]]).note, NO_HEIGHT);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.0009, 0], [0, 5]]).note, SHORT_FIRST_SIDE);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.0011, 0], [0, 5]]).drew, 1);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [10, 0], [4, 0.0009]]).note, SMALL_HEIGHT);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [10, 0], [4, 0.0011]]).drew, 1);
});

test("hand-worked 3-point circle: through (0, 0), (8, 0) and (0, 6) is round (4, 3) with radius 5; the three points aren't kept", async () => {
  // The three make a right angle at (0, 0), so the circle's diameter is the hypotenuse from (8, 0) to (0, 6): centre its
  // middle (4, 3), radius half its length √(64 + 36)/2 = 5. Only the centre becomes a point, as the circle tool's does.
  const f = fresh("three-circle");
  const r = clicks(f.doc, f.tool, [[0, 0], [8, 0], [0, 6]]);
  assert.equal(r.drew, 1);
  const s = sketchOf(r.doc, f.id);
  assert.equal(s.points.length, 1);
  assert.ok(nearXY(at(s, s.points[0].id), [4, 3], 1e-12));
  const c = s.curves[0];
  assert.ok(c.kind === "circle" && near(c.radius, 5, 1e-12));
  assert.equal(drawStep(f.tool), "Draw circle");
  assert.ok(await sketchOutline(kernel, r.doc, f.id));
  // On one line: no circle. The same three again: there already.
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [1, 1], [2, 2]]).note, IN_LINE);
  assert.equal(clicks(r.doc, f.tool, [[0, 0], [8, 0], [0, 6]]).note, SAME_SHAPE);
  // A third click back on the first: no circle through two points only.
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [8, 0], [0, 0]]).note, SAME_CLICK);
});

test("3-point circle radius at 0.9× and 1.1× of the smallest piece", () => {
  // (0, 0), (2r, 0), (r, r) have the right angle at (r, r), so the diameter runs (0, 0)–(2r, 0): centre (r, 0), radius r.
  const f = fresh("three-circle");
  const circle = (r: number) => clicks(f.doc, f.tool, [[0, 0], [2 * r, 0], [r, r]]);
  assert.equal(circle(0.0009).note, SMALL_THREE_CIRCLE);
  assert.equal(circle(0.0011).drew, 1);
});

test("hand-worked inscribed hexagon: centre (0, 0), corner (10, 0) has six sides of 10, the two flat ones level", async () => {
  // Corners at 10·(cos 60k°, sin 60k°): (10, 0), (5, 8.66…), (−5, 8.66…), (−10, 0), (−5, −8.66…), (5, −8.66…); a regular
  // hexagon's side is its circumradius, 10. sin 60° and sin 120° differ in the last place, so the top side is made exactly
  // level (its second corner moves by under 1e-15 mm) and gets Horizontal, and so does the bottom: two constraints.
  const f = fresh("polygon");
  assert.equal(f.tool.sides, DEFAULT_SIDES);
  const r = clicks(f.doc, f.tool, [[0, 0], [10, 0]]);
  assert.equal(r.drew, 1);
  const s = sketchOf(r.doc, f.id);
  const h = 5 * Math.sqrt(3);
  const want: SketchXY[] = [[10, 0], [5, h], [-5, h], [-10, 0], [-5, -h], [5, -h]];
  s.points.forEach((p, i) => assert.ok(nearXY([p.x, p.y], want[i], 1e-12), `${p.id} at ${p.x}, ${p.y}`));
  for (const l of linesOf(s)) assert.ok(near(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), 10, 1e-12));
  assert.equal(s.points[1].y, s.points[2].y, "the top side exactly level");
  assert.equal(s.points[4].y, s.points[5].y, "the bottom side exactly level");
  assert.deepEqual(s.constraints.map((c) => c.kind), ["horizontal", "horizontal"]);
  assert.equal(drawStep(f.tool), "Draw polygon");
  assert.ok(await sketchOutline(kernel, r.doc, f.id));
});

test("hand-worked circumscribed hexagon: an M3 nut trap 5.5 mm across the flats has upright flats 5.5 apart", () => {
  // The side's middle at (2.75, 0): the apothem a = 2.75, so across the flats is 2a = 5.5. Corners at angles −30° + 60k°
  // and distance a / cos 30° = 3.1754…: the first two (2.75, ∓1.5877…) make an upright side x = 2.75, the opposite side
  // x = −2.75 upright too (Vertical on both); each side 2a·tan 30° = 3.1754….
  const f = fresh("outside-polygon");
  const r = clicks(f.doc, f.tool, [[0, 0], [2.75, 0]]);
  const s = sketchOf(r.doc, f.id);
  const side = 5.5 * Math.tan(Math.PI / 6);
  assert.equal(s.points.length, 6);
  assert.equal(s.points[0].x, s.points[1].x, "the first side exactly upright");
  assert.ok(near(s.points[0].x, 2.75, 1e-12) && near(s.points[0].y, -side / 2, 1e-12) && near(s.points[1].y, side / 2, 1e-12));
  assert.equal(s.points[3].x, s.points[4].x, "the opposite side exactly upright");
  assert.ok(near(s.points[3].x - s.points[0].x, -5.5, 1e-12), "5.5 across the flats");
  for (const l of linesOf(s)) assert.ok(near(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), side, 1e-12));
  assert.deepEqual(s.constraints.map((c) => c.kind), ["vertical", "vertical"]);
});

test("hand-worked square polygon: corner (10, 0) round (0, 0) has its corners exactly on the axes", () => {
  // Quarter turns are exact (typed-entry.ts direction): (10, 0), (0, 10), (−10, 0), (0, −10); no side level or upright.
  const f = fresh("polygon");
  const r = clicks(f.doc, { ...f.tool, sides: 4 }, [[0, 0], [10, 0]]);
  const s = sketchOf(r.doc, f.id);
  assert.deepEqual(s.points.map((p) => [p.x, p.y]), [[10, 0], [0, 10], [-10, 0], [0, -10]]);
  assert.equal(s.constraints.length, 0);
});

test("polygon limits: sides 3 to 100, and a side at 0.9× and 1.1× of the smallest piece", () => {
  assert.deepEqual(readSides("3"), { value: 3 });
  assert.deepEqual(readSides(" 100 "), { value: MAX_SIDES });
  for (const bad of ["2", "101", "6.5", "-6", "six", ""]) assert.ok("error" in readSides(bad), bad);
  const f = fresh("polygon");
  assert.equal(clicks(f.doc, { ...f.tool, sides: 2 }, [[0, 0], [10, 0]]).note, SIDES_WORDS);
  assert.equal(clicks(f.doc, { ...f.tool, sides: 101 }, [[0, 0], [10, 0]]).note, SIDES_WORDS);
  assert.equal(clicks(f.doc, { ...f.tool, sides: 100 }, [[0, 0], [10, 0]]).drew, 1);
  // A hexagon's side is its radius.
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.0009, 0]]).note, SMALL_POLYGON);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.0011, 0]]).drew, 1);
});

test("hand-worked slot: centres (0, 0) and (20, 0), side through (7, 3), and the real solver keeps it a slot when it is sized", async () => {
  // n = (0, 1), r = 3: a1 (0, 3), b1 (0, −3), a2 (20, 3), b2 (20, −3). Line a1 → a2, the left half circle
  // counter-clockwise from a1 to b1 round (0, 0) (through (−3, 0)), line b1 → b2, the right one from b2 to a2 round
  // (20, 0) (through (23, 0)), and the centre line (0, 0) → (20, 0) dashed. Ids in drawing order: a1 point-3, a2
  // point-4, line-5; the arc's new end b1 point-6 and centre c1 point-7, arc-8; b2 point-9, line-10; c2 point-11, arc-12;
  // the centre line line-13. Six constraints: both sides level, each end's three points upright.
  const f = fresh("slot");
  const r = clicks(f.doc, f.tool, [[0, 0], [20, 0], [7, 3]]);
  assert.equal(r.drew, 1);
  const s = sketchOf(r.doc, f.id);
  assert.deepEqual(s.points.map((p) => [p.id, p.x, p.y]), [["point-3", 0, 3], ["point-4", 20, 3], ["point-6", 0, -3], ["point-7", 0, 0], ["point-9", 20, -3], ["point-11", 20, 0]]);
  assert.deepEqual(s.curves.map((c) => [c.kind, c.construction === true]), [["line", false], ["arc", false], ["line", false], ["arc", false], ["line", true]]);
  assert.deepEqual(kinds(s), ["horizontal point-3 point-4", "horizontal point-6 point-9", "vertical point-3 point-7", "vertical point-7 point-6", "vertical point-4 point-11", "vertical point-11 point-9"]);
  assert.equal(drawStep(f.tool), "Draw slot");
  assert.ok(await sketchOutline(kernel, r.doc, f.id));
  // Sized on the real solver: the top side to 30 long moves a2 to (30, 3), and the right end follows, its centre midway
  // and upright under a2: c2 (30, 0), b2 (30, −3). Then the left end's radius to 5 (c1 to a1): a1 (0, 5), b1 (0, −5),
  // and the right end's radius follows from the level sides, (30, 5) and (30, −5), centre (30, 0): still a slot.
  const long = await addConstraint(kernel, r.doc, f.id, { kind: "distance", a: "point-3", b: "point-4", value: 30 });
  assert.ok("doc" in long, "refused" in long ? long.refused : "");
  const t = sketchOf(long.doc, f.id);
  for (const [id, p] of [["point-4", [30, 3]], ["point-9", [30, -3]], ["point-11", [30, 0]], ["point-3", [0, 3]]] as const) assert.ok(nearXY(at(t, id), p, 1e-6), `${id} at ${at(t, id)}`);
  const wide = await addConstraint(kernel, long.doc, f.id, { kind: "distance", a: "point-7", b: "point-3", value: 5 });
  assert.ok("doc" in wide, "refused" in wide ? wide.refused : "");
  const w = sketchOf(wide.doc, f.id);
  for (const [id, p] of [["point-3", [0, 5]], ["point-6", [0, -5]], ["point-7", [0, 0]], ["point-4", [30, 5]], ["point-9", [30, -5]], ["point-11", [30, 0]]] as const) assert.ok(nearXY(at(w, id), p, 1e-6), `${id} at ${at(w, id)}`);
  assert.ok(await sketchOutline(kernel, wide.doc, f.id));
});

test("hand-worked upright and tilted slots: an upright one gets the same six turned, a tilted one only its arcs", async () => {
  // Centres (0, 0) and (0, 10), side through (2, 5): u = (0, 1), n = (−1, 0), h = −2, r = 2. a1 = (−2, 0), b1 = (2, 0),
  // a2 = (−2, 10), b2 = (2, 10); the first arc counter-clockwise from (−2, 0) to (2, 0) round (0, 0) goes through (0, −2),
  // the end away from the other centre. Sides upright, each end's points level with its centre.
  const f = fresh("slot");
  const up = sketchOf(clicks(f.doc, f.tool, [[0, 0], [0, 10], [2, 5]]).doc, f.id);
  assert.deepEqual(up.points.map((p) => [p.x, p.y]), [[-2, 0], [-2, 10], [2, 0], [0, 0], [2, 10], [0, 10]]);
  assert.deepEqual(up.constraints.map((c) => c.kind), ["vertical", "vertical", "horizontal", "horizontal", "horizontal", "horizontal"]);
  // Tilted, centres (0, 0) and (6, 8): nothing is exactly level or upright, so nothing is added; still a closed outline.
  const tilted = clicks(f.doc, f.tool, [[0, 0], [6, 8], [0, 5]]);
  assert.equal(sketchOf(tilted.doc, f.id).constraints.length, 0);
  assert.ok(await sketchOutline(kernel, tilted.doc, f.id));
});

test("hand-worked overall slot: ends (0, 0) and (26, 0), side through (10, 3), has its centres 3 in, at (3, 0) and (23, 0)", async () => {
  const f = fresh("overall-slot");
  const r = clicks(f.doc, f.tool, [[0, 0], [26, 0], [10, 3]]);
  const s = sketchOf(r.doc, f.id);
  assert.deepEqual(s.points.map((p) => [p.x, p.y]), [[3, 3], [23, 3], [3, -3], [3, 0], [23, -3], [23, 0]]);
  assert.ok(await sketchOutline(kernel, r.doc, f.id));
});

test("slot refusals and their 0.9× / 1.1× limits", () => {
  const f = fresh("slot");
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [20, 0], [5, 0]]).note, NO_WIDTH);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.0009, 0], [0, 5]]).note, SHORT_SLOT);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [0.0011, 0], [0, 5]]).drew, 1);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [20, 0], [5, 0.0009]]).note, SMALL_SLOT);
  assert.equal(clicks(f.doc, f.tool, [[0, 0], [20, 0], [5, 0.0011]]).drew, 1);
  // Overall: its centres r in from each end must still be the smallest piece apart, L − 2r ≥ 0.001.
  const o = fresh("overall-slot");
  assert.equal(clicks(o.doc, o.tool, [[0, 0], [6.0009, 0], [3, 3]]).note, SHORT_OVERALL_SLOT);
  assert.equal(clicks(o.doc, o.tool, [[0, 0], [6.0011, 0], [3, 3]]).drew, 1);
  assert.equal(clicks(o.doc, o.tool, [[0, 0], [4, 0], [3, 3]]).note, SHORT_OVERALL_SLOT, "wider than it is long");
});

test("a sketch point stays when the curves round it go, is picked by Select and deleted on its own", () => {
  // Point (3, 4) is point-3; a line (10, 0) → (10, 5) is points 4 and 5 and line-6. Deleting the line takes its two
  // points (only it used them) but not point-3, which was alone before.
  const f = fresh("point");
  const p = clicks(f.doc, f.tool, [[3, 4]]);
  assert.equal(p.drew, 1);
  assert.equal(drawStep(f.tool), "Draw point");
  assert.equal(toolBusy(p.tool), false, "a point is one click: nothing is ever half done");
  assert.equal(curveCount(sketchOf(p.doc, f.id)), "1 point");
  const l = drawLine(p.doc, f.id, [10, 0], [10, 5]);
  assert.equal(curveCount(sketchOf(l.doc, f.id)), "1 line and 1 point", "a line's ends are not counted as points");
  const gone = deleteCurve(l.doc, f.id, l.id);
  assert.deepEqual(sketchOf(gone, f.id).points.map((q) => [q.id, q.x, q.y]), [["point-3", 3, 4]]);
  // A second point on it, or on a line's end, is refused: it is there already.
  assert.equal(clicks(gone, f.tool, [[3, 4]]).note, POINT_THERE);
  assert.equal(clicks(l.doc, f.tool, [[10, 5]]).note, POINT_THERE);
  // Select picks it over the line it sits by (reach 1 mm), says what it is, and Delete takes it alone.
  const s = sketchOf(l.doc, f.id);
  assert.equal(selectAt(s, [3.2, 4], 1, 0.5), "point-3");
  assert.equal(selectAt(s, [9.8, 2], 1, 0.5), l.id, "a curve is picked as before");
  assert.equal(pickedWords(s, ["point-3"]), "1 point");
  assert.deepEqual(stillPicked(s, ["point-3", "point-4"]), ["point-3"], "a line's end is not picked as a point");
  const deleted = sketchOf(deleteCurves(l.doc, f.id, ["point-3"]), f.id);
  assert.deepEqual(deleted.points.map((q) => q.id), ["point-4", "point-5"]);
  assert.equal(deleted.curves.length, 1);
});

test("shapes share the sketch's points: a centre rectangle round a rectangle already there adds only its diagonals", () => {
  // The rectangle tool's (0, 0)–(10, 6) is points 3, 4, 6, 8; the centre rectangle at (5, 3) with corner (10, 6) has the
  // same four corners, so its sides are those four lines: only the two construction diagonals are new, and no
  // constraint (the rectangle drawn with drawRectangle had none; the shape's own sides get theirs).
  const s = addSketch(partDocument("box", 40, 30, 20));
  const rect = drawRectangle(s.doc, s.id, [0, 0], [10, 6]);
  const before = sketchOf(rect.doc, s.id);
  const r = clicks(rect.doc, startTool("centre-rectangle", s.id) as ShapeTool, [[5, 3], [10, 6]]);
  const after = sketchOf(r.doc, s.id);
  assert.equal(after.points.length, before.points.length);
  assert.deepEqual(after.curves.slice(4).map((c) => c.kind === "line" && c.construction), [true, true]);
  assert.equal(after.constraints.length, 4, "its sides kept level and upright");
  // Drawn again: nothing new at all.
  assert.equal(clicks(r.doc, startTool("centre-rectangle", s.id) as ShapeTool, [[5, 3], [10, 6]]).note, SAME_SHAPE);
});

test("typed sizes: a centre rectangle's width and height, a polygon's sides and diameter, a 3-point rectangle's height and a slot's width", () => {
  const doc = fresh("point").doc;
  // Centre (0, 0): width 12 and height 8 put the corner at (±6, ±4) on the pointer's side, (1, −1) → (6, −4).
  const cr: ShapeTool = { kind: "centre-rectangle", sketch: "sketch-2", clicks: [[0, 0]] };
  assert.deepEqual(typedFields(cr), ["width", "height"]);
  assert.deepEqual(aimOf(doc, cr, [1, -1], { width: 12, height: 8 }), [6, -4]);
  assert.deepEqual(liveValues([0, 0], [6, -4], cr), { width: 12, height: 8 });
  // Polygon round (0, 0): diameter 10 is a corner 5 out the pointer's way, (6, 8) → (3, 4); 8 sides typed are drawn.
  const pg: ShapeTool = { kind: "polygon", sketch: "sketch-2", clicks: [[0, 0]], sides: 6 };
  assert.deepEqual(typedFields(pg), ["sides", "diameter", "angle"]);
  assert.deepEqual(aimOf(doc, pg, [6, 8], { diameter: 10 }), [3, 4]);
  assert.deepEqual(aimOf(doc, pg, null, { diameter: 10, angle: 90 }), [0, 5]);
  const eight = withLocks(pg, { sides: 8 }, null);
  assert.equal(eight.sides, 8);
  const drawn = clicks(doc, eight, [[10, 0]]);
  assert.equal(sketchOf(drawn.doc, "sketch-2").points.length, 8);
  assert.equal(drawn.tool.sides, 8, "the next polygon keeps the sides typed");
  assert.equal(liveValues([0, 0], [3, 4], pg).sides, 6);
  // 3-point rectangle, first side (0, 0) → (10, 0): height 5 below it, the pointer at (3, −2) → (10, −5).
  const tr: ShapeTool = { kind: "three-rectangle", sketch: "sketch-2", clicks: [[0, 0], [10, 0]] };
  assert.deepEqual(typedFields(tr), ["height"]);
  assert.deepEqual(anchorOf(doc, tr), [10, 0]);
  assert.deepEqual(aimOf(doc, tr, [3, -2], { height: 5 }), [10, -5]);
  assert.deepEqual(liveValues([10, 0], [3, -2], tr), { height: 2 });
  // Slot, centres (0, 0) and (20, 0): width 6 is 3 off the centre line, the pointer's side, (5, 1) → (20, 3).
  const sl: ShapeTool = { kind: "slot", sketch: "sketch-2", clicks: [[0, 0], [20, 0]] };
  assert.deepEqual(typedFields(sl), ["width"]);
  assert.deepEqual(aimOf(doc, sl, [5, 1], { width: 6 }), [20, 3]);
  assert.deepEqual(liveValues([20, 0], [5, 1], sl), { width: 2 });
  // The second centre by length and angle, as a line's end.
  assert.deepEqual(typedFields({ ...sl, clicks: [[0, 0]] }), ["length", "angle"]);
  assert.deepEqual(aimOf(doc, { ...sl, clicks: [[0, 0]] }, null, { length: 20, angle: 90 }), [0, 20]);
  // No boxes before the first click, nor ever for a 3-point circle or a point.
  for (const kind of SHAPE_KINDS) assert.deepEqual(typedFields(startTool(kind, "sketch-2")), []);
  assert.deepEqual(typedFields({ kind: "three-circle", sketch: "sketch-2", clicks: [[0, 0], [1, 0]] }), []);
});

test("hints, the unfinished-shape words, the preview and the clicks drawn while a shape is half done", () => {
  const f = fresh("slot");
  assert.equal(hintOf(f.tool), "Place first centre");
  const one = clicks(f.doc, f.tool, [[0, 0]]).tool;
  assert.equal(hintOf(one), "Place second centre");
  assert.equal(unfinishedWords(one, "Finish sketch"), "The slot isn't finished: click its second centre, then a point on its side to finish it, or press Finish sketch again to go on without it.");
  assert.equal(unfinishedWords(f.tool, "Finish sketch"), null, "nothing clicked: nothing lost");
  // The preview: the centre line until the second centre is down, then the whole slot (2 lines, 2 half circles of 32
  // segments each, the centre line).
  assert.deepEqual(previewSegments(f.doc, one, [20, 0]), [[[0, 0], [20, 0]]]);
  const two = clicks(f.doc, one, [[20, 0]]).tool;
  assert.equal(previewSegments(f.doc, two, [5, 3]).length, 2 + 32 + 32 + 1);
  assert.deepEqual(previewSegments(f.doc, two, [5, 0]), [[[0, 0], [20, 0]]], "no width: only the centre line");
  // The clicks show as points while the shape is half done.
  const drawing = sketchDrawings(f.doc, { tool: two, grid: 10, pointer: null })[0];
  assert.deepEqual(drawing.editing?.points, [[0, 0], [20, 0]]);
  for (const kind of SHAPE_KINDS) assert.ok(SHAPE_CLICKS[kind] >= 1 && hintOf(startTool(kind, f.id)).startsWith("Place"), kind);
});

/** The distance from p to the segment a–b. */
function toSegment(p: SketchXY, a: SketchXY, b: SketchXY): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

test("seeded random shapes against a plain model of each: right corners, equal sides on one circle, tangent slot ends, closed outlines", async () => {
  // The model knows only what each shape is: a rectangle's four sides meet square and its far corner is where the
  // clicks say; a polygon's corners are all the same distance from its centre, its sides all one length; a slot's
  // straight sides are its radius from both centres and its arcs half circles. Clicks on a 0.5 mm grid.
  const seed = BigInt(process.env.FISSION_SEED ?? 52_003);
  const rand = seeded(seed);
  const grid = (): number => Math.round((rand.next() * 80 - 40) * 2) / 2;
  const click = (): SketchXY => [grid(), grid()];
  let drawn = 0;
  for (let k = 0; k < 160; k++) {
    const kind = SHAPE_KINDS[k % SHAPE_KINDS.length];
    const f = fresh(kind);
    const sides = 3 + Math.floor(rand.next() * 10);
    const tool = kind === "polygon" || kind === "outside-polygon" ? { ...f.tool, sides } : f.tool;
    const ps = Array.from({ length: SHAPE_CLICKS[kind] }, click);
    const r = clicks(f.doc, tool, ps);
    const plan = shapePlan(kind, ps, sides);
    const why = `seed ${seed}, shape ${k} (${kind}) at ${JSON.stringify(ps)}`;
    assert.equal(r.drew, "note" in plan ? 0 : 1, why);
    if ("note" in plan) continue;
    drawn++;
    const s = sketchOf(r.doc, f.id);
    const scale = 1e-9 * 100;
    if (kind === "centre-rectangle" || kind === "three-rectangle") {
      const c = s.points.map((p): SketchXY => [p.x, p.y]);
      for (let i = 0; i < 4; i++) {
        const [a, b, d] = [c[i], c[(i + 1) % 4], c[(i + 3) % 4]];
        assert.ok(Math.abs((b[0] - a[0]) * (d[0] - a[0]) + (b[1] - a[1]) * (d[1] - a[1])) <= scale * 100, `${why}: corner ${i} square`);
      }
      if (kind === "centre-rectangle") assert.ok(nearXY([(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2], ps[0], 1e-12), `${why}: centred`);
      else assert.ok(nearXY(c[0], ps[0]) && nearXY(c[1], ps[1]), `${why}: its first side where clicked`);
    }
    if (kind === "polygon" || kind === "outside-polygon") {
      const R = kind === "polygon" ? Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]) : Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]) / Math.cos(Math.PI / sides);
      assert.equal(s.points.length, sides, why);
      for (const p of s.points) assert.ok(near(Math.hypot(p.x - ps[0][0], p.y - ps[0][1]), R, scale), `${why}: corner on the circle`);
      const side = 2 * R * Math.sin(Math.PI / sides);
      for (const l of linesOf(s)) assert.ok(near(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), side, scale), `${why}: equal sides`);
      // Inscribed: the second click is a corner; circumscribed: the middle of the first side.
      const target = kind === "polygon" ? [s.points[0].x, s.points[0].y] : [(s.points[0].x + s.points[1].x) / 2, (s.points[0].y + s.points[1].y) / 2];
      assert.ok(nearXY(target as SketchXY, ps[1], scale), `${why}: through the click`);
    }
    if (kind === "slot" || kind === "overall-slot") {
      const arcs = s.curves.filter((c) => c.kind === "arc");
      const centres = arcs.map((a) => (a.kind === "arc" ? at(s, a.centre) : [0, 0])) as SketchXY[];
      const radius = arcs.map((a) => (a.kind === "arc" ? Math.hypot(at(s, a.start)[0] - at(s, a.centre)[0], at(s, a.start)[1] - at(s, a.centre)[1]) : 0));
      for (const l of linesOf(s).filter((x) => !x.construction))
        for (const c of centres) assert.ok(near(toSegment(c, l.a, l.b), radius[0], scale), `${why}: a side is the radius from each centre`);
      if (kind === "overall-slot") assert.ok(near(Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]), Math.hypot(centres[1][0] - centres[0][0], centres[1][1] - centres[0][1]) + 2 * radius[0], scale), `${why}: overall length`);
    }
    if (kind !== "point") assert.ok(await sketchOutline(kernel, r.doc, f.id), `${why}: closed outline`);
  }
  assert.ok(drawn > 120, `most random shapes draw (${drawn} of 160)`);
});
