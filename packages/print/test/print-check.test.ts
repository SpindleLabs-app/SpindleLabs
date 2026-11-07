// Print check (print-check.ts): parts built by hand from boxes and leaning
// prisms whose findings are worked out by hand in the comments, each rule's
// boundary at 0.9× and 1.1×, and bad input marking nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { printCheck, sectionArea, unionWork, P1S_RULES, MAX_TRIANGLES, type CheckMesh, type PrintRules } from "../src/print-check.ts";

type P = [number, number, number];

/**
 * A hexahedron from its eight corners c[i] with i = x + 2y + 4z (x, y, z each 0 or 1: low or high side), as 12
 * triangles wound outward: a box, or a box sheared along x (a leaning prism).
 */
function hexa(c: P[]): CheckMesh {
  const quads = [
    [0, 2, 3, 1], // bottom, −z
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
/** Triangles of a box (as `box` makes them): bottom 0–1, top 2–3, front 4–5, back 6–7, left 8–9, right 10–11. */
const BOTTOM = [0, 1];
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b} (±${eps})`);

test("a box on the plate prints as it is: nothing marked", () => {
  // Bottom on the plate, upright walls, 10 mm thick everywhere, the same section all the way up.
  const r = printCheck([box(0, 0, 0, 10, 10, 10)]);
  assert.deepEqual([r.supports, r.thin, r.sag, r.weakest, r.skipped], [[], [], [], null, false]);
});

test("a box hanging 1 mm above the plate needs supports under all of it; set on another body, none", () => {
  // The big box is on the plate; the small one floats 1 mm over it: its underside (z = 11) hangs straight down,
  // nothing under it within 0.05 mm, so both its bottom triangles need supports: 5 × 5 = 25 mm².
  const big = box(0, 0, 0, 20, 20, 10);
  const floating = printCheck([big, box(5, 5, 11, 10, 10, 16)]);
  assert.deepEqual(floating.supports, BOTTOM.map((t) => 12 + t));
  near(floating.supportsArea, 25);
  // Resting on the big box's top (z = 10): material just under it, so it is held up.
  const resting = printCheck([big, box(5, 5, 10, 10, 10, 15)]);
  assert.deepEqual(resting.supports, []);
});

test("a plate on a column: its underside needs supports where nothing is under it, 800 mm² by hand", () => {
  // A 30 × 30 mm underside at 10 mm on a 10 × 10 mm column: the column holds 100 mm² of it, 900 − 100 = 800 hang. The
  // underside is one face (two triangles), both marked; the area counts only what hangs, sampled every 0.5 mm or so:
  // within 2 %. The column may stand anywhere under it.
  for (const [x, y] of [[0, 0], [10, 10], [20, 5]]) {
    const r = printCheck([box(x, y, 0, x + 10, y + 10, 10), box(0, 0, 10, 30, 30, 12)]);
    assert.deepEqual(r.supports, [12, 13]);
    near(r.supportsArea, 800, 0.02 * 800);
  }
});

test("on the plate: a body 0.9 × 0.01 mm above the lowest point sits on it, 1.1 × hangs", () => {
  // The plate is at the lowest point of all the bodies (the slicer drops the part onto it): a box at 0 mm sets it.
  // A second box 0.009 mm up is on the plate (overhang.ts's 0.01 mm); 0.011 mm up its underside hangs: supports.
  const at = (z: number) => printCheck([box(0, 0, 0, 10, 10, 10), box(30, 0, z, 40, 10, 10)]);
  assert.deepEqual(at(0.9 * 0.01).supports, []);
  assert.deepEqual(at(1.1 * 0.01).supports, [12, 13]);
});

/**
 * A 10 mm wide (y), 10 mm tall prism on the plate whose right wall leans out from upright by `lean` degrees: the
 * bottom 10 mm along x, the top shifted by 10·tan(lean). Its right wall's outward normal is `lean` below level.
 */
function leaning(lean: number): CheckMesh {
  const s = 10 * Math.tan((lean * Math.PI) / 180);
  const c: P[] = [];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? 10 : 0;
    const z = i & 4 ? 10 : 0;
    c.push([x + (z > 0 ? s : 0), i & 2 ? 10 : 0, z]);
  }
  return hexa(c);
}

test("the overhang angle: a wall leaning 0.9 × 45° prints, 1.1 × 45° needs supports, its area by hand", () => {
  // Right wall (triangles 10, 11) leans out; the left wall leans in (its normal points up), so never hangs.
  assert.deepEqual(printCheck([leaning(0.9 * 45)]).supports, []);
  const r = printCheck([leaning(1.1 * 45)]);
  assert.deepEqual(r.supports, [10, 11]);
  // The wall is 10 mm wide and 10 / cos(49.5°) long up its slope: area = 100 / cos 49.5° = 153.98 mm².
  near(r.supportsArea, 100 / Math.cos((49.5 * Math.PI) / 180), 1e-6);
  // A rule from elsewhere: a 60° printer lets the 49.5° wall print.
  assert.deepEqual(printCheck([leaning(49.5)], { ...P1S_RULES, overhangAngle: 60 }).supports, []);
});

/** Two 5 × 10 × 10 pillars `gap` mm apart along x and a 2 mm slab across their tops: a bridge `gap` long. */
function bridge(gap: number): CheckMesh[] {
  return [box(0, 0, 0, 5, 10, 10), box(5 + gap, 0, 0, 10 + gap, 10, 10), box(0, 0, 10, 10 + gap, 10, 12)];
}

test("bridges: 0.9 × 10 mm prints, 1.1 × 10 mm may sag, past three times the limit it needs supports", () => {
  // 9 mm: the slab's underside is held at both ends 9 mm apart (walked in 0.2 mm steps: up to 9.4 mm), under 10.
  const short = printCheck(bridge(9));
  assert.deepEqual([short.supports, short.sag], [[], []]);
  // 11 mm: held at both ends, but 11 mm apart (at most 11.4 mm, walked): over 10, so it may sag. The slab is
  // triangles 24–35; its underside 24 and 25, each with points over the gap.
  const long = printCheck(bridge(11));
  assert.deepEqual([long.supports, long.sag], [[], [24, 25]]);
  assert.ok(long.longestBridge >= 11 && long.longestBridge <= 11.4 + 1e-9, `${long.longestBridge}`);
  // Its area: the underside (21 × 10 mm) less the pillars' tops under it (2 × 5 × 10): 110 mm², sampled every 0.5 mm
  // or so, so within 2 %.
  near(long.sagArea, 110, 0.02 * 110);
  // 35 mm: further than 30 mm (three times the limit) without an end, so not a bridge: supports.
  assert.deepEqual(printCheck(bridge(35)).supports, [24, 25]);
});

test("a slab on one pillar is a ledge, not a bridge: supports", () => {
  // Held at one end only: every way across the overhanging part runs off the slab's free edge on one side.
  const r = printCheck([box(0, 0, 0, 5, 10, 10), box(0, 0, 10, 15, 10, 12)]);
  assert.deepEqual([r.supports, r.sag], [[12, 13], []]); // the slab's underside
});

test("a ledge stays a ledge beside a taller body: an end must be under the slab, not past its free edge", () => {
  // The slab of the last test ends at x = 15; a tower stands 2 mm past it, up to 20 mm. Walking off the free edge and on
  // across the gap would meet the tower's inside at the slab's height, 7 mm from the pillar side: not an end.
  const r = printCheck([box(0, 0, 0, 5, 10, 10), box(0, 0, 10, 15, 10, 12), box(17, 0, 0, 22, 10, 20)]);
  assert.deepEqual([r.supports, r.sag], [[12, 13], []]);
});

test("walls too thin: 0.9 × 0.42 mm is lost, 1.1 × 0.42 mm prints; the thinnest by hand", () => {
  // An upright 10 × 10 mm wall t thick along x: its two big faces (left 8–9, right 10–11) are t apart along their
  // normals (level, |n_xy| = 1), lost when t < 0.42 mm. Its ends and top are 10 mm through: never thin.
  const lost = printCheck([box(0, 0, 0, 0.9 * 0.42, 10, 10)]);
  assert.deepEqual(lost.thin, [8, 9, 10, 11]);
  near(lost.thinnest!, 0.9 * 0.42, 1e-9);
  near(lost.thinArea, 200); // two faces of 10 × 10 mm
  assert.deepEqual(printCheck([box(0, 0, 0, 1.1 * 0.42, 10, 10)]).thin, []);
});

test("skins too thin: a flat plate under one layer is lost (0.9 × 0.2 mm), over it prints (1.1 ×)", () => {
  // A 10 × 10 mm plate t thick: its top and bottom (normals ±z, |n_z| = 1) are t apart, lost when t < 0.2 mm.
  assert.deepEqual(printCheck([box(0, 0, 0, 10, 10, 0.9 * 0.2)]).thin, [0, 1, 2, 3]);
  assert.deepEqual(printCheck([box(0, 0, 0, 10, 10, 1.1 * 0.2)]).thin, []);
  // The layer height comes from the rules: 0.16 mm layers keep the 0.18 mm plate.
  assert.deepEqual(printCheck([box(0, 0, 0, 10, 10, 0.18)], { ...P1S_RULES, layerHeight: 0.16 }).thin, []);
});

/** A dumbbell: 20 × 20 × 5 mm feet top and bottom and a square neck `side` mm across, 10 mm tall, between them. */
function dumbbell(side: number): CheckMesh[] {
  const a = 10 - side / 2;
  const b = 10 + side / 2;
  return [box(0, 0, 0, 20, 20, 5), box(a, a, 5, b, b, 15), box(0, 0, 15, 20, 20, 20)];
}

test("the weakest spot: a dumbbell's neck, its height, area and centre by hand", () => {
  // Layers at 0.1, 0.3, … mm; the neck (16 mm², 4 × 4) carries 400 mm² feet on both sides: 16 / 400 = 0.04, under
  // a half. Its lowest layer is the first above 5 mm: 5.1 mm. The neck is centred on (10, 10).
  const w = printCheck(dumbbell(4)).weakest!;
  near(w.z, 5.1, 1e-9);
  near(w.area, 16, 1e-9);
  near(w.above, 400, 1e-9);
  near(w.centre[0], 10, 1e-9);
  near(w.centre[1], 10, 1e-9);
  // The outline: the neck's four 4 mm sides (each side two triangles, so two pieces): 16 mm round.
  near(w.outline.reduce((n, [p, q]) => n + Math.hypot(q[0] - p[0], q[1] - p[1]), 0), 16, 1e-9);
  assert.ok(w.outline.every(([p, q]) => p[2] === 5.1 && q[2] === 5.1 || (Math.abs(p[2] - 5.1) < 1e-9 && Math.abs(q[2] - 5.1) < 1e-9)));
});

test("the weak-spot ratio: a neck 0.9 × half of the feet is weak, 1.1 × is not", () => {
  // Neck area = ratio × 400 mm²: 0.45 → side √180; 0.55 → side √220.
  assert.notEqual(printCheck(dumbbell(Math.sqrt(0.9 * 0.5 * 400))).weakest, null);
  assert.equal(printCheck(dumbbell(Math.sqrt(1.1 * 0.5 * 400))).weakest, null);
});

test("no neck: a stem under a plate, or a pyramid of boxes, has no weakest spot", () => {
  // The narrowest layer of each is at an end (nothing bigger below it), so it is not a neck.
  assert.equal(printCheck([box(10, 10, 0, 20, 20, 10), box(0, 0, 10, 30, 30, 12)]).weakest, null);
  assert.equal(printCheck([box(0, 0, 0, 30, 30, 5), box(5, 5, 5, 25, 25, 10), box(10, 10, 10, 20, 20, 15)]).weakest, null);
});

test("sections: overlapping bodies not yet combined are counted once", () => {
  // [0,10]² and [5,15]×[0,10]: 100 + 100 − 50 overlapping = 150 mm².
  near(sectionArea([box(0, 0, 0, 10, 10, 10), box(5, 0, 0, 15, 10, 10)], 5), 150, 1e-9);
  // A box with a 4 × 4 mm square hole through it (four boxes round the hole): 100 − 16 = 84 mm².
  near(sectionArea([box(0, 0, 0, 3, 10, 5), box(7, 0, 0, 10, 10, 5), box(3, 0, 0, 7, 3, 5), box(3, 7, 0, 7, 10, 5)], 2.5), 84, 1e-9);
  near(sectionArea([box(0, 0, 0, 10, 10, 10)], 11), 0);
});

test("bad input marks nothing and never throws", () => {
  const nan: CheckMesh = { positions: [NaN, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  const flat: CheckMesh = { positions: [0, 0, 5, 1, 0, 5, 2, 0, 5], indices: [0, 1, 2] }; // no area
  const loose: CheckMesh = { positions: [0, 0, 5, 1, 0, 5], indices: [0, 1, 7] }; // a corner it has no point for
  for (const meshes of [[], [nan], [flat], [loose], [{ positions: [], indices: [] }]]) {
    const r = printCheck(meshes);
    assert.deepEqual([r.supports, r.thin, r.sag, r.weakest], [[], [], [], null]);
  }
  const rules: PrintRules[] = [
    { ...P1S_RULES, overhangAngle: NaN },
    { ...P1S_RULES, overhangAngle: 91 },
    { ...P1S_RULES, lineWidth: 0 },
    { ...P1S_RULES, layerHeight: -1 },
    { ...P1S_RULES, bridgeLimit: Infinity },
    { ...P1S_RULES, weakRatio: 0 },
  ];
  for (const r of rules) assert.deepEqual(printCheck([box(0, 0, 1, 10, 10, 0.1)], r).thin, []);
});

test("too many triangles to stay live: skipped, saying so", () => {
  const n = MAX_TRIANGLES + 1;
  const r = printCheck([{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: new Array(3 * n).fill(0).map((_, i) => i % 3) }]);
  assert.equal(r.skipped, true);
  assert.deepEqual(r.supports, []);
});

// ---------------------------------------------------------------- seeded random parts against simple models

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
const SEED = Number(process.env.FISSION_SEED ?? 20261105);

/** The model: the exact area of a union of rectangles, by cutting the plane into a grid at every rectangle side. */
function rectanglesArea(rects: [number, number, number, number][]): number {
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

test(`seeded (${SEED}): 300 piles of up to four overlapping boxes, their section's area as the rectangles model says`, () => {
  const r = random(SEED);
  // Sides on a 0.5 mm grid so boxes often share a side or a corner exactly, as CAD parts do.
  const grid = (lo: number, hi: number) => lo + Math.round((r() * (hi - lo)) / 0.5) * 0.5;
  for (let c = 0; c < 300; c++) {
    const rects: [number, number, number, number][] = [];
    const meshes: CheckMesh[] = [];
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const [x0, y0] = [grid(0, 20), grid(0, 20)];
      const [x1, y1] = [x0 + grid(0.5, 15), y0 + grid(0.5, 15)];
      rects.push([x0, y0, x1, y1]);
      meshes.push(box(x0, y0, 0, x1, y1, 10));
    }
    const z = 0.1 + r() * 9.8;
    const want = rectanglesArea(rects);
    const got = sectionArea(meshes, z);
    assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `case ${c}: ${JSON.stringify(rects)} at z ${z}: ${got} mm², the model says ${want}`);
  }
});

