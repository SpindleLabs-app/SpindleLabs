// Construction curves (step 47f, construction.ts): turning picked curves
// into construction curves and back (one undo step, projected ones
// refused), the outline leaving them out on the real kernel, a sketch of
// only construction curves saying why it has no outline, constraints and
// dimensions still holding them, the drawing's dashes worked by hand, and
// the file's checks (version 8 brought the field). In the browser:
// apps/fission/e2e/sketch-construction.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { CONSTRUCTION_STEPS, dashes, MAX_DASHES, toggleConstruction } from "../src/construction.ts";
import { addConstraint } from "../src/constraints.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { CONSTRUCTION_ONLY, profileCurves, projectedOpen } from "../src/projection.ts";
import { addSketch, drawCircle, drawLine, drawRectangle, sketchOutline } from "../src/sketch.ts";
import { sketchDrawings } from "../src/sketch-tool.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const turned = (r: ReturnType<typeof toggleConstruction>) => {
  assert.ok("doc" in r, "refused" in r ? r.refused : "");
  return r;
};

/** A box, then Sketch 1 with a 20 × 10 rectangle from (0, 0) and its diagonal from (0, 0) to (20, 10). */
function rectangleAndDiagonal() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [20, 10]);
  const corner = (x: number, y: number) => sketchOf(r.doc, s.id).points.find((p) => p.x === x && p.y === y)!.id;
  const d = drawLine(r.doc, s.id, corner(0, 0), corner(20, 10));
  return { doc: d.doc, id: s.id, sides: r.ids, diagonal: d.id };
}

test("Construction turns the picked curves into construction curves, and back when every one already is", () => {
  const { doc, id, sides, diagonal } = rectangleAndDiagonal();
  const on = turned(toggleConstruction(doc, id, [diagonal]));
  assert.equal(on.step, CONSTRUCTION_STEPS.on);
  assert.equal(sketchOf(on.doc, id).curves.find((c) => c.id === diagonal)?.construction, true);
  assert.ok(sketchOf(on.doc, id).curves.filter((c) => c.id !== diagonal).every((c) => !("construction" in c)), "nothing else changes");
  // Mixed picks (one already construction): all become construction.
  const mixed = turned(toggleConstruction(on.doc, id, [diagonal, sides[0]]));
  assert.equal(mixed.step, CONSTRUCTION_STEPS.on);
  assert.ok([diagonal, sides[0]].every((k) => sketchOf(mixed.doc, id).curves.find((c) => c.id === k)?.construction === true));
  // All construction: back to ordinary, the field gone (a file never says false).
  const off = turned(toggleConstruction(mixed.doc, id, [diagonal, sides[0]]));
  assert.equal(off.step, CONSTRUCTION_STEPS.off);
  assert.deepEqual(sketchOf(off.doc, id).curves, sketchOf(doc, id).curves);
  // Nothing picked, or an id no longer there, is refused with what to do.
  assert.match((toggleConstruction(doc, id, []) as { refused: string }).refused, /Pick a line, circle or arc with Select first/);
  assert.match((toggleConstruction(doc, id, ["line-999"]) as { refused: string }).refused, /Pick a line/);
  assert.throws(() => toggleConstruction(doc, "sketch-99", [diagonal]), /no sketch sketch-99/);
});

test("a projected curve can't be turned", () => {
  const { doc, id, diagonal } = rectangleAndDiagonal();
  const withProjection = { ...doc, sketches: doc.sketches.map((s) => (s.id === id ? { ...s, projected: [{ id: "projection-90", made: diagonal, edge: "x" } as never] } : s)) };
  assert.match((toggleConstruction(withProjection, id, [diagonal]) as { refused: string }).refused, /A projected edge follows its body/);
});

test("the outline leaves construction curves out: a rectangle with a construction diagonal closes, with an ordinary one it does not", async () => {
  const { doc, id, diagonal } = rectangleAndDiagonal();
  // The diagonal from (0, 0) to (20, 10) splits the rectangle in two: no one outline.
  await assert.rejects(sketchOutline(kernel, doc, id), /has no closed outline/);
  const on = turned(toggleConstruction(doc, id, [diagonal]));
  assert.deepEqual(profileCurves(sketchOf(on.doc, id)).map((c) => c.id).includes(diagonal), false);
  // The rectangle alone: a closed outline of four lines, 20 × 10 = 200 mm² (the outline's corners by hand: its four).
  const outline = await sketchOutline(kernel, on.doc, id);
  assert.ok(outline, "closed");
});

test("a sketch of only construction curves says why it has no outline", async () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const c = drawCircle(s.doc, s.id, [0, 0], 5);
  assert.equal(projectedOpen(sketchOf(c.doc, s.id)), null, "an ordinary circle: the kernel judges");
  const on = turned(toggleConstruction(c.doc, s.id, [c.id]));
  assert.equal(projectedOpen(sketchOf(on.doc, s.id)), CONSTRUCTION_ONLY);
  await assert.rejects(sketchOutline(kernel, on.doc, s.id), new RegExp(`no closed outline: ${CONSTRUCTION_ONLY.slice(0, 30)}`));
});

