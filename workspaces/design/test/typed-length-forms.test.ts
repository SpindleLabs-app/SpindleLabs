// SL #764 item 8 (phone lows, app-wide hunt 2026-11-14): the sketch's typed size boxes refused "12,5" and "3cm" while
// Extrude's distance box (core `readSizeText`, issue #518) takes them. A sketch box now reads every form a size box
// reads; what it read before is read the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readDiameterIn, readLengthIn } from "../src/typed-length.ts";

const mm = (r: { value: number } | { error: string }) => ("error" in r ? r.error : r.value);

test("hand-worked: a decimal comma and the units a size box takes", () => {
  // "12,5" is twelve and a half: one comma, one to three digits after it, read as a decimal point.
  assert.equal(mm(readLengthIn("12,5", "mm")), 12.5);
  // 3 cm = 3 × 10 mm = 30 mm; 0.5 m = 500 mm; "2 in" = 2 × 25.4 = 50.8 mm.
  assert.equal(mm(readLengthIn("3cm", "mm")), 30);
  assert.equal(mm(readLengthIn("3 cm", "mm")), 30);
  assert.equal(mm(readLengthIn("0.5 m", "mm")), 500);
  assert.equal(mm(readLengthIn("2 in", "mm")), 50.8);
  // In an inch box a bare "1,5" is 1.5 in = 38.1 mm, and "3cm" is still 30 mm.
  assert.equal(mm(readLengthIn("1,5", "in")), 38.1);
  assert.equal(mm(readLengthIn("3cm", "in")), 30);
  // A circle's diameter: "12,5" is 12.5 mm across.
  assert.equal(mm(readDiameterIn("12,5", "mm")), 12.5);
  assert.equal(mm(readDiameterIn("1 cm", "mm")), 10);
});

test("what the boxes read before is read the same, refusals in the same words", () => {
  assert.equal(mm(readLengthIn("25", "mm")), 25);
  assert.equal(mm(readLengthIn("12.5 mm", "mm")), 12.5);
  assert.match(String(mm(readLengthIn("abc", "mm"))), /isn't a length: type a number of mm/);
  assert.match(String(mm(readLengthIn("0", "mm"))), /more than 0 mm/);
  assert.match(String(mm(readLengthIn("abc", "in"))), /isn't a length: type a number of inches/);
  // 0,0015 mm is a length the modeller keeps, but half of it, 0.00075 mm, is under its 0.001 mm: refused as a diameter.
  assert.match(String(mm(readDiameterIn("0,0015", "mm"))), /diameter must be at least/);
  assert.match(String(mm(readDiameterIn("0.0015", "mm"))), /diameter must be at least/);
  assert.match(String(mm(readLengthIn("1e3", "mm"))), /isn't a length/, "a power of ten stays refused");
});

test("a comma that could mean thousands is refused in the size boxes' words; a unit's limits still hold", () => {
  assert.match(String(mm(readLengthIn("1,000", "mm"))), /could mean thousands or a decimal/);
  // 2 km is over the 1 km limit: refused, as 2000000 typed would be.
  assert.match(String(mm(readLengthIn("2000 m", "mm"))), /at most/);
  assert.match(String(mm(readLengthIn("3 furlongs", "mm"))), /isn't a length/);
});
