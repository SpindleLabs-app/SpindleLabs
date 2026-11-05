// The weight and cost badge after a slice (Ben, 2026-11-04): what the print
// takes in plastic, money and time, in one line under the slice's result,
// "About 12 g of PLA, A$0.30, 1 h 20 min of printing". The price per kg is
// the user's to change (a spool's price differs by brand and shop), kept in
// the browser; A$25 a kg, a common price for a 1 kg spool of PLA, until
// changed. Pure: slice-print.ts shows it.

/** A$ a kg until the user types their own. */
export const DEFAULT_PRICE_PER_KG = 25;
/** The highest price the box takes (A$ a kg): far above any filament, so a slip of the keys is refused, not shown as a cost. */
export const MAX_PRICE_PER_KG = 1000;
/** Where the price typed is kept. */
export const PRICE_KEY = "spindle-filament-price";

/** A weight as the slice's words give it: one decimal under 10 g, whole grams from there. */
export const grams = (g: number) => (g < 10 ? g.toFixed(1) : Math.round(g).toString());

/**
 * The moves' time in words, rounded to the nearest minute: "4 min",
 * "1 h 5 min"; under half a minute is "under a minute". Null for a time
 * that is not a number or below 0 (an engine fault), so no figure shows.
 */
export function timeWords(s: number): string | null {
  if (!(s >= 0) || !Number.isFinite(s)) return null;
  const min = Math.round(s / 60);
  if (min === 0) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

/** Australian dollars to the cent; under half a cent is "under A$0.01". */
export function money(dollars: number): string {
  if (dollars < 0.005) return "under A$0.01";
  return `A$${(Math.round(dollars * 100) / 100).toFixed(2)}`;
}

/** The badge's words for a slice's plastic (g) and time (s) at `pricePerKg`; null when the weight is not a number of grams. */
export function costWords(print: { filamentG: number; printTimeS: number }, pricePerKg: number): string | null {
  const g = print.filamentG;
  if (!(g >= 0) || !Number.isFinite(g)) return null;
  const time = timeWords(print.printTimeS);
  return [`About ${grams(g)} g of PLA`, money((g / 1000) * pricePerKg), ...(time === null ? [] : [`${time} of printing`])].join(", ");
}

/** The price box's words as A$ a kg: a number above 0 and at most MAX_PRICE_PER_KG, "A$" or "$" before it allowed; else null. */
export function readPrice(text: string): number | null {
  const t = text.trim().replace(/^A?\$\s*/i, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_PER_KG ? n : null;
}

/** The price kept in `storage`, else the default (nothing kept, unreadable, or storage blocked). */
export function rememberedPrice(storage: Pick<Storage, "getItem"> | null): number {
  try {
    const kept = storage?.getItem(PRICE_KEY);
    return (kept == null ? null : readPrice(kept)) ?? DEFAULT_PRICE_PER_KG;
  } catch {
    return DEFAULT_PRICE_PER_KG;
  }
}
