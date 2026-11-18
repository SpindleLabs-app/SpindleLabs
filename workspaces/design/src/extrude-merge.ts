// An extrude of several profiles (version 18) without a boolean where none
// is needed (SL #611 C1). The kernel's booleans take flat faces only for
// now, so the prisms of profiles with a curved side could never be joined,
// even when they never meet. Two rules, both exact:
//
// - Prisms whose boxes don't meet, or meet only along a line or at a point
//   (on two axes thinner than the kernel's 10 nm), can't share any face, so
//   they are separate bodies as they are (`contactGroups`): only a group that
//   may share a face goes to the kernel.
// - Regions of one sketch extruded alike (one distance, plane and way) that
//   tile a bigger region side by side (a plate and its hole, a ring and its
//   middle, a circle split by a line) make the prism of that bigger region,
//   so their outlines are joined in the plane instead (`mergedOutline`): every
//   side the regions share is run once each way, and goes; what is left is
//   the bigger region's outline. Anything else (two outer loops, a corner
//   where more than two sides meet, an area that doesn't add up) gives null,
//   and the kernel is asked as before.

import type { Loop, Outline, OutlinePiece } from "@fission/core";
import { REACH } from "./extrude-operation.ts";

type Bounds = readonly [readonly number[], readonly number[]];

/**
 * Whether two prisms' boxes meet so that the prisms may share a face: the
 * boxes meet (touching counted, within `REACH`) and what they share is
 * thicker than `REACH` on at least two axes. Shared along a line or at a
 * point, the prisms can only touch there, and stay separate bodies.
 */
export function mayShareFace(a: Bounds, b: Bounds): boolean {
  let thin = 0;
  for (let i = 0; i < 3; i++) {
    const shared = Math.min(a[1][i], b[1][i]) - Math.max(a[0][i], b[0][i]);
    if (shared < -REACH) return false;
    if (shared <= REACH) thin++;
  }
  return thin < 2;
}

/** The prisms by index in groups that may share a face, each group in index order, the groups by their first index. */
export function contactGroups(boxes: readonly Bounds[]): number[][] {
  const group = boxes.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (mayShareFace(boxes[i], boxes[j])) group[root(j)] = root(i);
  const out = new Map<number, number[]>();
  boxes.forEach((_, i) => {
    const r = root(i);
    if (!out.has(r)) out.set(r, []);
    out.get(r)!.push(i);
  });
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

/** One side of a loop: from a to b, with its bulge (tan of a quarter of its turn, counter-clockwise positive) and the sketch curve it came from. */
interface Side {
  a: [number, number];
  b: [number, number];
  bulge: number;
  piece: OutlinePiece;
}

/** A whole circle loop, +1 an outer loop (counter-clockwise), -1 a hole. */
interface Ring {
  center: [number, number];
  radius: number;
  sign: 1 | -1;
  piece: OutlinePiece;
}

const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= REACH;

/** The signed area between a side's chord and its arc (positive for a counter-clockwise arc). */
function bulgeArea(s: Side): number {
  if (s.bulge === 0) return 0;
  const c = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  const t = 4 * Math.atan(Math.abs(s.bulge));
  const r = c / (2 * Math.sin(t / 2));
  return Math.sign(s.bulge) * ((r * r) / 2) * (t - Math.sin(t));
}

/** A loop's signed area (counter-clockwise positive): the shoelace of its corners and each arc's part. */
const sidesArea = (sides: readonly Side[]) => sides.reduce((sum, s) => sum + (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2 + bulgeArea(s), 0);

/** A loop as sides (one per corner) or a ring; null when its pieces don't match its corners. */
function readLoop(loop: Loop, pieces: readonly OutlinePiece[] | undefined): Side[] | Omit<Ring, "sign"> | null {
  if (pieces === undefined) return null;
  if ("circle" in loop) return pieces.length === 1 ? { center: [...loop.circle.center], radius: loop.circle.radius, piece: pieces[0] } : null;
  const { corners } = loop.path;
  const n = corners.length / 2;
  // No bulges given: every side straight.
  const bulges = loop.path.bulges.length === 0 ? new Array<number>(n).fill(0) : loop.path.bulges;
  if (!Number.isInteger(n) || n < 2 || bulges.length !== n || pieces.length !== n) return null;
  return bulges.map((bulge, i) => ({ a: [corners[2 * i], corners[2 * i + 1]], b: [corners[(2 * i + 2) % (2 * n)], corners[(2 * i + 3) % (2 * n)]], bulge, piece: pieces[i] }));
}

/** The sides run the other way round: each side turned, in reverse order. */
const turned = (sides: readonly Side[]): Side[] => [...sides].reverse().map((s) => ({ a: s.b, b: s.a, bulge: -s.bulge, piece: { ...s.piece, reversed: !s.piece.reversed } }));

/** A region profile's area, its holes taken off (null when it can't be read). */
export function outlineArea(o: Outline): number | null {
  let sum = 0;
  for (const [k, loop] of [o.outer, ...o.holes].entries()) {
    const read = readLoop(loop, k === 0 ? o.pieces : o.holePieces?.[k - 1]);
    if (read === null) return null;
    const area = Array.isArray(read) ? Math.abs(sidesArea(read)) : Math.PI * read.radius * read.radius;
    sum += k === 0 ? area : -area;
  }
  return sum;
}

/** Two arcs of one circle in a row as one: their turns added (null when the turn reaches a whole circle). */
function joinArcs(x: Side, y: Side): Side | null {
  const turn = 4 * Math.atan(x.bulge) + 4 * Math.atan(y.bulge);
  if (Math.abs(turn) >= 2 * Math.PI - 1e-9) return null;
  return { a: x.a, b: y.b, bulge: Math.tan(turn / 4), piece: x.piece };
}

const samePiece = (p: OutlinePiece, q: OutlinePiece) => p.curve === q.curve && p.index === q.index && p.reversed === q.reversed;

/** A loop's sides with each run of one sketch curve made one side (a line split at a corner another region had there); a loop all of one circle comes back as its ring. */
function tidied(sides: Side[]): Side[] | Omit<Ring, "sign"> | null {
  let loop = [...sides];
  for (let changed = true; changed && loop.length > 1; ) {
    changed = false;
    for (let i = 0; i < loop.length && loop.length > 1; i++) {
      const x = loop[i];
      const j = (i + 1) % loop.length;
      const y = loop[j];
      if (!samePiece(x.piece, y.piece) || (x.bulge === 0) !== (y.bulge === 0) || Math.sign(x.bulge) !== Math.sign(y.bulge)) continue;
      if (x.bulge === 0) {
        loop.splice(i, 1, { ...x, b: y.b });
      } else {
        const joined = joinArcs(x, y);
        if (joined === null) {
          // The whole circle, in two arcs.
          if (loop.length !== 2 || x.piece.curve !== "circle") return null;
          const c = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]);
          const t = 4 * Math.atan(x.bulge);
          const r = c / (2 * Math.sin(Math.abs(t) / 2));
          const h = (c / 2) / Math.tan(t / 2);
          const ux = (x.b[0] - x.a[0]) / c;
          const uy = (x.b[1] - x.a[1]) / c;
          return { center: [(x.a[0] + x.b[0]) / 2 - uy * h, (x.a[1] + x.b[1]) / 2 + ux * h], radius: r, piece: { ...x.piece, reversed: false } };
        }
        loop.splice(i, 1, joined);
      }
      loop.splice(j > i ? j : 0, 1);
      changed = true;
    }
  }
  return loop.length >= 2 ? loop : null;
}

