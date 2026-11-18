// SL #612 (bug hunt 2026-11-12, A1 and B1): an arc turns inside out only
// when its end passes its start (its sweep wraps through 0 or 2π) or the
// solver jumps to its other branch; passing a half turn is an ordinary
// bigger arc. The old check, the sign of the (centre, start, end) triangle
// (r²·sin(sweep)), refused every arc dragged past 180° and, on an exact
// half circle (a slot's end, area 0 up to rounding), one drag direction
// chosen by rounding. Proofs from the hunt: hunt-1112-A slot-drag-turned and
// slot-follow-turned, hunt-1112-B arc-drag and arc-drag-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { ARC_TURNED, dragTo, MAX_SWEEP_STEP, sweepOf, turn, turnedOver } from "../src/point-drag.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, addSketch, drawArc, pinNewPoints } from "../src/sketch.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";

const kernel = nodeKernel();
const sk = (d: DesignDocument, id: string): Sketch => d.sketches.find((s) => s.id === id)!;
const xy = (s: Sketch, id: string): SketchXY => {
  const p = s.points.find((q) => q.id === id)!;
  return [p.x, p.y];
};
const deg = (d: number): number => (d * Math.PI) / 180;
const onCircle = (d: number): [number, number] => [10 * Math.cos(deg(d)), 10 * Math.sin(deg(d))];

test("hand-worked: sweeps counter-clockwise in [0, 2π)", () => {
  // From (10, 0) round (0, 0): to (0, 10) a quarter turn, π/2; to (−10, 0) a half, π; to (0, −10) three quarters, 3π/2.
  assert.equal(sweepOf([0, 0], [10, 0], [0, 10]), Math.PI / 2);
  assert.equal(sweepOf([0, 0], [10, 0], [-10, 0]), Math.PI);
  assert.equal(sweepOf([0, 0], [10, 0], [0, -10]), (3 * Math.PI) / 2);
  // Off the origin: round (1, 2) from (4, 2) (start − centre = (3, 0)) to (1, 5) ((0, 3)): a quarter turn again.
  assert.equal(sweepOf([1, 2], [4, 2], [1, 5]), Math.PI / 2);
  // A half circle a rounding either side of flat: (−10, ±1e-14) is a hair under or over π, never near 0 or 2π.
  assert.ok(Math.abs(sweepOf([0, 0], [10, 0], [-10, 1e-14]) - Math.PI) < 1e-12);
  assert.ok(Math.abs(sweepOf([0, 0], [10, 0], [-10, -1e-14]) - Math.PI) < 1e-12);
  assert.equal(MAX_SWEEP_STEP, (2 * Math.PI) / 3);
});

test("hand-worked: a sweep through a half turn is not turned over, a wrap through 0 is, and the jump limit's 0.9×/1.1× boundaries", () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 0], [0, 10], [0, 0]); // start point-3, end point-4, centre point-5
  const s = sk(arc.doc, s0.id);
  const at = (endDeg: number) => new Map([["point-5", [0, 0] as const], ["point-3", [10, 0] as const], ["point-4", onCircle(endDeg)]]);
  // 170° to 190°: through the half turn, a change of 20°. The triangle's sign flips (sin 170° > 0 > sin 190°), the arc doesn't.
  assert.ok(turn([0, 0], [10, 0], onCircle(170)) > 0 && turn([0, 0], [10, 0], onCircle(190)) < 0);
  assert.equal(turnedOver(s, at(170), at(190)), null);
  assert.equal(turnedOver(s, at(190), at(170)), null);
  // The end carried past the start, 5° to −5° (355°): the sweep wraps, 5° → 355°, a change of 350°: turned over, both ways.
  assert.equal(turnedOver(s, at(5), at(-5)), arc.id);
  assert.equal(turnedOver(s, at(-5), at(5)), arc.id);
  // The jump limit, 120°: from 30°, 0.9 × 120° = 108° (to 138°) is taken, 1.1 × 120° = 132° (to 162°) refused.
  assert.equal(turnedOver(s, at(30), at(30 + 0.9 * 120)), null);
  assert.equal(turnedOver(s, at(30), at(30 + 1.1 * 120)), arc.id);
});

