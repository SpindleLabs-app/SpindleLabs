// Mutation testing's survivors in packages/print (test audit D-5, stryker/print.json): each test here is worked by
// hand and fails under the mutant named beside it. The ones no test can kill are explained in
// packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overhangArea, supportsHint, SUPPORTS_MIN_MM2 } from "../src/overhang.ts";
import { hangingShare, printCheck, rulesProblem, sectionArea, sectionSegments, shoelace, Solid, unionWork, P1S_RULES, type CheckMesh, type PrintRules } from "../src/print-check.ts";

type P = [number, number, number];
/** A binary STL of `tris` (three corners each, in order), its count field `count` (little-endian, as the format says). */
function stl(tris: P[][], count = tris.length): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, count, true);
  tris.forEach((t, i) => t.flat().forEach((x, k) => v.setFloat32(84 + i * 50 + 12 + k * 4, x, true)));
  return out;
}
/** A floor triangle at z = 0 far off to the side, so the lowest point is 0 and nothing else is on the plate. */
const FLOOR: P[] = [[50, 50, 0], [51, 50, 0], [50, 51, 0]];

test("overhang: the count is read little-endian, so triangles past it are not read", () => {
  // Count 2 but three triangles stored: the third, a flat 10 × 10 / 2 = 50 mm² underside, is past the count.
  // Read big-endian (the mutant), 2 would be 33,554,432, cut to the 3 stored, and the 50 mm² would count.
  const under: P[] = [[0, 0, 5], [0, 10, 5], [10, 0, 5]]; // (0,10,0)×(10,0,0) = (0,0,−100): faces down
  assert.equal(overhangArea([stl([FLOOR, under], 2)]), 50);
  assert.equal(overhangArea([stl([FLOOR, FLOOR, under], 2)]), 0);
});

test("overhang: at 0° every face leaning out at all hangs; at 90° only past flat, which nothing is", () => {
  // A strip leaning 10° out of upright, 5 mm up: corners (0,0,5), (10,0,5) and 10 mm up the lean.
  // Its normal leans 10° below level: −n_z = sin 10° > sin 0° = 0, so at angle 0 it hangs (the mutant
  // "angle > 0" refuses 0 and gives 0). The triangle a, d, c: half of 10 × 10 = 50 mm².
  const r = (10 * Math.PI) / 180;
  const a: P = [0, 0, 5], c: P = [10, 10 * Math.sin(r), 5 + 10 * Math.cos(r)], d: P = [0, 10 * Math.sin(r), 5 + 10 * Math.cos(r)];
  const area = overhangArea([stl([FLOOR, [a, d, c]])], 0);
  assert.ok(Math.abs(area - 50) < 1e-4, `${area}`);
});

test("overhang: a corner that is not a number is left out, never spoiling the floor or the rest", () => {
  // A NaN corner must not become the floor (Math.min with NaN is NaN, and the mutant would then answer 0 for all).
  const bad: P[] = [[0, 0, NaN], [1, 0, 3], [0, 1, 3]];
  const under: P[] = [[0, 0, 5], [0, 10, 5], [10, 0, 5]]; // 50 mm² facing down, 5 above the floor
  assert.equal(overhangArea([stl([bad, FLOOR, under])]), 50);
});

test("overhang: a sloping underside touching the plate at one corner only still hangs", () => {
  // Its highest corner is what says it is off the plate (the mutant Math.min would call it resting).
  // Corners (0,0,0), (0,10,1), (10,0,1): u = (0,10,1), v = (10,0,1), u×v = (10·1 − 1·0, 1·10 − 0·1, 0·0 − 10·10)
  // = (10, 10, −100), |u×v| = √10200, −n_z = 100/√10200 ≈ 0.990 > sin 45°: hangs, area √10200 / 2 ≈ 50.4975 mm².
  const slope: P[] = [[0, 0, 0], [0, 10, 1], [10, 0, 1]];
  const area = overhangArea([stl([FLOOR, slope])]);
  assert.ok(Math.abs(area - Math.sqrt(10200) / 2) < 1e-4, `${area}`);
});

test("overhang: the area of a tilted triangle away from the origin, by hand", () => {
  // Corners a = (3, 7, 5), b = a + (1, 4, 1) = (4, 11, 6), c = a + (4, 0, 2) = (7, 7, 7).
  // u = (1,4,1), v = (4,0,2): u×v = (4·2 − 1·0, 1·4 − 1·2, 1·0 − 4·4) = (8, 2, −16), |u×v| = √(64+4+256) = 18,
  // −n_z = 16/18 ≈ 0.889 > sin 45°: hangs, area 9 mm². (Mutants adding a corner's x or y instead of subtracting,
  // or adding uz·vx + ux·vz, change u, v or the normal here, where the corner is not at the origin.)
  const tri: P[] = [[3, 7, 5], [4, 11, 6], [7, 7, 7]];
  assert.equal(overhangArea([stl([FLOOR, tri])]), 9);
});

test("overhang: a face leaning out exactly 45° prints without supports", () => {
  // Corners (0,0,5), (0,10,15), (10,10,15): u = (0,10,10), v = (10,10,10), u×v = (10·10 − 10·10, 10·10 − 0·10, 0·10 − 10·10)
  // = (0, 100, −100): leaning out exactly 45°, −n_z = 100/√20000 = 0.7071067811865475 = sin 45° as computed, not past
  // it, so 0 (the mutant ">=" would count its 70.7 mm²).
  assert.equal(overhangArea([stl([FLOOR, [[0, 0, 5], [0, 10, 15], [10, 10, 15]]])]), 0);
});

test("overhang hint: exactly 5 mm² hanging recommends supports", () => {
  // SUPPORTS_MIN_MM2 is where "recommended" starts (≥), so 5 itself recommends them.
  assert.equal(SUPPORTS_MIN_MM2, 5);
  assert.equal(supportsHint(5, false)?.recommended, true);
});


// ---------------------------------------------------------------- print-check.ts

