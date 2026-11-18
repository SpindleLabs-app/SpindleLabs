// A size typed in the Size boxes, or a Shape chosen, while an OK is still being checked by the kernel waits for
// the OK (SL #760 item 5) and then goes to the body the boxes showed when it was typed, never to the one they show
// once the OK lands (the OK clears the selection, or makes a new last body). App bug hunt 2026-11-18, E-2: the
// Width typed for Box 1 right after a Move's OK made Box 2 20 wide; Box 1's Height typed right after an Extrude's
// OK made the new extrude 20 mm; Cylinder chosen for Box 1 added a new cylinder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const type = (a: App, sel: string, value: string) => {
  const box = a.$(sel) as HTMLInputElement;
  box.value = value;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as never);
};
const params = (a: App, id: string) => a.doc().timeline.features.find((x) => x.id === id)!.intent.parameters as Record<string, number>;

/** Box 1 10×10×10 at the origin; Sketch 1 a 40×30 rectangle at x 20..60, y 0..30, apart from it. */
function boxAndSketch(): DesignDocument {
  const s = addSketch(partDocument("box", 10, 10, 10));
  return drawRectangle(s.doc, s.id, [20, 0], [60, 30]).doc;
}
async function extrudeFive(a: App) {
  a.$("#extrude")!.click();
  await a.settle();
  type(a, "#extrude-distance", "5");
  await a.settle();
  assert.equal((a.$("#height") as HTMLInputElement).value, "10", "the Size boxes show Box 1 while Extrude is open");
}

test("Box 1's Height typed right after an Extrude's OK goes to Box 1, not the new extrude", async () => {
  const a = await app(boxAndSketch());
  await extrudeFive(a);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  type(a, "#height", "20");
  await a.settle();
  const ext = a.doc().timeline.features.at(-1)!;
  assert.equal(ext.intent.type, "extrude", "the extrude is recorded");
  assert.equal(params(a, ext.id).distance, 5, "the extrude keeps its 5 mm");
  assert.equal(params(a, "feature-1").height, 20, "Box 1 is made 20 high");
  // Box 1 10·10·20 = 2,000 and the extrude 40·30·5 = 6,000: 8,000 mm³.
  assert.ok(Math.abs(a.volume() - 8000) < 1e-6, `${a.volume()}`);
  await a.close();
});

test("pressed slowly, the boxes show the new extrude after its OK, and the Height typed there is its distance", async () => {
  const a = await app(boxAndSketch());
  await extrudeFive(a);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  type(a, "#height", "20");
  await a.settle();
  const ext = a.doc().timeline.features.at(-1)!;
  assert.equal(params(a, ext.id).distance, 20);
  assert.equal(params(a, "feature-1").height, 10);
  // 1,000 + 40·30·20 = 25,000 mm³.
  assert.ok(Math.abs(a.volume() - 25000) < 1e-6, `${a.volume()}`);
  await a.close();
});

test("Cylinder chosen in Box 1's Shape right after an Extrude's OK makes Box 1 the cylinder, adding no item", async () => {
  const a = await app(boxAndSketch());
  await extrudeFive(a);
  const count = a.doc().timeline.features.length;
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  const shape = a.$("#shape") as HTMLSelectElement;
  shape.value = "cylinder";
  shape.dispatchEvent(new a.window.Event("change", { bubbles: true }) as never);
  await a.settle();
  const f = a.doc().timeline.features;
  assert.equal(f.length, count + 1, "only the extrude is added");
  assert.equal(f.find((x) => x.id === "feature-1")!.intent.type, "cylinder");
  await a.close();
});

test("Box 1 selected, Moved 5 along x, OK, then Width 20 typed at once: Box 1 is 20 wide, Box 2 stays 8", async () => {
  const b = insertPreset(partDocument("box", 10, 10, 10), "box", 8, 6, 4);
  const a = await app(insertMove(b.doc, [`body:${b.id}`], { ...NO_MOVE, x: 30 }).doc, designWorkspace);
  a.selection.set([{ kind: "body", id: "body:feature-1" } as never]);
  await a.settle();
  assert.equal((a.$("#width") as HTMLInputElement).value, "10", "the boxes show Box 1");
  (a.$("#move") as HTMLButtonElement).click();
  await a.settle();
  type(a, "#move-x", "5");
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  type(a, "#width", "20");
  await a.settle();
  assert.equal(params(a, "feature-1").width, 20, "Box 1 is made 20 wide");
  assert.equal(params(a, b.id).width, 8, "Box 2 keeps its 8");
  // Box 1 20·10·10 = 2,000 and Box 2 8·6·4 = 192: 2,192 mm³.
  assert.ok(Math.abs(a.volume() - 2192) < 1e-6, `${a.volume()}`);
  await a.close();
});

