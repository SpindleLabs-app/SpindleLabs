// Combine bug hunt 2026-11-06: a hidden Combine piece, then the Combine deleted (or undone away): the document must still save and open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem, hideBody } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

test("hide a Combine's piece, delete the Combine, save: the file opens again", async () => {
  // Bar x 0..100 (feature-1), slot box 10x40x20 (feature-2) moved to x 30..40 (feature-3), Combine cut (feature-4):
  // two pieces, body:feature-1 (x 0..30) and body:feature-4/piece:1 (x 40..100).
  let doc: DesignDocument = partDocument("box", 100, 20, 10);
  doc = insertPreset(doc, "box", 10, 40, 20).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const c = insertCombine(doc, "body:feature-1", ["body:feature-2"], "cut");
  const build = await rebuildTimeline(c.doc, new BodyCache(kernel), kernel);
  const piece = `body:${c.id}/piece:1`;
  assert.ok(piece in build.bodies, "the cut leaves a piece");
  // As the workspace does after the rebuild (workspace.ts `followed`): the piece numbered.
  doc = numberPieces(c.doc, Object.keys(build.bodies));
  // The user shuts the piece's eye, then deletes the Combine (confirmed).
  doc = hideBody(doc, piece, true);
  doc = deleteItem(doc, c.id);
  // The piece's number is gone with its Combine (numberBodies), so the hidden list must not name it either.
  // Saved and opened again: expected to open (the same document).
  const saved = JSON.parse(JSON.stringify(doc));
  assert.doesNotThrow(() => readDesignDocument(saved));
});

test("the same delete undone and redone: redo puts the snapshot back through the file reader (main.ts restoreSnapshot)", async () => {
  const { createHistory } = await import("@fission/core");
  let doc: DesignDocument = partDocument("box", 100, 20, 10);
  doc = insertPreset(doc, "box", 10, 40, 20).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const c = insertCombine(doc, "body:feature-1", ["body:feature-2"], "cut");
  const build = await rebuildTimeline(c.doc, new BodyCache(kernel), kernel);
  doc = hideBody(numberPieces(c.doc, Object.keys(build.bodies)), `body:${c.id}/piece:1`, true);
  // The app's history: snapshots as text, put back by reading them as a file is read (projectFromJson -> readDesignDocument).
  const history = createHistory({ capture: () => JSON.stringify(doc), restore: (s) => (doc = readDesignDocument(JSON.parse(s))) });
  history.step("Delete Combine 1", () => void (doc = deleteItem(doc, c.id)));
  assert.equal(doc.timeline.features.some((f) => f.id === c.id), false);
  history.undo();
  // Undo brings the Combine back with its piece hidden.
  assert.ok(doc.timeline.features.some((f) => f.id === c.id));
  assert.deepEqual(doc.hidden, [`body:${c.id}/piece:1`]);
  // Redo must delete it again, not throw.
  assert.doesNotThrow(() => history.redo());
  assert.equal(doc.timeline.features.some((f) => f.id === c.id), false);
});
