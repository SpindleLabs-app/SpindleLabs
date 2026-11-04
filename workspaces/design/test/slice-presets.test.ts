// Slicer printer presets (slice-presets.ts, Ben 2026-11-04): the stored shape read and written by hand-written JSON,
// each setting checked against the dialog's lists (each broken in turn), names (empty, the 40-character limit either
// side, a clash), a newer app's store left alone, blocked storage, and the dialog in a real DOM (happy-dom): save,
// pick, the "changed" mark, update, rename, delete, Escape, and a dialog built again on the same storage (a reload)
// opening on the preset picked last. The Chromium check is apps/fission/e2e/slice-presets.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRIP_KEY, NOZZLE_KEY, PRINT_DEFAULTS, FILE_DEFAULTS, presetSettingsOf, slicePrint, WARM_UP_KEY, type PrintChoices, type FileChoices } from "../src/slice-print.ts";
import { byName, NAME_MAX, nameProblem, PRESET_PICKED_KEY, PRESETS_KEY, PRESETS_MAX, readPresets, sameSettings, writePresets, type PresetSettings, type PrintPreset } from "../src/slice-presets.ts";

const DEFAULTS: PresetSettings = { ...PRINT_DEFAULTS, ...FILE_DEFAULTS };
const WORK: PresetSettings = { layerHeight: 0.16, walls: 3, infill: 40, supports: "tree", warmUp: false, betterGrip: true, format: "p1s", plate: "smooth", nozzle: "high-flow" };

/** A Storage-like map, optionally refusing writes. */
function memory(initial: Record<string, string> = {}, full = false) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

test("the stored shape, read from hand-written JSON: presets this app can use are shown, others kept untouched when written back", () => {
  // Written by hand: one preset for the P1S, one for a printer that doesn't exist yet, one with a quality the dialog
  // doesn't list (0.3 mm), one with no name, and a second preset reusing the first one's id.
  const home = { id: "a1", name: "  home P1S ", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 1000 };
  const p2s = { id: "b2", name: "work P2S", printer: "bambu-p2s", settings: DEFAULTS, updatedAt: 2000 };
  const odd = { id: "c3", name: "odd", printer: "bambu-p1s", settings: { ...DEFAULTS, layerHeight: 0.3 }, updatedAt: 3000 };
  const unnamed = { id: "d4", name: "   ", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 4000 };
  const twin = { id: "a1", name: "twin", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 5000 };
  const s = memory({ [PRESETS_KEY]: JSON.stringify({ version: 1, presets: [home, p2s, odd, unnamed, twin] }) });
  const store = readPresets(s, presetSettingsOf);
  // Only the first is usable; its name is trimmed. The other four are kept as they were, in order.
  assert.deepEqual(store.presets, [{ id: "a1", name: "home P1S", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 1000 }]);
  assert.deepEqual(store.kept, [p2s, odd, unnamed, twin]);
  assert.equal(store.writable, true);
  // Written back with a new preset: the version, ours first, then the kept ones, unchanged.
  const work: PrintPreset = { id: "e5", name: "work", printer: "bambu-p1s", settings: WORK, updatedAt: 6000 };
  assert.equal(writePresets(s, { ...store, presets: [...store.presets, work] }), true);
  assert.deepEqual(JSON.parse(s.m.get(PRESETS_KEY)!), { version: 1, presets: [{ ...home, name: "home P1S" }, work, p2s, odd, unnamed, twin] });
  // Nothing kept, text that is not JSON, or JSON that is not a store: no presets, and the store may be written.
  for (const v of [undefined, "{not json", "null", "[]", '{"version":1}', '{"version":1,"presets":{}}']) {
    const r = readPresets(memory(v === undefined ? {} : { [PRESETS_KEY]: v }), presetSettingsOf);
    assert.deepEqual(r, { presets: [], kept: [], writable: true }, String(v));
  }
  // A missing time reads as 0 (the oldest), so a sync would keep any other copy.
  const old = readPresets(memory({ [PRESETS_KEY]: JSON.stringify({ version: 1, presets: [{ ...home, updatedAt: "yesterday" }] }) }), presetSettingsOf);
  assert.equal(old.presets[0].updatedAt, 0);
});

