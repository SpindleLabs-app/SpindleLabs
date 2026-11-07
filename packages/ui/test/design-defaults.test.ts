import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { lengthLimitRefusal, MAX_LENGTH_MM, MIN_LENGTH_MM } from "@fission/core";
import { SETTINGS_KEY, SettingsStore, fillSettings, type SettingsStorage } from "../src/settings.ts";
import { currentDesignDefaults, DEFAULT_GRID_MM, readGridSize, startDesignDefaults } from "../src/design-defaults.ts";

// U2b: the grid size and Snap to grid a new sketch starts with.

const memory = (initial?: string): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const page = () => new Window().document as unknown as Document;

test("nothing stored, damaged or out of range is the built-in 10 mm, snap off", () => {
  for (const stored of [undefined, "{not json", '{"gridSize":"big"}', '{"gridSize":0}', '{"gridSize":-5}', '{"gridSize":1e9}', '{"gridSize":0.0001}']) {
    assert.equal(readGridSize(new SettingsStore(memory(stored))), DEFAULT_GRID_MM, String(stored));
  }
  assert.deepEqual(currentDesignDefaults(page()), { grid: 10, snap: false }, "a page that never started wears the built-in ones");
});

test("the limits are the kernel's 1 µm to 1 km: 0.9× and 1.1× of each", () => {
  // Hand-worked: 0.9 × 0.001 = 0.0009 mm is under 1 µm (refused); 1.1 × 0.001 = 0.0011 mm is over it (taken); 1.1 × 1e6 = 1.1e6 mm is over 1 km (refused); 0.9 × 1e6 = 9e5 mm is under (taken).
  assert.notEqual(lengthLimitRefusal(0.9 * MIN_LENGTH_MM), null);
  assert.equal(lengthLimitRefusal(1.1 * MIN_LENGTH_MM), null);
  assert.equal(lengthLimitRefusal(0.9 * MAX_LENGTH_MM), null);
  assert.notEqual(lengthLimitRefusal(1.1 * MAX_LENGTH_MM), null);
  assert.equal(lengthLimitRefusal(MIN_LENGTH_MM), null);
  assert.equal(lengthLimitRefusal(MAX_LENGTH_MM), null);
  assert.equal(lengthLimitRefusal(0), "A length must be more than 0 mm.");
  assert.notEqual(lengthLimitRefusal(NaN), null);
});

test("choosing stores and wears the size; a refused size keeps the last good one and says why", () => {
  const doc = page();
  const storage = memory('{"gridSize":2.5,"gridSnap":true}');
  const choose = startDesignDefaults(doc, new SettingsStore(storage));
  assert.deepEqual(currentDesignDefaults(doc), { grid: 2.5, snap: true });
  assert.equal(choose.setGrid(5), null);
  assert.equal(currentDesignDefaults(doc).grid, 5);
  for (const bad of [0, -1, 0.0009, 1.1e6, NaN, Infinity]) {
    const why = choose.setGrid(bad);
    assert.match(why ?? "", /^The grid size /, String(bad));
    assert.equal(currentDesignDefaults(doc).grid, 5, `${bad} keeps 5`);
    assert.equal(JSON.parse(storage.data.get(SETTINGS_KEY)!).gridSize, 5);
  }
  choose.setSnap(false);
  assert.deepEqual(currentDesignDefaults(doc), { grid: 5, snap: false });
  assert.equal(JSON.parse(storage.data.get(SETTINGS_KEY)!).gridSnap, false);
});

test("Settings > Design: the Grid box shows the size in the unit, refuses in words, and follows a unit change", () => {
  const doc = page();
  const dialog = doc.createElement("dialog") as HTMLDialogElement;
  doc.body.append(dialog);
  const taken: number[] = [];
  const snaps: boolean[] = [];
  let ai = 0;
  fillSettings(dialog, {
    version: "",
    onShortcuts: () => {},
    unit: "mm",
    onUnit: () => {},
    grid: 25.4,
    onGrid: (mm) => (taken.push(mm), lengthLimitRefusal(mm)),
    snap: false,
    onSnap: (on) => snaps.push(on),
    onAiSettings: () => ai++,
  });
  const box = dialog.querySelector<HTMLInputElement>("[data-section=design] .grid-size")!;
  const note = dialog.querySelector<HTMLElement>("[data-section=design] .grid-note")!;
  const type = (text: string) => {
    box.value = text;
    box.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).Event("change"));
  };
  assert.equal(box.value, "25.4");
  type("0.5 in");
  assert.deepEqual(taken, [12.7], "0.5 in is 12.7 mm");
  assert.equal(box.value, "12.7", "the box still reads in mm");
  type("0");
  assert.match(note.textContent!, /must be more than 0 mm\. The grid stays at 12.7 mm\./);
  assert.equal(box.value, "12.7", "the last good size goes back");
  type("ten");
  assert.match(note.textContent!, /Type the grid size as a number/);
  assert.equal(taken.length, 2, "text that is no length never reaches the setting");
  // Choosing inches redraws the box: 12.7 mm is 0.5 in.
  dialog.querySelector<HTMLElement>("[data-unit=in]")!.click();
  assert.equal(box.value, "0.5");
  assert.equal(dialog.querySelector(".grid-unit")!.textContent, " in");
  type("0.00001 in");
  assert.match(note.textContent!, /must be at least 0\.0000394 in/, "the refusal is said in inches");
  fillSettings(dialog, { version: "", onShortcuts: () => {}, grid: 12.7, onGrid: () => null });
  assert.equal(dialog.querySelector(".grid-snap"), null, "no snap row without its handler");
  assert.equal(dialog.querySelector(".settings-ai"), null);
});

test("Settings > Design: Snap to grid and the AI row report their changes", () => {
  const doc = page();
  const dialog = doc.createElement("dialog") as HTMLDialogElement;
  doc.body.append(dialog);
  const snaps: boolean[] = [];
  let ai = 0;
  fillSettings(dialog, { version: "", onShortcuts: () => {}, grid: 10, onGrid: () => null, snap: false, onSnap: (on) => snaps.push(on), onAiSettings: () => ai++ });
  const snap = dialog.querySelector<HTMLInputElement>(".grid-snap input")!;
  snap.checked = true;
  snap.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).Event("change"));
  assert.deepEqual(snaps, [true]);
  dialog.querySelector<HTMLElement>(".settings-ai button")!.click();
  assert.equal(ai, 1);
});
