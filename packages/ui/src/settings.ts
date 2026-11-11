// The Settings page (the skeleton): a dialog of sections, each a card. Most
// sections say what will live there; only what really works today has a
// control (the shortcuts list, the version). `SettingsStore` keeps choices in
// the browser alone, so Settings works offline with no account; storage that
// is off or full never throws, the settings just don't stick.

import { CUSTOM_NAMES, DEFAULT_CUSTOM, parseHex, toHex, type CustomColours } from "./custom-theme.ts";
import { boxShown, parseLength, wordsInUnit, type Unit } from "@fission/core";
import { MOUSE_PRESETS, type MousePreset } from "@fission/core";
import { THEME_CHOICES, type ThemeChoice } from "./theme-choice.ts";
import { UNIT_CHOICES } from "./unit-choice.ts";

export interface SettingsSection {
  id: string;
  title: string;
  /** What will live here, in plain words, shown while there is nothing to set. */
  coming: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", title: "General", coming: "" },
  { id: "design", title: "Design", coming: "" },
  { id: "phone", title: "Phone", coming: "Touch and sheet choices will be set here." },
  { id: "printing", title: "Printing", coming: "Your printer and the slicer will be set here." },
  { id: "privacy", title: "Privacy and data", coming: "" },
  { id: "about", title: "About", coming: "" },
];

export const SETTINGS_KEY = "spindlelabs-settings";

/** The part of Web Storage the store uses (any of it may throw: storage off, private mode, full). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SettingValue = string | number | boolean;

export class SettingsStore {
  private values = new Map<string, SettingValue>();
  private readonly storage: SettingsStorage | null;
  constructor(storage: SettingsStorage | null) {
    this.storage = storage;
    this.reload();
  }
  /** Reads the stored settings again, dropping what was read before (settings brought from the account were just written). */
  reload(): void {
    this.values = new Map();
    try {
      const raw = this.storage?.getItem(SETTINGS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") this.values.set(k, v);
      }
    } catch {
      // Damaged or unreadable: start empty rather than refuse to open.
    }
  }
  get<T extends SettingValue>(key: string, fallback: T): T {
    const v = this.values.get(key);
    return typeof v === typeof fallback ? (v as T) : fallback;
  }
  set(key: string, value: SettingValue): void {
    this.values.set(key, value);
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(this.values)));
    } catch {
      // Not kept this time; the choice still holds until the page closes.
    }
  }
}

export interface SettingsParts {
  /** "kernel v0.1.2" or "" while the kernel loads. */
  version: string;
  onShortcuts: () => void;
  /** The stored theme choice and the way to change it (U2a); the Theme row shows only when both are given. */
  theme?: ThemeChoice;
  onTheme?: (choice: ThemeChoice) => void;
  /** The Custom theme's three colours and the way to change them; applies at once and returns what it adjusted, in words (Ben, 2026-11-04). */
  custom?: CustomColours;
  onCustom?: (colours: CustomColours) => string[];
  /** The stored unit for lengths and the way to change it (U2c2); the Units row shows only when both are given. */
  unit?: Unit;
  onUnit?: (unit: Unit) => void;
  /** The grid size new sketches start with, in millimetres, and the way to change it (U2b): returns why it was refused, or null. The Grid row shows only when both are given. */
  grid?: number;
  onGrid?: (mm: number) => string | null;
  /** Whether new sketches start with Snap to grid on, and the way to change it. */
  snap?: boolean;
  onSnap?: (on: boolean) => void;
  /** Where the AI assistant's provider settings live: a row with a button that closes Settings and shows them. */
  onAiSettings?: () => void;
  /** The stored mouse preset and the way to change it (U2d); the Mouse row and its table show only when both are given. */
  mouse?: MousePreset;
  onMouse?: (preset: MousePreset) => void;
  /** Opens Report a bug (bug-report.ts); the About card's row shows only when given. */
  onReportBug?: () => void;
  /** Opens What's new (whats-new.ts), the public list of changes; the About card's row shows only when given. */
  onWhatsNew?: () => void;
}

