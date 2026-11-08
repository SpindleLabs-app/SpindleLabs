// The fit list under a circle's Diameter box (FK2, Ben's design of
// 2026-10-28): a small "+ Fit" under the number tags the circle with what the
// hole or peg it makes is for (an M3 bolt's clearance, a 6 mm pin's slide
// fit). The number stays the design's size, visible and editable; the tag
// only records the purpose, and Slice for printing prints it at the size
// that fits (FK3, from Printer fits' measures). A native list, so a phone
// shows its own picker. Styles: src/styles/fit-tag.css.

import { FIT_CHOICES, fitId, fitOfId, type Fit } from "@fission/print";

/** The list's words when nothing is picked: the "+" of Ben's design. */
export const NO_FIT_LABEL = "+ Fit";

export interface FitPicker {
  readonly element: HTMLSelectElement;
  /** Shows `fit` as picked (null: none), hearing nothing. */
  set(fit: Fit | null): void;
}

/** The list; `picked` hears each choice a person makes (null: "+ Fit", none). */
export function fitPicker(document: Document, picked: (fit: Fit | null) => void): FitPicker {
  const select = document.createElement("select");
  select.id = "typed-fit";
  select.className = "fit-tag";
  select.title = "What this hole or peg is for: it stays this size in the design, and is printed at the size that fits on your printer (Slice for printing ▸ Printer fits).";
  select.setAttribute("aria-label", "Fit: what this hole or peg is for");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = NO_FIT_LABEL;
  select.append(none);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const c of FIT_CHOICES) {
    let g = groups.get(c.group);
    if (!g) {
      g = document.createElement("optgroup");
      g.label = c.group;
      groups.set(c.group, g);
      select.append(g);
    }
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    g.append(o);
  }
  select.addEventListener("change", () => picked(fitOfId(select.value)));
  // Its keys stay in it: a letter picks an option, never a sketch tool behind it, and Enter or Escape is the list's own.
  select.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    element: select,
    set(fit) {
      select.value = fit ? fitId(fit) : "";
      select.classList.toggle("fit-tag-on", fit !== null);
    },
  };
}
