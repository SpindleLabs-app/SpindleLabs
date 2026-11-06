// A Combine's numbered pieces keep their ids by their faces (hunt 11-06): an
// earlier edit that changes the pieces' sizes (and so their rank order)
// never moves a piece's id to another piece silently. The data remembers
// each piece's faces when it is first numbered (version 9, `faces` in the
// bodies list); a rebuild gives the id to the piece with those faces, and
// when none has them, gives it by rank order with a warning on the Combine.
// Volumes worked out by hand in the comments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/** `doc` built, with its pieces numbered (and their faces remembered) as the workspace takes them in after a rebuild. */
async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, doc: numberPieces(doc, Object.keys(build.bodies), builtPieceFaces(build)), volume: async (b: string) => (await cache.view(build.bodies[b].handle)).volume };
}

/** Through JSON, as a file is saved and opened. */
const reopened = (doc: DesignDocument) => readDesignDocument(JSON.parse(JSON.stringify(doc)));

/**
 * Bar x 0..100, y 0..20, z 0..10 (feature-1, Body 1). Slot A 10 × 40 × 20 at (20, −10, −5): x 20..30 (Body 2). Slot B
 * the same at (50, −10, −5): x 50..60 (Body 3). Combine 1 cuts the bar with both; then Box 3 10 × 10 × 10 at
 * (95, 5, 5) (Body 6) is joined to Combine 1's piece 1 by Combine 2.
 */
async function twoSlots() {
  let doc = partDocument("box", 100, 20, 10);
  const bar = doc.timeline.features[0].id;
  let a: string, b: string;
  ({ doc, id: a } = insertPreset(doc, "box", 10, 40, 20));
  doc = insertMove(doc, [`body:${a}`], { ...NO_MOVE, x: 20, y: -10, z: -5 }).doc;
  ({ doc, id: b } = insertPreset(doc, "box", 10, 40, 20));
  const moveB = insertMove(doc, [`body:${b}`], { ...NO_MOVE, x: 50, y: -10, z: -5 });
  doc = moveB.doc;
  const c1 = insertCombine(doc, `body:${bar}`, [`body:${a}`, `body:${b}`], "cut");
  const first = await built(c1.doc);
  const firstVolumes = [await first.volume(`body:${c1.id}/piece:1`), await first.volume(`body:${c1.id}/piece:2`)];
  await first.cache.close();
  let box3: string;
  ({ doc, id: box3 } = insertPreset(first.doc, "box", 10, 10, 10));
  doc = insertMove(doc, [`body:${box3}`], { ...NO_MOVE, x: 95, y: 5, z: 5 }).doc;
  const c2 = insertCombine(doc, `body:${c1.id}/piece:1`, [`body:${box3}`], "join");
  return { first, firstVolumes, doc: c2.doc, bar, a, b, moveB: moveB.id, c1: c1.id, c2: c2.id };
}

