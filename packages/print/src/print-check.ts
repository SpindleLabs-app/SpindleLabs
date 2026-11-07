// Print check (H1, Ben 2026-11-05): what would go wrong printing the bodies
// as modelled (Z up, the lowest point on the plate), found on the display
// meshes the view already has, so it updates on every change, offline, with
// no slicing and nothing from the kernel. Four findings, each per triangle
// of the joined mesh (scene.ts `joinBodies`' order) so the view can paint
// them:
//
// - Needs supports: faces leaning out further than the overhang angle from
//   upright (the engine's 45°: overhang.ts), not on the plate and not
//   resting on a body under them, that no bridge holds up.
// - Too thin: walls narrower than one outer line (0.42 mm, the engine's
//   `external_width`), or flat skins thinner than one layer. A wall whose
//   two sides are t apart along its normal n has a strip t / |n_xy| wide in
//   each layer and is t / |n_z| tall, so it is lost when t < w·|n_xy| (the
//   strip is narrower than a line, the engine leaves it out) or
//   t < h·|n_z| (it falls between layers).
// - Bridge may sag: a flat underside (within 5° of level) held up at both
//   ends, but further than 10 mm from end to end. A shorter bridge prints
//   without supports, so it is not marked.
// - Weakest spot (an estimate): the narrowest neck along the build
//   direction, a layer whose cross-section is at most half of the biggest
//   below it and of the biggest above it. Layers bond less well than the
//   plastic along them, so a push on the part above splits it there first.
//
// Every test of "is there material here" is a point-in-solid test against
// the bodies' meshes (a ray's crossings, odd inside), so bodies not yet
// combined count together: a plate resting on a column rests on it.

/** A body's display mesh: corners [x, y, z, …] in mm and three corner indices a triangle, wound outward (right-hand rule). */
export interface CheckMesh {
  positions: readonly number[];
  indices: readonly number[];
}

/** What the check judges against: the printer and the plastic. */
export interface PrintRules {
  /** Degrees a wall may lean out from upright and print without supports. */
  overhangAngle: number;
  /** The narrowest line the printer lays (mm): the outer wall's width. */
  lineWidth: number;
  /** One layer's height (mm). */
  layerHeight: number;
  /** The longest bridge (mm) that prints without sagging. */
  bridgeLimit: number;
  /** A section this many times the biggest above it, or less, is a weak spot. */
  weakRatio: number;
}

/**
 * A P1S with a 0.4 mm nozzle (Standard or High Flow: both lay 0.42 mm outer walls) and PLA, as the slicing engine's
 * defaults: 45° overhangs, 0.42 mm outer walls, 0.2 mm layers. 10 mm bridges: Bambu's PLA prints them level with its
 * bridge settings; past that they droop more with every millimetre.
 */
export const P1S_RULES: PrintRules = { overhangAngle: 45, lineWidth: 0.42, layerHeight: 0.2, bridgeLimit: 10, weakRatio: 0.5 };

/** How close to the lowest point (mm) a triangle counts as lying on the plate: overhang.ts's ON_PLATE_MM. */
const ON_PLATE_MM = 0.01;
/** How far (mm) under a face material counts as holding it up, and over it as the part above. */
export const TOUCH_MM = 0.05;
/** How far from level (degrees) an underside may lean and still be bridged. */
export const BRIDGE_TILT = 5;
/** The step (mm) a bridge is walked in to find its ends: half a line. */
export const BRIDGE_STEP = 0.2;
/** Directions a bridge is tried in, spread over a half turn. */
export const BRIDGE_DIRECTIONS = 12;
/** Triangles past this many (all bodies) are not checked, so the view never stalls (about a second and a half at this many); a part's mesh is usually a few thousand. */
export const MAX_TRIANGLES = 50_000;

export type Point = [number, number, number];

/** The weakest spot: the layer's height, its section's area and the biggest above (mm²), the section's centre and outline. */
export interface WeakSpot {
  z: number;
  area: number;
  above: number;
  centre: Point;
  outline: [Point, Point][];
}

