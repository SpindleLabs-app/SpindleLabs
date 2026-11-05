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