test("hand-worked: moving a slot so the middle piece grows past the far one, Combine 2 stays on the far piece it was made on", async () => {
  const s = await twoSlots();
  // Pieces: near x 0..20 (keeps the bar's id: its left end is whole), middle x 30..50 (20 × 20 × 10 = 4,000),
  // far x 60..100 (40 × 20 × 10 = 8,000). Ranked by their share of the bottom face (the first face reaching all):
  // far (40 × 20 = 800 mm²) before middle (400 mm²): far is piece 1, middle piece 2.
  near(s.firstVolumes[0], 8000);
  near(s.firstVolumes[1], 4000);
  // The far piece's faces: the bar's five it keeps (all but its left end) and slot B's right side, x = 60, it lies on.
  const far = [`face:${s.bar}/back`, `face:${s.bar}/bottom`, `face:${s.bar}/front`, `face:${s.bar}/right`, `face:${s.bar}/top`, `face:${s.b}/right`].sort();
  assert.deepEqual(s.first.doc.bodies!.find((x) => x.id === `body:${s.c1}/piece:1`), { id: `body:${s.c1}/piece:1`, number: 4, faces: far });
  const second = await built(s.doc);
  // 8,000 + 1,000 − 250 (the overlap x 95..100, y 5..15, z 5..10) = 8,750.
  near(await second.volume(`body:${s.c1}/piece:1`), 8750);
  await second.cache.close();
  // The user moves slot B to x 80..90. Middle x 30..80 = 10,000; far x 90..100 = 2,000: by rank the middle is piece 1
  // now. The far piece has the same faces, so it keeps piece 1 and Combine 2 still joins it: 2,000 + 1,000 − 250 = 2,750.
  const edited = changedMove(second.doc, s.moveB, { ...NO_MOVE, x: 80, y: -10, z: -5 });
  const third = await built(edited);
  const r = third.build.results[s.c2];
  assert.equal(r.status, "built", JSON.stringify(r));
  near(await third.volume(`body:${s.c1}/piece:1`), 2750);
  // The middle piece keeps piece 2: 50 × 20 × 10 = 10,000.
  near(await third.volume(`body:${s.c1}/piece:2`), 10000);
  // Every piece found by its faces: no warning, and nothing in the data changes.
  const c1 = third.build.results[s.c1];
  assert.ok(c1.status === "built" && c1.pieces === undefined, JSON.stringify(c1));
  assert.equal(third.doc, edited);
  await third.cache.close();
});

test("a remembered piece no piece matches any more is given by rank order with a warning on its Combine, never silently", async () => {
  const s = await twoSlots();
  const second = await built(s.doc);
  await second.cache.close();
  // Slot B moved to y 5..45: it only notches the bar (y 5..20 of 0..20), so the bar is in two pieces, near (x 0..20)
  // and the rest (x 30..100 less the notch x 50..60, y 5..20). The rest has slot B's three notch faces, so neither the
  // far piece's faces nor the middle's: piece 1 goes to the rest by rank order, and Combine 1 says so.
  const edited = changedMove(second.doc, s.moveB, { ...NO_MOVE, x: 50, y: 5, z: -5 });
  const third = await built(edited);
  const c1 = third.build.results[s.c1];
  assert.equal(c1.status, "built", JSON.stringify(c1));
  assert.deepEqual(c1.status === "built" && c1.pieces, { message: "Combine 1's pieces changed since they were numbered, so Body 4 may now be another piece: check the items that use it" });
  // The rest: 70 × 20 × 10 − 10 × 15 × 10 = 14,000 − 1,500 = 12,500; joined with Box 3: + 1,000 − 250 = 13,250.
  near(await third.volume(`body:${s.c1}/piece:1`), 13250);
  assert.equal(third.build.bodies[`body:${s.c1}/piece:2`], undefined, "no middle piece any more");
  // What the piece was numbered with stays remembered, so the warning stays while the pieces differ.
  assert.deepEqual(third.doc.bodies, second.doc.bodies);
  await third.cache.close();
});

test("an old version 8 file with pieces opens and gets each piece's faces, as its Combine made it, on its first build", async () => {
  const s = await twoSlots();
  const second = await built(s.doc);
  await second.cache.close();
  // As a version 8 SpindleLabs saved it: the same numbers, no faces.
  const v8 = { ...JSON.parse(JSON.stringify(second.doc)), version: 8 };
  for (const b of v8.bodies) delete b.faces;
  const opened = readDesignDocument(v8);
  assert.equal(opened.version, 9);
  assert.ok(opened.bodies!.every((b) => b.faces === undefined));
  const first = await built(opened);
  await first.cache.close();
  // Piece 1's faces as Combine 1 made it (the far piece), not as Combine 2 left it (Box 3 joined on): the same as the
  // version 9 file remembers. Nothing else changes.
  assert.deepEqual(first.doc.bodies, second.doc.bodies);
  assert.equal(first.doc.nextBody, second.doc.nextBody);
  // A version 8 file holding faces is refused: version 9 brought them.
  assert.throws(() => readDesignDocument({ ...JSON.parse(JSON.stringify(second.doc)), version: 8 }), { message: "Design data says version 8 but has pieces' faces, which version 9 brought" });
  assert.throws(() => readDesignDocument({ ...JSON.parse(JSON.stringify(second.doc)), version: 6 }), { message: "Design data says version 6 but has pieces' faces, which version 9 brought" });
});

