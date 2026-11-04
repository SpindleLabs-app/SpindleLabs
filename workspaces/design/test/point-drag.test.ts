// Dragging sketch points with the solver (step 47d3, point-drag.ts) on the
// real kernel's solver: hand-worked drags with their working (a rectangle
// with one corner fixed dragged by the opposite corner lands exactly, a
// point vertical to a fixed one slides), the steps a big jump is split
// into with the DRAG_STEP_PIXELS boundary at 0.9× and 1.1×, the
// MIN_FEATURE boundary at 0.9× and 1.1×, every point that can't be
// dragged, an arc turned over refused (a kernel answer that turns one is
// refused, so the check can fail), the newest target winning, and seeded
// drags of random constrained sketches through the promises (every
// constraint holds after every step, fixed points stay, the dragged point
// lands on the pointer when nothing holds it back, and with no arcs no
// point moves further in a step than the dragged one).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls } from "@fission/core";
import { seeded } from "../../../packages/testing/src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint, MIN_FEATURE, type NewConstraint } from "../src/constraints.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawArc, drawLine, drawRectangle, PROJECTED_POINT } from "../src/sketch.ts";
import { ARC_TURNED, DRAG_STEP_PIXELS, dragStep, dragSteps, dragTo, FIXED_POINT, fixedPoints, grabProblem, MAX_DRAG_STEPS, PINNED_POINT, pointOf, turn, turnedOver } from "../src/point-drag.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (s: Sketch, p: string): [number, number] => {
  const q = s.points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
async function constrain(doc: DesignDocument, id: string, cs: NewConstraint[]): Promise<DesignDocument> {
  for (const c of cs) {
    const got = await addConstraint(kernel, doc, id, c);
    assert.ok("doc" in got, "refused" in got ? got.refused : "");
    doc = got.doc;
  }
  return doc;
}
const solvedDoc = (r: Awaited<ReturnType<typeof dragStep>>): DesignDocument => {
  assert.ok("doc" in r, "refused" in r ? r.refused : "");
  return r.doc;
};

/** A box, then Sketch 1 (sketch-2) with a rectangle (0, 0)–(4, 3): corners point-3 (0, 0), point-4 (4, 0), point-6 (4, 3), point-8 (0, 3); lines line-5 (3–4), line-7, line-9, line-10. */
function rectangle() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [4, 3]);
  return { doc: r.doc, id: s.id };
}

test("the fixture's rectangle is as the comment says", () => {
  const { doc, id } = rectangle();
  const s = sketchOf(doc, id);
  assert.deepEqual(s.points.map((p) => [p.id, p.x, p.y]), [["point-3", 0, 0], ["point-4", 4, 0], ["point-6", 4, 3], ["point-8", 0, 3]]);
});

test("a rectangle with one corner fixed, dragged by the opposite corner, lands exactly", async () => {
  // Horizontal on the bottom (3–4) and top (8–6), vertical on the sides
  // (4–6 and 3–8), point-3 fixed at (0, 0). Drag point-6 to (10, 7): it is
  // held, so it lands there; the bottom's y group is point-3's, 0, and the
  // right side's x group is point-6's, 10, so point-4 is (10, 0); the left
  // side's x is point-3's, 0, and the top's y point-6's, 7, so point-8 is
  // (0, 7). Substitution, so each is exact, not just within LINEAR.
  const r = rectangle();
  const doc = await constrain(r.doc, r.id, [
    { kind: "horizontal", a: "point-3", b: "point-4" },
    { kind: "horizontal", a: "point-8", b: "point-6" },
    { kind: "vertical", a: "point-4", b: "point-6" },
    { kind: "vertical", a: "point-3", b: "point-8" },
    { kind: "fix", point: "point-3" },
  ]);
  const got = await dragTo(kernel, doc, r.id, "point-6", [10, 7], 0.05);
  assert.equal(got.refused, null);
  const s = sketchOf(got.doc, r.id);
  assert.deepEqual(["point-3", "point-4", "point-6", "point-8"].map((p) => xy(s, p)), [[0, 0], [10, 0], [10, 7], [0, 7]]);
});

