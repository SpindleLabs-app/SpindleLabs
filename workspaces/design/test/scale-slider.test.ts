// Scale's slider (scale-slider.ts, Ben 11-09): the factor at each position
// worked out by hand, where a typed factor puts it, and the slider wired into
// the Move panel in a real DOM (happy-dom): a drag sets the factor's box and
// asks for the preview, a typed factor moves the slider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { factorAt, factorWords, positionOf, SCALE_SLIDER_STEPS, STEPS_PER_TENFOLD } from "../src/scale-slider.ts";
import { movePanel, type MoveShow } from "../src/move-panel.ts";
import { NO_MOVE, type MoveValues } from "../src/move.ts";
import { readMoveBoxes } from "../src/move-tool.ts";

const { Window } = await import("happy-dom");

test("hand-worked: the factor at each slider position", () => {
  assert.equal(STEPS_PER_TENFOLD, 100);
  assert.equal(SCALE_SLIDER_STEPS, 100);
  // The middle is 10^0 = 1: the same size.
  assert.equal(factorAt(0), 1);
  // The ends are 10^1 = 10 and 10^-1 = 0.1.
  assert.equal(factorAt(100), 10);
  assert.equal(factorAt(-100), 0.1);
  // log10 2 = 0.30103, so 30 steps is 10^0.30 = 1.9953, two decimals 2.00; -30 steps is 10^-0.30 = 0.50119, so 0.50.
  assert.equal(factorAt(30), 2);
  assert.equal(factorAt(-30), 0.5);
  // One step: 10^0.01 = 1.02329, so 1.02; ten steps: 10^0.1 = 1.25893, so 1.26.
  assert.equal(factorAt(1), 1.02);
  assert.equal(factorAt(10), 1.26);
  // 70 steps: 10^0.7 = 5.01187, so 5.01 (close to 5, never claimed as 5).
  assert.equal(factorAt(70), 5.01);
  // Past an end is the end; a part step goes to the nearest; not a number is the middle.
  assert.equal(factorAt(250), 10);
  assert.equal(factorAt(-250), 0.1);
  assert.equal(factorAt(29.6), 2);
  assert.equal(factorAt(Number.NaN), 1);
});

test("hand-worked: where a typed factor puts the slider", () => {
  // 100 × log10 f to the nearest step: 2 is 30.1, so 30; 0.5 is -30.1, so -30; 1 is 0.
  assert.equal(positionOf(2), 30);
  assert.equal(positionOf(0.5), -30);
  assert.equal(positionOf(1), 0);
  // 3 is 100 × 0.47712 = 47.7, so 48.
  assert.equal(positionOf(3), 48);
  // Inside the ends at 0.9× and past them at 1.1× of each: 9 is 95.4 → 95, 11 is 104.1 → the end, 100;
  // 0.11 is -95.9 → -96, 0.09 is -104.6 → the end, -100.
  assert.equal(positionOf(9), 95);
  assert.equal(positionOf(11), 100);
  assert.equal(positionOf(0.11), -96);
  assert.equal(positionOf(0.09), -100);
  // A huge factor (refused by OK) still stands the slider at its end.
  assert.equal(positionOf(1e9), 100);
  // No factor: the slider stays where it was.
  assert.equal(positionOf(0), null);
  assert.equal(positionOf(-2), null);
  assert.equal(positionOf(Number.NaN), null);
  assert.equal(positionOf(Number.POSITIVE_INFINITY), null);
});

test("every slider position's factor puts the slider back there (round trip)", () => {
  for (let p = -SCALE_SLIDER_STEPS; p <= SCALE_SLIDER_STEPS; p++) {
    const f = factorAt(p);
    assert.ok(f > 0 && f >= 0.1 && f <= 10, `p ${p}: ${f}`);
    // Two decimals of rounding moves the factor under 1% at 0.1× (0.005 / 0.1 = 5%: about two steps there), so
    // allow the nearest step to be within the rounding's own reach.
    const back = positionOf(f)!;
    const reach = Math.ceil(Math.abs(Math.log10((f + 0.005) / f)) * STEPS_PER_TENFOLD) + 1;
    assert.ok(Math.abs(back - p) <= reach, `p ${p} → ${f} → ${back}`);
    if (p > -SCALE_SLIDER_STEPS) assert.ok(f >= factorAt(p - 1), `the factor never falls as the slider goes right (p ${p})`);
  }
  // From 1× up, two decimals is fine enough that every step comes back exactly.
  for (let p = 0; p <= SCALE_SLIDER_STEPS; p++) assert.equal(positionOf(factorAt(p)), p, `p ${p}`);
});

