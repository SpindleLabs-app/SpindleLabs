// A save's conflict check and its writes are one step (real-use hunt B6, B7):
// they were three, so a tab paused between its check and its write stored
// over another tab's newer save with no message in either, and a tab killed
// between the project write and the summary write left a project stored but
// never listed. The store now saves through KeyValue.update, which reads and
// writes in one go (one readwrite IndexedDB transaction in the browser:
// e2e/storage.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project } from "@fission/core";
import { memoryKeyValue, ProjectChangedError, projectStore, type KeyValue } from "../src/index.ts";

const part = (w: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width: w } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;

test("two tabs saving from the same stored state at once: one is stored, the other refused (worked by hand)", async () => {
  // Stored 40 at 1000. Tab A saves 45 and tab B 70, both expecting the store to hold the state of 1000: whichever
  // goes first changes the save time, so the other's check must fail; neither may land silently over the other.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await store.save("p", part(40), new Date(1000));
  const base = new Date(1000);
  const outcomes = await Promise.all([
    store.save("p", part(45), new Date(2000), base).then(() => "stored", (e) => (e instanceof ProjectChangedError ? "refused" : String(e))),
    store.save("p", part(70), new Date(3000), base).then(() => "stored", (e) => (e instanceof ProjectChangedError ? "refused" : String(e))),
  ]);
  assert.deepEqual(outcomes, ["stored", "refused"]);
  assert.equal(widthOf(await store.open("p")), 45);
  assert.equal((await store.list())[0].modified.getTime(), 2000, "the summary is A's");
});

test("a save that can't finish writes nothing: never a project without its summary", async () => {
  // As a tab killed mid-save, or a full disk: the KeyValue's separate writes fail after the first (the old path).
  const kv = memoryKeyValue();
  const dying: KeyValue = {
    ...kv,
    set: async (k, v) => {
      if (k.startsWith("summary/")) throw new Error("tab killed");
      return kv.set(k, v);
    },
  };
  await projectStore(dying, []).save("n", part(10)).catch(() => {});
  const stored = [...kv.entries.keys()].filter((k) => k.startsWith("project/")).map((k) => k.slice("project/".length));
  const listed = (await projectStore(kv, []).list()).map((s) => s.id);
  assert.deepEqual(stored, listed, "every stored project is listed");
});

test("memoryKeyValue.update: reads the keys, writes what change returns, and writes nothing when it throws", async () => {
  const kv = memoryKeyValue();
  await kv.set("a", "1");
  await kv.update(["a", "b"], ([a, b]) => {
    assert.deepEqual([a, b], ["1", undefined]);
    return { a: "2", c: "3" };
  });
  assert.deepEqual([...kv.entries].sort(), [["a", "2"], ["c", "3"]]);
  await assert.rejects(
    kv.update(["a"], () => {
      throw new ProjectChangedError();
    }),
    ProjectChangedError,
  );
  assert.deepEqual([...kv.entries].sort(), [["a", "2"], ["c", "3"]]);
});

test("a project whose entries were cleared under the tab (site data cleared) is saved again, not refused as another tab's change", async () => {
  // Real-use hunt B4: once reconnected, the first save found no summary and threw ProjectChangedError, so autosave
  // stopped for good ("changed in another tab") and the page's journal refused to keep the work.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await store.save("p", part(40), new Date(1000));
  kv.entries.clear(); // the browser emptied the database
  await store.save("p", part(45), new Date(2000), new Date(1000));
  assert.equal(widthOf(await store.open("p")), 45);
  // A summary that is there but can't be read, or holds another time, still refuses.
  await kv.set("summary/p", "{ cut sh");
  await assert.rejects(store.save("p", part(50), new Date(3000), new Date(2000)), ProjectChangedError);
});

// ---- Deleting when the store is full (export hunt 2026-11-12, SL #643 item 2) ----

/**
 * `kv` as Chromium is once the origin is over its quota (measured in the hunt on raw IndexedDB): any step that
 * holds a write is refused, even one that makes the store smaller; a step of deletes only goes through.
 * `room` says whether writes are let through again once something was deleted (true: the delete freed room).
 */
function fullKeyValue(kv: KeyValue, room: boolean): KeyValue & { freed: boolean } {
  const full = () => new Error("browser storage is full: can't save this project (use Save to keep your work as a file)");
  const state = {
    ...kv,
    freed: false,
    set: (k: string, v: string) => (state.freed && room ? kv.set(k, v) : Promise.reject(full())),
    update: (keys: readonly string[], change: (values: (string | undefined)[]) => Record<string, string | null>) =>
      kv.update(keys, (values) => {
        const changes = change(values);
        const writes = Object.values(changes).some((v) => v !== null);
        if (writes && !(state.freed && room)) throw full();
        if (!writes && Object.keys(changes).length > 0) state.freed = true;
        return changes;
      }),
  };
  return state;
}

test("storage full: a project can still be deleted to make room, and it stays deleted for a tab that had it open", async () => {
  const kv = memoryKeyValue();
  const plain = projectStore(kv, []);
  await plain.save("old", part(40), new Date(1000));
  await plain.save("keep", part(70), new Date(2000));
  const store = projectStore(fullKeyValue(kv, true), []);
  // The store is full: a save is refused, in the store's words.
  await assert.rejects(store.save("keep", part(71), new Date(3000)), /browser storage is full/);
  await store.remove("old");
  assert.deepEqual((await store.list()).map((s) => s.id), ["keep"], "the deleted project is not listed");
  await assert.rejects(store.open("old"));
  assert.equal(kv.entries.has("project/old"), false, "its text is gone: the room is free");
  // The deletion mark is written once the delete made room, so a tab that still shows it can't put it back.
  await assert.rejects(plain.save("old", part(41), new Date(4000), new Date(1000)), ProjectChangedError);
  // And with room again, the save that was refused goes through.
  await store.save("keep", part(71), new Date(5000));
  assert.equal(widthOf(await plain.open("keep")), 71);
});

test("storage full and still no room for the mark: the project is deleted all the same, whole", async () => {
  const kv = memoryKeyValue();
  const plain = projectStore(kv, []);
  await plain.save("old", part(40), new Date(1000));
  await plain.save("keep", part(70), new Date(2000));
  const store = projectStore(fullKeyValue(kv, false), []);
  await store.remove("old");
  assert.deepEqual((await plain.list()).map((s) => s.id), ["keep"]);
  assert.equal(kv.entries.has("project/old"), false);
  assert.equal(kv.entries.has("summary/old"), false, "no half: neither its text nor a listing is left");
  assert.equal(widthOf(await plain.open("keep")), 70, "the other project is untouched");
});

test("storage full: deleting a project that is not there is still refused in words, and a failure that is not 'full' is passed on", async () => {
  const kv = memoryKeyValue();
  await projectStore(kv, []).save("keep", part(70), new Date(2000));
  await assert.rejects(projectStore(fullKeyValue(kv, true), []).remove("nothing"), /there is no stored project "nothing" to remove/);
  const broken: KeyValue = { ...kv, update: () => Promise.reject(new Error("browser storage failed: can't save this project (UnknownError: disk)")) };
  await assert.rejects(projectStore(broken, []).remove("keep"), /browser storage failed/);
  assert.equal(kv.entries.has("project/keep"), true, "nothing was deleted by another route");
});
