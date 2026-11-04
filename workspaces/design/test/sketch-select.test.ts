// Selecting and deleting single sketch curves (missing basics, Ben 2026-11-04):
// sketch-select.ts worked by hand (distances from geometry), the reach at
// 0.9× and 1.1×, the picks a click leaves, the delete and its undo step's
// name, and what the viewport is told to light. The app on the real kernel:
// packages/testing/journeys/sketch-select.journey.ts; the browser:
// apps/fission/e2e/sketch-select.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawArc, drawCircle, drawLine } from "../src/sketch.ts";
import { SNAP_PIXELS } from "../src/snap.ts";
import { curveAt, PICK_PIXELS, deleteCurves, deleteStep, pickCurve, pickedWords, selectStatus, stillPicked, toArc, toCurve, toSegment } from "../src/sketch-select.ts";
import { sketchDrawings, startTool, toolBusy, type SelectTool } from "../src/sketch-tool.ts";

const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-12 * Math.max(1, Math.abs(want)), `${got} is not ${want}`);

/**
 * A box, then Sketch 1 (sketch-2) with: line-5 from (0, 0) to (10, 0)
 * (points 3 and 4); line-7 from (10, 0) to (10, 10) (point-4 shared, point-6);
 * circle-9 round (30, 0) radius 5 (point-8); and arc-13 counter-clockwise
 * from (10, 20) to (0, 30) round (0, 20), a quarter turn of radius 10
 * (points 10, 11, 12: drawArc names the start, end and centre in that order).
 */
function sketched(): { doc: DesignDocument; id: string } {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const one = drawLine(s.doc, s.id, [0, 0], [10, 0]);
  const two = drawLine(one.doc, s.id, "point-4", [10, 10]);
  const circle = drawCircle(two.doc, s.id, [30, 0], 5);
  const arc = drawArc(circle.doc, s.id, [10, 20], [0, 30], [0, 20]);
  return { doc: arc.doc, id: s.id };
}
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;

test("the fixture's ids are as the comment says (every id from the one counter)", () => {
  const { doc, id } = sketched();
  assert.equal(id, "sketch-2");
  assert.deepEqual(sketchOf(doc, id).curves.map((c) => `${c.kind} ${c.id}`), ["line line-5", "line line-7", "circle circle-9", "arc arc-13"]);
});

test("hand-worked: distances to a segment, within it and past either end", () => {
  // Segment (0,0)–(10,0) along x. (3,4) is above x = 3, inside: straight down, 4.
  near(toSegment([3, 4], [0, 0], [10, 0]), 4);
  // (−3,4) is past the start: to (0,0), √(9+16) = 5. (13,4) past the end: to (10,0), √(9+16) = 5.
  near(toSegment([-3, 4], [0, 0], [10, 0]), 5);
  near(toSegment([13, 4], [0, 0], [10, 0]), 5);
  // A slanted segment (0,0)–(4,4): the foot of (4,0) on it is (2,2), so √((4−2)² + (0−2)²) = √8.
  near(toSegment([4, 0], [0, 0], [4, 4]), Math.sqrt(8));
  // Away from the origin: (2,3)–(12,3); (5,7) is 4 above it, (−1,7) is past its start, √(9+16) = 5 from (2,3).
  near(toSegment([5, 7], [2, 3], [12, 3]), 4);
  near(toSegment([-1, 7], [2, 3], [12, 3]), 5);
  // And slanted away from the origin: (1,1)–(5,5); the foot of (5,1) is (3,3), √(4+4) = √8.
  near(toSegment([5, 1], [1, 1], [5, 5]), Math.sqrt(8));
  // A segment of no length is its one point: (3,4) from (0,0) is 5.
  near(toSegment([3, 4], [0, 0], [0, 0]), 5);
});

