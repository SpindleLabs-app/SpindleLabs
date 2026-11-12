// `History.present` and `History.amendStep` (undo hunt 2026-11-12, #624 / #622): a step put right after later steps
// were recorded on top, as Design's settle answered late is; and `withWorkspaceDocument`, the snapshot it writes. A tiny
// stand-in project: a box width and a label held in `doc`, captured as JSON. Every expected value is worked out by hand
// in the comment beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../src/model/history.ts";
import { emptyProject, projectToJson, withWorkspaceDocument, type Project } from "../src/model/project.ts";

function rig() {
  const doc = { w: 40, name: "Box" };
  let t = 0;
  const h = createHistory({
    capture: () => JSON.stringify(doc),
    restore: (s) => Object.assign(doc, JSON.parse(s)),
    now: () => t,
  });
  let changes = 0;
  h.onChange(() => changes++);
  const edit = (w: number, key?: string) => {
    doc.w = w;
    return h.record(`Width ${w}`, key);
  };
  const rename = (name: string) => {
    doc.name = name;
    return h.record(`Rename ${name}`);
  };
  /** A rewrite that puts width `w` into whatever step it is given. */
  const widthTo = (w: number) => (s: string) => JSON.stringify({ ...JSON.parse(s), w });
  return { h, doc, edit, rename, widthTo, tick: (ms: number) => (t += ms), changes: () => changes };
}
const widths = (h: ReturnType<typeof rig>["h"], doc: { w: number }) => {
  // Every state Undo and Redo reach, from the start: undo all the way, then redo all the way back.
  while (h.canUndo()) h.undo();
  const seen = [doc.w];
  while (h.canRedo()) {
    h.redo();
    seen.push(doc.w);
  }
  return seen;
};

test("a step put right after another was recorded on top: Undo lands on the put-right state, the later step is kept as it was", () => {
  const { h, doc, edit, rename, widthTo, changes } = rig();
  edit(50); // the step a settle will put right: 50 as first recorded, 55 once settled
  const step = h.present();
  rename("Pad"); // recorded on top before the settle answered
  const before = changes();
  assert.equal(h.amendStep(step, widthTo(55)), true);
  assert.equal(changes(), before + 1, "listeners hear of it");
  assert.deepEqual(doc, { w: 50, name: "Pad" }, "the present is not touched");
  assert.equal(h.undoLabel(), "Rename Pad");
  h.undo();
  // Undo of the rename puts back the step below as put right: 55 wide, still "Box".
  assert.deepEqual(doc, { w: 55, name: "Box" });
  assert.equal(h.undoLabel(), "Width 50");
  h.redo();
  assert.deepEqual(doc, { w: 50, name: "Pad" }, "Redo brings the later step back as recorded");
  // From the start: 40, then the put-right 55, then the rename's own state.
  assert.deepEqual(widths(h, doc), [40, 55, 50]);
});

test("the present step put right is the same as amending it, and the next key typed still merges into it", () => {
  const { h, doc, edit, widthTo, tick } = rig();
  edit(5, "w");
  const step = h.present();
  doc.w = 7; // the project as the settle left it
  assert.equal(h.amendStep(step, widthTo(7)), true);
  tick(100);
  edit(70, "w"); // within MERGE_MS of the first key, same key: one step
  assert.equal(h.steps().length, 2, "the start and one typed step");
  h.undo();
  assert.equal(doc.w, 40);
});

test("nothing is rewritten for a step changed since, gone, or a rewrite that leaves it", () => {
  const { h, doc, edit, widthTo, tick, changes } = rig();
  edit(5, "w");
  const typed = h.present();
  tick(100);
  edit(50, "w"); // merged into the same step: `typed` names the step as it was, no more
  const before = changes();
  assert.equal(h.amendStep(typed, widthTo(99)), false, "a step merged into since");
  assert.equal(h.amendStep(h.present(), () => null), false, "the rewrite leaves it");
  assert.equal(h.amendStep(h.present(), (s) => s), false, "the rewrite gives the same text");
  assert.equal(h.amendStep({}, widthTo(99)), false, "never a step of this history");
  const merged = h.present();
  h.undo();
  edit(60); // a new step after an Undo drops the step a redo away
  assert.equal(h.amendStep(merged, widthTo(99)), false, "a step dropped");
  assert.equal(changes(), before + 2, "only the undo and the record told the listeners");
  assert.deepEqual(widths(h, doc), [40, 60]);
});

test("a step put right into the state before it has nothing to undo, so it is removed; the present stays the present", () => {
  const { h, doc, edit, rename, widthTo } = rig();
  edit(50);
  const step = h.present();
  rename("Pad");
  // The step below the rename put right as 40: the same as the start, {w: 40, name: "Box"}.
  assert.equal(h.amendStep(step, widthTo(40)), true);
  assert.deepEqual(h.steps().map((s) => s.label), ["", "Rename Pad"]);
  assert.equal(h.undoLabel(), "Rename Pad");
  assert.deepEqual(doc, { w: 50, name: "Pad" });
  h.undo();
  assert.deepEqual(doc, { w: 40, name: "Box" });
  assert.equal(h.canUndo(), false);
  // The present itself put back to the state before it: gone, Undo has nothing to take back.
  const { h: h2, edit: edit2, widthTo: widthTo2 } = rig();
  edit2(50);
  assert.equal(h2.amendStep(h2.present(), widthTo2(40)), true);
  assert.equal(h2.canUndo(), false);
  assert.equal(h2.steps().length, 1);
});