/** An axis-aligned box as 12 triangles wound outward (corner i = x + 2y + 4z), as print-check.test.ts builds them. */
function boxMesh(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): CheckMesh {
  const c: P[] = [];
  for (let i = 0; i < 8; i++) c.push([i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return { positions: c.flat(), indices: quads.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]) };
}
/** A closed UV sphere (`rings` × `segments` quads, poles as fans), wound outward: many triangles, so a deep box tree. */
function sphereMesh(cx: number, cy: number, cz: number, r: number, rings = 12, segments = 16): CheckMesh {
  const positions: number[] = [cx, cy, cz - r];
  for (let i = 1; i < rings; i++) {
    const th = Math.PI * (i / rings) - Math.PI / 2;
    for (let j = 0; j < segments; j++) {
      const ph = (2 * Math.PI * j) / segments;
      positions.push(cx + r * Math.cos(th) * Math.cos(ph), cy + r * Math.cos(th) * Math.sin(ph), cz + r * Math.sin(th));
    }
  }
  positions.push(cx, cy, cz + r);
  const top = positions.length / 3 - 1;
  const at = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  const indices: number[] = [];
  for (let j = 0; j < segments; j++) indices.push(0, at(1, j + 1), at(1, j)); // bottom fan, facing down
  for (let i = 1; i < rings - 1; i++)
    for (let j = 0; j < segments; j++) indices.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  for (let j = 0; j < segments; j++) indices.push(top, at(rings - 1, j), at(rings - 1, j + 1)); // top fan
  return { positions, indices };
}
/** A seeded random number in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The nearest hit over every triangle, no box tree: what `first` must agree with. */
function brute(s: Solid, o: P, d: P, skip = -1): { t: number; tri: number } {
  let best = { t: Infinity, tri: -1 };
  for (let tri = 0; tri < s.count; tri++) {
    if (tri === skip) continue;
    const t = s.hit(tri, o, d);
    if (t > 0 && t < best.t) best = { t, tri };
  }
  return best;
}

const RULES_OK: PrintRules = { overhangAngle: 45, lineWidth: 0.42, layerHeight: 0.2, bridgeLimit: 10, weakRatio: 0.5 };

test("print check rules: each limit's ends, by the words of the rule", () => {
  const with_ = (k: keyof PrintRules, v: number) => rulesProblem({ ...RULES_OK, [k]: v });
  assert.equal(rulesProblem(P1S_RULES), null);
  // The overhang angle may be 0° and 90° themselves (closed range), not −1, 91 or NaN.
  for (const v of [0, 90]) assert.equal(with_("overhangAngle", v), null);
  for (const v of [-1, 91, NaN]) assert.equal(with_("overhangAngle", v), "the overhang angle is not between 0° and 90°");
  // Line width, layer height: open (0, 10): 0 and 10 refused, 0.01 and 9.99 taken.
  for (const v of [0.01, 9.99]) assert.equal(with_("lineWidth", v), null);
  for (const v of [0, 10, -1, 11, NaN]) assert.equal(with_("lineWidth", v), "the line width is not between 0 and 10 mm");
  for (const v of [0.01, 9.99]) assert.equal(with_("layerHeight", v), null);
  for (const v of [0, 10, -1, 11, NaN]) assert.equal(with_("layerHeight", v), "the layer height is not between 0 and 10 mm");
  // Bridge limit: open (0, 1000).
  for (const v of [0.01, 999]) assert.equal(with_("bridgeLimit", v), null);
  for (const v of [0, 1000, -1, 1001, NaN]) assert.equal(with_("bridgeLimit", v), "the bridge limit is not between 0 and 1000 mm");
  // Weak-spot ratio: (0, 1], 1 itself taken.
  for (const v of [0.01, 1]) assert.equal(with_("weakRatio", v), null);
  for (const v of [0, 1.01, -1, 2, NaN]) assert.equal(with_("weakRatio", v), "the weak-spot ratio is not between 0 and 1");
  // And a check on bad rules marks nothing, even on a part that needs supports (a box floating 1 mm up).
  const floating = [boxMesh(0, 0, 0, 1, 1, 1), boxMesh(5, 5, 2, 10, 10, 4)];
  assert.ok(printCheck(floating, RULES_OK).supports.length > 0);
  assert.deepEqual(printCheck(floating, { ...RULES_OK, lineWidth: 0 }).supports, []);
});

test("print check rays: the box tree finds the same nearest hit and the same inside as every triangle tried in turn", () => {
  // A self-consistency check of the tree (the triangle test itself is checked by hand below): 3 seeds × 400 rays
  // from inside, on and outside a sphere of 16 × 12 quads and a box beside it, some along an axis (zero components).
  const meshes = [sphereMesh(3, -2, 5, 7), boxMesh(-20, -4, 0, -12, 9, 3)];
  for (const seed of [1, 2, 3]) {
    const r = random(seed);
    for (const mesh of meshes) {
      const s = new Solid(mesh);
      for (let n = 0; n < 400; n++) {
        const o: P = [-30 + 50 * r(), -20 + 40 * r(), -10 + 30 * r()];
        let d: P = [r() - 0.5, r() - 0.5, r() - 0.5];
        const axis = n % 4;
        if (axis < 3) d = [axis === 0 ? Math.sign(d[0]) || 1 : 0, axis === 1 ? Math.sign(d[1]) || 1 : 0, axis === 2 ? Math.sign(d[2]) || 1 : 0];
        // From outside, aim at the solid now and then, so most rays hit.
        if (n % 3 === 0) {
          const [lo, hi] = [s.box.lo, s.box.hi];
          const aim: P = [0, 1, 2].map((a) => lo[a] + (hi[a] - lo[a]) * r()) as P;
          d = [aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]];
        }
        const skip = n % 5 === 0 ? Math.floor(r() * s.count) : -1;
        const want = brute(s, o, d, skip);
        const got = s.first(o, d, skip);
        assert.equal(got.t, want.t, `seed ${seed} ray ${n}`);
        if (Number.isFinite(want.t)) assert.equal(got.tri, want.tri, `seed ${seed} ray ${n}`);
      }
      for (let n = 0; n < 400; n++) {
        const p: P = [-25 + 40 * r(), -15 + 30 * r(), -5 + 20 * r()];
        let crossings = 0;
        const odd: P = [0.5377, 0.4153, 0.7339];
        for (let tri = 0; tri < s.count; tri++) if (s.hit(tri, p, odd) > 0) crossings++;
        assert.equal(s.inside(p), crossings % 2 === 1, `seed ${seed} point ${n}`);
      }
    }
  }
});

