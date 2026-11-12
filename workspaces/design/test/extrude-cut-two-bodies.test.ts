// One Extrude Cut through several bodies (SL #538 item 1, hunt 2026-11-11):
// it runs one boolean per body picked, and its pieces are numbered once for
// the whole item, so no two of its bodies can ever share an id. Until then
// each boolean numbered its own pieces against every remembered piece of
// the extrude: a new chunk of one box could take the number a chunk of
// another box was remembered with, the second overwrote the first, and a
// whole chunk of a body was gone from the design (not drawn, no row, not in
// the STL), depending on the order the bodies were picked in. Built by the
// real rebuild on the real kernel; every volume and corner is worked out by
// hand from the boxes' corners and the sketch's rectangle beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { pieceIds } from "../src/boolean-names.ts";
import { forgetPieces } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, type OperationChoice } from "../src/extrude.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import * as REAL from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);
/** Through JSON, as a file is saved and opened. */
const reopened = (d: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(d)));

type Rebuild = Pick<typeof REAL, "BodyCache" | "rebuildTimeline" | "builtPieceFaces">;

/** `doc` built (by `r`, the real rebuild unless a planted copy), its pieces numbered and remembered as the workspace takes them in, each body's volume and corners read. */
async function built(doc: DesignDocument, r: Rebuild = REAL) {
  const cache = new r.BodyCache(kernel);
  const build = await r.rebuildTimeline(doc, cache, kernel);
  const bodies: Record<string, { volume: number; bounds: unknown }> = {};
  for (const [id, b] of Object.entries(build.bodies)) {
    const v = await cache.view(b.handle);
    bodies[id] = { volume: v.volume, bounds: v.bounds };
  }
  await cache.close();
  const total = Object.values(bodies).reduce((s, b) => s + b.volume, 0);
  return { build, doc: numberPieces(doc, Object.keys(build.bodies), r.builtPieceFaces(build)), bodies, ids: Object.keys(bodies).sort(), total };
}

/** `doc` with a rectangle from `a` to `c` sketched on XY (z = 0) and extruded `distance` mm up with `choice`. */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice) {
  const s = addSketch(doc);
  return extrudeSketch(drawRectangle(s.doc, s.id, a, c).doc, s.id, distance, false, undefined, choice);
}

/**
 * Box A 40 × 30 × 20 with its low corner moved to x = −10 (x −10..30), Box B the same at x = 100 (x 100..140), and
 * Extrude 1 cutting the slot x 20..150, y 13..17, z 0..30 through both, picked in `order`.
 */
function twoBoxes(order: "A first" | "B first") {
  let doc = partDocument("box", 40, 30, 20);
  const a = `body:${doc.timeline.features[0].id}`;
  const moveA = insertMove(doc, [a], { ...NO_MOVE, x: -10 });
  const boxB = insertPreset(moveA.doc, "box", 40, 30, 20);
  const b = `body:${boxB.id}`;
  doc = insertMove(boxB.doc, [b], { ...NO_MOVE, x: 100 }).doc;
  const e = extruded(doc, [20, 13], [150, 17], 30, { operation: "cut", bodies: order === "A first" ? [a, b] : [b, a] });
  return { doc: e.doc, a, b, moveA: moveA.id, e: e.id, piece: (k: number) => `body:${e.id}/piece:${k}` };
}

