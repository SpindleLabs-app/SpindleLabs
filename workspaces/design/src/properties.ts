// The properties panel: the part's parameters (size inputs labelled for its
// shape), the feature's intent and provenance, and the built body's numbers
// with their validation, staleness and STL notes. The workspace drives it;
// the panel only shows what it is given.

import { areaIn, boxShown, describeProvenance, toMm, volumeIn, type BodyView, type Feature, type Unit } from "@fission/core";
import { currentUnit, downstreamChip, formatQuantity as fmt, UNIT_EVENT, type ChipInfo } from "@fission/ui";
import { SHAPES } from "./commands.ts";
import type { PartKind } from "./document.ts";
import { SHAPE_LABELS } from "./toolbar.ts";
import { NAME_NOTE } from "./references.ts";
import { lengthRefused, MIN_TYPED } from "./typed-entry.ts";
import type { SelectionRow } from "./selection.ts";

export type SizeKey = "width" | "depth" | "height";
export const SIZE_KEYS: SizeKey[] = ["width", "depth", "height"];

export interface ParameterRow {
  key: SizeKey;
  label: string;
  shown: boolean;
}

/**
 * Which size inputs a shape uses and what they are called: round shapes
 * take a diameter and no depth, a sphere no height either, and an extruded
 * outline's height is how far it is extruded. An extrude of a sketch has
 * only that distance: the sketch gives its outline.
 */
export function parameterRows(shape: PartKind): ParameterRow[] {
  const round = shape === "cylinder" || shape === "sphere";
  const primitive = round || shape === "box";
  const sketched = shape === "sketch-extrude";
  return [
    { key: "width", label: round ? "Diameter" : "Width", shown: !sketched },
    { key: "depth", label: "Depth", shown: !round && !sketched },
    { key: "height", label: primitive ? "Height" : "Extrude by", shown: shape !== "sphere" },
  ];
}

/**
 * Why the Parameters boxes' sizes `typed` can't be taken for a `kind`, in the
 * box's own name, or null. Each shown box: a number (hunt 26g), more than
 * 0 mm (hunt 26h), from 0.001 mm to 1 km (`lengthRefused`, app sweep
 * 2026-10-28). Then the shape's own rules a person can break by typing
 * ordinary sizes (clumsy hunt 2026-11-04: both reached the kernel, failed in
 * its words and were recorded): a round shape's radius, half its diameter,
 * is at least 0.001 mm as the sketch's Diameter box asks (`readDiameter`);
 * a slot w × d has round ends d across joined by straights w − d long,
 * which must be at least the 0.001 mm the modeller keeps.
 */
export function panelSizeRefused(kind: PartKind, typed: Record<SizeKey, string>): string | null {
  for (const r of parameterRows(kind)) {
    if (!r.shown) continue;
    const text = typed[r.key];
    const label = kind === "sketch-extrude" ? "distance" : r.label.toLowerCase();
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v)) return `Type the ${label} in mm.`;
    if (v <= 0) return `The ${label} must be more than 0 mm.`;
    const refused = lengthRefused(v);
    if (refused !== null) return `The ${label}${refused.slice("A length".length)}`;
    if (r.label === "Diameter" && v / 2 < MIN_TYPED) return `The diameter must be at least ${2 * MIN_TYPED} mm: its radius can't be under ${MIN_TYPED} mm, the smallest piece the modeller keeps.`;
  }
  if (kind === "slot" && Number(typed.width) - Number(typed.depth) < MIN_TYPED)
    return `A slot's depth must be less than its width, by at least ${MIN_TYPED} mm: its round ends are as wide as it is deep.`;
  return presetTooSmall(kind, Number(typed.width), Number(typed.depth));
}

/**
 * How far a star's nearest two sides are apart, for each mm of its smaller side (profiles.ts: outer radius r = m/2,
 * inner corners at 0.4·r, ten corners 36° apart): the inner corner at 36° from the side joining the outer corner at
 * 72° to the inner one at 108°, 0.4442·r = 0.2221·m (test/tiny-presets.test.ts works it by hand).
 */
const STAR_GAP = (() => {
  const at = (deg: number, r: number) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  const [p, a, b] = [at(36, 0.2), at(72, 0.5), at(108, 0.2)];
  const v = [b[0] - a[0], b[1] - a[1]];
  const w = [p[0] - a[0], p[1] - a[1]];
  return Math.abs(v[0] * w[1] - v[1] * w[0]) / Math.hypot(v[0], v[1]);
})();

/**
 * Why an L-bracket, plate or star `w` × `d` mm is too small for the modeller (clumsy-user hunt 2026-11-04: it failed in
 * the kernel's words and was kept as a broken part), or null. Each piece of its outline (profiles.ts) must be at least
 * MIN_TYPED long, wide or apart: an L-bracket's arms are 0.3·m thick (m = the smaller side); a plate's holes 0.15·m in
 * radius and w/4 − 0.15·m from its ends; a star's nearest sides STAR_GAP·m apart. The size suggested is the next one up
 * that builds.
 */
