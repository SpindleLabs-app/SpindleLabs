// The Pattern panel (step 61c, pattern-tool.ts), at the top of the
// properties as Combine's and Chamfer's are: the bodies picked (or how to
// pick them), the kind (Row, Grid, Round an axis), then the kind's boxes:
// a row's direction, spacing (negative goes the other way) and count, a
// grid's second direction, spacing and count too; round an axis, the axis,
// the centre the axis passes through, the count and the angle (empty: a
// full turn). Counts include the bodies themselves, as Fusion's do. Join
// (off by default) joins each body's copies to it. Then the preview's state,
// the refusal, OK and Cancel. A box left empty counts as 0 and shows 0 as
// soon as the focus leaves it (the typed-box rule), so the preview stays up
// while a box is cleared to type in it; the angle shows empty (a full turn).
// Enter anywhere in the panel but on a button is OK; Escape is Cancel. The
// workspace drives it. Styles: src/styles/pattern-panel.css.

import { wordsInUnit } from "@fission/core";
import { currentUnit } from "@fission/ui";
import { EDIT_BODIES_NOTE, type EditablePattern } from "./pattern.ts";
import { MAX_INSTANCES, PATTERN_AXES, turnAxisItem, type PatternAxis, type TurnAxis } from "./pattern-values.ts";
import { bodiesWords, KIND_WORDS, PATTERN_KINDS, START_SPACING, typedOf, type PatternKind, type PatternTyped } from "./pattern-tool.ts";
import { sizeBox, type SizeBox } from "./properties.ts";

export interface PatternEvents {
  /** A box, the kind, an axis or Join changed: the error put away, the preview asked again. */
  changed(): void;
  ok(): void;
  cancel(): void;
}

export interface PatternPanel {
  /** Opens a new Pattern with `names` picked, a row along X `spacing` mm apart, 3 in all; or Edit feature on a Pattern, its boxes holding its values. */
  show(names: readonly string[], spacing?: number, edit?: EditablePattern): void;
  /** The Pattern being edited (its id), or null for a new one. */
  readonly editing: string | null;
  /** The bodies picked, by name, as the picks change. */
  setBodies(names: readonly string[]): void;
  /**
   * The construction axes the Axis list offers after X, Y and Z (step 59a3b), by name, in timeline order. The axis
   * chosen stays chosen while it is offered; one no longer offered (deleted, suppressed) stays in the list, marked, so an
   * edited Pattern still shows what it turns round, and X is chosen for a new one.
   */
  setAxes(axes: readonly { axis: TurnAxis; label: string }[]): void;
  /**
   * A new Pattern's spacings as the picks change: each set to `along(its direction)` until typed in (as Move's pivot
   * follows its bodies until typed), so a row picked after the panel opened still starts with its copies apart.
   */
  followSpacing(along: (axis: PatternAxis) => number): void;
  readonly typed: PatternTyped;
  /** The preview's state: the copies drawn (read by the e2e test), or null with why there is none ("" says nothing), in red when `refused`. */
  showPreview(copies: number | null, why?: string, refused?: boolean): void;
  /** Why OK recorded nothing ("" hides it), in the unit chosen in Settings. */
  showError(message: string): void;
  /** OK off while the kernel checks the pattern, so a second press can't record twice. */
  busy(on: boolean): void;
  readonly ready: boolean;
  hide(): void;
  readonly shown: boolean;
}

/** The boxes a new Pattern opens with: a row of 3 along X; a grid's second direction Y, 2 along it; round Z through the origin, 6 in a full turn. */
export const PATTERN_DEFAULTS: PatternTyped = {
  kind: "row",
  direction: "X",
  spacing: String(START_SPACING),
  count: "3",
  direction2: "Y",
  spacing2: String(START_SPACING),
  count2: "2",
  axis: "Z",
  centre: ["0", "0", "0"],
  count3: "6",
  angle: "",
  join: false,
};

