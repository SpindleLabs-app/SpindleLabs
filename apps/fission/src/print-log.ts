// File ▾ > Print log… (account features 5): @fission/ui's dialog over @fission/print's log in this browser's storage.
// Works with no account and offline. The account code (src/print-log-sync.ts, in the account chunk) fills the
// dialog's account line and calls `refresh` when prints arrive from another device; a print saved from Slice for
// printing (PRINT_LOGGED_EVENT) and another tab's change (the storage event) redraw it too.

import { changePrint, PRINT_LOG_KEY, PRINT_LOG_LIMITS, PRINT_LOGGED_EVENT, PROBLEMS, readLog, removePrint, summaryWords, type ProblemId } from "@fission/print";
import { printLogDialog, type PrintLogDialog } from "@fission/ui";

export interface PrintLogView {
  show(): void;
  refresh(): void;
  readonly dialog: PrintLogDialog;
  /** Called after every change made in the dialog (the account's sync sends it a few seconds later). */
  onChange(listener: () => void): void;
}

/** The store, or null where storage is blocked. */
function storageOf(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

let started: PrintLogView | null = null;
/** The print log started on this page (the account's code reaches it here), or null before main.ts starts it. */
export const currentPrintLog = (): PrintLogView | null => started;

export function startPrintLog(doc: Document): PrintLogView {
  const win = doc.defaultView!;
  const store = storageOf(win);
  const listeners: (() => void)[] = [];
  const changed = <T>(ok: T): T => {
    if (ok) for (const l of listeners) l();
    return ok;
  };
  const dialog = printLogDialog(doc, {
    list: () => readLog(store).prints.map((p) => ({ ...p, madeAt: new Date(p.madeAt) })),
    summary: () => summaryWords(readLog(store).prints),
    problems: PROBLEMS,
    change: (id, change) => changed(changePrint(store, id, { ...change, problem: change.problem as ProblemId | null | undefined }, new Date()) !== null),
    remove: (id) => changed(removePrint(store, id)),
    noteMax: PRINT_LOG_LIMITS.note,
  });
  doc.addEventListener(PRINT_LOGGED_EVENT, () => dialog.refresh());
  win.addEventListener("storage", (e) => {
    if (e.key === PRINT_LOG_KEY || e.key === null) dialog.refresh();
  });
  started = {
    show: () => dialog.show(),
    refresh: () => dialog.refresh(),
    dialog,
    onChange: (l) => void listeners.push(l),
  };
  return started;
}
