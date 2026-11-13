// Unit tests for the kernel calls' time limits (step 35d3, time-limit.ts).
// Run with `npm test` (Node's built-in test runner).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BodySpec } from "../src/kernel/kernel-types.ts";
import { booleanUnits, calibrate, CALIBRATION_TARGET, CALIBRATION_TOOL, sliceUnits, supportUnits, buildFaces, buildUnits, callUnits, facesSize, HEADROOM, LIMIT_FLOOR_MS, limitMs, MAX_MEETING_POINTS, MOST_PAIRS, regionsUnits, sketchUnits, solveUnits, UNITS_PER_ARC_CUBED, UNITS_PER_CHECKED_TRIANGLE, UNITS_PER_CORNER, UNITS_PER_MEETING, UNITS_PER_PAIR } from "../src/kernel/time-limit.ts";

/** An L in plan, 6 corners, with a round hole: 2 caps + 6 sides + 1 round side = 9 faces. */
const lWithHole = {
  extrude: {
    profile: { outer: { path: { corners: [0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20], bulges: [] } }, holes: [{ circle: { center: [5, 5], radius: 2 } }] },
    distance: 3,
  },
} satisfies BodySpec;

test("a build's faces and units by hand", () => {
  // The L: 6 corners, the circle one more: 7 corners, 7 × 11 = 77 units; faces 2 caps + 7 sides = 9.
  assert.equal(buildFaces(lWithHole), 9);
  assert.equal(buildUnits(lWithHole), 77);
  // Moved, the same body: the moves don't count.
  assert.equal(buildUnits({ moved: { body: lWithHole, moves: [{ move: [1, 2, 3] }] } }), 77);
  // A box: 6 faces, its 4 profile corners × 11 = 44; a cylinder 3 faces, 11; a sphere 2 faces, 90 (its mesh).
  assert.equal(buildFaces({ box: { width: 1, depth: 1, height: 1 } }), 6);
  assert.equal(buildUnits({ box: { width: 1, depth: 1, height: 1 } }), 44);
  assert.equal(buildFaces({ cylinder: { radius: 1, height: 1 } }), 3);
  assert.equal(buildUnits({ cylinder: { radius: 1, height: 1 } }), 11);
  assert.equal(buildFaces({ sphere: { radius: 1 } }), 2);
  assert.equal(buildUnits({ sphere: { radius: 1 } }), 90);
});

test("a boolean's units by hand: each tool meets every piece so far, each step capped at the costliest legal boolean", () => {
  const cube = facesSize(6);
  // One tool: 6 × 6 = 36 pairs, × 0.17 = 6.12 units.
  assert.ok(Math.abs(booleanUnits(cube, [cube]) - 6.12) < 1e-9);
  // Two tools: 36, then the second meets the target's 6 faces and the first tool's 6: 12 × 6 = 72; 108 × 0.17 = 18.36.
  assert.ok(Math.abs(booleanUnits(cube, [cube, cube]) - 18.36) < 1e-9);
  // Two 1,000-face bodies: 1,000,000 pairs, capped at 450² = 202,500, × 0.17 = 34,425.
  assert.ok(Math.abs(booleanUnits(facesSize(1000), [facesSize(1000)]) - 34_425) < 1e-6);
  assert.equal(MOST_PAIRS * UNITS_PER_PAIR, 34_425);
  // No tools, no work.
  assert.equal(booleanUnits(cube, []), 0);
});

test("a sketch's units by hand: 0.25 a curve and 0.00012 a pair", () => {
  // 100 curves: 25 + 0.00012 × 10,000 = 26.2; 2,000: 500 + 480 = 980.
  assert.ok(Math.abs(sketchUnits(100) - 26.2) < 1e-9);
  assert.ok(Math.abs(sketchUnits(2000) - 980) < 1e-9);
  assert.equal(callUnits("sketch_outline", [Array(1000).fill(null), Array(600).fill(null), Array(400).fill(null)] as never, () => undefined), sketchUnits(2000));
});

