// Tests written to kill the mutants StrykerJS found surviving in the
// viewport on main, 2026-11-06: U7a2's face framing (framing.ts:
// pointsInPlane, pieceCount, faceFraming) and a pane's picture and
// leaveNavTool (pane.ts). Each test names the change it catches; the
// mutants no caller can tell apart are explained in
// packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SharedViewport } from "@fission/core";
import { faceFraming, LOOK_AT_FACE_MARGIN, lookAtFraming, pieceCount, pointsInPlane } from "../src/framing.ts";
import { paneViewports, type PaneCamera } from "../src/pane.ts";

// ---------- pointsInPlane ----------

test("a point exactly the tolerance away from the plane is in it; 0.9× is in, 1.1× is out", () => {
  // Kills `<= tolerance` => `< tolerance`. The plane z = 0 (normal (0, 0, 1)), so a point's distance from it is its z.
  const plane = { origin: [0, 0, 0], normal: [0, 0, 1] };
  const at = (z: number) => pointsInPlane([5, 6, z], plane, 0.5);
  assert.deepEqual(at(0.5), [[5, 6, 0.5]]);
  assert.deepEqual(at(0.45), [[5, 6, 0.45]]);
  assert.deepEqual(at(0.55), []);
});

test("a slanted plane away from the origin: each coordinate is measured from the plane's origin, weighted by the normal", () => {
  // Kills `x - ox` => `x + ox`, `y - oy` => `y + oy`, the two `+` between the terms => `-`, and `* nz` => `/ nz`.
  // Worked by hand: the plane through (1, 2, 3) with normal (1, 1, 1)/√3. The point (3, 1, 2) is (2, -1, -1) from the origin,
  // and 2 - 1 - 1 = 0, so it is in the plane. (3, 1, 3) is (2, -1, 0) away: 1/√3 = 0.577 mm off, so it is out.
  const n = 1 / Math.sqrt(3);
  const plane = { origin: [1, 2, 3], normal: [n, n, n] };
  assert.deepEqual(pointsInPlane([3, 1, 2, 3, 1, 3], plane), [[3, 1, 2]]);
});

// ---------- pieceCount ----------

/** Two triangles: one at the origin, the other moved `by` (no shared vertex), as six vertices and two triangles. */
const twoTriangles = (by: [number, number, number]) => {
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const moved = tri.map((v, k) => v + by[k % 3]);
  return { positions: [...tri, ...moved], indices: [0, 1, 2, 3, 4, 5] };
};

test("two triangles 10 mm apart along x, along y or along z are two pieces", () => {
  // Kills, in a vertex's key, `* 1e5` => `/ 1e5` for each of x, y and z (10 mm and 0 mm would both round to 0, one key),
  // and the index changes `3 * i` => `3 / i`, `3 * i + 1` => `3 * i - 1`, `3 * i + 2` => `3 * i - 2`.
  for (const by of [[10, 0, 0], [0, 10, 0], [0, 0, 10]] as [number, number, number][]) {
    const { positions, indices } = twoTriangles(by);
    assert.equal(pieceCount(positions, indices), 2, String(by));
  }
  // The same place twice is one vertex: a second triangle sharing an edge is one piece with the first.
  assert.equal(pieceCount([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 1, 3, 2]), 1);
});

test("indices that stop part way through a triangle are not read as one", () => {
  // Kills `t + 2 < indices.length` => `<=`: the two indices left over (vertices 3 and 4, away from the triangle) would be
  // read with an undefined third and counted as a second piece.
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 50, 50, 50, 51, 50, 50];
  assert.equal(pieceCount(positions, [0, 1, 2, 3, 4]), 1);
});

// ---------- faceFraming ----------

const whole = { centre: [100, 100, 100], radius: 1000 };

test("three corners in the plane are enough to frame the face", () => {
  // Kills `inPlane.length < 3` => `<=`: a triangle face (three corners) is framed, not the whole body.
  // Worked by hand: (0, 0, 0), (10, 0, 0), (0, 10, 0) box to centre (5, 5, 0), half-diagonal √200/2 = 7.07, ×1.1 = 7.78.
  const f = faceFraming([[0, 0, 0], [10, 0, 0], [0, 10, 0]], [], whole, [0, 0, 0]);
  assert.deepEqual(f.centre, [5, 5, 0]);
  assert.ok(Math.abs(f.radius - (Math.sqrt(200) / 2) * 1.1) < 1e-12, String(f.radius));
  assert.equal(faceFraming([[0, 0, 0], [10, 0, 0]], [], whole, [0, 0, 0]), whole, "two corners are no face");
});

test("a face framed exactly as loose as the whole picture keeps the whole picture", () => {
  // Kills `radius < whole.radius` => `<=`: at equal radii the whole (with its own centre) is kept.
  const corners = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  const same = { centre: [100, 100, 100], radius: lookAtFraming(corners, [0, 0, 0]).radius * LOOK_AT_FACE_MARGIN };
  assert.equal(faceFraming(corners, [], same, [0, 0, 0]), same);
});

// ---------- pane.ts ----------

test("a pane's picture and leaving its navigation tool reach the pane's own view", () => {
  // Kills `{ picture: () => view.picture!() }` => {} and its arrow => undefined, and `() => view.leaveNavTool()` => undefined.
  const calls: string[] = [];
  const pane = paneViewports({} as SharedViewport);
  const view = {
    element: {} as HTMLElement,
    picture: () => (calls.push("picture"), "the picture"),
    leaveNavTool: () => void calls.push("leaveNavTool"),
  } as unknown as PaneCamera;
  const v = pane(view) as SharedViewport & { picture?: () => unknown };
  assert.equal(v.picture?.(), "the picture");
  v.leaveNavTool();
  assert.deepEqual(calls, ["picture", "leaveNavTool"]);
  // A view with no picture gives the pane none.
  assert.equal("picture" in pane({ ...view, picture: undefined } as unknown as PaneCamera), false);
});
