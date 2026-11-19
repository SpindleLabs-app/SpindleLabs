// SL #764 item 1 (P-1, app-wide hunt 2026-11-14): with nothing selected the
// Feature and Body sections describe the part, the last item that makes a
// body. After a Combine used that body up (a tool not kept), the panel showed
// dashes for every number although the design held one good body. It now
// describes the body that took the part in, as a click on its Bodies row
// does. Built by the real rebuild on the real kernel; volumes by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, partFeature, type DesignDocument } from "../src/document.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { bodyReference } from "../src/references.ts";
import { panelFocus, panelPart } from "../src/selection.ts";

const kernel = nodeKernel();

async function drawn(doc0: DesignDocument): Promise<{ doc: DesignDocument; scene: Scene }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies), builtPieceFaces(build));
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  await cache.close();
  return { doc, scene };
}

/** What the panel shows with nothing selected: the feature, the body's name and its volume rounded. */
function unselected(scene: Scene, doc: DesignDocument) {
  const f = panelFocus([], scene, doc);
  return f && { feature: f.feature.id, body: f.body === null ? null : `Body ${f.body.place}`, volume: f.body === null ? null : Math.round(f.body.view.volume) };
}

/** Box 1, 30 × 20 × 10, and Box 2, 10 × 10 × 20, both standing on z = 0 round the same middle. */
function twoBoxes() {
  const one = partDocument("box", 30, 20, 10);
  const two = insertPreset(one, "box", 10, 10, 20);
  return { doc: two.doc, b1: "feature-1", b2: two.id };
}

test("hand-worked: after Combine Join with nothing picked, the panel shows the joined body, not dashes", async () => {
  const t = twoBoxes();
  const { doc, scene } = await drawn(insertCombine(t.doc, `body:${t.b1}`, [`body:${t.b2}`], "join").doc);
  assert.equal(scene.bodies.length, 1, "one body is left");
  // The part is still Box 2 (the last item making a body), whose body the Join used up.
  assert.equal(partFeature(doc)?.id, t.b2);
  // Join: 30·20·10 + 10·10·20 − the overlap 10·10·10 (Box 2 lies inside Box 1's footprint, z 0..10) = 6000 + 2000 − 1000 = 7000.
  assert.deepEqual(unselected(scene, doc), { feature: t.b1, body: "Body 1", volume: 7000 });
  // The same as a click on Body 1's row.
  const clicked = panelFocus([bodyReference(scene.bodies[0].body)], scene, doc);
  assert.equal(clicked?.body, scene.bodies[0]);
  assert.equal(clicked?.feature.id, t.b1);
});

test("hand-worked: after Combine Cut using its tool up, the panel shows the cut body", async () => {
  const t = twoBoxes();
  const { doc, scene } = await drawn(insertCombine(t.doc, `body:${t.b1}`, [`body:${t.b2}`], "cut").doc);
  // Cut: 6000 − the overlap 1000 = 5000 (a 10 × 10 hole through Box 1's 10 mm height).
  assert.deepEqual(unselected(scene, doc), { feature: t.b1, body: "Body 1", volume: 5000 });
});

test("hand-worked: a chain of Combines is followed to the body that holds the part now", async () => {
  const t = twoBoxes();
  // Box 3, 40 × 30 × 5, under the same middle; Combine 1 joins Box 2 into Box 3, then Combine 2 joins Box 3 into Box 1.
  const three = insertPreset(t.doc, "box", 40, 30, 5);
  const c1 = insertCombine(three.doc, `body:${three.id}`, [`body:${t.b2}`], "join");
  const c2 = insertCombine(c1.doc, `body:${t.b1}`, [`body:${three.id}`], "join");
  const { doc, scene } = await drawn(c2.doc);
  assert.equal(scene.bodies.length, 1);
  assert.equal(partFeature(doc)?.id, three.id, "the part is Box 3, used up by Combine 2");
  // Union of the three, all on z = 0 round one middle: Box 3 (40·30·5 = 6000) + Box 1 above z 5 (30·20·5 = 3000)
  // + Box 2 above z 10 (10·10·10 = 1000) = 10000.
  assert.deepEqual(unselected(scene, doc), { feature: t.b1, body: "Body 1", volume: 10000 });
});

test("control: with Keep tools on the part's own body is still shown and described", async () => {
  const t = twoBoxes();
  const { doc, scene } = await drawn(insertCombine(t.doc, `body:${t.b1}`, [`body:${t.b2}`], "join", true).doc);
  assert.equal(scene.bodies.length, 2);
  // Box 2 untouched: 10·10·20 = 2000.
  assert.deepEqual(unselected(scene, doc), { feature: t.b2, body: "Body 2", volume: 2000 });
});

test("control: the Parameters still edit the part with nothing selected", async () => {
  const t = twoBoxes();
  const { doc, scene } = await drawn(insertCombine(t.doc, `body:${t.b1}`, [`body:${t.b2}`], "join").doc);
  assert.equal(panelPart([], scene, doc)?.id, t.b2);
});
