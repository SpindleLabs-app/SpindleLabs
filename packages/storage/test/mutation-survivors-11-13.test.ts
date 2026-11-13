// Tests that kill the mutants the nightly TypeScript mutation run of 2026-11-12 (run 43243193539) found surviving in
// saving (issues #275 autosave, #276 store, #277 unsaved; packages/testing/stryker/run.sh storage), most of them in the
// journal and refusal code of the export and save hunt (#642, #643). Each test names the change to the code it
// catches. Three of the survivors showed real bugs, each reproduced here first (the "bug:" tests). Mutants no caller
// can tell apart from the code are listed, with the reason, in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import {
  asideKey,
  forget,
  journalEntry,
  memoryKeyValue,
  projectStore,
  readJournalEntry,
  recoverUnsaved,
  startAutosave,
  unsavedKey,
  type JournalStorage,
  type KeyValue,
  type ProjectStore,
  type Timers,
} from "../src/index.ts";
import { ProjectChangedError, ProjectDeletedError } from "../src/store.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r));
};

/** A fake clock: timers run only when the test moves time on, in time order (the earlier set first at the same time). */
function fakeClock() {
  let t = 0;
  let next = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => (pending.set(++next, { at: t + ms, fn }), next),
    clearTimeout: (h) => void pending.delete(h as number),
  };
  async function advance(ms: number) {
    const end = t + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      t = due[1].at;
      due[1].fn();
      await settle();
    }
    t = end;
    await settle();
  }
  return { timers, advance, now: () => new Date(t) };
}

/** localStorage as a Map; `full` makes every setItem throw, as a full localStorage does. */
function fakeStorage() {
  const items = new Map<string, string>();
  const s: JournalStorage & { items: Map<string, string>; full: boolean } = {
    items,
    full: false,
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      if (s.full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      items.set(k, v);
    },
    removeItem: (k) => void items.delete(k),
  };
  return s;
}

/** A promise the test lets go of when it chooses. */
function gate() {
  let open = () => {};
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open: () => open() };
}

const REFUSED = new ProjectChangedError().message;
const KEPT_WORDS = "unsaved changes from your last visit couldn't be stored yet, so this tab won't save over them. Reload the page to see them.";
const CHECK_WORDS = "this project was changed in another tab, so this tab shows an older version. Reload to see the newer one.";
const FULL = "browser storage is full: can't save this project (use Save to keep your work as a file)";
const said = (out: string[]) => (s: { state: string; message?: string }) => out.push(s.state === "error" ? s.message! : s.state);
const entryAt = (journal: { items: Map<string, string> }, key: string) => {
  const e = journal.items.get(key);
  return e === undefined ? null : readJournalEntry(e);
};
const widthIn = (entry: { text: string } | null) => (entry === null ? null : widthOf(JSON.parse(entry.text) as Project));

/** Tabs A and B on project "p" (width 40, stored at t = 0); another tab stores 70 at t = 500, so both are stale. */
async function twoStaleTabs(a = "tab-a", b = "tab-b") {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40), new Date(0));
  const tab = { a: part(40), b: part(40) };
  const out = { a: [] as string[], b: [] as string[] };
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => tab.a, said(out.a), { ...opts, writer: a });
  const tabB = startAutosave(store, "p", () => tab.b, said(out.b), { ...opts, writer: b });
  await store.save("p", part(70), new Date(500));
  return { clock, store, journal, tab, tabA, tabB, out };
}

// ---- bugs the survivors showed, each reproduced before its fix ----

test("bug: a refused save with another change waiting, the tab back at the state it opened, says the refusal, never Saved", async () => {
  // A opened 40 (stored at t = 0); another tab stored 70 at t = 500. A changes to 45: its save starts at t = 1000 and
  // is held. A goes back to 40 (Undo) and the quiet moment ends at t = 2000 while that save still runs, so one more
  // save is asked for. The held save is refused (the store holds 70): the next save finds 40, the text A last wrote,
  // and said "saved", though the store holds the other tab's 70 (#642 item 3 by another timing).
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  const hold = gate();
  const store: ProjectStore = { ...real, save: async (...args) => (await hold.wait, real.save(...args)) };
  let p = part(40);
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => p, said(out), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now, writer: "tab-a" });
  await real.save("p", part(70), new Date(500));
  p = part(45);
  tab.changed();
  await clock.advance(1000);
  p = part(40);
  tab.changed();
  await clock.advance(1000);
  hold.open();
  await settle();
  assert.equal(tab.refused(), true);
  assert.equal(out.at(-1), REFUSED, "it said \"saved\" over another tab's work");
  assert.ok(!out.includes("saved"));
  assert.equal(widthOf(await real.open("p")), 70);
});

