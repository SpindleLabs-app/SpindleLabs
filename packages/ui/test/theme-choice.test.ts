import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { SETTINGS_KEY, SettingsStore, type SettingsStorage } from "../src/settings.ts";
import { applyTheme, readThemeChoice, resolveTheme, startTheme, THEME_COLOURS, THEME_SETTING } from "../src/theme-choice.ts";

// U2a: the Theme setting (follow the device, light, dark), kept with the other
// settings, and the resolved theme the page wears. The same rule also runs in
// apps/fission/public/theme-init.js before the first paint; both are run here
// over one table.

const memory = (initial?: string): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const TABLE: [stored: string | undefined, deviceLight: boolean, expected: "light" | "dark"][] = [
  [undefined, false, "dark"], // nothing chosen: follow the device
  [undefined, true, "light"],
  ['{"theme":"device"}', true, "light"],
  ['{"theme":"device"}', false, "dark"],
  ['{"theme":"light"}', false, "light"], // a choice beats the device
  ['{"theme":"dark"}', true, "dark"],
  ['{"theme":"purple"}', true, "light"], // unknown: follow the device
  ['{"theme":7}', false, "dark"],
  ["{not json", true, "light"], // damaged storage: follow the device
  ["[1,2]", false, "dark"],
];

test("the theme a stored choice and the device give, worked out by hand", () => {
  for (const [stored, deviceLight, expected] of TABLE) {
    const choice = readThemeChoice(new SettingsStore(memory(stored)));
    assert.equal(resolveTheme(choice, deviceLight), expected, `${stored} / light device ${deviceLight}`);
  }
});

test("the script that runs before the first paint agrees with the app's rule on every row", () => {
  const script = readFileSync(fileURLToPath(new URL("../../../apps/fission/public/theme-init.js", import.meta.url)), "utf8");
  for (const [stored, deviceLight, expected] of TABLE) {
    const attrs = new Map<string, string>();
    const meta = { setAttribute: (k: string, v: string) => attrs.set(`meta.${k}`, v) };
    const window = {
      localStorage: { getItem: (k: string) => (k === SETTINGS_KEY ? (stored ?? null) : null) },
      matchMedia: () => ({ matches: deviceLight }),
    };
    const document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) }, querySelector: () => meta };
    runInNewContext(script, { window, document });
    assert.equal(attrs.get("data-theme"), expected, `${stored} / light device ${deviceLight}`);
    assert.equal(attrs.get("meta.content"), THEME_COLOURS[expected]);
  }
});

test("the script never throws when storage is blocked or there is no matchMedia", () => {
  const script = readFileSync(fileURLToPath(new URL("../../../apps/fission/public/theme-init.js", import.meta.url)), "utf8");
  let set = "";
  const document = { documentElement: { setAttribute: (_: string, v: string) => (set = v) }, querySelector: () => null };
  const window = { get localStorage(): never { throw new Error("blocked"); } };
  runInNewContext(script, { window, document });
  assert.equal(set, "dark");
});

test("choosing stores the choice and applies it; a change of the device is followed only on 'device'", () => {
  const storage = memory();
  const settings = new SettingsStore(storage);
  const root = { dataset: {} as Record<string, string> };
  const events: string[] = [];
  const doc = {
    documentElement: root,
    querySelector: () => null,
    dispatchEvent: (e: { detail: string }) => void events.push(e.detail),
  } as unknown as Document;
  (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class { detail: unknown; constructor(_: string, init: { detail: unknown }) { this.detail = init.detail; } };
  let listener: (() => void) | null = null;
  const media = { matches: false, addEventListener: (_: string, l: () => void) => (listener = l) } as unknown as MediaQueryList;
  const choose = startTheme(doc, settings, media);
  assert.equal(root.dataset.theme, "dark");
  (media as { matches: boolean }).matches = true;
  listener!();
  assert.equal(root.dataset.theme, "light"); // following the device
  choose("dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(JSON.parse(storage.data.get(SETTINGS_KEY)!)[THEME_SETTING], "dark");
  listener!(); // the device still says light, but dark was chosen
  assert.equal(root.dataset.theme, "dark");
  assert.deepEqual(events, ["dark", "light", "dark", "dark"]);
});

test("the check fails when a choice is lost: applyTheme sets exactly the theme it is given, and the browser bar's colour", () => {
  const set: string[] = [];
  const doc = { documentElement: { dataset: {} as Record<string, string> }, querySelector: () => ({ setAttribute: (_: string, v: string) => set.push(v) }), dispatchEvent: () => true } as unknown as Document;
  assert.equal(applyTheme(doc, "light"), "light");
  assert.equal(doc.documentElement.dataset.theme, "light");
  assert.deepEqual(set, ["#e6eaf1"]);
});
