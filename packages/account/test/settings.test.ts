import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthClient } from "../src/auth.ts";
import { accountSettingsFrom, mergeSettings, saveSettingsAnswerFrom, SETTINGS_BASE_PREFIX, SETTINGS_LIMITS, SETTINGS_TRIES, type SettingSpec, settingsApi, settingsSync } from "../src/settings.ts";
import { memoryStore } from "./fake-service.ts";
import { fakeSettingsAccount, type FakeSettingsAccount } from "./fake-settings.ts";

const UI = "spindlelabs-settings";
const NOZZLE = "spindlelabs.slice.nozzle";
const GRIP = "spindlelabs.slice.better-grip";
const PRESETS = "spindlelabs.slice.presets";
const SPECS: SettingSpec[] = [
  { key: UI, kind: "map" },
  { key: NOZZLE, kind: "text" },
  { key: GRIP, kind: "text" },
  { key: PRESETS, kind: "list-by-id" },
];
const presets = (...list: object[]) => JSON.stringify({ version: 1, presets: list });
const preset = (id: string, name: string, updatedAt: number) => ({ id, name, printer: "bambu-p1s", settings: { nozzle: "0.4" }, updatedAt });

/** One browser of person `user`: its storage and a sync. `first`: never synced here before. */
function browser(acc: FakeSettingsAccount, user = "ada", first = false) {
  const store = memoryStore();
  if (!first) store.setItem(SETTINGS_BASE_PREFIX + user, JSON.stringify({ revision: acc.rows.get(user)?.revision ?? 0, settings: acc.rows.get(user)?.settings ?? {} }));
  let held = Promise.resolve();
  const sync = settingsSync({
    api: settingsApi(acc.as(user) as AuthClient),
    userId: user,
    store,
    specs: SPECS,
    lock: (fn) => {
      const run = held.then(fn);
      held = run.then(() => undefined, () => undefined);
      return run;
    },
  });
  return { store, sync, get: (k: string) => store.getItem(k), set: (k: string, v: string) => store.setItem(k, v) };
}

// The merge, worked by hand

test("hand-worked: each side's change is taken, and a value changed on both sides goes to this browser", () => {
  // base: nozzle 0.4, grip off.  here: nozzle 0.6 (changed here), grip off.  account: nozzle 0.4, grip on (changed there).
  // nozzle: account still has base's 0.4, so here's change 0.6 wins. grip: here still has base's "off", so the account's "on" wins.
  const base = { [NOZZLE]: "0.4", [GRIP]: "off" };
  assert.deepEqual(mergeSettings(SPECS, base, { [NOZZLE]: "0.6", [GRIP]: "off" }, { [NOZZLE]: "0.4", [GRIP]: "on" }, "local"), { [NOZZLE]: "0.6", [GRIP]: "on" });
  // Both changed nozzle from 0.4: here 0.6, account 0.2. Normally this browser's 0.6; the first time here, the account's 0.2.
  assert.equal(mergeSettings(SPECS, base, { [NOZZLE]: "0.6" }, { [NOZZLE]: "0.2" }, "local")[NOZZLE], "0.6");
  assert.equal(mergeSettings(SPECS, base, { [NOZZLE]: "0.6" }, { [NOZZLE]: "0.2" }, "remote")[NOZZLE], "0.2");
});

test("hand-worked: a deletion on one side is taken, but never over a change on the other", () => {
  // grip deleted here, unchanged there (still base's "on"): deleted. nozzle deleted there, changed here (0.4 -> 0.8): kept as 0.8.
  const base = { [NOZZLE]: "0.4", [GRIP]: "on" };
  assert.deepEqual(mergeSettings(SPECS, base, { [NOZZLE]: "0.8" }, { [GRIP]: "on" }, "local"), { [NOZZLE]: "0.8" });
  // Deleted here, changed there: the account's change is kept.
  assert.deepEqual(mergeSettings(SPECS, base, {}, { [NOZZLE]: "0.6", [GRIP]: "on" }, "local"), { [NOZZLE]: "0.6" });
});

