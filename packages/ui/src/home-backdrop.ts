// The home screen's living background: circuit lines that grow, branch and fade across the page, motes drifting in
// depth, and the design you carry on with turning on a turntable under the words, as thin lines. It tells a calm story
// again and again: the design builds up from its floor like a print, flashes when whole, has ripples of light run through
// it and a face pulled out and back, then sinks away to be built again (with no project, a different simple part each
// time). Drawn on one 2D canvas, behind the screen's words (aria-hidden, no pointer), kept light on purpose: at most 30
// frames a second, at most about 1,500 segments, the pixel ratio capped at 1.5, nothing at all while the tab is hidden
// or the screen is closed. A computer that draws too slowly steps down to lighter versions (`QUALITY`; a weak one,
// `lowEnd`, starts on the lightest). Under prefers-reduced-motion it moves gently instead (Ben, 2026-11-16: with Windows'
// animations off a still picture read as broken): the design built and turning slowly, circuit lines and the simple parts
// fading softly in and out, the motes drifting slower and never large in front; no build, flash, ripple, extrude, spark,
// camera sway or drift in and out. Paused by the screen's button (`choose`), or once even the lightest proves too slow,
// it draws one still picture. The pure parts are tested by hand in test/home-backdrop.test.ts. Styles: the end of
// src/styles/home-screen.css.
import { formatLength, fromMm, type Unit } from "@fission/core";
import { currentUnit } from "./unit-choice.ts";

/** The cube shown when the project has no shape to show: 12 edges, as pairs of x y z points, half-size 1. */
export const NEUTRAL_SHAPE: readonly number[] = (() => {
  const c = (i: number) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
  const out: number[] = [];
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) out.push(...c(i), ...c(i | bit));
  return out;
})();

/**
 * The edges of a straight prism: the polygon `profile` (x, y corners in order) at heights `z0` and `z1`, joined at every
 * corner when `sides` (a round hole's polygon is not). Pure.
 */
export function prismEdges(profile: readonly (readonly [number, number])[], z0: number, z1: number, sides = true): number[] {
  const out: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[(i + 1) % profile.length];
    out.push(ax, ay, z0, bx, by, z0, ax, ay, z1, bx, by, z1);
    if (sides) out.push(ax, ay, z0, ax, ay, z1);
  }
  return out;
}

/** A regular polygon of `n` corners on a circle of `r`, the first on the x axis. Pure. */
const polygon = (n: number, r: number): [number, number][] => Array.from({ length: n }, (_, k) => [r * Math.cos((k / n) * Math.PI * 2), r * Math.sin((k / n) * Math.PI * 2)]);

/**
 * The simple parts built in turn, one each story, when there is no project to show: the cube; an L-bracket (its profile
 * standing in x and z, 1.4 deep in y); a hex nut (across corners 2.3, 0.7 tall, a round hole of 0.55 drawn as 16 sides);
 * and a stepped block (a 2.4 × 1.8 × 0.6 base with a 1.2 × 1.8 × 0.7 step on one end).
 */
export const NEUTRAL_SHAPES: readonly (readonly number[])[] = [
  NEUTRAL_SHAPE,
  (() => {
    const edges = prismEdges([[0, 0], [2.2, 0], [2.2, 0.5], [0.5, 0.5], [0.5, 1.8], [0, 1.8]], 0, 1.4);
    for (let i = 0; i < edges.length; i += 3) [edges[i + 1], edges[i + 2]] = [edges[i + 2], edges[i + 1]]; // stand it up: y ↔ z
    return edges;
  })(),
  [...prismEdges(polygon(6, 1.15), 0, 0.7), ...prismEdges(polygon(16, 0.55), 0, 0.7, false)],
  [...prismEdges([[0, 0], [2.4, 0], [2.4, 1.8], [0, 1.8]], 0, 0.6), ...prismEdges([[0, 0], [1.2, 0], [1.2, 1.8], [0, 1.8]], 0.6, 1.3)],
];

/** A body's surface: corner points (x y z) and triangles (three corner numbers each, counter-clockwise seen from outside). */
export interface Surface {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** Twice the signed area of a polygon (corners x, y in order): positive when they run counter-clockwise. Pure. */
const area2 = (poly: readonly (readonly [number, number])[]) => poly.reduce((a, [x, y], i) => a + x * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * y, 0);

/**
 * Triangles filling a simple polygon (its corners in order, either way round), as corner numbers, each counter-clockwise:
 * ear clipping (a corner whose triangle turns left and holds no other corner is cut off, until three are left). Pure.
 */
export function triangulate(poly: readonly (readonly [number, number])[]): [number, number, number][] {
  const order = poly.map((_, i) => i);
  if (area2(poly) < 0) order.reverse();
  const out: [number, number, number][] = [];
  const cross = (a: number, b: number, c: number) => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  const inside = (p: number, a: number, b: number, c: number) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  for (let guard = 0; order.length > 3 && guard < 10000; guard++) {
    let cut = false;
    for (let i = 0; i < order.length; i++) {
      const [a, b, c] = [order[(i + order.length - 1) % order.length], order[i], order[(i + 1) % order.length]];
      if (cross(a, b, c) <= 0) continue; // a reflex corner: not an ear
      if (order.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      order.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break; // not simple: what is left is not filled
  }
  if (order.length === 3) out.push([order[0], order[1], order[2]]);
  return out;
}

/** Where a ray from the origin at `angle` leaves a polygon around the origin (the nearest crossing of its sides). Pure. */
function rayOut(poly: readonly (readonly [number, number])[], angle: number): [number, number] {
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den; // along the ray
    const u = (ax * dy - ay * dx) / den; // along the side
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return [dx * best, dy * best];
}

/**
 * The surface of a straight prism: the polygon `profile` (x, y) from height `z0` to `z1`, its caps and walls wound
 * outwards. With `hole`, a round hole of that radius (16 sides) through the middle: the caps become rings (between the
 * profile and the hole, at every corner of either) and the hole's wall faces in. Pure.
 */
export function prismSurface(profile: readonly (readonly [number, number])[], z0: number, z1: number, hole = 0): Surface {
  const ccw = area2(profile) < 0 ? [...profile].reverse() : [...profile];
  const positions: number[] = [];
  const indices: number[] = [];
  const point = (x: number, y: number, z: number) => (positions.push(x, y, z), positions.length / 3 - 1);
  const tri = (a: number, b: number, c: number) => indices.push(a, b, c);
  const wall = (poly: readonly (readonly [number, number])[], outward: boolean) => {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const [a0, b0, a1, b1] = [point(ax, ay, z0), point(bx, by, z0), point(ax, ay, z1), point(bx, by, z1)];
      if (outward) (tri(a0, b0, b1), tri(a0, b1, a1));
      else (tri(a0, b1, b0), tri(a0, a1, b1));
    }
  };
  wall(ccw, true);
  if (hole > 0) {
    const ring = polygon(16, hole);
    wall(ring, false);
    const corner = (x: number, y: number) => (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
    const angles = [...new Set([...ccw, ...ring].map(([x, y]) => Math.round(corner(x, y) * 1e9) / 1e9))].sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      const [a, b] = [angles[i], angles[(i + 1) % angles.length] + (i + 1 === angles.length ? Math.PI * 2 : 0)];
      const [oa, ob] = [rayOut(ccw, a), rayOut(ccw, b)];
      const [ia, ib] = [rayOut(ring, a), rayOut(ring, b)];
      // Each sector of the ring: up at the top (counter-clockwise from above), down at the bottom.
      const top = [point(oa[0], oa[1], z1), point(ob[0], ob[1], z1), point(ib[0], ib[1], z1), point(ia[0], ia[1], z1)];
      const bottom = [point(oa[0], oa[1], z0), point(ob[0], ob[1], z0), point(ib[0], ib[1], z0), point(ia[0], ia[1], z0)];
      tri(top[0], top[1], top[2]);
      tri(top[0], top[2], top[3]);
      tri(bottom[0], bottom[2], bottom[1]);
      tri(bottom[0], bottom[3], bottom[2]);
    }
  } else {
    const top = ccw.map(([x, y]) => point(x, y, z1));
    const bottom = ccw.map(([x, y]) => point(x, y, z0));
    for (const [a, b, c] of triangulate(ccw)) {
      tri(top[a], top[b], top[c]);
      tri(bottom[a], bottom[c], bottom[b]);
    }
  }
  return { positions, indices };
}

/** Two surfaces as one. Pure. */
export function joinSurfaces(a: Surface, b: Surface): Surface {
  const shift = a.positions.length / 3;
  return { positions: [...Array.from(a.positions), ...Array.from(b.positions)], indices: [...Array.from(a.indices), ...Array.from(b.indices, (i) => i + shift)] };
}

/** The volume a closed surface holds (positive when wound outwards): the sum over triangles of a · (b × c) / 6. Pure. */
export function surfaceVolume(s: Surface): number {
  let v = 0;
  const p = s.positions;
  for (let t = 0; t + 2 < s.indices.length; t += 3) {
    const [a, b, c] = [s.indices[t] * 3, s.indices[t + 1] * 3, s.indices[t + 2] * 3];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** The simple parts' surfaces, in NEUTRAL_SHAPES' order. */
export const NEUTRAL_SURFACES: readonly Surface[] = [
  prismSurface([[-1, -1], [1, -1], [1, 1], [-1, 1]], -1, 1),
  (() => {
    const s = prismSurface([[0, 0], [2.2, 0], [2.2, 0.5], [0.5, 0.5], [0.5, 1.8], [0, 1.8]], 0, 1.4);
    const p = Array.from(s.positions);
    for (let i = 0; i < p.length; i += 3) [p[i + 1], p[i + 2]] = [p[i + 2], p[i + 1]]; // stand it up: y ↔ z, a mirror,
    const idx = Array.from(s.indices);
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]]; // so every triangle turns over
    return { positions: p, indices: idx };
  })(),
  prismSurface(polygon(6, 1.15), 0, 0.7, 0.55),
  joinSurfaces(prismSurface([[0, 0], [2.4, 0], [2.4, 1.8], [0, 1.8]], 0, 0.6), prismSurface([[0, 0], [1.2, 0], [1.2, 1.8], [0, 1.8]], 0.6, 1.3)),
];

/** The most triangles shaded; a bigger body is drawn as lines only. */
export const MAX_TRIANGLES = 4000;

/**
 * A surface moved and scaled exactly as `fitShape` moves and scales `lines` (so the two stay together), as numbers ready
 * to draw. Null when there are no lines to fit to, a corner number is out of range, a number is not finite, or there
 * are more than `max` triangles. Pure.
 */
export function fitSurface(surface: Surface | null | undefined, lines: ArrayLike<number> | null | undefined, max = MAX_TRIANGLES): { positions: Float32Array; indices: Uint32Array } | null {
  const box = boxOf(lines);
  if (!surface || !box) return null;
  const count = Math.floor(surface.positions.length / 3);
  const tris = Math.floor(surface.indices.length / 3);
  if (tris === 0 || tris > max) return null;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    const v = surface.positions[i];
    if (!Number.isFinite(v)) return null;
    positions[i] = (v - box.mid[i % 3]) / box.radius;
  }
  const indices = new Uint32Array(tris * 3);
  for (let i = 0; i < tris * 3; i++) {
    const n = surface.indices[i];
    if (!Number.isInteger(n) || n < 0 || n >= count) return null;
    indices[i] = n;
  }
  return { positions, indices };
}

/** The middle and half-size (the largest of the three) of the box round some lines; null when nothing can be fitted. Pure. */
function boxOf(lines: ArrayLike<number> | null | undefined): { mid: number[]; radius: number } | null {
  if (!lines) return null;
  const count = Math.floor(lines.length / 6);
  if (count === 0) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count * 6; i++) {
    const v = lines[i];
    if (!Number.isFinite(v)) return null;
    lo[i % 3] = Math.min(lo[i % 3], v);
    hi[i % 3] = Math.max(hi[i % 3], v);
  }
  const mid = lo.map((l, k) => (l + hi[k]) / 2);
  const radius = Math.max(...lo.map((l, k) => Math.max(hi[k] - mid[k], mid[k] - l)));
  return radius > 0 ? { mid, radius } : null;
}

/**
 * The part of a flat polygon (corners x y z) at or under the level `z`: each side is kept, cut where it crosses, or left
 * out (one plane's Sutherland–Hodgman step). Fewer than 3 corners: nothing under. Pure.
 */
export function clipUnder(poly: readonly (readonly number[])[], z: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = a[2] <= z;
    const bIn = b[2] <= z;
    if (aIn) out.push([...a]);
    if (aIn !== bIn) {
      const t = (z - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z]);
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * Where a body's triangles cross the level `z`: the slice a printer lays down there, as segments x0 y0 x1 y1 (all at
 * `z`). A corner exactly on the level counts as over it, so a face lying in the level gives nothing, and a side that
 * only touches the level gives no segment. Pure.
 */
