// Issue #627 items 5 and 9, #643 item 3: projects only the journal holds (storage full when they were opened) are
// listed (`listWithHeld`) and can be deleted (`forget`); a project opened from a list is paired with the save time of
// exactly the state read (`openAsStored`), never the time an older list showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { forget, heldProjects, journalEntry, listWithHeld, memoryKeyValue, openAsStored, projectStore, unsavedKey, UNREADABLE_PREFIX, type JournalStorage, type ProjectStore } from "../src/index.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (width: number, name = "Box"): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
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
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 3, minutes));

test("hand-worked: a held project written at 3:05 lists between one touched at 3:10 and one at 3:00; a plain entry and a stored one's are not listed", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, [design], () => at(30));
  // Each saved with the clock at its own time, so "touched" (the home screen's last opened) is 3:00 and 3:10.
  await projectStore(kv, [design], () => at(0)).save("old", part(1, "Old"), at(0));
  await projectStore(kv, [design], () => at(10)).save("new", part(2, "New"), at(10));
  const j = journal();
  j.setItem(unsavedKey("file"), journalEntry(projectToJson(part(9, "Bracket")), at(5), true)); // kept: storage full
  j.setItem(unsavedKey("plain"), journalEntry(projectToJson(part(8, "Plain")), at(6))); // not kept: recovery's to put back
  j.setItem(unsavedKey("new"), journalEntry(projectToJson(part(3, "New")), at(20), true)); // a stored project's newer state
  // New (touched 3:10) > Bracket (written 3:05) > Old (touched 3:00).
  const rows = await listWithHeld(store, j);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.held ?? false]), [["new", "New", false], ["file", "Bracket", true], ["old", "Old", false]]);
  assert.deepEqual(heldProjects(j).map((h) => h.id), ["new", "file"], "newest first");
});

test("a held project newer than everything lists first; with nothing stored it is the only row", async () => {
  const store = projectStore(memoryKeyValue(), [design]);
  const j = journal();
  j.setItem(unsavedKey("file"), journalEntry(projectToJson(part(9, "Bracket")), at(5), true));
  assert.deepEqual((await listWithHeld(store, j)).map((r) => r.id), ["file"]);
  assert.deepEqual((await listWithHeld(store, null)).map((r) => r.id), [], "no journal: nothing held");
});

test("forget deletes a held-only project by its entries, and a project's entries kept for a later build go with it", async () => {
  const kv = memoryKeyValue();
  const store = projectStore(kv, [design]);
  const j = journal();
  j.setItem(unsavedKey("file"), journalEntry(projectToJson(part(9)), at(5), true));
  await forget(store, j, "file");
  assert.equal(j.map.size, 0);
  await assert.rejects(forget(store, j, "nothing"), /no stored project "nothing"/, "an id held nowhere is still refused");
  await store.save("p", part(1));
  j.setItem(`${UNREADABLE_PREFIX}p/5000`, journalEntry(projectToJson(part(0)), at(5)));
  await forget(store, j, "p");
  assert.equal(j.map.size, 0, "the kept-aside entry would otherwise bring the deleted project back with a later build");
});

test("#627 item 9: openAsStored pairs the state with its own save time even when a save lands while it opens", async () => {
  const kv = memoryKeyValue();
  const inner = projectStore(kv, [design]);
  await inner.save("p", part(1), at(0));
  let landed = false;
  // A store whose first open is overtaken by a save (the last project's save landing, or another tab's).
  const racing: ProjectStore = {
    ...inner,
    async open(id) {
      const p = await inner.open(id);
      if (!landed) {
        landed = true;
        await inner.save("p", part(2), at(1));
      }
      return p;
    },
  };
  const { project, modified } = await openAsStored(racing, "p");
  // The first try read width 1 between times 3:00 and 3:01: refused; the second reads width 2 at 3:01 both sides.
  assert.deepEqual(project, part(2));
  assert.deepEqual(modified, at(1));
});

test("openAsStored: a time that moves at every try is refused in words, never paired with the wrong state", async () => {
  const kv = memoryKeyValue();
  const inner = projectStore(kv, [design]);
  await inner.save("p", part(1), at(0));
  let n = 1;
  const busy: ProjectStore = { ...inner, async open(id) { const p = await inner.open(id); await inner.save("p", part(++n), at(n)); return p; } };
  await assert.rejects(openAsStored(busy, "p"), /kept being saved by another tab/);
});
