// Presses that come too quickly to be meant (clumsy-user hunt 2026-11-04): a double-click on Save, a held Enter, or
// an impatient thumb on Slice and download made a file per press. A press that comes within REPEAT_MS of the press
// before it, taken or not, belongs to the same burst and does nothing; so a burst of any length is one press, and a
// press after a pause is taken again. The buttons that save a file use one guard each (main.ts, slice-print.ts).

/** How close two presses must be to be one burst, in ms: about a system's double-click time (Windows' default is 500). */
export const REPEAT_MS = 500;

/** A guard for one button: call it on each press. */
export interface RepeatGuard {
  /** True when this press repeats the one before (ignore it), false when it is meant. */
  (): boolean;
  /** Lets the next press through, however soon: something was changed since, so a press now asks for something new. */
  reset(): void;
}

/** A RepeatGuard on the clock `now`, in ms. */
export function repeatGuard(now: () => number = () => performance.now()): RepeatGuard {
  let last = -Infinity;
  const guard = () => {
    const t = now();
    const repeat = t - last < REPEAT_MS;
    last = t;
    return repeat;
  };
  return Object.assign(guard, { reset: () => void (last = -Infinity) });
}
