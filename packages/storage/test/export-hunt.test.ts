// Export and save hunt 2026-11-12 (issues #642 two tabs, #643 storage full): what the autosave and recovery do when a
// tab's saves are refused or fail. One store and one localStorage shared by the tabs, on one fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project } from "@fission/core";
import { bringForward, forget, indexedDbKeyValue, keptEntry, memoryKeyValue, projectStore, readJournalEntry, recoverUnsaved, RETRY_MS, startAutosave, unsavedKey, journalEntry, type JournalStorage, type ProjectStore, type Timers } from "../src/index.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = () => new Promise<void>((r) => setImmediate(r));

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
function fakeStorage() {
  const items = new Map<string, string>();
  const s: JournalStorage & { items: Map<string, string> } = {
    items,
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  return s;
}
const REFUSED = "This project was changed in another tab. Reload to see the newer version.";

/** Tabs A and B on project "p" (width 40, stored at t = 0); B stores 70 at t = 1000, so A is stale from then on. */
async function staleTab() {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  const tab = { a: part(40), b: part(40) };
  const aSaid: string[] = [];
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => tab.a, (s) => aSaid.push(s.state === "error" ? s.message : s.state), { ...opts, writer: "tab-a" });
  const tabB = startAutosave(store, "p", () => tab.b, () => {}, { ...opts, writer: "tab-b" });
  tab.b = part(70);
  tabB.changed();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 70);
  return { clock, store, journal, tab, tabA, tabB, aSaid };
}
const entryOf = (journal: ReturnType<typeof fakeStorage>) => {
  const e = journal.items.get(unsavedKey("p"));
  return e === undefined ? null : readJournalEntry(e);
};

test("a tab whose saves are refused journals each change at the end of its quiet moment, not only when it leaves (#642 item 2, worked by hand)", async () => {
  // B stored 70 at t = 1000. A (still on the state saved at t = 0) changes to 45 at t = 1000: its save at t = 2000 is
  // refused. Nothing but the journal can hold the 45 then, so it is written there at once, naming save time 0 (the
  // state it was made from): a crash before the tab is hidden loses nothing. The next change, 46, is journalled a
  // second later the same way, without leaving() ever being called.
  const { clock, store, journal, tab, tabA, aSaid } = await staleTab();
  tab.a = part(45);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(aSaid.at(-1), REFUSED);
  assert.equal(widthOf(await store.open("p")), 70, "B's work untouched");
  assert.deepEqual([widthOf(JSON.parse(entryOf(journal)!.text)), entryOf(journal)!.base?.getTime(), entryOf(journal)!.kept, entryOf(journal)!.writer], [45, 0, false, "tab-a"]);
  tab.a = part(46);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(widthOf(JSON.parse(entryOf(journal)!.text)), 46);
  // the next visit keeps it apart, never over B's 70
  await recoverUnsaved(store, journal, [], () => "copy");
  assert.deepEqual([widthOf(await store.open("p")), widthOf(await store.open("copy"))], [70, 46]);
});

test("Undo in a refused tab, back to the state it opened, never says Saved: the store holds another tab's work (#642 item 3)", async () => {
  const { clock, journal, tab, tabA, aSaid } = await staleTab();
  tab.a = part(45);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(aSaid.at(-1), REFUSED);
  tab.a = part(40); // Undo: the tab shows what it opened, which is not what the store holds (70)
  tabA.changed();
  await clock.advance(1000);
  assert.equal(aSaid.at(-1), REFUSED, "it said \"saved\"");
  assert.ok(!aSaid.slice(aSaid.indexOf(REFUSED)).includes("saved"));
  assert.equal(entryOf(journal), null, "nothing of its own is left to keep: the entry for 45 is gone");
  assert.equal(tabA.leaving(), true);
  assert.equal(entryOf(journal), null);
});

test("check(): a tab that made no change learns that another tab stored the project since, and says so (#642 item 3)", async () => {
  const { store, tabA, tabB, aSaid, clock } = await staleTab();
  assert.equal(tabA.refused(), false);
  await tabA.check();
  assert.equal(tabA.refused(), true);
  assert.equal(aSaid.at(-1), "this project was changed in another tab, so this tab shows an older version. Reload to see the newer one.");
  // the tab that stored it is not stale, and neither is one whose project was only brought forward (same save time)
  await tabB.check();
  assert.equal(tabB.refused(), false);
  assert.equal(await bringForward(store, "p", new Date(1000)), true);
  await tabB.check();
  assert.equal(tabB.refused(), false);
  await clock.advance(5000);
});

