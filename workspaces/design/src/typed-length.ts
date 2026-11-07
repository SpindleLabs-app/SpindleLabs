// A length typed in a sketch box in the unit chosen in Settings (U2c3), read as millimetres. Apart from typed-entry.ts,
// which the planted-bug tests copy and run on its own: it holds no runtime import.
import { toMm, wordsInUnit, type Unit } from "@fission/core";
import { DECIMAL, lengthRefused, MIN_TYPED, readDiameter, readLength, type Reading } from "./typed-entry.ts";

/**
 * A length typed in a box while the unit chosen in Settings is `unit` (U2c3), as millimetres. In millimetres it is exactly
 * `readLength`. In inches a bare number is inches, and one followed by mm, in, inch or " is in that unit; the same limits
 * apply to the millimetres it makes, and the refusals say lengths in inches.
 */
export function readLengthIn(text: string, unit: Unit): Reading {
  if (unit === "mm") return readLength(text);
  const t = text.trim();
  const m = /^(.*?)\s*(mm|inch|in|")?$/i.exec(t)!;
  if (!DECIMAL.test(m[1])) return { error: `"${t}" isn't a length: type a number of inches, like 1 or 0.5.` };
  const typed: Unit = m[2] === undefined ? unit : m[2].toLowerCase() === "mm" ? "mm" : "in";
  const value = toMm(Number(m[1]), typed);
  const refused = lengthRefused(value);
  return refused === null ? { value } : { error: wordsInUnit(refused, unit) };
}

/** A circle's diameter typed in `unit` (`readLengthIn`), its half still at least MIN_TYPED mm (`readDiameter`). */
export function readDiameterIn(text: string, unit: Unit): Reading {
  if (unit === "mm") return readDiameter(text);
  const r = readLengthIn(text, unit);
  if ("error" in r) return r;
  if (r.value / 2 < MIN_TYPED) return { error: wordsInUnit(`A circle's diameter must be at least ${2 * MIN_TYPED} mm: its radius can't be under ${MIN_TYPED} mm, the smallest piece the modeller keeps.`, unit) };
  return r;
}
