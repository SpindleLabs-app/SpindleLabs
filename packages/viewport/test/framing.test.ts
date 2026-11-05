import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOK_AT_EMPTY_RADIUS, lookAtFraming, needsRefit, partFraming, pointsInPlane, faceFraming, LOOK_AT_FACE_MARGIN, selectionFraming } from "../src/framing.ts";

test("camera re-frames when the body stops fitting or becomes a speck", () => {
  const at = (x: number, y: number, z: number, radius: number) => ({ centre: [x, y, z] as [number, number, number], radius });
  assert.equal(needsRefit(null, at(0, 0, 0, 25)), true); // first body
  // 40×30×20 box (r = √2900/2 ≈ 26.93, centre (20, 15, 10)) widened to 45:
  // r = √3325/2 ≈ 28.83, centre moves 2.5; 2.5 + 28.83 < 1.5 × 26.93.
  assert.equal(needsRefit(at(20, 15, 10, Math.sqrt(2900) / 2), at(22.5, 15, 10, Math.sqrt(3325) / 2)), false);
  // Boundary on the fit rule, framed r = 10: reach 15 is kept, just past re-frames.
  assert.equal(needsRefit(at(0, 0, 0, 10), at(3, 4, 0, 10)), false); // 5 + 10 = 15
  assert.equal(needsRefit(at(0, 0, 0, 10), at(3, 4, 0, 10.0001)), true);
  assert.equal(needsRefit(at(0, 0, 0, 10), at(0, 0, 0, 15)), false); // grew 1.5×
  assert.equal(needsRefit(at(0, 0, 0, 10), at(0, 0, 0, 15.0001)), true);
  // Boundary on shrinking: a tenth is kept, just under re-frames.
  assert.equal(needsRefit(at(0, 0, 0, 1), at(0, 0, 0, 0.1)), false);
  assert.equal(needsRefit(at(0, 0, 0, 1), at(0, 0, 0, 0.0999)), true);
  // 40 mm box → 1 µm box: radius ratio ~3e-5.
  assert.equal(needsRefit(at(20, 15, 10, 29), at(0.0005, 0.0005, 0.0005, 0.00087)), true);
  assert.equal(needsRefit(at(0, 0, 0, 5), at(0, 0, 0, 0)), false); // nothing to frame
});

test("the selection is framed by a sphere around its own triangles and segments", () => {
  // A hand-built mesh of the 40 × 30 × 20 box's top face (face 1, z = 20,
  // two triangles) and bottom face (face 0, z = 0), and two edges: edge 4
  // from (0, 0, 20) to (40, 0, 20), edge 9 from (40, 30, 0) to (40, 30, 20).
  const mesh = {
    positions: [0, 0, 20, 40, 0, 20, 40, 30, 20, 0, 30, 20, 0, 0, 0, 40, 0, 0, 40, 30, 0, 0, 30, 0],
    indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6],
    triangle_faces: [1, 1, 0, 0],
    edge_lines: [0, 0, 20, 40, 0, 20, 40, 30, 0, 40, 30, 20],
    edge_line_edges: [4, 9],
  };
  // Top face alone: box 0..40 × 0..30 × 20..20, centre (20, 15, 20),
  // radius = √(40² + 30²)/2 = 50/2 = 25.
  assert.deepEqual(selectionFraming(mesh, [1], []), { centre: [20, 15, 20], radius: 25 });
  // Edge 4 alone: centre (20, 0, 20), radius 40/2 = 20.
  assert.deepEqual(selectionFraming(mesh, [], [4]), { centre: [20, 0, 20], radius: 20 });
  // Top face and edge 9: box 0..40 × 0..30 × 0..20, the whole box,
  // centre (20, 15, 10), radius √2900/2 (as fit() frames it).
  assert.deepEqual(selectionFraming(mesh, [1], [9]), { centre: [20, 15, 10], radius: Math.sqrt(2900) / 2 });
  // The bottom face does not leak into the top face's framing, and an
  // index the mesh does not have frames nothing.
  assert.equal(selectionFraming(mesh, [0], []).centre[2], 0);
  assert.deepEqual(selectionFraming(mesh, [7], [3]), { centre: [0, 0, 0], radius: 0 });
  assert.deepEqual(selectionFraming(mesh, [], []), { centre: [0, 0, 0], radius: 0 });
});