test("bug: a tab held back by the last visit's kept changes, back at the state it opened after they were stored, never says Saved", async () => {
  // A opened 40 (stored at t = 0). The last visit's change (50), which recovery couldn't store, is in the journal,
  // marked kept: A's change to 45 is refused, never saved over it. Another tab then stores the 50 (room again) and its
  // entry goes. A goes back to 40: the store holds 50, not A's 40, so "saved" would be untrue.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40), new Date(0));
  let p = part(40);
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => p, said(out), { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now, writer: "tab-a" });
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(50)), new Date(500), true));
  p = part(45);
  tab.changed();
  await clock.advance(1000);
  assert.equal(out.at(-1), KEPT_WORDS);
  await store.save("p", part(50), new Date(1500)); // the tab opened from the kept entry stores it
  journal.removeItem(unsavedKey("p"));
  p = part(40);
  tab.changed();
  await clock.advance(1000);
  assert.notEqual(out.at(-1), "saved", "it said \"saved\" while the store holds the kept changes");
  assert.equal(out.at(-1), KEPT_WORDS);
  assert.equal(widthOf(await store.open("p")), 50);
  assert.deepEqual([...journal.items.keys()], [], "back at the state it opened: nothing of its own left to keep");
});

test("bug: finish() on a full store never marks its change kept over another tab's entry that took the key meanwhile (ownEntryThere() counted its entry put aside)", async () => {
  // A changes 40 to 60 and another project is opened at once (finish): 60 is journalled under the key and its store
  // save starts (held). Meanwhile tab B (80) is hidden: leaving() puts A's entry aside and journals B's under the key,
  // B's own save not landing (the page went). A's save then fails, storage full: A's state was marked kept by writing
  // it under the key, over B's entry, and B's 80 was nowhere.
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  const journal = fakeStorage();
  const holdA = gate();
  const never = gate();
  const fullA: ProjectStore = { ...real, save: async () => (await holdA.wait, Promise.reject(new Error(FULL))) };
  const goneB: ProjectStore = { ...real, save: async () => never.wait };
  let a = part(40);
  let b = part(40);
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(fullA, "p", () => a, () => {}, { ...opts, writer: "tab-a" });
  const tabB = startAutosave(goneB, "p", () => b, () => {}, { ...opts, writer: "tab-b" });
  a = part(60);
  tabA.changed();
  assert.equal(tabA.finish(), null);
  b = part(80);
  tabB.changed();
  assert.equal(tabB.leaving(), true);
  holdA.open();
  await tabA.settled();
  const key = entryAt(journal, unsavedKey("p"));
  assert.deepEqual([key?.writer, widthIn(key)], ["tab-b", 80], "B's entry was written over");
  assert.equal(widthIn(entryAt(journal, asideKey("p", "tab-a"))), 60, "A's change is kept aside");
});

test("bug: finish() on a full store whose own journal write failed marks the newest state kept once the journal has room, not the older one left by leaving()", async () => {
  // A journals 45 when hidden (leaving), changes to 46, then another project is opened (finish) while localStorage is
  // full: 46 can't be journalled then. localStorage has room again when the store's save fails (storage full): the
  // entry under the key is A's own, so A's newest state, 46, is marked kept there. It marked only an entry finish
  // itself had written, so the 45 stayed, unmarked, and the 46 was lost (the mutant `journalVersion === v` made true
  // survived because it did better).
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  const journal = fakeStorage();
  const hold = gate();
  const full: ProjectStore = { ...real, save: async () => (await hold.wait, Promise.reject(new Error(FULL))) };
  let a = part(40);
  const tab = startAutosave(full, "p", () => a, () => {}, { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now, writer: "tab-a" });
  a = part(45);
  tab.changed();
  assert.equal(tab.leaving(), true);
  a = part(46);
  tab.changed();
  journal.full = true;
  assert.equal(tab.finish(), null);
  journal.full = false;
  hold.open();
  await tab.settled();
  const key = entryAt(journal, unsavedKey("p"));
  assert.deepEqual([widthIn(key), key?.kept], [46, true]);
});
