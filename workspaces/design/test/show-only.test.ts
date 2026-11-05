// Show only this body, and Show all (quick wins, Ben 2026-11-04): from a
// body's menu every other body's eye is shut, as one undo step; Show all
// opens every body's eye and the Bodies folder's. Hand-worked on three
// bodies (the fixture body-numbers.test.ts uses): the box (Body 1, its body
// id body:feature-1), an extrude of a rectangle (Body 2, body:feature-11)
// and a cylinder (Body 3, body:feature-12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertPreset, isHidden, partDocument, EYE_FOLDERS, type DesignDocument } from "../src/document.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { hideBody, hideRow } from "../src/timeline-edits.ts";
import { hiddenBodyCount, showAllBodies, showOnlyBody } from "../src/show-only.ts";

function three(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const extruded = extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc, s.id, 10).doc;
  return insertPreset(extruded, "cylinder", 10, 10, 5).doc;
}
const BODIES = ["body:feature-1", "body:feature-11", "body:feature-12"];
const shut = (d: DesignDocument) => BODIES.filter((b) => isHidden(d, b));

test("hand-worked: show only Body 2 shuts Body 1's and Body 3's eyes and leaves Body 2's open; nothing else changes", () => {
  const d = three();
  const only = showOnlyBody(d, "body:feature-11");
  assert.deepEqual(shut(only), ["body:feature-1", "body:feature-12"]);
  assert.deepEqual(only.timeline, d.timeline, "the timeline is untouched");
  assert.equal(hiddenBodyCount(only), 2);
});

test("show only a hidden body opens its eye; with the Bodies folder shut, the folder opens too, or nothing would show", () => {
  const d = hideBody(three(), "body:feature-12", true);
  assert.deepEqual(shut(showOnlyBody(d, "body:feature-12")), ["body:feature-1", "body:feature-11"]);
  const folderShut = hideRow(three(), EYE_FOLDERS.bodies, true);
  const only = showOnlyBody(folderShut, "body:feature-1");
  assert.equal(isHidden(only, EYE_FOLDERS.bodies), false, "the folder open");
  assert.deepEqual(shut(only), ["body:feature-11", "body:feature-12"]);
});

test("show all opens every body's eye and the Bodies folder's; with nothing hidden it gives the same document back", () => {
  const d = hideRow(showOnlyBody(three(), "body:feature-1"), EYE_FOLDERS.bodies, true);
  assert.equal(hiddenBodyCount(d), 3, "two eyes shut and the folder: all three hidden");
  const all = showAllBodies(d);
  assert.deepEqual(shut(all), []);
  assert.equal(isHidden(all, EYE_FOLDERS.bodies), false);
  assert.equal(hiddenBodyCount(all), 0);
  const plain = three();
  assert.equal(showAllBodies(plain), plain, "nothing to show: the same document");
  // Show only the one body already the only one shown changes nothing either.
  const only = showOnlyBody(plain, "body:feature-1");
  assert.equal(showOnlyBody(only, "body:feature-1"), only);
});

test("a body id that isn't one of the design's bodies is refused, changing nothing", () => {
  assert.throws(() => showOnlyBody(three(), "body:feature-99"), /no body "body:feature-99"/);
  assert.throws(() => showOnlyBody(three(), "feature-1"), /no body "feature-1"/);
});
