// Export hunt 2026-11-12, #642 item 4: two windows both on screen; the stale one is edited and hidden within a second,
// before its save is refused, and its undo steps were written over the good tab's (which then had "Nothing to undo"
// after a reload). Steps are now written with the writing tab's own save times (`Autosave.ownTimes`) and only over a
// store holding one of them (`StepsStore.write`'s `own`), checked in the same step as the write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project, type SavedHistory } from "@fission/core";
import { memoryKeyValue, projectStore, startAutosave, stepsStore, type Timers } from "../src/index.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const history = (label: string): SavedHistory => ({ index: 0, kept: [{ snapshot: `{"w":"${label}"}`, label, at: 0 }] });
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

async function twoTabs() {
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], clock.now);
  const steps = stepsStore(kv);
  await store.save("p", part(40), new Date(0));
  const tab = { a: part(40), b: part(40) };
  const opts = { timers: clock.timers, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => tab.a, () => {}, { ...opts, writer: "tab-a" });
  const tabB = startAutosave(store, "p", () => tab.b, () => {}, { ...opts, writer: "tab-b" });
  return { clock, store, steps, tab, tabA, tabB };
}

test("#642 item 4: a stale tab's steps, written before it heard of its refusal, never replace the good tab's", async () => {
  const { clock, steps, tab, tabA, tabB } = await twoTabs();
  // B saves 70 at t = 1000 and keeps its steps.
  await clock.advance(500);
  tab.b = part(70);
  tabB.changed();
  await clock.advance(1000);
  await steps.write("p", history("B"), 1500, tabB.ownTimes());
  // A, still on the state of t = 0, is edited at t = 1600 and hidden at once: its steps are written before its save
  // (at 1600, refused: the store holds B's 1500) is heard of. A's own times are 0 and 1600, neither of them 1500.
  await clock.advance(100);
  tab.a = part(45);
  tabA.changed();
  tabA.leaving();
  assert.equal(tabA.refused(), false, "it has not heard yet");
  await steps.write("p", history("A"), 1600, tabA.ownTimes());
  assert.equal((await steps.read("p"))?.kept[0].label, "B", "the good tab's steps stay");
  await clock.advance(2000);
});

test("one tab: steps written while its own save is still landing are kept (the store holds the time it started)", async () => {
  const { clock, store, steps, tab, tabA } = await twoTabs();
  tab.a = part(50);
  tabA.changed();
  tabA.leaving(); // starts the save at once; the steps follow before it is heard of
  await steps.write("p", history("A"), 10, tabA.ownTimes());
  assert.equal((await steps.read("p"))?.kept[0].label, "A");
  assert.deepEqual(await store.open("p"), part(50));
  await clock.advance(2000);
});

test("control: with no times given (the code before), the stale tab's steps do replace the good tab's", async () => {
  const { clock, steps, tab, tabA, tabB } = await twoTabs();
  tab.b = part(70);
  tabB.changed();
  await clock.advance(1000);
  await steps.write("p", history("B"), 1000, tabB.ownTimes());
  tab.a = part(45);
  tabA.changed();
  tabA.leaving();
  await steps.write("p", history("A"), 1600);
  assert.equal((await steps.read("p"))?.kept[0].label, "A");
  await clock.advance(2000);
});
