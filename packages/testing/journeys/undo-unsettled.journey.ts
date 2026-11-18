// Timeline and rebuild hunt 2026-11-11, D1 (#537 item 1): an edit made outside a sketch is recorded, then settled on
// the kernel into its own undo step (workspace.ts `settled`: a kept shape, a held sketch place, followed points). Undo
// pressed before the kernel answered used to put the project back first, the settle was dropped, and Redo brought back
// the step as first recorded: a design nobody made (an extrude failed instead of keeping its shape, a lost sketch
// drawn where it was first drawn). The settle is now held in the history, so the shell's Undo waits for it, and an
// edit made meanwhile is recorded at once, in the order made, the settle written into its own step when it comes
// (`History.amendStep`, undo hunt 2026-11-12: a size that waited its turn instead was lost on a reload or another
// project, #627; more in undo-unsettled-next.journey.ts), so every step is the settled design.
// Undo and Redo are pressed as the shell presses them (`pressUndo`, `pressRedo` in design-app.ts: main.ts `undoRedo`).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { addSketch, designWorkspace, drawLine, extrudeSketch, partDocument, pinNewPoints, type DesignDocument, type EdgeTarget } from "@fission/design";
import { app, chooseShape, close } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
/** Lets the app run on while the kernel is held (`settle` would wait for the rebuild the held kernel owes). */
const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

// ---- Edit feature OK, Undo straight after, Redo (D1) ----

const CORNER = "back+bottom&back+right&bottom+right"; // Box 1's bottom back right corner, (width, depth, 0)
/**
 * Box 1 (40 × 30 × 20) and Sketch 1 on XY, the outline (0, −20) (60, −20) (60, 40) (40, 30) with its last corner
 * snapped to Box 1's bottom back right corner, extruded 5 (lost-followed-sketch.journey.ts's design).
 */
function snapped(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  let doc = s.doc;
  const pts: [number, number][] = [[0, -20], [60, -20], [60, 40], [40, 30]];
  for (let i = 0; i < 4; i++) {
    const sk = doc.sketches.find((x) => x.id === s.id)!;
    const at = (p: [number, number]) => sk.points.find((q) => q.x === p[0] && q.y === p[1])?.id ?? p;
    doc = drawLine(doc, s.id, at(pts[i]), at(pts[(i + 1) % 4])).doc;
  }
  const corner: EdgeTarget = { at: [40, 30], kind: "endpoint", name: CORNER, feature: "feature-1" };
  doc = pinNewPoints(s.doc, doc, s.id, [corner]);
  return extrudeSketch(doc, s.id, 5).doc;
}
const state = (a: App) => {
  const extrude = a.doc().timeline.features.at(-1)!.id;
  return {
    volume: Math.round(a.volume() * 1000) / 1000,
    extrudeFailed: a.$(`.timeline-bar-item[data-item="${extrude}"]`)!.dataset.failed === "true",
    kept: a.doc().kept?.[extrude] !== undefined,
    warned: a.warning() !== null,
  };
};
// Before: the box 40 · 30 · 20 = 24000, and the outline's area by the shoelace sum over (0, −20) (60, −20) (60, 40)
// (40, 30): ½ |(0·−20 − 60·−20) + (60·40 − 60·−20) + (60·30 − 40·40) + (40·−20 − 0·30)| = ½ (1200 + 3600 + 200 − 800)
// = 2100 mm², times 5 = 10500: 34500 mm³.
const BEFORE = 24000 + 10500;
// Box 1 made 80 wide: its corner goes to (80, 30) and the snapped point with it, so the outline's last side crosses
// its first and Sketch 1 is lost: Extrude 1 keeps its last shape (10500) with the warning, beside the box 80 · 30 · 20
// = 48000: 58500 mm³, Extrude 1 not failed, its shape in `kept`.
const EDITED = { volume: 48000 + 10500, extrudeFailed: false, kept: true, warned: true };
/** Edit feature on Box 1: width 80, OK pressed (not waited for). */
async function okWidth80(a: App) {
  assert.equal(await a.menu("feature-1", "edit"), null);
  (a.$("#edit-width") as HTMLInputElement).value = "80";
  a.$("#feature-edit-ok")!.click();
}

test("control: Edit Box 1 to 80 wide, waited for: Extrude 1 keeps its last shape (58500 mm³, warned); Undo and Redo give it back the same", async () => {
  const a = await app(snapped(), designWorkspace);
  assert.ok(close(a.volume(), BEFORE), `${a.volume()}`);
  await okWidth80(a);
  await a.settle();
  assert.deepEqual(state(a), EDITED);
  await a.undo();
  assert.ok(close(a.volume(), BEFORE), `${a.volume()}`);
  await a.redo();
  assert.deepEqual(state(a), EDITED);
  assert.ok(await a.close());
});

