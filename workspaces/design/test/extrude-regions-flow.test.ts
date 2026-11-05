// Step 48d: picking a sketch region in the mounted Design workspace (the
// real kernel, a stand-in view): hand-worked preview volumes, OK saving the
// region picked, Undo and Redo, the E key with several regions, a body face
// picked between, and a pick made while OK's build is still out (48d hunt).
// The browser check is apps/fission/e2e/extrude-regions.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../../packages/testing/journeys/design-app.ts";
import { addSketch, drawCircle, drawRectangle, partDocument, type DesignDocument } from "../src/index.ts";

type App = Awaited<ReturnType<typeof app>>;
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);

/** A 40 × 30 rectangle with a radius 5 circle at its middle: two regions, the plate (with its hole) and the disc. */
function plateWithHole(): DesignDocument {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const r = drawRectangle(s.doc, s.id, [100, 0], [140, 30]);
  return drawCircle(r.doc, s.id, [120, 15], 5).doc;
}
async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}
const panel = (a: App) => a.$("#extrude-panel")!;
type Offer = { id: string; outline: { holes: unknown[] } };
const regionsOf = (a: App) => a.extrudeShown()!.profiles.filter((p) => !p.face) as unknown as Offer[];
const plateOf = (a: App) => regionsOf(a).find((o) => o.outline.holes.length === 1)!;
const discOf = (a: App) => regionsOf(a).find((o) => o.outline.holes.length === 0)!;
const okOff = (a: App) => (a.$("#extrude-ok") as HTMLButtonElement).disabled;
const regionSaved = (a: App) => a.doc().timeline.features.at(-1)!.intent.parameters.region as { outer: { curve: string }[] } | undefined;

test("hand-worked: the disc previews 785.40 mm³ and the plate 11214.60 mm³ by 10 mm; OK saves the plate's region; Undo then Redo builds it again", async () => {
  const a = await app(plateWithHole());
  a.$("#extrude")!.click();
  await a.settle();
  assert.equal(regionsOf(a).length, 2);
  assert.equal(a.$("#extrude-status")!.textContent, "Sketch 1 has 2 regions: click or tap the one to extrude.");
  assert.ok(okOff(a), "OK waits for a region");
  await a.extrudePointer({ kind: "pick", profile: discOf(a).id });
  await type(a, "10");
  // The disc: π · 5² · 10 = 250π = 785.398 mm³.
  near(Number(panel(a).dataset.previewVolume), 250 * Math.PI, "disc preview");
  await a.extrudePointer({ kind: "pick", profile: plateOf(a).id });
  await a.settle();
  // The plate: (40 · 30 − 25π) · 10 = 12000 − 250π = 11214.60 mm³.
  near(Number(panel(a).dataset.previewVolume), 12000 - 250 * Math.PI, "plate preview");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(regionSaved(a)!.outer.length, 4, "the plate is named by its four sides");
  // The view's mesh: the hole drawn as straight pieces inside its circle, so a little more than the exact 11214.60 + 1000 = 12214.60.
  const shown = a.volume();
  assert.ok(shown > 12214.6 && shown < 12214.6 * 1.002, `the plate and the 10 mm box: ${shown}`);
  await a.undo();
  await a.redo();
  assert.equal(a.volume(), shown, "after Undo then Redo");
  assert.ok(await a.close());
});

test("the E key with several regions picks none: Enter records nothing", async () => {
  const a = await app(plateWithHole());
  await a.key("extrude-tool");
  assert.ok(okOff(a));
  await type(a, "5");
  await a.key("extrude-ok");
  assert.equal(a.history.undoLabel(), null);
  assert.ok(await a.close());
});

test("a region picked, then a face of the box, then the region again: its preview comes back", async () => {
  const a = await app(plateWithHole());
  a.$("#extrude")!.click();
  await a.settle();
  const face = a.extrudeShown()!.profiles.find((p) => p.face)!;
  await a.extrudePointer({ kind: "pick", profile: discOf(a).id });
  await type(a, "4");
  const disc = panel(a).dataset.previewVolume;
  // π · 25 · 4 = 100π.
  near(Number(disc), 100 * Math.PI, "disc by 4");
  await a.extrudePointer({ kind: "pick", profile: face.id });
  await a.extrudePointer({ kind: "pick", profile: discOf(a).id });
  assert.equal(panel(a).dataset.previewVolume, disc);
  assert.equal(a.extrudeShown()!.chosen, discOf(a).id);
  assert.ok(await a.close());
});

test("regression (48d hunt): another region of the sketch picked while OK's build is out makes OK's extrude out of date, so the disc is never recorded when the plate was picked last", async () => {
  const a = await app(plateWithHole());
  a.$("#extrude")!.click();
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: discOf(a).id });
  await type(a, "10");
  const plate = plateOf(a).id;
  a.hold();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.extrudePointer({ kind: "pick", profile: plate });
  await a.release();
  assert.equal(a.history.undoLabel(), null, "the disc's OK, out of date, is not recorded");
  assert.equal(a.extrudeShown()?.chosen, plate, "the panel stays open on the plate");
  // OK again now makes the plate.
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(regionSaved(a)!.outer.length, 4, "the plate, named by its four sides");
  assert.ok(await a.close());
});
