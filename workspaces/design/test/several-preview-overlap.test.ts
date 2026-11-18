// SL #632 item 3: the Extrude preview of several profiles whose prisms
// overlap showed the prisms' volumes added (the overlap counted twice),
// while OK builds them joined. The preview now joins them as the rebuild
// does, so its volume is the body OK makes. In the mounted Design
// workspace on the real kernel, worked by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../../packages/testing/journeys/design-app.ts";
import { addSketch, drawRectangle, partDocument, type DesignDocument } from "../src/index.ts";

type App = Awaited<ReturnType<typeof app>>;
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);
type Offer = { id: string; outline: { outer: { path?: { corners: number[] } } } };
/** The offered region whose corners' x all lie between `lo` and `hi`. */
const squareAt = (a: App, lo: number, hi: number) =>
  (a.extrudeShown()!.profiles.filter((o) => !o.face) as unknown as Offer[]).find((o) => {
    const xs = (o.outline.outer.path?.corners ?? []).filter((_, i) => i % 2 === 0);
    return xs.length > 0 && Math.min(...xs) >= lo - 1e-9 && Math.max(...xs) <= hi + 1e-9;
  })!.id;

/** A 10 mm box, then two sketches on XY each with a 10 mm square: x 100..110 and x `from`..`from` + 10, y 0..10. */
function twoSketches(from: number): DesignDocument {
  const s1 = addSketch(partDocument("box", 10, 10, 10));
  const d = drawRectangle(s1.doc, s1.id, [100, 0], [110, 10]).doc;
  const s2 = addSketch(d);
  return drawRectangle(s2.doc, s2.id, [from, 0], [from + 10, 10]).doc;
}

async function previewOf(from: number): Promise<{ preview: number; built: number }> {
  const a = await app(twoSketches(from));
  a.$("#extrude")!.click();
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: squareAt(a, 100, 110) });
  await a.extrudePointer({ kind: "pick", profile: squareAt(a, from, from + 10), add: true });
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = "10";
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  assert.equal(a.$("#extrude-profile")!.textContent, "2 selected");
  const preview = Number(a.$("#extrude-panel")!.dataset.previewVolume);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const built = a.volume();
  assert.ok(await a.close());
  return { preview, built };
}

test("hand-worked: two sketches' squares overlapping by half preview as the one body OK builds", async () => {
  // x 100..110 and 105..115: the union is x 100..115 by y 0..10, 150 mm², by 10 mm: 1,500 mm³ (not 1,000 + 1,000).
  const { preview, built } = await previewOf(105);
  near(preview, 1500, "preview");
  // The box's 1,000 and the extrude's 1,500.
  near(built, 2500, "built");
});

test("control: two sketches' squares apart preview as their sum", async () => {
  // x 100..110 and 130..140: two 1,000 mm³ prisms, 2,000 mm³.
  const { preview, built } = await previewOf(130);
  near(preview, 2000, "preview");
  near(built, 3000, "built");
});
