// The sketch solver hunt (2026-11-11, #545): the re-solve a sketch gets
// when a body it is pinned to changes (rebuild.ts `follow`, 47d4). (1) A
// body's edit that carries an arc's pinned end past its centre must not
// turn the arc inside out unsaid: the re-solve refuses that, as a drag
// does (point-drag.ts `turnedOver`), and the sketch keeps its followed
// points with the "can't all hold" warning. (2) A sketch left unsolved by
// a body's edit keeps saying so on every rebuild while it stays so, and a
// constraint or drag is judged against its own connected part of the
// sketch, so curves that have nothing to do with the broken arc stay
// editable. On the real kernel's solver and build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addConstraint } from "../src/constraints.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { dragTo } from "../src/point-drag.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, drawArc, drawLine, pinNewPoints } from "../src/sketch.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (doc: DesignDocument, id: string, p: string): [number, number] => {
  const q = sketchOf(doc, id).points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
const near = (got: [number, number], want: [number, number], what: string) => assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 1e-9, `${what} at ${got}, not ${want}`);
const warning = (build: Awaited<ReturnType<typeof rebuildTimeline>>, id: string): string | undefined => {
  const r = build.results[id];
  return r.status === "built" ? r.constraints?.message : r.status;
};

/** A 40 × 30 × 20 box, a sketch on its top: a quarter arc round (30, 30) from the top's corner (40, 30), pinned there, anticlockwise to (30, 40); `fix` its points to fix. */
async function quarterArc(fix: ("centre" | "end")[]) {
  const { doc: onTop, id } = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const arc = drawArc(onTop, id, [40, 30], [30, 40], [30, 30]);
  const a = sketchOf(arc.doc, id).curves.find((c) => c.id === arc.id) as { id: string; start: string; end: string; centre: string };
  let doc = pinNewPoints(onTop, arc.doc, id, [{ at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" }]);
  for (const which of fix) {
    const got = await addConstraint(kernel, doc, id, { kind: "fix", point: a[which] });
    assert.ok("doc" in got, `fixing the ${which}`);
    doc = got.doc;
  }
  return { doc, id, arc: a };
}

async function rebuilt(doc: DesignDocument) {
  const build = await rebuildTimeline(doc, new BodyCache(kernel), kernel);
  return { build, doc: followedDoc(doc, build) };
}

/** Twice the signed area of the arc's triangle (centre, start, end): positive while it turns anticlockwise under half a turn. */
const turnOf = (doc: DesignDocument, id: string, a: { start: string; end: string; centre: string }): number => {
  const [c, s, e] = [xy(doc, id, a.centre), xy(doc, id, a.start), xy(doc, id, a.end)];
  return (s[0] - c[0]) * (e[1] - c[1]) - (s[1] - c[1]) * (e[0] - c[0]);
};

test("hand-worked (#545 item 1): the box made 24 wide would turn the pinned quarter arc inside out: refused with a warning, only the pinned point moves", async () => {
  const { doc, id, arc } = await quarterArc([]);
  // As drawn: (centre, start, end) = ((30,30), (40,30), (30,40)), so
  // start - centre = (10, 0) and end - centre = (0, 10): cross product
  // 10·10 - 0·0 = +100 > 0, an anticlockwise sweep of atan2(10,0) -
  // atan2(0,10) = 90°.
  assert.equal(turnOf(doc, id, arc), 100);
  const { build, doc: drawn } = await rebuilt(editFeature(doc, "feature-1", { width: 24 }));
  // The corner is now (24, 30), 6 mm LEFT of the centre (30, 30). Any arc
  // from there anticlockwise round a centre near (30, 30) to near (30, 40)
  // sweeps past 180° (the solve's answer, (31.33, 31.33) and (30, 38.67),
  // is a 270° loop: the triangle's sign flips). Refused as a drag is: the
  // pinned start follows its corner to (24, 30), the centre and the end
  // stay at (30, 30) and (30, 40), and the sketch says why.
  near(xy(drawn, id, arc.start), [24, 30], "the start, following its corner");
  near(xy(drawn, id, arc.centre), [30, 30], "the centre, left");
  near(xy(drawn, id, arc.end), [30, 40], "the end, left");
  assert.match(warning(build, id) ?? "none", /^Sketch 1's constraints can't all hold where its points on the body are now \(an arc would turn inside out\)/);
});

test("control (#545 item 1): the box made 36 wide keeps the corner right of the centre: solved, no warning, the arc still under half a turn", async () => {
  const { doc, id, arc } = await quarterArc([]);
  const { build, doc: drawn } = await rebuilt(editFeature(doc, "feature-1", { width: 36 }));
  near(xy(drawn, id, arc.start), [36, 30], "the start, following its corner");
  assert.equal(warning(build, id), undefined);
  assert.ok(turnOf(drawn, id, arc) > 0, "still turning anticlockwise under half a turn");
  const r = build.results[id];
  assert.ok(r.status === "built" && r.solved !== undefined, "the solve moved the free points");
});