test("hand-worked: Look At frames the box round the body's corners and the sketch's ends", () => {
  // Corners (0, 0, 0) and (6, 8, 0): centre (3, 4, 0), diagonal 10, radius 5.
  assert.deepEqual(lookAtFraming([[0, 0, 0], [6, 8, 0]], [9, 9, 9]), { centre: [3, 4, 0], radius: 5 });
  // A sketch end out at (−6, 4, 0) widens it: x from −6 to 6, y 0 to 8: centre (0, 4, 0), radius √(144 + 64) / 2 = √52.
  const wide = lookAtFraming([[0, 0, 0], [6, 8, 0], [-6, 4, 0]], [0, 0, 0]);
  assert.deepEqual(wide.centre, [0, 4, 0]);
  assert.ok(Math.abs(wide.radius - Math.sqrt(52)) < 1e-12);
});

test("Look At with nothing to frame, or one point, frames 50 mm round it; points that aren't numbers are skipped", () => {
  assert.deepEqual(lookAtFraming([], [1, 2, 3]), { centre: [1, 2, 3], radius: LOOK_AT_EMPTY_RADIUS });
  assert.deepEqual(lookAtFraming([[4, 4, 0], [4, 4, 0]], [0, 0, 0]), { centre: [4, 4, 0], radius: LOOK_AT_EMPTY_RADIUS });
  assert.deepEqual(lookAtFraming([[NaN, 0, 0], [0, 0, 0], [6, 8, 0]], [0, 0, 0]), { centre: [3, 4, 0], radius: 5 });
});

test("hand-worked: Fit frames the box round the body and every finished sketch, a lost one too (hunt 26h)", () => {
  // A 40 × 30 × 20 box from the origin alone: centre (20, 15, 10), radius half the diagonal, √(40² + 30² + 20²) / 2 = √2900 / 2.
  const body = [
    [0, 0, 0],
    [40, 30, 20],
  ];
  const alone = partFraming(body);
  assert.deepEqual(alone.centre, [20, 15, 10]);
  assert.ok(Math.abs(alone.radius - Math.sqrt(2900) / 2) < 1e-12);
  // With a sketch held at x = 60 (its face gone), a circle round (60, 15, 10) of radius 3: the box is now 0..60 in x,
  // so the centre is (30, 15, 10) and the radius √(60² + 30² + 20²) / 2 = √4900 / 2 = 35.
  const both = partFraming([...body, [60, 12, 10], [60, 18, 10], [60, 15, 7], [60, 15, 13]]);
  assert.deepEqual(both.centre, [30, 15, 10]);
  assert.equal(both.radius, 35);
  // A sketch inside the body's box changes nothing.
  assert.deepEqual(partFraming([...body, [10, 10, 0], [30, 20, 0]]), alone);
  // Nothing, or nothing that is a point: radius 0 (nothing to frame); NaN and short points are skipped.
  assert.deepEqual(partFraming([]), { centre: [0, 0, 0], radius: 0 });
  assert.deepEqual(partFraming([[NaN, 0, 0], [1, 2]]), { centre: [0, 0, 0], radius: 0 });
  assert.deepEqual(partFraming([...body, [Infinity, 0, 0]]), alone);
  // One point is a box of size 0 there, not nothing: centre (5, 6, 7), radius 0.
  assert.deepEqual(partFraming([[5, 6, 7]]), { centre: [5, 6, 7], radius: 0 });
  // A box not starting at the origin, (1, 2, 3) to (4, 6, 15): sides 3, 4, 12, so the
  // diagonal is √(9 + 16 + 144) = 13 and the radius 6.5; centre (2.5, 4, 9).
  assert.deepEqual(partFraming([[1, 2, 3], [4, 6, 15]]), { centre: [2.5, 4, 9], radius: 6.5 });
});

