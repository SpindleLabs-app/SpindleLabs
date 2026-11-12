// Undo/redo across all workspaces (roadmap step 20): one history of
// whole-project snapshots, shared by every workspace like the selection.
// Snapshots for now; from steps 24–25 a step becomes "undo this timeline
// edit" behind the same interface.
//
// The history never reads the project itself: `capture` gives the project
// as text (the shell passes projectToJson) and `restore` puts a snapshot
// back (the shell opens it like a file and remounts). Recording the same
// text as the present is a no-op, so a restore that reports itself as a
// change records nothing, and neither does an edit back to the same value.

/** Undo/redo across all workspaces. */
export interface History {
  canUndo(): boolean;
  canRedo(): boolean;
  /** What Undo would take back ("Change size"), or null when there is nothing to undo. */
  undoLabel(): string | null;
  /** What Redo would do again, or null when there is nothing to redo. */
  redoLabel(): string | null;
  /**
   * Records the project as it is now as one step named `label`, after a
   * change. Returns false when there was nothing to record (the same text
   * as the present, or a call made while a snapshot is being restored).
   * A step with the same `mergeKey` as the step recorded just before it,
   * within the merge time and with no undo or redo between, is folded into
   * that step (typing 4 then 0 in one box is one step); folded back to the
   * state before that step, the step disappears. Recording drops every
   * step that could be redone.
   */
  record(label: string, mergeKey?: string): boolean;
  /**
   * Every step kept, oldest first, for a list the person can jump about in: item 0 is the start (label ""), then one
   * item per step, each with when it was made (ms by the clock the history was given) and where it stands against the
   * present: "done" (before it), "current" (the project as it is now) or "undone" (a redo away or more).
   */
  steps(): HistoryStepInfo[];
  /**
   * Puts the project back as it was at step `step` of `steps()` (0 is the start), by as many undos or redos as it takes,
   * as one restore. Returns that step's label, or null when it is the present, or not a step (not a whole number, below
   * 0 or past the last). Refused inside an undo step, like undo and redo.
   */
  jumpTo(step: number): string | null;
  /** Puts back the state before the last step; returns that step's label, or null when there is nothing to undo. */
  undo(): string | null;
  /** Puts back the step last undone; returns its label, or null when there is nothing to redo. */
  redo(): string | null;
  /**
   * The steps kept, to put back later with `load` (a design tab left and returned to, tabs step 2). Opaque: a copy, so
   * later steps never change it.
   */
  save(): SavedHistory;
  /**
   * Puts back the steps `save` gave, when the project as it is now is exactly the present they ended at (the same text);
   * returns false and changes nothing otherwise (a different project, or one changed since: the caller starts afresh).
   * Past the limit the oldest steps go first, then the steps furthest a redo away.
   * Refused inside an undo step, like reset.
   */
  load(saved: SavedHistory): boolean;
  /** Forgets every step: the project as it is now becomes the start (a project opened or started afresh). */
  reset(): void;
  /**
   * Takes the project as it is now into the present, without a new step:
   * for a change nobody made, which Undo must not take back (a workspace
   * filling in its defaults the first time it is shown). Returns false when
   * there was nothing to take in, or during a restore. A present step left
   * the same as the state before it has nothing to undo, so it is removed.
   * The next record starts a step of its own (no merging across this),
   * unless `keepMerging`: for a change that follows from the step just
   * recorded (a sketch point following the edge it is pinned to, once the
   * edit has rebuilt: step 26f), which must not split the typing in one box
   * into a step per key.
   * Inside a step (below) it does nothing: the step takes everything in.
   */
  amend(keepMerging?: boolean): boolean;
  /**
   * Runs `run` as ONE undo step named `label`, however many changes it
   * makes: an ownership hand-over, or an accepted AI command (commands
   * only, one undo step). Records made inside are folded into it and
   * return false; a step inside a step joins the outer one. Changes no one
   * recorded before it starts are taken into the present first (as amend).
   * The step never merges with a neighbour. If nothing changed, nothing is
   * recorded and the redo is kept. If `run` throws, the project is put back
   * as it was when the step started, nothing is recorded, and the error
   * passes on. Undo, redo and reset inside a step are refused, as is a step
   * started while a snapshot is being put back. Returns what `run` returns.
   */
  step<T>(label: string, run: () => T): T;
  /**
   * True while undo or redo is putting a snapshot back: a workspace mounted
   * now is showing the same project a moment later, not an opened file, so
   * it keeps its camera and follows its selection.
   */
  restoring(): boolean;
  /** Called once after every change to what can be undone or redone; returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /**
   * Holds `work`, a step the person already asked for that records when the kernel answers (an OK it still checks),
   * until it settles either way; returns it. Undo or Redo pressed meanwhile waits (`whenIdle`, main.ts), so it takes
   * back that step, not the one before (clumsy hunt 2026-11-04: the step was lost, and the one before it undone).
   */
  hold<T>(work: Promise<T>): Promise<T>;
  /** The present step, for `amendStep` to name later: the same step until a record merges into it or an amend changes it. */
  present(): HistoryStep;
  /**
   * Puts right a step recorded earlier, the present or one since built on (Design's settle answered after the next
   * action was recorded: #624, #622): `rewrite` gets `step`'s snapshot and returns what it should have held all along,
   * or null to leave it. Nothing happens once `step` is gone or was changed since (`present`), nor during a restore or
   * a step. A step left the same as the one before it has nothing to undo, so it is removed. Returns whether it changed.
   */
  amendStep(step: HistoryStep, rewrite: (snapshot: string) => string | null): boolean;
  /** Whether held work is still running. */
  busy(): boolean;
  /** Settles once no held work runs, including work held while waiting; at once when none does. */
  whenIdle(): Promise<void>;
}

