// Hunt UE: Delete of an item something is built from (asks first), Undo pressed while the kernel still plans the delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, extrudeSketch, partDocument } from "@fission/design";
import { projectToJson } from "@fission/core";
import { app, close } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const turns = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
async function typed() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const a = await app(extrudeSketch(drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc, s.id, 5).doc, designWorkspace);
  const h = a.$("#height") as HTMLInputElement;
  h.value = "8";
  h.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  assert.ok(close(a.volume(), 24800), `${a.volume()}`);
  return { a, step: a.history.undoLabel() };
}
const sketchOf = (a: App) => a.doc().timeline.features.find((f) => f.id.startsWith("sketch"))!.id;
function deleteSketch(a: App) {
  a.$(`[data-item="${sketchOf(a)}"]`)!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as unknown as Event);
  (a.$("#row-menu-delete") as HTMLButtonElement).click();
}
const state = (a: App) => ({ items: a.doc().timeline.features.length, volume: Math.round(a.volume()), undo: a.history.undoLabel(), redo: a.history.redoLabel(), ask: (a.$("#delete-ask") as HTMLDialogElement | null)?.open ?? false });

test("control: Delete Sketch 1 asks; Delete in the box; one step", async () => {
  const { a, step } = await typed();
  deleteSketch(a);
  await a.settle();
  assert.deepEqual(state(a), { items: 3, volume: 24800, undo: step, redo: null, ask: true });
  (a.$("#delete-ask-confirm") as HTMLButtonElement).click();
  await a.settle();
  assert.deepEqual(state(a), { items: 2, volume: 24800, undo: "Delete Sketch 1", redo: null, ask: false });
  assert.ok(await a.close());
});

test("Delete Sketch 1 (asks), Undo pressed before the kernel has planned it: Undo must not take back the step before while the question waits", async (t) => {
  const { a, step } = await typed();
  t.after(() => a.release());
  const before = projectToJson({ ...({} as never), name: "x", workspaces: { design: a.doc() } } as never);
  a.hold();
  deleteSketch(a);
  await turns();
  a.pressUndo();
  await turns();
  await a.release();
  await a.presses();
  await a.settle();
  const got = state(a);
  console.log("after Delete(asks)+Undo:", JSON.stringify(got), "step before was", step);
  // Rule (#537, delete-undo.journey.ts): Undo pressed straight after Delete takes back the delete, never the step before it.
  // The delete was not made yet (its question is open), so the distance typed (8, 24800 mm3) must still be there.
  assert.equal(got.volume, 24800, `the distance typed before the Delete is still 8 (24800 mm3), got ${got.volume}`);
  assert.equal(got.undo, step);
  void before;
  assert.ok(await a.close());
});
