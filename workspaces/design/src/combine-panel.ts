// The Combine panel (step 35f1c, combine.ts), at the top of the
// properties as Fusion's Combine box is: the target body, the tool bodies
// (in the order picked), the operation (Join, Cut, Intersect), Keep tools
// (off by default, as in Fusion), the kernel's refusal, OK and Cancel. One
// of the two body fields picks at a time: clicking a body in the view or
// its row in the browser fills the target first, then adds or takes out
// tools; a click on a field's row makes it the one that picks. An edited
// Combine (its timeline item opened) changes its operation and Keep tools;
// its bodies stay as made, the fields off and a note saying so (picking
// them again needs the view rolled back to it: a later step). Enter is
// OK; Escape is Cancel (workspace.ts). Shown only with `?combine` until
// step 35f5 (combine-flag.ts). The workspace drives it; the panel shows
// what it is given and reports what was clicked. Styles:
// src/styles/combine-panel.css.

import { COMBINE_OPERATIONS, type CombineOperation } from "./document.ts";
import { OPERATION_WORDS } from "./combine.ts";

/** Which body field the view's clicks fill. */
export type CombineField = "target" | "tools";

export interface CombineEvents {
  /** A field's row clicked: it picks from now on. */
  field(which: CombineField): void;
  /** The operation or Keep tools changed: the panel's state is read again. */
  changed(): void;
  ok(): void;
  cancel(): void;
}

/** What the panel opens on: a new Combine (no id) or Combine `id`'s, its name, and the body names and choices it starts with. */
export interface CombineShow {
  id: string | null;
  name: string;
  target: string | null;
  tools: readonly string[];
  operation: CombineOperation;
  keepTools: boolean;
  /** Why this Combine failed in the last rebuild, in the rebuild's words (#505): shown at the top of its edit panel. */
  failed?: string;
}

export interface CombinePanel {
  show(c: CombineShow): void;
  /** The picked bodies' names as the selection changes: the target (null: none yet) and the tools, in order. */
  setBodies(target: string | null, tools: readonly string[]): void;
  /** Which field picks now, lit. */
  setField(which: CombineField): void;
  readonly field: CombineField;
  readonly operation: CombineOperation;
  readonly keepTools: boolean;
  /** Why OK recorded nothing ("" hides it). */
  showError(message: string): void;
  /** OK off while the kernel checks the Combine, so a second press can't record twice. */
  busy(on: boolean): void;
  readonly ready: boolean;
  hide(): void;
  readonly shown: boolean;
  /** The Combine being edited, or null for a new one (or none open). */
  readonly editing: string | null;
}

/** What each field says with nothing in it. */
export const TARGET_EMPTY = "Click the body to change";
export const TOOLS_EMPTY = "Click the bodies to use as tools";
/** The same on a touch screen, which says Tap as the app's other touch words do. */
export const TARGET_EMPTY_TOUCH = "Tap the body to change";
export const TOOLS_EMPTY_TOUCH = "Tap the bodies to use as tools";
/** The note under an edited Combine's fields. */
export const EDIT_NOTE = "The bodies stay as this Combine was made. To use other bodies, delete it and make a new one.";

