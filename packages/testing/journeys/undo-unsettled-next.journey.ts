// Undo and edit hunt 2026-11-12 (#624 item 1, #627 item 1, #622 item 4): #537's siblings. An edit made outside a
// sketch is recorded, then settled on the kernel into its own undo step (workspace.ts `settled`). A second action made
// before the kernel answered, one that brings its own design (an eye, Insert, Rename, an OK, an AI accept), was
// recorded on top and the first step's settle was dropped: Undo went back to a design nobody made (an extrude red and
// bodiless), and saving wrote it. A size typed meanwhile waited outside the project, so a reload or a project switch
// dropped it ("10" kept as 1), and anything done meanwhile jumped ahead of it (a Suppress made at the first digit; 6, 7,
// Insert recorded as distance, Insert, distance). Now every action is recorded at once, in the order made, and a settle
// answered late is written into the step it belongs to (`History.amendStep`).
// The design and its hand-worked numbers are undo-unsettled.journey.ts's; Undo and Redo are pressed as the shell
// presses them (`pressUndo`, `pressRedo`, `presses` in design-app.ts: main.ts `undoRedo`).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { acceptCommands } from "@fission/ai";
import { addSketch, designWorkspace, drawLine, extrudeSketch, partDocument, pinNewPoints, type DesignDocument, type EdgeTarget } from "@fission/design";
import { app, chooseShape } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
/** Lets the app run on while the kernel is held (`settle` would wait for the rebuild the held kernel owes). */
const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const type = (a: App, box: string, value: string) => {
  const input = a.$(box) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
};
const labels = (a: App) => a.history.steps().slice(1).map((s) => s.label);
/** From now on every kernel call waits until `release`, from the moment the step named `label` is recorded (a worker's answers come in later tasks; this in-process kernel answers in microtasks). */
const holdFrom = (a: App, label: string) => {
  const stop = a.history.onChange(() => a.history.undoLabel() === label && a.hold());
  return stop;
};
function rowMenu(a: App, id: string, entry: string) {
  a.$(`[data-item="${id}"]`)!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as unknown as Event);
  const b = a.$(`#row-menu-${entry}`) as HTMLButtonElement;
  assert.ok(b && !b.disabled, `menu entry ${entry}`);
  b.click();
}

// ---- The design: a sketch snapped to Box 1's corner ----

const CORNER = "back+bottom&back+right&bottom+right"; // Box 1's bottom back right corner, (width, depth, 0)
/** Box 1 (40 × 30 × 20) and Sketch 1 on XY, the outline (0, −20) (60, −20) (60, 40) (40, 30) with its last corner snapped to Box 1's bottom back right corner, extruded 5. */
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
const extrudeOf = (a: App) => a.doc().timeline.features.find((f) => f.intent.type === "extrude")!;
const state = (a: App) => {
  const extrude = extrudeOf(a).id;
  return {
    volume: Math.round(a.volume() * 1000) / 1000,
    extrudeFailed: a.$(`.timeline-bar-item[data-item="${extrude}"]`)!.dataset.failed === "true",
    kept: a.doc().kept?.[extrude] !== undefined,
    warned: a.warning() !== null,
  };
};
// The outline's area by the shoelace sum over (0, −20) (60, −20) (60, 40) (40, 30):
// ½ |(0·−20 − 60·−20) + (60·40 − 60·−20) + (60·30 − 40·40) + (40·−20 − 0·30)| = ½ (1200 + 3600 + 200 − 800) = 2100 mm².
const AREA = 2100;
// Box 1 made 80 wide: its corner goes to (80, 30) and the snapped point with it, so the outline's last side crosses its
// first and Sketch 1 is lost: Extrude 1 keeps its last shape (2100 · 5 = 10500) with the warning, beside the box
// 80 · 30 · 20 = 48000: 58500 mm³, Extrude 1 not failed, its shape in `kept`. The step as first recorded (unsettled)
// builds 48000 with Extrude 1 failed: the design nobody made.
const EDITED = { volume: 80 * 30 * 20 + AREA * 5, extrudeFailed: false, kept: true, warned: true };

