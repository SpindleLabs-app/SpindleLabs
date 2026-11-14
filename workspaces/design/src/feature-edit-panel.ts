// The Edit feature panel (step 25a2, feature-edit.ts), at the top of the
// properties: the item's name, a box for each size its shape uses with the
// value it has now, an extrude's Flip (26c), what it says of an extrude's
// region (48d4: picked in the view), the kernel's refusal, and OK
// or Cancel. Enter in a box
// is OK; Escape is Cancel (workspace.ts `shortcut`). The workspace drives
// it; the panel only shows what it is given and reports what was typed and
// clicked. With Combine shown (`?combine`), an extrude of a sketch also has
// Extrude's Operation row and its bodies (extrude-operation.ts), so its
// operation can be changed, as Fusion's Extrude edited.
// Styles: src/styles/feature-edit.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import type { EditableFeature } from "./feature-edit.ts";
import { EXTRUDE_OPERATION_WORDS, EXTRUDE_OPERATIONS, type BodyChoice, type ExtrudeOperation } from "./extrude-operation.ts";
import { followUnit, parameterRows, sizeBox, type SizeBox, type SizeKey } from "./properties.ts";

export interface FeatureEditEvents {
  /** OK (or Enter), with each shown box as typed and, for an extrude, whether Flip is ticked. */
  ok(typed: Partial<Record<SizeKey, string>>, flip?: boolean, symmetric?: boolean): void;
  cancel(): void;
  /** The Operation row changed (an extrude of a sketch, with Combine shown). */
  operation?(operation: ExtrudeOperation): void;
  /** A body in its list ticked or unticked. */
  tick?(body: string, on: boolean): void;
  /** A size typed or Flip changed (each shown box as typed, and Flip), so the bodies an extrude reaches can be found again. */
  sizes?(typed: Partial<Record<SizeKey, string>>, flip?: boolean, symmetric?: boolean): void;
}

export interface FeatureEditPanel {
  /** Opens the panel on this item, its boxes filled with its sizes now, the first box focused. */
  show(f: EditableFeature): void;
  /** Why OK recorded nothing ("" hides it). */
  showError(message: string): void;
  /** An extrude of a sketch (48d4): what the panel says about its region, shaded in the view to pick another (null: no line). */
  showRegion(words: string | null): void;
  /** An extrude of a sketch with Combine shown: its Operation row, set to `operation` (the bodies list shown for Join, Cut, Intersect). */
  showOperation(operation: ExtrudeOperation): void;
  /** The bodies the extrude's operation can work on, and the words under them; `ready` says whether OK can use them. */
  showBodies(list: readonly BodyChoice[], note: string, ready: boolean): void;
  /** The operation chosen now; null without an Operation row. */
  readonly operation: ExtrudeOperation | null;
  /** OK off while the kernel checks the sizes, so a second press can't record twice. */
  busy(on: boolean): void;
  hide(): void;
  /** The item open in the panel, or null when it is closed. */
  readonly editing: string | null;
}