test("hand-worked: the Settings page's own settings merge entry by entry", () => {
  // base {theme dark, unit mm}. Here the theme went light; there the unit went to inches. Both changed the whole text,
  // but different entries: theme light (only here changed it) and unit in (only there changed it).
  const base = { [UI]: JSON.stringify({ theme: "dark", unit: "mm" }) };
  const out = mergeSettings(SPECS, base, { [UI]: JSON.stringify({ theme: "light", unit: "mm" }) }, { [UI]: JSON.stringify({ theme: "dark", unit: "in" }) }, "local");
  assert.deepEqual(JSON.parse(out[UI]!), { theme: "light", unit: "in" });
  // Both changed the theme: here's (light) wins, there's new entry (custom-primary) is added, here's deletion of unit is taken.
  const both = mergeSettings(SPECS, base, { [UI]: JSON.stringify({ theme: "light" }) }, { [UI]: JSON.stringify({ theme: "custom", unit: "mm", "custom-primary": "#ff0000" }) }, "local");
  assert.deepEqual(JSON.parse(both[UI]!), { theme: "light", "custom-primary": "#ff0000" });
  // Damaged text on one side: no entries to merge, so the whole text follows the plain rule (this browser's).
  assert.equal(mergeSettings(SPECS, base, { [UI]: "{not json" }, { [UI]: JSON.stringify({ theme: "x" }) }, "local")[UI], "{not json");
});

test("hand-worked: presets merge preset by preset, the later change winning", () => {
  const a = preset("a", "home P1S", 100);
  const b = preset("b", "work P1S", 100);
  const base = { [PRESETS]: presets(a, b) };
  // Here: "a" renamed at 300 and "c" added. There: "a" renamed at 200, "b" deleted, "d" added.
  // a: changed both sides, 300 > 200, so here's. b: deleted there, unchanged here: deleted. c, d: each new on one side: both kept.
  const here = presets({ ...a, name: "home (here)", updatedAt: 300 }, b, preset("c", "c", 300));
  const there = presets({ ...a, name: "home (there)", updatedAt: 200 }, preset("d", "d", 250));
  const out = JSON.parse(mergeSettings(SPECS, base, { [PRESETS]: here }, { [PRESETS]: there }, "local")[PRESETS]!);
  assert.deepEqual(out.presets.map((p: { id: string; name: string }) => `${p.id}:${p.name}`), ["a:home (here)", "c:c", "d:d"]);
  assert.equal(out.version, 1);
  // The later one wins whichever side it is on, even when this browser is preferred.
  const later = JSON.parse(mergeSettings(SPECS, base, { [PRESETS]: presets({ ...a, name: "old", updatedAt: 150 }, b) }, { [PRESETS]: presets({ ...a, name: "new", updatedAt: 400 }, b) }, "local")[PRESETS]!);
  assert.equal(later.presets[0].name, "new");
  // Deleted here, renamed there: kept as renamed (a change beats a deletion).
  const kept = JSON.parse(mergeSettings(SPECS, base, { [PRESETS]: presets(b) }, { [PRESETS]: presets({ ...a, name: "renamed", updatedAt: 500 }, b) }, "local")[PRESETS]!);
  assert.deepEqual(kept.presets.map((p: { name: string }) => p.name), ["work P1S", "renamed"]);
});

test("presets of another version are never mixed: the plain rule picks one side whole", () => {
  const out = mergeSettings(SPECS, {}, { [PRESETS]: presets(preset("a", "a", 1)) }, { [PRESETS]: JSON.stringify({ version: 2, presets: [{ id: "z" }] }) }, "local");
  assert.equal(out[PRESETS], presets(preset("a", "a", 1)));
});

