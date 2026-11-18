// Step 44a-app2's browser check found it: a design whose only body a Chamfer
// changed had no STL (Download STL, 3MF and OBJ, and Slice for printing all
// waited for ever). The chamfered body has no spec (only the kernel holds
// it), so its file must be asked of the kernel by body, as a Combine's is.
// Worked by hand: the 10 mm cube's top front edge at 2 mm takes
// 10 · 2 · 2 / 2 = 20 mm³, so the STL holds 980 mm³ inside x, y, z 0..10.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertChamfer } from "../src/chamfer.ts";
import { partDocument } from "../src/document.ts";
import { endStls } from "../src/move-tool.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { heldNamesOf } from "../src/chamfer-tool.ts";

const kernel = nodeKernel();

/** An STL's enclosed volume (the signed tetrahedra to the origin summed) and its bounds. */
function stlFacts(bytes: Uint8Array): { volume: number; low: number[]; high: number[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(80, true);
  let volume = 0;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((i) => v.getFloat32(84 + 50 * t + 12 + 12 * k + 4 * i, true)));
    const [a, b, c] = p;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const q of p) for (let i = 0; i < 3; i++) (low[i] = Math.min(low[i], q[i])), (high[i] = Math.max(high[i], q[i]));
  }
  return { volume, low, high };
}

test("regression: a chamfered body's STL is the kernel's chamfered body, 980 mm³", async () => {
  const doc = partDocument("box", 10, 10, 10);
  const cache = new BodyCache(kernel);
  let held: string | null;
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const view = await cache.view(build.bodies["body:feature-1"].handle);
    const edge = view.edge_vertices.findIndex(([a, b]) => [a, b].every((k) => Math.abs(view.vertex_points[k][1]) < 1e-9 && Math.abs(view.vertex_points[k][2] - 10) < 1e-9));
    [held] = await heldNamesOf(build.bodies, (b) => cache.view(b.handle), [{ body: "body:feature-1", edge }]);
  } finally {
    await cache.clear();
  }
  const { doc: chamfered } = insertChamfer(doc, "body:feature-1", [held!], { equal: 2 });
  const feature = chamfered.timeline.features[0];
  const [file] = await Promise.race([
    endStls(kernel, chamfered, [{ body: "body:feature-1", feature, name: "body" }]),
    new Promise<never>((_, no) => setTimeout(() => no(new Error("no STL within 20 s")), 20_000)),
  ]);
  const got = stlFacts(file.bytes);
  assert.ok(Math.abs(got.volume - 980) < 1e-3, `volume ${got.volume}`);
  assert.deepEqual(got.low.map((x) => Math.round(x * 1e4) / 1e4), [0, 0, 0]);
  assert.deepEqual(got.high.map((x) => Math.round(x * 1e4) / 1e4), [10, 10, 10]);
});
