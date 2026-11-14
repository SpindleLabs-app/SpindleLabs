// Hunter D, broken-solids hunt 2026-11-12: repros D1, D2 and D5, all on an extrude of several profiles (#531),
// in the real Design app (design-app.ts) on the real kernel. Each test failed on main 4907029 (SL #611).
// Run: cd packages/testing && node --experimental-strip-types --no-warnings --test journeys/several-hunt-d.journey.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { regionRef, sketchRegions } from "../../../workspaces/design/src/regions.ts";
import { freshDesign } from "../../../workspaces/design/src/start-fresh.ts";
import { app } from "./design-app.ts";
import { kernel, reopen, typeIn, r6, type App } from "./several-hunt-d-lib.ts";
setCombineShown(true); // the app's ?combine switch (the Operation row in Extrude and Edit feature)

async function regionAt(doc: DesignDocument, id: string, x: number, y: number) {
  const found = await sketchRegions(kernel, doc.sketches.find((s) => s.id === id)!);
  const r = found.regions.find((g) => Math.hypot(g.centroid[0] - x, g.centroid[1] - y) < 1e-6);
  assert.ok(r, `no region at ${x},${y}`);
  return regionRef(r, found.ids);
}
/**
 * Sketch 1 on XY: square A x 0..10 and square B x 20..30, both y 0..10; Extrude 1 of both by 5 mm (A picked first):
 * two bodies of 10 x 10 x 5 = 500 mm3 each, 1,000 in all. With `base` given, after that design's items.
 */
async function twoSquares(base: DesignDocument = freshDesign()) {
  const s = addSketch(base);
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [20, 0], [30, 10]).doc;
  const made = extrudeSketch(d, s.id, 5, false, await regionAt(d, s.id, 5, 5), null, [{ sketch: s.id, region: await regionAt(d, s.id, 25, 5) }]);
  return { doc: made.doc, extrude: made.id, sketch: s.id };
}
/** Whether the design as the app holds it now opens as a saved file does (the same reader Undo, Redo and File > Open use). */
const opens = (doc: DesignDocument): string => {
  try {
    reopen(doc);
    return "opens";
  } catch (e) {
    return String(e);
  }
};
async function editDistance(a: App, item: string, value: number) {
  assert.equal(await a.menu(item, "edit"), null);
  const box = a.$("#feature-edit input[type=number]") as HTMLInputElement;
  box.value = String(value);
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  a.$("#feature-edit-ok")!.click();
  await a.settle();
}

test("D1: Edit feature on a two-profile extrude, the second square clicked, OK: the first body must not vanish and the design must still open", async () => {
  const { doc, extrude } = await twoSquares();
  const a = await app(doc);
  assert.equal(r6(a.volume()), 1000);
  assert.equal(await a.menu(extrude, "edit"), null);
  const offers = (a.extrudeShown()?.profiles ?? []) as unknown as { id: string; ref: { centroid: [number, number] } }[];
  await a.extrudePointer({ kind: "pick", profile: offers.find((o) => Math.abs(o.ref.centroid[0] - 25) < 1e-6)!.id });
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  const said = a.$("#feature-edit")!.hidden ? null : a.$("#feature-edit-error")?.textContent;
  // Either the pick is refused in words (nothing changes: 1,000 mm3), or the squares swap places in the pick order
  // (still both: 1,000 mm3). Never one square twice: 500 mm3 and a file no reader takes.
  assert.equal(opens(a.doc()), "opens", `after OK (panel says ${JSON.stringify(said)}), volume ${r6(a.volume())}`);
  assert.equal(r6(a.volume()), 1000);
  await a.close();
});

test("D2: Edit feature makes a two-profile extrude a Join: refused in words (as the Extrude panel does), not half built and saved as a file that never opens", async () => {
  // Box 1 40 x 40 x 2 (z 0..2) under both squares: 3,200 mm3. Joined with both prisms (z 0..5, 3 mm above the plate each):
  // 3,200 + 2 x 10 x 10 x 3 = 3,800 mm3 if it joined both; refused, the mesh drawn stays plate + two prisms = 4,200.
  const { doc, extrude } = await twoSquares(partDocument("box", 40, 40, 2));
  const a = await app(doc);
  assert.equal(r6(a.volume()), 4200);
  assert.equal(await a.menu(extrude, "edit"), null);
  const sel = a.$("#edit-operation") as HTMLSelectElement;
  sel.value = "join";
  sel.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event);
  await a.settle();
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  // Refused in words while the panel stays open (its own body stays out of the view while its regions are offered).
  assert.match(a.$("#feature-edit")!.textContent ?? "", /Join, Cut and Intersect take one profile for now/);
  assert.equal(opens(a.doc()), "opens");
  a.$("#feature-edit-cancel")!.click();
  await a.settle();
  // Nothing recorded: the plate and both prisms, 4,200.
  const v = r6(a.volume());
  assert.equal(opens(a.doc()), "opens", `after OK: volume ${v} (3,500 = the plate and square A only: square B dropped)`);
  assert.ok(v === 4200, `volume ${v}`);
  await a.close();
});

// D3 (a sketch on a second profile's top after a side redrawn) is fixed by SL #632 item 2, tested in Design's
// test/several-cap-names.test.ts; D4 (two profiles of one sketch sharing a kept shape) is #632 item 1.
test("D5a: Extrude on the top face of square B's body (press-pull): the design must still open, and Redo must put it back", async () => {
  const { doc } = await twoSquares();
  const a = await app(doc);
  a.$("#extrude")!.click();
  await a.settle();
  const top = a.extrudeShown()!.profiles.find((p) => p.face && Math.abs(p.plane.normal[2]) === 1 && Math.abs(p.plane.origin[2] - 5) < 1e-9 && p.id.endsWith("/end:2"))!; // B is the second profile: its top is end:2 (SL #632 item 2)
  await a.extrudePointer({ kind: "pick", profile: top.id });
  typeIn(a, "#extrude-distance", 3);
  await a.settle();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(r6(a.volume()), 1300); // 1,000 + 10 x 10 x 3
  const file = opens(a.doc());
  let redo = "redone";
  await a.undo();
  try {
    await a.redo();
  } catch (e) {
    redo = `Redo threw: ${e}`;
  }
  assert.deepEqual({ file, redo }, { file: "opens", redo: "redone" });
  await a.close();
});

test("D5b: a line drawn from a corner of square B's body in a new sketch on the XY plane (the snap pins it): the design must still open, and Redo must put it back", async () => {
  const { doc } = await twoSquares();
  const a = await app(doc);
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  assert.ok(a.sketching());
  await a.key("sketch-line");
  await a.click(20, 0); // B's bottom corner (20, 0, 0): the snap pins the point to it
  await a.click(25, -8);
  await a.key("clear-selection");
  await a.finish();
  const s = a.doc().sketches.at(-1)!;
  assert.ok((s.pins ?? []).length > 0, "the corner was snapped to and pinned");
  const file = opens(a.doc());
  let redo = "redone";
  await a.undo();
  try {
    await a.redo();
  } catch (e) {
    redo = `Redo threw: ${e}`;
  }
  assert.deepEqual({ file, redo }, { file: "opens", redo: "redone" });
  await a.close();
});
