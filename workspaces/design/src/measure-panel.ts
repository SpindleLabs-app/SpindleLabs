// The Measure panel (step 35e2l2, measure-tool.ts), at the top of the
// properties as Fusion's Measure box is: the two picks in words, each with
// a button that lets it go, what to do next, the rows of numbers, and
// Close. A kernel refusal shows in its place. The workspace drives it: the
// panel shows what it is given and reports what was pressed. Styles:
// src/styles/measure-panel.css.

import type { MeasureRow } from "./measure-tool.ts";

export interface MeasureEvents {
  /** A pick's × pressed: let it go. */
  drop(which: "first" | "second"): void;
  close(): void;
}

export interface MeasurePanel {
  show(): void;
  /** The picks in words (null: none yet) and the next step's hint. */
  setPicks(first: string | null, second: string | null, hint: string): void;
  /** The numbers; empty while waiting. */
  setRows(rows: readonly MeasureRow[]): void;
  /** Why there are no numbers ("" hides it). */
  showError(message: string): void;
  hide(): void;
  readonly shown: boolean;
}

/** What an empty pick says. */
export const NOTHING_PICKED = "Nothing picked";

export function measurePanel(slot: HTMLElement, on: MeasureEvents): MeasurePanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "measure-panel", "measure-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Measure");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "measure-title", "", "Measure");
  const pickRow = (which: "first" | "second", legend: string) => {
    const row = el("div", `measure-${which}`, "measure-panel-pick");
    const value = el("span", `measure-${which}-name`, "measure-panel-value");
    const drop = el("button", `measure-${which}-drop`, "measure-panel-drop", "×");
    drop.type = "button";
    drop.title = `Let the ${which} pick go`;
    drop.setAttribute("aria-label", drop.title);
    drop.addEventListener("click", () => on.drop(which));
    row.append(el("span", "", "measure-panel-legend", legend), value, drop);
    return { value, drop };
  };
  const first = pickRow("first", "First");
  const second = pickRow("second", "Second");
  const hint = el("p", "measure-hint", "measure-panel-hint");
  const table = el("dl", "measure-rows", "measure-panel-rows");
  const error = el("p", "measure-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const close = el("button", "measure-close", "", "Close");
  close.type = "button";
  close.addEventListener("click", () => on.close());
  const buttons = el("div", "", "measure-panel-buttons");
  buttons.append(close);
  box.append(title, first.value.parentElement!, second.value.parentElement!, hint, table, error, buttons);
  let open = false;
  const fill = (p: { value: HTMLElement; drop: HTMLButtonElement }, words: string | null) => {
    p.value.textContent = words ?? NOTHING_PICKED;
    p.value.classList.toggle("measure-panel-empty", words === null);
    p.drop.hidden = words === null;
  };
  return {
    show() {
      open = true;
      box.hidden = false;
    },
    setPicks(a, b, next) {
      fill(first, a);
      fill(second, b);
      hint.textContent = next;
    },
    setRows(rows) {
      // A pick's own facts are marked, so a phone can leave them out under a distance (measure-panel.css).
      table.classList.toggle("measure-pair", rows.some((r) => r.id === "distance"));
      table.replaceChildren(
        ...rows.flatMap((r) => {
          const own = /^(first|second)-/.test(r.id) ? "measure-own" : "";
          return [el("dt", "", own, r.label), el("dd", `measure-${r.id}`, own, r.value)];
        }),
      );
    },
    showError(message) {
      error.textContent = message;
      error.hidden = message === "";
    },
    hide() {
      open = false;
      box.hidden = true;
      error.hidden = true;
    },
    get shown() {
      return open;
    },
  };
}
