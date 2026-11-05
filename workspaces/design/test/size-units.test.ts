import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { propertiesPanel } from "../src/properties.ts";

// U2c2: the Properties size boxes in the chosen unit. The document holds millimetres; a box shows mm or inches and
// `inputs[i].value` is always millimetres as text, so the rest of the workspace never knows which unit is on screen.

const { Window } = await import("happy-dom");

function setup(unit?: string) {
  const doc = new Window().document as unknown as Document;
  if (unit) doc.documentElement.dataset.unit = unit;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const p = propertiesPanel(slot);
  const $ = (id: string) => slot.querySelector<HTMLInputElement>(`#${id}`)!;
  const choose = (u: string) => {
    doc.documentElement.dataset.unit = u;
    const Ev = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
    doc.dispatchEvent(new Ev("unitchange", { detail: u }));
  };
  return { p, $, slot, choose };
}

test("millimetres: the box is the input's own text, as before", () => {
  const { p, $ } = setup();
  p.inputs[0].value = "40";
  assert.equal($("width").value, "40");
  $("width").value = "12.5";
  assert.equal(p.inputs[0].value, "12.5");
  $("width").value = "";
  assert.equal(p.inputs[0].value, "", "an empty box stays empty for the refusal to name");
  assert.equal(setup().slot.querySelector(".unit-name")!.textContent, "mm");
});

test("hand-worked: a 40 × 30 × 20 mm box in inches shows 1.575 × 1.181 × 0.787, and reads back as exactly 40, 30, 20 mm", () => {
  const { p, $, slot } = setup("in");
  ["40", "30", "20"].forEach((mm, i) => (p.inputs[i].value = mm));
  // 40 / 25.4 = 1.5748 → 1.575; 30 / 25.4 = 1.1811 → 1.181; 20 / 25.4 = 0.7874 → 0.787.
  assert.deepEqual([$("width").value, $("depth").value, $("height").value], ["1.575", "1.181", "0.787"]);
  assert.deepEqual(p.inputs.map((b) => b.value), ["40", "30", "20"], "the rounded text still means the exact millimetres it came from");
  assert.equal(slot.querySelector(".unit-name")!.textContent, "in");
});

test("a size typed in inches is read as millimetres: 2 in is 50.8 mm", () => {
  const { p, $ } = setup("in");
  $("width").value = "2"; // 2 × 25.4
  assert.equal(p.inputs[0].value, "50.8");
  $("width").value = "3"; // 3 × 25.4 = 76.2 (76.19999999999999 in floating point)
  assert.equal(p.inputs[0].value, "76.2");
  $("width").value = "";
  assert.equal(p.inputs[0].value, "");
});

test("choosing the other unit shows the same lengths in it, both ways, and loses nothing", () => {
  const { p, $, choose, slot } = setup();
  ["40", "30", "20"].forEach((mm, i) => (p.inputs[i].value = mm));
  choose("in");
  assert.deepEqual([$("width").value, $("depth").value, $("height").value], ["1.575", "1.181", "0.787"]);
  assert.equal(slot.querySelector(".unit-name")!.textContent, "in");
  choose("mm");
  assert.deepEqual([$("width").value, $("depth").value, $("height").value], ["40", "30", "20"]);
  assert.deepEqual(p.inputs.map((b) => b.value), ["40", "30", "20"]);
  // A length the inches text could not hold survives the round trip too.
  p.inputs[0].value = "40.0004";
  choose("in");
  choose("mm");
  assert.equal(p.inputs[0].value, "40.0004");
});

test("a box with a half-typed number keeps it through a unit change", () => {
  const { p, $, choose } = setup();
  $("width").value = "";
  choose("in");
  assert.equal($("width").value, "");
  assert.equal(p.inputs[0].value, "");
});

test("the body's volume and area follow the unit", () => {
  const { p, $, choose } = setup();
  const view = { volume: 16387.064, area: 645.16, vertices: 8, edges: 12, faces: 6, errors: [] } as unknown as BodyView;
  p.showBody(view, "Body 1");
  assert.equal($("volume").textContent, "16,387.064 mm³");
  choose("in");
  // 16387.064 mm³ is exactly one cubic inch (25.4³), 645.16 mm² one square inch.
  assert.equal($("volume").textContent, "1 in³");
  assert.equal($("area").textContent, "1 in²");
  choose("mm");
  assert.match($("area").textContent!, /645\.16 mm²$/);
});

test("a panel that was replaced stops listening", () => {
  const { slot, choose, p } = setup();
  const first = p.inputs[0].el;
  propertiesPanel(slot); // Design mounted again into the same slot
  choose("in");
  assert.equal(first.isConnected, false);
  assert.equal(slot.querySelector<HTMLInputElement>("#width")!.value, "1.575", "the new panel reshows its own boxes (the default 40 mm)");
});
