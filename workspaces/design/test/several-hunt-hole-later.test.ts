// Hunt 2026-11-12 C, C1 variant: a working two-square extrude breaks when a screw hole is drawn in one square later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extrudeSketch } from "../src/extrude.ts";
import { settleKept } from "../src/rebuild.ts";
import { addSketch, drawCircle, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { kernel, regionsOf, volumesOf } from "./several-hunt-helpers.ts";

test("C1b: two squares apart extruded together, then a r 2 hole drawn in the second: (100) + (100 - 4pi), h 1", async () => {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [30, 0], [40, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const at = (x: number) => rs.find((r) => Math.abs(r.c[0] - x) < 1e-6)!.ref;
  const made = extrudeSketch(d, s.id, 1, false, at(5), null, [{ sketch: s.id, region: at(35) }]);
  const before = await volumesOf(made.doc, made.id);
  assert.equal(before.status, "built");
  const after = await settleKept(kernel, made.doc, drawCircle(made.doc, s.id, [35, 5], 2).doc);
  const out = await volumesOf(after, made.id);
  console.log("after the hole:", JSON.stringify(out.r).slice(0, 250));
  assert.equal(out.status, "built");
  const sum = out.vols.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - (200 - 4 * Math.PI)) < 1e-6, `volume ${sum}`);
});