test("a point vertical to a fixed one slides up and down only", async () => {
  // Line (0, 0)–(0, 5), vertical, its start fixed. Dragging the end to
  // (3, 8): its x is in the fixed start's group, 0, so it can't follow
  // the pointer across; its y is free and held, 8. So (0, 8).
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [0, 5]);
  const doc = await constrain(l.doc, s0.id, [{ kind: "vertical", a: "point-3", b: "point-4" }, { kind: "fix", point: "point-3" }]);
  const got = await dragTo(kernel, doc, s0.id, "point-4", [3, 8], undefined);
  assert.equal(got.refused, null);
  assert.deepEqual(xy(sketchOf(got.doc, s0.id), "point-4"), [0, 8]);
  assert.deepEqual(xy(sketchOf(got.doc, s0.id), "point-3"), [0, 0]);
});

test("a big jump is split into equal steps of at most DRAG_STEP_PIXELS, the last exactly on the pointer", () => {
  // 100 mm at 1 mm a pixel, steps of at most 8 px = 8 mm: ⌈100 / 8⌉ = 13 steps of 100/13 mm.
  const steps = dragSteps([0, 0], [100, 0], 1);
  assert.equal(steps.length, 13);
  assert.deepEqual(steps.at(-1), [100, 0]);
  assert.ok(Math.abs(steps[0][0] - 100 / 13) < 1e-12);
  // 1000 mm would be 125 steps: at most MAX_DRAG_STEPS (32), each 1000/32 = 31.25 mm.
  const far = dragSteps([0, 0], [0, 1000], 1);
  assert.equal(far.length, MAX_DRAG_STEPS);
  assert.deepEqual(far[0], [0, 31.25]);
  // No size of a pixel known: one step. No move: none.
  assert.deepEqual(dragSteps([1, 2], [3, 4], undefined), [[3, 4]]);
  // Straight up from (0, 10) to (0, 18): 8 mm, one step at 1 mm a pixel.
  assert.deepEqual(dragSteps([0, 10], [0, 18], 1), [[0, 18]]);
  // A pixel of 0, below 0 or NaN can't size a step either: one step, never MAX_DRAG_STEPS.
  for (const pixel of [0, -1, NaN]) assert.deepEqual(dragSteps([1, 2], [3, 4], pixel), [[3, 4]], `pixel ${pixel}`);
  // Off the origin and slanted: (1, 2) to (31, 42) is √(30² + 40²) = 50 mm, ⌈50 / 8⌉ = 7 steps; the k-th at (1 + 30k/7, 2 + 40k/7).
  const slant = dragSteps([1, 2], [31, 42], 1);
  assert.equal(slant.length, 7);
  for (const [k, [x, y]] of slant.entries()) assert.ok(Math.abs(x - (1 + (30 * (k + 1)) / 7)) < 1e-12 && Math.abs(y - (2 + (40 * (k + 1)) / 7)) < 1e-12, `step ${k + 1} at ${x}, ${y}`);
  assert.deepEqual(dragSteps([1, 2], [1, 2], 1), []);
});

test("DRAG_STEP_PIXELS boundary: 0.9× of a step's reach is one step, 1.1× is two", () => {
  // At 0.5 mm a pixel a step reaches 8 × 0.5 = 4 mm: 3.6 mm in one, 4.4 mm in two of 2.2 mm.
  const reach = DRAG_STEP_PIXELS * 0.5;
  assert.equal(dragSteps([0, 0], [0.9 * reach, 0], 0.5).length, 1);
  const two = dragSteps([0, 0], [1.1 * reach, 0], 0.5);
  assert.equal(two.length, 2);
  assert.ok(Math.abs(two[0][0] - 0.55 * reach) < 1e-12);
});

