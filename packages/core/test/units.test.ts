import assert from "node:assert/strict";
import { test } from "node:test";
import { areaIn, boxShown, boxValue, commaWords, formatLength, fromMm, MM_PER_INCH, parseLength, readDecimalText, readSizeText, readUnit, toMm, volumeIn, wordsInUnit } from "../src/model/units.ts";

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

test("hand-worked: areas and volumes in inches", () => {
  // A square inch is 25.4 × 25.4 = 645.16 mm², a cubic inch 25.4 × 645.16 = 16387.064 mm³.
  assert.equal(areaIn(645.16, "in"), 1);
  assert.ok(Math.abs(volumeIn(16387.064, "in") - 1) < 1e-12);
  // The 40 × 30 × 20 mm box: 24000 mm³ = 24000 / 16387.064 = 1.46457 in³ (1.575 × 1.181 × 0.787 = 1.4639 with the sides rounded).
  assert.ok(Math.abs(volumeIn(24000, "in") - 1.46457) < 1e-5);
  assert.equal(volumeIn(24000, "mm"), 24000);
  assert.equal(areaIn(5.5, "mm"), 5.5);
});

test("refusal words said in inches; millimetres are left exactly as they were", () => {
  const mm = "A length must be at least 0.001 mm, the smallest piece the modeller keeps.";
  assert.equal(wordsInUnit(mm, "mm"), mm);
  // 0.001 mm / 25.4 = 0.0000393701 in, to 3 significant digits 0.0000394.
  assert.equal(wordsInUnit(mm, "in"), "A length must be at least 0.0000394 in, the smallest piece the modeller keeps.");
  // 1 km = 1,000,000 mm = 39370.079 in.
  assert.equal(wordsInUnit("A length can be at most 1000000 mm (1 km), the largest size.", "in"), "A length can be at most 39370.079 in (1 km), the largest size.");
  assert.equal(wordsInUnit("Type the width in mm.", "in"), "Type the width in inches.");
  assert.equal(wordsInUnit("It is back to 40 mm.", "in"), "It is back to 1.575 in.");
  assert.equal(wordsInUnit("The volume is 5 mm³ over 2 mm².", "in"), "The volume is 5 mm³ over 2 mm².", "areas and volumes are not lengths");
  assert.equal(wordsInUnit("A length must be more than 0 mm.", "in"), "A length must be more than 0 in.");
});

test("hand-worked: what a number box shows in inches", () => {
  // 40 / 25.4 = 1.5748 → 1.575; 30 / 25.4 = 1.1811 → 1.181; 20 / 25.4 = 0.7874 → 0.787 (3 significant digits under an inch).
  assert.deepEqual([40, 30, 20].map((mm) => boxShown(mm, "in")), ["1.575", "1.181", "0.787"]);
  assert.equal(boxShown(0.5, "in"), "0.0197", "a 0.5 mm wall: 0.5 / 25.4 = 0.019685, not 0.02");
  assert.equal(boxShown(25.4, "in"), "1");
  assert.equal(boxShown(0.001, "in"), "0.0000394", "the smallest length, never in 1e-5 notation");
  assert.equal(boxShown(40, "mm"), "40", "millimetres are the whole value");
});

// U2c3: an item's summary said in inches for the browser, the timeline and the Feature line.
test("summaryInUnit: each summary's lengths in inches, worked by hand (mm / 25.4)", async () => {
  const { summaryInUnit } = await import("../src/model/units.ts");
  // 40 / 25.4 = 1.5748 -> 1.575, 30 / 25.4 = 1.1811 -> 1.181, 20 / 25.4 = 0.7874 -> 0.787.
  assert.equal(summaryInUnit("Box: 40 × 30 × 20 mm", "in"), "Box: 1.575 × 1.181 × 0.787 in");
  assert.equal(summaryInUnit("Cylinder: ⌀20 × 30 mm", "in"), "Cylinder: ⌀0.787 × 1.181 in");
  assert.equal(summaryInUnit("Sphere: ⌀25.4 mm", "in"), "Sphere: ⌀1 in");
  assert.equal(summaryInUnit("Extrude Sketch 1 by 10 mm", "in"), "Extrude Sketch 1 by 0.394 in"); // 10 / 25.4 = 0.3937
  assert.equal(summaryInUnit("Extrude Sketch 1 by 25.4 mm, flipped", "in"), "Extrude Sketch 1 by 1 in, flipped");
  assert.equal(summaryInUnit("Extrude: Plate 60 × 20 mm, by 4 mm", "in"), "Extrude: Plate 2.362 × 0.787 in, by 0.157 in"); // 60 / 25.4 = 2.3622, 4 / 25.4 = 0.1575
  assert.equal(summaryInUnit("Move Box 1 by (25.4, 0, -50.8) mm, turned 90° about Z", "in"), "Move Box 1 by (1, 0, -2) in, turned 90° about Z");
});