test("a sketch's regions by hand: the outline's units and 0.03 a point where curves may meet, two a pair, at most 100,000 (48d3)", () => {
  assert.equal(UNITS_PER_MEETING, 0.03);
  assert.equal(MAX_MEETING_POINTS, 100_000);
  // 10 curves: 2.5 + 0.00012 × 100 = 2.512, and 10 × 9 = 90 points (45 pairs, twice each) × 0.03 = 2.7: 5.212.
  assert.ok(Math.abs(regionsUnits(10) - 5.212) < 1e-9, `${regionsUnits(10)}`);
  // 600 curves (the 300 × 300 grid): 150 + 43.2, and 600 × 599 = 359,400 points, past the 100,000 a sketch may have: 3,000 more, 3,193.2.
  assert.ok(Math.abs(regionsUnits(600) - 3193.2) < 1e-9, `${regionsUnits(600)}`);
  // The cap's edge: 316 × 315 = 99,540 points (under), 317 × 316 = 100,172 (over, so 100,000).
  assert.ok(Math.abs(regionsUnits(316) - sketchUnits(316) - 0.03 * 99_540) < 1e-9);
  assert.ok(Math.abs(regionsUnits(317) - sketchUnits(317) - 0.03 * 100_000) < 1e-9);
  // One curve meets nothing; none is no work.
  assert.equal(regionsUnits(1), sketchUnits(1));
  assert.equal(regionsUnits(0), 0);
  // The call counts lines, circles and arcs together; the outline's call keeps the outline's units.
  assert.equal(callUnits("sketch_regions", [Array(300).fill(null), Array(200).fill(null), Array(100).fill(null)] as never, () => undefined), regionsUnits(600));
  assert.equal(callUnits("sketch_outline", [Array(300).fill(null), Array(200).fill(null), Array(100).fill(null)] as never, () => undefined), sketchUnits(600));
  assert.equal(callUnits("sketch_regions", [undefined, [], []] as never, () => undefined), 0, "the wrong shape: the floor");
});

test("the limit is the floor, or units × the calibration × HEADROOM above it", () => {
  assert.equal(HEADROOM, 4);
  assert.equal(limitMs(0, 1), LIMIT_FLOOR_MS);
  // 1,000 units at 2 ms a unit: 8,000 ms, under the floor.
  assert.equal(limitMs(1000, 2), LIMIT_FLOOR_MS);
  // 2,000 at 2 ms: 16,000 ms.
  assert.equal(limitMs(2000, 2), 16_000);
  // The browser checks' own floor.
  assert.equal(limitMs(0, 1, 3000), 3000);
});

test("each call's units: the quick ones none, a body's view its mesh, a build its corners", () => {
  const sizes = new Map([[7, { faces: 9, mesh: 77 }]]);
  const sizeOf = (h: number) => sizes.get(h);
  for (const op of ["kernel_version", "snap_to_grid", "place_freely", "body_free", "body_count", "wasm_bytes"] as const) assert.equal(callUnits(op, [] as never, sizeOf), 0, op);
  assert.equal(callUnits("body_view", [7], sizeOf), 77);
  assert.equal(callUnits("body_stl", [7, "x"], sizeOf), 77);
  assert.equal(callUnits("body_step", [7], sizeOf), 77);
  assert.equal(callUnits("body_view", [8], sizeOf), 0, "an unknown handle is refused at once: the floor");
  assert.equal(callUnits("body_build", [lWithHole], sizeOf), 77);
  assert.equal(callUnits("export_stl", [lWithHole, "x"], sizeOf), 77);
  assert.equal(callUnits("make_extrude", [lWithHole.extrude.profile, 3], sizeOf), 7 * UNITS_PER_CORNER);
  assert.equal(callUnits("make_sphere", [5], sizeOf), 90);
});

/** A binary STL of triangles given by their corners' z (x and y anything), with `claimed` triangles in its count. */
function stl(zs: number[][], claimed = zs.length): Uint8Array {
  const out = new Uint8Array(84 + 50 * zs.length);
  const data = new DataView(out.buffer);
  data.setUint32(80, claimed, true);
  zs.forEach((tri, t) => tri.forEach((z, c) => data.setFloat32(84 + 50 * t + 12 + 12 * c + 8, z, true)));
  return out;
}