test("MIN_FEATURE boundary: a drag leaving a line 0.9× MIN_FEATURE long is refused, 1.1× is made", async () => {
  // Line (0, 0)–(5, 0), horizontal, its start fixed. Dragging the end to
  // (x, 4) puts it at (x, 0) (its y is the fixed start's), so the line is
  // x long: 0.9 µm is under MIN_FEATURE (1 µm) and refused, nothing moving;
  // 1.1 µm is made.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [5, 0]);
  const doc = await constrain(l.doc, s0.id, [{ kind: "horizontal", a: "point-3", b: "point-4" }, { kind: "fix", point: "point-3" }]);
  const short = await dragStep(kernel, doc, s0.id, "point-4", [0.9 * MIN_FEATURE, 4]);
  assert.ok("refused" in short && /shrink line-5/.test(short.refused), JSON.stringify(short));
  const long = solvedDoc(await dragStep(kernel, doc, s0.id, "point-4", [1.1 * MIN_FEATURE, 4]));
  assert.deepEqual(xy(sketchOf(long, s0.id), "point-4"), [1.1 * MIN_FEATURE, 0]);
  // Through dragTo the refused step leaves the sketch where the last step put it.
  const stopped = await dragTo(kernel, doc, s0.id, "point-4", [0.9 * MIN_FEATURE, 4], undefined);
  assert.equal(stopped.doc, doc);
  assert.match(stopped.refused ?? "", /shrink/);
});

