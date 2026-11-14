// Tests that kill the mutants the nightly TypeScript mutation run of
// 2026-11-11 found surviving in the save/load hunt C fixes (SpindleLabs #275
// and #276; run packages/testing/stryker/run.sh storage). Each test names the
// change to the code it catches. The mutants no caller can tell apart from the
// code are listed, with the reason, in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import { forget, journalEntry, memoryKeyValue, putAsideOthers, projectStore, readJournalEntry, startAutosave, unsavedKey, versionedStore, type JournalStorage, type Timers } from "../src/index.ts";
import { ProjectDeletedError } from "../src/store.ts";

const part = (width: number, name = "Box"): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
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

function fakeStorage(): JournalStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

test("a save refused because another tab deleted the project says so by name (kills store.ts \"ProjectDeletedError\" => \"\")", async () => {
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = versionedStore(projectStore(kv, [], clock.now), kv, []);
  await store.save("p", part(40));
  await forget(store, fakeStorage(), "p"); // the other tab's Delete
  const refused = await store.save("p", part(45), undefined, new Date(0)).then(() => null, (e: unknown) => e);
  assert.ok(refused instanceof ProjectDeletedError);
  assert.equal(refused.name, "ProjectDeletedError");
});

test("a summary that holds a name is a project's, even with a deleted field beside it (kills store.ts \"name\" => \"\")", async () => {
  // A deletion mark is { deleted } alone (store.ts remove). A hand-edited or damaged summary with both fields is still
  // the summary of a stored project, so the project stays listed and opens; the mutant `"" in s` took it for a mark.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await store.save("p", part(40), new Date(1000));
  const summary = JSON.parse((await kv.get("summary/p"))!) as Record<string, unknown>;
  await kv.set("summary/p", JSON.stringify({ ...summary, deleted: "2026-11-11T00:00:00.000Z" }));
  assert.deepEqual((await store.list()).map((s) => s.id), ["p"]);
});

test("a refused tab's kept copy never takes the entry another tab journalled under the project's key since (guards dropOwnEntries' writer check)", async () => {
  // Worked by hand: stored 40 at save time 0. Tab B saves 60 (t = 1000); tab A, still on 40, changes to 25 and is refused
  // (t = 2100). A's leaving() journals 25 under the key "p", writer tabA. B then changes to 70 and its page goes with that
  // journalled under "p" (writer tabB), A's entry moved aside first (putAsideOthers), and not stored. A opens another project: finish() stores 25 as
  // "Box (kept copy)" and drops A's own entries. Only an entry naming tabA is A's: B's 70 under "p" must stay, or B's
  // unsaved change is lost. Replacing the check by `true` removes it (that mutant is killed elsewhere too; this states the case).
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  let copies = 0;
  const tabA = startAutosave(store, "p", () => a, () => {}, { ...opts, writer: "tabA", newId: () => `copy-${++copies}` });
  const tabB = startAutosave(store, "p", () => b, () => {}, { ...opts, writer: "tabB" });
  b = part(60);
  tabB.changed();
  await clock.advance(1100);
  a = part(25);
  tabA.changed();
  await clock.advance(1100);
  assert.equal(tabA.refused(), true, "refused() says so, as a boolean (kills autosave.ts `() => conflicted` => `() => undefined`)");
  assert.equal(tabA.leaving(), true);
  assert.equal(readJournalEntry(journal.items.get(unsavedKey("p"))!).writer, "tabA");
  // B's page goes with its 70 journalled and not stored (what its leaving() writes when its save never lands).
  tabB.stop();
  putAsideOthers(journal, "p", "tabB");
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(70)), new Date(2200), false, new Date(1000), "tabB"));
  assert.equal(readJournalEntry(journal.items.get(unsavedKey("p"))!).writer, "tabB", "B's entry took the key");
  assert.equal(tabA.finish(), "Box (kept copy)");
  await tabA.settled();
  await settle();
  const left = journal.items.get(unsavedKey("p"));
  assert.notEqual(left, undefined, "B's entry is still there");
  const read = readJournalEntry(left!);
  assert.deepEqual([read.writer, (JSON.parse(read.text) as Project).workspaces.design], ["tabB", { version: 1, width: 70 }]);
  assert.deepEqual([...journal.items.keys()].filter((k) => k.includes("tabA")), [], "A's own entries went");
});

test("a tab that knows no stored state, held back by the last visit's kept changes, journals nothing and asks before going (kills autosave.ts `conflicted || keptFromLastVisit()` => false or &&, and `refused && base === undefined` => false)", async () => {
  // Worked by hand: no storedAt, so this autosave's base is undefined. The journal holds the last visit's kept 50
  // ("@900!"), so no save may go over it: the change is refused. An entry naming no stale state would be put back over
  // anything next visit, so leaving() writes none (the kept entry stays exactly as it was, nothing goes aside) and says
  // false: the page must ask. With either mutant `refused` is false here and the change goes aside, leaving() true.
  const store = projectStore(memoryKeyValue(), []);
  const journal = fakeStorage();
  const kept = journalEntry(projectToJson(part(50)), new Date(900), true);
  journal.items.set(unsavedKey("p"), kept);
  let project = part(40);
  const timers: Timers = { setTimeout: () => 1, clearTimeout: () => {} };
  const a = startAutosave(store, "p", () => project, () => {}, { journal, timers, now: () => new Date(1000), writer: "tabA" });
  project = part(41);
  a.changed();
  assert.equal(a.leaving(), false);
  assert.deepEqual([...journal.items], [[unsavedKey("p"), kept]]);
  a.stop();
});
