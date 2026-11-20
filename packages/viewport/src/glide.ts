// The camera gliding from where it is to where it goes (a face looked at from TestLab's card): about half a second,
// easing in and out, stopped by any press or wheel on the view, and a jump under reduced motion (the app's animation rule).
// Pure: the viewer steps it each frame (ViewportView.lookAtFace).

type Vec3 = [number, number, number];

/** A camera: where it is, what it looks at, the screen's up. */
export interface GlidePose {
  position: readonly number[];
  target: readonly number[];
  up: readonly number[];
}

/** How long a glide takes, in ms. */
export const GLIDE_MS = 500;

/** Smoothstep, 3t² − 2t³: still at both ends; t clamped to 0…1. */
export function ease(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  return s * s * (3 - 2 * s);
}

const unit = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
};
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Unit `a` turned toward unit `b` by fraction `t` of the angle between, about their common square; straight opposite, about `side` (or any square). */
function turn(a: Vec3, b: Vec3, t: number, side: readonly number[]): Vec3 {
  const c = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(c);
  if (angle < 1e-9) return b;
  // The unit square to a in the plane of a and b, toward b; opposite, one square to a and `side` (else x or y).
  let w = [b[0] - c * a[0], b[1] - c * a[1], b[2] - c * a[2]];
  if (Math.hypot(w[0], w[1], w[2]) < 1e-9) {
    w = cross(cross(a, side), a);
    if (Math.hypot(w[0], w[1], w[2]) < 1e-9) w = cross(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]), a);
  }
  const wu = unit(w);
  const s = angle * t;
  return [Math.cos(s) * a[0] + Math.sin(s) * wu[0], Math.cos(s) * a[1] + Math.sin(s) * wu[1], Math.cos(s) * a[2] + Math.sin(s) * wu[2]];
}

/**
 * The camera `t` of the way (0…1 of the time, eased) from `from` to `to`: the target moves in a straight line, the
 * direction to the camera turns at an even rate along the great circle, the distance changes by an even ratio (so a zoom
 * in or out feels even), the up turns likewise. Never passes through the target.
 */
export function glidePose(from: GlidePose, to: GlidePose, t: number): { position: Vec3; target: Vec3; up: Vec3 } {
  const e = ease(t);
  const target: Vec3 = [0, 1, 2].map((k) => from.target[k] + (to.target[k] - from.target[k]) * e) as Vec3;
  const off0 = [0, 1, 2].map((k) => from.position[k] - from.target[k]);
  const off1 = [0, 1, 2].map((k) => to.position[k] - to.target[k]);
  const d0 = Math.hypot(off0[0], off0[1], off0[2]);
  const d1 = Math.hypot(off1[0], off1[1], off1[2]);
  const dist = d0 > 0 && d1 > 0 ? d0 * (d1 / d0) ** e : d0 + (d1 - d0) * e;
  const dir = turn(unit(off0), unit(off1), e, from.up);
  const up = turn(unit(from.up), unit(to.up), e, dir);
  return { position: [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist], target, up };
}

/** Whether the computer asks for less motion (then the camera jumps); a window with no matchMedia moves. */
export function reducedMotion(win: { matchMedia?: (query: string) => { matches: boolean } }): boolean {
  return win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
