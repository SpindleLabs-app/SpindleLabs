import { test } from "node:test";
import assert from "node:assert/strict";
import { DOUBLE_PICK_MS, DOUBLE_PICK_PX, isDoublePick, type ViewClick } from "../src/double-pick.ts";

const first: ViewClick = { x: 100, y: 200, at: 10_000, touch: false };
const tap: ViewClick = { ...first, touch: true };

test("a second click soon after and close by is a double-click; the gap is measured by hand", () => {
  // 250 ms later, 3 px right and 4 px down: a 3-4-5 triangle, so 5 px away, under the mouse's 6 px and 500 ms.
  assert.equal(isDoublePick(first, { x: 103, y: 204, at: 10_250, touch: false }), true);
  // The same 5 px with a finger: under its 24 px too.
  assert.equal(isDoublePick(tap, { x: 103, y: 204, at: 10_250, touch: true }), true);
  // 9 px right and 12 px down is 15 px (3-4-5 again): too far for a mouse, fine for a finger.
  assert.equal(isDoublePick(first, { x: 109, y: 212, at: 10_250, touch: false }), false);
  assert.equal(isDoublePick(tap, { x: 109, y: 212, at: 10_250, touch: true }), true);
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
    const at = (f: number, sx = 1, sy = 1): ViewClick => ({ x: 100 + sx * 0.6 * px * f, y: 200 + sy * 0.8 * px * f, at: 10_100, touch });
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
