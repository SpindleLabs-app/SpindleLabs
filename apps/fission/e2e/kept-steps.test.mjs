// The open project's undo steps kept in this browser (src/kept-steps.ts, step 89), over an in-memory store: written
// when the project's save lands and on flush, never before the kept ones were read and never by a tab whose saves are
// refused (save/load hunt C6), put back only over an untouched history that they line up with, the old project's
// steps kept as they were when another one replaces it, and a late read for a project no longer open changing nothing.
// The browser side is e2e/kept-history.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistory } from "@fission/core";
import { memoryKeyValue, stepsStore } from "@fission/storage";
import { keptSteps, LEFT_LABEL } from "../src/kept-steps.ts";

const tick = () => new Promise((r) => setImmediate(r));
function setup(kv = memoryKeyValue(), extra = {}) {
  const steps = stepsStore(kv);
  const app = { project: "w=10", refused: false };
  const history = createHistory({ capture: () => app.project, restore: (s) => (app.project = s), mergeMs: 0 });
  const kept = keptSteps(history, steps, () => app.project, { now: () => 1, refused: () => app.refused, ...extra });
  const edit = (w) => {
    app.project = `w=${w}`;
    history.record(`Width ${w}`);
  };
  const stored = async (id) => (await steps.read(id))?.kept.map((e) => e.label) ?? null;
  return { kv, steps, app, history, kept, edit, stored };
}
const two = { kept: [{ snapshot: "w=10", label: "", mergeKey: undefined, at: 0 }, { snapshot: "w=20", label: "Width 20", mergeKey: undefined, at: 1 }], index: 1 };

test("written when the project's save lands, not before; a flush (the page going) writes at once; nothing changed, nothing written", async () => {
  const s = setup();
  s.kept.follow("p");
  await s.kept.settled();
  s.kept.saved();
  await tick();
  assert.equal(await s.stored("p"), null, "a fresh start with nothing kept writes nothing");
  s.edit(20);
  await tick();
  assert.equal(await s.stored("p"), null, "not before the save lands");
  s.kept.saved();
  await tick();
  assert.deepEqual(await s.stored("p"), ["", "Width 20"]);
  s.edit(30);
  s.kept.flush();
  await tick();
  assert.deepEqual(await s.stored("p"), ["", "Width 20", "Width 30"]);
  await s.steps.forget("p");
  s.kept.saved(); // nothing changed since the flush
  await tick();
  assert.equal(await s.stored("p"), null);
});

test("a reload: the steps kept are put back, and Undo carries on", async () => {
  const kv = memoryKeyValue();
  const first = setup(kv);
  first.kept.follow("p");
  await first.kept.settled();
  first.edit(20);
  first.edit(30);
  first.history.undo(); // at w=20, Width 30 a redo away
  first.kept.saved();
  await tick();
  const again = setup(kv);
  again.app.project = "w=20";
  again.history.reset();
  again.kept.follow("p");
  await again.kept.settled();
  assert.deepEqual(again.history.steps().map((x) => [x.label, x.state]), [["", "done"], ["Width 20", "current"], ["Width 30", "undone"]]);
  assert.equal(again.history.undo(), "Width 20");
  assert.equal(again.app.project, "w=10");
});

test("a tab whose saves are refused (another tab stored the project since) never writes over the good tab's steps (C6)", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", two, 1); // the good tab's steps, ending at its stored w=20
  const stale = setup(kv);
  stale.app.project = "w=99";
  stale.history.reset();
  stale.kept.follow("p");
  await stale.kept.settled();
  stale.edit(77);
  stale.app.refused = true; // its save was refused
  stale.kept.saved();
  stale.kept.flush();
  stale.kept.stop();
  await tick();
  assert.deepEqual(await stale.stored("p"), ["", "Width 20"], "the good tab's steps kept");
  // Deliberate break: the same tab with its saves going through does write.
  const control = setup(kv);
  control.app.project = "w=99";
  control.history.reset();
  control.kept.follow("p");
  await control.kept.settled();
  control.edit(77);
  control.kept.saved();
  await tick();
  assert.deepEqual(await control.stored("p"), ["", "Width 77"]);
});

test("nothing is written before the kept steps are read, so a fresh start never replaces them unread", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", two, 1);
  let answer;
  const slow = { ...kv, get: (k) => new Promise((r) => (answer = () => r(kv.get(k)))) };
  const s = setup(slow);
  s.app.project = "w=20";
  s.history.reset();
  s.kept.follow("p");
  s.history.reset(); // the shell's own reset after keep()
  s.kept.saved();
  s.kept.flush();
  await tick();
  assert.deepEqual((await stepsStore(kv).read("p")).kept.map((e) => e.label), ["", "Width 20"], "kept as they were");
  answer();
  await s.kept.settled();
  assert.equal(s.history.undoLabel(), "Width 20");
});

