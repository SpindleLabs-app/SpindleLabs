// Hunt 2026-11-12 C, finding C3: a `more` profile's region is never
// brought up to date (rebuild.ts settleKept: "Only the extrude's own first
// profile has its region brought up to date here"). The timeline hunt's A3
// fix (a dragged region whose side is then deleted and drawn again between
// the same corners is found again by its centroid) therefore works for the
// first profile only: the same edits on a second profile lose it, leaving a
// stuck "region gone" warning and a body that no longer follows the sketch.
// Control: the very same edits with that square as the FIRST profile pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { settleKept } from "../src/rebuild.ts";
import { addSketch, deleteCurve, drawLine, drawRectangle, movePoint } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { kernel, regionsOf, volumesOf } from "./several-hunt-helpers.ts";

async function scenario(bFirst: boolean) {
  // Squares A x 0..10 and B x 30..40 (apart), y 0..10, extruded 1 mm together: 100 + 100.
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [30, 0], [40, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const A = rs.find((r) => Math.abs(r.c[0] - 5) < 1e-6)!.ref;
  const B = rs.find((r) => Math.abs(r.c[0] - 35) < 1e-6)!.ref;
  const made = bFirst ? extrudeSketch(d, s.id, 1, false, B, null, [{ sketch: s.id, region: A }]) : extrudeSketch(d, s.id, 1, false, A, null, [{ sketch: s.id, region: B }]);
  let doc: DesignDocument = made.doc;
  const step = async (next: DesignDocument) => (doc = await settleKept(kernel, doc, next));
  const sk = () => doc.sketches.find((x) => x.id === s.id)!;
  // B's corner at (40, 10) dragged to (50, 10): B is the quadrilateral (30,0) (40,0) (50,10) (30,10),
  // area = trapezoid with parallel sides 10 (bottom) and 20 (top), height 10: 150.
  const corner = sk().points.find((p) => p.x === 40 && p.y === 10)!;
  await step(movePoint(doc, s.id, corner.id, 50, 10));
  // Then B's top side (30,10)-(50,10) deleted and drawn again between the same two corners.
  const topLeft = sk().points.find((p) => p.x === 30 && p.y === 10)!;
  const top = sk().curves.find((c) => c.kind === "line" && [c.start, c.end].includes(corner.id) && [c.start, c.end].includes(topLeft.id))!;
  await step(deleteCurve(doc, s.id, top.id));
  await step(drawLine(doc, s.id, topLeft.id, corner.id).doc);
  // Then the corner dragged again, to (60, 10): area = (10 + 30) / 2 * 10 = 200.
  await step(movePoint(doc, s.id, corner.id, 60, 10));
  return { out: await volumesOf(doc, made.id) };
}

test("C3 control: B as the first profile follows: 100 + 200 = 300 mm3, no warning", async () => {
  const { out } = await scenario(true);
  assert.equal(out.status, "built");
  const sum = out.vols.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 300) < 1e-6, `volume ${sum} ${JSON.stringify(out.r).slice(0, 300)}`);
  assert.equal((out.r as { warning?: unknown }).warning, undefined);
});

test("C3: B as a second (more) profile, the same edits: 100 + 200 = 300 mm3, no warning", async () => {
  const { out } = await scenario(false);
  assert.equal(out.status, "built");
  const sum = out.vols.reduce((a, b) => a + b, 0);
  console.log("C3 result", sum, JSON.stringify((out.r as { warning?: unknown }).warning ?? null).slice(0, 300));
  assert.equal((out.r as { warning?: unknown }).warning, undefined, "no stuck warning");
  assert.ok(Math.abs(sum - 300) < 1e-6, `volume ${sum}`);
});
