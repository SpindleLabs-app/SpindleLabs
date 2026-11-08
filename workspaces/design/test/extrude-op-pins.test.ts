// Pins and projections on a body an extrude that joins or cuts changed (Combine hunt 2): snapping to such a body
// names the point by the extrude, with a design-wide edge name (design-edges.ts, rule 5), as a Combine's result is
// named. The saved file must open again as the same design; before the fix the reader took such names only on a Combine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { XY_PLANE } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { sketchEdgeTargets } from "../src/face-edges.ts";
import { projectPick } from "../src/projection.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { addSketch, drawCircle, pinNewPoints, projectEdges, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();
const reopened = (d: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(d)));

/** Box 20 × 20 × 10 at the origin (feature-1), the square x/y 5..10 extruded 20 up as `op` on it, then an empty sketch on XY after it, built. */
async function boxWithOperation(op: "cut" | "join") {
  let doc = partDocument("box", 20, 20, 10);
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [5, 5], [10, 10]).doc;
  const e = extrudeSketch(doc, s.id, 20, false, undefined, { operation: op, bodies: ["body:feature-1"] });
  const p = addSketch(e.doc);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(p.doc, cache, kernel);
  assert.equal(build.results[e.id].status, "built");
  const scene = joinBodies(await shownBodies(p.doc, build, cache), build);
  return { doc: p.doc, sketch: p.id, extrude: e.id, scene, cache };
}

/** A circle centred on the box's corner (0, 0, 0), pinned there. */
async function pinnedOnCorner(op: "cut" | "join") {
  const b = await boxWithOperation(op);
  // The box's bottom front left corner is (0, 0, 0); seen from above, (0, 0). The extrude changed the box, so the
  // last item that made this body is the extrude, and the corner is named design-wide.
  const corner = sketchEdgeTargets(b.doc, b.sketch, b.scene, XY_PLANE).find((t) => t.kind === "endpoint" && t.at[0] === 0 && t.at[1] === 0);
  await b.cache.close();
  assert.ok(corner);
  assert.equal(corner.feature, b.extrude);
  return { ...b, doc: pinNewPoints(b.doc, drawCircle(b.doc, b.sketch, corner.at, 2).doc, b.sketch, [corner]) };
}

for (const op of ["cut", "join"] as const) {
  test(`a circle pinned to a corner of a box an Extrude ${op} changed: the saved file opens as the same design, and rebuilds the same`, async () => {
    const b = await pinnedOnCorner(op);
    const back = reopened(b.doc);
    assert.deepEqual(back, b.doc);
    // The pin still holds after reopening: the circle's centre is the corner, (0, 0), in both builds.
    const cache = new BodyCache(kernel);
    const before = await rebuildTimeline(b.doc, cache, kernel);
    const after = await rebuildTimeline(back, cache, kernel);
    await cache.close();
    assert.equal(after.results[b.sketch].status, "built");
    assert.deepEqual(after.results[b.sketch], before.results[b.sketch]);
  });

  test(`the top face of a box an Extrude ${op} changed, projected into a sketch: the saved file opens as the same design`, async () => {
    const b = await boxWithOperation(op);
    const pick = projectPick(b.doc, b.sketch, b.scene, XY_PLANE, { face: b.scene.faceStart[0] });
    await b.cache.close();
    assert.equal(pick.note, null);
    assert.ok(pick.edges.length > 0 && pick.edges.every((e) => e.feature === b.extrude));
    const doc = projectEdges(b.doc, b.sketch, pick.edges).doc;
    assert.deepEqual(reopened(doc), doc);
  });
}

test("a design-wide name on an extrude that makes a new body is still refused: only a Combine or a joining or cutting extrude gives one", async () => {
  const b = await pinnedOnCorner("cut");
  const data = JSON.parse(JSON.stringify(b.doc));
  // Turn the cutting extrude into one making a new body: its pin's held name now names nothing it can give.
  const extrude = data.timeline.features.find((f: { id: string }) => f.id === b.extrude);
  delete extrude.intent.parameters.operation;
  delete extrude.intent.parameters.bodies;
  assert.throws(() => readDesignDocument(data), /pin on point-\d+ has a Combine result.s name but is on feature-\d+, which is not a Combine or a Duplicate, or an extrude that joins, cuts or intersects/);
});
