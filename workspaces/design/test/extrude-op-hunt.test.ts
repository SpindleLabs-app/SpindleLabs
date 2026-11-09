// Combine bug hunt (2026-11-08), the extrude operations' share: an Extrude
// Join, Cut or Intersect as people use one, built by the real rebuild on the
// real kernel. Each test was a failing case first (the hunt's), now kept for
// good: a file that would not open again after a delete, a picked body
// renamed by a Join that didn't touch it, a piece silently swapped for
// another after an earlier edit, the part's red line over a design with
// nothing wrong, and refusals in raw ids. Every volume is worked out by hand
// from the boxes' corners and the sketch's rectangle in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { forgetPieces, insertCombine } from "../src/combine.ts";
import { changePreset, insertPreset, numberPieces, partDocument, partFeature, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, type OperationChoice } from "../src/extrude.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { partFailure } from "../src/part-failure.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { deleteItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);
/** Through JSON, as a file is saved and opened. */
const reopened = (d: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(d)));

/** Boxes, each `[w, d, h]` with its low corner moved to `[x, y, z]` (a ready-made box, then a Move, whose id is in `moves`); Box n's body "body:<its item>". */
function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[]; moves: (string | null)[] } {
  let doc: DesignDocument | null = null;
  const bodies: string[] = [];
  const moves: (string | null)[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (doc === null) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x !== 0 || y !== 0 || z !== 0) {
      const m = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z });
      doc = m.doc;
      moves.push(m.id);
    } else moves.push(null);
  }
  return { doc: doc!, bodies, moves };
}

/** `doc` with a rectangle from `a` to `c` sketched on XY (z = 0) and extruded `distance` mm up with `choice`. */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice | null) {
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, a, c).doc;
  return extrudeSketch(drawn, s.id, distance, false, undefined, choice);
}

/** `doc` built, its pieces numbered (and their faces remembered) as the workspace takes them in after a rebuild. */
async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const view = async (b: string) => cache.view(build.bodies[b].handle);
  return { build, cache, doc: numberPieces(doc, Object.keys(build.bodies), builtPieceFaces(build)), volume: async (b: string) => (await view(b)).volume, bounds: async (b: string) => (await view(b)).bounds };
}

// ---------------------------------------------------------------- deleting what made a piece an extrude uses