test("points that can't be dragged are refused with the reason", async () => {
  const r = rectangle();
  const s = sketchOf(r.doc, r.id);
  assert.equal(grabProblem(s, "point-6"), null);
  assert.match(grabProblem(s, "point-99") ?? "", /no point point-99/);
  // Pinned to a body's edge (26f).
  assert.equal(grabProblem({ ...s, pins: [{ point: "point-6", kind: "corner", name: "x" } as never] }, "point-6"), PINNED_POINT);
  // Made by a projection (27d): its line's two ends.
  const projected: Sketch = { ...s, projected: [{ id: "projection-9", made: "line-5", feature: "feature-1", edge: "e" } as never] };
  assert.equal(grabProblem(projected, "point-3"), PROJECTED_POINT);
  // Fixed, and coincident with a fixed one through a chain (6 = 8, 8 = 3, 3 fixed).
  const chained: Sketch = { ...s, constraints: [{ id: "c1", kind: "coincident", a: "point-6", b: "point-8" }, { id: "c2", kind: "coincident", a: "point-3", b: "point-8" }, { id: "c3", kind: "fix", point: "point-3" }] };
  assert.equal(grabProblem(chained, "point-3"), FIXED_POINT);
  assert.equal(grabProblem(chained, "point-6"), FIXED_POINT);
  assert.equal(grabProblem(chained, "point-4"), null);
  assert.deepEqual([...fixedPoints(chained)].sort(), ["point-3", "point-6", "point-8"]);
  // Coincident constraints that close a loop (3 = 4, 4 = 6, 6 = 3) end the search all the same; 4 and 6 are fixed through it.
  const loop: Sketch = { ...s, constraints: [{ id: "c1", kind: "coincident", a: "point-3", b: "point-4" }, { id: "c2", kind: "coincident", a: "point-4", b: "point-6" }, { id: "c3", kind: "coincident", a: "point-6", b: "point-3" }, { id: "c4", kind: "fix", point: "point-3" }] };
  assert.deepEqual([...fixedPoints(loop)].sort(), ["point-3", "point-4", "point-6"]);
  // The reasons say what is wrong in words.
  assert.match(FIXED_POINT, /fixed/);
  assert.match(PINNED_POINT, /pinned to a body's edge/);
  assert.match(ARC_TURNED, /arc would turn inside out/);
  // Horizontal to a fixed point is not fixed: it slides.
  assert.equal(grabProblem({ ...s, constraints: [{ id: "c1", kind: "horizontal", a: "point-3", b: "point-4" }, { id: "c3", kind: "fix", point: "point-3" }] }, "point-4"), null);
});

test("signed areas and arcs turned over, worked by hand", () => {
  // (0, 0), (1, 0), (0, 1) goes anticlockwise: twice its area is 1·1 − 0·0 = 1; the other way round −1.
  assert.equal(turn([0, 0], [1, 0], [0, 1]), 1);
  assert.equal(turn([0, 0], [0, 1], [1, 0]), -1);
  // Off the origin: (1, 2), (4, 3), (2, 6): (4 − 1)(6 − 2) − (3 − 2)(2 − 1) = 12 − 1 = 11.
  assert.equal(turn([1, 2], [4, 3], [2, 6]), 11);
  // A quarter arc round (0, 0) from (10, 0) to (0, 10): turn(c, s, e) = 10·10 = 100 > 0.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 0], [0, 10], [0, 0]); // start point-3, end point-4, centre point-5
  const s = sketchOf(arc.doc, s0.id);
  const at = (c: [number, number], st: [number, number], e: [number, number]) => new Map([["point-5", c], ["point-3", st], ["point-4", e]] as const);
  const before = at([0, 0], [10, 0], [0, 10]);
  // The centre mirrored across the chord to (10, 10): turn = (0)(0) − (−10)(−10) = −100, turned over.
  assert.equal(turnedOver(s, before, at([10, 10], [10, 0], [0, 10])), arc.id);
  // The centre onto the chord's middle (5, 5): flat (0), not turned over; nor is a centre moved along its side.
  assert.equal(turnedOver(s, before, at([5, 5], [10, 0], [0, 10])), null);
  assert.equal(turnedOver(s, before, at([-1, -1], [10, 0], [0, 10])), null);
  // The other way round: the ends swapped, turn = −100 < 0. Mirrored to (10, 10) is +100, turned over; flat, or still below 0, is not.
  const back = at([0, 0], [0, 10], [10, 0]);
  assert.equal(turnedOver(s, back, at([10, 10], [0, 10], [10, 0])), arc.id);
  assert.equal(turnedOver(s, back, at([5, 5], [0, 10], [10, 0])), null);
  assert.equal(turnedOver(s, back, at([-1, -1], [0, 10], [10, 0])), null);
  // From flat (the centre on the chord) to either side is not turned over.
  const flatAt = at([5, 5], [10, 0], [0, 10]);
  assert.equal(turnedOver(s, flatAt, at([10, 10], [10, 0], [0, 10])), null);
  assert.equal(turnedOver(s, flatAt, at([0, 0], [10, 0], [0, 10])), null);
});

test("a solver answer that turns an arc over is refused, and nothing moves", async () => {
  // The kernel keeps each arc's centre on its side, so to see the app's
  // own check fail, a kernel that answers with the arc's centre mirrored
  // across its chord: the step is refused with ARC_TURNED.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 0], [0, 10], [0, 0]); // points 3 (start), 4 (end), 5 (centre)
  const order = sketchOf(arc.doc, s0.id).points.map((p) => p.id);
  const mirrored: Record<string, [number, number]> = { "point-3": [10, 0], "point-4": [0, 10], "point-5": [10, 10] };
  const flipping: KernelCalls = { call: async () => JSON.stringify({ result: "solved", points: order.map((p) => mirrored[p]), free: 0, redundant: [] }) } as never;
  const got = await dragStep(flipping, arc.doc, s0.id, "point-3", [10, 0]);
  assert.deepEqual(got, { refused: ARC_TURNED });
  // The real solver, the same drag of the start along its circle a little: solved, the centre on its side.
  const real = solvedDoc(await dragStep(kernel, arc.doc, s0.id, "point-3", [9.9, 1]));
  const t = sketchOf(real, s0.id);
  assert.ok(turn(xy(t, "point-5"), xy(t, "point-3"), xy(t, "point-4")) > 0);
});

test("a refusal or conflict from the solver is refused in words, and pointOf names what it can't find", async () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [5, 5]);
  const answering = (answer: object): KernelCalls => ({ call: async () => JSON.stringify(answer) }) as never;
  assert.deepEqual(await dragStep(answering({ result: "refused", message: "too many points" }), l.doc, s0.id, "point-4", [6, 6]), { refused: "The sketch can't be solved there: too many points." });
  assert.deepEqual(await dragStep(answering({ result: "conflict", blame: 0, group: [0] }), l.doc, s0.id, "point-4", [6, 6]), { refused: "The sketch's constraints can't all hold there, so the point stays where it last was." });
  await assert.rejects(dragStep(kernel, l.doc, "sketch-99", "point-4", [6, 6]), /there is no sketch sketch-99 in the design/);
  assert.throws(() => pointOf(l.doc, s0.id, "point-99"), /sketch sketch-2 has no point point-99/);
  assert.throws(() => pointOf(l.doc, "sketch-99", "point-4"), /sketch sketch-99 has no point point-4/);
});