export function combinePanel(slot: HTMLElement, on: CombineEvents): CombinePanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "combine-panel", "combine-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Combine");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "combine-title");
  /** A body field: a button showing its bodies, pressed while it picks. */
  const fieldRow = (which: CombineField, legend: string) => {
    const b = el("button", `combine-${which}`, "combine-panel-field");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    const name = el("span", "", "combine-panel-legend", legend);
    const value = el("span", `combine-${which}-names`, "combine-panel-value");
    b.append(name, value);
    b.addEventListener("click", () => on.field(which));
    return { button: b, value };
  };
  const target = fieldRow("target", "Target body");
  const tools = fieldRow("tools", "Tool bodies");
  const operation = el("select", "combine-operation", "dark-select"); // styles/dark-select.css (packages/ui): the open list dark and readable
  operation.setAttribute("aria-label", "Operation");
  for (const op of COMBINE_OPERATIONS) {
    const o = el("option", "", "", OPERATION_WORDS[op]);
    o.value = op;
    operation.append(o);
  }
  operation.addEventListener("change", () => on.changed());
  const opLabel = el("label", "", "combine-panel-op");
  opLabel.append(el("span", "", "combine-panel-legend", "Operation"), operation);
  const keep = el("input", "combine-keep");
  keep.type = "checkbox";
  keep.addEventListener("change", () => on.changed());
  const keepLabel = el("label", "", "combine-panel-keep");
  keepLabel.append(keep, document.createTextNode(" Keep tools"));
  const note = el("p", "combine-note", "combine-panel-note", EDIT_NOTE);
  note.hidden = true;
  const why = el("p", "combine-why", "bad");
  why.hidden = true;
  why.setAttribute("role", "status");
  const error = el("p", "combine-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const ok = el("button", "combine-ok", "", "OK");
  ok.type = "button";
  ok.addEventListener("click", () => on.ok());
  const cancel = el("button", "combine-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  const buttons = el("div", "", "combine-panel-buttons");
  buttons.append(ok, cancel);
  box.append(title, why, target.button, tools.button, note, opLabel, keepLabel, error, buttons);
  box.addEventListener("keydown", (e) => {
    // A button's own Enter clicks it; anywhere else in the panel (the operation, Keep tools) Enter is OK.
    if (e.key === "Enter" && !ok.disabled && (e.target as Element | null)?.tagName !== "BUTTON") on.ok();
  });
  let field: CombineField = "target";
  let editing: string | null = null;
  let open = false;
  let hasTarget = false;
  let toolCount = 0;
  const setField = (which: CombineField) => {
    field = which;
    target.button.setAttribute("aria-pressed", String(editing === null && which === "target"));
    tools.button.setAttribute("aria-pressed", String(editing === null && which === "tools"));
  };
  const okState = () => (ok.disabled = ok.dataset.busy === "1" || !hasTarget || toolCount === 0);
  return {
    show(c) {
      editing = c.id;
      open = true;
      title.textContent = c.id === null ? c.name : `Edit ${c.name}`;
      operation.value = c.operation;
      keep.checked = c.keepTools;
      error.hidden = true;
      why.textContent = c.id !== null && c.failed ? `Couldn't be made: ${c.failed}` : "";
      why.hidden = why.textContent === "";
      note.hidden = c.id === null;
      target.button.disabled = tools.button.disabled = c.id !== null;
      delete ok.dataset.busy;
      this.setBodies(c.target, c.tools);
      setField(c.target === null ? "target" : "tools");
      box.dataset.shows = String(Number(box.dataset.shows ?? 0) + 1); // the phone's sheet opens again for a Combine started over an open one (#586)
      box.hidden = false;
    },
    setBodies(t, ts) {
      hasTarget = t !== null;
      toolCount = ts.length;
      const touch = document.defaultView?.matchMedia?.("(pointer: coarse)").matches === true;
      target.value.textContent = t ?? (touch ? TARGET_EMPTY_TOUCH : TARGET_EMPTY);
      target.value.classList.toggle("combine-panel-empty", t === null);
      tools.value.textContent = ts.length === 0 ? (touch ? TOOLS_EMPTY_TOUCH : TOOLS_EMPTY) : ts.join(", ");
      tools.value.classList.toggle("combine-panel-empty", ts.length === 0);
      okState();
    },
    setField,
    get field() {
      return field;
    },
    get operation() {
      return operation.value as CombineOperation;
    },
    get keepTools() {
      return keep.checked;
    },
    showError(message) {
      error.textContent = message;
      error.hidden = message === "";
    },
    busy(on) {
      if (on) ok.dataset.busy = "1";
      else delete ok.dataset.busy;
      okState();
    },
    get ready() {
      return !ok.disabled;
    },
    hide() {
      editing = null;
      open = false;
      box.hidden = true;
      error.hidden = true;
    },
    get shown() {
      return open;
    },
    get editing() {
      return editing;
    },
  };
}
