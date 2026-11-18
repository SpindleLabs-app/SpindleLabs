// #500 (Combine check, 2026-11-11): Download STL while a Combine in the
// timeline is failed. A failed Combine uses up nothing, so its target and
// tool are still bodies of the design: the Bodies rows and the picture
// show them, and the download must hold them too. On the real kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, type Selected, type WorkspaceContext } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { DOWNLOAD_STL, registerDesignActions, shownBodyRefs, type DesignRun } from "../src/actions.ts";
import { failedIds } from "../src/browser.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

/** A binary STL's enclosed volume: the sum over its triangles of the signed tetrahedron each makes with the origin, a · (b × c) / 6. */
function stlVolume(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let six = 0;
  for (let t = 0; t < v.getUint32(80, true); t++) {
    const p = (k: number) => [0, 4, 8].map((o) => v.getFloat32(84 + 50 * t + 12 + 12 * k + o, true));
    const [a, b, c] = [p(0), p(1), p(2)];
    six += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return six / 6;
}

/** Design's Download STL of every body shown, as the workspace runs it: the failed set of a rebuild in the run's context. */
async function download(doc: DesignDocument, withFailed = true) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  const failed = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
  const saved: Uint8Array[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, (bytes) => void saved.push(bytes));
  const project = emptyProject();
  project.workspaces.design = doc;
  const ctx = { project, kernel, viewport: { setOverlay: () => {}, clearOverlay: () => {} }, ...(withFailed && { failed }) } as unknown as DesignRun;
  const targets: Selected[] = shownBodyRefs(doc, failed);
  return { failed, targets, saved, outcome: await r.get(DOWNLOAD_STL)!.run(targets, ctx as WorkspaceContext) };
}

/** Box 1 40 × 30 × 20 at the origin and Box 2 the same moved 200 along x: apart, 24,000 mm³ each. */
function apart() {
  let doc = partDocument("box", 40, 30, 20);
  const b1 = `body:${doc.timeline.features[0].id}`;
  const two = insertPreset(doc, "box", 40, 30, 20);
  const b2 = `body:${two.id}`;
  doc = insertMove(two.doc, [b2], { ...NO_MOVE, x: 200 }).doc;
  return { doc, b1, b2 };
}

test("a failed Combine uses up nothing: both of its bodies are in the STL", async () => {
  const { doc, b1, b2 } = apart();
  // Intersect of bodies 160 mm apart: nothing in common, so the Combine fails and both boxes stay.
  const c = insertCombine(doc, b1, [b2], "intersect", false);
  const d = await download(c.doc);
  assert.deepEqual([...d.failed], [c.id]);
  assert.deepEqual(d.targets.map((t) => t.id), [b1, b2]);
  // Both boxes are in the file, but the failed Combine is not (export hunt 2026-11-12 D): said, and so a warning.
  assert.match(d.outcome.message, /^Exported spindlelabs-2-bodies\.stl\. Combine 1 failed, so it is not in the STL: /);
  assert.equal(d.outcome.bad, true, d.outcome.message);
  assert.equal(d.saved.length, 1);
  // 40 · 30 · 20 = 24,000 each: 48,000 mm³ (single-precision corners at whole millimetres are exact).
  assert.equal(Math.round(stlVolume(d.saved[0])), 48000);
});

test("a tool a Combine that built used up is still refused, naming it", async () => {
  // Box 2 moved (20, 15, 10) overlaps Box 1 in 20 · 15 · 10 = 3,000: the Cut builds and uses Box 2 up.
  let doc = partDocument("box", 40, 30, 20);
  const b1 = `body:${doc.timeline.features[0].id}`;
  const two = insertPreset(doc, "box", 40, 30, 20);
  const b2 = `body:${two.id}`;
  doc = insertCombine(insertMove(two.doc, [b2], { ...NO_MOVE, x: 20, y: 15, z: 10 }).doc, b1, [b2], "cut", false).doc;
  const d = await download(doc);
  assert.deepEqual(d.targets.map((t) => t.id), [b1]);
  // 24,000 − 3,000 = 21,000.
  assert.equal(Math.round(stlVolume(d.saved[0])), 21000);
  const cache = new BodyCache(kernel);
  await cache.close();
  const r = new ActionRegistry();
  registerDesignActions(r, () => assert.fail("nothing to save"));
  const project = emptyProject();
  project.workspaces.design = doc;
  const ctx = { project, kernel, failed: d.failed, viewport: { setOverlay: () => {}, clearOverlay: () => {} } } as unknown as DesignRun;
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([{ kind: "body", id: b2 }], ctx as WorkspaceContext), { message: "Body 2 is not a body shown in the design, so there is nothing to download.", bad: true });
});