test("check() says nothing while this tab's own save waits or runs, on a project never stored, or after stop()", async () => {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  let p = part(40);
  const said: string[] = [];
  const tab = startAutosave(store, "p", () => p, (s) => said.push(s.state), { timers: clock.timers, now: clock.now });
  await tab.check(); // never stored: no save time to compare
  assert.deepEqual(said, []);
  p = part(41);
  tab.changed();
  await tab.check(); // its own save waits
  await clock.advance(1000);
  await tab.check(); // stored by itself: the store holds its save time
  assert.deepEqual(said, ["saving", "saved"]);
  assert.equal(tab.refused(), false);
  await store.save("p", part(99), new Date(5000));
  tab.stop();
  await tab.check();
  assert.equal(tab.refused(), false);
});

test("a refused tab's journal entry deleted under it (the project deleted in another tab) is written again when it leaves (#642 item 5)", async () => {
  const { clock, store, journal, tab, tabA } = await staleTab();
  tab.a = part(45);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(tabA.leaving(), true);
  assert.equal(widthOf(JSON.parse(entryOf(journal)!.text)), 45);
  await forget(store, journal, "p"); // another tab: File > Projects, Delete
  assert.equal(entryOf(journal), null);
  assert.equal(tabA.leaving(), true, "kept again, so the page need not ask");
  assert.equal(widthOf(JSON.parse(entryOf(journal)!.text)), 45, "the tab trusted an entry that was no longer there");
});

test("two tabs started at once make one kept copy of a stale entry, not two (#642 item 6)", async () => {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(70), new Date(1000));
  journal.setItem(unsavedKey("p"), journalEntry(JSON.stringify(part(45)), new Date(1500), false, new Date(0), "tab-a"));
  const said = await Promise.all([recoverUnsaved(store, journal, []), recoverUnsaved(store, journal, [])]);
  const names = (await store.list()).map((s) => s.name).sort();
  assert.deepEqual(names, ["Box", "Box (kept copy)"]);
  assert.ok(said.flat().length >= 1);
  // another stale change to the same project, written at another time, is a copy of its own
  journal.setItem(unsavedKey("p"), journalEntry(JSON.stringify(part(46)), new Date(1600), false, new Date(0), "tab-a"));
  await recoverUnsaved(store, journal, []);
  assert.equal((await store.list()).length, 3);
});

test("a project replaced while storage is full keeps its last change as the kept entry, so opening it again shows it (#643 item 3)", async () => {
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await real.save("p", part(45));
  const full: ProjectStore = { ...real, save: async () => Promise.reject(new Error("browser storage is full: can't save this project (use Save to keep your work as a file)")) };
  let p = part(45);
  const tab = startAutosave(full, "p", () => p, () => {}, { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now });
  p = part(60);
  tab.changed();
  await clock.advance(1000); // refused: full
  assert.equal(tab.finish(), null); // another project opened
  await tab.settled();
  const kept = keptEntry(journal, "p");
  assert.ok(kept !== null, "the entry was not marked kept, so the app opened the older stored state and said Saved");
  assert.equal(widthOf(JSON.parse(kept)), 60);
});