/** Edit feature on Box 1: width 80, OK pressed (not waited for). */
async function okWidth80(a: App) {
  assert.equal(await a.menu("feature-1", "edit"), null);
  (a.$("#edit-width") as HTMLInputElement).value = "80";
  a.$("#feature-edit-ok")!.click();
}
/** Box 1's row clicked, so the size boxes describe Box 1. */
async function boxInBoxes(a: App) {
  [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((x) => x.dataset.node === "body-1")!.click();
  await a.settle();
}
const clickXyEye = (a: App) => {
  const eye = [...a.window.document.querySelectorAll<HTMLElement>("[data-eye]")].find((e) => e.dataset.eye === "origin-xy");
  assert.ok(eye, "the XY plane's eye");
  eye.click();
};
const insert = (a: App, kind: string) => {
  (a.$("#insert") as HTMLButtonElement).click();
  (a.$(`#insert-${kind}`) as HTMLButtonElement).click();
};
function rename(a: App, id: string, name: string) {
  rowMenu(a, id, "rename");
  (a.$("#rename-input") as HTMLInputElement).value = name;
  (a.$("#rename-save") as HTMLButtonElement).click();
}

// ---- An action that brings its own design, made before the edit before it is settled (#624 item 1, #622 item 4) ----

for (const [name, second, step] of [
  ["the XY plane's eye clicked", clickXyEye, "Show XY plane"],
  ["Insert > Box", (a: App) => insert(a, "box"), "Insert Box"],
  ["Extrude 1 renamed", (a: App) => rename(a, extrudeOf(a).id, "Pad"), "Rename Extrude 1"],
] as const) {
  test(`control: Edit Box 1 OK, waited for, then ${name}, then Undo: the settled edit (58500 mm³, kept, warned)`, async () => {
    const a = await app(snapped(), designWorkspace);
    await okWidth80(a);
    await a.settle();
    assert.deepEqual(state(a), EDITED);
    second(a);
    await a.settle();
    assert.equal(a.history.undoLabel(), step);
    a.pressUndo();
    await a.presses();
    await a.settle();
    assert.equal(a.history.undoLabel(), "Edit Box 1");
    assert.deepEqual(state(a), EDITED);
    assert.ok(await a.close());
  });

  test(`Edit Box 1 OK, then ${name} before the kernel has settled it, then Undo: the same settled edit, and Redo brings the second step back settled`, async (t) => {
    const a = await app(snapped(), designWorkspace);
    t.after(() => a.release()); // a failed check never leaves the kernel held for the next test
    const stop = holdFrom(a, "Edit Box 1");
    await okWidth80(a);
    await turns();
    stop();
    assert.equal(a.history.busy(), true, "the edit is still being settled");
    second(a); // straight after OK
    await turns();
    assert.deepEqual(labels(a), ["Edit Box 1", step], "recorded at once, in the order made");
    await a.release();
    await a.settle();
    assert.deepEqual(state(a), EDITED, "the second step is settled too");
    a.pressUndo();
    await a.presses();
    await a.settle();
    assert.equal(a.history.undoLabel(), "Edit Box 1", "one Undo took back the second step only");
    assert.deepEqual(state(a), EDITED, "the step Undo lands on is the settled edit, not the one first recorded");
    // What is saved now opens the same: the settled design, not 48000 with Extrude 1 failed.
    const saved = structuredClone(a.doc());
    a.pressRedo();
    await a.presses();
    await a.settle();
    assert.equal(a.history.undoLabel(), step);
    assert.deepEqual(state(a), EDITED);
    assert.ok(await a.close());
    const b = await app(saved, designWorkspace);
    assert.deepEqual(state(b), EDITED, "the undone-to step, opened afresh");
    assert.ok(await b.close());
  });
}

test("a width typed, then Extrude 1 renamed before the kernel has settled the width: Undo of the rename gives the settled 80-wide design", async (t) => {
  const a = await app(snapped(), designWorkspace);
  t.after(() => a.release());
  await boxInBoxes(a);
  const stop = holdFrom(a, "Change width");
  type(a, "#width", "80");
  await turns();
  stop();
  assert.equal(a.history.busy(), true);
  rename(a, extrudeOf(a).id, "Pad");
  await turns();
  assert.deepEqual(labels(a), ["Change width", "Rename Extrude 1"]);
  await a.release();
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.equal(a.history.undoLabel(), "Change width");
  assert.deepEqual(state(a), EDITED);
  assert.ok(await a.close());
});

test("an AI change accepted before the kernel has settled a width: the AI's change is its own one step, and Undo of it gives the settled width", async (t) => {
  const a = await app(snapped(), designWorkspace);
  t.after(() => a.release());
  await boxInBoxes(a);
  const stop = holdFrom(a, "Change width");
  type(a, "#width", "80");
  await turns();
  stop();
  assert.equal(a.history.busy(), true);
  // As the assistant's Accept runs it (packages/ai actions.ts): the commands inside one undo step, at once.
  acceptCommands(a.history, "AI: rename the extrude", [{ op: "rename_item", item: "Extrude 1", name: "Pad" }], (c) => void a.command(c));
  await turns();
  assert.deepEqual(labels(a), ["Change width", "AI: rename the extrude"]);
  await a.release();
  assert.equal(extrudeOf(a).provenance.self.label, "Pad");
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.equal(a.history.undoLabel(), "Change width");
  assert.equal(extrudeOf(a).provenance.self.label, "Extrude 1");
  assert.deepEqual(state(a), EDITED);
  assert.ok(await a.close());
});

// ---- A size typed while the edit before it settles: in the project at once, in the order made (#627 item 1, #622 item 4) ----

const distance = (a: App) => extrudeOf(a).intent.summary;
// The size boxes describe Extrude 1, the last body: its one box (#height) is the distance. Box 1 stays 40 · 30 · 20 =
// 24000 and the outline keeps its 2100 mm², so a distance d builds 24000 + 2100 d.
const withDistance = (d: number) => 24000 + AREA * d;

test("1 then 10 typed in the distance box while the kernel still settles the 1: the project holds 10 at once (a reload or project switch keeps it)", async (t) => {
  const a = await app(snapped(), designWorkspace);
  t.after(() => a.release());
  const stop = holdFrom(a, "Change extrude distance");
  type(a, "#height", "1");
  await turns();
  stop();
  assert.equal(a.history.busy(), true, "the 1 is still being settled");
  type(a, "#height", "10");
  await turns();
  // What the journal, autosave and a project switch read: the project as it is now, before the kernel answers.
  assert.equal(distance(a), "Extrude Sketch 1 by 10 mm");
  await a.release();
  assert.deepEqual(labels(a), ["Change extrude distance"], "1 then 0 typed in one box: one step");
  assert.equal(Math.round(a.volume()), withDistance(10)); // 24000 + 21000 = 45000
  assert.ok(await a.close());
});

test("1 then 12 typed in the distance box, then Suppress on Extrude 1, all before the kernel answers: Extrude 1 suppressed with distance 12", async (t) => {
  const a = await app(snapped(), designWorkspace);
  t.after(() => a.release());
  const ex = extrudeOf(a).id;
  a.hold();
  type(a, "#height", "1");
  await turns();
  type(a, "#height", "12");
  await turns();
  rowMenu(a, ex, "suppress");
  await turns();
  await a.release();
  await a.settle();
  assert.deepEqual(labels(a), ["Change extrude distance", "Suppress Extrude 1"]);
  assert.equal(distance(a), "Extrude Sketch 1 by 12 mm");
  assert.equal(extrudeOf(a).suppressed, true);
  assert.equal(Math.round(a.volume()), 24000, "Box 1 alone");
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.equal(Math.round(a.volume()), withDistance(12), "unsuppressed at 12: 24000 + 25200 = 49200");
  assert.ok(await a.close());
});

test("6 then 7 typed in the distance box, then Insert > Cylinder, all before the kernel answers: Insert is the last step, and Undo takes back only it", async (t) => {
  const a = await app(snapped(), designWorkspace);
  t.after(() => a.release());
  a.hold();
  type(a, "#height", "6");
  await turns();
  type(a, "#height", "7");
  await turns();
  insert(a, "cylinder");
  await turns();
  await a.release();
  await a.settle();
  assert.deepEqual(labels(a), ["Change extrude distance", "Insert Cylinder"], "in the order made");
  assert.equal(distance(a), "Extrude Sketch 1 by 7 mm");
  a.pressUndo();
  await a.presses();
  await a.settle();
  assert.equal(a.history.undoLabel(), "Change extrude distance");
  assert.equal(a.doc().timeline.features.length, 3, "the cylinder is gone");
  assert.equal(distance(a), "Extrude Sketch 1 by 7 mm");
  assert.equal(Math.round(a.volume()), withDistance(7), "24000 + 14700 = 38700");
  assert.ok(await a.close());
});

// ---- A sketch on a face, the shape changed, then Insert before the kernel answers ----

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
const heldPlace = (a: App) => a.doc().sketches[0].face!.held !== undefined;
/** The design's reach along x, read off the shown mesh. */
const maxX = (a: App) => {
  const p = a.mesh()!.positions;
  let hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) hi = Math.max(hi, p[i]);
  return hi;
};
/** Box 1 40 × 30 × 20, a circle sketched on its right face (x = 40) and extruded 5, then Box 1 made 60 wide: the sketch follows to x = 60, so the disc reaches 65. Box 1 is then picked, so the Shape choice changes it. */
async function widened() {
  const a = await app(partDocument("box", 40, 30, 20));
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, (p) => p[0] === 40) });
  await a.key("sketch-circle");
  await a.click(15, 10);
  await a.click(18, 10);
  await a.finish();
  await a.command({ op: "extrude_sketch", distance: 5 } as never);
  assert.equal(await a.menu(a.doc().timeline.features[0].id, "edit"), null);
  (a.$("#edit-width") as HTMLInputElement).value = "60";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.equal(maxX(a), 65);
  await a.pick({ face: faceWhere(a.mesh()!, (p) => p[2] === 0) });
  return a;
}

