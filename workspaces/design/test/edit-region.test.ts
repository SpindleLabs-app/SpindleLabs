// Step 48d4: Edit feature re-picks the region of an extrude of a sketch, as
// Fusion's edited Extrude lets you pick other profiles. In the mounted
// Design workspace on the real kernel (a stand-in view): the sketch's
// regions shaded with the one extruded chosen, a click picking another
// that OK saves with the sizes as one undo step, a refused region saying
// why, Cancel leaving it all as it was, an old extrude with no region
// given one, and setExtrudeRegion by hand. The browser check is
// apps/fission/e2e/extrude-regions.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../../packages/testing/journeys/design-app.ts";
import { addSketch, drawCircle, drawRectangle, extrudeSketch, partDocument, type DesignDocument } from "../src/index.ts";
import { setExtrudeRegion } from "../src/extrude.ts";
import { editFeature } from "../src/feature-edit.ts";
import { editRegionWords } from "../src/extrude-regions.ts";
import type { RegionRef } from "../src/regions.ts";

type App = Awaited<ReturnType<typeof app>>;
/** The view's volume against the exact one: the mesh draws the circle as straight pieces, so it may be off by up to 1 % of the circle's own 250π mm³ (10 mm high). */
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 0.01 * 250 * Math.PI, `${what}: ${got}, expected ${want}`);

/** A 40 × 30 rectangle from (100, 0) with a circle of radius `r` round (120, 15), Sketch 1, beside a 10 mm box. */
function plateWithHole(r = 5): { doc: DesignDocument; sketch: string } {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const rect = drawRectangle(s.doc, s.id, [100, 0], [140, 30]);
  return { doc: drawCircle(rect.doc, s.id, [120, 15], r).doc, sketch: s.id };
}

/** The design with Sketch 1's plate (or disc) extruded 10 mm, picked the way the Extrude tool picks it. */
async function extruded(which: "plate" | "disc", r = 5): Promise<App> {
  const { doc } = plateWithHole(r);
  const a = await app(doc);
  a.$("#extrude")!.click();
  await a.settle();
  const offers = a.extrudeShown()!.profiles.filter((p) => !p.face) as unknown as { id: string; outline: { holes: unknown[] } }[];
  await a.extrudePointer({ kind: "pick", profile: offers.find((o) => (o.outline.holes.length === 1) === (which === "plate"))!.id });
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = "10";
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  return a;
}
const extrudeId = (a: App) => a.doc().timeline.features.at(-1)!.id;
const edit = (a: App) => a.$("#feature-edit")!;
const offered = (a: App) => (a.extrudeShown()?.profiles ?? []) as unknown as { id: string; outline: { holes: unknown[] }; refused?: string }[];
const region = (a: App) => a.doc().timeline.features.at(-1)!.intent.parameters.region as RegionRef | undefined;

// The box is 1,000 mm³; the plate (40 × 30 − 25π) × 10 = 11214.60 mm³ and the disc 25π × 10 = 785.40 mm³.
const PLATE = 12000 - 250 * Math.PI;
const DISC = 250 * Math.PI;

test("hand-worked: Edit feature on the plate's extrude shades both regions with the plate chosen; a click on the disc and OK makes it the disc (1000 + 785.40 mm³), one undo step; Undo brings the plate back", async () => {
  const a = await extruded("plate");
  near(a.volume(), 1000 + PLATE, "the box and the plate");
  const id = extrudeId(a);
  const plate = region(a)!;
  assert.equal(await a.menu(id, "edit"), null);
  await a.settle();
  const shown = a.extrudeShown()!;
  assert.equal(offered(a).length, 2, "both regions shaded");
  assert.equal(offered(a).find((o) => o.id === shown.chosen)!.outline.holes.length, 1, "the plate chosen");
  assert.equal(edit(a).dataset.regionChosen, shown.chosen);
  assert.equal(a.$("#edit-region")!.textContent, "Sketch 1 has 2 regions: the one extruded is chosen; click or tap another to extrude it instead.");
  // Another workspace shown and Design again: the panel and its shading are still there, the plate still chosen.
  await a.away();
  assert.equal(a.extrudeShown()?.chosen, shown.chosen, "shaded again on waking");
  const disc = offered(a).find((o) => o.outline.holes.length === 0)!;
  await a.extrudePointer({ kind: "pick", profile: disc.id });
  assert.equal(a.extrudeShown()!.chosen, disc.id);
  assert.equal(a.$("#edit-region")!.textContent, "Another region of Sketch 1 chosen: OK extrudes it.");
  assert.equal(region(a), plate, "nothing saved before OK");
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(region(a)!.outer.length, 1, "the disc, named by its circle");
  near(a.volume(), 1000 + DISC, "the box and the disc");
  assert.equal(a.history.undoLabel(), "Edit Extrude 1");
  assert.equal(a.extrudeShown(), null, "the shading gone with the panel");
  await a.undo();
  assert.deepEqual(region(a), plate);
  near(a.volume(), 1000 + PLATE, "after Undo");
  assert.ok(await a.close());
});

