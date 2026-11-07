// The Edit feature panel (step 25a2, feature-edit.ts), at the top of the
// properties: the item's name, a box for each size its shape uses with the
// value it has now, an extrude's Flip (26c), what it says of an extrude's
// region (48d4: picked in the view), the kernel's refusal, and OK
// or Cancel. Enter in a box
// is OK; Escape is Cancel (workspace.ts `shortcut`). The workspace drives
// it; the panel only shows what it is given and reports what was typed and
// clicked. Styles: src/styles/feature-edit.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import type { EditableFeature } from "./feature-edit.ts";
import { followUnit, parameterRows, sizeBox, type SizeBox, type SizeKey } from "./properties.ts";

export interface FeatureEditEvents {
  /** OK (or Enter), with each shown box as typed and, for an extrude, whether Flip is ticked. */
  ok(typed: Partial<Record<SizeKey, string>>, flip?: boolean): void;
  cancel(): void;
}

export interface FeatureEditPanel {
  /** Opens the panel on this item, its boxes filled with its sizes now, the first box focused. */
  show(f: EditableFeature): void;
  /** Why OK recorded nothing ("" hides it). */
  showError(message: string): void;
  /** An extrude of a sketch (48d4): what the panel says about its region, shaded in the view to pick another (null: no line). */
  showRegion(words: string | null): void;
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
  let region: HTMLElement | null = null;
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
        Object.assign(input, { type: "number", step: "any" });
        const field = sizeBox(input, () => currentUnit(document)); // the sizes are millimetres outside the box (U2c3)
        field.value = String(f.sizes[r.key] ?? "");
        // Enter in a box is OK, as in any dialog.
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && ok && !ok.disabled) on.ok(typed(), flip?.checked);
        });
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
        const row = el("label", "", "feature-edit-row feature-edit-flip");
        row.title = "Extrude the other way from the sketch's plane; the body still starts on it";
        row.append(flip, " Flip");
        labels.push(row);
      }
      region = el("p", "edit-region", "feature-edit-region");
      region.hidden = true;
      error = el("p", "feature-edit-error", "bad");
      error.hidden = true;
      error.setAttribute("role", "alert");
      ok = el("button", "feature-edit-ok", "", "OK");
      ok.type = "button";
      ok.addEventListener("click", () => on.ok(typed(), flip?.checked));
      const cancel = el("button", "feature-edit-cancel", "", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => on.cancel());
      const buttons = el("div", "", "feature-edit-buttons");
      buttons.append(ok, cancel);
      const title = el("h2", "feature-edit-title", "", `Edit ${f.name}`);
      const note = el("p", "", "feature-edit-note", "Everything after it in the timeline is built again.");
      box.replaceChildren(title, ...labels, region, error, note, buttons);
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
    busy(on) {
      if (ok) ok.disabled = on;
    },
    hide() {
      editing = null;
      // Emptied while still drawn, then hidden: a button under the pointer taken out of a panel already hidden leaves Chromium
      // holding the panel as hovered, and then in memory once a new design replaces it (e2e/closed-panels.mjs).
      box.replaceChildren();
      box.hidden = true;
      error = ok = flip = region = null;
      inputs = [];
      watching = null;
    },
    get editing() {
      return editing;
    },
  };
}
