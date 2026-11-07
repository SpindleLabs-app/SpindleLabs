// Sketch dimensions (step 47e): the Dimension tool's picks (constraint-tool.ts
// `clickDimension`), each dimension's drawing and label worked by hand,
// the value's limits at 0.9× and 1.1×, adding and changing dimensions on
// the real kernel's solver (constraints.ts) with the working shown,
// refusals (a size that fights, one already set, one that shrinks a
// line), a diameter's circle, the file's checks, and seeded sessions
// through the promises (every dimension holds, a refusal changes
// nothing). In the browser: apps/fission/e2e/sketch-dimensions.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seeded } from "../../../packages/testing/src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changeDimensionTool, clickConstraint, constraintHint, constraintPickAt, dimensionLabels, dimensionLine, dimensionWord, startConstraintTool } from "../src/constraint-tool.ts";
import { addConstraint, changeDimension, dimensionProblem, keptConstraints, solverRequest, type Added, type Changed } from "../src/constraints.ts";
import { DIMENSION_LIMITS, partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, deleteCurve, drawArc, drawCircle, drawLine } from "../src/sketch.ts";
import { typedFields } from "../src/typed-entry.ts";

const kernel = nodeKernel();
const LINEAR = 1e-5;
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (s: Sketch, p: string): [number, number] => {
  const q = s.points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
const apart = (s: Sketch, a: string, b: string) => Math.hypot(xy(s, a)[0] - xy(s, b)[0], xy(s, a)[1] - xy(s, b)[1]);
const ok = <T extends Added | Changed>(a: T): Exclude<T, { refused: string }> => {
  assert.ok("doc" in a, "refused" in a ? a.refused : "");
  return a as Exclude<T, { refused: string }>;
};
const no = (a: Added | Changed): { refused: string; fighting: string[] } => {
  assert.ok("refused" in a, "it was taken");
  return a;
};
const near = (got: readonly number[], want: readonly number[], tol = LINEAR) =>
  assert.ok(got.every((v, k) => Math.abs(v - want[k]) <= tol), `${got.join(", ")} is not ${want.join(", ")}`);

/** A box, then Sketch 1 (sketch-2) with line-5 from `from` to `to`: points 3 and 4. */
function oneLine(from: [number, number] = [0, 0], to: [number, number] = [4, 2]) {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s.doc, s.id, from, to);
  return { doc: l.doc, id: s.id, line: l.id };
}

test("the Dimension tool's picks: a line's length, an arc's radius, a circle's diameter, two points apart", () => {
  const { doc, id } = oneLine();
  const c = drawCircle(doc, id, [20, 0], 5);
  // Arc from (10, 10) to (6, 14) round (10, 14): radius 4, the centre a point of its own.
  const a = drawArc(c.doc, id, [10, 10], [6, 14], [10, 14]);
  const s = sketchOf(a.doc, id);
  const arc = s.curves.find((q) => q.id === a.id)!;
  assert.equal(arc.kind, "arc");
  if (arc.kind !== "arc") return;
  const tool = startConstraintTool("dimension", id);
  assert.equal(constraintHint(tool), "Click a line, arc or circle to size it, or a point to measure from");
  // The line (0, 0)–(4, 2): its length √(16 + 4) = √20 = 4.4721…, start then end.
  const line = clickConstraint(tool, s, { curve: "line-5" });
  assert.equal(line.add, null, "nothing is added until the value is typed");
  assert.deepEqual(line.tool.pending, { kind: "distance", a: "point-3", b: "point-4", value: Math.sqrt(20) });
  assert.deepEqual(typedFields(line.tool), ["length"]);
  assert.equal(constraintHint(line.tool), "Type the size and press Enter, or Escape to leave it");
  assert.equal(dimensionWord(s, line.tool.pending!), "Length");
  // The arc: centre to start, 4.
  const r = clickConstraint(tool, s, { curve: a.id });
  assert.deepEqual(r.tool.pending, { kind: "distance", a: arc.centre, b: arc.start, value: 4 });
  assert.deepEqual(typedFields(r.tool), ["radius"]);
  assert.equal(dimensionWord(s, r.tool.pending!), "Radius");
  // The circle: twice its radius 5.
  const d = clickConstraint(tool, s, { curve: c.id });
  assert.deepEqual(d.tool.pending, { kind: "diameter", circle: c.id, value: 10 });
  assert.deepEqual(typedFields(d.tool), ["diameter"]);
  // Two points: the first remembered, the second makes it; (0, 0) to the circle's centre (20, 0) is 20 apart.
  const centre = s.curves.find((q) => q.id === c.id)!;
  if (centre.kind !== "circle") return assert.fail();
  const p1 = clickConstraint(tool, s, { point: "point-3" });
  assert.equal(p1.tool.first, "point-3");
  assert.equal(p1.tool.pending, null);
  assert.equal(constraintHint(p1.tool), "Click the point to measure to (not a line: a point to a line comes later)");
  const p2 = clickConstraint(p1.tool, s, { point: centre.centre });
  assert.deepEqual(p2.tool.pending, { kind: "distance", a: "point-3", b: centre.centre, value: 20 });
  assert.equal(p2.tool.first, null);
  assert.equal(dimensionWord(s, p2.tool.pending!), "Distance");
  // The same point twice keeps the first; no tool but Dimension takes a curve.
  assert.equal(clickConstraint(p1.tool, s, { point: "point-3" }).tool.first, "point-3");
  assert.equal(clickConstraint(startConstraintTool("fix", id), s, { curve: "line-5" }).add, null);
  // The pointer picks a point before the line it ends, then the line within reach (reach 1 at 0.9× and 1.1×).
  assert.deepEqual(constraintPickAt(s, "dimension", [0.3, 0.2], 1), { point: "point-3" });
  // (2, 1 + 0.9·√5/2·…): simpler, the line's midpoint (2, 1) moved 0.9 and 1.1 along its normal (−1, 2)/√5.
  const n = [-1 / Math.sqrt(5), 2 / Math.sqrt(5)];
  assert.deepEqual(constraintPickAt(s, "dimension", [2 + 0.9 * n[0], 1 + 0.9 * n[1]], 1), { curve: "line-5" });
  assert.equal(constraintPickAt(s, "dimension", [2 + 1.1 * n[0], 1 + 1.1 * n[1]], 1), null);
});

