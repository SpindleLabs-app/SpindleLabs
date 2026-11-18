// Edit feature on an extrude that cuts (Extrude's Operation row, Design
// data version 10, with Combine shown), in the Design app as the shell runs
// it (design-app.ts) on the real kernel: the panel's list follows the
// distance typed, as the new extrude's preview does, and keeps the bodies
// the extrude already cuts even when its box no longer reaches them, so OK
// never drops one the person didn't untick (fresh-eyes review, 2026-11-05).
// Run with `npm run journeys`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

// The Operation row shows only with Combine shown (`?combine`).
setCombineShown(true);

type App = Awaited<ReturnType<typeof app>>;

/**
 * Box 1, 10 mm, x 0..10, y 0..10, z 0..10 (Body 1); Box 2, the same moved up to z 30..40 (Body 2); Sketch 1 on XY, the
 * square x 2..6, y 2..6, extruded `distance` mm up cutting `cuts` (by their box numbers).
 */
function design(distance: number, cuts: number[]): { doc: DesignDocument; id: string } {
  let doc = partDocument("box", 10, 10, 10);
  const one = `body:${doc.timeline.features[0].id}`;
  const two = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, z: 30 }).doc;
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  return extrudeSketch(drawn, s.id, distance, false, undefined, { operation: "cut", bodies: cuts.map((n) => (n === 1 ? one : `body:${two.id}`)) });
}

const listed = (a: App) => [...a.window.document.querySelectorAll("#edit-bodies input[type=checkbox]")].map((e) => `${e.parentElement!.textContent!.trim()}:${(e as unknown as HTMLInputElement).checked}`);
async function typeDistance(a: App, text: string) {
  const box = a.$("#feature-edit input[inputmode=decimal]") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

test("hand-worked: typing a longer distance in Edit lists Box 2 once the extrude reaches it, unticked; shorter again, it goes", async () => {
  // At 20 mm the extrude runs z 0..20: it reaches Box 1 (z 0..10) and not Box 2, 10 mm above it (z 30).
  const { doc, id } = design(20, [1]);
  const a = await app(doc);
  assert.equal(await a.menu(id, "edit"), null);
  assert.equal((a.$("#edit-operation") as HTMLSelectElement).value, "cut");
  assert.deepEqual(listed(a), ["Body 1:true"]);
  // At 35 mm it runs z 0..35, into Box 2 (z 30..40): listed, unticked (Fusion's: only what was picked stays picked).
  await typeDistance(a, "35");
  assert.deepEqual(listed(a), ["Body 1:true", "Body 2:false"]);
  // At 29 mm (z 0..29) it stops 1 mm short of Box 2 again: gone from the list.
  await typeDistance(a, "29");
  assert.deepEqual(listed(a), ["Body 1:true"]);
  // A distance that can't be read leaves the list as it was.
  await typeDistance(a, "abc");
  assert.deepEqual(listed(a), ["Body 1:true"]);
  assert.ok(await a.close());
});

test("hand-worked: an extrude cutting both boxes keeps Box 2 on Edit's list though 20 mm no longer reaches it, so OK keeps it", async () => {
  // At 35 mm it cuts both: 1,000 − 16 × 10 = 840 mm³ of Box 1 (z 0..10) and 1,000 − 16 × 5 = 920 of Box 2 (z 30..35).
  const { doc, id } = design(35, [1, 2]);
  const a = await app(doc);
  assert.equal(await a.menu(id, "edit"), null);
  assert.deepEqual(listed(a), ["Body 1:true", "Body 2:true"]);
  // 20 mm (z 0..20) stops short of Box 2, but Box 2 is one of its own bodies: still listed, still ticked.
  await typeDistance(a, "20");
  assert.deepEqual(listed(a), ["Body 1:true", "Body 2:true"]);
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  // #521: at 20 mm the cut removes nothing from Box 2, so OK asks first; Cut anyway records it as listed.
  assert.match(a.$("#cut-ask-words")?.textContent ?? "", /doesn't reach Body 2/);
  (a.$("#cut-ask-go") as HTMLButtonElement).click();
  await a.settle();
  const f = a.doc().timeline.features.find((x) => x.id === id)!;
  assert.equal(f.intent.parameters.distance, 20);
  assert.equal((f.intent.parameters.bodies as string[]).length, 2, "both bodies kept");
  assert.ok(await a.close());
});