for (const order of ["A first", "B first"] as const)
  test(`hand-worked (${order}): one Cut through two boxes, then an earlier Move makes the other box split too: four bodies, 41,600 mm³, no chunk gone`, async () => {
    const s = twoBoxes(order);
    const first = await built(s.doc);
    assert.equal(first.build.results[s.e].status, "built");
    // The slot only notches A (x 20..30 of −10..30): one body, 24,000 − 10 × 4 × 20 = 23,200. It cuts B right across:
    // y 0..13 (40 × 13 × 20 = 10,400), which keeps B's id (a box's faces in made order are bottom, top, front, back, left,
    // right: bottom and top are split, the front, y = 0, is the first wholly in one piece), and y 17..30 (10,400), piece 1.
    assert.deepEqual(first.ids, [s.a, s.b, s.piece(1)].sort());
    near(first.bodies[s.a].volume, 23200);
    near(first.bodies[s.b].volume, 10400);
    assert.deepEqual(first.bodies[s.piece(1)].bounds, [[100, 17, 0], [140, 30, 20]]);
    near(first.total, 44000);
    // Body 1 and Body 2 are the boxes, so the piece is Body 3, remembered with its faces.
    const three = first.doc.bodies!.find((x) => x.id === s.piece(1))!;
    assert.equal(three.number, 3);
    assert.ok(three.faces !== undefined);

    // Move 1 edited: A's low corner to x = 30 (x 30..70), wholly inside the slot's x 20..150, so A is cut right across too.
    const edited = changedMove(reopened(first.doc), s.moveA, { ...NO_MOVE, x: 30 });
    const second = await built(edited);
    const r = second.build.results[s.e];
    assert.equal(r.status, "built", JSON.stringify(r));
    // By hand: each box is 24,000 − 40 × 4 × 20 (3,200) = 20,800 in two chunks of 40 × 13 × 20 = 10,400: four bodies, 41,600.
    assert.deepEqual(second.ids, [s.a, s.b, s.piece(1), s.piece(2)].sort(), `the design's bodies: ${second.ids.join(", ")}`);
    for (const id of second.ids) near(second.bodies[id].volume, 10400);
    near(second.total, 41600);
    // Each box keeps its id on its front chunk; B's back chunk is still piece 1 (Body 3), found by its faces, and A's new
    // back chunk takes the first free number, 2, whichever box was picked first. No piece changed, so no warning.
    assert.deepEqual(second.bodies[s.a].bounds, [[30, 0, 0], [70, 13, 20]]);
    assert.deepEqual(second.bodies[s.b].bounds, [[100, 0, 0], [140, 13, 20]]);
    assert.deepEqual(second.bodies[s.piece(1)].bounds, [[100, 17, 0], [140, 30, 20]]);
    assert.deepEqual(second.bodies[s.piece(2)].bounds, [[30, 17, 0], [70, 30, 20]]);
    assert.ok(r.status === "built" && r.pieces === undefined, JSON.stringify(r.status === "built" && r.pieces));
    assert.deepEqual(second.doc.bodies!.find((x) => x.id === s.piece(1)), three);
    assert.equal(second.doc.bodies!.find((x) => x.id === s.piece(2))!.number, 4);

    // Saved and opened afresh, it builds the same four bodies, and nothing in the data changes.
    const fresh = await built(reopened(second.doc));
    assert.deepEqual(fresh.bodies, second.bodies);
    assert.deepEqual(fresh.doc, second.doc);
    // The edit undone (the document as it was before it): 44,000 in three bodies again.
    const undone = await built(first.doc);
    assert.deepEqual(undone.bodies, first.bodies);
    near(undone.total, 44000);
  });

