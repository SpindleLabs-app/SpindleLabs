// Autosave's longest wait (lost-work hunt 2026-11-12, issue #627 item 8): every change restarted the one-second quiet
// moment, so work with changes under a second apart was never stored, however long it went on, and a crashed tab lost
// the whole stretch. A save now starts LONGEST_MS after the first change not yet stored, at the latest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project } from "@fission/core";
import { LONGEST_MS, QUIET_MS, memoryKeyValue, projectStore, startAutosave, type Timers } from "@fission/storage";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r));
};
function fakeClock() {
  let t = 1_000_000;
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
async function steady(gapMs: number) {
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  await store.save("p", part(40));
  let project = part(40);
  const autosave = startAutosave(store, "p", () => project, () => {}, { timers: clock.timers, now: clock.now, stored: true, storedAt: (await store.list())[0].modified });
  /** Makes change `i` (width 40 + i) and lets `ms` pass. */
  const change = async (i: number, ms = gapMs) => {
    project = part(40 + i);
    autosave.changed();
    await clock.advance(ms);
  };
  return { clock, change, stored: async () => widthOf(await store.open("p")) };
}

test("the limits are the ones the working below uses", () => {
  assert.equal(QUIET_MS, 1000);
  assert.equal(LONGEST_MS, 5000);
});

test("a change every 0.9 s is stored 5 s after the first one", async () => {
  const s = await steady(900);
  // By hand: changes 1 to 6 are made at 0, 0.9, 1.8, 2.7, 3.6 and 4.5 s. Each restarts the 1 s quiet moment, so none
  // has fired by 4.5 s; the wait set at 4.5 s is cut to end at 0 + 5 s. Just before, the store still holds 40.
  for (let i = 1; i <= 5; i++) await s.change(i);
  await s.change(6, 0.9 * 500 - 1); // to 4.5 s + 449 ms = 4.949 s
  assert.equal(await s.stored(), 40, "nothing stored before the longest wait is over");
  await s.clock.advance(51); // 5.000 s
  assert.equal(await s.stored(), 46, "the sixth change, the newest at 5 s, is stored");
});

test("ten minutes of steady work loses at most the last five seconds", async () => {
  const s = await steady(900);
  for (let i = 1; i <= 667; i++) await s.change(i);
  // By hand: 667 changes 0.9 s apart; a save starts at most 5 s after the first change it holds, and 5 s is under six
  // gaps (5.4 s), so the store is never more than 6 changes behind: at least 661.
  const stored = await s.stored();
  assert.ok(stored >= 40 + 661, `the store holds width ${stored}`);
});

test("the longest wait counts from the first change not stored, not from the last save", async () => {
  const s = await steady(900);
  for (let i = 1; i <= 6; i++) await s.change(i); // stored at 5 s (above); the clock is at 5.4 s
  await s.clock.advance(60_000); // a minute's rest
  // Changes 7 to 11, 0.9 s apart, take 3.6 s: under the longest wait, so only the quiet moment after the last stores them.
  for (let i = 7; i <= 10; i++) await s.change(i);
  await s.change(11, 0);
  assert.equal(await s.stored(), 46, "not stored while changes keep coming inside the longest wait");
  await s.clock.advance(999);
  assert.equal(await s.stored(), 46, "0.9 x the quiet moment after the last change: not yet");
  await s.clock.advance(1);
  assert.equal(await s.stored(), 51, "stored once the quiet moment has passed");
});
