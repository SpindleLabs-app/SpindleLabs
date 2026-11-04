// Slicer printer presets (Ben, 2026-11-04): Slice for printing's settings (the file, plate and nozzle, and the
// beginner's choices) saved under a name such as "home P1S" or "work P2S", picked again from a list at the top of the
// dialog, updated, renamed and deleted. Kept in this browser's storage only: offline, no account. The stored shape is
// ready to sync later (Pro's cloud sync): each preset has its own id and the time it last changed, and holds the
// printer it is for (only the P1S today; other printers come with the all-printers slicer). Presets this app can't
// read (another printer's, or a newer app's) are kept untouched when the list is written back.
// The bar sits in the dialog's heading line, so the dialog grows no taller (it must fit a 470 px laptop window);
// naming and deleting happen in the same line. Styles: src/styles/slice-presets.css.

import type { FileChoices, PrintChoices } from "./slice-print.ts";

/** Everything a preset holds: the beginner's choices and the file's. */
export type PresetSettings = PrintChoices & FileChoices;

/** The printers a preset can be for: the P1S only, until the all-printers slicer adds profiles. */
export type PrinterId = "bambu-p1s";
export const P1S_PRINTER: PrinterId = "bambu-p1s";

export interface PrintPreset {
  /** Never changes, even on a rename: what a sync would match presets by. */
  id: string;
  name: string;
  printer: PrinterId;
  settings: PresetSettings;
  /** When it was saved, updated or renamed (milliseconds since 1970): a sync keeps the newer. */
  updatedAt: number;
}

/** Where the presets are kept (this browser only), and the last one picked. */
export const PRESETS_KEY = "spindlelabs.slice.presets";
export const PRESET_PICKED_KEY = "spindlelabs.slice.preset";

/** The stored shape's version: a store with a higher one was written by a newer app, which this one never overwrites. */
export const PRESETS_VERSION = 1;

/** Names: up to this many characters, after trimming; at most this many presets. */
export const NAME_MAX = 40;
export const PRESETS_MAX = 50;

/** The presets this app reads, the entries it keeps without reading, and whether it may write the store back. */
export interface PresetStore {
  presets: PrintPreset[];
  kept: unknown[];
  writable: boolean;
}

/** Reads one preset, or null when it isn't one this app can use (`settingsOf` checks the settings against the dialog's lists). */
function presetOf(raw: unknown, settingsOf: (raw: unknown) => PresetSettings | null): PrintPreset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "" || typeof r.name !== "string" || r.printer !== P1S_PRINTER) return null;
  const name = r.name.trim();
  if (name === "" || name.length > NAME_MAX) return null;
  const settings = settingsOf(r.settings);
  if (settings === null) return null;
  const updatedAt = typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : 0;
  return { id: r.id, name, printer: P1S_PRINTER, settings, updatedAt };
}

/** The presets kept in `storage`; none when nothing is kept, the text is not ours, or storage is blocked. Never throws. */
export function readPresets(storage: Pick<Storage, "getItem"> | null, settingsOf: (raw: unknown) => PresetSettings | null): PresetStore {
  let text: string | null = null;
  try {
    text = storage?.getItem(PRESETS_KEY) ?? null;
  } catch {
    return { presets: [], kept: [], writable: false };
  }
  if (text === null) return { presets: [], kept: [], writable: true };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { presets: [], kept: [], writable: true }; // not ours: nothing to keep
  }
  const d = data as { version?: unknown; presets?: unknown } | null;
  if (typeof d !== "object" || d === null || !Array.isArray(d.presets)) return { presets: [], kept: [], writable: true };
  if (typeof d.version !== "number" || d.version > PRESETS_VERSION) return { presets: [], kept: [], writable: false };
  const presets: PrintPreset[] = [];
  const kept: unknown[] = [];
  const ids = new Set<string>();
  for (const raw of d.presets) {
    const p = presetOf(raw, settingsOf);
    // A second preset with an id already read is kept, not shown: two can't answer to one id.
    if (p && !ids.has(p.id)) {
      presets.push(p);
      ids.add(p.id);
    } else kept.push(raw);
  }
  return { presets, kept, writable: true };
}

