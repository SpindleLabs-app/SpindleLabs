import { test } from "node:test";
import assert from "node:assert/strict";
import { movePanel, pivotWords, type MoveEvents } from "../src/move-panel.ts";
import { NO_MOVE } from "../src/move.ts";

// U2c3: the Move and Rotate boxes in the chosen unit. The distances and the pivot show mm or inches; the angles stay
// degrees; outside the panel (`typed`, the events, setValue, setValues) every length is millimetres as text.

const { Window } = await import("happy-dom");

function setup(unit?: string) {
  const doc = new Window().document as unknown as Document;
  if (unit) doc.documentElement.dataset.unit = unit;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const events: string[] = [];
  const on: MoveEvents = { typed: () => events.push("typed"), ok: (t) => events.push(`ok:${t.x}`), cancel() {}, centre() {}, snap() {} };
  const panel = movePanel(slot, on);
  panel.show({ id: null, kind: "move", name: "Move", bodies: ["Body 1"], values: { ...NO_MOVE } });
  const box = (k: string) => slot.querySelector<HTMLInputElement>(`#move-${k}`)!;
  const choose = (u: string) => {
    doc.documentElement.dataset.unit = u;
    const Ev = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
    doc.dispatchEvent(new Ev("unitchange", { detail: u }));
  };
  const typeIn = (k: string, text: string) => {
    box(k).value = text;
    box(k).dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("input"));
  };
  return { panel, slot, box, choose, typeIn, events };
}

test("millimetres: the boxes are as before and the legends say mm and °", () => {
  const { panel, slot, box, typeIn } = setup();
  typeIn("x", "12.5");
  assert.equal(panel.typed.x, "12.5");
  assert.equal(box("x").value, "12.5");
  const legends = [...slot.querySelectorAll(".move-panel-legend")].map((e) => e.textContent);
  // Scale's factor (step 35e2) has no unit: "×" in either.
  assert.deepEqual(legends, ["Distance (mm)", "Angle (°)", "Scale (×)", "Pivot (mm)"]);
});

test("inches: a typed 1 is 25.4 mm outside the box; setValue, the pivot and the legends follow the unit; angles stay degrees", () => {
  const { panel, slot, box, typeIn } = setup("in");
  assert.deepEqual([...slot.querySelectorAll(".move-panel-legend")].map((e) => e.textContent), ["Distance (in)", "Angle (°)", "Scale (×)", "Pivot (in)"]);
  typeIn("x", "1");
  assert.equal(panel.typed.x, "25.4", "1 in x 25.4 = 25.4 mm");
  panel.setValue("y", 50.8); // a handle drag, in millimetres
  assert.equal(box("y").value, "2", "50.8 mm / 25.4 = 2 in");
  assert.equal(panel.typed.y, "50.8");
  panel.setPivot([25.4, 0, 12.7]);
  assert.equal(box("pivotX").value, "1");
  assert.equal(box("pivotZ").value, "0.5");
  assert.equal(panel.typed.pivotZ, "12.7");
  typeIn("turnX", "90");
  assert.equal(panel.typed.turnX, "90", "an angle is degrees, not converted");
  assert.equal(slot.querySelector("#move-pivot-summary")!.textContent, "Pivot: centre of the bodies");
  typeIn("pivotX", "2");
  assert.equal(slot.querySelector("#move-pivot-summary")!.textContent, "Pivot (2, 0, 0.5) in");
});

test("a snap sets the lengths in millimetres and the boxes show them in inches", () => {
  const { panel, box } = setup("in");
  panel.setValues({ ...NO_MOVE, x: 12.7, turnZ: 45 });
  assert.equal(box("x").value, "0.5");
  assert.equal(panel.typed.x, "12.7");
  assert.equal(box("turnZ").value, "45");
});

test("choosing the other unit re-shows every length, keeps the exact millimetres, and leaves angles alone", () => {
  const { panel, box, choose, slot } = setup();
  panel.setValue("x", 0.123456789); // the box shows 0.123457 in mm; the number behind it is exact
  assert.equal(panel.typed.x, "0.123456789");
  choose("in");
  assert.equal(box("x").value, "0.00486", "0.123456789 / 25.4 = 0.004860 in to 3 significant digits");
  assert.equal(panel.typed.x, "0.123456789", "read back exactly, not through the rounded inches");
  choose("mm");
  assert.equal(panel.typed.x, "0.123456789");
  assert.equal(slot.querySelector(".move-panel-legend")!.textContent, "Distance (mm)");
  panel.setValue("turnY", 30);
  choose("in");
  assert.equal(panel.typed.turnY, "30");
});

test("an empty length box goes back to 0 on leaving it, in either unit", () => {
  const { panel, box, typeIn } = setup("in");
  typeIn("z", "");
  box("z").dispatchEvent(new (box("z").ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("blur"));
  assert.equal(box("z").value, "0");
  assert.equal(panel.typed.z, "0");
});

test("the panel's words say lengths in the unit", () => {
  const { slot, panel } = setup("in");
  panel.showError("Type the X distance in mm.");
  assert.equal(slot.querySelector("#move-error")!.textContent, "Type the X distance in inches.");
  assert.equal(pivotWords(true, ["1", "2", "3"], "in"), "Pivot (1, 2, 3) in");
  assert.equal(pivotWords(true, ["1", "2", "3"]), "Pivot (1, 2, 3) mm");
});

// Issue #518: the Move, Rotate and Scale boxes were number boxes too, so a browser dropped a typed unit or decimal comma.
test("hand-worked: Move's boxes read a unit and a decimal comma, and refuse what they can't read (#518)", () => {
  const { panel, box, typeIn } = setup();
  for (const k of ["x", "turnX", "scale", "pivotX"]) assert.deepEqual([box(k).type, box(k).inputMode], ["text", "decimal"], k);
  typeIn("x", "1,5");
  assert.equal(panel.typed.x, "1.5", "a decimal comma: 1.5 mm, never 15");
  typeIn("x", "2 cm");
  assert.equal(panel.typed.x, "20", "2 cm × 10 = 20 mm");
  typeIn("y", "1in");
  assert.equal(panel.typed.y, "25.4", "1 in = 25.4 mm");
  typeIn("turnX", "22,5");
  assert.equal(panel.typed.turnX, "22.5", "an angle with a decimal comma: 22.5°");
  typeIn("scale", "1,25");
  assert.equal(panel.typed.scale, "1.25");
  for (const [k, t] of [["x", "0x10"], ["x", "2 cx"], ["x", "1,000"], ["turnX", "0x10"], ["scale", "1,000"]]) {
    typeIn(k, t);
    assert.ok(!Number.isFinite(Number(panel.typed[k as "x"])), `${k} ${t} is read as no number, never as another one: ${panel.typed[k as "x"]}`);
  }
});