/** One step of a history, as `History.present` names it (opaque). */
export type HistoryStep = object;

/** The steps of a history, kept by `History.save` (opaque). */
export interface SavedHistory {
  readonly kept: readonly { snapshot: string; label: string; mergeKey: string | undefined; at: number }[];
  readonly index: number;
}

/** One line of `History.steps()`. */
export interface HistoryStepInfo {
  /** The step's name ("" for the start). */
  label: string;
  /** When it was made, ms. */
  at: number;
  state: "done" | "current" | "undone";
}

export interface HistoryOptions {
  /** The project as text, the same text for the same project. */
  capture(): string;
  /** Puts a snapshot back. If it throws, the history is left as it was and the error passes on. */
  restore(snapshot: string): void;
  /** Most undo steps kept; the oldest go first. Default UNDO_LIMIT. */
  limit?: number;
  /** Steps with one merge key closer together than this (ms) are one step (never across a clock set back). Default MERGE_MS. */
  mergeMs?: number;
  /** The clock, in ms (tests pass a fake one). */
  now?(): number;
}

/** Undo steps kept by default. A snapshot of today's project is a few kilobytes. */
export const UNDO_LIMIT = 100;
/** Edits of one thing closer together than this (ms) are one undo step. */
export const MERGE_MS = 1000;

interface Entry {
  snapshot: string;
  /** The step that led here ("" for the start). */
  label: string;
  mergeKey: string | undefined;
  at: number;
}

