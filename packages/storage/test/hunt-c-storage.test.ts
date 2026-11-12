// Save/load bug hunt C (2026-11-11), browser storage: SpindleLabs#510 items 1-4.
//   C1  a tab whose saves are refused (another tab saved since) lost its edit on the reload its own message asks for:
//       leaving() journalled nothing. Now it journals the edit naming the stale state it was made from, so the next
//       visit keeps it apart as "(kept copy)" and never puts it over the other tab's work.
//   C2  a project deleted in one tab was stored again, silently, by another tab's autosave (a missing summary was
//       always taken for site data cleared). A delete now leaves a mark, written with the delete in one transaction;
//       a save expecting a save time that finds it is refused, and the change is kept apart as for C1.
//   C3  a delete cut short between its writes left a listed project that couldn't be opened: now one transaction.
//   C5  the storage-full words named internal keys ("project/<id>", "summary/<id>", "order").
// One store and one localStorage shared by both tabs, on one fake clock, as in two-tabs.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import {
  asideKey,
  forget,
  indexedDbKeyValue,
  journalEntry,
  memoryKeyValue,
  ProjectChangedError,
  projectStore,
  readJournalEntry,
  recoverUnsaved,
  startAutosave,
  storageFull,
  unsavedKey,
  versionedStore,
  type JournalStorage,
  type KeyValue,
  type ProjectStore,
  type Timers,
} from "../src/index.ts";

const part = (width: number, name = "Box"): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
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

function fakeStorage(): JournalStorage & { items: Map<string, string>; full: boolean } {
  const items = new Map<string, string>();
  const s = {
    items,
    full: false,
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (s.full) throw new Error("QuotaExceededError");
      items.set(k, v);
    },
    removeItem: (k: string) => void items.delete(k),
  };
  return s;
}

/** Every listed project as [name, width], sorted, so a test states the whole store. */
const listed = async (store: ProjectStore) => (await Promise.all((await store.list()).map(async (s) => [s.name, widthOf(await store.open(s.id))] as [string, number]))).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]));

/** Stored 40 at t = 0; tab B saves 60 (t = 1000); tab A, still on 40, changes to 25 at 1100 and is refused (t = 2100); the clock left at 2200. */
async function staleTab() {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const said: string[] = [];
  let copies = 0;
  const tabA = startAutosave(store, "p", () => a, (s) => said.push(s.state === "error" ? s.message : s.state), { ...opts, writer: "tabA", newId: () => `copy-${++copies}` });
  const tabB = startAutosave(store, "p", () => b, () => {}, { ...opts, writer: "tabB" });
  b = part(60);
  tabB.changed();
  await clock.advance(1100);
  a = part(25);
  tabA.changed();
  await clock.advance(1100);
  return { clock, store, journal, said, tabA, tabB, setA: (w: number) => void (a = part(w)) };
}

// ---------- C1 ----------

test("C1: a tab refused as another tab's change keeps its edit through the reload its message asks for, as a kept copy (worked by hand)", async () => {
  // B stored 60 with save time 1000. A's 25 was made from save time 0, so A's save expecting 0 is refused. A reloads:
  // leaving() at t = 2200 journals 25 naming base 0, written at 2200. The next visit's recovery tries 25 over save time 0, finds
  // 1000, and keeps it apart: the store is then exactly Box = 60 (B's work, still the one a visit opens) and
  // "Box (kept copy)" = 25.
  const { store, journal, said, tabA } = await staleTab();
  assert.equal(said.at(-1), "This project was changed in another tab. Reload to see the newer version.");
  assert.equal(tabA.leaving(), true, "the edit is kept, so the page need not ask");
  const entry = readJournalEntry(journal.items.get(unsavedKey("p"))!);
  assert.deepEqual([widthOf(JSON.parse(entry.text)), entry.base?.getTime(), entry.written?.getTime(), entry.kept], [25, 0, 2200, false]);
  tabA.stop();
  const problems = await recoverUnsaved(store, journal, [], () => "copy-r");
  assert.deepEqual(await listed(store), [["Box", 60], ["Box (kept copy)", 25]]);
  assert.equal((await store.list())[0].name, "Box", "B's work is still the project a visit opens");
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /"Box \(kept copy\)"/);
  assert.equal(journal.items.size, 0);
});

