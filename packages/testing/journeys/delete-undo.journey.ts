// Timeline and rebuild hunt 2026-11-11, D2 (#537 item 2): Delete on the timeline (the item's menu, or the Delete key:
// both run timeline-menu.ts `chooseEntry`) asks the kernel what the delete leaves (`planDelete`) before it records.
// It was not held in the history meanwhile, so Undo pressed straight after took back the step BEFORE, and the delete,
// planned from a design no longer there, was dropped without a word. It is now held as an OK the kernel still checks
// is (#503), so the shell's Undo waits and takes back the delete. Undo is pressed as the shell presses it
// (`pressUndo` in design-app.ts: main.ts `undoRedo`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, extrudeSketch, partDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
/** Lets the app run on while the kernel is held (`settle` would wait for the answers the held kernel owes). */
const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
// Box 1, 40 · 30 · 20 = 24000 mm³, and Sketch 1, a 10 × 10 square beside it (x 100..110), extruded 5: 100 · 5 = 500.
// Extrude 1's distance typed 8 (the step "Change extrude distance"): 100 · 8 = 800, so 24800 mm³ in all.
const WITH_BOX = 24000 + 800;
/** That design, the distance typed; the name of that step. */
async function typed() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const a = await app(extrudeSketch(drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc, s.id, 5).doc, designWorkspace);
  assert.ok(close(a.volume(), 24000 + 500), `${a.volume()}`);
  const h = a.$("#height") as HTMLInputElement;
  h.value = "8";
  h.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  assert.ok(close(a.volume(), WITH_BOX), `${a.volume()}`);
  return { a, step: a.history.undoLabel() };
}
/** Delete chosen from Box 1's menu, not waited for (nothing is built from Box 1, so no question is asked). */
function deleteBox(a: App) {
  const box = a.doc().timeline.features[0].id;
  a.$(`[data-item="${box}"]`)!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as unknown as Event);
  (a.$("#row-menu-delete") as HTMLButtonElement).click();
}
const state = (a: App) => ({ items: a.doc().timeline.features.length, volume: Math.round(a.volume()), undo: a.history.undoLabel(), redo: a.history.redoLabel() });

test("control: Delete Box 1, waited for, leaves the extrude alone (800 mm³); Undo brings the box back", async () => {
  const { a, step } = await typed();
  deleteBox(a);
  await a.settle();
  // Without the box only Extrude 1 is left: 800 mm³, two items (Sketch 1 and Extrude 1).
  assert.deepEqual(state(a), { items: 2, volume: 800, undo: "Delete Box 1", redo: null });
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.deepEqual(state(a), { items: 3, volume: WITH_BOX, undo: step, redo: "Delete Box 1" });
  assert.ok(await a.close());
});

test("Delete Box 1, then Undo pressed before the kernel has planned the delete: Undo takes back the delete, not the distance typed before it", async (t) => {
  const { a, step } = await typed();
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  a.hold(); // the kernel is slow to plan the delete (it is asked for Sketch 1's outline)
  deleteBox(a);
  await turns();
  assert.equal(a.doc().timeline.features.length, 3, "the delete is still being planned");
  a.pressUndo(); // Ctrl+Z straight after Delete
  await turns();
  await a.release();
  await a.presses();
  await a.settle();
  const got = state(a);
  assert.equal(a.history.busy(), false);
  assert.ok(await a.close());
  // The delete was made, then taken back: the design as before it, 3 items and 24800 mm³ (the distance still 8), Undo
  // still offering the distance step and Redo the delete.
  assert.deepEqual(got, { items: 3, volume: WITH_BOX, undo: step, redo: "Delete Box 1" });
});

test("the Delete key on the picked timeline item is held the same way", async (t) => {
  const { a, step } = await typed();
  t.after(() => a.release());
  const box = a.doc().timeline.features[0].id;
  (a.$(`.timeline-bar-item[data-item="${box}"]`) as HTMLElement).focus();
  a.hold();
  // The Delete key reads where the focus is from the page's own `document`, which this harness keeps on its window.
  const page = globalThis as { document?: unknown; HTMLElement?: unknown };
  const had = { document: page.document, HTMLElement: page.HTMLElement };
  Object.assign(page, { document: a.window.document, HTMLElement: a.window.HTMLElement });
  try {
    a.press("delete-selection");
  } finally {
    Object.assign(page, had);
  }
  await turns();
  assert.equal(a.doc().timeline.features.length, 3, "the delete is still being planned");
  a.pressUndo();
  await turns();
  await a.release();
  await a.presses();
  await a.settle();
  const got = state(a);
  assert.ok(await a.close());
  assert.deepEqual(got, { items: 3, volume: WITH_BOX, undo: step, redo: "Delete Box 1" });
});
