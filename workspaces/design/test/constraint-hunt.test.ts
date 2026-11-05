// The sketch solver bug hunt (2026-11-06): each bug the hunt found, as a
// test that failed before its fix, on the real kernel's solver. A deleted
// line takes the constraints and dimensions that were about it; refusals
// name a curve in words and draw it red, never by its id; an arc's radius
// picked as two points is a radius in either order; a diameter out of range
// is refused like a length; a sketch with more points than the solver
// takes can still be constrained and dragged where only a few points are
// tied together; an arc through a followed point stays on its circle after
// a body's edit even when the sketch has no constraints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint, solverRequest, type Added } from "../src/constraints.ts";
import { clickConstraint, dimensionWord, startConstraintTool } from "../src/constraint-tool.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { dragStep } from "../src/point-drag.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, addSketch, deleteCurve, drawArc, drawCircle, drawLine, drawRectangle, pinNewPoints } from "../src/sketch.ts";

const kernel = nodeKernel();
const LINEAR = 1e-5;
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (s: Sketch, p: string): [number, number] => {
  const q = s.points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
const ok = (a: Added): { doc: DesignDocument; id: string } => {
  assert.ok("doc" in a, "refused" in a ? a.refused : "");
  return a;
};
const no = (a: Added): { refused: string; fighting: string[] } => {
  assert.ok("refused" in a, "it was added");
  return a;
};

/** A box, then Sketch 1 (sketch-2) with a 10 × 5 rectangle from (0, 0): its bottom side the first line. */
function rectangle() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [10, 5]);
  const bottom = sketchOf(r.doc, s.id).curves.find((c) => c.id === r.ids[0])!;
  assert.equal(bottom.kind, "line");
  if (bottom.kind !== "line") throw new Error("not a line");
  assert.deepEqual([xy(sketchOf(r.doc, s.id), bottom.start), xy(sketchOf(r.doc, s.id), bottom.end)], [[0, 0], [10, 0]], "the first side is the bottom");
  return { doc: r.doc, id: s.id, bottom };
}

test("a deleted line takes its own constraints and dimension, though its ends stay with the sides next to it", async () => {
  const { doc, id, bottom } = rectangle();
  const h = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: bottom.start, b: bottom.end }));
  const d = ok(await addConstraint(kernel, h.doc, id, { kind: "distance", a: bottom.start, b: bottom.end, value: 12 }));
  // A fix on a corner is about the point, not the line: it stays.
  const f = ok(await addConstraint(kernel, d.doc, id, { kind: "fix", point: bottom.start }));
  const gone = deleteCurve(f.doc, id, bottom.id);
  const s = sketchOf(gone, id);
  // Both corners are still the left and right sides' ends, so they stay, but the horizontal and the 12 were the bottom's.
  assert.ok(s.points.some((p) => p.id === bottom.start) && s.points.some((p) => p.id === bottom.end));
  assert.deepEqual(s.constraints.map((c) => c.id), [f.id]);
});

