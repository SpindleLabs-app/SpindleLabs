// The Construct panel (step 59a2, construct-tool.ts), at the top of the
// properties as Chamfer's is: the Type (the 14 kinds grouped Plane, Axis,
// Point), one row for each thing the kind is made from (what is picked, a
// list to choose an origin plane, axis or point or an earlier construction
// instead, and × to let it go), the distance or angle where the kind needs
// one, the preview's line or the refusal, OK and Cancel. A row is pressed to
// be the one the next click in the view fills. With a mouse the number
// takes the typing as the panel opens, as Extrude's does; never on a touch
// screen. Enter anywhere in the panel but on a button is OK; Escape is
// Cancel. The controller (construct-view.ts) drives it. Styles:
// src/styles/construct-panel.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { CONSTRUCT_KINDS, kindNumber, type ConstructKind } from "./construct-data.ts";
import { KIND_WORDS } from "./construct.ts";
import { DEFAULT_ANGLE, DEFAULT_DISTANCE, KIND_GROUPS, type Choice } from "./construct-tool.ts";
import { typesStraightAway } from "./extrude-panel.ts";
import { sizeBox } from "./properties.ts";

/** One row: a slot, its name, what fills it (null: nothing yet), its list and whether the next pick goes to it. */
export interface SlotRow {
  slot: string;
  legend: string;
  words: string | null;
  choices: readonly Choice[];
  /** The list's chosen name (an origin or earlier construction), or "". */
  chosen: string;
  active: boolean;
}

export interface ConstructEvents {
  /** The Type changed. */
  kind(k: ConstructKind): void;
  /** A row pressed: the next pick goes there. */
  activate(slot: string): void;
  /** A name chosen from a row's list, or "" for none (a row's ×). */
  choose(slot: string, ref: string): void;
  /** The number typed: the error goes and the preview is asked again. */
  changed(): void;
  ok(): void;
  cancel(): void;
}

export interface ConstructPanel {
  /** Opens with `kind` chosen, its number at the default; the rows come from `setRows`. */
  show(kind: ConstructKind): void;
  readonly kind: ConstructKind;
  setRows(rows: readonly SlotRow[]): void;
  /** What is typed for the number (millimetres or degrees as text; "" for a kind with none). */
  readonly typed: string;
  /** The preview's line ("" hides it), or why the kernel refused the picks now (`refused`: red). */
  showPreview(words: string, refused?: boolean): void;
  /** Why OK recorded nothing ("" hides it), in the unit chosen in Settings. */
  showError(message: string): void;
  /** OK off while the kernel checks, so a second press can't record twice; `ready`: OK is enabled only when every row is filled. */
  busy(on: boolean): void;
  setReady(on: boolean): void;
  readonly ready: boolean;
  hide(): void;
  readonly shown: boolean;
}

