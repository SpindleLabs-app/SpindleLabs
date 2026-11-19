// The printer presets' bar on the Slice page (SP5b2c: moved from Design's slice-presets.test.ts, which tested the same bar in the
// dialog): save the settings as a preset, pick it, the "changed" mark, update, rename, delete, a page built again on the same
// storage (a reload), another tab's changes, full storage and a store a newer app wrote. The pure store tests are in packages/print.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry } from "@fission/core";
import { printPanel } from "../src/index.ts";
import { FORMAT_OPTIONS, INFILL_OPTIONS, NOZZLE_OPTIONS, PLATE_OPTIONS, QUALITY_OPTIONS, SUPPORT_OPTIONS, WALL_OPTIONS } from "@fission/print";
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
const { Window } = await import("happy-dom");

/** The page's print panel on `window`'s storage (a second call on the same window is the page reloaded). */
function dialog(window: InstanceType<typeof Window>) {
  const doc = window.document as unknown as Document;
  doc.body.replaceChildren();
  const asked: { c: PrintChoices; f: FileChoices }[] = [];
  const build = () => {
    doc.body.replaceChildren();
    const made = printPanel(doc, { kernel: { call: async () => ({}), stopSlicing: () => undefined } as never, registry: new RepresentationRegistry(), objects: () => [], storage: window.localStorage as unknown as Storage });
    doc.body.append(made.element);
    return made;
  };
  let panel = build();
  // Asking again is the page shown again: built anew from what the storage holds now.
  let asks = 0;
  const d = { ask: () => void (asks++ > 0 && (panel = build())) };
  const $ = <T extends HTMLElement>(i: string) => doc.getElementById(i) as T;
  const change = (e: HTMLElement) => e.dispatchEvent(new window.Event("change") as unknown as Event);
  // The page's choice boxes hold the option's place as their value: the tables turn a setting into its place and back.
  const table: Record<string, readonly (string | number)[]> = {
    "slice-page-quality": QUALITY_OPTIONS.map((o) => o.value),
    "slice-page-walls": WALL_OPTIONS,
    "slice-page-infill": INFILL_OPTIONS,
    "slice-page-supports": SUPPORT_OPTIONS.map((o) => o.value),
    "slice-page-format": FORMAT_OPTIONS.map((o) => o.value),
    "slice-page-plate": PLATE_OPTIONS.map((o) => o.value),
    "slice-page-nozzle": NOZZLE_OPTIONS.map((o) => o.value),
  };
  const read = (i: string) => String(table[i][Number($<HTMLSelectElement>(i).value)]);
  const set = (i: string, v: string) => {
    const at = table[i]?.findIndex((x) => String(x) === v);
    if (at !== undefined) assert.ok(at >= 0, `${v} is not a choice of ${i}`);
    $<HTMLSelectElement>(i).value = at === undefined ? v : String(at);
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
  /** The panel's settings as the selects and tick boxes show them. */
  const shown = () => ({
    format: read("slice-page-format"),
    plate: read("slice-page-plate"),
    nozzle: read("slice-page-nozzle"),
    layerHeight: read("slice-page-quality"),
    walls: read("slice-page-walls"),
    infill: read("slice-page-infill"),
  });
  /** The per-print choices: not part of any preset. */
  const perPrint = () => ({
    supports: read("slice-page-supports"),
    warmUp: $<HTMLInputElement>("slice-page-warm-up").checked,
    betterGrip: $<HTMLInputElement>("slice-page-grip").checked,
  });
  const list = () => [...$<HTMLSelectElement>("slice-presets-list").options].map((o) => o.textContent);
  const visible = () => ["pick", "editing", "naming", "asking"].filter((m) => !(doc.querySelector(`.slice-presets-${m}`) as HTMLElement).hidden);
  const status = () => $("slice-page-status").textContent;
  return { d, $, set, tick, key, shown, perPrint, list, visible, status, asked, get panel() { return panel; }, settle: () => new Promise((r) => setTimeout(r, 0)) };
}

/** Settings as the dialog shows them (its selects hold text). */
const asShown = (s: PresetSettings) => ({ format: s.format, plate: s.plate, nozzle: s.nozzle, layerHeight: String(s.layerHeight), walls: String(s.walls), infill: String(s.infill) });

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
  for (const [i, v] of [["slice-page-format", "p1s"], ["slice-page-plate", "smooth"], ["slice-page-nozzle", "high-flow"], ["slice-page-quality", "0.16"], ["slice-page-walls", "3"], ["slice-page-infill", "40"], ["slice-page-supports", "tree"]]) t.set(i, v);
  t.tick("slice-page-warm-up", false);
  t.tick("slice-page-grip", true);
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
  // Picking home puts every one of its settings back, and the remembered nozzle follows. Supports, warm-up loop and
  // Better grip are per print: they stay as they were set (tree, off, on) and are no part of the preset.
  t.set("slice-presets-list", home.id);
  assert.deepEqual(t.shown(), asShown(DEFAULTS));
  assert.deepEqual(t.perPrint(), { supports: "tree", warmUp: false, betterGrip: true });
  assert.equal(storage.getItem(NOZZLE_KEY), "standard");
  assert.equal(storage.getItem(WARM_UP_KEY), "off");
  assert.equal(storage.getItem(GRIP_KEY), "on");
  assert.deepEqual(Object.keys(stored().presets[0].settings).sort(), ["format", "infill", "layerHeight", "nozzle", "plate", "walls"], "a preset holds the printer's settings only");
  assert.equal(storage.getItem(PRESET_PICKED_KEY), home.id);
  // And a slice uses them.
  assert.deepEqual(t.panel.choices(), { ...PRINT_DEFAULTS, supports: "tree", warmUp: false, betterGrip: true });
  assert.deepEqual(t.panel.file(), FILE_DEFAULTS);
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
  t.set("slice-page-infill", "60");
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
  t.d.ask();
  t.$("slice-presets-save-as").click();
  assert.equal(t.status(), "There are 50 presets already: delete one to save another.");
  assert.deepEqual(t.visible(), ["pick"]);
  kept.set(PRESETS_KEY, many(49));
  t.d.ask();
  t.$("slice-presets-save-as").click();
  assert.deepEqual(t.visible(), ["naming"]);
  await window.happyDOM.close();
});