export function sectionAt(positions: ArrayLike<number>, indices: ArrayLike<number>, z: number): number[] {
  const out: number[] = [];
  const cut = (a: number, b: number) => {
    const t = (z - positions[a * 3 + 2]) / (positions[b * 3 + 2] - positions[a * 3 + 2]);
    return [positions[a * 3] + (positions[b * 3] - positions[a * 3]) * t, positions[a * 3 + 1] + (positions[b * 3 + 1] - positions[a * 3 + 1]) * t];
  };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const v = [indices[i], indices[i + 1], indices[i + 2]];
    const under = v.map((k) => positions[k * 3 + 2] < z);
    const n = under.filter(Boolean).length;
    if (n === 0 || n === 3) continue;
    // The lone corner (alone on its side of the level) and the two sides leaving it, each crossing the level once.
    const lone = under.findIndex((u) => (n === 1 ? u : !u));
    const a = v[lone];
    const p = cut(a, v[(lone + 1) % 3]);
    const q = cut(a, v[(lone + 2) % 3]);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9) out.push(p[0], p[1], q[0], q[1]);
  }
  return out;
}

/**
 * Segments (x0 y0 x1 y1 each, in any order and either way round) joined end to end into paths (x y x y …), ends meeting
 * within `tol`; a closed loop ends where it started. Each segment is used once. Pure.
 */
export function chainLoops(segs: readonly number[], tol = 1e-6): number[][] {
  const n = Math.floor(segs.length / 4);
  const used = new Uint8Array(n);
  const near = (x: number, y: number, k: number, end: 0 | 1) => Math.abs(segs[k * 4 + end * 2] - x) <= tol && Math.abs(segs[k * 4 + end * 2 + 1] - y) <= tol;
  const paths: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const path = [segs[s * 4], segs[s * 4 + 1], segs[s * 4 + 2], segs[s * 4 + 3]];
    for (;;) {
      const x = path[path.length - 2];
      const y = path[path.length - 1];
      let next = -1;
      let flip = false;
      for (let k = 0; k < n && next < 0; k++) {
        if (used[k]) continue;
        if (near(x, y, k, 0)) next = k;
        else if (near(x, y, k, 1)) (next = k), (flip = true);
      }
      if (next < 0) break;
      used[next] = 1;
      path.push(segs[next * 4 + (flip ? 0 : 2)], segs[next * 4 + (flip ? 1 : 3)]);
    }
    paths.push(path);
  }
  return paths;
}

/** How long a path (x y x y …) is. Pure. */
export function pathLength(path: readonly number[]): number {
  let total = 0;
  for (let j = 2; j < path.length; j += 2) total += Math.hypot(path[j] - path[j - 2], path[j + 1] - path[j - 1]);
  return total;
}

/** The point `d` along a path (x y x y …), going round again past its end; null for a path of no length. Pure. */
export function alongPath(path: readonly number[], d: number): { x: number; y: number } | null {
  const total = pathLength(path);
  if (!(total > 0)) return null;
  let left = ((d % total) + total) % total;
  for (let j = 2; j < path.length; j += 2) {
    const dx = path[j] - path[j - 2];
    const dy = path[j + 1] - path[j - 1];
    const len = Math.hypot(dx, dy);
    if (left <= len && len > 0) return { x: path[j - 2] + (dx * left) / len, y: path[j - 1] + (dy * left) / len };
    left -= len;
  }
  return { x: path[path.length - 2], y: path[path.length - 1] };
}

/** How fast the nozzle's point runs round the slice, shape radii a second, and how long its bright trail is. */
export const NOZZLE_SPEED = 2.4;
export const NOZZLE_TRAIL = 0.5;
/** A slice with more segments than this is drawn without the nozzle (joining it into loops would cost too much a frame). */
export const MAX_SLICE_SEGMENTS = 600;
/** Under a simple part shown when there is no project. */
export const SAMPLE_WORDS = "Sample part";
/** A printer's usual layer height, mm: the build's caption counts layers of it. */
export const LAYER_MM = 0.2;
/** How many layer lines show on the walls while the design builds (a picture of layers, not every real one). */
export const LAYER_LINES = 18;

/**
 * The words under the design for what it is doing now: the layer being printed while it builds ("Printing preview ·
 * layer 62 of 100", counted in LAYER_MM layers of `heightMm`, or without numbers for a part of no size), the face being
 * pulled while it is extruded ("Extrude top face · +4.8 mm"), and nothing at rest, in a ripple or while it sinks. Pure.
 */
export function storyWords(stage: string, built: number, heightMm: number | null, pushMm: number | null, unit: Unit): string {
  if (stage === "building") {
    if (heightMm === null || !(heightMm > 0)) return "Printing preview";
    const layers = Math.max(1, Math.round(heightMm / LAYER_MM));
    const layer = Math.max(1, Math.min(layers, Math.ceil(built * layers - 1e-9)));
    return `Printing preview · layer ${layer} of ${layers}`;
  }
  if (stage === "extrude") return pushMm === null ? "Extrude top face" : `Extrude top face · ${pushWords(pushMm, unit)}`;
  return "";
}

/**
 * The faces nearest the viewer, on the screen, for telling which parts of the lines they hide: each triangle (screen x, y
 * and depth at its corners) is filed in the cells of a grid its box touches, so a point asks only its own cell's. Depths
 * are read across a triangle the way a camera sees them: 1 / (camera + depth) changes evenly across the screen, depth
 * itself does not (half-way across the screen between depths 0 and 1 is 7/15 with the camera at 7, not 1/2).
 */
export class Occluder {
  private readonly cells: number[][];
  private readonly tris: number[] = [];
  private readonly x0: number;
  private readonly y0: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly camera: number;
  /** A grid of `cols` × `rows` square cells `cell` pixels wide, its top left corner at (x0, y0), for a camera `camera` away. */
  constructor(x0: number, y0: number, cell: number, cols: number, rows: number, camera = CAMERA) {
    this.x0 = x0;
    this.y0 = y0;
    this.cell = cell > 0 ? cell : 1;
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.camera = camera;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  /** How many triangles were added. */
  get size(): number {
    return this.tris.length / 9;
  }
  /** A triangle facing the viewer: its corners on the screen with their depths. */
  add(ax: number, ay: number, ad: number, bx: number, by: number, bd: number, cx: number, cy: number, cd: number) {
    const t = this.tris.length / 9;
    const cam = this.camera;
    this.tris.push(ax, ay, 1 / (cam + ad), bx, by, 1 / (cam + bd), cx, cy, 1 / (cam + cd));
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((Math.max(ax, bx, cx) - this.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - this.y0) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((Math.max(ay, by, cy) - this.y0) / this.cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(t);
  }
  /** The depth of the nearest face covering the screen point (x, y), or Infinity where none does. */
  depthAt(x: number, y: number): number {
    const c = Math.floor((x - this.x0) / this.cell);
    const r = Math.floor((y - this.y0) / this.cell);
    if (!(c >= 0 && r >= 0 && c < this.cols && r < this.rows)) return Infinity;
    const T = this.tris;
    let nearest = 0; // the most 1 / (camera + depth) seen: nearer is more
    for (const t of this.cells[r * this.cols + c]) {
      const k = t * 9;
      const ax = T[k], ay = T[k + 1], aw = T[k + 2], bx = T[k + 3], by = T[k + 4], bw = T[k + 5], cx = T[k + 6], cy = T[k + 7], cw = T[k + 8];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      nearest = Math.max(nearest, u * aw + v * bw + w * cw);
    }
    return nearest > 0 ? 1 / nearest - this.camera : Infinity;
  }
  /** Whether a face covers the screen point (x, y) nearer the viewer than `depth` less `bias` (a line on a face is not hidden by it). */
  hides(x: number, y: number, depth: number, bias = OCCLUDE_BIAS): boolean {
    return this.depthAt(x, y) < depth - bias;
  }
}
/** How much nearer (shape radii) a face must be than a point on a line to hide it: a line on the face's own edge shows. */
export const OCCLUDE_BIAS = 0.03;

/**
 * The parts of the screen segment a–b (depths ad, bd) the faces leave showing and the parts they hide: sampled every
 * `step` pixels (2 to 33 samples), as runs [from, to, shown] along it (0..1), the changes half-way between samples. The
 * depth along it is read as the camera sees it (as in `Occluder`). Pure given the occluder.
 */
export function visibleRuns(ax: number, ay: number, ad: number, bx: number, by: number, bd: number, occ: Occluder, step = 8, camera = CAMERA): [number, number, boolean][] {
  const n = Math.max(1, Math.min(32, Math.ceil(Math.hypot(bx - ax, by - ay) / step)));
  const runs: [number, number, boolean][] = [];
  const aw = 1 / (camera + ad);
  const bw = 1 / (camera + bd);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const shown = !occ.hides(ax + (bx - ax) * t, ay + (by - ay) * t, 1 / (aw + (bw - aw) * t) - camera);
    const from = k === 0 ? 0 : (k - 0.5) / n;
    const last = runs[runs.length - 1];
    if (last && last[2] === shown) last[1] = k === n ? 1 : (k + 0.5) / n;
    else {
      if (last) last[1] = from;
      runs.push([from, k === n ? 1 : (k + 0.5) / n, shown]);
    }
  }
  return runs;
}

/** A surface's triangles gathered into flat faces (triangles on one plane), worked out once for each shape. */
export interface FaceGroups {
  /** Each flat face's triangles, as numbers of triangles in the surface's indices. */
  tris: number[][];
  /** Each flat face's outward normal, of length 1, in the shape's own frame. */
  normals: [number, number, number][];
  /** Each flat face's distance from the origin along its normal. */
  offsets: number[];
}

/**
 * The flat faces of a surface: triangles whose normals and planes agree to 1/1000 of the shape's size are one face, so a
 * face is painted in one piece (no seams across it) and sorted as one. Triangles with no area are left out. Pure.
 */
export function groupFaces(positions: ArrayLike<number>, indices: ArrayLike<number>): FaceGroups {
  const out: FaceGroups = { tris: [], normals: [], offsets: [] };
  const byPlane = new Map<string, number>();
  const p = positions;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-12)) continue; // no area (or a number that is not one)
    nx /= len;
    ny /= len;
    nz /= len;
    const d = nx * p[a] + ny * p[a + 1] + nz * p[a + 2];
    const key = `${Math.round(nx * 1000)},${Math.round(ny * 1000)},${Math.round(nz * 1000)},${Math.round(d * 1000)}`;
    let g = byPlane.get(key);
    if (g === undefined) {
      g = out.tris.length;
      byPlane.set(key, g);
      out.tris.push([]);
      out.normals.push([nx, ny, nz]);
      out.offsets.push(d);
    }
    out.tris[g].push(t / 3);
  }
  return out;
}

/** Where the light comes from, as seen by the camera (right, up, away): above, to the left and a little in front. Length 1. */
export const LIGHT: readonly [number, number, number] = [-0.48, 0.8, -0.36];

/**
 * How lit a face is, 0 (turned from the light) to 1 (facing it): its normal turned as `project` turns a point, against
 * LIGHT. The light stays with the camera, so the faces brighten and darken as the design turns. Pure.
 */
export function toneOf([x, y, z]: readonly number[], yaw: number, pitch = PITCH): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  const up = z * Math.cos(pitch) + ry * Math.sin(pitch);
  const away = ry * Math.cos(pitch) - z * Math.sin(pitch);
  return Math.max(0, Math.min(1, rx * LIGHT[0] + up * LIGHT[1] + away * LIGHT[2]));
}

/** Whether a triangle on the screen (canvas y down) faces the viewer: a surface wound counter-clockwise from outside shows clockwise. Pure. */
export const facesViewer = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0;

/** One flat face to paint: its number in the groups, whether it faces the viewer, its pieces on the screen (x y pairs) and its depth. */
export interface FacePaint {
  group: number;
  front: boolean;
  polys: number[][];
  depth: number;
}

/**
 * One frame's faces: every vertex put on the screen through `at`, the faces facing the viewer (and, with `backs`, the
 * inside of those facing away) cut at the build plane `plane` (null: whole), listed farthest first for painting over each
 * other, and an `Occluder` of the faces facing the viewer for hiding the lines behind them. Pure given `at`.
 */