test("a dimension's drawing and label, worked by hand", () => {
  const { doc, id } = oneLine([0, 0], [10, 0]);
  const c = drawCircle(doc, id, [30, 0], 5);
  const s = { ...sketchOf(c.doc, id), constraints: [{ id: "constraint-1", kind: "distance", a: "point-3", b: "point-4", value: 10 } as const, { id: "constraint-2", kind: "diameter", circle: c.id, value: 10 } as const] };
  // Mark size 1: the line (0, 0)→(10, 0) goes along x, so its left (the normal) is (0, 1); the dimension line is
  // 2.5 sizes over it, (0, 2.5)–(10, 2.5), a tick of one size across each end, the label one size further out at
  // the middle, (5, 3.5).
  const d = dimensionLine(s, s.constraints[0], 1)!;
  assert.deepEqual(d.segments, [[[0, 2.5], [10, 2.5]], [[0, 2], [0, 3]], [[10, 2], [10, 3]]]);
  assert.deepEqual(d.label, [5, 3.5]);
  // The diameter across the circle round (30, 0) at 45°: 5·√½ = 3.5355 each way, the label half a size past its end.
  const m = dimensionLine(s, s.constraints[1], 1)!;
  near(m.segments[0][0], [30 - 5 * Math.SQRT1_2, -5 * Math.SQRT1_2]);
  near(m.segments[0][1], [30 + 5 * Math.SQRT1_2, 5 * Math.SQRT1_2]);
  near(m.label, [30 + 5 * Math.SQRT1_2 + 0.5, 5 * Math.SQRT1_2 + 0.5]);
  assert.deepEqual(dimensionLabels(s, 1).map((l) => l.text), ["10", "⌀ 10"]);
  // A value shows to three places, as the typed boxes do: 12.34567 shows 12.346.
  const odd = { ...s, constraints: [{ ...s.constraints[0], value: 12.34567 }] };
  assert.deepEqual(dimensionLabels(odd, 1).map((l) => l.text), ["12.346"]);
  // A dimension whose points are gone draws nothing.
  assert.equal(dimensionLine({ ...s, points: [] }, s.constraints[0], 1), null);
});

test("an arc's radius is drawn from its centre to its start and labelled R", () => {
  const { doc, id } = oneLine();
  const a = drawArc(doc, id, [10, 10], [6, 14], [10, 14]);
  const s0 = sketchOf(a.doc, id);
  const arc = s0.curves.find((q) => q.id === a.id)!;
  if (arc.kind !== "arc") return assert.fail();
  const s = { ...s0, constraints: [{ id: "constraint-1", kind: "distance", a: arc.centre, b: arc.start, value: 4 } as const] };
  // Centre (10, 14) to start (10, 10): the segment itself, its label halfway, (10, 12).
  assert.deepEqual(dimensionLine(s, s.constraints[0], 1), { segments: [[[10, 14], [10, 10]]], label: [10, 12] });
  assert.deepEqual(dimensionLabels(s, 1).map((l) => l.text), ["R 4"]);
});