export function featureEditPanel(slot: HTMLElement, on: FeatureEditEvents): FeatureEditPanel {
  const document = slot.ownerDocument;
  const box = document.createElement("section");
  box.className = "feature-edit";
  box.id = "feature-edit"; // the ids are read by the e2e test
  box.setAttribute("aria-label", "Edit feature");
  box.hidden = true;
  slot.prepend(box);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  let editing: string | null = null;
  let error: HTMLElement | null = null;
  let ok: HTMLButtonElement | null = null;
  let inputs: [SizeKey, SizeBox][] = [];
  let flip: HTMLInputElement | null = null;
  /** An extrude of a sketch's Symmetric (53a1): half its distance each way; Flip is off while it is ticked. */
  let both: HTMLInputElement | null = null;
  let region: HTMLElement | null = null;
  let select: HTMLSelectElement | null = null;
  let bodies: HTMLElement | null = null;
  let note: HTMLElement | null = null;
  let operationSlot: HTMLElement | null = null;
  let checking = false;
  let bodiesReady = true;
  const okNow = () => {
    if (ok) ok.disabled = checking || (select !== null && select.value !== "new" && !bodiesReady);
  };
  /** The unit follower of the open item, kept here because the page's listener holds it only weakly. */
  let watching: (() => boolean) | null = null;
  const typed = () => Object.fromEntries(inputs.map(([k, i]) => [k, i.value])) as Partial<Record<SizeKey, string>>;
  return {
    show(f) {
      editing = f.id;
      const rows = parameterRows(f.shape).filter((r) => r.shown);
      inputs = [];
      const labels = rows.map((r) => {
        const input = el("input", `edit-${r.key}`);
        Object.assign(input, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false }); // sizeBox reads units and commas (issue #518)
        const field = sizeBox(input, () => currentUnit(document)); // the sizes are millimetres outside the box (U2c3)
        field.value = String(f.sizes[r.key] ?? "");
        // Enter in a box is OK, as in any dialog.
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && ok && !ok.disabled) on.ok(typed(), flip?.checked, both?.checked);
        });
        field.addEventListener("input", () => on.sizes?.(typed(), flip?.checked, both?.checked));
        inputs.push([r.key, field]);
        const label = el("label", "", "feature-edit-row");
        // A sketch extrude's one size is its distance; the main panel calls the same box "Extrude by".
        label.append(`${f.shape === "sketch-extrude" ? "Distance" : r.label} `, input, " ", el("span", "", "unit-name", currentUnit(document)));
        return label;
      });
      flip = null;
      if (f.flip !== undefined) {
        flip = el("input", "edit-flip");
        flip.type = "checkbox";
        flip.checked = f.flip;
        flip.addEventListener("change", () => on.sizes?.(typed(), flip?.checked, both?.checked));
        const row = el("label", "", "feature-edit-row feature-edit-flip");
        row.title = "Extrude the other way from the sketch's plane; the body still starts on it";
        row.append(flip, " Flip");
        labels.push(row);
      }
      both = null;
      if (f.symmetric !== undefined) {
        const ticked = el("input", "edit-symmetric");
        both = ticked;
        ticked.type = "checkbox";
        ticked.checked = f.symmetric;
        const flipBox = flip;
        const flipOff = () => {
          if (flipBox) flipBox.disabled = ticked.checked;
        };
        flipOff();
        ticked.addEventListener("change", () => {
          flipOff();
          on.sizes?.(typed(), flip?.checked, ticked.checked);
        });
        const row = el("label", "", "feature-edit-row feature-edit-symmetric");
        row.title = "Extrude half the distance each way from the sketch's plane: the distance is the whole thickness";
        row.append(ticked, " Symmetric");
        labels.push(row);
      }
      region = el("p", "edit-region", "feature-edit-region");
      region.hidden = true;
      select = null;
      bodies = el("fieldset", "edit-bodies", "feature-edit-bodies");
      bodies.hidden = true;
      note = el("p", "edit-operation-note", "feature-edit-note");
      note.hidden = true;
      checking = false;
      bodiesReady = true;
      error = el("p", "feature-edit-error", "bad");
      error.hidden = true;
      error.setAttribute("role", "alert");
      ok = el("button", "feature-edit-ok", "", "OK");
      ok.type = "button";
      ok.addEventListener("click", () => on.ok(typed(), flip?.checked, both?.checked));
      const cancel = el("button", "feature-edit-cancel", "", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => on.cancel());
      const buttons = el("div", "", "feature-edit-buttons");
      buttons.append(ok, cancel);
      const title = el("h2", "feature-edit-title", "", `Edit ${f.name}`);
      const after = el("p", "", "feature-edit-note", "Everything after it in the timeline is built again.");
      // The Operation row's place (`showOperation` fills it): after the sizes and Flip, before the region's words.
      operationSlot = el("div", "", "feature-edit-operation");
      box.replaceChildren(title, ...labels, operationSlot, bodies, note, region, error, after, buttons);
      box.hidden = false;
      inputs[0]?.[1].el.focus();
      inputs[0]?.[1].el.select();
      const names = box.querySelectorAll(".unit-name");
      const mine = inputs;
      const onUnit = (): boolean => {
        if (inputs !== mine || watching !== onUnit) return false;
        for (const [, b] of mine) b.reshow();
        for (const n of names) n.textContent = currentUnit(document);
        return true;
      };
      watching = onUnit;
      followUnit(document, onUnit);
    },
    showError(message) {
      if (!error) return;
      error.textContent = wordsInUnit(message, currentUnit(document));
      error.hidden = message === "";
    },
    showRegion(words) {
      if (!region) return;
      region.textContent = words ?? "";
      region.hidden = words === null;
    },
    showOperation(operation) {
      if (!operationSlot || !bodies || !note) return;
      const list = bodies;
      const words = note;
      const s = el("select", "edit-operation", "feature-edit-operation-select");
      s.setAttribute("aria-label", "Operation");
      for (const op of EXTRUDE_OPERATIONS) {
        const option = el("option", "", "", EXTRUDE_OPERATION_WORDS[op]);
        option.value = op;
        s.append(option);
      }
      s.value = operation;
      s.addEventListener("change", () => {
        list.hidden = words.hidden = s.value === "new";
        okNow();
        on.operation?.(s.value as ExtrudeOperation);
      });
      select = s;
      list.hidden = words.hidden = operation === "new";
      const row = el("label", "", "feature-edit-row");
      row.append("Operation ", s);
      operationSlot.replaceChildren(row);
      okNow();
    },
    showBodies(choices, words, ready) {
      if (!bodies || !note) return;
      const items = choices.map((b) => {
        const row = el("label", "", "feature-edit-body");
        const tick = document.createElement("input");
        tick.type = "checkbox";
        tick.checked = b.ticked;
        tick.dataset.body = b.body; // read by the e2e test
        tick.addEventListener("change", () => on.tick?.(b.body, tick.checked));
        row.append(tick, " ", b.label);
        return row;
      });
      bodies.replaceChildren(el("legend", "", "", "Bodies"), ...items);
      note.textContent = words;
      bodiesReady = ready;
      okNow();
    },
    get operation() {
      return (select?.value as ExtrudeOperation | undefined) ?? null;
    },
    busy(on) {
      checking = on;
      okNow();
    },
    hide() {
      editing = null;
      // Emptied while still drawn, then hidden: a button under the pointer taken out of a panel already hidden leaves Chromium
      // holding the panel as hovered, and then in memory once a new design replaces it (e2e/closed-panels.mjs).
      box.replaceChildren();
      box.hidden = true;
      error = ok = flip = both = region = null;
      select = null;
      bodies = note = operationSlot = null;
      inputs = [];
      watching = null;
    },
    get editing() {
      return editing;
    },
  };
}
