// Step 44a-app3: Edit feature on a Chamfer (chamfer.ts `changedChamfer`,
// `editableChamfer`), its timeline card and bar icon, the open-tool words,
// and the live preview of the cut before OK (chamfer-preview.ts), on the real
// kernel. Every volume is worked out by hand beside it: a chamfer of d1 × d2
// along an edge L long between two square faces takes away a right
// triangle's prism, L · d1 · d2 / 2; from the 10 mm cube's 1,000 mm³.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedChamfer, CHAMFER_MAX, editableChamfer, insertChamfer } from "../src/chamfer.ts";
import { cutAt, editPreviewInput, LATER_CHANGES, pickableView, previewChamfer, previewedMesh } from "../src/chamfer-preview.ts";
import { chamferOf, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { editStep } from "../src/feature-edit.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { openTool, openToolRefusal } from "../src/open-tool.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";
import { cardFacts, ownBodies } from "../src/timeline-card.ts";
import { editOff, itemMenu, timelineBarItems } from "../src/timeline-bar.ts";
import { renameItem } from "../src/timeline-edits.ts";
import type { Scene } from "../src/scene.ts";

const kernel = nodeKernel();
const near = (got: number, want: number, what = "") => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what} ${got}, expected ${want}`);

/** The 10 mm cube (x, y, z 0..10) as Box 1, and its body. */
const BODY = "body:feature-1";
/** The cube's top front edge: y = 0, z = 10, x 0..10. */
const topFront = (p: [number, number, number]) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;

/** The cube's top front edge's held name, and its kernel index on the cube as built. */
async function cubeEdge(doc: DesignDocument): Promise<{ name: string; index: number }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const ids = Object.keys(build.bodies);
    const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
    const at = ids.indexOf(BODY);
    const view = list[at].view;
    const edges = view.edge_vertices.flatMap(([a, b], e) => (topFront(view.vertex_points[a]) && topFront(view.vertex_points[b]) ? [e] : []));
    assert.equal(edges.length, 1, "one edge there");
    const name = heldEdgeNames(designNames(list), at)[edges[0]];
    assert.ok(name !== null);
    return { name: name!, index: edges[0] };
  } finally {
    await cache.close();
  }
}

/** The cube with a 2 mm Chamfer of its top front edge ("Chamfer 1", feature-2). */
async function chamfered(): Promise<{ doc: DesignDocument; id: string; index: number }> {
  const cube = partDocument("box", 10, 10, 10);
  const edge = await cubeEdge(cube);
  const { doc, id } = insertChamfer(cube, BODY, [edge.name], { equal: 2 });
  return { doc, id, index: edge.index };
}

/** The volume of `body` when `doc` is built. */
async function volumeOf(doc: DesignDocument, id: string): Promise<{ status: string; volume: number | null }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const b = build.bodies[BODY];
    return { status: build.results[id].status, volume: b === undefined ? null : (await cache.view(b.handle)).volume };
  } finally {
    await cache.close();
  }
}

test("hand-worked: Edit feature makes the 2 mm chamfer 3 mm, 1,000 − 10 · 3 · 3 / 2 = 955 mm³, the item keeping its id, place, body, edges and name", async () => {
  const { doc, id } = await chamfered();
  near((await volumeOf(doc, id)).volume!, 980, "before: 1,000 − 10 · 2 · 2 / 2");
  const next = changedChamfer(doc, id, { equal: 3 }, false);
  const was = doc.timeline.features[1];
  const now = next.timeline.features[1];
  assert.equal(now.id, id);
  assert.equal(now.provenance.self.label, "Chamfer 1");
  assert.deepEqual(chamferOf(now), { ...chamferOf(was), size: { equal: 3 } });
  assert.deepEqual(now.dependsOn, was.dependsOn);
  assert.equal(now.intent.summary, "Chamfer 1 edge of Box 1, 3 mm");
  assert.equal(next.nextId, doc.nextId, "no new id is taken");
  const built = await volumeOf(next, id);
  assert.equal(built.status, "built");
  near(built.volume!, 955, "after");
  // The edited design is a file that opens as it is.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(next))), next);
});

test("hand-worked: two distances 2 × 3 mm, then flipped, both 10 · 2 · 3 / 2 = 30 mm³ off, 970 mm³; the summary says flipped", async () => {
  const { doc, id } = await chamfered();
  const two = changedChamfer(doc, id, { two: [2, 3] }, false);
  assert.equal(two.timeline.features[1].intent.summary, "Chamfer 1 edge of Box 1, 2 mm × 3 mm");
  near((await volumeOf(two, id)).volume!, 970);
  const flipped = changedChamfer(two, id, { two: [2, 3] }, true);
  assert.notEqual(flipped, two);
  assert.equal(flipped.timeline.features[1].intent.summary, "Chamfer 1 edge of Box 1, 2 mm × 3 mm, flipped");
  assert.equal(chamferOf(flipped.timeline.features[1]).flip, true);
  near((await volumeOf(flipped, id)).volume!, 970);
  // Distance and angle: 2 mm at 45° is 2 × 2 (tan 45° = 1): 980 again.
  const angled = changedChamfer(doc, id, { angle: [2, 45] }, false);
  assert.equal(angled.timeline.features[1].intent.summary, "Chamfer 1 edge of Box 1, 2 mm at 45°");
  near((await volumeOf(angled, id)).volume!, 980);
  // Back to equal drops the second size and Flip (an equal chamfer has nothing to flip).
  const back = changedChamfer(flipped, id, { equal: 2 }, true);
  assert.deepEqual(back.timeline.features[1].intent.parameters, doc.timeline.features[1].intent.parameters);
});

test("nothing changed is the same document (nothing to record); a size the data can't hold is refused in words, 0.9× and 1.1× of 1 km", async () => {
  const { doc, id } = await chamfered();
  assert.equal(changedChamfer(doc, id, { equal: 2 }, false), doc);
  assert.equal(changedChamfer(doc, id, { equal: 2 }, true), doc, "Flip means nothing for an equal chamfer");
  assert.doesNotThrow(() => changedChamfer(doc, id, { equal: 0.9 * CHAMFER_MAX }, false));
  assert.throws(() => changedChamfer(doc, id, { equal: 1.1 * CHAMFER_MAX }, false), /The chamfer's size can't be used/);
  assert.throws(() => changedChamfer(doc, id, { equal: 0 }, false), /The chamfer's size can't be used/);
  assert.throws(() => changedChamfer(doc, id, { angle: [2, 90] }, false), /The chamfer's size can't be used/);
  assert.throws(() => changedChamfer(doc, "feature-1", { equal: 2 }, false), /is not a Chamfer in the timeline/);
  assert.throws(() => changedChamfer(doc, id, { equal: 2 }, "yes" as unknown as boolean), /Flip must be true or false/);
});

test("a size too big for the edge builds as a failure in the kernel's words, so Edit feature's OK check refuses it", async () => {
  const { doc, id } = await chamfered();
  // 12 mm is more than the 10 mm face beside the edge: the kernel refuses it.
  const built = await volumeOf(changedChamfer(doc, id, { equal: 12 }, false), id);
  assert.equal(built.status, "failed");
});

test("what Edit feature opens with, its undo step, and a rename followed in the summary's body name", async () => {
  const { doc, id } = await chamfered();
  assert.deepEqual(editableChamfer(doc, id), { id, name: "Chamfer 1", edges: 1, size: { equal: 2 }, flip: false });
  assert.equal(editStep(doc, id), "Edit Chamfer 1");
  assert.throws(() => editableChamfer(doc, "feature-1"), /is not a Chamfer/);
  const r = renameItem(doc, "feature-1", "Base");
  assert.ok("doc" in r);
  const renamed = r.doc;
  assert.equal(changedChamfer(renamed, id, { equal: 3 }, false).timeline.features[1].intent.summary, "Chamfer 1 edge of Base, 3 mm");
});

test("the menu, the bar and the card: Edit feature on, the chamfer icon, the card's kind and words, its own body lit", async () => {
  const { doc, id } = await chamfered();
  const f = doc.timeline.features[1];
  assert.equal(editOff(f), null);
  assert.equal(itemMenu(doc, id)[0].off, null);
  const { items } = timelineBarItems(doc);
  assert.equal(items[1].icon, "chamfer");
  assert.deepEqual(cardFacts(doc, f, items[1], 1), { name: "Chamfer 1", number: 2, kind: "Chamfer", details: ["1 edge of Box 1, 2 mm"], status: null });
  const scene = { bodies: [{ body: "body:feature-9", feature: "feature-9" }, { body: BODY, feature: "feature-1" }] } as unknown as Scene;
  assert.deepEqual([...ownBodies(scene, f)], [1], "the body it cuts back, which Box 1 made");
});

test("an export waits for an open Chamfer, new or edited, in words naming it", () => {
  const none = { move: null, extrude: false, edit: null, combine: null, sketch: null };
  const name = (x: string) => (x === "feature-2" ? "Chamfer 1" : x);
  assert.equal(openToolRefusal(openTool({ ...none, chamfer: { editing: null } }, name), "Export STL"), "Chamfer is still open: press OK or Cancel first, then Export STL.");
  assert.equal(openTool({ ...none, chamfer: { editing: "feature-2" } }, name)?.name, "Edit Chamfer 1");
  assert.equal(openTool({ ...none, chamfer: null }, name), null);
});

test("hand-worked preview on the real kernel: the cube's edge at 2 mm draws 980 mm³ and leaves the kernel's body count where it was", async () => {
  const cube = partDocument("box", 10, 10, 10);
  const edge = await cubeEdge(cube);
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(cube, cache, kernel);
    const handle = build.bodies[BODY].handle;
    const start = await kernel.call("body_count");
    const { view } = await previewChamfer(kernel, handle, [edge.index], { equal: 2 }, false);
    near(view.volume, 980);
    // Its new face's corners: (x, 2, 10) and (x, 0, 8), the cut 2 mm back along the top and down the front: the box round it is still 0..10.
    assert.deepEqual(view.bounds, [[0, 0, 0], [10, 10, 10]]);
    assert.equal(view.faces, 7);
    assert.equal(await kernel.call("body_count"), start, "the chamfered body was freed");
    // Two distances flipped: 970 either way round.
    near((await previewChamfer(kernel, handle, [edge.index], { two: [2, 3] }, true)).view.volume, 970);
    // Too big for the edge: the kernel's refusal, and still nothing left behind.
    await assert.rejects(previewChamfer(kernel, handle, [edge.index], { equal: 12 }, false));
    assert.equal(await kernel.call("body_count"), start);
  } finally {
    await cache.close();
  }
});

test("an edited Chamfer's preview chamfers the body it was made from with the rebuild's edges, until a later item changes the body", async () => {
  const { doc, id, index } = await chamfered();
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const r = build.results[id];
    const from = editPreviewInput(r, build.bodies[BODY].handle);
    assert.ok(from !== null && !("why" in from));
    assert.deepEqual(from.edges, [index], "the edge the rebuild found by its name");
    // The body before the Chamfer is the cube itself: 1,000 mm³; chamfered again at 3 mm, 955.
    near((await cache.view(from.handle)).volume, 1000);
    near((await previewChamfer(kernel, from.handle, from.edges, { equal: 3 }, false)).view.volume, 955);
    // A Move after it changes the body: no preview, said in words.
    const moved = insertMove(doc, [BODY], { ...NO_MOVE, x: 50 }).doc;
    const mb = await rebuildTimeline(moved, cache, kernel);
    assert.deepEqual(editPreviewInput(mb.results[id], mb.bodies[BODY].handle), { why: LATER_CHANGES });
    // A Chamfer that did not build has none.
    assert.equal(editPreviewInput({ status: "failed" }, undefined), null);
  } finally {
    await cache.close();
  }
});

test("hand-worked: the preview swaps only its body's mesh, and a scene without that body is drawn as it is", () => {
  const tri = (x: number): BodyView => ({ mesh: { positions: [x, 0, 0, x + 1, 0, 0, x, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], triangle_faces: [0], edge_lines: [], edge_line_edges: [] }, faces: 1, edges: 0 }) as unknown as BodyView;
  const scene = { bodies: [{ body: "body:a", feature: "a", view: tri(0) }, { body: BODY, feature: "feature-1", view: tri(5) }], mesh: { positions: [] } } as unknown as Scene;
  const swapped: BodyView = { ...tri(9), mesh: { ...tri(9).mesh, positions: [9, 0, 0, 10, 0, 0, 9, 2, 0] } };
  const mesh = previewedMesh(scene, BODY, swapped);
  // The first body's three points as they were, then the preview's.
  assert.deepEqual(mesh.positions, [0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 0, 0, 10, 0, 0, 9, 2, 0]);
  assert.deepEqual(mesh.indices, [0, 1, 2, 3, 4, 5]);
  assert.equal(previewedMesh(scene, "body:gone", swapped), scene.mesh);
});

test("hand-worked: the drawn preview answers a click with the cube's own faces and edges, so picking goes on while it shows", async () => {
  const cube = partDocument("box", 10, 10, 10);
  const edge = await cubeEdge(cube);
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(cube, cache, kernel);
    const handle = build.bodies[BODY].handle;
    const body = await cache.view(handle);
    const made = await previewChamfer(kernel, handle, [edge.index], { equal: 2 }, false);
    const { view: drawn, cuts } = pickableView(body, made.view, made.faces);
    // Numbered as the cube: its 6 faces, then the chamfer's face as 6, and its 12 edges, so every body after it keeps its edges' numbers.
    assert.equal(drawn.faces, 7);
    assert.deepEqual(cuts, [edge.index], "face 6 is the chamfer of the picked edge");
    assert.equal(drawn.edges, 12);
    near(drawn.volume, 980, "still the preview's volume");
    const m = drawn.mesh;
    assert.ok(m.triangle_faces.every((f) => f >= 0 && f < 7));
    assert.ok(m.edge_line_edges.every((e) => e >= 0 && e < 12));
    // The cube's edge for a segment with both ends at these points: the top right edge (x = 10, z = 10) is cut to y 2..10,
    // and its drawn line still answers as that edge.
    const edgeAt = (p: [number, number, number], q: [number, number, number]) => body.edge_vertices.findIndex(([a, b]) => [body.vertex_points[a], body.vertex_points[b]].every((v) => [p, q].some((w) => v.every((x, i) => Math.abs(x - w[i]) < 1e-9))));
    const topRight = edgeAt([10, 0, 10], [10, 10, 10]);
    const linesOf = (e: number) => m.edge_line_edges.flatMap((x, k) => (x === e ? [m.edge_lines.slice(6 * k, 6 * k + 6)] : []));
    const ys = linesOf(topRight).flatMap((l) => [l[1], l[4]]);
    assert.ok(ys.length > 0 && Math.abs(Math.min(...ys) - 2) < 1e-9 && Math.abs(Math.max(...ys) - 10) < 1e-9, `top right edge drawn over y ${ys}`);
    // The chamfer's four edges (its long sides at (x, 2, 10) and (x, 0, 8), and its two ends) answer as the edge it cut.
    const cutLines = linesOf(edge.index);
    const pts = new Set(cutLines.flatMap((l) => [l.slice(0, 3), l.slice(3)].map((p) => p.map((x) => Math.round(x * 1e6) / 1e6).join(","))));
    for (const corner of ["0,2,10", "10,2,10", "0,0,8", "10,0,8"]) assert.ok(pts.has(corner), `${corner} on the chamfer's outline`);
    // Its face's triangles answer as face 6, and only they do.
    const own = made.faces.findIndex((f) => f.from === "edge");
    made.view.mesh.triangle_faces.forEach((f, t) => assert.equal(m.triangle_faces[t] === 6, f === own));
    // A click on it, in a scene of another 6-faced body before this one: face 6 + 6 = 12 is the picked edge; 11 and 13 are not.
    const scene = { bodies: [{ body: "body:other", view: { faces: 6 } }, { body: BODY, view: body }] } as unknown as Scene;
    assert.equal(cutAt(scene, BODY, { view: drawn, cuts }, 12), edge.index);
    assert.equal(cutAt(scene, BODY, { view: drawn, cuts }, 11), null);
    assert.equal(cutAt(scene, BODY, { view: drawn, cuts }, 13), null);
    assert.equal(cutAt(scene, "body:gone", { view: drawn, cuts }, 12), null);
  } finally {
    await cache.close();
  }
});
