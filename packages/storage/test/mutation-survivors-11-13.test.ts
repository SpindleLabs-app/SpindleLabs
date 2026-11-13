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

// ---- autosave.ts: the journal ----

test("leaving() writes a refused change again when the project was deleted and another stale tab's entry took the key (catches ownEntryThere taking any writer's entry for its own)", async () => {
  // A and C are stale (another tab stored 70). A's 45 is refused and journalled under the key. The project is deleted
  // in another tab, which takes the journal entries with it; C's 55 is then refused (deleted) and journalled under the
  // key. A's entry is nowhere now, so A's leaving() writes it again, putting C's aside: both changes are kept.
  const { clock, store, journal, tab, tabA, tabB: tabC, out } = await twoStaleTabs("tab-a", "tab-c");
  tab.a = part(45);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(out.a.at(-1), REFUSED);
  await forget(store, journal, "p");
  assert.deepEqual([...journal.items.keys()], []);
  tab.b = part(55);
  tabC.changed();
  await clock.advance(1000);
  assert.equal(entryAt(journal, unsavedKey("p"))?.writer, "tab-c");
  assert.equal(tabA.leaving(), true);
  const key = entryAt(journal, unsavedKey("p"));
  assert.deepEqual([key?.writer, widthIn(key)], ["tab-a", 45], "A's change was lost");
  assert.equal(widthIn(entryAt(journal, asideKey("p", "tab-c"))), 55);
});

test("an autosave whose writer isn't a writer id counts the entry under the key as its own: leaving() trusts it, writes again once it is gone (catches `entry != null && ownName === \"\"` mutants)", async () => {
  // The writer "not a writer!" has a space and a "!", so its entries carry no writer and the autosave can't tell its
  // own from another's: an entry under the key is taken as its own.
  const { clock, store, journal, tab, tabA, out } = await twoStaleTabs("not a writer!");
  tab.a = part(45);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(out.a.at(-1), REFUSED);
  const first = journal.items.get(unsavedKey("p"));
  assert.equal(readJournalEntry(first!).writer, undefined);
  // localStorage full now: the entry already there keeps the change, so the page need not ask (true, nothing written)
  journal.full = true;
  assert.equal(tabA.leaving(), true, "it tried to write its entry again into a full journal");
  assert.equal(journal.items.get(unsavedKey("p")), first);
  journal.full = false;
  // deleted in another tab, entries and all: leaving() writes it again
  await forget(store, journal, "p");
  assert.equal(tabA.leaving(), true);
  assert.equal(widthIn(entryAt(journal, unsavedKey("p"))), 45, "it trusted an entry that was gone");
});

test("check() finding another tab's save in a tab that changed nothing journals nothing: the next visit makes no kept copy (catches refuse() journalling with no change)", async () => {
  const { store, journal, tabA, out } = await twoStaleTabs();
  await tabA.check();
  assert.equal(out.a.at(-1), CHECK_WORDS);
  assert.deepEqual([...journal.items.keys()], [], "an entry of the unchanged state was written");
  assert.equal(tabA.leaving(), true);
  await recoverUnsaved(store, journal, []);
  assert.deepEqual((await store.list()).map((s) => s.name), ["Box"]);
});

// ---- autosave.ts: tries after a failure, and the status ----

/** A tab on "p" (40, stored at t = 0) over a store whose saves fail with "browser storage failed" until `ok`. */
async function failingTab() {
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  const tries: number[] = [];
  const state = { ok: false };
  const store: ProjectStore = { ...real, save: async (...args) => (tries.push(clock.now().getTime()), state.ok ? real.save(...args) : Promise.reject(new Error("browser storage failed: planted"))) };
  const p = { now: part(40) };
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => p.now, said(out), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  return { clock, real, tries, state, p, out, tab };
}

test("a change while a retry waits replaces it: the change's own save is the next try, not the retry as well (catches noRetry() doing nothing)", async () => {
  // Fails at t = 1000; the retry would be at 1000 + 10 000 = 11 000. A change at t = 10 500 has its save at
  // 10 500 + 1000 = 11 500, and that is the only try: none at 11 000.
  const { clock, tries, p, tab } = await failingTab();
  p.now = part(45);
  tab.changed();
  await clock.advance(1000);
  await clock.advance(9500);
  p.now = part(46);
  tab.changed();
  await clock.advance(1000);
  assert.deepEqual(tries, [1000, 11_500]);
  tab.stop();
});

