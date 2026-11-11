// Timeline and rebuild bug hunt (2026-11-11) regressions for Edit feature, in the Design app on the real kernel.
// E2: Edit feature on a Copy or a Mirror, which has nothing of its own to edit, is off in the menu with a reason true
// of the item (it was on, and said "Copy 1 is a sketch"), and a double-click on one leaves any open tool as it is (it
// shut an open Move and lost what was typed in it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyReference, insertDuplicates, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const type = (a: App, sel: string, value: string) => {
  const el = a.$(sel) as HTMLInputElement;
  assert.ok(el, `no ${sel}`);
  el.value = value;
  el.dispatchEvent(new a.window.Event("input") as unknown as Event);
};
const value = (a: App, sel: string) => (a.$(sel) as HTMLInputElement).value;

/** Box 1 (feature-1, 40 × 30 × 20), Copy 1 (its copy) and Mirror 1 (its mirror image across YZ). */
function copied() {
  const d = insertDuplicates(partDocument("box", 40, 30, 20), ["body:feature-1"]);
  const m = insertDuplicates(d.doc, ["body:feature-1"], "YZ");
  return { doc: m.doc, box: "feature-1", copy: d.ids[0], mirror: m.ids[0] };
}
const COPY_OFF = "Copy 1 is a copy of Box 1: it follows that body and has nothing of its own to edit";
const MIRROR_OFF = "Mirror 1 is a mirror image of Box 1: it follows that body and has nothing of its own to edit";

test("Edit feature is off in a Copy's and a Mirror's menu, saying what the item is; a solid's stays on", async () => {
  const { doc, box, copy, mirror } = copied();
  const a = await app(doc);
  // `menu` gives an off entry's reason (its greyed button's words) and chooses nothing.
  assert.equal(await a.menu(copy, "edit"), COPY_OFF);
  assert.equal(await a.menu(mirror, "edit"), MIRROR_OFF);
  assert.equal(a.error(), "", "an off entry is only greyed: nothing was refused in red");
  assert.equal(a.$("#feature-edit")!.hidden, true);
  // Control: Box 1's Edit feature is on and opens its sizes.
  assert.equal(await a.menu(box, "edit"), null);
  assert.equal(a.$("#feature-edit")!.hidden, false);
  assert.equal(value(a, "#edit-height"), "20");
  assert.ok(await a.close());
});

test("a double-click on a Copy or a Mirror leaves an open Move and its typed number as they are, and says why in words true of the item", async () => {
  const { doc, copy, mirror } = copied();
  const a = await app(doc);
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("move-tool");
  type(a, "#move-x", "33");
  await a.settle();
  const before = a.doc();
  for (const [id, words] of [[copy, COPY_OFF], [mirror, MIRROR_OFF]] as const) {
    await a.doubleClick(id);
    assert.equal(a.$("#move-panel")!.hidden, false, "the Move is still open");
    assert.equal(value(a, "#move-x"), "33", "with what was typed");
    assert.match(a.$("#move-bodies")!.textContent, /Box 1/, "and its body");
    assert.equal(a.error(), words);
    assert.doesNotMatch(a.error() ?? "", /is a sketch/);
  }
  assert.equal(a.$("#feature-edit")!.hidden, true);
  assert.equal(a.doc(), before, "nothing was recorded");
  // The Move still works: OK moves Box 1 by the 33 mm typed before the double-clicks.
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.doc().timeline.features.at(-1)!.intent.parameters.x, 33);
  assert.ok(await a.close());
});

test("a double-click on a Mirror leaves an open Edit feature and its typed size as they are; one on a solid still changes tool (control)", async () => {
  const { doc, box, mirror } = copied();
  const a = await app(doc);
  await a.doubleClick(box);
  type(a, "#edit-height", "55");
  await a.doubleClick(mirror);
  assert.equal(a.$("#feature-edit")!.hidden, false, "Edit feature on Box 1 is still open");
  assert.equal(value(a, "#edit-height"), "55", "with what was typed");
  assert.equal(a.error(), MIRROR_OFF);
  (a.$("#feature-edit-cancel") as HTMLButtonElement).click();
  await a.settle();
  // Control, as before and after the fix: with a Move open, a double-click on Box 1 (which has sizes) leaves the Move for its Edit feature.
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("move-tool");
  assert.equal(a.$("#move-panel")!.hidden, false);
  await a.doubleClick(box);
  assert.equal(a.$("#move-panel")!.hidden, true);
  assert.equal(a.$("#feature-edit")!.hidden, false);
  assert.ok(await a.close());
});
