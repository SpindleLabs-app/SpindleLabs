// SL #641 item 2 (save hunt 2026-11-12, C2): the reader opens a sketch of at most 20,000 points and curves and 8,000
// constraints, and a design of at most 500,000 points and curves in all its sketches and kept shapes; the drawing
// tools never counted, so the 2,001st rectangle in one sketch made a design the app's own reader refused (the file,
// the kept copy, every undo step). Now an edit that would pass a limit is refused in words and the design stays as it
// was; at the limit itself it still draws, and the design still opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls } from "@fission/core";
import { DESIGN_LIMITS, MAX_SKETCH_CONSTRAINTS, partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { SketchFull } from "../src/sketch-room.ts";
import { addSketch, deleteCurve, drawCircle, drawLine, drawPoint, drawRectangle } from "../src/sketch.ts";
import { addConstraint, squaredRectangle } from "../src/constraints.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";

/** Whether the design, saved and opened again, is one the reader takes. */
const opens = (doc: DesignDocument): boolean => {
  readDesignDocument(JSON.parse(JSON.stringify(doc)));
  return true;
};

/** `doc` with sketch `id` replaced by `make(sketch)`. */
const withContent = (doc: DesignDocument, id: string, make: (s: Sketch) => Sketch): DesignDocument => ({ ...doc, sketches: doc.sketches.map((s) => (s.id === id ? make(s) : s)) });

/** A sketch of `n` circles of radius 1, 3 mm apart along x: each a centre point and a circle, so 2n points and curves. */
function circles(n: number) {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const points = Array.from({ length: n }, (_, i) => ({ id: `point-${100_000 + i}`, x: i * 3, y: 0 }));
  const curves = points.map((p, i) => ({ id: `circle-${200_000 + i}`, kind: "circle" as const, centre: p.id, radius: 1 }));
  return { doc: { ...withContent(s.doc, s.id, (k) => ({ ...k, points, curves })), nextId: 300_000 }, id: s.id };
}

test("a sketch fills to exactly 20,000 points and curves, opens, and the next circle is refused in words with the design as it was", () => {
  // Worked by hand: 9,999 circles are 9,999 centres + 9,999 circles = 19,998. One more circle adds a centre and a
  // circle: 20,000, exactly the limit, which the reader opens (it refuses "more than"). The next adds 2 more: 20,002.
  const full = drawCircle(circles(9_999).doc, "sketch-2", [-10, 0], 1).doc;
  const s = full.sketches.find((k) => k.id === "sketch-2")!;
  assert.equal(s.points.length + s.curves.length, DESIGN_LIMITS.sketch);
  assert.ok(opens(full));
  assert.throws(() => drawCircle(full, "sketch-2", [-20, 0], 1), (e: Error) => e instanceof SketchFull && /20,000 points and curves/.test(e.message));
  // A line's two new ends and the line are 3 more; a lone point 1 more: each refused the same way.
  assert.throws(() => drawLine(full, "sketch-2", [-20, 0], [-25, 0]), SketchFull);
  assert.throws(() => drawPoint(full, "sketch-2", [-20, 5]), SketchFull);
  // A line between two points already there adds only its curve: 20,001, over the limit too.
  assert.throws(() => drawLine(full, "sketch-2", "point-100000", "point-100001"), SketchFull);
});

test("a full sketch's tools say why they drew nothing, and leave the design and the tool as they were", () => {
  const full = drawCircle(circles(9_999).doc, "sketch-2", [-10, 0], 1).doc;
  const tool = startTool("circle", "sketch-2");
  const first = clickAt(full, tool, [-30, 0]);
  const done = clickAt(first.doc, first.tool, [-29, 0]);
  assert.equal(done.drew, false);
  assert.equal(done.doc, full);
  assert.match(done.note ?? "", /full/);
});

test("rectangles fill a sketch to exactly 8,000 constraints, which opens, and the 2,001st is refused (the hunt's recipe)", () => {
  // Worked by hand: the Rectangle tool draws 4 lines and squares them, 2 Horizontal and 2 Vertical: 4 constraints a
  // rectangle, so 2,000 rectangles hold 8,000 (the limit, which opens) and the 2,001st would make 8,004 (as the hunt saw).
  // Its 4 corners and 4 lines are 8 points and curves each: 16,000 at 2,000, under that limit.
  const s = addSketch(partDocument("box", 10, 10, 10));
  let doc = s.doc;
  for (let n = 1; n <= 2_000; n++) {
    const drawn = drawRectangle(doc, s.id, [n * 3, 0], [n * 3 + 2, 2]);
    doc = squaredRectangle(drawn.doc, s.id, drawn.ids);
  }
  assert.equal(doc.sketches.find((k) => k.id === s.id)!.constraints.length, MAX_SKETCH_CONSTRAINTS);
  assert.ok(opens(doc));
  const drawn = drawRectangle(doc, s.id, [-10, 0], [-8, 2]);
  assert.throws(() => squaredRectangle(drawn.doc, s.id, drawn.ids), (e: Error) => e instanceof SketchFull && /8,000 constraints/.test(e.message));
  // Through the tool: two clicks, nothing drawn, the words, the design as it was.
  const tool = startTool("rectangle", s.id);
  const first = clickAt(doc, tool, [-10, 0]);
  const done = clickAt(first.doc, first.tool, [-8, 2]);
  assert.equal(done.drew, false);
  assert.equal(done.doc, doc);
  assert.match(done.note ?? "", /8,000 constraints/);
});

test("a constraint added to a sketch already holding 8,000 is refused before the solver is asked", async () => {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const one = drawLine(s.doc, s.id, [0, 0], [5, 1]);
  const line = one.doc.sketches.find((k) => k.id === s.id)!.curves[0] as { start: string; end: string };
  // 8,000 constraints already (Horizontal on the line's ends, held as data; the count is what is checked).
  const full = withContent(one.doc, s.id, (k) => ({ ...k, constraints: Array.from({ length: MAX_SKETCH_CONSTRAINTS }, (_, i) => ({ id: `constraint-${100_000 + i}`, kind: "horizontal" as const, a: line.start, b: line.end })) }));
  const kernel = new Proxy({}, { get: () => () => assert.fail("the solver was asked") }) as unknown as KernelCalls;
  const got = await addConstraint(kernel, full, s.id, { kind: "vertical", a: line.start, b: line.end });
  assert.ok("refused" in got);
  assert.match(got.refused, /8,000 constraints/);
  // One under the limit is not refused for its count: it reaches the solver.
  const under = withContent(full, s.id, (k) => ({ ...k, constraints: k.constraints.slice(1) }));
  await assert.rejects(() => addConstraint(kernel, under, s.id, { kind: "vertical", a: line.start, b: line.end }), /the solver was asked/);
});

test("a design fills to exactly 500,000 points and curves in all its sketches, opens, and a point in another sketch is refused", () => {
  // Worked by hand: 25 sketches of 20,000 lone points are 25 x 20,000 = 500,000, the design's limit, which opens;
  // a point in a 26th sketch would make 500,001.
  let doc = partDocument("box", 10, 10, 10);
  for (let k = 0; k < 25; k++) {
    const s = addSketch(doc);
    doc = withContent(s.doc, s.id, (x) => ({ ...x, points: Array.from({ length: DESIGN_LIMITS.sketch }, (_, i) => ({ id: `point-${1_000_000 + k * DESIGN_LIMITS.sketch + i}`, x: i, y: k })) }));
  }
  doc = { ...doc, nextId: 2_000_000 };
  assert.equal(doc.sketches.reduce((n, s) => n + s.points.length + s.curves.length, 0), DESIGN_LIMITS.content);
  assert.ok(opens(doc));
  const last = addSketch(doc);
  assert.throws(() => drawPoint(last.doc, last.id, [0, 0]), (e: Error) => e instanceof SketchFull && /500,000 points and curves/.test(e.message));
});

test("taking content out of a sketch is never refused, even one past a limit", () => {
  // 10,001 circles are 20,002 points and curves: only a file from elsewhere holds that (the reader refuses it).
  const over = circles(10_001);
  assert.throws(() => drawPoint(over.doc, over.id, [-5, -5]), SketchFull);
  // Deleting a circle (and its centre, which only it used) takes 2 away: 20,000, allowed, and it opens again.
  const fewer = deleteCurve(over.doc, over.id, "circle-200000");
  const s = fewer.sketches.find((k) => k.id === over.id)!;
  assert.equal(s.points.length + s.curves.length, DESIGN_LIMITS.sketch);
  assert.ok(opens(fewer));
});