test("C1: the other tab's saves never remove the stale tab's entry, and a later Open keeps one copy, not two", async () => {
  const { clock, store, journal, tabA, tabB } = await staleTab();
  assert.equal(tabA.leaving(), true);
  // B carries on saving: its save must not take A's entry (it names a state B never saw).
  tabB.changed();
  await clock.advance(1100);
  assert.notEqual(journal.items.get(unsavedKey("p")), undefined, "A's entry is still kept");
  // A, still open, opens another project: finish() stores its edit apart now, and its entry goes with it.
  assert.equal(tabA.finish(), "Box (kept copy)");
  await tabA.settled();
  await settle();
  assert.equal(journal.items.has(unsavedKey("p")), false, "the entry went once the copy was stored");
  await recoverUnsaved(store, journal, []);
  assert.deepEqual(await listed(store), [["Box", 60], ["Box (kept copy)", 25]], "exactly one kept copy");
});

test("C1: with the journal full the refused tab's edit can't be kept, so leaving() still says the page should ask", async () => {
  const { journal, tabA } = await staleTab();
  journal.full = true;
  assert.equal(tabA.leaving(), false);
});

test("C1: a tab that won't save over the last visit's kept changes keeps its own edit aside, and the next visit keeps both (worked by hand)", async () => {
  // Stored 40 (save time 500). The last visit's 50 couldn't be stored (storage full) and is marked kept ("@900!").
  // This tab opened the stored 40 (base 500) and renames it: refused, the kept 50 is not saved over. On leaving it must
  // neither drop the rename nor write over the kept entry: it goes aside under its own writer. The next visit, with
  // room: the kept 50 goes back over p (kept entries go back whatever the store holds), then the rename, made from
  // save time 500, finds p's new save time 900 and is kept apart: Box = 50 and "Renamed (kept copy)" = 40.
  const t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(40), new Date(500));
  const journal = fakeStorage();
  const kept = journalEntry(projectToJson(part(50)), new Date(900), true);
  journal.items.set(unsavedKey("p"), kept);
  let project = part(40);
  const timers: Timers = { setTimeout: (fn, ms) => (ms === 0 && queueMicrotask(fn), 1), clearTimeout: () => {} };
  const a = startAutosave(store, "p", () => project, () => {}, { journal, timers, quietMs: 0, stored: true, storedAt: new Date(500), now: () => new Date(t), writer: "tabA" });
  project = part(40, "Renamed");
  a.changed();
  await settle();
  assert.equal(a.leaving(), true);
  assert.equal(journal.items.get(unsavedKey("p")), kept, "the kept entry exactly as it was");
  const aside = readJournalEntry(journal.items.get(asideKey("p", "tabA"))!);
  assert.deepEqual([JSON.parse(aside.text).name, aside.base?.getTime()], ["Renamed", 500]);
  a.stop();
  await recoverUnsaved(store, journal, [], () => "copy-r");
  assert.deepEqual(await listed(store), [["Box", 50], ["Renamed (kept copy)", 40]]);
  assert.equal(journal.items.size, 0);
});

// ---------- C2 ----------

/** Tab A has "Box" (40, save time 0) open; tab B deletes it (home screen > Delete); A's next change is 45. */
async function deletedUnderTab() {
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = versionedStore(projectStore(kv, [], clock.now), kv, []);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  const said: string[] = [];
  const tabA = startAutosave(store, "p", () => a, (s) => said.push(s.state === "error" ? s.message : s.state), { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now, writer: "tabA", newId: () => "copy-a" });
  await forget(store, journal, "p"); // tab B
  a = part(45);
  tabA.changed();
  await clock.advance(1100);
  return { kv, store, journal, said, tabA };
}

test("C2: a project deleted in another tab is not stored again by this tab's autosave, and it says so", async () => {
  const { store, said } = await deletedUnderTab();
  assert.deepEqual(await listed(store), [], "the deleted project stays deleted");
  assert.match(said.at(-1)!, /^This project was deleted in another tab/);
  await assert.rejects(store.open("p"), /there is no stored project "p"/);
});

