// The Extrude panel (step 21d; UX1b Fusion's feel), at the top of the
// properties: the profile, picked by clicking a closed sketch in the view
// (its name, or how to pick one, and ✕ to clear it, like Fusion's "1
// selected ×"); the distance, typeable and kept in step with the arrow
// dragged in the view, negative going the other way from the sketch's
// plane; Flip, which turns the distance's sign (26c: the start still on
// the plane); whether the profile makes a closed outline or the kernel's
// reason it doesn't; and OK or Cancel. OK stays off until the kernel says
// the outline is closed. The workspace drives it; the panel only shows what
// it is given and reports what was typed and clicked.
// With Combine shown (`?combine`, combine-flag.ts), an Operation row as
// Fusion's: New body (the default), Join, Cut or Intersect, and for the
// last three the bodies the extrude reaches, each to tick or untick
// (extrude-operation.ts); OK stays off until one is ticked.
// Styles: src/styles/extrude.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { followUnit, sizeBox, type SizeBox } from "./properties.ts";
import { EXTRUDE_OPERATION_WORDS, EXTRUDE_OPERATIONS, type BodyChoice, type ExtrudeOperation } from "./extrude-operation.ts";

export interface ExtrudePanelEvents {
  /** The distance box changed as typed (every keystroke), so the preview and arrow follow it. */
  distance(typed: string): void;
  /** Flip: the distance's sign turned (the box already shows it). */
  flip(typed: string): void;
  /** ✕: no profile chosen. */
  clear(): void;
  /** OK (or Enter in the distance box), with the distance as typed. */
  ok(typed: string): void;
  cancel(): void;
  /** The Operation row changed (only shown with Combine). */
  operation?(operation: ExtrudeOperation): void;
  /** A body in the list ticked or unticked. */
  tick?(body: string, on: boolean): void;
  /** Pick several turned on or off (a phone's Ctrl: each tap adds or takes away a profile). */
  several?(on: boolean): void;
}

export interface ExtrudePanel {
  /** Opens the panel with the profile chosen (its name; null for none yet) and the distance as typed; `operations` adds the Operation row (New body chosen). */
  show(chosen: string | null, distance: string, operations?: boolean): void;
  /** The bodies Join, Cut or Intersect would work on, and the words under them; `ready` says whether OK can work on them. */
  showBodies(list: readonly BodyChoice[], note: string, ready: boolean): void;
  /** The operation chosen now: "new" unless the Operation row says otherwise. */
  readonly operation: ExtrudeOperation;
  /** The profile chosen now (its name; null for none), as a click in the view or ✕ left it. */
  showProfile(chosen: string | null): void;
  /** The distance box set to `typed` (an arrow drag); the caret and focus are left alone. */
  showDistance(typed: string): void;
  /** The distance box glows softly while the view's arrow is dragged (Ben, 2026-10-28), so it is clear which value changes. */
  dragging(on: boolean): void;
  /** Whether the chosen profile can be extruded, in words; OK follows it. */
  showStatus(text: string, closed: boolean): void;
  /** Why OK did nothing, or why the preview can't be built (a distance the kernel refused); empty hides it. */
  showError(message: string): void;
  hide(): void;
  readonly shown: boolean;
  /** Whether OK can be pressed now (Enter outside the box presses it too). */
  readonly ready: boolean;
  /** The distance as typed now. */
  readonly typed: string;
}

/** What the panel says an extrude makes with New body chosen (or no Operation row). */
export const NEW_BODY_NOTE = "The extrude is a new body, put in the timeline at the marker.";

/** Pick several's tooltip: what it does, and the keys that do the same with a mouse. */
export const SEVERAL_TITLE = "Pick several profiles: each click or tap adds a profile, or takes one away. With a mouse, hold Ctrl (⌘ on a Mac) or Shift while clicking to do the same.";

/** What the profile row says while none is chosen. */
export const PICK_PROFILE = "Click a closed sketch or a flat face in the view";

