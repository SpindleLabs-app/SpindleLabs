// Issue #220: the version 6 → 7 reading of a ready-made profile's piece
// names (document.ts withKindPieces), hand-made documents worked by hand.
// Each name is written as version 6 wrote it ("side:piece-2") and the
// expected one as version 7 does ("side:plate-piece-2"): the shape is the
// preset's in the document, put after "side:", before any hole's number.
// Nothing changed gives the same document back (the same object), so a
// file with nothing to rename is not copied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NewerFormatError } from "@fission/core";
import { partDocument, readDesignDocument, withKindPieces, withRuledNames, type DesignDocument } from "../src/document.ts";
import { addFaceSketch } from "../src/sketch.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import type { SketchPin } from "../src/face-edges.ts";
import type { SketchProjection } from "../src/projection.ts";

/** A sketch on face `face` of the preset `kind` (feature-1), with these pins and projected edges. */
function onFace(kind: "plate" | "box", face: string, pins?: SketchPin[], projected?: SketchProjection[]): DesignDocument {
  const made = addFaceSketch(partDocument(kind, 40, 30, 20), { plane: facePlane("feature-1", face), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  return { ...made.doc, sketches: made.doc.sketches.map((s) => ({ ...s, ...(pins ? { pins } : {}), ...(projected ? { projected } : {}) })) };
}
const plane = (d: DesignDocument) => d.timeline.features.find((f) => f.id === d.sketches[0].id)!.intent.parameters.plane;
const pin = (name: string, feature?: string): SketchPin => ({ point: "point-9", kind: "corner", name, ...(feature ? { feature } : {}) }) as SketchPin;
const edge = (name: string): SketchProjection => ({ id: "projection-8", feature: "feature-1", edge: name, made: "line-7" });

test("hand-worked: a sketch's plane alone renamed, the piece number of two digits kept whole", () => {
  // "side:piece-12" is the plate's 13th side: the shape goes in before the piece, the number left as it is.
  const d = withKindPieces(onFace("plate", "side:piece-12"));
  assert.equal(plane(d), facePlane("feature-1", "side:plate-piece-12"));
});

test("hand-worked: only a projected edge renamed, a hole's number of two digits kept whole", () => {
  // The edge where the end meets the side of hole 12's piece 0: "hole-12-piece-0" becomes "plate-hole-12-piece-0".
  const d = withKindPieces(onFace("plate", "end", undefined, [edge("end+side:hole-12-piece-0")]));
  assert.equal(d.sketches[0].projected![0].edge, "end+side:plate-hole-12-piece-0");
  assert.equal(d.sketches[0].pins, undefined);
});

test("hand-worked: only pins renamed, by the face's feature when a pin names none, else by its own", () => {
  // The pin with no feature is on the sketch's face, the plate's; the other names the plate itself.
  const d = withKindPieces(onFace("plate", "end", [pin("side:piece-1+side:piece-2"), pin("side:piece-3", "feature-1")]));
  assert.deepEqual(d.sketches[0].pins!.map((p) => p.name), ["side:plate-piece-1+side:plate-piece-2", "side:plate-piece-3"]);
  assert.equal(d.sketches[0].projected, undefined);
});

test("nothing to rename gives the very same document back", () => {
  // Already version 7 names, a box's (which has no pieces, even when a name looks like one), and a pin on an item that
  // is not in the timeline (no shape to read): each left as it is, the document not copied.
  for (const doc of [
    onFace("plate", "end", [pin("side:plate-piece-2")], [edge("end+side:plate-hole-1-piece-0")]),
    onFace("box", "side:piece-2", [pin("side:piece-1")]),
    onFace("plate", "end", [pin("side:piece-1", "feature-99")]),
    partDocument("plate", 40, 30, 20),
  ])
    assert.equal(withKindPieces(doc), doc);
});

test("hand-worked: one pin or edge of two renamed renames the sketch; the other is kept as it was", () => {
  // The first of each was written by version 6, the second already as version 7 writes it.
  const d = withKindPieces(onFace("plate", "end", [pin("side:piece-1"), pin("side:plate-piece-2")]));
  assert.deepEqual(d.sketches[0].pins!.map((p) => p.name), ["side:plate-piece-1", "side:plate-piece-2"]);
  const e = withKindPieces(onFace("plate", "end", undefined, [edge("end+side:piece-0"), { ...edge("end+side:plate-piece-3"), id: "projection-9" }]));
  assert.deepEqual(e.sketches[0].projected!.map((p) => p.edge), ["end+side:plate-piece-0", "end+side:plate-piece-3"]);
});

test("also issue #220: an unnamed item with no shape to name it by is an Item; a version below 1 is wrong, not newer", () => {
  // A plate extrude whose profile is not in the list has no shape: named as the first Item, "Item 1".
  const d = partDocument("plate", 40, 30, 20);
  const f = d.timeline.features[0];
  const unnamed = { ...d, profiles: [], timeline: { ...d.timeline, features: [{ ...f, provenance: { ...f.provenance, self: { ...f.provenance.self, label: "" } } }] } };
  assert.equal(withRuledNames(unnamed).timeline.features[0].provenance.self.label, "Item 1");
  // Version 0 and -1 are whole numbers, but no SpindleLabs wrote them: a plain error, never "from a newer SpindleLabs".
  for (const version of [0, -1])
    assert.throws(() => readDesignDocument({ ...d, version }), (e: unknown) => e instanceof Error && !(e instanceof NewerFormatError) && (e as Error).message === `Design data version ${version} is not one this SpindleLabs reads (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 or 20)`);
  // Version 10 is newer.
  assert.throws(() => readDesignDocument({ ...d, version: 21 }), NewerFormatError);
});
