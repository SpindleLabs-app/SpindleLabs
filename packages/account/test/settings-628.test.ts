// Issue #628 item 6 (lost-work hunt 2026-11-12, helper D's D5): settings changed in this browser while signed out
// (same person, same browser) were replaced by the account's older ones at the next sign-in. Red on main a4bd339: the fit
// came back as 0.2 and the units as mm. The app's own list of settings, copied from apps/fission/src/settings-sync.ts
// (that file needs a browser's document to load); the account is fake-settings.ts, answering as the migration does.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthClient } from "../src/auth.ts";
import { SETTINGS_LAST_KEY, SETTINGS_UNSENT_PREFIX, settingsApi, settingsSync, type SettingSpec } from "../src/settings.ts";
import { memoryStore } from "./fake-service.ts";
import { fakeSettingsAccount } from "./fake-settings.ts";

const SPECS: SettingSpec[] = [
  { key: "spindlelabs-settings", kind: "map" },
  { key: "spindlelabs.slice.presets", kind: "list-by-id" },
  { key: "spindlelabs.slice.preset", kind: "text" },
  { key: "spindlelabs.slice.nozzle", kind: "text" },
  { key: "spindlelabs.fits.standard", kind: "text" },
];
const FIT = "spindlelabs.fits.standard";
const PRESETS = "spindlelabs.slice.presets";
const UI = "spindlelabs-settings";
const NOZZLE = "spindlelabs.slice.nozzle";
const presets = (...list: object[]) => JSON.stringify({ version: 1, presets: list });
const petg = (layer: string, updatedAt: number) => ({ id: "p1", name: "PETG", printer: "bambu-p1s", settings: { nozzle: "0.4", layer }, updatedAt });

/** One browser (or `store`, shared); `as(user)` is that person's rounds, signOut as the Sign out button does it. */
function browser(acc: ReturnType<typeof fakeSettingsAccount>, store = memoryStore()) {
  const syncFor = (user: string) => settingsSync({ api: settingsApi(acc.as(user) as AuthClient), userId: user, store, specs: SPECS, lock: (fn) => fn() });
  return { store, syncFor, get: (k: string) => store.getItem(k) ?? undefined, json: (k: string) => JSON.parse(store.getItem(k) ?? "null") };
}

test("item 6: fit, a preset and the units changed while signed out are still here after the same person signs in again, and sent", async () => {
  const acc = fakeSettingsAccount();
  const b = browser(acc);
  b.store.setItem(FIT, JSON.stringify({ gap: 0.2, measuredAt: 1 }));
  b.store.setItem(PRESETS, presets(petg("0.2", 100)));
  b.store.setItem(UI, JSON.stringify({ unit: "mm", theme: "dark" }));
  assert.equal((await b.syncFor("ada").round()).kind, "done");
  b.syncFor("ada").signOut();
  // Still signed out: the test piece printed again and measured, the preset tuned, inches chosen.
  b.store.setItem(FIT, JSON.stringify({ gap: 0.35, measuredAt: 2 }));
  b.store.setItem(PRESETS, presets(petg("0.12", 200)));
  b.store.setItem(UI, JSON.stringify({ unit: "in", theme: "dark" }));
  const r = await b.syncFor("ada").round();
  assert.equal(r.kind === "done" && r.sent, true);
  assert.equal(b.json(FIT).gap, 0.35, "the fit measured while signed out");
  assert.equal(b.json(PRESETS).presets[0].settings.layer, "0.12");
  assert.equal(b.json(UI).unit, "in", "the units chosen while signed out");
  // And the account has them now (hand-worked: changed here only, so here's value is the merge).
  const kept = acc.rows.get("ada")!.settings;
  assert.equal(JSON.parse(kept[FIT]!).gap, 0.35);
  assert.equal(JSON.parse(kept[UI]!).unit, "in");
  assert.equal(b.get(SETTINGS_UNSENT_PREFIX + "ada"), undefined, "the note goes once merged");
});

test("item 6: still three ways: changed on another device and not here, the account's comes in; changed on both, here's wins", async () => {
  const acc = fakeSettingsAccount();
  const b = browser(acc);
  b.store.setItem(NOZZLE, "standard");
  b.store.setItem(UI, JSON.stringify({ unit: "mm", theme: "dark" }));
  await b.syncFor("ada").round();
  b.syncFor("ada").signOut();
  // Her phone, meanwhile: high-flow nozzle, and the light theme.
  const phone = browser(acc);
  await phone.syncFor("ada").round();
  phone.store.setItem(NOZZLE, "high-flow");
  phone.store.setItem(UI, JSON.stringify({ unit: "mm", theme: "light" }));
  await phone.syncFor("ada").round();
  // Here, signed out: inches (the theme untouched).
  b.store.setItem(UI, JSON.stringify({ unit: "in", theme: "dark" }));
  await b.syncFor("ada").round();
  // Hand-worked per entry against the note (nozzle standard; unit mm, theme dark): nozzle changed only on the phone ->
  // high-flow; unit changed only here -> in; theme changed only on the phone -> light.
  assert.equal(b.get(NOZZLE), "high-flow");
  assert.deepEqual(b.json(UI), { unit: "in", theme: "light" });
  assert.deepEqual(JSON.parse(acc.rows.get("ada")!.settings[UI]!), { unit: "in", theme: "light" });
});

test("item 6: after someone else synced settings here, a change made after Ada signed out isn't taken as hers", async () => {
  const acc = fakeSettingsAccount();
  const b = browser(acc);
  b.store.setItem(NOZZLE, "standard");
  await b.syncFor("ada").round();
  b.syncFor("ada").signOut();
  await b.syncFor("bo").round(); // Bo signs in here and out again
  b.syncFor("bo").signOut();
  assert.notEqual(b.get(SETTINGS_LAST_KEY), undefined);
  b.store.setItem(NOZZLE, "other"); // changed by whoever, signed out
  await b.syncFor("ada").round();
  // Hand-worked: not Ada's to send (not as she left it, and someone else synced since): the account's value wins.
  assert.equal(b.get(NOZZLE), "standard");
  assert.equal(acc.rows.get("ada")!.settings[NOZZLE], "standard");
});

test("item 6, can fail: with no note made at sign out (an older build signed out), the account's older value wins as before", async () => {
  const acc = fakeSettingsAccount();
  const b = browser(acc);
  b.store.setItem(NOZZLE, "standard");
  await b.syncFor("ada").round();
  b.syncFor("ada").signOut();
  b.store.removeItem(SETTINGS_UNSENT_PREFIX + "ada"); // as main's signOut left it when nothing was unsent
  b.store.setItem(NOZZLE, "high-flow");
  await b.syncFor("ada").round();
  assert.equal(b.get(NOZZLE), "standard");
});

test("item 6: signing out with every setting as agreed notes them, and a setting first set while signed out is sent", async () => {
  const acc = fakeSettingsAccount();
  const b = browser(acc);
  b.store.setItem(NOZZLE, "standard");
  await b.syncFor("ada").round();
  b.syncFor("ada").signOut();
  // Hand-worked note: the agreed nozzle and its value here; settings with no value on either side left out.
  assert.deepEqual(b.json(SETTINGS_UNSENT_PREFIX + "ada"), { [NOZZLE]: ["standard", "standard"] });
  b.store.setItem(FIT, JSON.stringify({ gap: 0.3 }));
  await b.syncFor("ada").round();
  assert.equal(JSON.parse(acc.rows.get("ada")!.settings[FIT]!).gap, 0.3);
});
