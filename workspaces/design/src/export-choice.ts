// File ▾ Export 3MF or OBJ… (step 77): one menu item that asks which, so
// File ▾ still fits a 375 × 667 phone. A modal <dialog> like Start fresh's:
// a button for each format with what it is for, Cancel (focused), Escape or
// a click outside closing it; its keys never reach the app's shortcuts.
// Styles: styles/export-choice.css.

import { DOWNLOAD_3MF, DOWNLOAD_OBJ } from "./mesh-export.ts";

/** The formats offered, in order: the action each runs and the words under its name. */
export const EXPORT_CHOICES = [
  { id: "export-choice-3mf", action: DOWNLOAD_3MF, name: "3MF", words: "For a slicer: sizes in millimetres, each body its own object." },
  { id: "export-choice-obj", action: DOWNLOAD_OBJ, name: "OBJ", words: "For another 3D program: each body its own object (OBJ has no units; the numbers are millimetres)." },
] as const;

export const EXPORT_CHOICE_ID = "file-export-mesh";
export const EXPORT_CHOICE_LABEL = "Export 3MF or OBJ…";

export interface ExportChoice {
  ask(): void;
  readonly open: boolean;
}

/** The dialog, in `slot`'s page; `choose` runs with the chosen format after it closes. */
export function exportChoice(slot: HTMLElement, choose: (format: (typeof EXPORT_CHOICES)[number]) => void): ExportChoice {
  const document = slot.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.id = "export-choice-dialog";
  dialog.className = "export-choice";
  dialog.setAttribute("aria-labelledby", "export-choice-heading");
  const heading = document.createElement("h2");
  heading.id = "export-choice-heading";
  heading.textContent = "Export every body shown as";
  const list = document.createElement("div");
  list.className = "export-choice-list";
  const close = () => {
    if (dialog.open) dialog.close();
  };
  for (const c of EXPORT_CHOICES) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = c.id;
    const name = document.createElement("strong");
    name.textContent = c.name;
    const words = document.createElement("span");
    words.textContent = c.words;
    b.append(name, words);
    b.addEventListener("click", () => {
      close();
      choose(c);
    });
    list.append(b);
  }
  const actions = document.createElement("div");
  actions.className = "export-choice-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "export-choice-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);
  actions.append(cancel);
  dialog.append(heading, list, actions);
  slot.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = e as MouseEvent;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) close();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  });
  return {
    ask() {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      cancel.focus();
    },
    get open() {
      return dialog.open;
    },
  };
}
