// Step 44a-app2: the Chamfer tool's rules (chamfer-tool.ts). Every expected
// answer is worked out by hand from the box's corners (test/views.ts: corner
// k at (k & 1, k & 2, k & 4) scaled; edge 4 is the top front, 4–5; edge 5 the
// top right, 5–7; edge 6 the top back, 6–7) and, on the real kernel, from the
// volume a chamfer takes: L · d1 · d2 / 2 off an edge L long between square faces.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { CORNER_SHARED, CURVED_EDGE, chamferHintWords, edgeRefusal, edgesWords, heldNamesOf, NOT_BETWEEN, ONE_BODY, picksFrom, readChamferSize, ROUND_FACES, shareCorner, togglePick } from "../src/chamfer-tool.ts";
import { insertChamfer } from "../src/chamfer.ts";
import { CHAMFER_MAX, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertCombine } from "../src/combine.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { boxView, cylinderView } from "./views.ts";

const kernel = nodeKernel();
const box = boxView(10, 10, 10);

test("hand-worked: which edges a click takes on the 10 mm box, and what it refuses at once", () => {
  // Every edge of a box is a line between two flat faces: all twelve are taken.
  for (let e = 0; e < 12; e++) assert.equal(edgeRefusal(box, e), null, `edge ${e}`);
  // A cylinder's rims are circles: curved, refused in words.
  assert.equal(edgeRefusal(cylinderView(5, 10), 0), CURVED_EDGE);
  // A straight edge on a body with a round face (a box with a hole's walls as a cylinder) is refused for the body.
  const holed: BodyView = { ...box, face_types: [...box.face_types, "cylinder"] };
  assert.equal(edgeRefusal(holed, 4), ROUND_FACES);
  // An edge with no two faces (only in a body that failed validation), or no such edge, is refused.
  const loose: BodyView = { ...box, edge_faces: box.edge_faces.map((f, i) => (i === 4 ? null : f)) };
  assert.equal(edgeRefusal(loose, 4), NOT_BETWEEN);
  assert.equal(edgeRefusal(box, 12), NOT_BETWEEN);
  assert.equal(edgeRefusal(box, -1), NOT_BETWEEN);
  assert.equal(edgeRefusal(box, 1.5), NOT_BETWEEN);
});

test("hand-worked: edges sharing a corner, from the box's edge ends", () => {
  // Top front 4–5 and top right 5–7 meet at corner 5; top front 4–5 and top back 6–7 share none.
  assert.equal(shareCorner(box, 4, 5), true);
  assert.equal(shareCorner(box, 4, 6), false);
  // Top front 4–5 and the front right upright 1–5 meet at 5; the bottom back 2–3 and top front share none.
  assert.equal(shareCorner(box, 4, 8), true);
  assert.equal(shareCorner(box, 1, 4), false);
});

test("hand-worked: clicks add, take out and refuse, the picks kept in the order clicked", () => {
  const a = { body: "body:feature-1", edge: 4 };
  const b = { body: "body:feature-1", edge: 6 };
  let r = togglePick([], a, box);
  assert.deepEqual(r, { picks: [a], refused: null });
  r = togglePick(r.picks, b, box);
  assert.deepEqual(r, { picks: [a, b], refused: null });
  // Top right meets both at corners 5 and 7: refused, the picks unchanged.
  assert.deepEqual(togglePick(r.picks, { body: "body:feature-1", edge: 5 }, box), { picks: [a, b], refused: CORNER_SHARED });
  // An edge of another body: refused, one body at a time.
  assert.deepEqual(togglePick(r.picks, { body: "body:feature-2", edge: 0 }, box), { picks: [a, b], refused: ONE_BODY });
  // A picked edge clicked again goes, the other stays.
  assert.deepEqual(togglePick(r.picks, a, box), { picks: [b], refused: null });
  // With nothing picked, another body's edge is fine.
  assert.deepEqual(togglePick([], { body: "body:feature-2", edge: 0 }, box), { picks: [{ body: "body:feature-2", edge: 0 }], refused: null });
});

test("picksFrom takes the selection's edges as clicks: once each, refusals left out with the first one's words", () => {
  const views: Record<string, BodyView> = { "body:feature-1": box, "body:feature-2": cylinderView(5, 10) };
  const viewOf = (b: string) => views[b] ?? null;
  const got = picksFrom(
    [
      { body: "body:feature-1", edge: 4 },
      { body: "body:feature-1", edge: 4 }, // twice: once
      { body: "body:feature-1", edge: 5 }, // meets 4 at corner 5
      { body: "body:feature-2", edge: 0 }, // another body
      { body: "body:feature-9", edge: 0 }, // not shown: left out silently
      { body: "body:feature-1", edge: 6 },
    ],
    viewOf,
  );
  assert.deepEqual(got.picks, [{ body: "body:feature-1", edge: 4 }, { body: "body:feature-1", edge: 6 }]);
  assert.equal(got.refused, CORNER_SHARED);
  // A cylinder's rim first: refused as curved, nothing picked.
  assert.deepEqual(picksFrom([{ body: "body:feature-2", edge: 1 }], viewOf), { picks: [], refused: CURVED_EDGE });
});

