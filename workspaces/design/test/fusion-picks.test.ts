// SL #524 items 3 and 4 (app bug hunt 2026-11-11), Fusion's way: Ctrl (Cmd on a Mac) adds a Bodies row to the selection
// as Shift does, and with Select a click on a dimension's number picks the dimension. The browser's side is checked in
// apps/fission/e2e/fusion-picks.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addsToSelection } from "../src/select-keys.ts";
import { labelPicks } from "../src/sketch-select.ts";
import { partDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawCircle, drawLine } from "../src/sketch.ts";

test("item 3: Shift, Ctrl or Cmd adds; a plain click, or Alt alone, replaces", () => {
  const keys = (shiftKey: boolean, ctrlKey: boolean, metaKey: boolean) => ({ shiftKey, ctrlKey, metaKey });
  assert.equal(addsToSelection(keys(false, false, false)), false);
  assert.equal(addsToSelection(keys(true, false, false)), true);
  assert.equal(addsToSelection(keys(false, true, false)), true, "Ctrl adds (it replaced the selection)");
  assert.equal(addsToSelection(keys(false, false, true)), true, "Cmd adds");
  assert.equal(addsToSelection({ ...keys(false, false, false), altKey: true } as never), false);
});

/** A sketch with a line dimensioned (constraint-1) and a circle with a diameter (constraint-2). */
function sized(): Sketch {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s.doc, s.id, [0, 0], [10, 0]);
  const c = drawCircle(l.doc, s.id, [30, 0], 5);
  const sketch = c.doc.sketches.find((q) => q.id === s.id)!;
  const line = sketch.curves.find((q) => q.id === l.id)!;
  if (line.kind !== "line") throw new Error("no line");
  return { ...sketch, constraints: [{ id: "constraint-1", kind: "distance", a: line.start, b: line.end, value: 10 }, { id: "constraint-2", kind: "diameter", circle: c.id, value: 10 }] };
}

test("item 4, hand-worked: a click on a dimension's label picks only it; Shift adds or takes it out", () => {
  const s = sized();
  const line = s.curves[0].id;
  assert.deepEqual(labelPicks(s, [], "constraint-1", false), ["constraint-1"]);
  assert.deepEqual(labelPicks(s, [line], "constraint-1", false), ["constraint-1"], "a plain click replaces the line picked");
  assert.deepEqual(labelPicks(s, [line], "constraint-1", true), [line, "constraint-1"], "Shift adds it");
  assert.deepEqual(labelPicks(s, [line, "constraint-1"], "constraint-1", true), [line], "Shift on it again takes it out");
  assert.deepEqual(labelPicks(s, ["constraint-1", "gone-9"], "constraint-2", true), ["constraint-1", "constraint-2"], "a pick no longer in the sketch is dropped");
});

test("item 4: a label that is no dimension of the sketch (a fit tag's own) or no sketch picks nothing", () => {
  const s = sized();
  assert.equal(labelPicks(s, ["constraint-1"], "fit:circle-9", false), null);
  assert.equal(labelPicks(undefined, [], "constraint-1", false), null);
});