test("print check rays: a flat face alone (its tree box flat on one axis) is still hit, along each axis", () => {
  // Two triangles of a 10 × 10 square in the plane x = 4 (then y = 4, z = 4): a ray along that axis through the
  // square's middle meets it 4 − (−6) = 10 along. The box around a flat face has no thickness on that axis: only the
  // 1e-9 mm widening keeps the ray inside it.
  const squares: P[][] = [
    [[4, 0, 0], [4, 10, 0], [4, 10, 10], [4, 0, 10]],
    [[0, 4, 0], [0, 4, 10], [10, 4, 10], [10, 4, 0]],
    [[0, 0, 4], [10, 0, 4], [10, 10, 4], [0, 10, 4]],
  ];
  squares.forEach((q, axis) => {
    const s = new Solid({ positions: q.flat(), indices: [0, 1, 2, 0, 2, 3] });
    const o: P = [5, 5, 5];
    o[axis] = -6;
    const d: P = [0, 0, 0];
    d[axis] = 1;
    assert.equal(s.first(o, d).t, 10, `axis ${axis}`);
    // And a slanted ray onto the same face, from the far side: o = middle + 3·(1, 1, 1), its own axis 10, back.
    const o2: P = [5 + 3, 5 + 3, 5 + 3];
    o2[axis] = 4 + 6;
    const d2: P = [-3 / 6, -3 / 6, -3 / 6];
    d2[axis] = -1;
    assert.equal(s.first(o2, d2).t, 6, `axis ${axis}, slanted`);
    // Rays meeting the square on its edge where the next axis is 0, at (4, 0, 5) in turn, t = 1, crossing that axis
    // twice as fast as they cross the square: one from the edge's outside, one from its inside. The widening must be
    // as wide on the square's own axis as on the edge's, or the ray leaves the edge's 1e-9 mm before reaching the square.
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    for (const way of [1, -1]) {
      const o3: P = [0, 0, 0];
      const d3: P = [0, 0, 0];
      [o3[axis], o3[b], o3[c]] = [3, 2 * way, 5];
      [d3[axis], d3[b]] = [1, -2 * way];
      assert.equal(s.first(o3, d3).t, 1, `axis ${axis}, edge, ${way}`);
    }
  });
});

test("print check rays: Möller–Trumbore by hand, its edges and corners counted as hits, grazing rays not", () => {
  // Triangle (0,0,0), (1,0,0), (0,1,0) in z = 0, facing +z; rays straight down from z = 2: t = 2 wherever they land
  // on it, edges and corners included (u = 0, v = 0, u + v = 1 are on it); a hair outside, NaN.
  const s = new Solid({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] });
  const down: P = [0, 0, -1];
  for (const [x, y] of [[0.25, 0.25], [0, 0.5], [0.5, 0], [0.5, 0.5], [0, 0], [1, 0], [0, 1]]) assert.equal(s.hit(0, [x, y, 2], down), 2, `${x}, ${y}`);
  for (const [x, y] of [[-1e-9, 0.5], [0.5, -1e-9], [0.5, 0.5 + 1e-9], [1 + 1e-9, 0], [0, 1 + 1e-9]]) assert.ok(Number.isNaN(s.hit(0, [x, y, 2], down)), `${x}, ${y}`);
  // A ray running all but along the face (its determinant 1e-20, under the 1e-18 floor) is a miss, never a hit far
  // off: from (−5, 0.2, −5.3e-20) along (1, 0, 1e-20) it would reach z = 0 at x = 0.3, inside the triangle.
  assert.ok(Number.isNaN(s.hit(0, [-5, 0.2, -5.3e-20], [1, 0, 1e-20])));
  // Behind the origin: a hit at t = −2 is not the nearest hit ahead (there is none).
  assert.equal(s.first([0.25, 0.25, -2], down).t, Infinity);
  // A ray starting on a triangle that is not skipped: t = 0 is not ahead of it. Two squares, z = 0 and z = −3:
  // from (0.25, 0.75, 0) on the top square's second triangle (1), skipping the first (0), the next hit is 3 below.
  const sq = new Solid({ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, -3, 1, 0, -3, 1, 1, -3, 0, 1, -3], indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6] });
  assert.equal(sq.first([0.25, 0.75, 0], down, 0).t, 3);
});

test("print check rays: a point on a box's low x, y or z face counts as inside; on a high face, outside", () => {
  // The point-in-solid ray goes up and out ((0.54, 0.42, 0.73) normalised). From a point on a low face it starts on
  // that face (t = 0, not counted), then leaves through a high face once: 1 crossing, inside. From a high face it
  // leaves at once: 0, outside. A point on a low face is also on the edge of the solid's box: still looked at.
  // (Off the faces' diagonals, where two triangles meet and the start would be on both.)
  const s = new Solid(boxMesh(0, 0, 0, 10, 10, 10));
  for (const p of [[0, 3, 6], [3, 0, 6], [3, 6, 0]] as P[]) assert.equal(s.inside(p), true, `${p}`);
  for (const p of [[10, 3, 6], [3, 10, 6], [3, 6, 10]] as P[]) assert.equal(s.inside(p), false, `${p}`);
});

test("print check: a body with no triangles beside a real one checks the real one", () => {
  // An empty mesh's box is a point at the origin, never undefined: the sections over z skip it.
  const r = printCheck([{ positions: [], indices: [] }, boxMesh(0, 0, 0, 10, 10, 10), boxMesh(0, 0, 11, 10, 10, 12)]);
  assert.deepEqual(r.supports, [12, 13]); // the floating box's bottom: the empty body adds no triangles, the first box 12
});

