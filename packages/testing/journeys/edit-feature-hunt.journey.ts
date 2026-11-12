// Timeline and rebuild bug hunt (2026-11-11) regressions for Edit feature, in the Design app on the real kernel.
// E2: Edit feature on a Copy or a Mirror, which has nothing of its own to edit, is off in the menu with a reason true
// of the item (it was on, and said "Copy 1 is a sketch"), and a double-click on one leaves any open tool as it is (it
// shut an open Move and lost what was typed in it).
// A2: Edit feature on an extrude that offers its sketch's regions leaves the extrude's own body out of the view
// meanwhile; opening Edit feature on another item from there forgot the regions without drawing the body again, so it
// stayed undrawn (and the regions shaded) after Cancel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, bodyReference, drawRectangle, extrudeSketch, insertDuplicates, partDocument } from "@fission/design";
import { regionRef, sketchRegions } from "../../../workspaces/design/src/regions.ts";
import { app, kernel } from "./design-app.ts";

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

/**
 * Box 1 (40 × 30 × 20 = 24,000 mm³), then Sketch 1 on XY holding rectangle A (100, 0)-(110, 10) and rectangle B
 * (120, 0)-(140, 10), clear of the box and of each other, and Extrude 1 of A by 5: 10 × 10 × 5 = 500 mm³.
 * Both bodies drawn: 24,000 + 500 = 24,500 mm³. With Extrude 1's regions offered its own body is left out: 24,000.
 */
async function boxAndRegions() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  let doc = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  doc = drawRectangle(doc, s.id, [120, 0], [140, 10]).doc;
  const regions = await sketchRegions(kernel, doc.sketches[0]);
  const a = regions.regions.find((r) => Math.abs(r.centroid[0] - 105) < 1e-9)!;
  const made = extrudeSketch(doc, s.id, 5, false, regionRef(a, regions.ids));
  return { doc: made.doc, box: "feature-1", extrude: made.id };
}
const drawn = (a: App) => Math.round(a.volume() * 1e6) / 1e6;
const shaded = (a: App) => a.extrudeShown()?.profiles.length ?? 0;
/** Edit feature opened on Extrude 1 from its menu: its two regions shaded, its own body out of the view (by design). */
async function offered(a: App, extrude: string) {
  assert.equal(drawn(a), 24500, "both bodies drawn: 24,000 + 500");
  assert.equal(await a.menu(extrude, "edit"), null);
  assert.equal(shaded(a), 2, "regions A and B are offered");
  assert.equal(drawn(a), 24000, "Extrude 1's body is out of the view while its regions are offered");
}

test("Edit feature on an extrude offering regions, then Edit feature on another item: the extrude's body is drawn again at once, no region stays shaded, and Cancel leaves both drawn", async () => {
  for (const how of ["its menu", "a double-click"] as const) {
    const { doc, box, extrude } = await boxAndRegions();
    const a = await app(doc);
    await offered(a, extrude);
    if (how === "its menu") assert.equal(await a.menu(box, "edit"), null);
    else await a.doubleClick(box);
    assert.equal(a.$("#feature-edit-title")!.textContent, "Edit Box 1", "the panel is Box 1's now");
    assert.equal(value(a, "#edit-width"), "40");
    // Box 1 offers no regions, so the view is the whole design again: 24,000 + 500.
    assert.equal(drawn(a), 24500, `Edit feature on Box 1 by ${how}: Extrude 1's body is drawn again`);
    assert.equal(shaded(a), 0, "and no region is shaded");
    (a.$("#feature-edit-cancel") as HTMLButtonElement).click();
    await a.settle();
    assert.equal(a.$("#feature-edit")!.hidden, true);
    assert.equal(drawn(a), 24500, `after Cancel (${how})`);
    assert.equal(shaded(a), 0);
    assert.equal(a.doc(), doc, "nothing was recorded");
    assert.ok(await a.close());
  }
});

test("every other way out of an extrude's offered regions puts the view back too (controls)", async () => {
  // Each leaves Edit feature on Extrude 1 with its regions offered; the volume drawn after is worked from what is then built.
  const ways: { name: string; go: (a: App, ids: { box: string; extrude: string }) => Promise<unknown>; drawn: number }[] = [
    { name: "Cancel", go: async (a) => ((a.$("#feature-edit-cancel") as HTMLButtonElement).click(), a.settle()), drawn: 24500 },
    { name: "Escape", go: (a) => a.key("clear-selection"), drawn: 24500 },
    { name: "OK with nothing changed", go: async (a) => ((a.$("#feature-edit-ok") as HTMLButtonElement).click(), a.settle()), drawn: 24500 },
    { name: "the Move tool", go: (a) => a.key("move-tool"), drawn: 24500 },
    { name: "Create sketch", go: async (a) => ((a.$("#create-sketch") as HTMLButtonElement).click(), a.settle()), drawn: 24500 },
    // Box 1 suppressed from its menu with the panel open: only Extrude 1 is built, 500 mm³.
    { name: "Box 1 suppressed", go: (a, { box }) => a.menu(box, "suppress"), drawn: 500 },
    // Extrude 1 deleted from its menu (nothing is built from it, so no question): only Box 1, 24,000 mm³.
    { name: "Extrude 1 deleted", go: (a, { extrude }) => a.menu(extrude, "delete"), drawn: 24000 },
  ];
  for (const way of ways) {
    const { doc, box, extrude } = await boxAndRegions();
    const a = await app(doc);
    await offered(a, extrude);
    await way.go(a, { box, extrude });
    assert.equal(a.$("#feature-edit")!.hidden, true, `${way.name}: Edit feature is closed`);
    assert.equal(drawn(a), way.drawn, `${way.name}: what is built is drawn`);
    assert.equal(shaded(a), 0, `${way.name}: no region stays shaded`);
    if (way.name === "Extrude 1 deleted") {
      assert.equal(await a.undo(), "Delete Extrude 1");
      assert.equal(drawn(a), 24500, "Undo brings Extrude 1's body back into the view");
    }
    assert.ok(await a.close(), way.name);
  }
});

test("Edit feature opened again on the same extrude keeps offering its regions, its body out of the view (by design)", async () => {
  const { doc, extrude } = await boxAndRegions();
  const a = await app(doc);
  await offered(a, extrude);
  await a.doubleClick(extrude);
  assert.equal(a.$("#feature-edit")!.hidden, false);
  assert.equal(shaded(a), 2);
  assert.equal(drawn(a), 24000);
  (a.$("#feature-edit-cancel") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(drawn(a), 24500);
  assert.equal(shaded(a), 0);
  assert.ok(await a.close());
});