export function presetTooSmall(kind: PartKind, w: number, d: number): string | null {
  const m = Math.min(w, d);
  const words = (shape: string, what: string, least: string) =>
    `${shape} this small has ${what} ${MIN_TYPED} mm, the smallest piece the modeller keeps: make its width and depth at least ${least} mm.`;
  if (kind === "l-bracket" && 0.3 * m < MIN_TYPED) return words("An L-bracket", "arms thinner than", "0.0034");
  if (kind === "plate" && (0.15 * m < MIN_TYPED || w / 4 - 0.15 * m < MIN_TYPED)) return words("A plate", "holes, or gaps beside them, under", "0.01");
  if (kind === "star" && STAR_GAP * m < MIN_TYPED) return words("A star", "points closer together than", "0.0046");
  return null;
}

// The ids are read by the e2e test (#width, #stats[data-stale], #action-note…).
export const DEFAULT_SIZES: Record<SizeKey, string> = { width: "40", depth: "30", height: "20" };
/** The panel's words for a design with no body (24f4). */
export const NO_BODY_FEATURE = "No body: nothing in the timeline builds";
export const NO_PART = "No body to change: choosing a shape or typing a size adds a new body at the marker.";
/** The Shape choice's words for a part that is no preset (U0d: the toolbar's shape buttons moved here; Insert ▾ adds a new body). */
export const EXTRUDED_SKETCH = "Extruded sketch";
export const SHAPE_TITLE = "The part's shape: choosing another changes the part in place when it is a preset, else adds a new body at the marker. Insert ▾ adds a new body.";
const NONE = "—";

/**
 * What the panel says once a refused size (`why`, typed as `typed`) has
 * given way to the one the design kept: it went back without a word
 * (beginner play-test 2026-10-28). A negative extrude distance names Flip,
 * the way to go the other way.
 */
export function revertedNote(why: string, typed: string, kept: string, extrude: boolean): string {
  const flip = extrude && Number(typed) < 0 ? " To extrude the other way, tick Flip in Edit feature." : "";
  return `${why} It is back to ${kept} mm.${flip}`;
}

const HTML = `
  <h2>Selection</h2>
  <p id="selection-empty">Nothing selected: click a face or an edge (double-click or double-tap for its whole body), or a body in the browser.</p>
  <ul id="selection-list" class="selection-list"></ul>
  <p id="selection-note" class="bad" hidden></p>
  <div id="selection-actions" class="verbs" role="group" aria-label="Actions for the selection" hidden></div>
  <p id="action-note"></p>
  <h2>Parameters</h2>
  <p id="no-part" hidden>${NO_PART}</p>
  <label id="shape-row" title="${SHAPE_TITLE}">Shape <select id="shape" class="dark-select"><option value="" disabled hidden>—</option><option value="sketch-extrude" disabled hidden>${EXTRUDED_SKETCH}</option>${SHAPES.map((k) => `<option value="${k}">${SHAPE_LABELS[k]}</option>`).join("")}</select></label>
  ${SIZE_KEYS.map((k) => `<label id="${k}-row"><span id="${k}-label"></span> <input id="${k}" type="number" value="${DEFAULT_SIZES[k]}" step="any" /> <span class="unit-name">mm</span></label>`).join("\n  ")}
  <h2>Feature</h2>
  <dl id="feature-info">
    <dt>Feature</dt><dd id="intent">…</dd>
    <dt>Made from</dt><dd id="provenance">…</dd>
  </dl>
  <h2 id="body-heading">Body</h2>
  <dl id="stats">
    <dt>Volume</dt><dd id="volume">…</dd>
    <dt>Area</dt><dd id="area">…</dd>
    <dt>Topology</dt><dd id="topology">…</dd>
    <dt>Validation</dt><dd id="status">…</dd>
  </dl>
  <p id="body-problems" class="bad" hidden></p>
  <p id="stale-note" hidden>Out of date: these numbers are for the last part that built.</p>
  <p id="error"></p>
  <p id="kept-warning" class="kept kept-warning" role="status" hidden></p>
  <section id="downstream" hidden>
    <h2>Downstream</h2>
    <div id="downstream-chips" role="group" aria-label="What other workspaces make from this design"></div>
  </section>`;

/** The event the properties slot gets when new words the user must see are put in it (properties-fold.ts opens a folded panel for it). */
export const WORDS_EVENT = "properties-words";

/** A verb as a button shows it: the action's id, label and one-line title. */
export interface Verb {
  id: string;
  label: string;
  title: string;
}