test("presets with no id, or a second with the same id, are kept once each and never matched", () => {
  const loose = { name: "no id" };
  const out = JSON.parse(mergeSettings(SPECS, {}, { [PRESETS]: JSON.stringify({ version: 1, presets: [preset("a", "a", 1), loose] }) }, { [PRESETS]: JSON.stringify({ version: 1, presets: [loose, preset("a", "a", 2), preset("a", "dup", 9)] }) }, "local")[PRESETS]!);
  assert.deepEqual(out.presets, [preset("a", "a", 2), loose, preset("a", "dup", 9)]);
});

test("settings this app doesn't know (a newer app's) are kept as the account has them", () => {
  assert.deepEqual(mergeSettings(SPECS, {}, { [NOZZLE]: "0.4" }, { "spindlelabs.future": "x" }, "local"), { "spindlelabs.future": "x", [NOZZLE]: "0.4" });
});

// Rounds between devices

test("two devices: each one's change reaches the other, and both end the same", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  const phone = browser(acc);
  laptop.set(NOZZLE, "0.6");
  phone.set(GRIP, "on");
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [], sent: true });
  assert.deepEqual(await phone.sync.round(), { kind: "done", changed: [NOZZLE], sent: true });
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [GRIP], sent: false });
  for (const b of [laptop, phone]) assert.deepEqual([b.get(NOZZLE), b.get(GRIP)], ["0.6", "on"]);
  assert.deepEqual(acc.rows.get("ada"), { settings: { [NOZZLE]: "0.6", [GRIP]: "on" }, revision: 2 });
  // Nothing changed anywhere: a round only reads.
  acc.calls.length = 0;
  assert.deepEqual(await phone.sync.round(), { kind: "done", changed: [], sent: false });
  assert.deepEqual(acc.calls, ["POST rpc/my_settings"]);
  assert.equal(phone.sync.changedHere(), false);
  phone.set(NOZZLE, "0.2");
  assert.equal(phone.sync.changedHere(), true);
});

test("a new device takes the account's settings, and adds its own the account lacks", async () => {
  const acc = fakeSettingsAccount();
  acc.put("ada", { [NOZZLE]: "0.6", [UI]: JSON.stringify({ theme: "light" }) });
  const fresh = browser(acc, "ada", true);
  fresh.set(NOZZLE, "0.4");
  fresh.set(GRIP, "on");
  fresh.set(UI, JSON.stringify({ theme: "dark", unit: "in" }));
  assert.equal(fresh.sync.changedHere(), true, "never synced here: there is something to do");
  const r = await fresh.sync.round();
  assert.deepEqual(r, { kind: "done", changed: [UI, NOZZLE], sent: true });
  assert.equal(fresh.get(NOZZLE), "0.6", "the account's wins on a new device");
  assert.equal(fresh.get(GRIP), "on", "the account had none: this browser's goes up");
  assert.deepEqual(JSON.parse(fresh.get(UI)!), { theme: "light", unit: "in" });
  assert.deepEqual(acc.rows.get("ada")!.settings[GRIP], "on");
});

test("after the first round, this browser wins a setting changed on both sides", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  const phone = browser(acc);
  laptop.set(NOZZLE, "0.4");
  await laptop.sync.round();
  await phone.sync.round();
  laptop.set(NOZZLE, "0.6");
  phone.set(NOZZLE, "0.8");
  await laptop.sync.round();
  await phone.sync.round();
  assert.equal(phone.get(NOZZLE), "0.8");
  await laptop.sync.round();
  assert.equal(laptop.get(NOZZLE), "0.8", "the later round's device wins, and both end the same");
});

test("a save that crossed another device's is merged again from the newer copy", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  laptop.set(NOZZLE, "0.6");
  // Between this browser's read and its save, another device saves grip on.
  acc.beforeSave = () => acc.put("ada", { [GRIP]: "on" });
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [GRIP], sent: true });
  assert.deepEqual(acc.rows.get("ada"), { settings: { [NOZZLE]: "0.6", [GRIP]: "on" }, revision: 2 });
  assert.deepEqual(acc.calls, ["POST rpc/my_settings", "POST rpc/save_settings", "POST rpc/my_settings", "POST rpc/save_settings"]);
});

