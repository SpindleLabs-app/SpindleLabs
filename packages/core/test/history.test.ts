// The one undo/redo history (step 20a), on a tiny stand-in project: a box
// width held in `doc`, captured as JSON. Every expected value is worked out
// by hand in the comment beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory, MERGE_MS, UNDO_LIMIT, type HistoryOptions } from "../src/model/history.ts";

/** A history over one number, a fake clock and a log of restores and change calls. */
function rig(extra: Partial<HistoryOptions> = {}) {
  const doc = { w: 40 };
  let t = 0;
  const restores: number[] = [];
  const h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => {
      doc.w = JSON.parse(s).w;
      restores.push(doc.w);
    },
    now: () => t,
    ...extra,
  });
  let changes = 0;
  h.onChange(() => changes++);
  /** The user sets the width and the workspace records it. */
  const edit = (w: number, label = `Width ${w}`, key?: string) => {
    doc.w = w;
    return h.record(label, key);
  };
  return { h, doc, edit, restores, tick: (ms: number) => (t += ms), changes: () => changes };
}

test("a new history has nothing to undo or redo", () => {
  const { h } = rig();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.undoLabel(), null);
  assert.equal(h.redoLabel(), null);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
});

test("hand-worked: three edits, undo twice, redo once, then a new edit drops the redo", () => {
  const { h, doc, edit, restores } = rig();
  // States: 40 (start) → 50 → 60 → 70.
  edit(50);
  edit(60);
  edit(70);
  assert.equal(h.undoLabel(), "Width 70");
  // Undo takes back "Width 70": back to 60. Undo again takes back "Width 60": back to 50.
  assert.equal(h.undo(), "Width 70");
  assert.equal(doc.w, 60);
  assert.equal(h.undo(), "Width 60");
  assert.equal(doc.w, 50);
  // Now Undo would take back "Width 50" (to 40) and Redo would redo "Width 60".
  assert.equal(h.undoLabel(), "Width 50");
  assert.equal(h.redoLabel(), "Width 60");
  assert.equal(h.redo(), "Width 60");
  assert.equal(doc.w, 60);
  // 70 can still be redone, until a new edit (65) replaces it.
  assert.equal(h.redoLabel(), "Width 70");
  edit(65);
  assert.equal(h.canRedo(), false);
  // Undo from 65 goes to 60, then 50, then 40, then nothing: four states, three undos.
  assert.equal(h.undo(), "Width 65");
  assert.equal(h.undo(), "Width 60");
  assert.equal(h.undo(), "Width 50");
  assert.equal(h.undo(), null);
  assert.equal(doc.w, 40);
  assert.deepEqual(restores, [60, 50, 60, 60, 50, 40]);
});

test("recording the same project as the present records nothing", () => {
  const { h, edit, changes } = rig();
  assert.equal(edit(40), false); // 40 is the start: no step
  assert.equal(h.canUndo(), false);
  assert.equal(changes(), 0);
  assert.equal(edit(50), true);
  assert.equal(edit(50), false);
  assert.equal(changes(), 1);
});

test("a change reported while a snapshot is being put back is not recorded", () => {
  // The shell's restore remounts Design, which reports the project changed:
  // that report must not become a new step (it would wipe the redo).
  let h!: ReturnType<typeof createHistory>;
  const doc = { w: 40 };
  const results: boolean[] = [];
  h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => {
      doc.w = JSON.parse(s).w;
      results.push(h.record("remount"));
    },
  });
  doc.w = 50;
  h.record("Width 50");
  h.undo();
  assert.deepEqual(results, [false]);
  assert.equal(h.canRedo(), true);
  assert.equal(h.redoLabel(), "Width 50");
});

test("a restore that throws leaves the history where it was", () => {
  let fail = false;
  const doc = { w: 40 };
  const h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => {
      if (fail) throw new Error("the kernel is busy");
      doc.w = JSON.parse(s).w;
    },
  });
  doc.w = 50;
  h.record("Width 50");
  fail = true;
  assert.throws(() => h.undo(), /the kernel is busy/);
  assert.equal(doc.w, 50);
  assert.equal(h.undoLabel(), "Width 50");
  assert.equal(h.canRedo(), false);
  // And the guard against recording during a restore is lifted again.
  doc.w = 60;
  assert.equal(h.record("Width 60"), true);
});

test("edits with one merge key are one step within the merge time: 0.9× merges, 1.1× does not", () => {
  // Typing "4" then "0" in the width box: two records 0.9 × 1000 = 900 ms apart, one step.
  const a = rig();
  a.edit(4, "Width", "width");
  a.tick(0.9 * MERGE_MS);
  a.edit(40.5, "Width", "width");
  a.h.undo();
  assert.equal(a.doc.w, 40); // one undo goes all the way back to the start
  assert.equal(a.h.canUndo(), false);
  // 1.1 × 1000 = 1100 ms apart: two steps, so one undo goes back to 4.
  const b = rig();
  b.edit(4, "Width", "width");
  b.tick(1.1 * MERGE_MS);
  b.edit(40.5, "Width", "width");
  b.h.undo();
  assert.equal(b.doc.w, 4);
  assert.equal(b.h.canUndo(), true);
});

