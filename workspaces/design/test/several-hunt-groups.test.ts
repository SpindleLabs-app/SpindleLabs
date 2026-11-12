// Hunt 2026-11-12 C: grouping of several profiles into bodies (hand-worked volumes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extrudeSketch } from "../src/extrude.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { regionsOf, volumesOf } from "./several-hunt-helpers.ts";

test("first profile apart, the other two touching each other: bodies 100 and 200 (h 1)", async () => {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [30, 0], [40, 10]).doc;
  d = drawRectangle(d, s.id, [40, 0], [50, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const at = (x: number) => rs.find((r) => Math.abs(r.c[0] - x) < 1e-6)!.ref;
  const made = extrudeSketch(d, s.id, 1, false, at(5), null, [{ sketch: s.id, region: at(35) }, { sketch: s.id, region: at(45) }]);
  const out = await volumesOf(made.doc, made.id);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.deepEqual(out.vols.map((v) => Math.round(v * 1e6) / 1e6).sort((a, b) => a - b), [100, 200]);
});

test("two sketches whose squares overlap (x 0..10 and x 5..15): one body 15 x 10 x 1 = 150; preview sums 200", async () => {
  const one = addSketch(freshDesign());
  const d1 = drawRectangle(one.doc, one.id, [0, 0], [10, 10]).doc;
  const two = addSketch(d1);
  const d2 = drawRectangle(two.doc, two.id, [5, 0], [15, 10]).doc;
  const made = extrudeSketch(d2, one.id, 1, false, (await regionsOf(d2, one.id))[0].ref, null, [{ sketch: two.id, region: (await regionsOf(d2, two.id))[0].ref }]);
  const out = await volumesOf(made.doc, made.id);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.deepEqual(out.vols.map((v) => Math.round(v * 1e6) / 1e6), [150]);
});

async function twoSketches(a: [[number, number], [number, number]], b: [[number, number], [number, number]], h: number) {
  const one = addSketch(freshDesign());
  const d1 = drawRectangle(one.doc, one.id, a[0], a[1]).doc;
  const two = addSketch(d1);
  const d2 = drawRectangle(two.doc, two.id, b[0], b[1]).doc;
  const made = extrudeSketch(d2, one.id, h, false, (await regionsOf(d2, one.id))[0].ref, null, [{ sketch: two.id, region: (await regionsOf(d2, two.id))[0].ref }]);
  return volumesOf(made.doc, made.id);
}

test("the same square drawn in two sketches, both picked: one 10 x 10 x 2 = 200 body", async () => {
  const out = await twoSketches([[0, 0], [10, 10]], [[0, 0], [10, 10]], 2);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.deepEqual(out.vols.map((v) => Math.round(v * 1e6) / 1e6), [200]);
});

test("a small square in sketch 2 inside sketch 1's square: one body 20 x 20 x 1 = 400", async () => {
  const out = await twoSketches([[0, 0], [20, 20]], [[5, 5], [10, 10]], 1);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.deepEqual(out.vols.map((v) => Math.round(v * 1e6) / 1e6), [400]);
});