test("an account that keeps changing under every try gives up the round without writing anything here", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  laptop.set(NOZZLE, "0.6");
  let n = 0;
  const cross = () => {
    acc.put("ada", { [GRIP]: `v${++n}` });
    acc.beforeSave = n < SETTINGS_TRIES ? cross : undefined;
  };
  acc.beforeSave = cross;
  assert.deepEqual(await laptop.sync.round(), { kind: "failed", reason: "unavailable" });
  assert.equal(laptop.get(GRIP), null);
  assert.equal(n, SETTINGS_TRIES);
  // Next round, with no more crossing, it goes.
  assert.equal((await laptop.sync.round()).kind, "done");
  assert.equal(laptop.get(GRIP), `v${SETTINGS_TRIES}`);
});

test("a setting changed here while a round runs is not overwritten, and goes next round", async () => {
  const acc = fakeSettingsAccount();
  acc.put("ada", { [NOZZLE]: "0.2" });
  const laptop = browser(acc, "ada", true);
  // The person picks 0.8 while the account is being asked.
  acc.beforeSave = undefined;
  const api = settingsApi(acc.as("ada") as AuthClient);
  const sync = settingsSync({
    api: { read: async () => { const r = await api.read(); laptop.set(NOZZLE, "0.8"); return r; }, save: api.save },
    userId: "ada",
    store: laptop.store,
    specs: SPECS,
    lock: (fn) => fn(),
  });
  assert.deepEqual(await sync.round(), { kind: "done", changed: [], sent: false });
  assert.equal(laptop.get(NOZZLE), "0.8");
  assert.equal(laptop.sync.changedHere(), true);
  await laptop.sync.round();
  assert.equal(acc.rows.get("ada")!.settings[NOZZLE], "0.8");
});

// Limits, off, failures

test("the size limit at 0.9x is kept and at 1.1x stays in this browser, not sent again until it changes", async () => {
  const name = "spindlelabs.slice.presets"; // 25 characters
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  // 0.9 x 262144 = 235929.6: a value of 235904 characters + the 25 of its name = 235929: kept.
  laptop.set(name, "x".repeat(235904));
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [], sent: true });
  // 1.1 x 262144 = 288358.4: a value of 288334 + 25 = 288359: refused, and this browser keeps it.
  laptop.set(name, "y".repeat(288334));
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [], sent: false, tooBig: true });
  assert.equal(laptop.get(name)!.length, 288334);
  assert.equal(acc.rows.get("ada")!.settings[name]!.length, 235904, "the account keeps what it had");
  assert.equal(laptop.sync.changedHere(), false, "refused and unchanged: nothing to send");
  acc.calls.length = 0;
  assert.equal((await laptop.sync.round()).kind, "done");
  assert.deepEqual(acc.calls, ["POST rpc/my_settings"], "not sent again");
  laptop.set(name, "z".repeat(1000));
  assert.equal(laptop.sync.changedHere(), true);
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [], sent: true });
  assert.equal(SETTINGS_LIMITS.maxBytes, 262144);
});

test("off stops every round and forgets what was agreed, so turning it on again starts afresh", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  laptop.set(NOZZLE, "0.6");
  await laptop.sync.round();
  assert.deepEqual(await settingsApi(acc.as("ada") as AuthClient).setKeeping(false), { kind: "ok", value: false });
  laptop.set(NOZZLE, "0.8");
  acc.calls.length = 0;
  assert.deepEqual(await laptop.sync.round(), { kind: "off" });
  assert.deepEqual(acc.calls, ["POST rpc/my_settings"], "nothing sent");
  assert.equal(laptop.get(SETTINGS_BASE_PREFIX + "ada"), null);
  assert.equal(laptop.get(NOZZLE), "0.8", "this browser's own settings stay");
  acc.keep.set("ada", true);
  assert.deepEqual(await laptop.sync.round(), { kind: "done", changed: [], sent: true });
  assert.equal(acc.rows.get("ada")!.settings[NOZZLE], "0.8");
});