test("a failed save is tried again by itself: 10 s later, then 30 s, then every minute (#643 item 5, worked by hand)", async () => {
  // The save at t = 1000 fails (storage full). No further edit. Retries at 1000 + 10 000 = 11 000 (fails),
  // 11 000 + 30 000 = 41 000 (fails), 41 000 + 60 000 = 101 000 (room again: stored, "saved").
  const clock = fakeClock();
  const real = projectStore(memoryKeyValue(), [], clock.now);
  await real.save("p", part(45));
  const tries: number[] = [];
  let room = false;
  const store: ProjectStore = { ...real, save: async (...args) => (tries.push(clock.now().getTime()), room ? real.save(...args) : Promise.reject(new Error("browser storage is full: can't save this project"))) };
  let p = part(45);
  const said: string[] = [];
  const tab = startAutosave(store, "p", () => p, (s) => said.push(s.state), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  assert.deepEqual(RETRY_MS, [10_000, 30_000, 60_000]);
  p = part(60);
  tab.changed();
  await clock.advance(1000 + 10_000 * 0.9);
  assert.deepEqual(tries, [1000], "not before 10 s");
  await clock.advance(10_000 * 0.2);
  assert.deepEqual(tries, [1000, 11_000]);
  await clock.advance(30_000);
  assert.deepEqual(tries, [1000, 11_000, 41_000]);
  room = true;
  await clock.advance(60_000);
  assert.deepEqual(tries, [1000, 11_000, 41_000, 101_000]);
  assert.equal(said.at(-1), "saved");
  assert.equal(widthOf(await real.open("p")), 60);
  await clock.advance(600_000);
  assert.equal(tries.length, 4, "nothing more once stored");
});

test("a refused save (another tab's work) is never retried by the timer, and stop() ends the retries", async () => {
  const { clock, store, tab, tabA } = await staleTab();
  let saves = 0;
  const real = store.save;
  store.save = (...args) => (saves++, real(...args));
  tab.a = part(45);
  tabA.changed();
  await clock.advance(1000);
  await clock.advance(600_000);
  assert.equal(widthOf(await store.open("p")), 70);
  // a failing store, then stop: no more tries
  const c2 = fakeClock();
  let tries = 0;
  const failing: ProjectStore = { ...projectStore(memoryKeyValue(), [], c2.now), save: async () => (tries++, Promise.reject(new Error("browser storage failed"))) };
  let p = part(1);
  const t2 = startAutosave(failing, "q", () => p, () => {}, { timers: c2.timers, now: c2.now });
  p = part(2);
  t2.changed();
  await c2.advance(1000);
  assert.equal(tries, 1);
  t2.stop();
  await c2.advance(600_000);
  assert.equal(tries, 1);
});

test("lost(): the browser emptied the store under the tab; the open project is stored again though nothing changed (#643 item 4)", async () => {
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], clock.now);
  await store.save("p", part(45));
  const p = part(45);
  const said: string[] = [];
  const tab = startAutosave(store, "p", () => p, (s) => said.push(s.state), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  for (const k of await kv.keys("")) await kv.delete(k); // site data cleared
  assert.equal((await store.list()).length, 0);
  tab.lost();
  assert.equal(said.at(-1), "saving");
  await clock.advance(1000);
  assert.equal(said.at(-1), "saved");
  assert.equal(widthOf(await store.open("p")), 45);
});

test("a failed save that is not 'full' also says how to keep the work; the full and refused words are left as they are (#643 item 6)", async () => {
  const said = async (error: Error) => {
    const clock = fakeClock();
    const store: ProjectStore = { ...projectStore(memoryKeyValue(), [], clock.now), save: async () => Promise.reject(error) };
    let p = part(1);
    const out: string[] = [];
    const tab = startAutosave(store, "q", () => p, (s) => out.push(s.state === "error" ? s.message : s.state), { timers: clock.timers, now: clock.now });
    p = part(2);
    tab.changed();
    await clock.advance(1000);
    tab.stop();
    return out.at(-1);
  };
  assert.equal(await said(new Error("browser storage failed: can't save this project (UnknownError: planted write failure)")), "browser storage failed: can't save this project (UnknownError: planted write failure). Use Save to keep your work as a file.");
  const full = "browser storage is full: can't save this project (use Save to keep your work as a file)";
  assert.equal(await said(new Error(full)), full);
});

test("the database closing under the tab is reported (#643 item 4)", async () => {
  // One that opens, then is closed by the browser (site data cleared): `lost` hears it.
  let opened: Record<string, unknown> = {};
  const closing = { open: () => { const r: Record<string, unknown> = { result: opened }; setImmediate(() => (r.onsuccess as () => void)()); return r; } } as unknown as IDBFactory;
  let lost = 0;
  const kv = indexedDbKeyValue("x", closing, () => lost++);
  await kv.get("k").catch(() => {}); // the stand-in has no transactions: only the open matters here
  assert.equal(lost, 0);
  (opened.onclose as () => void)();
  assert.equal(lost, 1);
});