test("hunt A1: an Extrude Cut of a Combine's piece, then the Combine deleted: the file opens again and the extrude fails in words", async () => {
  // Bar 100 × 20 × 10 at the origin, slot 10 × 40 × 20 at (30, −10, −5): the cut leaves x 0..30 (the bar's id: its left end,
  // the first face in a box's made order wholly in one piece, is there) and x 40..100 (piece 1).
  const { doc: two, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const c = insertCombine(two, bodies[0], [bodies[1]], "cut");
  const first = await built(c.doc);
  await first.cache.close();
  const piece = `body:${c.id}/piece:1`;
  // The square x 60..70, y 5..15 cut 20 up through the far piece: 60 × 20 × 10 = 12,000 less 10 × 10 × 10 = 1,000: 11,000.
  const e = extruded(first.doc, [60, 5], [70, 15], 20, { operation: "cut", bodies: [piece] });
  const second = await built(e.doc);
  assert.equal(second.build.results[e.id].status, "built");
  near(await second.volume(piece), 11000);
  await second.cache.close();
  const deleted = deleteItem(second.doc, c.id);
  assert.deepEqual(reopened(deleted), deleted);
  // The extrude names what it lost, as a Move of the piece does; the bar is back whole: 20,000.
  const third = await built(deleted);
  assert.deepEqual(third.build.results[e.id], { status: "failed", cause: "deleted-input", input: c.id, message: "Combine 1 was deleted, so Extrude 1 has nothing to cut" });
  near(await third.volume(bodies[0]), 20000);
  await third.cache.close();
});

test("hunt A1b: an Extrude Cut of another Extrude Cut's piece, then the first extrude deleted: the file opens again and the second fails in words", async () => {
  // Bar 100 × 20 × 10; Extrude 1 cuts the slot x 30..40, y −10..30 through it: piece 1 is x 40..100 (as above).
  const start = partDocument("box", 100, 20, 10);
  const bar = `body:${start.timeline.features[0].id}`;
  const e1 = extruded(start, [30, -10], [40, 30], 20, { operation: "cut", bodies: [bar] });
  const first = await built(e1.doc);
  await first.cache.close();
  const piece = `body:${e1.id}/piece:1`;
  assert.deepEqual((await (async () => { const b = await built(e1.doc); const r = await b.bounds(piece); await b.cache.close(); return r; })())[0], [40, 0, 0]);
  const e2 = extruded(first.doc, [60, 5], [70, 15], 20, { operation: "cut", bodies: [piece] });
  const deleted = deleteItem(e2.doc, e1.id);
  assert.deepEqual(reopened(deleted), deleted);
  const b = await built(deleted);
  assert.deepEqual(b.build.results[e2.id], { status: "failed", cause: "deleted-input", input: e1.id, message: "Extrude 1 was deleted, so Extrude 2 has nothing to cut" });
  await b.cache.close();
});

test("a piece whose maker is still there but which the data doesn't number is still refused by the reader (the delete case only lets a deleted maker's piece through)", async () => {
  const start = partDocument("box", 100, 20, 10);
  const bar = `body:${start.timeline.features[0].id}`;
  const e1 = extruded(start, [30, -10], [40, 30], 20, { operation: "cut", bodies: [bar] });
  const first = await built(e1.doc);
  await first.cache.close();
  const e2 = extruded(first.doc, [60, 5], [70, 15], 20, { operation: "cut", bodies: [`body:${e1.id}/piece:1`] });
  const d = JSON.parse(JSON.stringify(e2.doc));
  d.timeline.features.at(-1).intent.parameters.bodies = [`body:${e1.id}/piece:2`];
  assert.throws(() => readDesignDocument(d), { message: `Design extrude ${e2.id}: body:${e1.id}/piece:2 is not a body made before it in the timeline` });
});

// ---------------------------------------------------------------- Extrude Join keeps the bodies it holds

test("hunt A9: an Extrude Join of two bodies, the second not reached: the second keeps its id, in either pick order (document-model section 8)", async () => {
  // Cube A x 0..10, y 0..10, z −5..5; cube B x 50..60, z 0..10. The square x 2..6, y 2..6 extruded z 0..20 joins A only:
  // A 1,000 plus the part above it, z 5..20, 4 × 4 × 15 = 240: 1,240. B is untouched: 1,000, its own id.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [50, 0, 0]]);
  for (const picked of [[bodies[0], bodies[1]], [bodies[1], bodies[0]]]) {
    const e = extruded(two, [2, 2], [6, 6], 20, { operation: "join", bodies: picked });
    const b = await built(e.doc);
    const r = b.build.results[e.id];
    assert.equal(r.status, "built", JSON.stringify(r));
    assert.deepEqual(Object.keys(b.build.bodies).sort(), [...bodies].sort());
    near(await b.volume(bodies[0]), 1240);
    near(await b.volume(bodies[1]), 1000);
    assert.deepEqual(r.status === "built" && r.pieceFaces, undefined, "no piece of its own");
    await b.cache.close();
  }
});

test("hunt A9: an Extrude Join of two touching bodies goes into the earliest made, whichever was picked first (document-model section 8)", async () => {
  // Cubes A x 0..10 and B x 10..20 (z −5..5) touch on x = 10; the rectangle x 6..14, y 2..6 up 20 reaches both. One piece:
  // 1,000 + 1,000 + the part above z 5, 8 × 4 × 15 = 480: 2,480, Box 1's (A, made first) id; B's id is gone.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [10, 0, -5]]);
  for (const picked of [[bodies[0], bodies[1]], [bodies[1], bodies[0]]]) {
    const e = extruded(two, [6, 2], [14, 6], 20, { operation: "join", bodies: picked });
    const b = await built(e.doc);
    assert.equal(b.build.results[e.id].status, "built");
    assert.deepEqual(Object.keys(b.build.bodies), [bodies[0]], `picked ${picked}`);
    near(await b.volume(bodies[0]), 2480);
    await b.cache.close();
  }
});

test("an Extrude Join of two pieces of one Combine goes into the lower numbered, whichever was picked first", async () => {
  // Bar x 0..100, y 0..20, z 0..10 cut by slots x 20..30 and x 50..60 (10 × 40 × 20 boxes at y −10, z −5): near x 0..20 keeps
  // the bar's id, far x 60..100 (8,000) is piece 1, middle x 30..50 (4,000) piece 2 (test/combine-piece-identity.test.ts).
  const { doc: four, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [20, -10, -5]], [[10, 40, 20], [50, -10, -5]]);
  const c = insertCombine(four, bodies[0], [bodies[1], bodies[2]], "cut");
  const first = await built(c.doc);
  await first.cache.close();
  const [p1, p2] = [`body:${c.id}/piece:1`, `body:${c.id}/piece:2`];
  // The bridge x 45..65, y 2..6, z 0..20 (1,600) reaches the middle (x 45..50 × 4 × 10 = 200 shared) and the far piece
  // (x 60..65, 200 shared): 8,000 + 4,000 + 1,600 − 400 = 13,200, under piece 1's id (same item: the lower number first).
  const e = extruded(first.doc, [45, 2], [65, 6], 20, { operation: "join", bodies: [p2, p1] });
  const b = await built(e.doc);
  assert.equal(b.build.results[e.id].status, "built", JSON.stringify(b.build.results[e.id]));
  assert.deepEqual(Object.keys(b.build.bodies).sort(), [bodies[0], p1].sort());
  near(await b.volume(p1), 13200);
  await b.cache.close();
});

