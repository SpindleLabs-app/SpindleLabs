// Which workspaces DESIGN ▾ lists (src/listed-workspaces.ts), worked by
// hand from Ben's ask of 2026-11-04: the public app lists Design and Slice
// only, in the app's own order; the developers' switch lists all, as given.
// The browser side (the menu, Slice opening Slice for printing, links to
// unlisted workspaces, no Split) is in e2e/workspace-list.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { greyedInMenu, listedWorkspaces, PUBLIC_WORKSPACES } from "../src/listed-workspaces.ts";

const TEN = ["design", "render", "simulate", "manufacture", "laser", "slice", "circuit", "vector", "image", "layout"].map((id) => ({ id }));

test("hand-worked: the public app lists Design and Slice, nothing else (not Image, which works)", () => {
  assert.deepEqual(PUBLIC_WORKSPACES, ["design", "slice"]);
  assert.deepEqual(listedWorkspaces(TEN, false).map((w) => w.id), ["design", "slice"]);
});

test("the switch lists all ten in the app's order, a copy (the list given is never changed)", () => {
  const listed = listedWorkspaces(TEN, true);
  assert.deepEqual(listed.map((w) => w.id), TEN.map((w) => w.id));
  assert.notEqual(listed, TEN);
  listed.pop();
  assert.equal(TEN.length, 10);
});

test("the app's order is kept, not the public list's; a workspace the app lacks is not made up", () => {
  assert.deepEqual(listedWorkspaces([{ id: "slice" }, { id: "image" }, { id: "design" }], false).map((w) => w.id), ["slice", "design"]);
  assert.deepEqual(listedWorkspaces([{ id: "image" }], false), []);
});

test("hand-worked: a placeholder is greyed unless its switch turned its page on; a working workspace never is", () => {
  const testlab = { id: "simulate", status: "placeholder" };
  const design = { id: "design", status: "real" };
  // ?all-workspaces alone: TestLab is still the placeholder, so greyed with its date.
  assert.equal(greyedInMenu(testlab, () => false), true);
  // ?testlab (or ?all, which turns it on): its page opens, so not greyed.
  assert.equal(greyedInMenu(testlab, (id) => id === "simulate"), false);
  // Another workspace's switch leaves TestLab greyed (the switch is per workspace).
  assert.equal(greyedInMenu(testlab, (id) => id === "laser"), true);
  // A workspace that is built is never greyed, whatever the switches say.
  assert.equal(greyedInMenu(design, () => false), false);
});
