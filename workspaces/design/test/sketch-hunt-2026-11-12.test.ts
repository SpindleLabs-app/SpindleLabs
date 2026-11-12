// Sketch drawing hunt 2026-11-12 (SL #612): construction lines kept apart
// from the Rectangle and Line tools' sides, a sized side holding the corner
// drawn first, the Centre rectangle's own row and column, and a refused
// polygon keeping its typed boxes. Proofs from the hunt: hunt-1112-A
// construction-shared, centre-rect-row-snap, polygon-refused-locks and
// hunt-1112-B rect-origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint, changeDimension, squaredRectangle } from "../src/constraints.ts";
import { toggleConstruction } from "../src/construction.ts";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { sketchRegions } from "../src/regions.ts";
import { addSketch, drawLine, drawRectangle } from "../src/sketch.ts";
import { clickAt, SAME_LINE, startTool } from "../src/sketch-tool.ts";
import { FLAT_CENTRE_RECTANGLE } from "../src/sketch-shapes.ts";
import { snapOnSketch } from "../src/snap.ts";

const kernel = nodeKernel();
const sk = (d: DesignDocument, id: string) => d.sketches.find((s) => s.id === id)!;

/** Sketch 1 on XY with a 10 × 10 construction square (0, 0)–(10, 10), as a guide. */
function guide() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [10, 10]);
  const turned = toggleConstruction(drawn.doc, s.id, drawn.ids);
  assert.ok("doc" in turned);
  return { doc: turned.doc, id: s.id };
}

const clicks = (doc: DesignDocument, kind: "line" | "rectangle", id: string, at: [number, number][]) => {
  let tool = startTool(kind, id);
  let got: ReturnType<typeof clickAt> = { doc, tool, drew: false };
  for (const p of at) {
    got = clickAt(got.doc, tool, p);
    tool = got.tool;
  }
  return got;
};

test("hand-worked (hunt A2a): a rectangle beside a construction square has four ordinary sides and one 100 mm² region", async () => {
  // Rectangle (10, 0)–(20, 10): its left side runs (10, 0)–(10, 10), where the square's right side, a construction line,
  // lies. It must get its own ordinary side there: four ordinary sides round 10 × 10 = 100 mm², the guide adds nothing.
  const g = guide();
  const got = clicks(g.doc, "rectangle", g.id, [[10, 0], [20, 10]]);
  assert.ok(got.drew);
  const s = sk(got.doc, g.id);
  assert.equal(s.curves.filter((c) => c.kind === "line" && c.construction !== true).length, 4);
  assert.equal(s.curves.filter((c) => c.kind === "line" && c.construction === true).length, 4, "the guide is kept");
  const r = await sketchRegions(kernel, s);
  assert.equal(r.regions.length, 1);
  assert.ok(Math.abs(r.regions[0].area - 100) < 1e-6, `area ${r.regions[0].area}`);
});

test("hand-worked (hunt A2b): a rectangle on a construction square's own corners is drawn, four ordinary sides on the guide", () => {
  const g = guide();
  const got = clicks(g.doc, "rectangle", g.id, [[0, 0], [10, 10]]);
  assert.ok(got.drew, `refused: ${got.note}`);
  const s = sk(got.doc, g.id);
  // 4 construction + 4 ordinary lines over the same 4 corner points (shared, never doubled).
  assert.equal(s.curves.filter((c) => c.kind === "line" && c.construction !== true).length, 4);
  assert.equal(s.points.length, 4);
  // The same rectangle once more is refused: its sides are all ordinary lines already there.
  assert.equal(clicks(got.doc, "rectangle", g.id, [[0, 0], [10, 10]]).note, SAME_LINE);
});

test("hand-worked (hunt A2c): a line along a construction line's two points is drawn; along an ordinary line it is still refused", () => {
  const g = guide();
  const got = clicks(g.doc, "line", g.id, [[0, 0], [10, 0]]);
  assert.notEqual(got.note, SAME_LINE);
  assert.ok(got.drew);
  const s = sk(got.doc, g.id);
  assert.equal(s.curves.filter((c) => c.kind === "line" && c.construction !== true).length, 1);
  // Now an ordinary line joins (0, 0) and (10, 0): a second one there would break the outline.
  assert.equal(clicks(got.doc, "line", g.id, [[0, 0], [10, 0]]).note, SAME_LINE);
});

/** A Rectangle-tool rectangle (0, 0)–(30, 20), squared: its sides chain (0,0) → (30,0) → (30,20) → (0,20) → (0,0). */
function rect() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [30, 20]);
  return { doc: squaredRectangle(r.doc, s.id, r.ids), id: s.id, ids: r.ids };
}
const corners = (d: DesignDocument, id: string) => sk(d, id).points.map((q) => [q.x, q.y]);

