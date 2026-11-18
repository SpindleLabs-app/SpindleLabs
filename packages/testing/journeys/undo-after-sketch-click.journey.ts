// Hunt U-B: Undo pressed straight after a sketch click (the kernel still rounding/settling it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const lines = (a: App) => a.doc().sketches.at(-1)?.curves.filter((c) => c.kind === "line").length ?? -1;
const curves = (a: App) => a.doc().sketches.at(-1)?.curves.length ?? -1;
async function start(a: App) {
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  await a.key("sketch-rectangle");
  await a.click(100, 0);
  await a.click(110, 10);
  assert.equal(lines(a), 4);
  assert.equal(a.history.undoLabel(), "Draw rectangle");
}

for (const held of [false, true]) {
  test(`rectangle A drawn; rectangle B's second click then Undo at once (${held ? "kernel held" : "kernel at its own speed"}): Undo takes back B, A stays (4 lines)`, async () => {
    const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
    await start(a);
    await a.click(120, 0);
    if (held) a.hold();
    a.pointer("click", [130, 10]); // the click that draws B: the person has made rectangle B
    a.pressUndo(); // Ctrl+Z straight after
    if (held) await a.release();
    await a.presses();
    await a.settle();
    console.log(`held=${held}: lines after click+Undo = ${lines(a)} (expected 4: A stays, B undone), undo label = ${a.history.undoLabel()}, redo label = ${a.history.redoLabel()}`);
    assert.equal(lines(a), 4, "Undo took back the rectangle before the one just drawn, and the one just drawn was dropped");
  });
}

test("control: B's click waited for, then Undo: A stays (4 lines), Redo gives 8", async () => {
  const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
  await start(a);
  await a.click(120, 0);
  await a.click(130, 10);
  assert.equal(lines(a), 8);
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.equal(lines(a), 4);
  a.pressRedo();
  await a.presses();
  await a.settle();
  assert.equal(lines(a), 8);
});
