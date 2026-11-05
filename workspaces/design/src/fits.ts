// Fits that know your printer (P13, then P10; Ben 2026-11-05): print one
// small test piece, measure it with calipers, and from then on a hole or peg
// tagged with what it is for (an M3 bolt's clearance hole, a 6 mm pin's
// press fit) is printed at the size that comes out right on that printer.
//
// The size typed in the design never changes: it is the true size of the
// part. What is worked out here is only the size the printer is asked for,
// and every place that uses it shows both.
//
// How a printer gets sizes wrong, as modelled here (diameters d in mm):
//
//   an outside (a peg, a plate's length) comes out  s·d + 2·e(d)
//   a hole                                comes out  s·d − 2·c(d)
//
// s is the plastic's shrink as it cools (about 99.5 % to 100 % for PLA),
// e(d) how far a printed outside grows past its line on each side (the
// squashed line is wider than the model), c(d) how far a hole closes in on
// each side (the same squash, plus the inside of a curve pulling in). Small
// holes close in more than big ones, so e and c are measured at three sizes
// and read in between along straight lines (held flat past the ends).
//
// The test piece (fit-piece.ts) is a 120 mm plate with 5, 10 and 15 mm holes
// and pegs. Its length L = 120 and the 15 mm peg are both outsides with
// nearly straight walls, taken to grow by the same e, so their difference
// gives the shrink with e cancelled:
//
//   M_L − M_15 = s·(120 − 15)   so   s = (M_L − M_15) / 105
//
// and then each peg's e_i = (M_i − s·d_i) / 2 and each hole's
// c_i = (s·d_i − H_i) / 2.

import type { NozzleType } from "./slice-print.ts";

/** The test piece's sizes in mm: the plate's length, and the three sizes of hole and peg on it. */
export const PIECE = { length: 120, sizes: [5, 10, 15] as const } as const;

/** What was measured on a printed test piece, in mm: the plate's length, and each peg's and hole's diameter by size (5, 10, 15). */
export interface FitMeasures {
  length: number;
  pegs: readonly [number, number, number];
  holes: readonly [number, number, number];
}

/** A printer's fit allowances, worked out from FitMeasures (or the typical ones until it is measured). */
export interface FitProfile {
  /** Shrink: printed size over modelled size, before the squash. */
  scale: number;
  /** How far an outside grows on each side, at each test size (mm). */
  pegGrow: readonly [number, number, number];
  /** How far a hole closes in on each side, at each test size (mm). */
  holeShrink: readonly [number, number, number];
  /** False for TYPICAL_PROFILE: an estimate, never measured on this printer. */
  measured: boolean;
}

/**
 * What a P1S with PLA typically does, used until the test piece is measured, and said to be an estimate wherever it
 * is used: no shrink to speak of, outsides 0.1 mm big on each side, holes 0.15 mm small on each side (0.2 mm on the
 * smallest). Measuring replaces it.
 */
export const TYPICAL_PROFILE: FitProfile = { scale: 1, pegGrow: [0.1, 0.1, 0.1], holeShrink: [0.2, 0.15, 0.15], measured: false };

/**
 * The limits a measured piece must fall in, so a number typed in the wrong box (or the wrong peg measured) is
 * caught and never becomes the size every hole is printed at.
 *
 * - Each number within `near` mm (plus `nearPerMm` of the size) of the size it was meant to be.
 * - The shrink between `scaleLow` and `scaleHigh`: plastics shrink well under 2 %.
 * - Each side's allowance between `sideLow` and `sideHigh` mm: a 0.4 mm nozzle's line is never more than
 *   about half a line out on a side.
 * - The allowance changing by at most `slope` mm per mm of size between two test sizes. This also keeps the
 *   sizes to ask for in step with the sizes wanted (printedSize's search needs s − 2·slope > 0).
 */
export const LIMITS = { near: 1, nearPerMm: 0.03, scaleLow: 0.98, scaleHigh: 1.02, sideLow: -0.3, sideHigh: 0.6, slope: 0.1 } as const;

const NAMES = ["5 mm", "10 mm", "15 mm"] as const;

/** Rounds to 0.01 mm for words. */
const mm = (n: number): string => `${(Math.round(n * 100) / 100).toFixed(2)} mm`;

