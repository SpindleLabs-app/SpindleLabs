// SL #622 item 7 (Undo hunt 2026-11-12, C4 and D3): the pieces an item
// makes (a Combine Join of boxes apart, an extrude of two profiles) were
// numbered only when the rebuild after OK landed, and taken into the step
// then. An Insert made before that took the next number first, so one
// body was "Body 4" after the Insert, "Body 3" after Undo and "Body 4"
// again after Redo. Now OK numbers them from its own check build, in its
// own undo step, so a body keeps one number whichever side of an Undo you
// are. Each case is run slowly too (the control: the rebuild landed
// first), which must give the same numbers. On the real kernel, in the
// app around Design (design-app.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;

const turns = async (n = 60) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
/** Each body's number by its id ("body:feature-4/piece:1=Body 3"). */
const numbers = (a: App) => new Map((a.doc().bodies ?? []).map((b) => [b.id, b.number] as const));
const insertBox = (a: App) => {
  a.$("#insert")!.click();
  (a.$("#insert-box") as HTMLButtonElement).click();
};
/** A face of the drawn mesh all of whose corners pass `on`. */
function faceWhere(a: App, on: (p: number[]) => boolean): number {
  const mesh = a.mesh()!;
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const corners = [0, 1, 2].map((k) => { const i = mesh.indices[3 * t + k]; return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]; });
    all.set(f, (all.get(f) ?? true) && corners.every(on));
  });
  return [...all].filter(([, ok]) => ok).map(([f]) => f)[0];
}

/**
 * OK pressed by `ok`, which records `label`; with `quick` the kernel is held from that record, so Insert ▾ Box lands
 * before the OK's rebuild does. Then Undo and Redo. The numbers of `piece` and of the new box at each point.
 */
async function okThenInsert(a: App, ok: () => void, label: (l: string | null) => boolean, quick: boolean, pieceOf: (made: string) => string) {
  const off = a.history.onChange(() => { if (quick && label(a.history.undoLabel())) a.hold(); });
  ok();
  for (let i = 0; i < 60 && !label(a.history.undoLabel()); i++) await turns(1);
  assert.ok(label(a.history.undoLabel()), `OK recorded (undo says ${a.history.undoLabel()})`);
  off();
  if (!quick) await a.settle();
  const piece = pieceOf(a.doc().timeline.features.at(-1)!.id);
  insertBox(a);
  await turns(10);
  if (quick) await a.release();
  await a.settle();
  if (a.$("#move-panel") && !a.$("#move-panel")!.hidden) await a.key("clear-selection");
  const box = a.doc().timeline.features.at(-1)!.id;
  const after = numbers(a);
  await a.undo();
  const undone = numbers(a);
  await a.redo();
  const redone = numbers(a);
  return { piece: [after.get(piece), undone.get(piece), redone.get(piece)], box: [after.get(`body:${box}`), redone.get(`body:${box}`)] };
}

/** Box 1 x 0..10 and Box 2 moved to x 20..30: apart. */
function twoBoxes(): DesignDocument {
  const doc = partDocument("box", 10, 10, 10);
  const made = insertPreset(doc, "box", 10, 10, 10);
  return insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 20 }).doc;
}

async function combineRun(quick: boolean) {
  const a = await app(twoBoxes(), designWorkspace);
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a, (p) => close(p[0], 0)) });
  await a.pick({ face: faceWhere(a, (p) => close(p[0], 30)) });
  // Join of boxes apart (Fusion's F2): Box 1 stays Body 1, Box 2's lump is the Combine's piece ("body:<Combine 1>/piece:1").
  const got = await okThenInsert(a, () => (a.$("#combine-ok") as HTMLButtonElement).click(), (l) => l === "Combine bodies", quick, (made) => `body:${made}/piece:1`);
  await a.close();
  return got;
}

test("a Combine's new piece keeps one number through Undo and Redo, with an Insert made before or after its rebuild lands (SL #622 item 7)", async () => {
  // Bodies 1 and 2 are the boxes; the Combine's piece is the next made, Body 3; the Insert's box comes after it, Body 4.
  const want = { piece: [3, 3, 3], box: [4, 4] };
  assert.deepEqual(await combineRun(false), want, "control: the rebuild landed first");
  assert.deepEqual(await combineRun(true), want, "the Insert before the rebuild landed");
});

/** Box 1 (5 mm cube) and two sketches with a rectangle each, apart: x 20..30 and x 40..60. */
function twoSketches(): DesignDocument {
  const s1 = addSketch(partDocument("box", 5, 5, 5));
  let doc = drawRectangle(s1.doc, s1.id, [20, 0], [30, 10]).doc;
  const s2 = addSketch(doc);
  return drawRectangle(s2.doc, s2.id, [40, 0], [60, 10]).doc;
}

async function extrudeRun(quick: boolean) {
  const a = await app(twoSketches(), designWorkspace);
  a.$("#extrude")!.click();
  await a.settle();
  const [s1, s2] = a.doc().sketches.map((s) => s.id);
  await a.extrudePointer({ kind: "pick", profile: s1 });
  await a.extrudePointer({ kind: "pick", profile: s2, add: true });
  const d = a.$("#extrude-distance") as HTMLInputElement;
  d.value = "5";
  d.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  // Extrude 1 of both: the first profile's block is its own body, the second's is its piece ("body:<Extrude 1>/piece:1").
  const got = await okThenInsert(a, () => (a.$("#extrude-ok") as HTMLButtonElement).click(), (l) => l?.startsWith("Extrude") === true, quick, (made) => `body:${made}/piece:1`);
  await a.close();
  return got;
}

test("an extrude of two profiles: its second block keeps one number through Undo and Redo, with an Insert made before or after its rebuild lands (SL #622 item 7)", async () => {
  // Box 1 is Body 1, the extrude's first block Body 2, its second block Body 3; the Insert's box Body 4.
  const want = { piece: [3, 3, 3], box: [4, 4] };
  assert.deepEqual(await extrudeRun(false), want, "control: the rebuild landed first");
  assert.deepEqual(await extrudeRun(true), want, "the Insert before the rebuild landed");
});
