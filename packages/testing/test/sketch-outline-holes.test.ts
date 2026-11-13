// The outline of a sketch that is one shape with holes (export hunt 2026-11-12, SL #639 item 3), on the real kernel:
// a plate with a hole was refused ("has no closed outline: the sketch makes 2 separate loops"), though Extrude takes
// the same sketch, so the commonest laser part could not be copied as SVG. Sketches that are not one shape with
// holes (two shapes side by side, shapes that cross, a ring inside a hole) are still refused, in the same words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { outlineToSvg } from "@fission/core";
import { addSketch, drawCircle, drawRectangle, partDocument, sketchOutline, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";

const kernel = nodeKernel();
function sketch(draw: (doc: DesignDocument, id: string) => DesignDocument) {
  const s = addSketch(partDocument("box", 10, 10, 10));
  return { doc: draw(s.doc, s.id), id: s.id };
}
const rect = (doc: DesignDocument, id: string, a: [number, number], b: [number, number]) => drawRectangle(doc, id, a, b).doc;
const circle = (doc: DesignDocument, id: string, c: [number, number], r: number) => drawCircle(doc, id, c, r).doc;

test("a plate with a hole is one outline with one hole (worked by hand)", async () => {
  // A 40 x 30 rectangle from (0, 0) with a circle of radius 5 at (20, 15). Outer loop: the rectangle's four corners;
  // one hole: the circle. As SVG: 40 mm wide, 30 mm high, one path with two closed pieces (the rectangle, then the
  // circle as four quarter arcs of radius 5).
  const { doc, id } = sketch((d, s) => circle(rect(d, s, [0, 0], [40, 30]), s, [20, 15], 5));
  const outline = await sketchOutline(kernel, doc, id);
  assert.ok("path" in outline.outer);
  const corners = outline.outer.path.corners;
  const pairs = Array.from({ length: corners.length / 2 }, (_, i) => `${corners[2 * i]},${corners[2 * i + 1]}`).sort();
  assert.deepEqual(pairs, ["0,0", "0,30", "40,0", "40,30"]);
  assert.deepEqual(outline.holes, [{ circle: { center: [20, 15], radius: 5 } }]);
  const svg = outlineToSvg(outline);
  assert.deepEqual([svg.width, svg.height], [40, 30]);
  assert.equal((svg.text.match(/Z/g) ?? []).length, 2, "two closed pieces in one path");
  assert.equal((svg.text.match(/A5 5 /g) ?? []).length, 4, "the hole's four quarter arcs");
  assert.match(svg.text, /fill-rule="evenodd"/);
});

test("a plate with two holes keeps both; a single shape is unchanged", async () => {
  const two = sketch((d, s) => circle(circle(rect(d, s, [0, 0], [40, 30]), s, [10, 15], 5), s, [30, 15], 4));
  const outline = await sketchOutline(kernel, two.doc, two.id);
  assert.deepEqual(outline.holes.map((h) => ("circle" in h ? h.circle.radius : null)).sort(), [4, 5]);
  const one = sketch((d, s) => rect(d, s, [0, 0], [40, 30]));
  assert.deepEqual((await sketchOutline(kernel, one.doc, one.id)).holes, []);
});

test("sketches that are not one shape with holes are still refused, naming the sketch", async () => {
  const cases: [string, (d: DesignDocument, s: string) => DesignDocument][] = [
    ["two rectangles side by side", (d, s) => rect(rect(d, s, [0, 0], [10, 10]), s, [20, 0], [30, 10])],
    ["a plate with a hole and a circle outside it", (d, s) => circle(circle(rect(d, s, [0, 0], [40, 30]), s, [20, 15], 5), s, [60, 15], 5)],
    ["a circle inside a circle inside a plate", (d, s) => circle(circle(rect(d, s, [0, 0], [40, 30]), s, [20, 15], 10), s, [20, 15], 5)],
  ];
  for (const [name, draw] of cases) {
    const { doc, id } = sketch(draw);
    await assert.rejects(sketchOutline(kernel, doc, id), /^Error: Sketch 1 has no closed outline: /, name);
  }
});