test("C2: the deleted project's last edit is kept as a kept copy over a reload, never as the deleted project", async () => {
  const { store, journal, tabA } = await deletedUnderTab();
  assert.equal(tabA.leaving(), true);
  tabA.stop();
  await recoverUnsaved(store, journal, [], () => "copy-r");
  assert.deepEqual(await listed(store), [["Box (kept copy)", 45]]);
  assert.deepEqual((await store.list()).map((s) => s.id), ["copy-r"]);
});

test("C2: the deleted project's last edit is kept as a kept copy when this tab opens another project", async () => {
  const { store, tabA } = await deletedUnderTab();
  assert.equal(tabA.finish(), "Box (kept copy)");
  await tabA.settled();
  await settle();
  assert.deepEqual(await listed(store), [["Box (kept copy)", 45]]);
});

test("C2: the refusal is a ProjectChangedError, so every caller that keeps a stale tab's change apart keeps this one too", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], () => new Date(0));
  await store.save("p", part(40));
  await store.remove("p");
  await assert.rejects(store.save("p", part(45), new Date(5), new Date(0)), (e: unknown) => e instanceof ProjectChangedError && /deleted in another tab/.test((e as Error).message));
});

test("C2 (B4 kept): site data cleared under the tab (no entries at all, no mark) is still stored again", async () => {
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], clock.now);
  await store.save("p", part(40));
  let a = part(40);
  const said: string[] = [];
  const tabA = startAutosave(store, "p", () => a, (s) => said.push(s.state), { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now });
  kv.entries.clear(); // the browser emptied the store: no deletion mark either
  a = part(45);
  tabA.changed();
  await clock.advance(1100);
  assert.deepEqual(await listed(store), [["Box", 45]]);
  assert.equal(said.at(-1), "saved");
});

test("C2: a deleted id saved again without expecting a save time (a new project, recovery) is an ordinary project again", async () => {
  // The mark refuses only a save made from the deleted state; a fresh save replaces it, and from then on saves
  // expecting that save's time (1000) are stored as usual.
  let t = 0;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(40));
  await store.remove("p");
  t = 1000;
  await store.save("p", part(41));
  t = 2000;
  await store.save("p", part(42), undefined, new Date(1000));
  assert.deepEqual(await listed(store), [["Box", 42]]);
});

// ---------- C3 ----------

/** `kv` whose `n`th write (set, delete or update) never happens and every later one neither: the tab killed there. */
function killedAtWrite(kv: KeyValue, n: number): KeyValue {
  let writes = 0;
  const dead = () => ++writes >= n;
  return {
    ...kv,
    set: async (k, v) => (dead() ? Promise.reject(new Error("tab killed")) : kv.set(k, v)),
    delete: async (k) => (dead() ? Promise.reject(new Error("tab killed")) : kv.delete(k)),
    update: async (keys, change) => (dead() ? Promise.reject(new Error("tab killed")) : kv.update(keys, change)),
  };
}