/**
 * A size box. The document holds millimetres, so `value` is always millimetres as text, whichever unit the box shows
 * (U2c2): reading converts what is typed, writing converts what is put in. Nothing else in the Design workspace knows
 * the box may show inches. In millimetres it is the input's own text, untouched.
 */
export interface SizeBox {
  /** The number box itself, in the unit it shows (the e2e tests and the page see this). */
  readonly el: HTMLInputElement;
  /** Millimetres as text; text that is no number (empty, "e") is returned as the input has it, for the refusal to name. */
  value: string;
  addEventListener(type: "input" | "change" | "blur", listener: () => void): void;
  /** The unit changed (Settings): show the same length in the new unit. */
  reshow(): void;
}

/** A size box over `el`, showing the unit `unitNow()` gives, now and after each `reshow`. */
export function sizeBox(el: HTMLInputElement, unitNow: () => Unit): SizeBox {
  let unit: Unit = unitNow(); // the unit the text in the box is in
  /** The millimetres last put in, while the box still has the text that was put there: read back exactly, not through a division. */
  let put: { text: string; mm: string } | null = null;
  const read = (): string => {
    if (put !== null && el.value === put.text) return put.mm;
    const text = el.value;
    const n = Number(text);
    if (unit === "mm" || text.trim() === "" || !Number.isFinite(n)) return text;
    return String(Number(toMm(n, unit).toPrecision(12)));
  };
  const write = (mm: string) => {
    unit = unitNow();
    const n = Number(mm);
    if (unit === "mm" || mm.trim() === "" || !Number.isFinite(n)) {
      el.value = mm;
      put = null;
      return;
    }
    el.value = boxShown(n, unit);
    put = { text: el.value, mm };
  };
  return {
    el,
    get value() {
      return read();
    },
    set value(mm: string) {
      write(mm);
    },
    addEventListener: (type, listener) => el.addEventListener(type, listener),
    reshow() {
      write(read());
    },
  };
}

export interface PropertiesPanel {
  /** The size boxes, in SIZE_KEYS order. */
  inputs: SizeBox[];
  /** The Shape choice (U0d), standing for the part's shape as the toolbar's shape buttons did. */
  shapeChoice: HTMLSelectElement;
  /** Labels and shows the size inputs for this shape; the Shape choice shows the part's shape (`pressed`), or "—" for a design with no body. */
  setShape(shape: PartKind, pressed: PartKind | null): void;
  /** The part's feature, or null for a design with no body (24f4). */
  showFeature(feature: Feature | null): void;
  /** What is selected: one row per item, or the empty note. */
  showSelection(rows: readonly SelectionRow[]): void;
  /** Says what the last rebuild took out of the selection ("" hides the note). */
  showSelectionNote(text: string): void;
  /** A built body's name ("Body 3", the heading), numbers and validation, with its problems listed under them. */
  showBody(view: BodyView, name: string): void;
  /** No body to describe (24f4): the numbers blank and the Parameters' note on how to add one. */
  showNoBody(): void;
  /** Why the last rebuild failed, or "" once one builds. */
  showError(message: string): void;
  /** An extrude built from its kept shape (step 24d2): what happened and why, or "" for none. */
  showWarning(message: string): void;
  /** Dims the body's numbers while stale; says so in words when the rebuild failed. */
  markStale(stale: boolean, failed: boolean): void;
  /** The verbs the action registry offers for the selection, as buttons (none hides the row). */
  showActions(verbs: readonly Verb[], onRun: (id: string) => void): void;
  /** What the last action said: a warning or an error, or "" for nothing. */
  showActionNote(text: string, bad: boolean): void;
  /** What other workspaces make from the design, one chip each; a click opens the chip's workspace. None hides the whole section. */
  showDownstream(chips: readonly ChipInfo[], onOpen: (target: string) => void): void;
}