test("retries go on each minute after the third: 10 s, 30 s, 60 s, 60 s (worked by hand; catches the last delay read past the list)", async () => {
  // t = 1000 fails; then 1000 + 10 000 = 11 000, 11 000 + 30 000 = 41 000, 41 000 + 60 000 = 101 000 and
  // 101 000 + 60 000 = 161 000, where storage has room again.
  const { clock, real, tries, state, p, out, tab } = await failingTab();
  p.now = part(45);
  tab.changed();
  await clock.advance(1000 + 10_000 + 30_000 + 60_000);
  assert.deepEqual(tries, [1000, 11_000, 41_000, 101_000]);
  state.ok = true;
  await clock.advance(60_000 * 0.9);
  assert.equal(tries.length, 4, "not before the minute");
  await clock.advance(60_000 * 0.1);
  assert.deepEqual(tries, [1000, 11_000, 41_000, 101_000, 161_000]);
  assert.equal(out.at(-1), "saved");
  assert.equal(widthOf(await real.open("p")), 45);
});

test("a save landing while a newer change waits for its quiet moment says nothing: still saving, not Saved (catches `timer === null` made true)", async () => {
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  const hold = gate();
  const store: ProjectStore = { ...real, save: async (...args) => (await hold.wait, real.save(...args)) };
  let p = part(40);
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => p, said(out), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  p = part(45);
  tab.changed();
  await clock.advance(1000); // the save of 45 starts, held
  p = part(46);
  tab.changed(); // its quiet moment ends at t = 2000
  await clock.advance(200);
  hold.open();
  await settle();
  assert.equal(widthOf(await real.open("p")), 45);
  assert.equal(out.at(-1), "saving", "it said Saved with 46 not stored");
  await clock.advance(1000);
  assert.equal(out.at(-1), "saved");
  assert.equal(widthOf(await real.open("p")), 46);
});

// ---- autosave.ts: check() and lost() ----

test("check() reads nothing from the store while stopped, refused, never stored, or with its own save waiting or running (catches each part of its first guard dropped)", async () => {
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  let reads = 0;
  const hold = { now: null as ReturnType<typeof gate> | null };
  const store: ProjectStore = { ...real, list: () => (reads++, real.list()), save: async (...args) => (await hold.now?.wait, real.save(...args)) };
  const open = (storedAt: Date | null) => {
    const p = { now: part(40) };
    const tab = startAutosave(store, "p", () => p.now, () => {}, { timers: clock.timers, stored: true, storedAt, now: clock.now });
    return { p, tab };
  };
  // never stored by this tab, nor opened with a save time: nothing to compare
  await open(null).tab.check();
  assert.equal(reads, 0, "never stored");
  // a change waiting for its quiet moment
  const waiting = open(new Date(0));
  waiting.p.now = part(41);
  waiting.tab.changed();
  await waiting.tab.check();
  assert.equal(reads, 0, "a save waiting");
  waiting.tab.stop();
  // a save running
  hold.now = gate();
  const running = open(new Date(0));
  running.p.now = part(42);
  running.tab.changed();
  await clock.advance(1000);
  await running.tab.check();
  assert.equal(reads, 0, "a save running");
  hold.now.open();
  await running.tab.settled();
  running.tab.stop();
  // stopped
  const stopped = open(new Date(0));
  stopped.tab.stop();
  await stopped.tab.check();
  assert.equal(reads, 0, "stopped");
  // refused already: the first check reads and finds the other tab's save, the second reads nothing
  const refused = open(new Date(0));
  await refused.tab.check();
  assert.equal([reads, refused.tab.refused()].join(), "1,true");
  await refused.tab.check();
  assert.equal(reads, 1, "refused");
});

test("check() compares this project's own save time, not another project's listed first (catches `s.id === id` made true)", async () => {
  // "p" stored at t = 0; "q" stored at t = 1000 is listed first (newest). The tab on p is not stale.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  await store.save("p", part(40), new Date(0));
  await store.save("q", part(10), new Date(1000));
  assert.equal((await store.list())[0]!.id, "q");
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => part(40), said(out), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  await tab.check();
  assert.deepEqual([tab.refused(), out], [false, []]);
});

