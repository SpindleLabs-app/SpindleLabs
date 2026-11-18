// SL #677 item 4 (final Combine hunt 2026-11-12): an OK the kernel still checks, followed at once by Insert > Box or
// by Suppress from another item's menu, was dropped without a word: the other action shut the panel, and the OK,
// finding its panel shut, left. Insert and the item menus now wait for the OK, as Undo does, so both are recorded
// in the order pressed. On the real kernel, in the app around Design (design-app.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;

/**
 * Box 1 is 10 × 4 × 2 (80 mm³). Box 2 is 2 × 6 × 4 (48 mm³), moved 4 along x and 1 back along y and z, so it crosses
 * Box 1 through its whole depth and height over 2 mm of its length. Box 3 is 2 × 2 × 2 (8 mm³), 10 mm away along y.
 * Items: feature-1 Box 1, feature-2 Box 2, feature-3 its Move, feature-4 Box 3, feature-5 its Move.
 */
function start(): DesignDocument {
  let doc = partDocument("box", 10, 4, 2);
  const b = insertPreset(doc, "box", 2, 6, 4);
  doc = insertMove(b.doc, [`body:${b.id}`], { ...NO_MOVE, x: 4, y: -1, z: -1 }).doc;
  const c = insertPreset(doc, "box", 2, 2, 2);
  return insertMove(c.doc, [`body:${c.id}`], { ...NO_MOVE, y: 10 }).doc;
}
const body = (id: string) => ({ kind: "body" as const, id });
/** Modify > Combine opened, Box 1 picked as the target and Box 2 as the tool, Cut, tools not kept; OK not yet pressed. */
async function cutReady(a: App) {
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  a.selection.set([body("body:feature-1")]);
  await a.settle();
  a.selection.set([body("body:feature-1"), body("body:feature-2")]);
  await a.settle();
  const select = a.$("#combine-operation") as HTMLSelectElement;
  select.value = "cut";
  select.dispatchEvent(new a.window.Event("change") as never);
  const keep = a.$("#combine-keep") as HTMLInputElement;
  if (keep.checked) (keep.checked = false), keep.dispatchEvent(new a.window.Event("change") as never);
}
const combines = (a: App) => a.doc().timeline.features.filter((f) => f.intent.type === "combine").length;

test("hand-worked: the three boxes hold 136 mm³, and the Cut alone leaves 72", async () => {
  const a = await app(start(), designWorkspace);
  // 80 + 48 + 8 = 136.
  assert.ok(close(a.volume(), 136), `start: ${a.volume()}`);
  await cutReady(a);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  await a.settle();
  // Box 2 takes 2 (x 4..6) × 4 (all of y) × 2 (all of z) = 16 out of Box 1: 80 - 16 = 64, and Box 2 is used up.
  // With Box 3: 64 + 8 = 72.
  assert.equal(combines(a), 1);
  assert.ok(close(a.volume(), 72), `cut: ${a.volume()}`);
  await a.close();
});

test("Combine's OK then Insert > Box at once: both are made, the Combine first", async () => {
  const a = await app(start(), designWorkspace);
  await cutReady(a);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  a.$("#insert")!.click();
  (a.$("#insert-box") as HTMLElement).click();
  await a.settle();
  assert.equal(combines(a), 1, "the Combine is in the timeline");
  const types = a.doc().timeline.features.map((f) => f.intent.type);
  assert.equal(types.indexOf("combine"), 5, `the Combine comes before the new box: ${types}`);
  // The new box is Insert's 40 × 30 × 20 = 24,000 mm³: 72 + 24,000 = 24,072.
  assert.ok(close(a.volume(), 24072), `volume: ${a.volume()}`);
  assert.equal(a.history.undoLabel(), "Insert Box");
  a.history.undo();
  await a.settle();
  assert.ok(close(a.volume(), 72), `Undo takes back only the box: ${a.volume()}`);
  assert.equal(a.history.undoLabel(), "Combine bodies");
  await a.close();
});

test("Combine's OK then Suppress from Box 3's menu at once: both are made", async () => {
  const a = await app(start(), designWorkspace);
  await cutReady(a);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  a.$('[data-item="feature-4"]')!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as never);
  (a.$("#row-menu-suppress") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(combines(a), 1, "the Combine is in the timeline");
  // The Cut's 64 without Box 3's 8.
  assert.ok(close(a.volume(), 64), `volume: ${a.volume()}`);
  assert.equal(a.history.undoLabel(), "Suppress Box 3");
  a.history.undo();
  await a.settle();
  assert.ok(close(a.volume(), 72), `Undo brings Box 3 back and keeps the Cut: ${a.volume()}`);
  await a.close();
});

test("Edit feature's OK then Suppress from another item's menu at once: both are made", async () => {
  const a = await app(start(), designWorkspace);
  await a.menu("feature-1", "edit");
  await a.settle();
  const length = a.$("#edit-width") ?? a.$("#feature-edit input");
  assert.ok(length, "Edit feature has a size box");
  (length as HTMLInputElement).value = "20";
  length.dispatchEvent(new a.window.Event("input") as never);
  a.$("#feature-edit-ok")!.click();
  a.$('[data-item="feature-4"]')!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as never);
  (a.$("#row-menu-suppress") as HTMLButtonElement).click();
  await a.settle();
  // Box 1 now 20 × 4 × 2 = 160, Box 2 still 48, Box 3 suppressed: 208.
  assert.ok(close(a.volume(), 208), `volume: ${a.volume()}`);
  await a.close();
});