test("hand-worked: distances to an arc, inside its sweep and outside it, the short way round and the long way", () => {
  // Quarter arc counter-clockwise from (10,0) to (0,10) round (0,0), radius 10.
  // (6,8) is on the circle (6² + 8² = 100) at 53°, inside 0°..90°: 0.
  near(toArc([6, 8], [10, 0], [0, 10], [0, 0]), 0);
  // (3,4) at 53° too, 5 from the centre: 10 − 5 = 5.
  near(toArc([3, 4], [10, 0], [0, 10], [0, 0]), 5);
  // The centre itself is radius 10 from every point of the arc.
  near(toArc([0, 0], [10, 0], [0, 10], [0, 0]), 10);
  // (0,−10) is on the circle at 270°, outside the sweep: the nearer end is (10,0), √(100+100).
  near(toArc([0, -10], [10, 0], [0, 10], [0, 0]), Math.sqrt(200));
  // The other three quarters: counter-clockwise from (0,10) to (10,0), 90° round to 360°. (6,8) at 53° is now
  // outside: the nearer end is (0,10), √(36+4) = √40 (to (10,0) it is √(16+64) = √80). (−6,−8) at 233° is inside, on it: 0.
  near(toArc([6, 8], [0, 10], [10, 0], [0, 0]), Math.sqrt(40));
  near(toArc([-6, -8], [0, 10], [10, 0], [0, 0]), 0);
  // Away from the origin: a quarter round (20,10) from (30,10) to (20,20). (26,18) is (6,8) from the centre: on it, 0.
  near(toArc([26, 18], [30, 10], [20, 20], [20, 10]), 0);
  // (20,0) is (0,−10) from the centre, at 270°, outside: to the start (30,10), √(100+100).
  near(toArc([20, 0], [30, 10], [20, 20], [20, 10]), Math.sqrt(200));
  // (14,2) is (−6,−8) from the centre, at 233°, outside: to the start √(256+64) = √320, to the end √(36+324) = √360; √320.
  near(toArc([14, 2], [30, 10], [20, 20], [20, 10]), Math.sqrt(320));
  // (23,14) is (3,4) from the centre, inside: 10 − 5 = 5 (a wrong centre would put it elsewhere).
  near(toArc([23, 14], [30, 10], [20, 20], [20, 10]), 5);
  // (15,15) is (−5,5) from the centre, at 135°, outside: to the end (20,20) √50, to the start √(225+25); √50.
  near(toArc([15, 15], [30, 10], [20, 20], [20, 10]), Math.sqrt(50));
});

test("hand-worked: distances to each kind of the fixture's curves", () => {
  const { doc, id } = sketched();
  const s = sketchOf(doc, id);
  const curve = (cid: string) => s.curves.find((c) => c.id === cid)!;
  // line-7 runs up x = 10 from y 0 to 10: (12, 5) is 2 off it.
  near(toCurve(s, curve("line-7"), [12, 5]), 2);
  // circle-9, radius 5 round (30, 0): (33, 4) is 5 from the centre (3-4-5), on it; (36, 8) is 10 out, so 5 off.
  near(toCurve(s, curve("circle-9"), [33, 4]), 0);
  near(toCurve(s, curve("circle-9"), [36, 8]), 5);
  // arc-13, radius 10 round (0, 20) from 0° to 90°: (6, 28) is (6, 8) from the centre, on it.
  near(toCurve(s, curve("arc-13"), [6, 28]), 0);
  // A curve naming a point the sketch lacks is never near (a broken file is refused on reading; this never throws).
  assert.equal(toCurve(s, { id: "line-99", kind: "line", start: "point-404", end: "point-3" }, [0, 0]), Infinity);
});

test("boundary: a click 0.9 × the reach from a line picks it, 1.1 × the reach picks nothing", () => {
  const { doc, id } = sketched();
  const s = sketchOf(doc, id);
  const reach = 1; // 10 pixels of 0.1 mm, the app's snap reach
  // line-5 lies on y = 0 from x 0 to 10; (5, ±0.9) is 0.9 off it, (5, −1.1) is 1.1 off it (and nothing else is within 1).
  assert.equal(curveAt(s, [5, 0.9 * reach], reach), "line-5");
  assert.equal(curveAt(s, [5, -0.9 * reach], reach), "line-5");
  assert.equal(curveAt(s, [5, -1.1 * reach], reach), null);
  // Exactly the reach away still picks (the reach is how far a pick goes, inclusive).
  assert.equal(curveAt(s, [5, -reach], reach), "line-5");
  // The same for the circle's rim (radius 5 round (30, 0)): 5.9 from its centre is 0.9 out, 6.1 is 1.1 out; 4.1 is 0.9 in.
  assert.equal(curveAt(s, [35.9, 0], reach), "circle-9");
  assert.equal(curveAt(s, [34.1, 0], reach), "circle-9");
  assert.equal(curveAt(s, [36.1, 0], reach), null);
  // And past the arc's end: (−0.9, 30) is 0.9 from its end (0, 30) but outside its sweep; (−1.1, 30) is 1.1 away.
  assert.equal(curveAt(s, [-0.9, 30], reach), "arc-13");
  assert.equal(curveAt(s, [-1.1, 30], reach), null);
});

