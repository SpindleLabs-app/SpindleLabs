import assert from "node:assert/strict";
import { test } from "node:test";
import { leftDragOf, MOUSE_PRESETS, readMousePreset } from "../src/model/mouse.ts";

// U2d: the mouse presets, hand-listed from the viewer's gestures (middle pans, Shift + middle orbits, the wheel zooms
// toward the pointer, the right button is kept for a menu, Escape puts a lit bar tool away).

test("two presets, SpindleLabs's own first; they differ in what the left drag does and nothing else", () => {
  assert.deepEqual(MOUSE_PRESETS.map((p) => [p.id, p.leftDrag]), [["spindle", "orbit"], ["fusion", "select"]]);
  const [spindle, fusion] = MOUSE_PRESETS;
  assert.equal(spindle.rows.length, fusion.rows.length);
  const same = spindle.rows.filter((r, i) => r.gesture === fusion.rows[i].gesture && r.does === fusion.rows[i].does);
  assert.equal(same.length, spindle.rows.length - 1, "every row but the left-button drag is the same");
  assert.equal(spindle.rows[1].gesture, "Left-button drag");
  assert.match(spindle.rows[1].does, /^Turns the view/);
  assert.match(fusion.rows[1].does, /^Nothing/);
});

test("every table names each button and key it uses, with a plain description", () => {
  for (const p of MOUSE_PRESETS) {
    assert.deepEqual(p.rows.map((r) => r.gesture), ["Left click", "Left-button drag", "Middle-button drag", "Shift + middle-button drag", "Wheel", "Ctrl + wheel, or a trackpad pinch", "Right button", "Escape"]);
    for (const r of p.rows) assert.ok(r.does.length > 5, r.gesture);
  }
});

test("stored values: only \"fusion\" is Fusion-style; anything else is SpindleLabs's own", () => {
  for (const [raw, want] of [["fusion", "fusion"], ["spindle", "spindle"], ["Fusion", "spindle"], [undefined, "spindle"], [3, "spindle"], ["", "spindle"]] as const) assert.equal(readMousePreset(raw), want, String(raw));
  assert.equal(leftDragOf("fusion"), "select");
  assert.equal(leftDragOf("spindle"), "orbit");
});