test("a slice's units by hand: its triangles times its layers, over every file given back to back", () => {
  // 2 triangles from z 0 to 10 at 0.2 mm: 50 layers, 2 × 50 × 0.27 = 27 units.
  const a = stl([
    [0, 0, 10],
    [10, 10, 0],
  ]);
  assert.ok(Math.abs(sliceUnits(a, 0.2) - 27) < 1e-9);
  // Another file after it, 1 triangle from z 5 to 20: 3 triangles, z 0 to 20, 100 layers: 3 × 100 × 0.27 = 81 units.
  const b = stl([[5, 20, 5]]);
  const both = new Uint8Array([...a, ...b]);
  assert.ok(Math.abs(sliceUnits(both, 0.2) - 81) < 1e-9);
  // A second file claiming more triangles than it holds: the kernel refuses it at once, only the first counts.
  const short = new Uint8Array([...a, ...stl([[5, 20, 5]], 2)]);
  assert.ok(Math.abs(sliceUnits(short, 0.2) - 27) < 1e-9);
  // Nothing readable, a flat file, or no layer height: no units, the floor.
  assert.equal(sliceUnits(new Uint8Array(10), 0.2), 0);
  assert.equal(sliceUnits(stl([[1, 1, 1]]), 0.2), 0);
  assert.equal(sliceUnits(a, 0), 0);
  // Read from a view into a bigger buffer, as the worker gets it.
  const offset = new Uint8Array(4 + a.length);
  offset.set(a, 4);
  assert.ok(Math.abs(sliceUnits(offset.subarray(4), 0.2) - 27) < 1e-9);
  assert.equal(callUnits("slice_stl", [a as Uint8Array<ArrayBuffer>, 0.2, 3, 15, "off"], () => undefined), sliceUnits(a, 0.2));
});

/** Fake kernel calls for the calibration: each boolean takes `ms` on a fake clock; it counts what is kept. */
function fakeCalls(ms: number, failAt = Infinity) {
  let clock = 0;
  let next = 1;
  const kept = new Set<number>();
  const specs: unknown[] = [];
  let booleans = 0;
  return {
    kept,
    specs,
    booleans: () => booleans,
    calls: {
      build: (spec: BodySpec) => (specs.push(spec), kept.add(next), next++),
      boolean: (target: number, tools: number[], op: string) => {
        assert.deepEqual([target, tools, op], [1, [2], "union"]);
        if (++booleans >= failAt) throw new Error("planted");
        clock += ms;
        kept.add(next);
        return { bodies: [next++], history: [] };
      },
      free: (body: number) => void assert.ok(kept.delete(body), `body ${body} freed once`),
      now: () => clock,
    },
  };
}

test("the calibration times the cubes' boolean for 50 ms and 3 runs at least, and keeps nothing", () => {
  // 7 ms a run: 7 runs make 49 ms, the 8th 56 ms ≥ 50: 56 / 8 = 7 ms a unit.
  const quick = fakeCalls(7);
  assert.equal(calibrate(quick.calls), 7);
  assert.equal(quick.booleans(), 8);
  assert.deepEqual([...quick.kept], []);
  assert.deepEqual(quick.specs, [CALIBRATION_TARGET, CALIBRATION_TOOL]);
  // 100 ms a run (a slow phone): still 3 runs, 300 / 3 = 100.
  const slow = fakeCalls(100);
  assert.equal(calibrate(slow.calls), 100);
  assert.equal(slow.booleans(), 3);
  // A clock that never moves: 1,000 runs, then 0 (the client takes its default for 0).
  const stopped = fakeCalls(0);
  assert.equal(calibrate(stopped.calls), 0);
  assert.equal(stopped.booleans(), 1000);
  // A boolean that throws: the cubes are still freed, and the error goes on.
  const failing = fakeCalls(7, 2);
  assert.throws(() => calibrate(failing.calls), /planted/);
  assert.deepEqual([...failing.kept], [], "the first run's result and both cubes freed");
});