test("a store written by a newer app is never overwritten; blocked or full storage says no", () => {
  const text = JSON.stringify({ version: 2, presets: [{ id: "x", name: "future", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 1 }] });
  const s = memory({ [PRESETS_KEY]: text });
  const store = readPresets(s, presetSettingsOf);
  assert.deepEqual(store, { presets: [], kept: [], writable: false });
  assert.equal(writePresets(s, { ...store, presets: [{ id: "y", name: "mine", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 2 }] }), false);
  assert.equal(s.m.get(PRESETS_KEY), text, "left exactly as it was");
  // The other side: version 1 is ours.
  assert.equal(readPresets(memory({ [PRESETS_KEY]: text.replace('"version":2', '"version":1') }), presetSettingsOf).writable, true);
  // Blocked: reading throws, so nothing shows and nothing is written; full: the write is refused.
  const blocked = { getItem: () => { throw new Error("SecurityError"); } };
  assert.deepEqual(readPresets(blocked, presetSettingsOf), { presets: [], kept: [], writable: false });
  assert.deepEqual(readPresets(null, presetSettingsOf), { presets: [], kept: [], writable: true });
  assert.equal(writePresets(memory({}, true), { presets: [], kept: [], writable: true }), false);
  assert.equal(writePresets(null, { presets: [], kept: [], writable: true }), false);
});

test("stored settings are checked choice by choice: each one broken in turn is refused", () => {
  assert.deepEqual(presetSettingsOf(WORK), WORK);
  assert.deepEqual(presetSettingsOf({ ...DEFAULTS, extra: 1 }), DEFAULTS, "a field this app doesn't know is left out");
  const breaks: [keyof PresetSettings, unknown][] = [
    ["layerHeight", 0.3],
    ["layerHeight", "0.2"],
    ["walls", 7],
    ["walls", 0],
    ["infill", 30],
    ["supports", "on"],
    ["warmUp", "true"],
    ["betterGrip", 1],
    ["format", "stl"],
    ["plate", "glass"],
    ["nozzle", "hardened"],
  ];
  for (const [k, v] of breaks) assert.equal(presetSettingsOf({ ...DEFAULTS, [k]: v }), null, `${k} = ${JSON.stringify(v)}`);
  for (const k of Object.keys(DEFAULTS)) {
    const missing: Record<string, unknown> = { ...DEFAULTS };
    delete missing[k];
    assert.equal(presetSettingsOf(missing), null, `${k} missing`);
  }
  for (const v of [null, undefined, "settings", 3, []]) assert.equal(presetSettingsOf(v), null, String(v));
});

test("names: one is needed, up to 40 characters (40 passes, 41 is refused), never another preset's, whatever its case", () => {
  const list: PrintPreset[] = [{ id: "a", name: "home P1S", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 0 }];
  assert.equal(nameProblem(list, "   "), "Give the preset a name, such as home P1S.");
  assert.equal(NAME_MAX, 40);
  assert.equal(nameProblem(list, "x".repeat(40)), null);
  assert.equal(nameProblem(list, ` ${"x".repeat(40)} `), null, "spaces round it are trimmed first");
  assert.equal(nameProblem(list, "x".repeat(41)), "Keep the name to 40 characters or fewer.");
  assert.equal(nameProblem(list, "HOME p1s"), "There is already a preset called home P1S: pick another name, or choose it and update it.");
  // Renaming a preset to its own name in another case is no clash.
  assert.equal(nameProblem(list, "Home P1S", "a"), null);
  // The list shows them by name, ignoring case.
  const names = byName([
    { ...list[0], id: "1", name: "work P2S" },
    { ...list[0], id: "2", name: "Home P1S" },
    { ...list[0], id: "3", name: "garage" },
  ]).map((p) => p.name);
  assert.deepEqual(names, ["garage", "Home P1S", "work P2S"]);
  // Settings the same choice by choice; one choice different is not.
  assert.equal(sameSettings(DEFAULTS, { ...DEFAULTS }), true);
  const other: PresetSettings = { ...WORK, format: "gcode" };
  for (const k of Object.keys(DEFAULTS) as (keyof PresetSettings)[]) assert.equal(sameSettings(DEFAULTS, { ...DEFAULTS, [k]: other[k] }), false, k);
});

const { Window } = await import("happy-dom");