test("Box 1 suppressed from its menu while the Move's OK is checked, then Width typed for it: refused in words, no body changed", async () => {
  const b = insertPreset(partDocument("box", 10, 10, 10), "box", 8, 6, 4);
  const a = await app(insertMove(b.doc, [`body:${b.id}`], { ...NO_MOVE, x: 30 }).doc, designWorkspace);
  a.selection.set([{ kind: "body", id: "body:feature-1" } as never]);
  await a.settle();
  (a.$("#move") as HTMLButtonElement).click();
  await a.settle();
  type(a, "#move-x", "5");
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  // Box 1's row menu, Suppress, both pressed before the OK's check answers: the Suppress waits for the OK, then the Width.
  a.$(`[data-item="feature-1"]`)!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as never);
  (a.$("#row-menu-suppress") as HTMLButtonElement).click();
  type(a, "#width", "20");
  await a.settle();
  const f = a.doc().timeline.features;
  assert.equal(f.find((x) => x.id === "feature-1")!.suppressed, true, "Box 1 is suppressed");
  assert.equal(params(a, "feature-1").width, 10, "suppressed Box 1 keeps its 10");
  assert.equal(params(a, b.id).width, 8, "Box 2, which the boxes show now, keeps its 8");

  assert.match(a.$("#action-note")!.textContent!, /The size typed was for Box 1/);
  await a.close();
});

test("Depth typed for Box 2, the Cut's tool, right after the Combine's OK changes Box 2, not Box 3 (app bug hunt 2026-11-18, B-3)", async () => {
  setCombineShown(true);
  // Box 1 10×4×2 at the origin; Box 2 2×6×4 moved (4, −1, −1); Box 3 2×2×2 moved (1, 1, 1).
  let doc = partDocument("box", 10, 4, 2);
  const b2 = insertPreset(doc, "box", 2, 6, 4);
  doc = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 4, y: -1, z: -1 }).doc;
  const b3 = insertPreset(doc, "box", 2, 2, 2);
  doc = insertMove(b3.doc, [`body:${b3.id}`], { ...NO_MOVE, x: 1, y: 1, z: 1 }).doc;
  const a = await app(doc, designWorkspace);
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  a.selection.set([{ kind: "body", id: "body:feature-1" } as never]);
  await a.settle();
  a.selection.set([{ kind: "body", id: "body:feature-1" } as never, { kind: "body", id: `body:${b2.id}` } as never]);
  await a.settle();
  const select = a.$("#combine-operation") as HTMLSelectElement;
  select.value = "cut";
  select.dispatchEvent(new a.window.Event("change") as never);
  const keep = a.$("#combine-keep") as HTMLInputElement;
  if (keep.checked) (keep.checked = false), keep.dispatchEvent(new a.window.Event("change") as never);
  await a.settle();
  assert.equal(["#width", "#depth", "#height"].map((x) => (a.$(x) as HTMLInputElement).value).join("x"), "2x6x4", "the boxes show Box 2");
  (a.$("#combine-ok") as HTMLButtonElement).click();
  type(a, "#depth", "3");
  for (let i = 0; i < 5; i++) await a.settle();
  assert.equal(params(a, b2.id).depth, 3, "Box 2 is made 3 deep");
  assert.equal(params(a, b3.id).depth, 2, "Box 3 keeps its 2");
  // Box 2 now spans y −1..2, so the Cut takes x 4..6, y 0..2, z 0..2 from Box 1: 80 − 8 = 72; with Box 3's 8: 80 mm³.
  assert.ok(Math.abs(a.volume() - 80) < 1e-6, `${a.volume()}`);
  await a.close();
});