export interface PrintCheck {
  /** Triangles of the joined mesh in each finding, in order. */
  supports: number[];
  thin: number[];
  sag: number[];
  /** Their areas (mm²). */
  supportsArea: number;
  thinArea: number;
  sagArea: number;
  /** The longest bridge found that may sag (mm), 0 for none. */
  longestBridge: number;
  /** The thinnest wall found that is too thin (mm), null for none. */
  thinnest: number | null;
  weakest: WeakSpot | null;
  /** True when there were too many triangles to check (nothing is marked). */
  skipped: boolean;
}

const EMPTY: PrintCheck = { supports: [], thin: [], sag: [], supportsArea: 0, thinArea: 0, sagArea: 0, longestBridge: 0, thinnest: null, weakest: null, skipped: false };

/** Rules that are all numbers in range, else null (never a check on nonsense). */
export function rulesProblem(r: PrintRules): string | null {
  if (!(r.overhangAngle >= 0 && r.overhangAngle <= 90)) return "the overhang angle is not between 0° and 90°";
  if (!(r.lineWidth > 0 && r.lineWidth < 10)) return "the line width is not between 0 and 10 mm";
  if (!(r.layerHeight > 0 && r.layerHeight < 10)) return "the layer height is not between 0 and 10 mm";
  if (!(r.bridgeLimit > 0 && r.bridgeLimit < 1000)) return "the bridge limit is not between 0 and 1000 mm";
  if (!(r.weakRatio > 0 && r.weakRatio <= 1)) return "the weak-spot ratio is not between 0 and 1";
  return null;
}

// ---------------------------------------------------------------- solids

/** One body's triangles with a box tree over them, for rays and point-in-solid tests. */
export class Solid {
  readonly tri: Float64Array; // 9 numbers a triangle
  readonly count: number;
  private readonly order: Int32Array;
  // Node arrays while building: box lo/hi, and either children (left, right) or a leaf's [start, end) in `order`.
  private readonly lo: number[] = [];
  private readonly hi: number[] = [];
  private readonly left: number[] = [];
  private readonly right: number[] = [];
  private readonly start: number[] = [];
  private readonly end: number[] = [];
  // The same, packed once built.
  private nodes: { lo: Float64Array; hi: Float64Array; left: Int32Array; right: Int32Array; start: Int32Array; end: Int32Array } | null = null;
  private stack = new Int32Array(256);
  readonly box: { lo: Point; hi: Point };

  constructor(mesh: CheckMesh) {
    const n = Math.floor(mesh.indices.length / 3);
    this.tri = new Float64Array(9 * n);
    for (let t = 0; t < n; t++)
      for (let k = 0; k < 3; k++) {
        const i = mesh.indices[3 * t + k];
        for (let a = 0; a < 3; a++) this.tri[9 * t + 3 * k + a] = Number(mesh.positions[3 * i + a]);
      }
    this.count = n;
    this.order = new Int32Array(n);
    for (let t = 0; t < n; t++) this.order[t] = t;
    const centre = new Float64Array(3 * n);
    for (let t = 0; t < n; t++) for (let a = 0; a < 3; a++) centre[3 * t + a] = (this.tri[9 * t + a] + this.tri[9 * t + 3 + a] + this.tri[9 * t + 6 + a]) / 3;
    this.build(0, n, centre);
    this.nodes = { lo: Float64Array.from(this.lo), hi: Float64Array.from(this.hi), left: Int32Array.from(this.left), right: Int32Array.from(this.right), start: Int32Array.from(this.start), end: Int32Array.from(this.end) };
    this.box = n === 0 ? { lo: [0, 0, 0], hi: [0, 0, 0] } : { lo: [this.lo[0], this.lo[1], this.lo[2]], hi: [this.hi[0], this.hi[1], this.hi[2]] };
  }

  private build(s: number, e: number, centre: Float64Array): number {
    const node = this.left.length;
    this.left.push(-1);
    this.right.push(-1);
    this.start.push(s);
    this.end.push(e);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = this.order[i];
      for (let k = 0; k < 3; k++)
        for (let a = 0; a < 3; a++) {
          const v = this.tri[9 * t + 3 * k + a];
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
    }
    this.lo.push(...lo);
    this.hi.push(...hi);
    if (e - s <= 4) return node;
    let axis = 0;
    for (let a = 1; a < 3; a++) if (hi[a] - lo[a] > hi[axis] - lo[axis]) axis = a;
    const part = Array.from(this.order.subarray(s, e)).sort((p, q) => centre[3 * p + axis] - centre[3 * q + axis]);
    this.order.set(part, s);
    const m = (s + e) >> 1;
    const l = this.build(s, m, centre);
    const r = this.build(m, e, centre);
    this.left[node] = l;
    this.right[node] = r;
    return node;
  }