test("a piece's faces are saved and read back, and a later build never changes them", async () => {
  const s = await twoSlots();
  const second = await built(s.doc);
  await second.cache.close();
  const back = reopened(second.doc);
  assert.deepEqual(back, second.doc);
  assert.ok(back.bodies!.filter((b) => b.id.includes("/piece:")).every((b) => b.faces !== undefined && b.faces.length > 0));
  const again = await built(back);
  await again.cache.close();
  assert.equal(again.doc, back, "nothing to number or fill");
});

/** A valid file with pieces, broken by `mutate`; refused with `message`. */
async function brokenPieces() {
  const s = await twoSlots();
  const second = await built(s.doc);
  await second.cache.close();
  const data = JSON.parse(JSON.stringify(second.doc));
  const piece = data.bodies.findIndex((b: { id: string }) => b.id === `body:${s.c1}/piece:1`);
  const refused = (mutate: (d: Record<string, any>) => void, message: string) => {
    const d = JSON.parse(JSON.stringify(data));
    mutate(d);
    assert.throws(() => readDesignDocument(d), { message });
  };
  return { data, piece, refused, id: `body:${s.c1}/piece:1`, c1: s.c1 };
}

test("a piece's faces are checked when a file opens: each break refused in words", async () => {
  const { data, piece, refused, id } = await brokenPieces();
  assert.deepEqual(readDesignDocument(data), data, "the file as saved opens");
  refused((d) => (d.bodies[0].faces = ["face:feature-1/top"]), "Design body body:feature-1 has faces, which only a Combine's piece remembers");
  refused((d) => (d.bodies[piece].faces = []), `Design body ${id}'s faces are not a list of face names`);
  refused((d) => (d.bodies[piece].faces = "face:feature-1/top"), `Design body ${id}'s faces are not a list of face names`);
  refused((d) => (d.bodies[piece].faces = null), `Design body ${id}'s faces are not a list of face names`);
  refused((d) => d.bodies[piece].faces.push(3), `Design body ${id}'s face 3 is not a face's name`);
  refused((d) => d.bodies[piece].faces.push(["face:x/top"]), `Design body ${id}'s face a list is not a face's name`);
  refused((d) => d.bodies[piece].faces.push("edge:feature-1/top"), `Design body ${id}'s face "edge:feature-1/top" is not a face's name`);
  refused((d) => d.bodies[piece].faces.push(d.bodies[piece].faces[0]), `Design body ${id} lists face ${data.bodies[piece].faces[0]} twice`);
});

test("500,000 piece face names over the whole design open; 500,001 are refused before they are looked at", async () => {
  const { data, piece } = await brokenPieces();
  const other = data.bodies.findIndex((b: { id: string }, i: number) => i !== piece && b.id.includes("/piece:"));
  const names = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `face:many/${from + i}`);
  // The limit is on all pieces together: 499,999 on one and 1 on the other is 500,000.
  const at = JSON.parse(JSON.stringify(data));
  at.bodies[piece].faces = names(499_999);
  at.bodies[other].faces = names(1, 499_999);
  assert.equal(readDesignDocument(at).bodies![piece].faces!.length, 499_999);
  // 499,999 + 2 = 500,001: one past, and the second list's bad name never read (the count comes first).
  at.bodies[other].faces = [...names(1, 499_999), 7];
  assert.throws(() => readDesignDocument(at), { message: "Design data's pieces have at least 500001 face names together, more than the 500000 this SpindleLabs opens" });
});
