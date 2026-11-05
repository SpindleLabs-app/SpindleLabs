import assert from "node:assert/strict";
import { test } from "node:test";
import { boxValue, formatLength, fromMm, MM_PER_INCH, parseLength, readUnit, toMm } from "../src/model/units.ts";

test("hand-worked: an inch is exactly 25.4 mm, both ways", () => {
  assert.equal(MM_PER_INCH, 25.4);
  assert.equal(toMm(1, "in"), 25.4);
  assert.equal(fromMm(25.4, "in"), 1);
  // 2.5 in is 2.5 × 25.4 = 63.5 mm (2 × 25.4 = 50.8, plus half of 25.4 = 12.7).
  assert.equal(toMm(2.5, "in"), 63.5);
  assert.equal(toMm(7, "mm"), 7);
  assert.equal(fromMm(7, "mm"), 7);
});

test("hand-worked: the 40 × 30 × 20 mm box shown in inches", () => {
  // 40 / 25.4 = 1.5748031…, 30 / 25.4 = 1.1811023…, 20 / 25.4 = 0.7874015…: to 3 decimals 1.575, 1.181, 0.787.
  assert.equal(formatLength(40, "in"), "1.575 in");
  assert.equal(formatLength(30, "in"), "1.181 in");
  assert.equal(formatLength(20, "in"), "0.787 in");
  assert.equal(formatLength(40, "mm"), "40 mm");
  assert.equal(formatLength(25.4, "in"), "1 in");
  assert.equal(formatLength(0, "in"), "0 in");
  assert.equal(formatLength(-25.4, "in"), "-1 in");
  assert.equal(formatLength(0.0001, "in"), "0 in", "negative zero never shows");
  assert.equal(formatLength(-0.0001, "mm"), "0 mm");
  assert.equal(formatLength(NaN, "mm"), "—");
  assert.equal(formatLength(Infinity, "in"), "—");
});

test("a number box holds the whole value and reads back the same millimetres, far inside the kernel's 10 nm", () => {
  for (const mm of [40, 30, 20, 0.001, 1000, 123.456789, 1e-3 * 7, 999999.999]) {
    const back = toMm(Number(boxValue(mm, "in")), "in");
    assert.ok(Math.abs(back - mm) < 1e-6, // 1 nm, ten times inside the kernel's 10 nm
       `${mm} mm came back as ${back}`);
    assert.equal(Number(boxValue(mm, "mm")), mm);
  }
  assert.equal(boxValue(25.4, "in"), "1");
  assert.equal(boxValue(40, "mm"), "40");
});

test("typed lengths: a bare number is in the chosen unit, a suffix wins", () => {
  assert.equal(parseLength("25.4", "mm"), 25.4);
  assert.equal(parseLength("1", "in"), 25.4);
  assert.equal(parseLength("1in", "mm"), 25.4);
  assert.equal(parseLength("1 in", "mm"), 25.4);
  assert.equal(parseLength("1 inch", "mm"), 25.4);
  assert.equal(parseLength('1"', "mm"), 25.4);
  assert.equal(parseLength("25.4mm", "in"), 25.4);
  assert.equal(parseLength("  25.4 MM ", "in"), 25.4);
  assert.equal(parseLength("2.5 in", "mm"), 63.5);
  assert.equal(parseLength(".5", "in"), 12.7, "half an inch");
  assert.equal(parseLength("1e1", "mm"), 10);
  assert.equal(parseLength("-3", "mm"), -3, "the sign is the caller's to refuse, in its own words");
});

test("typed lengths: anything that isn't one is refused", () => {
  for (const bad of ["", "  ", "abc", "1 2", "1 ft", "1,5", "NaN", "Infinity", "1e999", "--1", "1..2", "in", "mm", "1 in in", "1mmm", "0x10"]) {
    assert.equal(parseLength(bad, "mm"), null, `"${bad}" is not a length`);
    assert.equal(parseLength(bad, "in"), null, `"${bad}" is not a length (inches)`);
  }
});

test("a saved unit choice reads back, anything odd is millimetres", () => {
  assert.equal(readUnit("in"), "in");
  assert.equal(readUnit("mm"), "mm");
  for (const odd of [undefined, null, "", "cm", 1, {}, "IN"]) assert.equal(readUnit(odd), "mm");
});