/**
 * The outline of the region that regions `outlines` (of one sketch, each
 * with its pieces) tile side by side, or null when they don't make one
 * region with one outer loop (or its area isn't theirs added, within
 * `REACH` times its edge length: a side moved by 10 nm moves no more).
 */
export function mergedOutline(outlines: readonly Outline[]): Outline | null {
  const sides: Side[] = [];
  const rings: Ring[] = [];
  let total = 0;
  for (const o of outlines) {
    const area = outlineArea(o);
    if (area === null) return null;
    total += area;
    for (const [k, loop] of [o.outer, ...o.holes].entries()) {
      const read = readLoop(loop, k === 0 ? o.pieces : o.holePieces?.[k - 1]);
      if (read === null) return null;
      if (!Array.isArray(read)) rings.push({ ...read, sign: k === 0 ? 1 : -1 });
      // Outer loops counter-clockwise, holes clockwise, so a side two regions share runs once each way.
      else sides.push(...((sidesArea(read) > 0) === (k === 0) ? read : turned(read)));
    }
  }
  // A side run both ways (a shared side), and a ring both ways (a disc in its hole), go.
  const left = sides.filter((s) => !sides.some((t) => near(s.a, t.b) && near(s.b, t.a) && Math.abs(s.bulge + t.bulge) * (Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 2) <= REACH));
  const ringsLeft = rings.filter((r) => !rings.some((q) => q.sign === -r.sign && near(q.center, r.center) && Math.abs(q.radius - r.radius) <= REACH));
  if (left.length === sides.length && ringsLeft.length === rings.length) return null;
  // The sides left, in loops: each corner starts exactly one side.
  const used = new Set<number>();
  const loops: (Side[] | Omit<Ring, "sign"> & { sign?: 1 | -1 })[] = [...ringsLeft];
  for (let start = 0; start < left.length; start++) {
    if (used.has(start)) continue;
    const loop: Side[] = [];
    let at = start;
    while (!used.has(at)) {
      used.add(at);
      loop.push(left[at]);
      const from = left[at].b;
      const next = left.flatMap((s, i) => (near(s.a, from) ? [i] : []));
      if (next.length !== 1) return null;
      at = next[0];
    }
    if (at !== start) return null;
    const tidy = tidied(loop);
    if (tidy === null) return null;
    loops.push(Array.isArray(tidy) ? tidy : { ...tidy, sign: sidesArea(loop) > 0 ? 1 : -1 });
  }
  const isOuter = (l: (typeof loops)[number]) => (Array.isArray(l) ? sidesArea(l) > 0 : l.sign === 1);
  const outers = loops.filter(isOuter);
  if (outers.length !== 1) return null;
  const asLoop = (l: (typeof loops)[number], outer: boolean): { loop: Loop; pieces: OutlinePiece[] } => {
    if (!Array.isArray(l)) return { loop: { circle: { center: l.center, radius: l.radius } }, pieces: [l.piece] };
    // Outer counter-clockwise and holes clockwise, as the kernel gives a region's.
    const run = (sidesArea(l) > 0) === outer ? l : turned(l);
    return { loop: { path: { corners: run.flatMap((s) => s.a), bulges: run.map((s) => s.bulge) } }, pieces: run.map((s) => s.piece) };
  };
  const outer = asLoop(outers[0], true);
  const holes = loops.filter((l) => !isOuter(l)).map((l) => asLoop(l, false));
  const merged: Outline = { outer: outer.loop, holes: holes.map((h) => h.loop), pieces: outer.pieces, holePieces: holes.map((h) => h.pieces) };
  const area = outlineArea(merged);
  const edge = left.reduce((sum, s) => sum + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0) + ringsLeft.reduce((sum, r) => sum + 2 * Math.PI * r.radius, 0);
  return area !== null && Math.abs(area - total) <= REACH * edge ? merged : null;
}
