// Timeline hunt 2026-11-11 (A1): `keptUnsettled`, which edits made outside a
// sketch the app must settle (rebuild.ts settleKept) even when no sketch lies
// on a body: the ones that ask an extrude for another outline. Each case is
// read off the rule by hand; the app's side, on the real kernel, is
// packages/testing/journeys/kept-region-pick.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesignDocument } from "../src/document.ts";
import { addSketch, deleteCurve, drawLine, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch, setExtrudeDistance, setExtrudeRegion } from "../src/extrude.ts";
import { keptUnsettled } from "../src/rebuild.ts";
import { deleteItem, suppressItem } from "../src/timeline-edits.ts";
import type { RegionRef } from "../src/regions.ts";

const empty = () => ({ version: 16, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } }) as unknown as DesignDocument;

/** A region named by a rectangle's four sides in the order drawn, its middle `centroid`. */
const region = (ids: readonly string[], centroid: [number, number]): RegionRef => ({ outer: ids.map((curve) => ({ curve, reversed: false })), centroid });

/** Sketch 1 with rectangles A (0,0)-(10,10) and B (20,0)-(40,10), Extrude 1 of region A by 5; Sketch 2 with one rectangle, extruded by nothing. */
function design() {
  const s = addSketch(empty());
  const a = drawRectangle(s.doc, s.id, [0, 0], [10, 10]);
  const b = drawRectangle(a.doc, s.id, [20, 0], [40, 10]);
  const e = extrudeSketch(b.doc, s.id, 5, false, region(a.ids, [5, 5]));
  const other = addSketch(e.doc);
  const doc = drawRectangle(other.doc, other.id, [0, 50], [10, 60]).doc;
  return { doc, sketch: s.id, extrude: e.id, other: other.id, a: a.ids, b: b.ids };
}

test("nothing to settle: the same design, a distance, a suppress, a sketch no extrude uses, a new extrude of an unchanged sketch", () => {
  const d = design();
  assert.equal(keptUnsettled(d.doc, d.doc), false);
  // The outline asked for is the same sketch and the same region, whatever the distance.
  assert.equal(keptUnsettled(d.doc, setExtrudeDistance(d.doc, 8, d.extrude)), false);
  // Suppression doesn't count in the kept-shape rule.
  assert.equal(keptUnsettled(d.doc, suppressItem(d.doc, d.extrude, true)), false);
  // Sketch 2 changed: no extrude asks it for anything.
  assert.equal(keptUnsettled(d.doc, drawLine(d.doc, d.other, [0, 70], [10, 70]).doc), false);
  // Extrude 2 of Sketch 2 as it was: its outline is asked for the first time, of a sketch `before` has too, so nothing was kept or lost.
  assert.equal(keptUnsettled(d.doc, extrudeSketch(d.doc, d.other, 3).doc), false);
});

test("to settle: an extrude given another region, or the same curves with another centroid", () => {
  const d = design();
  assert.equal(keptUnsettled(d.doc, setExtrudeRegion(d.doc, region(d.b, [30, 5]), d.extrude)), true);
  assert.equal(keptUnsettled(d.doc, setExtrudeRegion(d.doc, region(d.a, [5, 6]), d.extrude)), true);
  // The same region set again is the same document (setExtrudeRegion), so nothing.
  assert.equal(keptUnsettled(d.doc, setExtrudeRegion(d.doc, region(d.a, [5, 5]), d.extrude)), false);
  // An old extrude without a region given one.
  const old = extrudeSketch(d.doc, d.other, 3);
  assert.equal(keptUnsettled(old.doc, setExtrudeRegion(old.doc, region(["x"], [5, 55]), old.id)), true);
});

test("to settle: the points or curves of a sketch an extrude uses changed; both ways round", () => {
  const d = design();
  const open = deleteCurve(d.doc, d.sketch, d.a[0]);
  assert.equal(keptUnsettled(d.doc, open), true);
  assert.equal(keptUnsettled(open, d.doc), true);
  assert.equal(keptUnsettled(d.doc, drawLine(d.doc, d.sketch, [0, 20], [10, 20]).doc), true);
});

test("a deleted sketch: settled once its extrude keeps a shape (the delete settles itself), not before", () => {
  const d = design();
  const gone = deleteItem(d.doc, d.sketch);
  assert.equal(gone.sketches.some((s) => s.id === d.sketch), false);
  // Nothing kept yet: settling must keep Sketch 1 as it was for Extrude 1.
  assert.equal(keptUnsettled(d.doc, gone), true);
  const whole = d.doc.sketches.find((s) => s.id === d.sketch)!;
  const kept: DesignDocument = { ...gone, kept: { [d.extrude]: { points: whole.points, curves: whole.curves } } };
  assert.equal(keptUnsettled(d.doc, kept), false);
  // And a later edit elsewhere, the sketch gone on both sides.
  assert.equal(keptUnsettled(kept, setExtrudeDistance(kept, 8, d.extrude)), false);
});
