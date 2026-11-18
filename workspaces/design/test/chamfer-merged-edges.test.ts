// Two held edges of one Chamfer that an edit before it made one edge: the
// edge is chamfered once, its new face named after the first of them (app bug
// hunt 2026-11-18, A-3: the kernel was handed the edge twice and the Chamfer
// failed "This edge is picked twice", though each edge was picked once).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertChamfer } from "../src/chamfer.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE, changedMove } from "../src/move.ts";
import { insertCombine } from "../src/combine.ts";
import { suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

const kernel = nodeKernel();
type P = [number, number, number];
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const body = build.bodies["body:feature-1"];
  const view = body === undefined ? undefined : await cache.view(body.handle);
  const faces = body?.named?.faces.flatMap((f) => f.names) ?? [];
  await cache.close();
  return { results: build.results, volume: view?.volume ?? NaN, faces };
}

/** The held names of the edges of `body` whose two ends pass `on`. */
async function edgesWhere(doc: DesignDocument, body: string, on: (p: P) => boolean): Promise<string[]> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const at = ids.indexOf(body);
  const view = list[at].view;
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a] as P) && on(view.vertex_points[b] as P) ? [e] : []));
  await cache.close();
  return edges.map((e) => heldEdgeNames(designNames(list), at)[e]!);
}

// Bar 30×10×10 from the origin; Box 2 2×4×4 moved to x 14, y −2, z 8 and cut
// from it: a notch 2×2×2 (x 14..16, y 0..2, z 8..10) in the middle of the top
// front edge (y 0, z 10), which is now two edges, x 0..14 and x 16..30.
async function notched() {
  let doc = partDocument("box", 30, 10, 10);
  const t = insertPreset(doc, "box", 2, 4, 4);
  const mv = insertMove(t.doc, [`body:${t.id}`], { ...NO_MOVE, x: 14, y: -2, z: 8 });
  const cut = insertCombine(mv.doc, "body:feature-1", [`body:${t.id}`], "cut");
  doc = cut.doc;
  const names = await edgesWhere(doc, "body:feature-1", (p) => eq(p[1], 0) && eq(p[2], 10));
  assert.equal(names.length, 2, "the notch splits the top front edge in two");
  const c = insertChamfer(doc, "body:feature-1", names, { equal: 1 });
  return { doc: c.doc, chamfer: c.id, cut: cut.id, move: mv.id };
}

test("both halves of a notched edge chamfered 1 mm: 2978 mm³; the notch suppressed or its tool moved off: the one edge chamfered once, 2985 mm³", async () => {
  const n = await notched();
  const a = await built(n.doc);
  assert.equal(a.results[n.chamfer].status, "built");
  // 3000 − the notch 2·2·2 = 2992; each half 14 long, a 1 mm equal chamfer takes 14 · 1·1/2 = 7: 2992 − 14 = 2978.
  assert.ok(Math.abs(a.volume - 2978) < 1e-6, `${a.volume}`);
  const chamferFace = (k: number) => `face:${encodeURIComponent(n.chamfer)}/chamfer:${k}`;
  assert.ok(a.faces.includes(chamferFace(1)) && a.faces.includes(chamferFace(2)), "a face for each edge");

  // No notch: the top front edge is whole again, 30 long: 3000 − 30 · 1/2 = 2985.
  const off = await built(suppressItem(n.doc, n.cut, true));
  assert.equal(off.results[n.chamfer].status, "built", JSON.stringify(off.results[n.chamfer]));
  assert.ok(Math.abs(off.volume - 2985) < 1e-6, `${off.volume}`);
  assert.ok(off.faces.includes(chamferFace(1)), "the one face is named after the first edge listed");
  assert.ok(!off.faces.includes(chamferFace(2)), "no face for the second, which is the same edge");

  // The tool moved to z 20 misses the bar: the cut takes nothing, the edge is whole: 2985 again.
  const away = await built(changedMove(n.doc, n.move, { ...NO_MOVE, x: 14, y: -2, z: 20 }));
  assert.equal(away.results[n.chamfer].status, "built", JSON.stringify(away.results[n.chamfer]));
  assert.ok(Math.abs(away.volume - 2985) < 1e-6, `${away.volume}`);
});