test("the merge time runs from the last edit, so steady typing stays one step", () => {
  // Five keys 900 ms apart: 3.6 s in all, but never 1 s between two of them.
  const { h, doc, edit, tick } = rig();
  for (const w of [1, 12, 123, 12, 120]) {
    edit(w, "Width", "width");
    tick(900);
  }
  h.undo();
  assert.equal(doc.w, 40);
});

test("different merge keys, no key, or an undo in between keep steps apart", () => {
  const a = rig();
  a.edit(50, "Width", "width");
  a.edit(20, "Height", "height");
  a.h.undo();
  assert.equal(a.doc.w, 50); // height and width are separate steps
  const b = rig();
  b.edit(50, "Width");
  b.edit(60, "Width");
  b.h.undo();
  assert.equal(b.doc.w, 50); // no key: never merged
  const c = rig();
  c.edit(50, "Width", "width");
  c.edit(60, "Width", "width"); // merged: 40 → 60 is one step
  c.h.undo(); // back to 40
  c.h.redo(); // forward to 60
  c.edit(70, "Width", "width"); // after a redo: a new step, not merged into 40 → 60
  c.h.undo();
  assert.equal(c.doc.w, 60);
});

test("typing back to where a merged step started removes the step", () => {
  // 40 → 4 → 40 in one box: nothing changed, so nothing to undo.
  const { h, edit } = rig();
  edit(50, "Height", "height");
  edit(4, "Width", "width");
  edit(50, "Width", "width");
  assert.equal(h.undoLabel(), "Height");
  // ...and the next width key starts a new step rather than reviving the old one.
  edit(55, "Width", "width");
  h.undo();
  assert.equal(h.undoLabel(), "Height");
});

test("the undo limit keeps the newest steps: limit steps undo, the one before is gone", () => {
  // Limit 3: edits 41, 42, 43, 44 from 40. The oldest step (40 → 41) is dropped,
  // so undo stops at 41 after three undos.
  const { h, doc, edit } = rig({ limit: 3 });
  for (const w of [41, 42, 43]) edit(w);
  assert.equal([h.undo(), h.undo(), h.undo(), h.undo()].filter(Boolean).length, 3);
  assert.equal(doc.w, 40); // exactly at the limit nothing is lost
  for (let i = 0; i < 3; i++) h.redo();
  edit(44);
  for (let i = 0; i < 5; i++) h.undo();
  assert.equal(doc.w, 41);
  assert.equal(UNDO_LIMIT, 100);
});

test("reset forgets every step and starts from the project as it is", () => {
  const { h, doc, edit, changes } = rig();
  edit(50);
  h.undo();
  doc.w = 70; // an opened file
  h.reset();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(changes(), 3);
  assert.equal(edit(70), false); // 70 is the new start
});

test("hand-worked: amend takes a change nobody made into the present, not a new step", () => {
  // 40 → Width 50, then a workspace fills in a default (the box becomes 55
  // with no edit). Undo takes back Width 50 to 40, redo brings 55, the
  // amended present, not the 50 recorded before it.
  const { h, doc, edit, restores, changes } = rig();
  edit(50);
  doc.w = 55;
  assert.equal(h.amend(), true);
  assert.equal(changes(), 2); // the record and the amend
  assert.equal(h.undoLabel(), "Width 50");
  assert.equal(h.undo(), "Width 50");
  assert.equal(h.redo(), "Width 50");
  assert.deepEqual(restores, [40, 55]);
  // Nothing new to take in: false, and no change call.
  assert.equal(h.amend(), false);
  assert.equal(changes(), 4);
});

test("amend keeps the redo, and a present step amended back to the state before it is removed", () => {
  const { h, doc, edit, restores } = rig();
  edit(50);
  edit(60);
  h.undo(); // at Width 50, Width 60 to redo
  doc.w = 51;
  h.amend();
  assert.equal(h.redoLabel(), "Width 60");
  // 51 → 40 is the start's state: Width 50 has nothing left to undo.
  doc.w = 40;
  assert.equal(h.amend(), true);
  assert.equal(h.canUndo(), false);
  assert.equal(h.redoLabel(), "Width 60");
  assert.equal(h.redo(), "Width 60");
  assert.deepEqual(restores, [50, 60]);
});

test("amend ends a merge: the next edit with the same key is a step of its own", () => {
  // Typing 41 then 42 in one box within the merge time is one step; a
  // default filled in between them splits it, so undo goes 42 → 41 → 40.
  const { h, doc, edit, restores, tick } = rig();
  edit(41, "Change width", "width");
  (doc as { w: number; d?: number }).d = 30;
  h.amend();
  tick(MERGE_MS * 0.1);
  edit(42, "Change width", "width");
  h.undo();
  h.undo();
  assert.deepEqual(restores, [41, 40]);
});