test("constraints and dimensions hold a construction line like any other", async () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s.doc, s.id, [0, 0], [4, 2]);
  const on = turned(toggleConstruction(l.doc, s.id, [l.id]));
  // Horizontal: its start stays, its end comes level, (4, 0); length 10: on along x to (10, 0).
  const h = await addConstraint(kernel, on.doc, s.id, { kind: "horizontal", a: "point-3", b: "point-4" });
  assert.ok("doc" in h);
  const d = await addConstraint(kernel, h.doc, s.id, { kind: "distance", a: "point-3", b: "point-4", value: 10 });
  assert.ok("doc" in d);
  const end = sketchOf(d.doc, s.id).points.find((p) => p.id === "point-4")!;
  assert.ok(Math.abs(end.x - 10) <= 1e-5 && Math.abs(end.y) <= 1e-5, `${end.x}, ${end.y}`);
  assert.equal(sketchOf(d.doc, s.id).curves[0].construction, true, "still construction");
});

test("dashes, worked by hand", () => {
  // (0, 0)–(10, 0) every 2 mm: a dash of 0.6 · 2 = 1.2 from 0, 2, 4, 6 and 8.
  assert.deepEqual(dashes([[[0, 0], [10, 0]]], 2), [0, 2, 4, 6, 8].map((x) => [[x, 0], [x + 1.2, 0]]));
  // Shorter than one period: drawn whole.
  assert.deepEqual(dashes([[[0, 0], [1, 0]]], 2), [[[0, 0], [1, 0]]]);
  // A run of two joined segments, (0, 0)–(1, 0)–(2, 0), every 1.5: one path 2 long, dashes from 0 to 0.9 and from 1.5
  // to 2.1, the second cut at the run's end, 2.
  const run = dashes([[[0, 0], [1, 0]], [[1, 0], [2, 0]]], 1.5);
  assert.equal(run.length, 2);
  assert.deepEqual(run[0][0], [0, 0]);
  assert.ok(Math.abs(run[0][1][0] - 0.9) < 1e-12, "0.6 · 1.5 = 0.9, within its rounding");
  assert.ok(Math.abs(run[1][0][0] - 1.5) < 1e-12 && run[1][1][0] === 2);
  // Two separate segments are dashed apart: each starts with a dash.
  assert.deepEqual(dashes([[[0, 0], [3, 0]], [[0, 5], [3, 5]]], 2).map(([a]) => a), [[0, 0], [2, 0], [0, 5], [2, 5]]);
  // 1000 mm at 1 mm apart would be 1000 dashes: the period grows to 1000 / MAX_DASHES = 5.
  const long = dashes([[[0, 0], [1000, 0]]], 1);
  assert.equal(long.length, MAX_DASHES);
  assert.deepEqual(long[1][0], [5, 0]);
  // No period (nothing to go by): whole.
  assert.deepEqual(dashes([[[0, 0], [10, 0]]], 0), [[[0, 0], [10, 0]]]);
});

test("a construction curve is drawn apart from the lines, dashed", () => {
  const { doc, id, diagonal } = rectangleAndDiagonal();
  const before = sketchDrawings(doc, null)[0];
  const on = turned(toggleConstruction(doc, id, [diagonal]));
  const after = sketchDrawings(on.doc, null)[0];
  assert.equal(before.construction, undefined);
  assert.equal(after.lines.length, before.lines.length - 1, "the diagonal left the lines");
  // Not edited: a 60th of the sketch's size apart; its size is the rectangle's diagonal √500 = 22.36, so 0.3727 apart and
  // the diagonal, 22.36 long, is cut into 60 dashes.
  assert.equal(after.construction?.length, 60);
  // Edited with a pixel of 0.1 mm: 10 px = 1 mm apart, so 23 dashes along 22.36 mm (from 0, 1, … 22).
  const edited = sketchDrawings(on.doc, { tool: { kind: "select", sketch: id, picked: [], hover: null }, grid: 1, pointer: null, pixel: 0.1 } as never)[0];
  assert.equal(edited.construction?.length, 23);
});

test("files: construction is true or left out, and version 7 data can't hold it", () => {
  const { doc, id, diagonal } = rectangleAndDiagonal();
  const on = turned(toggleConstruction(doc, id, [diagonal]));
  const raw = () => JSON.parse(JSON.stringify(on.doc));
  assert.deepEqual(readDesignDocument(raw()), on.doc);
  const withFlag = (v: unknown) => {
    const d = raw();
    d.sketches.find((s: Sketch) => s.id === id).curves.find((c: { id: string }) => c.id === diagonal).construction = v;
    return () => readDesignDocument(d);
  };
  assert.throws(withFlag(false), new RegExp(`curve ${diagonal} has construction false, which must be true or left out`));
  assert.throws(withFlag("yes"), /has construction yes, which must be true/);
  assert.throws(withFlag(null), /has construction null/);
  const seven = { ...raw(), version: 7 };
  assert.throws(() => readDesignDocument(seven), /says version 7 but has construction curves or dimensions, which version 8 brought/);
  // Version 7 data without them opens as version 8, unchanged otherwise.
  assert.equal(readDesignDocument({ ...JSON.parse(JSON.stringify(doc)), version: 7 }).version, 10);
});

test("the sketch's words count construction curves apart", async () => {
  const { curveCount } = await import("../src/sketch-tool.ts");
  const { doc, id, diagonal } = rectangleAndDiagonal();
  assert.equal(curveCount(sketchOf(doc, id)), "5 lines");
  const on = turned(toggleConstruction(doc, id, [diagonal]));
  assert.equal(curveCount(sketchOf(on.doc, id)), "4 lines and 1 construction curve");
});