test("callUnits gives 0 (the floor) for arguments of the wrong shape, so the kernel can answer bad-request instead of a TypeError", () => {
  const none = () => undefined;
  // Cold read 2026-10-31: each of these threw a TypeError before.
  assert.equal(callUnits("make_extrude", ["nonsense", 1] as never, none), 0);
  assert.equal(callUnits("make_extrude", [{ outer: [] }, 1] as never, none), 0, "a profile with no holes list");
  assert.equal(callUnits("body_build", [null] as never, none), 0);
  assert.equal(callUnits("sketch_outline", [undefined, [], []] as never, none), 0);
  assert.equal(callUnits("body_boolean", [1, "x", "union"] as never, none), 0);
  assert.equal(callUnits("slice_stl", [null, "a"] as never, none), 0);
  // A well-shaped call is unchanged.
  assert.equal(callUnits("sketch_outline", [[1], [2], [3]] as never, none), sketchUnits(3));
});

/** A binary STL of a w × d × h box from the origin: 12 triangles (2 a face), normals left zero. */
function boxStl(w: number, d: number, h: number): Uint8Array {
  const v = (x: number, y: number, z: number) => [x * w, y * d, z * h];
  const quads = [
    [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  const tris = quads.flatMap(([a, b, c, e]) => [[a, b, c], [a, c, e]]);
  const out = new Uint8Array(84 + 50 * tris.length);
  const data = new DataView(out.buffer);
  data.setUint32(80, tris.length, true);
  tris.forEach((tri, t) => tri.forEach((p, c) => p.forEach((x, k) => data.setFloat32(84 + 50 * t + 12 + 12 * c + 4 * k, x, true))));
  return out;
}

test("a big flat-sided part costs by its area too: a box is 12 triangles however big (slicer hunt M8), worked by hand", () => {
  // 100 × 100 × 10 mm at 0.2 mm: 50 layers. Triangles: 12 × 50 × 0.27 = 162. Area: 1e4 mm² × 50 layers × 1.1e-3 = 550, times the fill share.
  const box = boxStl(100, 100, 10);
  assert.ok(Math.abs(sliceUnits(box, 0.2, 100) - 550 * 1.25) < 1e-6, "100 %: share 0.25 + 1 = 1.25 → 687.5");
  assert.ok(Math.abs(sliceUnits(box, 0.2, 15) - 550 * 0.4) < 1e-6, "15 %: share 0.4 → 220, over the triangles' 162");
  assert.ok(Math.abs(sliceUnits(box, 0.2, 0) - 162) < 1e-6, "no infill: share 0.25 → 137.5, under the triangles' 162, which count");
  // A small part keeps its triangle count: a 20 mm cube at 0.2 mm, 100 layers: 12 × 100 × 0.27 = 324 over 20² × 100 × 1.1e-3 × 0.4 = 17.6.
  assert.ok(Math.abs(sliceUnits(boxStl(20, 20, 20), 0.2, 15) - 324) < 1e-9);
  // The default, when none is given, is the P1S's 15 %.
  assert.equal(sliceUnits(box, 0.2), sliceUnits(box, 0.2, 15));
  // The hunt's box, 246 × 246 × 245 mm at 100 %, was 1,764 units of triangles and needed at least 8.7 times that.
  const big = boxStl(246, 246, 245);
  assert.ok(sliceUnits(big, 0.2, 100) >= 8.7 * 1764, `${sliceUnits(big, 0.2, 100)} units`);
  // Fewer layers, fewer units; a wider box, more.
  assert.ok(sliceUnits(boxStl(100, 100, 10), 0.28, 100) < sliceUnits(box, 0.2, 100));
  assert.ok(sliceUnits(boxStl(200, 100, 10), 0.2, 100) > sliceUnits(box, 0.2, 100));
  // A call carries the infill: callUnits reads it from slice_stl's fourth argument.
  assert.equal(callUnits("slice_stl", [big as Uint8Array<ArrayBuffer>, 0.2, 3, 100, "off"], () => undefined), sliceUnits(big, 0.2, 100));
  assert.equal(callUnits("print_file_stl", [big as Uint8Array<ArrayBuffer>, 0.2, 3, 0, "off", "textured"], () => undefined), sliceUnits(big, 0.2, 0));
  // Infill nonsense is the default's: never NaN units.
  assert.ok(Number.isFinite(sliceUnits(box, 0.2, NaN)));
});

/** A binary STL of a w × d × h box from (x, y, z), its triangles wound counter-clockwise seen from outside (as the kernel writes them), so the bottom faces down. */
function outwardBox(w: number, d: number, h: number, [x, y, z]: [number, number, number] = [0, 0, 0]): Uint8Array {
  const v = (i: number, j: number, k: number) => [x + i * w, y + j * d, z + k * h];
  // Each face's corners counter-clockwise seen from outside it.
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], // bottom, facing down
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], // top
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], // front (y 0)
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)], // back
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)], // left (x 0)
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], // right
  ];
  const tris = quads.flatMap(([a, b, c, e]) => [[a, b, c], [a, c, e]]);
  const out = new Uint8Array(84 + 50 * tris.length);
  const data = new DataView(out.buffer);
  data.setUint32(80, tris.length, true);
  tris.forEach((tri, t) => tri.forEach((p, c) => p.forEach((n, k) => data.setFloat32(84 + 50 * t + 12 + 12 * c + 4 * k, n, true))));
  return out;
}