test(`seeded (${SEED}): 300 boxes near the thin limits, their thin faces as t < w and t < h say`, () => {
  const r = random(SEED + 1);
  for (let c = 0; c < 300; c++) {
    // Each size between half and twice its limit, kept 2 % or more from it (the model is exact; this keeps the case clear).
    const size = (limit: number) => {
      for (;;) {
        const s = limit * (0.5 + 1.5 * r());
        if (Math.abs(s / limit - 1) > 0.02) return s;
      }
    };
    const [a, b, h] = [size(0.42), r() < 0.5 ? size(0.42) : 5 + 10 * r(), size(0.2)];
    const [x, y] = [r() * 50 - 25, r() * 50 - 25];
    const want = sorted([...(h < 0.2 ? [0, 1, 2, 3] : []), ...(b < 0.42 ? [4, 5, 6, 7] : []), ...(a < 0.42 ? [8, 9, 10, 11] : [])]);
    assert.deepEqual(sorted(printCheck([box(x, y, 0, x + a, y + b, h)]).thin), want, `case ${c}: ${a} × ${b} × ${h} mm at (${x}, ${y})`);
  }
});

test(`seeded (${SEED}): 200 leaning walls, supports exactly when they lean past 45°`, () => {
  const r = random(SEED + 2);
  for (let c = 0; c < 200; c++) {
    const lean = r() * 80;
    if (Math.abs(lean - 45) < 0.01) continue;
    const got = printCheck([leaning(lean)]).supports;
    assert.deepEqual(got, lean > 45 ? [10, 11] : [], `case ${c}: leaning ${lean}°`);
  }
});

