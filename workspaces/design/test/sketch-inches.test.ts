// SL #519 items 1, 2 and 4 (app bug hunt 2026-11-11): with inches chosen in Settings, the sketch's dimension labels,
// its Grid box and its refusals said millimetres, and the Length box took a unit one way only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionLabels } from "../src/constraint-tool.ts";
import { partDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawCircle, drawLine } from "../src/sketch.ts";
import { sketchPanel } from "../src/sketch-panel.ts";
import { MIN_TYPED } from "../src/typed-entry.ts";
import { readLengthIn } from "../src/typed-length.ts";

const { Window } = await import("happy-dom");

/** Sketch 1 on a box: a line (0, 0)–(25.4, 0) given a 25.4 mm length, and a circle round (60, 0) given a 25.4 mm diameter. */
function sized(): Sketch {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s.doc, s.id, [0, 0], [25.4, 0]);
  const c = drawCircle(l.doc, s.id, [60, 0], 12.7);
  const sketch = c.doc.sketches.find((q) => q.id === s.id)!;
  const line = sketch.curves.find((q) => q.id === l.id)!;
  if (line.kind !== "line") throw new Error("not a line");
  return {
    ...sketch,
    constraints: [
      { id: "constraint-1", kind: "distance", a: line.start, b: line.end, value: 25.4 },
      { id: "constraint-2", kind: "diameter", circle: c.id, value: 25.4 },
    ],
  };
}

test("item 1, hand-worked: a 25.4 mm length and diameter are labelled 1 and ⌀ 1 in inches (25.4 mm / 25.4 mm per inch), 25.4 and ⌀ 25.4 in mm", () => {
  const s = sized();
  assert.deepEqual(dimensionLabels(s, 1, "in").map((l) => l.text), ["1", "⌀ 1"]);
  assert.deepEqual(dimensionLabels(s, 1, "mm").map((l) => l.text), ["25.4", "⌀ 25.4"]);
  assert.deepEqual(dimensionLabels(s, 1).map((l) => l.text), ["25.4", "⌀ 25.4"], "millimetres when no unit is given");
  // 10 mm = 0.3937… in, shown to three places as the size boxes show inches: 0.394. A thin 0.5 mm = 0.019685 in: three
  // significant digits under an inch, 0.0197, never rounded to 0.02.
  const odd = { ...s, constraints: [{ ...s.constraints[0], value: 10 }, { ...s.constraints[1], value: 0.5 }] } as Sketch;
  assert.deepEqual(dimensionLabels(odd, 1, "in").map((l) => l.text), ["0.394", "⌀ 0.0197"]);
});

test("item 4, hand-worked: in millimetres a length followed by in, inch or \" is read in inches (1 in = 25.4 mm)", () => {
  assert.deepEqual(readLengthIn("1 in", "mm"), { value: 25.4 });
  assert.deepEqual(readLengthIn("1in", "mm"), { value: 25.4 });
  assert.deepEqual(readLengthIn("0.5 inch", "mm"), { value: 12.7 });
  assert.deepEqual(readLengthIn('2"', "mm"), { value: 50.8 });
  assert.deepEqual(readLengthIn("25.4 mm", "mm"), { value: 25.4 }, "mm after it stays exactly readLength");
  assert.deepEqual(readLengthIn("12.5", "mm"), { value: 12.5 });
  assert.match((readLengthIn("1 ft", "mm") as { error: string }).error, /isn't a length/, "another unit is still refused");
  assert.match((readLengthIn("1e1", "mm") as { error: string }).error, /isn't a length/, "a power of ten is refused in either unit");
  assert.match((readLengthIn("1e1", "in") as { error: string }).error, /isn't a length/);
});

test("item 4: the limits hold for inches typed in millimetres, at 0.9x and 1.1x of the smallest length (0.001 mm)", () => {
  const minIn = MIN_TYPED / 25.4;
  assert.ok("value" in readLengthIn(`${minIn * 1.1} in`, "mm"), "1.1x passes");
  const small = readLengthIn(`${minIn * 0.9} in`, "mm");
  assert.match((small as { error: string }).error, /at least 0\.001 mm/, "0.9x refused, in the unit chosen (mm)");
  assert.ok("value" in readLengthIn(`${(1e6 / 25.4) * 0.9} in`, "mm"));
  assert.ok("error" in readLengthIn(`${(1e6 / 25.4) * 1.1} in`, "mm"), "1.1x a kilometre refused");
});

function panel(unit?: string) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  if (unit) doc.documentElement.dataset.unit = unit;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const grids: string[] = [];
  const noop = () => {};
  const p = sketchPanel(slot, { pickPlane: noop, cancel: noop, grid: (t) => grids.push(t), gridSnap: noop, finish: noop, extrude: noop, lookAt: noop });
  p.showEditing("Sketch 1", "10", false, "line");
  const box = () => doc.getElementById("sketch-grid") as HTMLInputElement;
  const type = (text: string) => {
    box().value = text;
    box().dispatchEvent(new window.Event("change") as unknown as Event);
  };
  const choose = (u: string) => {
    doc.documentElement.dataset.unit = u;
    doc.dispatchEvent(new window.CustomEvent("unitchange", { detail: u }) as unknown as Event);
  };
  const label = () => (doc.querySelector(".sketch-grid") as HTMLElement).textContent!.trim();
  const error = () => doc.getElementById("sketch-grid-error")!.textContent;
  return { p, box, type, choose, label, error, grids };
}

test("item 2, hand-worked: in inches the Grid box shows 10 mm as 0.394 in and reads a typed 0.5 as 12.7 mm", () => {
  const { box, type, label, grids } = panel("in");
  assert.equal(box().value, "0.394", "10 / 25.4 = 0.3937");
  assert.match(label(), /in$/);
  type("0.5");
  assert.deepEqual(grids, ["12.7"], "0.5 in x 25.4 = 12.7 mm, told in millimetres");
  type("");
  assert.deepEqual(grids, ["12.7", ""], "an emptied box goes as typed, for the refusal to name");
});

test("item 2: in millimetres the Grid box is as before; choosing inches shows the same grid in inches", () => {
  const { box, type, choose, label, grids } = panel();
  assert.equal(box().value, "10");
  assert.match(label(), /mm$/);
  type("5");
  assert.deepEqual(grids, ["5"]);
  choose("in");
  assert.equal(box().value, "0.197", "5 / 25.4 = 0.19685");
  assert.match(label(), /in$/);
  choose("mm");
  assert.equal(box().value, "5");
});

test("item 1: the sketch panel's refusals say their lengths in inches when inches are chosen, mm when not", () => {
  const inches = panel("in");
  inches.p.showError("A dimension must be from 0.001 mm to 200000000 mm.");
  assert.doesNotMatch(inches.error()!, /\bmm\b/);
  assert.match(inches.error()!, /from 0\.0000394 in to 7874015\.748 in/, "0.001 / 25.4 and 2e8 / 25.4");
  inches.p.showError("The grid size must be at least 0.001 mm. The grid stays at 10 mm.");
  assert.match(inches.error()!, /The grid stays at 0\.394 in\./);
  const mm = panel();
  mm.p.showError("A dimension must be from 0.001 mm to 200000000 mm.");
  assert.equal(mm.error(), "A dimension must be from 0.001 mm to 200000000 mm.");
});