/** Fill the dialog: a header with Close, then one card per section. */
export function fillSettings(dialog: HTMLDialogElement, parts: SettingsParts): void {
  const doc = dialog.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const header = el("header", "settings-head");
  const h2 = el("h2", undefined, "Settings");
  h2.id = "settings-title";
  const close = el("button", "close", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  header.append(h2, close);
  const body = el("div", "settings-body");
  /** Redraws the Grid box in the unit just chosen (the Units row is in an earlier card, so this is set once the Design card is built). */
  let showGrid: (unit: Unit) => void = () => {};
  for (const s of SETTINGS_SECTIONS) {
    const card = el("section", "settings-card");
    card.dataset.section = s.id;
    card.append(el("h3", undefined, s.title));
    if (s.coming) card.append(el("p", "settings-empty", s.coming));
    if (s.id === "design") {
      if (parts.grid !== undefined && parts.onGrid) showGrid = gridRows(el, card, parts.grid, parts.unit ?? "mm", parts.onGrid, parts.snap ?? false, parts.onSnap);
      if (parts.onAiSettings) {
        const row = el("div", "settings-row settings-ai");
        const open = el("button", "settings-action", "Open");
        open.type = "button";
        open.setAttribute("aria-label", "Open AI assistant provider"); // its row's words, so a list of buttons says what it opens
        open.addEventListener("click", () => {
          dialog.close();
          parts.onAiSettings?.();
        });
        row.append(el("span", undefined, "AI assistant provider"), open);
        card.append(row);
      }
    }
    if (s.id === "general") {
      if (parts.theme !== undefined && parts.onTheme) {
        const themeRow = el("div", "settings-row settings-theme");
        const group = el("div", "settings-choices");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "Theme");
        for (const c of THEME_CHOICES) {
          const b = el("button", "settings-choice", c.label);
          b.type = "button";
          b.dataset.choice = c.id;
          b.setAttribute("role", "radio");
          const pick = (chosen: string) => {
            for (const other of group.children) other.setAttribute("aria-checked", String((other as HTMLElement).dataset.choice === chosen));
          };
          b.addEventListener("click", () => {
            parts.onTheme?.(c.id);
            pick(c.id);
          });
          group.append(b);
          b.setAttribute("aria-checked", String(parts.theme === c.id));
        }
        themeRow.append(el("span", undefined, "Theme"), group);
        card.append(themeRow);
        if (parts.custom && parts.onCustom) card.append(customBlock(el, parts.custom, parts.onCustom, () => group.querySelector<HTMLElement>('[aria-checked="true"]')?.dataset.choice ?? "", group));
      }
      if (parts.unit !== undefined && parts.onUnit) {
        const unitRow = el("div", "settings-row settings-units");
        const group = el("div", "settings-choices");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "Units");
        for (const c of UNIT_CHOICES) {
          const b = el("button", "settings-choice", c.label);
          b.type = "button";
          b.dataset.unit = c.id;
          b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", String(parts.unit === c.id));
          b.addEventListener("click", () => {
            parts.onUnit?.(c.id);
            showGrid(c.id);
            for (const other of group.children) other.setAttribute("aria-checked", String((other as HTMLElement).dataset.unit === c.id));
          });
          group.append(b);
        }
        unitRow.append(el("span", undefined, "Units"), group);
        card.append(unitRow);
      }
      if (parts.mouse !== undefined && parts.onMouse) card.append(mouseBlock(el, parts.mouse, parts.onMouse));
      const row = el("div", "settings-row");
      const label = el("span", undefined, "Keyboard shortcuts");
      const open = el("button", "settings-action", "Show");
      open.type = "button";
      open.setAttribute("aria-label", "Show keyboard shortcuts"); // its row's words, so a list of buttons says what it shows
      open.addEventListener("click", () => {
        dialog.close();
        parts.onShortcuts();
      });
      row.append(label, open);
      card.append(row);
    } else if (s.id === "privacy") {
      card.append(el("p", undefined, "Your projects are kept in this browser and are never sent to us. An account is optional and never needed to design, slice or save; signing in sends only what the privacy page lists. The optional AI assistant sends only what you ask it, and only once you turn it on."));
    } else if (s.id === "about") {
      card.append(el("p", undefined, parts.version ? `SpindleLabs, ${parts.version}` : "SpindleLabs"));
      if (parts.onWhatsNew) {
        const row = el("div", "settings-row");
        const show = el("button", "settings-action", "Show");
        show.type = "button";
        show.id = "settings-whats-new";
        show.setAttribute("aria-label", "Show what's new");
        show.addEventListener("click", () => {
          dialog.close();
          parts.onWhatsNew?.();
        });
        row.append(el("span", undefined, "What's new"), show);
        card.append(row);
      }
      if (parts.onReportBug) {
        const row = el("div", "settings-row");
        const report = el("button", "settings-action", "Report a bug");
        report.type = "button";
        report.id = "settings-report-bug";
        report.addEventListener("click", () => {
          dialog.close();
          parts.onReportBug?.();
        });
        row.append(el("span", undefined, "Something not working?"), report);
        card.append(row);
      }
    }
    body.append(card);
  }
  dialog.replaceChildren(header, body);
}

