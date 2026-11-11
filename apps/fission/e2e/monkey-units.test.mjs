import { test } from "node:test";
import assert from "node:assert/strict";
import { shownNumber, summaryShown, volumeShown } from "./monkey-units.mjs";

test("a box, a cylinder and an extrude in inches, worked by hand", () => {
  // 13 / 25.4 = 0.51181… → 0.512; 20 / 25.4 = 0.78740… → 0.787; 5 / 25.4 = 0.19685… → 0.197 (the nightly's Body 1, issue #427).
  assert.equal(summaryShown("Box: 13 × 20 × 5 mm", "in"), "Box: 0.512 × 0.787 × 0.197 in");
  // ⌀14 / 25.4 = 0.55118… → 0.551; 30 / 25.4 = 1.18110… → 1.181.
  assert.equal(summaryShown("Cylinder: ⌀14 × 30 mm", "in"), "Cylinder: ⌀0.551 × 1.181 in");
  // 25.4 mm is exactly 1 in (trailing zeros dropped); "Sketch 1" is a name, not a length.
  assert.equal(summaryShown("Extrude Sketch 1 by 25.4 mm", "in"), "Extrude Sketch 1 by 1 in");
  assert.equal(summaryShown("Extrude Sketch 1 by 25.4 mm, flipped", "in"), "Extrude Sketch 1 by 1 in, flipped");
  // A move's offsets convert; its angle stays degrees.
  assert.equal(summaryShown("Move Box 1 by (50.8, 0, -12.7) mm, turned 90° about Z", "in"), "Move Box 1 by (2, 0, -0.5) in, turned 90° about Z");
});

test("lengths under an inch keep 3 significant figures, worked by hand (issue #473)", () => {
  // The nightly's Body 5: 1 / 25.4 = 0.039370… → 0.0394; 30 / 25.4 = 1.181102… → 1.181 (3 decimals from 1 in up);
  // 0.5 / 25.4 = 0.019685… → 0.0197. Three decimals would have said 0.039 and 0.02.
  assert.equal(summaryShown("Box: 1 × 30 × 0.5 mm", "in"), "Box: 0.0394 × 1.181 × 0.0197 in");
  // 0.001 mm (the smallest length) is 0.0000393700… in → 0.0000394, never 1e-5 notation; 25.4 mm stays 1.
  assert.equal(summaryShown("Box: 0.001 × 25.4 × 2.54 mm", "in"), "Box: 0.0000394 × 1 × 0.1 in");
  // The check can fail: the old 3-decimal reading is not what the panel says.
  assert.notEqual(summaryShown("Box: 1 × 30 × 0.5 mm", "in"), "Box: 0.039 × 1.181 × 0.02 in");
});

test("millimetres give the summary back as it is", () => {
  assert.equal(summaryShown("Box: 13 × 20 × 5 mm", "mm"), "Box: 13 × 20 × 5 mm");
  assert.equal(volumeShown(1300, "mm"), 1300);
});

test("a volume in cubic inches, worked by hand", () => {
  // 1 in³ = 25.4³ = 16,387.064 mm³, so 1300 mm³ = 0.0793309 in³ (the panel showed 0.07933086732 in³).
  assert.ok(Math.abs(volumeShown(1300, "in") - 0.07933086732) < 1e-11);
  assert.ok(Math.abs(volumeShown(16387.064, "in") - 1) < 1e-12);
});

test("the check can fail: a length left in millimetres, or a name converted, is not what inches show", () => {
  assert.notEqual(summaryShown("Box: 13 × 20 × 5 mm", "in"), "Box: 13 × 20 × 5 mm");
  assert.notEqual(summaryShown("Box: 13 × 20 × 5 mm", "in"), "Box: 13 × 20 × 5 in");
  assert.notEqual(summaryShown("Extrude Sketch 1 by 25.4 mm", "in"), "Extrude Sketch 0.039 by 1 in");
});

test("a shown volume read back, worked by hand, powers of ten included (issues #473, #480, #481)", () => {
  // Grouped digits: "9,298.852874" is 9298.852874.
  assert.equal(shownNumber("9,298.852874 in³"), 9298.852874);
  assert.equal(shownNumber("15,600 mm³"), 15600);
  // #473: a 1 × 30 × 0.5 mm box is 15 mm³ = 15 / 16,387.064 in³ = 0.000915356 in³, shown "9.153561614 × 10⁻⁴ in³".
  assert.ok(Math.abs(shownNumber("9.153561614 × 10⁻⁴ in³") - 15 / 16387.064) < 1e-12);
  // #480: a ⌀999999 × 30 mm cylinder is π · 499999.5² · 30 = 2.35619 × 10¹³ mm³.
  const cylinder = Math.PI * 499999.5 ** 2 * 30;
  assert.ok(Math.abs(shownNumber("2.356189778 × 10¹³ mm³") - cylinder) <= 1e-9 * cylinder);
  // #481: a ⌀999999 mm sphere is (4/3)π · 499999.5³ = 5.23597 × 10¹⁷ mm³.
  const sphere = (4 / 3) * Math.PI * 499999.5 ** 3;
  assert.ok(Math.abs(shownNumber("5.235972048 × 10¹⁷ mm³") - sphere) <= 1e-9 * sphere);
  // A one-figure mantissa and a two-figure exponent: "1 × 10⁻¹²".
  assert.equal(shownNumber("1 × 10⁻¹² mm³"), 1e-12);
});

test("the reading can fail: the old digits-only reading is not what the panel means", () => {
  // What the monkey read before: every digit and point kept, "× 10⁻⁴" as more digits.
  const old = Number("9.153561614 × 10⁻⁴ in³".replace(/[^\d.]/g, ""));
  assert.notEqual(shownNumber("9.153561614 × 10⁻⁴ in³"), old);
  assert.ok(Number.isNaN(shownNumber("")));
  assert.ok(Number.isNaN(shownNumber("— in³")));
});
