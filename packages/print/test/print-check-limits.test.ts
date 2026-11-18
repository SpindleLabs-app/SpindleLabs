// Print check (print-check.ts), the limits the first tests left open (test audit 2026-11-18, D-1 to D-4 and D-6):
// how high the weak-spot search reaches, the "resting on" gap (TOUCH_MM) and the bridge tilt (BRIDGE_TILT) at
// 0.9× and 1.1×, bridges turned off the axes (BRIDGE_DIRECTIONS) and the longest bridge of a face whose samples see
// different spans. Every expected value is worked by hand in the comment beside it; each test was run against its
// planted bug (in the audit's D/plants.json) and goes red with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { printCheck, P1S_RULES, type CheckMesh } from "../src/print-check.ts";

type P = [number, number, number];

/** A hexahedron from its eight corners c[i], i = x + 2y + 4z (each 0 low or 1 high), as 12 triangles wound outward. */
function hexa(c: P[]): CheckMesh {
  const quads = [
    [0, 2, 3, 1], // bottom, −z: triangles 0, 1
    [4, 5, 7, 6], // top, +z
    [0, 1, 5, 4], // front, −y
    [2, 6, 7, 3], // back, +y
    [0, 4, 6, 2], // left, −x
    [1, 3, 7, 5], // right, +x
  ];
  return { positions: c.flat(), indices: quads.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]) };
}
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): CheckMesh {
  const c: P[] = [];
  for (let i = 0; i < 8; i++) c.push([i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]);
  return hexa(c);
}
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b} (±${eps})`);
const rad = (deg: number) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- D-1: the weak-spot search reaches the top

test("hand-worked: a neck near the top of a 230 mm part is found (the whole P1S height is searched)", () => {
  // Feet 20 × 20 (400 mm²) from 0 to 215 mm and 225 to 230 mm, a 4 × 4 (16 mm²) neck between. Layers sit at
  // 0.1, 0.3, … mm, so the neck's lowest layer is the first above 215: k = 1075, z = 1075.5 × 0.2 = 215.1 mm.
  // Ratio 16 / 400 = 0.04, under a half: a neck. A search stopping at 200 mm (1000 layers) finds nothing.
  const w = printCheck([box(0, 0, 0, 20, 20, 215), box(8, 8, 215, 12, 12, 225), box(0, 0, 225, 20, 20, 230)]).weakest;
  assert.notEqual(w, null);
  near(w!.z, 215.1, 1e-9);
  near(w!.area, 16, 1e-9);
  near(w!.above, 400, 1e-9);
});

test("hand-worked: at the finest layers (0.12 mm) a neck at the P1S's 250 mm top is still found", () => {
  // The app's finest quality is 0.12 mm layers, the most layers a P1S part can have: 250 / 0.12 = 2083. Feet 400 mm²
  // from 0 to 245 and 248 to 250 mm, neck 16 mm² between. Layer k sits at (k + 0.5) × 0.12: k = 2041 is at 244.98
  // (inside the foot), k = 2042 at 245.1 mm, the neck's first layer.
  const fine = { ...P1S_RULES, layerHeight: 0.12 };
  const w = printCheck([box(0, 0, 0, 20, 20, 245), box(8, 8, 245, 12, 12, 248), box(0, 0, 248, 20, 20, 250)], fine).weakest;
  assert.notEqual(w, null);
  near(w!.z, 245.1, 1e-9);
  near(w!.area, 16, 1e-9);
});

// ---------------------------------------------------------------- D-2: resting on another body, TOUCH_MM

test("resting on a body: 0.9 × 0.05 mm above its top rests, 1.1 × hangs and needs supports", () => {
  // A small box over the big box's top (z = 10). At 10.045 mm the point 0.05 mm under its underside (9.995) is
  // inside the big box: it rests. At 10.055 that point (10.005) is above the big box: nothing under its 5 × 5 mm
  // underside, so both its bottom triangles (12 + 0, 12 + 1) need supports, 25 mm².
  const big = box(0, 0, 0, 20, 20, 10);
  assert.deepEqual(printCheck([big, box(5, 5, 10 + 0.9 * 0.05, 10, 10, 16)]).supports, []);
  const hangs = printCheck([big, box(5, 5, 10 + 1.1 * 0.05, 10, 10, 16)]);
  assert.deepEqual(hangs.supports, [12, 13]);
  near(hangs.supportsArea, 25, 1e-9);
  // A quarter of a mm (more than a whole 0.2 mm layer) prints in mid-air: supports, never "rests".
  assert.deepEqual(printCheck([big, box(5, 5, 10.25, 10, 10, 16)]).supports, [12, 13]);
});

// ---------------------------------------------------------------- D-3: how far from level a bridge may lean

/**
 * A bridge of `gap` mm along x whose pillars' tops and slab rise along y at `deg` degrees: pillars x 0–5 and
 * 5 + gap to 10 + gap, y 0–10, from the plate to z = 10 + y·tan(deg); the slab 2 mm thick over both. The slab's
 * underside z = 10 + y·tan(deg) has outward normal (0, tan, −1)/√(1 + tan²): it leans `deg` from level.
 */
function tiltedBridge(gap: number, deg: number): CheckMesh[] {
  const t = Math.tan(rad(deg));
  const tilted = (x0: number, x1: number, lo: (y: number) => number, hi: (y: number) => number) => {
    const c: P[] = [];
    for (let i = 0; i < 8; i++) {
      const y = i & 2 ? 10 : 0;
      c.push([i & 1 ? x1 : x0, y, i & 4 ? hi(y) : lo(y)]);
    }
    return hexa(c);
  };
  return [
    tilted(0, 5, () => 0, (y) => 10 + y * t),
    tilted(5 + gap, 10 + gap, () => 0, (y) => 10 + y * t),
    tilted(0, 10 + gap, (y) => 10 + y * t, (y) => 12 + y * t),
  ];
}

test("the bridge tilt: an underside 0.9 × 5° off level is bridged, 1.1 × 5° is an overhang needing supports", () => {
  // 4.5°: cos 4.5° = 0.99692 ≥ cos 5° = 0.99619, level enough: an 8 mm bridge (walked: at most 8.4 mm), under 10.
  const level = printCheck(tiltedBridge(8, 0.9 * 5));
  assert.deepEqual([level.supports, level.sag], [[], []]);
  // 5.5°: cos 5.5° = 0.99540 < 0.99619, not a bridge; it leans past 45° (0.99540 > sin 45° = 0.70711), so it is an
  // overhang judged at its centroid. The slab is triangles 24–35, its underside 24 (corners x 0, 0, 18: centroid
  // x = 6) and 25 (x 0, 18, 18: centroid x = 12): both over the gap 5 to 13, nothing under them: supports.
  const leaning = printCheck(tiltedBridge(8, 1.1 * 5));
  assert.deepEqual([leaning.supports, leaning.sag], [[24, 25], []]);
});

// ---------------------------------------------------------------- D-4: bridges turned off the axes

/**
 * The plain bridge (two 5 mm pillars `gap` apart along its own x, a 2 mm slab over them) `width` mm deep, turned
 * `deg` degrees about z round the origin, then moved by (dx, dy).
 */
function turnedBridge(gap: number, deg: number, width = 10, dx = 0, dy = 0): CheckMesh[] {
  const [c, s] = [Math.cos(rad(deg)), Math.sin(rad(deg))];
  const turned = (x0: number, z0: number, x1: number, z1: number) => {
    const k: P[] = [];
    for (let i = 0; i < 8; i++) {
      const [x, y] = [i & 1 ? x1 : x0, i & 2 ? width : 0];
      k.push([c * x - s * y + dx, s * x + c * y + dy, i & 4 ? z1 : z0]);
    }
    return hexa(k);
  };
  return [turned(0, 0, 5, 10), turned(5 + gap, 0, 10 + gap, 10), turned(0, 10, 10 + gap, 12)];
}

test("hand-worked: a 9.5 mm bridge turned 22.5° prints (12 directions), as it does along x", () => {
  // The directions tried are 0.7°, 15.7°, 30.7°, … (15° apart, 0.0123 rad on). The bridge runs at 22.5°: the nearest
  // direction is 15.7°, 6.8° off, so the walk across is 9.5 / cos 6.8° = 9.567 mm, and with the 0.2 mm steps at
  // most 9.967 mm: under 10, it prints. With only 4 directions (0.7°, 45.7°, …) the nearest is 21.8° off:
  // 9.5 / cos 21.8° = 10.23 mm, over 10: "may sag", wrongly.
  const r = printCheck(turnedBridge(9.5, 22.5));
  assert.deepEqual([r.supports, r.sag], [[], []]);
  // The same span along x, as a control.
  assert.deepEqual(printCheck(turnedBridge(9.5, 0)).sag, []);
  // And 11 mm turned 22.5° still may sag: 11 mm is the shortest way across, over 10.
  const long = printCheck(turnedBridge(11, 22.5));
  assert.deepEqual([long.supports, long.sag], [[], [24, 25]]);
});

/** mulberry32: the same seed gives the same parts. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.FISSION_SEED ?? 20261118);

test(`seeded (${SEED}): 80 bridges turned and moved about, fine to 9.5 mm, sagging from 10 to 29 mm`, () => {
  // The model: with 12 directions 15° apart the nearest is at most 7.5° off, so the span found is between the gap and
  // gap / cos 7.5° + 0.4 (two 0.2 mm steps) = gap × 1.00863 + 0.4. So a gap up to 9.5 mm is found ≤ 9.98 (fine),
  // and from 10 to 29 mm between 10 and 29.65 ≤ 30 (may sag). The slab is 30 mm deep so no walk at 7.5° over 30 mm
  // (4 mm sideways) runs off it from a sample 5 mm in from its side or more.
  const r = random(SEED);
  for (let c = 0; c < 80; c++) {
    const short = r() < 0.5;
    const gap = short ? 1 + r() * 8.5 : 10.05 + r() * 18.95;
    const deg = r() * 180;
    const [dx, dy] = [r() * 100 - 50, r() * 100 - 50];
    const got = printCheck(turnedBridge(gap, deg, 30, dx, dy));
    const want = short ? { supports: [], sag: [] } : { supports: [], sag: [24, 25] };
    assert.deepEqual({ supports: got.supports, sag: got.sag }, want, `case ${c}: a ${gap} mm bridge turned ${deg}° and moved by (${dx}, ${dy})`);
    if (!short) assert.ok(got.longestBridge >= gap - 1e-9 && got.longestBridge <= gap * 1.00863 + 0.4 + 1e-9, `case ${c}: ${got.longestBridge} for ${gap}`);
  }
});

// ---------------------------------------------------------------- D-6: the longest bridge is the longest sample's

test("hand-worked: one underside over an 11 mm and a 15 mm gap reports the 15 mm span, not the first one met", () => {
  // Pillars x 0–12, 23–42 and 57–60 (all y 0–10, z 0–10), a 60 × 10 mm slab z 10–12 over them: gaps 11 mm (12 to 23)
  // and 15 mm (42 to 57). The slab is triangles 36–47, its underside 36 (corners (0,0), (0,10), (60,10)) and 37
  // ((0,0), (60,10), (60,0)). Each is judged at its centroid, then the midpoints to its corners in order:
  //   36: centroid (20, 6.7) over the 11 mm gap; (10, 3.3), (10, 8.3) on the first pillar; (40, 8.3) on the second.
  //   37: centroid (40, 3.3) on the second pillar; (20, 1.7) over the 11 mm gap; (50, 6.7), (50, 1.7) over 15 mm.
  // The pillars' faces run along y, so the shortest way across is along x: 11 mm and 15 mm (walked: up to 0.4 more).
  // Both triangles may sag, and the longest bridge is 15 to 15.4 mm. Keeping only each face's first sagging
  // sample would say 11 to 11.4.
  const r = printCheck([box(0, 0, 0, 12, 10, 10), box(23, 0, 0, 42, 10, 10), box(57, 0, 0, 60, 10, 10), box(0, 0, 10, 60, 10, 12)]);
  assert.deepEqual([r.supports, r.sag], [[], [36, 37]]);
  assert.ok(r.longestBridge >= 15 && r.longestBridge <= 15.4 + 1e-9, `${r.longestBridge}`);
});