test("a drag in the second of two sketches changes only that one, and keeps the points it doesn't move as they were", async () => {
  // A sketch with a line, then a second with a line (0, 0)–(5, 5), its end dragged to (6, 9).
  const a = addSketch(partDocument("box", 40, 30, 20));
  const la = drawLine(a.doc, a.id, [1, 1], [2, 2]);
  const b = addSketch(la.doc);
  const lb = drawLine(b.doc, b.id, [0, 0], [5, 5]);
  const [p, q] = sketchOf(lb.doc, b.id).points.map((x) => x.id);
  const got = solvedDoc(await dragStep(kernel, lb.doc, b.id, q, [6, 9]));
  assert.equal(sketchOf(got, a.id), sketchOf(lb.doc, a.id), "the other sketch is the same object");
  assert.deepEqual(xy(sketchOf(got, b.id), q), [6, 9]);
  assert.equal(sketchOf(got, b.id).points.find((x) => x.id === p), sketchOf(lb.doc, b.id).points.find((x) => x.id === p), "an unmoved point is kept as it was");
});

test("regression (47d4 review): an arc can't be carried across its chord through a step landing exactly flat", async () => {
  // An arc from (10, 0) to (0, 0) round (5, 3): turn(centre, start, end) = (5)(−3) − (−3)(−5) = −30. Its centre dragged to
  // (5, −3) at 0.5 mm a pixel goes in ⌈6 / 4⌉ = 2 steps: (5, 0), on the chord (flat, allowed), then (5, −3), +30, the arc the
  // other way round. Against the step before (flat) that is no turn, but against where the drag began it is: refused,
  // left at the flat step. In one step it is refused too.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 0], [0, 0], [5, 3]); // start point-3, end point-4, centre point-5
  const tri = (d: DesignDocument) => {
    const s = sketchOf(d, s0.id);
    return turn(xy(s, "point-5"), xy(s, "point-3"), xy(s, "point-4"));
  };
  assert.equal(tri(arc.doc), -30);
  assert.deepEqual(await dragStep(kernel, arc.doc, s0.id, "point-5", [5, -3]), { refused: ARC_TURNED });
  const got = await dragTo(kernel, arc.doc, s0.id, "point-5", [5, -3], 0.5);
  assert.equal(got.refused, ARC_TURNED);
  assert.ok(tri(got.doc) <= 0, `the arc turned over: ${tri(got.doc)}`);
});

test("the newest target wins: a drag stops between steps once a newer one comes", async () => {
  // 0 → 100 mm at 1 mm a pixel is 13 steps; told after the 2nd that a newer target came, it stops there.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s0.doc, s0.id, [0, 0], [5, 5]);
  let seen = 0;
  const got = await dragTo(kernel, l.doc, s0.id, "point-4", [105, 5], 1, () => seen >= 2, () => void seen++);
  assert.equal(seen, 2);
  assert.equal(got.refused, null);
  assert.deepEqual(pointOf(got.doc, s0.id, "point-4"), [5 + 200 / 13, 5]);
});