/** The dialog on `window`'s storage (a second call on the same window is the page reloaded). */
function dialog(window: InstanceType<typeof Window>) {
  const doc = window.document as unknown as Document;
  doc.body.replaceChildren();
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const asked: { c: PrintChoices; f: FileChoices }[] = [];
  const d = slicePrint(slot, { slice: async (c, f) => (asked.push({ c, f }), { print: { layers: 1, filamentMm: 1, filamentG: 1, printTimeS: 1, unprintedVolume: 0 }, saved: true, name: "x" }), preview: async () => {} });
  const $ = <T extends HTMLElement>(i: string) => doc.getElementById(i) as T;
  const change = (e: HTMLElement) => e.dispatchEvent(new window.Event("change") as unknown as Event);
  const set = (i: string, v: string) => {
    $<HTMLSelectElement>(i).value = v;
    change($(i));
  };
  const tick = (i: string, on: boolean) => {
    $<HTMLInputElement>(i).checked = on;
    change($(i));
  };
  const key = (i: string, k: string) => {
    const e = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    $(i).dispatchEvent(e as unknown as Event);
    return e.defaultPrevented;
  };
  /** The dialog's settings as the selects and tick boxes show them. */
  const shown = () => ({
    format: $<HTMLSelectElement>("slice-print-format").value,
    plate: $<HTMLSelectElement>("slice-print-plate").value,
    nozzle: $<HTMLSelectElement>("slice-print-nozzle").value,
    layerHeight: $<HTMLSelectElement>("slice-print-quality").value,
    walls: $<HTMLSelectElement>("slice-print-walls").value,
    infill: $<HTMLSelectElement>("slice-print-infill").value,
    supports: $<HTMLSelectElement>("slice-print-supports").value,
    warmUp: $<HTMLInputElement>("slice-print-warm-up").checked,
    betterGrip: $<HTMLInputElement>("slice-print-grip").checked,
  });
  const list = () => [...$<HTMLSelectElement>("slice-presets-list").options].map((o) => o.textContent);
  const visible = () => ["pick", "editing", "naming", "asking"].filter((m) => !(doc.querySelector(`.slice-presets-${m}`) as HTMLElement).hidden);
  const status = () => $("slice-print-status").textContent;
  return { d, $, set, tick, key, shown, list, visible, status, asked, settle: () => new Promise((r) => setTimeout(r, 0)) };
}

/** Settings as the dialog shows them (its selects hold text). */
const asShown = (s: PresetSettings) => ({ format: s.format, plate: s.plate, nozzle: s.nozzle, layerHeight: String(s.layerHeight), walls: String(s.walls), infill: String(s.infill), supports: s.supports, warmUp: s.warmUp, betterGrip: s.betterGrip });

