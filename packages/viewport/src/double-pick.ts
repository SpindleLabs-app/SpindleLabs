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

/** A click on the view: where (client px), when (ms) and with what. */
export interface ViewClick {
  x: number;
  y: number;
  at: number;
  touch: boolean;
}

/**
 * Whether `next` is the second click of a double-click whose first was
 * `last`: both with the same kind of pointer, at most DOUBLE_PICK_MS apart
 * (a clock that went backwards never counts) and within that pointer's
 * DOUBLE_PICK_PX. The viewer forgets `last` after a double, so a third
 * quick click starts afresh rather than making a second double.
 */
export function isDoublePick(last: ViewClick | null, next: ViewClick): boolean {
  if (last === null || last.touch !== next.touch) return false;
  const gap = next.at - last.at;
  if (!(gap >= 0 && gap <= DOUBLE_PICK_MS)) return false;
  return Math.hypot(next.x - last.x, next.y - last.y) <= (next.touch ? DOUBLE_PICK_PX.touch : DOUBLE_PICK_PX.mouse);
}
