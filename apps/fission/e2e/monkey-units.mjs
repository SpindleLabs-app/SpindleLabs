// What the monkey expects the Feature line and the Body panel to say once Settings shows inches (U2c, issue #427): the
// design keeps millimetres, the screens convert. Worked out here on its own (not with the app's units.ts), so a mistake
// there shows as a disagreement: 1 inch is exactly 25.4 mm, and a length is shown to 3 decimals, trailing zeros dropped.

export const MM_PER_INCH = 25.4;
const NUM = String.raw`-?\d+(?:\.\d+)?`;
/** A run of lengths a summary ends in its unit: "13 × 20 × 5 mm", "⌀14 × 30 mm", "(10, 0, -5) mm". */
const RUN = new RegExp(String.raw`\(?⌀?${NUM}(?:(?: × |, )⌀?${NUM})*\)? mm`, "g");

/** A length in mm as the screens write it in inches: 13 → "0.512". */
const inches = (mm) => {
  const s = (mm / MM_PER_INCH).toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

/** The summary `text` (millimetres, as the design keeps it) as the Feature line shows it in `unit`. Only numbers in a run that ends in "mm" are lengths; names ("Sketch 1") and angles stay. */
export function summaryShown(text, unit) {
  if (unit !== "in") return text;
  return text.replace(RUN, (run) => run.replace(new RegExp(NUM, "g"), (n) => inches(Number(n))).replace(/ mm$/, " in"));
}

/** A volume in mm³ in `unit`'s cube: in³ is 25.4³ = 16,387.064 mm³. */
export const volumeShown = (mm3, unit) => (unit === "in" ? mm3 / MM_PER_INCH ** 3 : mm3);

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/**
 * The number a panel shows, read back: grouped digits ("15,600.5 mm³") or,
 * outside 0.001 to 10¹², a power of ten ("9.153561614 × 10⁻⁴ in³"). Worked
 * out here on its own, not with the app's format.ts. Stripping everything
 * but digits and the point read "× 10⁻⁴" as more digits (issues #473, #480,
 * #481: 9.1535616141 for 0.000915, 2.35618977810 for 2.36 × 10¹³). NaN for
 * text with no number.
 */
export function shownNumber(text) {
  const m = /(-?[\d,]+(?:\.\d+)?)(?: × 10([⁻]?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+))?/.exec(text);
  if (!m) return NaN;
  const mantissa = Number(m[1].replace(/,/g, ""));
  if (m[3] === undefined) return mantissa;
  const exp = Number([...m[3]].map((c) => SUPERSCRIPT.indexOf(c)).join(""));
  return mantissa * 10 ** (m[2] ? -exp : exp);
}