test("a region picked and a distance typed are one undo step; Cancel after a pick keeps the region and the distance as they were", async () => {
  const a = await extruded("plate");
  const id = extrudeId(a);
  const plate = region(a);
  assert.equal(await a.menu(id, "edit"), null);
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: offered(a).find((o) => o.outline.holes.length === 0)!.id });
  (a.$("#feature-edit-cancel") as HTMLButtonElement).click();
  await a.settle();
  assert.deepEqual(region(a), plate);
  assert.equal(a.extrudeShown(), null);
  assert.equal(a.history.undoLabel(), "Extrude Sketch 1");
  // Again, the disc and 4 mm: 25π × 4 = 314.16 mm³, recorded as one step.
  assert.equal(await a.menu(id, "edit"), null);
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: offered(a).find((o) => o.outline.holes.length === 0)!.id });
  (a.$("#edit-height") as HTMLInputElement).value = "4";
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  near(a.volume(), 1000 + 100 * Math.PI, "the box and a 4 mm disc");
  assert.equal(a.history.undoLabel(), "Edit Extrude 1");
  await a.undo();
  near(a.volume(), 1000 + PLATE, "one Undo takes back both");
  assert.ok(await a.close());
});

test("a region that can't be extruded says why when picked and stays unpicked; OK with nothing else changed records nothing", async () => {
  // The circle of radius 14.9995 comes 0.0005 mm from the rectangle's top and bottom: the plate round it is refused.
  const a = await extruded("disc", 14.9995);
  const id = extrudeId(a);
  const disc = region(a);
  assert.equal(await a.menu(id, "edit"), null);
  await a.settle();
  const refused = offered(a).find((o) => o.refused !== undefined)!;
  await a.extrudePointer({ kind: "pick", profile: refused.id });
  assert.match(a.$("#feature-edit-error")!.textContent!, /^This region of Sketch 1 can't be extruded: line 1 and circle 1 come closer than 0\.001 mm without meeting; move them apart or join them$/);
  assert.notEqual(a.extrudeShown()!.chosen, refused.id);
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.deepEqual(region(a), disc);
  assert.equal(a.history.undoLabel(), "Extrude Sketch 1");
  assert.ok(await a.close());
});

test("an old extrude with no region, its sketch now making two: none chosen, and a pick gives it a region, so it builds again", async () => {
  // Saved before regions: the rectangle alone extruded 10 (1,200 × 10 = 12,000 mm³); then the circle drawn makes two regions, and an extrude with no region
  // refuses a sketch with a circle inside (as before regions).
  const s = addSketch(partDocument("box", 10, 10, 10));
  const rect = drawRectangle(s.doc, s.id, [100, 0], [140, 30]);
  const old = extrudeSketch(rect.doc, s.id, 10);
  const a = await app(drawCircle(old.doc, s.id, [120, 15], 5).doc);
  assert.equal(await a.menu(old.id, "edit"), null);
  await a.settle();
  assert.equal(offered(a).length, 2);
  assert.equal(a.extrudeShown()!.chosen, null, "none chosen");
  assert.equal(a.$("#edit-region")!.textContent, "Sketch 1 has 2 regions: click or tap the one to extrude.");
  await a.extrudePointer({ kind: "pick", profile: offered(a).find((o) => o.outline.holes.length === 1)!.id });
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(region(a)!.outer.length, 4);
  near(a.volume(), 1000 + PLATE, "the box and the plate");
  assert.ok(await a.close());
});

test("setExtrudeRegion by hand: the region set, everything else kept; the same region gives the same document; a preset is refused", () => {
  const { doc, sketch } = plateWithHole();
  const e = extrudeSketch(doc, sketch, 7, true);
  const ref: RegionRef = { outer: [{ curve: "circle-9", reversed: false }], centroid: [120, 15] };
  const set = setExtrudeRegion(e.doc, ref, e.id);
  const f = set.timeline.features.find((x) => x.id === e.id)!;
  assert.deepEqual(f.intent.parameters, { sketch, distance: 7, flip: true, region: ref });
  assert.equal(set.timeline.features.indexOf(f), e.doc.timeline.features.findIndex((x) => x.id === e.id));
  assert.equal(setExtrudeRegion(set, structuredClone(ref), e.id), set);
  assert.throws(() => setExtrudeRegion(set, ref, "feature-1"), /is not an extrude of a sketch, so it has no region to pick/);
  // Through Edit feature: with the sizes and Flip as they are, only the region changes; a preset given a region is refused.
  const other: RegionRef = { outer: [{ curve: "line-3", reversed: false }], centroid: [1, 2] };
  assert.deepEqual(editFeature(set, e.id, { height: 7 }, true, other).timeline.features.find((x) => x.id === e.id)!.intent.parameters.region, other);
  assert.equal(editFeature(set, e.id, { height: 7 }, true, ref), set);
  assert.throws(() => editFeature(set, "feature-1", {}, undefined, ref), /has no region: only an extrude of a sketch extrudes one/);
});

test("editRegionWords: each case's words", () => {
  assert.equal(editRegionWords("Sketch 1", 1, true, false), null);
  assert.equal(editRegionWords("Sketch 1", 1, false, false), "Sketch 1's region is shaded: click or tap it to extrude it.");
  assert.equal(editRegionWords("Sketch 2", 3, true, false), "Sketch 2 has 3 regions: the one extruded is chosen; click or tap another to extrude it instead.");
  assert.equal(editRegionWords("Sketch 2", 3, false, false), "Sketch 2 has 3 regions: click or tap the one to extrude.");
  assert.equal(editRegionWords("Sketch 2", 3, true, true), "Another region of Sketch 2 chosen: OK extrudes it.");
});