type Rect3 = [number, number, number, number, number, number];
/** The exact area of a union of rectangles [x0, y0, x1, y1] (coordinate compression: every cell between neighbouring edges is in or out). */
function unionArea(rects: readonly [number, number, number, number][]): number {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      const [cx, cy] = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
      if (rects.some((r) => r[0] < cx && cx < r[2] && r[1] < cy && cy < r[3])) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  return area;
}
/** The weak-spot rule worked on the layer areas apart from the code: at each layer, the smaller of the biggest area below and above; the least ratio ≤ the limit, the lowest of equals; null for none. */
function weakModel(areas: number[], ratioLimit: number): { k: number; above: number } | null {
  let best: { k: number; ratio: number; above: number } | null = null;
  for (let k = 0; k < areas.length; k++) {
    const below = Math.max(0, ...areas.slice(0, k));
    const above = Math.max(0, ...areas.slice(k + 1));
    const carried = Math.min(below, above);
    if (!(areas[k] > 1e-9 && carried > 0)) continue;
    const ratio = areas[k] / carried;
    if (ratio <= ratioLimit && (best === null || ratio < best.ratio - 1e-9)) best = { k, ratio, above };
  }
  return best && { k: best.k, above: best.above };
}

test("print check sections: overlapping, touching and stacked boxes against the exact union of their rectangles, and the weak spot against the rule", () => {
  // 3 seeds × 60 scenes of 1 to 4 boxes on whole millimetres (so faces and edges often meet exactly: shared walls,
  // edges along one line, one box inside another), the lowest on the plate. The layers' middles (0.1, 0.3, …) never
  // meet a box's top or bottom. Every layer's section area must be the exact union area, and the weakest spot the one
  // the rule picks from those areas, with its height, area and the biggest section above.
  const rules: PrintRules = { ...P1S_RULES, layerHeight: 0.2 };
  let necks = 0;
  for (const seed of [11, 12, 13]) {
    const r = random(seed);
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    for (let scene = 0; scene < 60; scene++) {
      const boxes: Rect3[] = [];
      if (scene % 3 === 0) {
        // A stack: a base, a stem on it and a cap on the stem, each anywhere over the last (often a neck, not always).
        let z = 0;
        for (let i = 0; i < 3; i++) {
          const [x0, y0, h] = [int(0, 4), int(0, 4), int(1, 2)];
          boxes.push([x0, y0, z, x0 + int(1, 6), y0 + int(1, 6), z + h]);
          z += h;
        }
      } else {
        const count = int(1, 4);
        for (let i = 0; i < count; i++) {
          const [x0, y0, z0] = [int(0, 6), int(0, 6), i === 0 ? 0 : int(0, 3)];
          boxes.push([x0, y0, z0, x0 + int(1, 5), y0 + int(1, 5), z0 + int(1, 3)]);
        }
      }
      // Each scene moved as a whole, so the plate is not at 0 nor the corners at the origin: up 0.5, down 2.5, or
      // across by −7.25 and 3.5 (all exact in binary).
      const [mx, my, mz] = [[0, 0, 0.5], [0, 0, -2.5], [-7.25, 3.5, 0]][scene % 3];
      for (const b of boxes) [b[0], b[1], b[2], b[3], b[4], b[5]] = [b[0] + mx, b[1] + my, b[2] + mz, b[3] + mx, b[4] + my, b[5] + mz];
      const meshes = boxes.map((b) => boxMesh(...b));
      const top = Math.max(...boxes.map((b) => b[5]));
      const areas: number[] = [];
      for (let k = 0; k < Math.floor((top - mz) / 0.2); k++) {
        const z = mz + (k + 0.5) * 0.2;
        const want = unionArea(boxes.filter((b) => b[2] < z && z < b[5]).map((b) => [b[0], b[1], b[3], b[4]]));
        areas.push(want);
        const got = sectionArea(meshes, z);
        assert.ok(Math.abs(got - want) < 1e-9, `seed ${seed} scene ${scene} z ${z}: ${got} not ${want} (${JSON.stringify(boxes)})`);
      }
      const want = weakModel(areas, rules.weakRatio);
      const got = printCheck(meshes, rules).weakest;
      if (want === null) assert.equal(got, null, `seed ${seed} scene ${scene} (${JSON.stringify(boxes)})`);
      else {
        necks++;
        assert.ok(got !== null, `seed ${seed} scene ${scene}: no weak spot (${JSON.stringify(boxes)})`);
        assert.ok(Math.abs(got.z - (mz + (want.k + 0.5) * 0.2)) < 1e-9 && Math.abs(got.area - areas[want.k]) < 1e-9 && Math.abs(got.above - want.above) < 1e-9, `seed ${seed} scene ${scene}: ${JSON.stringify([got.z, got.area, got.above])} (${JSON.stringify(boxes)})`);
      }
    }
  }
  assert.ok(necks >= 20, `only ${necks} scenes had a neck`);
});

/** A prism over an anticlockwise polygon from z0 to z1: caps fanned, each side two triangles, wound outward. */
function prismMesh(poly: readonly [number, number][], z0: number, z1: number): CheckMesh {
  const n = poly.length;
  const positions = [...poly.flatMap(([x, y]) => [x, y, z0]), ...poly.flatMap(([x, y]) => [x, y, z1])];
  const indices: number[] = [];
  for (let i = 1; i + 1 < n; i++) indices.push(0, i + 1, i, n, n + i, n + i + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  return { positions, indices };
}
/** The same mesh with each triangle's corners turned round (same winding, a different first corner), chosen by `r`. */
function turned(m: CheckMesh, r: () => number): CheckMesh {
  const idx = m.indices.slice();
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const k = Math.floor(r() * 3);
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let i = 0; i < 3; i++) idx[t + i] = tri[(i + k) % 3];
  }
  return { positions: m.positions, indices: idx };
}
/** Shoelace area of an anticlockwise polygon. */
const polyArea = (p: readonly [number, number][]) => p.reduce((s, [a, b], i) => s + a * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * b, 0) / 2;
/** Sutherland–Hodgman: the part of `subject` inside the convex `clipper` (both anticlockwise). */
function clip(subject: [number, number][], clipper: readonly [number, number][]): [number, number][] {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length > 0; i++) {
    const [[ax, ay], [bx, by]] = [clipper[i], clipper[(i + 1) % clipper.length]];
    const side = ([x, y]: [number, number]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const [P, Q] = [inp[k], inp[(k + 1) % inp.length]];
      const [sp, sq] = [side(P), side(Q)];
      if (sp >= 0) out.push(P);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      }
    }
  }
  return out;
}

