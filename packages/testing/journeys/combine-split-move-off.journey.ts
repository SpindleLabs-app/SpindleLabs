// SL #624 item 2 (broken-solids hunt, 2026-11-12; SL #583 item 2 from a new
// side), in the app around Design (design-app.ts) on the real kernel: the
// Cut goes right through the bar while the Move that lifts it is OFF
// (suppressed from its menu, or rolled back by the marker), then the Move
// is put back. Both pieces are lifted, live and in a fresh open of the
// saved file; before the fix one piece stayed on the ground with no word.
// Unit cases: workspaces/design test/combine-split-move-off.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertCombine, insertMove, insertPreset, movedBodies, NO_MOVE, partDocument, setCombineShown } from "@fission/design";
import { projectFromJson } from "@fission/core";
import { app, close } from "./design-app.ts";
import { fileOf } from "./kept-app.ts";

setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;
// combine-split-move.journey.ts's design. Bar 100 x 40 x 10; Box 2 10 x 30 x 30 moved (30, -10, -10): a notch of
// 10 x 20 x 10; Combine 1 cuts it: 40000 - 2000 = 38000. Move 2 lifts the bar 50.
function design() {
  let doc = partDocument("box", 100, 40, 10);
  let slot: string;
  ({ doc, id: slot } = insertPreset(doc, "box", 10, 30, 30));
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -10 }).doc;
  const c = insertCombine(doc, "body:feature-1", [`body:${slot}`], "cut");
  const m = insertMove(c.doc, ["body:feature-1"], { ...NO_MOVE, z: 50 });
  return { doc: m.doc, slot, combine: c.id, move: m.id };
}
const zs = (a: App) => {
  const p = a.mesh()!.positions;
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < p.length; i += 3) (lo = Math.min(lo, p[i])), (hi = Math.max(hi, p[i]));
  return [lo, hi];
};
/** Box 2 made 60 deep by Edit feature: y -10..50 crosses the bar: two pieces, x 0..30 (12000) and x 40..100 (24000): 36000. */
async function slotThrough(a: App, slot: string) {
  assert.equal(await a.menu(slot, "edit"), null);
  (a.$("#edit-depth") as HTMLInputElement).value = "60";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.ok(close(a.volume(), 36000), `slot through: ${a.volume()}`);
}
const rows = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.textContent!.trim()).filter((t) => /^Body \d+/.test(t));

for (const way of ["suppress", "marker"] as const) {
  test(`the slot cut through while Move 2 is ${way === "suppress" ? "suppressed" : "rolled back by the marker"}, then Move 2 ${way === "suppress" ? "unsuppressed" : "rolled forward"}: both pieces of the bar are lifted (z 50..60)`, async () => {
    const d = design();
    const a = await app(d.doc, designWorkspace);
    assert.deepEqual(zs(a), [50, 60]);
    if (way === "suppress") assert.equal(await a.menu(d.move, "suppress"), null);
    else assert.equal(await a.menu(d.combine, "marker"), null);
    assert.deepEqual(zs(a), [0, 10], "the bar back on the ground while Move 2 is off");
    await slotThrough(a, d.slot);
    if (way === "suppress") assert.equal(await a.menu(d.move, "unsuppress"), null);
    else assert.equal(await a.menu(d.move, "marker"), null);
    const move2 = a.doc().timeline.features.find((f) => f.id === d.move)!;
    const got = { volume: Math.round(a.volume()), z: zs(a), moved: movedBodies(move2), warning: a.warning(), rows: rows(a).length };
    // And a fresh open of the saved file builds the same.
    const file = fileOf(a.doc());
    assert.ok(await a.close(), "every body freed");
    const b = await app(projectFromJson(file, [designWorkspace]).workspaces.design as never, designWorkspace);
    const fresh = { volume: Math.round(b.volume()), z: zs(b) };
    assert.ok(await b.close());
    // The control (combine-split-move.journey.ts, Move 2 on while the slot goes through): both pieces lifted, lowest
    // point z = 50. The bar is 10 thick, so everything shown lies in z 50..60: nothing is left on the ground at z = 0.
    // Move 2 holds the far piece too, nothing warns, and the Bodies list shows the two pieces and no more.
    assert.deepEqual(got, { volume: 36000, z: [50, 60], moved: ["body:feature-1", `body:${d.combine}/piece:1`], warning: null, rows: 2 });
    assert.deepEqual(fresh, { volume: 36000, z: [50, 60] });
  });
}

test("control + Redo: the slot cut through with Move 2 on, Undo, Redo: the same file byte for byte, both pieces lifted", async () => {
  const d = design();
  const a = await app(d.doc, designWorkspace);
  await slotThrough(a, d.slot);
  const forward = fileOf(a.doc());
  assert.deepEqual(zs(a), [50, 60]);
  await a.undo();
  await a.redo();
  const got = { same: fileOf(a.doc()) === forward, z: zs(a), volume: Math.round(a.volume()) };
  assert.ok(await a.close());
  assert.deepEqual(got, { same: true, z: [50, 60], volume: 36000 });
});

test("the slot cut through while Move 2 is suppressed, Undo, Redo: the Move lets the piece go with the edit and takes it again, the same file byte for byte", async () => {
  const d = design();
  const a = await app(d.doc, designWorkspace);
  assert.equal(await a.menu(d.move, "suppress"), null);
  const held = () => movedBodies(a.doc().timeline.features.find((f) => f.id === d.move)!);
  await slotThrough(a, d.slot);
  const forward = fileOf(a.doc());
  assert.deepEqual(held(), ["body:feature-1", `body:${d.combine}/piece:1`], "taken into the edit's own step");
  await a.undo();
  // The notch again: 40,000 − 2,000 = 38,000, one body, and Move 2 holds only the bar.
  assert.deepEqual({ held: held(), volume: Math.round(a.volume()) }, { held: ["body:feature-1"], volume: 38000 });
  await a.redo();
  const got = { same: fileOf(a.doc()) === forward, held: held(), volume: Math.round(a.volume()), z: zs(a) };
  assert.ok(await a.close(), "every body freed");
  // Move 2 is still suppressed: both pieces on the ground, z 0..10.
  assert.deepEqual(got, { same: true, held: ["body:feature-1", `body:${d.combine}/piece:1`], volume: 36000, z: [0, 10] });
});
