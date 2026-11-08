// Step 35f1f2b: pins and projections on a Combine's result's edges. Its edges
// are named across the design by rule 5 (two faces' full names), held by a pin
// or projection escaped after "design:" with the Combine as its item
// (design-edges.ts); the rebuild finds them again by rule 5 over the bodies
// built before the sketch. Every place below is worked out by hand from the
// cubes' corners, on the real rebuild and kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { XY_PLANE } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { DESIGN_EDGE, edgeNow, heldEdgeName, isHeldDesignName, pinNameNow, ruleFiveName } from "../src/design-edges.ts";
import { readDesignDocument, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { sketchEdgeTargets } from "../src/face-edges.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { projectPick } from "../src/projection.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { addSketch, drawCircle, pinNewPoints, projectEdges } from "../src/sketch.ts";
import type { DesignNames } from "../src/boolean-names.ts";

const kernel = nodeKernel();

// Cube A x/y/z 0..10 (feature-1); cube B the same (feature-2) moved (5, 5, 5) (feature-3); B joined to A (feature-4).
// The result keeps A's id, body:feature-1; B's top is the whole square x/y 5..15 at z 15 (A ends at z 10).
function joined(): DesignDocument {
  let doc = partDocument("box", 10, 10, 10);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 5, y: 5, z: 5 }).doc;
  return insertCombine(doc, "body:feature-1", ["body:feature-2"], "join").doc;
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; scene: Scene }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  return { build, cache, scene };
}

/** B's Move (feature-3) changed to (d, d, d). */
const bAt = (doc: DesignDocument, d: number) => changedMove(doc, "feature-3", { ...NO_MOVE, x: d, y: d, z: d });

const pinnedOf = (b: TimelineBuild, id: string) => {
  const r = b.results[id];
  assert.equal(r.status, "built", JSON.stringify(r));
  return r as Extract<typeof r, { status: "built" }>;
};

test("design-edges: a rule 5 name held and read back; text that isn't one is not", () => {
  const name = "edge:face:feature-2/back+face:feature-2/right";
  const held = heldEdgeName(name);
  // encodeURIComponent: ":" %3A, "/" %2F, "+" %2B; no "/" or "&" left for the file checks.
  assert.equal(held, "design:face%3Afeature-2%2Fback%2Bface%3Afeature-2%2Fright");
  assert.ok(!held.slice(DESIGN_EDGE.length).includes("/") && !held.includes("&"));
  assert.equal(ruleFiveName(held), name);
  assert.equal(ruleFiveName("design:%E0"), null); // a broken escape
  assert.equal(ruleFiveName("design:"), null);
  assert.equal(ruleFiveName("back+right"), null);
  assert.throws(() => heldEdgeName("face:feature-1/top"), /not a rule 5 edge name/);
  assert.ok(isHeldDesignName(`back+right&${held}`));
  assert.ok(!isHeldDesignName("back+right&back+top&right+top"));
});

test("design-edges: found on one edge, two alike are never guessed between, and a vertex's edges must meet on one body", () => {
  const e = (a: string, b: string, name: string | null, ends: string[] = []) => ({ faces: [a, b] as [string, string], ends, name });
  const names: DesignNames = {
    full: [],
    edges: [
      [e("face:f/a", "face:f/b", "edge:face:f/a+face:f/b"), e("face:f/a", "face:f/c", null, ["x"])],
      [e("face:f/a", "face:f/c", null, ["x"]), e("face:g/a", "face:g/b", "edge:face:g/a+face:g/b")],
    ],
    tagFor: () => [],
  };
  assert.deepEqual(edgeNow(heldEdgeName("edge:face:f/a+face:f/b"), names), { body: 0, name: heldEdgeName("edge:face:f/a+face:f/b") });
  // Two edges with the same two faces and the same ends: ambiguous, never one of them.
  assert.deepEqual(edgeNow(heldEdgeName("edge:face:f/a+face:f/c;ends:x"), names), { cause: "point-ambiguous" });
  assert.deepEqual(edgeNow(heldEdgeName("edge:face:f/z+face:f/b"), names), { cause: "point-lost" });
  assert.deepEqual(edgeNow("design:%E0", names), { cause: "point-lost" });
  // A vertex whose two edges are now on two bodies meets nowhere: lost; an ambiguous part wins over a lost one.
  const two = [heldEdgeName("edge:face:f/a+face:f/b"), heldEdgeName("edge:face:g/a+face:g/b")].join("&");
  assert.deepEqual(pinNameNow(two, names), { cause: "point-lost" });
  assert.deepEqual(pinNameNow(`${heldEdgeName("edge:face:f/z+face:f/b")}&${heldEdgeName("edge:face:f/a+face:f/c;ends:x")}`, names), { cause: "point-ambiguous" });
});

