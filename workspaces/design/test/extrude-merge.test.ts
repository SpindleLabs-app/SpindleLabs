// SL #611 C1: several profiles extruded without a boolean where none is needed (extrude-merge.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Outline } from "@fission/core";
import { contactGroups, mayShareFace, mergedOutline, outlineArea } from "../src/extrude-merge.ts";
import { REACH } from "../src/extrude-operation.ts";

const box = (lo: number[], hi: number[]) => [lo, hi] as const;
const line = (index: number, reversed = false) => ({ curve: "line" as const, index, reversed });

test("hand-worked: prisms touching on a face may share it; along a line or at a corner they can't; 0.9x/1.1x REACH", () => {
  // Two 10 x 10 x 1 boxes side by side share the face x = 10 (thin on one axis only).
  assert.equal(mayShareFace(box([0, 0, 0], [10, 10, 1]), box([10, 0, 0], [20, 10, 1])), true);
  // Corner to corner in the plane they share only the line x = 10, y = 10 (thin on two axes): never a face.
  assert.equal(mayShareFace(box([0, 0, 0], [10, 10, 1]), box([10, 10, 0], [20, 20, 1])), false);
  // A gap of 0.9 REACH still counts as touching (the kernel's tolerance); 1.1 REACH apart they don't meet.
  assert.equal(mayShareFace(box([0, 0, 0], [10, 10, 1]), box([10 + 0.9 * REACH, 0, 0], [20, 10, 1])), true);
  assert.equal(mayShareFace(box([0, 0, 0], [10, 10, 1]), box([10 + 1.1 * REACH, 0, 0], [20, 10, 1])), false);
  // Overlapping by 1.1 REACH on two axes is no longer a line: it may share a face.
  assert.equal(mayShareFace(box([0, 0, 0], [10, 10, 1]), box([10 - 1.1 * REACH, 10 - 1.1 * REACH, 0], [20, 20, 1])), true);
  assert.equal(mayShareFace(box([0, 0, 0], [10, 10, 1]), box([10 - 0.9 * REACH, 10 - 0.9 * REACH, 0], [20, 20, 1])), false);
});

test("hand-worked: groups join through a chain, apart ones stay alone", () => {
  // A touches B, B touches C, D far away: [A, B, C] and [D].
  const boxes = [box([0, 0, 0], [1, 1, 1]), box([1, 0, 0], [2, 1, 1]), box([2, 0, 0], [3, 1, 1]), box([9, 9, 0], [10, 10, 1])];
  assert.deepEqual(contactGroups(boxes), [[0, 1, 2], [3]]);
});

const square = (x0: number, x1: number, first: number): Outline => ({
  outer: { path: { corners: [x0, 0, x1, 0, x1, 10, x0, 10], bulges: [0, 0, 0, 0] } },
  holes: [],
  pieces: [line(first), line(first + 1), line(first + 2), line(first + 3)],
  holePieces: [],
});

test("hand-worked: a plate and the disc in its hole merge to the plate's outline, 400 mm2", () => {
  // Plate 20 x 20 with a hole r 5 at (10, 10): 400 - 25pi; the disc 25pi. Together the square, 400.
  const plate: Outline = { outer: { path: { corners: [0, 0, 20, 0, 20, 20, 0, 20], bulges: [] } }, holes: [{ circle: { center: [10, 10], radius: 5 } }], pieces: [line(0), line(1), line(2), line(3)], holePieces: [[{ curve: "circle", index: 0, reversed: true }]] };
  const disc: Outline = { outer: { circle: { center: [10, 10], radius: 5 } }, holes: [], pieces: [{ curve: "circle", index: 0, reversed: false }], holePieces: [] };
  assert.ok(Math.abs(outlineArea(plate)! - (400 - 25 * Math.PI)) < 1e-9);
  const m = mergedOutline([plate, disc])!;
  assert.deepEqual(m.holes, []);
  assert.ok(Math.abs(outlineArea(m)! - 400) < 1e-9);
});

test("hand-worked: two halves of a circle merge back to the whole circle", () => {
  // Circle r 10 at the origin cut by the diameter along x: the upper half runs (10,0) -> (-10,0) round the top (a half
  // turn counter-clockwise, bulge 1), then the diameter back; the lower half (-10,0) -> (10,0) round the bottom, then
  // the diameter back the other way. Without the diameter, run both ways, the circle is left: centre (0, 0), radius 10.
  const arc = { curve: "circle" as const, index: 0, reversed: false };
  const upper: Outline = { outer: { path: { corners: [10, 0, -10, 0], bulges: [1, 0] } }, holes: [], pieces: [arc, line(0, true)], holePieces: [] };
  const lower: Outline = { outer: { path: { corners: [-10, 0, 10, 0], bulges: [1, 0] } }, holes: [], pieces: [arc, line(0)], holePieces: [] };
  const m = mergedOutline([upper, lower])!;
  assert.ok("circle" in m.outer, JSON.stringify(m.outer));
  const c = (m.outer as { circle: { center: [number, number]; radius: number } }).circle;
  assert.ok(Math.hypot(c.center[0], c.center[1]) < 1e-9 && Math.abs(c.radius - 10) < 1e-9, JSON.stringify(c));
});

test("hand-worked: two squares side by side merge to one 20 x 10 rectangle with its bottom and top one side each", () => {
  // Squares x 0..10 and 10..20, the shared side x = 10 run both ways goes; the bottoms (one sketch line split at x = 10)
  // become one side, so the outline has 4 corners and area 200.
  const a = square(0, 10, 0);
  const b = square(10, 20, 0);
  b.pieces = [line(0), line(1), line(2), line(4, true)];
  a.pieces = [line(0), line(4), line(2), line(3)];
  const m = mergedOutline([a, b])!;
  assert.ok(Math.abs(outlineArea(m)! - 200) < 1e-9);
  assert.equal((m.outer as { path: { corners: number[] } }).path.corners.length, 8);
});

test("refused: squares apart, or meeting at a corner only, are no one region", () => {
  assert.equal(mergedOutline([square(0, 10, 0), square(30, 40, 4)]), null);
  const corner: Outline = { ...square(10, 20, 4), outer: { path: { corners: [10, 10, 20, 10, 20, 20, 10, 20], bulges: [0, 0, 0, 0] } } };
  assert.equal(mergedOutline([square(0, 10, 0), corner]), null);
});
