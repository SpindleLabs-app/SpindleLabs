// The open project's undo steps kept in this browser (step 89): written each time the project's own save lands (and
// when the page is hidden or goes), so the steps kept are always this tab's steps over the state it stored; put back
// when the project is kept again after a reload or opened again from this browser, so the History panel and Undo carry
// on where they were. Only while the history is still as the project opened (nothing recorded yet), and only when the
// steps end at the project as it opens (`alignSteps`; `History.load` checks again): otherwise the history starts afresh.
// A tab whose saves are refused because another tab stored the project since writes none (save/load hunt C6: a stale
// tab's steps, written over the good tab's, left that tab with nothing to undo after its reload).

import type { History } from "@fission/core";
import { alignSteps, type StepsStore } from "@fission/storage";

export interface KeptSteps {
  /** From now on the history is project `id`'s: its kept steps are read and put back if they fit, then kept as it changes. */
  follow(id: string): void;
  /** The project's save landed: the steps changed since are written. */
  saved(): void;
  /** Writes the steps changed since the last write now (the page hidden or going), unless this tab's saves are refused. */
  flush(): void;
  /** Writes steps waiting, then stops following (before another project replaces this one and the history starts afresh). */
  stop(): void;
  /** The project followed, or null (for tests). */
  following(): string | null;
  /** Settles once the kept steps of the project followed have been read and put back or refused (for tests). */
  settled(): Promise<void>;
}

export interface KeptStepsOptions {
  now?(): number;
  /** True while this tab's saves are refused (another tab stored the project since): then no steps are written. */
  refused?(): boolean;
}

/** Keeps `history`'s steps in `steps`; `capture` is the project as text, the history's own capture. */
export function keptSteps(history: History, steps: StepsStore, capture: () => string, options: KeptStepsOptions = {}): KeptSteps {
  const now = options.now ?? (() => Date.now());
  const refused = options.refused ?? (() => false);
  let id: string | null = null;
  /** Reading the kept steps is done: until then nothing is written, so a fresh history never replaces them unread. */
  let ready = false;
  /** The history changed since the steps were last written. */
  let dirty = false;
  /** Counts follows and stops, so a read that answers late for a project no longer followed changes nothing. */
  let generation = 0;
  let reading: Promise<void> = Promise.resolve();

  const write = () => {
    if (id === null || !ready || !dirty || refused()) return;
    dirty = false;
    void steps.write(id, history.save(), now());
  };
  history.onChange(() => {
    if (id !== null && ready) dirty = true;
  });

  const api: KeptSteps = {
    follow(next) {
      if (id === next) return;
      api.stop();
      id = next;
      const mine = ++generation;
      reading = steps.read(next).then((saved) => {
        if (mine !== generation) return;
        let loaded = false;
        // Nothing recorded since the project opened: its kept steps go back if they end where it is now.
        if (saved !== null && history.steps().length === 1) {
          const fits = alignSteps(saved, capture());
          if (fits !== null) {
            try {
              loaded = history.load(fits);
            } catch {
              // refused inside an undo step: the history goes on as it is
            }
          }
        }
        ready = true;
        // Steps that couldn't go back are replaced by this history at the next save; ones put back are already kept.
        dirty = !loaded && (saved !== null || history.steps().length > 1);
      });
    },
    saved: write,
    flush: write,
    stop() {
      write();
      generation++;
      id = null;
      ready = false;
      dirty = false;
    },
    following: () => id,
    settled: () => reading,
  };
  return api;
}