test("Edit Box 1 OK, Undo pressed while the kernel still settles it, then Redo: the step is the one a waited-for OK records (58500 mm³, kept, warned)", async (t) => {
  const a = await app(snapped(), designWorkspace);
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  assert.ok(close(a.volume(), BEFORE), `${a.volume()}`);
  // A worker's answers come in later tasks; this in-process kernel answers in microtasks. So that the order is the
  // browser's, every kernel call made once the step is recorded waits until released.
  const stop = a.history.onChange(() => a.history.undoLabel() === "Edit Box 1" && a.hold());
  await okWidth80(a);
  assert.equal(a.history.busy(), true, "the OK is held while the kernel checks it");
  a.pressUndo(); // Ctrl+Z straight after OK: it waits
  await turns();
  stop();
  assert.equal(a.history.undoLabel(), "Edit Box 1", "the Undo still waits: the step is not settled yet");
  assert.equal(a.history.busy(), true, "the step is held until it is settled");
  await a.release();
  await a.presses();
  await a.settle();
  assert.equal(a.history.busy(), false);
  assert.equal(a.history.redoLabel(), "Edit Box 1", "the waiting Undo took back the OK");
  assert.ok(close(a.volume(), BEFORE), `undone: the design before, ${a.volume()}`);
  a.pressRedo(); // Ctrl+Shift+Z, any time later
  await a.presses();
  await a.settle();
  const got = state(a);
  assert.ok(await a.close());
  assert.deepEqual(got, EDITED);
});

// ---- A shape change, Undo and Redo before the kernel answers (D1b); two edits in a row, then Undo (D1c) ----

function faceWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((k) => {
      const i = mesh.indices[3 * t + k];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  const found = [...all].filter(([, ok]) => ok).map(([f]) => f);
  assert.equal(found.length, 1, `one face, got ${found}`);
  return found[0];
}
/** Where each sketch is drawn, and whether as lost (red). */
const drawn = (a: App) => a.drawings().filter((d) => !d.editing).map((d) => ({ origin: [...d.plane.origin], lost: d.lost === true }));
const heldPlace = (a: App) => a.doc().sketches[0].face!.held !== undefined;
/**
 * Box 1 (40 × 30 × 20) with a circle sketched on its right face (the plane x = 40), then made 60 wide by Edit feature:
 * the face is now the plane x = 60 and the sketch follows it, so it is drawn with its origin at (60, 0, 0), found.
 */
async function widened() {
  const a = await app(partDocument("box", 40, 30, 20));
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, (p) => p[0] === 40) });
  await a.key("sketch-circle");
  await a.click(15, 10);
  await a.click(18, 10);
  await a.finish();
  assert.equal(await a.menu(a.doc().timeline.features[0].id, "edit"), null);
  (a.$("#edit-width") as HTMLInputElement).value = "60";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.deepEqual(drawn(a), [{ origin: [60, 0, 0], lost: false }]);
  return a;
}
// Box 1 made a cylinder has no right face: the sketch is lost and stays where it LAST lay, the plane x = 60 (the
// owner's rule, face-hunt.journey.ts), never where it was first drawn (x = 40); the place is held in the design.
const LOST_AT_60 = [{ origin: [60, 0, 0], lost: true }];
const type = (a: App, box: string, value: string) => {
  const input = a.$(box) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
};

test("control: the shape changed to Cylinder, waited for: the sketch stays at x = 60, lost and held; Undo and Redo give it back the same", async () => {
  const a = await widened();
  chooseShape(a, "Cylinder");
  await a.settle();
  assert.deepEqual(drawn(a), LOST_AT_60);
  assert.equal(heldPlace(a), true);
  await a.undo();
  assert.deepEqual(drawn(a), [{ origin: [60, 0, 0], lost: false }]);
  await a.redo();
  assert.deepEqual(drawn(a), LOST_AT_60);
  assert.equal(heldPlace(a), true);
  assert.ok(await a.close());
});

test("the shape changed, then Undo and Redo pressed before the kernel has answered: the step still holds the sketch at x = 60", async (t) => {
  const a = await widened();
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  a.hold();
  chooseShape(a, "Cylinder");
  await turns();
  assert.equal(a.history.undoLabel(), "Change shape to Cylinder");
  assert.equal(a.history.busy(), true, "the step is held until the kernel has settled it");
  a.pressUndo();
  a.pressRedo();
  await turns();
  assert.equal(a.history.undoLabel(), "Change shape to Cylinder", "both presses wait");
  await a.release();
  await a.presses();
  await a.settle();
  assert.equal(a.history.busy(), false);
  assert.equal(a.history.undoLabel(), "Change shape to Cylinder", "undone, then done again");
  const got = { drawn: drawn(a), held: heldPlace(a) };
  assert.ok(await a.close());
  assert.deepEqual(got, { drawn: LOST_AT_60, held: true });
});