test("hand-worked: a Cut through three bars, the first whole again and the third newly split: the second bar's piece keeps its number and its chunk", async () => {
  // Bars 100 × 20 × 10: A at the origin, B at y 30..50, C lifted to z 30..40. Move 3 lifts A and C together by 5: A is at
  // z 5..15, C at z 35..45. Extrude 1 cuts the slot x 30..40, y −10..60, z 0..20 through A, B and C in that order: it
  // misses C (above it), and cuts A and B right across. Each keeps its near end x 0..30 (its left end, x = 0, is whole
  // there) and the far ends x 40..100 (60 × 20 × 10 = 12,000 each) are piece 1 (A's) and piece 2 (B's).
  let doc = partDocument("box", 100, 20, 10);
  const a = `body:${doc.timeline.features[0].id}`;
  const boxB = insertPreset(doc, "box", 100, 20, 10);
  const b = `body:${boxB.id}`;
  doc = insertMove(boxB.doc, [b], { ...NO_MOVE, y: 30 }).doc;
  const boxC = insertPreset(doc, "box", 100, 20, 10);
  const c = `body:${boxC.id}`;
  doc = insertMove(boxC.doc, [c], { ...NO_MOVE, z: 30 }).doc;
  const lift = insertMove(doc, [a, c], { ...NO_MOVE, z: 5 });
  const e = extruded(lift.doc, [30, -10], [40, 60], 20, { operation: "cut", bodies: [a, b, c] });
  const [p1, p2] = [`body:${e.id}/piece:1`, `body:${e.id}/piece:2`];
  const first = await built(e.doc);
  assert.deepEqual(first.ids, [a, b, c, p1, p2].sort());
  assert.deepEqual(first.bodies[p1].bounds, [[40, 0, 5], [100, 20, 15]]);
  assert.deepEqual(first.bodies[p2].bounds, [[40, 30, 0], [100, 50, 10]]);
  // A and B: 6,000 + 12,000 each; C whole, 20,000: 56,000.
  near(first.total, 56000);
  const number = first.doc.bodies!.find((x) => x.id === p1)!.number;

  // Move 3 edited to −25: A is at z −25..−15, below the slot (whole again, 20,000), and C at z 5..15, cut right across.
  // B's far end has the faces piece 2 was numbered with, so it stays piece 2. C's far end x 40..100 has C's faces, which
  // no remembered piece has: it takes the lowest free number, 1, which was A's far end's, so Extrude 1 says so.
  const second = await built(changedMove(first.doc, lift.id, { ...NO_MOVE, z: -25 }));
  const r = second.build.results[e.id];
  assert.equal(r.status, "built", JSON.stringify(r));
  assert.deepEqual(second.ids, [a, b, c, p1, p2].sort(), `the design's bodies: ${second.ids.join(", ")}`);
  near(second.bodies[a].volume, 20000);
  near(second.bodies[b].volume, 6000);
  near(second.bodies[c].volume, 6000);
  assert.deepEqual(second.bodies[p2].bounds, [[40, 30, 0], [100, 50, 10]]);
  assert.deepEqual(second.bodies[p1].bounds, [[40, 0, 5], [100, 20, 15]]);
  // The same 56,000: A whole 20,000, B 18,000, C 18,000.
  near(second.total, 56000);
  assert.deepEqual(r.status === "built" && r.pieces, { renumbered: [p1], message: `Extrude 1's pieces changed since they were numbered, so Body ${number} may now be another piece: check the items that use it, then edit Extrude 1 to keep its pieces as they are now` });
  // Editing Extrude 1 confirms its pieces as they are now: the same five bodies, no warning.
  const third = await built(forgetPieces(second.doc, e.id, [p1]));
  const r3 = third.build.results[e.id];
  assert.ok(r3.status === "built" && r3.pieces === undefined, JSON.stringify(r3));
  assert.deepEqual(third.bodies, second.bodies);
});

// ---------------------------------------------------------------- the numbering itself (boolean-names.ts `pieceIds`)