  /** Visits every triangle whose node box the ray o + t·d (t > 0) passes through. */
  private walk(o: Point, d: Point, visit: (t: number) => void) {
    if (this.count === 0) return;
    const { lo, hi, left, right, start, end } = this.nodes!;
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    const [ox, oy, oz] = o;
    const ix = 1 / d[0];
    const iy = 1 / d[1];
    const iz = 1 / d[2];
    while (top > 0) {
      const node = stack[--top];
      const b = 3 * node;
      // Slabs: where the ray is inside the box on each axis (an axis it runs along: all or nothing).
      let t0 = 0;
      let t1 = Infinity;
      let ta = (lo[b] - 1e-9 - ox) * ix;
      let tb = (hi[b] + 1e-9 - ox) * ix;
      if (Number.isNaN(ta) || Number.isNaN(tb)) {
        if (ox < lo[b] - 1e-9 || ox > hi[b] + 1e-9) continue;
      } else {
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      ta = (lo[b + 1] - 1e-9 - oy) * iy;
      tb = (hi[b + 1] + 1e-9 - oy) * iy;
      if (Number.isNaN(ta) || Number.isNaN(tb)) {
        if (oy < lo[b + 1] - 1e-9 || oy > hi[b + 1] + 1e-9) continue;
      } else {
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      ta = (lo[b + 2] - 1e-9 - oz) * iz;
      tb = (hi[b + 2] + 1e-9 - oz) * iz;
      if (Number.isNaN(ta) || Number.isNaN(tb)) {
        if (oz < lo[b + 2] - 1e-9 || oz > hi[b + 2] + 1e-9) continue;
      } else {
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t0 > t1) continue;
      if (left[node] < 0) for (let i = start[node]; i < end[node]; i++) visit(this.order[i]);
      else {
        stack[top++] = left[node];
        stack[top++] = right[node];
      }
    }
  }

  /** Where the ray o + t·d meets triangle `t` (Möller–Trumbore): t, or NaN for a miss. */
  hit(tri: number, o: Point, d: Point): number {
    const p = this.tri;
    const b = 9 * tri;
    const ax = p[b], ay = p[b + 1], az = p[b + 2];
    const e1x = p[b + 3] - ax, e1y = p[b + 4] - ay, e1z = p[b + 5] - az;
    const e2x = p[b + 6] - ax, e2y = p[b + 7] - ay, e2z = p[b + 8] - az;
    const qx = d[1] * e2z - d[2] * e2y, qy = d[2] * e2x - d[0] * e2z, qz = d[0] * e2y - d[1] * e2x;
    const det = e1x * qx + e1y * qy + e1z * qz;
    if (!(Math.abs(det) >= 1e-18)) return NaN;
    const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az;
    const u = (sx * qx + sy * qy + sz * qz) / det;
    if (u < 0 || u > 1) return NaN;
    const rx = sy * e1z - sz * e1y, ry = sz * e1x - sx * e1z, rz = sx * e1y - sy * e1x;
    const v = (d[0] * rx + d[1] * ry + d[2] * rz) / det;
    if (v < 0 || u + v > 1) return NaN;
    return (e2x * rx + e2y * ry + e2z * rz) / det;
  }

  /** The nearest t > 0 the ray o + t·d meets a triangle other than `skip`, with that triangle; Infinity for none. */
  first(o: Point, d: Point, skip = -1): { t: number; tri: number } {
    let best = { t: Infinity, tri: -1 };
    this.walk(o, d, (tri) => {
      if (tri === skip) return;
      const t = this.hit(tri, o, d);
      if (t > 0 && t < best.t) best = { t, tri };
    });
    return best;
  }

  /** Whether `o` is inside the solid: a ray in an odd direction crosses its surface an odd number of times. */
  inside(o: Point): boolean {
    const b = this.box;
    if (this.count === 0 || o[0] < b.lo[0] || o[0] > b.hi[0] || o[1] < b.lo[1] || o[1] > b.hi[1] || o[2] < b.lo[2] || o[2] > b.hi[2]) return false;
    let crossings = 0;
    this.walk(o, ODD, (tri) => {
      if (this.hit(tri, o, ODD) > 0) crossings++;
    });
    return crossings % 2 === 1;
  }

  /** Triangle `t`'s unit outward normal (from its winding) and area; area 0 when it has none or a corner is not a number. */
  normal(t: number): { n: Point; area: number } {
    const p = this.tri;
    const b = 9 * t;
    const u = [p[b + 3] - p[b], p[b + 4] - p[b + 1], p[b + 5] - p[b + 2]];
    const v = [p[b + 6] - p[b], p[b + 7] - p[b + 1], p[b + 8] - p[b + 2]];
    const c: Point = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(c[0], c[1], c[2]);
    if (!(len > 0) || !Number.isFinite(len)) return { n: [0, 0, 0], area: 0 };
    return { n: [c[0] / len, c[1] / len, c[2] / len], area: len / 2 };
  }

  corner(t: number, k: number): Point {
    const b = 9 * t + 3 * k;
    return [this.tri[b], this.tri[b + 1], this.tri[b + 2]];
  }
}

/** A direction no face of a CAD part lines up with, so a point-in-solid ray never runs along an edge or a face. */
const ODD: Point = (() => {
  const d = [0.5377, 0.4153, 0.7339];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
})();

const insideAny = (solids: readonly Solid[], p: Point) => solids.some((s) => s.inside(p));

// ---------------------------------------------------------------- the check

/**
 * The print check of these bodies' display meshes (in the order scene.ts joins them, so triangle indices are the
 * joined mesh's). Never throws: corners that are not numbers, triangles with no area and bad rules mark nothing.
 */
export function printCheck(meshes: readonly CheckMesh[], rules: PrintRules = P1S_RULES): PrintCheck {
  if (rulesProblem(rules) !== null) return { ...EMPTY };
  const total = meshes.reduce((n, m) => n + Math.floor(m.indices.length / 3), 0);
  if (total > MAX_TRIANGLES) return { ...EMPTY, skipped: true };
  const solids = meshes.map((m) => new Solid(m));
  let floor = Infinity;
  for (const s of solids) for (let i = 2; i < s.tri.length; i += 3) if (Number.isFinite(s.tri[i]) && s.tri[i] < floor) floor = s.tri[i];
  if (!Number.isFinite(floor)) return { ...EMPTY };
  const out: PrintCheck = { ...EMPTY, supports: [], thin: [], sag: [] };
  const lean = Math.sin((rules.overhangAngle * Math.PI) / 180);
  const level = Math.cos((BRIDGE_TILT * Math.PI) / 180);
  let offset = 0;
  solids.forEach((solid) => {
    for (let t = 0; t < solid.count; t++) {
      const { n, area } = solid.normal(t);
      if (area === 0) continue;
      const corners = [solid.corner(t, 0), solid.corner(t, 1), solid.corner(t, 2)];
      if (!corners.flat().every(Number.isFinite)) continue;
      const centre: Point = [0, 1, 2].map((a) => (corners[0][a] + corners[1][a] + corners[2][a]) / 3) as Point;
      // Too thin: from the middle of the face straight in, to where the solid ends.
      const thickness = wallThickness(solid, t, centre, n);
      const nxy = Math.hypot(n[0], n[1]);
      if (thickness !== null && (thickness < rules.lineWidth * nxy || thickness < rules.layerHeight * Math.abs(n[2]))) {
        out.thin.push(offset + t);
        out.thinArea += area;
        out.thinnest = out.thinnest === null ? thickness : Math.min(out.thinnest, thickness);
      }
      // Overhangs: leaning out past the angle, off the plate.
      if (!(-n[2] > lean)) continue;
      if (Math.max(corners[0][2], corners[1][2], corners[2][2]) - floor <= ON_PLATE_MM) continue;
      const samples = -n[2] >= level ? [centre, ...corners.map((c) => [0, 1, 2].map((a) => (c[a] + centre[a]) / 2) as Point)] : [centre];
      let worst: "fine" | "sag" | "supports" = "fine";
      let span = 0;
      for (const p of samples) {
        const verdict = -n[2] >= level ? bridged(solids, p, n, rules) : restsOn(solids, p) ? { kind: "fine" as const, span: 0 } : { kind: "supports" as const, span: 0 };
        if (verdict.kind === "supports") {
          worst = "supports";
          break;
        }
        if (verdict.kind === "sag") {
          worst = "sag";
          span = Math.max(span, verdict.span);
        }
      }
      if (worst === "fine") continue;
      // The part of the triangle that hangs (not resting on a body under it), for its area: a plate's underside over a
      // column is one face, the column's top under part of it.
      const hanging = area * hangingShare(solids, corners);
      if (worst === "supports") {
        out.supports.push(offset + t);
        out.supportsArea += hanging;
      } else {
        out.sag.push(offset + t);
        out.sagArea += hanging;
        out.longestBridge = Math.max(out.longestBridge, span);
      }
    }
    offset += solid.count;
  });
  out.weakest = weakestSpot(solids, floor, rules);
  return out;
}

/** How finely (mm) a hanging triangle is sampled for the share of it that rests on a body under it, and at most how many pieces a side. */
export const SHARE_SPACING = 0.5;
export const SHARE_MAX_SPLIT = 64;

/**
 * The share of a triangle with nothing under it: the triangle cut into n × n equal triangles (n from its longest side
 * and SHARE_SPACING, at most SHARE_MAX_SPLIT), each judged at its centroid. A first look at 4 × 4 that finds every
 * piece hanging answers 1 (a body under less than a sixteenth of it can be missed: the area then errs high).
 */
export function hangingShare(solids: readonly Solid[], c: Point[]): number {
  const longest = Math.max(...[0, 1, 2].map((k) => Math.hypot(...([0, 1, 2].map((a) => c[(k + 1) % 3][a] - c[k][a]) as Point))));
  const share = (n: number) => {
    let free = 0;
    const at = (u: number, v: number): Point => [0, 1, 2].map((a) => c[0][a] + u * (c[1][a] - c[0][a]) + v * (c[2][a] - c[0][a])) as Point;
    for (let i = 0; i < n; i++)
      for (let j = 0; i + j < n; j++) {
        if (!restsOn(solids, at((i + 1 / 3) / n, (j + 1 / 3) / n))) free++; // the piece pointing one way
        if (i + j < n - 1 && !restsOn(solids, at((i + 2 / 3) / n, (j + 2 / 3) / n))) free++; // and the other
      }
    return free / (n * n);
  };
  // A first look at 4 × 4 pieces: all hanging (the usual case, nothing under the face) needs no finer look.
  const n = Math.max(1, Math.min(SHARE_MAX_SPLIT, Math.ceil(longest / SHARE_SPACING)));
  const rough = share(Math.min(n, 4));
  return rough === 1 || n <= 4 ? rough : share(n);
}

/** Material just under `p` (TOUCH_MM down), in any body: the face rests on it. */
function restsOn(solids: readonly Solid[], p: Point): boolean {
  return insideAny(solids, [p[0], p[1], p[2] - TOUCH_MM]);
}

/**
 * The wall's thickness at `centre` of triangle `t`, measured straight in (against the outward normal) to where the
 * solid ends: the first triangle the ray meets that faces along it. Null where it meets none (a mesh that is not
 * closed), or meets one facing back (not a solid there).
 */
export function wallThickness(solid: Solid, t: number, centre: Point, n: Point): number | null {
  const d: Point = [-n[0], -n[1], -n[2]];
  const hit = solid.first(centre, d, t);
  if (!Number.isFinite(hit.t) || hit.tri < 0) return null;
  const m = solid.normal(hit.tri).n;
  if (!(m[0] * d[0] + m[1] * d[1] + m[2] * d[2] > 0)) return null;
  return hit.t;
}

/**
 * Whether a flat underside at `p` (outward normal `n`, within BRIDGE_TILT of straight down) is held up: resting on
 * material, bridged between two ends no more than the limit apart ("fine"), bridged further ("sag", with the span),
 * or not held at both ends in any direction within three times the limit ("supports"). Each direction is walked
 * both ways along the face's own plane in BRIDGE_STEP steps: an end is where material appears under the walk; the
 * walk is free (no end) where the part is no longer over it.
 */
function bridged(solids: readonly Solid[], p: Point, n: Point, rules: PrintRules): { kind: "fine" | "sag" | "supports"; span: number } {
  if (restsOn(solids, p)) return { kind: "fine", span: 0 };
  const reach = 3 * rules.bridgeLimit;
  let best = Infinity;
  for (let k = 0; k < BRIDGE_DIRECTIONS; k++) {
    const a = (Math.PI * k) / BRIDGE_DIRECTIONS + 0.0123;
    // Along the face's plane: horizontal direction (cos a, sin a), z rising as the plane does.
    const dz = -(n[0] * Math.cos(a) + n[1] * Math.sin(a)) / n[2];
    const dir: Point = [Math.cos(a), Math.sin(a), dz];
    // Only a span shorter than the best so far matters, so walk no further than that.
    const there = walk(solids, p, dir, Math.min(reach, best));
    if (there === null) continue;
    const back = walk(solids, p, [-dir[0], -dir[1], -dir[2]], Math.min(reach, best) - there);
    if (back === null) continue;
    best = Math.min(best, there + back);
    if (best <= rules.bridgeLimit) break; // bridged: no need for a shorter way
  }
  if (!Number.isFinite(best)) return { kind: "supports", span: 0 };
  return best > rules.bridgeLimit ? { kind: "sag", span: best } : { kind: "fine", span: best };
}

/** How far (horizontally, mm) from `p` along `dir` material first appears under the face, or null when the part ends first or it is further than `reach`. */
function walk(solids: readonly Solid[], p: Point, dir: Point, reach: number): number | null {
  for (let s = BRIDGE_STEP; s <= reach + 1e-9; s += BRIDGE_STEP) {
    const q: Point = [p[0] + s * dir[0], p[1] + s * dir[1], p[2] + s * dir[2]];
    if (restsOn(solids, q)) return s;
    if (!insideAny(solids, [q[0], q[1], q[2] + TOUCH_MM])) return null;
  }
  return null;
}

// ---------------------------------------------------------------- sections

/**
 * Each body's cross-section at height z as directed segments, the part on the left of each as you walk it (the
 * outline anticlockwise seen from above, holes clockwise), so the shoelace sum is the area. A triangle crossing z
 * gives the segment between its two crossing points, directed along ẑ × n.
 */
export function sectionSegments(solid: Solid, z: number, only?: readonly number[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  const count = only?.length ?? solid.count;
  for (let i = 0; i < count; i++) {
    const t = only ? only[i] : i;
    const c = [solid.corner(t, 0), solid.corner(t, 1), solid.corner(t, 2)];
    const cut: Point[] = [];
    for (let k = 0; k < 3; k++) {
      const a = c[k];
      const b = c[(k + 1) % 3];
      if (a[2] > z !== b[2] > z) {
        const f = (z - a[2]) / (b[2] - a[2]);
        cut.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), z]);
      }
    }
    if (cut.length !== 2) continue;
    const { n } = solid.normal(t);
    const [p, q] = cut;
    // Walking along ẑ × n = (−n_y, n_x) keeps the solid (behind n) on the left.
    if ((q[0] - p[0]) * -n[1] + (q[1] - p[1]) * n[0] >= 0) out.push([p, q]);
    else out.push([q, p]);
  }
  return out;
}

