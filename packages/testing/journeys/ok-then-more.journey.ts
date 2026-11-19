// SL #760 item 5 (app-wide hunt 2026-11-14, R-5): an OK the kernel still checks, followed at once by Duplicate (Ctrl+D
// or Modify > Duplicate), a size typed in the Size boxes or a Shape chosen there, was dropped without a word: each
// shuts the open tool's panel, and the OK, finding it shut, left. They now wait for the OK as the ways into a tool do
// (ok-then-tool.journey.ts, ok-then-edit.journey.ts), so pressing fast ends as pressing slowly does.
// The design, by hand: Box 1 10 × 4 × 2 (80 mm³); Box 2 2 × 6 × 4 moved (4, −1, −1) crosses it over 2 mm of its length,
// through its depth and height; Box 3 2 × 2 × 2 (8) is 10 mm away. The Cut takes 2 × 4 × 2 = 16 out of Box 1 and uses
// Box 2 up: 64 + 8 = 72 mm³.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;

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
const types = (a: App) => a.doc().timeline.features.map((f) => f.intent.type).join(" ");

const combines = (a: App) => a.doc().timeline.features.filter((f) => f.intent.type === "combine").length;
const NEXT: [string, (a: App) => Promise<unknown> | void][] = [
  ["Ctrl+D (Duplicate)", (a) => a.key("duplicate-bodies")],
  ["Modify > Duplicate", (a) => (a.$("#modify-menu")!.click(), void a.$("#modify-menu-duplicate")?.click())],
];
for (const [what, next] of NEXT) {
  test(`Combine's OK then ${what} at once: the Cut is made, as when pressed slowly`, async () => {
    const a = await app(start(), designWorkspace);
    await cutReady(a);
    (a.$("#combine-ok") as HTMLButtonElement).click();
    await next(a);
    await a.settle();
    assert.equal(combines(a), 1, `the Combine pressed OK on is in the timeline: ${types(a)}`);
    // Pressed slowly, the OK clears the selection, so Duplicate then has nothing to copy: the Cut alone, 72 mm³.
    assert.equal(a.history.undoLabel(), "Combine bodies");
    assert.ok(close(a.volume(), 72), `volume ${a.volume()}`);
    await a.close();
  });
}

test("Edit feature's OK then a depth typed in the Size boxes at once: the edit is recorded", async () => {
  const a = await app(start(), designWorkspace);
  await a.menu("feature-1", "edit");
  await a.settle();
  const length = (a.$("#edit-width") ?? a.$("#feature-edit input")) as HTMLInputElement;
  length.value = "20";
  length.dispatchEvent(new a.window.Event("input") as never);
  a.$("#feature-edit-ok")!.click();
  const depth = a.$("#depth") as HTMLInputElement;
  depth.value = "3";
  depth.dispatchEvent(new a.window.Event("input", { bubbles: true }) as never);
  await a.settle();
  const box1 = a.doc().timeline.features.find((f) => f.id === "feature-1")!.intent.parameters as { width: number; depth: number };
  assert.equal(box1.width, 20, "Box 1's width from the OK pressed first");
  // The Size boxes are Box 3's (the body made last), so the depth typed makes it 2 × 3 × 2 = 12. With Box 1 now
  // 20 × 4 × 2 = 160 and Box 2's 48: 220 mm³, in two steps, the edit first.
  assert.deepEqual(a.history.steps().map((s) => s.label).slice(-2), ["Edit Box 1", "Change depth"]);
  assert.ok(close(a.volume(), 220), `volume ${a.volume()}`);
  await a.close();
});

test("Edit feature's OK then a Shape chosen in the Size boxes at once: the edit is recorded", async () => {
  const a = await app(start(), designWorkspace);
  await a.menu("feature-1", "edit");
  await a.settle();
  const length = (a.$("#edit-width") ?? a.$("#feature-edit input")) as HTMLInputElement;
  length.value = "20";
  length.dispatchEvent(new a.window.Event("input") as never);
  a.$("#feature-edit-ok")!.click();
  const shape = a.$("#shape") as HTMLSelectElement;
  shape.value = "cylinder";
  shape.dispatchEvent(new a.window.Event("change", { bubbles: true }) as never);
  await a.settle();
  assert.deepEqual(a.history.steps().map((s) => s.label).slice(-2), ["Edit Box 1", "Change shape to Cylinder"]);
  // Box 1 160, Box 2 48, and Box 3 now a cylinder 2 across and 2 high, π × 1² × 2 = 6.283: 214.28 (drawn in flat
  // facets, so a little under: within 0.1 mm³).
  assert.ok(Math.abs(a.volume() - (208 + 2 * Math.PI)) < 0.1, `volume ${a.volume()}`);
  await a.close();
});
