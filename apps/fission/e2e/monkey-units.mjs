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

/** A volume in mm³ in `unit`'s cube: in³ is 25.4³ = 16,387.064 mm³. null (a volume the model can't work out) stays null, never 0 (issues #474, #483, #485, #486). */
export const volumeShown = (mm3, unit) => (mm3 === null || unit !== "in" ? mm3 : mm3 / MM_PER_INCH ** 3);