test("a save answered off (turned off on another device meanwhile) sends nothing more", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  laptop.set(NOZZLE, "0.6");
  acc.beforeSave = () => acc.keep.set("ada", false);
  assert.deepEqual(await laptop.sync.round(), { kind: "off" });
  assert.equal(laptop.get(SETTINGS_BASE_PREFIX + "ada"), null);
});

test("offline, an account service without settings yet, or a strange answer: nothing changes here", async () => {
  const acc = fakeSettingsAccount();
  acc.put("ada", { [NOZZLE]: "0.2" });
  const laptop = browser(acc, "ada", true);
  laptop.set(NOZZLE, "0.4");
  for (const mode of ["down", "missing"] as const) {
    acc.mode = mode;
    assert.deepEqual(await laptop.sync.round(), { kind: "failed", reason: mode === "down" ? "offline" : "rejected" });
  }
  acc.mode = "up";
  for (const body of [null, {}, { keep: true, revision: -1, settings: {} }, { keep: true, revision: 1, settings: { a: 1 } }, { keep: "yes", revision: 1, settings: {} }, []]) {
    acc.nextBody = body;
    assert.deepEqual(await laptop.sync.round(), { kind: "failed", reason: "malformed" }, JSON.stringify(body));
  }
  assert.equal(laptop.get(NOZZLE), "0.4");
  assert.equal(laptop.get(SETTINGS_BASE_PREFIX + "ada"), null);
});

test("answers are checked for the shape the database promises", () => {
  assert.deepEqual(accountSettingsFrom({ keep: true, revision: 0, settings: {} }), { keep: true, revision: 0, settings: {} });
  assert.equal(accountSettingsFrom({ keep: true, revision: 1.5, settings: {} }), null);
  assert.deepEqual(saveSettingsAnswerFrom({ status: "saved", revision: 2 }), { status: "saved", revision: 2 });
  assert.equal(saveSettingsAnswerFrom({ status: "saved", revision: 0 }), null, "a save makes revision 1 at least");
  assert.deepEqual(saveSettingsAnswerFrom({ status: "changed", revision: 0 }), { status: "changed", revision: 0 });
  assert.deepEqual(saveSettingsAnswerFrom({ status: "too-big" }), { status: "too-big" });
  assert.equal(saveSettingsAnswerFrom({ status: "saved" }), null);
  assert.equal(saveSettingsAnswerFrom({ status: "great" }), null);
});

test("an answer saying invalid is reported, never taken as kept", async () => {
  const acc = fakeSettingsAccount();
  const laptop = browser(acc);
  laptop.set(NOZZLE, "0.6");
  acc.beforeSave = () => {
    acc.nextBody = { status: "invalid" };
  };
  assert.deepEqual(await laptop.sync.round(), { kind: "failed", reason: "malformed" });
  assert.equal(laptop.sync.changedHere(), true, "still to send");
});

test("storage that is blocked fails the round and changes nothing", async () => {
  const acc = fakeSettingsAccount();
  const no = () => {
    throw new Error("blocked");
  };
  const sync = settingsSync({ api: settingsApi(acc.as("ada") as AuthClient), userId: "ada", store: { getItem: no, setItem: no, removeItem: no }, specs: SPECS, lock: (fn) => fn() });
  assert.deepEqual(await sync.round(), { kind: "failed", reason: "storage" });
  assert.equal(sync.changedHere(), true, "no base readable: treated as never synced, and the round then fails safely");
  assert.equal(acc.rows.size, 0);
});