test("hand-worked (26f): amend keeping the merge folds a change that follows from the edit into its step, and the typing goes on merging", () => {
  // Typing 41 then 42 in one box within the merge time, a point pinned to
  // the box's edge following each (p = 31, then 32): one step, from
  // {40, 30} to {42, 32}, the point where it followed to. Without keeping
  // the merge (the test above) the same keys would be two steps.
  const doc = { w: 40, p: 30 };
  let t = 0;
  const restores: string[] = [];
  const h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => (Object.assign(doc, JSON.parse(s)), restores.push(s)),
    now: () => t,
  });
  doc.w = 41;
  h.record("Change width", "width");
  doc.p = 31;
  assert.equal(h.amend(true), true);
  t += MERGE_MS * 0.1;
  doc.w = 42;
  h.record("Change width", "width");
  doc.p = 32;
  assert.equal(h.amend(true), true);
  assert.equal(h.undo(), "Change width");
  assert.equal(h.canUndo(), false, "one step");
  assert.equal(h.redo(), "Change width");
  assert.deepEqual(restores, ['{"w":40,"p":30}', '{"w":42,"p":32}']);
});

test("amend keeping the merge still removes a step amended back to the state before it", () => {
  // 40 → 41, the follow-up putting it back to 40 (d dropped again): nothing to undo, and the next 41 is a step again.
  const { h, doc, edit } = rig();
  const d = doc as { w: number; d?: number };
  edit(41, "Change width", "width");
  d.w = 40;
  assert.equal(h.amend(true), true);
  assert.equal(h.canUndo(), false);
  assert.equal(edit(41, "Change width", "width"), true);
  assert.equal(h.undoLabel(), "Change width");
});

test("amend during a restore does nothing", () => {
  let h!: ReturnType<typeof createHistory>;
  const doc = { w: 40 };
  const results: boolean[] = [];
  h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => {
      doc.w = JSON.parse(s).w + 1; // the remount changed it again
      results.push(h.amend());
    },
  });
  doc.w = 50;
  h.record("Width 50");
  h.undo();
  assert.deepEqual(results, [false]);
  assert.equal(h.redoLabel(), "Width 50");
});

test("onChange is called once per change and can be unsubscribed", () => {
  const { h, edit, changes } = rig();
  edit(50);
  h.undo();
  h.undo(); // nothing to undo: no call
  h.redo();
  h.redo(); // nothing to redo: no call
  assert.equal(changes(), 3);
  let mine = 0;
  const off = h.onChange(() => mine++);
  edit(60);
  off();
  edit(70);
  assert.equal(mine, 1);
});

test("a nonsense limit or merge time is refused", () => {
  const capture = () => "";
  const restore = () => {};
  assert.throws(() => createHistory({ capture, restore, limit: 0 }), /undo limit/);
  assert.throws(() => createHistory({ capture, restore, limit: 2.5 }), /undo limit/);
  assert.throws(() => createHistory({ capture, restore, mergeMs: NaN }), /merge time/);
  assert.throws(() => createHistory({ capture, restore, mergeMs: -1 }), /merge time/);
});

// One labelled step for many changes (step 20c): an ownership hand-over or
// an accepted AI command.
test("hand-worked: a step with three changes inside is one undo step with its label", () => {
  const { h, doc, edit, restores } = rig();
  edit(50); // 40 → 50, "Width 50"
  const out = h.step("AI: widen and deepen", () => {
    // Inside, records fold into the step and say so by returning false.
    assert.equal(edit(60), false);
    assert.equal(edit(61, "Change width", "width"), false);
    doc.w = 70; // a change nobody recorded counts too
    return "done";
  });
  assert.equal(out, "done");
  // Steps: 40 →(Width 50) 50 →(AI) 70. One undo takes the AI step back to 50, not to 61 or 60.
  assert.equal(h.undoLabel(), "AI: widen and deepen");
  assert.equal(h.undo(), "AI: widen and deepen");
  assert.equal(doc.w, 50);
  assert.equal(h.undo(), "Width 50");
  assert.equal(doc.w, 40);
  assert.equal(h.redo(), "Width 50");
  assert.equal(h.redo(), "AI: widen and deepen");
  assert.equal(doc.w, 70);
  assert.deepEqual(restores, [50, 40, 50, 70]);
});

test("a step that throws puts the project back, records nothing and passes the error on", () => {
  const { h, doc, edit, restores } = rig();
  edit(50);
  edit(60);
  h.undo(); // 50 now, with "Width 60" to redo
  assert.throws(
    () =>
      h.step("AI: two changes", () => {
        edit(80);
        throw new Error("second command refused");
      }),
    /second command refused/,
  );
  // Put back to 50 (one restore after the undo's), nothing recorded, the redo is still there.
  assert.equal(doc.w, 50);
  assert.deepEqual(restores, [50, 50]);
  assert.equal(h.undoLabel(), "Width 50");
  assert.equal(h.redoLabel(), "Width 60");
  // A step that fails before changing anything restores nothing.
  assert.throws(() => h.step("x", () => { throw new Error("no"); }), /no/);
  assert.deepEqual(restores, [50, 50]);
});