/** A plate on a column, as the slicer hunt's: a 10 × 10 × 20 mm column and a `plate` × `plate` × 3 mm plate on its top, centred on it. */
const plateOnColumn = (plate: number, column = 20) => new Uint8Array([...outwardBox(10, 10, column), ...outwardBox(plate, plate, 3, [5 - plate / 2, 5 - plate / 2, column])]);

test("supports cost by the overhangs they hold up, tree supports far more (slicer hunt 2026-11-04, inputs 1), worked by hand", () => {
  // The 80 mm plate on the 20 mm column at 0.2 mm: the only face down above the plate is the plate's underside, 80 × 80 =
  // 6,400 mm² at z 20, 20 / 0.2 = 100 layers up (the column's bottom is on the plate, so it needs none).
  // Tree: 4 × 6,400 + 0.015 × 6,400 × 100 + 40 × 100 = 25,600 + 9,600 + 4,000 = 39,200 units.
  // Normal: 0.1 × 6,400 + 0.002 × 6,400 × 100 + 50 × 100 = 640 + 1,280 + 5,000 = 6,920 units.
  const p80 = plateOnColumn(80);
  assert.ok(Math.abs(supportUnits(p80, 0.2, "tree") - 39_200) < 1e-6, `${supportUnits(p80, 0.2, "tree")}`);
  assert.ok(Math.abs(supportUnits(p80, 0.2, "normal") - 6_920) < 1e-6, `${supportUnits(p80, 0.2, "normal")}`);
  assert.equal(supportUnits(p80, 0.2, "off"), 0);
  // A box on the plate needs none: its only face down is on the plate.
  assert.equal(supportUnits(outwardBox(20, 20, 20), 0.2, "tree"), 0);
  // The slice's units add them to the rest: the plate on the column without supports, plus these.
  assert.ok(Math.abs(sliceUnits(p80, 0.2, 15, "tree") - (sliceUnits(p80, 0.2, 15) + 39_200)) < 1e-6);
  assert.equal(sliceUnits(p80, 0.2, 15, "off"), sliceUnits(p80, 0.2, 15));
  // The calls carry the style: their fifth argument.
  assert.equal(callUnits("slice_stl", [p80 as Uint8Array<ArrayBuffer>, 0.2, 2, 15, "tree", true, false], () => undefined), sliceUnits(p80, 0.2, 15, "tree"));
  assert.equal(callUnits("print_file_stl", [p80 as Uint8Array<ArrayBuffer>, 0.2, 2, 15, "normal", "textured", "standard", true, false], () => undefined), sliceUnits(p80, 0.2, 15, "normal"));
  // A style the calls don't know (an old app's true) is costed as the dearer tree, never as none.
  assert.equal(sliceUnits(p80, 0.2, 15, true as never), sliceUnits(p80, 0.2, 15, "tree"));
  // Measured on the shipped build (2026-11-04, print_file_stl, 2 walls, 15 %, warm-up on; units each needed, its time over
  // the calibration's): plates on columns, tree and normal. The units promised are at least twice each, so the limit
  // (HEADROOM × them) is at least eight times what each took. Before supports counted, the 80 mm plate had 331 units
  // and the tree's 15,632 ran past the 10 s floor.
  const measured: [number, number, number, "normal" | "tree", number][] = [
    // plate (mm), column (mm), layer (mm), style, units needed
    [20, 20, 0.2, "tree", 2_183], [40, 20, 0.2, "tree", 4_550], [80, 20, 0.2, "tree", 15_632], [120, 20, 0.2, "tree", 36_568],
    [80, 80, 0.2, "tree", 17_500], [40, 80, 0.2, "tree", 8_722], [40, 20, 0.12, "tree", 7_317], [80, 20, 0.12, "tree", 19_002], [80, 40, 0.12, "tree", 30_806],
    [20, 20, 0.2, "normal", 2_317], [40, 20, 0.2, "normal", 2_847], [80, 20, 0.2, "normal", 1_754], [120, 20, 0.2, "normal", 2_225], [160, 20, 0.2, "normal", 2_127],
    [80, 80, 0.2, "normal", 3_660], [40, 80, 0.2, "normal", 9_860], [80, 40, 0.12, "normal", 4_575],
  ];
  for (const [plate, column, layer, style, needed] of measured) {
    const promised = sliceUnits(plateOnColumn(plate, column), layer, 15, style);
    assert.ok(promised >= 2 * needed, `${plate} mm plate on a ${column} mm column at ${layer} mm, ${style}: ${promised.toFixed(0)} units for ${needed} needed`);
  }
});