for (const fixed of [true, false]) {
  test(`hand-worked: a quarter arc's end dragged round to 270°${fixed ? " (centre fixed)" : ""} is taken, not refused at 180°`, async () => {
    // Quarter arc from (10, 0) to (0, 10) round (0, 0). The end dragged in 5° moves round the circle, as a hand would,
    // to (0, −10): counter-clockwise from (10, 0) that is a 270° arc, a valid sketch arc (the kernel builds it).
    const s = addSketch(partDocument("box", 40, 30, 20));
    const a = drawArc(s.doc, s.id, [10, 0], [0, 10], [0, 0]);
    const arc = sk(a.doc, s.id).curves.find((c) => c.id === a.id);
    assert.ok(arc?.kind === "arc");
    let doc = a.doc;
    if (fixed) {
      const got = await addConstraint(kernel, doc, s.id, { kind: "fix", point: arc.centre });
      assert.ok("doc" in got);
      doc = got.doc;
    }
    for (let d = 95; d <= 270; d += 5) {
      const got = await dragTo(kernel, doc, s.id, arc.end, onCircle(d), 0.05);
      assert.equal(got.refused, null, `refused at ${d}°`);
      doc = got.doc;
    }
    const t = sk(doc, s.id);
    const sweep = sweepOf(xy(t, arc.centre), xy(t, arc.start), xy(t, arc.end));
    if (fixed) {
      // Centre held at (0, 0), so the end lands where the pointer is: (0, −10), 270°.
      assert.ok(Math.hypot(xy(t, arc.end)[0], xy(t, arc.end)[1] + 10) < 1e-6, `the end is at ${xy(t, arc.end)}`);
      assert.ok(Math.abs(sweep - deg(270)) < 1e-6, `sweep ${sweep}`);
    } else assert.ok(sweep > Math.PI, `still under a half turn: ${sweep}`);
  });
}

test("hand-worked: an arc's end dragged across its start is still refused (it would turn inside out)", async () => {
  // Quarter arc from (10, 0) to (0, 10) round (0, 0), its centre and start fixed: the end can only go round the circle.
  // Dragged to 5° first (a 5° arc), then on to −5°: there the arc would run from (10, 0) counter-clockwise to 355°,
  // its end past its start (the sweep wrapping from 5° to 355°): refused, the end left short of the start.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const a = drawArc(s.doc, s.id, [10, 0], [0, 10], [0, 0]);
  const arc = sk(a.doc, s.id).curves.find((c) => c.id === a.id);
  assert.ok(arc?.kind === "arc");
  let doc = a.doc;
  for (const point of [arc.centre, arc.start]) {
    const got = await addConstraint(kernel, doc, s.id, { kind: "fix", point });
    assert.ok("doc" in got);
    doc = got.doc;
  }
  for (let d = 85; d >= 5; d -= 5) {
    const got = await dragTo(kernel, doc, s.id, arc.end, onCircle(d), 0.05);
    assert.equal(got.refused, null, `refused at ${d}°`);
    doc = got.doc;
  }
  const crossed = await dragTo(kernel, doc, s.id, arc.end, onCircle(-5), 0.05);
  assert.ok(crossed.refused !== null, "the end was carried past the start");
  const t = sk(crossed.doc, s.id);
  const sweep = sweepOf(xy(t, arc.centre), xy(t, arc.start), xy(t, arc.end));
  assert.ok(sweep < deg(10), `the arc swept ${sweep}`);
  // The drag from 5° in one go to −5° (one step at 1 mm a pixel) is refused with the inside-out words.
  assert.equal((await dragTo(kernel, doc, s.id, arc.end, onCircle(-5), 1)).refused, ARC_TURNED);
});

function slot(kind: "slot" | "overall-slot", clicks: SketchXY[]) {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  let doc = s0.doc;
  let tool = startTool(kind, s0.id);
  for (const p of clicks) ({ doc, tool } = clickAt(doc, tool, p));
  return { doc, id: s0.id };
}

