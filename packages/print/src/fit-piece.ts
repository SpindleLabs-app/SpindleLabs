// The fit test piece (fits.ts): a plate 120 × 20 × 2 mm made of six 20 mm
// squares, the first three with a 5, 10 and 15 mm hole through, the other
// three with a 15, 10 and 5 mm peg standing 6 mm tall, made here as one
// closed mesh (a binary STL the slicer takes like a body's) without the
// kernel, so it needs no design open.
//
// Each square is meshed between two rings of FIT_SEGMENTS points at the
// same angles: one on the square's edge (where the ray from its centre at
// that angle meets it) and one on the circle. FIT_SEGMENTS is a multiple of
// eight, so the square's corners (at 45°, 135°, …) are ring points and its
// sides are straight runs of them; two squares side by side put the same
// points on the side they share (worked out by symmetry from one octant, so
// they are equal to the last bit), and the plate is watertight. A circle's
// points lie on it, so its widest width, across two opposite points, is the
// size measured; its narrowest is d·cos(π/N), 0.0001 mm under a 15 mm hole's.

import { PIECE } from "./fits.ts";

/** Points round each circle (a multiple of 8). */
export const FIT_SEGMENTS = 256;
/** The squares' side, the plate's thickness and the pegs' height, in mm. */
export const FIT_CELL = 20;
export const FIT_THICK = 2;
export const FIT_PEG = 6;

type V = readonly [number, number, number];

/** The six squares in order along x: [diameter, hole or peg]. */
export const FIT_CELLS: readonly (readonly [number, "hole" | "peg"])[] = [
  [PIECE.sizes[0], "hole"],
  [PIECE.sizes[1], "hole"],
  [PIECE.sizes[2], "hole"],
  [PIECE.sizes[2], "peg"],
  [PIECE.sizes[1], "peg"],
  [PIECE.sizes[0], "peg"],
];

/** The square's ring round (cx, cy), half side a: N points counter-clockwise from angle 0, exact by symmetry. */
function squareRing(cx: number, cy: number, a: number, n: number): [number, number][] {
  const eighth = n / 8;
  // u[j]: how far along a side from its middle the ray at angle 2πj/n meets it, j = 0 … n/8 (the corner, exactly a).
  const u = Array.from({ length: eighth + 1 }, (_, j) => (j === eighth ? a : a * Math.tan((2 * Math.PI * j) / n)));
  const ring: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const run = Math.floor((k + eighth) / (2 * eighth)); // 4 for the last eighth: the right side again
    const side = run % 4; // 0 right, 1 top, 2 left, 3 bottom
    const j = k + eighth - run * 2 * eighth; // 0 … 2·eighth along that side, eighth at its middle
    const t = j >= eighth ? u[j - eighth]! : -u[eighth - j]!;
    const [x, y] = side === 0 ? [a, t] : side === 1 ? [-t, a] : side === 2 ? [-a, -t] : [t, -a];
    ring.push([cx + x, cy + y]);
  }
  return ring;
}

/** The test piece's triangles, wound outward. */
export function fitPieceTriangles(n = FIT_SEGMENTS): [V, V, V][] {
  if (!Number.isInteger(n) || n < 8 || n % 8 !== 0) throw new Error(`the fit piece needs a multiple of 8 points round a circle, not ${n}`);
  const a = FIT_CELL / 2;
  const top = FIT_THICK;
  const length = FIT_CELLS.length * FIT_CELL;
  const tris: [V, V, V][] = [];
  FIT_CELLS.forEach(([d, kind], i) => {
    const cx = a + i * FIT_CELL;
    const cy = a;
    const sq = squareRing(cx, cy, a, n);
    const ci = Array.from({ length: n }, (_, k): [number, number] => [cx + (d / 2) * Math.cos((2 * Math.PI * k) / n), cy + (d / 2) * Math.sin((2 * Math.PI * k) / n)]);
    const at = (p: readonly [number, number], z: number): V => [p[0], p[1], z];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      // Top (z = thickness, facing up) and bottom (z = 0, facing down) between the square and the circle.
      tris.push([at(sq[k]!, top), at(sq[k1]!, top), at(ci[k1]!, top)], [at(sq[k]!, top), at(ci[k1]!, top), at(ci[k]!, top)]);
      tris.push([at(sq[k]!, 0), at(ci[k1]!, 0), at(sq[k1]!, 0)], [at(sq[k]!, 0), at(ci[k]!, 0), at(ci[k1]!, 0)]);
      if (kind === "hole") {
        // The hole's wall, facing in towards its middle.
        tris.push([at(ci[k]!, 0), at(ci[k]!, top), at(ci[k1]!, top)], [at(ci[k]!, 0), at(ci[k1]!, top), at(ci[k1]!, 0)]);
      } else {
        const peak = top + FIT_PEG;
        const mid: [number, number] = [cx, cy];
        // The bottom under the peg, the peg's wall facing out, and its top.
        tris.push([at(mid, 0), at(ci[k1]!, 0), at(ci[k]!, 0)]);
        tris.push([at(ci[k]!, top), at(ci[k1]!, peak), at(ci[k]!, peak)], [at(ci[k]!, top), at(ci[k1]!, top), at(ci[k1]!, peak)]);
        tris.push([at(mid, peak), at(ci[k]!, peak), at(ci[k1]!, peak)]);
      }
      // The plate's outside walls: square sides on the plate's edge (not shared with the next square), facing out.
      const p = sq[k]!;
      const q = sq[k1]!;
      const along = (c: 0 | 1, v: number) => p[c] === v && q[c] === v;
      if (along(1, 0) || along(1, FIT_CELL) || along(0, 0) || along(0, length)) tris.push([at(p, 0), at(q, 0), at(q, top)], [at(p, 0), at(q, top), at(p, top)]);
    }
  });
  return tris;
}

/** The test piece as a binary STL (80-byte header, the count, then each triangle's normal, corners and a 0). */
export function fitPieceStl(n = FIT_SEGMENTS): Uint8Array<ArrayBuffer> {
  const tris = fitPieceTriangles(n);
  const bytes = new Uint8Array(84 + 50 * tris.length);
  const view = new DataView(bytes.buffer);
  const header = "SpindleLabs fit test piece";
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  view.setUint32(80, tris.length, true);
  tris.forEach(([p, q, r], t) => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const nx = u[1]! * v[2]! - u[2]! * v[1]!;
    const ny = u[2]! * v[0]! - u[0]! * v[2]!;
    const nz = u[0]! * v[1]! - u[1]! * v[0]!;
    const len = Math.hypot(nx, ny, nz) || 1;
    const o = 84 + 50 * t;
    [nx / len, ny / len, nz / len, ...p, ...q, ...r].forEach((x, i) => view.setFloat32(o + 4 * i, x, true));
  });
  return bytes;
}
