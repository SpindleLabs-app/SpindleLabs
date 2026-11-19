// The open project's undo steps kept in this browser (step 89): written each time the project's own save lands (and
// when the page is hidden or goes), so the steps kept are always this tab's steps over the state it stored; put back
// when the project is kept again after a reload or opened again from this browser, so the History panel and Undo carry
// on where they were. Only while the history is still as the project opened (nothing recorded yet), and only when the
// steps end at the project as it opens (`alignSteps`; `History.load` checks again): otherwise the history starts afresh.
// Two cases still fit (lost-work hunt 2026-11-12, issue #627 items 6 and 7; each emptied the History without a word):
// steps written by an older SpindleLabs, whose snapshots are brought up to date first (`upgrade`), and steps that stop
// one change short of the project because that change came back from the unsaved-changes journal (`follow`'s `left`).
// A tab whose saves are refused because another tab stored the project since writes none (save/load hunt C6: a stale
// tab's steps, written over the good tab's, left that tab with nothing to undo after its reload).
// A project opened with no steps kept keeps its opening step (`follow`'s `opened`; issue #764 S-4): a reload in the
// moment after its first change then puts that change back on it from the journal instead of leaving nothing to undo.

import type { History } from "@fission/core";
import { alignSteps, extendSteps, type StepsStore } from "@fission/storage";

export interface KeptSteps {
  /**
   * From now on the history is project `id`'s: its kept steps are read and put back if they fit, then kept as it changes.
   * `left`: the project opens with a change the last visit left with before its save landed, put back from the journal,
   * so steps that end before it get it as one more step (LEFT_LABEL) instead of being dropped.
   * `opened`: the project was opened (a file, or one kept in this browser), not started fresh. With no steps kept its
   * opening step is kept too, so a reload in the moment after its first change still has that change to undo (issue
   * #764 S-4): "stored", already in the store as it opens, writes it once read; "storing", stored by its first save,
   * writes it when that save lands. A fresh start (no `opened`) still writes nothing until something is recorded.
   */
  follow(id: string, left?: boolean, opened?: Opened): void;
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
  /**
   * A kept snapshot as today's readers write it (the project read and written again): steps kept by an older
   * SpindleLabs carry its data versions, and compared as text never fitted the project as it opens. Throws for a
   * snapshot that can't be read; then the steps are not put back.
   */
  upgrade?(snapshot: string): string;
}

/** How a followed project was opened: already in the store as it is, or stored by its first save (`KeptSteps.follow`). */
export type Opened = "stored" | "storing";

/** The History's name for a change put back from the unsaved-changes journal, whose own name went with the page. */
export const LEFT_LABEL = "Change before leaving";

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
    follow(next, left = false, opened) {
      if (id === next) return;
      api.stop();
      id = next;
      const mine = ++generation;
      reading = steps.read(next).then((saved) => {
        if (mine !== generation) return;
        let loaded = false;
        /** The steps put back are not the steps as kept (brought up to date, or one step longer): written again. */
        let changed = false;
        // Nothing recorded since the project opened: its kept steps go back if they end where it is now.
        if (saved !== null && history.steps().length === 1) {
          const present = capture();
          let fits = alignSteps(saved, present);
          if (fits === null) {
            let current: typeof saved | null = saved;
            if (options.upgrade) {
              try {
                const upgrade = options.upgrade;
                current = { kept: saved.kept.map((e) => ({ ...e, snapshot: upgrade(e.snapshot) })), index: saved.index };
                fits = alignSteps(current, present);
              } catch {
                current = null; // a snapshot today's readers refuse: the history starts afresh
              }
            }
            if (fits === null && left && current !== null) fits = extendSteps(current, present, now(), LEFT_LABEL);
            changed = fits !== null;
          }
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
        // An opened project with none kept keeps its opening step (S-4): written now when the store already holds it.
        const opening = saved === null && opened !== undefined;
        dirty = loaded ? changed : saved !== null || history.steps().length > 1 || opening;
        if (opening && opened === "stored" && !left) write(); // with a change from the journal on it, not until it is stored
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
