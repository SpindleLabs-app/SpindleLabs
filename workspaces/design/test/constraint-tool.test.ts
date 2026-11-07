// The constraint tools (step 47d2, constraint-tool.ts): what the pointer
// picks (a point before a line; lines only for Horizontal and Vertical),
// the reach at 0.9× and 1.1×, what each click does, and each mark's
// segments worked by hand. Adding on the solver: constraints.test.ts; in
// the browser: apps/fission/e2e/sketch-constraints.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clickConstraint, constraintHint, constraintMarks, constraintPickAt, constraintStep, isConstraintTool, markAt, startConstraintTool } from "../src/constraint-tool.ts";
import { deleteCurves, deleteStep, pickedWords, stillPicked } from "../src/sketch-select.ts";
import { partDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawLine } from "../src/sketch.ts";
import { startTool } from "../src/sketch-tool.ts";

/** Sketch 1 with line-5 from (0, 0) to (10, 0): points 3 and 4. */
function oneLine(): Sketch {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return drawLine(s.doc, s.id, [0, 0], [10, 0]).doc.sketches.find((x) => x.id === s.id)!;
}

test("a point within reach is picked before the line it ends", () => {
  const s = oneLine();
  // (0.5, 0.2) is 0.539 from point-3 (√(0.25 + 0.04)) and 0.2 from the line: the point wins at reach 1.
  assert.deepEqual(constraintPickAt(s, "horizontal", [0.5, 0.2], 1), { point: "point-3" });
  // (5, 0.2): 5 from either end, 0.2 from the line: the line, for Horizontal and Vertical only.
  assert.deepEqual(constraintPickAt(s, "vertical", [5, 0.2], 1), { line: "line-5" });
  assert.equal(constraintPickAt(s, "coincident", [5, 0.2], 1), null);
  assert.equal(constraintPickAt(s, "fix", [5, 0.2], 1), null);
});

test("the reach at 0.9× and 1.1×", () => {
  const s = oneLine();
  // point-4 is (10, 0); the pointer 0.9 and 1.1 of the reach 2 above it.
  assert.deepEqual(constraintPickAt(s, "fix", [10, 1.8], 2), { point: "point-4" });
  assert.equal(constraintPickAt(s, "fix", [10, 2.2], 2), null);
  // The line from (5, ±0.9·2) is picked, from (5, 1.1·2) not.
  assert.deepEqual(constraintPickAt(s, "horizontal", [5, -1.8], 2), { line: "line-5" });
  assert.equal(constraintPickAt(s, "horizontal", [5, 2.2], 2), null);
});

test("what each click does", () => {
  const s = oneLine();
  // A line picked with Horizontal: its start (held) then its end, at once.
  const h = startConstraintTool("horizontal", s.id);
  assert.deepEqual(clickConstraint(h, s, { line: "line-5" }).add, { kind: "horizontal", a: "point-3", b: "point-4" });
  // Two points with Coincident: the first is remembered, the second makes it (first held).
  const c1 = clickConstraint(startConstraintTool("coincident", s.id), s, { point: "point-4" });
  assert.equal(c1.add, null);
  assert.equal(c1.tool.first, "point-4");
  // The same point again, or nothing, keeps the first.
  assert.equal(clickConstraint(c1.tool, s, { point: "point-4" }).tool.first, "point-4");
  assert.equal(clickConstraint(c1.tool, s, null).tool.first, "point-4");
  const c2 = clickConstraint(c1.tool, s, { point: "point-3" });
  assert.deepEqual(c2.add, { kind: "coincident", a: "point-4", b: "point-3" });
  assert.equal(c2.tool.first, null);
  // Fix: one point.
  assert.deepEqual(clickConstraint(startConstraintTool("fix", s.id), s, { point: "point-3" }).add, { kind: "fix", point: "point-3" });
  // A pick clears the red of a refusal.
  assert.deepEqual(clickConstraint({ ...h, fighting: ["c"] }, s, null).tool.fighting, []);
  // A line is not a pick for Coincident.
  assert.equal(clickConstraint(startConstraintTool("coincident", s.id), s, { line: "line-5" }).add, null);
});

test("each mark's segments, by hand", () => {
  const s: Sketch = { ...oneLine(), constraints: [
    { id: "h", kind: "horizontal", a: "point-3", b: "point-4" },
    { id: "f", kind: "fix", point: "point-3" },
    { id: "c", kind: "coincident", a: "point-4", b: "point-3" },
  ] };
  const m = constraintMarks(s, 2);
  // Horizontal: the middle of (0, 0) and (10, 0) is (5, 0); a bar 2 long, 2 above it: (4, 2)–(6, 2).
  assert.deepEqual(m.get("h"), [[[4, 2], [6, 2]]]);
  // Fix: a square of side 2 round (0, 0) and its two diagonals: 6 segments.
  assert.deepEqual(m.get("f"), [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]], [[-1, -1], [1, 1]], [[1, -1], [-1, 1]]]);
  // Coincident: a diamond round its first point (10, 0), 1 out each way.
  assert.deepEqual(m.get("c"), [[[10, -1], [11, 0]], [[11, 0], [10, 1]], [[10, 1], [9, 0]], [[9, 0], [10, -1]]]);
  // Vertical: a bar 2 to the right of the middle.
  const v = constraintMarks({ ...s, constraints: [{ id: "v", kind: "vertical", a: "point-3", b: "point-4" }] }, 2);
  assert.deepEqual(v.get("v"), [[[7, -1], [7, 1]]]);
});

test("the tools start from the sketch toolbar's kinds, with their hints and undo names", () => {
  const t = startTool("vertical", "sketch-2");
  assert.ok(isConstraintTool(t));
  assert.equal(isConstraintTool(startTool("line", "sketch-2")), false);
  assert.equal(constraintHint(startConstraintTool("fix", "s")), "Click a point to fix it where it is");
  assert.equal(constraintHint({ ...startConstraintTool("coincident", "s"), first: "p" }), "Click the point to move onto it");
  assert.equal(constraintStep("coincident"), "Coincident");
});

test("with Select, a constraint's mark is picked and Delete takes the constraint off", () => {
  const s: Sketch = { ...oneLine(), constraints: [{ id: "constraint-9", kind: "horizontal", a: "point-3", b: "point-4" }] };
  // Its bar at size 2 runs (4, 2)–(6, 2): from (5, 2.4) it is 0.4 away, in a reach of 0.5; from (5, 2.6), 0.6, not.
  assert.equal(markAt(s, [5, 2.4], 0.5, 2), "constraint-9");
  assert.equal(markAt(s, [5, 2.6], 0.5, 2), null);
  const doc = { ...partDocument("box", 40, 30, 20), sketches: [s] };
  assert.deepEqual(stillPicked(s, ["constraint-9", "line-5", "gone"]), ["constraint-9", "line-5"]);
  assert.equal(pickedWords(s, ["constraint-9"]), "1 constraint");
  assert.equal(deleteStep(s, ["constraint-9"]), "Delete constraint");
  assert.equal(deleteStep(s, ["constraint-9", "line-5"]), "Delete 2 items");
  const after = deleteCurves(doc, s.id, ["constraint-9"]).sketches[0];
  assert.deepEqual(after.constraints, []);
  assert.deepEqual(after.points, s.points, "taking a constraint off moves nothing");
  // Both at once: the constraint, and the line with its points.
  const both = deleteCurves(doc, s.id, ["line-5", "constraint-9"]).sketches[0];
  assert.deepEqual([both.curves, both.constraints], [[], []]);
});
