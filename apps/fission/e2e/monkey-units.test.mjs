import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryShown, volumeShown } from "./monkey-units.mjs";

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
