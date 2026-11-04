// The Settings page (the skeleton): a dialog of sections, each a card. Most
// sections say what will live there; only what really works today has a
// control (the shortcuts list, the version). `SettingsStore` keeps choices in
// the browser alone, so Settings works offline with no account; storage that
// is off or full never throws, the settings just don't stick.

import { CUSTOM_NAMES, DEFAULT_CUSTOM, parseHex, toHex, type CustomColours } from "./custom-theme.ts";
import { THEME_CHOICES, type ThemeChoice } from "./theme-choice.ts";

export interface SettingsSection {
  id: string;
  title: string;
  /** What will live here, in plain words, shown while there is nothing to set. */
  coming: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", title: "General", coming: "Units will be set here." },
  { id: "design", title: "Design", coming: "Snapping and the grid will be set here." },
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
    try {
      const raw = storage?.getItem(SETTINGS_KEY);
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
  for (const s of SETTINGS_SECTIONS) {
    const card = el("section", "settings-card");
    card.dataset.section = s.id;
    card.append(el("h3", undefined, s.title));
    if (s.coming) card.append(el("p", "settings-empty", s.coming));
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
      const row = el("div", "settings-row");
      const label = el("span", undefined, "Keyboard shortcuts");
      const open = el("button", "settings-action", "Show");
      open.type = "button";
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
    }
    body.append(card);
  }
  dialog.replaceChildren(header, body);
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
  const reset = el("button", "settings-action", "Reset to standard");
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
