import { test } from "node:test";
import assert from "node:assert/strict";
import { extrudePanel, type ExtrudePanelEvents } from "../src/extrude-panel.ts";
import { featureEditPanel } from "../src/feature-edit-panel.ts";

// U2c3: the Extrude distance box and the Edit feature boxes in the chosen unit. Outside the box the distance is always
// millimetres as text (what `on.distance`, `on.ok`, `typed` and the edit panel's OK report), whichever unit is on screen.

const { Window } = await import("happy-dom");

function setup(unit?: string) {
  const doc = new Window().document as unknown as Document;
  if (unit) doc.documentElement.dataset.unit = unit;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const choose = (u: string) => {
    doc.documentElement.dataset.unit = u;
    const Ev = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
    doc.dispatchEvent(new Ev("unitchange", { detail: u }));
  };
  return { doc, slot, choose };
}
function extrudeSetup(unit?: string) {
  const s = setup(unit);
  const seen: string[] = [];
  const events: ExtrudePanelEvents = {
    distance: (t) => seen.push(`d${t}`),
    flip: (t) => seen.push(`f${t}`),
    clear() {},
    ok: (t) => seen.push(`ok${t}`),
    cancel() {},
  };
  const panel = extrudePanel(s.slot, events);
  panel.show("Sketch 1", "10");
  const box = s.slot.querySelector<HTMLInputElement>("#extrude-distance")!;
  return { ...s, panel, box, seen };
}
const input = (el: HTMLInputElement, text: string) => {
  el.value = text;
  el.dispatchEvent(new (el.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("input"));
};

test("millimetres: the distance box is the input's own text, and says mm", () => {
  const { box, panel, seen, slot } = extrudeSetup();
  assert.equal(box.value, "10");
  assert.equal(slot.querySelector(".unit-name")!.textContent, "mm");
  assert.equal(box.getAttribute("aria-label"), "Distance in mm");
  input(box, "12.5");
  assert.deepEqual(seen, ["d12.5"]);
  assert.equal(panel.typed, "12.5");
});

test("inches: 25.4 mm shows 1, typing 2 in reports 50.8 mm, an arrow drag and Flip stay in millimetres outside", () => {
  const { box, panel, seen, slot } = extrudeSetup("in");
  panel.showDistance("25.4");
  assert.equal(box.value, "1", "25.4 mm / 25.4 = 1 in");
  assert.equal(panel.typed, "25.4");
  input(box, "2");
  assert.equal(panel.typed, "50.8", "2 in x 25.4 = 50.8 mm");
  assert.equal(seen.at(-1), "d50.8");
  slot.querySelector<HTMLButtonElement>("#extrude-flip")!.click();
  assert.equal(seen.at(-1), "f-50.8");
  assert.equal(box.value, "-2");
  assert.equal(slot.querySelector(".unit-name")!.textContent, "in");
  assert.equal(box.getAttribute("aria-label"), "Distance in in");
});

test("choosing the other unit re-shows the same length, and a closed panel stops following", () => {
  const { box, panel, choose, slot } = extrudeSetup();
  panel.showDistance("25.4");
  choose("in");
  assert.equal(box.value, "1");
  assert.equal(slot.querySelector(".unit-name")!.textContent, "in");
  choose("mm");
  assert.equal(box.value, "25.4");
  panel.hide();
  panel.show(null, "5");
  const again = slot.querySelector<HTMLInputElement>("#extrude-distance")!;
  choose("in");
  assert.equal(panel.typed, "5", "the first panel's listener no longer touches the new box, which holds 5 mm");
  assert.equal(again.value, "0.197", "5 / 25.4 = 0.19685 in, shown to 3 decimals");
});

test("a refusal's lengths are said in the unit", () => {
  const { panel, slot, choose } = extrudeSetup("in");
  panel.showError("The distance must be at most 25.4 mm.");
  assert.equal(slot.querySelector("#extrude-error")!.textContent, "The distance must be at most 1 in.");
  choose("mm");
  panel.showError("The distance must be at most 25.4 mm.");
  assert.equal(slot.querySelector("#extrude-error")!.textContent, "The distance must be at most 25.4 mm.");
});

test("Edit feature: the sizes show in inches and OK reports millimetres", () => {
  const { slot, doc, choose } = setup("in");
  const got: Record<string, string>[] = [];
  const panel = featureEditPanel(slot, { ok: (t) => void got.push(t), cancel() {} });
  panel.show({ id: "i1", name: "Extrude 1", shape: "sketch-extrude", sizes: { height: 50.8 }, flip: false } as never);
  const box = doc.querySelector<HTMLInputElement>("#edit-height")!;
  assert.equal(box.value, "2", "50.8 mm = 2 in");
  assert.equal(slot.querySelector(".unit-name")!.textContent, "in");
  box.value = "1";
  [...slot.querySelectorAll("button")].find((b) => b.textContent === "OK")!.click();
  assert.equal(got[0].height, "25.4", "1 in = 25.4 mm");
  choose("mm");
  assert.equal(box.value, "25.4");
  assert.equal(slot.querySelector(".unit-name")!.textContent, "mm");
  panel.showError("Too long: 25.4 mm");
  choose("in");
  panel.showError("Too long: 25.4 mm");
  assert.equal(slot.querySelector("#feature-edit-error")!.textContent, "Too long: 1 in");
});
