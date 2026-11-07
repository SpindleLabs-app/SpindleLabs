// Tests that kill the mutants the nightly TypeScript mutation run of 2026-11-04 found surviving in saving (issues
// #275 and #277; packages/testing/stryker/run.sh storage). Each test names the change to the code it catches. Mutants
// no caller can tell apart from the code are listed, with the reason, in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, NewerFormatError, projectToJson, type Project } from "@fission/core";
import { asideKey, journalEntry, memoryKeyValue, projectStore, readJournalEntry, recoverUnsaved, startAutosave, unsavedKey, type JournalStorage, type Timers } from "../src/index.ts";
import { asideKeysOf } from "../src/unsaved.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

/** A journal in memory, its keys in the order they were first set; `gone` makes key(i) answer null there. */
function fakeStorage(gone: (i: number) => boolean = () => false) {
  const items = new Map<string, string>();
  const s: JournalStorage & { items: Map<string, string> } = {
    items,
    get length() {
      return items.size;
    },
    key: (i) => (gone(i) ? null : ([...items.keys()][i] ?? null)),
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  return s;
}

test("asideKeysOf lists only the aside keys for that project, none for an empty journal (catches `keys` starting non-empty)", () => {
  const journal = fakeStorage();
  assert.deepEqual(asideKeysOf(journal, "p"), []);
  journal.setItem(asideKey("p", "w1"), "x");
  journal.setItem(asideKey("q", "w1"), "x");
  journal.setItem(unsavedKey("p"), "x");
  assert.deepEqual(asideKeysOf(journal, "p"), [asideKey("p", "w1")]);
});

test("asideKeysOf skips a key the storage no longer has (another tab removed it while the list was read: key(i) is null) (catches `k !== null` made true)", () => {
  const journal = fakeStorage((i) => i === 0);
  journal.setItem(asideKey("p", "w0"), "x"); // index 0: gone by the time it is read
  journal.setItem(asideKey("p", "w1"), "x");
  assert.deepEqual(asideKeysOf(journal, "p"), [asideKey("p", "w1")]);
});

test("hand-worked: recovery puts a tab's own entry back before the entries put aside for it, whatever order the journal lists them in (catches the sort removed or changed)", async () => {
  // The store holds 40 for p, saved at 1000. Two entries were made from that save: one put aside (another tab, w2,
  // width 30), listed first, and the tab's own (w1, width 20). Own first: 20 goes over the 1000 save, so p holds 20;
  // the aside one was made from 1000 too but p was saved since, so it is kept as a separate copy (30). The other order
  // would give p 30 and the copy 20.
  let t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(40), undefined, undefined, false, "w0");
  t = 2000;
  const journal = fakeStorage();
  journal.setItem(asideKey("p", "w2"), journalEntry(projectToJson(part(30)), new Date(1500), false, new Date(1000), "w2"));
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(20)), new Date(1400), false, new Date(1000), "w1"));
  const problems = await recoverUnsaved(store, journal, [], () => "copy");
  assert.equal(widthOf(await store.open("p")), 20, "the tab's own entry goes back over p");
  assert.equal(widthOf(await store.open("copy")), 30, "the aside one is kept as a copy");
  assert.equal(problems.length, 1);
  assert.equal(journal.items.size, 0);
});

test("the same with an unrelated project's entry listed between them: still the tab's own entry first (catches a one-sided sort)", async () => {
  // Listed: p's aside entry, q's own entry, p's own entry. However the sort pairs them, p's own (20) must go back
  // before p's aside one (30), and q's goes back too.
  let t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(40), undefined, undefined, false, "w0");
  t = 2000;
  const journal = fakeStorage();
  journal.setItem(asideKey("p", "w2"), journalEntry(projectToJson(part(30)), new Date(1500), false, new Date(1000), "w2"));
  journal.setItem(unsavedKey("q"), journalEntry(projectToJson(part(70)), new Date(1450), false, null, "w3"));
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(20)), new Date(1400), false, new Date(1000), "w1"));
  await recoverUnsaved(store, journal, [], () => "copy");
  assert.deepEqual([widthOf(await store.open("p")), widthOf(await store.open("copy")), widthOf(await store.open("q"))], [20, 30, 70]);
});

test("an entry put aside that a newer SpindleLabs wrote is kept where it is, silently (catches `aside !== null` made false)", async () => {
  // A newer build's unsaved-key entry is moved to the newer key and said once; one already put aside stays put and
  // says nothing (it was said, or will be, for the entry it was moved out of the way of).
  const store = projectStore(memoryKeyValue(), []);
  const journal = fakeStorage();
  const raw = journalEntry(projectToJson(part(30)), new Date(1500), false, null, "w2");
  journal.setItem(asideKey("p", "w2"), raw);
  const refuses = [{ id: "design" as const, readData: () => { throw new NewerFormatError("Design data version 99 is from a newer SpindleLabs"); } }];
  assert.deepEqual(await recoverUnsaved(store, journal, refuses), []);
  assert.deepEqual([...journal.items.entries()], [[asideKey("p", "w2"), raw]]);
});

test("a save landing leaves an entry this autosave never journalled as it was, even one with no writer (catches `journalVersion === null` made false)", async () => {
  // This autosave starts with no entry and never journals (its change is stored within the quiet moment, nothing
  // leaves). While its save is waiting, an entry with no writer named appears under the key (an older build's tab,
  // which names no writer and so reads as this tab's own key), made from save time 500: not this autosave's writing,
  // so its save landing must not move it onto the new save.
  let t = 0;
  const pending: (() => void)[] = [];
  const timers: Timers = { setTimeout: (fn) => (pending.push(fn), pending.length), clearTimeout: () => {} };
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  const journal = fakeStorage();
  const raw = journalEntry(projectToJson(part(46)), new Date(400), false, new Date(500));
  let p = part(40);
  const tab = startAutosave(store, "p", () => p, () => {}, { timers, journal, now: () => new Date(t) });
  p = part(45);
  tab.changed();
  journal.setItem(unsavedKey("p"), raw);
  t = 1000;
  pending.shift()!(); // the quiet moment ends: the save starts
  await settle();
  assert.equal(widthOf(await store.open("p")), 45);
  assert.equal(journal.items.get(unsavedKey("p")), raw, "untouched");
  assert.equal(readJournalEntry(raw).base?.getTime(), 500);
  tab.stop();
});
