// Tests that kill the mutants the nightly TypeScript mutation run found
// surviving in saving on 2026-11-03 (issues #275, #276 and #277; run
// packages/testing/stryker/run.sh storage). Each test names the change to the
// code it catches. Mutants no caller can tell apart from the code are listed,
// with the reason, in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import {
  keptCopyName,
  journalEntry,
  memoryKeyValue,
  NEWER_PREFIX,
  projectStore,
  ProjectChangedError,
  readJournalEntry,
  recoverUnsaved,
  unsavedKey,
  startAutosave,
  type JournalStorage,
  type ProjectStore,
  type Timers,
} from "../src/index.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

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

/** `store` with each save held until `land()`. */
function held(store: ProjectStore) {
  const waiting: { args: Parameters<ProjectStore["save"]>; done: () => void; failed: (e: unknown) => void }[] = [];
  return {
    store: { ...store, save: (...args) => new Promise<void>((done, failed) => waiting.push({ args, done, failed })) } as ProjectStore,
    async land() {
      const w = waiting.shift()!;
      try {
        await store.save(...w.args);
        w.done();
      } catch (e) {
        w.failed(e);
      }
      await settle();
    },
  };
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

/** `globalThis.crypto` replaced by `value` while `run` runs (Node's own is put back after). */
async function withCrypto<T>(value: unknown, run: () => Promise<T>): Promise<T> {
  const was = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(globalThis, "crypto", was);
  }
}

test("a stale tab's change with no name is kept as Untitled (kept copy) (catches \"Untitled\" made \"\")", () => {
  assert.equal(keptCopyName(""), "Untitled (kept copy)");
  assert.equal(keptCopyName("Box"), "Box (kept copy)");
});

/** Recovery of a stale tab's entry over another tab's newer save, with the default new id: the copy's id. */
async function staleCopyId(): Promise<string> {
  let t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(45), undefined, undefined, false, "a");
  t = 2000;
  const journal = fakeStorage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(25)), new Date(1300), false, new Date(0), "b"));
  await recoverUnsaved(store, journal, []);
  const ids = (await store.list()).map((s) => s.id).filter((id) => id !== "p");
  assert.equal(ids.length, 1, "one copy");
  return ids[0];
}

test("the copy of a stale tab's change gets an id made from the entry: the project's id, its time and its writer (export hunt 2026-11-12, #642 item 6; worked by hand)", async () => {
  // It was a fresh random id, so two tabs recovering the same entry at once stored two copies. The entry here is for
  // project "p", written at 1300 ms by writer "b": 1300 = 1 x 36^2 + 0 x 36 + 4, "104" in base 36, so "p-kept-104-b",
  // with or without the browser's crypto (nothing random is in it).
  assert.equal(await staleCopyId(), "p-kept-104-b");
  for (const crypto of [undefined, {}]) assert.equal(await withCrypto(crypto, staleCopyId), "p-kept-104-b");
});

test("journal keys only count with an id after the prefix; other keys are left alone (catches the NEWER_PREFIX check made || or >=, or its length check true)", async () => {
  const store = projectStore(memoryKeyValue(), [], () => new Date(1000));
  const journal = fakeStorage();
  const entry = journalEntry(projectToJson(part(25)), new Date(500), false);
  // The prefix alone (no id), and a key of another kind longer than the prefix: neither is an entry.
  journal.setItem(NEWER_PREFIX, entry);
  journal.setItem("x".repeat(NEWER_PREFIX.length + 5), entry);
  assert.deepEqual(await recoverUnsaved(store, journal, []), []);
  assert.deepEqual(await store.list(), [], "nothing stored");
  assert.equal(journal.items.size, 2, "both left as they were");
});

test("a kept entry (one the store couldn't take last visit) goes back though the store's last save is its own writer's, newer (catches `over !== undefined && holds !== undefined` made true or ||, and `over !== undefined` made true)", async () => {
  // The store holds 45, saved at 1000 by writer "b". The entry, 46, is marked kept (written 500, by "b"): it is the
  // project's newest state, shown and owed to the store, so it goes back whatever the times say.
  let t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(45), undefined, undefined, false, "b");
  t = 2000;
  const journal = fakeStorage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(46)), new Date(500), true, null, "b"));
  assert.deepEqual(await recoverUnsaved(store, journal, []), []);
  assert.equal(widthOf(await store.open("p")), 46);
  assert.equal(journal.items.size, 0);
});

test("an entry put back is stored as of when it was written, not when recovery ran (catches `entry.written ?? undefined` made &&)", async () => {
  const store = projectStore(memoryKeyValue(), [], () => new Date(9000));
  const journal = fakeStorage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(25)), new Date(1300), false));
  assert.deepEqual(await recoverUnsaved(store, journal, []), []);
  const [s] = await store.list();
  assert.equal(s.modified.getTime(), 1300, "the entry's time, 1300, not the clock's 9000");
});

