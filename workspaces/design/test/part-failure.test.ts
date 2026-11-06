// Whether the part (the last item that makes a body) failed, as the
// properties' red line and the folded panel's ⚠ say (Ben 2026-11-05: "Box 5
// is built" in red, a ⚠ on the folded Properties button, and nothing wrong
// with the design). The part's body had gone into a Combine after it, which
// is no failure: only a failed build, or a built part whose body nothing
// used, is one.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, partFeature, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { partFailure } from "../src/part-failure.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";

const kernel = nodeKernel();

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache }> {
  const cache = new BodyCache(kernel);
  return { build: await rebuildTimeline(doc, cache, kernel), cache };
}

const failureOf = (doc: DesignDocument, build: TimelineBuild) => partFailure(doc.timeline.features, partFeature(doc), build);

/** A 40 × 30 × 20 block at the origin and a 10 mm cube moved to (5, 5, 15), then cut from the block (`keepTools` as given). */
function blockAndCube(keepTools: boolean, operation: "cut" | "join" = "cut", cubeIsTarget = false) {
  const block = partDocument("box", 40, 30, 20);
  const blockBody = `body:${block.timeline.features[0].id}`;
  const { doc: two, id: cube } = insertPreset(block, "box", 10, 10, 10);
  const cubeBody = `body:${cube}`;
  const moved = insertMove(two, [cubeBody], { ...NO_MOVE, x: 5, y: 5, z: 15 }).doc;
  const [target, tool] = cubeIsTarget ? [cubeBody, blockBody] : [blockBody, cubeBody];
  return { doc: insertCombine(moved, target, [tool], operation, keepTools).doc, blockBody, cubeBody, cube };
}

test("Ben's design (2026-11-05): Box 5 cut from Body 7 by Combine 6 is no failure", async () => {
  const project = JSON.parse(readFileSync(new URL("./regressions/combined-part.spindle", import.meta.url), "utf8"));
  const doc = readDesignDocument(project.workspaces.design);
  const { build, cache } = await built(doc);
  try {
    // Every item built: the design has nothing wrong with it.
    for (const [id, r] of Object.entries(build.results)) assert.equal(r.status, "built", `${id} built`);
    // The part is Box 5 (the last item that makes a body: Moves and Combines act on bodies, they make none)...
    assert.equal(partFeature(doc)?.provenance.self.label, "Box 5");
    // ...and its body is gone: Combine 6 used it up as its tool. That is what the old check called "Box 5 is built".
    assert.equal("body:feature-54" in build.bodies, false);
    assert.equal(failureOf(doc, build), undefined);
  } finally {
    cache.clear?.();
  }
});

test("hand-worked: a cube cut from a block leaves one body of 23,500 mm³, and the cube (the part) did not fail", async () => {
  const { doc, blockBody, cubeBody } = blockAndCube(false);
  const { build, cache } = await built(doc);
  // The block: 40 × 30 × 20 = 24,000 mm³. The cube spans x 5..15, y 5..15, z 15..25; inside the block (z up to 20) is
  // 10 × 10 × 5 = 500 mm³, so the cut leaves 24,000 − 500 = 23,500 mm³, and only the block's body.
  assert.deepEqual(Object.keys(build.bodies), [blockBody]);
  const volume = (await cache.view(build.bodies[blockBody].handle)).volume;
  assert.ok(Math.abs(volume - 23500) <= 1e-6, `${volume}`);
  assert.equal(cubeBody in build.bodies, false, "the cube went into the Combine");
  assert.equal(failureOf(doc, build), undefined);
});

test("a cube kept by the Combine (keep tools) is still there, and no failure either", async () => {
  const { doc, cubeBody } = blockAndCube(true);
  const { build } = await built(doc);
  assert.equal(cubeBody in build.bodies, true);
  assert.equal(failureOf(doc, build), undefined);
});

test("the cube as the Combine's target, the block joined into it: no failure", async () => {
  const { doc } = blockAndCube(false, "join", true);
  const { build } = await built(doc);
  assert.equal(failureOf(doc, build), undefined);
});

test("a part that failed says why, word for word", async () => {
  const { doc, cube } = blockAndCube(false);
  const { build } = await built(doc);
  const broken: TimelineBuild = { ...build, results: { ...build.results, [cube]: { status: "failed", cause: "error", message: "Box 2 can't be made: the kernel said no" } } };
  assert.equal(failureOf(doc, broken), "Box 2 can't be made: the kernel said no");
});

test("can fail: a built part whose body is missing with no Combine using it is still a failure", async () => {
  // Box 2 alone (no Combine), its body taken out of the build by hand: nothing explains where it went.
  const block = partDocument("box", 40, 30, 20);
  const { doc, id } = insertPreset(block, "box", 10, 10, 10);
  const { build } = await built(doc);
  const bodies = { ...build.bodies };
  delete bodies[`body:${id}`];
  assert.equal(failureOf(doc, { ...build, bodies }), "Box 2 built no body");
});

test("can fail: a Combine that failed used nothing up, so a missing body is still a failure", async () => {
  const { doc, cube, cubeBody } = blockAndCube(false);
  const { build } = await built(doc);
  const combine = doc.timeline.features.at(-1)!.id;
  const bodies = { ...build.bodies };
  delete bodies[cubeBody];
  const results = { ...build.results, [combine]: { status: "failed" as const, cause: "error" as const, message: "Combine 1 can't be made" } };
  assert.equal(failureOf(doc, { ...build, bodies, results }), "Box 2 built no body", `the part is ${cube}`);
});

test("the part's body taken in as a built Combine's target is used up; as a kept tool it is not", async () => {
  // Bodies taken out of each build by hand, so only the Combine's own record says where they went.
  const asTarget = blockAndCube(false, "join", true);
  const t = (await built(asTarget.doc)).build;
  const noCube = { ...t.bodies };
  delete noCube[asTarget.cubeBody];
  assert.equal(failureOf(asTarget.doc, { ...t, bodies: noCube }), undefined, "the target went into the Combine");
  const kept = blockAndCube(true);
  const k = (await built(kept.doc)).build;
  const gone = { ...k.bodies };
  delete gone[kept.cubeBody];
  assert.equal(failureOf(kept.doc, { ...k, bodies: gone }), "Box 2 built no body", "a kept tool should still be there");
});
