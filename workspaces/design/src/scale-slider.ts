// Scale's slider (Ben, 2026-11-09: "Scale and similar tools get sliders and
// show the result live before OK, no guessing"): a slider beside the factor
// box in the Move panel (move-panel.ts) that sets the factor while the
// preview follows it. The slider is logarithmic, so halving and doubling are
// the same distance either side of 1×: its position p runs from
// -SCALE_SLIDER_STEPS to +SCALE_SLIDER_STEPS and gives 10^(p / STEPS_PER_TENFOLD),
// 0.1× at the left end, 1× in the middle, 10× at the right end, rounded to
// hundredths so the box shows a number a person would type (0.5, 2, 1.26).
// A factor typed outside 0.1..10 puts the slider at that end; the box, not
// the slider, is what OK reads.

/** Slider steps from 1× to 10× (and from 1× down to 0.1×): each step is about 2.3% bigger. */
export const STEPS_PER_TENFOLD = 100;
/** The slider's ends: one tenfold either way. */
export const SCALE_SLIDER_STEPS = STEPS_PER_TENFOLD;

/** The factor at slider position `p` (a whole number in -STEPS..STEPS; outside is taken as the end), to two decimals. */
export function factorAt(p: number): number {
  if (!Number.isFinite(p)) return 1;
  const q = Math.max(-SCALE_SLIDER_STEPS, Math.min(SCALE_SLIDER_STEPS, Math.round(p)));
  return Math.round(10 ** (q / STEPS_PER_TENFOLD) * 100) / 100;
}

/** Where the slider stands for `factor` (a box's number): the nearest step, held at an end past it; null for no factor (0 or less, or not a number), when the slider stays where it was. */
export function positionOf(factor: number): number | null {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const p = Math.round(Math.log10(factor) * STEPS_PER_TENFOLD);
  return Math.max(-SCALE_SLIDER_STEPS, Math.min(SCALE_SLIDER_STEPS, p)) + 0;
}

/** The slider's spoken value: "2× (twice the size)", "0.5× (half the size)", else "1.26×". */
export function factorWords(f: number): string {
  if (f === 1) return "1× (the same size)";
  if (f === 2) return "2× (twice the size)";
  if (f === 0.5) return "0.5× (half the size)";
  return `${f}×`;
}