/** Join's tooltip. */
export const JOIN_TITLE = "Join: join each body's copies to it where they touch or overlap, making one body. Off: every copy is a body of its own.";
/** The count boxes' tooltip. */
export const COUNT_TITLE = `How many in all, the body itself included (at most ${MAX_INSTANCES})`;

export function patternPanel(slot: HTMLElement, on: PatternEvents): PatternPanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const touch = () => document.defaultView?.matchMedia?.("(pointer: coarse)").matches === true;
  const box = el("section", "pattern-panel", "pattern-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Pattern");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "pattern-title", "", "Pattern");
  const bodies = el("p", "pattern-bodies", "pattern-panel-bodies");
  const note = el("p", "pattern-edit-note", "pattern-panel-note", EDIT_BODIES_NOTE);
  note.hidden = true;
  const select = (id: string, label: string, options: readonly (readonly [string, string])[]) => {
    const s = el("select", id, "dark-select"); // styles/dark-select.css (packages/ui)
    s.setAttribute("aria-label", label);
    for (const [value, words] of options) {
      const o = el("option", "", "", words);
      o.value = value;
      s.append(o);
    }
    return s;
  };
  const row = (id: string, legend: string, ...fields: HTMLElement[]) => {
    const r = el("label", id, "pattern-panel-row");
    const inner = el("span", "", "pattern-panel-fields");
    inner.append(...fields);
    r.append(el("span", "", "pattern-panel-legend", legend), inner);
    return r;
  };
  const axes = PATTERN_AXES.map((a) => [a, a] as const);
  const kind = select("pattern-kind", "Type", PATTERN_KINDS.map((k) => [k, KIND_WORDS[k]] as const));
  const direction = select("pattern-direction", "Direction", axes);
  const direction2 = select("pattern-direction2", "Second direction", axes);
  const axis = select("pattern-axis", "Axis", axes);
  axis.title = "The axis the copies turn round: X, Y or Z through the centre below, or a construction axis (it says where it turns)";
  /** The construction axes listed now, by name (`setAxes`). */
  let offered: { axis: TurnAxis; label: string }[] = [];
  /** An edited Pattern's construction axis by name, for the list when it is no longer offered. */
  let ownAxisName = "";
  /** An edited Pattern's own axis as saved, the only one kept in the list when no longer offered. */
  let ownAxis = "";
  /** The Axis list: X, Y, Z, then each construction axis offered, then `keep` (the one chosen) when it is no longer offered. */
  const listAxes = (keep: string) => {
    const options: [string, string][] = [...axes.map(([a, w]) => [a, w] as [string, string]), ...offered.map((o) => [o.axis, o.label] as [string, string])];
    if (editing !== null && keep === ownAxis && turnAxisItem(keep) !== null && !options.some(([v]) => v === keep)) options.push([keep, `${ownAxisName || "Its construction axis"} (can't be used now)`]);
    axis.replaceChildren(...options.map(([value, words]) => Object.assign(el("option", "", "", words), { value })));
    axis.value = options.some(([v]) => v === keep) ? keep : "X";
  };
  const textBox = (id: string, label: string, decimal = true) => {
    const input = el("input", id);
    Object.assign(input, { type: "text", inputMode: decimal ? "decimal" : "numeric", autocomplete: "off", spellcheck: false });
    input.setAttribute("aria-label", label);
    return input;
  };
  const unitNow = () => currentUnit(document);
  /** Each length box (mm read and written through `sizeBox`, shown in Settings' unit), and each plain box (counts, the angle). */
  const lengths = new Map<string, SizeBox>();
  const plain = new Map<string, HTMLInputElement>();
  const length = (id: string, label: string) => {
    const input = textBox(id, label);
    lengths.set(id, sizeBox(input, unitNow));
    return input;
  };
  const counted = (id: string, label: string) => {
    const input = textBox(id, label, false);
    input.title = COUNT_TITLE;
    plain.set(id, input);
    return input;
  };
  const angleInput = textBox("pattern-angle", "Angle in degrees");
  angleInput.placeholder = "360";
  angleInput.title = "The angle the copies spread over, in degrees (negative turns the other way). Empty: a full turn, spaced evenly all the way round.";
  plain.set("pattern-angle", angleInput);
  const kindRow = row("pattern-kind-row", "Type", kind);
  const rowRows = [
    row("pattern-direction-row", "Direction", direction),
    row("pattern-spacing-row", "Spacing", length("pattern-spacing", "Spacing")),
    row("pattern-count-row", "Count", counted("pattern-count", "Count")),
  ];
  const gridRows = [
    row("pattern-direction2-row", "Direction 2", direction2),
    row("pattern-spacing2-row", "Spacing 2", length("pattern-spacing2", "Second spacing")),
    row("pattern-count2-row", "Count 2", counted("pattern-count2", "Second count")),
  ];
  const centreRow = row("pattern-centre-row", "Centre", ...(["x", "y", "z"] as const).map((k) => length(`pattern-centre-${k}`, `Centre ${k.toUpperCase()}`)));
  centreRow.title = "The point the axis passes through";
  const turnRows = [row("pattern-axis-row", "Axis", axis), centreRow, row("pattern-count3-row", "Count", counted("pattern-count3", "Count round the axis")), row("pattern-angle-row", "Angle (°)", angleInput)];
  const join = el("input", "pattern-join");
  join.type = "checkbox";
  const joinRow = el("label", "pattern-join-row", "pattern-panel-join");
  joinRow.title = JOIN_TITLE;
  joinRow.append(join, document.createTextNode(" Join"));
  const previewWhy = el("p", "pattern-preview-why", "pattern-panel-note");
  previewWhy.hidden = true;
  const error = el("p", "pattern-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const ok = el("button", "pattern-ok", "", "OK");
  ok.type = "button";
  ok.title = "Make the pattern (Enter)";
  ok.addEventListener("click", () => on.ok());
  const cancel = el("button", "pattern-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  const buttons = el("div", "", "pattern-panel-buttons");
  buttons.append(ok, cancel);
  box.append(title, bodies, note, kindRow, ...rowRows, ...gridRows, ...turnRows, joinRow, previewWhy, error, buttons);

  let open = false;
  let editing: string | null = null;
  let picked = 0;
  /** Whether each spacing box was typed in since the panel opened (Edit feature's are its own: never followed). */
  const typedIn = { spacing: false, spacing2: false };
  const showKind = () => {
    const k = kind.value as PatternKind;
    for (const r of rowRows) r.hidden = k === "circular";
    for (const r of gridRows) r.hidden = k !== "grid";
    for (const r of turnRows) r.hidden = k !== "circular";
    // A construction axis says where it turns: no centre to type (59a3b).
    centreRow.hidden = k !== "circular" || turnAxisItem(axis.value) !== null;
  };
  const okState = () => (ok.disabled = ok.dataset.busy === "1" || picked === 0);
  const changed = () => on.changed();
  for (const s of [kind, direction, direction2, axis]) s.addEventListener("change", () => (showKind(), changed()));
  join.addEventListener("change", changed);
  for (const [id, input] of [...[...lengths.keys()].map((id) => [id, lengths.get(id)!.el] as const), ...plain.entries()]) {
    input.addEventListener("input", () => {
      if (id === "pattern-spacing") typedIn.spacing = true;
      if (id === "pattern-spacing2") typedIn.spacing2 = true;
      changed();
    });
    // A box left empty shows 0 as soon as the focus leaves it (the typed-box rule; it counts as 0 meanwhile). The angle
    // stays empty: empty is a full turn, its placeholder saying 360.
    input.addEventListener("blur", () => {
      if (!open || input.value.trim() !== "" || id === "pattern-angle") return;
      const size = lengths.get(id);
      if (size) size.value = "0";
      else input.value = "0";
      changed();
    });
  }
  box.addEventListener("keydown", (e) => {
    const target = e.target as Element | null;
    // A button's own Enter clicks it; anywhere else in the panel (a box, a list, Join) Enter is OK.
    if (e.key === "Enter" && target?.tagName !== "BUTTON") {
      e.preventDefault();
      if (!ok.disabled) on.ok();
    }
    if (e.key === "Escape") on.cancel();
  });
  const setLength = (id: string, mm: string) => (lengths.get(id)!.value = mm);
  const fill = (t: PatternTyped) => {
    kind.value = t.kind;
    direction.value = t.direction;
    direction2.value = t.direction2;
    listAxes(t.axis);
    setLength("pattern-spacing", t.spacing);
    setLength("pattern-spacing2", t.spacing2);
    (["x", "y", "z"] as const).forEach((k, i) => setLength(`pattern-centre-${k}`, t.centre[i]));
    plain.get("pattern-count")!.value = t.count;
    plain.get("pattern-count2")!.value = t.count2;
    plain.get("pattern-count3")!.value = t.count3;
    angleInput.value = t.angle;
    join.checked = t.join;
  };
  return {
    show(names, spacing, edit) {
      open = true;
      editing = edit?.id ?? null;
      ownAxisName = edit?.axisName ?? "";
      ownAxis = edit?.values.kind === "circular" ? edit.values.axis : "";
      typedIn.spacing = typedIn.spacing2 = edit !== undefined;
      const start = spacing === undefined ? PATTERN_DEFAULTS : { ...PATTERN_DEFAULTS, spacing: String(spacing), spacing2: String(spacing) };
      fill(edit === undefined ? start : typedOf(edit.values, start));
      title.textContent = edit === undefined ? "Pattern" : `Edit ${edit.name}`;
      note.hidden = edit === undefined;
      box.dataset.editing = editing ?? "";
      this.showPreview(null);
      error.hidden = true;
      delete ok.dataset.busy;
      showKind();
      this.setBodies(names);
      box.dataset.shows = String(Number(box.dataset.shows ?? 0) + 1); // the phone's sheet opens again for a Pattern started over an open one
      box.hidden = false;
    },
    setBodies(names) {
      picked = names.length;
      bodies.textContent = bodiesWords(names, touch());
      bodies.classList.toggle("pattern-panel-empty", names.length === 0);
      okState();
    },
    setAxes(list) {
      const keep = axis.value;
      offered = [...list];
      listAxes(keep);
      showKind();
    },
    followSpacing(along) {
      if (!typedIn.spacing) setLength("pattern-spacing", String(along(direction.value as PatternAxis)));
      if (!typedIn.spacing2) setLength("pattern-spacing2", String(along(direction2.value as PatternAxis)));
    },
    get typed() {
      return {
        kind: kind.value as PatternKind,
        direction: direction.value as PatternAxis,
        spacing: lengths.get("pattern-spacing")!.value,
        count: plain.get("pattern-count")!.value,
        direction2: direction2.value as PatternAxis,
        spacing2: lengths.get("pattern-spacing2")!.value,
        count2: plain.get("pattern-count2")!.value,
        axis: axis.value as TurnAxis,
        centre: (["x", "y", "z"] as const).map((k) => lengths.get(`pattern-centre-${k}`)!.value) as [string, string, string],
        count3: plain.get("pattern-count3")!.value,
        angle: angleInput.value,
        join: join.checked,
      };
    },
    showPreview(copies, why = "", refused = false) {
      box.dataset.previewCopies = copies === null ? "" : String(copies);
      previewWhy.textContent = wordsInUnit(why, unitNow());
      previewWhy.classList.toggle("bad", refused);
      previewWhy.hidden = why === "";
    },
    showError(message) {
      error.textContent = wordsInUnit(message, unitNow());
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
