// The sketch's Undo fence against a step folded away by its settle (app-wide hunt 2026-11-14, R-4): `amendStep` drops a
// step whose settled design is the one before it, and took the fence's floor out with it, so Undo inside an open sketch
// went back past the sketch's start (the thing the fence is there to stop, issue #520).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../src/model/history.ts";

function make() {
  let project = "A";
  let t = 0;
  const h = createHistory({ capture: () => project, restore: (s) => void (project = s), now: () => (t += 5000) });
  return { h, set: (p: string) => void (project = p), get: () => project };
}

test("control: a fence at the present stops Undo there", () => {
  const { h, set } = make();
  set("B");
  h.record("Extrude");
  set("C");
  h.record("Change width");
  h.fence(); // Edit Sketch opened at C
  assert.equal(h.canUndo(), false, "nothing of the sketch's own to undo yet");
  assert.equal(h.undo(), null);
});

test("the fenced step settled back to the design before it: Undo must still stop at the sketch's start", () => {
  const { h, set, get } = make();
  set("B");
  h.record("Extrude");
  set("C");
  h.record("Change width");
  const step = h.present(); // the edit whose settle is still with the kernel
  h.fence(); // Edit Sketch opened at once, at C
  // The settle lands: the settled design is the one before the edit (B), so the step folds away (amendStep's own rule).
  set("B"); // the settle writes the design, then its step
  assert.equal(h.amendStep(step, () => "B"), true);
  // Hand working: the sketch was opened at the present; the present is now B (the same design as the step before), and
  // nothing has been drawn in the sketch, so there is nothing of the sketch's own to undo: canUndo false, the Extrude
  // made before the sketch stays (history.ts fence: "undo, redo and jumpTo never go back past the present as it is now").
  assert.equal(h.canUndo(), false, `Undo is offered inside the sketch: "${h.undoLabel()}"`);
  h.undo();
  assert.equal(get(), "B", "the Extrude made before the sketch was opened is still there");
});