test("print check sections: one or two convex prisms, overlapping, nested, slid along an edge, nearly touching or far off, against their exact area", () => {
  // 4 seeds × 300 scenes. A random convex polygon (corners on a circle at sorted angles) extruded, each triangle's
  // corners turned round at random (so a section's piece is found from any corner first), and maybe a second prism:
  // apart, overlapping, inside the first, a copy slid along one of the first's edges (their edges overlapping on one
  // line), or a copy 1e-5 mm off one of its edges (all but touching). Sometimes everything is 900 mm out. The area is
  // the polygons' areas less their overlap, clipped apart from the code (Sutherland–Hodgman).
  for (const seed of [21, 22, 23, 24]) {
    const r = random(seed);
    for (let scene = 0; scene < 300; scene++) {
      const far = scene % 5 === 0 ? 900 : 0;
      const m = 3 + Math.floor(r() * 5), cx = far - 5 + 10 * r(), cy = -far - 5 + 10 * r(), R = 1 + 5 * r();
      const A = Array.from({ length: m }, () => 2 * Math.PI * r()).sort((p, q) => p - q).map((t): [number, number] => [cx + R * Math.cos(t), cy + R * Math.sin(t)]);
      const kind = scene % 6;
      let B: [number, number][] | null = null;
      if (kind === 1) B = A.map(([x, y]): [number, number] => [x + 30, y]);
      else if (kind === 2) {
        const [m2, R2, c2x, c2y] = [3 + Math.floor(r() * 5), 1 + 5 * r(), cx + (r() - 0.5) * 2 * R, cy + (r() - 0.5) * 2 * R];
        B = Array.from({ length: m2 }, () => 2 * Math.PI * r()).sort((p, q) => p - q).map((t): [number, number] => [c2x + R2 * Math.cos(t), c2y + R2 * Math.sin(t)]);
      } else if (kind === 3) {
        const f = 0.2 + 0.6 * r();
        B = A.map(([x, y]): [number, number] => [cx + f * (x - cx), cy + f * (y - cy)]);
      } else if (kind === 4 || kind === 5) {
        const e = Math.floor(r() * m);
        const [p0, p1] = [A[e], A[(e + 1) % m]];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        // Slid along the edge (kind 4), or moved 1e-5 mm straight out of it plus along it (kind 5).
        const along = (r() - 0.5) * 1.6;
        const out = kind === 5 ? 1e-5 / len : 0;
        B = A.map(([x, y]): [number, number] => [x + along * (p1[0] - p0[0]) + out * (p1[1] - p0[1]), y + along * (p1[1] - p0[1]) - out * (p1[0] - p0[0])]);
      }
      const z0 = -2 + 4 * r(), z1 = z0 + 1 + 2 * r(), z = z0 + (z1 - z0) * (0.05 + 0.9 * r());
      let want = polyArea(A);
      const meshes = [turned(prismMesh(A, z0, z1), r)];
      if (B) {
        const inter = clip(A, B);
        want += polyArea(B) - (inter.length >= 3 ? polyArea(inter) : 0);
        meshes.push(turned(prismMesh(B, z0 - r(), z1 + r()), r));
        if (r() < 0.5) meshes.reverse();
      }
      const got = sectionArea(meshes, z);
      assert.ok(Math.abs(got - want) < 1e-6 * Math.max(1, want), `seed ${seed} scene ${scene} (kind ${kind}): ${got} not ${want}`);
    }
  }
});

test("print check sections: a body's bottom counts at its own height, its top does not (half-open), and empty sections", () => {
  // A 4 × 3 box from z = 2 to 5: at z = 2 its section is the whole 12 mm² (side triangles cut at their bottom corners),
  // at z = 5 nothing (no corner above 5), between, 12. The rule is the same for every corner: below or at z is below.
  const b = [boxMesh(1, 1, 2, 5, 4, 5)];
  assert.equal(sectionArea(b, 2), 12);
  assert.equal(sectionArea(b, 3.5), 12);
  assert.equal(sectionArea(b, 5), 0);
  // With a second box standing on it (z 5 to 6, 2 × 2), at z = 5 only the upper box counts.
  assert.equal(sectionArea([...b, boxMesh(2, 2, 5, 4, 4, 6)], 5), 4);
  // The shoelace of nothing is 0 with its centre at the origin, never NaN.
  assert.deepEqual(shoelace([]), { area: 0, centre: [0, 0] });
  // The union's pair count is a count (tests read how it grows).
  unionWork.pairs = 0;
  sectionArea([boxMesh(0, 0, 0, 2, 2, 1), boxMesh(1, 1, 0, 3, 3, 1)], 0.5);
  assert.ok(Number.isInteger(unionWork.pairs) && unionWork.pairs > 0);
});

/** A hexahedron from its eight corners c[i], i = x + 2y + 4z (x, y, z each 0 low or 1 high), wound outward as `boxMesh`. */
function hexaMesh(c: P[]): CheckMesh {
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return { positions: c.flat(), indices: quads.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]) };
}
/** A box from x0..x1, y0..y1 whose bottom and top follow the planes zb(x, y) and zt(x, y), turned by `turn` radians about z through the origin. */
function slabMesh(x0: number, y0: number, x1: number, y1: number, zb: (x: number, y: number) => number, zt: (x: number, y: number) => number, turn = 0): CheckMesh {
  const c: P[] = [];
  for (let i = 0; i < 8; i++) {
    const [x, y] = [i & 1 ? x1 : x0, i & 2 ? y1 : y0];
    const z = i & 4 ? zt(x, y) : zb(x, y);
    c.push([x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn), z]);
  }
  return hexaMesh(c);
}
const flat = (z: number) => () => z;

