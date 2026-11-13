// SL #630 (hunt 2026-11-12, F4): a level slot's ends turned inside out with no refusal, by a drag or by a body
// edit. Each end is a half circle whose own sweep never changes (point-drag.ts `turnedOver` sees nothing): the
// sides reverse as the centres pass each other, and where a side meets an end the smooth joint becomes a cusp.
// Caught by `cornerTurned` (cases in corner-turned.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { dragTo } from "../src/point-drag.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, addSketch, pinNewPoints } from "../src/sketch.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";

const kernel = nodeKernel();
const sk = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const at = (doc: DesignDocument, id: string, p: string) => {
  const q = sk(doc, id).points.find((x) => x.id === p)!;
  return [q.x, q.y] as const;
};
function slot(doc: DesignDocument, id: string, clicks: [number, number][]) {
  let t = startTool("slot", id);
  for (const c of clicks) ({ doc, tool: t } = clickAt(doc, t, c) as { doc: DesignDocument; tool: typeof t });
  return doc;
}
/** Each end's bulge: the middle of the arc (anticlockwise from start to end) is farther from the other centre than its own centre is. */
function outward(doc: DesignDocument, id: string): boolean[] {
  const arcs = sk(doc, id).curves.filter((c) => c.kind === "arc") as { start: string; end: string; centre: string }[];
  return arcs.map((a, k) => {
    const [c, s] = [at(doc, id, a.centre), at(doc, id, a.start)];
    const o = at(doc, id, arcs[1 - k].centre);
    // A half circle anticlockwise from s round c: its middle is c + (s − c) turned a quarter left.
    const m = [c[0] - (s[1] - c[1]), c[1] + (s[0] - c[0])];
    return Math.hypot(m[0] - o[0], m[1] - o[1]) > Math.hypot(c[0] - o[0], c[1] - o[1]);
  });
}

test("hand-worked: a level slot's right centre dragged past its left one is refused, not turned inside out", async () => {
  // Slot tool: centres (0, 0) and (30, 0), radius 5 (third click (10, 5)): the left end bulges left, the right
  // end right. Drag the right centre to (-11, 0) at 0.1 mm a pixel: 32 steps of 41/32 mm, none landing within
  // 0.001 mm of x = 0, so no line shrinks. By hand, at x = -11 each end's arc (kept anticlockwise from its
  // start) now bulges toward the other centre: the left end's middle (-5, 0) is 6 from (-11, 0), less than its
  // centre's 11. The outline is pinched (the kernel's outline then says two curves touch). Expected: refused
  // as an arc turning inside out (ARC_TURNED), the slot as it was.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const doc = slot(s.doc, s.id, [[0, 0], [30, 0], [10, 5]]);
  assert.deepEqual(outward(doc, s.id), [true, true], "drawn with both ends outward");
  const right = (sk(doc, s.id).curves.filter((c) => c.kind === "arc")[1] as { centre: string }).centre;
  const got = await dragTo(kernel, doc, s.id, right, [-11, 0], 0.1);
  assert.deepEqual(outward(got.doc, s.id), [true, true], `ends after the drag (refused: ${got.refused}), right centre at ${at(got.doc, s.id, right)}`);
});

test("hand-worked: a box narrowed past a slot pinned to its corner does not turn the slot's ends inward unsaid", async () => {
  // Top face of the 40 x 30 x 20 box; slot centres (40, 30) (the back right corner, pinned) and (10, 30), radius 5,
  // its centre line sized 30. Box width 40 -> 9: the corner goes to (9, 30). By hand the slot keeps its length
  // and its ends' sides: the other centre at 9 - 30 = -21. The solve instead puts it at 9 + 30 = 39 (the
  // nearer root), so both ends bulge inward. Expected: the slot slid to -21, or the rebuild's "constraints
  // can't all hold ... an arc would turn inside out" warning.
  const { doc: d0, id } = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  let doc = pinNewPoints(d0, slot(d0, id, [[40, 30], [10, 30], [20, 35]]), id, [{ at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" }]);
  const line = sk(doc, id).curves.find((c) => c.kind === "line" && (c as { construction?: boolean }).construction) as { start: string; end: string };
  const sized = await addConstraint(kernel, doc, id, { kind: "distance", a: line.start, b: line.end, value: 30 });
  assert.ok("doc" in sized);
  doc = sized.doc;
  const edited = editFeature(doc, "feature-1", { width: 9 });
  const build = await rebuildTimeline(edited, new BodyCache(kernel), kernel);
  const after = followedDoc(edited, build);
  const warned = (build.results[id] as { constraints?: unknown }).constraints !== undefined;
  assert.ok(warned || outward(after, id).every(Boolean), `ends ${outward(after, id)} with no warning; centres ${sk(after, id).curves.filter((c) => c.kind === "arc").map((a) => at(after, id, (a as { centre: string }).centre))}`);
});
