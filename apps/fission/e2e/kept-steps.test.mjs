// The open project's undo steps kept in this browser (src/kept-steps.ts, step 89), on a fake clock over an in-memory
// store: written a quiet moment after a change and at once on flush, never before the kept ones were read, put back
// only over an untouched history that they line up with, the old project's steps kept as they were when another one
// replaces it, and a late read for a project no longer open changing nothing. The browser side is e2e/kept-history.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistory } from "@fission/core";
import { memoryKeyValue, stepsStore } from "@fission/storage";
import { keptSteps, STEPS_QUIET_MS } from "../src/kept-steps.ts";

function setup(kv = memoryKeyValue()) {
  const timers = new Map();
  let next = 1;
  let clock = 0;
  const steps = stepsStore(kv);
  const app = { project: "w=10" };
  const history = createHistory({ capture: () => app.project, restore: (s) => (app.project = s), now: () => clock, mergeMs: 0 });
  const kept = keptSteps(history, steps, () => app.project, {
    now: () => clock,
    setTimeout: (run, ms) => (timers.set(next, { run, at: clock + ms }), next++),
    clearTimeout: (t) => timers.delete(t),
  });
  /** Moves the clock on `ms`, running the timers due. */
  const wait = async (ms) => {
    clock += ms;
    for (const [t, { run, at }] of [...timers]) if (at <= clock) (timers.delete(t), run());
    await new Promise((r) => setImmediate(r));
  };
  const edit = (w) => {
    app.project = `w=${w}`;
    history.record(`Width ${w}`);
  };
  const stored = async (id) => (await steps.read(id))?.kept.map((e) => e.label) ?? null;
  return { kv, steps, app, history, kept, wait, edit, stored };
}

test("the quiet moment: 300 ms", () => assert.equal(STEPS_QUIET_MS, 300));

test("hand-worked: written 300 ms after the last change, not at 0.9× of it; a flush writes at once", async () => {
  const s = setup();
  s.kept.follow("p");
  await s.kept.settled();
  await s.wait(STEPS_QUIET_MS);
  assert.deepEqual(await s.stored("p"), [""]); // the fresh start, written once read
  s.edit(20);
  await s.wait(270); // 0.9 × 300
  assert.deepEqual(await s.stored("p"), [""], "not yet");
  await s.wait(60); // 330 = 1.1 × 300
  assert.deepEqual(await s.stored("p"), ["", "Width 20"]);
  s.edit(30);
  s.kept.flush(); // the page hidden: at once
  await s.wait(0);
  assert.deepEqual(await s.stored("p"), ["", "Width 20", "Width 30"]);
});

test("a reload: the steps kept are put back, and Undo carries on", async () => {
  const kv = memoryKeyValue();
  const first = setup(kv);
  first.kept.follow("p");
  await first.kept.settled();
  first.edit(20);
  first.edit(30);
  first.history.undo(); // at w=20, Width 30 a redo away
  first.kept.flush();
  await first.wait(0);
  // The next visit: the project as stored, a fresh history, then followed.
  const again = setup(kv);
  again.app.project = "w=20";
  again.history.reset();
  again.kept.follow("p");
  await again.kept.settled();
  assert.deepEqual(again.history.steps().map((x) => [x.label, x.state]), [["", "done"], ["Width 20", "current"], ["Width 30", "undone"]]);
  assert.equal(again.history.undo(), "Width 20");
  assert.equal(again.app.project, "w=10");
});

test("nothing is written before the kept steps are read, so a fresh start never replaces them unread", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", { kept: [{ snapshot: "w=10", label: "", mergeKey: undefined, at: 0 }, { snapshot: "w=20", label: "Width 20", mergeKey: undefined, at: 1 }], index: 1 }, 1);
  let answer;
  const slow = { ...kv, get: (k) => new Promise((r) => (answer = () => r(kv.get(k)))) };
  const s = setup(slow);
  s.app.project = "w=20";
  s.history.reset();
  s.kept.follow("p");
  s.history.reset(); // the shell's own reset after keep(): changes the history, writes nothing yet
  await s.wait(1000);
  assert.deepEqual((await stepsStore(kv).read("p")).kept.map((e) => e.label), ["", "Width 20"], "kept as they were");
  answer();
  await s.kept.settled();
  assert.equal(s.history.undoLabel(), "Width 20");
});

test("steps that don't line up (changed in another tab), or a history already changed, are not put back", async () => {
  const kv = memoryKeyValue();
  const keptTwo = { kept: [{ snapshot: "w=10", label: "", mergeKey: undefined, at: 0 }, { snapshot: "w=20", label: "Width 20", mergeKey: undefined, at: 1 }], index: 1 };
  await stepsStore(kv).write("p", keptTwo, 1);
  const other = setup(kv);
  other.app.project = "w=77"; // another tab's change
  other.history.reset();
  other.kept.follow("p");
  await other.kept.settled();
  assert.equal(other.history.canUndo(), false);
  await other.wait(STEPS_QUIET_MS);
  assert.deepEqual(await other.stored("p"), [""], "replaced by the fresh start");

  await stepsStore(kv).write("p", keptTwo, 2);
  const busy = setup(kv);
  busy.app.project = "w=20";
  busy.history.reset();
  busy.kept.follow("p");
  busy.edit(25); // recorded before the read answered
  await busy.kept.settled();
  assert.deepEqual(busy.history.steps().map((x) => x.label), ["", "Width 25"]);
  // Deliberate break: the same untouched history does take them.
  const control = setup(kv);
  await stepsStore(kv).write("p", keptTwo, 3);
  control.app.project = "w=20";
  control.history.reset();
  control.kept.follow("p");
  await control.kept.settled();
  assert.equal(control.history.undoLabel(), "Width 20");
});

test("another project opened: the old one's steps are kept as they were, the new start never written over them", async () => {
  const s = setup();
  s.kept.follow("p");
  await s.kept.settled();
  s.edit(20);
  s.kept.stop(); // replaceProject: before the reset
  s.app.project = "other";
  s.history.reset();
  await s.wait(1000);
  assert.deepEqual(await s.stored("p"), ["", "Width 20"]);
  assert.equal(s.kept.following(), null);
  s.kept.follow("q");
  await s.kept.settled();
  s.edit(5);
  await s.wait(STEPS_QUIET_MS);
  assert.deepEqual(await s.stored("q"), ["", "Width 5"]);
  assert.deepEqual(await s.stored("p"), ["", "Width 20"], "p untouched");
});

test("a late read for a project no longer followed changes nothing", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", { kept: [{ snapshot: "w=10", label: "", mergeKey: undefined, at: 0 }, { snapshot: "w=20", label: "Width 20", mergeKey: undefined, at: 1 }], index: 1 }, 1);
  let answer;
  const slow = { ...kv, get: (k) => (k === "steps/p" ? new Promise((r) => (answer = () => r(kv.get(k)))) : kv.get(k)) };
  const s = setup(slow);
  s.app.project = "w=20";
  s.history.reset();
  s.kept.follow("p");
  s.kept.stop();
  answer();
  await s.wait(1000);
  assert.equal(s.history.canUndo(), false);
});
