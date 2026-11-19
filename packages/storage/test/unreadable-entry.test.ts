// Issue #627 item 12 (lost-work hunt B, finding 2): unsaved changes in the journal that this build's reader refuses
// for a reason other than "newer" were deleted by recovery, where a newer build's are kept aside. A version number
// this build skips (a data version taken out of merge order, as nearly happened with SL #592) or a reader's bug would
// then destroy the person's unsaved work. Now an entry that is a project this build refuses is moved aside under
// UNREADABLE_PREFIX, said once, and tried again by every later visit (so a build that reads it puts it back); only text
// that is not a project at all (not JSON: damaged) is still removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { journalEntry, memoryKeyValue, projectStore, recoverUnsaved, unsavedKey, UNREADABLE_PREFIX, type JournalStorage } from "../src/index.ts";

function journal(): JournalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as JournalStorage & { map: Map<string, string> };
}
/** Design's part as a reader that refuses version 0 (not "newer": a plain error), as a version this build skips would be. */
const strict: DataReader = {
  id: "design",
  readData: (d) => {
    if ((d as { version?: number }).version === 0) throw new Error("Design data version 0 is not one this SpindleLabs reads");
    return d;
  },
};
const lenient: DataReader = { id: "design", readData: (d) => d };
const part = (version: number, width: number): Project => ({ ...emptyProject("Bracket"), workspaces: { design: { version, width } } });

test("#627 item 12: unsaved changes this build refuses (not newer) are kept aside, not deleted, and said", async () => {
  const j = journal();
  const raw = journalEntry(projectToJson(part(0, 70)), new Date(5000));
  j.setItem(unsavedKey("p1"), raw);
  const store = projectStore(memoryKeyValue(), [strict]);
  await store.save("p1", part(1, 40), new Date(1000));
  const said = await recoverUnsaved(store, j, [strict]);
  assert.equal(said.length, 1);
  assert.match(said[0], /couldn't be read, so the project is as it was last saved; they're kept in this browser/);
  assert.equal(j.map.has(unsavedKey("p1")), false, "out of the way of this build's autosave");
  const aside = [...j.map.keys()].filter((k) => k.startsWith(UNREADABLE_PREFIX));
  assert.equal(aside.length, 1);
  assert.equal(j.map.get(aside[0]), raw, "kept exactly as written");
  assert.deepEqual(await store.open("p1"), part(1, 40), "the stored project is as it was");
  // The next visit of the same build says nothing more and keeps it.
  assert.deepEqual(await recoverUnsaved(store, j, [strict]), []);
  assert.equal(j.map.get(aside[0]), raw);
});

test("#627 item 12: a build that reads the kept-aside entry puts it back over the project", async () => {
  const j = journal();
  j.setItem(unsavedKey("p1"), journalEntry(projectToJson(part(0, 70)), new Date(5000)));
  const kv = memoryKeyValue();
  await projectStore(kv, [strict]).save("p1", part(1, 40), new Date(1000));
  await recoverUnsaved(projectStore(kv, [strict]), j, [strict]);
  const store = projectStore(kv, [lenient]);
  assert.deepEqual(await recoverUnsaved(store, j, [lenient]), []);
  assert.deepEqual(await store.open("p1"), part(0, 70), "the kept change is back");
  assert.equal(j.map.size, 0);
});

test("#627 item 12: a second refused entry for the same project never overwrites the first one kept aside", async () => {
  const j = journal();
  const store = projectStore(memoryKeyValue(), [strict]);
  j.setItem(unsavedKey("p1"), journalEntry(projectToJson(part(0, 70)), new Date(5000)));
  await recoverUnsaved(store, j, [strict]);
  j.setItem(unsavedKey("p1"), journalEntry(projectToJson(part(0, 80)), new Date(6000)));
  await recoverUnsaved(store, j, [strict]);
  assert.equal([...j.map.keys()].filter((k) => k.startsWith(UNREADABLE_PREFIX)).length, 2);
});

test("control: text that is not a project at all (damaged) is still removed, as before", async () => {
  const j = journal();
  j.setItem(unsavedKey("p1"), "{ not json");
  const said = await recoverUnsaved(projectStore(memoryKeyValue(), [strict]), j, [strict]);
  assert.match(said[0], /couldn't be read, so the project is as it was last saved \(/);
  assert.equal(j.map.size, 0);
});