test("check() says nothing when the project's summary can't be read: the next save says what is wrong (catches a damaged summary read as save time 0)", async () => {
  // A damaged summary reads as save time 0 with a problem; the tab knew 1000, so taking 0 as the save time would
  // call it another tab's.
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], clock.now);
  await store.save("p", part(40), new Date(1000));
  await kv.set("summary/p", "{damaged");
  assert.equal((await store.list())[0]!.problem !== undefined, true);
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => part(40), said(out), { timers: clock.timers, stored: true, storedAt: new Date(1000), now: clock.now });
  await tab.check();
  assert.deepEqual([tab.refused(), out], [false, []]);
});

test("check() on a project no longer listed (deleted in another tab) settles quietly: the next save says so (catches `holds == null` dropped)", async () => {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  await store.save("p", part(40), new Date(0));
  const out: string[] = [];
  let p = part(40);
  const tab = startAutosave(store, "p", () => p, said(out), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  await store.remove("p");
  await tab.check();
  assert.deepEqual([tab.refused(), out], [false, []]);
  p = part(41);
  tab.changed();
  await clock.advance(1000);
  assert.equal(out.at(-1), new ProjectDeletedError().message);
});

test("check() whose own tab stored a save while it read the list takes that save for its own, not another tab's (catches `base !== knew` dropped)", async () => {
  // The tab knew save time 0 when it asked. Its change saved at t = 1000 lands before the list is read: the list
  // says 1000, which is this tab's own save, not another tab's.
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(40), new Date(0));
  const hold = gate();
  const store: ProjectStore = { ...real, list: async () => (await hold.wait, real.list()) };
  let p = part(40);
  const out: string[] = [];
  const tab = startAutosave(store, "p", () => p, said(out), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  const asked = tab.check();
  p = part(45);
  tab.changed();
  await clock.advance(1000);
  assert.equal((await real.list())[0]!.modified.getTime(), 1000);
  hold.open();
  await asked;
  assert.deepEqual([tab.refused(), out.at(-1)], [false, "saved"]);
});

test("lost() in a refused tab stores nothing: the other tab's newer work is what goes back into the emptied store (catches lost()'s guard dropped)", async () => {
  // A (45, refused) and B (the other tab's 70, stored at t = 500): the browser empties the store under both. A's
  // lost() comes first; only B, whose state the store last held, stores again.
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], clock.now);
  await store.save("p", part(40), new Date(0));
  let a = part(40);
  const b = part(70);
  const outA: string[] = [];
  const opts = { timers: clock.timers, stored: true, now: clock.now };
  const tabA = startAutosave(store, "p", () => a, said(outA), { ...opts, storedAt: new Date(0), writer: "tab-a" });
  await store.save("p", b, new Date(500), new Date(0));
  const tabB = startAutosave(store, "p", () => b, () => {}, { ...opts, storedAt: new Date(500), writer: "tab-b" });
  a = part(45);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(tabA.refused(), true);
  for (const k of await kv.keys("")) await kv.delete(k);
  tabA.lost();
  tabB.lost();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 70, "the refused tab's older state was stored first");
  assert.equal(outA.at(-1), REFUSED);
});

// ---- store.ts ----

test("text() gives the stored text exactly as it was written, and null for a project not stored (catches text() emptied or reading the wrong key)", async () => {
  const store = projectStore(memoryKeyValue(), []);
  await store.save("p", part(40), new Date(0));
  // the text is projectToJson's of the project saved, byte for byte, not read or upgraded
  assert.equal(await store.text("p"), projectToJson(part(40)));
  assert.equal(await store.text("q"), null);
});

/**
 * A key-value store that is full: a step that writes anything is refused with `refusal` (the browser's
 * QuotaExceededError by default, whose message doesn't say "QuotaExceeded"); a step of deletes alone goes through and,
 * with `roomAfterDelete`, makes room for what follows. `afterDelete` runs once a step of deletes has landed.
 */
