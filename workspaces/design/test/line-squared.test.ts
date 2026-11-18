// SL #630 (hunt 2026-11-12, F6): a rectangle drawn with the Line tool (or a rectangle side deleted and drawn again
// with it) gets no Horizontal/Vertical, so the first size typed on it leans it into a trapezoid. sketch-tool.ts
// lineClick never adds the level/upright constraints the Rectangle tool's squaredRectangle adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, deleteCurve } from "../src/sketch.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";

const kernel = nodeKernel();
const sk = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const clicks = (doc: DesignDocument, id: string, kind: "line" | "rectangle", at: [number, number][]) => {
  let t = startTool(kind, id);
  for (const c of at) ({ doc, tool: t } = clickAt(doc, t, c) as { doc: DesignDocument; tool: typeof t });
  return doc;
};
const right = (doc: DesignDocument, id: string) => {
  const p = sk(doc, id).points.map((q) => [q.x, q.y]);
  // Corners in drawing order; every corner's dot product of its two sides must be 0 for a rectangle.
  return p.map((b, i) => {
    const [a, c] = [p[(i + p.length - 1) % p.length], p[(i + 1) % p.length]];
    return (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) + 0; // + 0: a -0 product is a right angle too
  });
};

test("hand-worked: a rectangle drawn with the Line tool on the grid stays one when its bottom is sized", async () => {
  // Clicks (0,0) (40,0) (40,30) (0,30) and back on (0,0): four sides drawn exactly level and upright, as
  // Fusion's line tool would constrain them. Bottom typed 60: by hand (40,0) and (40,30) go to x = 60, a
  // 60 x 30 rectangle. Without H/V only (40,0) moves: the right side leans, |cos| 0.55 at its corners.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const doc = clicks(s.doc, s.id, "line", [[0, 0], [40, 0], [40, 30], [0, 30], [0, 0]]);
  const bottom = sk(doc, s.id).curves[0] as { start: string; end: string };
  const got = await addConstraint(kernel, doc, s.id, { kind: "distance", a: bottom.start, b: bottom.end, value: 60 });
  assert.ok("doc" in got);
  assert.deepEqual(right(got.doc, s.id), [0, 0, 0, 0], JSON.stringify(sk(got.doc, s.id).points));
});

test("hand-worked: a Rectangle tool side deleted and drawn again with the Line tool keeps the rectangle square", async () => {
  // Rectangle (0,0)-(40,30), its right side deleted (its Vertical goes with it) and drawn again with the Line
  // tool from (40,0) to (40,30). The bottom then typed 60: by hand a 60 x 30 rectangle.
  const s = addSketch(partDocument("box", 40, 30, 20));
  let doc = clicks(s.doc, s.id, "rectangle", [[0, 0], [40, 30]]);
  const [bottom, side] = sk(doc, s.id).curves as { id: string; start: string; end: string }[];
  doc = clicks(deleteCurve(doc, s.id, side.id), s.id, "line", [[40, 0], [40, 30]]);
  const got = await addConstraint(kernel, doc, s.id, { kind: "distance", a: bottom.start, b: bottom.end, value: 60 });
  assert.ok("doc" in got);
  const p = sk(got.doc, s.id).points.map((q) => [q.x, q.y]);
  assert.ok(p.some(([x, y]) => x === 60 && y === 30), `the top right corner follows to (60, 30): ${JSON.stringify(p)}`);
});