test("the dialog: save the settings as a preset, pick it, see it marked changed, update, rename and delete it; a reload opens on it", async () => {
  const window = new Window();
  window.localStorage.clear();
  const storage = window.localStorage as unknown as Storage;
  let t = dialog(window);
  t.d.ask();
  // No preset yet: the list says so, Edit is off, the bar shows the list.
  assert.deepEqual(t.list(), ["No preset"]);
  assert.equal(t.$<HTMLButtonElement>("slice-presets-edit").disabled, true);
  assert.deepEqual(t.visible(), ["pick"]);
  // Save as… with no name is refused in words, the name box marked; the dialog stays on naming.
  t.$("slice-presets-save-as").click();
  assert.deepEqual(t.visible(), ["naming"]);
  t.$("slice-presets-name-ok").click();
  assert.equal(t.status(), "Give the preset a name, such as home P1S.");
  assert.equal(t.$("slice-presets-name").getAttribute("aria-invalid"), "true");
  assert.deepEqual(t.visible(), ["naming"]);
  // Named "home P1S" (Enter saves): kept with the dialog's settings now, the P1S's defaults; picked and remembered.
  t.$<HTMLInputElement>("slice-presets-name").value = "home P1S";
  assert.equal(t.key("slice-presets-name", "Enter"), true);
  assert.equal(t.status(), "Saved the preset home P1S.");
  assert.deepEqual(t.list(), ["No preset", "home P1S"]);
  assert.deepEqual(t.visible(), ["pick"]);
  const stored = () => JSON.parse(storage.getItem(PRESETS_KEY)!) as { version: number; presets: PrintPreset[] };
  assert.equal(stored().version, 1);
  assert.equal(stored().presets.length, 1);
  const home = stored().presets[0];
  assert.deepEqual({ ...home, id: "", updatedAt: 0 }, { id: "", name: "home P1S", printer: "bambu-p1s", settings: DEFAULTS, updatedAt: 0 });
  assert.ok(home.id.length > 0 && home.updatedAt > 0);
  assert.equal(storage.getItem(PRESET_PICKED_KEY), home.id);
  assert.equal(t.$<HTMLSelectElement>("slice-presets-list").value, home.id);
  // Every setting changed to WORK's, and saved as "work P2S" (a name may not repeat another's, whatever its case).
  for (const [i, v] of [["slice-print-format", "p1s"], ["slice-print-plate", "smooth"], ["slice-print-nozzle", "high-flow"], ["slice-print-quality", "0.16"], ["slice-print-walls", "3"], ["slice-print-infill", "40"], ["slice-print-supports", "tree"]]) t.set(i, v);
  t.tick("slice-print-warm-up", false);
  t.tick("slice-print-grip", true);
  // Now the picked preset no longer matches: it says so, and Update turns on.
  assert.deepEqual(t.list(), ["No preset", "home P1S (changed)"]);
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "HOME p1s";
  t.$("slice-presets-name-ok").click();
  assert.match(t.status()!, /^There is already a preset called home P1S/);
  t.$<HTMLInputElement>("slice-presets-name").value = "work P2S";
  t.$("slice-presets-name-ok").click();
  assert.deepEqual(t.list(), ["No preset", "home P1S", "work P2S"]);
  const work = stored().presets.find((p) => p.name === "work P2S")!;
  assert.deepEqual(work.settings, WORK);
  // Picking home puts every one of its settings back, and the remembered nozzle, warm-up and grip follow.
  t.set("slice-presets-list", home.id);
  assert.deepEqual(t.shown(), asShown(DEFAULTS));
  assert.equal(storage.getItem(NOZZLE_KEY), "standard");
  assert.equal(storage.getItem(WARM_UP_KEY), "on");
  assert.equal(storage.getItem(GRIP_KEY), "off");
  assert.equal(storage.getItem(PRESET_PICKED_KEY), home.id);
  // And a slice uses them.
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked.at(-1), { c: PRINT_DEFAULTS, f: FILE_DEFAULTS });
  // Picking work puts its settings in, the plate and nozzle with it.
  t.set("slice-presets-list", work.id);
  assert.deepEqual(t.shown(), asShown(WORK));
  assert.equal(storage.getItem(NOZZLE_KEY), "high-flow");
  // Update: off while it matches; changed (infill 60), Edit > Update saves it over, and the mark goes.
  t.$("slice-presets-edit").click();
  assert.deepEqual(t.visible(), ["editing"]);
  assert.equal(t.$("slice-presets-editing-name").textContent, "work P2S");
  assert.equal(t.$<HTMLButtonElement>("slice-presets-update").disabled, true);
  t.$("slice-presets-back").click();
  t.set("slice-print-infill", "60");
  assert.deepEqual(t.list(), ["No preset", "home P1S", "work P2S (changed)"]);
  t.$("slice-presets-edit").click();
  assert.equal(t.$<HTMLButtonElement>("slice-presets-update").disabled, false);
  t.$("slice-presets-update").click();
  assert.equal(t.status(), "Updated the preset work P2S with these settings.");
  assert.deepEqual(stored().presets.find((p) => p.id === work.id)!.settings, { ...WORK, infill: 60 });
  assert.deepEqual(t.list(), ["No preset", "home P1S", "work P2S"]);
  // Rename: the box starts with its name; another preset's name is refused, Escape goes back without closing the dialog.
  t.$("slice-presets-edit").click();
  t.$("slice-presets-rename").click();
  assert.equal(t.$<HTMLInputElement>("slice-presets-name").value, "work P2S");
  assert.equal(t.$("slice-presets-name-ok").textContent, "Rename");
  t.$<HTMLInputElement>("slice-presets-name").value = "Home P1S";
  t.$("slice-presets-name-ok").click();
  assert.match(t.status()!, /^There is already a preset called home P1S/);
  assert.equal(t.key("slice-presets-name", "Escape"), true, "Escape is taken by the name box");
  assert.deepEqual(t.visible(), ["editing"]);
  assert.equal(t.d.open, true);
  t.$("slice-presets-rename").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "garage P1S";
  t.$("slice-presets-name-ok").click();
  assert.equal(t.status(), "Renamed the preset to garage P1S.");
  assert.deepEqual(t.list(), ["No preset", "garage P1S", "home P1S"]);
  const renamed = stored().presets.find((p) => p.id === work.id)!;
  assert.equal(renamed.name, "garage P1S", "same id, new name");
  assert.ok(renamed.updatedAt >= work.updatedAt);
  // A reload: a dialog built again on the same storage opens on the preset picked last, with its settings.
  t = dialog(window);
  t.d.ask();
  assert.equal(t.$<HTMLSelectElement>("slice-presets-list").value, work.id);
  assert.deepEqual(t.list(), ["No preset", "garage P1S", "home P1S"]);
  assert.deepEqual(t.shown(), asShown({ ...WORK, infill: 60 }));
  // Delete asks first; Keep keeps it; Delete deletes it, the settings stay, and no preset is picked.
  t.$("slice-presets-edit").click();
  t.$("slice-presets-delete").click();
  assert.deepEqual(t.visible(), ["asking"]);
  assert.equal(t.$("slice-presets-ask").textContent, "Delete garage P1S?");
  t.$("slice-presets-delete-no").click();
  assert.deepEqual(t.visible(), ["editing"]);
  assert.equal(stored().presets.length, 2);
  t.$("slice-presets-delete").click();
  t.$("slice-presets-delete-yes").click();
  assert.equal(t.status(), "Deleted the preset garage P1S. The settings below stay as they were.");
  assert.deepEqual(t.list(), ["No preset", "home P1S"]);
  assert.deepEqual(stored().presets.map((p) => p.name), ["home P1S"]);
  assert.equal(storage.getItem(PRESET_PICKED_KEY), null);
  assert.deepEqual(t.shown(), asShown({ ...WORK, infill: 60 }));
  // Reloaded again: no preset picked, so the dialog opens on the remembered nozzle, warm-up and grip as before presets.
  t = dialog(window);
  t.d.ask();
  assert.equal(t.$<HTMLSelectElement>("slice-presets-list").value, "");
  assert.equal(t.shown().nozzle, "high-flow");
  await window.happyDOM.close();
});

