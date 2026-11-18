// Hunt U-B: a click, Finish Sketch, then Undo, all before the kernel answers the click.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const turns = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const lines = (a: App) => a.doc().sketches.at(-1)?.curves.filter((c) => c.kind === "line").length ?? -1;
const pressed = (a: App, kind: string) => a.$(`#sketch-tool-${kind}`)?.getAttribute("aria-pressed");

test("rectangle A; B's first click, Finish Sketch, Undo before the kernel answers: the app is in one consistent state after", async () => {
  const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  await a.key("sketch-rectangle");
  await a.click(100, 0);
  await a.click(110, 10);
  a.hold();
  a.pointer("click", [120, 0]); // B's FIRST corner: the tool has nothing half drawn yet
  await turns();
  a.$("#finish-sketch")!.click();
  await turns();
  a.pressUndo();
  await turns();
  await a.release();
  await a.presses();
  await a.settle();
  console.log(`after: lines=${lines(a)} sketches=${a.doc().sketches.length} sketching=${a.sketching()} undo=${a.history.undoLabel()} redo=${a.history.redoLabel()} drawings=${a.drawings().length} bodies=${await a.bodies()}`);
  const before = { sketching: a.sketching(), rect: pressed(a, "rectangle"), line: pressed(a, "line") };
  // If the sketch still shows as open, its tools must work: choose Line with L, draw a line.
  if (a.sketching()) {
    await a.key("sketch-line");
    const after = { rect: pressed(a, "rectangle"), line: pressed(a, "line") };
    const n = lines(a);
    await a.click(200, 0);
    await a.click(210, 0);
    await a.key("clear-selection");
    console.log(`sketch shown open: before L ${JSON.stringify(before)}, after L ${JSON.stringify(after)}; lines before the 2 clicks ${n}, after ${lines(a)} (expected ${n + 1} with the Line tool)`);
    assert.equal(after.line, "true", "L chose the Line tool");
    assert.equal(lines(a), n + 1, "the Line tool drew one line");
    await a.finish();
    console.log(`after Finish: sketching=${a.sketching()}`);
    assert.equal(a.sketching(), false, "Finish Sketch closes the sketch");
  }
  assert.equal(await a.bodies(), 1, "one body (the box) held in the kernel");
});