test("C3: a delete cut short at any write leaves every listed project openable, and the delete either whole or not at all", async () => {
  for (let n = 1; n <= 4; n++) {
    const kv = memoryKeyValue();
    await projectStore(kv, []).save("p", part(40, "Bracket"));
    await projectStore(kv, []).save("q", part(7, "Other"));
    const finished = await projectStore(killedAtWrite(kv, n), []).remove("p").then(() => true, () => false);
    const store = projectStore(kv, []);
    const opens = await Promise.all((await store.list()).map((s) => store.open(s.id).then(() => `${s.name} opens`, (e: Error) => `${s.name}: ${e.message}`)));
    assert.deepEqual(opens.sort(), finished ? ["Other opens"] : ["Bracket opens", "Other opens"], `killed at write ${n}`);
    // Whole means the text gone and only the small deletion mark left; not at all means both entries as they were.
    assert.deepEqual([kv.entries.has("project/p"), /^\{"deleted":/.test(kv.entries.get("summary/p") ?? "")], finished ? [false, true] : [true, false], `killed at write ${n}`);
  }
});

// ---------- C5 ----------

/**
 * Just enough of IndexedDB for indexeddb.ts: an open that succeeds, and transactions whose requests answer at once;
 * `refuse` set, a readwrite transaction aborts with that DOMException once its writes are made (as Chromium does
 * when the quota is reached: the error is on the transaction).
 */
function fakeIndexedDb(refuse: { error: DOMException | null }, data = new Map<string, unknown>()): IDBFactory {
  const answer = <T>(result: () => T) => {
    const r = { onsuccess: null as null | (() => void), onerror: null, result: undefined as T | undefined, error: null };
    queueMicrotask(() => {
      r.result = result();
      r.onsuccess?.();
    });
    return r;
  };
  const db = {
    onclose: null,
    onversionchange: null,
    close() {},
    transaction(_store: string, mode: IDBTransactionMode) {
      const tx = {
        oncomplete: null as null | (() => void),
        onabort: null as null | (() => void),
        onerror: null,
        error: null as DOMException | null,
        abort() {
          throw new Error("not aborted here");
        },
        objectStore: () => ({
          get: (k: string) => answer(() => data.get(k)),
          put: (v: unknown, k: string) => answer(() => (refuse.error === null && data.set(k, v), k)),
          delete: (k: string) => answer(() => void data.delete(k)),
        }),
      };
      setImmediate(() => {
        if (mode === "readwrite" && refuse.error !== null) {
          tx.error = refuse.error;
          tx.onabort?.();
        } else tx.oncomplete?.();
      });
      return tx;
    },
  };
  return {
    open() {
      const r = { result: db, error: null, onupgradeneeded: null, onsuccess: null as null | (() => void), onerror: null, onblocked: null };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    },
  } as unknown as IDBFactory;
}

test("C5: storage full says in plain words that this project can't be saved, naming no internal key", async () => {
  const refuse = { error: new DOMException("", "QuotaExceededError") as DOMException | null };
  const store = projectStore(indexedDbKeyValue("t", fakeIndexedDb(refuse)), []);
  const e = await store.save("b64de7ae-1", part(40)).then(() => null, (x: Error) => x);
  assert.equal(e?.message, "browser storage is full: can't save this project (use Save to keep your work as a file)");
  assert.equal(storageFull(e), true, "still known as storage full, so versions give way and the journal keeps the change");
});

test("C5: any other storage failure names no internal key either", async () => {
  const refuse = { error: new DOMException("planted write failure", "UnknownError") as DOMException | null };
  const store = projectStore(indexedDbKeyValue("t", fakeIndexedDb(refuse)), []);
  const e = await store.save("b64de7ae-1", part(40)).then(() => null, (x: Error) => x);
  assert.equal(e?.message, "browser storage failed: can't save this project (UnknownError: planted write failure)");
  assert.doesNotMatch(e?.message ?? "", /project\/|summary\/|"order"/);
});

test("C5 control: the fake IndexedDB stores and reads back when nothing refuses", async () => {
  const refuse = { error: null as DOMException | null };
  const store = projectStore(indexedDbKeyValue("t", fakeIndexedDb(refuse)), []);
  await store.save("p", part(40));
  assert.equal(widthOf(await store.open("p")), 40);
});

// ---------- KeyValue.update deleting (for C3: a delete in one transaction) ----------

test("memoryKeyValue.update: a key given null is deleted in the same step as the writes; a change that throws does neither", async () => {
  const kv = memoryKeyValue();
  await kv.set("a", "1");
  await kv.set("b", "2");
  await kv.update(["a", "b"], () => ({ a: null, c: "3" }));
  assert.deepEqual([...kv.entries].sort(), [["b", "2"], ["c", "3"]], "a deleted (not stored as null), c written, b untouched");
  await assert.rejects(kv.update(["b"], () => {
    throw new Error("no");
  }));
  await kv.update(["missing"], () => ({ missing: null })); // deleting a key that isn't there does nothing
  assert.deepEqual([...kv.entries].sort(), [["b", "2"], ["c", "3"]]);
});

test("indexedDbKeyValue.update: a key given null is deleted in the transaction, the others written", async () => {
  const data = new Map<string, unknown>([["a", "1"], ["b", "2"]]);
  const kv = indexedDbKeyValue("t", fakeIndexedDb({ error: null }, data));
  await kv.update(["a"], () => ({ a: null, c: "3" }));
  assert.deepEqual([...data].sort(), [["b", "2"], ["c", "3"]]);
});