test("hunt A10: an Extrude Join of two touching cubes, then an earlier Move takes the second away: a later Move of the second still moves it", async () => {
  // As above, joined [A, B]: 2,480 under A's id, B's id gone, and a later Move of B fails in words.
  const { doc: two, bodies, moves } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [10, 0, -5]]);
  const e = extruded(two, [6, 2], [14, 6], 20, { operation: "join", bodies: [bodies[0], bodies[1]] });
  const later = insertMove(e.doc, [bodies[1]], { ...NO_MOVE, y: 100 });
  const s = await built(later.doc);
  near(await s.volume(bodies[0]), 2480);
  assert.equal(s.build.bodies[bodies[1]], undefined);
  assert.equal(s.build.results[later.id].status, "failed");
  await s.cache.close();
  // B moved to x 50..60 before the extrude: the extrude joins A only. Outside A it is x 10..14, z 0..20 (4 × 4 × 20 = 320)
  // and x 6..10, z 5..20 (4 × 4 × 15 = 240): 1,000 + 560 = 1,560. B is untouched and keeps its id, so the later Move
  // moves it: 1,000 at y 100..110.
  const away = changedMove(later.doc, moves[1]!, { ...NO_MOVE, x: 50, z: -5 });
  const t = await built(away);
  near(await t.volume(bodies[0]), 1560);
  assert.equal(t.build.results[later.id].status, "built", JSON.stringify(t.build.results[later.id]));
  near(await t.volume(bodies[1]), 1000);
  assert.deepEqual(await t.bounds(bodies[1]), [[50, 100, -5], [60, 110, 5]]);
  assert.deepEqual(reopened(away), away);
  await t.cache.close();
});

test("hunt A2: an Extrude Join that touches nothing it picked: the body keeps its id, the extrude is a body of its own that can be moved and saved", async () => {
  // Cube x 0..10; the square x 20..24, y 0..4 extruded 10 up: apart from it. Two bodies: the cube, 1,000, its own id, and
  // the extrude's 4 × 4 × 10 = 160, numbered, the only one of the extrude's: the extrude's own id (Design data version 16;
  // version 15 named it piece 1).
  const doc0 = partDocument("box", 10, 10, 10);
  const cube = `body:${doc0.timeline.features[0].id}`;
  const e = extruded(doc0, [20, 0], [24, 4], 10, { operation: "join", bodies: [cube] });
  const b = await built(e.doc);
  assert.equal(b.build.results[e.id].status, "built");
  near(await b.volume(cube), 1000);
  const own = Object.keys(b.build.bodies).filter((id) => id !== cube);
  assert.deepEqual(own, [`body:${e.id}`]);
  near(await b.volume(own[0]), 160);
  assert.ok(b.doc.bodies!.some((x) => x.id === own[0]), "numbered");
  await b.cache.close();
  // Moved 100 along x: x 120..124.
  const m = insertMove(b.doc, own, { ...NO_MOVE, x: 100 });
  assert.deepEqual(reopened(m.doc), m.doc);
  const c = await built(m.doc);
  assert.equal(c.build.results[m.id].status, "built");
  assert.deepEqual((await c.bounds(own[0]))[0], [120, 0, 0]);
  await c.cache.close();
});

