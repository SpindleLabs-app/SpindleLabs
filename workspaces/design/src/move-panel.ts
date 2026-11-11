// The Move panel (step 35e2b, move.ts and move-tool.ts), at the top of the
// properties as Fusion's Move/Copy box is: the bodies picked, the distance
// along X, Y and Z (mm), the angle about each axis (degrees, turned X then
// Y then Z), the pivot they turn about (folded under its summary, as it is
// rarely changed: the centre of the picked bodies until a pivot box is
// typed in, "Centre of the bodies" giving that back), the kernel's
// refusal, OK, Cancel, and Snap (35e2d: a face or edge of the bodies
// laid on another body's, move-snap.ts, which sets the boxes). Since Ben's
// ask (2026-10-29) it is two tools: Move shows the distances and Snap,
// Rotate the angles and the pivot, and (step 35e2) Scale its factor and the
// pivot it sizes about; a row the tool doesn't show comes up
// when it holds something (an old file's Move that shifts and turns, or a
// snap that turns), so nothing the Move does is ever out of sight. Enter in a box is OK; Escape is Cancel
// (workspace.ts `shortcut`). A new Move picks its bodies in the view or the
// browser while the panel is open; an edited one keeps the bodies it was
// made with. The workspace drives it; the panel only shows what it is given
// and reports what was typed and clicked. Styles: src/styles/move-panel.css.