test("hand-worked: a pin on a Combine's result's corner names the Combine, and follows the corner when B moves", async () => {
  const s = addSketch(joined());
  const { cache, scene } = await built(s.doc);
  const targets = sketchEdgeTargets(s.doc, s.id, scene, XY_PLANE);
  // B's top back right corner is B's origin + (10, 10, 10) = (15, 15, 15); seen from above, (15, 15).
  const corner = targets.find((t) => t.kind === "endpoint" && t.at[0] === 15 && t.at[1] === 15 && t.name.split("&").length === 3 && t.name.includes(encodeURIComponent("feature-2/top")));
  assert.ok(corner, JSON.stringify(targets.filter((t) => t.at[0] === 15 && t.at[1] === 15)));
  assert.equal(corner.feature, "feature-4");
  assert.ok(corner.name.split("&").every((p) => p.startsWith(DESIGN_EDGE)));
  await cache.close();
  let doc = pinNewPoints(s.doc, drawCircle(s.doc, s.id, corner.at, 2).doc, s.id, [corner]);
  const sketch = doc.sketches.find((x) => x.id === s.id)!;
  assert.deepEqual(sketch.pins?.map((p) => [p.feature, p.name]), [["feature-4", corner.name]]);
  assert.deepEqual(doc.timeline.features.find((f) => f.id === s.id)!.dependsOn, ["feature-4"]);
  // The file reads back as it was.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
  // B moved to (8, 8, 8): its far corner is (18, 18, 18), so the pinned centre goes to (18, 18).
  doc = bAt(doc, 8);
  const after = await built(doc);
  const r = pinnedOf(after.build, s.id);
  assert.equal(r.points, undefined, JSON.stringify(r.points));
  assert.deepEqual(r.pinned?.map((p) => p.at.map((v) => Math.round(v * 1e9) / 1e9)), [[18, 18]]);
  await after.cache.close();
});

test("hand-worked: projecting B's top on the Combine's result, and the square follows B", async () => {
  const s = addSketch(joined());
  const { cache, scene } = await built(s.doc);
  const d = scene.design!;
  const body = scene.bodies.findIndex((b) => b.body === "body:feature-1");
  const at = d.shown.indexOf(body);
  const top = d.names.full[at].indexOf("face:feature-2/top");
  assert.ok(top >= 0, JSON.stringify(d.names.full[at]));
  const pick = projectPick(s.doc, s.id, scene, XY_PLANE, { face: scene.faceStart[body] + top });
  await cache.close();
  assert.equal(pick.note, null);
  assert.equal(pick.edges.length, 4);
  assert.ok(pick.edges.every((e) => e.feature === "feature-4" && e.edge.startsWith(DESIGN_EDGE)));
  let doc = projectEdges(s.doc, s.id, pick.edges).doc;
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
  // B moved to (2, 2, 2): its top is x/y 2..12 at z 12 (still above A's top at 10, so still whole): the square's corners.
  doc = bAt(doc, 2);
  const after = await built(doc);
  const r = pinnedOf(after.build, s.id);
  assert.equal(r.projections, undefined, JSON.stringify(r.projections));
  const xs = new Set(r.projected!.flatMap((q) => q.points.map((p) => Math.round(p.at[0] * 1e9) / 1e9)));
  const ys = new Set(r.projected!.flatMap((q) => q.points.map((p) => Math.round(p.at[1] * 1e9) / 1e9)));
  assert.deepEqual([...xs].sort((a, b) => a - b), [2, 12]);
  assert.deepEqual([...ys].sort((a, b) => a - b), [2, 12]);
  await after.cache.close();
});