test("Box 1 made a cylinder, then Insert > Box before the kernel has settled it, then Undo: the shape change still holds the lost sketch at x = 60", async (t) => {
  // The control, waited for: Box 1 as a cylinder has no right face, so the sketch is lost and stays where it LAST lay,
  // x = 60 (the owner's rule, face-hunt.journey.ts), held in the design; its disc, 5 thick, reaches x = 65.
  const slow = await widened();
  chooseShape(slow, "Cylinder");
  await slow.settle();
  insert(slow, "box");
  await slow.settle();
  slow.pressUndo();
  await slow.presses();
  await slow.settle();
  const want = { undo: slow.history.undoLabel(), held: heldPlace(slow), maxX: maxX(slow), volume: Math.round(slow.volume()) };
  assert.ok(await slow.close());
  assert.deepEqual({ ...want, volume: 0 }, { undo: "Change shape to Cylinder", held: true, maxX: 65, volume: 0 });

  const a = await widened();
  t.after(() => a.release());
  a.hold();
  chooseShape(a, "Cylinder");
  await turns();
  assert.equal(a.history.busy(), true, "the shape's settle is held");
  insert(a, "box");
  await turns();
  await a.release();
  assert.equal(a.history.undoLabel(), "Insert Box");
  assert.equal(heldPlace(a), true, "after both, the sketch is held at x = 60");
  a.pressUndo();
  await a.presses();
  await a.settle();
  const got = { undo: a.history.undoLabel(), held: heldPlace(a), maxX: maxX(a), volume: Math.round(a.volume()) };
  assert.ok(await a.close());
  assert.deepEqual(got, want);
});
