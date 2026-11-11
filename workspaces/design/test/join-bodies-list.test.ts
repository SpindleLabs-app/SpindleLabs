// The design's bodies after an Extrude Join are the bodies the rebuild
// left (SL #538 item 2, hunt 2026-11-11): the Bodies rows, the whole
// design's STL list and Slice for printing (all `browser.ts` `designBodies`)
// against the bodies the real rebuild holds on the real kernel. Until then
// the list assumed a Join uses up every body picked after the first: a
// picked body the Join no longer reached was built and drawn but had no
// row and was left out of the exported STL, and when the first body picked
// was not the earliest made, the one row named a body that was gone.
// Volumes worked out by hand from the cubes' corners and the rectangle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { hiddenStlNote, shownBodyRefs } from "../src/actions.ts";
import { bodyRows, designBodies, failedIds } from "../src/browser.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { showAllBodies } from "../src/show-only.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { hideBody, reorderItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/** `doc0` built as the workspace takes a rebuild in: what it said (`failedIds`), the rows, the whole design's STL list, and each built body's volume. */
async function state(doc0: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies), builtPieceFaces(build));
  const said = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
  const volumes: Record<string, number> = {};
  for (const [id, b] of Object.entries(build.bodies)) volumes[id] = (await cache.view(b.handle)).volume;
  await cache.close();
  const rows = bodyRows(doc, said);
  return { doc, build, said, volumes, built: Object.keys(build.bodies).sort(), rows: rows.map((r) => r.body).sort(), labels: rows.map((r) => r.label), stl: shownBodyRefs(doc, said).map((r) => r.id as string).sort() };
}

/**
 * Cubes of 10: Box 1 at the origin (x 0..10), Box 2 moved to x = `bx` by Move 1, then (with `cx`) Box 3 moved to
 * x = `cx`. Sketch 1's rectangle x 6..14, y 2..6 extruded 20 up, Operation Join, the boxes picked in `order`
 * (their numbers).
 */
function joined(bx: number, order: number[] = [1, 2], cx?: number) {
  let doc = partDocument("box", 10, 10, 10);
  const box1 = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 10, 10, 10);
  const move = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: bx });
  doc = move.doc;
  const ids = [box1, b2.id];
  if (cx !== undefined) {
    const b3 = insertPreset(doc, "box", 10, 10, 10);
    doc = insertMove(b3.doc, [`body:${b3.id}`], { ...NO_MOVE, x: cx }).doc;
    ids.push(b3.id);
  }
  const s = addSketch(doc);
  const e = extrudeSketch(drawRectangle(s.doc, s.id, [6, 2], [14, 6]).doc, s.id, 20, false, undefined, { operation: "join", bodies: order.map((n) => `body:${ids[n - 1]}`) });
  return { doc: e.doc, e: e.id, move: move.id, box1, bodies: ids.map((id) => `body:${id}`) };
}

test("the control: a Join reaching both cubes, the earliest made picked first, leaves one body, one row and one body in the STL", async () => {
  // Box 2 at x 10..20 touches Box 1. The bar x 6..14, y 2..6, z 0..20 joins both: 1,000 + 1,000 + its part above the
  // cubes, 8 × 4 × 10 = 320: one body of 2,320, keeping the earliest made cube's id, Box 1's (Body 1).
  const j = joined(10);
  const s = await state(j.doc);
  assert.deepEqual(s.built, [j.bodies[0]]);
  near(s.volumes[j.bodies[0]], 2320);
  assert.deepEqual(s.rows, [j.bodies[0]]);
  assert.deepEqual(s.labels, ["Body 1"]);
  assert.deepEqual(s.stl, [j.bodies[0]]);
});

test("hand-worked: a Join that no longer reaches the second cube: both bodies built have a row and are in the STL (SL #538 item 2)", async () => {
  const j = joined(10);
  const before = await state(j.doc);
  assert.deepEqual(before.rows, [j.bodies[0]]);
  // Move 1 edited to x = 50: Box 2 is at x 50..60, out of the bar's reach (x 6..14).
  const s = await state(changedMove(before.doc, j.move, { ...NO_MOVE, x: 50 }));
  assert.equal(s.build.results[j.e].status, "built");
  // Box 1 with the bar: 1,000 + the bar beside it, x 10..14 × 4 × 10 = 160, + the bar above, 8 × 4 × 10 = 320: 1,480.
  // Box 2 as it was: 1,000. Two bodies, 2,480 mm³.
  assert.deepEqual(s.built, [...j.bodies].sort());
  near(s.volumes[j.bodies[0]], 1480);
  near(s.volumes[j.bodies[1]], 1000);
  assert.deepEqual(s.rows, s.built, "the Bodies rows are the bodies built");
  assert.deepEqual(s.labels, ["Body 1", "Body 2"]);
  assert.deepEqual(s.stl, s.built, "the whole design's STL holds the bodies built");
  // Each row is its own cube's: Box 2's row leads to Box 2 (its menu, its eye), not to the extrude.
  assert.deepEqual(bodyRows(s.doc, s.said).map((r) => r.feature.id), j.bodies.map((b) => b.slice("body:".length)));
  // Box 2's eye works on it: hidden, it leaves the STL with the note naming it; Show all bodies brings it back.
  const hidden = hideBody(s.doc, j.bodies[1], true);
  assert.deepEqual(shownBodyRefs(hidden, s.said).map((r) => r.id), [j.bodies[0]]);
  assert.equal(hiddenStlNote(hidden, s.said), "Body 2 is hidden, so it is not in the STL: show it with its eye in the browser to include it.");
  assert.deepEqual(shownBodyRefs(showAllBodies(hidden, s.said), s.said).map((r) => r.id).sort(), s.built);
  // Saved and opened afresh, the same.
  const fresh = await state(readDesignDocument(JSON.parse(JSON.stringify(s.doc))));
  assert.deepEqual([fresh.rows, fresh.stl], [s.built, s.built]);
  // Moved back to x = 10, Box 2 is joined in again: one body of 2,320, one row.
  const back = await state(changedMove(s.doc, j.move, { ...NO_MOVE, x: 10 }));
  near(back.volumes[j.bodies[0]], 2320);
  assert.deepEqual([back.rows, back.stl], [[j.bodies[0]], [j.bodies[0]]]);
});

