import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { commaWords } from "@fission/core";
import { panelSizeRefused, propertiesPanel } from "../src/properties.ts";

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

// Issue #518 (bug hunt 2026-11-11): the boxes were number boxes, so the browser threw away a typed unit or a decimal comma
// and the app read what was left: "1,5" built 15 mm, "2.5 cm" 2.5 mm, "25.4mm" in inches 25.4 in. Now they are text boxes
// (a decimal keypad on a phone) and every unit or comma is either read or refused in words, never dropped.

test("the size boxes are text boxes with a decimal keypad, so the browser keeps everything typed", () => {
  const { $ } = setup();
  for (const id of ["width", "depth", "height"]) {
    assert.equal($(id).type, "text", id);
    assert.equal($(id).inputMode, "decimal", id);
  }
});

test("hand-worked: a unit typed after the number is read, whichever unit the box shows (#518)", () => {
  const { p, $ } = setup();
  const reads = (typed: string) => (($("width").value = typed), p.inputs[0].value);
  assert.equal(reads("2.5 cm"), "25"); // 1 cm = 10 mm: 2.5 × 10 = 25
  assert.equal(reads("2.5cm"), "25");
  assert.equal(reads("1in"), "25.4"); // 1 in = 25.4 mm exactly
  assert.equal(reads('2"'), "50.8"); // 2 × 25.4 = 50.8
  assert.equal(reads("0.3 m"), "300"); // 1 m = 1000 mm: 0.3 × 1000 = 300 (299.99999999999994 in floating point, rounded)
  assert.equal(reads("12 mm"), "12");
  const inch = setup("in");
  inch.$("width").value = "25.4mm"; // in an inch box, "mm" still means millimetres: 25.4 mm, not 25.4 in (645.16 mm)
  assert.equal(inch.p.inputs[0].value, "25.4");
  inch.$("width").value = "1"; // a bare number is in the box's unit: 1 in = 25.4 mm
  assert.equal(inch.p.inputs[0].value, "25.4");
  inch.$("width").value = "2,5"; // 2.5 in = 2.5 × 25.4 = 63.5 mm
  assert.equal(inch.p.inputs[0].value, "63.5");
});

test("hand-worked: a decimal comma is a decimal point; a comma that could separate thousands is refused in words (#518)", () => {
  const { p, $ } = setup();
  const typed = () => Object.fromEntries(["width", "depth", "height"].map((k, i) => [k, p.inputs[i].value])) as Record<"width" | "depth" | "height", string>;
  ["40", "30", "20"].forEach((mm, i) => (p.inputs[i].value = mm));
  $("width").value = "1,5"; // one and a half: 1.5 mm, never 15
  assert.equal(p.inputs[0].value, "1.5");
  $("width").value = "0,250"; // a leading 0 is never a thousands group: 0.25 mm
  assert.equal(p.inputs[0].value, "0.25");
  $("width").value = "12,5 cm"; // 12.5 cm = 125 mm
  assert.equal(p.inputs[0].value, "125");
  for (const t of ["1,000", "12,345", "1,000,000", "1.000,5"]) {
    $("width").value = t;
    assert.equal(panelSizeRefused("box", typed()), `The width: ${commaWords(t)}`, t);
  }
  // Text that is no size is refused, never read as another number: the unit is not dropped, hex is not 16.
  for (const t of ["2.5 cx", "2.5 mm mm", "0x10", "1e999", "abc"]) {
    $("width").value = t;
    assert.equal(panelSizeRefused("box", typed()), "Type the width in mm.", t);
  }
});

test("0.9× and 1.1× of the largest size, typed in another unit (#518): 90,000 cm is taken, 110,000 cm refused", () => {
  const { p, $ } = setup();
  const typed = () => Object.fromEntries(["width", "depth", "height"].map((k, i) => [k, p.inputs[i].value])) as Record<"width" | "depth" | "height", string>;
  ["40", "30", "20"].forEach((mm, i) => (p.inputs[i].value = mm));
  $("width").value = "90000 cm"; // 900,000 mm: 0.9 × the 1,000,000 mm (1 km) the modeller works at
  assert.equal(p.inputs[0].value, "900000");
  assert.equal(panelSizeRefused("box", typed()), null);
  $("width").value = "110000 cm"; // 1,100,000 mm: 1.1 × 1 km
  assert.match(panelSizeRefused("box", typed())!, /^The width can be at most 1000000 mm/);
});
