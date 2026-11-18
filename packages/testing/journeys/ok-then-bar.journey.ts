// SL #819 B-2 (app bug hunt 2026-11-18): an Edit feature or Combine OK the kernel is still checking, followed at once by
// a timeline bar action (an item dragged, a playback button) or an assistant command, was dropped without a word: the
// bar's action shut the panel, and the OK, finding it shut, left. Menus, Insert and every way into a tool already wait
// for the OK (ok-then-tool, ok-then-edit, ok-then-more journeys); the bar and the assistant's commands now wait too, so
// pressing fast ends as pressing slowly does.
// The design, by hand (as ok-then-more.journey.ts): Box 1 10 × 4 × 2 (80 mm³); Box 2 2 × 6 × 4 moved (4, −1, −1) (48);
// Box 3 2 × 2 × 2 moved y 10 (8), apart from both. Box 1 edited to 20 wide: 160 + 48 + 8 = 216 mm³ (the boxes overlap
// but are separate bodies, so their volumes add). The Cut takes 2 × 4 × 2 = 16 out of Box 1 and uses Box 2 up:
// 64 + 8 = 72 mm³.
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
/** The bar's items laid out by hand (happy-dom has no layout): 30 px wide, 40 apart from x 100. */
function layOut(a: App) {
  const W = a.window as unknown as { HTMLElement: typeof HTMLElement };
  W.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    if (this.classList.contains("timeline-bar-item")) {
      const items = [...this.parentElement!.querySelectorAll(".timeline-bar-item")];
      return rect(100 + 40 * items.indexOf(this), 764, 30, 24);
    }
    if (this.classList.contains("timeline-bar")) return rect(100, 760, 600, 32);
    if (this.classList.contains("timeline-marker")) return rect(0, 760, 800, 32);
    return rect(0, 0, 0, 0);
  } as never;
}
/** Item `id` dragged along the bar to the gap before place `place`. */
function drag(a: App, id: string, place: number) {
  const li = a.$(`.timeline-bar-item[data-item="${id}"]`)!;
  const PE = (a.window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
  const at = 100 + 40 * place - 5;
  const from = 100 + 40 * [...li.parentElement!.querySelectorAll(".timeline-bar-item")].indexOf(li) + 15;
  li.dispatchEvent(new PE("pointerdown", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: from, clientY: 776 }));
  li.dispatchEvent(new PE("pointermove", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: at, clientY: 776 }));
  li.dispatchEvent(new PE("pointerup", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: at, clientY: 776 }));
}
const back = (a: App) => a.$('.timeline-marker-button[data-button="back"]')!;
const ids = (a: App) => a.doc().timeline.features.map((f) => f.id).join(" ");
const width = (a: App) => (a.doc().timeline.features.find((f) => f.id === "feature-1")!.intent.parameters as { width: number }).width;
const combines = (a: App) => a.doc().timeline.features.filter((f) => f.intent.type === "combine").length;
async function settled(a: App) {
  await a.presses();
  for (let i = 0; i < 6; i++) await a.settle();
}

async function editReady(a: App) {
  await a.menu("feature-1", "edit");
  const w = a.$("#edit-width") as HTMLInputElement;
  w.value = "20";
  w.dispatchEvent(new a.window.Event("input") as never);
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

test("Edit feature's OK then at once Box 3 dragged to the front of the bar: both are made, the edit first", async () => {
  const a = await app(start(), designWorkspace);
  layOut(a);
  await editReady(a);
  a.$("#feature-edit-ok")!.click();
  drag(a, "feature-4", 0);
  await settled(a);
  assert.equal(width(a), 20, "the edit pressed OK on is kept");
  assert.equal(ids(a), "feature-4 feature-1 feature-2 feature-3 feature-5", "and Box 3 went to the front");
  assert.deepEqual(a.history.steps().map((s) => s.label).slice(-2), ["Edit Box 1", "Move Box 3 in the timeline"]);
  assert.ok(close(a.volume(), 216), `volume ${a.volume()}`);
  await a.close();
});

test("Edit feature's OK then at once the marker's step-back button: the edit is made, then the marker steps back", async () => {
  const a = await app(start(), designWorkspace);
  layOut(a);
  await editReady(a);
  a.$("#feature-edit-ok")!.click();
  back(a).click();
  await settled(a);
  assert.equal(width(a), 20);
  assert.equal(a.doc().timeline.marker, "feature-4", "one step back from the end: on Box 3, its Move rolled back");
  assert.deepEqual(a.history.steps().map((s) => s.label).slice(-2), ["Edit Box 1", "Move the rollback marker"]);
  // Box 3 is still at the origin with its Move rolled back, inside the 20-wide Box 1, but a separate body: 160 + 48 + 8.
  assert.ok(close(a.volume(), 216), `volume ${a.volume()}`);
  await a.close();
});

test("Edit feature's OK then at once the assistant's rename: both are made", async () => {
  const a = await app(start(), designWorkspace);
  layOut(a);
  await editReady(a);
  a.$("#feature-edit-ok")!.click();
  const renamed = a.command({ op: "rename_item", item: "Box 3", name: "Peg" } as never);
  await renamed;
  await settled(a);
  assert.equal(width(a), 20);
  assert.equal(a.doc().timeline.features.find((f) => f.id === "feature-4")!.provenance.self.label, "Peg");
  assert.deepEqual(a.history.steps().map((s) => s.label).slice(-2), ["Edit Box 1", "Rename Box 3"]);
  await a.close();
});

test("Edit feature's OK then nothing (the control): the edit is made", async () => {
  const a = await app(start(), designWorkspace);
  layOut(a);
  await editReady(a);
  a.$("#feature-edit-ok")!.click();
  await settled(a);
  assert.equal(width(a), 20);
  assert.ok(close(a.volume(), 216), `volume ${a.volume()}`);
  await a.close();
});

for (const [what, next, order] of [
  ["Box 3 dragged to the front", (a: App) => drag(a, "feature-4", 0), "feature-4 feature-1 feature-2 feature-3 feature-5 feature-6"],
  ["the marker's step-back button", (a: App) => back(a).click(), "feature-1 feature-2 feature-3 feature-4 feature-5 feature-6"],
] as const) {
  test(`Combine's OK (Cut Box 2 from Box 1) then at once ${what}: the Cut is made first`, async () => {
    const a = await app(start(), designWorkspace);
    layOut(a);
    await cutReady(a);
    (a.$("#combine-ok") as HTMLButtonElement).click();
    next(a);
    await settled(a);
    assert.equal(combines(a), 1, `the Combine pressed OK on is in the timeline: ${ids(a)}`);
    assert.equal(ids(a), order);
    assert.equal(a.history.steps().map((s) => s.label).at(-2), "Combine bodies");
    await a.close();
  });
}

test("Edit feature's OK then at once a refused drag (Move 1 before the box it moves): the edit is made and the refusal shown by the bar", async () => {
  const a = await app(start(), designWorkspace);
  layOut(a);
  await editReady(a);
  a.$("#feature-edit-ok")!.click();
  drag(a, "feature-3", 0);
  await settled(a);
  assert.equal(width(a), 20);
  assert.equal(ids(a), "feature-1 feature-2 feature-3 feature-4 feature-5", "nothing moved");
  assert.equal(a.history.undoLabel(), "Edit Box 1");
  const note = a.$(".timeline-bar-note")?.textContent ?? "";
  assert.match(note, /Move 1 can't go before/, `the bar says why: "${note}"`);
  await a.close();
});
