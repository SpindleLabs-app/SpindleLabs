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
import { clickConstraint, constraintMarks, constraintPickAt, dimensionWord, selectAt, startConstraintTool } from "../src/constraint-tool.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { dragStep, dragTo, HELD } from "../src/point-drag.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";
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

test("a Fix on a corner that the sizes and another Fix already hold adds nothing: refused, so it can't block a later change", async () => {
  // A 40 × 25 rectangle held whole: level bottom and top, upright sides, bottom 40, right side 25 and its first corner fixed.
  // Its far corner (40, 25) is then set by the fixed corner, the level and upright sides and the two sizes: a Fix there adds nothing.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s0.doc, s0.id, [0, 0], [40, 25]);
  const sides = r.ids.map((id) => sketchOf(r.doc, s0.id).curves.find((c) => c.id === id)!) as { start: string; end: string }[];
  let doc = r.doc;
  for (const c of [
    { kind: "horizontal", a: sides[0].start, b: sides[0].end }, { kind: "vertical", a: sides[1].start, b: sides[1].end },
    { kind: "horizontal", a: sides[2].start, b: sides[2].end }, { kind: "vertical", a: sides[3].start, b: sides[3].end },
    { kind: "distance", a: sides[0].start, b: sides[0].end, value: 40 }, { kind: "distance", a: sides[1].start, b: sides[1].end, value: 25 },
    { kind: "fix", point: sides[0].start },
  ] as const) doc = ok(await addConstraint(kernel, doc, s0.id, c)).doc;
  const far = no(await addConstraint(kernel, doc, s0.id, { kind: "fix", point: sides[2].start }));
  assert.match(far.refused, /That fix constraint would add nothing: the others already hold that point/);
  // A Fix on a corner that is still free to move is taken: with the 25 off, the top can slide up and down.
  const loose = sketchOf(doc, s0.id).constraints.filter((c) => !(c.kind === "distance" && c.value === 25));
  const looser = { ...doc, sketches: doc.sketches.map((s) => (s.id === s0.id ? { ...s, constraints: loose } : s)) };
  ok(await addConstraint(kernel, looser, s0.id, { kind: "fix", point: sides[2].start }));
});

test("a drag of a point its constraints hold still says so, and one that moves says nothing", async () => {
  // Line (0, 0)–(4, 2), its start fixed, level, 4 long: its end is held at (4, 0).
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [4, 2]);
  let doc = l.doc;
  for (const c of [{ kind: "fix", point: "point-3" }, { kind: "horizontal", a: "point-3", b: "point-4" }, { kind: "distance", a: "point-3", b: "point-4", value: 4 }] as const) doc = ok(await addConstraint(kernel, doc, s0.id, c)).doc;
  const held = await dragTo(kernel, doc, s0.id, "point-4", [6, 3], 0.1);
  assert.equal(held.refused, HELD);
  assert.deepEqual(xy(sketchOf(held.doc, s0.id), "point-4"), [4, 0]);
  // Without the length the end slides along the level: to (6, 0), and nothing is said.
  const free = await dragTo(kernel, { ...doc, sketches: doc.sketches.map((s) => (s.id === s0.id ? { ...s, constraints: s.constraints.filter((c) => c.kind !== "distance") } : s)) }, s0.id, "point-4", [6, 3], 0.1);
  assert.equal(free.refused, null);
  const e = xy(sketchOf(free.doc, s0.id), "point-4");
  assert.ok(Math.abs(e[0] - 6) <= LINEAR && Math.abs(e[1]) <= LINEAR, `the end at ${e}`);
});

test("a point picked first, then a line, keeps the point and waits for a second point: the line's length is not set instead", () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [4, 2]);
  const c = drawCircle(l.doc, s0.id, [10, 10], 2);
  const s = sketchOf(c.doc, s0.id);
  const centre = (s.curves.find((q) => q.id === c.id) as { centre: string }).centre;
  for (const kind of ["dimension", "horizontal", "vertical"] as const) {
    const one = clickConstraint(startConstraintTool(kind, s0.id), s, { point: centre });
    const two = clickConstraint(one.tool, s, kind === "dimension" ? { curve: l.id } : { line: l.id });
    assert.equal(two.add, null, kind);
    assert.equal(two.tool.first, centre, `${kind}: the point is kept`);
    assert.ok(!two.tool.pending, `${kind}: no length waits`);
  }
});

test("a tap on the middle of a side shorter than the finger's reach picks the side, a tap by its corner the corner", () => {
  // A 6 × 4 rectangle with a reach of 5 (a finger at 375 px): the bottom side's middle (3, 0) is 3 from either corner.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s0.doc, s0.id, [0, 0], [6, 4]);
  const s = sketchOf(r.doc, s0.id);
  const bottom = s.curves.find((c) => c.id === r.ids[0]) as { id: string; start: string };
  assert.deepEqual(constraintPickAt(s, "horizontal", [3, 0.2], 5), { line: bottom.id });
  assert.deepEqual(constraintPickAt(s, "dimension", [3, 0.2], 5), { curve: bottom.id });
  // At (0.5, 0.1), an eighth of the way along: the corner (0, 0).
  assert.deepEqual(constraintPickAt(s, "horizontal", [0.5, 0.1], 5), { point: bottom.start });
  // Coincident and Fix take points only: the corner still.
  assert.ok("point" in constraintPickAt(s, "coincident", [3, 0.2], 5)!);
});