test("the pick's reach: a snap's 10 px with a mouse, 24 px for a finger (Move's handles' room)", () => {
  assert.equal(PICK_PIXELS.mouse, SNAP_PIXELS);
  assert.equal(PICK_PIXELS.touch, 24);
});

test("the nearest curve wins; on a tie the later drawn, which lies on top", () => {
  const { doc, id } = sketched();
  const s = sketchOf(doc, id);
  // Near the corner (10, 0) where both lines meet: (10.4, 0.2) is √(0.4² + 0.2²) ≈ 0.447 from line-5 (y = 0, x ≤ 10,
  // so past its end) and 0.4 from line-7 (x = 10, y 0..10). line-7 is nearer.
  assert.equal(curveAt(s, [10.4, 0.2], 1), "line-7");
  // (9.8, −0.4): to line-5, 0.4; to line-7 (past its start (10, 0)), √(0.04 + 0.16) ≈ 0.447. line-5 is nearer.
  assert.equal(curveAt(s, [9.8, -0.4], 1), "line-5");
  // The corner itself is 0 from both: line-7 is the later drawn.
  assert.equal(curveAt(s, [10, 0], 1), "line-7");
  // Nothing drawn, nothing picked.
  assert.equal(curveAt({ ...s, curves: [] }, [10, 0], 1), null);
});

test("hand-worked: what a click leaves picked, with and without Shift", () => {
  // A click on a curve picks only it; Shift adds it, or takes it out when picked; on nothing a click clears, Shift keeps.
  assert.deepEqual(pickCurve([], "line-5", false), ["line-5"]);
  assert.deepEqual(pickCurve(["line-5", "line-7"], "circle-9", false), ["circle-9"]);
  assert.deepEqual(pickCurve(["line-5"], "line-7", true), ["line-5", "line-7"]);
  assert.deepEqual(pickCurve(["line-5", "line-7"], "line-5", true), ["line-7"]);
  assert.deepEqual(pickCurve(["line-5"], null, false), []);
  assert.deepEqual(pickCurve(["line-5"], null, true), ["line-5"]);
  // A plain click on the one picked keeps it picked (it never toggles off without Shift).
  assert.deepEqual(pickCurve(["line-5"], "line-5", false), ["line-5"]);
});

test("deleting picks: points only they used go, shared ones stay, ids not there are passed over, and the file still reads", () => {
  const { doc, id } = sketched();
  // line-5 and the circle: point-3 (line-5's start only) and point-8 (the centre) go; point-4 is line-7's start too, so stays.
  const gone = deleteCurves(doc, id, ["line-5", "circle-9", "line-404"]);
  const s = sketchOf(gone, id);
  assert.deepEqual(s.curves.map((c) => c.id), ["line-7", "arc-13"]);
  assert.deepEqual(s.points.map((p) => p.id), ["point-4", "point-6", "point-10", "point-11", "point-12"]);
  assert.equal(gone.nextId, doc.nextId, "a delete never moves the counter back");
  assert.deepEqual(readDesignDocument(structuredClone(gone)), gone);
  // Everything picked: the sketch stays in the timeline, empty.
  const all = deleteCurves(doc, id, ["line-5", "line-7", "circle-9", "arc-13"]);
  assert.deepEqual(sketchOf(all, id), { id, points: [], curves: [], constraints: [] });
  assert.ok(all.timeline.features.some((f) => f.id === id));
  // Nothing picked, or a sketch not there: the same document.
  assert.equal(deleteCurves(doc, id, []), doc);
  assert.equal(deleteCurves(doc, "sketch-404", ["line-5"]), doc);
  // Only the named sketch's curves go: with a second sketch drawn after, deleting from it leaves Sketch 1 alone.
  const second = addSketch(doc);
  const other = drawLine(second.doc, second.id, [50, 50], [60, 50]);
  const fromSecond = deleteCurves(other.doc, second.id, [other.id]);
  assert.deepEqual(sketchOf(fromSecond, id), sketchOf(doc, id));
  assert.deepEqual(sketchOf(fromSecond, second.id).curves, []);
});