test("a dialog left open while another tab changes the presets: each edit here changes only its own preset (app hunt 2026-11-04)", async () => {
  const window = new Window();
  window.localStorage.clear();
  const storage = window.localStorage as unknown as Storage;
  const stored = () => JSON.parse(storage.getItem(PRESETS_KEY)!) as { version: number; presets: PrintPreset[] };
  const names = () => stored().presets.map((p) => p.name).sort();
  const t = dialog(window);
  t.d.ask(); // the list is read now, and stays open
  // Another tab saves "work P2S"; this dialog then saves "home P1S". Both are kept: the list here never knew of
  // "work P2S", so writing it back as it was read would have wiped it.
  const other: PrintPreset = { id: "other", name: "work P2S", printer: "bambu-p1s", settings: WORK, updatedAt: 5 };
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [other] }));
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "home P1S";
  t.$("slice-presets-name-ok").click();
  assert.equal(t.status(), "Saved the preset home P1S.");
  assert.deepEqual(names(), ["home P1S", "work P2S"]);
  assert.deepEqual(t.list(), ["No preset", "home P1S", "work P2S"], "the list shows what is kept");
  const home = stored().presets.find((p) => p.name === "home P1S")!;
  // A name the other tab took meanwhile is refused here too, whatever its case.
  const garage: PrintPreset = { id: "garage", name: "garage", printer: "bambu-p1s", settings: WORK, updatedAt: 6 };
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [...stored().presets, garage] }));
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "Garage";
  t.$("slice-presets-name-ok").click();
  assert.match(t.status()!, /^There is already a preset called garage/);
  assert.deepEqual(names(), ["garage", "home P1S", "work P2S"]);
  t.$("slice-presets-name-cancel").click();
  // The other tab deletes "work P2S" and "garage"; this dialog renames "home P1S": the deleted ones stay deleted.
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [home] }));
  t.$("slice-presets-edit").click();
  t.$("slice-presets-rename").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "home";
  t.$("slice-presets-name-ok").click();
  assert.equal(t.status(), "Renamed the preset to home.");
  assert.deepEqual(names(), ["home"]);
  // The other tab adds "work P2S" again; Update here keeps it, changing only "home"'s settings.
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [...stored().presets, other] }));
  t.set("slice-page-infill", "40");
  t.$("slice-presets-edit").click();
  t.$("slice-presets-update").click();
  assert.equal(t.status(), "Updated the preset home with these settings.");
  assert.deepEqual(names(), ["home", "work P2S"]);
  assert.equal(stored().presets.find((p) => p.id === home.id)!.settings.infill, 40);
  assert.deepEqual(stored().presets.find((p) => p.id === "other"), other, "the other tab's preset, untouched");
  // The other tab deletes "home"; Update here then neither brings it back nor touches "work P2S", and says why.
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [other] }));
  t.set("slice-page-infill", "60");
  t.$("slice-presets-edit").click();
  t.$("slice-presets-update").click();
  assert.equal(t.status(), "That preset was deleted in another tab, so it can't be changed here.");
  assert.deepEqual(stored().presets, [other]);
  assert.deepEqual(t.list(), ["No preset", "work P2S"]);
  assert.deepEqual(t.visible(), ["pick"]);
  // Deleting a preset this dialog shows but another tab changed keeps the other tab's other presets.
  t.set("slice-presets-list", "other");
  const third: PrintPreset = { id: "third", name: "third", printer: "bambu-p1s", settings: WORK, updatedAt: 7 };
  storage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [other, third] }));
  t.$("slice-presets-edit").click();
  t.$("slice-presets-delete").click();
  t.$("slice-presets-delete-yes").click();
  assert.deepEqual(stored().presets, [third]);
  await window.happyDOM.close();
});