/**
 * The profile from what was measured, or the reason it can't be used, in words for the person who typed it. Every
 * number must be a finite number above 0 and near what it was meant to be (LIMITS), so a slip is caught here.
 */
export function profileOf(m: FitMeasures): FitProfile | { refused: string } {
  const all: [string, number, number][] = [
    ["The plate's length", m.length, PIECE.length],
    ...PIECE.sizes.map((d, i): [string, number, number] => [`The ${NAMES[i]} peg`, m.pegs[i]!, d]),
    ...PIECE.sizes.map((d, i): [string, number, number] => [`The ${NAMES[i]} hole`, m.holes[i]!, d]),
  ];
  for (const [what, got, meant] of all) {
    if (typeof got !== "number" || !Number.isFinite(got) || got <= 0) return { refused: `${what} needs a measurement in mm above 0.` };
    const off = Math.abs(got - meant);
    if (off > LIMITS.near + LIMITS.nearPerMm * meant) return { refused: `${what} was measured as ${mm(got)}, too far from ${mm(meant)} to be that part of the piece: measure it again.` };
  }
  // The squash that makes outsides grow makes holes close in, so each peg is wider than the hole of its size; a piece
  // whose pegs are not was measured the wrong way round (pegs typed as holes), which no other check would catch.
  for (let i = 0; i < 3; i++)
    if (!(m.pegs[i]! > m.holes[i]!)) return { refused: `The ${NAMES[i]} peg should measure wider than the ${NAMES[i]} hole: the pegs and holes look swapped, so check which box each number went in.` };
  const scale = (m.length - m.pegs[2]) / (PIECE.length - PIECE.sizes[2]);
  if (!(scale >= LIMITS.scaleLow && scale <= LIMITS.scaleHigh))
    return { refused: `The plate's length and the 15 mm peg don't agree (they say the plastic shrank to ${(scale * 100).toFixed(1)} %, and PLA shrinks far less): measure both again.` };
  const pegGrow = PIECE.sizes.map((d, i) => (m.pegs[i]! - scale * d) / 2) as unknown as [number, number, number];
  const holeShrink = PIECE.sizes.map((d, i) => (scale * d - m.holes[i]!) / 2) as unknown as [number, number, number];
  for (const [kind, sides] of [["peg", pegGrow], ["hole", holeShrink]] as const) {
    for (let i = 0; i < 3; i++) {
      const side = sides[i]!;
      if (!(side >= LIMITS.sideLow && side <= LIMITS.sideHigh)) {
        const words = kind === "peg" ? `grew by ${mm(side)} on each side` : `closed in by ${mm(side)} on each side`;
        return { refused: `The ${NAMES[i]} ${kind} ${words}, more than a printer does: measure it again.` };
      }
    }
    for (let i = 0; i < 2; i++) {
      const step = Math.abs(sides[i + 1]! - sides[i]!) / (PIECE.sizes[i + 1]! - PIECE.sizes[i]!);
      if (!(step <= LIMITS.slope)) return { refused: `The ${NAMES[i]} and ${NAMES[i + 1]} ${kind}s are too different to both be right: measure them again.` };
    }
  }
  return { scale, pegGrow, holeShrink, measured: true };
}

/** An allowance at diameter d: straight lines between the test sizes, flat past the ends. */
export function allowanceAt(sides: readonly [number, number, number], d: number): number {
  const [a, b, c] = PIECE.sizes;
  if (d <= a) return sides[0];
  if (d >= c) return sides[2];
  if (d <= b) return sides[0] + ((sides[1] - sides[0]) * (d - a)) / (b - a);
  return sides[1] + ((sides[2] - sides[1]) * (d - b)) / (c - b);
}

/** What a hole or peg modelled at diameter d comes out as on this printer. */
export function printsAs(p: FitProfile, role: "hole" | "peg", d: number): number {
  return role === "hole" ? p.scale * d - 2 * allowanceAt(p.holeShrink, d) : p.scale * d + 2 * allowanceAt(p.pegGrow, d);
}

