// Hunt U-B: Undo pressed while the kernel still works on a sketch action (the shell's press, kernel held): every action that
// awaits the kernel before it records. Expected each time: Undo takes back THAT action (the design ends as before it, and
// "Draw rectangle" is still there to undo). Actual: the action is dropped and the rectangle before it is undone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, partDocument } from "@fission/design";
import { app } from "./design-app.ts";
import { fileOf } from "./kept-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const turns = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const tool = async (a: App, kind: string) => { (a.$(`#sketch-tool-${kind}`) as HTMLButtonElement).click(); await a.settle(); };
const cases: [string, (a: App) => Promise<void>, (a: App) => void][] = [
  ["Horizontal on a free line", async (a) => { await a.key("sketch-line"); await a.click(100, 30); await a.click(110, 33); await a.key("clear-selection"); await tool(a, "horizontal"); }, (a) => a.pointer("click", [105, 31.5])],
  ["Delete a picked side", async (a) => { await a.key("clear-selection"); await a.key("clear-selection"); await a.click(105, 0); }, (a) => a.press("delete-selection")],
  ["Construction on a picked side", async (a) => { await a.key("clear-selection"); await a.key("clear-selection"); await a.click(105, 0); }, (a) => a.press("sketch-construction")],
  ["A point dragged and let go", async (a) => { await a.key("clear-selection"); await a.key("clear-selection"); const grab = a.drawings().flatMap((d) => d.editing?.grab ?? []); const k = grab.findIndex((p) => p[0] === 110 && p[1] === 10); a.pointer("grab", [110, 10], { grab: k } as never); await a.settle(); a.pointer("drag", [115, 12]); await a.settle(); }, (a) => a.pointer("drop", [115, 12])],
  ["A dimension's Enter", async (a) => { await a.key("sketch-circle"); await a.click(150, 0); await a.click(155, 0); await a.key("clear-selection"); await tool(a, "dimension"); await a.click(155, 0); const box = a.$("#typed-diameter") as HTMLInputElement; box.value = "8"; box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event); await a.settle(); }, (a) => void a.$("#typed-diameter")!.dispatchEvent(new a.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event)],
];
for (const [name, setUp, act] of cases) {
  test(`${name}, then Undo before the kernel answers`, async (t) => {
    const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
    t.after(() => a.release());
    a.$("#create-sketch")!.click();
    await a.settle();
    await a.pick({ plane: "XY" });
    await a.key("sketch-rectangle");
    await a.click(100, 0);
    await a.click(110, 10);
    await setUp(a);
    const before = fileOf(a.doc());
    const label = a.history.undoLabel();
    a.hold();
    act(a);
    await turns();
    a.pressUndo();
    await turns();
    await a.release();
    await a.presses();
    await a.settle();
    const same = fileOf(a.doc()) === before;
    console.log(`${name}: after the action + Undo the design is ${same ? "the one before the action (ok)" : "NOT the one before the action"}; Undo now says "${a.history.undoLabel()}" (expected "${label}"), Redo says "${a.history.redoLabel()}"`);
    assert.ok(same, `Undo took back "${label}" (a step before), and the action itself was dropped`);
  });
}