// ---------------------------------------------------------------- an extrude's pieces keep their ids by their faces

test("hunt A11: an Extrude Cut through two bars, a Move of the first bar's piece, then an earlier edit stops that split: the Move fails in words, never moving the second bar's piece", async () => {
  // Bar A x 0..100, y 0..20, z 0..10; bar B the same at y 30..50. The slot x 30..40, y −10..60, 20 up, cuts both: each
  // keeps its near end (x 0..30), and the far ends x 40..100 (60 × 20 × 10 = 12,000 each) are pieces 1 (A's) and 2 (B's).
  const { doc: two, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[100, 20, 10], [0, 30, 0]]);
  const e = extruded(two, [30, -10], [40, 60], 20, { operation: "cut", bodies: [bodies[0], bodies[1]] });
  const s0 = await built(e.doc);
  const [p1, p2] = [`body:${e.id}/piece:1`, `body:${e.id}/piece:2`];
  assert.deepEqual(await s0.bounds(p1), [[40, 0, 0], [100, 20, 10]]);
  assert.deepEqual(await s0.bounds(p2), [[40, 30, 0], [100, 50, 10]]);
  await s0.cache.close();
  // Each piece remembered with its faces (version 13's `faces`), as a Combine's.
  assert.ok([p1, p2].every((p) => s0.doc.bodies!.find((x) => x.id === p)?.faces !== undefined));
  const m = insertMove(s0.doc, [p1], { ...NO_MOVE, z: 50 });
  // Bar A made 20 long (x 0..20): the slot at x 30..40 misses it, so A has no far piece. B's far piece keeps piece 2
  // (its faces are B's and the slot's), so the Move of piece 1 has nothing to move and says so; B's far piece stays at z 0.
  const shorter = changePreset(m.doc, bodies[0].slice("body:".length), "box", 20, 20, 10);
  const t = await built(shorter);
  assert.equal(t.build.bodies[p1], undefined);
  assert.deepEqual(await t.bounds(p2), [[40, 30, 0], [100, 50, 10]]);
  assert.deepEqual(t.build.results[m.id], { status: "failed", cause: "failed-input", input: e.id, message: "Move 2 can't move a piece: an earlier Combine or extrude used it up or left no such piece" });
  const r = t.build.results[e.id];
  assert.ok(r.status === "built" && r.pieces === undefined, JSON.stringify(r));
  await t.cache.close();
});

/** Bar 100 × 20 × 10, turned 180° about z through its middle when `turned`, then Extrude 1 cutting the slot x 30..40 through it. */
function turnedBar(turned: boolean) {
  const start = partDocument("box", 100, 20, 10);
  const bar = `body:${start.timeline.features[0].id}`;
  const turn = insertMove(start, [bar], { ...NO_MOVE, turnZ: turned ? 180 : 0, pivotX: 50, pivotY: 10 });
  const e = extruded(turn.doc, [30, -10], [40, 30], 20, { operation: "cut", bodies: [bar] });
  return { doc: e.doc, bar, turn: turn.id, e: e.id, piece: `body:${e.id}/piece:1` };
}