/** The area left of directed segments (shoelace), and their centroid. */
export function shoelace(segments: readonly [Point, Point][]): { area: number; centre: [number, number] } {
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (const [p, q] of segments) {
    const cross = p[0] * q[1] - q[0] * p[1];
    twice += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  const area = twice / 2;
  return { area, centre: area === 0 ? [0, 0] : [cx / (6 * area), cy / (6 * area)] };
}

/** How many segment pairs the union has tried to cut, counted so a test can see it skips the pairs far apart. */
export const unionWork = { pairs: 0 };

/**
 * The union of the bodies' sections at z: each body's segments, split where another body's cross them, kept where
 * their middle is not inside another body. Bodies not yet combined that overlap are counted once.
 */
function unionSection(solids: readonly Solid[], z: number, only?: readonly (readonly number[])[]): [Point, Point][] {
  const each = solids.map((s, i) => (s.box.lo[2] <= z && s.box.hi[2] >= z ? sectionSegments(s, z, only?.[i]) : []));
  const live = each.map((segs, i) => (segs.length > 0 ? i : -1)).filter((i) => i >= 0);
  if (live.length <= 1) return live.length === 1 ? each[live[0]] : [];
  // Each segment's box and each body's section box, so a segment skips the bodies and segments it cannot cut (a
  // piece of a big scene would otherwise try every segment of every other body: seconds a layer stack).
  const boxes = each.map((segs) => segs.map(([p, q]) => segmentBox(p, q)));
  const whole = boxes.map((bs) => {
    const b: Box2 = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of bs) [b[0], b[1], b[2], b[3]] = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])];
    return b;
  });
  const out: [Point, Point][] = [];
  for (const i of live)
    for (let n = 0; n < each[i].length; n++) {
      const [p, q] = each[i][n];
      const a = boxes[i][n];
      const cuts = [0, 1];
      for (const j of live) if (j !== i && !apart(a, whole[j])) {
        const segs = each[j];
        for (let m = 0; m < segs.length; m++)
          if (!apart(a, boxes[j][m])) {
            unionWork.pairs++;
            cuts.push(...crossAt(p, q, segs[m][0], segs[m][1]));
          }
      }
      cuts.sort((a, b) => a - b);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const [f0, f1] = [cuts[k], cuts[k + 1]];
        if (f1 - f0 < 1e-12) continue;
        const at = (f: number): Point => [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1]), z];
        // The piece is on the union's outline when just outside it (right of it) is in no other body, and is the
        // first body's copy when bodies share it (just inside it is in no body before this one).
        const mid = at((f0 + f1) / 2);
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const right: Point = [((q[1] - p[1]) / len) * NUDGE, (-(q[0] - p[0]) / len) * NUDGE, 0];
        const outside: Point = [mid[0] + right[0], mid[1] + right[1], z];
        const within: Point = [mid[0] - right[0], mid[1] - right[1], z];
        // A point beyond a body's (widened) section box is not in it at this height, so its ray is not cast.
        if (live.some((j) => j !== i && inBox(whole[j], outside) && solids[j].inside(outside))) continue;
        if (live.some((j) => j < i && inBox(whole[j], within) && solids[j].inside(within))) continue;
        out.push([at(f0), at(f1)]);
      }
    }
  return out;
}

