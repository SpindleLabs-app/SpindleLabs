// Mutation survivors of 2026-11-08 in the file checks versions 14 and 15 brought (document.ts `checkProjections`,
// `hasVersion15Fields`), each killed by a test that breaks a file in exactly the way the survivor would let through, and
// asserts the reader's own words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { XY_PLANE } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { sketchEdgeTargets } from "../src/face-edges.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { projectPick } from "../src/projection.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { addSketch, drawCircle, pinNewPoints, projectEdges } from "../src/sketch.ts";

const kernel = nodeKernel();

// Cube A (feature-1), cube B (feature-2) moved (5, 5, 5) (feature-3), B joined to A (feature-4); Sketch 1 (feature-5) after.
async function sketched() {
  let doc: DesignDocument = partDocument("box", 10, 10, 10);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 5, y: 5, z: 5 }).doc;
  const s = addSketch(insertCombine(doc, "body:feature-1", ["body:feature-2"], "join").doc);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(s.doc, cache, kernel);
  const scene = joinBodies(await shownBodies(s.doc, build, cache), build);
  const corner = sketchEdgeTargets(s.doc, s.id, scene, XY_PLANE).find((t) => t.kind === "endpoint" && t.feature === "feature-4")!;
  const body = scene.bodies.findIndex((b) => b.body === "body:feature-1");
  const pick = projectPick(s.doc, s.id, scene, XY_PLANE, { face: scene.faceStart[body] });
  await cache.close();
  const pinned = JSON.parse(JSON.stringify(pinNewPoints(s.doc, drawCircle(s.doc, s.id, corner.at, 2).doc, s.id, [corner])));
  const projected = JSON.parse(JSON.stringify(projectEdges(s.doc, s.id, pick.edges.slice(0, 1)).doc));
  return { id: s.id, pinned, projected };
}

test("a projection holding a Combine result's edge name on a box is refused, in its own words", async () => {
  const { id, projected } = await sketched();
  const data = JSON.parse(JSON.stringify(projected));
  const p = data.sketches.find((x: { id: string }) => x.id === id).projected[0];
  assert.equal(p.feature, "feature-4");
  assert.doesNotThrow(() => readDesignDocument(data));
  // On box A (feature-1), which has faces of its own, so only the held-name check can refuse it.
  p.feature = "feature-1";
  data.timeline.features.find((x: { id: string }) => x.id === id).dependsOn = ["feature-1"];
  assert.throws(() => readDesignDocument(data), { message: `Design sketch ${id}'s projection ${p.id} has a Combine result's edge name but is of feature-1, which is not a Combine or a Duplicate, or an extrude that joins, cuts or intersects` });
});

test("a projection on the Combine whose edge is not text is refused as not a solid item's, never read as a name", async () => {
  const { id, projected } = await sketched();
  const data = JSON.parse(JSON.stringify(projected));
  const p = data.sketches.find((x: { id: string }) => x.id === id).projected[0];
  p.edge = 7;
  assert.throws(() => readDesignDocument(data), { message: `Design sketch ${id}'s projection ${p.id} is of feature-4, which is not a solid item before it in the timeline` });
});

test("version 14 data is refused when any pin holds a Combine result's name, whatever the pins beside it hold", async () => {
  const { id, pinned } = await sketched();
  const words = "Design data says version 14 but has a point or edge taken from a Combine's result, which version 15 brought";
  const data = JSON.parse(JSON.stringify(pinned));
  const s = data.sketches.find((x: { id: string }) => x.id === id);
  // Before the held pin: no pin at all, a pin whose name is a number, and a box's own corner name.
  s.pins = [null, { point: "p-x", kind: "endpoint", feature: "feature-1", name: 7 }, { point: "p-y", kind: "endpoint", feature: "feature-1", name: "back+right&back+top&right+top" }, ...s.pins];
  assert.throws(() => readDesignDocument({ ...data, version: 14 }), { message: words });
});