test("print check counts: exactly 50,000 triangles are checked, one more is not", () => {
  // Zero-area triangles (all three corners one point) count towards the limit but mark nothing. With a box floating
  // over a box (its 2 bottom triangles need supports), 50,000 in all are checked; 50,001 are skipped, nothing marked.
  const parts = (pad: number) => [boxMesh(0, 0, 0, 4, 4, 1), boxMesh(0, 0, 3, 4, 4, 4), { positions: [9, 9, 0.5], indices: new Array(3 * pad).fill(0) }];
  const at = printCheck(parts(50_000 - 24));
  assert.equal(at.skipped, false);
  assert.deepEqual(at.supports, [12, 13]);
  const over = printCheck(parts(50_000 - 23));
  assert.equal(over.skipped, true);
  assert.deepEqual(over.supports, []);
});

test("print check thin walls: an open face (no solid behind it) is never too thin", () => {
  // A lone 10 × 10 square facing up at z = 5: the ray in from it meets nothing, so it has no thickness, not 0.
  const r = printCheck([{ positions: [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5], indices: [0, 1, 2, 0, 2, 3] }]);
  assert.deepEqual(r.thin, []);
  assert.equal(r.thinnest, null);
});

test("print check thin walls: a ray in that meets a face turned towards it has found no wall", () => {
  // One mesh holding a 10 mm box and, inside it, a box 2..8 × 2..8 × 2..9.9 wound outward as well (not a cavity: two
  // solids overlapping in one mesh). Straight down from the big box's top (z = 10) the first face met is the small
  // box's top at 9.9, facing up, back at the ray: no solid wall ends there, so the top is not marked 0.1 mm thin.
  const outer = boxMesh(0, 0, 0, 10, 10, 10);
  const inner = boxMesh(2, 2, 2, 8, 8, 9.9);
  const mesh = { positions: [...outer.positions, ...inner.positions], indices: [...outer.indices, ...inner.indices.map((i) => i + 8)] };
  const r = printCheck([mesh]);
  assert.ok(!r.thin.includes(2) && !r.thin.includes(3), `${r.thin}`);
});

test("print check hanging share: tiny triangles are judged at their one middle, big ones first at 4 × 4", () => {
  const col = (x0: number, y0: number, x1: number, y1: number) => [new Solid(boxMesh(x0, y0, 0, x1, y1, 10))];
  // A 0.3 mm triangle at z = 10, longest side 0.42 < 0.5 mm: one piece, its middle (0.1, 0.1). A column under
  // y 0..1 holds that middle (0.05 under it, z 9.95, is in the column): nothing hangs, 0.
  const tiny: P[] = [[0, 0, 10], [0.3, 0, 10], [0, 0.3, 10]];
  assert.equal(hangingShare(col(-1, 0, 1, 1), tiny), 0);
  // A column under y below 0.05 only: the one middle (y 0.1) is over nothing, so all of it hangs, 1 (the column under
  // a sixth of it is missed: a piece is judged at its middle).
  assert.equal(hangingShare(col(-1, -1, 1, 0.05), tiny), 1);
  // An 8 mm triangle (longest side 11.3: 23 pieces a side) over a 0.4 mm column at 3.7..4.1 × 3.7..4.1: the first
  // look's 4 × 4 pieces have their middles at 2/3 + 2i, 4/3 + 2i mm (i = 0..3), none over the column, so it answers
  // 1 without looking finer (the doc's "errs high").
  const big: P[] = [[0, 0, 10], [8, 0, 10], [0, 8, 10]];
  assert.equal(hangingShare(col(3.7, 3.7, 4.1, 4.1), big), 1);
});

test("print check bridges: over 30 mm (three times the limit) needs supports, never 'may sag'", () => {
  // A 60 × 10 × 1 plate at z = 10 on two 10 high pillars, 0..10 and 50..60: a 40 mm gap. From the samples over the
  // gap (x = 20, 40) one end is 10 or 30 mm away along x and the other 30 or 10, 40 in all, past the 30 mm reach:
  // supports, not a 40 mm sag.
  const r = printCheck([boxMesh(0, 0, 0, 10, 10, 10), boxMesh(50, 0, 0, 60, 10, 10), boxMesh(0, 0, 10, 60, 10, 11)]);
  assert.deepEqual([r.supports, r.sag], [[24, 25], []]);
});

test("print check bridges: a span of exactly the 30 mm reach, walked in 0.2 mm steps, still sags", () => {
  // Pillars to x = 15.1 and from x = 44.9 under a 60 × 10 plate at z = 10. The underside's samples over the gap are at
  // x = 20 and 40 (the triangles' middles and corner midpoints). From x = 20 the walk along 0.0123 rad off x meets the
  // right pillar after 24.9 / cos(0.0123) / 0.2 = 124.51 steps (125 steps, 25.0 mm) and the left after 24.50 (25 steps,
  // 5.0 mm): 30.0 mm, no more than the reach 3 × 10, though the steps add up to a hair over 25 and 5. From x = 40 the
  // same the other way round. So both triangles may sag, the longest bridge 30 mm.
  const r = printCheck([boxMesh(0, 0, 0, 15.1, 10, 10), boxMesh(44.9, 0, 0, 60, 10, 10), boxMesh(0, 0, 10, 60, 10, 11)]);
  assert.deepEqual([r.supports, r.sag], [[], [24, 25]]);
  assert.ok(Math.abs(r.longestBridge - 30) < 1e-6, `${r.longestBridge}`);
});

test("print check bridges: the 12 directions are turned 0.0123 rad anticlockwise from the axes", () => {
  // The scene above made asymmetric and turned 0.0123 rad about z, so the first direction runs straight across the
  // gap: from the samples, 4.9 and 24.996 mm to the pillars (25 and 125 steps: 30.0 mm). Turned the other way (−0.0123)
  // it would cross at 0.0246 rad and need 24.996 / cos(0.0246) = 25.0036 mm, 126 steps: 30.2, past the reach.
  const t = 0.0123;
  const r = printCheck([slabMesh(0, 0, 15.1, 10, flat(0), flat(10), t), slabMesh(44.996, 0, 60, 10, flat(0), flat(10), t), slabMesh(0, 0, 60, 10, flat(10), flat(11), t)]);
  assert.deepEqual([r.supports, r.sag], [[], [24, 25]]);
});