test("hand-worked: an item's pieces are numbered once: a remembered piece keeps its number wherever it comes, the rest take the lowest numbers no piece has", () => {
  const ids = (faces: string[][], remembered: [string, string[]][], own?: string, first?: number) => pieceIds("feature-9", faces, new Map(remembered), own, first);
  const P = (k: number) => `body:feature-9/piece:${k}`;
  // Nothing remembered: 1, 2, 3 in the order given (section 8: counted on across every body the item splits).
  assert.deepEqual(ids([["face:a"], ["face:b"], ["face:c"]], []), { ids: [P(1), P(2), P(3)], renumbered: [], next: 4 });
  // The case above (SL #538 item 1): piece 1 was numbered with B's faces, and A's new chunk comes before it. B's chunk
  // stays piece 1 and A's takes 2, the lowest number no piece has; nothing was renumbered.
  assert.deepEqual(ids([["face:a"], ["face:b"]], [[P(1), ["face:b"]]]), { ids: [P(2), P(1)], renumbered: [], next: 3 });
  // The other way round: piece 2 remembered on the first piece, then a new one: it takes 1, never 2 again.
  assert.deepEqual(ids([["face:b"], ["face:c"]], [[P(2), ["face:b"]]]), { ids: [P(2), P(1)], renumbered: [], next: 3 });
  // A remembered piece no piece has the faces of: its number goes by rank to a piece without one, and it is named.
  assert.deepEqual(ids([["face:c"], ["face:b"]], [[P(1), ["face:a"]], [P(2), ["face:b"]]]), { ids: [P(1), P(2)], renumbered: [P(1)], next: 3 });
  // A high remembered number stays; the others fill in from 1, and the next free number is above them all.
  assert.deepEqual(ids([["face:a"], ["face:b"], ["face:c"]], [[P(7), ["face:b"]]]), { ids: [P(1), P(7), P(2)], renumbered: [], next: 8 });
  // Faces are compared as sets: their order and a name given twice change nothing.
  assert.deepEqual(ids([["face:y", "face:x", "face:y"]], [[P(3), ["face:x", "face:y"]]]).ids, [P(3)]);
  // Two pieces with the same faces are never guessed between: the numbers go by rank, and the remembered one is named
  // when the piece taking it has other faces.
  assert.deepEqual(ids([["face:a"], ["face:a"]], [[P(2), ["face:a"]]]), { ids: [P(1), P(2)], renumbered: [], next: 3 });
  assert.deepEqual(ids([["face:b"], ["face:a"], ["face:a"]], [[P(1), ["face:a"]]]), { ids: [P(1), P(2), P(3)], renumbered: [P(1)], next: 4 });
  // Nor are two remembered pieces with the same faces: neither is matched, so the one piece takes the lowest number.
  assert.deepEqual(ids([["face:a"]], [[P(2), ["face:a"]], [P(3), ["face:a"]]]), { ids: [P(1)], renumbered: [], next: 2 });
  // Another item's pieces and ids that are no piece's are not this item's memory.
  assert.deepEqual(ids([["face:a"]], [["body:feature-8/piece:4", ["face:a"]], ["body:feature-9", ["face:a"]], ["body:feature-9/piece:04", ["face:a"]]]).ids, [P(1)]);
  // Counted from `first` when asked (a boolean after others, with nothing remembered).
  assert.deepEqual(ids([["face:a"], ["face:b"]], [], undefined, 3), { ids: [P(3), P(4)], renumbered: [], next: 5 });
  // An Extrude join's own body is number 1 and its piece k number k + 1: the first by rank is the extrude's own, and a
  // remembered piece 1 (number 2) stays where its faces are.
  const own = "body:feature-9";
  assert.deepEqual(ids([["face:a"], ["face:b"]], [], own), { ids: [own, P(1)], renumbered: [], next: 2 });
  assert.deepEqual(ids([["face:a"], ["face:b"]], [[P(1), ["face:a"]]], own), { ids: [P(1), own], renumbered: [], next: 2 });
  assert.deepEqual(ids([["face:a"], ["face:b"]], [[own, ["face:b"]]], own), { ids: [P(1), own], renumbered: [], next: 2 });
  // No two pieces ever get one id, whatever is remembered: every way of remembering up to three of four pieces' faces
  // (and one no piece has) under the numbers 1 to 4.
  const faces = [["face:a"], ["face:b"], ["face:c"], ["face:d"]];
  const names = ["face:a", "face:b", "face:c", "face:z"];
  let tried = 0;
  for (let code = 0; code < 5 ** 3; code++) {
    const numbers = [code % 5, Math.floor(code / 5) % 5, Math.floor(code / 25)];
    if (new Set(numbers.filter((k) => k > 0)).size !== numbers.filter((k) => k > 0).length) continue;
    const remembered = numbers.flatMap((k, i): [string, string[]][] => (k === 0 ? [] : [[P(k), [names[i]]]]));
    const got = ids(faces, remembered).ids;
    assert.equal(new Set(got).size, 4, `${JSON.stringify(remembered)} gave ${got.join(", ")}`);
    for (const [id, [name]] of remembered) if (name !== "face:z") assert.equal(got[names.indexOf(name)], id, `${JSON.stringify(remembered)} gave ${got.join(", ")}`);
    tried++;
  }
  // 1 (none remembered) + 3 × 4 (one) + 3 × 4 × 3 (two) + 4 × 3 × 2 (three) = 73 ways.
  assert.equal(tried, 73);
});