test("an extrude's piece whose faces no piece has any more is given by rank with a warning; editing the extrude (forgetting it) confirms it", async () => {
  // Unturned: the bar's left end (x = 0), first in a box's made order, is whole in the near piece (x 0..30), which keeps the
  // bar's id; piece 1 is the far piece x 40..100, remembered with the slot's x = 40 side.
  const s = turnedBar(false);
  const first = await built(s.doc);
  await first.cache.close();
  assert.deepEqual(await (async () => { const b = await built(s.doc); const r = await b.bounds(s.piece); await b.cache.close(); return r; })(), [[40, 0, 0], [100, 20, 10]]);
  const number = first.doc.bodies!.find((b) => b.id === s.piece)!.number;
  // Turned 180° about (50, 10): the same box, but its left end is at x = 100, so the far piece keeps the bar's id and the
  // near piece x 0..30 (6,000) is the extrude's piece, with the slot's x = 30 side: not the faces piece 1 was numbered with.
  const turned = changedMove(first.doc, s.turn, { ...NO_MOVE, turnZ: 180, pivotX: 50, pivotY: 10 });
  const t = await built(turned);
  const r = t.build.results[s.e];
  assert.ok(r.status === "built");
  assert.deepEqual(r.pieces, { renumbered: [s.piece], message: `Extrude 1's pieces changed since they were numbered, so Body ${number} may now be another piece: check the items that use it, then edit Extrude 1 to keep its pieces as they are now` });
  near(await t.volume(s.piece), 6000);
  assert.equal(t.doc, turned, "what it was numbered with stays remembered while the pieces differ");
  await t.cache.close();
  // Editing Extrude 1 confirms its pieces as they are now: the warned piece's faces go, its number stays, and the next
  // build remembers it afresh with no warning.
  const confirmed = forgetPieces(turned, s.e, r.pieces!.renumbered);
  assert.deepEqual(confirmed.bodies!.find((b) => b.id === s.piece), { id: s.piece, number });
  const u = await built(confirmed);
  const ru = u.build.results[s.e];
  assert.ok(ru.status === "built" && ru.pieces === undefined, JSON.stringify(ru));
  assert.ok(u.doc.bodies!.find((b) => b.id === s.piece)!.faces !== undefined);
  await u.cache.close();
  const v = await built(u.doc);
  assert.equal(v.doc, u.doc, "found by its new faces: nothing changes");
  await v.cache.close();
});

// ---------------------------------------------------------------- the part's red line

test("hunt A14: no red line on the part after an Extrude Join takes the last box in, nor after an Extrude Cut", async () => {
  // Cubes x 0..10 and x 10..20 (z −5..5), the rectangle x 6..14, y 2..6 up 20: Join puts Box 2 (the part, the last item
  // making a body) into Box 1, as it should; Cut leaves Box 2 as it is.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [10, 0, -5]]);
  for (const choice of [{ operation: "cut" as const, bodies: [bodies[0]] }, { operation: "join" as const, bodies: [bodies[0], bodies[1]] }]) {
    const e = extruded(two, [6, 2], [14, 6], 20, choice);
    const b = await built(e.doc);
    assert.equal(partFeature(e.doc)?.provenance.self.label, "Box 2");
    assert.equal(partFailure(e.doc.timeline.features, partFeature(e.doc), b.build), undefined, choice.operation);
    await b.cache.close();
  }
  // A Join that fails still shows the red line: Box 2 not built, as before (the check above can fail).
  const e = extruded(two, [6, 2], [14, 6], 20, { operation: "join", bodies: [bodies[0], bodies[1]] });
  const b = await built(e.doc);
  const gone = { ...b.build, results: { ...b.build.results, [e.id]: { status: "failed" as const, cause: "error" as const, message: "Extrude 1 can't be made" } } };
  assert.equal(partFailure(e.doc.timeline.features, partFeature(e.doc), gone), "Box 2 built no body");
  await b.cache.close();
});

// ---------------------------------------------------------------- words

test("a body picked twice is named as the browser shows it (Body n), for an extrude and a Combine", () => {
  const { doc, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [20, 0, 0]]);
  assert.throws(() => extruded(doc, [2, 2], [6, 6], 20, { operation: "cut", bodies: [bodies[0], bodies[0]] }), { message: "Body 1 is picked twice" });
  assert.throws(() => insertCombine(doc, bodies[0], [bodies[1], bodies[1]], "join"), { message: "Body 2 is picked twice" });
});

test("a Move of a body an Extrude Join took in says an earlier Combine or extrude used it up", async () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [10, 0, -5]]);
  const e = extruded(two, [6, 2], [14, 6], 20, { operation: "join", bodies: [bodies[0], bodies[1]] });
  const later = insertMove(e.doc, [bodies[1]], { ...NO_MOVE, y: 100 });
  const b = await built(later.doc);
  assert.deepEqual(b.build.results[later.id], { status: "failed", cause: "failed-input", input: bodies[1].slice("body:".length), message: "Move 3 can't move Box 2: an earlier Combine or extrude used it up or left no such piece" });
  await b.cache.close();
});
