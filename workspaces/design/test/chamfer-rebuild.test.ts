// Step 44a, the app's half: the Chamfer item built by the real rebuild on the
// real kernel (rebuild.ts `chamferRun`), its data (document.ts
// `checkChamfer`, Design data version 24) and `insertChamfer` (chamfer.ts).
// Every volume is worked out by hand from the box's corners beside it: a
// chamfer of d1 × d2 along an edge L long between two square faces takes away
// a right triangle's prism, L · d1 · d2 / 2.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { CHAMFER_STEP, chamferSummary, insertChamfer } from "../src/chamfer.ts";
import { CHAMFER_MAX, changePreset, chamferOf, DESIGN_VERSION, insertPreset, partDocument, readDesignDocument, type ChamferSizing, type DesignDocument } from "../src/document.ts";
import { insertCombine } from "../src/combine.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem, suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

const kernel = nodeKernel();

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; view: (body: string) => Promise<BodyView> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, view: (body) => cache.view(build.bodies[body].handle) };
}

const near = (got: number, want: number, what = "") => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what} ${got}, expected ${want}`);

/**
 * The held name (as the screen gives it, design-edges.ts) of the straight edge of `body` whose two ends both
 * satisfy `on`, in `doc` as built: every body named across the design, as the rebuild names them.
 */
async function edgeWhere(doc: DesignDocument, body: string, on: (p: [number, number, number]) => boolean): Promise<string> {
  const { build, cache } = await built(doc);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const names = designNames(list);
  const at = ids.indexOf(body);
  const view = list[at].view;
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a]) && on(view.vertex_points[b]) ? [e] : []));
  assert.equal(edges.length, 1, "one edge there");
  const held = heldEdgeNames(names, at)[edges[0]];
  await cache.clear();
  assert.ok(held !== null, "the edge has a name");
  return held!;
}

/** The 10 mm cube (x, y, z 0..10) and its body. */
const cube = () => ({ doc: partDocument("box", 10, 10, 10), body: "body:feature-1" });
/** The cube's top front edge: y = 0, z = 10, x 0..10. */
const topFront = (p: [number, number, number]) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;
/** The cube's top back edge: y = 10, z = 10. */
const topBack = (p: [number, number, number]) => Math.abs(p[1] - 10) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;

test("hand-worked: a 2 mm chamfer on the 10 mm cube's top front edge takes 10 · 2 · 2 / 2 = 20 mm³, the body keeping its id and its faces' names", async () => {
  const start = await kernel.call("body_count");
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  const { doc, id } = insertChamfer(d0, body, [edge], { equal: 2 });
  const { build, cache, view } = await built(doc);
  assert.equal(build.results[id].status, "built");
  // 1,000 − 20 = 980 mm³.
  const v = await view(body);
  near(v.volume, 980, "volume");
  // Six faces, one trimmed by each end of the cut... the cube's six and the chamfer's: 7.
  assert.equal(v.faces, 7);
  const named = build.bodies[body].named!;
  assert.equal(named.faces.length, 7);
  // The new face is the Chamfer's, "chamfer:1"; every face of the cube keeps its own name.
  const all = named.faces.flatMap((f) => f.names);
  assert.ok(all.includes(`face:${id}/chamfer:1`));
  for (const role of ["top", "bottom", "front", "back", "left", "right"]) assert.ok(all.some((n) => n.startsWith(`face:feature-1/${role}`)), role);
  // Its new face's corners: (x, 2, 10) and (x, 0, 8) for x 0 and 10, the cut 2 mm back along the top and down the front.
  const fresh = named.faces.findIndex((f) => f.names.includes(`face:${id}/chamfer:1`));
  const corners = v.vertex_points.filter((_, k) => v.edge_vertices.some(([a, b], e) => (a === k || b === k) && v.edge_faces[e]?.includes(fresh)));
  const key = (p: number[]) => p.map((x) => Math.round(x * 1e6) / 1e6).join(",");
  assert.deepEqual(corners.map(key).sort(), ["0,0,8", "0,2,10", "10,0,8", "10,2,10"]);
  await cache.clear();
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("hand-worked: two distances, 2 along one face and 3 along the other, take 10 · 2 · 3 / 2 = 30 mm³; Flip swaps which face gets which", async () => {
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  const cornersOf = async (flip: boolean) => {
    const { doc, id } = insertChamfer(d0, body, [edge], { two: [2, 3] }, flip);
    const { build, cache, view } = await built(doc);
    const v = await view(body);
    near(v.volume, 970, `volume, flip ${flip}`);
    const fresh = build.bodies[body].named!.faces.findIndex((f) => f.names.includes(`face:${id}/chamfer:1`));
    const ys = new Set<number>();
    const zs = new Set<number>();
    v.edge_vertices.forEach(([a, b], e) => {
      if (!v.edge_faces[e]?.includes(fresh)) return;
      for (const p of [v.vertex_points[a], v.vertex_points[b]]) {
        ys.add(Math.round(p[1] * 1e6) / 1e6);
        zs.add(Math.round(p[2] * 1e6) / 1e6);
      }
    });
    await cache.clear();
    // Back along the top to y = a, down the front to z = 10 − b.
    return { a: Math.max(...ys), b: 10 - Math.min(...zs) };
  };
  const one = await cornersOf(false);
  const other = await cornersOf(true);
  assert.deepEqual([one.a, one.b].sort(), [2, 3]);
  assert.deepEqual([other.a, other.b], [one.b, one.a], "Flip swaps the two distances' faces");
});

test("hand-worked: the chamfer follows its edge when the box is made 20 wide before it: 20 · 2 · 2 / 2 = 40 mm³ off 2,000", async () => {
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  const { doc, id } = insertChamfer(d0, body, [edge], { equal: 2 });
  const wider = changePreset(doc, "feature-1", "box", 20, 10, 10);
  const { build, cache, view } = await built(wider);
  assert.equal(build.results[id].status, "built");
  near((await view(body)).volume, 2000 - 40);
  await cache.clear();
});

test("hand-worked: two edges at 1 mm, the top front and top back, take 2 · 10 · 1 · 1 / 2 = 10 mm³, named chamfer:1 and chamfer:2 in the order given", async () => {
  const { doc: d0, body } = cube();
  const front = await edgeWhere(d0, body, topFront);
  const back = await edgeWhere(d0, body, topBack);
  const { doc, id } = insertChamfer(d0, body, [back, front], { equal: 1 });
  const { build, cache, view } = await built(doc);
  const v = await view(body);
  near(v.volume, 990);
  const named = build.bodies[body].named!;
  const centreY = (name: string) => {
    const k = named.faces.findIndex((f) => f.names.includes(name));
    const ys = v.edge_vertices.flatMap(([a, b], e) => (v.edge_faces[e]?.includes(k) ? [v.vertex_points[a][1], v.vertex_points[b][1]] : []));
    return ys.reduce((s, y) => s + y, 0) / ys.length;
  };
  // The first edge given was the back one (y 9..10), the second the front (y 0..1).
  near(centreY(`face:${id}/chamfer:1`), 9.5, "chamfer:1 at the back");
  near(centreY(`face:${id}/chamfer:2`), 0.5, "chamfer:2 at the front");
  await cache.clear();
});

test("hand-worked: a chamfer on a Combine's result, the cube with a 2 mm cube cut from its top's middle: 1,000 − 8 − 20 = 972 mm³; then moved, it keeps it", async () => {
  // The notch's tool: 2 × 2 × 4 at (4, 4, 8), so x, y 4..6, z 8..12: the pocket is 2 × 2 × 2 = 8 mm³, clear of the edge.
  let doc = partDocument("box", 10, 10, 10);
  const made = insertPreset(doc, "box", 2, 2, 4);
  doc = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 4, y: 4, z: 8 }).doc;
  doc = insertCombine(doc, "body:feature-1", [`body:${made.id}`], "cut").doc;
  const edge = await edgeWhere(doc, "body:feature-1", topFront);
  const chamfered = insertChamfer(doc, "body:feature-1", [edge], { equal: 2 });
  const { build, cache, view } = await built(chamfered.doc);
  assert.equal(build.results[chamfered.id].status, "built");
  near((await view("body:feature-1")).volume, 972);
  await cache.clear();
  // A Move after it moves the chamfered body (no spec: the kernel's body_move), volume kept.
  const moved = insertMove(chamfered.doc, ["body:feature-1"], { ...NO_MOVE, x: 50 }).doc;
  const after = await built(moved);
  const v = await after.view("body:feature-1");
  near(v.volume, 972);
  assert.ok(v.vertex_points.every((p) => p[0] >= 50 - 1e-9), "moved 50 along x");
  await after.cache.clear();
});

test("refusals: an edge no longer found, a size the kernel refuses (no body changed), its body deleted or suppressed", async () => {
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  // Top and bottom never meet: a name no edge has.
  const nowhere = "design:" + encodeURIComponent("face:feature-1/top+face:feature-1/bottom");
  const lost = insertChamfer(d0, body, [nowhere], { equal: 1 });
  const a = await built(lost.doc);
  assert.deepEqual(a.build.results[lost.id], { status: "failed", cause: "error", message: "Chamfer 1 can't find its edge on Box 1 any more: an edit before it changed or removed that edge" });
  near((await a.view(body)).volume, 1000, "the cube as it was");
  await a.cache.clear();
  // 20 mm on a 10 mm cube is too big: the kernel's own words, the cube as it was.
  const big = insertChamfer(d0, body, [edge], { equal: 20 });
  const b = await built(big.doc);
  const r = b.build.results[big.id];
  assert.equal(r.status, "failed");
  assert.equal(r.status === "failed" && r.cause, "error");
  assert.ok(r.status === "failed" && r.message.length > 0 && !/\d+ *\(|edge \d|index/.test(r.message), `plain words: ${r.status === "failed" && r.message}`);
  near((await b.view(body)).volume, 1000, "the cube as it was");
  await b.cache.clear();
  const { doc, id } = insertChamfer(d0, body, [edge], { equal: 1 });
  const gone = await built(deleteItem(doc, "feature-1"));
  assert.deepEqual(gone.build.results[id], { status: "failed", cause: "deleted-input", input: "feature-1", message: "Box 1 was deleted, so Chamfer 1 has nothing to chamfer" });
  await gone.cache.clear();
  const off = await built(suppressItem(doc, "feature-1", true));
  assert.deepEqual(off.build.results[id], { status: "greyed", by: "feature-1" });
  await off.cache.clear();
});

test("the data: a Chamfer saves and reads back as the current version (24 brought it), and insertChamfer's words", async () => {
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  for (const size of [{ equal: 2 }, { two: [2, 3] }, { angle: [2, 30] }] as ChamferSizing[]) {
    const { doc, id } = insertChamfer(d0, body, [edge], size, true);
    const read = readDesignDocument(JSON.parse(JSON.stringify(doc)));
    assert.equal(read.version, DESIGN_VERSION);
    assert.equal(DESIGN_VERSION, 26);
    assert.deepEqual(read, doc);
    const f = read.timeline.features.find((x) => x.id === id)!;
    assert.deepEqual(chamferOf(f), { body, edges: [edge], size, flip: true });
    assert.deepEqual(f.dependsOn, ["feature-1"]);
    assert.equal(f.provenance.self.label, "Chamfer 1");
  }
  assert.equal(chamferSummary("Box 1", 1, { equal: 2 }, false), "Chamfer 1 edge of Box 1, 2 mm");
  assert.equal(chamferSummary("Box 1", 3, { two: [2, 3.5] }, true), "Chamfer 3 edges of Box 1, 2 mm × 3.5 mm, flipped");
  assert.equal(chamferSummary("Box 1", 1, { angle: [2, 30] }, false), "Chamfer 1 edge of Box 1, 2 mm at 30°");
  assert.equal(CHAMFER_STEP, "Chamfer edges");
  assert.throws(() => insertChamfer(d0, body, [], { equal: 1 }), { message: "pick at least one edge" });
  assert.throws(() => insertChamfer(d0, body, [edge, edge], { equal: 1 }), { message: "an edge is picked twice" });
  assert.throws(() => insertChamfer(d0, body, ["top"], { equal: 1 }), { message: "top is not an edge's name" });
  assert.throws(() => insertChamfer(d0, body, [edge], { equal: 0 }), { message: "The chamfer's size can't be used: its distance 0 is not above 0 and at most 1000000 mm" });
  assert.throws(() => insertChamfer(d0, "body:feature-9", [edge], { equal: 1 }), { message: "body:feature-9 is not a body in the design" });
});

test("the reader refuses each break of a Chamfer, and version 23 data holding one; the size limits at 0.9× and 1.1×", async () => {
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  const { doc, id } = insertChamfer(d0, body, [edge], { equal: 2 });
  const json = JSON.stringify(doc);
  const broken = (patch: (f: Record<string, unknown>, p: Record<string, unknown>) => void, version = 24) => {
    const d = JSON.parse(json);
    d.version = version;
    const f = d.timeline.features.find((x: { id: string }) => x.id === id);
    patch(f, f.intent.parameters);
    return () => readDesignDocument(d);
  };
  const at = `Design chamfer ${id}`;
  assert.throws(broken(() => {}, 23), { message: "Design data says version 23 but has a Chamfer, which version 24 brought" });
  assert.throws(broken((_, p) => (p.size = 2)), { message: `${at} has a parameter "size" a chamfer doesn't have` });
  assert.throws(broken((_, p) => (p.body = `body:${id}`)), { message: `${at} chamfers body:${id}, which is not a body made before it in the timeline` });
  assert.throws(broken((_, p) => (p.body = "body:feature-1/piece:3")), { message: `${at} chamfers body:feature-1/piece:3, which is not a body made before it in the timeline` });
  assert.throws(broken((_, p) => (p.edges = [])), { message: `${at} has no edges` });
  assert.throws(broken((_, p) => (p.edges = ["top"])), { message: `${at}'s edge top is not an edge's name` });
  assert.throws(broken((_, p) => (p.edges = [edge, edge])), { message: `${at} names edge ${edge} twice` });
  assert.throws(broken((_, p) => (p.distance = 0)), { message: `${at}'s size: its distance 0 is not above 0 and at most 1000000 mm` });
  assert.throws(broken((_, p) => (p.distance = "2")), { message: `${at}'s size: its distance "2" is not above 0 and at most 1000000 mm` });
  assert.throws(broken((_, p) => ((p.second = 1), (p.angle = 30))), { message: `${at}'s size: it has both a second distance and an angle, which a chamfer never has together` });
  assert.throws(broken((_, p) => (p.second = -1)), { message: `${at}'s size: its second distance -1 is not above 0 and at most 1000000 mm` });
  assert.throws(broken((_, p) => (p.flip = "no")), { message: `${at}'s flip "no" is not true or false` });
  assert.throws(broken((f) => (f.dependsOn = [])), { message: `${at} must depend on exactly the item that made the body it chamfers (feature-1)` });
  // The limits: a distance of 0.9 × CHAMFER_MAX (1 km) reads, 1.1 × is refused; an angle of 0.9 × 90° reads, 1.1 × is refused.
  assert.equal(CHAMFER_MAX, 1_000_000);
  assert.doesNotThrow(broken((_, p) => (p.distance = 0.9 * CHAMFER_MAX)));
  assert.throws(broken((_, p) => (p.distance = 1.1 * CHAMFER_MAX)), { message: `${at}'s size: its distance ${1.1 * CHAMFER_MAX} is not above 0 and at most 1000000 mm` });
  assert.doesNotThrow(broken((_, p) => (p.angle = 0.9 * 90)));
  assert.throws(broken((_, p) => (p.angle = 1.1 * 90)), { message: `${at}'s size: its angle ${1.1 * 90} is not between 0 and 90 degrees` });
  // Version 23 data without one opens as the current version (26 since the Shell, step 35h2c).
  assert.equal(readDesignDocument({ ...JSON.parse(JSON.stringify(d0)), version: 23 }).version, 26);
});

test("the rest of Design reads a Chamfer: the AI's timeline line, the change notes' name, Edit feature on (44a-app3 opens the Chamfer panel on it)", async () => {
  const { designAIView } = await import("../src/ai-view.ts");
  const { itemCalled } = await import("../src/graph.ts");
  const { editOff } = await import("../src/timeline-bar.ts");
  const { doc: d0, body } = cube();
  const edge = await edgeWhere(d0, body, topFront);
  const { doc, id } = insertChamfer(d0, body, [edge], { equal: 2 });
  const f = doc.timeline.features.find((x) => x.id === id)!;
  assert.equal(itemCalled(f), "Chamfer 1");
  assert.equal(editOff(f), null);
  const view = designAIView(doc, new Set(), { width: 10, depth: 10, height: 10 });
  assert.match(JSON.stringify(view), /2\. Chamfer 1 edge of Box 1, 2 mm\. A chamfer: builds no body; the body it chamfers is the result from here on\./);
});