export function constructPanel(slot: HTMLElement, on: ConstructEvents): ConstructPanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "construct-panel", "construct-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Construct");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "construct-title", "", "Construct");
  const kind = el("select", "construct-kind", "dark-select"); // styles/dark-select.css (packages/ui)
  kind.setAttribute("aria-label", "Type");
  for (const g of KIND_GROUPS) {
    const group = el("optgroup");
    group.label = g.heading;
    for (const k of g.kinds) {
      const o = el("option", "", "", KIND_WORDS[k]);
      o.value = k;
      group.append(o);
    }
    kind.append(group);
  }
  const kindRow = el("label", "", "construct-panel-row");
  kindRow.append(el("span", "", "construct-panel-legend", "Type"), kind);
  const rows = el("div", "construct-rows", "construct-panel-rows");
  const numberInput = el("input", "construct-number");
  Object.assign(numberInput, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false });
  const distance = sizeBox(numberInput, () => currentUnit(document));
  const numberRow = el("label", "construct-number-row", "construct-panel-row");
  numberRow.append(el("span", "", "construct-panel-legend", "Distance"), numberInput);
  const angleInput = el("input", "construct-angle");
  Object.assign(angleInput, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false });
  const angleRow = el("label", "construct-angle-row", "construct-panel-row");
  angleRow.append(el("span", "", "construct-panel-legend", "Angle (°)"), angleInput);
  const preview = el("p", "construct-preview", "construct-panel-note");
  preview.hidden = true;
  const error = el("p", "construct-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const ok = el("button", "construct-ok", "", "OK");
  ok.type = "button";
  ok.title = "Make the construction (Enter)";
  ok.addEventListener("click", () => on.ok());
  const cancel = el("button", "construct-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  const buttons = el("div", "", "construct-panel-buttons");
  buttons.append(ok, cancel);
  box.append(title, kindRow, rows, numberRow, angleRow, preview, error, buttons);

  let open = false;
  let ready = false;
  const okState = () => (ok.disabled = ok.dataset.busy === "1" || !ready);
  const showNumber = () => {
    const k = kind.value as ConstructKind;
    const need = kindNumber(k);
    numberRow.hidden = need !== "distance";
    angleRow.hidden = need !== "angle";
    title.textContent = KIND_WORDS[k];
    box.dataset.kind = k;
  };
  // A new kind starts its own number: a distance 10 mm (the box shows Settings' unit), an angle 45°.
  const startNumber = (k: ConstructKind) => {
    const need = kindNumber(k);
    if (need === "distance") distance.value = String(DEFAULT_DISTANCE);
    else if (need === "angle") angleInput.value = String(DEFAULT_ANGLE);
  };
  kind.addEventListener("change", () => {
    const k = kind.value as ConstructKind;
    startNumber(k);
    showNumber();
    on.kind(k);
  });
  for (const input of [numberInput, angleInput]) input.addEventListener("input", () => on.changed());
  box.addEventListener("keydown", (e) => {
    const target = e.target as Element | null;
    // A button's own Enter clicks it, and a list's Enter opens it; anywhere else (the number) Enter is OK.
    if (e.key === "Enter" && target?.tagName !== "BUTTON" && target?.tagName !== "SELECT") {
      e.preventDefault();
      if (!ok.disabled) on.ok();
    }
    if (e.key === "Escape") on.cancel();
  });
  return {
    show(k) {
      open = true;
      kind.value = k;
      startNumber(k);
      showNumber();
      this.showPreview("");
      error.hidden = true;
      delete ok.dataset.busy;
      ready = false;
      okState();
      box.dataset.shows = String(Number(box.dataset.shows ?? 0) + 1); // the phone's sheet opens again for a Construct started over an open one
      box.hidden = false;
      const typed = kindNumber(k) === "distance" ? numberInput : kindNumber(k) === "angle" ? angleInput : null;
      if (typed !== null && typesStraightAway(document)) {
        typed.focus({ preventScroll: true });
        typed.select();
      }
    },
    get kind() {
      return kind.value as ConstructKind;
    },
    setRows(list) {
      rows.replaceChildren();
      for (const r of list) {
        const row = el("div", `construct-slot-${r.slot}`, "construct-panel-slot");
        row.dataset.slot = r.slot;
        row.classList.toggle("construct-panel-active", r.active);
        if (r.active) row.setAttribute("aria-current", "true");
        const pick = el("button", `construct-pick-${r.slot}`, "construct-panel-pick");
        pick.type = "button";
        pick.title = `Pick the ${r.legend.toLowerCase()} in the view`;
        pick.append(el("span", "", "construct-panel-legend", r.legend), el("span", `construct-value-${r.slot}`, r.words === null ? "construct-panel-value construct-panel-empty" : "construct-panel-value", r.words ?? "Pick in the view"));
        pick.addEventListener("click", () => on.activate(r.slot));
        const list = el("select", `construct-choose-${r.slot}`, "dark-select");
        list.setAttribute("aria-label", `${r.legend}: or choose`);
        const none = el("option", "", "", r.choices.length === 0 ? "Pick in the view" : "Or choose…");
        none.value = "";
        list.append(none);
        for (const c of r.choices) {
          const o = el("option", "", "", c.label);
          o.value = c.ref;
          list.append(o);
        }
        list.value = r.chosen;
        list.hidden = r.choices.length === 0;
        list.addEventListener("change", () => on.choose(r.slot, list.value));
        const drop = el("button", `construct-drop-${r.slot}`, "construct-panel-drop", "×");
        drop.type = "button";
        drop.title = `Let the ${r.legend.toLowerCase()} go`;
        drop.setAttribute("aria-label", drop.title);
        drop.hidden = r.words === null;
        drop.addEventListener("click", () => on.choose(r.slot, ""));
        row.append(pick, list, drop);
        rows.append(row);
      }
    },
    get typed() {
      const need = kindNumber(kind.value as ConstructKind);
      return need === "distance" ? distance.value : need === "angle" ? angleInput.value : "";
    },
    showPreview(words, refused = false) {
      preview.textContent = refused ? wordsInUnit(words, currentUnit(document)) : words;
      preview.classList.toggle("bad", refused);
      preview.hidden = words === "";
      box.dataset.previewRefused = String(refused);
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
    setReady(r) {
      ready = r;
      okState();
      // A kind with no number to type has nothing else to take the keys: with a mouse OK takes them, so Enter makes it.
      if (r && open && numberRow.hidden && angleRow.hidden && typesStraightAway(document)) ok.focus({ preventScroll: true });
    },
    get ready() {
      return !ok.disabled;
    },
    hide() {
      open = false;
      this.showPreview("");
      box.hidden = true;
      error.hidden = true;
      if (box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    },
    get shown() {
      return open;
    },
  };
}

/** Which kinds the panel's Type lists, for a test. */
export const PANEL_KINDS = Object.keys(CONSTRUCT_KINDS) as ConstructKind[];