export function faceFrame(
  groups: FaceGroups,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  at: (x: number, y: number, z: number) => { x: number; y: number; depth: number },
  plane: number | null,
  backs: boolean,
): { paint: FacePaint[]; occ: Occluder; whole: Occluder | null; front: number } {
  const n = Math.floor(positions.length / 3);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sd = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const q = at(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    sx[i] = q.x;
    sy[i] = q.y;
    sd[i] = q.depth;
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  if (!(x1 >= x0 && y1 >= y0)) (x0 = 0), (y0 = 0), (x1 = 1), (y1 = 1);
  // Cells of 12 px or more, at most about 1,600 of them.
  const cell = Math.max(12, Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 1600));
  const grid = () => new Occluder(x0, y0, cell, Math.ceil((x1 - x0 + 1) / cell), Math.ceil((y1 - y0 + 1) / cell));
  const occ = grid();
  // While the plane cuts the faces, the whole design's faces too, for the ghosts of what is still to be built.
  const whole = plane === null ? null : grid();
  const paint: FacePaint[] = [];
  let front = 0;
  for (let g = 0; g < groups.tris.length; g++) {
    const sides: [FacePaint | null, FacePaint | null] = [null, null]; // facing away, facing the viewer
    let depths = 0;
    let counted = 0;
    for (const t of groups.tris[g]) {
      const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
      if (!(ia < n && ib < n && ic < n)) continue;
      const facing = facesViewer(sx[ia], sy[ia], sx[ib], sy[ib], sx[ic], sy[ic]);
      if (facing && whole) whole.add(sx[ia], sy[ia], sd[ia], sx[ib], sy[ib], sd[ib], sx[ic], sy[ic], sd[ic]);
      if (!facing && !backs) continue;
      const za = positions[ia * 3 + 2], zb = positions[ib * 3 + 2], zc = positions[ic * 3 + 2];
      let poly: number[];
      let polyDepths: number[];
      if (plane === null || Math.max(za, zb, zc) <= plane) {
        poly = [sx[ia], sy[ia], sx[ib], sy[ib], sx[ic], sy[ic]];
        polyDepths = [sd[ia], sd[ib], sd[ic]];
      } else if (Math.min(za, zb, zc) >= plane) continue; // not built yet
      else {
        const cut = clipUnder([[positions[ia * 3], positions[ia * 3 + 1], za], [positions[ib * 3], positions[ib * 3 + 1], zb], [positions[ic * 3], positions[ic * 3 + 1], zc]], plane);
        if (cut.length < 3) continue;
        poly = [];
        polyDepths = [];
        for (const [x, y, z] of cut) {
          const q = at(x, y, z);
          poly.push(q.x, q.y);
          polyDepths.push(q.depth);
        }
      }
      const side = (sides[facing ? 1 : 0] ??= { group: g, front: facing, polys: [], depth: 0 });
      side.polys.push(poly);
      for (const d of polyDepths) depths += d / polyDepths.length;
      counted += 1;
      if (facing) for (let k = 2; k < polyDepths.length; k++) occ.add(poly[0], poly[1], polyDepths[0], poly[k * 2 - 2], poly[k * 2 - 1], polyDepths[k - 1], poly[k * 2], poly[k * 2 + 1], polyDepths[k]);
    }
    if (counted === 0) continue;
    for (const side of sides) {
      if (!side) continue;
      side.depth = depths / counted;
      paint.push(side);
      if (side.front) front += 1;
    }
  }
  paint.sort((a, b) => b.depth - a.depth);
  return { paint, occ, whole, front };
}

/**
 * How much of the accent is mixed into the page's colour for a face, by how lit it is (`tone`, 0..1): on a dark page a lit
 * face glows more blue, on a light one it stays nearly white and the shaded side takes the blue; the inside of a design
 * being built (a face turned away, seen through the open top) is the darkest. Pure.
 */
export function faceMix(tone: number, front: boolean, glow: boolean): number {
  const t = Math.max(0, Math.min(1, tone));
  if (!front) return glow ? 0.02 : 0.3;
  return glow ? 0.09 + 0.22 * t : 0.05 + 0.18 * (1 - t);
}

export const MAX_SEGMENTS = 1500;
export const FRAME_MS = 1000 / 30;
export const MAX_ALPHA = 0.5; // the brightest a line gets: words on top stay readable
export const BASE_ALPHA = 0.2;
/** Steps of brightness the shape's lines are batched into. */
export const BUCKETS = 10;
export const TURN_SECONDS = 40;
export const PITCH = 0.5;
export const CAMERA = 7; // far enough to read as a CAD part, near enough for depth

/**
 * The edges (pairs of x y z points) centred on their box's middle and scaled so the farthest point from it is 1, cut to
 * at most `max` segments by keeping every n-th. Null when there is nothing to draw: no segment, a bad number, or every
 * point the same.
 */
export function fitShape(lines: ArrayLike<number> | null | undefined, max = MAX_SEGMENTS): Float32Array | null {
  const box = boxOf(lines);
  if (!box || !lines) return null;
  const count = Math.floor(lines.length / 6);
  const step = Math.max(1, Math.ceil(count / max));
  const kept = Math.ceil(count / step);
  const out = new Float32Array(kept * 6);
  for (let n = 0; n < kept; n++) for (let j = 0; j < 6; j++) out[n * 6 + j] = (lines[n * step * 6 + j] - box.mid[j % 3]) / box.radius;
  return out;
}

export interface Projected {
  /** Screen offset from the middle, in units of the shape's radius (y down). */
  x: number;
  y: number;
  /** Nearer is smaller; 0 is the middle's distance. */
  depth: number;
  /** The height before turning, up is +1: what the pulse sweeps along. */
  height: number;
}

/** A point turned `yaw` about the up (z) axis, tipped towards the viewer by `pitch`, seen from `camera` away. Pure. */
export function project(x: number, y: number, z: number, yaw: number, pitch = PITCH, camera = CAMERA): Projected {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = x * c - y * s;
  const ry = x * s + y * c; // the depth axis before tipping
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Seen from above and in front: the camera is tipped `pitch` above the level, so a higher point comes nearer it and
  // the far side rises on the screen.
  const up = z * cp + ry * sp;
  const depth = ry * cp - z * sp;
  const k = camera / (camera + depth);
  return { x: rx * k, y: -up * k, depth, height: z };
}

/*
 * The story, told again every STORY_SECONDS, one calm thing at a time (as fractions of the story):
 *   0    .. 0.3   the design builds up from its floor like a print: a glowing plane rises, edges under it are drawn,
 *                 edges over it wait as faint ghosts, and a point of light marks every edge where the plane crosses it;
 *   0.3           built: the whole design flashes once;
 *   0.33 .. 0.49  a ripple of light spreads through the edges from one corner;
 *   0.5  .. 0.76  the top face is pulled out (or pushed in), held, and let back;
 *   0.78 .. 0.9   a second ripple, from the opposite corner;
 *   0.9  .. 1     the plane sinks back to the floor, and the design waits to be built again.
 */
export const STORY_SECONDS = 36;
export const BUILD_END = 0.3;
export const UNBUILD_AT = 0.9;
export const FLASH_AT = BUILD_END;
/**
 * Where the first story starts once the picture is revealed, as a fraction of the story (Ben, 2026-11-21: the build at
 * the start held every other motion back for 10.8 s, so it looked like a slow load). It opens on the design already
 * built, its last layers going down, a little before the flash: the picture's 0.9 s fade-in (home-screen.css) is about
 * over by the flash, and the first ripple follows a second later. Later stories still build from the floor, as before.
 */
export const OPEN_AT = FLASH_AT - 0.025;
/** Story time, seconds, at which a revealed picture starts: OPEN_AT moving fully; at 0 moving gently (nothing builds, and a simple part fades in at a story's start). Pure. */
export const openingAt = (gentle: boolean): number => (gentle ? 0 : OPEN_AT * STORY_SECONDS);
export const RIPPLES: readonly (readonly [number, number])[] = [
  [0.33, 0.49],
  [0.78, 0.9],
];
/** How far (shape radii) a ripple spreads in its time: across the fitted shape's whole box (2√3 ≈ 3.46) and a little more. */
export const RIPPLE_REACH = 3.6;
/** How bright a ghost (an edge not built yet, drawn dashed) is: under the built ones' BASE_ALPHA to MAX_ALPHA. */
export const GHOST = 0.1;

const smooth = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/** Where the story is at `seconds`: 0 at its start, going to 1 at its end, then round again. Pure. */
export const storyPhase = (seconds: number): number => (((seconds / STORY_SECONDS) % 1) + 1) % 1;

/** How much of the design's height is built at `seconds`: rising 0 → 1 (eased) to BUILD_END, 1, then sinking from UNBUILD_AT. Pure. */
export function buildAt(seconds: number): number {
  const p = storyPhase(seconds);
  return p < BUILD_END ? smooth(p / BUILD_END) : p < UNBUILD_AT ? 1 : 1 - smooth((p - UNBUILD_AT) / (1 - UNBUILD_AT));
}

/** The ripple going at `seconds`: which one (0 or 1) and its radius (shape radii from its corner), or null between them. Pure. */
export function rippleAt(seconds: number): { which: number; radius: number } | null {
  const p = storyPhase(seconds);
  for (let k = 0; k < RIPPLES.length; k++) {
    const [a, b] = RIPPLES[k];
    if (p >= a && p < b) return { which: k, radius: ((p - a) / (b - a)) * RIPPLE_REACH };
  }
  return null;
}

/**
 * The glow (0..1) of a built line at `seconds`, `height` of the way up the design (0 floor .. 1 top), `gap` shape radii from
 * the ripple's front (Infinity with none): a faint base; while building, a bright band just under the plane (the fresh
 * layers, about 0.12 of the height deep); a band about 0.3 wide where the ripple is; and a slow breathing. Pure.
 */
export function glowOf(seconds: number, height: number, gap: number, gentle = false): number {
  const built = buildAt(seconds);
  // Moving gently (reduced motion) nothing builds, so there are no fresh layers: only the base and the breathing.
  const fresh = !gentle && storyPhase(seconds) < BUILD_END && height <= built ? Math.exp(-(((built - height) / 0.12) ** 2)) : 0;
  const wave = Number.isFinite(gap) ? Math.exp(-((gap / 0.3) ** 2)) : 0;
  const breath = 0.9 + 0.1 * Math.sin(seconds * 0.9);
  return Math.min(1, (0.32 + 0.68 * Math.max(fresh, wave)) * breath);
}

/**
 * The whole design's extra brightness (0..0.6) the moment it is built (FLASH_AT of the story): a short flash fading over
 * about a second either side. Pure.
 */
export function flash(seconds: number): number {
  const d = (storyPhase(seconds) - FLASH_AT) / 0.025;
  return 0.6 * Math.exp(-d * d);
}

/** The corner of a fitted shape farthest along `dir`: where a ripple starts. [0, 0, 0] for no shape. Pure. */
export function cornerOf(shape: ArrayLike<number>, dir: readonly number[]): [number, number, number] {
  let best: [number, number, number] = [0, 0, 0];
  let most = -Infinity;
  for (let i = 0; i + 2 < shape.length; i += 3) {
    const d = shape[i] * dir[0] + shape[i + 1] * dir[1] + shape[i + 2] * dir[2];
    if (d > most) {
      most = d;
      best = [shape[i], shape[i + 1], shape[i + 2]];
    }
  }
  return best;
}

/**
 * How far the segment a–b is from a sphere of `radius` about `c` (0 when the sphere's surface crosses it), and where along
 * it (0..1) the sphere crosses, nearest a first (null when it doesn't). Pure.
 */
export function sphereGap(a: readonly number[], b: readonly number[], c: readonly number[], radius: number): { gap: number; cross: number | null } {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const f = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const da = Math.hypot(f[0], f[1], f[2]);
  const db = Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]);
  // The nearest point of the segment to c: the distances along it run down to that and up again.
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const tn = dd > 0 ? Math.max(0, Math.min(1, -(f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) / dd)) : 0;
  const dn = Math.hypot(f[0] + d[0] * tn, f[1] + d[1] * tn, f[2] + d[2] * tn);
  const lo = dn;
  const hi = Math.max(da, db);
  if (radius < lo) return { gap: lo - radius, cross: null };
  if (radius > hi) return { gap: radius - hi, cross: null };
  // |f + t·d| = radius: dd·t² + 2(f·d)t + (|f|² − r²) = 0; the root in 0..1 nearest a.
  const B = 2 * (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]);
  const C = da * da - radius * radius;
  const disc = Math.max(0, B * B - 4 * dd * C);
  const roots = dd > 0 ? [(-B - Math.sqrt(disc)) / (2 * dd), (-B + Math.sqrt(disc)) / (2 * dd)].filter((t) => t >= -1e-9 && t <= 1 + 1e-9) : [];
  return { gap: 0, cross: roots.length > 0 ? Math.max(0, Math.min(1, roots[0])) : null };
}

/** The lowest height of a fitted shape (its z), -1 for none. Pure. */
export function floorOf(shape: ArrayLike<number>): number {
  let lo = Infinity;
  for (let i = 2; i < shape.length; i += 3) lo = Math.min(lo, shape[i]);
  return Number.isFinite(lo) ? lo : -1;
}

