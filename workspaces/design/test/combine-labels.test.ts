// SL #677 item 5: the Combine panel and its questions name each body the
// way the Bodies list shows it, and a body the list doesn't show by its
// item, never by a number the list doesn't have or by a raw id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyLabel, bodyRows, deleteItem, insertCombine, insertPreset, partDocument } from "../src/index.ts";
import { combineHintWords } from "../src/combine-panel.ts";

/** Box 1 (40 x 30 x 20) and Box 2 (10 mm cube): Body 1 and Body 2. */
function boxes() {
  const doc = partDocument("box", 40, 30, 20);
  const b = insertPreset(doc, "box", 10, 10, 10);
  return { doc: b.doc, box2: b.id };
}

test("a new Combine's picks are named by their Bodies rows", () => {
  const { doc, box2 } = boxes();
  // Two boxes, nothing combined: the list shows Body 1 and Body 2, numbered in the order made.
  assert.deepEqual(bodyRows(doc).map((r) => r.label), ["Body 1", "Body 2"]);
  assert.equal(bodyLabel(doc, "body:feature-1"), "Body 1");
  assert.equal(bodyLabel(doc, `body:${box2}`), "Body 2");
});

test("an edited Combine's tool, used up and so not on the list, is named by its item, not by a number the list lacks", () => {
  const { doc, box2 } = boxes();
  const c = insertCombine(doc, "body:feature-1", [`body:${box2}`], "join");
  // The Join uses Box 2 up: the list shows Body 1 only (no Body 2), so the panel says "Box 2", the timeline's name for it.
  assert.deepEqual(bodyRows(c.doc).map((r) => r.label), ["Body 1"]);
  const f = c.doc.timeline.features.find((x) => x.id === c.id)!;
  assert.equal(bodyLabel(c.doc, `body:${box2}`, undefined, f), "Box 2");
  assert.equal(bodyLabel(c.doc, "body:feature-1", undefined, f), "Body 1");
});

test("an edited Combine whose tool's item was deleted names it by the name it had, never by the raw id", () => {
  const { doc, box2 } = boxes();
  const c = insertCombine(doc, "body:feature-1", [`body:${box2}`], "join");
  const gone = deleteItem(c.doc, box2);
  const f = gone.timeline.features.find((x) => x.id === c.id)!;
  // Box 2 is no longer in the timeline; the Combine remembers it was called "Box 2" when it was made.
  assert.equal(bodyLabel(gone, `body:${box2}`, undefined, f), "Box 2 (deleted)");
  // With no Combine to ask, it is still words, never "body:feature-2".
  assert.equal(bodyLabel(gone, `body:${box2}`), "a deleted body");
});

test("the hint over the view asks for picks only when there are two bodies to pick from", () => {
  // No body: nothing to pick, so it says how to make some.
  assert.equal(combineHintWords("target", 0), "Combine needs two bodies: make them first with Insert or Extrude");
  // One body, the target picked or not: no tool can be picked, so it says to add one.
  assert.equal(combineHintWords("target", 1), "Combine needs two bodies: add another with Insert or Extrude");
  assert.equal(combineHintWords("tools", 1), "Combine needs two bodies: add another with Insert or Extrude");
  // Two bodies: the picking words as before, by the field picking now.
  assert.equal(combineHintWords("target", 2), "Combine: click or tap the body to change");
  assert.equal(combineHintWords("tools", 2), "Now click or tap the bodies to use as tools");
});