import { readDecimalText, wordsInUnit, type MoveKind, type Unit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { MOVE_PARAMS, MOVE_SCALE, type MoveParam } from "./document.ts";
import { followUnit, sizeBox, type SizeBox } from "./properties.ts";
import { MOVE_VERBS, type MoveBox, type MoveValues } from "./move.ts";
import { boxText } from "./move-tool.ts";

export interface MoveEvents {
  /** A box typed in: the preview follows (every box as typed). */
  typed(typed: Record<MoveBox, string>): void;
  /** OK (or Enter in a box). */
  ok(typed: Record<MoveBox, string>): void;
  cancel(): void;
  /** "Centre of the bodies": the pivot follows the picked bodies again. */
  centre(): void;
  /** Snap pressed (35e2d): start picking what to snap, or stop. */
  snap(): void;
}

/** What the panel opens on: a new Move or Rotate (no id) or Move `id`'s numbers, which tool, and the bodies' names. */
export interface MoveShow {
  id: string | null;
  kind: MoveKind;
  name: string;
  bodies: readonly string[];
  values: MoveValues;
}

export interface MovePanel {
  /** Shows the unit now chosen (false once the panel left the page). Held here because the page's listener holds it only weakly. */
  onUnit: () => boolean;
  show(m: MoveShow): void;
  /** The picked bodies' names, as the selection changes (a new Move). */
  setBodies(names: readonly string[]): void;
  /** The pivot the bodies give, put in its boxes unless the user typed one. */
  setPivot(p: readonly [number, number, number]): void;
  /** One box set from a drag of the view's handles (35e2c): typed values follow the drag. */
  setValue(key: MoveParam, value: number): void;
  /**
   * The box a handle's drag is changing glows softly while the drag lasts
   * (Ben, 2026-10-28: "make the changing value in the properties glow a lil
   * bit to avoid confusion"); null when the drag ends, and on show.
   */
  dragging(key: MoveParam | null): void;
  /** The distance and angle boxes set from a snap (35e2d), each to the number itself (already rounded by move-snap.ts), so the bodies land exactly. */
  setValues(values: MoveValues): void;
  /**
   * Snap pressed, with what to pick now in place of the bodies' names, or
   * not (null). The names hidden is what a phone's Properties sheet watches
   * (apps/fission main.ts): it goes away while the view is tapped to pick
   * and comes back with the snapped numbers and OK.
   */
  snapping(words: string | null): void;
  /** Why OK recorded nothing ("" hides it). */
  showError(message: string): void;
  /** OK off while the kernel checks the Move, so a second press can't record twice. */
  busy(on: boolean): void;
  /** Whether OK can be pressed now (not busy while the kernel checks), as Enter in a box asks. */
  readonly ready: boolean;
  hide(): void;
  /** Whether the panel is open. */
  readonly shown: boolean;
  /** The Move being edited, or null for a new one (or none open). */
  readonly editing: string | null;
  /** Which tool the panel is: Move, Rotate or Scale. */
  readonly kind: MoveKind;
  /** Whether a pivot box was typed in, so the pivot no longer follows the bodies. */
  readonly pivotTyped: boolean;
  /** Every box as it is now. */
  readonly typed: Record<MoveBox, string>;
}

/** The three rows of boxes: their legend, the boxes' keys, and the unit after them. */
const ROWS: readonly { legend: string; keys: readonly MoveBox[]; unit: string; id: string }[] = [
  { legend: "Distance", keys: ["x", "y", "z"], unit: "mm", id: "move-distance" },
  { legend: "Angle", keys: ["turnX", "turnY", "turnZ"], unit: "°", id: "move-angle" },
  { legend: "Pivot", keys: ["pivotX", "pivotY", "pivotZ"], unit: "mm", id: "move-pivot" },
  // Scale (step 35e2): one box, the factor (2 doubles every size, 0.5 halves it), about the pivot.
  { legend: "Scale", keys: [MOVE_SCALE], unit: "×", id: "move-scale-row" }, // its box is #move-scale
];

/** What the folded pivot's summary says: where the Move turns about (`p` as the boxes show it, in `unit`). */
export const pivotWords = (typed: boolean, p: readonly string[], unit: Unit = "mm") => (typed ? `Pivot (${p.join(", ")}) ${unit}` : "Pivot: centre of the bodies");

/** The unit a row's legend names: lengths follow Settings (U2c3), angles are degrees. */
const rowUnit = (row: { unit: string }, length: Unit): string => (row.unit === "mm" ? length : row.unit);
/** Whether a box holds a length (the distances and the pivot), shown in the chosen unit; the angles are degrees. */
const isLength = (k: MoveBox): boolean => k !== MOVE_SCALE && !k.startsWith("turn");

export function movePanel(slot: HTMLElement, on: MoveEvents): MovePanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "move-panel", "move-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Move");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "move-title");
  // The bodies picked, or how to pick them; the second is hidden once there is one (main.ts opens a phone's sheet then).
  const bodies = el("p", "move-bodies", "move-panel-bodies");
  const pick = el("p", "move-pick", "move-panel-note", "Click the bodies to move in the view, or their rows in the browser.");
  const snapNote = el("p", "move-snap-note", "move-panel-bodies");
  snapNote.hidden = true;
  const inputs = new Map<MoveBox, HTMLInputElement>();
  // The length boxes (distances, pivot) show the unit chosen in Settings; everything outside them, `typed` included, is
  // millimetres (U2c3). The angle boxes are degrees as before.
  const fields = new Map<MoveBox, SizeBox>();
  const unitNow = (): Unit => currentUnit(document);
  /** Puts `mm` (text in millimetres) in a length box. In millimetres the box shows it rounded (boxText) and the number behind is kept (`exact`); in inches the length box keeps it itself. */
  const setLength = (k: MoveBox, mm: string) => {
    const n = Number(mm);
    if (mm.trim() === "" || !Number.isFinite(n)) {
      fields.get(k)!.value = mm;
      exact.delete(k);
    } else if (unitNow() === "mm") {
      const text = boxText(n);
      fields.get(k)!.value = text;
      exact.set(k, { text, value: n });
    } else {
      fields.get(k)!.value = mm;
      exact.delete(k);
    }
  };
  // What the panel itself put in a box, rounded for show (boxText), with the exact number behind it: a box still showing
  // it reads as that number, so OK on an unchanged Move of 1e-7 mm records no change (weak-spot hunt 10-29).
  const exact = new Map<MoveBox, { text: string; value: number }>();
  const put = (k: MoveBox, value: number) => {
    if (fields.has(k)) return setLength(k, String(value));
    const text = boxText(value);
    inputs.get(k)!.value = text;
    exact.set(k, { text, value });
  };
  // A box holding text it can't read as a number ("1e", "1.2.3") reads as not a number, never as an empty box's 0
  // (weak-spot hunt 10-29); badInput is kept for a number box a test may still give.
  const read = (k: MoveBox) => {
    const input = inputs.get(k)!;
    if (input.validity?.badInput) return "?";
    const field = fields.get(k);
    const text = field ? field.value : input.value; // a length box says millimetres, whichever unit it shows
    const shown = exact.get(k);
    if (shown && shown.text === text) return String(shown.value);
    if (field || text.trim() === "") return text;
    // A turn or a factor: text boxes since issue #518 (a number box dropped a decimal comma, "1,5" read as 15), read here.
    const n = readDecimalText(text);
    return "value" in n ? String(n.value) : "?";
  };
  const typed = () => Object.fromEntries([...MOVE_PARAMS, MOVE_SCALE].map((k) => [k, read(k as MoveBox)])) as Record<MoveBox, string>;
  let pivotTyped = false;
  let editing: string | null = null;
  let kind: MoveKind = "move";
  let open = false;
  const summary = el("summary", "move-pivot-summary");
  const showSummary = () => (summary.textContent = pivotWords(pivotTyped, ["pivotX", "pivotY", "pivotZ"].map((k) => inputs.get(k as MoveParam)!.value), unitNow()));
  const legends: { set: HTMLElement; legend: HTMLElement; row: (typeof ROWS)[number] }[] = [];
  const ok = el("button", "move-ok", "", "OK");
  const rows = ROWS.map((row) => {
    // A group with its name as its first cell: over the boxes on a wide screen, beside them on a phone (move-panel.css).
    const set = el("div", row.id, "move-panel-row");
    set.setAttribute("role", "group");
    set.setAttribute("aria-label", `${row.legend} (${rowUnit(row, unitNow())})`);
    const legend = el("span", "", "move-panel-legend", `${row.legend} (${rowUnit(row, unitNow())})`);
    legends.push({ set, legend, row });
    set.append(legend);
    for (const key of row.keys) {
      const input = el("input", `move-${key}`);
      Object.assign(input, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false });
      const axis = key.slice(-1).toUpperCase();
      input.setAttribute("aria-label", key === MOVE_SCALE ? "Scale factor" : `${row.legend} ${axis}`);
      if (isLength(key)) fields.set(key, sizeBox(input, unitNow));
      input.addEventListener("input", () => {
        if (row.id === "move-pivot") (pivotTyped = true), showSummary();
        on.typed(typed());
      });
      // A box left empty shows 0 as soon as the focus leaves it (Ben, 2026-10-28): it counts as 0 meanwhile (readMoveBoxes).
      input.addEventListener("blur", () => {
        if (input.value.trim() !== "" || input.validity?.badInput || !open) return;
        if (isLength(key)) setLength(key, "0");
        else input.value = key === MOVE_SCALE ? "1" : "0"; // an empty factor scales by 1, as readMoveBoxes reads it
        if (row.id === "move-pivot") showSummary();
        on.typed(typed());
      });
      // Enter in a box is OK, as in any dialog.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !ok.disabled) on.ok(typed());
      });
      inputs.set(key, input);
      const label = el("label", "", "move-panel-box");
      // The factor's box needs no axis letter: its legend says Scale (×).
      if (key === MOVE_SCALE) label.append(input);
      else label.append(el("span", "", "move-panel-axis", axis), input);
      set.append(label);
    }
    return set;
  });
  /** Shows the unit now chosen; false once the panel left the page (Design mounted anew), and it is no longer wanted. */
  const onUnit = (): boolean => {
    if (!box.isConnected) return false;
    for (const k of fields.keys()) {
      const mm = read(k);
      if (mm !== "?") setLength(k, mm);
    }
    for (const { set, legend, row } of legends) {
      legend.textContent = `${row.legend} (${rowUnit(row, unitNow())})`;
      set.setAttribute("aria-label", legend.textContent);
    }
    showSummary();
    return true;
  };
  followUnit(document, onUnit);
  const pivot = el("details", "move-pivot-fold", "move-panel-pivot");
  const centre = el("button", "move-pivot-centre", "", "Centre of the bodies");
  centre.type = "button";
  centre.title = "Turn about the middle of the box round the picked bodies";
  centre.addEventListener("click", () => {
    pivotTyped = false;
    showSummary();
    on.centre();
  });
  pivot.append(summary, rows[2], centre);
  const error = el("p", "move-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  ok.type = "button";
  ok.addEventListener("click", () => on.ok(typed()));
  const cancel = el("button", "move-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  // Snap (35e2d): pressed while the view's clicks pick what to snap and where it lands; off until there are bodies.
  const snap = el("button", "move-snap", "", "Snap");
  snap.type = "button";
  snap.title = "Snap: click a face or edge of the bodies, then a face or edge of another body to land it on";
  snap.setAttribute("aria-pressed", "false");
  snap.addEventListener("click", () => on.snap());
  const buttons = el("div", "", "move-panel-buttons");
  buttons.append(ok, cancel, snap);
  const note = el("p", "move-note", "move-panel-note");
  box.append(title, bodies, snapNote, pick, rows[0], rows[1], rows[3], pivot, error, note, buttons);
  /** The rows this tool shows, and any other that holds something; the note says what OK does with what is shown. */
  const showRows = () => {
    const holds = (keys: readonly MoveBox[]) => keys.some((k) => Number(inputs.get(k)!.value) !== 0);
    const distances = kind === "move" || holds(ROWS[0].keys);
    const angles = kind === "rotate" || holds(ROWS[1].keys);
    const scaled = kind === "scale" || Number(inputs.get(MOVE_SCALE)!.value) !== 1;
    rows[0].hidden = !distances;
    rows[1].hidden = !angles;
    rows[3].hidden = !scaled;
    pivot.hidden = !angles && !scaled;
    snap.hidden = kind !== "move";
    // In the order the kernel is asked (moveMotions): the turns, the scale, the shift.
    const turned = angles ? "Turned about X, then Y, then Z through the pivot" : "";
    const sized = scaled ? (turned ? ", then sized about it" : "Sized about the pivot") : "";
    const moved = distances ? (turned || sized ? ", then moved" : "Moved along X, Y and Z") : "";
    note.textContent = `${turned}${sized}${moved}.`;
  };
  const setBodies = (names: readonly string[]) => {
    bodies.textContent = names.length === 0 ? "" : `${names.length === 1 ? "Body" : "Bodies"}: ${names.join(", ")}`;
    bodies.hidden = names.length === 0 || !snapNote.hidden;
    pick.hidden = names.length > 0; // an edited Move whose bodies were all taken out asks again (35e2i)
    snap.disabled = names.length === 0;
  };
  return {
    onUnit, // kept by the panel, which the page's listener holds only weakly
    show(m) {
      editing = m.id;
      open = true;
      kind = m.kind;
      // An edited Move keeps its pivot; a new one follows its bodies.
      pivotTyped = m.id !== null;
      title.textContent = m.id === null ? m.name : `Edit ${m.name}`;
      box.setAttribute("aria-label", MOVE_VERBS[kind]);
      box.dataset.kind = kind; // read by the e2e test
      this.dragging(null);
      exact.clear();
      for (const k of MOVE_PARAMS) put(k, m.values[k]);
      put(MOVE_SCALE, m.values.scale ?? 1);
      showRows();
      pivot.open = false;
      showSummary();
      setBodies(m.bodies);
      error.hidden = true;
      ok.disabled = false;
      box.hidden = false;
      const first = inputs.get(kind === "rotate" ? "turnX" : kind === "scale" ? MOVE_SCALE : "x")!;
      // Not on a touch screen: the focus there pops the on-screen keyboard up over the view before the
      // person has asked to type (phone hunt 11-01); they tap a box when they want one.
      if (!document.defaultView?.matchMedia?.("(pointer: coarse)").matches) {
        first.focus();
        first.select();
      }
    },
    setBodies,
    setPivot(p) {
      if (pivotTyped) return;
      (["pivotX", "pivotY", "pivotZ"] as const).forEach((k, i) => put(k, p[i]));
      showSummary();
    },
    setValue(key, value) {
      put(key, value);
    },
    dragging(key) {
      for (const [k, input] of inputs) input.classList.toggle("move-panel-dragged", k === key);
    },
    setValues(values) {
      for (const k of ["x", "y", "z", "turnX", "turnY", "turnZ"] as const) {
        if (isLength(k)) fields.get(k)!.value = String(values[k] + 0);
        else inputs.get(k)!.value = String(values[k] + 0);
        exact.delete(k);
      }
      showRows(); // a snap that turns shows the angles it set
    },
    snapping(words) {
      snap.setAttribute("aria-pressed", String(words !== null));
      snapNote.textContent = words ?? "";
      snapNote.hidden = words === null;
      bodies.hidden = words !== null || bodies.textContent === "";
    },
    showError(message) {
      error.textContent = wordsInUnit(message, unitNow());
      error.hidden = message === "";
    },
    busy(on) {
      ok.disabled = on;
    },
    hide() {
      editing = null;
      open = false;
      snap.setAttribute("aria-pressed", "false");
      snapNote.hidden = true;
      box.hidden = true;
      error.hidden = true;
    },
    get shown() {
      return open;
    },
    get ready() {
      return !ok.disabled;
    },
    get editing() {
      return editing;
    },
    get kind() {
      return kind;
    },
    get pivotTyped() {
      return pivotTyped;
    },
    get typed() {
      return typed();
    },
  };
}