test("refused while a snapshot is being put back and inside a step", () => {
  const { h, edit, widthTo } = rig();
  edit(50);
  const step = h.present();
  edit(60);
  assert.equal(h.step("Two at once", () => h.amendStep(step, widthTo(55))), false);
  assert.equal(h.undoLabel(), "Width 60");
  // Asked from inside a restore (an Undo putting a snapshot back): refused.
  let state = "a";
  const answers: boolean[] = [];
  const r = createHistory({
    capture: () => state,
    restore: (s) => {
      answers.push(r.amendStep(r.present(), () => "z"));
      state = s;
    },
  });
  state = "b";
  r.record("B");
  r.undo();
  assert.deepEqual(answers, [false]);
  assert.equal(state, "a");
  r.redo();
  assert.equal(state, "b", "the step was not rewritten");
});

// ---- withWorkspaceDocument: the snapshot of the project with one workspace's document put right ----

const project = (design: unknown): Project => ({ ...emptyProject("P"), workspaces: { design, slice: { layer: 0.2 } } });

test("the snapshot with Design's document swapped is exactly what capturing that project writes", () => {
  const was = { box: { w: 50 }, notes: undefined };
  const now = { box: { w: 55 }, kept: { a: 1 } };
  const snapshot = projectToJson(project(was));
  // By the rule: the text `projectToJson` writes for the same project holding `now` (Slice's part untouched).
  assert.equal(withWorkspaceDocument(snapshot, "design", was, now), projectToJson(project(now)));
  // Keys in any order and left-out keys are the same document: `projectToJson` sorts and drops them.
  assert.equal(withWorkspaceDocument(snapshot, "design", { box: { w: 50 } }, now), projectToJson(project(now)));
});

test("null when the snapshot does not hold that document, or can't be read, or the new one can't be saved", () => {
  const snapshot = projectToJson(project({ box: { w: 50 } }));
  assert.equal(withWorkspaceDocument(snapshot, "design", { box: { w: 51 } }, { box: { w: 55 } }), null, "another document");
  assert.equal(withWorkspaceDocument(snapshot, "render", { box: { w: 50 } }, { box: { w: 55 } }), null, "no such workspace in it");
  assert.equal(withWorkspaceDocument("{not json", "design", {}, {}), null);
  assert.equal(withWorkspaceDocument("[1]", "design", {}, {}), null);
  assert.equal(withWorkspaceDocument("null", "design", undefined, {}), null, "not an object");
  assert.equal(withWorkspaceDocument('{"workspaces":null}', "design", undefined, {}), null, "no workspaces");
  assert.equal(withWorkspaceDocument('{"workspaces":[]}', "design", undefined, {}), null, "workspaces not an object");
  // A workspace the snapshot doesn't hold is never one whose document was `undefined`: nothing to put right.
  assert.equal(withWorkspaceDocument(snapshot, "render", undefined, { box: { w: 55 } }), null, "no render document");
  assert.equal(withWorkspaceDocument(snapshot, "design", { box: { w: 50 } }, { box: { w: Infinity } }), null, "no file can hold it");
});

test("the first state put right, and a removed present never lets the next key merge into the step below it", () => {
  const { h, doc, edit, widthTo, tick } = rig();
  const start = h.present();
  edit(50, "w"); // step X, typed in the width box
  // The start itself put right (a file whose design settles differently once built): Undo lands on 45.
  assert.equal(h.amendStep(start, widthTo(45)), true);
  h.undo();
  assert.equal(doc.w, 45);
  h.redo();
  tick(100);
  edit(60, "v"); // step A, another box: a step of its own
  const a = h.present();
  // A put right into X's state, 50 wide: nothing to undo, so it goes and X is the present again.
  assert.equal(h.amendStep(a, widthTo(50)), true);
  assert.equal(h.undoLabel(), "Width 50");
  tick(100);
  edit(70, "w"); // X's key, within MERGE_MS of X: still its own step, since X was not the last thing recorded
  assert.deepEqual(h.steps().map((s) => s.label), ["", "Width 50", "Width 70"]);
  h.undo();
  assert.equal(doc.w, 50);
});

test("a step below the present removed keeps the typing in the present one step; one a redo away removed leaves the present where it is", () => {
  const { h, doc, edit, rename, widthTo, tick } = rig();
  rename("Pad"); // X: {w: 40, name: "Pad"}
  const x = h.present();
  tick(100);
  edit(60, "w"); // A, the present, typed in the width box
  // X put right into the start's state ({w: 40, name: "Box"}): removed, A stays the present and still the last record.
  assert.equal(h.amendStep(x, (s) => JSON.stringify({ ...JSON.parse(s), name: "Box" })), true);
  assert.equal(h.undoLabel(), "Width 60");
  tick(100);
  edit(65, "w"); // the next key in the same box: merged into A
  assert.deepEqual(h.steps().map((s) => s.label), ["", "Width 65"]);
  // [start, Width 65, Width 70]; Undo once, so Width 70 is a redo away, then put it right into Width 65's state.
  tick(2000);
  edit(70);
  const y = h.present();
  h.undo();
  assert.equal(h.amendStep(y, widthTo(65)), true);
  assert.equal(h.canRedo(), false, "the redo had nothing to bring back");
  assert.equal(h.undoLabel(), "Width 65", "the present is still Width 65");
  assert.equal(doc.w, 65);
});
