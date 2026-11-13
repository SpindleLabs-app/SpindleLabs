// A saved print file goes into the print log (account features 5, `@fission/print` print-log.ts): Slice for printing
// calls `logPrint` once the file is saved. Kept apart so the dialog's tests can count what it adds.

import { addPrint, PRINT_LOGGED_EVENT, type PrintMade } from "@fission/print";

/** Adds `made` to this browser's print log; true when it is kept. Never throws: storage blocked keeps nothing. */
export function logPrint(doc: Document, made: PrintMade, now = new Date()): boolean {
  let storage: Storage | null = null;
  try {
    storage = doc.defaultView?.localStorage ?? null;
  } catch {
    return false;
  }
  const added = addPrint(storage, made, now);
  if (added) doc.dispatchEvent(new (doc.defaultView?.CustomEvent ?? CustomEvent)(PRINT_LOGGED_EVENT, { detail: added.print }));
  return added !== null;
}