test("a dimension's value from the smallest feature to the range's width, at 0.9× and 1.1×", () => {
  assert.deepEqual(DIMENSION_LIMITS, { min: 1e-3, max: 2e8 });
  assert.equal(dimensionProblem(1e-3), null);
  assert.equal(dimensionProblem(1.1e-3), null);
  assert.match(dimensionProblem(0.9e-3)!, /from 0.001 mm to 200000000 mm/);
  assert.equal(dimensionProblem(0.9 * 2e8), null);
  assert.match(dimensionProblem(1.1 * 2e8)!, /from 0.001 mm/);
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.ok(dimensionProblem(bad), `${bad} is refused`);
});

test("a line's length set: its start stays, its end moves along it", async () => {
  const { doc, id } = oneLine();
  // Line (0, 0)–(4, 2), its start held. A length is one equation in the end's two coordinates; the step that moves the
  // end least goes along the line, so the end lands 10 from (0, 0) on the ray through (4, 2): 10·(4, 2)/√20 =
  // (20/√5, 10/√5) = (8.9443, 4.4721).
  const got = ok(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 10 }));
  const s = sketchOf(got.doc, id);
  assert.deepEqual(xy(s, "point-3"), [0, 0]);
  near(xy(s, "point-4"), [20 / Math.sqrt(5), 10 / Math.sqrt(5)]);
  assert.deepEqual(s.constraints.at(-1), { id: got.id, kind: "distance", a: "point-3", b: "point-4", value: 10 });
});

test("a level line given a length: its end slides along the level", async () => {
  const { doc, id } = oneLine();
  // Horizontal first: the end comes level with the start, (4, 0). Then length 25: the end goes on along x to (25, 0).
  const h = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  const d = ok(await addConstraint(kernel, h.doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 25 }));
  near(xy(sketchOf(d.doc, id), "point-4"), [25, 0]);
  // Changed to 7.5: the start still held, the end back to (7.5, 0); one more change to the same value changes nothing.
  const c = ok(await changeDimension(kernel, d.doc, id, d.id, 7.5));
  near(xy(sketchOf(c.doc, id), "point-4"), [7.5, 0]);
  assert.equal(sketchOf(c.doc, id).constraints.find((q) => q.id === d.id)?.kind === "distance" && (sketchOf(c.doc, id).constraints.find((q) => q.id === d.id) as { value: number }).value, 7.5);
  assert.equal(ok(await changeDimension(kernel, c.doc, id, d.id, 7.5)).doc, c.doc);
  // The same length again adds nothing; a different one between the same two points fights it.
  assert.match(no(await addConstraint(kernel, d.doc, id, { kind: "distance", a: "point-4", b: "point-3", value: 25 })).refused, /That dimension would add nothing: the others already set that size/);
  const fight = no(await addConstraint(kernel, d.doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 30 }));
  assert.match(fight.refused, /That dimension fights the ones shown in red, so it can't be added/);
  assert.ok(fight.fighting.includes(d.id));
});

test("a rectangle 30 × 12 from two lengths on its level and upright sides", async () => {
  // An L of two lines from (0, 0): to (20, 1) and to (1, 9). Horizontal on the first, vertical on the second: (20, 0)
  // and (0, 9). Then lengths 30 and 12: (30, 0) and (0, 12), the corner still at the origin (held: each line's start).
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l1 = drawLine(s0.doc, s0.id, [0, 0], [20, 1]);
  const l2 = drawLine(l1.doc, s0.id, "point-3", [1, 9]);
  const id = s0.id;
  let doc = l2.doc;
  const far = sketchOf(doc, id).curves.find((c) => c.id === l2.id)!;
  if (far.kind !== "line") return assert.fail();
  doc = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" })).doc;
  doc = ok(await addConstraint(kernel, doc, id, { kind: "vertical", a: "point-3", b: far.end })).doc;
  doc = ok(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 30 })).doc;
  doc = ok(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: far.end, value: 12 })).doc;
  const s = sketchOf(doc, id);
  near(xy(s, "point-3"), [0, 0]);
  near(xy(s, "point-4"), [30, 0]);
  near(xy(s, far.end), [0, 12]);
});

