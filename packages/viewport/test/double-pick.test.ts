import { test } from "node:test";
import assert from "node:assert/strict";
import { DOUBLE_PICK_MS, DOUBLE_PICK_PX, isDoublePick, sameView, VIEW_SLACK, type ViewClick } from "../src/double-pick.ts";

/** A camera 100 mm out with no turn, and the same camera looking from the front instead (turned 90° about x: (sin 45°, 0, 0, cos 45°)). */
const HOME = [60, -80, 0, 0, 0, 0, 1];
const FRONT = [0, -100, 0, Math.SQRT1_2, 0, 0, Math.SQRT1_2];

const first: ViewClick = { x: 100, y: 200, at: 10_000, touch: false, shift: false, view: HOME };
const tap: ViewClick = { ...first, touch: true };

test("a second click soon after and close by is a double-click; the gap is measured by hand", () => {
  // 250 ms later, 3 px right and 4 px down: a 3-4-5 triangle, so 5 px away, under the mouse's 6 px and 500 ms.
  assert.equal(isDoublePick(first, { x: 103, y: 204, at: 10_250, touch: false, shift: false, view: HOME }), true);
  // The same 5 px with a finger: under its 24 px too.
  assert.equal(isDoublePick(tap, { x: 103, y: 204, at: 10_250, touch: true, shift: false, view: HOME }), true);
  // 9 px right and 12 px down is 15 px (3-4-5 again): too far for a mouse, fine for a finger.
  assert.equal(isDoublePick(first, { x: 109, y: 212, at: 10_250, touch: false, shift: false, view: HOME }), false);
  assert.equal(isDoublePick(tap, { x: 109, y: 212, at: 10_250, touch: true, shift: false, view: HOME }), true);
});

test("the time limit at 0.9× passes and at 1.1× fails, and the clock never runs backwards", () => {
  assert.equal(isDoublePick(first, { ...first, at: first.at + 0.9 * DOUBLE_PICK_MS }), true);
  assert.equal(isDoublePick(first, { ...first, at: first.at + DOUBLE_PICK_MS }), true); // exactly the limit still counts
  assert.equal(isDoublePick(first, { ...first, at: first.at + 1.1 * DOUBLE_PICK_MS }), false);
  assert.equal(isDoublePick(first, { ...first, at: first.at - 1 }), false); // a clock that went backwards
  assert.equal(isDoublePick(first, { ...first, at: Number.NaN }), false);
});

test("the distance limit at 0.9× passes and at 1.1× fails, for a mouse and a finger, in any direction", () => {
  for (const touch of [false, true]) {
    const px = touch ? DOUBLE_PICK_PX.touch : DOUBLE_PICK_PX.mouse;
    const last = { ...first, touch };
    // (0.6, 0.8) × px × f is exactly px × f away (3-4-5 triangle).
    const at = (f: number, sx = 1, sy = 1): ViewClick => ({ x: 100 + sx * 0.6 * px * f, y: 200 + sy * 0.8 * px * f, at: 10_100, touch, shift: false, view: HOME });
    assert.equal(isDoublePick(last, at(0.9)), true);
    assert.equal(isDoublePick(last, at(1.1)), false);
    assert.equal(isDoublePick(last, at(0.9, -1, -1)), true);
    assert.equal(isDoublePick(last, at(1.1, -1, 1)), false);
  }
});

test("no first click, or a mouse click then a tap, is never a double", () => {
  assert.equal(isDoublePick(null, first), false);
  assert.equal(isDoublePick(first, { ...first, at: first.at + 100, touch: true }), false);
  assert.equal(isDoublePick(tap, { ...tap, at: tap.at + 100, touch: false }), false);
});

test("a Shift-click then a quick plain click (or the other way) is two picks, not a double; Shift on both is a double", () => {
  const shifted = { ...first, shift: true };
  assert.equal(isDoublePick(shifted, { ...first, at: first.at + 100 }), false); // Shift-click adds, the plain click replaces
  assert.equal(isDoublePick(first, { ...shifted, at: first.at + 100 }), false);
  assert.equal(isDoublePick(shifted, { ...shifted, at: first.at + 100 }), true); // Shift+double-click
});

test("a View button between two clicks on the same spot makes them two picks: the camera must be where it was", () => {
  assert.equal(isDoublePick(first, { ...first, at: first.at + 100 }), true);
  assert.equal(isDoublePick(first, { ...first, at: first.at + 100, view: FRONT }), false);
});

test("the camera may differ by rounding only: VIEW_SLACK at 0.9× is the same view, at 1.1× another", () => {
  // The x of 60 mm: the slack is relative, 60 · VIEW_SLACK; a turn component under 1 gets the absolute VIEW_SLACK.
  const moved = (i: number, by: number) => HOME.map((x, j) => (j === i ? x + by : x));
  assert.equal(sameView(HOME, moved(0, 0.9 * 60 * VIEW_SLACK)), true);
  assert.equal(sameView(HOME, moved(0, 1.1 * 60 * VIEW_SLACK)), false);
  assert.equal(sameView(HOME, moved(3, 0.9 * VIEW_SLACK)), true);
  assert.equal(sameView(HOME, moved(3, -1.1 * VIEW_SLACK)), false);
  assert.equal(sameView(HOME, HOME.slice(0, 6)), false); // not a camera at all
  assert.equal(sameView(HOME, moved(1, Number.NaN)), false);
  // As measured on a phone between two taps: 89.26762708614116 then 89.26762708614058 (5.8e-13 apart) is the same view.
  assert.equal(sameView([89.26762708614116], [89.26762708614058]), true);
});
