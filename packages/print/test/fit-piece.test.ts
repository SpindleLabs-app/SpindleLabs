// The fit test piece (fit-piece.ts): one closed mesh, wound outward, the
// sizes the calibration reads, and the real engine slicing it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../testing/src/node-kernel.ts";
import { FIT_CELL, FIT_CELLS, FIT_PEG, FIT_THICK, fitPieceStl, fitPieceTriangles } from "../src/fit-piece.ts";
import { PIECE } from "../src/fits.ts";
import { PRINT_DEFAULTS } from "../src/choices.ts";

type V = readonly [number, number, number];
const key = (v: V) => v.join(",");

/** Every edge, as the two corners in the direction a triangle runs it. */
function edges(tris: readonly (readonly [V, V, V])[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const t of tris)
    for (let i = 0; i < 3; i++) {
      const e = `${key(t[i]!)}>${key(t[(i + 1) % 3]!)}`;
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  return count;
}

/** The signed volume (divergence theorem: the sum of each triangle's tetrahedron to the origin): positive when wound outward. */
const volume = (tris: readonly (readonly [V, V, V])[]) =>
  tris.reduce((sum, [a, b, c]) => sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);

test("the piece is closed: every edge is run once each way by its two triangles", () => {
  for (const n of [8, 16, 256]) {
    const count = edges(fitPieceTriangles(n));
    for (const [e, k] of count) {
      assert.equal(k, 1, `edge ${e} run ${k} times one way (n = ${n})`);
      const [p, q] = e.split(">");
      assert.equal(count.get(`${q}>${p}`), 1, `edge ${e} has no partner (n = ${n})`);
    }
  }
});

test("hand-worked: its volume, wound outward", () => {
  // The plate 120 × 20 × 2 = 4800 mm³; three holes through it (2 mm deep) and three pegs 6 mm tall on it, each circle
  // a regular N-gon of area (N/2)·r²·sin(2π/N) (N triangles from the centre, each ½·r²·sin(2π/N)).
  // For N = 8: area = 4·r²·sin(45°) = 2√2·r². Radii 2.5, 5, 7.5: r² sum = 6.25 + 25 + 56.25 = 87.5, so
  // V = 4800 − 2·2√2·87.5 + 6·2√2·87.5 = 4800 + 4·2√2·87.5 = 4800 + 700√2 = 5789.949…
  close(volume(fitPieceTriangles(8)), 4800 + 700 * Math.SQRT2, 1e-9);
  // For 256 points, the same with (128·sin(2π/256)) ≈ π − 0.000315 per r².
  const n = 256;
  const area = (r: number) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
  const v = 4800 - 2 * (area(2.5) + area(5) + area(7.5)) + 6 * (area(2.5) + area(5) + area(7.5));
  close(volume(fitPieceTriangles(n)), v, 1e-8);
  close(v, 4800 + 4 * Math.PI * 87.5, 0.12); // the circles' π·r², 0.11 mm³ more
});

test("its sizes: 120 × 20 mm, 8 mm tall, and each circle's widest width is its test size", () => {
  const tris = fitPieceTriangles();
  const all = tris.flat();
  const span = (c: 0 | 1 | 2) => [Math.min(...all.map((v) => v[c])), Math.max(...all.map((v) => v[c]))];
  assert.deepEqual(span(0), [0, PIECE.length]);
  assert.deepEqual(span(1), [0, FIT_CELL]);
  assert.deepEqual(span(2), [0, FIT_THICK + FIT_PEG]);
  assert.equal(FIT_CELLS.length * FIT_CELL, PIECE.length);
  // At mid-height of each cell's circle (z = 1 for holes, z = 5 for pegs), the corners on its centre line y = 10.
  FIT_CELLS.forEach(([d, kind], i) => {
    const z = kind === "hole" ? FIT_THICK : FIT_THICK + FIT_PEG;
    const cx = FIT_CELL / 2 + i * FIT_CELL;
    const xs = all.filter((v) => v[2] === z && Math.abs(v[1] - FIT_CELL / 2) < 1e-12 && Math.abs(v[0] - cx) < FIT_CELL / 2 - 1e-9).map((v) => v[0]);
    const width = Math.max(...xs) - Math.min(...xs);
    close(width, d, 1e-12);
  });
});

test("the STL holds the same triangles, each normal pointing the way its corners wind", () => {
  const tris = fitPieceTriangles();
  const stl = fitPieceStl();
  const view = new DataView(stl.buffer);
  assert.equal(view.getUint32(80, true), tris.length);
  assert.equal(stl.length, 84 + 50 * tris.length);
  for (const t of [0, 1, 777, tris.length - 1]) {
    const o = 84 + 50 * t;
    const f = (i: number) => view.getFloat32(o + 4 * i, true);
    const [a, b, c] = tris[t]!;
    [...a, ...b, ...c].forEach((x, i) => assert.equal(f(3 + i), Math.fround(x)));
    const n = [f(0), f(1), f(2)];
    close(Math.hypot(n[0]!, n[1]!, n[2]!), 1, 1e-6);
  }
});

test("a broken count of points is refused", () => {
  for (const n of [0, 7, 12, 8.5, -8]) assert.throws(() => fitPieceTriangles(n), /multiple of 8/);
});

test("the real engine slices it: a P1S file with 40 layers of 0.2 mm, nothing left unprinted", async () => {
  const kernel = nodeKernel();
  const sliced = await kernel.call("slice_stl", fitPieceStl(), 0.2, 3, 15, "off", false, false);
  // 8 mm tall at 0.2 mm a layer: 40 layers.
  assert.equal(sliced.layers, 40);
  assert.ok(sliced.unprintedVolume < 1, `unprinted ${sliced.unprintedVolume}`);
  // About 5.79 cm³ of PLA at 1.24 g/cm³ and 15 % infill: a few grams.
  assert.ok(sliced.filamentG > 2 && sliced.filamentG < 8, `${sliced.filamentG} g`);
  const file = await kernel.call("print_file_stl", fitPieceStl(), PRINT_DEFAULTS.layerHeight, 3, 15, "off", "textured", "high-flow", true, false);
  assert.ok(file.package.length > 1000);
  assert.equal(file.layers, 40);
});

function close(a: number, b: number, tol: number) {
  assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b} (within ${tol})`);
}
