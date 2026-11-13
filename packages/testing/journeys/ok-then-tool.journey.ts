// Flat stress hunt 2026-11-13 (A2-1): an OK the kernel still checks, followed at once by a way into another tool (the
// M or E key, the Move, Extrude or Create sketch button, Combine again, Edit feature from the timeline) or by the open
// tool's own Cancel or Escape, dropped the OK without a word: the other action shut the panel, and the OK, finding its
// panel shut, left. SL #677 item 4 made only Insert and the item menus wait. Every way out of a tool now waits for the
// OK, so the OK is recorded and the next tool opens after it (Cancel and Escape then have nothing left to cancel).
// On the real kernel, in the app around Design (design-app.ts). Same design and hand working as ok-then-edit.journey.ts.

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
 * The Cut takes 2 (x 4..6) × 4 × 2 = 16 out of Box 1 and uses Box 2 up: 64 + 8 = 72 mm³ in all.
 */
function start(): DesignDocument {
  let doc = partDocument("box", 10, 4, 2);
  const b = insertPreset(doc, "box", 2, 6, 4);
  doc = insertMove(b.doc, [`body:${b.id}`], { ...NO_MOVE, x: 4, y: -1, z: -1 }).doc;
  const c = insertPreset(doc, "box", 2, 2, 2);
  return insertMove(c.doc, [`body:${c.id}`], { ...NO_MOVE, y: 10 }).doc;
}
const body = (id: string) => ({ kind: "body" as const, id });
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
const shown = (a: App, id: string) => {
  const el = a.$(`#${id}`);
  return el !== null && el.closest("[hidden]") === null;
};

/** Two clicks on a timeline bar item at once, as a double-click opens it (timeline-bar.ts `isDoubleClick`). */
function dblclick(a: App, id: string) {
  const item = a.$(`[data-item="${id}"]`)!;
  for (let i = 0; i < 2; i++) item.dispatchEvent(new a.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as never);
}

const NEXT: [string, (a: App) => Promise<void> | void, string | null][] = [
  ["the M key", (a) => a.key("move-tool"), "move-panel"],
  ["the E key", (a) => a.key("extrude-tool"), "extrude-panel"],
  ["the Move button", (a) => void a.$("#move")!.click(), "move-panel"],
  ["the Extrude button", (a) => void a.$("#extrude")!.click(), "extrude-panel"],
  ["Create sketch", (a) => void a.$("#create-sketch")!.click(), "sketch-panel"],
  ["Combine again", (a) => (a.$("#modify-menu")!.click(), void a.$("#modify-menu-combine")!.click()), "combine-panel"],
  ["Edit feature on Box 3's Move", (a) => a.menu("feature-5", "edit"), "move-panel"],
  ["a double-click on Box 3's Move in the timeline", (a) => dblclick(a, "feature-5"), "move-panel"],
  ["Combine's Cancel", (a) => void a.$("#combine-cancel")!.click(), null],
  ["Escape", (a) => a.key("clear-selection"), null],
];

for (const [what, next, opens] of NEXT) {
  test(`Combine's OK then ${what} at once: the Combine is recorded`, async () => {
    const a = await app(start(), designWorkspace);
    await cutReady(a);
    (a.$("#combine-ok") as HTMLButtonElement).click();
    await next(a);
    await a.settle();
    assert.equal(combines(a), 1, "the Combine is in the timeline");
    assert.ok(close(a.volume(), 72), `volume: ${a.volume()}`);
    assert.equal(a.history.undoLabel(), "Combine bodies");
    if (opens !== null) assert.ok(shown(a, opens), `${opens} opens after the Combine`);
    else assert.ok(!shown(a, "combine-panel"), "the Combine panel is shut");
    await a.close();
  });
}

test("Edit feature's OK then the M key at once: the edit is recorded", async () => {
  const a = await app(start(), designWorkspace);
  await a.menu("feature-1", "edit");
  await a.settle();
  const length = (a.$("#edit-width") ?? a.$("#feature-edit input")) as HTMLInputElement;
  length.value = "20";
  length.dispatchEvent(new a.window.Event("input") as never);
  a.$("#feature-edit-ok")!.click();
  await a.key("move-tool");
  await a.settle();
  // Box 1 now 20 × 4 × 2 = 160, Box 2 48, Box 3 8: 216.
  assert.ok(close(a.volume(), 216), `volume: ${a.volume()}`);
  assert.equal(a.history.undoLabel(), "Edit Box 1");
  await a.close();
});