test("a step that changes nothing records nothing and keeps the redo", () => {
  const { h, doc, edit, changes } = rig();
  edit(50);
  h.undo();
  const before = changes();
  h.step("Hand over", () => {
    edit(55);
    doc.w = 40; // and back: no net change
  });
  assert.equal(changes(), before, "no change call");
  assert.equal(h.redoLabel(), "Width 50");
  assert.equal(h.undoLabel(), null);
});

test("a step drops the redo, never merges with its neighbours, and nested steps are one", () => {
  const { h, edit, tick } = rig();
  edit(41, "Change width", "width");
  h.undo();
  h.step("Outer", () => {
    edit(42, "Change width", "width");
    h.step("Inner", () => edit(43));
  });
  assert.equal(h.redoLabel(), null, "a step drops the redo");
  // Same merge key 1 ms later: still a step of its own, after a step.
  tick(1);
  edit(44, "Change width", "width");
  assert.equal(h.undo(), "Change width");
  assert.equal(h.undo(), "Outer", "the inner step joined the outer one");
  assert.equal(h.undo(), null);
});

test("a step takes earlier unrecorded changes into the present first, so a failure keeps them", () => {
  const { h, doc } = rig();
  doc.w = 45; // a default filled in, never recorded
  assert.throws(() => h.step("x", () => { doc.w = 99; throw new Error("bad"); }), /bad/);
  // Put back to 45 (the present as the step started), not to 40.
  assert.equal(doc.w, 45);
  assert.equal(h.canUndo(), false);
});

test("a step that leaves a project which can't be captured fails and is put back", () => {
  const doc = { w: 40 };
  const h = createHistory({
    capture: () => {
      if (!Number.isFinite(doc.w)) throw new Error("can't save a NaN width");
      return JSON.stringify(doc);
    },
    restore: (s) => (doc.w = JSON.parse(s).w),
  });
  assert.throws(() => h.step("AI: bad", () => (doc.w = NaN)), /NaN width/);
  assert.equal(doc.w, 40);
  assert.equal(h.canUndo(), false);
});

test("undo, redo and reset inside a step are refused; a step during a restore is refused", () => {
  let h!: ReturnType<typeof createHistory>;
  const doc = { w: 40 };
  let duringRestore: unknown = null;
  h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => {
      doc.w = JSON.parse(s).w;
      assert.equal(h.restoring(), true);
      try {
        h.step("x", () => {});
      } catch (e) {
        duringRestore = e;
      }
    },
  });
  doc.w = 50;
  h.record("Width 50");
  for (const [what, call] of [["undo", () => h.undo()], ["redo", () => h.redo()], ["start the history afresh", () => h.reset()]] as const) {
    assert.throws(() => h.step("s", call), new RegExp(`can't ${what} while an undo step is running`));
  }
  assert.equal(h.amend(), false, "amend inside nothing changed is false anyway");
  assert.equal(h.restoring(), false);
  h.undo();
  assert.match(String(duringRestore), /can't start an undo step while undo or redo is putting a snapshot back/);
  assert.equal(h.restoring(), false, "and false again after");
});

test("amend inside a step does nothing; the step takes the change in", () => {
  const { h, doc } = rig();
  h.step("Hand over", () => {
    doc.w = 50;
    assert.equal(h.amend(), false);
  });
  assert.equal(h.undo(), "Hand over");
  assert.equal(doc.w, 40);
});

test("a step counts towards the limit like any step", () => {
  const { h, edit } = rig({ limit: 2 });
  edit(41);
  h.step("S", () => edit(42));
  edit(43);
  // Limit 2: the oldest ("Width 41") dropped; undo twice reaches 41, then nothing.
  assert.equal(h.undo(), "Width 43");
  assert.equal(h.undo(), "S");
  assert.equal(h.undo(), null);
});

test("a clock set back between two edits keeps them two steps (real-use hunt D3)", () => {
  // Width 50 at t = 100,000; the device's clock is corrected back 5 minutes; width 60 then reads t = −199,500 +
  // 100,000. The gap is −300,000 + 500 ms: below MERGE_MS only because it is negative, and minutes of real time
  // passed, so 60 must be a step of its own; undo gives 50, not 40.
  const { h, doc, edit, tick } = rig();
  tick(100_000);
  edit(50, "Width", "width");
  tick(-300_000 + 500);
  edit(60, "Width", "width");
  h.undo();
  assert.equal(doc.w, 50);
  h.undo();
  assert.equal(doc.w, 40);
});