test("a corner gone after an edit holds the point with a warning, never moved to another", async () => {
  const s = addSketch(joined());
  const { cache, scene } = await built(s.doc);
  const corner = sketchEdgeTargets(s.doc, s.id, scene, XY_PLANE).find((t) => t.kind === "endpoint" && t.at[0] === 15 && t.at[1] === 15 && t.name.includes(encodeURIComponent("feature-2/top")))!;
  await cache.close();
  // B moved to (−5, −5, −5): its top back right corner is (5, 5, 5), inside A (0..10 every way), so the Join leaves no
  // corner where B's back, right and top meet; the pinned centre stays where it was, with a warning.
  const doc = bAt(pinNewPoints(s.doc, drawCircle(s.doc, s.id, corner.at, 2).doc, s.id, [corner]), -5);
  const after = await built(doc);
  const r = pinnedOf(after.build, s.id);
  assert.deepEqual(r.pinned, []);
  assert.equal(r.points?.cause, "point-lost");
  assert.equal(r.points?.points, 1);
  await after.cache.close();
});

test("a Combine after the sketch offers no point or edge of its result to it (the sketch is built before it)", async () => {
  let doc = partDocument("box", 10, 10, 10);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 5, y: 5, z: 5 }).doc;
  const s = addSketch(doc);
  doc = insertCombine(s.doc, "body:feature-1", ["body:feature-2"], "join").doc;
  const { cache, scene } = await built(doc);
  assert.deepEqual(sketchEdgeTargets(doc, s.id, scene, XY_PLANE), []);
  const body = scene.bodies.findIndex((b) => b.body === "body:feature-1");
  const pick = projectPick(doc, s.id, scene, XY_PLANE, { face: scene.faceStart[body] });
  assert.equal(pick.edges.length, 0);
  assert.match(pick.note ?? "", /after/);
  await cache.close();
});

test("the file checks: a Combine result's name only on a Combine, and a Combine only with one", async () => {
  const s = addSketch(joined());
  const { cache, scene } = await built(s.doc);
  const corner = sketchEdgeTargets(s.doc, s.id, scene, XY_PLANE).find((t) => t.kind === "endpoint" && t.feature === "feature-4")!;
  await cache.close();
  const doc = pinNewPoints(s.doc, drawCircle(s.doc, s.id, corner.at, 2).doc, s.id, [corner]);
  const edit = (f: (pin: Record<string, unknown>, item: Record<string, unknown>) => void) => {
    const data = JSON.parse(JSON.stringify(doc));
    f(data.sketches.find((x: { id: string }) => x.id === s.id).pins[0], data.timeline.features.find((x: { id: string }) => x.id === s.id));
    return data;
  };
  assert.doesNotThrow(() => readDesignDocument(edit(() => {})));
  // The held name on box A (feature-1), not a Combine: refused.
  assert.throws(() => readDesignDocument(edit((p, i) => ((p.feature = "feature-1"), (i.dependsOn = ["feature-1"])))), /has a Combine result's name but is on feature-1, which is not a Combine or a Duplicate/);
  // A box's own name on the Combine: refused, as a Combine has no faces of its own to name it by.
  assert.throws(() => readDesignDocument(edit((p) => (p.name = "back+right&back+top&right+top"))), /is on feature-4, which is not a solid item before it/);
});

test("version 15: version 14 data holding a Combine result's pin or projection is refused, other version 14 data opens as 15", async () => {
  const s = addSketch(joined());
  const { cache, scene } = await built(s.doc);
  const corner = sketchEdgeTargets(s.doc, s.id, scene, XY_PLANE).find((t) => t.kind === "endpoint" && t.feature === "feature-4")!;
  const body = scene.bodies.findIndex((b) => b.body === "body:feature-1");
  const pick = projectPick(s.doc, s.id, scene, XY_PLANE, { face: scene.faceStart[body] });
  await cache.close();
  const pinned = JSON.parse(JSON.stringify(pinNewPoints(s.doc, drawCircle(s.doc, s.id, corner.at, 2).doc, s.id, [corner])));
  const projected = JSON.parse(JSON.stringify(projectEdges(s.doc, s.id, pick.edges.slice(0, 1)).doc));
  assert.equal(pinned.version, 15);
  const words = "Design data says version 14 but has a point or edge taken from a Combine's result, which version 15 brought";
  assert.throws(() => readDesignDocument({ ...pinned, version: 14 }), { message: words });
  assert.throws(() => readDesignDocument({ ...projected, version: 14 }), { message: words });
  assert.equal(readDesignDocument({ ...JSON.parse(JSON.stringify(s.doc)), version: 14 }).version, 15);
});