test("hand-worked: Look At on the 40 × 30 × 20 box's top face frames that face, not the whole box", () => {
  // The box's 8 corners as a mesh's vertices (x, y, z each).
  const box = [0, 0, 0, 40, 0, 0, 40, 30, 0, 0, 30, 0, 0, 0, 20, 40, 0, 20, 40, 30, 20, 0, 30, 20];
  const top = { origin: [0, 0, 20], normal: [0, 0, 1] };
  const corners = pointsInPlane(box, top);
  assert.deepEqual(corners, [[0, 0, 20], [40, 0, 20], [40, 30, 20], [0, 30, 20]], "the four top corners");
  // Its box is 40 × 30 × 0, centre (20, 15, 20), half the diagonal √(40² + 30²)/2 = 50/2 = 25.
  assert.deepEqual(lookAtFraming(corners, top.origin), { centre: [20, 15, 20], radius: 25 });
  // The whole box would be centre (20, 15, 10), radius √(40² + 30² + 20²)/2 = √2900/2 = 26.93: looser, and off the face.
  // A plane through the middle (z = 10) touches no vertex, so nothing is found and the caller falls back to the box.
  assert.deepEqual(pointsInPlane(box, { origin: [0, 0, 10], normal: [0, 0, 1] }), []);
  // A repeated corner (each is in several triangles) is one point.
  assert.equal(pointsInPlane([...box, ...box], top).length, 4);
});

test("the plane's tolerance: a vertex 0.9 × tolerance off the plane counts, 1.1 × does not", () => {
  const plane = { origin: [0, 0, 0], normal: [0, 0, 1] };
  assert.equal(pointsInPlane([0, 0, 0.0009], plane, 0.001).length, 1);
  assert.equal(pointsInPlane([0, 0, 0.0011], plane, 0.001).length, 0);
  assert.equal(pointsInPlane([0, 0, -0.0009], plane, 0.001).length, 1, "either side");
  assert.equal(pointsInPlane([0, 0, NaN], plane).length, 0, "a vertex that isn't a number is left out");
});

test("hand-worked: a sketch on a small face frames that face with a margin; on a face as big as the body, the body as before", () => {
  // A 100 × 100 × 100 block (centre (50, 50, 50), half diagonal √30000/2 = 86.60) with a 30 × 40 face on it at z = 100.
  const whole = lookAtFraming([[0, 0, 0], [100, 100, 100]], [0, 0, 100]);
  assert.ok(Math.abs(whole.radius - 86.6025) < 1e-3);
  const face = [[10, 10, 100], [40, 10, 100], [40, 50, 100], [10, 50, 100]];
  // The face's half diagonal is √(30² + 40²)/2 = 25, with the 10 % margin 27.5, centre (25, 30, 100).
  assert.equal(LOOK_AT_FACE_MARGIN, 1.1);
  const framed = faceFraming(face, [], whole, [0, 0, 100]);
  assert.deepEqual(framed.centre, [25, 30, 100]);
  assert.ok(Math.abs(framed.radius - 27.5) < 1e-12);
  // The sketch's ends count: a point drawn at (70, 50, 100) widens it to 10..70 × 10..50, half diagonal √(60² + 40²)/2 = 36.06.
  assert.ok(Math.abs(faceFraming(face, [[70, 50, 100]], whole, [0, 0, 100]).radius - 1.1 * Math.sqrt(5200) / 2) < 1e-9);
  // A face as big as the body (100 × 100: half diagonal 70.7, with margin 77.8 — but a whole body whose radius is 26.93 is tighter): never looser than the body.
  const tight = lookAtFraming([[0, 0, 0], [40, 30, 20]], [0, 0, 20]); // radius √2900/2 = 26.93
  const topFace = [[0, 0, 20], [40, 0, 20], [40, 30, 20], [0, 30, 20]]; // 25 · 1.1 = 27.5 > 26.93
  assert.deepEqual(faceFraming(topFace, [], tight, [0, 0, 20]), tight);
  // Fewer than three corners in the plane: the body.
  assert.deepEqual(faceFraming([[0, 0, 0], [1, 0, 0]], [], tight, [0, 0, 0]), tight);
});