test("hand-worked: a clock set back by less than the merge time, far from 0, still keeps two edits apart", () => {
  // A real clock reads ms since 1970, never near 0. Width 50 at t = 100,000; the clock is
  // corrected back half a second, so width 60 reads t = 99,500. The gap is 99,500 − 100,000 =
  // −500 ms: under MERGE_MS (1,000) only because it is negative, so 60 is a step of its own and
  // undo gives 50, then 40. (The D3 test above sets the clock back past 0; this one stays far
  // above it, where adding the two times, 199,500, would wrongly look like a gap of 0 or more.)
  const a = rig();
  a.tick(100_000);
  a.edit(50, "Width", "width");
  a.tick(-500);
  a.edit(60, "Width", "width");
  a.h.undo();
  assert.equal(a.doc.w, 50);
  a.h.undo();
  assert.equal(a.doc.w, 40);
  // The same clock run forward 400 ms instead: a gap of 100,400 − 100,000 = 400 ms, one step.
  const b = rig();
  b.tick(100_000);
  b.edit(50, "Width", "width");
  b.tick(400);
  b.edit(60, "Width", "width");
  b.h.undo();
  assert.equal(b.doc.w, 40);
  assert.equal(b.h.canUndo(), false);
});

test("hand-worked: a step amended back to the one before it ends the merge, so the next edit of that box is a step of its own", () => {
  // Width 50 (key "width"), then height 20 (key "height"), then a change nobody made puts the
  // height back (amend): the Height step is left the same as the state before it, so it is
  // removed and the present is Width 50 again. Width 60 comes 0.1 × MERGE_MS after Width 50
  // with the same key, but the amend came between them, so it must not fold into Width 50:
  // undo gives 50, then 40 (two steps), not 40 at once.
  const doc = { w: 40, h: 10 };
  let t = 0;
  const h = createHistory({ capture: () => JSON.stringify(doc), restore: (s) => void Object.assign(doc, JSON.parse(s)), now: () => t });
  doc.w = 50;
  h.record("Width", "width");
  doc.h = 20;
  h.record("Height", "height");
  doc.h = 10;
  assert.equal(h.amend(), true);
  assert.equal(h.undoLabel(), "Width"); // the Height step is gone
  t += 0.1 * MERGE_MS;
  doc.w = 60;
  h.record("Width", "width");
  assert.equal(h.undo(), "Width");
  assert.deepEqual(doc, { w: 50, h: 10 });
  assert.equal(h.undo(), "Width");
  assert.deepEqual(doc, { w: 40, h: 10 });
  assert.equal(h.canUndo(), false);
});

test("held work makes the history busy until it settles either way; whenIdle waits for the last of it (clumsy hunt 2026-11-04)", async () => {
  // An OK the kernel still checks is held: Undo pressed meanwhile waits for it (main.ts), so it takes back that OK.
  const h = createHistory({ capture: () => "s", restore: () => {} });
  assert.equal(h.busy(), false);
  let idle = false;
  await h.whenIdle(); // nothing held: at once
  let okDone!: (v: string) => void;
  let editFailed!: (e: Error) => void;
  const ok = h.hold(new Promise<string>((r) => (okDone = r)));
  const edit = h.hold(new Promise<never>((_, j) => (editFailed = j)));
  edit.catch(() => {});
  assert.equal(h.busy(), true);
  void h.whenIdle().then(() => (idle = true));
  okDone("recorded");
  assert.equal(await ok, "recorded", "hold gives back what the work gives");
  await new Promise((r) => setImmediate(r));
  assert.equal(idle, false, "the edit is still held");
  assert.equal(h.busy(), true);
  editFailed(new Error("refused"));
  await assert.rejects(edit, /refused/, "and passes its failure on");
  await new Promise((r) => setImmediate(r));
  assert.equal(idle, true, "idle once the last held work settled, a failure too");
  assert.equal(h.busy(), false);
});

test("work held while waiting for idle is waited for too", async () => {
  const h = createHistory({ capture: () => "s", restore: () => {} });
  let first!: () => void;
  let second!: () => void;
  void h.hold(new Promise<void>((r) => (first = r)));
  let idle = false;
  void h.whenIdle().then(() => (idle = true));
  void h.hold(new Promise<void>((r) => (second = r)));
  first();
  await new Promise((r) => setImmediate(r));
  assert.equal(idle, false, "the second, held before the first ended, is still running");
  second();
  await new Promise((r) => setImmediate(r));
  assert.equal(idle, true);
});

test("steps lists the start and every step, oldest first, with where each stands against the present", () => {
  const { h, edit, tick } = rig();
  assert.deepEqual(h.steps(), [{ label: "", at: 0, state: "current" }], "just the start");
  tick(10);
  edit(50, "Change width");
  tick(10);
  edit(60, "Change depth");
  tick(10);
  edit(70, "Extrude");
  // Start (at 0), then three steps at 10, 20 and 30 ms; the last is the present.
  assert.deepEqual(h.steps(), [
    { label: "", at: 0, state: "done" },
    { label: "Change width", at: 10, state: "done" },
    { label: "Change depth", at: 20, state: "done" },
    { label: "Extrude", at: 30, state: "current" },
  ]);
  h.undo();
  h.undo();
  assert.deepEqual(h.steps().map((s) => s.state), ["done", "current", "undone", "undone"], "two undone are a redo away");
  edit(55, "Change height");
  assert.deepEqual(h.steps().map((s) => s.label), ["", "Change width", "Change height"], "a new step drops what could be redone");
});

