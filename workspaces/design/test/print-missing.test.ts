// SL #675 item 3: Slice for printing leaves a body its eye hides out of the print, as the whole design's STL does
// (shownBodyRefs), but said nothing of it; the three exports say it (`hiddenStlNote`). The dialog's missing line and
// each slice's warning now come from `printMissingNote`: the failed items, then the hidden bodies, in the print's words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { failedItemsNote, hiddenStlNote, printMissingNote, shownBodyRefs } from "../src/actions.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { hideBody } from "../src/timeline-edits.ts";

/** Box 1 (feature-1, Body 1), Box 2 (Body 2) and Box 3 (Body 3), each a whole new body. */
function three(): DesignDocument {
  const two = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc;
  return insertPreset(two, "box", 5, 5, 5).doc;
}

test("hand-worked: a body hidden by its eye is named in the print's missing words, as the STL names it", () => {
  const doc = three();
  const body2 = shownBodyRefs(doc)[1].id as string;
  const hidden = hideBody(doc, body2, true);
  // The print takes the shown bodies only (Bodies 1 and 3), so Body 2 is left out and said, in the print's words.
  assert.equal(shownBodyRefs(hidden).length, 2);
  assert.equal(printMissingNote(hidden), "Body 2 is hidden, so it is not in the print: show it with its eye in the browser to include it.");
  // The STL's own words are unchanged.
  assert.equal(hiddenStlNote(hidden), "Body 2 is hidden, so it is not in the STL: show it with its eye in the browser to include it.");
});

test("hand-worked: two hidden bodies are listed smallest first; nothing hidden or failed says nothing", () => {
  const doc = three();
  const [b1, , b3] = shownBodyRefs(doc).map((r) => r.id as string);
  const hidden = hideBody(hideBody(doc, b3, true), b1, true);
  assert.equal(printMissingNote(hidden), "Bodies 1 and 3 are hidden, so they are not in the print: show them with their eyes in the browser to include them.");
  assert.equal(printMissingNote(doc), "");
});

test("a failed item and a hidden body are both said, the failed item first", () => {
  const doc = three();
  const hidden = hideBody(doc, shownBodyRefs(doc)[2].id as string, true);
  const failed = new Set(["feature-1"]);
  // feature-1 failed: Box 1 builds no body, so the bodies left are Box 2 (Body 2) and the hidden Box 3 (Body 3).
  assert.equal(printMissingNote(hidden, failed), `${failedItemsNote(hidden, failed, "print")} Body 3 is hidden, so it is not in the print: show it with its eye in the browser to include it.`);
});