test("a store a newer app wrote while this dialog is open is never overwritten, by any edit (app hunt 2026-11-04)", async () => {
  const window = new Window();
  window.localStorage.clear();
  const storage = window.localStorage as unknown as Storage;
  const t = dialog(window);
  t.d.ask();
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "home P1S";
  t.$("slice-presets-name-ok").click();
  // A newer SpindleLabs in another tab writes a version 2 store.
  const newer = JSON.stringify({ version: 2, presets: [{ id: "n", name: "from a newer app", printer: "bambu-p1s", settings: {}, updatedAt: 9 }] });
  storage.setItem(PRESETS_KEY, newer);
  const refused = "Presets were saved by a newer version of SpindleLabs, so this one leaves them alone: reload the page.";
  // Save as…
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "work P2S";
  t.$("slice-presets-name-ok").click();
  assert.equal(t.status(), refused);
  assert.equal(storage.getItem(PRESETS_KEY), newer);
  t.$("slice-presets-name-cancel").click();
  // Update, Rename and Delete of the preset this dialog still has picked: each refused in the same words.
  for (const step of [
    () => (t.set("slice-page-infill", "40"), t.$("slice-presets-edit").click(), t.$("slice-presets-update").click()),
    () => (t.$("slice-presets-edit").click(), t.$("slice-presets-rename").click(), (t.$<HTMLInputElement>("slice-presets-name").value = "x"), t.$("slice-presets-name-ok").click()),
    () => (t.$("slice-presets-edit").click(), t.$("slice-presets-delete").click(), t.$("slice-presets-delete-yes").click()),
  ]) {
    step();
    assert.equal(t.status(), refused);
    assert.equal(storage.getItem(PRESETS_KEY), newer);
  }
  await window.happyDOM.close();
});