function fullKeyValue(o: { roomAfterDelete?: boolean; refuseDeletes?: boolean; refusal?: () => Error; afterDelete?: () => Promise<void> } = {}) {
  const kv = memoryKeyValue();
  const state = { full: false };
  const refusal = o.refusal ?? (() => new DOMException("The quota has been exceeded.", "QuotaExceededError"));
  const wrapped: KeyValue = {
    ...kv,
    update: async (keys, change) => {
      if (!state.full) return kv.update(keys, change);
      let writes = false;
      await kv.update(keys, (values) => {
        const out = change(values);
        writes = Object.values(out).some((v) => v !== null);
        if (writes || o.refuseDeletes) throw refusal();
        return out;
      });
      if (o.roomAfterDelete) state.full = false;
      await o.afterDelete?.();
    },
  };
  return { kv: wrapped, state };
}

test("remove() on a full store deletes the project all the same, the browser's own QuotaExceededError included (catches the error's name not read, and the deletes made under the wrong keys)", async () => {
  const { kv, state } = fullKeyValue();
  const store = projectStore(kv, [], () => new Date(2000));
  await store.save("p", part(40), new Date(0));
  state.full = true;
  await store.remove("p");
  assert.deepEqual([await store.list(), await store.text("p")], [[], null]);
  await assert.rejects(store.open("p"), /there is no stored project "p"/);
});

test("remove() on a full store writes the deletion mark once the deletes made room: a stale tab's save is then refused as deleted", async () => {
  const { kv, state } = fullKeyValue({ roomAfterDelete: true });
  const store = projectStore(kv, [], () => new Date(2000));
  await store.save("p", part(40), new Date(0));
  state.full = true;
  await store.remove("p");
  await assert.rejects(store.save("p", part(41), new Date(3000), new Date(0)), ProjectDeletedError);
});

test("remove() on a full store never writes its mark over the project stored again meanwhile (catches the mark written whatever the summary holds)", async () => {
  // Between the deletes and the mark, a tab whose store was emptied under it stores the project again (B4): the mark
  // is left out, so the project stays listed and opens.
  let store: ProjectStore | null = null;
  const full = fullKeyValue({ roomAfterDelete: true, afterDelete: async () => store!.save("p", part(99), new Date(2500)) });
  const s = projectStore(full.kv, [], () => new Date(2000));
  store = s;
  await s.save("p", part(40), new Date(0));
  full.state.full = true;
  await s.remove("p");
  assert.deepEqual((await s.list()).map((x) => x.id), ["p"]);
  assert.equal(widthOf(await s.open("p")), 99);
});

test("remove() on a store that refuses even deletes says storage is full and leaves the project whole", async () => {
  const { kv, state } = fullKeyValue({ refuseDeletes: true });
  const store = projectStore(kv, [], () => new Date(2000));
  await store.save("p", part(40), new Date(0));
  state.full = true;
  await assert.rejects(store.remove("p"), { message: "browser storage is full: can't delete this project" });
  assert.equal(widthOf(await store.open("p")), 40);
});

test("remove() rethrows a failure that isn't a full store, deleting nothing: words that only mention a full store later aren't one (catches every failure taken for full, and the words' start not checked)", async () => {
  for (const words of ["browser storage failed: planted", "UnknownError: not because browser storage is full"]) {
    const { kv, state } = fullKeyValue({ refuseDeletes: true, refusal: () => new Error(words) });
    const store = projectStore(kv, [], () => new Date(2000));
    await store.save("p", part(40), new Date(0));
    state.full = true;
    await assert.rejects(store.remove("p"), { message: words });
    state.full = false;
    assert.equal(widthOf(await store.open("p")), 40);
  }
});

// ---- unsaved.ts ----

test("a stale entry's kept copy is stored under the project's id, the entry's time in base 36 and its writer's first 8 characters (worked by hand)", async () => {
  // Written at t = 1500: 1500 = 1·36² + 5·36 + 24, digits 1, 5, o, so "15o". Writer "abcdefghijk": first 8 "abcdefgh".
  // An entry without a writer gets no writer part.
  for (const [writer, id] of [["abcdefghijk", "p-kept-15o-abcdefgh"], [null, "p-kept-15o"]] as const) {
    const store = projectStore(memoryKeyValue(), []);
    const journal = fakeStorage();
    await store.save("p", part(70), new Date(1000));
    journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(45)), new Date(1500), false, new Date(0), writer));
    await recoverUnsaved(store, journal, []);
    assert.deepEqual((await store.list()).map((s) => s.id).sort(), ["p", id].sort());
    assert.equal(widthOf(await store.open(id)), 45);
  }
});
