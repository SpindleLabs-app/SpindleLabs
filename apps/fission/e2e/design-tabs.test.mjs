// What the design tabs keep in memory for the tabs not on screen (src/design-tabs.ts `trimViews`; tabs hunt C6, D1,
// D2): nothing for a project that is no longer a tab, and at most VIEWS_CHAR_BUDGET characters of undo snapshots in
// all, the tab left longest ago dropped first. The browser side is e2e/tabs.mjs ("tabs hunt C6/D1").
import assert from "node:assert/strict";
import { test } from "node:test";
import { STEPS_CHAR_LIMIT } from "@fission/storage";
import { trimViews, viewChars, VIEWS_CHAR_BUDGET } from "../src/design-tabs.ts";

/** A view whose undo snapshots are `sizes` characters long. */
const view = (...sizes) => ({ history: { kept: sizes.map((n, i) => ({ snapshot: "x".repeat(n), label: `step ${i}`, mergeKey: undefined, at: i })), index: sizes.length - 1 }, selection: [], camera: null });

test("a view's size is the characters of its undo snapshots", () => {
  // Snapshots of 10 and 30 characters: 10 + 30 = 40. Labels and the rest are not counted.
  assert.equal(viewChars(view(10, 30)), 40);
  assert.equal(viewChars({}), 0, "a view with no history counts nothing");
});

test("the budget is the one each project's steps get in storage (step 89)", () => {
  assert.equal(VIEWS_CHAR_BUDGET, STEPS_CHAR_LIMIT);
  assert.equal(VIEWS_CHAR_BUDGET, 8_000_000);
});

test("a view whose tab is gone is dropped", () => {
  const views = new Map([["a", view(1)], ["b", view(1)], ["c", view(1)]]);
  trimViews(views, ["a", "c"], 100);
  assert.deepEqual([...views.keys()], ["a", "c"]);
});

test("past the budget the tab left longest ago goes first, until the rest fit (worked by hand)", () => {
  // Left in the order a (40), b (50), c (30): 40 + 50 + 30 = 120 > 100, so a goes (the first left); 50 + 30 = 80 <= 100, so b and c stay.
  const views = new Map([["a", view(10, 30)], ["b", view(50)], ["c", view(30)]]);
  trimViews(views, ["a", "b", "c"], 100);
  assert.deepEqual([...views.keys()], ["b", "c"]);
});

test("0.9 × the budget keeps every view; 1.1 × drops the oldest", () => {
  const budget = 1000;
  // Two views of 450 each: 900 = 0.9 × 1000, within the budget.
  const under = new Map([["a", view(450)], ["b", view(450)]]);
  trimViews(under, ["a", "b"], budget);
  assert.deepEqual([...under.keys()], ["a", "b"]);
  // Two views of 550 each: 1100 = 1.1 × 1000, past it: a (left first) goes, 550 is left.
  const over = new Map([["a", view(550)], ["b", view(550)]]);
  trimViews(over, ["a", "b"], budget);
  assert.deepEqual([...over.keys()], ["b"]);
});

test("one view bigger than the whole budget is dropped too", () => {
  const views = new Map([["a", view(1500)]]);
  trimViews(views, ["a"], 1000);
  assert.deepEqual([...views.keys()], []);
});