/** Every constraint holds exactly (no arcs, so substitution), and each fixed point is where it was fixed: the first broken, or null. */
function broken(s: Sketch, fixedAt: ReadonlyMap<string, [number, number]>): string | null {
  for (const c of s.constraints) {
    if (c.kind === "fix") {
      const [x, y] = xy(s, c.point);
      const was = fixedAt.get(c.point)!;
      if (x !== was[0] || y !== was[1]) return `${c.id} fixed ${c.point} moved`;
      continue;
    }
    const [a, b] = [xy(s, c.a), xy(s, c.b)];
    if ((c.kind === "horizontal" || c.kind === "coincident") && a[1] !== b[1]) return `${c.id} ${c.kind} broken in y`;
    if ((c.kind === "vertical" || c.kind === "coincident") && a[0] !== b[0]) return `${c.id} ${c.kind} broken in x`;
  }
  return null;
}

test("seeded drags of random constrained sketches keep every promise", async () => {
  const seed = BigInt(process.env.FISSION_SEED ?? 47_003);
  const rand = seeded(seed);
  const below = (n: number) => Math.floor(rand.next() * n);
  let steps = 0;
  let onPointer = 0;
  let refused = 0;
  for (let session = 0; session < 30; session++) {
    // Two rectangles on a 1 mm grid and random H, V, coincident and fix constraints between their corners.
    const s0 = addSketch(partDocument("box", 40, 30, 20));
    let doc = s0.doc;
    const id = s0.id;
    for (let k = 0; k < 2; k++) {
      const a: [number, number] = [below(21) - 10, below(21) - 10];
      doc = drawRectangle(doc, id, a, [a[0] + 1 + below(8), a[1] + 1 + below(8)]).doc;
    }
    const fixedAt = new Map<string, [number, number]>();
    for (let k = 0; k < 5; k++) {
      const pts = sketchOf(doc, id).points.map((p) => p.id);
      const [a, b] = [pts[below(pts.length)], pts[below(pts.length)]];
      const kind = (["horizontal", "vertical", "coincident", "fix"] as const)[below(4)];
      const got = await addConstraint(kernel, doc, id, kind === "fix" ? { kind, point: a } : { kind, a, b });
      if ("doc" in got) doc = got.doc;
    }
    for (const c of sketchOf(doc, id).constraints) if (c.kind === "fix") fixedAt.set(c.point, xy(sketchOf(doc, id), c.point));
    // Five drags of a random point that can be dragged, each to a random spot up to 30 mm away, at 0.25 mm a pixel.
    for (let d = 0; d < 5; d++) {
      const free = sketchOf(doc, id).points.map((p) => p.id).filter((p) => grabProblem(sketchOf(doc, id), p) === null);
      if (free.length === 0) break;
      const p = free[below(free.length)];
      const to: [number, number] = [below(61) - 30, below(61) - 30];
      let last = doc;
      const got = await dragTo(kernel, doc, id, p, to, 0.25, undefined, (next) => {
        steps++;
        const why = broken(sketchOf(next, id), fixedAt);
        assert.equal(why, null, `seed ${seed} session ${session} drag ${d}: ${why}`);
        // No arcs: every point moves at most as far as the dragged one did in this step (each copies the coordinates of its group).
        const was = sketchOf(last, id);
        const moved = (q: string) => Math.hypot(xy(sketchOf(next, id), q)[0] - xy(was, q)[0], xy(sketchOf(next, id), q)[1] - xy(was, q)[1]);
        for (const q of was.points) assert.ok(moved(q.id) <= moved(p) * (1 + 1e-12) + 1e-12, `seed ${seed} session ${session}: ${q.id} jumped ${moved(q.id)} when ${p} moved ${moved(p)}`);
        last = next;
      });
      if (got.refused !== null) refused++;
      // With no constraint naming it, the dragged point lands exactly on the pointer.
      const named = sketchOf(doc, id).constraints.some((c) => (c.kind === "fix" ? c.point === p : c.a === p || c.b === p));
      if (!named && got.refused === null) {
        assert.deepEqual(pointOf(got.doc, id, p), to, `seed ${seed} session ${session}: ${p} missed the pointer`);
        onPointer++;
      }
      doc = got.doc;
    }
  }
  assert.ok(steps > 300 && onPointer > 10, `steps ${steps}, on the pointer ${onPointer}, refused ${refused}`);
});