test("summaryInUnit: millimetres give the text back as it was, and nothing but the summary's own length places change", async () => {
  const { summaryInUnit } = await import("../src/model/units.ts");
  for (const text of ["Box: 40 × 30 × 20 mm", "Extrude Sketch 1 by 10 mm", "Sketch 1 on the XY plane", "Combine Box 1 and Box 2"]) assert.equal(summaryInUnit(text, "mm"), text);
  // A name that holds a number and "mm" is not a length: only the places the summaries put one are changed.
  assert.equal(summaryInUnit("Sketch 5 mm on the XY plane", "in"), "Sketch 5 mm on the XY plane");
  assert.equal(summaryInUnit("Extrude Washer 5 mm by 25.4 mm", "in"), "Extrude Washer 5 mm by 1 in");
  assert.equal(summaryInUnit("Combine Box 1 and Box 2", "in"), "Combine Box 1 and Box 2");
});

// Issue #518: a size box reads a unit after the number and a decimal comma itself, or refuses the text; nothing is dropped.
test("hand-worked: readSizeText reads mm, cm, m, in and \" after a number, with or without a space", () => {
  assert.deepEqual(readSizeText("2.5 cm", "mm"), { mm: 25 }); // 1 cm = 10 mm: 2.5 × 10 = 25
  assert.deepEqual(readSizeText("1in", "mm"), { mm: 25.4 }); // 1 in = 25.4 mm exactly
  assert.deepEqual(readSizeText("1 inch", "mm"), { mm: 25.4 });
  assert.deepEqual(readSizeText("2 inches", "mm"), { mm: 50.8 }); // 2 × 25.4
  assert.deepEqual(readSizeText('0.5"', "mm"), { mm: 12.7 }); // half of 25.4
  assert.deepEqual(readSizeText("0.04 m", "mm"), { mm: 40 }); // 1 m = 1000 mm: 0.04 × 1000 = 40
  assert.deepEqual(readSizeText("25.4mm", "in"), { mm: 25.4 }, "mm in an inch box is still mm");
  assert.deepEqual(readSizeText("1", "in"), { mm: 25.4 }, "a bare number is in the box's unit");
  assert.deepEqual(readSizeText(" 12 ", "mm"), { mm: 12 });
  assert.deepEqual(readSizeText("1e3", "mm"), { mm: 1000 });
  assert.deepEqual(readSizeText("0.3 cm", "mm"), { mm: 3 }, "rounded to 12 digits: 0.3 × 10 is 3.0000000000000004 in floating point");
});

test("hand-worked: a decimal comma is a point, a comma that could separate thousands is refused", () => {
  assert.deepEqual(readDecimalText("1,5"), { value: 1.5 });
  assert.deepEqual(readDecimalText(",5"), { value: 0.5 });
  assert.deepEqual(readDecimalText("-2,25"), { value: -2.25 });
  assert.deepEqual(readDecimalText("0,500"), { value: 0.5 }, "a leading 0 is never a thousands group");
  assert.deepEqual(readDecimalText("1234,567"), { value: 1234.567 }, "four digits before the comma are no thousands group");
  assert.deepEqual(readDecimalText("1,2345"), { value: 1.2345 }, "four digits after it are no group either");
  for (const t of ["1,000", "12,345", "999,999", "1,000,000", "1.000,5", "1,000.5"]) assert.deepEqual(readDecimalText(t), { why: "comma" }, t);
  assert.deepEqual(readDecimalText("1,"), { value: 1 }, "half typed, as 1. is");
  for (const t of ["", ",", "abc", "0x10", "Infinity", "1e999", "1..2", "1,5,"]) assert.equal("why" in readDecimalText(t), true, t);
  assert.deepEqual(readSizeText("1,000 mm", "mm"), { why: "comma" });
  assert.deepEqual(readSizeText("2.5 cx", "mm"), { why: "unreadable" }, "another word is refused, never dropped");
  assert.deepEqual(readSizeText("2.5 mm mm", "mm"), { why: "unreadable" });
  assert.match(commaWords(" 1,000 "), /^"1,000" could mean thousands or a decimal/);
});