test("print check bridges: an underside tilted 2.6° is walked along its own slope, both ways", () => {
  // A 20 × 14 plate whose underside is the plane z = 10 + 0.035x + 0.03y, 1 mm thick, on two walls under y 0..2 and
  // 12..14 whose tops are that plane: a 10 mm gap along y, nothing under it along x. The walk must rise as the plane
  // does in every direction (dz = −(n_x cos a + n_y sin a)/n_z): along x it runs off the plate, across it meets a wall
  // each way, so nothing needs supports. Any way across the 10 mm gap, rounded up to whole 0.2 mm steps past each
  // wall, is over 10 mm, so the middle may sag. Off the slope by more than 0.05 mm, the walk leaves the plate (or
  // sinks into the walls' side) and finds no end, and the middle would need supports instead.
  const plane = (x: number, y: number) => 10 + 0.035 * x + 0.03 * y;
  const r = printCheck([slabMesh(0, 0, 20, 2, flat(-5), plane), slabMesh(0, 12, 20, 14, flat(-5), plane), slabMesh(0, 0, 20, 14, plane, (x, y) => plane(x, y) + 1)]);
  assert.deepEqual([r.supports, r.sag], [[], [24, 25]]);
});

test("print check bridges: an underside tilted exactly 5° is still a bridge, held by walls 8 mm apart", () => {
  // The underside z = 10 + s·y with s = 0.08748866352592205 (tan 5° to the last bit, chosen so the computed −n_z is
  // exactly cos 5°): within BRIDGE_TILT, so its samples are walked as a bridge and the walls under x ≤ 1 and x ≥ 9
  // hold it. Judged as a leaning face instead, its middles hang over the gap and would need supports.
  const s = 0.08748866352592205;
  const plane = (_x: number, y: number) => 10 + s * y;
  const solid = new Solid(slabMesh(0, 0, 10, 10, plane, (x, y) => plane(x, y) + 1));
  assert.equal(-solid.normal(0).n[2], Math.cos((5 * Math.PI) / 180));
  const r = printCheck([slabMesh(-4, 0, 1, 10, flat(0), plane), slabMesh(9, 0, 14, 10, flat(0), plane), slabMesh(0, 0, 10, 10, plane, (x, y) => plane(x, y) + 1)]);
  assert.deepEqual([r.supports, r.sag], [[], []]);
});

test("print check bridges: a sample resting on a pin is held, however far the next support", () => {
  // A 10 × 10 × 1 plate at z = 5 on eight 0.1 mm pins, one under each of its underside's samples (each triangle's
  // middle and corner midpoints): every sample rests, so nothing hangs, though no walk from a sample meets another pin.
  const samples: [number, number][] = [[10 / 3, 20 / 3], [5 / 3, 10 / 3], [5 / 3, 25 / 3], [20 / 3, 25 / 3], [20 / 3, 10 / 3], [10 / 3, 5 / 3], [25 / 3, 20 / 3], [25 / 3, 5 / 3]];
  const pins = samples.map(([x, y]) => boxMesh(x - 0.05, y - 0.05, 0, x + 0.05, y + 0.05, 5));
  const r = printCheck([...pins, boxMesh(0, 0, 5, 10, 10, 6)]);
  assert.deepEqual([r.supports.filter((t) => t >= 96), r.sag], [[], []]);
});

test("print check solids: a point beside an open mesh's box is not inside it, though its ray crosses the mesh", () => {
  // A lone triangle (an open mesh, as an imported STL can be) standing in the plane x = 5, and one in y = 5. From
  // (4, 2, 2) the ray along (0.5377, 0.4153, 0.7339) reaches x = 5 after 1/0.5377 of its length: y = 2 + 0.4153/0.5377
  // = 2.77, z = 2 + 0.7339/0.5377 = 3.36, inside the triangle (y + z ≤ 10). One crossing is odd, but the point is
  // left of the mesh's box (x < 5), so it is outside. The same in y, from (2, 4, 2): x = 3.29, z = 3.77 at y = 5.
  const odd: P = [0.5377, 0.4153, 0.7339];
  const inX = new Solid({ positions: [5, 0, 0, 5, 10, 0, 5, 0, 10], indices: [0, 1, 2] });
  const inY = new Solid({ positions: [0, 5, 0, 10, 5, 0, 0, 5, 10], indices: [0, 1, 2] });
  assert.ok(inX.hit(0, [4, 2, 2], odd) > 0 && inY.hit(0, [2, 4, 2], odd) > 0);
  assert.equal(inX.inside([4, 2, 2]), false);
  assert.equal(inY.inside([2, 4, 2]), false);
});

test("print check sections: an axis box's section is its area whichever corner each triangle starts at", () => {
  // The box (1, 1, 2)–(5, 4, 5) cut at z = 3.5 is 4 × 3 = 12 mm², however the triangles of its upright faces list
  // their corners (each side's normal has one horizontal part 0, the case a direction test must not divide by).
  const r = random(31);
  for (let i = 0; i < 40; i++) assert.equal(sectionArea([turned(boxMesh(1, 1, 2, 5, 4, 5), r)], 3.5), 12, `turn ${i}`);
});

test("print check sections: one body's section is its own segments unchanged, also beside a body away from the height", () => {
  // One mesh holding a 20 × 20 base (z 0..2) round the origin, a seven-sided stem on it (z 2..4, corners at no round numbers, either side of the axes) and a
  // 20 × 20 top (z 4..6): the stem is the neck, and the weak spot's outline at its first layer (z = 2.1) is that one
  // body's section there, its own segments exactly as sectionSegments gives them (cutting them at their ends and
  // rejoining would round some corners in the last bit). A second body, a box off to the side under z = 1, has no
  // section there and changes nothing.
  const r = random(41);
  for (let i = 0; i < 10; i++) {
    const poly: [number, number][] = [];
    for (let k = 0; k < 7; k++) {
      const a = (2 * Math.PI * k) / 7 + r() * 0.5;
      const rad = 1 + 2 * r();
      poly.push([0.37 + rad * Math.cos(a), -0.11 + rad * Math.sin(a)]);
    }
    const parts = [boxMesh(-10, -10, 0, 10, 10, 2), turned(prismMesh(poly, 2, 4), r), boxMesh(-10, -10, 4, 10, 10, 6)];
    const one: CheckMesh = { positions: [], indices: [] };
    for (const m of parts) {
      const base = one.positions.length / 3;
      one.positions = [...one.positions, ...m.positions];
      one.indices = [...one.indices, ...m.indices.map((v) => v + base)];
    }
    const own = sectionSegments(new Solid(one), 2.1);
    for (const meshes of [[one], [one, boxMesh(30, 0, 0, 33, 3, 1)]]) {
      const weak = printCheck(meshes, RULES_OK).weakest;
      assert.ok(weak !== null && Math.abs(weak.z - 2.1) < 1e-12, `scene ${i}`);
      assert.deepEqual(weak.outline, own, `scene ${i}`);
    }
  }
});

