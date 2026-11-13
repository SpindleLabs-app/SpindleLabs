// Units (UI plan U2c): the document keeps every length in millimetres; mm or inch only changes what is shown and typed.
// This file is the one place that converts, so no screen does its own sums. 1 inch is exactly 25.4 mm (the 1959 definition).

export type Unit = "mm" | "in";
export const UNITS: readonly Unit[] = ["mm", "in"];
export const MM_PER_INCH = 25.4;

/** A length typed or shown in `unit`, in millimetres. */
export const toMm = (value: number, unit: Unit): number => (unit === "in" ? value * MM_PER_INCH : value);
/** A length in millimetres, in `unit`. */
export const fromMm = (mm: number, unit: Unit): number => (unit === "in" ? mm / MM_PER_INCH : mm);

/**
 * What goes in a number box for a length of `mm`: the whole value in `unit`, 12 significant digits so a box read back
 * gives the same millimetres to far better than the kernel's 10 nm (a stored 40 mm in inches is 1.5748031496063, and reads back as 40).
 */
export const boxValue = (mm: number, unit: Unit): string => String(Number(fromMm(mm, unit).toPrecision(12)));

/** Decimals a length is shown with in words: 3 for mm (1 µm), 3 for inch (0.001 in = 25.4 µm), trailing zeros dropped. */
const SHOWN_DECIMALS = 3;

