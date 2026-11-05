// Step 47d4: a body's edit moves a point that follows it (pinned to an
// edge, 26f; projected, 27d) without the user touching the sketch, and an
// arc through that point is then no longer on one circle. A sketch with
// constraints promises its points are solved (constraints.ts), so the
// rebuild solves it again with the followed points where the body put
// them: what the solve moves is taken into the document like the followed
// points themselves. A sketch whose constraints can't hold there keeps
// the followed points unsolved, with a warning in words. A sketch with no
// constraints is left as before 47d (the kernel says when its arc is off).
// On the real kernel's solver and build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addConstraint } from "../src/constraints.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { BodyCache, followedDoc, rebuildTimeline, settleKept } from "../src/rebuild.ts";
import { addFaceSketch, drawArc, pinNewPoints } from "../src/sketch.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (doc: DesignDocument, id: string, p: string): [number, number] => {
  const q = sketchOf(doc, id).points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
const near = (got: [number, number], want: [number, number], what: string) => assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 1e-9, `${what} at ${got}, not ${want}`);

/**
 * A 40 × 30 × 20 box with a sketch on its top: a quarter arc round (30, 30)
 * from the top's back right corner (40, 30), pinned there, anticlockwise to
 * (30, 40); `fix` lists the arc's points to fix ("centre", "end").
 */
async function quarterArc(fix: ("centre" | "end")[]) {
  const { doc: onTop, id } = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const arc = drawArc(onTop, id, [40, 30], [30, 40], [30, 30]);
  const a = sketchOf(arc.doc, id).curves.find((c) => c.id === arc.id) as { start: string; end: string; centre: string };
  let doc = pinNewPoints(onTop, arc.doc, id, [{ at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" }]);
  assert.deepEqual(sketchOf(doc, id).pins?.map((p) => p.point), [a.start], "the start is pinned to the corner");
  for (const which of fix) {
    const got = await addConstraint(kernel, doc, id, { kind: "fix", point: a[which] });
    assert.ok("doc" in got, `fixing the ${which}`);
    doc = got.doc;
  }
  return { doc, id, arc: a };
}

/** The design rebuilt, and the document with its followed (and solved) points taken in, as the app draws it. */
async function rebuilt(doc: DesignDocument) {
  const build = await rebuildTimeline(doc, new BodyCache(kernel), kernel);
  return { build, doc: followedDoc(doc, build) };
}

test("hand-worked: the box made wider moves the pinned start, and the arc's free end follows round its fixed centre", async () => {
  const { doc, id, arc } = await quarterArc(["centre"]);
  const wider = editFeature(doc, "feature-1", { width: 60 });
  const { build, doc: drawn } = await rebuilt(wider);
  // The corner is now at (60, 30): the start follows it, 30 from the fixed
  // centre (30, 30). The arc's ends must stay on one circle, so the end,
  // the only free point, goes 30 from the centre too. The solve moves it
  // the least it can: straight out along the ray from the centre through
  // where it was ((30, 40), straight up), so to (30, 30 + 30) = (30, 60).
  near(xy(drawn, id, arc.start), [60, 30], "the start");
  near(xy(drawn, id, arc.centre), [30, 30], "the fixed centre");
  near(xy(drawn, id, arc.end), [30, 60], "the end");
  const r = build.results[id];
  assert.equal(r.status, "built");
  assert.ok(r.status === "built" && r.constraints === undefined, "no warning: the constraints hold");
  // The settle an edit runs takes the same places into the document.
  const settled = await settleKept(kernel, doc, wider);
  near(xy(settled, id, arc.end), [30, 60], "the settled end");
  // Settling it again changes nothing: it is solved where it lies.
  assert.equal(await settleKept(kernel, settled, settled), settled);
});

test("a body's edit that leaves the followed points where they were solves nothing and changes nothing", async () => {
  const { doc, id } = await quarterArc(["centre"]);
  const taller = editFeature(doc, "feature-1", { height: 25 }); // the top's corners don't move in the sketch
  const { build, doc: drawn } = await rebuilt(taller);
  assert.deepEqual(sketchOf(drawn, id).points, sketchOf(doc, id).points);
  const r = build.results[id];
  assert.ok(r.status === "built" && r.solved === undefined && r.constraints === undefined);
});

test("constraints that can't hold where the body put the point: the followed point is taken, the rest left, and the sketch says why", async () => {
  // The centre and the end both fixed: 10 apart, so the start must be 10
  // from the centre too, but the corner takes it 30 away.
  const { doc, id, arc } = await quarterArc(["centre", "end"]);
  const { build, doc: drawn } = await rebuilt(editFeature(doc, "feature-1", { width: 60 }));
  near(xy(drawn, id, arc.start), [60, 30], "the start, following its corner");
  near(xy(drawn, id, arc.end), [30, 40], "the end, left");
  const r = build.results[id];
  assert.ok(r.status === "built" && r.solved === undefined);
  assert.match(r.status === "built" ? (r.constraints?.message ?? "") : "", /^Sketch 1's constraints can't all hold where its points on the body are now/);
});

test("a sketch with no constraints is left as before: its followed point moves alone", async () => {
  const { doc, id, arc } = await quarterArc([]);
  const { build, doc: drawn } = await rebuilt(editFeature(doc, "feature-1", { width: 60 }));
  near(xy(drawn, id, arc.start), [60, 30], "the start");
  near(xy(drawn, id, arc.end), [30, 40], "the end, not solved");
  const r = build.results[id];
  assert.ok(r.status === "built" && r.solved === undefined && r.constraints === undefined);
});

test("the solver failing during the rebuild builds the sketch with its followed points and says so, never fails the build", async () => {
  const { doc, id, arc } = await quarterArc(["centre"]);
  const failing = { ...kernel, call: ((op: string, ...a: unknown[]) => (op === "solve_sketch" ? Promise.reject(new Error("took too long")) : (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...a))) as typeof kernel.call };
  const build = await rebuildTimeline(editFeature(doc, "feature-1", { width: 60 }), new BodyCache(failing), failing);
  const r = build.results[id];
  assert.ok(r.status === "built" && r.solved === undefined);
  assert.match(r.status === "built" ? (r.constraints?.message ?? "") : "", /the solver failed: took too long/);
  near(xy(followedDoc(doc, build), id, arc.end), [30, 40], "the end, left");
});