test("a newer build's held entry that this build reads, refused by the store, moves to the unsaved key (catches `if (held)` made false)", async () => {
  // Held under NEWER_PREFIX by an older build; this one reads it. The store is full: the entry is kept, marked kept,
  // under its unsaved key (where the tabs look), and the held copy goes, so it is not there twice.
  const real = projectStore(memoryKeyValue(), []);
  const store: ProjectStore = { ...real, save: async () => Promise.reject(new Error("quota exceeded")) };
  const journal = fakeStorage();
  journal.setItem(NEWER_PREFIX + "p", journalEntry(projectToJson(part(25)), new Date(500), false));
  const problems = await recoverUnsaved(store, journal, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /couldn't be stored \(quota exceeded\)/);
  assert.deepEqual([...journal.items.keys()], [unsavedKey("p")]);
  const kept = readJournalEntry(journal.items.get(unsavedKey("p"))!);
  assert.deepEqual([kept.kept, widthOf(JSON.parse(kept.text) as Project)], [true, 25]);
});

test("a stale tab's change is kept as a copy when the store's project can't be read to compare (catches holdsExactly's catch made true)", async () => {
  // The store refuses the entry over its newer state (another tab's save) and then can't open its own project:
  // nothing says the two are the same, so the change is kept apart as a copy, never dropped.
  let t = 1000;
  const real = projectStore(memoryKeyValue(), [], () => new Date(t));
  await real.save("p", part(45), undefined, undefined, false, "a");
  t = 2000;
  const store: ProjectStore = { ...real, open: async () => Promise.reject(new Error("can't read")) };
  const journal = fakeStorage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(25)), new Date(1300), false, new Date(0), "b"));
  const problems = await recoverUnsaved(store, journal, [], () => "copy-1");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /kept as a separate project, "Box \(kept copy\)"/);
  assert.equal(widthOf(await real.open("copy-1")), 25);
  assert.equal(journal.items.size, 0);
  // The copy is stored as of when the entry was written, 1300, not the clock's 2000 (catches the copy's `entry.written ?? undefined` made &&).
  assert.equal((await real.list()).find((s) => s.id === "copy-1")!.modified.getTime(), 1300);
});

test("a save with no writer is listed with none, and a later save checked against it is taken (catches `by === null` made false)", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], () => new Date(1000));
  await store.save("p", part(45), new Date(1000));
  const [s] = await store.list();
  assert.equal(s.problem, undefined);
  assert.equal(Object.hasOwn(s, "writer"), false, "no writer named");
  // Stored with no writer field at all (not "writer": null), as before writers were named, so any build reads it the same.
  const summaries = await Promise.all((await kv.keys("")).map(async (k) => (await kv.get(k))!));
  const summary = summaries.find((v) => v.includes('"modified"'))!;
  assert.equal(Object.hasOwn(JSON.parse(summary) as object, "writer"), false, summary);
  await store.save("p", part(46), new Date(2000), new Date(1000));
  assert.equal(widthOf(await store.open("p")), 46);
});

/** A tab's save of 45 in flight (read at t = 1000) while a newer change, 46, is journalled at 1100; `meddle` runs on the journal before the save lands. The entry after. */
async function entryAfterLanding(meddle: (journal: ReturnType<typeof fakeStorage>) => void = () => {}) {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  await store.save("p", part(40));
  const pg = held(store);
  const journal = fakeStorage();
  let p = part(40);
  const tab = startAutosave(pg.store, "p", () => p, () => {}, { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now, writer: "a" });
  p = part(45);
  tab.changed();
  await clock.advance(1000); // the quiet second: the save of 45 starts, read at 1000
  await clock.advance(100);
  p = part(46);
  tab.changed();
  assert.equal(tab.leaving(), true); // 46 journalled at 1100, made from save time 0
  meddle(journal);
  await pg.land();
  return journal.items.get(unsavedKey("p"));
}

test("hand-worked: an entry journalled while a save was in flight is moved onto that save once it lands (catches rebase's block emptied, `entry == null` made true, `read.written !== null` made false)", async () => {
  // Before the save lands, 46's entry names save time 0; the store then holds 45 at 1000, which 46 was made from:
  // the entry now names 1000, so the next visit puts 46 back over 45 rather than keeping it as another tab's.
  const entry = readJournalEntry((await entryAfterLanding())!);
  assert.deepEqual([widthOf(JSON.parse(entry.text) as Project), entry.written?.getTime(), entry.base?.getTime(), entry.writer, entry.kept], [46, 1100, 1000, "a", false]);
});

test("an entry with no time on it (not this tab's writing) is left as it is when the save lands", async () => {
  const raw = projectToJson(part(46));
  assert.equal(await entryAfterLanding((j) => j.setItem(unsavedKey("p"), raw)), raw);
});

test("an autosave names itself in its saves: the browser's random UUID, else one made of the time and a random number (catches each change to freshWriter)", async () => {
  const writerOf = async () => {
    const clock = fakeClock();
    const store = projectStore(memoryKeyValue(), [], clock.now);
    let p = part(40);
    const tab = startAutosave(store, "p", () => p, () => {}, { timers: clock.timers, now: clock.now });
    p = part(45);
    tab.changed();
    await clock.advance(2000);
    tab.stop();
    const [s] = await store.list();
    return s.writer;
  };
  assert.match((await writerOf())!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  // No crypto, or no randomUUID: "w-", the time in base 36, "-", the random digits after "0." (no dot: a writer id
  // is letters, digits, "-" and "_" only, store.ts writerId, so one with a dot would name no writer at all).
  for (const crypto of [undefined, {}]) assert.match((await withCrypto(crypto, writerOf))!, /^w-[0-9a-z]+-[0-9a-z]+$/);
});

test("finish() stores the tab's last change as the newest project, first in the list (catches its save's `behind` made true)", async () => {
  // q is saved after p was opened; the tab then changes p and finishes (the page going): p is the work last done, so
  // the list starts with it, as after any other save of this tab's.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  await store.save("p", part(40));
  await store.save("q", part(10));
  let p = part(40);
  const tab = startAutosave(store, "p", () => p, () => {}, { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  p = part(45);
  tab.changed();
  tab.finish();
  await settle();
  assert.equal(widthOf(await store.open("p")), 45);
  assert.deepEqual((await store.list()).map((s) => s.id), ["p", "q"]);
});