test("a length the solver lands is within LINEAR (1e-5 mm), and solving the answer again moves nothing", async () => {
  const { doc, id } = oneLine();
  const got = ok(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 10 }));
  const s = sketchOf(got.doc, id);
  const err = Math.abs(apart(s, "point-3", "point-4") - 10);
  assert.ok(err <= LINEAR, `off by ${err}`);
  // The answer is a fixed point of the solver: asked again, the same points come back.
  const again = JSON.parse(await kernel.call("solve_sketch", solverRequest(s).text));
  assert.equal(again.result, "solved");
  assert.deepEqual(again.points, s.points.map((p) => [p.x, p.y]));
});

test("a dimension that would shrink a line, or a value out of range, is refused and changes nothing", async () => {
  const { doc, id } = oneLine();
  assert.match(no(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 0.0009 })).refused, /from 0.001 mm/);
  const tiny = ok(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 0.0011 }));
  assert.ok(Math.abs(apart(sketchOf(tiny.doc, id), "point-3", "point-4") - 0.0011) <= LINEAR);
  const d = ok(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 10 }));
  assert.match(no(await changeDimension(kernel, d.doc, id, d.id, 3e8)).refused, /from 0.001 mm/);
  await assert.rejects(changeDimension(kernel, d.doc, id, "nope", 4), /has no dimension nope/);
  assert.match(no(await addConstraint(kernel, doc, id, { kind: "distance", a: "point-3", b: "point-3", value: 4 })).refused, /two different points/);
});

test("a circle's diameter sets its radius, takes its freedom from the count, and goes with the circle", async () => {
  const { doc, id } = oneLine();
  const c = drawCircle(doc, id, [20, 0], 5);
  const before = solverRequest(sketchOf(c.doc, id));
  assert.equal(JSON.parse(before.text).circles, 1);
  // Diameter 16: radius 8; nothing else moves.
  const d = ok(await addConstraint(kernel, c.doc, id, { kind: "diameter", circle: c.id, value: 16 }));
  const s = sketchOf(d.doc, id);
  const circle = s.curves.find((q) => q.id === c.id)!;
  assert.equal(circle.kind === "circle" && circle.radius, 8);
  assert.deepEqual(s.points, sketchOf(c.doc, id).points);
  assert.equal(JSON.parse(solverRequest(s).text).circles, 0, "a sized circle has no free radius");
  // A second diameter on it is refused; changing it sets the radius again.
  assert.match(no(await addConstraint(kernel, d.doc, id, { kind: "diameter", circle: c.id, value: 4 })).refused, /already has a diameter/);
  const ch = ok(await changeDimension(kernel, d.doc, id, d.id, 3));
  const after = sketchOf(ch.doc, id).curves.find((q) => q.id === c.id)!;
  assert.equal(after.kind === "circle" && after.radius, 1.5);
  // A diameter under twice the smallest radius would make a circle too small to build: 0.0018 (radius 0.0009) is refused.
  assert.match(no(await changeDimension(kernel, d.doc, id, d.id, 0.0009)).refused, /from 0.001 mm/);
  // Deleting the circle takes its diameter with it.
  const gone = deleteCurve(d.doc, id, c.id);
  assert.deepEqual(sketchOf(gone, id).constraints, []);
  assert.deepEqual(keptConstraints(s), s.constraints);
});

