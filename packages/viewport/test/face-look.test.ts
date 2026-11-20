import { test } from "node:test";
import assert from "node:assert/strict";
import { faceLook, faceLookPose, FACE_LOOK_MARGIN, ROUND_FACE } from "../src/face-look.ts";
import { fitDistance } from "../src/views.ts";

/**
 * A box 20 × 10 × 5 (x, y, z from 0), two triangles a face, wound outwards
 * as the kernel winds them: face 0 the top (z = 5), 1 the bottom, 2 the
 * front (y = 0), 3 the right (x = 20).
 */
const P = [
  [0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0],
  [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
];
const tris: [number, number, number, number][] = [
  [4, 5, 6, 0], [4, 6, 7, 0], // top: (5−4)×(6−4) = (20,0,0)×(20,10,0) = (0,0,200), +z
  [0, 2, 1, 1], [0, 3, 2, 1], // bottom: (20,10,0)×(20,0,0) = (0,0,−200), −z
  [0, 1, 5, 2], [0, 5, 4, 2], // front: (20,0,0)×(20,0,5) = (0,−100,0), −y
  [1, 2, 6, 3], [1, 6, 5, 3], // right: (0,10,0)×(0,10,5) = (50,0,0), +x
];
const box = {
  positions: P.flat(),
  indices: tris.flatMap((t) => t.slice(0, 3)),
  triangle_faces: tris.map((t) => t[3]),
};

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= eps), `${a} is not ${b}`);

test("the top of a 20 × 10 × 5 box: looked at from straight above, framed round its own corners (by hand)", () => {
  const look = faceLook(box, 0);
  assert.ok(look !== null);
  // Its corners run 0…20 in x, 0…10 in y, at z = 5: centre (10, 5, 5); half the diagonal √(20² + 10²)/2 = √500/2, with the margin.
  close(look.framing.centre, [10, 5, 5]);
  assert.ok(Math.abs(look.framing.radius - (Math.sqrt(500) / 2) * FACE_LOOK_MARGIN) < 1e-9);
  // Both triangles' normals are (0, 0, 200): the outward normal is +z.
  close(look.toward!, [0, 0, 1]);
});

test("the front and the right face look from −y and +x (by hand), each framed round only its own corners", () => {
  const front = faceLook(box, 2)!;
  close(front.toward!, [0, -1, 0]);
  // x 0…20, z 0…5 at y = 0: centre (10, 0, 2.5), half diagonal √(400 + 25)/2.
  close(front.framing.centre, [10, 0, 2.5]);
  assert.ok(Math.abs(front.framing.radius - (Math.sqrt(425) / 2) * FACE_LOOK_MARGIN) < 1e-9);
  const right = faceLook(box, 3)!;
  close(right.toward!, [1, 0, 0]);
  close(right.framing.centre, [20, 5, 2.5]);
});

test("a face the mesh doesn't have, or with no size, gives nothing to look at", () => {
  assert.equal(faceLook(box, 7), null);
  assert.equal(faceLook(box, -1), null);
  const flat = { positions: [1, 1, 1, 1, 1, 1, 1, 1, 1], indices: [0, 1, 2], triangle_faces: [0] };
  assert.equal(faceLook(flat, 0), null);
});

test("a face round on itself (a tube's whole side) has no one direction: toward is null, the view keeps its own", () => {
  // A square tube's four sides as one face: the four normals cancel.
  const tube = { positions: box.positions, indices: [4, 5, 6, 4, 6, 7, 0, 2, 1, 0, 3, 2], triangle_faces: [0, 0, 0, 0] };
  const look = faceLook(tube, 0)!;
  assert.equal(look.toward, null);
  // Its corners are the whole box: centre (10, 5, 2.5).
  close(look.framing.centre, [10, 5, 2.5]);
});

test("ROUND_FACE boundary: normals cancelling to 0.9× of it keep no direction, 1.1× give one", () => {
  // Two triangles of area 50 each: one facing +z, one −z tilted so the sum's length is k of the total (100 doubled = 200).
  const make = (k: number) => {
    // Upper: (0,0,0) (10,0,0) (0,10,0): twice-area normal (0,0,100). Lower: same corners with z lifted on one so its normal
    // is (0, 0, −100 + 200k)... simpler: scale the lower triangle so its twice-area is 100(1 − 2k) facing −z.
    const s = Math.sqrt(1 - 2 * k);
    return {
      positions: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1, 0, 10 * s, 1, 10 * s, 0, 1],
      indices: [0, 1, 2, 3, 4, 5],
      triangle_faces: [0, 0],
    };
  };
  // Sum = 100 − 100(1 − 2k) = 200k; total = 100 + 100(1 − 2k) = 200(1 − k); ratio k/(1 − k).
  const kFor = (ratio: number) => ratio / (1 + ratio);
  assert.equal(faceLook(make(kFor(0.9 * ROUND_FACE)), 0)!.toward, null);
  assert.notEqual(faceLook(make(kFor(1.1 * ROUND_FACE)), 0)!.toward, null);
});

test("the camera for a face: square onto it from outside at the fitting distance, top seen with +y up (by hand)", () => {
  const look = faceLook(box, 0)!;
  const pose = faceLookPose(look, [0.6, -0.8, 0.55], 45, 1.5);
  const d = fitDistance(look.framing.radius, 45, 1.5);
  close(pose.target, [10, 5, 5]);
  close(pose.position, [10, 5, 5 + d]);
  close(pose.up, [0, 1, 0]);
  // The front from −y with z up.
  const front = faceLookPose(faceLook(box, 2)!, [1, 0, 0], 45, 1);
  close(front.up, [0, 0, 1]);
  assert.ok(front.position[1] < 0);
});

test("a face with no one direction is framed from where the camera already looks", () => {
  const tube = { positions: box.positions, indices: [4, 5, 6, 4, 6, 7, 0, 2, 1, 0, 3, 2], triangle_faces: [0, 0, 0, 0] };
  const look = faceLook(tube, 0)!;
  const pose = faceLookPose(look, [3, 0, 4], 45, 1); // the camera 3 along x and 4 up for every 5 away
  const d = fitDistance(look.framing.radius, 45, 1);
  close(pose.position, [10 + 0.6 * d, 5, 2.5 + 0.8 * d]);
});
