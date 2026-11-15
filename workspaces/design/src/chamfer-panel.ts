// The Chamfer panel (step 44a-app2, chamfer-tool.ts), at the top of the
// properties as Combine's is: how many edges are picked (or how to pick
// them), the chamfer's type (Equal distance, Two distances, Distance and
// angle, as Fusion offers them), its distance, the second distance or the
// angle, Flip (which face the first size is measured along; nothing to flip
// for an equal chamfer, so hidden then), the refusal, OK and Cancel. With a
// mouse the Distance box takes the typing as the panel opens, its number
// selected, so "2" and Enter make the chamfer (Extrude's
// `typesStraightAway`); never on a touch screen, whose keyboard would cover
// the view. Enter anywhere in the panel but on a button is OK; Escape is
// Cancel. The workspace drives it. Styles: src/styles/chamfer-panel.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { CHAMFER_KINDS, DEFAULT_ANGLE, DEFAULT_CHAMFER, edgesWords, KIND_WORDS, type ChamferKind } from "./chamfer-tool.ts";
import { EDIT_EDGES_NOTE, type EditableChamfer } from "./chamfer.ts";
import { typesStraightAway } from "./extrude-panel.ts";
import { sizeBox } from "./properties.ts";

export interface ChamferEvents {
  /** A box, the type or Flip changed: the error put away. */
  changed(): void;
  ok(): void;
  cancel(): void;
}

/** What the boxes hold: the type, the distance (mm, as text), the second distance (mm) or the angle (degrees), and Flip. */
export interface ChamferTyped {
  kind: ChamferKind;
  first: string;
  second: string;
  flip: boolean;
}

export interface ChamferPanel {
  /** Opens a new Chamfer with `edges` picked, its boxes at the defaults; or Edit feature on a Chamfer (44a-app3), its boxes holding its size and Flip, its edges as they are. */
  show(edges: number, edit?: EditableChamfer): void;
  /** The Chamfer being edited (its id), or null for a new one. */
  readonly editing: string | null;
  /** The live preview's state (44a-app3): the volume drawn (read by the e2e test), or null with why there is none ("" says nothing). */
  showPreview(volume: number | null, why?: string): void;
  /** The number of edges picked, as the picks change. */
  setEdges(count: number): void;
  readonly typed: ChamferTyped;
  /** Why OK recorded nothing ("" hides it), in the unit chosen in Settings. */
  showError(message: string): void;
  /** OK off while the kernel checks the chamfer, so a second press can't record twice. */
  busy(on: boolean): void;
  readonly ready: boolean;
  hide(): void;
  readonly shown: boolean;
}

/** Flip's tooltip. */
export const FLIP_TITLE = "Flip: measure the first size along the other face";

