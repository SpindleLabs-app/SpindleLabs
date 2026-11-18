// The sides of a sideways-scrolling row with tools out of sight (scroll-more.ts, UI review 2026-11-18 finding 12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { moreSides, SLACK, watchScrollMore } from "../src/scroll-more.ts";

test("hand-worked: the 375 px Design toolbar, 1219 px of tools", () => {
  // Unscrolled: 0 + 375 = 375 < 1219, so tools lie past the right edge only.
  assert.equal(moreSides(0, 375, 1219), "right");
  // Scrolled 400: 400 > 0 on the left, 400 + 375 = 775 < 1219 on the right: both.
  assert.equal(moreSides(400, 375, 1219), "left right");
  // Scrolled to the end, 1219 − 375 = 844: nothing past the right, the left still hidden.
  assert.equal(moreSides(844, 375, 1219), "left");
  // A row whose tools all fit (a wide window): nothing either side.
  assert.equal(moreSides(0, 1280, 900), "");
});

test("edges: within SLACK of an end counts as at it; past it does not", () => {
  // 0.9 and 1.1 of the slack, from both ends.
  assert.equal(moreSides(0.9 * SLACK, 375, 1219), "right");
  assert.equal(moreSides(1.1 * SLACK, 375, 1219), "left right");
  assert.equal(moreSides(844 - 0.9 * SLACK, 375, 1219), "left");
  assert.equal(moreSides(844 - 1.1 * SLACK, 375, 1219), "left right");
});

test("the row is marked and follows its scrolling; stopping lets it go", () => {
  const window = new Window();
  const row = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(row as unknown as Node);
  let left = 0;
  Object.defineProperty(row, "scrollLeft", { get: () => left, configurable: true });
  Object.defineProperty(row, "clientWidth", { get: () => 375, configurable: true });
  Object.defineProperty(row, "scrollWidth", { get: () => 1219, configurable: true });
  const stop = watchScrollMore(row);
  assert.equal(row.classList.contains("scroll-more"), true);
  assert.equal(row.dataset.more, "right");
  left = 844;
  row.dispatchEvent(new window.Event("scroll") as unknown as Event);
  assert.equal(row.dataset.more, "left");
  stop();
  left = 0;
  row.dispatchEvent(new window.Event("scroll") as unknown as Event);
  assert.equal(row.dataset.more, "left"); // no longer followed
  window.close();
});
