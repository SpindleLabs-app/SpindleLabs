// SL #707 (flat stress hunt 2026-11-13), Design data version 22: a face sketch's `body` is now the frame of the input
// face its name names. A sketch drawn before recorded the merged face's first input's, so version 21 data's face
// sketches with `body` are marked `first` as they are read and carried as before; `first` is checked like any field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_VERSION, migrateDesignV21, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { drawnFrame } from "../src/face-sketch.ts";
import { addFaceSketch, addSketch, drawCircle } from "../src/sketch.ts";

/** A box with a circle on its top (recorded with the world's frame for `body`, as nothing moved it) and one on XY. */
function design(): { doc: DesignDocument; top: string; flat: string } {
  const box = partDocument("box", 40, 30, 20);
  // The body's frame when drawn is the world's (nothing moved it), as the face picker records it.
  const t = addFaceSketch(box, { plane: "face:feature-1/top", feature: "feature-1" }, { ...drawnFrame([0, 0, 1], [20, 15, 20]), body: { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] } });
  const onTop = drawCircle(t.doc, t.id, [20, 15], 5).doc;
  const f = addSketch(onTop);
  return { doc: drawCircle(f.doc, f.id, [0, 0], 3).doc, top: t.id, flat: f.id };
}

const json = (d: DesignDocument): Record<string, unknown> => JSON.parse(JSON.stringify(d));
const faceOf = (d: DesignDocument, id: string) => d.sketches.find((s) => s.id === id)!.face;

test("a new face sketch has a body frame and no first, and reads back as version 22 unchanged", () => {
  const { doc, top } = design();
  assert.equal(DESIGN_VERSION, 22);
  assert.ok(faceOf(doc, top)?.body, "drawn on a face: it records its body frame");
  assert.equal(Object.hasOwn(faceOf(doc, top)!, "first"), false);
  assert.deepEqual(readDesignDocument(json(doc)), doc);
});

test("hand-worked upgrade: version 21's face sketch with a body frame opens marked first; one on an origin plane is left as it was", () => {
  const { doc, top, flat } = design();
  // Version 21 data is the same data said as version 21: the top sketch has `body`, so it is marked; the XY sketch has
  // no `face` at all, so nothing is added to it; everything else is as written.
  const opened = readDesignDocument({ ...json(doc), version: 21 });
  assert.equal(opened.version, 22);
  assert.deepEqual(faceOf(opened, top), { ...faceOf(doc, top), first: true });
  assert.equal(faceOf(opened, flat), undefined);
  assert.deepEqual({ ...opened, sketches: [] }, { ...doc, sketches: [] });
  // Saved and opened again: still marked, nothing more.
  assert.deepEqual(readDesignDocument(json(opened)), opened);
  // The upgrade on its own, and on data with no sketches list (left for the reader's checks).
  assert.equal((migrateDesignV21({ ...json(doc), version: 21 }).sketches as { face?: { first?: true } }[])[0].face?.first, true);
  assert.deepEqual(migrateDesignV21({ version: 21 }), { version: 22 });
});

test("a face sketch without a body frame (from before 35e2h) is not marked, as it is not carried", () => {
  const { doc, top } = design();
  const old = json(doc) as { sketches: { id: string; face?: Record<string, unknown> }[] };
  delete old.sketches.find((s) => s.id === top)!.face!.body;
  const opened = readDesignDocument({ ...old, version: 21 });
  assert.equal(Object.hasOwn(faceOf(opened, top)!, "first"), false);
});

test("the reader refuses version 21 data already marked first, and a first that is not true or has no body frame, saying so", () => {
  const { doc, top } = design();
  const marked = (first: unknown, body = true) => {
    const d = json(doc) as { sketches: { id: string; face?: Record<string, unknown> }[] };
    const face = d.sketches.find((s) => s.id === top)!.face!;
    face.first = first;
    if (!body) delete face.body;
    return d;
  };
  assert.throws(() => readDesignDocument({ ...marked(true), version: 21 }), /says version 21 but has a sketch marked as drawn before version 22, which only version 22 marks/);
  assert.equal(faceOf(readDesignDocument(marked(true)), top)?.first, true, "control: version 22 holding it opens");
  for (const bad of [false, "true", 1, null]) assert.throws(() => readDesignDocument(marked(bad)), /first must be true, on a sketch with a body frame/, String(bad));
  assert.throws(() => readDesignDocument(marked(true, false)), /first must be true, on a sketch with a body frame, not true/);
});
