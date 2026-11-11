// The open project's undo steps kept in this browser (step 89): written a quiet moment after each change to the
// history (and at once when the page is hidden or goes), and put back when the project is kept again after a reload or
// opened again from this browser, so the History panel and Undo carry on where they were. Only while the history is
// still as the project opened (nothing recorded yet), and only when the steps end at the project as it opened
// (`alignSteps`; `History.load` checks again): otherwise the history starts afresh, and the next write replaces them.

import type { History } from "@fission/core";
import { alignSteps, type StepsStore } from "@fission/storage";

/** A quiet moment after a change to the history before its steps are written (ms). */
export const STEPS_QUIET_MS = 300;

export interface KeptSteps {
  /** From now on the history is project `id`'s: its kept steps are read and put back if they fit, then kept as it changes. */
  follow(id: string): void;
  /** Writes steps waiting for their quiet moment now (the page hidden or going). */
  flush(): void;
  /** Writes steps waiting, then stops following (before another project replaces this one and the history starts afresh). */
  stop(): void;
  /** The project followed, or null (for tests). */
  following(): string | null;
  /** Settles once the kept steps of the project followed have been read and put back or refused (for tests). */
  settled(): Promise<void>;
}

export interface KeptStepsOptions {
  quietMs?: number;
  now?(): number;
  setTimeout?(run: () => void, ms: number): unknown;
  clearTimeout?(timer: unknown): void;
}

/** Keeps `history`'s steps in `steps`; `capture` is the project as text, the history's own capture. */
export function keptSteps(history: History, steps: StepsStore, capture: () => string, options: KeptStepsOptions = {}): KeptSteps {
  const quietMs = options.quietMs ?? STEPS_QUIET_MS;
  const now = options.now ?? (() => Date.now());
  const later = options.setTimeout ?? ((run, ms) => globalThis.setTimeout(run, ms));
  const cancel = options.clearTimeout ?? ((t) => globalThis.clearTimeout(t as ReturnType<typeof globalThis.setTimeout>));
  let id: string | null = null;
  /** Reading the kept steps is done: until then nothing is written, so a fresh history never replaces them unread. */
  let ready = false;
  let timer: unknown = null;
  /** Counts follows and stops, so a read that answers late for a project no longer followed changes nothing. */
  let generation = 0;
  let reading: Promise<void> = Promise.resolve();

  const write = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (id === null || !ready) return;
    void steps.write(id, history.save(), now());
  };
  const schedule = () => {
    if (timer !== null) cancel(timer);
    timer = later(write, quietMs);
  };
  history.onChange(() => {
    if (id !== null && ready) schedule();
  });

  const api: KeptSteps = {
    follow(next) {
      if (id === next) return;
      api.stop();
      id = next;
      const mine = ++generation;
      reading = steps.read(next).then((saved) => {
        if (mine !== generation) return;
        // Nothing recorded since the project opened: its kept steps go back if they end where it is now.
        if (saved !== null && history.steps().length === 1) {
          const fits = alignSteps(saved, capture());
          if (fits !== null) {
            try {
              history.load(fits);
            } catch {
              // refused inside an undo step: the history goes on as it is
            }
          }
        }
        ready = true;
        schedule(); // the steps as they now are: those put back, or a fresh start in place of ones that didn't fit
      });
    },
    flush: () => void (timer !== null && write()),
    stop() {
      api.flush();
      generation++;
      id = null;
      ready = false;
    },
    following: () => id,
    settled: () => reading,
  };
  return api;
}