test("print check sections: a body's piece inside another is dropped, whatever its ends' coordinates", () => {
  // A wedge along x (its end x = 4 a single triangle, (4, −10, 0), (4, 10, 0), (4, 0, 10)), cut at z = 5: the
  // rectangle x 0..4, y −5..5, 40 mm², its end piece running from (4, −5) to (4, 5). A box x 2..6, y −3..3 standing
  // through it: 4 × 6 = 24 mm², overlapping x 2..4, y −3..3 = 12. The union is 40 + 24 − 12 = 52.
  const prism = prismMesh([[-10, 0], [10, 0], [0, 10]], 0, 4);
  const wedge: CheckMesh = { positions: prism.positions.map((_, i, p) => p[3 * Math.floor(i / 3) + ((i % 3) + 2) % 3]), indices: prism.indices };
  assert.equal(sectionArea([wedge], 5), 40);
  assert.equal(sectionArea([wedge, boxMesh(2, -3, 0, 6, 3, 10)], 5), 52);
});

test("print check weak spot: the layers stop at the last whole layer, so a top thinner than half a layer is not counted", () => {
  // A 10 × 10 base 5 mm tall, a 2 × 2 stem to z = 10, and a 10 × 10 plate from 10 to 10.15: 10.15 / 0.2 = 50.75, so
  // 50 layers, middles 0.1 … 9.9; the plate's z = 10.1 is past them. Without it nothing above the stem is bigger, so
  // there is no neck (counting it, the stem would be a neck of 4/100).
  const r = printCheck([boxMesh(0, 0, 0, 10, 10, 5), boxMesh(4, 4, 5, 6, 6, 10), boxMesh(0, 0, 10, 10, 10, 10.15)], RULES_OK);
  assert.equal(r.weakest, null);
});

test("print check weak spot: of two necks the narrower wins, though it is higher", () => {
  // 10 × 10 blocks at z 0..2, 4..6 and 8..10, joined by a 6 × 6 neck (z 2..4: 36/100 = 0.36) and a 2 × 2 one (z 6..8:
  // 4/100 = 0.04). Both are under 0.5; the weakest is the 2 × 2, its first layer's middle at z = 6.1.
  const r = printCheck([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(2, 2, 2, 8, 8, 4), boxMesh(0, 0, 4, 10, 10, 6), boxMesh(4, 4, 6, 6, 6, 8), boxMesh(0, 0, 8, 10, 10, 10)], RULES_OK);
  assert.ok(r.weakest !== null && Math.abs(r.weakest.z - 6.1) < 1e-9 && Math.abs(r.weakest.area - 4) < 1e-9, JSON.stringify(r.weakest));
});

test("print check bridges: at exactly 5° the corner samples are walked too, not only the middle", () => {
  // The exact-5° plate (−n_z = cos 5° to the bit) on two 0.1 mm pins, one under each underside triangle's middle and
  // nothing else: the middles rest, but the samples halfway to the corners rest on nothing and find no two ends, so
  // both underside triangles are marked. Judging the middle alone would mark nothing.
  const s = 0.08748866352592205;
  const plane = (_x: number, y: number) => 10 + s * y;
  const plate = slabMesh(0, 0, 10, 10, plane, (x, y) => plane(x, y) + 1);
  const solid = new Solid(plate);
  const middles: P[] = [];
  for (let t = 0; t < solid.count; t++) {
    if (!(-solid.normal(t).n[2] > 0.99)) continue;
    assert.equal(-solid.normal(t).n[2], Math.cos((5 * Math.PI) / 180));
    middles.push([0, 1, 2].map((a) => (solid.corner(t, 0)[a] + solid.corner(t, 1)[a] + solid.corner(t, 2)[a]) / 3) as P);
  }
  assert.equal(middles.length, 2);
  const pins = middles.map(([x, y]) => boxMesh(x - 0.05, y - 0.05, 0, x + 0.05, y + 0.05, plane(x, y)));
  const r = printCheck([...pins, plate]);
  const marked = [...r.supports, ...r.sag].sort((a, b) => a - b);
  assert.deepEqual(marked, [24, 25]);
});

test("print check bridges: the walk keeps to the 5° slope exactly, so walls 0.047 mm under it still hold it", () => {
  // The exact-5° underside z = 10 + s·y over y −5..34, on walls under y −5..0 and 29..34 whose tops are 0.047 mm under
  // the plane (within TOUCH_MM = 0.05): a 29 mm gap, so the underside sags but needs no supports. The walk's rise per
  // mm is −n_y/n_z = tan 5°; off by a factor n_z² = cos² 5° it would drift sin² 5° · tan 5° = 0.00066 mm a mm, and 8
  // mm down the slope be 0.0053 mm above it: 0.05 under that is above the walls' tops, so no end is found.
  const s = 0.08748866352592205;
  const plane = (_x: number, y: number) => 10 + s * y;
  const wall = (y0: number, y1: number) => slabMesh(0, y0, 10, y1, flat(0), (x, y) => plane(x, y) - 0.047);
  const r = printCheck([wall(-5, 0), wall(29, 34), slabMesh(0, -5, 10, 34, plane, (x, y) => plane(x, y) + 1)]);
  assert.deepEqual([r.supports, r.sag], [[], [24, 25]]);
});
