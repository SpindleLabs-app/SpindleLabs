// The kernel calls' time limits on the real WASM kernel (step 35d3): the
// calibration boolean timed as the worker times it, then legal calls of
// every kind that has a size, each taking less than its units times the
// calibration with no headroom at all (the limit gives four times that), so
// no legal call is failed by its limit on a device whose calibration runs
// as fast as its other calls. And the store calls the limits read, on the
// real kernel: body_boolean of the calibration cubes by hand, body_hide.
// Run with `npm run journeys`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelError, type BodySpec, type BooleanResult, type Outline } from "@fission/core";
import { calibrate, CALIBRATION_TARGET, CALIBRATION_TOOL, callUnits, facesSize, builtSize, HEADROOM, MAX_MEETING_POINTS, type BodySize } from "../../core/src/kernel/time-limit.ts";
import { entry } from "../../core/src/kernel/entry-points.ts";
import { loadKernel, nodeKernel } from "../src/node-kernel.ts";

loadKernel();
const calls = { build: (spec: BodySpec) => entry.body_build(spec), boolean: entry.body_boolean, free: entry.body_free, now: () => performance.now() };

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ path: { corners: [x0, y0, x1, y0, x1, y1, x0, y1], bulges: [] } });

/** A 100 mm square plate 2 mm thick with `n` slots along x (the kernel's costliest legal boolean is two of these crossed, at 111 slots): 6 + 4n faces. */
function grating(n: number): BodySpec {
  const pitch = 98 / n;
  const holes = Array.from({ length: n }, (_, k) => rect(1, 1 + k * pitch, 99, 1 + k * pitch + pitch / 2));
  return { extrude: { profile: { outer: rect(0, 0, 100, 100), holes }, distance: 2 } };
}

/** A comb 249.5 mm long: 499 teeth 0.25 mm wide and 8 mm tall on a 2 mm spine, 3 mm thick; 4 × 499 + 3 = 1,999 corners. */
function comb(): BodySpec {
  const corners = [0, 0];
  for (let i = 0; i < 499; i++) corners.push(i * 0.5, 10, (i + 0.5) * 0.5, 10, (i + 0.5) * 0.5, 2, (i + 1) * 0.5, 2);
  corners.push(249.5, 0);
  return { extrude: { profile: { outer: { path: { corners, bulges: [] } }, holes: [] }, distance: 3 } };
}

/** A 250 × 10 × 2 mm strip with 499 slots 0.25 × 6 mm: 4 + 4 × 499 = 2,000 corners. */
const slotted = (): BodySpec => ({ extrude: { profile: { outer: rect(0, 0, 250, 10), holes: Array.from({ length: 499 }, (_, i) => rect(0.3 + 0.5 * i, 2, 0.55 + 0.5 * i, 8)) }, distance: 2 } });

/** A strip 5n mm long, 5 mm wide and 2 mm thick with `n` round holes of radius 1.5 in a row. */
const holed = (n: number): BodySpec => ({ extrude: { profile: { outer: rect(0, 0, 5 * n, 5), holes: Array.from({ length: n }, (_, i) => ({ circle: { center: [2.5 + 5 * i, 2.5] as [number, number], radius: 1.5 } })) }, distance: 2 } });

/** How long `f` takes, in ms. */
function timed<T>(f: () => T): [number, T] {
  const start = performance.now();
  const out = f();
  return [performance.now() - start, out];
}

test("the calibration times the cubes' boolean on this machine and keeps nothing", () => {
  const before = entry.body_count();
  const unitMs = calibrate(calls);
  assert.ok(unitMs > 0 && Number.isFinite(unitMs), `${unitMs}`);
  assert.equal(entry.body_count(), before);
});

/**
 * Passes of the calibration run first, untimed: just after the kernel loads, V8 is still compiling and optimising it,
 * so the first pass took 3 to 4.6 ms a unit on the measuring machine and only settled near 1.1 ms by the sixth (five
 * fresh processes, 2026-11-05), and on CI the first came out anywhere from 1.2 to 7.9 ms. The units are priced against
 * the settled kernel, so they are checked against it: warm calls against a warm calibration.
 */
