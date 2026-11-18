// Hunt 2026-11-12 C: multi-profile extrude on shapes a beginner draws.
// Every volume worked by hand; the real rebuild on the real kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { type ProfileRef } from "../src/extrude-profiles.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { regionRef, sketchRegions, type RegionRef } from "../src/regions.ts";
import { addSketch, drawCircle, drawLine, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";

import { regionsOf, volumesOf } from "./several-hunt-helpers.ts";

async function allRegions(doc: DesignDocument, id: string, h: number) {
  const rs = await regionsOf(doc, id);
  const [first, ...rest] = rs;
  const made = extrudeSketch(doc, id, h, false, first.ref, null, rest.map((x): ProfileRef => ({ sketch: id, region: x.ref })));
  return { made, rs, out: await volumesOf(made.doc, made.id) };
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${what}: ${got}, expected ${want}`);

test("plate with a hole and the hole picked together: one 20 x 20 x 5 block, 2,000 mm3", async () => {
  // Square 0..20, circle r 5 at (10,10): regions = plate (400 - 25pi) and disc (25pi). Both: the full square, 400 * 5 = 2000.
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [20, 20]).doc;
  d = drawCircle(d, s.id, [10, 10], 5).doc;
  const { rs, out } = await allRegions(d, s.id, 5);
  assert.equal(rs.length, 2);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 2000, "volume");
});

test("ring and its middle disc: one cylinder r 10 h 2 = 200pi", async () => {
  const s = addSketch(freshDesign());
  let d = drawCircle(s.doc, s.id, [0, 0], 10).doc;
  d = drawCircle(d, s.id, [0, 0], 5).doc;
  const { rs, out } = await allRegions(d, s.id, 2);
  assert.equal(rs.length, 2);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 200 * Math.PI, "volume");
});

test("rectangle split by a line into two: 20 x 10 x 3 = 600", async () => {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [20, 10]).doc;
  d = drawLine(d, s.id, [10, 0], [10, 10]).doc;
  const { rs, out } = await allRegions(d, s.id, 3);
  assert.equal(rs.length, 2);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 600, "volume");
});

test("circle split by a diameter: both halves give a cylinder r 10 h 4 = 400pi", async () => {
  const s = addSketch(freshDesign());
  let d = drawCircle(s.doc, s.id, [0, 0], 10).doc;
  d = drawLine(d, s.id, [-10, 0], [10, 0]).doc;
  const { rs, out } = await allRegions(d, s.id, 4);
  assert.equal(rs.length, 2);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 400 * Math.PI, "volume");
});

test("three squares in a row, picked ends first then middle: one 30 x 10 x 1 = 300", async () => {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [10, 0], [20, 10]).doc;
  d = drawRectangle(d, s.id, [20, 0], [30, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const at = (x: number) => rs.find((r) => Math.abs(r.c[0] - x) < 1e-6)!.ref;
  const made = extrudeSketch(d, s.id, 1, false, at(5), null, [{ sketch: s.id, region: at(25) }, { sketch: s.id, region: at(15) }]);
  const out = await volumesOf(made.doc, made.id);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 300, "volume");
});

test("two circles overlapping (lens + two moons), all three: union of two r 5 discs, h 1", async () => {
  // Circles r 5 at (0,0) and (6,0): union area = 2*25pi - lens. Lens = 2 r^2 acos(d/2r) - (d/2) sqrt(4r^2 - d^2) with d = 6.
  const r = 5, dd = 6;
  const lens = 2 * r * r * Math.acos(dd / (2 * r)) - (dd / 2) * Math.sqrt(4 * r * r - dd * dd);
  const s = addSketch(freshDesign());
  let d = drawCircle(s.doc, s.id, [0, 0], 5).doc;
  d = drawCircle(d, s.id, [6, 0], 5).doc;
  const { rs, out } = await allRegions(d, s.id, 1);
  assert.equal(rs.length, 3);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 50 * Math.PI - lens, "volume");
});

test("grid of 4 squares (2x2, a cross of lines), all picked: 20 x 20 x 2 = 800", async () => {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [20, 20]).doc;
  d = drawLine(d, s.id, [10, 0], [10, 20]).doc;
  d = drawLine(d, s.id, [0, 10], [20, 10]).doc;
  const { rs, out } = await allRegions(d, s.id, 2);
  assert.equal(rs.length, 4);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.equal(out.vols.length, 1, `bodies ${out.vols}`);
  near(sum(out.vols), 800, "volume");
});

test("two diagonal squares touching at one corner only: kernel answer", async () => {
  // Squares 0..10 and 10..20 meeting at (10,10) only. 2 x 100 x 1. One or two bodies, never a failure.
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [10, 10], [20, 20]).doc;
  const { rs, out } = await allRegions(d, s.id, 1);
  assert.equal(rs.length, 2);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  near(sum(out.vols), 200, "volume");
});