test("per-print choices (Ben, 2026-11-16): Supports, Warm-up loop and Better grip never mark a preset changed and are never saved in one", () => {
  const window = new Window();
  window.localStorage.clear();
  const storage = window.localStorage as unknown as Storage;
  const t = dialog(window);
  t.d.ask();
  t.$("slice-presets-save-as").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "home P1S";
  t.$("slice-presets-name-ok").click();
  assert.deepEqual(t.list(), ["No preset", "home P1S"]);
  const before = storage.getItem(PRESETS_KEY);
  // Each of the three changed: still no "(changed)", Update stays off, the store is untouched.
  t.set("slice-page-supports", "tree");
  t.tick("slice-page-warm-up", false);
  t.tick("slice-page-grip", true);
  assert.deepEqual(t.list(), ["No preset", "home P1S"]);
  t.$("slice-presets-edit").click();
  assert.equal(t.$<HTMLButtonElement>("slice-presets-update").disabled, true);
  assert.equal(storage.getItem(PRESETS_KEY), before);
  // A printer setting still marks it (the check can fail): quality changed.
  t.$("slice-presets-back").click();
  t.set("slice-page-quality", "0.28");
  assert.deepEqual(t.list(), ["No preset", "home P1S (changed)"]);
});

test("presets saved before the change (holding supports, warm-up loop and Better grip) still show; the three are ignored, the rest kept", () => {
  const old = { id: "o1", name: "old P1S", printer: "bambu-p1s", settings: { ...WORK, supports: "tree", warmUp: false, betterGrip: true }, updatedAt: 7 };
  const window = new Window();
  window.localStorage.clear();
  window.localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [old] }));
  window.localStorage.setItem(PRESET_PICKED_KEY, "o1");
  const t = dialog(window);
  t.d.ask();
  // It shows, picked, matching (not "changed") although the dialog's supports differ from the old preset's; the printer's settings went in.
  assert.deepEqual(t.list(), ["No preset", "old P1S"]);
  assert.deepEqual(t.shown(), asShown(WORK));
  assert.deepEqual(t.perPrint(), { supports: "off", warmUp: true, betterGrip: false }, "the old preset's three are not put in");
  // Renamed: written back without the three, everything else as it was.
  t.$("slice-presets-edit").click();
  t.$("slice-presets-rename").click();
  t.$<HTMLInputElement>("slice-presets-name").value = "kept";
  t.$("slice-presets-name-ok").click();
  const now = JSON.parse(window.localStorage.getItem(PRESETS_KEY)!);
  assert.equal(now.version, 1);
  assert.deepEqual(now.presets.map((p: PrintPreset) => ({ ...p, updatedAt: 0 })), [{ id: "o1", name: "kept", printer: "bambu-p1s", settings: WORK, updatedAt: 0 }]);
});

test("the printer settings fold into one section: closed by default with a line of words, the choice remembered across a reload", () => {
  const window = new Window();
  window.localStorage.clear();
  let t = dialog(window);
  t.d.ask();
  const section = () => window.document.querySelector(".slice-page-settings") as unknown as HTMLDetailsElement;
  assert.equal(section().open, false);
  // By hand: file "Bambu Lab P1S (.gcode.3mf)" loses its bracket, plate and nozzle labels as listed, quality's bracket gives "0.2 mm layers".
  const words = () => window.document.querySelector(".slice-page-settings-words")!.textContent;
  assert.equal(words(), "Bambu Lab P1S · Textured PEI plate · 0.4 mm Standard · 0.2 mm layers · 2 walls · 15 % infill");
  t.set("slice-page-walls", "1");
  t.set("slice-page-infill", "100");
  assert.equal(words(), "Bambu Lab P1S · Textured PEI plate · 0.4 mm Standard · 0.2 mm layers · 1 wall · 100 % infill");
  t.set("slice-page-format", "gcode");
  assert.equal(words(), "Plain G-code · 0.2 mm layers · 1 wall · 100 % infill");
  // Supports, warm-up loop and Better grip are outside the section; every printer setting is inside.
  for (const id of ["slice-page-supports", "slice-page-warm-up", "slice-page-grip"]) assert.equal(section().contains(t.$(id)), false, id);
  for (const id of ["slice-page-format", "slice-page-plate", "slice-page-nozzle", "slice-page-quality", "slice-page-walls", "slice-page-infill", "slice-page-fits-open"]) assert.equal(section().contains(t.$(id)), true, id);
  // Opened: remembered, and the next dialog on the same storage opens open.
  section().open = true;
  section().dispatchEvent(new window.Event("toggle") as unknown as Event);
  assert.equal(window.localStorage.getItem(SETTINGS_OPEN_KEY), "open");
  t = dialog(window);
  t.d.ask();
  assert.equal(section().open, true);
});
