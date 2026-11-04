// Every project kept in this browser reachable (projects.ts; round 2 hunt A2, A3): bringForward makes a project
// opened from the list the one a reload opens, touching nothing else; forget deletes one for good, journal and all.
// Hand-worked cases, the failures, and seeded sessions of saves, renames, opens from the list, deletes and new
// projects against a plain model of what the list must show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { bringForward, forget, journalEntry, memoryKeyValue, NEWER_PREFIX, projectStore, recoverUnsaved, unsavedKey, type JournalStorage, type KeyValue } from "../src/index.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (name: string, width: number): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });

/** A clock that moves one second on each read, from 2026-11-04 00:00 UTC. */
function ticking() {
  let t = Date.UTC(2026, 10, 4);
  return () => new Date((t += 1000));
}

function memoryJournal() {
  const items = new Map<string, string>();
  const journal: JournalStorage = {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  return { journal, items };
}

/** `kv` whose every update throws once `full` is set, as IndexedDB does when the browser's storage is full. */
function fillable(kv: KeyValue) {
  const state = { full: false };
  return {
    state,
    kv: { ...kv, update: (keys, change) => (state.full ? Promise.reject(new Error("QuotaExceededError")) : kv.update(keys, change)) } as KeyValue,
  };
}

test("hand-worked: bringing the oldest of three forward lists it first, same save time, next save number", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, [design], ticking());
  await store.save("a", part("A", 10)); // 00:00:01, save number 1
  await store.save("b", part("B", 20)); // 00:00:02, number 2
  await store.save("c", part("C", 30)); // 00:00:03, number 3
  const a = (await store.list()).find((s) => s.id === "a")!;
  const textBefore = kv.entries.get("project/a");
  assert.equal(await bringForward(store, "a", a.modified), true);
  // Saves 1, 2, 3 were counted, so bringing A forward is save number 4: above C's 3, so A lists first, then C, then B.
  // Its save time is the one handed in, 00:00:01 (Date.UTC(2026, 10, 4) + 1000 ms), not the clock's next tick.
  const list = await store.list();
  assert.deepEqual(list.map((s) => [s.id, s.order]), [["a", 4], ["c", 3], ["b", 2]]);
  assert.equal(list[0].modified.getTime(), Date.UTC(2026, 10, 4) + 1000);
  assert.equal(list[0].name, "A");
  assert.equal(kv.entries.get("project/a"), textBefore, "the project's text is exactly as it was");
});

test("bringForward leaves alone a project another save changed since it was opened, and says so", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, [design], ticking());
  await store.save("a", part("A", 10));
  await store.save("b", part("B", 20));
  const opened = (await store.list()).find((s) => s.id === "a")!.modified;
  await store.save("a", part("A", 99)); // another tab's newer work (save number 3)
  const before = new Map(kv.entries);
  assert.equal(await bringForward(store, "a", opened), false);
  assert.deepEqual(kv.entries, before, "nothing written: the newer work stands, and it is already first");
});

test("bringForward on full storage throws for the shell to say, and changes nothing", async () => {
  const { kv, state } = fillable(memoryKeyValue());
  const store = projectStore(kv, [design], ticking());
  await store.save("a", part("A", 10));
  await store.save("b", part("B", 20));
  const a = (await store.list()).find((s) => s.id === "a")!;
  state.full = true;
  await assert.rejects(bringForward(store, "a", a.modified), /QuotaExceededError/);
  assert.deepEqual((await store.list()).map((s) => s.id), ["b", "a"], "the order is as it was");
  assert.deepEqual(await store.open("a"), part("A", 10), "and the project too");
});

test("forget deletes the project and its journal entries, so the next visit can't bring it back", async () => {
  const store = projectStore(memoryKeyValue(), [design], ticking());
  const { journal, items } = memoryJournal();
  await store.save("a", part("A", 10));
  await store.save("b", part("B", 20));
  // A's last change, journalled as the page went, and one from a newer SpindleLabs: both A's.
  items.set(unsavedKey("a"), journalEntry(projectToJson(part("A", 11)), new Date(Date.UTC(2027, 0, 1))));
  items.set(NEWER_PREFIX + "a", "@1\n{}");
  items.set(unsavedKey("b"), journalEntry(projectToJson(part("B", 21)), new Date(Date.UTC(2027, 0, 1))));
  await forget(store, journal, "a");
  assert.deepEqual([...items.keys()], [unsavedKey("b")], "only B's entry is left");
  assert.deepEqual(await recoverUnsaved(store, journal, [design]), []);
  assert.deepEqual((await store.list()).map((s) => s.id), ["b"], "A stays deleted after the next visit's recovery");
});

