// Lost-work hunt 11-12 (B): once main writes Design data version 18, a build reading 19 must open
// a version 18 project and put back an unsaved-changes entry at 18. Were 18 refused as a plain error
// (not "newer"), the project couldn't open and recovery would delete that entry (packages/storage
// unsaved.ts, the "couldn't be read" branch), losing the user's last changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import { readDesignDocument } from "@fission/design";
import { journalEntry, memoryKeyValue, projectStore, recoverUnsaved, unsavedKey, type JournalStorage } from "@fission/storage";

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];

/** A Design part at data version `version`, with `nextId` telling two states apart. */
const part = (version: number, nextId: number): Project => ({
  ...emptyProject("Box"),
  workspaces: { design: { version, nextId, profiles: [], sketches: [], timeline: { features: [] } } },
});

function journal() {
  const items = new Map<string, string>();
  const j = {
    items,
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
  return j satisfies JournalStorage;
}

const nextIdOf = (p: Project) => (p.workspaces.design as { nextId: number }).nextId;

test("a version 18 Design project opens, read up to version 21", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, DESIGN);
  await store.save("p", part(18, 5), new Date(1000));
  const opened = await store.open("p");
  assert.equal((opened.workspaces.design as { version: number }).version, 21);
  assert.equal(nextIdOf(opened), 5);
});

test("an unsaved-changes entry at version 18 is put back, never deleted as unreadable", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, DESIGN);
  await store.save("p", part(18, 5), new Date(1000));
  const j = journal();
  // Written after the stored save (t = 2000 > 1000), so recovery puts it back: nextId 5 -> 7.
  j.setItem(unsavedKey("p"), journalEntry(projectToJson(part(18, 7)), new Date(2000)));
  assert.deepEqual(await recoverUnsaved(store, j, DESIGN), []);
  assert.equal(nextIdOf(await store.open("p")), 7);
  assert.equal(j.items.size, 0, "the entry goes only once the store holds it");
});

test("control: an entry from a version newer than 21 is kept aside as newer, not deleted", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, DESIGN);
  await store.save("p", part(18, 5), new Date(1000));
  const j = journal();
  j.setItem(unsavedKey("p"), journalEntry(projectToJson(part(22, 7)), new Date(2000)));
  const problems = await recoverUnsaved(store, j, DESIGN);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /made by a newer SpindleLabs/);
  assert.equal(nextIdOf(await store.open("p")), 5);
  assert.equal(j.items.size, 1, "kept for the newer build");
});
