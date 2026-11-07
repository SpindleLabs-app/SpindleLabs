import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { SETTINGS_KEY, SettingsStore, type SettingsStorage } from "../src/settings.ts";
import { currentUnit, readUnitChoice, startUnits, UNIT_EVENT } from "../src/unit-choice.ts";

// U2c2: the Units setting. Stored in the same place as the theme; anything but "in" is millimetres.

const memory = (initial?: string): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test("nothing stored, damaged or unknown storage is millimetres; only \"in\" is inches", () => {
  for (const [stored, expected] of [
    [undefined, "mm"],
    ['{"unit":"mm"}', "mm"],
    ['{"unit":"in"}', "in"],
    ['{"unit":"cubits"}', "mm"],
    ['{"unit":7}', "mm"],
    ["{not json", "mm"],
  ] as const) assert.equal(readUnitChoice(new SettingsStore(memory(stored))), expected, String(stored));
});

test("starting wears the stored unit; choosing stores it, wears it and says so once", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  assert.equal(currentUnit(doc), "mm", "a page that never started units is in millimetres");
  const storage = memory('{"unit":"in"}');
  const heard: string[] = [];
  doc.addEventListener(UNIT_EVENT, (e) => heard.push((e as CustomEvent).detail));
  const choose = startUnits(doc, new SettingsStore(storage));
  assert.equal(currentUnit(doc), "in");
  choose("mm");
  assert.equal(currentUnit(doc), "mm");
  assert.deepEqual(heard, ["in", "mm"]);
  assert.equal(JSON.parse(storage.data.get(SETTINGS_KEY)!).unit, "mm");
});

test("Settings > General shows the Units choice with the stored one checked; picking the other reports it and checks it", async () => {
  const { fillSettings } = await import("../src/settings.ts");
  const window = new Window();
  const doc = window.document as unknown as Document;
  const dialog = doc.createElement("dialog") as HTMLDialogElement;
  doc.body.append(dialog);
  const picked: string[] = [];
  fillSettings(dialog, { version: "", onShortcuts: () => {}, unit: "mm", onUnit: (u) => picked.push(u) });
  const radio = (u: string) => dialog.querySelector<HTMLElement>(`[data-section=general] [data-unit=${u}]`)!;
  assert.equal(radio("mm").getAttribute("aria-checked"), "true");
  assert.equal(radio("in").getAttribute("aria-checked"), "false");
  radio("in").click();
  assert.deepEqual(picked, ["in"]);
  assert.equal(radio("in").getAttribute("aria-checked"), "true");
  assert.equal(radio("mm").getAttribute("aria-checked"), "false");
  // Without the parts, no Units row is drawn (nothing pretends).
  fillSettings(dialog, { version: "", onShortcuts: () => {} });
  assert.equal(dialog.querySelector("[data-unit]"), null);
});
