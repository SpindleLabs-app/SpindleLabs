// SL #677 item 5, the coordinator's calls (2026-11-12): while Combine is
// open the Bodies rows say which body is the Target and which are Tools
// (words, not a second colour), and after OK one line over the view says
// what the Combine did and that Undo puts it back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { insertPreset, partDocument } from "../src/index.ts";
import { combineRowTags } from "../src/browser.ts";
import { combineDoneWords } from "../src/combine-panel.ts";

test("the Bodies rows' tags: the target's row says Target, each tool's says Tool, the rest nothing", () => {
  // Three boxes: Body 1, Body 2 and Body 3, rows body-1, body-2 and body-3 (numbered in the order made).
  let doc = partDocument("box", 10, 10, 10);
  const b2 = insertPreset(doc, "box", 5, 5, 5);
  const b3 = insertPreset(b2.doc, "box", 2, 2, 2);
  doc = b3.doc;
  assert.deepEqual([...combineRowTags(doc, new Set(), "body:feature-1", [`body:${b3.id}`])], [["body-1", "Target"], ["body-3", "Tool"]]);
  // Nothing picked yet: no tags.
  assert.deepEqual([...combineRowTags(doc, new Set(), null, [])], []);
  // Two tools: both tagged, Body 1 untagged.
  assert.deepEqual([...combineRowTags(doc, new Set(), `body:${b2.id}`, ["body:feature-1", `body:${b3.id}`])], [["body-1", "Tool"], ["body-2", "Target"], ["body-3", "Tool"]]);
});

test("the line after OK says what each operation did, whether the tools were used up, and that Undo puts it back", () => {
  // Cut, tools used up (Keep tools off, the default): the hunt's suggested words.
  assert.equal(combineDoneWords("Combine 1", "cut", "Body 1", ["Body 2"], false), "Combine 1: Body 2 cut from Body 1 and used up. Undo puts it back as it was.");
  // Join of two tools, kept.
  assert.equal(combineDoneWords("Combine 2", "join", "Body 1", ["Body 2", "Body 3"], true), "Combine 2: Body 2 and Body 3 joined to Body 1, and kept. Undo puts it back as it was.");
  // Join, used up (plural verb agrees).
  assert.equal(combineDoneWords("Combine 1", "join", "Body 1", ["Body 2", "Body 3"], false), "Combine 1: Body 2 and Body 3 joined to Body 1 and used up. Undo puts it back as it was.");
  // Intersect: the target keeps only what it shares.
  assert.equal(combineDoneWords("Combine 3", "intersect", "Body 1", ["Body 2"], false), "Combine 3: Body 1 now keeps only what it shared with Body 2, which was used up. Undo puts it back as it was.");
  assert.equal(combineDoneWords("Combine 3", "intersect", "Body 1", ["Body 2"], true), "Combine 3: Body 1 now keeps only what it shared with Body 2, which was kept. Undo puts it back as it was.");
  // Three tools are listed with commas and "and".
  assert.equal(combineDoneWords("Combine 1", "cut", "Body 1", ["Body 2", "Body 3", "Body 4"], false), "Combine 1: Body 2, Body 3 and Body 4 cut from Body 1 and used up. Undo puts it back as it was.");
});