test("a deleted arc takes its radius, though its centre and start stay with other curves", async () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  // Arc round (0, 0) from (4, 0) to (0, 4): radius 4. A line from the centre to the start shares both points.
  const arc = drawArc(s0.doc, s0.id, [4, 0], [0, 4], [0, 0]);
  const a = sketchOf(arc.doc, s0.id).curves.find((c) => c.id === arc.id)!;
  if (a.kind !== "arc") return assert.fail();
  const spoke = drawLine(arc.doc, s0.id, a.centre, a.start);
  // The spoke's length is the same two points as the radius: one dimension is about both, so it stays while the spoke does.
  const r = ok(await addConstraint(kernel, spoke.doc, s0.id, { kind: "distance", a: a.centre, b: a.start, value: 5 }));
  assert.deepEqual(sketchOf(deleteCurve(r.doc, s0.id, arc.id), s0.id).constraints.map((c) => c.id), [r.id], "the spoke still has it");
  // With the spoke gone first, deleting the arc takes the radius too.
  const noSpoke = deleteCurve(r.doc, s0.id, spoke.id);
  assert.deepEqual(sketchOf(noSpoke, s0.id).constraints.map((c) => c.id), [r.id], "the arc still has it");
  const both = deleteCurve(noSpoke, s0.id, arc.id);
  assert.deepEqual(sketchOf(both, s0.id).constraints, []);
  // Its centre and start each kept by a line of their own (not one between them): the arc deleted still takes its radius.
  const held = drawLine(drawLine(noSpoke, s0.id, a.centre, [-5, 0]).doc, s0.id, a.start, [9, 0]).doc;
  const kept = sketchOf(deleteCurve(held, s0.id, arc.id), s0.id);
  assert.ok(kept.points.some((p) => p.id === a.centre) && kept.points.some((p) => p.id === a.start), "both points stay");
  assert.deepEqual(kept.constraints, []);
});

test("a constraint that would shrink a line names it in words and draws it red, never by its id", async () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [4, 2]);
  const h = ok(await addConstraint(kernel, l.doc, s0.id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  const v = no(await addConstraint(kernel, h.doc, s0.id, { kind: "vertical", a: "point-3", b: "point-4" }));
  assert.doesNotMatch(v.refused, /line-\d|point-\d|arc-\d/, v.refused);
  assert.match(v.refused, /would shrink the line shown in red to almost nothing/);
  assert.deepEqual(v.fighting, [l.id]);
});

test("a drag that would shrink a line says so in words, never by its id", async () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [4, 2]);
  const f = ok(await addConstraint(kernel, l.doc, s0.id, { kind: "fix", point: "point-3" }));
  // Its end dragged onto the fixed start: the line would be nothing.
  const got = await dragStep(kernel, f.doc, s0.id, "point-4", [0, 0]);
  assert.ok("refused" in got);
  assert.doesNotMatch(got.refused, /line-\d|point-\d|arc-\d/, got.refused);
  assert.match(got.refused, /would shrink a line below/);
});

test("an arc's radius picked as two points is a radius whichever is picked first, and from its end too", () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 10], [6, 14], [10, 14]);
  const s = sketchOf(arc.doc, s0.id);
  const a = s.curves.find((c) => c.id === arc.id)!;
  if (a.kind !== "arc") return assert.fail();
  for (const [first, second] of [[a.centre, a.start], [a.start, a.centre], [a.centre, a.end], [a.end, a.centre]]) {
    const one = clickConstraint(startConstraintTool("dimension", s0.id), s, { point: first });
    const two = clickConstraint(one.tool, s, { point: second });
    const p = two.tool.pending!;
    assert.equal(dimensionWord(s, p), "Radius", `${first} then ${second}`);
    assert.equal(two.tool.pendingField, "radius", `${first} then ${second}: the radius box`);
    // The radius is drawn and solved from the centre, as when the arc itself is picked: centre first.
    assert.ok(p.kind === "distance" && p.a === a.centre, `${first} then ${second}: centre first`);
    assert.ok(p.kind === "distance" && Math.abs(p.value - 4) < 1e-12, "radius 4: (10, 10) to (10, 14)");
  }
});

test("a diameter out of range is refused like any dimension, at 0.9× and 1.1× of the limits", async () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const c = drawCircle(s0.doc, s0.id, [0, 0], 5);
  for (const value of [0, -4, Number.NaN, Number.POSITIVE_INFINITY, 1e12, 0.9e-3]) {
    const got = no(await addConstraint(kernel, c.doc, s0.id, { kind: "diameter", circle: c.id, value }));
    assert.match(got.refused, /A dimension must be from/, `diameter ${value}`);
  }
  // 1.1× the smallest size is taken: radius 0.00055.
  const small = ok(await addConstraint(kernel, c.doc, s0.id, { kind: "diameter", circle: c.id, value: 1.1e-3 }));
  const circle = sketchOf(small.doc, s0.id).curves.find((q) => q.id === c.id)!;
  assert.ok(circle.kind === "circle" && Math.abs(circle.radius - 0.55e-3) < 1e-15);
});

