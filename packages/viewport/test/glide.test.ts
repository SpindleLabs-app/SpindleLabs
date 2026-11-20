import { test } from "node:test";
import assert from "node:assert/strict";
import { ease, glidePose, GLIDE_MS, reducedMotion } from "../src/glide.ts";

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= eps), `${a} is not ${b}`);

const from = { position: [100, 0, 0], target: [0, 0, 0], up: [0, 0, 1] };
const to = { position: [10, 10, 40], target: [10, 10, 0], up: [0, 1, 0] };

test("a glide is about half a second (the app's animation rule)", () => {
  assert.equal(GLIDE_MS, 500);
});

test("ease starts and ends still: 0 at 0, 1/2 at 1/2, 1 at 1, and clamps outside", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(0.5), 0.5);
  assert.equal(ease(1), 1);
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  // 3t² − 2t³ at 1/4: 3/16 − 2/64 = 10/64.
  assert.equal(ease(0.25), 10 / 64);
});

test("the glide starts where the camera is and ends where it goes", () => {
  const a = glidePose(from, to, 0);
  close(a.position, from.position);
  close(a.target, from.target);
  const b = glidePose(from, to, 1);
  close(b.position, to.position);
  close(b.target, to.target);
  close(b.up, to.up);
});

test("half way (by hand): the target half way, the direction turned half the angle, the distance the geometric mean", () => {
  // From +x at 100 away to +z at 40 away: half way (ease(1/2) = 1/2) the direction is 45° between, (1/√2, 0, 1/√2), and the
  // distance √(100 × 40) = √4000, so a zoom feels even; the target (5, 5, 0).
  const m = glidePose(from, to, 0.5);
  close(m.target, [5, 5, 0]);
  const d = Math.sqrt(4000);
  close(m.position, [5 + d / Math.SQRT2, 5, d / Math.SQRT2]);
});

test("a glide to straight behind turns round the side, never through the target", () => {
  const behind = { position: [-50, 0, 0], target: [0, 0, 0], up: [0, 0, 1] };
  const m = glidePose({ position: [50, 0, 0], target: [0, 0, 0], up: [0, 0, 1] }, behind, 0.5);
  // Half way it is still 50 away, square to the line it turned from.
  assert.ok(Math.abs(Math.hypot(...m.position) - 50) < 1e-9);
  assert.ok(Math.abs(m.position[0]) < 1e-9);
});

test("reduced motion: the computer's setting is read, and no matchMedia means motion", () => {
  assert.equal(reducedMotion({ matchMedia: (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }) }), true);
  assert.equal(reducedMotion({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(reducedMotion({}), false);
});