/**
 * The diameter to ask the printer for so a hole or peg comes out at `want` mm: the d with printsAs(d) = want. printsAs
 * rises with d (its slope is at least s − 2·LIMITS.slope, above 0.7), so halving the bracket finds the one d, to far
 * below a micron; null when `want` is not a size above 0.
 */
export function printedSize(p: FitProfile, role: "hole" | "peg", want: number): number | null {
  if (!Number.isFinite(want) || want <= 0) return null;
  let low = 0;
  let high = 2 * want + 10;
  for (let i = 0; i < 200 && high - low > 1e-12; i++) {
    const mid = (low + high) / 2;
    if (printsAs(p, role, mid) < want) low = mid;
    else high = mid;
  }
  const d = (low + high) / 2;
  return d > 0 ? d : null;
}

/** Metric screw sizes: the clearance holes of ISO 273 (close and normal) and the coarse thread's pitch. */
export const METRIC: readonly { size: number; close: number; normal: number; pitch: number }[] = [
  { size: 2, close: 2.2, normal: 2.4, pitch: 0.4 },
  { size: 2.5, close: 2.7, normal: 2.9, pitch: 0.45 },
  { size: 3, close: 3.2, normal: 3.4, pitch: 0.5 },
  { size: 4, close: 4.3, normal: 4.5, pitch: 0.7 },
  { size: 5, close: 5.3, normal: 5.5, pitch: 0.8 },
  { size: 6, close: 6.4, normal: 6.6, pitch: 1 },
  { size: 8, close: 8.4, normal: 9, pitch: 1.25 },
  { size: 10, close: 10.5, normal: 11, pitch: 1.5 },
  { size: 12, close: 13, normal: 13.5, pitch: 1.75 },
];

/**
 * The gap each pin fit leaves across the diameter between a pin and its hole, in mm, once both are the size they
 * should be: press, pushed in hard and held by friction; slide, moves by hand with no play you can feel; loose,
 * turns freely. When both parts are printed, each takes half the gap.
 */
export const GAPS = { press: 0, slide: 0.15, loose: 0.3 } as const;

/** What a tagged hole or peg is for. The design's diameter is the bolt's, the pin's or the peg's own size. */
export type Fit =
  | { role: "hole"; kind: "bolt-close" | "bolt-normal" | "screw-thread" }
  | { role: "hole" | "peg"; kind: keyof typeof GAPS; partner: "bought" | "printed" };

/** A fit's name in words, for the size `d` typed. */
export function fitWords(fit: Fit, d: number): string {
  const n = Number(d.toFixed(3));
  if (fit.kind === "bolt-close") return `close clearance for an M${n} bolt`;
  if (fit.kind === "bolt-normal") return `clearance for an M${n} bolt`;
  if (!("partner" in fit)) return `for an M${n} screw to cut its own thread`;
  const what = fit.role === "hole" ? (fit.partner === "bought" ? `a ${n} mm metal pin or shaft` : `a printed ${n} mm peg`) : fit.partner === "bought" ? `a ${n} mm bought hole (a bearing or bushing)` : `a printed ${n} mm hole`;
  return `${fit.kind} fit ${fit.role === "hole" ? "for" : "into"} ${what}`;
}

/**
 * The size a tagged hole or peg should really be, from its fit and the size typed `d`, or why there is none: a bolt
 * or screw fit needs a metric size (M2 to M12) typed as the diameter.
 */
export function targetSize(fit: Fit, d: number): number | { refused: string } {
  if (!Number.isFinite(d) || d <= 0) return { refused: "A fit needs a diameter above 0." };
  if (!("partner" in fit)) {
    const m = METRIC.find((x) => Math.abs(x.size - d) < 1e-9);
    if (!m) return { refused: `A bolt or screw fit needs a metric size as the diameter (M2, M2.5, M3, M4, M5, M6, M8, M10 or M12), not ${Number(d.toFixed(3))} mm.` };
    return fit.kind === "bolt-close" ? m.close : fit.kind === "bolt-normal" ? m.normal : m.size - m.pitch;
  }
  const gap = GAPS[fit.kind] * (fit.partner === "printed" ? 0.5 : 1);
  const size = fit.role === "hole" ? d + gap : d - gap;
  return size > 0 ? size : { refused: "That fit leaves no peg: make it bigger." };
}

