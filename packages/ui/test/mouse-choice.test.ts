import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { MOUSE_PRESETS } from "@fission/core";
import { SETTINGS_KEY, SettingsStore, type SettingsStorage } from "../src/settings.ts";
import { currentMouse, readMouseChoice, startMouse } from "../src/mouse-choice.ts";

// U2d: the mouse preset setting. Stored with the other settings; anything but "fusion" is SpindleLabs's own.

const memory = (initial?: string): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test("nothing stored, damaged or unknown storage is SpindleLabs's own; only \"fusion\" is Fusion-style", () => {
  for (const [stored, expected] of [
    [undefined, "spindle"],
    ['{"mouse":"fusion"}', "fusion"],
    ['{"mouse":"spindle"}', "spindle"],
    ['{"mouse":"blender"}', "spindle"],
    ['{"mouse":1}', "spindle"],
    ["{not json", "spindle"],
  ] as const) assert.equal(readMouseChoice(new SettingsStore(memory(stored))), expected, String(stored));
});

test("starting wears the stored preset; choosing stores it, wears it and says so once", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  assert.equal(currentMouse(doc), "spindle", "a page that never started the mouse preset has SpindleLabs's own");
  const storage = memory('{"mouse":"fusion"}');
  const heard: string[] = [];
  doc.addEventListener("mousechange", (e) => heard.push((e as CustomEvent).detail));
  const choose = startMouse(doc, new SettingsStore(storage));
  assert.equal(currentMouse(doc), "fusion");
  assert.equal(doc.documentElement.dataset.mouse, "fusion");
  choose("spindle");
  assert.equal(currentMouse(doc), "spindle");
  assert.deepEqual(heard, ["fusion", "spindle"]);
  assert.equal(JSON.parse(storage.data.get(SETTINGS_KEY)!).mouse, "spindle");
});

test("Settings > General shows the Mouse choice and the chosen preset's table; picking the other swaps the table and reports it", async () => {
  const { fillSettings } = await import("../src/settings.ts");
  const window = new Window();
  const doc = window.document as unknown as Document;
  const dialog = doc.createElement("dialog") as HTMLDialogElement;
  doc.body.append(dialog);
  const picked: string[] = [];
  fillSettings(dialog, { version: "", onShortcuts: () => {}, mouse: "spindle", onMouse: (p) => picked.push(p) });
  const radio = (id: string) => dialog.querySelector<HTMLElement>(`[data-section=general] [data-mouse=${id}]`)!;
  const rows = () => [...dialog.querySelectorAll(".settings-mouse-table tr")].map((tr) => [tr.querySelector("th")!.textContent, tr.querySelector("td")!.textContent]);
  assert.equal(radio("spindle").getAttribute("aria-checked"), "true");
  assert.equal(radio("fusion").getAttribute("aria-checked"), "false");
  assert.deepEqual(rows(), MOUSE_PRESETS[0].rows.map((r) => [r.gesture, r.does]));
  radio("fusion").click();
  assert.deepEqual(picked, ["fusion"]);
  assert.equal(radio("fusion").getAttribute("aria-checked"), "true");
  assert.deepEqual(rows(), MOUSE_PRESETS[1].rows.map((r) => [r.gesture, r.does]));
  assert.equal(dialog.querySelector(".settings-mouse-summary")!.textContent, MOUSE_PRESETS[1].summary);
  // Without the parts, no Mouse row is drawn (nothing pretends).
  fillSettings(dialog, { version: "", onShortcuts: () => {} });
  assert.equal(dialog.querySelector("[data-mouse]"), null);
});