test("a rectangle drawn with the tool comes level and upright: a size on one side keeps it a rectangle", async () => {
  // The beginner check (2026-11-06): a 30 × 20 rectangle had no constraints, so its bottom made 40 moved one corner and made a
  // trapezoid. Drawn with the tool it now has Horizontal on its bottom and top and Vertical on its sides, as in Fusion.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const one = clickAt(s0.doc, startTool("rectangle", s0.id), [0, 0]);
  const two = clickAt(one.doc, one.tool, [30, 20]);
  assert.ok(two.drew);
  const s = sketchOf(two.doc, s0.id);
  const sides = s.curves as { id: string; start: string; end: string }[];
  assert.deepEqual(s.constraints.map((c) => c.kind), ["horizontal", "vertical", "horizontal", "vertical"]);
  assert.deepEqual(s.constraints.map((c) => (c.kind === "horizontal" || c.kind === "vertical" ? [c.a, c.b] : [])), sides.map((l) => [l.start, l.end]));
  // The bottom made 40, its start (0, 0) held: its end to (40, 0); the right side stays upright, so its top corner goes to (40, 20);
  // the top stays level with it, so the rectangle is 40 × 20 with the left side where it was.
  const d = ok(await addConstraint(kernel, two.doc, s0.id, { kind: "distance", a: sides[0].start, b: sides[0].end, value: 40 }));
  const after = sketchOf(d.doc, s0.id);
  assert.deepEqual(sides.map((l) => xy(after, l.start)), [[0, 0], [40, 0], [40, 20], [0, 20]]);
  // The ids come from the one counter, each once.
  assert.equal(new Set(s.constraints.map((c) => c.id)).size, 4);
  assert.equal(two.doc.nextId, one.doc.nextId + 4 + 4 + 4);
});

test("a rectangle drawn onto a corner that follows a body keeps every side squared (#517); one over an existing rectangle adds nothing twice", () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const one = clickAt(s0.doc, startTool("rectangle", s0.id), [0, 0]);
  const two = clickAt(one.doc, one.tool, [30, 20]);
  // The same rectangle again: every side a line already there, nothing drawn and no constraint twice.
  const again = clickAt(clickAt(two.doc, startTool("rectangle", s0.id), [0, 0]).doc, clickAt(two.doc, startTool("rectangle", s0.id), [0, 0]).tool, [30, 20]);
  assert.equal(sketchOf(again.doc, s0.id).constraints.length, 4);
  // A pinned corner: the two sides through it still get theirs, each with a free end (#517: before, they got none).
  const pinned = { ...two.doc, sketches: two.doc.sketches.map((s) => (s.id === s0.id ? { ...s, constraints: [], pins: [{ point: (s.curves[0] as { start: string }).start, kind: "endpoint" as const, name: "x", feature: "feature-1" }] } : s)) };
  const over = clickAt(clickAt(pinned, startTool("rectangle", s0.id), [0, 0]).doc, clickAt(pinned, startTool("rectangle", s0.id), [0, 0]).tool, [10, 5]);
  const s = sketchOf(over.doc, s0.id);
  const corner = (s.curves[0] as { start: string }).start;
  assert.ok(s.constraints.length === 4 && s.constraints.filter((c) => c.kind !== "fix" && c.kind !== "diameter" && (c.a === corner || c.b === corner)).length === 2, JSON.stringify(s.constraints));
});

test("a rectangle drawn from a point that gets pinned to a body keeps its constraints, and the design still opens", async () => {
  // Found by the browser check: a rectangle from the origin had its corner pinned there after its Horizontal and Vertical
  // were made, and the design then refused to open ("names point-3, which follows a body's edge"), so Undo and Redo failed.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const one = clickAt(s0.doc, startTool("rectangle", s0.id), [0, 0]);
  const two = clickAt(one.doc, one.tool, [30, 20]);
  const pinned = pinNewPoints(s0.doc, two.doc, s0.id, [{ at: [0, 0], kind: "endpoint", name: "origin", feature: "feature-1" }]);
  const s = sketchOf(pinned, s0.id);
  const corner = s.pins![0].point;
  // Every side has a free end, so all four keep theirs (#517: the bottom and the left side, through the corner, lost theirs
  // and a typed size then bent the rectangle); the solver fixes the corner where the body puts it.
  assert.deepEqual(s.constraints.map((c) => c.kind), ["horizontal", "vertical", "horizontal", "vertical"]);
  assert.equal(s.constraints.filter((c) => c.kind !== "fix" && c.kind !== "diameter" && (c.a === corner || c.b === corner)).length, 2);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(pinned))), pinned, "it saves and opens as it is");
});

test("Select picks a diagonal right under the pointer over a rectangle's own mark beside it; the mark when it is nearer", () => {
  // A 20 × 10 rectangle with its Horizontal and Vertical, and its diagonal (0, 0)–(20, 10). Marks 4 mm across (a phone's zoom):
  // the bottom's Horizontal bar is drawn above its middle (10, 0). At (10, 5) the diagonal is 0 away: it wins.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const one = clickAt(s0.doc, startTool("rectangle", s0.id), [0, 0]);
  const two = clickAt(one.doc, one.tool, [20, 10]);
  const d = drawLine(two.doc, s0.id, (sketchOf(two.doc, s0.id).curves[0] as { start: string }).start, [20, 10]);
  const s = sketchOf(d.doc, s0.id);
  assert.equal(selectAt(s, [10, 5], 6, 4), d.id);
  // Right on a mark's bar, away from every curve, the mark.
  const [bar] = constraintMarks(s, 4).get(s.constraints[0].id)!;
  const onBar: [number, number] = [(bar[0][0] + bar[1][0]) / 2, (bar[0][1] + bar[1][1]) / 2];
  assert.equal(selectAt(s, onBar, 6, 4), s.constraints[0].id, `the bar's middle ${onBar}`);
});
