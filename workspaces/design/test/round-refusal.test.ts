// SL #677 item 1 (final Combine hunt, 2026-11-12): cutting a round hole is the first thing a beginner tries, and the
// refusal was written for the kernel ("face 3 of the tool is curved (part of a cylinder); booleans take flat faces
// only for now"). The item now says it in the app's own words, naming which side is round, decided from the bodies'
// own face types (never from the kernel's sentence). A refusal between flat-sided bodies keeps its own words.
// On the real kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, roundWords } from "../src/rebuild.ts";
import { addSketch, drawCircle } from "../src/sketch.ts";

const kernel = nodeKernel();

/** The message item `id` fails with ("" when it is built). */
async function said(doc: DesignDocument, id: string): Promise<string> {
  const cache = new BodyCache(kernel);
  try {
    const r = (await rebuildTimeline(doc, cache, kernel)).results[id];
    return r.status === "failed" ? r.message : "";
  } finally {
    await cache.close();
  }
}
/** Box 1 40 × 30 × 20 from the origin and a ready-made cylinder of radius 5 and height 30 moved to stand through it. */
function boxAndCylinder(): { doc: DesignDocument; box: string; cylinder: string } {
  const one = partDocument("box", 40, 30, 20);
  const made = insertPreset(one, "cylinder", 10, 10, 30);
  return { doc: insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 20, y: 15, z: -5 }).doc, box: `body:${one.timeline.features[0].id}`, cylinder: `body:${made.id}` };
}

test("the words: which side is round, what works for now, and that round shapes are coming", () => {
  assert.equal(roundWords("tool"), "a tool body has a round face. Cut, Join and Intersect work on flat-sided shapes for now; round shapes are coming.");
  assert.equal(roundWords("target"), "the body it changes has a round face. Cut, Join and Intersect work on flat-sided shapes for now; round shapes are coming.");
  assert.equal(roundWords("extrude"), "this extrude has a round side. Cut, Join and Intersect work on flat-sided shapes for now; round shapes are coming.");
});

test("a Combine with a cylinder as its tool, for each operation: refused in the app's words", async () => {
  const { doc, box, cylinder } = boxAndCylinder();
  for (const operation of ["cut", "join", "intersect"] as CombineOperation[]) {
    const c = insertCombine(doc, box, [cylinder], operation);
    assert.equal(await said(c.doc, c.id), `Combine 1 can't be made: ${roundWords("tool")}`, operation);
  }
});

test("a Combine that changes a cylinder, and one of two cylinders: the body it changes is named", async () => {
  const { doc, box, cylinder } = boxAndCylinder();
  const c = insertCombine(doc, cylinder, [box], "cut");
  assert.equal(await said(c.doc, c.id), `Combine 1 can't be made: ${roundWords("target")}`);
  const more = insertPreset(doc, "cylinder", 10, 10, 30);
  const both = insertCombine(more.doc, cylinder, [`body:${more.id}`], "join");
  assert.equal(await said(both.doc, both.id), `Combine 1 can't be made: ${roundWords("target")}`);
});

test("a circle on the ground extruded as a Cut into the box: this extrude is named", async () => {
  const box = partDocument("box", 40, 30, 20);
  const s = addSketch(box);
  const e = extrudeSketch(drawCircle(s.doc, s.id, [20, 15], 5).doc, s.id, 10, false, undefined, { operation: "cut", bodies: [`body:${box.timeline.features[0].id}`] });
  assert.equal(await said(e.doc, e.id), `Extrude 1 can't be made: ${roundWords("extrude")}`);
});

test("a refusal between flat-sided boxes keeps its own words, with nothing about round faces", async () => {
  // Two 10 mm cubes meeting only along the edge x = 10, z = 10: the Join is refused for that, and neither is round.
  const one = partDocument("box", 10, 10, 10);
  const made = insertPreset(one, "box", 10, 10, 10);
  const moved = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 10, z: 10 }).doc;
  const c = insertCombine(moved, `body:${one.timeline.features[0].id}`, [`body:${made.id}`], "join");
  const words = await said(c.doc, c.id);
  assert.match(words, /^Combine 1 can't be made: /);
  assert.doesNotMatch(words, /round/);
});