test("jumpTo puts the project back as it was at that step, in one restore, and can go forward again", () => {
  const { h, doc, edit, restores, tick, changes } = rig();
  tick(2000);
  edit(50, "A");
  tick(2000);
  edit(60, "B");
  tick(2000);
  edit(70, "C");
  const before = changes();
  assert.equal(h.jumpTo(1), "A");
  assert.equal(doc.w, 50, "the width at step A");
  assert.deepEqual(restores, [50], "one restore, not a walk through B and C");
  assert.equal(changes() - before, 1, "one change heard");
  assert.deepEqual(h.steps().map((s) => s.state), ["done", "current", "undone", "undone"]);
  assert.equal(h.undoLabel(), "A");
  assert.equal(h.redoLabel(), "B");
  assert.equal(h.jumpTo(3), "C", "forward to the last");
  assert.equal(doc.w, 70);
  assert.equal(h.jumpTo(0), "", "back to the start (its label is empty)");
  assert.equal(doc.w, 40);
  assert.equal(h.canUndo(), false);
  // An edit after a jump back drops what was ahead, as after an undo.
  h.jumpTo(1);
  edit(99, "D");
  assert.deepEqual(h.steps().map((s) => s.label), ["", "A", "D"]);
});

test("jumpTo to the present, or to no step, does nothing", () => {
  const { h, edit, restores } = rig();
  edit(50, "A");
  edit(60, "B", "k");
  for (const bad of [2, -1, 3, 1.5, NaN, Infinity]) assert.equal(h.jumpTo(bad), null, `${bad}`);
  assert.deepEqual(restores, [], "nothing was put back");
  assert.equal(h.steps().length, 3);
});

test("jumpTo is refused inside an undo step, and a failed restore moves nothing", () => {
  const { h, edit } = rig();
  edit(50, "A");
  edit(60, "B");
  assert.throws(() => h.step("Group", () => h.jumpTo(0)), /can't jump back while an undo step is running/);
  let fail = true;
  const doc = { w: 1 };
  const g = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => {
      if (fail) throw new Error("cannot open it");
      doc.w = JSON.parse(s).w;
    },
  });
  doc.w = 2;
  g.record("X", undefined);
  assert.throws(() => g.jumpTo(0), /cannot open it/);
  assert.deepEqual(g.steps().map((s) => s.state), ["done", "current"], "still at X");
  fail = false;
  assert.equal(g.jumpTo(0), "");
});

test("save and load (design tabs): the steps come back when the project is as it was left, and undo works through them", () => {
  const a = rig();
  a.edit(50, "Width 50");
  a.edit(60, "Width 60");
  // Start 40, steps 50 and 60, present 60 (index 2). Leave this tab:
  const saved = a.h.save();
  // Another project is on screen (width 7); its history starts afresh, then the first one is shown again as it was left.
  a.h.reset();
  a.doc.w = 7;
  a.h.reset();
  assert.equal(a.h.load(saved), false); // 7 is not the saved present (60): nothing changes
  assert.equal(a.h.canUndo(), false);
  a.doc.w = 60;
  assert.equal(a.h.load(saved), true);
  assert.deepEqual(a.h.steps().map((s) => s.label), ["", "Width 50", "Width 60"]);
  assert.equal(a.h.undo(), "Width 60");
  assert.equal(a.doc.w, 50); // one undo from 60 is 50
  assert.equal(a.h.undo(), "Width 50");
  assert.equal(a.doc.w, 40);
  assert.equal(a.h.redo(), "Width 50");
});

test("save is a copy: steps made after it do not change it, and an undone present is saved where it stood", () => {
  const { h, doc, edit } = rig();
  edit(50);
  const saved = h.save(); // start 40, step 50, present 50
  edit(70);
  doc.w = 50; // back to the saved present by hand
  assert.equal(saved.kept.length, 2); // still two entries: the 70 step is not in it
  h.reset();
  assert.equal(h.load(saved), true);
  assert.deepEqual(h.steps().map((s) => s.label), ["", "Width 50"]);
  h.undo(); // present 40 (index 0)
  const atStart = h.save();
  assert.equal(atStart.index, 0);
  h.reset();
  doc.w = 40;
  assert.equal(h.load(atStart), true);
  assert.equal(h.canUndo(), false);
  assert.equal(h.redoLabel(), "Width 50"); // the redo step was kept
});