/** The area (mm²) of the bodies' cross-section at height z, overlapping bodies counted once. */
export function sectionArea(meshes: readonly CheckMesh[], z: number): number {
  return shoelace(unionSection(meshes.map((m) => new Solid(m)), z)).area;
}

/** A segment's box in the plane, [lo x, lo y, hi x, hi y], widened by more than `crossAt` can ever reach past it. */
type Box2 = [number, number, number, number];

/**
 * Widened by 1e-6 mm and a thousandth of the segment's own span: a cut `crossAt` finds lies on both segments up to
 * rounding (far below that) or, along one line, within 1e-9 mm of it, so skipping the segments whose boxes are apart
 * changes no cut.
 */
function segmentBox(p: Point, q: Point): Box2 {
  const pad = 1e-6 + 1e-3 * (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]));
  return [Math.min(p[0], q[0]) - pad, Math.min(p[1], q[1]) - pad, Math.max(p[0], q[0]) + pad, Math.max(p[1], q[1]) + pad];
}

/** Whether a point is in (or on) a box. */
const inBox = (b: Box2, o: Point) => o[0] >= b[0] && o[0] <= b[2] && o[1] >= b[1] && o[1] <= b[3];

/** Whether two boxes are apart (not touching). */
const apart = (a: Box2, b: Box2) => a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3];

