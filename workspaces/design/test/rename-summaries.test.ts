// SL #819 E-1/B-1 (app bug hunt 2026-11-18): Rename rewrote every whole-word match of the old name in the descriptions
// of the items made from the renamed one, so renaming an item called "Box" turned "Cut Box 2 from Box" into
// "Cut Plate 2 from Plate", and an item called "XY" or "5" changed a plane's name or a number. Each description is now
// said again from its own kind's words with the new name (summary-names.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertChamfer } from "../src/chamfer.ts";
import { insertCombine } from "../src/combine.ts";
import { bodyIdOf, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { insertPattern } from "../src/pattern.ts";
import type { PatternValues } from "../src/pattern-values.ts";
import { insertShell } from "../src/shell.ts";
import { addConstructSketch, addFaceSketch, addSketch, drawRectangle } from "../src/sketch.ts";
import { insertConstruct } from "../src/construct.ts";
import { summaryNamed } from "../src/summary-names.ts";
import { renameItem } from "../src/timeline-edits.ts";

const renamed = (doc: DesignDocument, id: string, typed: string) => {
  const r = renameItem(doc, id, typed);
  if ("refused" in r) throw new Error(`refused: ${r.message}`);
  return r.doc;
};
const summaryOf = (doc: DesignDocument, id: string) => doc.timeline.features.find((f) => f.id === id)!.intent.summary;

test("hand-worked: Box and Box 2, a Combine cutting Box 2 from Box; renaming Box to Plate leaves Box 2's name", () => {
  let doc = renamed(partDocument("box", 40, 30, 10), "feature-1", "Box");
  const b2 = insertPreset(doc, "box", 10, 10, 30);
  doc = b2.doc;
  assert.equal(doc.timeline.features.find((f) => f.id === b2.id)!.provenance.self.label, "Box 2");
  const c = insertCombine(doc, "body:feature-1", [bodyIdOf(b2.id)], "cut");
  assert.equal(summaryOf(c.doc, c.id), "Cut Box 2 from Box");
  // By hand: only the target, Box, is renamed; the tool is still Box 2 (the old words gave "Cut Plate 2 from Plate").
  assert.equal(summaryOf(renamed(c.doc, "feature-1", "Plate"), c.id), "Cut Box 2 from Plate");
  // And the other way: renaming the tool leaves the target.
  assert.equal(summaryOf(renamed(c.doc, b2.id, "Peg"), c.id), "Cut Peg from Box");
});

test("hand-worked: an item named XY mirrored across the XY plane; renaming it changes the body's name, not the plane's", () => {
  const doc = renamed(partDocument("box", 40, 30, 10), "feature-1", "XY");
  const m = insertDuplicates(doc, [bodyIdOf("feature-1")], "XY");
  const id = m.ids[0];
  assert.equal(summaryOf(m.doc, id), "Mirror of XY across the XY plane");
  assert.equal(summaryOf(renamed(m.doc, "feature-1", "Base"), id), "Mirror of Base across the XY plane");
});

test("hand-worked: an item named 5 moved by (5, 0, 5) mm; renaming it changes the name, not the numbers", () => {
  const doc = renamed(partDocument("box", 40, 30, 10), "feature-1", "5");
  const m = insertMove(doc, [bodyIdOf("feature-1")], { ...NO_MOVE, x: 5, z: 5 });
  assert.equal(summaryOf(m.doc, m.id), "Move 5 by (5, 0, 5) mm");
  assert.equal(summaryOf(renamed(m.doc, "feature-1", "Peg"), m.id), "Move Peg by (5, 0, 5) mm");
});

test("hand-worked: a sketch on a face of Box, renamed Base, says Base, and Box 2 on its own row is left alone", () => {
  let doc = renamed(partDocument("box", 40, 30, 20), "feature-1", "Box");
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  const s = addFaceSketch(doc, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  assert.match(summaryOf(s.doc, s.id), / on a face of Box$/);
  const after = summaryOf(renamed(s.doc, "feature-1", "Base"), s.id);
  assert.equal(after, summaryOf(s.doc, s.id).replace(/Box$/, "Base"));
});

test("a description that can't be said again from its parameters is left as it is (never rewritten by text)", () => {
  const doc = partDocument("box", 40, 30, 10);
  const m = insertDuplicates(doc, [bodyIdOf("feature-1")]);
  const id = m.ids[0];
  const handMade: DesignDocument = { ...m.doc, timeline: { ...m.doc.timeline, features: m.doc.timeline.features.map((f) => (f.id === id ? { ...f, intent: { ...f.intent, summary: "A copy of Box 1 made by hand" } } : f)) } };
  assert.equal(summaryOf(renamed(handMade, "feature-1", "Base"), id), "A copy of Box 1 made by hand");
});

const row: PatternValues = { kind: "linear", direction: "X", spacing: 15, count: 3, join: false } as PatternValues;
const round: PatternValues = { kind: "circular", axis: "Z", centre: [0, 0, 0], count: 4, angle: 90, join: false } as PatternValues;
const EDGE = "design:" + encodeURIComponent("face:feature-1/top+face:feature-1/front");

/**
 * Self-consistency (not a hand-worked test): every kind whose description names another item says it again from its
 * parameters exactly as made, so Rename can trust it. A kind that drifted would leave its words unrenamed.
 */
test("every kind that names another item is said again exactly as made", () => {
  const base = partDocument("box", 40, 30, 10);
  const second = insertPreset(base, "box", 5, 5, 5);
  const two = second.doc;
  const other = bodyIdOf(second.id);
  const made: [string, () => { doc: DesignDocument; id: string }][] = [
    ["combine cut", () => insertCombine(two, "body:feature-1", [other], "cut")],
    ["combine join keeping tools", () => insertCombine(two, "body:feature-1", [other], "join", true)],
    ["combine intersect", () => insertCombine(two, "body:feature-1", [other], "intersect")],
    ["move", () => insertMove(base, [bodyIdOf("feature-1")], { ...NO_MOVE, x: 1.5, turnZ: 90 })],
    ["rotate", () => insertMove(base, [bodyIdOf("feature-1")], { ...NO_MOVE, turnX: 45 }, "rotate")],
    ["scale", () => insertMove(base, [bodyIdOf("feature-1")], { ...NO_MOVE, scale: 2 }, "scale")],
    ["two bodies moved", () => insertMove(two, [bodyIdOf("feature-1"), other], { ...NO_MOVE, y: 2 })],
    ["copy", () => ((r) => ({ doc: r.doc, id: r.ids[0] }))(insertDuplicates(base, [bodyIdOf("feature-1")]))],
    ["mirror", () => ((r) => ({ doc: r.doc, id: r.ids[0] }))(insertDuplicates(base, [bodyIdOf("feature-1")], "YZ"))],
    ["chamfer equal", () => insertChamfer(base, "body:feature-1", [EDGE], { equal: 2 })],
    ["chamfer two", () => insertChamfer(base, "body:feature-1", [EDGE], { two: [2, 3] }, true)],
    ["chamfer angle", () => insertChamfer(base, "body:feature-1", [EDGE], { angle: [2, 30] })],
    ["pattern row", () => insertPattern(base, ["body:feature-1"], row)],
    ["pattern round", () => insertPattern(base, ["body:feature-1"], round)],
    ["shell", () => insertShell(base, "body:feature-1", [facePlane("feature-1", "top")], 1)],
    ["extrude of a sketch", () => {
      const s = addSketch(base);
      return extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc, s.id, 5, true);
    }],
    ["extrude cut", () => {
      const s = addSketch(base);
      return extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc, s.id, 5, false, undefined, { operation: "cut", bodies: ["body:feature-1"] });
    }],
    ["sketch on a face", () => addFaceSketch(base, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 10]))],
  ];
  for (const [what, make] of made) {
    const { doc, id } = make();
    const f = doc.timeline.features.find((x) => x.id === id)!;
    assert.equal(summaryNamed(f), f.intent.summary, what);
  }
});