/** Fills the properties slot and returns the handle that updates it. */
export function propertiesPanel(slot: HTMLElement): PropertiesPanel {
  slot.innerHTML = HTML;
  const $ = <T extends HTMLElement>(id: string) => slot.querySelector<T>(`#${id}`)!;
  /** New words the user must see (an action's note, a rebuild's error): a folded panel opens for them (U0b, `WORDS_EVENT`). */
  const said = () => {
    // The slot's own page's Event (a test's DOM has its own).
    const PageEvent = slot.ownerDocument.defaultView?.Event ?? Event;
    slot.dispatchEvent(new PageEvent(WORDS_EVENT));
  };
  /** The slot says when it holds a failed rebuild's words or a warning, so its folded button can show it (U0b, properties-fold.css). */
  const markProblem = () => {
    if ($("error").textContent !== "" || !$("kept-warning").hidden) slot.dataset.problem = "";
    else delete slot.dataset.problem;
  };
  const doc = slot.ownerDocument;
  const boxes = SIZE_KEYS.map((k) => sizeBox($<HTMLInputElement>(k), () => currentUnit(doc)));
  /** The body numbers last shown, drawn again when the unit changes. */
  let shownBody: BodyView | null = null;
  const drawBody = () => {
    if (shownBody === null) return;
    const unit = currentUnit(doc);
    $("volume").textContent = `${fmt(volumeIn(shownBody.volume, unit))} ${unit}³`;
    $("area").textContent = `${fmt(areaIn(shownBody.area, unit))} ${unit}²`;
  };
  const onUnit = () => {
    // The panel was filled again (Design mounted anew): this one is gone.
    if (slot.querySelector("#width") !== boxes[0].el) return doc.removeEventListener(UNIT_EVENT, onUnit);
    for (const b of boxes) b.reshow();
    for (const name of slot.querySelectorAll(".unit-name")) name.textContent = currentUnit(doc);
    drawBody();
  };
  doc.addEventListener(UNIT_EVENT, onUnit);
  for (const name of slot.querySelectorAll(".unit-name")) name.textContent = currentUnit(doc);
  return {
    inputs: boxes,
    shapeChoice: $<HTMLSelectElement>("shape"),
    setShape(shape, pressed) {
      const choice = $<HTMLSelectElement>("shape");
      choice.value = pressed ?? "";
      // The two words that are no choice show only while they are the part's.
      for (const o of choice.options) if (o.disabled) o.hidden = o.value !== choice.value;
      for (const row of parameterRows(shape)) {
        $(`${row.key}-label`).textContent = row.label;
        $(`${row.key}-row`).hidden = !row.shown;
      }
    },
    showFeature(feature) {
      $("intent").textContent = feature === null ? NO_BODY_FEATURE : feature.intent.summary;
      $("provenance").textContent = feature === null ? NONE : describeProvenance(feature.provenance);
      $("no-part").hidden = feature !== null;
    },
    showSelection(rows) {
      const document = slot.ownerDocument;
      $("selection-empty").hidden = rows.length > 0;
      $("selection-list").replaceChildren(
        ...rows.map((r) => {
          const li = document.createElement("li");
          li.dataset.id = r.id; // read by the e2e test
          const id = document.createElement("code");
          id.textContent = r.id;
          id.title = NAME_NOTE;
          li.append(`${r.name} · ${r.type} `, id);
          return li;
        }),
      );
    },
    showSelectionNote(text) {
      const note = $("selection-note");
      note.textContent = text;
      note.hidden = text === "";
    },
    showBody(view, name) {
      $("body-heading").textContent = name;
      shownBody = view;
      drawBody();
      $("topology").textContent = `${view.vertices} V · ${view.edges} E · ${view.faces} F`;
      const status = $("status");
      status.textContent = view.errors.length === 0 ? "valid" : `${view.errors.length} problem(s)`;
      status.className = view.errors.length === 0 ? "ok" : "bad";
      $("body-problems").textContent = view.errors.join("\n");
      $("body-problems").hidden = view.errors.length === 0;
    },
    showNoBody() {
      shownBody = null;
      $("body-heading").textContent = "Body";
      for (const id of ["volume", "area", "topology", "status"]) $(id).textContent = NONE;
      $("status").className = "";
      $("body-problems").textContent = "";
      $("body-problems").hidden = true;
    },
    showError(message) {
      const was = $("error").textContent;
      $("error").textContent = message;
      markProblem();
      if (message !== "" && message !== was) said();
    },
    showWarning(message) {
      $("kept-warning").textContent = message;
      $("kept-warning").hidden = message === "";
      markProblem();
    },
    markStale(stale, failed) {
      $("stats").classList.toggle("stale", stale);
      $("stats").dataset.stale = String(stale);
      $("stale-note").hidden = !(stale && failed);
    },
    showActions(verbs, onRun) {
      const row = $("selection-actions");
      row.hidden = verbs.length === 0;
      row.replaceChildren(
        ...verbs.map((v) => {
          const b = slot.ownerDocument.createElement("button");
          b.type = "button";
          b.textContent = v.label;
          b.title = v.title;
          b.dataset.action = v.id; // read by the e2e test
          b.addEventListener("click", () => onRun(v.id));
          return b;
        }),
      );
    },
    showActionNote(text, bad) {
      const note = $("action-note");
      note.textContent = text;
      note.className = bad ? "bad" : "";
      if (text !== "") said();
    },
    showDownstream(chips, onOpen) {
      $("downstream").hidden = chips.length === 0;
      const box = $("downstream-chips");
      box.innerHTML = chips.map(downstreamChip).join(""); // the chip escapes what it is given
      for (const b of box.querySelectorAll<HTMLElement>(".downstream-chip")) b.addEventListener("click", () => onOpen(b.dataset.target!));
    },
  };
}
