// Telling a double-click (or a finger's double-tap) on the view from two
// single clicks (Ben's idea, 2026-11-04: a double-click on a body picks the
// whole body). Pure, so the rules are unit-tested without a browser;
// viewer.ts keeps the last click and asks.

/** The longest time between the two clicks of a double-click, in ms: the usual desktop setting (the timeline's too). */
export const DOUBLE_PICK_MS = 500;

/**
 * How far (CSS px, straight line) the second click may land from the first:
 * a mouse barely moves (Windows allows 4 px each way, about 6 px straight),
 * a fingertip lands a little way off each time (about half a 44 px touch
 * target). The body picked is the one under the second click.
 */
export const DOUBLE_PICK_PX = { mouse: 6, touch: 24 } as const;

/** A click on the view: where (client px), when (ms), with what, and whether Shift was held. */
export interface ViewClick {
  x: number;
  y: number;
  at: number;
  touch: boolean;
  shift: boolean;
  /**
   * Where the camera was: its position (mm) then its turn (a quaternion).
   * A view changed between two clicks (Top, then Front) makes them two picks.
   */
  view: readonly number[];
}

/**
 * How far each camera number may differ between two clicks of one
 * double-click, relative to its size (at least 1): rounding as the view is
 * redrawn moves a phone's camera about 1e-14 of its 100 mm distance between
 * two taps, far below this; the smallest real view change (a View button,
 * an orbit by one pixel) moves it far above.
 */
export const VIEW_SLACK = 1e-9;

/** Whether two cameras are the same, number by number, within VIEW_SLACK. */
export function sameView(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= VIEW_SLACK * Math.max(1, Math.abs(x), Math.abs(b[i])));
}

/**
 * Whether `next` is the second click of a double-click whose first was
 * `last`: both with the same kind of pointer and both with Shift or both
 * without (a Shift-click then a quick plain click is a replace, not a
 * double: the smoke check's own habit), with the camera where it was (a
 * click, a View button, a click on the same spot is two picks of two
 * different faces), at most DOUBLE_PICK_MS apart
 * (a clock that went backwards never counts) and within that pointer's
 * DOUBLE_PICK_PX. The viewer forgets `last` after a double, so a third
 * quick click starts afresh rather than making a second double.
 */
export function isDoublePick(last: ViewClick | null, next: ViewClick): boolean {
  if (last === null || last.touch !== next.touch || last.shift !== next.shift || !sameView(last.view, next.view)) return false;
  const gap = next.at - last.at;
  if (!(gap >= 0 && gap <= DOUBLE_PICK_MS)) return false;
  return Math.hypot(next.x - last.x, next.y - last.y) <= (next.touch ? DOUBLE_PICK_PX.touch : DOUBLE_PICK_PX.mouse);
}
