// SL #677 item 2: each extra Extrude Cut made every rebuild about 0.4 s
// slower, even with nothing changed. The kernel keeps a display mesh only for
// the bodies on screen (`BodyCache.showOnly`), and naming a Cut's result
// needs the meshes of its inputs and of its answer, so every rebuild meshed
// each earlier Cut's hidden inputs and answers again: the work grew with the
// number of pockets. These count the kernel's meshing (`body_view`) on a
// rebuild, and check the answer is exactly what a fresh cache says.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, setExtrudeDistance } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";

const real = nodeKernel();

/** The kernel, counting the calls of each op. */
function counting(): { kernel: KernelCalls; asked: Map<string, number> } {
  const asked = new Map<string, number>();
  const kernel: KernelCalls = {
    call: ((op: string, ...args: unknown[]) => {
      asked.set(op, (asked.get(op) ?? 0) + 1);
      return (real.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args);
    }) as KernelCalls["call"],
  };
  return { kernel, asked };
}

/**
 * A plate 8k × 10 × 10 mm (x 0..8k, y 0..10, z −10..0) with k square pockets cut down into it from its top: pocket i a
 * 4 × 4 rectangle at x 8i+2..8i+6, y 3..7 sketched on XY (the plate's top) and extruded 5 mm down as a Cut of the plate.
 */
function plate(k: number): { doc: DesignDocument; pockets: string[] } {
  let doc = partDocument("box", 8 * k, 10, 10);
  const body = `body:${doc.timeline.features[0].id}`;
  doc = insertMove(doc, [body], { ...NO_MOVE, z: -10 }).doc;
  const pockets: string[] = [];
  for (let i = 0; i < k; i++) {
    const s = addSketch(doc);
    const drawn = drawRectangle(s.doc, s.id, [8 * i + 2, 3], [8 * i + 6, 7]).doc;
    let id: string;
    ({ doc, id } = extrudeSketch(drawn, s.id, 5, true, undefined, { operation: "cut", bodies: [body] }));
    pockets.push(id);
  }
  return { doc, pockets };
}

/** A build without its handles (two caches hand out different ones), for comparing what it says. */
const said = (b: TimelineBuild) => JSON.parse(JSON.stringify(b, (k, v) => (k === "handle" || k === "holds" ? undefined : v instanceof Map ? [...v] : v)));

/** Built once, then only the final bodies left on screen (as the app's rebuild leaves them), then the kernel calls of `rebuild`. */
async function callsOf(doc: DesignDocument, edit: (doc: DesignDocument) => DesignDocument): Promise<{ asked: Map<string, number>; build: TimelineBuild; doc: DesignDocument }> {
  const { kernel, asked } = counting();
  const cache = new BodyCache(kernel);
  const first = await rebuildTimeline(doc, cache, kernel);
  for (const [id, r] of Object.entries(first.results)) assert.equal(r.status, "built", `${id}: ${JSON.stringify(r)}`);
  await cache.showOnly(Object.values(first.bodies).map((b) => b.handle));
  const next = edit(doc);
  asked.clear();
  const build = await rebuildTimeline(next, cache, kernel);
  await cache.close();
  return { asked, build, doc: next };
}

test("hand-worked: an unchanged rebuild of a plate with 1 or 6 pockets meshes no body, and says what a fresh cache says", async () => {
  for (const k of [1, 6]) {
    const { doc, pockets } = plate(k);
    const { asked, build } = await callsOf(doc, (d) => d);
    // Worked by hand: nothing changed, so every body and every Cut's answer is the cache's, and the one body on screen
    // (the plate with its k pockets) still has its mesh: nothing needs meshing. Before: each Cut meshed its two
    // hidden inputs (plate so far, pocket prism) and its hidden answer, 3k body_view, 18 for six pockets.
    assert.equal(asked.get("body_view") ?? 0, 0, `${k} pockets: ${JSON.stringify([...asked])}`);
    assert.equal(asked.get("body_boolean") ?? 0, 0);
    for (const p of pockets) assert.equal(build.results[p].status, "built");
    const fresh = new BodyCache(real);
    const anew = await rebuildTimeline(doc, fresh, real);
    assert.deepEqual(said(build), said(anew));
    // Volume by hand: 8k × 10 × 10 less k pockets of 4 × 4 × 5 = 80 each: 800k − 80k = 720k mm³.
    const ids = Object.keys(anew.bodies);
    assert.equal(ids.length, 1, "one body, the plate");
    const v = (await fresh.view(anew.bodies[ids[0]].handle)).volume;
    assert.ok(Math.abs(v - 720 * k) < 1e-6 * 720 * k, `${v} mm³, expected ${720 * k}`);
    await fresh.close();
  }
});

test("editing the last pocket of six meshes only what that Cut changed, the same as for one pocket, and says what a fresh cache says", async () => {
  const counts: number[] = [];
  for (const k of [1, 6]) {
    const { doc, pockets } = plate(k);
    const last = pockets[k - 1];
    const { asked, build, doc: edited } = await callsOf(doc, (d) => setExtrudeDistance(d, 4, last));
    for (const p of pockets) assert.equal(build.results[p].status, "built");
    counts.push(asked.get("body_view") ?? 0);
    assert.equal(asked.get("body_boolean"), 1, "only the last Cut's boolean is asked again");
    const fresh = new BodyCache(real);
    assert.deepEqual(said(build), said(await rebuildTimeline(edited, fresh, real)));
    await fresh.close();
  }
  // The earlier five Cuts are unchanged, so the last one's work is all: as many meshes for six pockets as for one.
  assert.equal(counts[1], counts[0], `body_view for 1 and 6 pockets: ${counts.join(", ")}`);
});
