// U2b: a new sketch starts with the grid size and Snap to grid chosen in Settings (the page wears them as data-grid-size
// and data-grid-snap, packages/ui design-defaults.ts), in the real workspace on the real kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GRID_MM, DEFAULT_GRID_SNAP_ON } from "@fission/ui";
import { lengthLimitRefusal, MAX_LENGTH_MM, MIN_LENGTH_MM } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { DEFAULT_GRID, DEFAULT_GRID_SNAP } from "../src/sketch-tool.ts";
import { lengthRefused } from "../src/typed-entry.ts";
import { app } from "../../../packages/testing/journeys/design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const input = (a: App, id: string) => a.$(id) as unknown as HTMLInputElement;

test("the built-in defaults and the length rule are the same in Settings and in Design", () => {
  assert.equal(DEFAULT_GRID_MM, DEFAULT_GRID);
  assert.equal(DEFAULT_GRID_SNAP_ON, DEFAULT_GRID_SNAP);
  for (const v of [0, -1, NaN, 0.9 * MIN_LENGTH_MM, MIN_LENGTH_MM, 1.1 * MIN_LENGTH_MM, 10, 0.9 * MAX_LENGTH_MM, MAX_LENGTH_MM, 1.1 * MAX_LENGTH_MM]) {
    assert.equal(lengthLimitRefusal(v), lengthRefused(v), String(v));
  }
});

test("a new sketch starts with the stored grid size and snap; a default left alone keeps the toggle as the person left it", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  const root = (a.window.document as unknown as Document).documentElement;
  // Nothing worn: the built-in 10 mm, snap off.
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  assert.equal(input(a, "#sketch-grid").value, "10");
  assert.equal(input(a, "#sketch-grid-snap").checked, false);
  await a.finish();
  // Settings chose 2.5 mm with snap on: the next new sketch has both.
  root.dataset.gridSize = "2.5";
  root.dataset.gridSnap = "on";
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XZ" });
  assert.equal(input(a, "#sketch-grid").value, "2.5");
  assert.equal(input(a, "#sketch-grid-snap").checked, true);
  await a.key("clear-selection");
  // Unticked in the sketch, the default unchanged: the next sketch keeps the grid size but not a ticked box it was never given.
  const snap = input(a, "#sketch-grid-snap");
  snap.checked = false;
  snap.dispatchEvent(new a.window.Event("change") as unknown as Event);
  await a.settle();
  await a.finish();
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "YZ" });
  assert.equal(input(a, "#sketch-grid").value, "2.5");
  assert.equal(input(a, "#sketch-grid-snap").checked, false, "the default did not change, so the toggle stays as it was left");
  await a.finish();
  // A junk value worn on the page (not a length) falls back to the built-in size.
  root.dataset.gridSize = "0";
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  assert.equal(input(a, "#sketch-grid").value, "10");
  assert.ok(await a.close());
});