// After 59a3a (SL #832): a construction plane can be renamed too, and the descriptions naming it said again.
const PLACED = { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1], near: [0, 0, 0] } as const;

test("hand-worked: Plane 1 renamed Datum; the sketch on it and the Mirror across it say Datum, the Mirror's body name kept", () => {
  const { doc: d0, id: plane } = insertConstruct(partDocument("box", 40, 30, 20), "offset_plane", { plane: "face:feature-1/top" }, 5, PLACED);
  const s = addConstructSketch(d0, plane);
  assert.equal(summaryOf(s.doc, s.id), "Sketch 1 on Plane 1");
  const m = insertDuplicates(s.doc, ["body:feature-1"], `construct:${plane}`);
  const mirror = m.ids[0];
  assert.equal(summaryOf(m.doc, mirror), "Mirror of Box 1 across Plane 1");
  const after = renamed(m.doc, plane, "Datum");
  assert.equal(summaryOf(after, s.id), "Sketch 1 on Datum");
  assert.equal(summaryOf(after, mirror), "Mirror of Box 1 across Datum");
  // Renaming the box changes the Mirror's body name only; the sketch on the plane is left alone.
  const boxRenamed = renamed(m.doc, "feature-1", "Base");
  assert.equal(summaryOf(boxRenamed, mirror), "Mirror of Base across Plane 1");
  assert.equal(summaryOf(boxRenamed, s.id), "Sketch 1 on Plane 1");
});