test("deliberate break: deleting from the store alone, the next visit's recovery brings the project back", async () => {
  // Why forget clears the journal: this is what store.remove alone would do.
  const store = projectStore(memoryKeyValue(), [design], ticking());
  const { journal, items } = memoryJournal();
  await store.save("a", part("A", 10));
  items.set(unsavedKey("a"), journalEntry(projectToJson(part("A", 11)), new Date(Date.UTC(2027, 0, 1))));
  await store.remove("a");
  await recoverUnsaved(store, journal, [design]);
  assert.deepEqual((await store.list()).map((s) => s.id), ["a"], "back again");
});

test("forget refuses an id that isn't stored and leaves its journal entry", async () => {
  const store = projectStore(memoryKeyValue(), [design], ticking());
  const { journal, items } = memoryJournal();
  items.set(unsavedKey("x"), "@1\n{}");
  await assert.rejects(forget(store, journal, "x"), /no stored project "x"/);
  assert.equal(items.size, 1);
});

test("forget on full storage: a delete is a write too; refused, everything stays", async () => {
  // memoryKeyValue's delete never fails, so a store whose delete throws stands in for IndexedDB refusing.
  const kv = memoryKeyValue();
  const store = projectStore({ ...kv, delete: () => Promise.reject(new Error("storage failing")) }, [design], ticking());
  const { journal, items } = memoryJournal();
  await store.save("a", part("A", 10));
  items.set(unsavedKey("a"), "@1\n{}");
  await assert.rejects(forget(store, journal, "a"), /storage failing/);
  assert.equal(items.size, 1, "the journal entry stays with the project it belongs to");
  assert.deepEqual((await store.list()).map((s) => s.id), ["a"]);
});

test("forget with no journal, or one that throws (storage off), still deletes the project", async () => {
  const store = projectStore(memoryKeyValue(), [design], ticking());
  await store.save("a", part("A", 10));
  await store.save("b", part("B", 10));
  await forget(store, null, "a");
  const off = { ...memoryJournal().journal, removeItem: () => { throw new Error("SecurityError"); } };
  await forget(store, off, "b");
  assert.deepEqual(await store.list(), []);
});

/** Seeded: mulberry32, so a seed replays the same session. */
function random(seed: number) {
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
  test(`seeded session ${seed}: 1,000 saves, renames, opens from the list, deletes and new projects match the model`, async () => {
    const r = random(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const store = projectStore(memoryKeyValue(), [design], ticking());
    const { journal, items } = memoryJournal();
    // The model: what each kept project holds, and the order the list must show (most recently saved or opened first).
    const model = new Map<string, { name: string; width: number }>();
    let order: string[] = [];
    let open: string | null = null;
    let next = 0;
    const top = (id: string) => (order = [id, ...order.filter((x) => x !== id)]);
    for (let step = 0; step < 1000; step++) {
      const what = r();
      const ids = [...model.keys()];
      if (what < 0.15 || ids.length === 0) {
        const id = `p${next++}`; // a new project, kept on its first change
        const p = { name: pick(["Untitled", "Bracket", "Box"]), width: Math.floor(r() * 100) };
        await store.save(id, part(p.name, p.width));
        model.set(id, p);
        top(id);
        open = id;
      } else if (what < 0.45 && open !== null) {
        const p = { ...model.get(open)!, width: Math.floor(r() * 100) }; // an edit to the open project
        await store.save(open, part(p.name, p.width));
        model.set(open, p);
        top(open);
      } else if (what < 0.55 && open !== null) {
        const p = { ...model.get(open)!, name: `Part ${step}` }; // renamed
        await store.save(open, part(p.name, p.width));
        model.set(open, p);
        top(open);
      } else if (what < 0.85) {
        const id = pick(ids); // opened from the list
        const summary = (await store.list()).find((s) => s.id === id)!;
        assert.equal(await bringForward(store, id, summary.modified), true);
        top(id);
        open = id;
      } else {
        const others = ids.filter((id) => id !== open); // the list never deletes the open one
        if (others.length === 0) continue;
        const id = pick(others);
        items.set(unsavedKey(id), journalEntry(projectToJson(part("ghost", 1)), new Date(Date.UTC(2099, 0, 1)))); // an entry the delete must take too
        await forget(store, journal, id);
        model.delete(id);
        order = order.filter((x) => x !== id);
      }
      if (step % 50 === 49 || step === 999) {
        const list = await store.list();
        assert.deepEqual(list.map((s) => s.id), order, `seed ${seed} step ${step}: the list's order`);
        for (const s of list) {
          assert.equal(s.name, model.get(s.id)!.name, `seed ${seed} step ${step}: ${s.id}'s name`);
          assert.deepEqual(await store.open(s.id), part(model.get(s.id)!.name, model.get(s.id)!.width), `seed ${seed} step ${step}: ${s.id}'s contents`);
        }
        assert.equal(list[0]?.id ?? null, open, `seed ${seed} step ${step}: a reload opens the open project`);
      }
    }
    // A next visit's recovery brings back nothing deleted.
    await recoverUnsaved(store, journal, [design]);
    assert.deepEqual((await store.list()).map((s) => s.id), order, `seed ${seed}: after recovery`);
  });
}