test("a damaged base here is treated as a first round, which never loses a setting", async () => {
  const acc = fakeSettingsAccount();
  acc.put("ada", { [GRIP]: "on" });
  const laptop = browser(acc);
  laptop.set(SETTINGS_BASE_PREFIX + "ada", "{damaged");
  laptop.set(NOZZLE, "0.6");
  await laptop.sync.round();
  assert.deepEqual(acc.rows.get("ada")!.settings, { [GRIP]: "on", [NOZZLE]: "0.6" });
  assert.equal(laptop.get(GRIP), "on");
});

// Seeded random devices against a simple model

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [1, 2, 3, 4, 5]) {
  test(`seeded random devices (seed ${seed}): every device ends the same, and no change made on one side alone is lost`, async () => {
    const rnd = mulberry(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const acc = fakeSettingsAccount();
    const devices = [browser(acc, "ada", true), browser(acc, "ada", true), browser(acc, "ada", true)];
    const textKeys = [NOZZLE, GRIP];
    let stamp = 0;
    for (let step = 0; step < 400; step++) {
      // The model: each setting's (and each preset's, and each Settings entry's) last writer since everything last agreed.
      const writes = new Map<string, Set<number>>(); // what -> devices that changed it
      const wrote = new Map<string, unknown>(); // what -> the value the only writer left
      const note = (what: string, d: number, v: unknown) => {
        (writes.get(what) ?? writes.set(what, new Set()).get(what)!).add(d);
        wrote.set(what, v);
      };
      const edits = 1 + Math.floor(rnd() * 6);
      for (let e = 0; e < edits; e++) {
        const d = Math.floor(rnd() * devices.length);
        const dev = devices[d]!;
        const what = rnd();
        if (what < 0.4) {
          const k = pick(textKeys);
          const v = rnd() < 0.2 ? null : pick(["a", "b", "c", "d"]);
          if (v === null) dev.store.removeItem(k);
          else dev.set(k, v);
          note(k, d, v);
        } else if (what < 0.7) {
          const ui = JSON.parse(dev.get(UI) ?? "{}");
          const entry = pick(["theme", "unit", "custom-primary"]);
          ui[entry] = pick(["1", "2", "3"]);
          dev.set(UI, JSON.stringify(ui));
          note(`${UI}#${entry}`, d, ui[entry]);
        } else {
          const list = JSON.parse(dev.get(PRESETS) ?? presets()).presets as ReturnType<typeof preset>[];
          const id = pick(["p", "q", "r"]);
          const i = list.findIndex((p) => p.id === id);
          const next = preset(id, pick(["n1", "n2", "n3"]), ++stamp);
          if (i >= 0) list[i] = next;
          else list.push(next);
          dev.set(PRESETS, presets(...list));
          note(`${PRESETS}#${id}`, d, next.name);
        }
        // Now and then a device syncs mid-way (the others don't see it yet).
        if (rnd() < 0.3) assert.equal((await devices[Math.floor(rnd() * devices.length)]!.sync.round()).kind, "done");
      }
      // Everyone syncs twice over: then every device and the account agree.
      for (let pass = 0; pass < 2; pass++) for (const dev of devices) assert.equal((await dev.sync.round()).kind, "done");
      const account = acc.rows.get("ada")?.settings ?? {};
      for (const dev of devices) for (const s of SPECS) assert.equal(dev.get(s.key) ?? undefined, account[s.key], `seed ${seed} step ${step}: ${s.key} differs`);
      // A change only one device made since the last agreement is what everyone has now.
      for (const [what, who] of writes) {
        if (who.size !== 1) continue;
        const want = wrote.get(what);
        const [key, entry] = what.split("#");
        if (entry === undefined) assert.equal(account[key!] ?? null, want, `seed ${seed} step ${step}: ${key} lost`);
        else if (key === UI) assert.equal(JSON.parse(account[UI]!)[entry], want, `seed ${seed} step ${step}: ${entry} lost`);
        else assert.equal((JSON.parse(account[PRESETS]!).presets as { id: string; name: string }[]).find((p) => p.id === entry)?.name, want, `seed ${seed} step ${step}: preset ${entry} lost`);
      }
    }
  });
}