test("a sketch with more points than the solver takes: a constraint and a drag still work where few points are tied", async () => {
  // 1,001 separate lines: 2,002 points, more than the solver's 2,000, though none is tied to another.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  let doc = s0.doc;
  for (let k = 0; k < 1001; k++) doc = drawLine(doc, s0.id, [k * 3, 0], [k * 3 + 1, 1 + (k % 7)]).doc;
  const s = sketchOf(doc, s0.id);
  assert.equal(s.points.length, 2002);
  const first = s.curves[0];
  if (first.kind !== "line") return assert.fail();
  const h = ok(await addConstraint(kernel, doc, s0.id, { kind: "horizontal", a: first.start, b: first.end }));
  // Line (0, 0)–(1, 1) made level: its start held, its end to (1, 0); every other point stays exactly.
  const after = sketchOf(h.doc, s0.id);
  assert.deepEqual(xy(after, first.end), [1, 0]);
  assert.equal(after.points.filter((p, k) => p !== s.points[k]).length, 1, "only the end moved");
  // The solver is told only the points a constraint or arc ties, and what is held.
  assert.equal(JSON.parse(solverRequest(after).text).points.length, 2);
  // A drag of a point no constraint ties goes where it is dragged.
  const last = s.curves[1000];
  if (last.kind !== "line") return assert.fail();
  const got = await dragStep(kernel, h.doc, s0.id, last.end, [5000, 9]);
  assert.ok("doc" in got, "refused" in got ? got.refused : "");
  assert.deepEqual(xy(sketchOf(got.doc, s0.id), last.end), [5000, 9]);
  // The level line's end dragged: it stays level with its start.
  const lv = await dragStep(kernel, h.doc, s0.id, first.end, [2, 3]);
  assert.ok("doc" in lv, "refused" in lv ? lv.refused : "");
  const e = xy(sketchOf(lv.doc, s0.id), first.end);
  assert.ok(Math.abs(e[1] - xy(sketchOf(lv.doc, s0.id), first.start)[1]) <= LINEAR, `the end at ${e}`);
});

test("an arc pinned at a corner stays on its circle after the box is widened, though the sketch has no constraints", async () => {
  // Quarter arc round (30, 30) from the top's back right corner (40, 30), pinned there, to (30, 40) (as follow-solve.test.ts).
  const { doc: onTop, id } = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const arc = drawArc(onTop, id, [40, 30], [30, 40], [30, 30]);
  const a = sketchOf(arc.doc, id).curves.find((c) => c.id === arc.id) as { start: string; end: string; centre: string };
  const doc = pinNewPoints(onTop, arc.doc, id, [{ at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" }]);
  assert.deepEqual(sketchOf(doc, id).constraints, []);
  const wider = editFeature(doc, "feature-1", { width: 60 });
  const build = await rebuildTimeline(wider, new BodyCache(kernel), kernel);
  const drawn = sketchOf(followedDoc(wider, build), id);
  const [s, c, e] = [xy(drawn, a.start), xy(drawn, a.centre), xy(drawn, a.end)];
  assert.deepEqual(s, [60, 30], "the start follows its corner");
  // Its ends on one circle: |start - centre| = |end - centre| within LINEAR.
  const r1 = Math.hypot(s[0] - c[0], s[1] - c[1]);
  const r2 = Math.hypot(e[0] - c[0], e[1] - c[1]);
  assert.ok(Math.abs(r1 - r2) <= LINEAR, `radii ${r1} and ${r2}`);
  const r = build.results[id];
  assert.ok(r.status === "built" && r.solved !== undefined && r.constraints === undefined, "solved, with no warning");
});