// Hand-worked (hunt B2): the corner clicked first, (0, 0), stays wherever a side is sized; the side's other end, and the
// far side with it (Horizontal and Vertical keep it a rectangle), moves.
// - bottom (0,0)→(30,0) sized 50: (30,0) and (30,20) go to x = 50.
// - right (30,0)→(30,20) sized 35: its end next to the first corner's side, (30,0), stays; (30,20) and (0,20) go to y = 35.
// - top (30,20)→(0,20) sized 60: the drawn start (30,20) used to be held, pushing (0,20) and (0,0) to x = −30. Its end on
//   the first corner's side, (0,20), stays; (30,20) and (30,0) go to x = 60.
// - left (0,20)→(0,0) sized 40: (0,0) stays (it used to go to y = −20); (0,20) and (30,20) go to y = 40.
for (const [side, name, value, want] of [
  [0, "bottom", 50, [[0, 0], [50, 0], [50, 20], [0, 20]]],
  [1, "right", 35, [[0, 0], [30, 0], [30, 35], [0, 35]]],
  [2, "top", 60, [[0, 0], [60, 0], [60, 20], [0, 20]]],
  [3, "left", 40, [[0, 0], [30, 0], [30, 40], [0, 40]]],
] as const) {
  test(`hand-worked (hunt B2): a rectangle from the origin keeps its first corner when its ${name} side is sized ${value}, and when the size is changed`, async () => {
    const { doc, id, ids } = rect();
    const line = sk(doc, id).curves.find((c) => c.id === ids[side]) as { start: string; end: string };
    const got = await addConstraint(kernel, doc, id, { kind: "distance", a: line.start, b: line.end, value });
    assert.ok("doc" in got, "refused" in got ? got.refused : "");
    assert.deepEqual(corners(got.doc, id), want);
    // Changed from its label to 10 more: the first corner still stays, the same side grows by 10.
    const changed = await changeDimension(kernel, got.doc, id, got.id, value + 10);
    assert.ok("doc" in changed);
    const grown = want.map(([x, y]) => (side % 2 === 0 ? [x === 0 ? 0 : x + 10, y] : [x, y === 0 ? 0 : y + 10]));
    assert.deepEqual(corners(changed.doc, id), grown);
  });
}

test("hand-worked: a lone line sized keeps its start, the point drawn first, either way the size is picked", async () => {
  // Line (2, 1) → (5, 5), 5 long; sized 10 along the same way: (2, 1) + 10·(3, 4)/5 = (8, 9). Picked end first (a = end), still.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s.doc, s.id, [2, 1], [5, 5]);
  const line = sk(l.doc, s.id).curves.find((c) => c.id === l.id) as { start: string; end: string };
  for (const [a, b] of [[line.start, line.end], [line.end, line.start]]) {
    const got = await addConstraint(kernel, l.doc, s.id, { kind: "distance", a, b, value: 10 });
    assert.ok("doc" in got);
    const p = corners(got.doc, s.id).map(([x, y]) => [Math.round(x * 1e9) / 1e9, Math.round(y * 1e9) / 1e9]);
    assert.deepEqual(p, [[2, 1], [8, 9]]);
  }
});

test("hand-worked (hunt A3): a 40 × 1.6 mm centre rectangle round the origin at 0.1 mm a pixel is drawn as clicked, not pulled flat", () => {
  // Centre (0, 0); pointer at (20, 0.8), 8 px above the centre's own row at 0.1 mm a pixel (the snap's reach is 10 px =
  // 1 mm). The centre's row and column are never offered, as a plain Rectangle's first corner's aren't: the corner stays
  // (20, 0.8), a rectangle 2·20 = 40 wide and 2·0.8 = 1.6 high. Another point's row is still offered: with a point at
  // (−5, 0.5), the pointer 3 px off that row lands on y = 0.5.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const rect = clickAt(s.doc, startTool("rectangle", s.id), [0, 0]).tool;
  assert.deepEqual(snapOnSketch(s.doc, rect, [20, 0.8], [20, 0.8], 0.1).at, [20, 0.8]);
  const centre = clickAt(s.doc, startTool("centre-rectangle", s.id), [0, 0]).tool;
  const at = snapOnSketch(s.doc, centre, [20, 0.8], [20, 0.8], 0.1).at;
  assert.deepEqual(at, [20, 0.8]);
  const r = clickAt(s.doc, centre, at);
  assert.notEqual(r.note, FLAT_CENTRE_RECTANGLE);
  assert.ok(r.drew, `refused: ${r.note}`);
  const withPoint = clickAt(s.doc, startTool("point", s.id), [-5, 0.5]).doc;
  const centre2 = clickAt(withPoint, startTool("centre-rectangle", s.id), [0, 0]).tool;
  assert.deepEqual(snapOnSketch(withPoint, centre2, [20, 0.8], [20, 0.8], 0.1).at, [20, 0.5]);
});