/** How far (mm) beside a section's piece the union looks for other bodies. */
const NUDGE = 1e-6;

/**
 * Where segment rs cuts segment pq, as fractions along pq strictly between its ends: where they cross, or, lying
 * along one line, where r and s fall on pq (so a shared stretch of outline becomes a piece of its own).
 */
function crossAt(p: Point, q: Point, r: Point, s: Point): number[] {
  const d = [q[0] - p[0], q[1] - p[1]];
  const e = [s[0] - r[0], s[1] - r[1]];
  const dd = d[0] * d[0] + d[1] * d[1];
  const w = [r[0] - p[0], r[1] - p[1]];
  const den = d[0] * e[1] - d[1] * e[0];
  const inside = (f: number) => f > 1e-12 && f < 1 - 1e-12;
  if (Math.abs(den) <= 1e-12 * dd) {
    if (Math.abs(w[0] * d[1] - w[1] * d[0]) > 1e-9 * Math.sqrt(dd)) return []; // parallel, apart
    const fr = (w[0] * d[0] + w[1] * d[1]) / dd;
    const fs = ((s[0] - p[0]) * d[0] + (s[1] - p[1]) * d[1]) / dd;
    return [fr, fs].filter(inside);
  }
  const f = (w[0] * e[1] - w[1] * e[0]) / den;
  const g = (w[0] * d[1] - w[1] * d[0]) / den;
  return inside(f) && g >= 0 && g <= 1 ? [f] : [];
}