export function chamferPanel(slot: HTMLElement, on: ChamferEvents): ChamferPanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "chamfer-panel", "chamfer-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Chamfer");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "chamfer-title", "", "Chamfer");
  const edges = el("p", "chamfer-edges", "chamfer-panel-edges");
  const kind = el("select", "chamfer-kind", "dark-select"); // styles/dark-select.css (packages/ui)
  kind.setAttribute("aria-label", "Type");
  for (const k of CHAMFER_KINDS) {
    const o = el("option", "", "", KIND_WORDS[k]);
    o.value = k;
    kind.append(o);
  }
  const kindRow = el("label", "", "chamfer-panel-row");
  kindRow.append(el("span", "", "chamfer-panel-legend", "Type"), kind);
  const textBox = (id: string) => {
    const input = el("input", id);
    Object.assign(input, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false });
    return input;
  };
  const firstInput = textBox("chamfer-distance");
  const first = sizeBox(firstInput, () => currentUnit(document));
  const firstLabel = el("span", "chamfer-distance-label", "chamfer-panel-legend", "Distance");
  const firstRow = el("label", "", "chamfer-panel-row");
  firstRow.append(firstLabel, firstInput);
  const secondInput = textBox("chamfer-second");
  const second = sizeBox(secondInput, () => currentUnit(document));
  const secondRow = el("label", "chamfer-second-row", "chamfer-panel-row");
  secondRow.append(el("span", "", "chamfer-panel-legend", "Distance 2"), secondInput);
  const angle = textBox("chamfer-angle");
  const angleRow = el("label", "chamfer-angle-row", "chamfer-panel-row");
  angleRow.append(el("span", "", "chamfer-panel-legend", "Angle (°)"), angle);
  const flip = el("input", "chamfer-flip");
  flip.type = "checkbox";
  const flipRow = el("label", "chamfer-flip-row", "chamfer-panel-flip");
  flipRow.title = FLIP_TITLE;
  flipRow.append(flip, document.createTextNode(" Flip"));
  const note = el("p", "chamfer-edit-note", "chamfer-panel-note", EDIT_EDGES_NOTE);
  note.hidden = true;
  const previewWhy = el("p", "chamfer-preview-why", "chamfer-panel-note");
  previewWhy.hidden = true;
  const error = el("p", "chamfer-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const ok = el("button", "chamfer-ok", "", "OK");
  ok.type = "button";
  ok.title = "Make the chamfer (Enter)";
  ok.addEventListener("click", () => on.ok());
  const cancel = el("button", "chamfer-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  const buttons = el("div", "", "chamfer-panel-buttons");
  buttons.append(ok, cancel);
  box.append(title, edges, note, kindRow, firstRow, secondRow, angleRow, flipRow, previewWhy, error, buttons);

  let open = false;
  let editing: string | null = null;
  let count = 0;
  const showKind = () => {
    const k = kind.value as ChamferKind;
    secondRow.hidden = k !== "two";
    angleRow.hidden = k !== "angle";
    flipRow.hidden = k === "equal";
    firstLabel.textContent = k === "two" ? "Distance 1" : "Distance";
  };
  const okState = () => (ok.disabled = ok.dataset.busy === "1" || count === 0);
  const changed = () => on.changed();
  kind.addEventListener("change", () => (showKind(), changed()));
  for (const input of [firstInput, secondInput, angle]) input.addEventListener("input", changed);
  flip.addEventListener("change", changed);
  box.addEventListener("keydown", (e) => {
    const target = e.target as Element | null;
    // A button's own Enter clicks it; anywhere else in the panel (a box, the type, Flip) Enter is OK.
    if (e.key === "Enter" && target?.tagName !== "BUTTON") {
      e.preventDefault();
      if (!ok.disabled) on.ok();
    }
    if (e.key === "Escape") on.cancel();
  });
  return {
    show(n, edit) {
      open = true;
      editing = edit?.id ?? null;
      const size = edit?.size;
      kind.value = size === undefined || "equal" in size ? "equal" : "two" in size ? "two" : "angle";
      first.value = String(size === undefined ? DEFAULT_CHAMFER : "equal" in size ? size.equal : "two" in size ? size.two[0] : size.angle[0]);
      second.value = String(size !== undefined && "two" in size ? size.two[1] : DEFAULT_CHAMFER);
      angle.value = String(size !== undefined && "angle" in size ? size.angle[1] : DEFAULT_ANGLE);
      flip.checked = edit?.flip === true && kind.value !== "equal";
      title.textContent = edit === undefined ? "Chamfer" : `Edit ${edit.name}`;
      note.hidden = edit === undefined;
      box.dataset.editing = editing ?? "";
      this.showPreview(null);
      error.hidden = true;
      delete ok.dataset.busy;
      showKind();
      this.setEdges(n);
      box.dataset.shows = String(Number(box.dataset.shows ?? 0) + 1); // the phone's sheet opens again for a Chamfer started over an open one
      box.hidden = false;
      // With a mouse the cursor waits in the Distance box, its number selected (Extrude's feel); never on a touch screen.
      if (typesStraightAway(document)) {
        firstInput.focus({ preventScroll: true });
        firstInput.select();
      }
    },
    setEdges(n) {
      count = n;
      const touch = document.defaultView?.matchMedia?.("(pointer: coarse)").matches === true;
      edges.textContent = edgesWords(n, touch);
      edges.classList.toggle("chamfer-panel-empty", n === 0);
      okState();
    },
    get typed() {
      const k = kind.value as ChamferKind;
      return { kind: k, first: first.value, second: k === "angle" ? angle.value : second.value, flip: k !== "equal" && flip.checked };
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
    showPreview(volume, why = "") {
      box.dataset.previewVolume = volume === null ? "" : volume.toFixed(3);
      previewWhy.textContent = why;
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