test("dimensions are saved and read back; a file's bad dimensions are refused with the reason", async () => {
  const { doc, id } = oneLine();
  const c = drawCircle(doc, id, [20, 0], 5);
  const l = ok(await addConstraint(kernel, c.doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 10 }));
  const d = ok(await addConstraint(kernel, l.doc, id, { kind: "diameter", circle: c.id, value: 16 }));
  const read = readDesignDocument(JSON.parse(JSON.stringify(d.doc)));
  assert.deepEqual(sketchOf(read, id).constraints, sketchOf(d.doc, id).constraints);
  const withList = (list: unknown[], radius?: number) => {
    const raw = JSON.parse(JSON.stringify(d.doc));
    const s = raw.sketches.find((q: Sketch) => q.id === id);
    s.constraints = list;
    if (radius !== undefined) s.curves.find((q: { id: string }) => q.id === c.id).radius = radius;
    raw.nextId = 10_000;
    return () => readDesignDocument(raw);
  };
  const dist = (value: unknown) => ({ id: "constraint-100", kind: "distance", a: "point-3", b: "point-4", value });
  assert.doesNotThrow(withList([dist(1e-3)]));
  assert.throws(withList([dist(0.9e-3)]), /dimension constraint-100 needs a value from 0.001 to 200000000 mm, not 0.0009/);
  assert.throws(withList([dist(1.1 * 2e8)]), /needs a value from 0.001/);
  assert.throws(withList([dist("10")]), /needs a value from 0.001/);
  assert.throws(withList([dist(null)]), /needs a value from 0.001/);
  assert.throws(withList([{ id: "constraint-100", kind: "distance", a: "point-3", b: "point-3", value: 4 }]), /joins point point-3 to itself/);
  assert.throws(withList([{ id: "constraint-100", kind: "distance", a: "point-3", b: "point-99", value: 4 }]), /names point-99, which is not one of/);
  const dia = (circle: string, value: number, k = 100) => ({ id: `constraint-${k}`, kind: "diameter", circle, value });
  assert.doesNotThrow(withList([dia(c.id, 16)]));
  assert.throws(withList([dia(c.id, 12)]), new RegExp(`circle ${c.id} has radius 8, but dimension constraint-100 says its diameter is 12`));
  assert.throws(withList([dia("line-5", 16)]), /sizes "?line-5"?, which is not one of the sketch's circles/);
  assert.throws(withList([dia(c.id, 16), dia(c.id, 16, 101)]), new RegExp(`circle ${c.id} has two diameter dimensions`));
  assert.throws(withList([dia(c.id, 0.9e-3)], 0.45e-3), /needs a value from 0.001/);
});

test("changing a dimension from its label: the tool waits with the value", () => {
  const { doc, id } = oneLine([0, 0], [10, 0]);
  const s = { ...sketchOf(doc, id), constraints: [{ id: "constraint-1", kind: "distance", a: "point-3", b: "point-4", value: 10 } as const] };
  const t = changeDimensionTool(s, "constraint-1")!;
  assert.equal(t.kind, "dimension");
  assert.equal(t.changing, "constraint-1");
  assert.deepEqual(t.pending, { kind: "distance", a: "point-3", b: "point-4", value: 10 });
  assert.deepEqual(typedFields(t), ["length"]);
  assert.equal(changeDimensionTool(s, "nope"), null);
  assert.equal(changeDimensionTool({ ...s, constraints: [{ id: "constraint-2", kind: "fix", point: "point-3" }] }, "constraint-2"), null);
});

test("seeded sessions: random lengths on random lines, every dimension holds and a refusal changes nothing", async () => {
  let held = 0;
  let refused = 0;
  const base = BigInt(process.env.FISSION_SEED ?? 47_005);
  for (let k = 0n; k < 40n; k++) {
    const seed = base + k;
    const source = seeded(seed);
    const rand = () => source.next();
    const s0 = addSketch(partDocument("box", 40, 30, 20));
    const id = s0.id;
    let doc = s0.doc;
    // A chain of three to five lines from the origin, each end within 50 mm.
    const n = 3 + Math.floor(rand() * 3);
    let from: string | [number, number] = [0, 0];
    for (let k = 0; k < n; k++) {
      const l = drawLine(doc, id, from, [Math.round((rand() * 100 - 50) * 100) / 100, Math.round((rand() * 100 - 50) * 100) / 100]);
      doc = l.doc;
      const line = sketchOf(doc, id).curves.find((c) => c.id === l.id)!;
      if (line.kind !== "line") return assert.fail();
      from = line.end;
    }
    for (let k = 0; k < 6; k++) {
      const s = sketchOf(doc, id);
      const lines = s.curves.filter((c) => c.kind === "line");
      const line = lines[Math.floor(rand() * lines.length)];
      if (line.kind !== "line") continue;
      const value = Math.round((1 + rand() * 60) * 1000) / 1000;
      const got = await addConstraint(kernel, doc, id, { kind: "distance", a: line.start, b: line.end, value });
      if ("refused" in got) {
        refused++;
        continue;
      }
      doc = got.doc;
      held++;
      // Every dimension of the sketch still holds within LINEAR.
      const now = sketchOf(doc, id);
      for (const c of now.constraints) if (c.kind === "distance") assert.ok(Math.abs(apart(now, c.a, c.b) - c.value) <= LINEAR, `seed ${seed}: ${c.id} is ${apart(now, c.a, c.b)}, not ${c.value}`);
    }
  }
  // Both outcomes are reached (a length on a line already sized refuses as redundant or fighting).
  assert.ok(held > 100, `${held} held`);
  assert.ok(refused > 10, `${refused} refused`);
});
