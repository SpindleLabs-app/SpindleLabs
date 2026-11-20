// SL #507 "Pieces are named three ways": a Move of a Combine's piece says
// "a piece of Combine 1", as Copy, Combine, Extrude, Chamfer and the
// Browser's words do; a Move of a whole body keeps the item's name.
// Every expected summary is worked out by hand from moveSummary's pattern
// "<verb> <what> by (x, y, z) mm".

import { test } from "node:test";
import assert from "node:assert/strict";
import { insertCombine } from "../src/combine.ts";
import { bodyIdOf, insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { renameItem } from "../src/timeline-edits.ts";

const summaryOf = (doc: DesignDocument, id: string) => doc.timeline.features.find((f) => f.id === id)!.intent.summary;
const renamed = (doc: DesignDocument, id: string, typed: string) => {
  const r = renameItem(doc, id, typed);
  if ("refused" in r) throw new Error(`refused: ${r.message}`);
  return r.doc;
};

/** Box 1 and Box 2, Combine 1 cutting Box 2 from Box 1, its piece 1 numbered (as the rebuild numbers a piece it makes). */
function cutWithPiece(): { doc: DesignDocument; combine: string; piece: string } {
  const b2 = insertPreset(partDocument("box", 30, 10, 10), "box", 4, 20, 20);
  const c = insertCombine(b2.doc, "body:feature-1", [bodyIdOf(b2.id)], "cut");
  const piece = `body:${c.id}/piece:1`;
  return { doc: numberPieces(c.doc, [piece]), combine: c.id, piece };
}

test("hand-worked: a Move of a Combine's piece reads 'Move a piece of Combine 1 by (0, 0, 50) mm'", () => {
  const { doc, piece } = cutWithPiece();
  const m = insertMove(doc, [piece], { ...NO_MOVE, z: 50 });
  // By hand: one body, the piece; its item is Combine 1; x = y = 0, z = 50.
  assert.equal(summaryOf(m.doc, m.id), "Move a piece of Combine 1 by (0, 0, 50) mm");
  // The provenance still names the item itself (provenance names items, never pieces).
  assert.deepEqual(m.doc.timeline.features.find((f) => f.id === m.id)!.provenance.from.map((r) => r.label), ["Combine 1"]);
  // Saved and opened again, the words are kept as saved.
  assert.equal(summaryOf(readDesignDocument(JSON.parse(JSON.stringify(m.doc))), m.id), "Move a piece of Combine 1 by (0, 0, 50) mm");
});

test("hand-worked: an edited Move of a piece says the piece the same way, its values and its bodies changed", () => {
  const { doc, piece } = cutWithPiece();
  const m = insertMove(doc, [piece], { ...NO_MOVE, z: 50 });
  // Values only: z 50 -> 20.
  assert.equal(summaryOf(changedMove(m.doc, m.id, { ...NO_MOVE, z: 20 }), m.id), "Move a piece of Combine 1 by (0, 0, 20) mm");
  // Bodies given again (the same piece): still the piece's words.
  assert.equal(summaryOf(changedMove(m.doc, m.id, { ...NO_MOVE, x: 5 }, [piece]), m.id), "Move a piece of Combine 1 by (5, 0, 0) mm");
  // Bodies changed to the piece and Box 1's body (the cut's keeper): two bodies, "2 bodies".
  assert.equal(summaryOf(changedMove(m.doc, m.id, { ...NO_MOVE, x: 5 }, [piece, "body:feature-1"]), m.id), "Move 2 bodies by (5, 0, 0) mm");
  // And back to Box 1's body alone: its item's name, Box 1.
  assert.equal(summaryOf(changedMove(m.doc, m.id, { ...NO_MOVE, x: 5 }, ["body:feature-1"]), m.id), "Move Box 1 by (5, 0, 0) mm");
});

test("hand-worked: renaming the Combine renames the piece's Move: 'Move a piece of Cutter by (0, 0, 50) mm'", () => {
  const { doc, combine, piece } = cutWithPiece();
  const m = insertMove(doc, [piece], { ...NO_MOVE, z: 50 });
  assert.equal(summaryOf(renamed(m.doc, combine, "Cutter"), m.id), "Move a piece of Cutter by (0, 0, 50) mm");
});

test("an old Move of a piece saved as 'Move Combine 1 by …' keeps its words when opened, and a rename still follows them", () => {
  const { doc, combine, piece } = cutWithPiece();
  const m = insertMove(doc, [piece], { ...NO_MOVE, z: 50 });
  const old: DesignDocument = { ...m.doc, timeline: { ...m.doc.timeline, features: m.doc.timeline.features.map((f) => (f.id === m.id ? { ...f, intent: { ...f.intent, summary: "Move Combine 1 by (0, 0, 50) mm" } } : f)) } };
  const read = readDesignDocument(JSON.parse(JSON.stringify(old)));
  // Never rewritten by the reader: applied data stays as saved.
  assert.equal(summaryOf(read, m.id), "Move Combine 1 by (0, 0, 50) mm");
  // A rename of the Combine still follows the name in the old words, in the old form.
  assert.equal(summaryOf(renamed(read, combine, "Cutter"), m.id), "Move Cutter by (0, 0, 50) mm");
});

test("control: a Move of a whole body keeps its item's name, made, edited and renamed", () => {
  const { doc } = cutWithPiece();
  const m = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, z: 50 });
  assert.equal(summaryOf(m.doc, m.id), "Move Box 1 by (0, 0, 50) mm");
  assert.equal(summaryOf(changedMove(m.doc, m.id, { ...NO_MOVE, z: 7 }), m.id), "Move Box 1 by (0, 0, 7) mm");
  assert.equal(summaryOf(renamed(m.doc, "feature-1", "Plate"), m.id), "Move Plate by (0, 0, 50) mm");
});
