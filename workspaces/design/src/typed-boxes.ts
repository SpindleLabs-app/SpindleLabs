// The typed-size boxes (sketch feel SF4) floating by the pointer while a
// line, rectangle or arc is drawn: one box per size (typed-entry.ts
// `typedFields`), each showing the live size until something is typed
// in it, then a padlock while its text is a size it accepts. The boxes
// only show and report; the workspace decides what the locks do.
// Keys inside a box: Tab and Shift+Tab go round the boxes (and anything
// put under one, such as the fit list under Diameter), Enter places
// the point (not while a box holds text it refused: the keys go there),
// Escape empties the boxes and leaves them (a second Escape,
// outside, ends the line as before). Styles: src/styles/typed-entry.css.

import { boxShown, type Unit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { followUnit } from "./properties.ts";
import { readDiameterIn, readLengthIn } from "./typed-length.ts";
import { readAngle, readSides, readSweep, shownValue, type Locks, type Reading, type TypedField } from "./typed-entry.ts";
import { keepInside } from "./pointer-hint.ts";

export interface TypedBoxEvents {
  /** The locks changed (a box's text now reads as a size, or no longer does). */
  locks(locks: Locks): void;
  /** Enter in a box, every box's text a size or empty: place the point with the locks. */
  enter(): void;
  /** Escape in a box: the boxes were emptied and left. */
  escape(): void;
}

/** Each box's label (read by people and the e2e test) and how its text is read. */
export const FIELD_LABELS: Record<TypedField, string> = { length: "Length", angle: "Angle", width: "Width", height: "Height", radius: "Radius", sweep: "Arc angle", diameter: "Diameter", sides: "Sides" };
/** The angles are degrees, a polygon's sides a count with no unit; every other box holds a length, in the unit chosen in Settings (U2c3). */
const unitOf = (field: TypedField, length: Unit): string => (field === "angle" || field === "sweep" ? "°" : field === "sides" ? "" : length);
/** What a box's text means, in millimetres for a length: `unit` is the Settings choice. */
const read = (field: TypedField, text: string, unit: Unit): Reading =>
  field === "angle" ? readAngle(text) : field === "sweep" ? readSweep(text) : field === "sides" ? readSides(text) : field === "diameter" ? readDiameterIn(text, unit) : readLengthIn(text, unit);
/** A live size (millimetres, or degrees for the angles) as a box's placeholder: millimetres to 3 decimals, 5 under 0.01 mm (shownValue). */
const placeholder = (field: TypedField, value: number, unit: Unit): string => (unitOf(field, unit) !== unit || unit === "mm" ? shownValue(value) : boxShown(value, unit));

/** The boxes sit this far right of and below the point they are given (typed-entry.css translate). */
const BOX_OFFSET = { x: 18, y: 14 };
/** How near a point (in pixels) counts as under the boxes: a finger's reach. */
export const TAP_MARGIN = 22;
/** A sketch point this near the pointer is the one just placed (pixels). */
const POINTER_POINT = 16;

/** Whether any of `points` (in the host's pixels) is under `el`, or within `TAP_MARGIN` of it. */
function coversAny(el: HTMLElement, host: HTMLElement, points: readonly { x: number; y: number }[]): boolean {
  const b = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  return points.some((p) => p.x + h.left >= b.left - TAP_MARGIN && p.x + h.left <= b.right + TAP_MARGIN && p.y + h.top >= b.top - TAP_MARGIN && p.y + h.top <= b.bottom + TAP_MARGIN);
}

export interface TypedBoxes {
  /** Shows these fields (in this order) by the point (x, y) in the host's pixels, each not typed in showing its live value; no fields hides the boxes. */
  show(fields: readonly TypedField[], live: Locks, x: number, y: number, avoid?: readonly { x: number; y: number }[]): void;
  /** The accepted typed values: what is locked. */
  readonly locks: Locks;
  /** Shows the unit now chosen (false once the boxes left the page). Held here because the page's listener holds it only weakly. */
  onUnit: () => boolean;
  /** Whether a box has the keys. */
  readonly focused: boolean;
  /** Puts the keys in the first box, with `text` typed into it (a digit that started typing). */
  start(text: string): void;
  /** Empties every box (a point was placed, the tool changed, Escape); keeps the keys in the first box when `keepFocus` and a box had them. */
  clear(keepFocus?: boolean): void;
  /** What each box shown holds, as typed. */
  texts(): Partial<Record<TypedField, string>>;
  /**
   * Puts `texts` back in the boxes, as `texts` read them, while every box
   * is still empty (an Enter that placed nothing gives back what it took);
   * returns whether it did. Nothing typed since is ever overwritten.
   */
  restore(texts: Partial<Record<TypedField, string>>): boolean;
  hide(): void;
  /**
   * Puts `el` under box `field` whenever that box shows (FK2: the fit list under Diameter), or takes it away (null).
   * The boxes only place it; whoever made it hears it.
   */
  under(field: TypedField, el: HTMLElement | null): void;
  readonly element: HTMLElement;
}

export function typedBoxes(host: HTMLElement, on: TypedBoxEvents): TypedBoxes {
  const document = host.ownerDocument;
  const root = document.createElement("div");
  root.className = "typed-entry";
  root.id = "typed-entry"; // read by the e2e test
  root.hidden = true;
  host.append(root);
  let fields: TypedField[] = [];
  const boxes = new Map<TypedField, { row: HTMLElement; input: HTMLInputElement; unit: HTMLElement; lock: HTMLElement; error: HTMLElement }>();
  const unitNow = (): Unit => currentUnit(document);
  const extras = new Map<TypedField, HTMLElement>();
  /** Each extra right under its box's row, when its box shows. */
  const placeExtras = () => {
    for (const [f, el] of extras) {
      const b = boxes.get(f);
      if (b && fields.includes(f)) {
        if (b.row.nextSibling !== el) b.row.after(el);
      } else el.remove();
    }
  };

  /** Where Tab goes, in order: each shown box, then what is under it (FK2: without this the fit list took no keys). */
  const stops = (): HTMLElement[] => fields.flatMap((f) => [boxes.get(f)!.input, ...(extras.has(f) ? [extras.get(f)!] : [])]);
  const tabFrom = (from: HTMLElement, back: boolean) => {
    const all = stops();
    const to = all[(all.indexOf(from) + (back ? all.length - 1 : 1)) % all.length]!;
    to.focus();
    if (to.tagName === "INPUT") (to as HTMLInputElement).select();
  };
  /** Each extra's Tab listener, let go when it is taken away (a list held by the page would hold these boxes with it). */
  const tabbed = new Map<HTMLElement, AbortController>();

  const locks = (): Locks => {
    const out: Locks = {};
    for (const [f, b] of boxes) {
      if (!fields.includes(f) || b.input.value.trim() === "") continue;
      const r = read(f, b.input.value, unitNow());
      if ("value" in r) out[f] = r.value;
    }
    return out;
  };
  /** The first shown box whose text is not empty and reads as no size (shown red), or null. */
  const refused = (): HTMLInputElement | null => {
    for (const f of fields) {
      const input = boxes.get(f)!.input;
      if (input.value.trim() !== "" && "error" in read(f, input.value, unitNow())) return input;
    }
    return null;
  };
  /** Shows each box's padlock or its reason, from its text now. */
  function mark(f: TypedField) {
    const b = boxes.get(f)!;
    const text = b.input.value.trim();
    const r = text === "" ? null : read(f, text, unitNow());
    const locked = r !== null && "value" in r;
    b.lock.hidden = !locked;
    b.row.classList.toggle("typed-entry-locked", locked);
    b.row.classList.toggle("typed-entry-invalid", r !== null && !locked);
    b.error.textContent = r && "error" in r ? r.error : "";
    b.error.hidden = b.error.textContent === "";
    b.input.setAttribute("aria-invalid", String(r !== null && !locked));
  }

  function box(f: TypedField) {
    const row = document.createElement("label");
    row.className = "typed-entry-row";
    row.dataset.field = f;
    const name = document.createElement("span");
    name.className = "typed-entry-name";
    name.textContent = FIELD_LABELS[f];
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.id = `typed-${f}`; // read by the e2e test
    input.dataset.undo = "app-empty"; // empty, it has no typing to take back: Ctrl+Z is the project's Undo (main.ts `undoIsOurs`)
    input.setAttribute("aria-label", unitOf(f, unitNow()) === "" ? FIELD_LABELS[f] : `${FIELD_LABELS[f]} (${unitOf(f, unitNow())})`);
    if (f === "sides") input.inputMode = "numeric";
    const unit = document.createElement("span");
    unit.className = "typed-entry-unit";
    unit.textContent = unitOf(f, unitNow());
    // Our own padlock: a shackle over a body, drawn in the box's colour.
    const lock = document.createElement("span");
    lock.className = "typed-entry-lock";
    lock.title = `${FIELD_LABELS[f]} locked`;
    lock.setAttribute("role", "img");
    lock.setAttribute("aria-label", `${FIELD_LABELS[f]} locked`);
    lock.innerHTML = `<svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true"><path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="1.5" y="6" width="9" height="7" rx="1.5" fill="currentColor"/></svg>`;
    lock.hidden = true;
    const error = document.createElement("span");
    error.className = "typed-entry-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    row.append(name, input, unit, lock, error);
    input.addEventListener("input", () => {
      mark(f);
      on.locks(locks());
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        tabFrom(input, e.shiftKey);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        // A box whose text it refused (red, its reason showing) locks nothing, so placing now would draw to
        // the pointer, not the size typed: Enter places nothing and takes the keys to that box to mend it.
        const bad = refused();
        if (bad) {
          bad.focus();
          bad.select();
        } else on.enter();
      } else if (e.key === "Escape") {
        // Handled here, never by the shell's Escape (which would also end the line).
        e.preventDefault();
        e.stopPropagation();
        api.clear();
        input.blur();
        on.escape();
      }
    });
    boxes.set(f, { row, input, unit, lock, error });
    return row;
  }

  /** The unit changed (Settings): the labels say it, and a length already typed is shown as the same length in it. */
  const onUnit = (): boolean => {
    if (!root.isConnected) return false;
    const to = unitNow();
    for (const [f, b] of boxes) {
      const label = unitOf(f, to);
      b.unit.textContent = label;
      b.input.setAttribute("aria-label", label === "" ? FIELD_LABELS[f] : `${FIELD_LABELS[f]} (${label})`);
      if (label !== to || !fields.includes(f)) continue;
      const text = b.input.value.trim();
      const was: Unit = to === "mm" ? "in" : "mm";
      const r = text === "" ? null : read(f, text, was);
      if (r && "value" in r) b.input.value = boxShown(r.value, to);
      else if (text !== "") b.input.value = ""; // a refused text has no length to convert
      b.input.placeholder = "";
      mark(f);
    }
    on.locks(locks());
    return true;
  };
  followUnit(document, onUnit);

  const api: TypedBoxes = {
    onUnit, // kept by the boxes, which the page's listener holds only weakly
    element: root,
    get locks() {
      return locks();
    },
    get focused() {
      return [...boxes.values()].some((b) => b.input === document.activeElement);
    },
    show(next, live, x, y, avoid) {
      if (next.length === 0) return api.hide();
      if (next.join() !== fields.join()) {
        const had = api.focused;
        fields = [...next];
        for (const b of boxes.values()) b.row.remove();
        for (const f of fields) root.append(boxes.get(f)?.row ?? box(f));
        placeExtras();
        for (const f of fields) {
          boxes.get(f)!.input.value = "";
          mark(f);
        }
        if (had) boxes.get(fields[0])!.input.focus();
      }
      for (const f of fields) boxes.get(f)!.input.placeholder = live[f] === undefined ? "" : placeholder(f, live[f]!, unitNow());
      root.hidden = false;
      const place = (px: number, py: number) => {
        root.style.left = `${Math.round(px)}px`;
        root.style.top = `${Math.round(py)}px`;
        keepInside(root, host);
      };
      place(x, y);
      // The point just placed is at the pointer, which the boxes sit beside by design; the others are what a later tap may need.
      const others = (avoid ?? []).filter((p) => Math.hypot(p.x - x, p.y - y) > POINTER_POINT);
      if (!others.length || !coversAny(root, host, others)) return;
      // A finger's tap on a sketch point (the corner to close on) must not land on the boxes: try beside, above, then the corners of the view.
      const { width, height } = root.getBoundingClientRect();
      const { width: hw, height: hh } = host.getBoundingClientRect();
      for (const [px, py] of [[x - width - 2 * BOX_OFFSET.x, y], [x, y - height - 2 * BOX_OFFSET.y], [0, 0], [hw, 0], [0, hh], [hw, hh]]) {
        place(px, py);
        if (!coversAny(root, host, others)) return;
      }
      place(x, y);
    },
    start(text) {
      if (fields.length === 0) return;
      const input = boxes.get(fields[0])!.input;
      input.focus();
      input.value = text;
      mark(fields[0]);
      on.locks(locks());
    },
    clear(keepFocus = false) {
      const had = api.focused;
      for (const f of fields) {
        boxes.get(f)!.input.value = "";
        mark(f);
      }
      if (had && keepFocus && fields.length) boxes.get(fields[0])!.input.focus();
      else if (had) (document.activeElement as HTMLElement | null)?.blur();
    },
    texts() {
      return Object.fromEntries(fields.map((f) => [f, boxes.get(f)!.input.value]));
    },
    restore(texts) {
      if (fields.some((f) => boxes.get(f)!.input.value !== "")) return false;
      const back = fields.filter((f) => (texts[f] ?? "") !== "");
      if (back.length === 0) return false;
      for (const f of back) {
        boxes.get(f)!.input.value = texts[f]!;
        mark(f);
      }
      on.locks(locks());
      return true;
    },
    hide() {
      if (api.focused) (document.activeElement as HTMLElement | null)?.blur();
      for (const f of fields) boxes.get(f)!.input.value = "";
      fields = [];
      for (const b of boxes.values()) b.row.remove();
      for (const el of extras.values()) el.remove();
      root.hidden = true;
    },
    under(field, el) {
      const was = extras.get(field);
      if (was && was !== el) {
        was.remove();
        tabbed.get(was)?.abort();
        tabbed.delete(was);
      }
      if (el) {
        extras.set(field, el);
        if (!tabbed.has(el)) {
          const listening = new AbortController();
          tabbed.set(el, listening);
          el.addEventListener(
            "keydown",
            (e) => {
              if (e.key !== "Tab" || !el.isConnected) return;
              e.preventDefault();
              tabFrom(el, e.shiftKey);
            },
            { signal: listening.signal },
          );
        }
      } else extras.delete(field);
      placeExtras();
    },
  };
  return api;
}
