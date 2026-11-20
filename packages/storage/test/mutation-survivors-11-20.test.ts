// Mutation survivors of the 2026-11-19 nightly (SL #275 autosave.ts, #277 unsaved.ts) after #863's lost-work fixes:
// the save times a tab counts as its own, projects only the journal holds, entries kept aside for a later build and
// what counts as damaged text. Each test pins a rule a mutant broke without any test noticing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { heldProjects, journalEntry, memoryKeyValue, projectStore, recoverUnsaved, startAutosave, unsavedKey, UNREADABLE_PREFIX, type JournalStorage, type Timers } from "../src/index.ts";
import { unreadableKeysOf } from "../src/unsaved.ts";

const part = (width: number, name = "Box"): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
const settle = () => new Promise<void>((r) => setImmediate(r));
function fakeClock() {
  let t = 0;
  let next = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = { setTimeout: (fn, ms) => (pending.set(++next, { at: t + ms, fn }), next), clearTimeout: (h) => void pending.delete(h as number) };
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

/** A journal over a list of [key, value] pairs, in order; a null key stands for a slot another tab emptied meanwhile. */
function journal(pairs: [string | null, string][] = []): JournalStorage & { map: Map<string, string> } {
  const slots = [...pairs];
  const map = new Map<string, string>(pairs.filter((p): p is [string, string] => p[0] !== null));
  return {
    map,
    get length() {
      return slots.length;
    },
    key: (i: number) => slots[i]?.[0] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (!map.has(k)) slots.push([k, v]);
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
      const i = slots.findIndex((s) => s[0] === k);
      if (i >= 0) slots.splice(i, 1);
    },
  } as JournalStorage & { map: Map<string, string> };
}
const ms = (dates: readonly Date[]) => dates.map((d) => d.getTime());

test("hand-worked: a tab's own save times are the stored one it knows, the one it wrote, and its last 8 saves started", async () => {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  await store.save("p", part(40), new Date(0));
  let shown = part(40);
  const tab = startAutosave(store, "p", () => shown, () => {}, { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now, writer: "tab-a" });
  // Opened over the save of t = 0: that is the only time it knows.
  assert.deepEqual(ms(tab.ownTimes()), [0]);
  // A change at t = 1000 is saved after the quiet second, at t = 2000: the stored time it now knows (2000), the time
  // of the text it wrote (2000) and the save it started (2000).
  await clock.advance(1000);
  shown = part(41);
  tab.changed();
  await clock.advance(1500);
  assert.deepEqual(ms(tab.ownTimes()), [2000, 2000, 2000]);
  // Nine more changes, each 1000 ms after the last save landed and saved 1000 ms later: saves start at 2000, 4500, …,
  // 24500 (2000 + 2500 k). Only the last 8 started are kept: 7000 to 24500.
  for (let k = 1; k <= 9; k++) {
    await clock.advance(1000);
    shown = part(41 + k);
    tab.changed();
    await clock.advance(1500);
  }
  assert.deepEqual(ms(tab.ownTimes()), [24500, 24500, 7000, 9500, 12000, 14500, 17000, 19500, 22000, 24500]);
});

test("a tab with a project never stored has no save times of its own until its first save", async () => {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  let shown = part(1);
  const tab = startAutosave(store, "q", () => shown, () => {}, { timers: clock.timers, now: clock.now });
  assert.deepEqual(ms(tab.ownTimes()), []);
  await clock.advance(500);
  shown = part(2);
  tab.changed();
  await clock.advance(1500);
  // Changed at 500, saved at 1500: known, written and started at 1500.
  assert.deepEqual(ms(tab.ownTimes()), [1500, 1500, 1500]);
});

test("held projects: only kept entries under the journal's own prefix, with a project id, are listed", () => {
  const kept = (name: unknown) => journalEntry(JSON.stringify({ ...JSON.parse(projectToJson(part(1))), name }), new Date(5000), true);
  const j = journal([
    [null, ""], // a slot emptied by another tab while this one reads: skipped, the rest still read
    ["panoshape.unsaved/", kept("No id")], // the prefix alone names no project
    ["panoshape.unsaved-aside/tab-b/p", kept("Aside")], // another prefix: not a held project
    [unsavedKey("a"), kept("Bracket")],
    [unsavedKey("b"), kept(7)], // a name that is not text: listed as Untitled ("")
    [unsavedKey("c"), journalEntry("{ damaged", new Date(4000), true)], // can't be read: listed, no name
  ]);
  assert.deepEqual(
    heldProjects(j).map((h) => [h.id, h.name]),
    [
      ["a", "Bracket"],
      ["b", ""],
      ["c", ""],
    ],
  );
});

test("unreadable keys: only `<prefix><id>/<ms>` keys of that id, read past a slot emptied meanwhile", () => {
  const j = journal([
    [null, ""],
    [`${UNREADABLE_PREFIX}junk`, "x"], // no time: no id at all
    [`${UNREADABLE_PREFIX}p1/5000x`, "x"], // not ending in the time: not p1's
    [`${UNREADABLE_PREFIX}q\np1/5000`, "x"], // the id is the whole rest of the key: "q\np1", not p1
    [`${"z".repeat(UNREADABLE_PREFIX.length)}p1/5000`, "x"], // another key as long as the prefix: not p1's
    [`${UNREADABLE_PREFIX}p1/5000`, "x"],
    [`${UNREADABLE_PREFIX}p2/6000`, "x"],
  ]);
  assert.deepEqual(unreadableKeysOf(j, "p1"), [`${UNREADABLE_PREFIX}p1/5000`]);
  assert.deepEqual(unreadableKeysOf(journal(), "p1"), []);
});

/** Design's part as a reader that refuses every version but 1 (a plain error, not "newer"). */
const strict: DataReader = {
  id: "design",
  readData: (d) => {
    if ((d as { version?: number }).version !== 1) throw new Error("not a Design version this SpindleLabs reads");
    return d;
  },
};

test("a refused project is kept aside under the exact key `panoshape.unsaved-unreadable/<id>/<written ms>`, 0 with no time", async () => {
  const refused = projectToJson({ ...part(70), workspaces: { design: { version: 0, width: 70 } } });
  const j = journal([[unsavedKey("p1"), journalEntry(refused, new Date(5000))]]);
  await recoverUnsaved(projectStore(memoryKeyValue(), [strict]), j, [strict]);
  assert.deepEqual([...j.map.keys()], ["panoshape.unsaved-unreadable/p1/5000"]);
  // An entry with no head (no time written): kept under time 0.
  const bare = journal([[unsavedKey("p2"), refused]]);
  await recoverUnsaved(projectStore(memoryKeyValue(), [strict]), bare, [strict]);
  assert.deepEqual([...bare.map.keys()], ["panoshape.unsaved-unreadable/p2/0"]);
});

test("text that is JSON but not an object (a number, null, a list) is damaged: removed, not kept aside", async () => {
  for (const text of ["5", "null", "[1]"]) {
    const j = journal([[unsavedKey("p1"), journalEntry(text, new Date(5000))]]);
    const said = await recoverUnsaved(projectStore(memoryKeyValue(), [strict]), j, [strict]);
    assert.equal(said.length, 1, text);
    assert.equal(j.map.size, 0, `${text} removed`);
  }
});