test("steps that don't line up (changed in another tab), or a history already changed, are not put back; the next save replaces them", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", two, 1);
  const other = setup(kv);
  other.app.project = "w=77";
  other.history.reset();
  other.kept.follow("p");
  await other.kept.settled();
  assert.equal(other.history.canUndo(), false);
  other.kept.saved();
  await tick();
  assert.deepEqual(await other.stored("p"), [""], "replaced at its save by the fresh start");

  await stepsStore(kv).write("p", two, 2);
  const busy = setup(kv);
  busy.app.project = "w=20";
  busy.history.reset();
  busy.kept.follow("p");
  busy.edit(25); // recorded before the read answered
  await busy.kept.settled();
  assert.deepEqual(busy.history.steps().map((x) => x.label), ["", "Width 25"]);
  // Deliberate break: the same untouched history does take them.
  await stepsStore(kv).write("p", two, 3);
  const control = setup(kv);
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
  s.kept.stop(); // replaceProject: before the reset, writes what changed
  s.app.project = "other";
  s.history.reset();
  s.kept.saved();
  await tick();
  assert.deepEqual(await s.stored("p"), ["", "Width 20"]);
  assert.equal(s.kept.following(), null);
  s.kept.follow("q");
  await s.kept.settled();
  s.edit(5);
  s.kept.saved();
  await tick();
  assert.deepEqual(await s.stored("q"), ["", "Width 5"]);
  assert.deepEqual(await s.stored("p"), ["", "Width 20"], "p untouched");
});

test("a late read for a project no longer followed changes nothing", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", two, 1);
  let answer;
  const slow = { ...kv, get: (k) => (k === "steps/p" ? new Promise((r) => (answer = () => r(kv.get(k)))) : kv.get(k)) };
  const s = setup(slow);
  s.app.project = "w=20";
  s.history.reset();
  s.kept.follow("p");
  s.kept.stop();
  answer();
  await tick();
  await tick();
  assert.equal(s.history.canUndo(), false);
});

// Lost-work hunt 2026-11-12 (issue #627 items 6 and 7).
test("steps kept by an older SpindleLabs are brought up to date and put back; without that they never fit", async () => {
  // The older build wrote its snapshots in capitals; today's reader writes them small. The project opens as "w=20".
  const old = { kept: [{ snapshot: "W=10", label: "", mergeKey: undefined, at: 0 }, { snapshot: "W=20", label: "Width 20", mergeKey: undefined, at: 1 }, { snapshot: "W=30", label: "Width 30", mergeKey: undefined, at: 2 }], index: 1 };
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", old, 1);
  const plain = setup(kv);
  plain.app.project = "w=20";
  plain.history.reset();
  plain.kept.follow("p");
  await plain.kept.settled();
  assert.equal(plain.history.canUndo(), false, "compared as text, the old steps don't fit (the bug)");

  const s = setup(kv, { upgrade: (text) => text.toLowerCase() });
  s.app.project = "w=20";
  s.history.reset();
  s.kept.follow("p");
  await s.kept.settled();
  assert.deepEqual(s.history.steps().map((e) => e.label), ["", "Width 20", "Width 30"]);
  s.history.undo();
  assert.equal(s.app.project, "w=10", "Undo restores the step as today's readers write it");
  s.history.redo();
  s.history.redo();
  assert.equal(s.app.project, "w=30", "the step that was a Redo away is still there");
  s.history.undo();
  // Written again as put back, so the next visit reads today's text.
  s.kept.saved();
  await tick();
  assert.deepEqual((await s.steps.read("p")).kept.map((e) => e.snapshot), ["w=10", "w=20", "w=30"]);
});

test("a kept snapshot today's readers refuse: the history starts afresh, nothing thrown", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", { kept: [{ snapshot: "W=10", label: "", mergeKey: undefined, at: 0 }, { snapshot: "W=20", label: "Width 20", mergeKey: undefined, at: 1 }], index: 1 }, 1);
  const s = setup(kv, { upgrade: () => { throw new Error("can't be read"); } });
  s.app.project = "w=20";
  s.history.reset();
  s.kept.follow("p", true);
  await s.kept.settled();
  assert.equal(s.history.canUndo(), false);
});

test("a change that came back from the journal: steps one change short get it as a step; the redo steps go", async () => {
  const kv = memoryKeyValue();
  // Kept: w=10, w=20 (the present), w=30 a redo away. The page went 200 ms after w was typed 40: the project opens as w=40.
  await stepsStore(kv).write("p", { kept: [...two.kept, { snapshot: "w=30", label: "Width 30", mergeKey: undefined, at: 2 }], index: 1 }, 1);
  const s = setup(kv, { now: () => 7 });
  s.app.project = "w=40";
  s.history.reset();
  s.kept.follow("p", true);
  await s.kept.settled();
  // By hand: steps up to the present (w=10, w=20), then the change put back; Width 30 is dropped as a new change drops it.
  assert.deepEqual(s.history.steps().map((e) => e.label), ["", "Width 20", LEFT_LABEL]);
  assert.equal(s.history.canRedo(), false);
  s.history.undo();
  assert.equal(s.app.project, "w=20", "Undo takes back exactly the change made before leaving");
  s.history.undo();
  assert.equal(s.app.project, "w=10", "and the steps from before are still there");
  s.history.redo();
  s.history.redo();
  s.kept.saved();
  await tick();
  assert.deepEqual((await s.steps.read("p")).kept.map((e) => e.snapshot), ["w=10", "w=20", "w=40"], "kept as put back");
});

test("steps that don't end at the project, and no change came back from the journal: afresh, as before", async () => {
  const kv = memoryKeyValue();
  await stepsStore(kv).write("p", two, 1);
  const s = setup(kv);
  s.app.project = "w=40"; // changed in another tab, or on another device
  s.history.reset();
  s.kept.follow("p");
  await s.kept.settled();
  assert.equal(s.history.canUndo(), false);
});
