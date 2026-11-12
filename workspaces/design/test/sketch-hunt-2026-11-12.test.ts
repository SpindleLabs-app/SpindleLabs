// Sketch drawing hunt 2026-11-12 (SL #612): construction lines kept apart
// from the Rectangle and Line tools' sides, a sized side holding the corner
// drawn first, the Centre rectangle's own row and column, and a refused
// polygon keeping its typed boxes. Proofs from the hunt: hunt-1112-A
// construction-shared, centre-rect-row-snap, polygon-refused-locks and
// hunt-1112-B rect-origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { toggleConstruction } from "../src/construction.ts";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { sketchRegions } from "../src/regions.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { clickAt, SAME_LINE, startTool } from "../src/sketch-tool.ts";

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
