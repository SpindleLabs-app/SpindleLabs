// Which clicks add to a selection (SL #524 item 3, as Fusion does): Shift, Ctrl, or Cmd on a Mac, each adds a row's body
// to what is selected or takes it out; a plain click selects only it. Used by the browser's rows (workspace.ts).

/** The keys held with a click. */
export interface ClickKeys {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Whether a click with these keys adds to the selection (or takes out what it is on) rather than replacing it. */
export const addsToSelection = (e: ClickKeys): boolean => e.shiftKey || e.ctrlKey || e.metaKey;