test("the spoken value", () => {
  assert.equal(factorWords(1), "1× (the same size)");
  assert.equal(factorWords(2), "2× (twice the size)");
  assert.equal(factorWords(0.5), "0.5× (half the size)");
  assert.equal(factorWords(1.26), "1.26×");
});

function setup() {
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const typed: Record<string, string>[] = [];
  const panel = movePanel(slot, { typed: (t) => typed.push(t), ok() {}, cancel() {}, centre() {}, snap() {} });
  const slider = doc.getElementById("scale-slider") as HTMLInputElement;
  const box = doc.getElementById("move-scale") as HTMLInputElement;
  const fire = (e: HTMLElement, kind: string) => e.dispatchEvent(new window.Event(kind) as unknown as Event);
  return { doc, panel, slider, box, typed, fire };
}

const show = (o: Partial<MoveShow> & { values?: Partial<MoveValues> }): MoveShow => ({ id: null, kind: "scale", name: "Scale", bodies: ["Box 1"], ...o, values: { ...NO_MOVE, ...o.values } });

test("the slider in the panel: in the Scale row, at 1× on a new Scale, at an edited Scale's factor", () => {
  const { doc, panel, slider } = setup();
  panel.show(show({}));
  assert.equal(slider.closest(".move-panel-row")?.id, "move-scale-row");
  assert.equal(slider.type, "range");
  assert.deepEqual([slider.min, slider.max, slider.step, slider.value], ["-100", "100", "1", "0"]);
  assert.equal(slider.getAttribute("aria-valuetext"), "1× (the same size)");
  // Move hides the Scale row, slider and all.
  panel.show(show({ kind: "move", name: "Move" }));
  assert.equal((doc.getElementById("move-scale-row") as HTMLElement).hidden, true);
  // An edited Scale by 2 opens with the slider at 30 steps.
  panel.show(show({ id: "feature-2", name: "Scale 1", values: { scale: 2 } }));
  assert.equal(slider.value, "30");
  assert.equal(slider.getAttribute("aria-valuetext"), "2× (twice the size)");
  // A new Scale after it starts in the middle again.
  panel.show(show({}));
  assert.equal(slider.value, "0");
});

test("dragging the slider sets the factor's box and asks for the preview each time; OK reads the box", () => {
  const { panel, slider, box, typed, fire } = setup();
  panel.show(show({}));
  slider.value = "30";
  fire(slider, "input");
  assert.equal(box.value, "2");
  assert.equal(typed.length, 1);
  assert.equal(typed[0].scale, "2");
  assert.deepEqual(readMoveBoxes(typed[0]), { values: { ...NO_MOVE, pivotX: 0, pivotY: 0, pivotZ: 0, scale: 2 } });
  slider.value = "-30";
  fire(slider, "input");
  assert.equal(box.value, "0.5");
  assert.equal(typed.at(-1)!.scale, "0.5");
  assert.equal(slider.getAttribute("aria-valuetext"), "0.5× (half the size)");
  // Back to the middle: no scale at all, as a typed 1.
  slider.value = "0";
  fire(slider, "input");
  assert.equal(panel.typed.scale, "1");
  assert.deepEqual(readMoveBoxes(panel.typed), { values: { ...NO_MOVE, pivotX: 0, pivotY: 0, pivotZ: 0 } });
});

test("typing a factor moves the slider; a factor it can't show leaves it at an end; no factor leaves it be", () => {
  const { panel, slider, box, typed, fire } = setup();
  panel.show(show({}));
  box.value = "3";
  fire(box, "input");
  assert.equal(slider.value, "48");
  assert.equal(typed.at(-1)!.scale, "3", "the box's own number, not the slider's 3.02");
  box.value = "25";
  fire(box, "input");
  assert.equal(slider.value, "100");
  assert.equal(panel.typed.scale, "25", "the slider at its end never changes what was typed");
  box.value = "-1";
  fire(box, "input");
  assert.equal(slider.value, "100", "a factor of no size leaves the slider where it was");
  // Cleared and left: the box shows 1 and the slider goes to the middle.
  box.value = "";
  fire(box, "input");
  fire(box, "blur");
  assert.equal(box.value, "1");
  assert.equal(slider.value, "0");
});
