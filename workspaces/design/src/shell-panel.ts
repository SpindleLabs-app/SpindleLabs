// The Shell panel (step 35h2c-app2, shell-tool.ts), at the top of the
// properties as Chamfer's is: which faces are open (or how to pick them),
// the wall thickness, the preview's note, the refusal, OK and Cancel. With
// a mouse the Thickness box takes the typing as the panel opens, its number
// selected, so "2" and Enter make the shell (Extrude's `typesStraightAway`);
// never on a touch screen, whose keyboard would cover the view. Enter
// anywhere in the panel but on a button is OK; Escape is Cancel. An edited
// Shell keeps its open faces (its thickness changes). The workspace drives
// it. Styles: src/styles/shell-panel.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { DEFAULT_THICKNESS, facesWords, type ShellPicks } from "./shell-tool.ts";
import { EDIT_FACES_NOTE, type EditableShell } from "./shell.ts";
import { typesStraightAway } from "./extrude-panel.ts";
import { sizeBox } from "./properties.ts";

export interface ShellEvents {
  /** The thickness changed: the error put away. */
  changed(): void;
  ok(): void;
  cancel(): void;
}

export interface ShellPanel {
  /** Opens a new Shell with `picks`, the thickness at the default; or Edit feature on a Shell, its thickness in the box, its faces as they are. */
  show(picks: ShellPicks, edit?: EditableShell): void;
  /** The Shell being edited (its id), or null for a new one. */
  readonly editing: string | null;
  /** The picks, as they change (a new Shell's). */
  setPicks(picks: ShellPicks): void;
  /** The wall thickness typed (mm, as text). */
  readonly typed: string;
  /** The live preview's state: the volume drawn (read by the e2e test), or null with why there is none ("" says nothing); `refused` says it in red as the kernel's refusal. */
  showPreview(volume: number | null, why?: string, refused?: boolean): void;
  /** Why OK recorded nothing ("" hides it), in the unit chosen in Settings. */
  showError(message: string): void;
  /** OK off while the kernel checks the shell, so a second press can't record twice. */
  busy(on: boolean): void;
  readonly ready: boolean;
  hide(): void;
  readonly shown: boolean;
}

export function shellPanel(slot: HTMLElement, on: ShellEvents): ShellPanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "shell-panel", "shell-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Shell");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "shell-title", "", "Shell");
  const faces = el("p", "shell-faces", "shell-panel-faces");
  const input = el("input", "shell-thickness");
  Object.assign(input, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false });
  const thickness = sizeBox(input, () => currentUnit(document));
  const row = el("label", "", "shell-panel-row");
  row.append(el("span", "", "shell-panel-legend", "Thickness"), input);
  const note = el("p", "shell-edit-note", "shell-panel-note", EDIT_FACES_NOTE);
  note.hidden = true;
  const previewWhy = el("p", "shell-preview-why", "shell-panel-note");
  previewWhy.hidden = true;
  const error = el("p", "shell-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const ok = el("button", "shell-ok", "", "OK");
  ok.type = "button";
  ok.title = "Make the shell (Enter)";
  ok.addEventListener("click", () => on.ok());
  const cancel = el("button", "shell-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  const buttons = el("div", "", "shell-panel-buttons");
  buttons.append(ok, cancel);
  box.append(title, faces, note, row, previewWhy, error, buttons);

  let open = false;
  let editing: string | null = null;
  let picked = false;
  const okState = () => (ok.disabled = ok.dataset.busy === "1" || !picked);
  input.addEventListener("input", () => on.changed());
  box.addEventListener("keydown", (e) => {
    const target = e.target as Element | null;
    // A button's own Enter clicks it; anywhere else in the panel Enter is OK.
    if (e.key === "Enter" && target?.tagName !== "BUTTON") {
      e.preventDefault();
      if (!ok.disabled) on.ok();
    }
    if (e.key === "Escape") on.cancel();
  });
  return {
    show(picks, edit) {
      open = true;
      editing = edit?.id ?? null;
      thickness.value = String(edit?.thickness ?? DEFAULT_THICKNESS);
      title.textContent = edit === undefined ? "Shell" : `Edit ${edit.name}`;
      note.hidden = edit === undefined;
      box.dataset.editing = editing ?? "";
      this.showPreview(null);
      error.hidden = true;
      delete ok.dataset.busy;
      if (edit === undefined) this.setPicks(picks);
      else {
        picked = true;
        faces.textContent = edit.open === 0 ? "No face open: sealed, hollow inside" : edit.open === 1 ? "1 face open" : `${edit.open} faces open`;
        faces.classList.remove("shell-panel-empty");
        okState();
      }
      box.dataset.shows = String(Number(box.dataset.shows ?? 0) + 1); // the phone's sheet opens again for a Shell started over an open one
      box.hidden = false;
      if (typesStraightAway(document)) {
        input.focus({ preventScroll: true });
        input.select();
      }
    },
    setPicks(picks) {
      picked = picks.body !== null;
      const touch = document.defaultView?.matchMedia?.("(pointer: coarse)").matches === true;
      faces.textContent = facesWords(picks, touch);
      faces.classList.toggle("shell-panel-empty", !picked);
      box.dataset.open = picks.faces.length.toString();
      okState();
    },
    get typed() {
      return thickness.value;
    },
    showError(message) {
      error.textContent = wordsInUnit(message, currentUnit(document));
      error.hidden = message === "";
    },
    busy(b) {
      if (b) ok.dataset.busy = "1";
      else delete ok.dataset.busy;
      okState();
    },
    get ready() {
      return !ok.disabled;
    },
    get editing() {
      return editing;
    },
    showPreview(volume, why = "", refused = false) {
      box.dataset.previewVolume = volume === null ? "" : volume.toFixed(3);
      box.dataset.previewRefused = String(refused);
      previewWhy.textContent = refused ? wordsInUnit(why, currentUnit(document)) : why;
      previewWhy.classList.toggle("bad", refused);
      previewWhy.hidden = why === "";
    },
    hide() {
      open = false;
      editing = null;
      this.showPreview(null);
      box.hidden = true;
      error.hidden = true;
      if (box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    },
    get shown() {
      return open;
    },
  };
}
