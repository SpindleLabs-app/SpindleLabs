// A sketch point or a projection on a chamfered body names the Chamfer, the
// item that made the body as it is shown, as one on a Combine's result names
// the Combine (rebuild.ts chamferRun sets `by`; scene.ts madeBy). App hunt
// 2026-11-18, A-1 and A-2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertChamfer } from "../src/chamfer.ts";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { deleteItem, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { addSketch, drawCircle, pinNewPoints, planeOf } from "../src/sketch.ts";
import { sketchEdgeTargets } from "../src/face-edges.ts";
import { projectPick } from "../src/projection.ts";
import { deleteWords } from "../src/delete-ask.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

const kernel = nodeKernel();
type P = [number, number, number];
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The held name of the edge of `body` whose two ends pass `on`. */
async function edgeWhere(doc: DesignDocument, body: string, on: (p: P) => boolean): Promise<string> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const at = ids.indexOf(body);
  const view = list[at].view;
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a] as P) && on(view.vertex_points[b] as P) ? [e] : []));
  await cache.close();
  return heldEdgeNames(designNames(list), at)[edges[0]]!;
}

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  return { cache, build, scene };
}

// Box 1 10×10×10 from the origin; its top front edge (y = 0, z = 10) chamfered
// 2 mm equal. The chamfer's face runs from z = 8 on the front face to y = 2 on
// the top, so on the front plane XZ the new corner is (x 10, z 8): on Box 1 as
// it was, (10, 8) is in the middle of the right face's front edge, no corner.
const topFront = (p: P) => eq(p[1], 0) && eq(p[2], 10);

test("a sketch after a Chamfer pinned to the Chamfer's new corner (10, 8) depends on the Chamfer: delete asks, the drag before it is refused, suppress greys it", async () => {
  const d0 = partDocument("box", 10, 10, 10);
  const c = insertChamfer(d0, "body:feature-1", [await edgeWhere(d0, "body:feature-1", topFront)], { equal: 2 });
  const s = addSketch(c.doc, "XZ");
  const { cache, scene } = await sceneOf(s.doc);
  const targets = sketchEdgeTargets(s.doc, s.id, scene, planeOf("XZ"));
  await cache.close();
  const here = targets.filter((x) => Math.hypot(x.at[0] - 10, x.at[1] - 8) < 1e-9);
  assert.ok(here.length > 0, "the corner (10, 8) is offered to a sketch after the Chamfer");
  const drawn = drawCircle(s.doc, s.id, [10, 8], 1);
  const pinned = pinNewPoints(s.doc, drawn.doc, s.id, here);
  const f = pinned.timeline.features.find((x) => x.id === s.id)!;
  assert.deepEqual(f.dependsOn, [c.id], "the sketch depends on Chamfer 1, which made the corner");
  assert.ok(pinned.sketches.find((x) => x.id === s.id)!.pins!.every((p) => p.feature === c.id));
  assert.notEqual(deleteWords(pinned, deleteItem(pinned, c.id), c.id), null, "deleting Chamfer 1 asks first");
  const re = reorderItem(pinned, s.id, 1);
  assert.ok("refused" in re, "Sketch 1 can't go before Chamfer 1");
  const b = new BodyCache(kernel);
  const r = await rebuildTimeline(suppressItem(pinned, c.id, true), b, kernel);
  await b.close();
  assert.deepEqual(r.results[s.id], { status: "greyed", by: c.id }, "Chamfer 1 suppressed greys the sketch (Q3)");
});

test("a sketch made before a Chamfer is offered none of the Chamfer's edges or corners, and Project finds nothing on the chamfered body", async () => {
  const d0 = partDocument("box", 10, 10, 10);
  const s = addSketch(d0, "XZ");
  const c = insertChamfer(s.doc, "body:feature-1", [await edgeWhere(s.doc, "body:feature-1", topFront)], { equal: 2 });
  const { cache, scene } = await sceneOf(c.doc);
  const targets = sketchEdgeTargets(c.doc, s.id, scene, planeOf("XZ"));
  // The front face's edge against the chamfer face: y = 0, z = 8, x 0..10.
  const v = scene.bodies[0].view;
  const k = v.edge_vertices.findIndex(([p, q]) => [p, q].every((i) => eq(v.vertex_points[i][1], 0) && eq(v.vertex_points[i][2], 8)));
  assert.ok(k >= 0, "the chamfered body has the edge at z 8");
  const pick = projectPick(c.doc, s.id, scene, planeOf("XZ"), { edge: scene.edgeStart[0] + k });
  await cache.close();
  assert.equal(targets.filter((x) => x.name.includes("chamfer")).length, 0, "no target names the later Chamfer's face");
  assert.equal(targets.filter((x) => Math.hypot(x.at[0] - 10, x.at[1] - 8) < 1e-9).length, 0, "no snap at (10, 8)");
  assert.equal(pick.edges.length, 0, "the edge at z 8 is not projected into the sketch before the Chamfer");
});
