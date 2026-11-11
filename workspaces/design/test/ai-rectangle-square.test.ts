// The assistant's rectangle keeps its right angles (solver hunt, 2026-11-11).
// The Rectangle tool gives each level side Horizontal and each upright side
// Vertical (`squaredRectangle`, the beginner check of 2026-11-06); the
// assistant's `draw_rectangle` drew the same four lines with none, so a
// Dimension on one side leant the rectangle into a trapezoid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { documentFor, drawingFor } from "../src/commands.ts";
import type { DesignDocument } from "../src/document.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";

const kernel = nodeKernel();
const sketched = (): DesignDocument => documentFor({ op: "create_sketch", on: "XY" });
const only = (doc: DesignDocument) => doc.sketches[0];
const corners = (doc: DesignDocument) => only(doc).points.map((p) => [p.x, p.y]);
const asked = (doc: DesignDocument) => drawingFor(doc, only(doc).id, { op: "draw_rectangle", x: 0, y: 0, width: 40, height: 30 });

test("the assistant's rectangle has the Rectangle tool's constraints: level sides Horizontal, upright sides Vertical", () => {
  const drawn = asked(sketched());
  // Worked by hand: 40 × 30 centred on (0, 0) has corners (−20, −15), (20, −15), (20, 15), (−20, 15), drawn in that
  // order, so its sides are bottom (level), right (upright), top (level), left (upright).
  assert.deepEqual(corners(drawn), [[-20, -15], [20, -15], [20, 15], [-20, 15]]);
  const sketch = only(drawn);
  assert.deepEqual(sketch.constraints.map((c) => c.kind), ["horizontal", "vertical", "horizontal", "vertical"]);
  // Each names its own side's two ends, and the ids come from the one counter.
  const lines = sketch.curves.filter((c) => c.kind === "line");
  assert.deepEqual(sketch.constraints.map((c) => [c.a, "b" in c ? c.b : null]), lines.map((l) => [l.start, l.end]));
  assert.equal(new Set([...sketch.points, ...sketch.curves, ...sketch.constraints].map((x) => x.id)).size, 12, "twelve ids, none twice");
  // The same constraints the tool gives the same two clicks.
  const empty = sketched();
  const first = clickAt(empty, startTool("rectangle", only(empty).id), [-20, -15]);
  const tool = clickAt(first.doc, first.tool, [20, 15]).doc;
  assert.deepEqual(sketch.constraints, only(tool).constraints);
  // The whole design is the tool's, so whatever holds for the tool's rectangle (the file reader's checks among them) holds for this one.
  assert.deepEqual(drawn, tool, "the assistant's rectangle is the tool's rectangle");
});

test("a Dimension on one side of the assistant's rectangle keeps it a rectangle", async () => {
  const drawn = asked(sketched());
  const bottom = only(drawn).curves[0] as { start: string; end: string };
  const got = await addConstraint(kernel, drawn, only(drawn).id, { kind: "distance", a: bottom.start, b: bottom.end, value: 60 });
  assert.ok("doc" in got, "refused" in got ? got.refused : "");
  // Worked by hand: the bottom's first end (−20, −15) is the one picked first, so it stays; the bottom is level, so
  // its other end goes to (−20 + 60, −15) = (40, −15); the right side is upright, so the corner above follows to
  // x = 40 and keeps y = 15; the left side never moves. Before the fix that corner stayed at (20, 15): a trapezoid.
  assert.deepEqual(corners(got.doc), [[-20, -15], [40, -15], [40, 15], [-20, 15]]);
});

test("the same rectangle asked for twice draws nothing and adds nothing", () => {
  const once = asked(sketched());
  assert.equal(asked(once), once);
});