test("load is refused inside an undo step and for an empty save", () => {
  const { h } = rig();
  const saved = h.save();
  assert.throws(() => h.step("x", () => h.load(saved)), /can't load steps while an undo step is running/);
  assert.equal(h.load({ kept: [], index: 0 }), false);
});

test("load never keeps more than the limit (save/load hunt C9): the oldest go first, then the furthest redo", () => {
  let doc = "s5";
  const h = createHistory({ capture: () => doc, restore: (s) => (doc = s), limit: 3 });
  const kept = (n: number) => Array.from({ length: n }, (_, i) => ({ snapshot: `s${i}`, label: `Step ${i}`, mergeKey: undefined, at: i }));
  // Eight states s0..s7, the present s5 (index 5); limit 3 keeps 4 entries. Oldest first: drop s0, s1 (index 3, 6 left),
  // drop s2 (index 2, 5 left), drop s3 (index 1, 4 left): s4, s5, s6, s7 with the present at 1.
  assert.equal(h.load({ kept: kept(8), index: 5 }), true);
  assert.deepEqual(h.steps().map((s) => [s.label, s.state]), [["Step 4", "done"], ["Step 5", "current"], ["Step 6", "undone"], ["Step 7", "undone"]]);
  // The present at the very start: nothing older to drop, so the furthest redos go: s0..s3 kept, the present first.
  doc = "s0";
  assert.equal(h.load({ kept: kept(8), index: 0 }), true);
  assert.deepEqual(h.steps().map((s) => s.label), ["Step 0", "Step 1", "Step 2", "Step 3"]);
  // Exactly at the limit (4 entries): all kept.
  doc = "s3";
  assert.equal(h.load({ kept: kept(4), index: 3 }), true);
  assert.equal(h.steps().length, 4);
  assert.equal(h.undo(), "Step 3");
});

// Issue #520 (app bug hunt 2026-11-11): Ctrl+Z in a sketch opened again with Edit Sketch took back the extrude made
// before it. Design fences the history while the sketch is open: only the sketch's own steps can be undone.
test("hand-worked: a fence stops undo, redo and jumps at the present, and lets go when released", () => {
  const { h, edit, restores } = rig();
  // 40 → 50 ("Width 50", the extrude before the sketch) → 60, undone: 60 is a redo away when the fence goes up at 50.
  edit(50);
  edit(60);
  h.undo();
  const release = h.fence();
  // Nothing before the fence (40) and nothing a redo away when it went up (60) is in reach.
  assert.equal(h.canUndo(), false);
  assert.equal(h.undoLabel(), null);
  assert.equal(h.undo(), null);
  assert.equal(h.canRedo(), false);
  assert.equal(h.redoLabel(), null);
  assert.equal(h.redo(), null);
  assert.equal(h.jumpTo(0), null); // the start, behind the fence
  assert.equal(h.jumpTo(2), null); // 60, a redo away when the fence went up
  assert.deepEqual(restores, [50]); // only the undo before the fence put anything back
  // The sketch's own steps: 50 → 70 → 80. Undo goes 80 → 70 → 50 and stops; redo comes back to 80.
  edit(70, "Draw line");
  edit(80, "Draw line 2");
  assert.equal(h.undo(), "Draw line 2");
  assert.equal(h.undo(), "Draw line");
  assert.equal(h.canUndo(), false);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "Draw line");
  assert.equal(h.jumpTo(3), "Draw line 2"); // steps: 40, 50, 70, 80 — 80 is the sketch's own, in reach
  assert.equal(h.jumpTo(1), "Width 50"); // the fence's own floor is in reach
  assert.equal(h.jumpTo(0), null);
  // Released (Finish Sketch): the steps before are in reach again.
  release();
  assert.equal(h.undoLabel(), "Width 50");
  assert.equal(h.undo(), "Width 50");
  // Every restore in order: the first undo (50), undos to 70 and 50, redo to 70, jumps to 80 and 50, the last undo to 40.
  assert.deepEqual(restores, [50, 70, 50, 70, 80, 50, 40]);
});

test("a fence: the next record never merges into the step before it, reset ends it, an old release changes nothing", () => {
  const { h, edit, tick } = rig();
  edit(50, "Width", "w");
  const release = h.fence();
  tick(10); // well inside MERGE_MS: without the fence, this would fold into "Width"
  edit(55, "Width", "w");
  assert.equal(h.steps().length, 3); // 40, 50, 55: a step of its own, so the sketch can undo it alone
  assert.equal(h.undo(), "Width");
  assert.equal(h.canUndo(), false);
  const second = h.fence(); // a new fence replaces the first
  release(); // the first's release no longer lets go
  assert.equal(h.canUndo(), false);
  second();
  assert.equal(h.canUndo(), true);
  h.fence();
  h.reset();
  edit(60);
  edit(70);
  assert.equal(h.undo(), "Width 70");
  assert.equal(h.undo(), "Width 60"); // reset ended the fence: back to the start
});