/**
 * The Design card's Grid size and Snap to grid rows (U2b). The box shows the size in the chosen unit and is read with
 * `parseLength` (so "0.5 in" and "5mm" work); a size the kernel won't take (0, negative, empty, under 1 µm, over 1 km, not a
 * number) is refused in words in that unit and the last good size goes back in the box. Returns the redraw for a new unit.
 */
function gridRows(el: El, card: HTMLElement, startMm: number, startUnit: Unit, apply: (mm: number) => string | null, snap: boolean, onSnap?: (on: boolean) => void): (unit: Unit) => void {
  let unit = startUnit;
  let good = startMm;
  const row = el("label", "settings-row settings-grid");
  const input = el("input", "grid-size");
  input.type = "text";
  input.inputMode = "decimal";
  input.setAttribute("aria-label", "Grid size");
  const name = el("span", "grid-unit", ` ${unit}`);
  const note = el("p", "settings-grid grid-note");
  note.setAttribute("role", "status");
  const show = () => {
    input.value = boxShown(good, unit);
    name.textContent = ` ${unit}`;
  };
  input.addEventListener("change", () => {
    const mm = parseLength(input.value, unit);
    const why = mm === null ? "Type the grid size as a number (like 10 or 0.5 in)." : apply(mm);
    if (why === null && mm !== null) {
      good = mm;
      note.textContent = "";
    } else {
      note.textContent = `${wordsInUnit(why ?? "", unit)} The grid stays at ${boxShown(good, unit)} ${unit}.`;
    }
    show();
  });
  const label = el("span", undefined, "Grid size for new sketches");
  const field = el("span", "grid-field");
  field.append(input, name);
  row.append(label, field);
  show();
  card.append(row, note);
  if (onSnap) {
    const snapRow = el("label", "settings-row settings-grid grid-snap");
    const box = el("input");
    box.type = "checkbox";
    box.checked = snap;
    box.addEventListener("change", () => onSnap(box.checked));
    snapRow.append(el("span", undefined, "Snap to grid in new sketches"), box);
    card.append(snapRow);
  }
  return (next) => {
    unit = next;
    show();
  };
}