export function createHistory(options: HistoryOptions): History {
  const limit = options.limit ?? UNDO_LIMIT;
  const mergeMs = options.mergeMs ?? MERGE_MS;
  const now = options.now ?? (() => Date.now());
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`undo limit must be a whole number of steps, at least 1 (got ${limit})`);
  if (!(mergeMs >= 0)) throw new Error(`merge time must be 0 ms or more (got ${mergeMs})`);

  // entries[0] is the oldest state kept; entries[index] is the present.
  let entries: Entry[] = [];
  let index = 0;
  // Merging is allowed only straight after a record.
  let lastWasRecord = false;
  let restoring = false;
  /** Steps running (step() inside step() joins the outer one). */
  let grouping = 0;
  const refuseInStep = (what: string) => {
    if (grouping > 0) throw new Error(`can't ${what} while an undo step is running`);
  };
  /** Held work still running (`hold`). */
  const held = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  const start = () => {
    entries = [{ snapshot: options.capture(), label: "", mergeKey: undefined, at: now() }];
    index = 0;
    lastWasRecord = false;
  };
  start();

  /** Restores entries[to] and moves there; on a failed restore nothing moves. */
  const go = (to: number) => {
    restoring = true;
    try {
      options.restore(entries[to].snapshot);
    } finally {
      restoring = false;
    }
    index = to;
    lastWasRecord = false;
    changed();
  };

  const api: History = {
    canUndo: () => index > 0,
    canRedo: () => index < entries.length - 1,
    undoLabel: () => (index > 0 ? entries[index].label : null),
    redoLabel: () => (index < entries.length - 1 ? entries[index + 1].label : null),
    record(label, mergeKey) {
      if (restoring || grouping > 0) return false;
      const snapshot = options.capture();
      if (snapshot === entries[index].snapshot) return false;
      const t = now();
      const top = entries[index];
      entries.length = index + 1; // nothing to redo after a new step
      if (lastWasRecord && index > 0 && mergeKey !== undefined && top.mergeKey === mergeKey && t - top.at >= 0 && t - top.at < mergeMs) {
        if (snapshot === entries[index - 1].snapshot) {
          // Folded back to where the step started: the step is gone.
          entries.pop();
          index--;
          lastWasRecord = false;
        } else {
          entries[index] = { snapshot, label, mergeKey, at: t };
        }
      } else {
        entries.push({ snapshot, label, mergeKey, at: t });
        index++;
        if (entries.length > limit + 1) {
          entries.shift();
          index--;
        }
        lastWasRecord = true;
      }
      changed();
      return true;
    },
    steps: () => entries.map((e, i) => ({ label: e.label, at: e.at, state: i < index ? "done" : i === index ? "current" : "undone" })),
    jumpTo(step) {
      refuseInStep("jump back");
      if (!Number.isInteger(step) || step < 0 || step >= entries.length || step === index) return null;
      go(step);
      return entries[step].label;
    },
    undo() {
      refuseInStep("undo");
      if (index === 0) return null;
      const label = entries[index].label;
      go(index - 1);
      return label;
    },
    redo() {
      refuseInStep("redo");
      if (index === entries.length - 1) return null;
      go(index + 1);
      return entries[index].label;
    },
    save: () => ({ kept: entries.map((e) => ({ ...e })), index }),
    load(saved) {
      refuseInStep("load steps");
      const present = saved.kept[saved.index];
      if (!present || saved.kept.length === 0 || options.capture() !== present.snapshot) return false;
      entries = saved.kept.map((e) => ({ ...e }));
      index = saved.index;
      // Never more than the limit, whatever was kept (a damaged store, or a build with a bigger limit: save/load hunt C9):
      // the oldest go first, then the steps furthest a redo away, as record and step drop them.
      while (entries.length > limit + 1 && index > 0) {
        entries.shift();
        index--;
      }
      if (entries.length > limit + 1) entries.length = limit + 1;
      lastWasRecord = false;
      changed();
      return true;
    },
    reset() {
      refuseInStep("start the history afresh");
      start();
      changed();
    },
    amend(keepMerging = false) {
      if (restoring || grouping > 0) return false;
      const snapshot = options.capture();
      if (snapshot === entries[index].snapshot) return false;
      entries[index] = { ...entries[index], snapshot };
      if (index > 0 && snapshot === entries[index - 1].snapshot) {
        entries.splice(index, 1);
        index--;
        lastWasRecord = false;
      } else if (!keepMerging) lastWasRecord = false;
      changed();
      return true;
    },
    step(label, run) {
      if (restoring) throw new Error("can't start an undo step while undo or redo is putting a snapshot back");
      if (grouping > 0) return run();
      api.amend();
      const before = entries[index].snapshot;
      let result: ReturnType<typeof run>;
      let snapshot: string;
      grouping++;
      try {
        result = run();
        snapshot = options.capture(); // a project the step left unsaveable fails the step too
      } catch (e) {
        let unchanged = false;
        try {
          unchanged = options.capture() === before;
        } catch {
          // can't even be captured: put it back
        }
        if (!unchanged) {
          restoring = true;
          try {
            options.restore(before);
          } finally {
            restoring = false;
          }
        }
        throw e;
      } finally {
        grouping--;
      }
      if (snapshot === before) return result;
      entries.length = index + 1;
      entries.push({ snapshot, label, mergeKey: undefined, at: now() });
      index++;
      if (entries.length > limit + 1) {
        entries.shift();
        index--;
      }
      lastWasRecord = false;
      changed();
      return result;
    },
    restoring: () => restoring,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hold(work) {
      const done = work.then(
        () => void held.delete(done),
        () => void held.delete(done),
      );
      held.add(done);
      return work;
    },
    present: () => entries[index],
    amendStep(step, rewrite) {
      if (restoring || grouping > 0) return false;
      const at = entries.indexOf(step as Entry);
      if (at < 0) return false;
      const snapshot = rewrite(entries[at].snapshot);
      if (snapshot === null || snapshot === entries[at].snapshot) return false;
      if (at > 0 && snapshot === entries[at - 1].snapshot) {
        entries.splice(at, 1);
        if (at === index) lastWasRecord = false;
        if (at <= index) index--;
      } else entries[at] = { ...entries[at], snapshot };
      changed();
      return true;
    },
    busy: () => held.size > 0,
    async whenIdle() {
      while (held.size > 0) await Promise.all([...held]);
    },
  };
  return api;
}
