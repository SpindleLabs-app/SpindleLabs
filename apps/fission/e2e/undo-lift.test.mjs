// Where Undo and Redo go over an open phone sheet (src/undo-lift.ts `liftedBottom`), worked by hand. The browser side
// (real taps at 320, 375 and 393 px) is in e2e/phone-undo-sheet.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { GAP, liftedBottom } from "../src/undo-lift.ts";

// A 375 × 667 phone's view: the pair's container runs from y 100 to y 560; the Properties sheet's top is at y 387.
const TOP = 100;
const FOOT = 560;
const SHEET = 387;

test("no sheet open: the pair stays in its corner", () => {
  assert.equal(liftedBottom(552, 48, TOP, FOOT, null), null);
});

test("a sheet over the pair lifts it 8 px clear of the sheet's top", () => {
  // The sheet's top is 560 − 387 = 173 px above the container's foot, so the pair's bottom goes 173 + 8 = 181 px up.
  assert.equal(GAP, 8);
  assert.equal(liftedBottom(552, 48, TOP, FOOT, SHEET), 181);
});

test("a pair already clear of the sheet by the gap stays; one pixel less and it is lifted", () => {
  // Its bottom at 387 − 8 = 379 is exactly clear; at 380 it would be 7 px from the edge.
  assert.equal(liftedBottom(379, 48, TOP, FOOT, SHEET), null);
  assert.equal(liftedBottom(380, 48, TOP, FOOT, SHEET), 181);
});

test("a sheet taller than the view leaves the pair at the view's top, never off it", () => {
  // Sheet top at 120: 560 − 120 + 8 = 448 up would put the pair's top at 560 − 448 − 48 = 64, above the container (100).
  // The highest it may go: 560 − 100 − 48 − 8 = 404, the pair's top then 8 px under the container's top.
  assert.equal(liftedBottom(552, 48, TOP, FOOT, 120), 404);
  // And a container too short for the pair at all: 0, its corner.
  assert.equal(liftedBottom(552, 48, 530, FOOT, 540), 0);
});
