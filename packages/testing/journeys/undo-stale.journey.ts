// Things kept beside the design that went stale when the design changed under them (Undo hunt 2026-11-12, #623 items
// 3, 4 and 5): Exploded view through an Undo, bodies copied before an Undo, and an open Edit feature panel when a size
// is typed in the Size boxes below it. None needs timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyReference, insertMove, insertPreset, NO_MOVE, partDocument, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

/** The x range of everything drawn. */
function drawnX(a: App): [number, number] {
  const p = a.mesh()!.positions;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    lo = Math.min(lo, p[i]);
    hi = Math.max(hi, p[i]);
  }
  return [+lo.toFixed(3), +hi.toFixed(3)];
}
const type = (a: App, sel: string, value: string) => {
  const el = a.$(sel) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
};
/** Insert > `kind`, then out of the Move it opens on the new body. */
async function insert(a: App, kind: string) {
  a.$("#insert")!.click();
  (a.window.document.querySelector(`#insert-${kind}`) as unknown as HTMLElement).click();
  await a.settle();
  await a.key("clear-selection");
  await a.key("clear-selection");
}
const rows = (a: App) => a.doc().timeline.features.map((f) => `${f.provenance.self.label}: ${f.intent.summary}`);
/** A clipboard event's stand-in: the text set by a copy is the text a paste reads. */
function clipboard(text = "") {
  const held = { text };
  const e = { clipboardData: { setData: (_: string, t: string) => void (held.text = t), getData: () => held.text, files: [] } } as unknown as Event;
  return { e, held };
}

/** Box 1 (40 x 30 x 20 at the origin) and Box 2, the same, moved 100 along x. */
function twoBoxes(): DesignDocument {
  const made = insertPreset(partDocument("box", 40, 30, 20), "box", 40, 30, 20);
  return insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 100 }).doc;
}

test("Exploded view through Undo and Redo: the bodies are drawn pulled apart only while its bar and lit button say so", async () => {
  const a = await app(twoBoxes());
  // By hand: Box 1 spans x 0 to 40, Box 2, moved 100, spans 100 to 140, so in place the drawing spans 0 to 140.
  assert.deepEqual(drawnX(a), [0, 140]);
  // A step to take back that moves nothing along x: Box 1 up 5.
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("move-tool");
  type(a, "#move-z", "5");
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  a.selection.clear();
  await a.settle();
  a.$("#inspect-menu")!.click();
  await a.settle();
  (a.$("#inspect-menu-explode") as HTMLButtonElement).click();
  await a.settle();
  assert.notDeepEqual(drawnX(a), [0, 140], "Exploded view pulls the two boxes apart");
  assert.equal(a.$("#explode-bar")!.hidden, false);
  for (const press of ["Undo", "Redo"] as const) {
    if (press === "Undo") a.pressUndo();
    else a.pressRedo();
    await a.presses();
    await a.settle();
    const apart = String(drawnX(a)) !== "0,140";
    const bar = !a.$("#explode-bar")!.hidden;
    const lit = a.$("#inspect-explode")!.getAttribute("aria-pressed") === "true";
    assert.deepEqual({ press, bar, lit }, { press, bar: apart, lit: apart }, `after ${press} the bodies are drawn ${apart ? "pulled apart" : "in place"} (x ${drawnX(a)})`);
  }
  // Done still turns it off: in place again.
  if (!a.$("#explode-bar")!.hidden) (a.$("#explode-done") as HTMLButtonElement).click();
  await a.settle();
  assert.deepEqual(drawnX(a), [0, 140]);
  await a.close();
});

test("Paste after an Undo: a body copied and then undone is not pasted as the body that took its place", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  await insert(a, "sphere");
  assert.deepEqual(rows(a).length, 2);
  a.selection.set([bodyReference("body:feature-2")]); // the sphere
  await a.settle();
  const { e, held } = clipboard();
  assert.equal(await a.key("copy-svg", e), true, "Ctrl+C copies the picked body");
  // Control: pasted now, the sphere is copied.
  const control = held.text;
  a.pressUndo(); // the sphere is gone
  await a.presses();
  await a.settle();
  await insert(a, "cylinder"); // takes the sphere's place in the timeline (and its id)
  a.selection.clear();
  await a.settle();
  const before = rows(a);
  assert.equal(before.length, 2);
  assert.match(before[1], /^Cylinder 1/);
  const pasted = await a.key("paste-bodies", clipboard(control).e);
  assert.deepEqual({ pasted, rows: rows(a) }, { pasted: false, rows: before }, "the copied sphere is no longer in the design: nothing is pasted");
  // And a body still there is pasted as before.
  a.selection.set([bodyReference("body:feature-2")]);
  await a.settle();
  const again = clipboard();
  await a.key("copy-svg", again.e);
  a.selection.clear();
  await a.settle();
  assert.equal(await a.key("paste-bodies", again.e), true);
  assert.match(rows(a)[2], /^Copy 1: Copy of Cylinder 1$/);
  await a.close();
});

test("Edit feature open, a size typed in the Size boxes below it: the panel's OK never puts the old size back", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  await a.doubleClick("feature-1"); // Edit Box 1: Width 40, Depth 30, Height 20
  assert.equal((a.$("#edit-height") as HTMLInputElement).value, "20");
  type(a, "#height", "35");
  await a.settle();
  // By hand: 40 x 30 x 35 = 42,000 mm³.
  assert.equal(Math.round(a.volume()), 42000);
  // The panel, which still said 20, has gone with the design it described.
  assert.equal(a.$("#feature-edit")!.hidden, true, "Edit feature closes when the design is changed from the Size boxes");
  (a.$("#feature-edit-ok") as HTMLButtonElement | null)?.click(); // a click that still reaches it changes nothing
  await a.settle();
  assert.equal(a.doc().timeline.features[0].intent.parameters.height, 35);
  assert.equal(Math.round(a.volume()), 42000);
  assert.equal(a.history.undoLabel(), "Change height");
  await a.close();
});