for (const third of [[0, 5], [6, 0]] as SketchXY[]) {
  test(`hand-worked (hunt A1): tilted slot (0,0)-(6,8), side through ${third}: its far end's centre drags 1 mm either way along the slot`, async () => {
    // The slot's axis u = (6, 8)/10 = (0.6, 0.8). The far end is a half circle round c2 = (6, 8), its triangle flat but
    // for rounding. Moving c2 by ±u keeps it on its ends' perpendicular bisector, so the arc becomes a little more (+u)
    // or less (−u) than a half circle, still bulging away from c1: nothing turns inside out, both drags solve.
    const { doc, id } = slot("slot", [[0, 0], [6, 8], third]);
    const s = sk(doc, id);
    const far = s.curves.filter((c) => c.kind === "arc")[1];
    assert.ok(far?.kind === "arc");
    const c2 = xy(s, far.centre);
    assert.ok(Math.abs(turn(c2, xy(s, far.start), xy(s, far.end))) < 1e-12);
    for (const k of [1, -1]) {
      const r = await dragTo(kernel, doc, id, far.centre, [c2[0] + 0.6 * k, c2[1] + 0.8 * k], 0.05);
      assert.equal(r.refused, null, `dragging c2 by ${k > 0 ? "+" : "−"}u`);
    }
  });
}

test("hand-worked (hunt A1): a tilted overall slot's corner drags as the same slot drawn level does", async () => {
  // Overall slot ends (1, 2) and (13, 7), side through (3, 9): axis u = (12, 5)/13, n = (−5, 12)/13. The same slot level:
  // ends (0, 0), (13, 0), side through (2·12 + 7·5, −2·5 + 7·12)/13 = (59, 74)/13. The first corner dragged (−1.5, 2.5)
  // is, in the slot's coordinates, ((−1.5·12 + 2.5·5)/13, (1.5·5 + 2.5·12)/13) = (−5.5, 37.5)/13. Congruent drags agree.
  const tilted = slot("overall-slot", [[1, 2], [13, 7], [3, 9]]);
  const level = slot("overall-slot", [[0, 0], [13, 0], [59 / 13, 74 / 13]]);
  const a1t = sk(tilted.doc, tilted.id).points[0];
  const a1l = sk(level.doc, level.id).points[0];
  assert.equal((await dragTo(kernel, level.doc, level.id, a1l.id, [a1l.x - 5.5 / 13, a1l.y + 37.5 / 13], 0.05)).refused, null);
  assert.equal((await dragTo(kernel, tilted.doc, tilted.id, a1t.id, [a1t.x - 1.5, a1t.y + 2.5], 0.05)).refused, null);
});

async function narrowed(c2: SketchXY, third: SketchXY): Promise<string | undefined> {
  // A 40 × 30 × 20 box; on its top a slot from the corner (40, 30), its first centre pinned there, radius 6. Width 38
  // moves that centre 2 mm to (38, 30): a 6 mm half circle's centre moved 2 mm never crosses its 12 mm chord.
  const { doc: onTop, id } = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  let doc = onTop;
  let tool = startTool("slot", id);
  for (const p of [[40, 30], c2, third] as SketchXY[]) ({ doc, tool } = clickAt(doc, tool, p));
  doc = pinNewPoints(onTop, doc, id, [{ at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" }]);
  const build = await rebuildTimeline(editFeature(doc, "feature-1", { width: 38 }), new BodyCache(kernel), kernel);
  const r = build.results[id];
  assert.equal(r.status, "built");
  return r.status === "built" ? r.constraints?.message : undefined;
}

test("hand-worked (hunt A1): a slot pinned to a box's corner follows the box made 2 mm narrower, level or tilted, with no warning", async () => {
  assert.equal(await narrowed([20, 30], [30, 24]), undefined, "level, to (20, 30)");
  // Tilted, to (20, 15), u = (−0.8, −0.6): the solve sweeps the pinned end's arc from 180° to about 149° (the hunt's numbers).
  assert.equal(await narrowed([20, 15], [30, 15]), undefined, "tilted, to (20, 15)");
});
