// App bug hunt 11-18 D-5 (SL #820): a rectangle and a separate circle in one sketch made the sketch panel say "not closed:
// the sketch makes 2 separate loops; for now a sketch makes one outline", though Extrude offers both as regions since step
// 48. The status must say what Extrude will do with it, and still say "not closed" when nothing can be extruded.
// On the real kernel, in the app around Design (design-app.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawCircle, drawLine, drawRectangle, partDocument, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

/** The sketch panel's words with `doc`'s Sketch 1 open for editing. */
async function statusOf(doc: DesignDocument, sketch: string): Promise<string> {
  const a = await app(doc, designWorkspace);
  await a.menu(sketch, "edit-sketch");
  await a.settle();
  const words = a.$("#sketch-status")!.textContent ?? "";
  await a.close();
  return words;
}

test("a sketch of separate closed loops says how many regions Extrude offers, not that it isn't closed (SL #820 D-5)", async () => {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const rect = drawRectangle(s.doc, s.id, [0, 0], [20, 10]).doc;
  // A 20 x 10 rectangle (4 lines) and a radius 5 circle round (50, 0): the circle reaches x 45..55, clear of the
  // rectangle's x 0..20, so two loops apart, two regions (Extrude: "Sketch 1 has 2 regions").
  const apart = await statusOf(drawCircle(rect, s.id, [50, 0], 5).doc, s.id);
  assert.match(apart, /4 lines and 1 circle, closed: 2 regions to extrude\./, apart);
  assert.doesNotMatch(apart, /not closed/, apart);
  // The same rectangle with a radius 2 circle round (10, 5) inside it (x 8..12, y 3..7, clear of every side): the plate
  // with a hole and the disc in the hole, two regions.
  const nested = await statusOf(drawCircle(rect, s.id, [10, 5], 2).doc, s.id);
  assert.match(nested, /4 lines and 1 circle, closed: 2 regions to extrude\./, nested);
  // A lone line beside the circle: nothing closed but the circle, which alone is still a loop the line keeps open; the
  // words stay the kernel's "not closed" (a test that the new words are not said of an open sketch).
  const open = await statusOf(drawCircle(drawLine(s.doc, s.id, [0, 0], [20, 0]).doc, s.id, [50, 0], 5).doc, s.id);
  assert.match(open, /not closed/, open);
});