test(`seeded (${SEED}): 120 bridges moved about, fine to 10 mm, sagging to 30 mm, then supports`, () => {
  const r = random(SEED + 3);
  for (let c = 0; c < 120; c++) {
    const gap = 1 + r() * 39;
    // Walked in 0.2 mm steps, a span is found between the gap and 0.4 mm more: leave out gaps that close to a limit.
    if ((gap > 9.6 && gap <= 10) || (gap > 29.6 && gap <= 30)) continue;
    const [dx, dy] = [r() * 100 - 50, r() * 100 - 50];
    const moved = bridge(gap).map((m) => ({ ...m, positions: m.positions.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)) }));
    const got = printCheck(moved);
    const want = gap <= 10 ? { supports: [], sag: [] } : gap <= 30 ? { supports: [], sag: [24, 25] } : { supports: [24, 25], sag: [] };
    assert.deepEqual({ supports: got.supports, sag: got.sag }, want, `case ${c}: a ${gap} mm bridge moved by (${dx}, ${dy})`);
  }
});

// ---------------------------------------------------------------- big scenes stay quick (SpindleLabs#398)

test("nine cubes standing apart: the union tries no pair of their outlines, and still counts each cube once", () => {
  // Nine 10 mm cubes in a row, 20 mm apart (x from 20i to 20i + 10). Cut at z = 5, each cube's section is a square
  // of 8 segments (each side is two triangles, each cut once). The nearest two squares are 10 mm apart, far more than
  // the 1e-6 mm + 1e-3 × span a segment's box is widened by, so no segment can cut another: 0 pairs tried, where trying
  // every pair was 9 × 8 × 8 × 8 = 4608 (and seconds a frame for a scene of rounded bodies). Area: 9 × 10 × 10 = 900.
  const cubes = Array.from({ length: 9 }, (_, i) => box(20 * i, 0, 0, 20 * i + 10, 10, 10));
  unionWork.pairs = 0;
  near(sectionArea(cubes, 5), 900);
  assert.equal(unionWork.pairs, 0);
});

test("two cubes overlapping: only the halves meeting near the overlap's corners are tried, and the area is the union's", () => {
  // A is [0, 10]², B is [5, 15]² (both z 0 to 10), cut at z = 5. Each side is two triangles split along a diagonal,
  // which the level cut meets at the side's middle, so each square is eight 5 mm halves. The outlines cross at
  // (10, 5) and (5, 10). A's halves whose (hair-widened) boxes meet a B half: top x 0–5 and x 5–10 at y 10 each meet
  // B's left halves y 5–10 and y 10–15 at x 5 (touching at (5, 10)), and right y 0–5 and y 5–10 at x 10 each meet
  // B's bottom halves x 5–10 and x 10–15 at y 5 (touching at (10, 5)): 4 × 2 = 8. A's bottom and left halves are
  // 5 mm from every B half. By symmetry B's halves try 8 of A's: 16 pairs, where every pair was 2 × 8 × 8 = 128.
  // Area: 100 + 100 − 25 (the [5, 10]² overlap) = 175.
  unionWork.pairs = 0;
  near(sectionArea([box(0, 0, 0, 10, 10, 10), box(5, 5, 0, 15, 15, 10)], 5), 175);
  assert.equal(unionWork.pairs, 16);
});
