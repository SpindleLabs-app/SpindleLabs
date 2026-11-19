// Issue #510 item 5: with storage full, a project's versions were deleted to make room and the save was tried again;
// in Chromium a delete does not give its room back straight away (measured in the save/load hunt: usage went up after
// deleting ten 20 KB entries, and a 30 KB write was still refused 40 s later), so the save was still refused and the
// versions were gone for nothing. Now versions given up for a retry that is still refused are put back, and when even
// that is refused (the store still full) this tab holds them and writes them back after the next save that goes
// through. Tested on a store that, like Chromium, counts deleted entries against its room until it is compacted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { memoryKeyValue, projectStore, versionedStore, type KeyValue } from "../src/index.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (width: number, note = ""): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width, note } } });
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 19, 3, 0);
const full = () => new Error("browser storage is full: can't save the project (use Save to keep your work as a file)");

/**
 * `room` characters of values, where a deleted value keeps taking its room until `compact()` (Chromium's store frees a
 * delete's room only later). Every write past the room is refused as IndexedDB refuses it when full; deletes alone go.
 */
function chromiumLike(room: number) {
  const kv = memoryKeyValue();
  let freed = 0; // deleted characters not given back yet
  const used = (writes: Record<string, string | null>) => {
    const all = new Map(kv.entries);
    for (const [k, v] of Object.entries(writes)) if (v === null) all.delete(k);
    else all.set(k, v);
    return [...all.values()].reduce((n, v) => n + v.length, 0) + freed;
  };
  const gone = (k: string) => (freed += kv.entries.get(k)?.length ?? 0);
  const limited: KeyValue = {
    ...kv,
    set: async (k, v) => {
      if (used({ [k]: v }) > room) throw full();
      await kv.set(k, v);
    },
    delete: async (k) => {
      gone(k);
      await kv.delete(k);
    },
    update: async (keys, change) => {
      await kv.update(keys, (values) => {
        const writes = change(values);
        const onlyDeletes = Object.values(writes).every((v) => v === null);
        if (!onlyDeletes && used(writes) > room) throw full();
        for (const [k, v] of Object.entries(writes)) if (v === null) gone(k);
        return writes;
      });
    },
  };
  return { kv: limited, entries: kv.entries, compact: () => void (freed = 0) };
}

function setup(kv: KeyValue) {
  const clock = { minutes: 0 };
  const now = () => new Date(T0 + clock.minutes * MIN);
  const store = versionedStore(projectStore(kv, [design], now), kv, [design], { gapMs: 0 });
  const at = (minutes: number) => (clock.minutes = minutes);
  const kept = async () => (await store.versions("p")).map((d) => (d.getTime() - T0) / MIN);
  return { store, at, kept };
}

test("#510 item 5: storage full and the retry still refused: the versions are not thrown away", async () => {
  const one = projectToJson(part(1)).length;
  const { kv, entries } = chromiumLike(one * 6);
  const { store, at, kept } = setup(kv);
  for (let i = 0; i < 4; i++) {
    at(i);
    await store.save("p", part(i)); // each replaced state kept (gap 0): versions 0, 1, 2
  }
  // Worked by hand: project 3 (one) + summary + order + versions 0, 1, 2 (three × one) is just over 4 × one; a project
  // three × one bigger needs about 7 × one beside the versions and still 4 × one alone, more than the 6 × one of room
  // while the deleted versions' room is not given back.
  assert.deepEqual(await kept(), [2, 1, 0]);
  at(10);
  const big = part(9, "x".repeat(one * 3));
  await assert.rejects(store.save("p", big), /storage is full/);
  assert.deepEqual(await store.open("p"), part(3), "the refused save wrote nothing");
  assert.deepEqual(await kept(), [2, 1, 0], "the versions are still there");
  for (const t of [0, 1, 2]) assert.deepEqual(await store.openVersion("p", new Date(T0 + t * MIN)), part(t), `version ${t} opens as it was`);
  // While the store holds them only in this tab, they are written back once a save goes through.
  void entries;
});

test("#510 item 5: versions this tab holds while the store is full are written back after the next save that goes through", async () => {
  const one = projectToJson(part(1)).length;
  const { kv, entries, compact } = chromiumLike(one * 6);
  const { store, at, kept } = setup(kv);
  for (let i = 0; i < 4; i++) {
    at(i);
    await store.save("p", part(i));
  }
  at(10);
  await assert.rejects(store.save("p", part(9, "x".repeat(one * 3))), /storage is full/);
  compact(); // the browser gives the deleted room back
  at(11);
  await store.save("p", part(5)); // a smaller state, which fits
  assert.deepEqual(await store.open("p"), part(5));
  assert.deepEqual(await kept(), [3, 2, 1, 0], "the state it replaced is kept, and the three held versions are back");
  assert.ok([...entries.keys()].filter((k) => k.startsWith("version/p/")).length === 4, "all four are in the store, not only in this tab");
});

test("#510 item 5: a project deleted while its versions are held never gets them back", async () => {
  const one = projectToJson(part(1)).length;
  const { kv, entries, compact } = chromiumLike(one * 6);
  const { store, at, kept } = setup(kv);
  for (let i = 0; i < 4; i++) {
    at(i);
    await store.save("p", part(i));
  }
  at(10);
  await assert.rejects(store.save("p", part(9, "x".repeat(one * 3))), /storage is full/);
  await store.remove("p");
  compact();
  at(11);
  await store.save("q", part(1)); // another project's save goes through
  assert.deepEqual(await kept(), []);
  assert.equal([...entries.keys()].some((k) => k.startsWith("version/p/")), false);
});

test("control: when giving the versions up does make room (the store frees it at once), the save goes through as before", async () => {
  const one = projectToJson(part(1)).length;
  const kv = memoryKeyValue();
  const used = (w: Record<string, string | null>) => {
    const all = new Map(kv.entries);
    for (const [k, v] of Object.entries(w)) if (v === null) all.delete(k);
    else all.set(k, v);
    return [...all.values()].reduce((n, v) => n + v.length, 0);
  };
  const room = one * 6;
  const limited: KeyValue = {
    ...kv,
    set: async (k, v) => {
      if (used({ [k]: v }) > room) throw full();
      await kv.set(k, v);
    },
    update: async (keys, change) =>
      kv.update(keys, (values) => {
        const w = change(values);
        if (Object.values(w).some((v) => v !== null) && used(w) > room) throw full();
        return w;
      }),
  };
  const { store, at, kept } = setup(limited);
  for (let i = 0; i < 4; i++) {
    at(i);
    await store.save("p", part(i));
  }
  at(10);
  const big = part(9, "x".repeat(one * 3));
  await store.save("p", big);
  assert.deepEqual(await store.open("p"), big);
  assert.ok((await kept()).length <= 1, "the old versions gave way for the save");
});
