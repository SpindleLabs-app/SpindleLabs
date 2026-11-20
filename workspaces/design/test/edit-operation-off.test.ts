// SL #507 (the flag): an Extrude Cut edited with Combine switched off has no
// Operation row, and said nothing about being a cut. Now its panel says what
// it does in words, and that it stays as saved; OK keeps the cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../../packages/testing/journeys/design-app.ts";
import { partDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { setCombineShown } from "../src/combine-flag.ts";
import { operationWords } from "../src/body-uses.ts";

/** Box 1 40 × 30 × 20 with a 10 × 10 square on XY extruded 10 mm up as a Cut of Box 1. */
function cutBox() {
  const s = addSketch(partDocument("box", 40, 30, 20), "XY");
  const drawn = drawRectangle(s.doc, s.id, [5, 5], [15, 15]).doc;
  return extrudeSketch(drawn, s.id, 10, false, undefined, { operation: "cut", bodies: ["body:feature-1"] });
}

test("#507, by hand: with Combine off, Edit feature on an Extrude Cut says it cuts Box 1 and OK keeps the cut (24,000 − 1,000 mm³)", async () => {
  setCombineShown(false);
  try {
    const { doc, id } = cutBox();
    const a = await app(doc);
    // 40 × 30 × 20 = 24,000 less the 10 × 10 × 10 pocket = 23,000.
    assert.ok(Math.abs(a.volume() - 23000) < 1e-6, `${a.volume()}`);
    assert.equal(await a.menu(id, "edit"), null);
    await a.settle();
    assert.equal(a.$("#edit-operation"), null, "no row to change it");
    assert.equal(a.$("#edit-operation-words")!.textContent, "Cuts from Box 1. This stays as saved: switch Combine on to change it.");
    (a.$("#feature-edit-ok") as HTMLButtonElement).click();
    await a.settle();
    assert.ok(Math.abs(a.volume() - 23000) < 1e-6, "still cut");
  } finally {
    setCombineShown(null);
  }
});

test("#507: with Combine on the row is there and the words are not; a new body has no words at all", async () => {
  setCombineShown(true);
  try {
    const { doc, id } = cutBox();
    const a = await app(doc);
    assert.equal(await a.menu(id, "edit"), null);
    await a.settle();
    assert.equal((a.$("#edit-operation") as HTMLSelectElement).value, "cut");
    assert.equal(a.$("#edit-operation-words"), null);
  } finally {
    setCombineShown(null);
  }
  setCombineShown(false);
  try {
    const s = addSketch(partDocument("box", 40, 30, 20), "XY");
    const e = extrudeSketch(drawRectangle(s.doc, s.id, [50, 0], [60, 10]).doc, s.id, 10);
    const a = await app(e.doc);
    assert.equal(await a.menu(e.id, "edit"), null);
    await a.settle();
    assert.equal(a.$("#edit-operation-words"), null);
  } finally {
    setCombineShown(null);
  }
});

test("#507: the words for each operation, and a deleted body named in words", () => {
  const { doc } = cutBox();
  assert.equal(operationWords(doc, { operation: "join", bodies: ["body:feature-1"] }), "Joins Box 1. This stays as saved: switch Combine on to change it.");
  assert.equal(operationWords(doc, { operation: "intersect", bodies: ["body:feature-1", "body:feature-9"] }), "Intersects with Box 1 and a deleted body. This stays as saved: switch Combine on to change it.");
});