test("a fence's floor taken out (amend folds it back, or the limit drops it) moves to what is kept", () => {
  // Amend: the present at the fence amended back to the state before it removes that step; the floor becomes the step before.
  const { h, doc, edit } = rig();
  edit(50);
  edit(60);
  h.fence();
  doc.w = 50;
  assert.equal(h.amend(), true); // 60 folded back to 50: the "Width 60" step is gone
  assert.equal(h.canUndo(), false); // the floor moved to 50, not past it
  edit(65);
  assert.equal(h.undo(), "Width 65");
  assert.equal(h.undo(), null);
  // The limit: limit 2 keeps 3 states; the fence's floor (40, the start) drops out as steps are made after it.
  const small = rig({ limit: 2 });
  small.h.fence();
  small.edit(50);
  small.edit(60);
  small.edit(70); // 40 dropped: 50, 60, 70 kept, all made after the fence
  assert.equal(small.h.undo(), "Width 70");
  assert.equal(small.h.undo(), "Width 60");
  assert.equal(small.h.undo(), null);
});

test("a question held work puts to the person keeps it held but not working, until answered (SL #397)", async () => {
  // An OK held while the kernel checks (working), then asking the person (held, not working), then recording.
  const h = createHistory({ capture: () => "s", restore: () => {} });
  let checked!: () => void;
  let answer!: (yes: boolean) => void;
  let asked = false;
  const ok = h.hold(
    (async () => {
      await new Promise<void>((r) => (checked = r));
      asked = true;
      return h.asking(new Promise<boolean>((r) => (answer = r)));
    })(),
  );
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([h.busy(), h.working()], [true, true], "the kernel still checks: held and working");
  checked();
  await new Promise((r) => setImmediate(r));
  assert.equal(asked, true);
  assert.deepEqual([h.busy(), h.working()], [true, false], "asked: still held (an Undo waits), but nothing runs");
  let idle = false;
  void h.whenIdle().then(() => (idle = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(idle, false, "whenIdle still waits for the answer");
  answer(true);
  assert.equal(await ok, true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([h.busy(), h.working(), idle], [false, false, true]);
});

test("a second held work beside one waiting on the person keeps the history working", async () => {
  const h = createHistory({ capture: () => "s", restore: () => {} });
  let answer!: (yes: boolean) => void;
  let other!: () => void;
  void h.hold(h.asking(new Promise<boolean>((r) => (answer = r))));
  assert.equal(h.working(), false, "one held, one asking: nothing runs");
  void h.hold(new Promise<void>((r) => (other = r)));
  assert.equal(h.working(), true, "two held, one asking: the other runs");
  other();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.working(), false);
  answer(false);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([h.busy(), h.working()], [false, false]);
});

test("callsOff counts the held work that ended with nothing recorded, and nothing else moves it (#622)", async () => {
  // By hand: a new history has called nothing off (0). Holding work, recording a step, Undo and Redo are not
  // callOff, so the count stays 0. Two callOffs make it 2: the shell compares the count at an Undo press with
  // the count when the held work is over, and 0 !== 1 is how it knows to drop the press.
  let doc = { w: 40 };
  const h = createHistory({ capture: () => structuredClone(doc), restore: (s) => (doc = structuredClone(s as { w: number })) });
  assert.equal(h.callsOff(), 0);
  let done!: () => void;
  const work = h.hold(new Promise<void>((r) => (done = r)));
  doc.w = 60;
  h.record("Width");
  done();
  await work;
  await h.whenIdle();
  assert.equal(h.callsOff(), 0, "held work that recorded a step calls nothing off");
  h.undo();
  h.redo();
  assert.equal(h.callsOff(), 0, "Undo and Redo call nothing off");
  const pressedAt = h.callsOff();
  h.callOff();
  assert.equal(h.callsOff(), pressedAt + 1, "one callOff: a press that waited sees the count moved");
  h.callOff();
  assert.equal(h.callsOff(), 2);
  assert.deepEqual(doc, { w: 60 }, "calling off changes no data");
  assert.equal(h.canUndo(), true, "and no step");
});

test("SL #708 item 3: onBusy is told when held work starts and when it ends, a failure too, and onChange never is for it", async () => {
  // The shell's Undo button reads it: from the moment an OK is held it says Undo will wait and take it back.
  const h = createHistory({ capture: () => "s", restore: () => {} });
  const busySeen: boolean[] = [];
  let changes = 0;
  const stop = h.onBusy(() => busySeen.push(h.busy()));
  h.onChange(() => changes++);
  let okDone!: () => void;
  let editFailed!: (e: Error) => void;
  const ok = h.hold(new Promise<void>((r) => (okDone = r)));
  assert.deepEqual(busySeen, [true], "told at once, busy");
  const edit = h.hold(new Promise<never>((_, j) => (editFailed = j)));
  edit.catch(() => {});
  assert.deepEqual(busySeen, [true, true]);
  okDone();
  await ok;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(busySeen, [true, true, true], "the OK ended, the edit still held");
  editFailed(new Error("refused"));
  await assert.rejects(edit, /refused/);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(busySeen, [true, true, true, false], "the last ended: no longer busy");
  assert.equal(changes, 0, "nothing that can be undone changed, so nothing is saved for it");
  stop();
  await h.hold(Promise.resolve());
  assert.equal(busySeen.length, 4, "an unsubscribed listener is not told");
});
