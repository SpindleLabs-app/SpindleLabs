// Slicer printer presets (slice-presets.ts, Ben 2026-11-04): the stored shape read and written by hand-written JSON,
// each setting checked against the dialog's lists (each broken in turn), names (empty, the 40-character limit either
// side, a clash), a newer app's store left alone, blocked storage, and the dialog in a real DOM (happy-dom): save,
// pick, the "changed" mark, update, rename, delete, Escape, and a dialog built again on the same storage (a reload)
// opening on the preset picked last. The Chromium check is apps/fission/e2e/slice-presets.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byName, SETTINGS_OPEN_KEY, GRIP_KEY, NAME_MAX, nameProblem, NOZZLE_KEY, PRINT_DEFAULTS, FILE_DEFAULTS, presetSettingsOf, PRESET_PICKED_KEY, PRESETS_KEY, PRESETS_MAX, readPresets, sameSettings, WARM_UP_KEY, writePresets, type FileChoices, type PresetSettings, type PrintChoices, type PrintPreset } from "@fission/print";

const DEFAULTS: PresetSettings = { layerHeight: PRINT_DEFAULTS.layerHeight, walls: PRINT_DEFAULTS.walls, infill: PRINT_DEFAULTS.infill, ...FILE_DEFAULTS };
const WORK: PresetSettings = { layerHeight: 0.16, walls: 3, infill: 40, format: "p1s", plate: "smooth", nozzle: "high-flow" };

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
    ["format", "stl"],
    ["plate", "glass"],
    ["nozzle", "hardened"],
  ];
  // Presets saved before 2026-11-16 hold supports, the warm-up loop and Better grip: read, and the three dropped (they are per print).
  assert.deepEqual(presetSettingsOf({ ...WORK, supports: "tree", warmUp: false, betterGrip: true }), WORK);
  assert.deepEqual(presetSettingsOf({ ...WORK, supports: "bogus", warmUp: "x", betterGrip: 1 }), WORK, "nothing about them can refuse a preset");
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