const SETTLING_PASSES = 6;

test("legal calls of each size take less than their units × the calibration, with no headroom", () => {
  for (let k = 0; k < SETTLING_PASSES; k++) calibrate(calls);
  // Each call is judged against the calibration taken right before and right after it (each the faster of two
  // passes: what a device that isn't busy measures), the slower of the two kept, since a shared CI machine's speed
  // swings during a run; and timed like the calibration, the fastest of `runs` (its first run may meet code still
  // being optimised, or a garbage collection). One cold calibration at the start against one cold run half a minute
  // later, with no headroom, failed whenever they came out unevenly (2026-11-05: the 500 mm sphere, 128 ms against 113).
  const unitNow = () => Math.min(calibrate(calls), calibrate(calls));
  const check = (what: string, units: number, run: () => number, runs = 3) => {
    const before = unitNow();
    let ms = Infinity;
    for (let k = 0; k < runs; k++) ms = Math.min(ms, run());
    const unitMs = Math.max(before, unitNow());
    assert.ok(ms < units * unitMs, `${what}: ${ms.toFixed(0)} ms, ${units.toFixed(0)} units × ${unitMs.toFixed(3)} ms = ${(units * unitMs).toFixed(0)} ms`);
    console.log(`${what}: ${ms.toFixed(0)} ms of ${(units * unitMs).toFixed(0)}, ${(ms / (units * unitMs)).toFixed(2)} (limit ${(units * unitMs * HEADROOM).toFixed(0)})`);
  };
  // A boolean: 40-slot gratings crossed (166 faces each, 27,556 pairs).
  const plate = grating(40);
  const crossed: BodySpec = { moved: { body: plate, moves: [{ turn: { pivot: [0, 0, 0], axis: [0, 0, 1], angle: Math.PI / 2 } }, { move: [100.05, 0.05, 1] }] } };
  const sizes = new Map<number, BodySize>();
  const built: number[] = [];
  check("a 162-corner plate built", callUnits("body_build", [plate], () => undefined), () => {
    const [ms, body] = timed(() => entry.body_build(plate));
    built.push(body);
    return ms;
  });
  const [a, ...spare] = built;
  spare.forEach((body) => entry.body_free(body));
  const b = entry.body_build(crossed);
  sizes.set(a, builtSize(plate));
  sizes.set(b, builtSize(crossed));
  for (const op of ["union", "subtract", "intersect"] as const) {
    const made: BooleanResult[] = [];
    check(`gratings ${op}`, callUnits("body_boolean", [a, [b], op], (h) => sizes.get(h)), () => {
      const [ms, result] = timed(() => entry.body_boolean(a, [b], op));
      made.push(result);
      return ms;
    }, 1);
    const out = made[0];
    // Each result shown again after hiding: its mesh made anew, timed by its faces.
    const piece = out.bodies[0];
    check(`gratings ${op}, its first piece shown again`, facesSize(out.history[0].faces.length).mesh, () => (entry.body_hide(piece), timed(() => entry.body_view(piece))[0]));
    // 35f1f2a: the result moved, turned and scaled (a scale makes its mesh anew, the costliest move), timed as the body it moves.
    const moves = [{ turn: { pivot: [0, 0, 0], axis: [1, 1, 0], angle: 0.3 } }, { scale: { about: [0, 0, 0], factor: 1.5 } }, { move: [10, 0, 0] }] as const;
    check(`gratings ${op}, its first piece moved and scaled`, callUnits("body_move", [piece, [...moves]], () => facesSize(out.history[0].faces.length)), () => {
      const [ms, moved] = timed(() => entry.body_move(piece, [...moves] as never));
      entry.body_free(moved);
      return ms;
    });
    out.bodies.forEach((p) => entry.body_free(p));
  }
  // The STL of the plate, sliced at 0.2 mm (10 layers).
  const stl = entry.body_stl(a, "plate").bytes;
  // Five runs, not three: on CI's shared machines this slice once ran 18 % slower for all three (2026-11-05).
  check("the plate sliced", callUnits("slice_stl", [stl, 0.2, 3, 15, "off"], () => undefined), () => timed(() => entry.slice_stl(stl, 0.2, 3, 15, "off"))[0], 5);
  entry.body_free(a);
  entry.body_free(b);
  // Big flat-sided parts at full infill: 12 triangles each, so only their area tells (slicer hunt M8; the limit gave
  // the 246 mm box less than it took). 200 × 100 × 100 mm is the costliest per unit of area seen.
  for (const [w, d, h] of [[100, 100, 100], [150, 150, 150], [200, 100, 100]]) {
    const big = entry.body_build({ box: { width: w, depth: d, height: h } });
    const bigStl = entry.body_stl(big, "box").bytes;
    check(`a ${w} × ${d} × ${h} mm box sliced at 100 % infill`, callUnits("slice_stl", [bigStl, 0.2, 2, 100, "off"], () => undefined), () => timed(() => entry.slice_stl(bigStl, 0.2, 2, 100, "off"))[0], 2);
    entry.body_free(big);
  }
  // Export STL's "this is solid" check of long, many-toothed parts (hunt B2, 2026-11-12: priced at a thousandth of a unit
  // a triangle, the comb took about 150 times its units and the 10 s floor hid it on a fast machine, while the browser
  // took 14.5 s and was stopped). Each a legal extrude under the 2,000 profile corners, its STL checked as Download STL does.
  for (const [what, spec] of [["a 249.5 mm comb of 499 teeth", comb()], ["a 250 mm strip with 499 slots", slotted()], ["a 3 m strip with 600 round holes", holed(600)]] as const) {
    const file = entry.export_stl(spec, "part").bytes;
    // 50 bytes a triangle after the 84-byte header.
    const triangles = (file.length - 84) / 50;
    check(`${what} (${triangles} triangles) checked solid`, callUnits("check_solid", [file], () => undefined), () => {
      const [ms, report] = timed(() => entry.check_solid(file));
      // A sound part is never called broken; the check may stop at its own budget and say "unfinished" (these do today).
      assert.notEqual(report.verdict, "problems", what);
      return ms;
    }, 1);
  }
  // A 300-hole plate (304 corners), built with its view: make_extrude.
  const side = 18;
  const holes = Array.from({ length: 300 }, (_, k) => ({ circle: { center: [((k % side) + 0.5) * 5000, (Math.floor(k / side) + 0.5) * 5000] as [number, number], radius: 1500 } }));
  const profile: Outline = { outer: rect(0, 0, 90_000, 90_000), holes };
  check("a 300-hole plate extruded", callUnits("make_extrude", [profile, 1000], () => undefined), () => timed(() => entry.make_extrude(profile, 1000))[0]);
  // A 500 mm sphere hidden, then shown: its mesh at the most chords.
  const sphere: BodySpec = { sphere: { radius: 500 } };
  const ball = entry.body_build(sphere);
  check("a 500 mm sphere shown again", builtSize(sphere).mesh, () => (entry.body_hide(ball), timed(() => entry.body_view(ball))[0]), 5);
  entry.body_free(ball);
  // A sketch of 1,000 lines round a circle.
  const lines = Array.from({ length: 1000 }, (_, k) => {
    const at = (j: number): [number, number] => [100 * Math.cos((2 * Math.PI * j) / 1000), 100 * Math.sin((2 * Math.PI * j) / 1000)];
    return { a: at(k), b: at(k + 1) };
  });
  check("a 1,000-line sketch", callUnits("sketch_outline", [lines, [], []], () => undefined), () => timed(() => entry.sketch_outline(lines, [], []))[0]);
  // Its regions (step 48), and the costliest legal sketches for regions: ones whose curves meet at nearly the most points
  // a sketch may have (100,000). A 300 × 300 grid of lines meets at 90,000 points and makes 299² = 89,401 squares; 223
  // circles of radius 50 with centres 10 mm from the origin all cross each other, 2 × 223 × 222 / 2 = 49,506 points.
  // Regression (48d3): the regions' units counted only curves, as the outline's do, giving the grid 333 ms here where
  // it took 1,968 (the 10 s floor hid it on a fast machine; a device five times slower would have been stopped).
  const regions = (what: string, lines: unknown[], circles: unknown[], expected: number) => {
    const args = [lines, circles, []] as Parameters<typeof entry.sketch_regions>;
    check(what, callUnits("sketch_regions", args, () => undefined), () => {
      const [ms, out] = timed(() => entry.sketch_regions(...args));
      assert.equal(out.regions.length, expected, what);
      return ms;
    });
  };
  regions("a 1,000-line sketch's regions", lines, [], 1);
  const grid = Array.from({ length: 300 }, (_, i) => [{ a: [0, i + 1], b: [301, i + 1] }, { a: [i + 1, 0], b: [i + 1, 301] }]).flat();
  regions("a 300 × 300 grid's regions", grid, [], 299 * 299);
  const crossing = Array.from({ length: 223 }, (_, k) => ({ centre: [10 * Math.cos((2 * Math.PI * k) / 223), 10 * Math.sin((2 * Math.PI * k) / 223)], radius: 50 }));
  // Each circle crossing all the others: 223 × 222 + 2 = 49,508 regions by Euler (V − E + F = 2 with V = 49,506 points,
  // E = 2V arcs between them, F counting the outside), less the outside, 49,507.
  regions("223 crossing circles' regions", [], crossing, 223 * 222 + 1);
  // The units' cap is the kernel's own limit: a 317 × 317 grid meets at 100,489 points, past it, and is refused naming it.
  const over = Array.from({ length: 317 }, (_, i) => [{ a: [0, i + 1], b: [318, i + 1] }, { a: [i + 1, 0], b: [i + 1, 318] }]).flat();
  assert.throws(() => entry.sketch_regions(over, [], []), (e: unknown) => String((e as { message?: unknown }).message ?? e).includes(`more than ${MAX_MEETING_POINTS} points`));
});