/** Writes the store back; false when storage is blocked or full, or the store must not be written. */
export function writePresets(storage: Pick<Storage, "setItem"> | null, store: PresetStore): boolean {
  if (!store.writable || storage === null) return false;
  try {
    storage.setItem(PRESETS_KEY, JSON.stringify({ version: PRESETS_VERSION, presets: [...store.presets, ...store.kept] }));
    return true;
  } catch {
    return false;
  }
}

/** Why `name` can't name a preset (empty, too long, or already used by another), or null when it can. */
export function nameProblem(presets: readonly PrintPreset[], name: string, self?: string): string | null {
  const n = name.trim();
  if (n === "") return "Give the preset a name, such as home P1S.";
  if (n.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters or fewer.`;
  const clash = presets.find((p) => p.id !== self && p.name.toLowerCase() === n.toLowerCase());
  return clash ? `There is already a preset called ${clash.name}: pick another name, or choose it and update it.` : null;
}

/** A new id: random where the browser can make one, else the time and a random number. */
export function newPresetId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Whether two sets of settings are the same, choice by choice. */
export function sameSettings(a: PresetSettings, b: PresetSettings): boolean {
  const keys = Object.keys(a) as (keyof PresetSettings)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** The list as the dropdown shows it: by name, ignoring case. */
export const byName = (presets: readonly PrintPreset[]): PrintPreset[] => [...presets].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));

export interface PresetBarEvents {
  /** The dialog's settings now. */
  current(): PresetSettings;
  /** Puts `settings` into the dialog's choices. */
  apply(settings: PresetSettings): void;
  /** Says something in the dialog's status line (bad: shown as a warning); "" clears it. */
  say(text: string, bad: boolean): void;
  /** Checks stored settings against the dialog's lists. */
  settingsOf(raw: unknown): PresetSettings | null;
  /** The clock and the ids (tests pass their own). */
  now?(): number;
  newId?(): string;
}

export interface PresetBar {
  /** The bar's element, for the dialog's heading line. */
  readonly element: HTMLElement;
  /** Reads the list again (another tab may have changed it) and marks the preset picked as changed or not. */
  refresh(): void;
  /** Marks the preset picked as changed or not: call after any choice changes. */
  changed(): void;
}

/**
 * The bar: the Preset list (No preset, then each by name; the one picked says "changed" once a choice no longer
 * matches it), Save as… (a new preset from the settings now) and Edit (Update with these settings, Rename, Delete,
 * Back). Naming and confirming a delete take the bar's place in the same line; Escape in them goes back, never closes
 * the dialog. Picking a preset puts its settings in and is remembered, so the dialog opens on it next time.
 */
export function presetBar(document: Document, storage: Storage | null, events: PresetBarEvents): PresetBar {
  const now = events.now ?? Date.now;
  const newId = events.newId ?? newPresetId;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = "") => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (text) e.textContent = text;
    return e;
  };
  const button = (id: string, text: string, title: string) => {
    const b = el("button", id, text);
    b.type = "button";
    b.title = title;
    return b;
  };
  const bar = el("div", "slice-presets");
  bar.className = "slice-presets";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Presets");

  // Picking.
  const pick = el("div", "");
  pick.className = "slice-presets-pick";
  const label = el("label", "", "Preset");
  label.className = "slice-presets-label";
  const select = el("select", "slice-presets-list");
  select.classList.add("dark-select"); // styles/dark-select.css (packages/ui)
  select.title = "Your saved settings, such as one per printer or plate. Picking one puts its settings in below.";
  label.append(select);
  const saveAs = button("slice-presets-save-as", "Save as…", "Saves the settings below as a new preset, under a name you give it (kept in this browser).");
  const edit = button("slice-presets-edit", "Edit", "Update, rename or delete the preset picked.");
  pick.append(label, saveAs, edit);

  // Editing the preset picked.
  const editing = el("div", "");
  editing.className = "slice-presets-editing";
  const editName = el("span", "slice-presets-editing-name");
  const update = button("slice-presets-update", "Update", "Saves the settings below into this preset, replacing what it held.");
  const rename = button("slice-presets-rename", "Rename", "Gives this preset a new name.");
  const remove = button("slice-presets-delete", "Delete", "Deletes this preset (asks first).");
  const back = button("slice-presets-back", "Back", "Back to the preset list.");
  editing.append(editName, update, rename, remove, back);

  // Naming (a new preset, or a rename).
  const naming = el("div", "");
  naming.className = "slice-presets-naming";
  const nameBox = el("input", "slice-presets-name");
  nameBox.type = "text";
  nameBox.maxLength = NAME_MAX;
  nameBox.placeholder = "Name, such as home P1S";
  nameBox.setAttribute("aria-label", "Preset name");
  nameBox.autocomplete = "off";
  const nameOk = button("slice-presets-name-ok", "Save", "Saves the preset under this name.");
  const nameCancel = button("slice-presets-name-cancel", "Cancel", "Leaves the presets as they were.");
  naming.append(nameBox, nameOk, nameCancel);

  // Confirming a delete.
  const asking = el("div", "");
  asking.className = "slice-presets-asking";
  const askWords = el("span", "slice-presets-ask");
  const yes = button("slice-presets-delete-yes", "Delete", "Deletes the preset. The settings below stay as they are.");
  const no = button("slice-presets-delete-no", "Keep", "Keeps the preset.");
  asking.append(askWords, yes, no);

  bar.append(pick, editing, naming, asking);

  let store = readPresets(storage, events.settingsOf);
  let picked: string | null = null; // the id of the preset picked
  let renaming: string | null = null; // the id being renamed, or null when naming a new preset
  const pickedPreset = () => store.presets.find((p) => p.id === picked) ?? null;

  const show = (mode: "pick" | "editing" | "naming" | "asking") => {
    pick.hidden = mode !== "pick";
    editing.hidden = mode !== "editing";
    naming.hidden = mode !== "naming";
    asking.hidden = mode !== "asking";
  };
  const remember = () => {
    try {
      if (picked === null) storage?.removeItem(PRESET_PICKED_KEY);
      else storage?.setItem(PRESET_PICKED_KEY, picked);
    } catch {
      // Storage blocked: the pick still holds for this dialog.
    }
  };
  /** The list's options, the picked one marked when the settings no longer match it. */
  const fill = () => {
    const p = pickedPreset();
    if (p === null) picked = null;
    const differs = p !== null && !sameSettings(p.settings, events.current());
    const none = el("option", "", "No preset");
    none.value = "";
    const options = [none];
    for (const q of byName(store.presets)) {
      const o = el("option", "", q.id === picked && differs ? `${q.name} (changed)` : q.name);
      o.value = q.id;
      options.push(o);
    }
    select.replaceChildren(...options);
    select.value = picked ?? "";
    edit.disabled = picked === null;
    editName.textContent = p?.name ?? "";
    update.disabled = !differs;
    update.title = differs ? "Saves the settings below into this preset, replacing what it held." : "The settings below already match this preset.";
  };
  /** Writes the list; says so when it can't, and reads it back so what shows is what is kept. */
  const commit = (next: PrintPreset[]): boolean => {
    const ok = writePresets(storage, { ...store, presets: next });
    if (!ok) {
      events.say(store.writable ? "The preset couldn't be saved: this browser's storage is blocked or full." : "Presets were saved by a newer version of SpindleLabs, so this one leaves them alone: reload the page.", true);
      return false;
    }
    store = readPresets(storage, events.settingsOf);
    return true;
  };

  select.addEventListener("change", () => {
    picked = select.value === "" ? null : select.value;
    remember();
    const p = pickedPreset();
    if (p) events.apply(p.settings);
    fill();
  });
  edit.addEventListener("click", () => {
    if (pickedPreset() === null) return;
    show("editing");
    update.disabled ? rename.focus() : update.focus();
  });
  back.addEventListener("click", () => {
    show("pick");
    select.focus();
  });
  const startNaming = (id: string | null) => {
    renaming = id;
    nameBox.value = id === null ? "" : (pickedPreset()?.name ?? "");
    nameOk.textContent = id === null ? "Save" : "Rename";
    nameBox.setAttribute("aria-invalid", "false");
    show("naming");
    nameBox.focus();
    nameBox.select();
  };
  saveAs.addEventListener("click", () => {
    if (store.presets.length >= PRESETS_MAX) {
      events.say(`There are ${PRESETS_MAX} presets already: delete one to save another.`, true);
      return;
    }
    startNaming(null);
  });
  rename.addEventListener("click", () => startNaming(picked));
  const finishNaming = () => {
    const name = nameBox.value.trim();
    const problem = nameProblem(store.presets, name, renaming ?? undefined);
    nameBox.setAttribute("aria-invalid", String(problem !== null));
    if (problem) {
      events.say(problem, true);
      nameBox.focus();
      return;
    }
    if (renaming === null) {
      const p: PrintPreset = { id: newId(), name, printer: P1S_PRINTER, settings: events.current(), updatedAt: now() };
      if (!commit([...store.presets, p])) return;
      picked = p.id;
      remember();
      events.say(`Saved the preset ${name}.`, false);
    } else {
      const id = renaming;
      if (!commit(store.presets.map((p) => (p.id === id ? { ...p, name, updatedAt: now() } : p)))) return;
      events.say(`Renamed the preset to ${name}.`, false);
    }
    fill();
    show("pick");
    select.focus();
  };
  nameOk.addEventListener("click", finishNaming);
  const cancelNaming = () => {
    events.say("", false);
    show(renaming === null ? "pick" : "editing");
    (renaming === null ? saveAs : rename).focus();
  };
  nameCancel.addEventListener("click", cancelNaming);
  nameBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishNaming();
    } else if (e.key === "Escape") {
      e.preventDefault(); // Escape leaves the name box, not the dialog
      cancelNaming();
    }
  });
  update.addEventListener("click", () => {
    const p = pickedPreset();
    if (p === null) return;
    if (!commit(store.presets.map((q) => (q.id === p.id ? { ...q, settings: events.current(), updatedAt: now() } : q)))) return;
    events.say(`Updated the preset ${p.name} with these settings.`, false);
    fill();
    show("pick");
    select.focus();
  });
  remove.addEventListener("click", () => {
    const p = pickedPreset();
    if (p === null) return;
    askWords.textContent = `Delete ${p.name}?`;
    show("asking");
    no.focus();
  });
  yes.addEventListener("click", () => {
    const p = pickedPreset();
    if (p === null || !commit(store.presets.filter((q) => q.id !== p.id))) return;
    picked = null;
    remember();
    events.say(`Deleted the preset ${p.name}. The settings below stay as they were.`, false);
    fill();
    show("pick");
    select.focus();
  });
  no.addEventListener("click", () => {
    show("editing");
    remove.focus();
  });
  for (const part of [editing, asking]) {
    part.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Escape") return;
      e.preventDefault();
      show("pick");
      select.focus();
    });
  }

  // The dialog opens on the preset picked last, if it is still kept.
  try {
    picked = storage?.getItem(PRESET_PICKED_KEY) ?? null;
  } catch {
    picked = null;
  }
  const first = pickedPreset();
  if (first) events.apply(first.settings);
  fill();
  show("pick");

  return {
    element: bar,
    refresh() {
      store = readPresets(storage, events.settingsOf);
      if (pickedPreset() === null) show("pick");
      fill();
    },
    changed: fill,
  };
}