test("hand-worked: the first cube picked is not the earliest made: the one row and the STL name the body really there", async () => {
  // Box 1 dragged to after Move 1, so Box 2 is made first; the Join still lists Box 1 first. The joined body (2,320, as
  // in the control) keeps the earliest made cube's id, Box 2's, whose number is 2: the row is Body 2.
  const j = joined(10);
  const moved = reorderItem(j.doc, j.box1, 2);
  assert.ok("doc" in moved, JSON.stringify(moved));
  const s = await state(moved.doc);
  assert.deepEqual(s.built, [j.bodies[1]]);
  near(s.volumes[j.bodies[1]], 2320);
  assert.deepEqual(s.rows, s.built);
  assert.deepEqual(s.labels, ["Body 2"]);
  assert.deepEqual(s.stl, s.built);
  // Picked the other way round in the first place (Box 2, then Box 1), Box 1 is the earliest made and keeps its id.
  const other = await state(joined(10, [2, 1]).doc);
  assert.deepEqual([other.rows, other.labels], [[j.bodies[0]], ["Body 1"]]);
});

test("hand-worked: three cubes picked, the Join reaching the first two only: the far one keeps its row, and the joined one the earliest's", async () => {
  // Box 3 at x 80..90 is not reached; Boxes 1 and 2 (x 0..20) are joined by the bar: 2,320 under Box 1's id, and 1,000.
  for (const order of [[1, 2, 3], [3, 2, 1], [2, 3, 1]]) {
    const j = joined(10, order, 80);
    const s = await state(j.doc);
    assert.deepEqual(s.built, [j.bodies[0], j.bodies[2]].sort(), `picked ${order}`);
    near(s.volumes[j.bodies[0]], 2320);
    near(s.volumes[j.bodies[2]], 1000);
    assert.deepEqual(s.rows, s.built, `picked ${order}`);
    assert.deepEqual(s.labels, ["Body 1", "Body 3"], `picked ${order}`);
    assert.deepEqual(s.stl, s.built, `picked ${order}`);
  }
});

test("a body a Join left as it was is a body for the items after it: a Combine that then uses it up takes its row", async () => {
  // As the second test (Box 2 at x 50..60, not reached), then Combine 1 joins Box 2 into Box 1's body as its tool: the
  // two don't meet, so the piece of the tool left apart is the Combine's piece 1 (section 8's F2), and Box 2's id is gone.
  const j = joined(50);
  const c = insertCombine(j.doc, j.bodies[0], [j.bodies[1]], "join");
  const s = await state(c.doc);
  assert.equal(s.build.results[c.id].status, "built", JSON.stringify(s.build.results[c.id]));
  const piece = `body:${c.id}/piece:1`;
  assert.deepEqual(s.built, [j.bodies[0], piece].sort());
  near(s.volumes[j.bodies[0]], 1480);
  near(s.volumes[piece], 1000);
  assert.deepEqual(s.rows, s.built);
  assert.deepEqual(s.stl, s.built);
});

test("before any rebuild has answered, the list takes a Join's bodies as all joined into the earliest made; the rebuild's word then decides", async () => {
  // Read from the data alone (other workspaces' list of bodies, the browser's first draw): one body, the earliest made.
  const j = joined(50);
  assert.deepEqual(designBodies(j.doc).map((b) => b.body), [j.bodies[0]]);
  const moved = reorderItem(joined(10).doc, j.box1, 2);
  assert.ok("doc" in moved);
  assert.deepEqual(designBodies(moved.doc).map((b) => b.body), [j.bodies[1]]);
  // What the rebuild said names each picked body the Join left a body, and nothing else: no id of an item or a body.
  const s = await state(j.doc);
  assert.deepEqual([...s.said].sort(), j.bodies.map((b) => `stays:${j.e}>${b}`).sort());
  assert.deepEqual(designBodies(s.doc, s.said).map((b) => b.body), j.bodies);
  // A Join that failed left every body as it was, and says nothing of them: the list is the cubes.
  const failed = failedIds(s.doc, { ...s.build.results, [j.e]: { status: "failed" } }, new Set(j.bodies));
  assert.deepEqual([...failed], [j.e]);
  assert.deepEqual(designBodies(s.doc, failed).map((b) => b.body), j.bodies);
});