/** The red, green and blue (0..255) of a #rgb, #rrggbb or rgb() colour; null when it can't be read. Pure. */
export function rgbOf(colour: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = colour.match(/[\d.]+/g);
  return /^\s*rgba?\(/.test(colour) && m && m.length >= 3 ? (m.slice(0, 3).map(Number) as [number, number, number]) : null;
}

/** Relative luminance (0..1, WCAG) of a colour `rgbOf` reads; 0 when it can't be read. Pure. */
export function luminance(colour: string): number {
  const rgb = rgbOf(colour);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The size of the edges' box along x, y and z (in their own unit), or null when `fitShape` would draw nothing. Pure. */
export function extentOf(lines: ArrayLike<number> | null | undefined): [number, number, number] | null {
  if (!fitShape(lines, 1) || !lines) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < Math.floor(lines.length / 6) * 6; i++) {
    lo[i % 3] = Math.min(lo[i % 3], lines[i]);
    hi[i % 3] = Math.max(hi[i % 3], lines[i]);
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/** The size label under the turntable: "61.4 × 56.9 × 22 mm" (millimetres in, shown in `unit`). Pure. */
export function sizeWords([x, y, z]: readonly number[], unit: Unit): string {
  const n = (mm: number) => formatLength(mm, unit).split(" ")[0];
  return `${n(x)} × ${n(y)} × ${formatLength(z, unit)}`;
}

export interface Placement {
  cx: number;
  cy: number;
  /** Pixels for the shape's radius of 1. */
  scale: number;
}

/**
 * Where the turning shape goes in a `w` × `h` window whose words end `top` pixels down: centred across, and in the room
 * under the words when it fits there. The picture reaches ABOVE radii over its middle (the top face pulled out with its
 * handle) and BELOW radii under it (the turntable's front), then the size label's LABEL_PX: (ABOVE + BELOW) radii and
 * LABEL_PX in all, with 16 px kept above and below. It is never smaller than MIN_SCALE of the window's short side (it then
 * stands at the window's foot, partly under the words) nor larger than MAX_SCALE. Pure.
 */
export function placeShape(w: number, h: number, top: number, extent: Reach = { above: ABOVE, below: BELOW }): Placement {
  const short = Math.min(w, h);
  const free = h - Math.max(0, top);
  const reach = extent.above + extent.below;
  const scale = Math.max(MIN_SCALE * short, Math.min(MAX_SCALE * short, (free - LABEL_PX - 32) / reach));
  const block = reach * scale + LABEL_PX;
  const blockTop = free - 32 >= block ? h - free + 16 + (free - 32 - block) / 2 : h - block - 16;
  return { cx: w / 2, cy: blockTop + extent.above * scale, scale };
}
export const MIN_SCALE = 0.24;
export const MAX_SCALE = 0.4;
/** The reach for a shape nobody measured: the neutral cube's, rounded up. */
export const ABOVE = 1.75;
export const BELOW = 1.6;
export const LABEL_PX = 28;

/** How far a picture reaches above and below its middle, in shape radii. */
export interface Reach {
  above: number;
  below: number;
}

/**
 * How far points reach above and below the picture's middle whichever way the shape has turned, at each of `pitches`.
 * Each point is given by its height `z` and its distance `rho` from the up axis. Turned to the far side (its depth
 * rho·cos p − z·sin p), a point is drawn highest: up = CAMERA·(z·cos p + rho·sin p) / (CAMERA + rho·cos p − z·sin p);
 * turned nearest, lowest: CAMERA·(z·cos p − rho·sin p) / (CAMERA − rho·cos p − z·sin p). (Up rises steadily as the point
 * turns from nearest to farthest while CAMERA·sin p is more than z, so these two are the ends.) Pure.
 */
export function reachOf(points: readonly { z: number; rho: number }[], pitches: readonly number[] = [PITCH - SWAY, PITCH, PITCH + SWAY]): Reach {
  let above = -Infinity;
  let below = -Infinity;
  for (const p of pitches) {
    const c = Math.cos(p);
    const s = Math.sin(p);
    for (const { z, rho } of points) {
      above = Math.max(above, (CAMERA * (z * c + rho * s)) / (CAMERA + rho * c - z * s));
      below = Math.max(below, -(CAMERA * (z * c - rho * s)) / (CAMERA - rho * c - z * s));
    }
  }
  return Number.isFinite(above) && Number.isFinite(below) ? { above, below } : { above: ABOVE, below: BELOW };
}
/** How far the camera rises and sinks, radians either way of PITCH. */
export const SWAY = 0.07;

/** The camera's slow drift back and in again: the picture's size, 1 (nearest) down to 1 − DOLLY and back every DOLLY_SECONDS. Pure. */
export const dolly = (seconds: number): number => 1 - DOLLY * (0.5 - 0.5 * Math.cos((seconds / DOLLY_SECONDS) * Math.PI * 2));
export const DOLLY = 0.06;
export const DOLLY_SECONDS = 53;

/** Where the ends of a fitted shape's segments meet: for each end (2 × segment + 0 or 1), the other segments' ends at the same point. Pure. */
export function linksOf(shape: ArrayLike<number>): number[][] {
  const count = Math.floor(shape.length / 6);
  const key = (e: number) => {
    const at = Math.floor(e / 2) * 6 + (e % 2) * 3;
    return `${Math.round(shape[at] * 1e4)},${Math.round(shape[at + 1] * 1e4)},${Math.round(shape[at + 2] * 1e4)}`;
  };
  const byPoint = new Map<string, number[]>();
  for (let e = 0; e < count * 2; e++) {
    const k = key(e);
    const list = byPoint.get(k) ?? [];
    list.push(e);
    byPoint.set(k, list);
  }
  return Array.from({ length: count * 2 }, (_, e) => (byPoint.get(key(e)) ?? []).filter((o) => Math.floor(o / 2) !== Math.floor(e / 2)));
}

/** A spark of light running along the shape's edges: on segment `seg`, entered at end `from` (0 or 1), `t` of the way along. */
export interface Spark {
  seg: number;
  from: 0 | 1;
  t: number;
  /** Which of the shades it wears. */
  shade: number;
}

/** Shape units (radii) a spark runs in a second: calm, about a box's edge in two seconds. */
export const SPARK_SPEED = 0.55;

/**
 * A spark `dt` seconds on: it runs SPARK_SPEED along its segment; at the far end it carries on into another segment that
 * meets there (never straight back, unless there is no other), chosen by `rnd`; at a loose end it starts again on a
 * segment `rnd` picks. Pure apart from `rnd`.
 */
export function stepSpark(spark: Spark, dt: number, shape: ArrayLike<number>, links: readonly number[][], rnd: () => number): Spark {
  const count = Math.floor(shape.length / 6);
  if (count === 0) return spark;
  let { seg, from, t } = spark;
  let travel = SPARK_SPEED * Math.max(0, dt);
  for (let guard = 0; guard < 64 && travel > 0; guard++) {
    const i = seg * 6;
    const length = Math.hypot(shape[i + 3] - shape[i], shape[i + 4] - shape[i + 1], shape[i + 5] - shape[i + 2]) || 1e-6;
    const left = (1 - t) * length;
    if (travel < left) {
      t += travel / length;
      travel = 0;
      break;
    }
    travel -= left;
    const end = seg * 2 + (1 - from);
    const next = links[end] ?? [];
    if (next.length === 0) {
      seg = Math.min(count - 1, Math.floor(rnd() * count));
      from = rnd() < 0.5 ? 0 : 1;
    } else {
      const o = next[Math.min(next.length - 1, Math.floor(rnd() * next.length))];
      seg = Math.floor(o / 2);
      from = (o % 2) as 0 | 1;
    }
    t = 0;
  }
  return { seg, from, t, shade: spark.shade };
}

/** The segments of a fitted shape's top face: both ends at its greatest height (within 1e-3). Fewer than 3: none. Pure. */
export function topFace(shape: ArrayLike<number>): number[] {
  let hi = -Infinity;
  for (let i = 2; i < shape.length; i += 3) hi = Math.max(hi, shape[i]);
  const out: number[] = [];
  for (let s = 0; s * 6 + 5 < shape.length; s++) if (Math.abs(shape[s * 6 + 2] - hi) < 1e-3 && Math.abs(shape[s * 6 + 5] - hi) < 1e-3) out.push(s);
  return out.length >= 3 ? out : [];
}

export const EXTRUDE_OUT = 0.24;
export const EXTRUDE_IN = -0.14;

/**
 * How far the top face is pulled out (+) or pushed in (−), in shape radii, at `seconds`: still until 0.5 of the story,
 * eased out to 0.58, held to 0.68, eased back by 0.76, still again (never while the design is building). Even stories pull
 * out by EXTRUDE_OUT, odd ones push in by EXTRUDE_IN. Pure.
 */
export function extrudeAmount(seconds: number): number {
  const story = ((Math.floor(seconds / STORY_SECONDS) % 2) + 2) % 2;
  const p = storyPhase(seconds);
  const k = p < 0.5 ? 0 : p < 0.58 ? smooth((p - 0.5) / 0.08) : p < 0.68 ? 1 : p < 0.76 ? smooth(1 - (p - 0.68) / 0.08) : 0;
  return k * (story === 0 ? EXTRUDE_OUT : EXTRUDE_IN);
}

/**
 * Moving gently (reduced motion): seconds a turn of the turntable (6° a second, against TURN_SECONDS' 9°), and how fast
 * the motes drift as a share of their normal speed.
 */
export const GENTLE_TURN = 60;
export const GENTLE_DRIFT = 0.5;
/**
 * Moving gently, the most frames a second (a slow turn needs fewer: 6° a second is 0.3° a frame at 20), so it draws a third
 * fewer than the full picture's 30 and is the lighter one to suggest on a computer it slows down.
 */
export const GENTLE_FPS = 20;
/** Moving gently, the share of a story at either end over which a simple part fades out, and the next one in. */
export const PART_FADE = 0.05;

/**
 * How much of a simple part shows at `seconds` when moving gently (it is never built, so it fades instead): 0 at a
 * story's turn, eased up to 1 over PART_FADE of the story, and back down to 0 over the story's last PART_FADE. Pure.
 */
export function partFade(seconds: number): number {
  const p = storyPhase(seconds);
  return smooth(Math.min(p, 1 - p) / PART_FADE);
}

/**
 * The moment a paused picture keeps, when it is paused at `seconds`: that one, as on the screen, unless the design hardly
 * shows in it (`gentle` with the simple parts: one fading at the story's turn; otherwise: under a quarter built), then
 * STILL_AT, the design whole. With `project` and `gentle` the design always shows (it is never built or faded). Pure.
 */
export function pauseAt(seconds: number, gentle: boolean, project: boolean): number {
  const shows = gentle ? project || partFade(seconds) >= 1 : buildAt(seconds) >= 0.25;
  return shows ? seconds : STILL_AT;
}

/** Hue (0..360), saturation and lightness (0..1) of a red, green, blue (0..255). Pure. */
export function hslOf([r, g, b]: readonly number[]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

/** The CSS colour for a hue, saturation and lightness. Pure. */
export const hslText = ([h, s, l]: readonly number[]): string => `hsl(${(((h % 360) + 360) % 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;

/**
 * Four blues from the accent for the sparks and the scan: the accent itself, one turned 16° towards cyan, one turned 14°
 * towards indigo, and one lighter (on a dark page) or deeper (on a light one), so the words keep their contrast. Pure.
 */
export function shadesOf(rgb: readonly number[], light: boolean): string[] {
  const [h, s, l] = hslOf(rgb);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return [hslText([h, s, l]), hslText([h - 16, s, clamp(l + (light ? -0.06 : 0.08))]), hslText([h + 14, s, clamp(l + (light ? -0.1 : -0.02))]), hslText([h, s, clamp(l + (light ? -0.18 : 0.2))])];
}

/** The extrude handle's distance: signed, one decimal in the person's unit ("+7.4 mm", "−0.2 in"). Pure. */
export function pushWords(mm: number, unit: Unit): string {
  const v = Math.round(Math.abs(fromMm(mm, unit)) * 10) / 10;
  return `${mm < 0 ? "−" : "+"}${v.toFixed(1)} ${unit}`;
}

/** How bright a line is for its depth (−1 nearest .. +1 farthest): 1 at the front down to 0.45 at the back. Pure. */
export function depthCue(depth: number): number {
  return 1 - 0.55 * Math.max(0, Math.min(1, (depth + 1) / 2));
}

/** Small seeded generator (mulberry32): the same seed gives the same lines. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A side line forking off a circuit line: it starts growing once the main line has grown `start` pixels. */
export interface Branch {
  start: number;
  /** Its points relative to the main line's start, from the fork on. */
  points: { x: number; y: number }[];
  length: number;
}

export interface Trace {
  /** Corner points relative to the line's start; every step is along an axis or a 45° diagonal. */
  points: { x: number; y: number }[];
  /** Where it starts on the page. */
  x: number;
  y: number;
  /** The main line's length in pixels. */
  length: number;
  /** Side lines forking off at its corners (0 to 2), each also along axes and diagonals. */
  branches: Branch[];
  /** How far growth reaches in all, main line or branch: the pixels it takes to grow whole. */
  reach: number;
}

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // round the compass in 45° steps

/**
 * A run of `turns` steps from `from` heading `heading` (an index into DIRS): each turns 45° or 90° from the one before
 * (the first by `first` eighths of a turn when given), never straight on or back.
 */
function walk(rnd: () => number, from: { x: number; y: number }, heading: number, turns: number, shortest: number, spread: number, first?: number) {
  const points = [from];
  let length = 0;
  let last = heading;
  for (let t = 0; t < turns; t++) {
    const turn = t === 0 && first !== undefined ? first : (rnd() < 0.5 ? 1 : -1) * (rnd() < 0.4 ? 2 : 1);
    last = (last + turn + 8) % 8;
    const run = shortest + rnd() * spread;
    const p = points[points.length - 1];
    const [dx, dy] = DIRS[last];
    const norm = Math.hypot(dx, dy);
    points.push({ x: p.x + (dx / norm) * run, y: p.y + (dy / norm) * run });
    length += run;
  }
  return { points, length };
}

/** `count` circuit lines for a `w` × `h` window: where each starts, its corners and its branches. Pure and seeded. */
export function makeTraces(seed: number, count: number, w: number, h: number): Trace[] {
  const rnd = seeded(seed);
  const out: Trace[] = [];
  for (let i = 0; i < count; i++) {
    const main = walk(rnd, { x: 0, y: 0 }, Math.floor(rnd() * 8), 2 + Math.floor(rnd() * 3), 50, 170);
    const branches: Branch[] = [];
    let reach = main.length;
    let along = 0;
    for (let c = 1; c < main.points.length - 1; c++) {
      const a = main.points[c - 1];
      const b = main.points[c];
      along += Math.hypot(b.x - a.x, b.y - a.y);
      if (branches.length >= 2 || rnd() > 0.55) continue;
      // Forks off at this corner, 45° to the other side of the way the main line came in from the way it goes on.
      const heading = (p: { x: number; y: number }, q: { x: number; y: number }) => (Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4)) + 8) % 8;
      const into = heading(a, b);
      const turned = (heading(b, main.points[c + 1]) - into + 8) % 8; // 1 or 2: the main line turned clockwise on screen
      const side = walk(rnd, b, into, 1 + Math.floor(rnd() * 2), 30, 90, turned <= 4 ? -1 : 1);
      branches.push({ start: along, points: side.points, length: side.length });
      reach = Math.max(reach, along + side.length);
    }
    out.push({ points: main.points, x: rnd() * w, y: rnd() * h, length: main.length, branches, reach });
  }
  return out;
}

/** Pixels a second a circuit line grows at, how long it stays whole, and how long it takes to fade. */
export const GROW_SPEED = 46;
export const GROW_HOLD = 5;
export const GROW_FADE = 3;

/** How long one circuit line lives: growing at GROW_SPEED to its full `length`, held, then faded. Pure. */
export const growthLife = (length: number): number => length / GROW_SPEED + GROW_HOLD + GROW_FADE;

/**
 * A circuit line `age` seconds after it began: how much of its `length` has grown (pixels) and how bright it is (1 while
 * growing and held, falling to 0 over GROW_FADE, and fading in over its first half second). Pure.
 */
export function growthAt(age: number, length: number): { grown: number; alpha: number } {
  const growing = length / GROW_SPEED;
  const grown = Math.max(0, Math.min(length, age * GROW_SPEED));
  const fadeIn = Math.min(1, Math.max(0, age / 0.5));
  const fadeOut = age <= growing + GROW_HOLD ? 1 : Math.max(0, 1 - (age - growing - GROW_HOLD) / GROW_FADE);
  return { grown, alpha: fadeIn * fadeOut };
}

/** Moving gently, the seconds a circuit line takes to fade in whole. */
export const GENTLE_FADE_IN = 2;

/**
 * A circuit line `age` seconds after it began, moving gently (reduced motion): there all at once (`grown` its whole
 * `length`, so no bright tip runs along it), fading in over GENTLE_FADE_IN, held, and fading out as `growthAt`'s does, in the
 * same life (`growthLife`): the time it would have spent growing it is held whole instead. Pure.
 */
export function gentleGrowthAt(age: number, length: number): { grown: number; alpha: number } {
  const fadeIn = Math.min(1, Math.max(0, age / GENTLE_FADE_IN));
  const held = length / GROW_SPEED + GROW_HOLD;
  const fadeOut = age <= held ? 1 : Math.max(0, 1 - (age - held) / GROW_FADE);
  return { grown: length, alpha: fadeIn * fadeOut };
}

/** The first `length` pixels of a polyline (its points relative to its start), the last piece cut part way. Pure. */
export function grownPath(points: readonly { x: number; y: number }[], length: number): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const out = [points[0]];
  let left = Math.max(0, length);
  for (let i = 1; i < points.length && left > 0; i++) {
    const a = points[i - 1];
    const b = points[i];
    const piece = Math.hypot(b.x - a.x, b.y - a.y);
    if (piece <= left) {
      out.push(b);
      left -= piece;
    } else {
      const t = left / piece;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      left = 0;
    }
  }
  return out;
}

/** A mote of dust floating round the shape: where it starts (round the up axis, in shape radii), how fast it rises. */
export interface Mote {
  angle: number;
  radius: number;
  z: number;
  rise: number;
  /** Turning of its own round the axis, radians a second (slow, either way). */
  spin: number;
  shade: number;
}
export const MOTE_LOW = -1.5;
export const MOTE_HIGH = 2.3;

/** `count` motes in a ring round the shape (0.5 to 2.8 radii out, MOTE_LOW to MOTE_HIGH high). Pure and seeded. */
export function makeMotes(seed: number, count: number): Mote[] {
  const rnd = seeded(seed);
  return Array.from({ length: count }, (_, k) => ({
    angle: rnd() * Math.PI * 2,
    radius: 0.5 + Math.sqrt(rnd()) * 2.3,
    z: MOTE_LOW + rnd() * (MOTE_HIGH - MOTE_LOW),
    rise: 0.02 + rnd() * 0.05,
    spin: (rnd() - 0.5) * 0.06,
    shade: k % 4,
  }));
}

/**
 * Where a mote is `seconds` on (x, y, z in shape radii) and how much it shows (0..1): it rises and wraps from the top back
 * to the bottom, fading out over the last 0.3 at either end so it never pops. Pure.
 */
export function moteAt(m: Mote, seconds: number): { x: number; y: number; z: number; show: number } {
  const span = MOTE_HIGH - MOTE_LOW;
  const z = MOTE_LOW + ((((m.z - MOTE_LOW + m.rise * seconds) % span) + span) % span);
  const a = m.angle + m.spin * seconds;
  const edge = Math.min(z - MOTE_LOW, MOTE_HIGH - z);
  return { x: Math.cos(a) * m.radius, y: Math.sin(a) * m.radius, z, show: Math.max(0, Math.min(1, edge / 0.3)) };
}

export interface Machine {
  cores?: number;
  memory?: number; // GB, navigator.deviceMemory
  saveData?: boolean;
}

/**
 * A machine that starts on the lightest moving picture: 2 cores or fewer, 2 GB or less, or data saving on. Unknown counts
 * as fine. Pure.
 */
export function lowEnd(m: Machine): boolean {
  return (m.cores !== undefined && m.cores <= 2) || (m.memory !== undefined && m.memory <= 2) || m.saveData === true;
}

/**
 * The moving picture's versions, richest first. A computer that draws too slowly steps down to the next (fewer pixels,
 * motes and circuit lines, no soft halos, fewer frames a second) before the picture is ever stopped.
 */
export const QUALITY: readonly { ratio: number; motes: number; lines: number; fps: number; halo: boolean }[] = [
  { ratio: 1.5, motes: 1, lines: 1, fps: 30, halo: true },
  { ratio: 1, motes: 0.5, lines: 0.6, fps: 30, halo: true },
  { ratio: 1, motes: 0.25, lines: 0.4, fps: 20, halo: false },
];

/** Frames drawn after a start before any is timed: the first draws make sprites, warm the code and set up the graphics. */
export const WARM_FRAMES = 20;
/** Frames timed together; when the middle one of them took longer than SLOW_MS to draw, the picture steps down a version. */
export const SLOW_WINDOW = 30;
export const SLOW_MS = 14;
/** The moment the still picture shows: the design whole, a ripple of light part way through it. */
export const STILL_AT = 14.4;

/** The middle of a list of numbers (the mean of the two middle ones for an even count); 0 for none. Pure. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Why the picture is still, said in small words under it, so it is never mistaken for a broken one. Paused by its button
 * says nothing: the button beside it says Play.
 */
export const STILL_WORDS: Record<string, string> = {
  slow: "Still picture: moving it was slowing this computer down",
};

/**
 * How the picture moves, as the person chose (Settings > General, or the screen's Pause, Play and Full motion): following
 * the computer (the full story, or gently when it asks for less motion; stopped if it slows the computer down), the full
 * story or gently whatever the computer asks (either kept moving, on the lightest version if it must, however slow), or
 * still. Ben, 2026-11-16: full motion even on a computer set to show less motion, as an option.
 */
export type MotionChoice = "system" | "full" | "gentle" | "still";
export const MOTION_CHOICES: readonly MotionChoice[] = ["system", "full", "gentle", "still"];
/** Where the shell keeps the choice in the browser's settings (SettingsStore), for Settings and the home screen alike. */
export const HOME_MOTION_KEY = "home-motion";
/** A kept choice read back: one of MOTION_CHOICES, else (nothing kept, or damaged) "system". Pure. */
export const motionChoiceOf = (kept: unknown): MotionChoice => (MOTION_CHOICES.includes(kept as MotionChoice) ? (kept as MotionChoice) : "system");

export interface Backdrop {
  /** Starts drawing (the screen is up): the moving picture, or one still one. */
  start(): void;
  /** Stops all drawing (the screen is closed). */
  stop(): void;
  /**
   * Where the shape to turn comes from: the project's edges, or null for the neutral cube. Asked now and about once a
   * second while drawing (a project still reopening under the screen shows its body when it arrives); a new array is
   * fitted again, the same one is not.
   */
  setSource(source: () => ArrayLike<number> | null, faces?: () => Surface | null): void;
  /**
   * With `waits` (the home screen): the list is painted and the design is here (or will not come), so the picture is shown,
   * placed and sized for good from its first frame, its story opening on the design already built (OPEN_AT). Before this nothing is drawn.
   */
  reveal(): void;
  /** The words moved (the list scrolled or changed): a still picture is drawn again in the room left (a moving one follows by itself). */
  redraw(): void;
  /**
   * How it moves from now on. "still" while moving keeps the moment on the screen (`pauseAt`); moving again carries the
   * story on from there, and a chosen motion ("full", "gentle") on a computer it was slowing moves on the lightest version
   * instead of stopping.
   */
  choose(choice: MotionChoice): void;
  readonly choice: MotionChoice;
  /** Whether the computer asks for less motion (prefers-reduced-motion). */
  readonly lessMotion: boolean;
  /** Whether drawing it has been too slow on this computer (a timed window over SLOW_MS): the screen suggests gentle motion. */
  readonly slowed: boolean;
  readonly mode: "live" | "still" | "off";
  /**
   * For the browser check only (?test-hooks): from now on the canvas carries the turntable's angle (data-yaw, radians) and
   * how many moving frames were drawn (data-frames), and each timed frame counts `extraMs` more than it took, standing in
   * for a slow computer (under a paused clock a draw takes 0 ms).
   */
  probe(extraMs: number): void;
}

interface Env {
  win: Window & typeof globalThis;
  doc: Document;
  /** Where the screen's words end, in CSS pixels from the window's top (the picture sits in the room below). */
  room?: () => number;
  /** Draw nothing until `reveal()` (the home screen: so the picture never shows at one size and moves to another). */
  waits?: boolean;
  /** Told after every change of what is drawn (moving, still, off, ready), so the screen's Pause and Play button follows. */
  changed?: () => void;
}

/** Draws on `canvas`; harmless where there is no 2D context (a test DOM). */
export function homeBackdrop(canvas: HTMLCanvasElement, env: Env = { win: window, doc: document }): Backdrop {
  const { win, doc } = env;
  const ctx = (() => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  })();
  const neutrals = NEUTRAL_SHAPES.map((lines) => fitShape(lines) as Float32Array);
  const neutralFaces = NEUTRAL_SURFACES.map((s, k) => fitSurface(s, NEUTRAL_SHAPES[k]));
  const neutral = neutrals[0];
  /** The shape's faces, fitted with its lines, and gathered into flat faces; null: lines only, seen through. */
  let faces: { positions: Float32Array; indices: Uint32Array } | null = neutralFaces[0];
  let groups: FaceGroups = faces ? groupFaces(faces.positions, faces.indices) : { tris: [], normals: [], offsets: [] };
  /** Which flat faces lie on the top face (lit as it is pulled out). */
  let topGroups: boolean[] = [];
  /** Which simple part is shown (with no project), one a story. */
  let part = 0;
  let shape = neutral;
  /** Where the shape is drawn now (eased towards `placeShape`'s answer). */
  let place: Placement | null = null;
  /** The project's size in millimetres, for the label under the turntable; null for the neutral cube. */
  let size3: [number, number, number] | null = null;
  let links: number[][] = linksOf(neutral);
  let top: number[] = topFace(neutral);
  let topZ = 1;
  let topMid: [number, number] = [0, 0];
  let floorZ = -1;
  let ceilZ = 1;
  /** The ripples' corners: low at the front left, then high at the back right. */
  let corners: [number, number, number][] = [];
  /** How far the picture reaches above and below its middle, measured for this shape. */
  let reach: Reach = { above: ABOVE, below: BELOW };
  /**
   * The facts the picture needs about the shape: the top face's height and the middle of its corners (for the extrude and
   * its handle), its lowest and highest points (for the build), the ripples' corners and its reach.
   */
  function topFacts() {
    topZ = top.length > 0 ? shape[top[0] * 6 + 2] : 1;
    let mx = 0;
    let my = 0;
    for (const sIndex of top) {
      mx += (shape[sIndex * 6] + shape[sIndex * 6 + 3]) / (2 * top.length);
      my += (shape[sIndex * 6 + 1] + shape[sIndex * 6 + 4]) / (2 * top.length);
    }
    topMid = [mx, my];
    floorZ = floorOf(shape);
    ceilZ = -Infinity;
    for (let i = 2; i < shape.length; i += 3) ceilZ = Math.max(ceilZ, shape[i]);
    if (!Number.isFinite(ceilZ)) ceilZ = 1;
    corners = [cornerOf(shape, [-1, -1, -1]), cornerOf(shape, [1, 1, 1])];
    // Everything the picture draws round the shape: its points (the top face's also pulled out, with its handle), the
    // turntable under it and the build plane's ring at its top.
    const points: { z: number; rho: number }[] = [];
    for (let i = 0; i + 2 < shape.length; i += 3) {
      const rho = Math.hypot(shape[i], shape[i + 1]);
      points.push({ z: shape[i + 2], rho });
      if (top.length > 0 && Math.abs(shape[i + 2] - topZ) < 1e-3) points.push({ z: shape[i + 2] + EXTRUDE_OUT, rho });
    }
    if (top.length > 0) points.push({ z: topZ + EXTRUDE_OUT + 0.22, rho: Math.hypot(topMid[0], topMid[1]) });
    points.push({ z: floorZ - 0.08, rho: 1.25 }, { z: ceilZ, rho: 1.25 });
    reach = reachOf(points);
    topGroups = groups.normals.map((n, g) => top.length > 0 && n[2] > 0.999 && Math.abs(groups.offsets[g] - topZ) < 1e-3);
  }
  topFacts();
  let sparks: Spark[] = [];
  let sparkClock = 0;
  const sparkRnd = seeded(11);
  /** New sparks on the shape: one for every 10 segments, 3 to 5, spread out and in turn wearing each shade. */
  function seedSparks() {
    const count = Math.floor(shape.length / 6);
    const n = Math.max(3, Math.min(5, Math.round(count / 10)));
    const rnd = seeded(5);
    sparks = Array.from({ length: n }, (_, k) => ({ seg: Math.floor(rnd() * count), from: (rnd() < 0.5 ? 0 : 1) as 0 | 1, t: rnd(), shade: k % 4 }));
    sparkClock = 0;
  }
  seedSparks();
  let source: () => ArrayLike<number> | null = () => null;
  let faceSource: () => Surface | null = () => null;
  let from: ArrayLike<number> | null | undefined; // undefined: not read yet
  let fromFaces: Surface | null | undefined;
  let watch = 0;
  /** Reads the source; true when the shape changed. */
  function reshape(): boolean {
    let lines: ArrayLike<number> | null = null;
    let surface: Surface | null = null;
    try {
      lines = source();
      surface = lines ? faceSource() : null;
    } catch {
      lines = null; // a picture is never worth a broken screen
      surface = null;
    }
    if (lines === from && surface === fromFaces) return false;
    from = lines;
    fromFaces = surface;
    const fitted = fitShape(lines);
    project3 = fitted;
    size3 = fitted ? extentOf(lines) : null;
    const k = part % neutrals.length;
    use(fitted ?? neutrals[k], fitted ? fitSurface(surface, lines) : neutralFaces[k]);
    canvas.dataset.shape = fitted ? `project ${fitted.length / 6}` : "neutral"; // what the browser check reads
    canvas.dataset.faces = String(groups.tris.length); // flat faces painted (0: lines only)
    return true;
  }
  /** The project's fitted edges, or null when there is none (the simple parts are shown in turn). */
  let project3: Float32Array | null = null;
  /** Shows `next` (with its faces, or none) from here on: the facts about it worked out once. */
  function use(next: Float32Array, nextFaces: { positions: Float32Array; indices: Uint32Array } | null) {
    shape = next;
    faces = nextFaces;
    groups = faces ? groupFaces(faces.positions, faces.indices) : { tris: [], normals: [], offsets: [] };
    links = linksOf(shape);
    top = topFace(shape);
    topFacts();
    // The layers a printer would lay down, worked out once: LAYER_LINES levels spread up the body, each its slice.
    layers3 = faces ? Array.from({ length: LAYER_LINES }, (_, k) => ({ z: floorZ + ((k + 0.5) / LAYER_LINES) * (ceilZ - floorZ), segs: sectionAt(faces!.positions, faces!.indices, floorZ + ((k + 0.5) / LAYER_LINES) * (ceilZ - floorZ)) })) : [];
    seedSparks();
  }
  /** The body's slices at LAYER_LINES levels (fitted units), for the layer lines while it builds. */
  let layers3: { z: number; segs: number[] }[] = [];
  function watching() {
    watch = 0;
    if (!running) return;
    if (reshape() && !live() && shown && !doc.hidden) draw(stillAt);
    watch = win.setTimeout(watching, 1000);
  }
  /** Circuit lines growing, held and fading, each slot reborn with a new line once its life ends (staggered). */
  let slots = 0;
  const grown = new Map<string, Trace>();
  /** The line slot `k` grows in its `life`-th life, made once and kept. */
  const lineFor = (k: number, life: number): Trace => {
    const key = `${k}:${life}`;
    let t = grown.get(key);
    if (!t) {
      t = makeTraces(1000 + k * 131 + life * 7919, 1, w, h)[0];
      if (grown.size > 4 * slots + 8) grown.clear();
      grown.set(key, t);
    }
    return t;
  };
  let motes: Mote[] = [];
  let sprites: { key: string; images: (HTMLCanvasElement | null)[] } = { key: "", images: [] };
  /** Soft round sprites, one per blue, so a mote out of focus is one cheap image draw. */
  function spritesFor(blues: string[]): (HTMLCanvasElement | null)[] {
    const key = blues.join("|");
    if (sprites.key === key) return sprites.images;
    const images = blues.map((colour) => {
      const c = doc.createElement?.("canvas") as HTMLCanvasElement | undefined;
      const g = c?.getContext?.("2d");
      if (!c || !g) return null;
      c.width = c.height = 32;
      const fill = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      fill.addColorStop(0, colour);
      fill.addColorStop(0.35, colour.replace(")", " / 0.55)"));
      fill.addColorStop(1, colour.replace(")", " / 0)"));
      g.fillStyle = fill;
      g.fillRect(0, 0, 32, 32);
      return c;
    });
    sprites = { key, images };
    return images;
  }
  let w = 0;
  let h = 0;
  let timer = 0;
  let running = false;
  let lastFrame = 0;
  let t0 = 0;
  /** Where the story had got to when it last stopped (a resize, a hidden tab or a step down carries on from there). */
  let story = 0;
  const costs: number[] = [];
  let drawn = 0;
  /** The browser check's extra milliseconds a frame (`probe`), or null: then nothing is reported. */
  let probing: number | null = null;
  let framesDrawn = 0;
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  const nav = win.navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const weak = lowEnd({ cores: nav.hardwareConcurrency, memory: nav.deviceMemory, saveData: nav.connection?.saveData });
  /** Which version of the moving picture (QUALITY); QUALITY.length once even the lightest proved too slow. */
  let level = weak ? QUALITY.length - 1 : 0;
  const quality = () => QUALITY[Math.min(level, QUALITY.length - 1)];
  /** Whether the computer asks for less motion. */
  const reduced = () => motion?.matches ?? false;
  /** How the person chose it should move. */
  let choice: MotionChoice = "system";
  /** Whether it moves gently: chosen, or following a computer that asks for less motion. */
  const gentle = () => choice === "gentle" || (choice === "system" && reduced());
  const live = () => choice !== "still" && level < QUALITY.length;
  /** Why the picture is still, or "" while it moves. */
  const stillWhy = () => (choice === "still" ? "paused" : level >= QUALITY.length ? "slow" : "");
  /** The moment a still picture shows: STILL_AT, or the one on the screen when it was paused. */
  let stillAt = STILL_AT;
  /** Whether a timed window of frames has been too slow on this computer (`slowed`). */
  let slowed = false;
  /** What the turn adds to its angle (radians) since its speed last changed, and whether that speed was the gentle one. */
  let turnOffset = 0;
  let turnCalm = false;
  const set = (mode: string) => (canvas.dataset.backdrop = mode);
  set("off");
  /** Whether the picture may be drawn: at once, or (with `waits`) once `reveal` says the screen and the design are ready. */
  const waits = env.waits ?? false;
  let shown = !waits;

  const colour = () => win.getComputedStyle(doc.documentElement).getPropertyValue("--look-accent").trim() || "#4da3ff";

  function size() {
    const rect = canvas.getBoundingClientRect();
    const q = quality();
    const ratio = Math.min(win.devicePixelRatio || 1, q.ratio);
    w = Math.max(1, Math.round(rect.width || win.innerWidth || 1));
    h = Math.max(1, Math.round(rect.height || win.innerHeight || 1));
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    slots = Math.max(4, Math.round(Math.max(8, Math.min(24, Math.round((w * h) / 52000))) * q.lines));
    grown.clear();
    motes = makeMotes(3, Math.round((w < 640 ? 60 : 110) * q.motes));
  }

  /** The page's colour (faces are mixed from it). */
  const pageColour = () => win.getComputedStyle(doc.documentElement).getPropertyValue("--surface").trim();

  function draw(seconds: number) {
    if (!ctx) return;
    // Moving gently (reduced motion): the design built and turning slowly, soft fades only (see the file's top).
    const calm = gentle();
    if (calm !== turnCalm) {
      // The turning speed changed (gentle on or off): the turn goes on from the angle it had, never jumping.
      turnOffset += seconds * Math.PI * 2 * (1 / (turnCalm ? GENTLE_TURN : TURN_SECONDS) - 1 / (calm ? GENTLE_TURN : TURN_SECONDS));
      turnCalm = calm;
    }
    // With no project, a different simple part each story, changed at the story's turn while the last has sunk away.
    if (!project3) {
      const n = neutrals.length;
      const next = ((Math.floor(seconds / STORY_SECONDS) % n) + n) % n; // a frame stamped just before the start is story −1

      if (next !== part) {
        part = next;
        use(neutrals[part], neutralFaces[part]);
      }
      if (canvas.dataset.part !== String(part)) canvas.dataset.part = String(part); // which part: the tests read it
    }
    const ink = colour();
    const page = pageColour();
    // Whether the page is light (its surface bright): glows add light on a dark page, and would wash out a light one.
    const glow = !(luminance(page) > 0.5);
    const rgb = rgbOf(ink) ?? [77, 163, 255];
    const blues = shadesOf(rgb, !glow);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.globalCompositeOperation = glow ? "lighter" : "source-over";
    // Circuit lines growing slowly across the page like something alive, a bright tip at the growing end, each held a
    // while then fading as others start elsewhere.
    for (let k = 0; k < slots; k++) {
      const first = lineFor(k, 0);
      const offset = (k / slots) * growthLife(first.reach); // staggered, so lines are always at every stage
      const clock = seconds + offset;
      let life = 0;
      let age = clock;
      let line = first;
      for (let guard = 0; guard < 1000 && age > growthLife(line.reach); guard++) {
        age -= growthLife(line.reach);
        life += 1;
        line = lineFor(k, life);
      }
      const { grown: length, alpha } = (calm ? gentleGrowthAt : growthAt)(age, line.reach); // gently: whole, fading in
      if (alpha <= 0) continue;
      const { x: ox, y: oy } = line;
      // The main line and its branches, each grown as far as the growth has reached along it.
      const paths = [{ path: grownPath(line.points, length), whole: length >= line.length }];
      for (const b of line.branches) if (length > b.start) paths.push({ path: grownPath(b.points, length - b.start), whole: length - b.start >= b.length });
      ctx.beginPath();
      for (const { path } of paths) path.forEach((p, i) => (i === 0 ? ctx.moveTo(ox + p.x, oy + p.y) : ctx.lineTo(ox + p.x, oy + p.y)));
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.17 * alpha;
      ctx.stroke();
      ctx.globalAlpha = 0.22 * alpha;
      ctx.beginPath();
      ctx.arc(ox, oy, 1.8, 0, Math.PI * 2);
      ctx.fill();
      for (const { path, whole } of paths) {
        const tip = path[path.length - 1];
        // A growing end carries a bright bead of light; a finished one ends in a small pad.
        ctx.globalAlpha = (whole ? 0.24 : 0.6) * alpha;
        ctx.beginPath();
        ctx.arc(ox + tip.x, oy + tip.y, whole ? 2 : 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (glow && !whole) {
          ctx.globalAlpha = 0.15 * alpha;
          ctx.beginPath();
          ctx.arc(ox + tip.x, oy + tip.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // The design, turning slowly on a turntable in the room under the words.
    const want = placeShape(w, h, env.room?.() ?? h * 0.5, reach);
    // Eased towards where it should be, so a list that grows or scrolls moves the picture smoothly (a still picture jumps).
    place = place === null || !live() ? want : { cx: want.cx, cy: place.cy + (want.cy - place.cy) * 0.12, scale: place.scale + (want.scale - place.scale) * 0.12 };
    const { cx, cy } = place;
    const placed3 = `${Math.round(cx)} ${Math.round(cy)} ${Math.round(place.scale)}`; // where and how big (the browser check reads it)
    if (canvas.dataset.place !== placed3) canvas.dataset.place = placed3;
    const scale = place.scale * (calm ? 1 : dolly(seconds)); // the camera drifts back a little and in again, slowly
    const yaw = (seconds / (calm ? GENTLE_TURN : TURN_SECONDS)) * Math.PI * 2 + 0.6 + turnOffset;
    const pitch = PITCH + (calm ? 0 : SWAY * Math.sin((seconds / 37) * Math.PI * 2)); // the camera rises and sinks a little, slowly
    // Now and then the body's top face is extruded out or in: every point on it moves, so its side edges stretch.
    const push = top.length > 0 && !calm ? extrudeAmount(seconds) : 0;
    const pushed = push.toFixed(2);
    if (canvas.dataset.extrude !== pushed) canvas.dataset.extrude = pushed; // what the browser check waits on
    if (probing !== null) canvas.dataset.yaw = yaw.toFixed(5);
    const lifted = (z: number) => (top.length > 0 && Math.abs(z - topZ) < 1e-3 ? z + push : z);
    const atRaw = (x: number, y: number, z: number) => {
      const p = project(x, y, z, yaw, pitch);
      return { x: cx + p.x * scale, y: cy + p.y * scale, depth: p.depth };
    };
    const at = (x: number, y: number, z: number) => atRaw(x, y, lifted(z));
    const lift = calm ? 0 : flash(seconds);
    // Moving gently a simple part is never built, so it fades out at the story's turn and the next one fades in.
    const fade = calm && !project3 ? partFade(seconds) : 1;
    const floor = floorOf(shape) - 0.08;
    // Motes of dust floating up round the shape, sharp in the middle distance, soft and large when near, dim when far:
    // the far half now, behind everything, the near half after the shape.
    const images = spritesFor(blues);
    const placed = motes.map((m) => {
      const p = moteAt(m, calm ? seconds * GENTLE_DRIFT : seconds);
      return { ...atRaw(p.x, p.y, p.z), show: p.show, shade: m.shade };
    });
    const drawMote = (m: { x: number; y: number; depth: number; show: number; shade: number }) => {
      // depth −2.8 (nearest) .. +2.8 (farthest): out of focus grows with distance from the shape's middle (0).
      const blur = Math.min(1, Math.abs(m.depth) / 2.4);
      const near = m.depth < 0;
      const r = (1.1 + blur * (near && !calm ? 7 : 2.5)) * Math.max(0.6, scale / 160); // gently: never large in front
      const a = m.show * (near ? 0.5 - 0.32 * blur : 0.42 - 0.3 * blur) * (glow ? 1 : 0.55); // on a light page dots read as dust
      if (a <= 0.005) return;
      ctx.globalAlpha = a;
      const image = images[m.shade % images.length];
      if (image) ctx.drawImage(image, m.x - r * 2, m.y - r * 2, r * 4, r * 4);
      else {
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const m of placed) if (m.depth >= 0) drawMote(m);
    // A soft pool of light on the turntable.
    const base = at(0, 0, floor);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.3 * scale);
    pool.addColorStop(0, `rgba(${rgb.join(",")},1)`);
    pool.addColorStop(1, `rgba(${rgb.join(",")},0)`);
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.scale(1, Math.sin(pitch));
    ctx.globalAlpha = (glow ? 0.1 : 0.06) * (1 + 0.5 * lift);
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, 1.3 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = ink;
    // The turntable: one ring with a tick every 5°, longer every 30°, turning with the shape.
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.14;
    const ringFoot = ring(at, 1.25, floor);
    ctx.beginPath();
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const inner = k % 6 === 0 ? 1.13 : 1.2;
      const p = at(Math.cos(a) * inner, Math.sin(a) * inner, floor);
      const q = at(Math.cos(a) * 1.25, Math.sin(a) * 1.25, floor);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.globalAlpha = 0.12;
    ctx.stroke();
    // The build plane: while the design is building (or sinking back), a glowing level ring with a soft disc rises through
    // it from the floor; the edges and faces under it are built, the edges over it wait as ghosts.
    const built = calm ? 1 : buildAt(seconds);
    const span = Math.max(1e-6, ceilZ - floorZ);
    const planeZ = floorZ + built * span;
    const building = built < 1 - 1e-6;
    // The faces, solid and shaded by a light that stays with the camera, so the design reads as a body and its back is
    // hidden; while it builds, cut at the plane, with the inside seen through the open top. Painted farthest first.
    let occ: Occluder | null = null;
    let ghostOcc: Occluder | null = null;
    const extruding = Math.abs(push) > 0.002;
    const pushK = extruding ? Math.min(1, Math.abs(push) / Math.abs(push > 0 ? EXTRUDE_OUT : EXTRUDE_IN)) : 0;
    if (faces && groups.tris.length > 0) {
      const pass = faceFrame(groups, faces.positions, faces.indices, at, building ? planeZ : null, building);
      occ = pass.occ;
      ghostOcc = pass.whole;
      const base3 = rgbOf(page) ?? (glow ? [22, 29, 42] : [245, 247, 250]);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = fade;
      ctx.lineWidth = 0.75; // the same colour round each face closes the hairline seams between faces
      for (const f of pass.paint) {
        let amount = faceMix(toneOf(groups.normals[f.group], yaw, pitch), f.front, glow) + 0.08 * lift;
        if (topGroups[f.group] && f.front) amount += 0.16 * pushK; // the face being pulled out lights up
        const mix = base3.map((v, k) => Math.round(v + (rgb[k] - v) * Math.min(1, amount)));
        const fill = `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
        ctx.fillStyle = fill;
        ctx.strokeStyle = fill;
        ctx.beginPath();
        for (const poly of f.polys) {
          ctx.moveTo(poly[0], poly[1]);
          for (let j = 2; j < poly.length; j += 2) ctx.lineTo(poly[j], poly[j + 1]);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalCompositeOperation = glow ? "lighter" : "source-over";
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
    }
    if (building && built > 1e-6 && !(faces && groups.tris.length > 0)) {
      // A shape with lines only (no faces to slice): the plane shown as a glowing level ring with a soft disc.
      const edge = Math.min(1, built / 0.05, (1 - built) / 0.05); // fades in off the floor and out at the top
      const mid = at(0, 0, planeZ);
      const disc = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.25 * scale);
      disc.addColorStop(0, blues[1].replace(")", " / 0.5)"));
      disc.addColorStop(1, blues[1].replace(")", " / 0)"));
      ctx.save();
      ctx.translate(mid.x, mid.y);
      ctx.scale(1, Math.sin(pitch));
      ctx.globalAlpha = (glow ? 0.16 : 0.1) * edge;
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(0, 0, 1.25 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = blues[3];
      ctx.globalAlpha = 0.26 * edge;
      ctx.lineWidth = 1.1;
      ring(at, 1.25, planeZ);
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
    }
    // The ripple going now, from its corner.
    const wave = calm ? null : rippleAt(seconds);
    const from3 = wave ? corners[wave.which % corners.length] : null;
    // What the browser check waits on: the story's stage and how much is built (one decimal).
    const stage = building ? (storyPhase(seconds) < BUILD_END ? "building" : "sinking") : wave ? "ripple" : Math.abs(push) > 0.002 ? "extrude" : "rest";
    if (canvas.dataset.stage !== stage) canvas.dataset.stage = stage;
    const builtWords = built.toFixed(1);
    if (canvas.dataset.build !== builtWords) canvas.dataset.build = builtWords;
    // The edges, batched by brightness: built ones by their glow (the fresh layers, the ripple, the flash), ghosts far
    // fainter, and all much fainter at the back, so the near side reads first and the shape reads as solid. An edge the
    // plane crosses is split there. The extruded face's edges are drawn apart. Points of light go where the plane or the
    // ripple crosses an edge.
    const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
    const moving: number[] = [];
    const was: number[] = []; // where the extruded face started: drawn dashed, as a CAD preview keeps the profile
    const ghosts: number[] = []; // not built yet: drawn faint and dashed, like hidden lines on a drawing
    const beads: number[] = []; // x, y, cue, kind (0 the plane, 1 the ripple)
    const step = quality().halo ? 8 : 12; // how often a line is asked whether a face hides it, in pixels
    let hid = false;
    /** The parts of the screen segment a–b no face hides, each passed to `keep` (all of it when there are no faces). */
    const seen = (by: Occluder | null, a: { x: number; y: number; depth: number }, b: { x: number; y: number; depth: number }, keep: (ax: number, ay: number, bx: number, by: number) => void) => {
      if (!by) return keep(a.x, a.y, b.x, b.y);
      for (const [f, t, shown] of visibleRuns(a.x, a.y, a.depth, b.x, b.y, b.depth, by, step)) {
        if (!shown) {
          hid = true;
          continue;
        }
        keep(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    };
    const toMoving = (ax: number, ay: number, bx: number, by: number) => moving.push(ax, ay, bx, by);
    const toGhosts = (ax: number, ay: number, bx: number, by: number) => ghosts.push(ax, ay, bx, by);
    const brightness = (glowing: number, depth: number) =>
      Math.min(MAX_ALPHA, (BASE_ALPHA + (MAX_ALPHA - BASE_ALPHA) * Math.min(1, 0.75 * glowing + 0.4 * lift)) * depthCue(depth));
    const put = (alpha: number, ax: number, ay: number, bx: number, by: number) =>
      buckets[Math.max(0, Math.min(BUCKETS - 1, Math.round((alpha / MAX_ALPHA) * (BUCKETS - 1))))].push(ax, ay, bx, by);
    for (let i = 0; i < shape.length; i += 6) {
      const az = shape[i + 2];
      const bz = shape[i + 5];
      const a = at(shape[i], shape[i + 1], az);
      const b = at(shape[i + 3], shape[i + 4], bz);
      if (extruding && Math.abs(az - topZ) < 1e-3 && Math.abs(bz - topZ) < 1e-3) {
        seen(occ, a, b, toMoving);
        const a0 = atRaw(shape[i], shape[i + 1], az);
        const b0 = atRaw(shape[i + 3], shape[i + 4], bz);
        was.push(a0.x, a0.y, b0.x, b0.y);
        continue;
      }
      const height = ((az + bz) / 2 - floorZ) / span;
      let gap = Infinity;
      if (wave && from3) {
        const crossing = sphereGap([shape[i], shape[i + 1], az], [shape[i + 3], shape[i + 4], bz], from3, wave.radius);
        gap = crossing.gap;
        if (crossing.cross !== null && (!building || az + crossing.cross * (bz - az) <= planeZ)) {
          const t = crossing.cross;
          const p = at(shape[i] + t * (shape[i + 3] - shape[i]), shape[i + 1] + t * (shape[i + 4] - shape[i + 1]), az + t * (bz - az));
          if (!occ?.hides(p.x, p.y, p.depth)) beads.push(p.x, p.y, depthCue(p.depth), 1);
        }
      }
      const alpha = brightness(glowOf(seconds, height, gap, calm), (a.depth + b.depth) / 2);
      const lo = Math.min(az, bz);
      const hi = Math.max(az, bz);
      const toBucket = (ax: number, ay: number, bx: number, by: number) => put(alpha, ax, ay, bx, by);
      if (!building || hi <= planeZ) seen(occ, a, b, toBucket);
      else if (lo >= planeZ) seen(ghostOcc, a, b, toGhosts);
      else {
        // Crossed by the plane: built up to it, a ghost above, and a point of light where it crosses.
        const t = (planeZ - az) / (bz - az);
        const m = at(shape[i] + t * (shape[i + 3] - shape[i]), shape[i + 1] + t * (shape[i + 4] - shape[i + 1]), planeZ);
        const [under, over] = az < bz ? [a, b] : [b, a];
        seen(occ, under, m, toBucket);
        seen(ghostOcc, m, over, toGhosts);
        if (!occ?.hides(m.x, m.y, m.depth)) beads.push(m.x, m.y, depthCue(m.depth), 0);
      }
    }
    const strokeList = (list: number[], alpha: number, width: number) => {
      ctx.beginPath();
      for (let j = 0; j < list.length; j += 4) {
        ctx.moveTo(list[j], list[j + 1]);
        ctx.lineTo(list[j + 2], list[j + 3]);
      }
      if (glow && quality().halo) {
        ctx.globalAlpha = alpha * 0.16; // the soft halo
        ctx.lineWidth = width + 3;
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    for (let k = 0; k < BUCKETS; k++) if (buckets[k].length > 0) strokeList(buckets[k], (k / (BUCKETS - 1)) * MAX_ALPHA * fade, 1.2);
    const hides = hid ? "yes" : "no"; // whether faces hid any line this frame (the browser check reads it)
    if (canvas.dataset.hides !== hides) canvas.dataset.hides = hides;
    // Ghosts fade in as a story starts and out as it ends, so the part can change unseen between stories.
    const turn = storyPhase(seconds);
    const ghostFade = Math.min(1, turn / 0.03, (1 - turn) / 0.03);
    if (ghosts.length > 0 && ghostFade > 0) {
      ctx.setLineDash?.([3, 4]);
      strokeList(ghosts, GHOST * ghostFade, 1);
      ctx.setLineDash?.([]);
    }
    // Printing: the walls built so far carry faint layer lines, and the slice being laid down now glows, with the
    // nozzle's point of light running round it and a short bright trail of fresh line behind it. The lines fade away
    // once it is whole, so the print becomes the CAD body (and come back as it sinks).
    const turnNow = storyPhase(seconds);
    const layerShow = calm ? 0 : turnNow < BUILD_END ? 1 : turnNow < BUILD_END + 0.04 ? 1 - smooth((turnNow - BUILD_END) / 0.04) : turnNow >= UNBUILD_AT ? 1 : 0;
    if (layerShow > 0 && faces && groups.tris.length > 0) {
      const layerLines: number[] = [];
      const keepLayer = (ax: number, ay: number, bx: number, by: number) => layerLines.push(ax, ay, bx, by);
      for (const layer of layers3) {
        if (layer.z > planeZ - 1e-6) break;
        for (let j = 0; j < layer.segs.length; j += 4) seen(occ, at(layer.segs[j], layer.segs[j + 1], layer.z), at(layer.segs[j + 2], layer.segs[j + 3], layer.z), keepLayer);
      }
      ctx.strokeStyle = blues[3];
      if (layerLines.length > 0) strokeList(layerLines, 0.13 * layerShow * fade, 1);
      if (building && built > 1e-6) {
        const edge = Math.min(1, built / 0.04, (1 - built) / 0.04); // in off the floor, out at the top
        const slice = sectionAt(faces.positions, faces.indices, planeZ);
        const now: number[] = [];
        for (let j = 0; j < slice.length; j += 4) seen(occ, at(slice[j], slice[j + 1], planeZ), at(slice[j + 2], slice[j + 3], planeZ), (ax, ay, bx, by) => now.push(ax, ay, bx, by));
        if (now.length > 0) strokeList(now, MAX_ALPHA * 0.9 * edge, 1.4);
        const sliced = String(now.length / 4); // how many pieces of the slice are drawn (the browser check reads it)
        if (canvas.dataset.slice !== sliced) canvas.dataset.slice = sliced;
        const loops = slice.length / 4 <= MAX_SLICE_SEGMENTS ? chainLoops(slice, 1e-5) : [];
        const lengths = loops.map(pathLength);
        const total = lengths.reduce((a, b) => a + b, 0);
        if (total > 0) {
          // Which loop the nozzle is on now, and how far round it: it prints each loop of the slice in turn.
          const where = (d: number) => {
            let left = ((d % total) + total) % total;
            for (let k = 0; k < loops.length; k++) {
              if (left <= lengths[k]) return { loop: k, d: left };
              left -= lengths[k];
            }
            return { loop: loops.length - 1, d: lengths[loops.length - 1] };
          };
          const travel = seconds * NOZZLE_SPEED;
          const head = where(travel);
          const trail: { x: number; y: number; depth: number }[] = [];
          for (let k = 0; k <= 12; k++) {
            const back = head.d - (k / 12) * NOZZLE_TRAIL;
            if (back < 0) break; // the trail starts where this loop starts
            const p = alongPath(loops[head.loop], back);
            if (p) trail.push(at(p.x, p.y, planeZ));
          }
          ctx.lineWidth = 2;
          for (let k = 1; k < trail.length; k++) {
            ctx.globalAlpha = MAX_ALPHA * (1 - k / trail.length) * edge;
            ctx.beginPath();
            ctx.moveTo(trail[k - 1].x, trail[k - 1].y);
            ctx.lineTo(trail[k].x, trail[k].y);
            ctx.stroke();
          }
          const tip = trail[0];
          if (tip && !occ?.hides(tip.x, tip.y, tip.depth)) {
            ctx.fillStyle = blues[3];
            ctx.globalAlpha = 0.95 * edge;
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, 2.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.24 * edge;
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
    }
    // Points of light where the build plane (the lightest blue) or the ripple (the cyan blue) crosses an edge.
    for (let j = 0; j < beads.length; j += 4) {
      const [x, y, cue, kind] = [beads[j], beads[j + 1], beads[j + 2], beads[j + 3]];
      ctx.fillStyle = kind === 0 ? blues[3] : blues[1];
      ctx.globalAlpha = 0.85 * cue;
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
      if (glow) {
        ctx.globalAlpha = 0.16 * cue;
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = ink;
    if (moving.length > 0) {
      // The face being extruded, lit in the lightest blue, fading in and out with the move; its handle and distance beside it.
      const k = pushK;
      ctx.strokeStyle = blues[3];
      strokeList(moving, 0.35 + 0.35 * k, 1.4);
      ctx.setLineDash?.([4, 4]);
      strokeList(was, 0.3 * k, 1);
      ctx.setLineDash?.([]);
      const foot = atRaw(topMid[0], topMid[1], topZ + push);
      const tip = atRaw(topMid[0], topMid[1], topZ + push + 0.22); // the handle rides with the face, pointing out
      const tipY = tip.y;
      const len = Math.hypot(tip.x - foot.x, tipY - foot.y) || 1;
      const ux = (tip.x - foot.x) / len;
      const uy = (tipY - foot.y) / len;
      ctx.globalAlpha = 0.55 * k;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.lineTo(tip.x, tipY);
      ctx.moveTo(tip.x - ux * 6 - uy * 3.5, tipY - uy * 6 + ux * 3.5);
      ctx.lineTo(tip.x, tipY);
      ctx.lineTo(tip.x - ux * 6 + uy * 3.5, tipY - uy * 6 - ux * 3.5);
      ctx.stroke(); // its distance is in the words under the design, where the list never covers it
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
    }
    // A few sparks of light running calmly along the edges, each in its own blue, with a fading tail (none moving gently).
    const sparkShow = smooth((built - 0.85) / 0.15);
    const dt = Math.min(0.1, Math.max(0, seconds - sparkClock));
    sparkClock = seconds;
    if (!calm) sparks = sparks.map((p) => stepSpark(p, dt, shape, links, sparkRnd));
    for (const p of calm ? [] : sparks) {
      const i = p.seg * 6;
      const [ax, ay, az, bx, by, bz] = p.from === 0 ? [0, 1, 2, 3, 4, 5].map((k) => shape[i + k]) : [3, 4, 5, 0, 1, 2].map((k) => shape[i + k]);
      const length = Math.hypot(bx - ax, by - ay, bz - az) || 1e-6;
      const along = (t: number) => at(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
      const head = along(p.t);
      if (occ?.hides(head.x, head.y, head.depth)) continue; // running behind the body: out of sight
      const tail = along(Math.max(0, p.t - 0.35 / length));
      const colour = blues[p.shade % blues.length];
      const cue = depthCue(head.depth) * sparkShow; // sparks run only once the design is built
      const fade = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      fade.addColorStop(0, colour.replace(")", " / 0)")); // the same blue, see-through: no grey fringe on a light page
      fade.addColorStop(1, colour);
      ctx.strokeStyle = fade;
      ctx.globalAlpha = 0.75 * cue;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.85 * cue;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (glow) {
        ctx.globalAlpha = 0.12 * cue;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    for (const m of placed) if (m.depth < 0) drawMote(m);
    ctx.fillStyle = ink;
    if (size3) {
      ctx.globalAlpha = 0.42;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(sizeWords(size3, currentUnit(doc)), cx, ringFoot + 12);
    } else if (!project3) {
      // No project: say this is a sample, so nobody takes it for their own design.
      ctx.globalAlpha = 0.42 * fade;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(SAMPLE_WORDS, cx, ringFoot + 12);
    }
    // What it is doing now, in words under its size (Ben, 2026-11-16: obvious what you are looking at).
    const unit = currentUnit(doc);
    const doing = storyWords(stage, built, size3 ? size3[2] : null, size3 ? push * (Math.max(...size3) / 2) : null, unit);
    const doingY = ringFoot + (size3 || !project3 ? 28 : 12);
    if (canvas.dataset.words !== doing) canvas.dataset.words = doing; // what the browser check reads
    if (doing && !STILL_WORDS[stillWhy()]) {
      ctx.fillStyle = blues[3];
      ctx.globalAlpha = 0.8 * (stage === "extrude" ? pushK : Math.min(1, built / 0.03, (1 - built) / 0.03)) * fade;
      ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(doing, cx, doingY);
      ctx.fillStyle = ink;
    }
    // A still picture says why in small words under it, so it is never mistaken for a broken one.
    const why = stillWhy();
    if (STILL_WORDS[why]) {
      ctx.globalAlpha = 0.5;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(STILL_WORDS[why], cx, Math.min(h - 18, ringFoot + (size3 || !project3 ? 30 : 12)));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** A level circle of `radius` about the up axis at height `z`, drawn through `at`; gives its lowest point on screen. */
  function ring(at: (x: number, y: number, z: number) => { x: number; y: number }, radius: number, z: number): number {
    let foot = -Infinity;
    if (!ctx) return foot;
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const p = at(Math.cos(a) * radius, Math.sin(a) * radius, z);
      foot = Math.max(foot, p.y);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    return foot;
  }

  function frame(now: number) {
    timer = 0;
    if (!running) return;
    timer = win.requestAnimationFrame(frame);
    const fps = gentle() ? Math.min(GENTLE_FPS, quality().fps) : quality().fps;
    if (now - lastFrame < 1000 / fps - 1) return; // at most 30 a second (20 on the lightest, and moving gently)
    lastFrame = now;
    const begun = win.performance.now();
    story = Math.max(0, (now - t0) / 1000); // a frame can be stamped a moment before the start
    draw(story);
    const cost = win.performance.now() - begun + (probing ?? 0);
    if (probing !== null) canvas.dataset.frames = String(++framesDrawn);
    // The first frames after a start are not timed; then the middle of each SLOW_WINDOW decides (a few slow frames on a
    // busy page are not a slow computer).
    if (++drawn <= WARM_FRAMES) return;
    costs.push(cost);
    if (costs.length < SLOW_WINDOW) return;
    const typical = median(costs);
    costs.length = 0;
    canvas.dataset.cost = typical.toFixed(1); // milliseconds a frame takes to draw, for a check (and anyone curious)
    // A motion the person chose keeps moving on the lightest version however slow (they chose it over a still picture).
    if (typical > SLOW_MS) slowed = true; // the screen may suggest gentle motion
    if (typical > SLOW_MS && !(choice !== "system" && level >= QUALITY.length - 1)) {
      level += 1; // a lighter version, or a still picture once the lightest is too slow
      if (level >= QUALITY.length) stillAt = STILL_AT;
      settle();
    }
  }

  /** Runs, or paints the still picture, as the machine, the tab and the person's choice allow now; then tells the screen. */
  function settle() {
    settleNow();
    env.changed?.();
  }
  function settleNow() {
    if (timer) win.cancelAnimationFrame(timer);
    timer = 0;
    if (!running || !ctx) return set("off"); // closed, or nothing to draw on (a test DOM): no loop at all
    size();
    costs.length = 0;
    drawn = 0;
    const why = stillWhy();
    if (why) canvas.dataset.still = why;
    else delete canvas.dataset.still;
    if (live()) canvas.dataset.motion = gentle() ? "gentle" : "full"; // how it moves (the tests read it)
    else delete canvas.dataset.motion;
    canvas.dataset.quality = String(Math.min(level, QUALITY.length - 1)); // what the tests read
    if (!shown) return set(live() ? "live" : "still"); // waiting for `reveal`: nothing drawn yet, no loop
    if (live() && !doc.hidden) {
      set("live");
      t0 = win.performance.now() - story * 1000; // the story carries on where it was
      timer = win.requestAnimationFrame(frame);
    } else {
      set(live() ? "live" : "still"); // a hidden tab keeps its mode, drawing nothing
      if (!doc.hidden) draw(live() ? story : stillAt);
    }
  }

  const onVisible = () => running && settle();
  const onResize = () => running && settle();
  return {
    start() {
      if (running) return;
      running = true;
      doc.addEventListener("visibilitychange", onVisible);
      win.addEventListener("resize", onResize);
      motion?.addEventListener?.("change", onVisible);
      reshape();
      if (shown) canvas.dataset.ready = "yes";
      settle();
      if (ctx) watch = win.setTimeout(watching, 1000); // nothing to draw on (a test DOM): nothing to watch for
    },
    stop() {
      running = false;
      doc.removeEventListener("visibilitychange", onVisible);
      win.removeEventListener("resize", onResize);
      motion?.removeEventListener?.("change", onVisible);
      if (timer) win.cancelAnimationFrame(timer);
      if (watch) win.clearTimeout(watch);
      timer = 0;
      watch = 0;
      set("off");
      if (waits) {
        shown = false; // shown again only once revealed again
        delete canvas.dataset.ready;
      }
      env.changed?.();
    },
    setSource(next, nextFaces) {
      source = next;
      faceSource = nextFaces ?? (() => null);
      from = undefined; // read it again even if it gives the same array
      if (reshape() && running && !live() && shown && !doc.hidden) draw(stillAt);
    },
    reveal() {
      if (shown || !running) return;
      shown = true;
      reshape();
      place = null; // placed where it belongs from the first frame, never eased in from somewhere else
      story = openingAt(gentle()); // opens on the design already built, never on its build (OPEN_AT)
      stillAt = STILL_AT;
      turnOffset = 0;
      turnCalm = gentle();
      canvas.dataset.ready = "yes"; // the page fades the picture in (home-screen.css)
      settle();
    },
    redraw() {
      if (running && ctx && !live() && !doc.hidden && shown) draw(stillAt);
    },
    choose(next) {
      if (next === choice) return;
      // Paused while moving: the moment on the screen is kept (unless the design hardly shows in it).
      if (next === "still" && live() && shown) stillAt = pauseAt(story, gentle(), project3 !== null);
      choice = next;
      if (next === "full" || next === "gentle") level = Math.min(level, QUALITY.length - 1); // stopped as too slow: the lightest, moving
      settle();
    },
    get choice() {
      return choice;
    },
    get lessMotion() {
      return reduced();
    },
    get slowed() {
      return slowed;
    },
    probe(extraMs) {
      probing = extraMs;
    },
    get mode() {
      return canvas.dataset.backdrop as "live" | "still" | "off";
    },
  };
}