// ---------------------------------------------------------------- the guard: an id written twice fails the item

/** rebuild.ts with `find` replaced by `replace`, loaded from a copy outside the repo whose imports point back at src/ and the packages (body-ids.test.ts's way). */
async function plantedRebuild(name: string, find: string, replace: string, dir: string): Promise<Rebuild> {
  const source = new URL("../src/rebuild.ts", import.meta.url);
  const text = readFileSync(source, "utf8");
  const at = text.indexOf(find);
  assert.ok(at >= 0 && text.indexOf(find, at + 1) < 0, `${name}: the text to replace must be in rebuild.ts exactly once: ${find}`);
  const planted = (text.slice(0, at) + replace + text.slice(at + find.length)).replace(/from "\.\/([^"]+)"/g, (_, f) => `from "${new URL(f, source).href}"`).replace(/from "(@fission\/[a-z]+)"/g, (_, p) => `from "${import.meta.resolve(p)}"`);
  const file = join(dir, `rebuild-${name}.ts`);
  writeFileSync(file, planted);
  return (await import(pathToFileURL(file).href)) as Rebuild;
}

test("a planted collision: were two of an item's bodies ever given one id, the item fails in words and no body changes, rather than one overwriting the other", async () => {
  const dir = mkdtempSync(join(tmpdir(), "piece-id-plants-"));
  try {
    const s = twoBoxes("A first");
    const first = await built(s.doc);
    // Both boxes cut right across, as in the hand-worked case: two pieces to number, one from each boolean.
    const edited = changedMove(first.doc, s.moveA, { ...NO_MOVE, x: 30 });
    // The copy unplanted builds as the real one, so a failure below is the plant's and not the copying's.
    const clean = await built(edited, await plantedRebuild("none", "let firstPiece = 1;", "let firstPiece = 1;", dir));
    assert.deepEqual(clean.ids, [s.a, s.b, s.piece(1), s.piece(2)].sort());
    near(clean.total, 41600);
    const numbering = "pieceIds(f.id, numbered.map((id) => pieceFaces[id]), remembered, own)";
    const naming = "combineNames(f.id, op, t, ts, result, views, firstPiece, undefined, own)";
    const plants = [
      // The item's numbering answers with its first piece's id for every piece: A's chunk is given 2 (as above), so both would be piece 2.
      { name: "all-first", find: numbering, replace: `((s) => ({ ...s, ids: s.ids.map(() => s.ids[0]) }))(${numbering})`, id: s.piece(2) },
      // Each boolean's pieces counted from 1 again (section 8: "never gives two piece:1"): caught as the second boolean's is written.
      { name: "count-again", find: "        firstPiece++;\n", replace: "", id: s.piece(1) },
      // One boolean names every body it leaves as the body it cut: A's two chunks would both be A.
      { name: "all-keeper", find: naming, replace: `((n) => ("failed" in n ? n : { ...n, bodies: n.bodies.map((b) => ({ ...b, id: n.bodies[0].id })) }))(${naming})`, id: s.a },
    ];
    for (const plant of plants) {
      const got = await built(edited, await plantedRebuild(plant.name, plant.find, plant.replace, dir));
      // Failed in words, naming the id; all or none: both boxes whole as before the extrude, 2 × 24,000, and its own body
      // (the slot's prism) is no body of the design.
      assert.deepEqual(got.build.results[s.e], { status: "failed", cause: "error", message: `Extrude 1 can't be made: two of its bodies would both be ${plant.id}, so one would be lost (a fault in SpindleLabs, not in the design)` }, plant.name);
      assert.deepEqual(got.ids, [s.a, s.b].sort(), plant.name);
      near(got.total, 48000);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
