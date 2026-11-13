// Hunt UC, C1: Edit feature's OK has no "openings" guard (Extrude, Move and Combine have one): an OK still being checked
// by the kernel survives Cancel when the panel is opened again on the same item, and records its old numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const type = (a: App, sel: string, value: string) => {
  const el = a.$(sel) as HTMLInputElement;
  assert.ok(el, `no ${sel}`);
  el.value = value;
  el.dispatchEvent(new a.window.Event("input") as unknown as Event);
};
const value = (a: App, sel: string) => (a.$(sel) as HTMLInputElement).value;
const height = (a: App) => a.doc().timeline.features[0].intent.parameters.height;

test("C1a: OK, Cancel, open again while the kernel still checks: the cancelled edit must not be recorded", async (t) => {
  const a = await app(partDocument("box", 40, 30, 20));
  t.after(() => a.release());
  const before = JSON.stringify(a.doc());
  await a.doubleClick("feature-1");
  type(a, "#edit-height", "55");
  a.hold(); // a slow kernel
  (a.$("#feature-edit-ok") as HTMLButtonElement).click(); // OK: the kernel checks 40 x 30 x 55
  (a.$("#feature-edit-cancel") as HTMLButtonElement).click(); // changed my mind
  assert.equal(a.$("#feature-edit")!.hidden, true, "Cancel shut the panel");
  await a.doubleClick("feature-1"); // open it again
  assert.equal(a.$("#feature-edit")!.hidden, false);
  assert.equal(value(a, "#edit-height"), "20", "the panel shows the height the box has");
  await a.release();
  console.log("C1a  height expected 20, actual", height(a), "| undo label expected null, actual", a.history.undoLabel(), "| panel hidden expected false, actual", a.$("#feature-edit")!.hidden, "| volume expected 24000, actual", Math.round(a.volume()));
  assert.equal(JSON.stringify(a.doc()), before, "Cancel was pressed: nothing may change");
  assert.equal(a.history.canUndo(), false, "and nothing is recorded");
});

test("C1b: OK 55, Cancel, open again, type 60, OK: the last OK (60) is the one recorded", async (t) => {
  const a = await app(partDocument("box", 40, 30, 20));
  t.after(() => a.release());
  await a.doubleClick("feature-1");
  type(a, "#edit-height", "55");
  a.hold();
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  (a.$("#feature-edit-cancel") as HTMLButtonElement).click();
  await a.doubleClick("feature-1");
  type(a, "#edit-height", "60");
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.release();
  console.log("C1b steps", JSON.stringify(a.history.steps().map((s) => s.label)));
  console.log("C1b  height expected 60, actual", height(a), "| volume expected 72000, actual", Math.round(a.volume()), "| panel hidden", a.$("#feature-edit")!.hidden);
  assert.equal(height(a), 60);
});

test("control: OK then Cancel with no reopen records nothing", async (t) => {
  const a = await app(partDocument("box", 40, 30, 20));
  t.after(() => a.release());
  await a.doubleClick("feature-1");
  type(a, "#edit-height", "55");
  a.hold();
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  (a.$("#feature-edit-cancel") as HTMLButtonElement).click();
  await a.release();
  assert.equal(height(a), 20);
  assert.equal(a.history.canUndo(), false);
});