test("the shape changed, then a height typed before the kernel has answered, then Undo: two steps, the first as it is when waited for", async (t) => {
  const a = await widened();
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  a.hold();
  chooseShape(a, "Cylinder");
  await turns();
  type(a, "#height", "25"); // a second edit, while the first still settles: recorded at once, its own step
  await turns();
  assert.equal(a.history.undoLabel(), "Change height", "the height is recorded at once, after the shape (#627: it waited outside the project)");
  assert.deepEqual(a.history.steps().slice(-2).map((s) => s.label), ["Change shape to Cylinder", "Change height"]);
  await a.release();
  assert.equal(a.history.busy(), false);
  assert.equal(a.history.undoLabel(), "Change height");
  assert.deepEqual(drawn(a), LOST_AT_60);
  // The cylinder's height: the top of the mesh.
  const top = () => Math.max(...a.mesh()!.positions.filter((_, i) => i % 3 === 2));
  assert.equal(top(), 25);
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.equal(a.history.undoLabel(), "Change shape to Cylinder");
  assert.equal(top(), 20);
  const got = { drawn: drawn(a), held: heldPlace(a) };
  assert.ok(await a.close());
  assert.deepEqual(got, { drawn: LOST_AT_60, held: true });
});

test("the shape changed, a height typed and then Undo pressed, all before the kernel has answered: they happen in the order asked", async (t) => {
  const a = await widened();
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  a.hold();
  chooseShape(a, "Cylinder");
  await turns();
  type(a, "#height", "25");
  a.pressUndo(); // pressed after the height was typed: it takes back the height, once both are settled
  await turns();
  assert.equal(a.history.undoLabel(), "Change height", "the height is recorded at once; the Undo waits");
  assert.equal(a.history.redoLabel(), null);
  await a.release();
  await a.presses();
  await a.settle();
  assert.equal(a.history.busy(), false);
  const got = { undo: a.history.undoLabel(), redo: a.history.redoLabel(), drawn: drawn(a), held: heldPlace(a), top: Math.max(...a.mesh()!.positions.filter((_, i) => i % 3 === 2)) };
  assert.ok(await a.close());
  // Both steps were made, then the height taken back: the cylinder 20 high again, the sketch lost at x = 60 and held.
  assert.deepEqual(got, { undo: "Change shape to Cylinder", redo: "Change height", drawn: LOST_AT_60, held: true, top: 20 });
});

// ---- What must stay as it was ----

test("typing in one size box while the kernel settles each key is still one undo step", async (t) => {
  const a = await widened();
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  const steps = a.history.steps().length;
  a.hold();
  type(a, "#width", "7");
  await turns();
  type(a, "#width", "70");
  await turns();
  await a.release();
  assert.equal(a.history.busy(), false);
  assert.equal(a.history.steps().length, steps + 1, "7 then 0 typed: one step");
  assert.equal(a.history.undoLabel(), "Change width");
  // The box is 70 wide, so its right face is the plane x = 70 and the sketch on it follows.
  assert.deepEqual(drawn(a), [{ origin: [70, 0, 0], lost: false }]);
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.deepEqual(drawn(a), [{ origin: [60, 0, 0], lost: false }], "one Undo takes back both keys");
  assert.ok(await a.close());
});

test("the hold is let go when the kernel fails the settle, and when Design is put away while it runs", async (t) => {
  const a = await widened();
  t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
  // The first kernel call after the shape change is the settle's: it fails once. Nothing stays held, and Undo works.
  a.failCall(1);
  chooseShape(a, "Cylinder");
  await a.settle();
  assert.equal(a.calls().failed !== null, true, "a call failed");
  assert.equal(a.history.busy(), false, "a failed settle holds nothing");
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.deepEqual(drawn(a), [{ origin: [60, 0, 0], lost: false }]);
  // Design mounted afresh (moved to the other pane) while a settle runs, a height typed meanwhile: the height is kept as
  // its own step (it used to wait its turn outside the project and was dropped: #627), and the history is let go once
  // the kernel has answered.
  a.failCall(0);
  a.hold();
  chooseShape(a, "Cylinder");
  await turns();
  type(a, "#height", "25");
  await turns();
  assert.equal(a.history.busy(), true);
  const remounted = a.remount(); // put away and mounted at once; its own wait ends once the kernel answers again
  await turns();
  await a.release();
  await remounted;
  assert.equal(a.history.busy(), false, "nothing is held once the kernel has answered");
  assert.equal(a.history.undoLabel(), "Change height", "the height typed before Design was put away is kept");
  assert.ok(await a.close());
});
