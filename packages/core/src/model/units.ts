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
