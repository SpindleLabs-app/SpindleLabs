// Overhangs that need supports (overhang.ts): hand-built STL meshes whose
// hanging area is worked out by hand, the 45° boundary at 0.9× and 1.1×,
// the hint's 5 mm² boundary at 0.9× and 1.1×, and bad input adding nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overhangArea, supportsHint, OVERHANG_ANGLE, SUPPORTS_MIN_MM2 } from "../src/overhang.ts";

type P = [number, number, number];
/** A binary STL of `tris` (each three corners, in order), the stored normal left 0 (the code must not read it). */
function stl(tris: P[][], count = tris.length): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, count, true);
  tris.forEach((t, i) => t.flat().forEach((x, k) => v.setFloat32(84 + i * 50 + 12 + k * 4, x, true)));
  return out;
}
/** An axis-aligned box [x0,x1]×[y0,y1]×[z0,z1] as 12 triangles wound outward (right-hand rule). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): P[][] {
  const quad = (a: P, b: P, c: P, d: P): P[][] => [[a, b, c], [a, c, d]];
  return [
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), // bottom, facing −z
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // top, +z
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // front, −y
    ...quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]), // back, +y
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // left, −x
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]), // right, +x
  ];
}
/**
 * A 10 mm × 10 mm strip of underside, its lower edge along x at 5 mm up, leaning out from upright by `lean` degrees:
 * its far edge is 10 sin λ further out in +y and 10 cos λ higher, so λ = 90° is flat and λ = 0 upright. Wound so it
 * faces out and down (outward normal (0, cos λ, −sin λ)). 100 mm², with a floor triangle at z = 0 so it is off the plate.
 */
function strip(lean: number): Uint8Array {
  const r = (lean * Math.PI) / 180;
  const [dy, dz] = [10 * Math.sin(r), 10 * Math.cos(r)];
  const a: P = [0, 0, 5], b: P = [10, 0, 5], c: P = [10, dy, 5 + dz], d: P = [0, dy, 5 + dz];
  // (d−a)×(c−a) = (0,dy,dz)×(10,dy,dz) = (0, 10dz, −10dy): out and down, as wanted.
  return stl([[a, d, c], [a, c, b], [[50, 50, 0], [51, 50, 0], [50, 51, 0]]]);
}

test("a box on the plate hangs nowhere; lifted alone it still sits on the plate (its lowest point goes there)", () => {
  assert.equal(overhangArea([stl(box(0, 0, 0, 10, 10, 10))]), 0);
  assert.equal(overhangArea([stl(box(0, 0, 5, 10, 10, 15))]), 0);
});

test("a 30 × 30 mm plate held 10 mm up hangs by its whole underside: 900 mm², worked by hand", () => {
  // The column (10 × 10 × 10) stands on the plate; the plate (30 × 30 × 2) sits on it as its own body. Its bottom
  // face, 30 × 30 = 900 mm², faces straight down 10 mm up; the column's own faces are upright or on the plate or up.
  const column = stl(box(10, 10, 0, 20, 20, 10));
  const plate = stl(box(0, 0, 10, 30, 30, 12));
  assert.ok(Math.abs(overhangArea([column, plate]) - 900) < 1e-3);
  // Its files in either order: the same.
  assert.ok(Math.abs(overhangArea([plate, column]) - 900) < 1e-3);
});

test("the 45° boundary: a strip leaning 0.9 × 45° prints without, 1.1 × 45° needs support (100 mm²)", () => {
  assert.equal(OVERHANG_ANGLE, 45);
  assert.equal(overhangArea([strip(45 * 0.9)]), 0);
  assert.ok(Math.abs(overhangArea([strip(45 * 1.1)]) - 100) < 1e-2);
  // Flat (90°) hangs; upright (0°) never does.
  assert.ok(Math.abs(overhangArea([strip(90)]) - 100) < 1e-2);
  assert.equal(overhangArea([strip(0)]), 0);
  // A different angle moves the boundary: 49.5° hangs at 45° but not at 60°.
  assert.equal(overhangArea([strip(49.5)], 60), 0);
});

test("faces are oriented by their corners, never the stored normal: the same box wound inward hangs by its top", () => {
  // Every triangle reversed: the top (10 × 10 = 100 mm², 10 mm up) now faces down; the bottom faces up (and is on the plate anyway).
  const inward = box(0, 0, 0, 10, 10, 10).map(([a, b, c]) => [a, c, b]);
  assert.ok(Math.abs(overhangArea([stl(inward)]) - 100) < 1e-3);
});

test("bad input adds nothing and never throws", () => {
  assert.equal(overhangArea([]), 0);
  assert.equal(overhangArea([new Uint8Array(10)]), 0);
  // A count larger than the bytes hold reads only the triangles there.
  assert.equal(overhangArea([stl(box(0, 0, 0, 10, 10, 10), 1000)]), 0);
  // A corner that is not a number: that triangle skipped, the rest counted (the plate's 900 mm² stays).
  const plate = box(0, 0, 10, 30, 30, 12);
  const broken = [[[Number.NaN, 0, 20], [1, 0, 20], [0, 1, 19]] as P[], ...plate];
  assert.ok(Math.abs(overhangArea([stl(box(10, 10, 0, 20, 20, 10)), stl(broken)]) - 900) < 1e-3);
  // A triangle with no area.
  assert.equal(overhangArea([stl([[[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 0, 5], [1, 0, 5], [2, 0, 5]]])]), 0);
  for (const angle of [Number.NaN, -1, 91]) assert.equal(overhangArea([strip(90)], angle), 0, String(angle));
});

test("the hint: recommended from 5 mm² (0.9× says not needed, 1.1× recommended), with the one switch that disagrees", () => {
  assert.equal(SUPPORTS_MIN_MM2, 5);
  const below = supportsHint(SUPPORTS_MIN_MM2 * 0.9, false)!;
  assert.equal(below.recommended, false);
  assert.equal(below.words, "Supports not needed: only a sliver hangs out more than 45°, small enough to print without.");
  assert.equal(below.flip, null);
  const above = supportsHint(SUPPORTS_MIN_MM2 * 1.1, false)!;
  assert.equal(above.recommended, true);
  assert.equal(above.words, "Supports recommended: part of it hangs out more than 45° with nothing under it.");
  assert.deepEqual(above.flip, { to: "normal", label: "Turn supports on" });
  // Supports already on and recommended: nothing to switch.
  assert.equal(supportsHint(900, true)!.flip, null);
  // Nothing hanging with supports on: offer to turn them off.
  assert.deepEqual(supportsHint(0, true), { recommended: false, words: "Supports not needed: nothing hangs out more than 45°.", flip: { to: "off", label: "Turn supports off" } });
  // Nothing known: no hint.
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) assert.equal(supportsHint(bad, false), null, String(bad));
});