/**
 * The weakest spot: at the middle of each layer (as the printer lays them from the plate up), the section's area;
 * a layer is a neck when its area is at most `weakRatio` times the smaller of the biggest section below it and the
 * biggest above it (more part on both sides, a narrow joint between), and the weakest is the neck where that ratio is
 * least (the lowest of equals). Null when there is no neck: a cone, a sphere, a rod lying down and a stem standing
 * on the plate have none (their narrowest layer is at an end, and a first layer's grip is not a neck).
 */
function weakestSpot(solids: readonly Solid[], floor: number, rules: PrintRules): WeakSpot | null {
  const top = Math.max(...solids.map((s) => (s.count > 0 ? s.box.hi[2] : -Infinity)));
  if (!(top > floor)) return null;
  const count = Math.min(5000, Math.floor((top - floor) / rules.layerHeight));
  // Each triangle listed under the layers its heights span, so a layer looks only at the triangles it can cut.
  const buckets = solids.map((s) => {
    const b: number[][] = Array.from({ length: count }, () => []);
    for (let t = 0; t < s.count; t++) {
      const zs = [s.tri[9 * t + 2], s.tri[9 * t + 5], s.tri[9 * t + 8]];
      const k0 = Math.max(0, Math.ceil((Math.min(...zs) - floor) / rules.layerHeight - 0.5));
      const k1 = Math.min(count - 1, Math.floor((Math.max(...zs) - floor) / rules.layerHeight - 0.5));
      for (let k = k0; k <= k1; k++) b[k].push(t);
    }
    return b;
  });
  const layers: { z: number; area: number; segments: [Point, Point][] }[] = [];
  for (let k = 0; k < count; k++) {
    const z = floor + (k + 0.5) * rules.layerHeight;
    const segments = unionSection(solids, z, buckets.map((b) => b[k]));
    layers.push({ z, area: shoelace(segments).area, segments });
  }
  const above: number[] = new Array(layers.length).fill(0);
  for (let k = layers.length - 2; k >= 0; k--) above[k] = Math.max(above[k + 1], layers[k + 1].area);
  let below = 0;
  let best: { k: number; ratio: number; above: number } | null = null;
  for (let k = 0; k < layers.length; k++) {
    const a = layers[k].area;
    const carried = Math.min(below, above[k]);
    if (a > 1e-9 && carried > 0) {
      const ratio = a / carried;
      if (ratio <= rules.weakRatio && (best === null || ratio < best.ratio - 1e-9)) best = { k, ratio, above: above[k] };
    }
    below = Math.max(below, a);
  }
  if (best === null) return null;
  const layer = layers[best.k];
  const { centre } = shoelace(layer.segments);
  return { z: layer.z, area: layer.area, above: best.above, centre: [centre[0], centre[1], layer.z], outline: layer.segments };
}