/** The Mouse row: a choice of presets, and under it the table of what each button and key does in the one chosen. */
function mouseBlock(el: El, start: MousePreset, choose: (preset: MousePreset) => void): HTMLElement {
  const block = el("div", "settings-mouse");
  const row = el("div", "settings-row settings-mouse-row");
  const group = el("div", "settings-choices");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Mouse controls");
  const summary = el("p", "settings-mouse-summary");
  const table = el("table", "settings-mouse-table");
  table.setAttribute("aria-label", "What each mouse button and key does");
  const show = (id: MousePreset) => {
    const preset = MOUSE_PRESETS.find((p) => p.id === id)!;
    summary.textContent = preset.summary;
    table.replaceChildren(...preset.rows.map((r) => {
      const tr = el("tr");
      tr.append(el("th", undefined, r.gesture), el("td", undefined, r.does));
      return tr;
    }));
    for (const other of group.children) other.setAttribute("aria-checked", String((other as HTMLElement).dataset.mouse === id));
  };
  for (const p of MOUSE_PRESETS) {
    const b = el("button", "settings-choice", p.label);
    b.type = "button";
    b.dataset.mouse = p.id;
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => {
      choose(p.id);
      show(p.id);
    });
    group.append(b);
  }
  row.append(el("span", undefined, "Mouse"), group);
  block.append(row, summary, table);
  show(start);
  return block;
}

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

/** The Custom theme's block: a colour picker and a hex box for each of primary, secondary and highlight, what was adjusted, and Reset. Shown while Custom is the chosen theme. */
function customBlock(el: El, start: CustomColours, apply: (c: CustomColours) => string[], chosen: () => string, group: HTMLElement): HTMLElement {
  const block = el("div", "settings-custom");
  const colours: CustomColours = { ...start };
  const notes = el("p", "settings-custom-notes");
  notes.setAttribute("role", "status");
  const inputs = new Map<keyof CustomColours, { picker: HTMLInputElement; hex: HTMLInputElement }>();
  const send = () => {
    notes.textContent = apply({ ...colours }).join(" ");
  };
  const hint: Record<keyof CustomColours, string> = { primary: "the page and panels", secondary: "the 3D view's sky and ground", highlight: "what is chosen, like the tool you picked" };
  for (const key of ["primary", "secondary", "highlight"] as const) {
    const row = el("label", "settings-row settings-custom-row");
    row.dataset.colour = key;
    const name = el("span", undefined, CUSTOM_NAMES[key]);
    name.append(el("small", "settings-custom-hint", ` ${hint[key]}`));
    const picker = el("input", "settings-custom-picker");
    picker.type = "color";
    picker.value = toHex(parseHex(colours[key]) ?? parseHex(DEFAULT_CUSTOM[key])!);
    picker.setAttribute("aria-label", `${CUSTOM_NAMES[key]} colour`);
    const hex = el("input", "settings-custom-hex");
    hex.type = "text";
    hex.value = colours[key];
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.setAttribute("aria-label", `${CUSTOM_NAMES[key]} hex`);
    picker.addEventListener("input", () => {
      hex.value = picker.value;
      colours[key] = picker.value;
      send();
    });
    // A hex typed in applies once it is a whole colour; a half-typed one waits.
    hex.addEventListener("input", () => {
      const rgb = parseHex(hex.value);
      if (!rgb) return;
      colours[key] = toHex(rgb);
      picker.value = colours[key];
      send();
    });
    hex.addEventListener("change", () => {
      if (!parseHex(hex.value)) notes.textContent = `${CUSTOM_NAMES[key]} "${hex.value}" is not a hex colour (like #1a2b3c); the last good one is kept.`;
    });
    inputs.set(key, { picker, hex });
    row.append(name, picker, hex);
    block.append(row);
  }
  const reset = el("button", "settings-custom-reset", "Reset to standard");
  reset.type = "button";
  reset.addEventListener("click", () => {
    for (const [key, { picker, hex }] of inputs) {
      colours[key] = DEFAULT_CUSTOM[key];
      picker.value = DEFAULT_CUSTOM[key];
      hex.value = DEFAULT_CUSTOM[key];
    }
    send();
  });
  block.append(notes, reset);
  const show = () => (block.hidden = chosen() !== "custom");
  show();
  // The choice buttons are in `group`: follow them.
  new (group.ownerDocument.defaultView?.MutationObserver ?? MutationObserver)(show).observe(group, { attributes: true, subtree: true, attributeFilter: ["aria-checked"] });
  return block;
}