export function extrudePanel(slot: HTMLElement, on: ExtrudePanelEvents): ExtrudePanel {
  const document = slot.ownerDocument;
  const box = document.createElement("section");
  box.className = "extrude";
  box.id = "extrude-panel"; // the ids are read by the e2e test
  box.setAttribute("aria-label", "Extrude");
  box.hidden = true;
  slot.prepend(box);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  /** The distance is millimetres everywhere outside the box (`field.value`); the box shows the unit chosen in Settings (U2c3). */
  let parts: { status: HTMLElement; error: HTMLElement; ok: HTMLButtonElement; input: HTMLInputElement; field: SizeBox; profile: HTMLElement; clear: HTMLButtonElement; onUnit: () => boolean; note: HTMLElement; select: HTMLSelectElement | null; bodies: HTMLElement } | null = null;
  // OK needs both: the kernel's closed outline, and (Join, Cut, Intersect) a body ticked.
  let closed = false;
  let bodiesReady = true;
  const operationOf = () => (parts?.select?.value as ExtrudeOperation | undefined) ?? "new";
  const okNow = () => {
    if (parts) parts.ok.disabled = !(closed && (operationOf() === "new" || bodiesReady));
  };
  return {
    show(chosen, distance, operations = false) {
      const profile = el("span", "extrude-profile", "extrude-profile");
      const clear = el("button", "extrude-clear", "extrude-clear", "✕");
      clear.type = "button";
      clear.title = "Clear the profile: click another closed sketch in the view";
      clear.setAttribute("aria-label", "Clear the profile");
      clear.addEventListener("click", () => on.clear());
      // Pick several (version 18): Ctrl, Cmd or Shift with a click does the same; a phone has only this.
      const several = el("button", "extrude-several", "extrude-several", "Pick several");
      several.type = "button";
      several.title = SEVERAL_TITLE;
      several.setAttribute("aria-pressed", "false");
      several.addEventListener("click", () => {
        const pressed = several.getAttribute("aria-pressed") !== "true";
        several.setAttribute("aria-pressed", String(pressed));
        on.several?.(pressed);
      });
      const profileRow = el("div", "", "extrude-row extrude-profile-row extrude-several-row");
      profileRow.append(el("span", "", "extrude-label", "Profile"), profile, clear, several);
      const input = el("input", "extrude-distance");
      Object.assign(input, { type: "number", step: "any" });
      const field = sizeBox(input, () => currentUnit(document));
      field.value = distance;
      input.setAttribute("aria-label", `Distance in ${currentUnit(document)}`);
      field.addEventListener("input", () => on.distance(field.value));
      // Enter in the box is OK, as in any dialog.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !ok.disabled) on.ok(field.value);
      });
      const flip = el("button", "extrude-flip", "extrude-flip", "Flip");
      flip.type = "button";
      flip.title = "Extrude the other way from the sketch's plane (the distance turns negative); the body still starts on it";
      flip.addEventListener("click", () => {
        const n = Number(field.value);
        if (field.value.trim() === "" || !Number.isFinite(n) || n === 0) return;
        field.value = String(-n);
        on.flip(field.value);
      });
      const distanceRow = el("label", "", "extrude-row");
      const unitName = el("span", "", "unit-name", currentUnit(document));
      distanceRow.append(el("span", "", "extrude-label", "Distance"), input, " ", unitName, " ", flip);
      const status = el("p", "extrude-status", "extrude-status");
      const error = el("p", "extrude-error", "bad");
      error.hidden = true;
      const ok = el("button", "extrude-ok", "", "OK");
      ok.type = "button";
      ok.title = "Make the solid (Enter)";
      ok.disabled = true; // until the kernel says the outline is closed
      ok.addEventListener("click", () => on.ok(field.value));
      const cancel = el("button", "extrude-cancel", "", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => on.cancel());
      const buttons = el("div", "", "extrude-buttons");
      buttons.append(ok, cancel);
      const note = el("p", "extrude-what", "extrude-note", NEW_BODY_NOTE);
      // The Operation row (Fusion's), only while Combine is shown: hidden, an extrude is always a new body, as before.
      let select: HTMLSelectElement | null = null;
      const rows: HTMLElement[] = [];
      const bodies = el("fieldset", "extrude-bodies", "extrude-bodies");
      bodies.hidden = true;
      if (operations) {
        select = el("select", "extrude-operation", "extrude-operation");
        select.setAttribute("aria-label", "Operation");
        for (const op of EXTRUDE_OPERATIONS) {
          const option = el("option", "", "", EXTRUDE_OPERATION_WORDS[op]);
          option.value = op;
          select.append(option);
        }
        select.value = "new";
        select.addEventListener("change", () => {
          const op = select!.value as ExtrudeOperation;
          bodies.hidden = op === "new";
          if (op === "new") note.textContent = NEW_BODY_NOTE;
          okNow();
          on.operation?.(op);
        });
        const operationRow = el("label", "", "extrude-row");
        operationRow.append(el("span", "", "extrude-label", "Operation"), select);
        rows.push(operationRow, bodies);
      }
      box.replaceChildren(
        el("h2", "", "", "Extrude"),
        profileRow,
        distanceRow,
        el("p", "", "extrude-note", "Drag the arrow in the view or type the distance; a negative one goes the other way."),
        ...rows,
        status,
        error,
        note,
        buttons,
      );
      closed = false;
      bodiesReady = true;
      /** Shows the unit now chosen; false once this panel was closed or opened again, and it is no longer wanted. */
      const onUnit = (): boolean => {
        if (parts?.input !== input) return false;
        field.reshow();
        unitName.textContent = currentUnit(document);
        input.setAttribute("aria-label", `Distance in ${currentUnit(document)}`);
        return true;
      };
      parts = { status, error, ok, input, field, profile, clear, onUnit, note, select, bodies }; // `onUnit` is held here: the page's listener holds it only weakly
      followUnit(document, onUnit);
      this.showProfile(chosen);
      box.hidden = false;
    },
    showProfile(chosen) {
      if (!parts) return;
      parts.profile.textContent = chosen ?? PICK_PROFILE;
      parts.profile.classList.toggle("extrude-unpicked", chosen === null);
      parts.clear.hidden = chosen === null;
    },
    dragging(on) {
      parts?.input.classList.toggle("extrude-dragged", on);
    },
    showDistance(typed) {
      if (parts) parts.field.value = typed;
    },
    showStatus(text, isClosed) {
      if (!parts) return;
      parts.status.textContent = text;
      closed = isClosed;
      okNow();
    },
    showBodies(list, words, ready) {
      if (!parts) return;
      const document = box.ownerDocument;
      const legend = el("legend", "", "extrude-label", "Bodies");
      const items = list.map((b) => {
        const row = el("label", "", "extrude-body");
        const tick = document.createElement("input");
        tick.type = "checkbox";
        tick.checked = b.ticked;
        tick.dataset.body = b.body; // read by the e2e test
        tick.addEventListener("change", () => on.tick?.(b.body, tick.checked));
        row.append(tick, " ", b.label);
        return row;
      });
      parts.bodies.replaceChildren(legend, ...items);
      if (operationOf() !== "new") parts.note.textContent = words;
      bodiesReady = ready;
      okNow();
    },
    get operation() {
      return operationOf();
    },
    showError(message) {
      if (!parts) return;
      parts.error.textContent = wordsInUnit(message, currentUnit(document));
      parts.error.hidden = message === "";
    },
    hide() {
      // Emptied while still drawn, then hidden: a button under the pointer taken out of a panel already hidden leaves Chromium
      // holding the panel as hovered, and then in memory once a new design replaces it (e2e/closed-panels.mjs).
      box.replaceChildren();
      box.hidden = true;
      parts = null;
    },
    get shown() {
      return !box.hidden;
    },
    get ready() {
      return parts !== null && !parts.ok.disabled;
    },
    get typed() {
      return parts?.field.value ?? "";
    },
  };
}