/** "40 mm", "1.575 in": for words and labels; not finite shows "—". */
export function formatLength(mm: number, unit: Unit): string {
  if (!Number.isFinite(mm)) return "—";
  const v = fromMm(mm, unit);
  const s = v.toFixed(SHOWN_DECIMALS).replace(/\.?0+$/, "");
  return `${s === "-0" ? "0" : s} ${unit}`;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * A length typed in a box as millimetres, or null when it isn't one. A bare number is in `unit` (the unit chosen in Settings);
 * a number followed by mm, in, inch or " is in that unit whatever Settings says ("25.4mm", "1 in", `1"`). Anything else
 * (empty, a second number, another unit, NaN, Infinity) is null: the caller says so in words and keeps the last good value.
 */
export function parseLength(text: string, unit: Unit): number | null {
  const m = /^\s*(.*?)\s*(mm|inch|in|")?\s*$/i.exec(text);
  if (!m || !NUMBER.test(m[1])) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const typed = m[2] === undefined ? unit : m[2].toLowerCase() === "mm" ? "mm" : "in";
  const mm = toMm(v, typed);
  return Number.isFinite(mm) ? mm : null;
}

/** Millimetres in one of each unit a size box reads after a number (issue #518): 1 cm = 10 mm, 1 m = 1000 mm, 1 in = 25.4 mm. */
const MM_IN: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: MM_PER_INCH, inch: MM_PER_INCH, inches: MM_PER_INCH, '"': MM_PER_INCH, "″": MM_PER_INCH };

/**
 * A plain number typed in a box, a decimal comma read as a point (issue #518: "1,5" is 1.5, as a de-DE keyboard types it; "1," is 1,
 * as "1." is, while it is being typed), or why
 * not: "comma" when a comma could as well separate thousands (one comma before exactly three digits after 1 to 3 others, "1,000",
 * or more than one separator, "1,000,000", "1.000,5"), so the box refuses the text rather than guess 1000 or 1; "unreadable"
 * for anything else that isn't a finite decimal (empty, "abc", "0x10", "Infinity", "1e999"). An exponent is a number ("1e3").
 */
export function readDecimalText(text: string): { value: number } | { why: "comma" | "unreadable" } {
  let t = text.trim();
  if (t.includes(",")) {
    if (!/^[+-]?(\d*,\d+|\d+,)$/.test(t)) return { why: /^[+-]?[\d.,]+$/.test(t) ? "comma" : "unreadable" };
    if (/^[+-]?[1-9]\d{0,2},\d{3}$/.test(t)) return { why: "comma" };
    t = t.replace(",", ".");
  }
  if (!NUMBER.test(t)) return { why: "unreadable" };
  const value = Number(t);
  return Number.isFinite(value) ? { value } : { why: "unreadable" };
}

/**
 * A size typed in a box as millimetres (issue #518), or why not (`readDecimalText`'s reasons). A bare number is in `unit`, the unit
 * the box shows; one followed by mm, cm, m, in, inch, inches or " (with or without a space) is in that unit whatever the box
 * shows ("2.5 cm" is 25 mm, "1in" is 25.4 mm, "25.4mm" in an inch box is 25.4 mm). Any other word after it is unreadable, never
 * dropped. Converted sizes are rounded to 12 significant digits, as `boxValue` (0.3 cm is 3 mm, not 3.0000000000000004).
 */
export function readSizeText(text: string, unit: Unit): { mm: number } | { why: "comma" | "unreadable" } {
  const m = /^\s*(.*?)\s*(mm|cm|m|inches|inch|in|"|″)?\s*$/i.exec(text);
  if (!m) return { why: "unreadable" };
  const n = readDecimalText(m[1]);
  if ("why" in n) return n;
  const per = m[2] === undefined ? toMm(1, unit) : MM_IN[m[2].toLowerCase()];
  if (per === 1) return { mm: n.value };
  const mm = n.value * per;
  return Number.isFinite(mm) ? { mm: Number(mm.toPrecision(12)) } : { why: "unreadable" };
}

/** What a size box says for text with a comma that could separate thousands (`readDecimalText`): type it again, unambiguously. */
export const commaWords = (text: string): string =>
  `"${text.trim()}" could mean thousands or a decimal: type it without the comma (1000), or with a point or one comma for a decimal (1.5 or 1,5).`;

/** A saved unit choice read back: anything but "mm" or "in" is millimetres. */
export const readUnit = (raw: unknown): Unit => (raw === "in" ? "in" : "mm");

/** A volume of `mm3` cubic millimetres in cubic `unit`s (a cubic inch is 25.4³ mm³ = 16387.064 mm³). */
export const volumeIn = (mm3: number, unit: Unit): number => (unit === "in" ? mm3 / MM_PER_INCH ** 3 : mm3);
/** An area of `mm2` square millimetres in square `unit`s (a square inch is 25.4² mm² = 645.16 mm²). */
export const areaIn = (mm2: number, unit: Unit): number => (unit === "in" ? mm2 / MM_PER_INCH ** 2 : mm2);

/** A number as plain decimal text (never 1e-7): at least 1 gets 3 decimals, a smaller one 3 significant digits; trailing zeros dropped. */
function plain(x: number): string {
  const s = Math.abs(x) >= 1 ? x.toFixed(3) : Number(x.toPrecision(3)).toFixed(12);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * What a number box shows for a length of `mm` (U2c2): millimetres as `boxValue` (the whole value); inches to 3 decimals,
 * or 3 significant digits under an inch so a thin 0.5 mm wall reads 0.0197, not 0.02 (the 40 × 30 × 20 mm box is
 * 1.575 × 1.181 × 0.787). A box that still holds this text is read back as the exact millimetres it was made from
 * (properties.ts `sizeBox`), so the rounding costs nothing until the person types in it.
 */
export const boxShown = (mm: number, unit: Unit): string => (unit === "in" ? plain(fromMm(mm, unit)) : boxValue(mm, unit));

/**
 * Words that give lengths in millimetres, said in `unit`: every "N mm" becomes the same length in the unit
 * ("0.001 mm" is "0.0000394 in"), and "in mm" ("Type the width in mm.") becomes "in inches". Areas and volumes
 * (mm² and mm³) are left alone: they are never in a refusal's words. Millimetres leave the text exactly as it was.
 */
export function wordsInUnit(text: string, unit: Unit): string {
  if (unit === "mm") return text;
  return text
    .replace(/\bin mm\b/g, "in inches")
    .replace(/(\d+(?:\.\d+)?(?:e[+-]?\d+)?) mm(?![²³\w])/gi, (_, n: string) => `${plain(fromMm(Number(n), unit))} in`);
}

/** The shortest and longest length the kernel works with, in millimetres: 1 µm to 1 km (a typed length, a grid size). */
export const MIN_LENGTH_MM = 1e-3;
export const MAX_LENGTH_MM = 1e6;

/**
 * Why a length of `mm` millimetres is refused (not more than 0, under 1 µm, over 1 km), in the words the sketch's typed
 * boxes use ("A length must be more than 0 mm."), or null. Design's `lengthRefused` is the same rule (tested equal).
 */
export function lengthLimitRefusal(mm: number): string | null {
  if (!(mm > 0)) return "A length must be more than 0 mm.";
  if (mm < MIN_LENGTH_MM) return `A length must be at least ${MIN_LENGTH_MM} mm, the smallest piece the modeller keeps.`;
  if (mm > MAX_LENGTH_MM) return `A length can be at most ${MAX_LENGTH_MM} mm (1 km), the largest size the modeller works at.`;
  return null;
}

/** One length in a summary's own text ("40", "-2.5", "1e-7"), shown in `unit` as `plain` shows a length. */
const inUnit = (n: string, unit: Unit): string => plain(fromMm(Number(n), unit));
const NUM = String.raw`-?\d+(?:\.\d+)?(?:e[+-]?\d+)?`;
/** "40 × 30 × 20" or "⌀20 × 30": numbers joined by × (a diameter sign allowed), as a part's summary writes its sizes. */
const RUN = String.raw`⌀?${NUM}(?: × ⌀?${NUM})*`;
const convertRun = (run: string, unit: Unit): string => run.replace(new RegExp(NUM, "g"), (n) => inUnit(n, unit));

/**
 * An item's summary (the intent's words, always saved in millimetres: "Box: 40 × 30 × 20 mm", "Extrude Sketch 1 by 10 mm",
 * "Move Box 1 by (10, 0, 0) mm, turned 90° about Z") said in `unit` for the browser, the timeline and the Feature line
 * (U2c3). Only the places the summaries put a length are touched (a part's sizes at the start, ` by N mm`, ` by (a, b, c) mm`),
 * never a name that happens to hold a number and "mm"; the angle (°) is left alone. Millimetres give the text back as it was.
 */
export function summaryInUnit(text: string, unit: Unit): string {
  if (unit === "mm") return text;
  return text
    .replace(new RegExp(String.raw`^(Box|Cylinder|Sphere): (${RUN}) mm`), (_, kind: string, run: string) => `${kind}: ${convertRun(run, unit)} in`)
    .replace(new RegExp(String.raw`^(Extrude: .*?) (${RUN}) mm, by (${NUM}) mm$`), (_, head: string, run: string, by: string) => `${head} ${convertRun(run, unit)} in, by ${inUnit(by, unit)} in`)
    .replace(new RegExp(String.raw` by \((${NUM}), (${NUM}), (${NUM})\) mm`), (_, x: string, y: string, z: string) => ` by (${inUnit(x, unit)}, ${inUnit(y, unit)}, ${inUnit(z, unit)}) in`)
    .replace(new RegExp(String.raw`^(Extrude .*) by (${NUM}) mm(, flipped)?$`), (_, head: string, by: string, flip: string | undefined) => `${head} by ${inUnit(by, unit)} in${flip ?? ""}`);
}