/** A tagged hole or peg worked out for printing: the size typed, the size it should come out, and the size the printer is asked for. */
export interface FitSizes {
  typed: number;
  target: number;
  printed: number;
}

/** fitSizes for `fit` on a printer with profile `p`, or why it can't be. */
export function fitSizes(p: FitProfile, fit: Fit, typed: number): FitSizes | { refused: string } {
  const target = targetSize(fit, typed);
  if (typeof target !== "number") return target;
  const printed = printedSize(p, fit.role, target);
  if (printed === null) return { refused: "That fit has no size to print." };
  return { typed, target, printed };
}

/** Where a nozzle's measured piece is kept in this browser (works offline, no account). */
export const fitKey = (nozzle: NozzleType): string => `spindlelabs.fits.${nozzle}`;

/** What is kept: the numbers measured (the profile is worked out again from them on every read, so it can't drift), and when. */
interface Kept {
  version: 1;
  measured: FitMeasures;
  at: string;
}

/** The measures kept for `nozzle`, or null when there are none or what is kept is not a valid piece (a corrupt or hand-edited entry is ignored, never used). */
export function keptMeasures(storage: Pick<Storage, "getItem"> | null, nozzle: NozzleType): { measured: FitMeasures; at: string } | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(fitKey(nozzle)) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const kept = JSON.parse(raw) as Partial<Kept>;
    const m = kept?.measured;
    const triple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number");
    if (kept?.version !== 1 || typeof kept.at !== "string" || !m || typeof m.length !== "number" || !triple(m.pegs) || !triple(m.holes)) return null;
    const measured: FitMeasures = { length: m.length, pegs: m.pegs, holes: m.holes };
    return "refused" in profileOf(measured) ? null : { measured, at: kept.at };
  } catch {
    return null;
  }
}

/** The profile in use for `nozzle`: the measured one kept in this browser, else TYPICAL_PROFILE. */
export function profileFor(storage: Pick<Storage, "getItem"> | null, nozzle: NozzleType): FitProfile {
  const kept = keptMeasures(storage, nozzle);
  const p = kept ? profileOf(kept.measured) : null;
  return p && !("refused" in p) ? p : TYPICAL_PROFILE;
}

/** Keeps `measured` for `nozzle` (only a valid piece: otherwise the reason, and nothing is kept). */
export function keepMeasures(storage: Pick<Storage, "setItem"> | null, nozzle: NozzleType, measured: FitMeasures, at: Date): FitProfile | { refused: string } {
  const p = profileOf(measured);
  if ("refused" in p) return p;
  const kept: Kept = { version: 1, measured: { length: measured.length, pegs: [...measured.pegs], holes: [...measured.holes] }, at: at.toISOString() };
  try {
    storage?.setItem(fitKey(nozzle), JSON.stringify(kept));
  } catch {
    return { refused: "This browser won't keep it (its storage is full or turned off), so it holds only until the page is closed." };
  }
  return p;
}

/** Forgets the measures kept for `nozzle`, so the typical allowances are used again. */
export function forgetMeasures(storage: Pick<Storage, "removeItem"> | null, nozzle: NozzleType): void {
  try {
    storage?.removeItem(fitKey(nozzle));
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** The profile in words: what this printer does to sizes. */
export function profileWords(p: FitProfile): string {
  const lead = p.measured ? "Measured on your printer:" : "Typical for a P1S with PLA (an estimate until you measure your own test piece):";
  const shrink = Math.abs(p.scale - 1) < 0.0005 ? "no shrink to speak of" : `shrinks to ${(p.scale * 100).toFixed(2)} %`;
  return `${lead} ${shrink}; outsides grow ${mm(p.pegGrow[1])} on each side, holes close in ${mm(p.holeShrink[1])} on each side (at 10 mm).`;
}

/** A tagged size in words, both sizes shown: "M3 bolt clearance: 3.00 mm in the design, should be 3.40 mm, printed at 3.72 mm". */
export function sizesWords(fit: Fit, s: FitSizes): string {
  return `${fitWords(fit, s.typed)}: ${mm(s.typed)} in the design, should come out ${mm(s.target)}, printed at ${mm(s.printed)}`;
}