test("a sketch solve's units grow with its arcs cubed", () => {
  // 100 arcs (the most): 6e-4 × 100³ = 600 units, above the 535 ms ÷ 1.76 ms = 304 the costliest took.
  const arcs = (n: number) => JSON.stringify({ points: [], constraints: Array.from({ length: n }, () => ["arc", 0, 1, 2]) });
  assert.ok(Math.abs(solveUnits(arcs(100)) - 600) < 1e-9);
  assert.equal(UNITS_PER_ARC_CUBED * 1e6, 600);
  // Lines only: no Newton, so the floor alone.
  assert.equal(solveUnits(JSON.stringify({ points: [[0, 0], [1, 1]], constraints: [["horizontal", 0, 1]] })), 0);
  assert.equal(callUnits("solve_sketch", [arcs(10)] as never, () => undefined), solveUnits(arcs(10)));
  assert.equal(callUnits("solve_sketch", [7] as never, () => undefined), 0);
});

test("Export STL's solid check is priced by its triangles, so its limit follows the device, worked by hand", () => {
  assert.equal(UNITS_PER_CHECKED_TRIANGLE, 0.3);
  // The 249.5 mm comb of 499 teeth exports 7,988 triangles: 7,988 × 0.3 = 2,396.4 units (only the header's count is read).
  const comb = stl([], 7988);
  assert.ok(Math.abs(callUnits("check_solid", [comb], () => undefined) - 2396.4) < 1e-9);
  // On a device whose calibration takes 1.5 ms a unit: 2,396.4 × 1.5 × 4 = 14,378.4 ms, past the 10 s floor; on one
  // three times slower, three times that, 43,135.2 ms. At the old thousandth of a unit both were the floor.
  assert.ok(Math.abs(limitMs(2396.4, 1.5) - 14_378.4) < 1e-6);
  assert.ok(Math.abs(limitMs(2396.4, 4.5) - 43_135.2) < 1e-6);
  assert.equal(limitMs(7988 * 1e-3, 1.5), LIMIT_FLOOR_MS);
  // A box's 12 triangles: 3.6 units, 3.6 × 1.5 × 4 = 21.6 ms, so the floor.
  assert.ok(Math.abs(callUnits("check_solid", [boxStl(10, 10, 10)], () => undefined) - 3.6) < 1e-9);
  assert.equal(limitMs(3.6, 1.5), LIMIT_FLOOR_MS);
  // A file too short to hold a count has no triangles to check.
  assert.equal(callUnits("check_solid", [new Uint8Array(83)], () => undefined), 0);
});