test("another tab's change shows when the dialog is opened again; a preset deleted there is no longer picked", async () => {
  const window = new Window();
  window.localStorage.clear();
  const storage = window.localStorage as unknown as Storage;
  const t = dialog(window);
  t.d.ask();
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "home P1S";
  t.$("slice-presets-name-ok").click();
  t.$("slice-print-close").click();
  // The other tab adds one and deletes ours.
  const other: PrintPreset = { id: "other", name: "work P2S", printer: "bambu-p1s", settings: WORK, updatedAt: 5 };
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [other] }));
  t.d.ask();
  assert.deepEqual(t.list(), ["No preset", "work P2S"]);
  assert.equal(t.$<HTMLSelectElement>("slice-presets-list").value, "");
  assert.equal(t.$<HTMLButtonElement>("slice-presets-edit").disabled, true);
  await window.happyDOM.close();
});

test("full storage: the preset isn't saved and the dialog says so; at the cap of 50, Save as… says to delete one first", async () => {
  const window = new Window();
  // This browser's storage refuses the presets (full), as a stand-in put where the dialog finds it.
  let full = true;
  const kept = new Map<string, string>();
  const stand: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (k) => kept.get(k) ?? null,
    setItem: (k, v) => {
      if (full && k === PRESETS_KEY) throw new Error("QuotaExceededError");
      kept.set(k, v);
    },
    removeItem: (k) => void kept.delete(k),
  };
  Object.defineProperty(window, "localStorage", { value: stand, configurable: true });
  const t = dialog(window);
  t.d.ask();
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "home P1S";
  t.$("slice-presets-name-ok").click();
  assert.equal(t.status(), "The preset couldn't be saved: this browser's storage is blocked or full.");
  assert.deepEqual(t.list(), ["No preset"]);
  assert.deepEqual(t.visible(), ["naming"], "the name stays, to try again");
  // Room again: the same Save works.
  full = false;
  t.$("slice-presets-name-ok").click();
  assert.deepEqual(t.list(), ["No preset", "home P1S"]);
  // 50 presets kept: the 51st is refused before a name is asked; with 49, it is asked.
  const many = (n: number) => JSON.stringify({ version: 1, presets: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `p${i}`, printer: "bambu-p1s", settings: DEFAULTS, updatedAt: i })) });
  assert.equal(PRESETS_MAX, 50);
  kept.set(PRESETS_KEY, many(50));
  t.$("slice-print-close").click();
  t.d.ask();
  t.$("slice-presets-save-as").click();
  assert.equal(t.status(), "There are 50 presets already: delete one to save another.");
  assert.deepEqual(t.visible(), ["pick"]);
  kept.set(PRESETS_KEY, many(49));
  t.$("slice-print-close").click();
  t.d.ask();
  t.$("slice-presets-save-as").click();
  assert.deepEqual(t.visible(), ["naming"]);
  await window.happyDOM.close();
});
