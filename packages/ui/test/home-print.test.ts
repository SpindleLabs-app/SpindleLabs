// The home screen's printing story (home-backdrop.ts, round 10): the slice a printer lays down at a level, joined into
// loops for the nozzle's point to run round, and the words under the design. Worked by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alongPath, chainLoops, LAYER_MM, pathLength, prismSurface, sectionAt, storyWords } from "../src/home-backdrop.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const total = (segs: number[]) => {
  let sum = 0;
  for (let j = 0; j < segs.length; j += 4) sum += Math.hypot(segs[j + 2] - segs[j], segs[j + 3] - segs[j + 1]);
  return sum;
};
const square = prismSurface(
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ],
  -1,
  1,
);

test("hand-worked: the cube from −1 to 1 sliced at z = 0.25 is its 2 × 2 square outline, 8 long, every point on a side wall", () => {
  // Each side wall is two triangles; the level crosses both, so 8 segments, together the square's perimeter 4 × 2 = 8.
  const segs = sectionAt(square.positions, square.indices, 0.25);
  assert.equal(segs.length / 4, 8);
  near(total(segs), 8);
  for (let j = 0; j < segs.length; j += 2) near(Math.max(Math.abs(segs[j]), Math.abs(segs[j + 1])), 1);
});

test("the slice at the floor is empty, and at the top it is the top's outline once (a corner on the level counts as over it)", () => {
  // At z = −1 no corner is under the level: nothing. (Counting a corner on the level as under would give the floor's
  // outline here, 8 long: this is the check that can fail.)
  assert.deepEqual(sectionAt(square.positions, square.indices, -1), []);
  // At z = 1 the top face's triangles have no corner under: nothing. Each wall's triangle with one corner under gives its
  // top edge (length 2); its other triangle, two corners under, gives a point and is left out: 4 × 2 = 8.
  const top = sectionAt(square.positions, square.indices, 1);
  assert.equal(top.length / 4, 4);
  near(total(top), 8);
  // Over the top: nothing.
  assert.deepEqual(sectionAt(square.positions, square.indices, 1.5), []);
});

test("hand-worked: an L-bracket's profile sliced half way up is one closed loop as long as the L's outline, 7.6", () => {
  // The L: 2 along the foot, 0.5 up, 1.5 back, 1.3 up the arm, 0.5 across, 1.8 down: 2 + 0.5 + 1.5 + 1.3 + 0.5 + 1.8 = 7.6.
  const L = prismSurface(
    [
      [0, 0],
      [2, 0],
      [2, 0.5],
      [0.5, 0.5],
      [0.5, 1.8],
      [0, 1.8],
    ],
    0,
    1.4,
  );
  const segs = sectionAt(L.positions, L.indices, 0.7);
  near(total(segs), 7.6, 1e-9);
  const loops = chainLoops(segs, 1e-9);
  assert.equal(loops.length, 1);
  const loop = loops[0];
  near(loop[0], loop[loop.length - 2]);
  near(loop[1], loop[loop.length - 1]); // closed: it ends where it started
  near(pathLength(loop), 7.6, 1e-9);
});

test("chainLoops: two squares apart, given shuffled and some reversed, make two closed loops of 4", () => {
  const a = [0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1]; // (0,0)→(1,0), (1,1)→(1,0) reversed, (1,1)→(0,1), (0,0)→(0,1) reversed
  const b = a.map((v, k) => (k % 2 === 0 ? v + 5 : v)); // the same square 5 to the right
  const segs = [...b.slice(4, 8), ...a.slice(8, 12), ...b.slice(0, 4), ...a.slice(0, 4), ...b.slice(12), ...a.slice(12), ...a.slice(4, 8), ...b.slice(8, 12)];
  const loops = chainLoops(segs);
  assert.equal(loops.length, 2);
  for (const loop of loops) {
    near(pathLength(loop), 4);
    assert.equal(loop.length, 10); // 5 points: 4 corners and the first again
    near(loop[0], loop[8]);
    near(loop[1], loop[9]);
  }
});

test("chainLoops' tolerance: ends 0.9 × tol apart join, 1.1 × tol apart do not", () => {
  const tol = 1e-3;
  const join = chainLoops([0, 0, 1, 0, 1 + 0.9 * tol, 0, 2, 0], tol);
  assert.equal(join.length, 1);
  near(pathLength(join[0]), 2, 1e-12); // (0,0) (1,0) (2,0): the joined end's own point is taken as the one before it
  const apart = chainLoops([0, 0, 1, 0, 1 + 1.1 * tol, 0, 2, 0], tol);
  assert.equal(apart.length, 2);
});

test("hand-worked: alongPath round the unit square (0,0) (1,0) (1,1) (0,1) and back", () => {
  const sq = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0];
  assert.deepEqual(alongPath(sq, 1.5), { x: 1, y: 0.5 }); // 1 along the bottom, 0.5 up the right side
  assert.deepEqual(alongPath(sq, 4.25), { x: 0.25, y: 0 }); // once round (4), then 0.25 along the bottom
  assert.deepEqual(alongPath(sq, -0.5), { x: 0, y: 0.5 }); // half a unit back from the start: down the left side, at 3.5
  assert.equal(alongPath([2, 2, 2, 2], 1), null); // no length
});

test("hand-worked: the words under the design for each part of the story", () => {
  assert.equal(LAYER_MM, 0.2);
  // 20 mm tall in 0.2 mm layers: 100. 62% built: layer 62. 7% built is layer 7, though 0.07 × 100 is 7.000…01 in floating
  // point (rounding it up would say layer 8).
  assert.equal(storyWords("building", 0.62, 20, null, "mm"), "Printing preview · layer 62 of 100");
  assert.equal(storyWords("building", 0.07, 20, null, "mm"), "Printing preview · layer 7 of 100");
  assert.equal(storyWords("building", 0, 20, null, "mm"), "Printing preview · layer 1 of 100"); // never layer 0
  assert.equal(storyWords("building", 1, 20, null, "mm"), "Printing preview · layer 100 of 100");
  assert.equal(storyWords("building", 0.005, 20, null, "mm"), "Printing preview · layer 1 of 100"); // half a layer: the first
  assert.equal(storyWords("building", 0.015, 20, null, "mm"), "Printing preview · layer 2 of 100");
  // 31 mm: 155 layers. A part with no size (a sample): no numbers.
  assert.equal(storyWords("building", 0.5, 31, null, "mm"), "Printing preview · layer 78 of 155");
  assert.equal(storyWords("building", 0.5, null, null, "mm"), "Printing preview");
  // The extrude: its distance, signed, in the person's unit (25.4 mm is 1 in).
  assert.equal(storyWords("extrude", 1, 20, 4.8, "mm"), "Extrude top face · +4.8 mm");
  assert.equal(storyWords("extrude", 1, 20, -25.4, "in"), "Extrude top face · −1.0 in");
  assert.equal(storyWords("extrude", 1, null, null, "mm"), "Extrude top face");
  for (const stage of ["rest", "ripple", "sinking"]) assert.equal(storyWords(stage, 1, 20, 0, "mm"), "");
});
