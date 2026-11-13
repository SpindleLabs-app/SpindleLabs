// Hunter D: Undo pressed while Combine's OK is still being checked, then the "removes nothing" question answered Cancel:
// the waiting Undo takes back the step BEFORE the Combine (nothing of the Combine was recorded) and shuts the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyReference, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";
setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;
function faceWhere(a: App, on: (p: number[]) => boolean): number {
  const mesh = a.mesh()!;
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const corners = [0, 1, 2].map((k) => { const i = mesh.indices[3 * t + k]; return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]; });
    all.set(f, (all.get(f) ?? true) && corners.every(on));
  });
  return [...all].filter(([, ok]) => ok).map(([f]) => f)[0];
}
const steps = (a: App) => a.history.steps().map((s) => `${s.state === "current" ? ">" : ""}${s.label || "start"}`).join(" | ");
for (const answer of ["cancel", "go"] as const)
  test(`Undo pressed while Combine's Cut is checked, the question answered ${answer}`, async () => {
    // Box 1 x 0..40, Box 2 x 60..100 (apart). Step A: Box 1 moved 5 up. Then a Cut of Box 1 by Box 2, which removes nothing: asked.
    const d = partDocument("box", 40, 30, 20);
    const m = insertPreset(d, "box", 40, 30, 20);
    const a = await app(insertMove(m.doc, [`body:${m.id}`], { ...NO_MOVE, x: 60 }).doc);
    a.selection.set([bodyReference("body:feature-1")]);
    await a.key("move-tool");
    const z = a.$("#move-z") as HTMLInputElement; z.value = "5"; z.dispatchEvent(new a.window.Event("input") as never);
    (a.$("#move-ok") as HTMLButtonElement).click();
    await a.settle();
    a.selection.clear();
    await a.settle();
    assert.equal(steps(a), "start | >Move bodies");
    a.$("#modify-menu")!.click(); await a.settle();
    a.$("#modify-menu-combine")!.click(); await a.settle();
    await a.pick({ face: faceWhere(a, (p) => close(p[0], 0)) });
    await a.pick({ face: faceWhere(a, (p) => close(p[0], 100)) });
    const select = a.$("#combine-operation") as HTMLSelectElement; select.value = "cut"; select.dispatchEvent(new a.window.Event("change") as never);
    a.hold(); // a slow kernel
    (a.$("#combine-ok") as HTMLButtonElement).click();
    a.pressUndo(); // pressed while OK is checked: it waits
    await a.release();
    const ask = a.$("#cut-ask") as HTMLDialogElement;
    assert.ok(ask.open, "the question is open");
    console.log(`  asked: ${a.$("#cut-ask-words")!.textContent}`);
    console.log(`  while asked: ${steps(a)}`);
    (a.$(`#cut-ask-${answer}`) as HTMLButtonElement).click();
    await a.presses();
    await a.settle();
    console.log(`  after ${answer}: ${steps(a)}; Combine panel open: ${a.$("#combine-panel") ? !a.$("#combine-panel")!.hidden : false}`);
    // Rule: one press of Undo takes back the action it was pressed after (the Combine); a cancelled action is zero steps, so nothing else may go.
    if (answer === "cancel") assert.equal(steps(a), "start | >Move bodies", "Cancel recorded nothing, so the Move before it must still be there");
    else assert.equal(steps(a), "start | >Move bodies | Combine bodies");
  });

// Hunter A (M2): the same for an OK the kernel refuses. Move by 100,000 km is past the size limit, so nothing is
// recorded; the Undo that waited for that OK has nothing of it to take back and must not take the width before it.
test("Undo pressed while Move's OK is checked, the OK refused: nothing is undone and the refusal is on screen", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  const width = a.$("#width") as HTMLInputElement;
  width.value = "50";
  width.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  // By hand: 50 x 30 x 20 = 30,000 mm³.
  assert.equal(Math.round(a.volume()), 30000);
  const before = JSON.stringify(a.doc());
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("move-tool");
  const x = a.$("#move-x") as HTMLInputElement;
  x.value = "100000000";
  x.dispatchEvent(new a.window.Event("input") as unknown as Event);
  a.hold();
  (a.$("#move-ok") as HTMLButtonElement).click();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.equal(a.history.busy(), true, "the OK is held while the kernel checks it");
  a.pressUndo();
  await a.release();
  await a.presses();
  await a.settle();
  assert.equal(JSON.stringify(a.doc()), before, "the width typed before the Move is still there");
  assert.equal(steps(a), "start | >Change width");
  assert.equal(a.$("#move-panel")!.hidden, false, "the Move panel is still open");
  assert.notEqual(a.$("#move-error")?.textContent ?? "", "", "and says why the OK was refused");
  await a.close();
});