test("hand-worked: the sizes typed, and the limits at 0.9× and 1.1× (1 km for a distance, 90° for an angle)", () => {
  assert.deepEqual(readChamferSize("equal", "2", "9"), { size: { equal: 2 } });
  assert.deepEqual(readChamferSize("two", "2", "3"), { size: { two: [2, 3] } });
  assert.deepEqual(readChamferSize("angle", "2", "30"), { size: { angle: [2, 30] } });
  assert.deepEqual(readChamferSize("equal", " 2.5 ", ""), { size: { equal: 2.5 } });
  // 0.9 × 1,000,000 = 900,000 mm passes; 1.1 × = 1,100,000 is refused; likewise 81° and 99°.
  assert.deepEqual(readChamferSize("equal", String(0.9 * CHAMFER_MAX), ""), { size: { equal: 900_000 } });
  assert.ok("why" in readChamferSize("equal", String(1.1 * CHAMFER_MAX), ""));
  assert.ok("why" in readChamferSize("two", "2", String(1.1 * CHAMFER_MAX)));
  assert.deepEqual(readChamferSize("angle", "2", String(0.9 * 90)), { size: { angle: [2, 81] } });
  assert.ok("why" in readChamferSize("angle", "2", String(1.1 * 90)));
  // Nothing typed, nought, below nought, and text JavaScript's Number would take but no person types as a size.
  assert.deepEqual(readChamferSize("equal", "", ""), { why: "Type the chamfer's distance in mm." });
  assert.deepEqual(readChamferSize("two", "2", ""), { why: "Type the chamfer's second distance in mm." });
  assert.deepEqual(readChamferSize("angle", "2", " "), { why: "Type the chamfer's angle in degrees." });
  for (const bad of ["0", "-1", "0x10", "Infinity", "1e999", "abc"]) assert.ok("why" in readChamferSize("equal", bad, ""), bad);
  assert.ok("why" in readChamferSize("angle", "2", "0"));
  assert.ok("why" in readChamferSize("angle", "2", "90"));
});

test("the panel's and the hint's words", () => {
  assert.equal(edgesWords(0, false), "Click the edges to chamfer");
  assert.equal(edgesWords(0, true), "Tap the edges to chamfer");
  assert.equal(edgesWords(1, false), "1 edge");
  assert.equal(edgesWords(3, true), "3 edges");
  assert.match(chamferHintWords(0), /make one first/);
  assert.match(chamferHintWords(2), /click or tap the straight edges/);
});

/** The kernel edge of body `body` in the build whose two ends both satisfy `on`, from its view. */
function edgeWhere(view: BodyView, on: (p: [number, number, number]) => boolean): number {
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a]) && on(view.vertex_points[b]) ? [e] : []));
  assert.equal(edges.length, 1, "one edge there");
  return edges[0];
}
const topFront = (p: [number, number, number]) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got}, expected ${want}`);

/**
 * The tool's whole path on the real kernel: build `doc`, name the edge picked on `body` as the tool does
 * (`heldNamesOf`), put the Chamfer in, rebuild, and give the body's volume.
 */
async function chamferedVolume(doc: DesignDocument, body: string, on: (p: [number, number, number]) => boolean, d: number): Promise<number> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const edge = edgeWhere(await cache.view(build.bodies[body].handle), on);
    const [held] = await heldNamesOf(build.bodies, (b) => cache.view(b.handle), [{ body, edge }]);
    assert.ok(held !== null, "the edge has a name");
    const made = insertChamfer(doc, body, [held!], { equal: d });
    const after = await rebuildTimeline(made.doc, cache, kernel);
    assert.equal(after.results[made.id].status, "built", JSON.stringify(after.results[made.id]));
    return (await cache.view(after.bodies[body].handle)).volume;
  } finally {
    await cache.clear();
  }
}

test("hand-worked on the real kernel: the names the tool gives are the edges the rebuild chamfers", async () => {
  // The 10 mm cube's top front edge at 2 mm: 1,000 − 10 · 2 · 2 / 2 = 980 mm³.
  near(await chamferedVolume(partDocument("box", 10, 10, 10), "body:feature-1", topFront, 2), 980);
  // The second of two bodies (a 10 mm cube moved 50 along x, so its top front edge is x 50..60): 980 too, the first untouched.
  let two = partDocument("box", 20, 20, 20);
  const made = insertPreset(two, "box", 10, 10, 10);
  two = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 50 }).doc;
  near(await chamferedVolume(two, `body:${made.id}`, topFront, 2), 980);
  // A Combine's result (the cube with a 2 × 2 × 2 pocket cut from its top's middle, clear of the edge): 1,000 − 8 − 20 = 972.
  let cut = partDocument("box", 10, 10, 10);
  const tool = insertPreset(cut, "box", 2, 2, 4);
  cut = insertMove(tool.doc, [`body:${tool.id}`], { ...NO_MOVE, x: 4, y: 4, z: 8 }).doc;
  cut = insertCombine(cut, "body:feature-1", [`body:${tool.id}`], "cut").doc;
  near(await chamferedVolume(cut, "body:feature-1", topFront, 2), 972);
});

test("a pick on a body the build does not hold has no name", async () => {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(partDocument("box", 10, 10, 10), cache, kernel);
    assert.deepEqual(await heldNamesOf(build.bodies, (b) => cache.view(b.handle), [{ body: "body:feature-9", edge: 0 }]), [null]);
  } finally {
    await cache.clear();
  }
});