test("the picks' words and the undo step's name", () => {
  const { doc, id } = sketched();
  const s = sketchOf(doc, id);
  assert.equal(deleteStep(s, ["line-5"]), "Delete line");
  assert.equal(deleteStep(s, ["circle-9"]), "Delete circle");
  assert.equal(deleteStep(s, ["arc-13"]), "Delete arc");
  assert.equal(deleteStep(s, ["line-5", "line-7", "arc-13"]), "Delete 3 curves");
  // A pick an undo took out is not counted.
  assert.equal(deleteStep(s, ["line-5", "line-404"]), "Delete line");
  assert.equal(pickedWords(s, ["line-5", "line-7", "circle-9", "arc-13"]), "2 lines, 1 arc and 1 circle");
  assert.equal(pickedWords(s, ["circle-9", "line-7"]), "1 line and 1 circle");
  assert.equal(pickedWords(s, []), "");
  assert.equal(selectStatus(s, ["line-7"]), "Selected: 1 line. Press Delete or Backspace, or the Delete button, to remove it.");
  assert.equal(selectStatus(s, ["line-7", "arc-13"]), "Selected: 1 line and 1 arc. Press Delete or Backspace, or the Delete button, to remove them.");
  assert.equal(selectStatus(s, ["line-404"]), "");
  assert.deepEqual(stillPicked(s, ["arc-13", "line-404", "line-5"]), ["arc-13", "line-5"]);
  assert.deepEqual(stillPicked(undefined, ["line-5"]), []);
  assert.equal(pickedWords(undefined, ["line-5"]), "");
  assert.equal(pickedWords(s, ["line-404"]), "", "a pick not there is no word");
  // A projected curve (27d) is a projected edge, in words and in the step's name.
  const projected = { ...s, projected: [{ made: "line-7" }] } as unknown as Sketch;
  assert.equal(pickedWords(projected, ["line-5", "line-7"]), "1 line and 1 projected edge");
  assert.equal(deleteStep(projected, ["line-7"]), "Delete projected edge");
});

test("the Select tool places nothing, is never busy, and the viewport lights its picks and the curve under the pointer", () => {
  const { doc, id } = sketched();
  const tool = startTool("select", id) as SelectTool;
  assert.deepEqual(tool, { kind: "select", sketch: id, picked: [], hover: null });
  assert.equal(toolBusy(tool), false, "Escape has nothing half drawn to drop");
  const drawn = (t: SelectTool) => sketchDrawings(doc, { tool: t, grid: 1, pointer: [5, 0] }).find((d) => d.editing)!.editing!;
  // Nothing picked or hovered: neither is sent, and there is no preview.
  const plain = drawn(tool);
  assert.equal(plain.picked, undefined);
  assert.equal(plain.hover, undefined);
  assert.deepEqual(plain.preview, []);
  // line-5 picked: its one segment, (0,0)–(10,0); line-7 under the pointer: its segment (10,0)–(10,10), lighter.
  const lit = drawn({ ...tool, picked: ["line-5"], hover: "line-7" });
  assert.deepEqual(lit.picked, [[[0, 0], [10, 0]]]);
  assert.deepEqual(lit.hover, [[[10, 0], [10, 10]]]);
  // The circle picked is drawn as its 64 segments; a hover over a picked curve is not drawn twice.
  const circle = drawn({ ...tool, picked: ["circle-9"], hover: "circle-9" });
  assert.equal(circle.picked!.length, 64);
  assert.equal(circle.hover, undefined);
  // A pick the sketch no longer holds lights nothing.
  assert.deepEqual(drawn({ ...tool, picked: ["line-404"], hover: null }).picked, []);
});
