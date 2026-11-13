// SL #630 (hunt 2026-11-12, F5): a sized rectangle drawn from a box's corner was mirrored, silently, when one body
// edit carried the corner past the rectangle's far side; the same edit made in two steps slides it instead.
// rebuild.ts solvedAgain solves once from the stored points with the followed point already at its new place, and
// the solver can take the nearer of the two answers the lengths allow (the mirror). Now every corner turned over
// by a body edit is said (point-drag.ts `cornerTurned`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, pinNewPoints } from "../src/sketch.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";

const kernel = nodeKernel();
const sk = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xs = (doc: DesignDocument, id: string) => sk(doc, id).points.map((p) => p.x);

async function pocket() {
  const { doc: d0, id } = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  // Rectangle tool from the back right corner (40, 30) (a click there pins it) to (20, 20): squared, then sized 20 x 10.
  let t = startTool("rectangle", id);
  let doc = d0;
  for (const c of [[40, 30], [20, 20]] as [number, number][]) ({ doc, tool: t } = clickAt(doc, t, c) as { doc: DesignDocument; tool: typeof t });
  doc = pinNewPoints(d0, doc, id, [{ at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" }]);
  const [bottom, right] = sk(doc, id).curves as { start: string; end: string }[];
  for (const [l, v] of [[bottom, 20], [right, 10]] as const) {
    const got = await addConstraint(kernel, doc, id, { kind: "distance", a: l.start, b: l.end, value: v });
    assert.ok("doc" in got);
    doc = got.doc;
  }
  return { doc, id };
}
async function widthTo(doc: DesignDocument, w: number) {
  const edited = editFeature(doc, "feature-1", { width: w });
  const build = await rebuildTimeline(edited, new BodyCache(kernel), kernel);
  return { doc: followedDoc(edited, build), build };
}

test("hand-worked: the box made 15 wide carries the rectangle with its corner, not mirrored past it", async () => {
  const { doc, id } = await pocket();
  // By hand: the corner goes to (15, 30); the rectangle keeps 20 x 10 and its side of the corner (it was drawn
  // to the left of and below it), so x from 15 - 20 = -5 to 15. The mirror, x from 15 to 35, holds every
  // constraint too, but nothing asked it to turn over.
  const one = await widthTo(doc, 15);
  // The same width reached in two edits (40 -> 25 -> 15) slides, so the answer depends on the edit's path.
  const two = await widthTo((await widthTo(doc, 25)).doc, 15);
  assert.deepEqual([Math.min(...xs(two.doc, id)), Math.max(...xs(two.doc, id))], [-5, 15], "two steps");
  const warned = (one.build.results[id] as { constraints?: unknown }).constraints !== undefined;
  assert.ok(warned || (Math.min(...xs(one.doc, id)) === -5 && Math.max(...xs(one.doc, id)) === 15), `one edit: x from ${Math.min(...xs(one.doc, id))} to ${Math.max(...xs(one.doc, id))}, no warning`);
});