test("the calibration cubes joined by hand, through the app's handles; hidden bodies shown again the same", async () => {
  const kernel = nodeKernel();
  const before = await kernel.call("body_count");
  const target = await kernel.call("body_build", CALIBRATION_TARGET);
  const tool = await kernel.call("body_build", CALIBRATION_TOOL);
  const shown = await kernel.call("body_view", target);
  // Two 10 mm cubes overlapping in a 5 mm cube: 1,000 + 1,000 − 125 = 1,875 mm³; each keeps 3 faces whole and
  // 3 cut down to L shapes, so the union has 6 + 6 = 12 faces.
  const joined = await kernel.call("body_boolean", target, [tool], "union");
  assert.equal(joined.bodies.length, 1);
  const view = await kernel.call("body_view", joined.bodies[0]);
  assert.ok(Math.abs(view.volume - 1875) < 1e-9 * 1875, `${view.volume}`);
  assert.equal(view.faces, 12);
  assert.equal(joined.history[0].faces.length, 12);
  assert.deepEqual(new Set(joined.history[0].faces.map((f) => f.body)), new Set([target, tool]));
  assert.equal(joined.history[0].faces.filter((f) => f.whole).length, 6, "3 whole faces from each cube");
  // Hidden, the target is shown again bit for bit; hiding twice is fine.
  await kernel.call("body_hide", target);
  await kernel.call("body_hide", target);
  assert.deepEqual(await kernel.call("body_view", target), shown);
  // The cubes are left as they were: the subtract by hand, 1,000 − 125 = 875 mm³.
  const cut = await kernel.call("body_boolean", target, [tool], "subtract");
  assert.ok(Math.abs((await kernel.call("body_view", cut.bodies[0])).volume - 875) < 1e-9 * 875);
  // A body can't be its own tool; an unknown handle is refused by kind.
  await assert.rejects(kernel.call("body_boolean", target, [target], "union"), (e: KernelError) => e.kind === "invalid-input");
  await assert.rejects(kernel.call("body_hide", 999_999), (e: KernelError) => e.kind === "unknown-body");
  for (const body of [target, tool, ...joined.bodies, ...cut.bodies]) await kernel.call("body_free", body);
  assert.equal(await kernel.call("body_count"), before);
});
