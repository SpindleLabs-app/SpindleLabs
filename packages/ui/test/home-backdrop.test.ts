// The home screen's living background (home-backdrop.ts): the pure parts worked out by hand, then the canvas in a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clipUnder, faceFrame, faceMix, facesViewer, fitSurface, groupFaces, LIGHT, NEUTRAL_SURFACES, Occluder, OCCLUDE_BIAS, prismSurface, surfaceVolume, toneOf, triangulate, visibleRuns, type Surface } from "../src/home-backdrop.ts";
import { pushWords, extentOf, EXTRUDE_IN, EXTRUDE_OUT, extrudeAmount, hslOf, linksOf, placeShape, shadesOf, SPARK_SPEED, stepSpark, topFace, fitShape, flash, FLASH_AT, floorOf, FRAME_MS, homeBackdrop, lowEnd, luminance, makeTraces, MAX_ALPHA, NEUTRAL_SHAPE, project, rgbOf, depthCue, seeded, sizeWords, growthAt, growthLife, grownPath, GROW_SPEED, GROW_HOLD, GROW_FADE, makeMotes, moteAt, MOTE_LOW, MOTE_HIGH, NEUTRAL_SHAPES, prismEdges, QUALITY, WARM_FRAMES, SLOW_WINDOW, median, STORY_SECONDS, storyPhase, buildAt, BUILD_END, UNBUILD_AT, rippleAt, RIPPLE_REACH, glowOf, cornerOf, sphereGap, reachOf, CAMERA, dolly, DOLLY, DOLLY_SECONDS, ABOVE, BELOW } from "../src/home-backdrop.ts";
import { gentleGrowthAt, GENTLE_FADE_IN, GENTLE_TURN, GENTLE_DRIFT, TURN_SECONDS, partFade, PART_FADE, pauseAt, STILL_AT, motionChoiceOf, MOTION_CHOICES, type MotionChoice } from "../src/home-backdrop.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("hand-worked: a segment from (0,0,0) to (10,0,4) fits to radius 1 about its box's middle", () => {
  // Box x 0..10, z 0..4, y 0: middle (5, 0, 2); farthest extent from the middle is 5 (in x). So the ends are
  // ((0-5)/5, 0, (0-2)/5) = (-1, 0, -0.4) and ((10-5)/5, 0, (4-2)/5) = (1, 0, 0.4).
  const out = fitShape([0, 0, 0, 10, 0, 4])!;
  assert.deepEqual([...out].map((v) => Math.round(v * 1e6) / 1e6), [-1, 0, -0.4, 1, 0, 0.4]);
});

test("fitShape refuses what cannot be drawn and cuts big shapes to the cap", () => {
  assert.equal(fitShape(null), null);
  assert.equal(fitShape([]), null);
  assert.equal(fitShape([1, 1, 1, 1, 1, 1]), null); // every point the same
  assert.equal(fitShape([0, 0, 0, NaN, 0, 0]), null);
  assert.equal(fitShape([0, 0, 0, 1, 0, 0, 5])!.length, 6); // a stray number past the last pair is ignored
  const big = Array.from({ length: 3000 * 6 }, (_, i) => (i % 7) + (i % 3));
  const cut = fitShape(big, 1500)!;
  assert.ok(cut.length / 6 <= 1500 && cut.length / 6 >= 1000); // every 2nd of 3000 = 1500
  assert.equal(cut.length / 6, 1500);
});

test("the neutral cube is 12 edges, each of length 2, all corners at ±1", () => {
  assert.equal(NEUTRAL_SHAPE.length, 12 * 6);
  for (let i = 0; i < NEUTRAL_SHAPE.length; i += 6) {
    const d = Math.hypot(NEUTRAL_SHAPE[i + 3] - NEUTRAL_SHAPE[i], NEUTRAL_SHAPE[i + 4] - NEUTRAL_SHAPE[i + 1], NEUTRAL_SHAPE[i + 5] - NEUTRAL_SHAPE[i + 2]);
    near(d, 2);
  }
});

test("hand-worked: the simple parts shown in turn with no project", () => {
  // A triangle as a prism: 3 bottom, 3 top and 3 side edges; without sides (a hole) only the 6 round its ends.
  const tri: [number, number][] = [[0, 0], [1, 0], [0, 1]];
  assert.equal(prismEdges(tri, 0, 2).length / 6, 9);
  assert.equal(prismEdges(tri, 0, 2, false).length / 6, 6);
  assert.deepEqual(prismEdges(tri, 0, 2).slice(0, 18), [0, 0, 0, 1, 0, 0, 0, 0, 2, 1, 0, 2, 0, 0, 0, 0, 0, 2]); // bottom, top, side at (0,0)
  // The cube 12; the L-bracket's 6 corners × 3 = 18; the nut's hexagon 6 × 3 and its hole 16 × 2 = 50; the stepped block two boxes, 24.
  assert.deepEqual(NEUTRAL_SHAPES.map((p) => p.length / 6), [12, 18, 50, 24]);
  // The L-bracket stands up: its profile's 1.8 is its height (z), its 1.4 extrusion its depth (y).
  const L = NEUTRAL_SHAPES[1];
  near(Math.max(...L.filter((_, i) => i % 3 === 2)), 1.8);
  near(Math.max(...L.filter((_, i) => i % 3 === 1)), 1.4);
  // Each fits, and has a top face to pull out: the cube's 4 edges, the bracket's 4 (the top of its upright), the nut's 6 + 16
  // (its top and the hole's rim), the step's 4.
  assert.deepEqual(NEUTRAL_SHAPES.map((p) => topFace(fitShape(p) as Float32Array).length), [4, 4, 22, 4]);
});

test("hand-worked projection: yaw 90° turns (1,0,0) to (0,1,0); that is straight away from the viewer when pitch is 0", () => {
  // x' = 1·cos90 − 0 = 0; y' = 1·sin90 + 0 = 1 (the depth axis). Pitch 0: up = z = 0, depth = y' = 1.
  // Perspective k = camera/(camera+depth) = 4/(4+1) = 0.8 with camera 4. So screen (0, -0·0.8 = 0), depth 1.
  const p = project(1, 0, 0, Math.PI / 2, 0, 4);
  near(p.x, 0);
  near(p.y, 0);
  near(p.depth, 1);
  // Seen from the front (yaw 0, pitch 0, camera 4) a point at x = 1, z = 0.5 is at depth 0: k = 1, screen (1, -0.5).
  const q = project(1, 0, 0.5, 0, 0, 4);
  near(q.x, 1);
  near(q.y, -0.5);
  // Seen from straight above (pitch 90°): up = y, depth = −z, so a higher point is nearer and drawn bigger. (1, 0, 2) with
  // camera 4: depth −2, k = 4/(4 − 2) = 2, screen (2, 0). (0, 1, 0): up 1, depth 0, screen (0, −1): the far side is up.
  const top = project(1, 0, 2, 0, Math.PI / 2, 4);
  near(top.x, 2);
  near(top.y, 0);
  near(top.depth, -2);
  const far = project(0, 1, 0, 0, Math.PI / 2, 4);
  near(far.x, 0);
  near(far.y, -1);
});

test("hand-worked: the glow of a built line: the fresh layers under the plane, the ripple's band, the breathing", () => {
  const breath = (t: number) => 0.9 + 0.1 * Math.sin(t * 0.9);
  // 5.4 s is 0.15 of the 36 s story: building, half-way up (smoothstep(0.5) = 0.5).
  const t = 0.15 * STORY_SECONDS;
  const plane = buildAt(t);
  near(plane, 0.5);
  near(glowOf(t, plane, Infinity), breath(t)); // right at the plane: the band is 1, so (0.32 + 0.68) · breath
  near(glowOf(t, plane - 0.12, Infinity), (0.32 + 0.68 * Math.exp(-1)) * breath(t)); // 0.12 under: e^−(0.12/0.12)² = e^−1
  near(glowOf(t, 0.6, Infinity), 0.32 * breath(t)); // over the plane: not built, no band
  // 25.2 s is 0.7 of the story: built, no ripple: only the base.
  near(glowOf(25.2, 0.5, Infinity), 0.32 * breath(25.2));
  // On the ripple's front (gap 0) the band is 1; 0.3 off it, e^−1.
  near(glowOf(25.2, 0.5, 0), breath(25.2));
  near(glowOf(25.2, 0.5, 0.3), (0.32 + 0.68 * Math.exp(-1)) * breath(25.2));
  for (let s = 0; s < 80; s += 0.37) for (let h = 0; h <= 1; h += 0.25) for (const g of [0, 0.2, 1, Infinity]) assert.ok(glowOf(s, h, g) <= 1 && glowOf(s, h, g) >= 0.25);
  // The brightest a line is drawn at is MAX_ALPHA, below full: the words on top stay readable.
  assert.ok(MAX_ALPHA <= 0.5);
});

test("circuit lines: same seed, same lines; every step along an axis or a 45° diagonal; branches fork at corners", () => {
  assert.deepEqual(makeTraces(7, 12, 800, 600), makeTraces(7, 12, 800, 600));
  assert.notDeepEqual(makeTraces(7, 12, 800, 600), makeTraces(8, 12, 800, 600));
  assert.equal(seeded(1)() === seeded(1)(), true);
  const steps = (points: { x: number; y: number }[]) => {
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = Math.abs(points[i].x - points[i - 1].x);
      const dy = Math.abs(points[i].y - points[i - 1].y);
      assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6, `not axis or 45°: ${dx},${dy}`);
      sum += Math.hypot(dx, dy);
    }
    return sum;
  };
  let forks = 0;
  for (const t of makeTraces(3, 30, 800, 600)) {
    near(steps(t.points), t.length, 1e-6); // the length is the main line's steps' sum
    assert.ok(t.x >= 0 && t.x < 800 && t.y >= 0 && t.y < 600);
    assert.ok(t.branches.length <= 2);
    let reach = t.length;
    for (const b of t.branches) {
      near(steps(b.points), b.length, 1e-6);
      // It forks at one of the main line's inner corners, `start` pixels along it.
      const at = t.points.findIndex((p) => Math.hypot(p.x - b.points[0].x, p.y - b.points[0].y) < 1e-9);
      assert.ok(at > 0 && at < t.points.length - 1, "forks at an inner corner");
      near(steps(t.points.slice(0, at + 1)), b.start, 1e-6);
      reach = Math.max(reach, b.start + b.length);
      forks++;
    }
    near(t.reach, reach, 1e-9); // growing whole takes the longest of the main line and every branch
  }
  assert.ok(forks > 5, `some lines branch (${forks})`);
});

test("hand-worked: a circuit line grows, holds and fades", () => {
  // 230 px long at 46 px a second: grown in 5 s, held 5 s, faded over 3 s: a life of 13 s.
  near(growthLife(230), 230 / GROW_SPEED + GROW_HOLD + GROW_FADE);
  near(growthLife(230), 13);
  near(growthAt(0, 230).alpha, 0); // fades in over its first half second
  near(growthAt(0.25, 230).alpha, 0.5);
  near(growthAt(2, 230).grown, 92); // 2 s × 46
  near(growthAt(2, 230).alpha, 1);
  near(growthAt(7, 230).grown, 230); // whole, held
  near(growthAt(11.5, 230).alpha, 0.5); // 1.5 s into a 3 s fade
  near(growthAt(13, 230).alpha, 0);
  near(growthAt(20, 230).alpha, 0);
});

test("hand-worked: the grown part of an L", () => {
  // (0,0) → (30,0) → (30,40): 70 long. 50 px is the whole first leg and 20 of the second: ends at (30,20).
  const L2 = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];
  assert.deepEqual(grownPath(L2, 50), [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }]);
  assert.deepEqual(grownPath(L2, 15), [{ x: 0, y: 0 }, { x: 15, y: 0 }]);
  assert.deepEqual(grownPath(L2, 0), [{ x: 0, y: 0 }]);
  assert.deepEqual(grownPath(L2, 500), L2);
  assert.deepEqual(grownPath([], 10), []);
});

test("hand-worked: motes rise, wrap from the top to the bottom, and fade at both ends", () => {
  // A mote at angle 0, radius 2, height 0, rising 0.05 a second with no spin: after 10 s it is at (2, 0, 0.5), fully shown.
  const m = { angle: 0, radius: 2, z: 0, rise: 0.05, spin: 0, shade: 1 };
  const p = moteAt(m, 10);
  near(p.x, 2);
  near(p.y, 0);
  near(p.z, 0.5);
  near(p.show, 1);
  // The span is 2.3 − (−1.5) = 3.8: after 3.8 / 0.05 = 76 s it is back at 0.
  near(moteAt(m, 76).z, 0, 1e-9);
  // 0.15 under the top it is half shown (fading over the last 0.3); just past the top it is back at the bottom, hidden.
  near(moteAt({ ...m, z: MOTE_HIGH - 0.15 }, 0).show, 0.5);
  assert.ok(moteAt({ ...m, z: MOTE_HIGH - 0.01 }, 1).z < MOTE_LOW + 0.05);
  // Spin turns it round the axis: a quarter turn.
  const q = moteAt({ ...m, spin: Math.PI / 2 }, 1);
  near(q.x, 0, 1e-9);
  near(q.y, 2);
  // Seeded: the same motes for the same seed, every one in its ring.
  assert.deepEqual(makeMotes(3, 20), makeMotes(3, 20));
  for (const k of makeMotes(3, 200)) assert.ok(k.radius >= 0.5 && k.radius <= 2.8 && k.z >= MOTE_LOW && k.z <= MOTE_HIGH);
});

test("low-end rule: 2 cores or fewer, 2 GB or less, or data saving; unknown is fine; 30 frames a second", () => {
  assert.equal(lowEnd({ cores: 2 }), true);
  assert.equal(lowEnd({ cores: 3 }), false);
  assert.equal(lowEnd({ memory: 2 }), true);
  assert.equal(lowEnd({ memory: 4 }), false);
  assert.equal(lowEnd({ saveData: true }), true);
  assert.equal(lowEnd({}), false);
  near(FRAME_MS, 33.333, 0.001);
});

test("the backdrop with a drawing context: live draws and runs, reduced motion runs gently, Still draws once, a 2-core computer moves lightly, a hidden tab and stop draw nothing", () => {
  const calls = { stroke: 0, raf: 0, cancel: 0 };
  const ctx = new Proxy({}, { get: (_t, k) => (k === "stroke" ? () => void calls.stroke++ : String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  function build(reduce: boolean, hidden = false, cores = 8) {
    let frame: ((t: number) => void) | null = null;
    const listeners: Record<string, () => void> = {};
    const canvas = { dataset: {} as Record<string, string>, width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as HTMLCanvasElement;
    const win = {
      innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, navigator: { hardwareConcurrency: cores },
      matchMedia: () => ({ matches: reduce, addEventListener: () => {}, removeEventListener: () => {} }),
      getComputedStyle: () => ({ getPropertyValue: () => "#4da3ff" }),
      requestAnimationFrame: (f: (t: number) => void) => ((frame = f), ++calls.raf),
      cancelAnimationFrame: () => void calls.cancel++,
      addEventListener: () => {}, removeEventListener: () => {}, performance: { now: () => 0 }, setTimeout: () => 0, clearTimeout: () => {},
    } as unknown as Window & typeof globalThis;
    const doc = { hidden, documentElement: { dataset: {} }, addEventListener: (n: string, f: () => void) => (listeners[n] = f), removeEventListener: () => {} } as unknown as Document;
    return { canvas, backdrop: homeBackdrop(canvas, { win, doc }), tick: (t: number) => frame?.(t), listeners };
  }
  const live = build(false);
  live.backdrop.start();
  assert.equal(live.backdrop.mode, "live");
  assert.equal(live.canvas.width, 1200); // 800 × the pixel ratio capped at 1.5, not 2
  live.tick(100);
  assert.ok(calls.stroke > 0);
  const drawn = calls.stroke;
  live.tick(105); // 5 ms later: under the frame gap, nothing drawn
  assert.equal(calls.stroke, drawn);
  live.tick(140);
  assert.ok(calls.stroke > drawn);
  // With no project the simple parts take turns, one a story: the first, then the second once a story has gone by, and
  // round to the first again after the last.
  assert.equal(live.canvas.dataset.part, "0");
  live.tick(STORY_SECONDS * 1000 + 200);
  assert.equal(live.canvas.dataset.part, "1");
  live.tick(NEUTRAL_SHAPES.length * STORY_SECONDS * 1000 + 300);
  assert.equal(live.canvas.dataset.part, "0");
  assert.equal(live.canvas.dataset.shape, "neutral");
  live.backdrop.stop();
  assert.equal(live.backdrop.mode, "off");

  // Reduced motion: it runs, gently (Ben, 2026-11-16: a still picture with Windows' animations off read as broken).
  calls.raf = 0;
  const calm = build(true);
  calm.backdrop.start();
  assert.equal(calm.backdrop.mode, "live");
  assert.equal(calm.canvas.dataset.motion, "gentle");
  assert.ok(calls.raf > 0);
  calm.backdrop.stop();
  // Still, as chosen: drawn once, no loop.
  calls.stroke = 0;
  const still = build(true);
  still.backdrop.choose("still");
  still.backdrop.start();
  assert.equal(still.backdrop.mode, "still");
  assert.equal(still.canvas.dataset.still, "paused");
  assert.equal(still.canvas.dataset.motion, undefined);
  const once = calls.stroke;
  assert.ok(once > 0);
  still.tick(1000);
  assert.equal(calls.stroke, once); // no loop
  // A 2-core computer moves too, on the lightest version (Ben, 2026-11-16: a still picture on his laptop read as broken).
  const weak = build(false, false, 2);
  weak.backdrop.start();
  assert.equal(weak.backdrop.mode, "live");
  assert.equal(weak.canvas.dataset.quality, "2");

  calls.raf = 0;
  const hidden = build(false, true);
  hidden.backdrop.start();
  assert.equal(calls.raf, 0); // a hidden tab starts no loop
});

test("regression: a frame stamped just before the picture started (seconds a little under 0) draws the first part, no error", () => {
  // requestAnimationFrame's time is when the frame began, which can be a moment before the performance.now() read as the
  // picture started; the story's number then came out −1 and no part was found (a TypeError on every such frame).
  let frame: ((t: number) => void) | null = null;
  const ctx = new Proxy({}, { get: (_t, k) => (String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  const canvas = { dataset: {} as Record<string, string>, width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as HTMLCanvasElement;
  const win = {
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, navigator: { hardwareConcurrency: 8 },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "#4da3ff" }),
    requestAnimationFrame: (f: (t: number) => void) => ((frame = f), 1), cancelAnimationFrame: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, performance: { now: () => 1000 }, setTimeout: () => 0, clearTimeout: () => {},
  } as unknown as Window & typeof globalThis;
  const doc = { hidden: false, documentElement: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document;
  const b = homeBackdrop(canvas, { win, doc });
  b.start();
  assert.doesNotThrow(() => frame!(990)); // 10 ms before the start
  assert.equal(canvas.dataset.part, "0");
  b.stop();
});

/** A backdrop on a fake canvas whose every drawing takes `cost(frame)` milliseconds (read on the clock the backdrop measures with). */
function timed(cost: (frame: number) => number, opts: { cores?: number; reduce?: boolean; choice?: MotionChoice; changed?: () => void } = {}) {
  let clock = 0;
  let drawn = 0;
  let frame: ((t: number) => void) | null = null;
  const ctx = new Proxy({}, { get: (_t, k) => (k === "clearRect" ? () => void (clock += cost(drawn++)) : String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  const canvas = { dataset: {} as Record<string, string>, width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as HTMLCanvasElement;
  const win = {
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, navigator: { hardwareConcurrency: opts.cores ?? 8 },
    matchMedia: () => ({ matches: opts.reduce ?? false, addEventListener: () => {}, removeEventListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "#4da3ff" }),
    // A cancelled frame never comes (as in a browser), so a still picture's loop really stops.
    requestAnimationFrame: (f: (t: number) => void) => ((frame = f), 1), cancelAnimationFrame: () => void (frame = null),
    addEventListener: () => {}, removeEventListener: () => {}, performance: { now: () => clock }, setTimeout: () => 0, clearTimeout: () => {},
  } as unknown as Window & typeof globalThis;
  const doc = { hidden: false, documentElement: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document;
  const backdrop = homeBackdrop(canvas, { win, doc, changed: opts.changed });
  if (opts.choice) backdrop.choose(opts.choice);
  backdrop.start();
  /** Runs `n` frames, each 60 ms after the last on the clock (past any frame gap); `each` sees the canvas after each. */
  const run = (n: number, each?: (data: Record<string, string>) => void) => {
    for (let k = 0; k < n && frame; k++) {
      clock += 60;
      frame(clock);
      each?.(canvas.dataset as Record<string, string>);
    }
  };
  return { canvas, backdrop, run, draws: () => drawn };
}

test("regression: a slow first few frames (the computer warming up) never stop the motion", () => {
  // Ben's laptop showed only the still picture. The first frames cost far more than the rest (sprites made, code warmed,
  // the graphics set up): 300 ms then 8 ms frames averaged (300 + 23 × 8) / 24 = 20.2 ms over the first 24, past the 14 ms
  // limit, so one slow start stopped the picture for good.
  const t = timed((k) => (k === 0 ? 300 : k < 4 ? 60 : 8));
  t.run(200);
  assert.equal(t.backdrop.mode, "live");
  assert.equal(t.canvas.dataset.quality, "0"); // and at its richest: 8 ms is well inside the limit
  t.backdrop.stop();
});

test("frames that stay slow step the picture down to lighter versions before it is ever stopped, and say why", () => {
  // 20 ms every frame, past SLOW_MS (14): the richest version, then the lighter, then the lightest, then a still picture.
  const t = timed(() => 20);
  assert.equal(t.canvas.dataset.quality, "0");
  t.run(WARM_FRAMES + SLOW_WINDOW);
  assert.equal(t.canvas.dataset.quality, "1");
  assert.equal(t.backdrop.mode, "live");
  t.run(WARM_FRAMES + SLOW_WINDOW);
  assert.equal(t.canvas.dataset.quality, "2");
  t.run(WARM_FRAMES + SLOW_WINDOW);
  assert.equal(t.backdrop.mode, "still");
  assert.equal(t.canvas.dataset.still, "slow");
  t.backdrop.stop();
  // 10 ms a frame is inside the limit: it stays at its richest however long it runs.
  const fine = timed(() => 10);
  fine.run(5 * (WARM_FRAMES + SLOW_WINDOW));
  assert.equal(fine.canvas.dataset.quality, "0");
  assert.equal(fine.backdrop.mode, "live");
  // One frame in three slow (a busy page now and then) is not a slow computer: the middle frame's cost decides.
  const bursty = timed((k) => (k % 3 === 0 ? 40 : 6));
  bursty.run(5 * (WARM_FRAMES + SLOW_WINDOW));
  assert.equal(bursty.canvas.dataset.quality, "0");
  fine.backdrop.stop();
  bursty.backdrop.stop();
});

test("a 2-core computer gets the lightest moving picture, not a still one; reduced motion moves gently", () => {
  const two = timed(() => 5, { cores: 2 });
  assert.equal(two.backdrop.mode, "live");
  assert.equal(two.canvas.dataset.quality, String(QUALITY.length - 1));
  assert.equal(two.canvas.width, 800); // the lightest draws at 1 pixel a CSS pixel
  two.run(100);
  assert.equal(two.backdrop.mode, "live");
  two.backdrop.stop();
  const calm = timed(() => 5, { reduce: true });
  assert.equal(calm.backdrop.mode, "live");
  assert.equal(calm.canvas.dataset.motion, "gentle");
  assert.equal(calm.canvas.dataset.still, undefined);
  calm.backdrop.stop();
  // The levels get lighter in every way, and the lightest still moves at 20 frames a second or more.
  for (let k = 1; k < QUALITY.length; k++) {
    assert.ok(QUALITY[k].ratio <= QUALITY[k - 1].ratio && QUALITY[k].motes <= QUALITY[k - 1].motes && QUALITY[k].lines <= QUALITY[k - 1].lines && QUALITY[k].fps <= QUALITY[k - 1].fps);
  }
  assert.ok(QUALITY[QUALITY.length - 1].fps >= 20);
  // The middle of a list: the middle one, or the mean of the two middle ones.
  near(median([5, 1, 3]), 3);
  near(median([4, 1, 3, 2]), 2.5);
});

test("the backdrop survives a DOM with no canvas support", () => {
  const canvas = { dataset: {} as Record<string, string>, getContext: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }) } as unknown as HTMLCanvasElement;
  const b = homeBackdrop(canvas, { win: { innerWidth: 1, innerHeight: 1, navigator: {}, getComputedStyle: () => ({ getPropertyValue: () => "" }), requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, addEventListener: () => {}, removeEventListener: () => {}, performance: { now: () => 0 }, setTimeout: () => 0, clearTimeout: () => {} } as unknown as Window & typeof globalThis, doc: { hidden: false, documentElement: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document });
  b.setSource(() => [0, 0, 0, 1, 1, 1]);
  b.start();
  b.stop();
  assert.equal(b.mode, "off");
});

test("a body that arrives after the screen opened replaces the neutral cube within a second (a still picture: drawn again)", () => {
  let strokes = 0;
  const ctx = new Proxy({}, { get: (_t, k) => (k === "stroke" ? () => void strokes++ : String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  let tick: (() => void) | null = null;
  const canvas = { dataset: {} as Record<string, string>, width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 400, height: 300 }) } as unknown as HTMLCanvasElement;
  const win = {
    innerWidth: 400, innerHeight: 300, devicePixelRatio: 1, navigator: {},
    matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "#4da3ff" }),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    performance: { now: () => 0 }, setTimeout: (f: () => void) => ((tick = f), 1), clearTimeout: () => {},
  } as unknown as Window & typeof globalThis;
  const doc = { hidden: false, documentElement: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document;
  const b = homeBackdrop(canvas, { win, doc });
  let body: number[] | null = null;
  b.setSource(() => body);
  b.choose("still");
  b.start();
  assert.equal(canvas.dataset.shape, "neutral");
  assert.ok(strokes > 0);
  strokes = 0;
  tick!(); // a second on, still no body: nothing drawn again
  assert.equal(strokes, 0);
  // A body of 20 segments arrives: fitted (20 kept, under the cap) and the still picture drawn again.
  body = Array.from({ length: 20 * 6 }, (_, i) => (i * 37) % 11);
  tick!();
  assert.equal(canvas.dataset.shape, "project 20");
  assert.ok(strokes > 0);
  strokes = 0;
  tick!(); // the same array again: not fitted or drawn again
  assert.equal(strokes, 0);
  b.stop();
});

test("hand-worked: the story: building, the flash, the ripples, sinking back; the depth cue and the turntable's height", () => {
  const S = STORY_SECONDS;
  near(storyPhase(0), 0);
  near(storyPhase(1.5 * S), 0.5); // every story the same
  near(storyPhase(-0.25 * S), 0.75);
  // Building: 0 at the start, smoothstep(0.5) = 0.5 half-way to BUILD_END (0.15 of the story), whole at BUILD_END.
  near(buildAt(0), 0);
  near(buildAt(0.15 * S), 0.5);
  near(buildAt(BUILD_END * S), 1);
  near(buildAt(0.6 * S), 1);
  // Sinking back from UNBUILD_AT (0.9): half-way down at 0.95.
  near(buildAt(UNBUILD_AT * S), 1);
  near(buildAt(0.95 * S), 0.5);
  // Never a jump: at most 0.02 a 30th of a second (the steepest part, 1.5 / (0.3 × 36 s) a second, is 0.0046).
  let last = buildAt(0);
  for (let t = 0; t < 2 * S; t += 1 / 30) {
    assert.ok(Math.abs(buildAt(t) - last) < 0.02, `jump at ${t}`);
    last = buildAt(t);
  }
  // The flash peaks at 0.6 the moment it is built; half-way through the story it is 0.6·e^−((0.5−0.3)/0.025)² = 0.6·e^−64, about 0.
  near(flash(FLASH_AT * S), 0.6);
  assert.ok(flash(0.5 * S) < 1e-20);
  // The ripples: the first from 0.33 to 0.49, half-way (0.41) at half its reach; the second from 0.78 to 0.9, half-way at 0.84.
  assert.deepEqual(rippleAt(0.41 * S)?.which, 0);
  near(rippleAt(0.41 * S)?.radius ?? -1, RIPPLE_REACH / 2, 1e-9);
  assert.deepEqual(rippleAt(0.84 * S)?.which, 1);
  near(rippleAt(0.84 * S)?.radius ?? -1, RIPPLE_REACH / 2, 1e-9);
  assert.equal(rippleAt(0.6 * S), null); // the extrude has the stage to itself
  assert.equal(rippleAt(0.1 * S), null); // and the build
  // The depth cue: 1 at the front (−1), 1 − 0.55 · 0.5 = 0.725 in the middle (0), 0.45 at the back (+1), held past the ends.
  near(depthCue(-1), 1);
  near(depthCue(0), 0.725);
  near(depthCue(1), 0.45);
  near(depthCue(-5), 1);
  near(depthCue(5), 0.45);
  // The lowest z of the segment (0,0,−0.4)–(1,0,0.4) is −0.4; nothing at all gives −1.
  near(floorOf([0, 0, -0.4, 1, 0, 0.4]), -0.4);
  near(floorOf([]), -1);
});

test("hand-worked: where a ripple's sphere meets an edge, and the corner it starts from", () => {
  // The segment (0,0,0)–(2,0,0) and a sphere about the origin: radius 1 crosses it half-way (gap 0); radius 3 is 1 past
  // its far end; radius 0 touches its near end.
  assert.deepEqual(sphereGap([0, 0, 0], [2, 0, 0], [0, 0, 0], 1), { gap: 0, cross: 0.5 });
  assert.deepEqual(sphereGap([0, 0, 0], [2, 0, 0], [0, 0, 0], 3), { gap: 1, cross: null });
  // About (1,1,0) the nearest point is (1,0,0), 1 away: a sphere of 0.5 falls 0.5 short.
  near(sphereGap([0, 0, 0], [2, 0, 0], [1, 1, 0], 0.5).gap, 0.5);
  // Radius 1.2 about (1,1,0): (x − 1)² + 1 = 1.44, x = 1 ± √0.44; the crossing nearest (0,0,0) is x = 1 − 0.66332 = 0.33668, t = 0.16834.
  const c = sphereGap([0, 0, 0], [2, 0, 0], [1, 1, 0], 1.2);
  near(c.gap, 0);
  near(c.cross ?? -1, (1 - Math.sqrt(0.44)) / 2, 1e-12);
  // The cube's corner farthest along (−1,−1,−1) is (−1,−1,−1); along (1,1,1), (1,1,1).
  const cube = fitShape(NEUTRAL_SHAPE) as Float32Array;
  assert.deepEqual(cornerOf(cube, [-1, -1, -1]), [-1, -1, -1]);
  assert.deepEqual(cornerOf(cube, [1, 1, 1]), [1, 1, 1]);
  assert.deepEqual(cornerOf([], [1, 1, 1]), [0, 0, 0]);
});

test("hand-worked: how far the picture reaches above and below its middle", () => {
  // Seen from above at pitch 30° (sin 0.5, cos √3/2), CAMERA 7: a point turned to depth ry is raised ry · 0.5 on the screen
  // and pushed ry · √3/2 away. A point on the up axis at height 1 is raised √3/2 and comes 0.5 nearer, so it is drawn
  // 7 · (√3/2) / (7 − 0.5) = 0.93264 up whichever way it turns; a point on the ground 1 from the axis reaches
  // 7 · 0.5 / (7 + √3/2) = 0.44495 up (turned away: the far side rises) and 7 · 0.5 / (7 − √3/2) = 0.57059 down (turned
  // nearest, and nearer is bigger).
  assert.equal(CAMERA, 7);
  const c = Math.sqrt(3) / 2;
  const one = reachOf([{ z: 0, rho: 1 }], [Math.PI / 6]);
  near(one.above, 3.5 / (7 + c), 1e-12);
  near(one.below, 3.5 / (7 - c), 1e-12);
  near(one.above, 0.444952, 1e-6);
  near(one.below, 0.570592, 1e-6);
  const both = reachOf([{ z: 0, rho: 1 }, { z: 1, rho: 0 }], [Math.PI / 6]);
  near(both.above, (7 * c) / 6.5, 1e-12);
  near(both.above, 0.932643, 1e-6);
  near(both.below, 3.5 / (7 - c), 1e-12);
  // Nothing measured: the neutral cube's.
  assert.deepEqual(reachOf([]), { above: ABOVE, below: BELOW });
  // The same as projecting the point round a full turn (a different path to the same numbers): never past the reach, and close to it.
  for (const pt of [{ x: 0.7, y: -0.4, z: 0.3 }, { x: -1, y: 1, z: -1 }, { x: 0.2, y: 0.9, z: 1.2 }]) {
    const r = reachOf([{ z: pt.z, rho: Math.hypot(pt.x, pt.y) }], [0.5]);
    let up = -Infinity;
    let down = -Infinity;
    for (let k = 0; k < 3600; k++) {
      const q = project(pt.x, pt.y, pt.z, (k / 3600) * Math.PI * 2, 0.5);
      up = Math.max(up, -q.y);
      down = Math.max(down, q.y);
    }
    assert.ok(up <= r.above + 1e-9 && up > r.above - 1e-4, `up ${up} vs ${r.above}`);
    assert.ok(down <= r.below + 1e-9 && down > r.below - 1e-4, `down ${down} vs ${r.below}`);
  }
  // The camera's drift: nearest at the start, 1 − DOLLY half-way, back at the end.
  near(dolly(0), 1);
  near(dolly(DOLLY_SECONDS / 2), 1 - DOLLY);
  near(dolly(DOLLY_SECONDS), 1);
});

test("hand-worked: colours read for the glow choice, and the size label", () => {
  assert.deepEqual(rgbOf("#4da3ff"), [0x4d, 0xa3, 0xff]);
  assert.deepEqual(rgbOf("#fff"), [255, 255, 255]);
  assert.deepEqual(rgbOf("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.equal(rgbOf("blue"), null);
  // WCAG luminance: white 1, black 0, pure red 0.2126 (its weight).
  near(luminance("#ffffff"), 1);
  near(luminance("#000"), 0);
  near(luminance("rgb(255, 0, 0)"), 0.2126);
  // The STL Ben sent spans x −13.8..47.6, y −20.4..36.5, z 0..22: 61.4 × 56.9 × 22.
  const ends = [-13.8, -20.4, 0, 47.6, 36.5, 22];
  const [x, y, z] = extentOf(ends)!;
  near(x, 61.4, 1e-9);
  near(y, 56.9, 1e-9);
  near(z, 22);
  assert.equal(sizeWords([x, y, z], "mm"), "61.4 × 56.9 × 22 mm");
  // 25.4 mm is 1 in, 50.8 mm 2 in, 12.7 mm 0.5 in.
  assert.equal(sizeWords([25.4, 50.8, 12.7], "in"), "1 × 2 × 0.5 in");
  assert.equal(extentOf([1, 1, 1, 1, 1, 1]), null);
});

test("hand-worked: the shape sits in the room under the words, at its smallest at the window's foot when there is too little", () => {
  // 1280 × 800, words ending at 442: room 358. Fitted it would be (358 − 28 − 32) / 3.35 = 88.96 px a radius, under the
  // smallest (0.24 × 800 = 192). So 192: the picture is 3.35 × 192 + 28 = 671.2 tall, more than the room less 32 (326),
  // so it stands at the foot: top 800 − 671.2 − 16 = 112.8, middle 1.75 × 192 = 336 lower: 448.8.
  const small = placeShape(1280, 800, 442);
  near(small.scale, 192, 1e-9);
  near(small.cy, 448.8, 1e-9);
  near(small.cx, 640);
  // 1280 × 1800, the same words: room 1358, (1358 − 60) / 3.35 = 387.46 a radius (between 0.24 and 0.4 × 1280), the
  // picture 3.35 × 387.46 + 28 = 1326 tall, exactly the room less 32: its top 1800 − 1358 + 16 = 458, its middle 458 + 1.75 × 387.46.
  const roomy = placeShape(1280, 1800, 442);
  near(roomy.scale, 1298 / 3.35, 1e-9);
  near(roomy.cy, 458 + 1.75 * (1298 / 3.35), 1e-9);
  // Never bigger than 0.4 of the short side: a tall empty window.
  near(placeShape(400, 3000, 0).scale, 160, 1e-9);
  // Words past the window's foot (a long list): smallest (0.24 × 375 = 90), at the foot: top 812 − (3.35 × 90 + 28) − 16 = 466.5, middle + 1.75 × 90 = 624.
  const under = placeShape(375, 812, 2000);
  near(under.scale, 90, 1e-9);
  near(under.cy, 624, 1e-9);
  // A flat shape measured to reach 1 above and 1 below: in the same tall window (1358 − 60) / 2 = 649 is over the
  // largest (512), so 512; the picture 2 × 512 + 28 = 1052 tall is centred in the room less 32 (1326): top
  // 458 + (1326 − 1052) / 2 = 595, middle 595 + 512 = 1107.
  const flat = placeShape(1280, 1800, 442, { above: 1, below: 1 });
  near(flat.scale, 512, 1e-9);
  near(flat.cy, 1107, 1e-9);
});

// An L of two segments: (0,0,0)–(1,0,0) and (1,0,0)–(1,1,0), and a lone segment (5,5,5)–(6,5,5).
const L = [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 5, 5, 5, 6, 5, 5];

test("hand-worked: where segment ends meet", () => {
  // Ends are numbered 2·segment + end. Segment 0's far end (1) and segment 1's near end (2) are both (1,0,0); nothing else meets.
  assert.deepEqual(linksOf(L), [[], [2], [1], [], [], []]);
});

test("hand-worked: a spark runs along an edge, turns the corner, and starts again from a loose end", () => {
  const links = linksOf(L);
  const never = () => assert.fail("no choice to make");
  // On segment 0 from its start, 0.5 s at SPARK_SPEED (0.55 a second) is 0.275 along a segment of length 1.
  const a = stepSpark({ seg: 0, from: 0, t: 0, shade: 2 }, 0.5, L, links, never);
  assert.equal(a.seg, 0);
  near(a.t, 0.275);
  assert.equal(a.shade, 2);
  // From t = 0.9, 0.5 s takes it 0.1 to the corner, then 0.175 into segment 1 entered by its end 0 (the one at the corner).
  const b = stepSpark({ seg: 0, from: 0, t: 0.9, shade: 0 }, 0.5, L, links, () => 0);
  assert.deepEqual([b.seg, b.from], [1, 0]);
  near(b.t, 0.175);
  // At the L's loose end (1,1,0) there is nowhere to go: it starts again where rnd says (0.7 · 3 segments: segment 2, from end 1 as 0.7 ≥ 0.5).
  const c = stepSpark({ seg: 1, from: 0, t: 0.95, shade: 0 }, 0.2, L, links, () => 0.7);
  assert.deepEqual([c.seg, c.from], [2, 1]);
  near(c.t, 0.11 - 0.05, 1e-9); // 0.2 s = 0.11 of travel, 0.05 used to reach the end, the rest along segment 2 (length 1)
  // No time, no move; nothing to run on, unchanged.
  assert.deepEqual(stepSpark({ seg: 0, from: 1, t: 0.3, shade: 1 }, 0, L, links, never), { seg: 0, from: 1, t: 0.3, shade: 1 });
  assert.equal(SPARK_SPEED, 0.55);
});

test("hand-worked: the top face is the segments at the greatest height", () => {
  // The neutral cube's top is the 4 edges with both ends at z = 1.
  const cube = fitShape(NEUTRAL_SHAPE)!;
  const top = topFace(cube);
  assert.equal(top.length, 4);
  for (const s of top) assert.ok(cube[s * 6 + 2] === 1 && cube[s * 6 + 5] === 1);
  // Two segments at the top are not a face.
  assert.deepEqual(topFace([0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1]), []);
});

test("hand-worked: the face is still most of the time, pulled out in even stories and pushed in in odd ones", () => {
  const S = STORY_SECONDS;
  near(extrudeAmount(0.3 * S), 0); // resting while the design builds and flashes
  near(extrudeAmount(0.62 * S), EXTRUDE_OUT); // held, first story: out
  near(extrudeAmount(1.62 * S), EXTRUDE_IN); // held, second story: in
  // Half-way through easing out (0.54 of the story): smoothstep(0.5) = 0.5, so half the pull.
  near(extrudeAmount(0.54 * S), EXTRUDE_OUT / 2);
  near(extrudeAmount(0.8 * S), 0);
  // Never while the design is building or sinking back (it would pull a face that is not there yet).
  for (let t = 0; t < 4 * S; t += 0.1) if (buildAt(t) < 1) near(extrudeAmount(t), 0);
  // Never past the ends, and continuous: no jump of more than 0.02 in a 30th of a second.
  let last = extrudeAmount(0);
  for (let t = 0; t < 3 * S; t += 1 / 30) {
    const v = extrudeAmount(t);
    assert.ok(v <= EXTRUDE_OUT + 1e-12 && v >= EXTRUDE_IN - 1e-12);
    assert.ok(Math.abs(v - last) < 0.02, `jump at ${t}`);
    last = v;
  }
});

test("hand-worked: the blues come from the accent's hue", () => {
  // Pure blue (0, 0, 255): hue 240, saturation 1, lightness 0.5.
  assert.deepEqual(hslOf([0, 0, 255]), [240, 1, 0.5]);
  // White and grey have no hue.
  assert.deepEqual(hslOf([255, 255, 255]), [0, 0, 1]);
  // #4da3ff: max B 1, min R 0.302, l = 0.651, d = 0.698, s = d / (2 − 1 − 0.302) = 1, h = 60·((0.302 − 0.639)/0.698 + 4) = 211.0.
  const [h, s, l] = hslOf([0x4d, 0xa3, 0xff]);
  near(h, 211.0, 0.1);
  near(s, 1, 1e-9);
  near(l, 0.651, 0.001);
  // Dark page: the accent, 16° towards cyan and 8% lighter, 14° towards indigo, and 20% lighter.
  assert.deepEqual(shadesOf([0, 0, 255], false), ["hsl(240.0 100.0% 50.0%)", "hsl(224.0 100.0% 58.0%)", "hsl(254.0 100.0% 48.0%)", "hsl(240.0 100.0% 70.0%)"]);
  // Light page: every shade the same or deeper, never lighter, so it shows on white.
  assert.deepEqual(shadesOf([0, 0, 255], true), ["hsl(240.0 100.0% 50.0%)", "hsl(224.0 100.0% 44.0%)", "hsl(254.0 100.0% 40.0%)", "hsl(240.0 100.0% 32.0%)"]);
});

test("hand-worked: the extrude handle's distance", () => {
  // Ben's design is 61.4 mm across at its widest, so a radius of 30.7 mm; out by 0.24 of that is 7.368 mm, shown 7.4.
  assert.equal(pushWords(0.24 * 30.7, "mm"), "+7.4 mm");
  // In by 0.14: 4.298 mm, shown −4.3; in inches 4.298 / 25.4 = 0.169, shown 0.2.
  assert.equal(pushWords(-0.14 * 30.7, "mm"), "−4.3 mm");
  assert.equal(pushWords(-0.14 * 30.7, "in"), "−0.2 in");
});

test("hand-worked: a polygon cut into triangles, each counter-clockwise, either way round", () => {
  // The unit square 0 1 2 3: corner 0's ear (3, 0, 1) turns left and holds no other corner, so it is cut off first,
  // leaving 1 2 3.
  assert.deepEqual(triangulate([[0, 0], [1, 0], [1, 1], [0, 1]]), [[3, 0, 1], [1, 2, 3]]);
  // The L-bracket's profile: 2.2 × 0.5 plus 0.5 × 1.3, area 1.1 + 0.65 = 1.75, in 6 − 2 = 4 triangles; given clockwise too.
  const l: [number, number][] = [[0, 0], [2.2, 0], [2.2, 0.5], [0.5, 0.5], [0.5, 1.8], [0, 1.8]];
  for (const poly of [l, [...l].reverse()]) {
    const tris = triangulate(poly);
    assert.equal(tris.length, 4);
    let area = 0;
    for (const [a, b, c] of tris) {
      const cross = (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
      assert.ok(cross > 0, "counter-clockwise");
      area += cross / 2;
    }
    near(area, 1.75, 1e-12);
  }
  // A figure of eight is not simple: it stops instead of looping, and never throws.
  assert.doesNotThrow(() => triangulate([[0, 0], [1, 1], [1, 0], [0, 1]]));
});

/** The sum of every triangle's area times its normal: nought for a closed surface, whichever way its faces are cut. */
function areaVector(s: Surface): number[] {
  const p = s.positions;
  const sum = [0, 0, 0];
  for (let t = 0; t < s.indices.length; t += 3) {
    const [a, b, c] = [s.indices[t] * 3, s.indices[t + 1] * 3, s.indices[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    sum[0] += (u[1] * v[2] - u[2] * v[1]) / 2;
    sum[1] += (u[2] * v[0] - u[0] * v[2]) / 2;
    sum[2] += (u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return sum;
}

test("hand-worked: the simple parts' surfaces are closed, wound outwards, and hold their volumes", () => {
  // The cube: 2 × 2 × 2 = 8. The L-bracket: its profile's area 1.75 × 1.4 deep = 2.45. The hex nut: a hexagon of corner
  // radius 1.15 has area (3√3/2) · 1.15² = 3.43596, the 16-sided hole of radius 0.55 has 8 · 0.55² · sin 22.5° = 0.92609,
  // so (3.43596 − 0.92609) × 0.7 tall = 1.75690. The stepped block: 2.4 × 1.8 × 0.6 + 1.2 × 1.8 × 0.7 = 2.592 + 1.512 = 4.104.
  const hex = ((3 * Math.sqrt(3)) / 2) * 1.15 ** 2;
  const hole = 8 * 0.55 ** 2 * Math.sin(Math.PI / 8);
  const want = [8, 2.45, (hex - hole) * 0.7, 4.104];
  near((hex - hole) * 0.7, 1.7569, 1e-5);
  assert.equal(NEUTRAL_SURFACES.length, 4);
  NEUTRAL_SURFACES.forEach((s, k) => {
    near(surfaceVolume(s), want[k], 1e-9);
    // Closed and every face outwards: the area vector is nought, so moving the part changes nothing (a face turned the
    // wrong way would make it depend on where the part is).
    for (const v of areaVector(s)) near(v, 0, 1e-9);
    const moved = { positions: Array.from(s.positions, (v, i) => v + [3, -5, 7][i % 3]), indices: s.indices };
    near(surfaceVolume(moved), want[k], 1e-9);
  });
  // A face turned the wrong way is caught: the cube with one triangle turned over is no longer 8, nor the same when moved.
  const cube = prismSurface([[-1, -1], [1, -1], [1, 1], [-1, 1]], -1, 1);
  const flipped = Array.from(cube.indices);
  [flipped[1], flipped[2]] = [flipped[2], flipped[1]];
  const bad = { positions: cube.positions, indices: flipped };
  assert.ok(Math.abs(areaVector(bad)[1]) > 1); // the front wall's half, 2 in area, now counted the other way
  // The cube's top (z = 1) faces up: every triangle there has a normal with z > 0.
  for (let t = 0; t < cube.indices.length; t += 3) {
    const [a, b, c] = [cube.indices[t] * 3, cube.indices[t + 1] * 3, cube.indices[t + 2] * 3];
    const p = cube.positions;
    if (p[a + 2] !== 1 || p[b + 2] !== 1 || p[c + 2] !== 1) continue;
    assert.ok((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]) > 0);
  }
});

test("hand-worked: faces are moved and scaled exactly as the lines are, and bad ones are refused", () => {
  // The lines' box is x 0..10, z 0..4: middle (5, 0, 2), half-size 5 (as fitShape). A triangle (0,0,0) (10,0,0) (10,0,4)
  // goes to (−1, 0, −0.4) (1, 0, −0.4) (1, 0, 0.4).
  const lines = [0, 0, 0, 10, 0, 4];
  const tri = { positions: [0, 0, 0, 10, 0, 0, 10, 0, 4], indices: [0, 1, 2] };
  const fit = fitSurface(tri, lines)!;
  assert.deepEqual([...fit.positions].map((v) => Math.round(v * 1e6) / 1e6), [-1, 0, -0.4, 1, 0, -0.4, 1, 0, 0.4]);
  assert.deepEqual([...fit.indices], [0, 1, 2]);
  assert.equal(fitSurface(null, lines), null);
  assert.equal(fitSurface(tri, null), null); // nothing to fit to
  assert.equal(fitSurface({ positions: tri.positions, indices: [0, 1, 3] }, lines), null); // a corner past the last
  assert.equal(fitSurface({ positions: tri.positions, indices: [0, 1, -1] }, lines), null);
  assert.equal(fitSurface({ positions: tri.positions, indices: [0, 1, 1.5] }, lines), null);
  assert.equal(fitSurface({ positions: [0, 0, NaN, 10, 0, 0, 10, 0, 4], indices: [0, 1, 2] }, lines), null);
  assert.equal(fitSurface({ positions: tri.positions, indices: [] }, lines), null);
  const many = { positions: tri.positions, indices: Array.from({ length: 3 * 11 }, (_, i) => i % 3) };
  assert.equal(fitSurface(many, lines, 10), null); // 11 triangles past a cap of 10
  assert.ok(fitSurface(many, lines, 11));
});

test("hand-worked: a face cut at the build plane keeps the part under it", () => {
  // The triangle (0,0,0) (2,0,0) (0,0,2) under z = 1: both bottom corners kept, the side from (2,0,0) to (0,0,2) crosses
  // half-way at (1,0,1), and the side back to (0,0,0) at (0,0,1): a 4-sided piece.
  assert.deepEqual(clipUnder([[0, 0, 0], [2, 0, 0], [0, 0, 2]], 1), [[0, 0, 0], [2, 0, 0], [1, 0, 1], [0, 0, 1]]);
  assert.deepEqual(clipUnder([[0, 0, 2], [1, 0, 2], [0, 1, 3]], 1), []); // all over the plane: nothing
  assert.deepEqual(clipUnder([[0, 0, 0], [1, 0, 0], [0, 1, 0]], 1), [[0, 0, 0], [1, 0, 0], [0, 1, 0]]); // all under: the same
});

test("hand-worked: a face hides what is behind it, read as the camera sees depth, with a bias for lines on the face", () => {
  // A right triangle (0,0) (100,0) (0,100) at depth 1 everywhere hides (10, 10) at depth 2 but not at depth 1 (a line on it).
  const flat = new Occluder(0, 0, 10, 20, 20);
  flat.add(0, 0, 1, 100, 0, 1, 0, 100, 1);
  assert.equal(flat.hides(10, 10, 2), true);
  assert.equal(flat.hides(10, 10, 1), false);
  assert.equal(flat.hides(90, 90, 5), false); // outside the triangle
  assert.equal(flat.hides(-5, 10, 5), false); // off the grid
  assert.equal(flat.hides(95, 2, 5), true); // a far cell of the same triangle
  // The bias, OCCLUDE_BIAS, at 0.9× (shown) and 1.1× (hidden) behind the face.
  assert.equal(flat.hides(10, 10, 1 + 0.9 * OCCLUDE_BIAS), false);
  assert.equal(flat.hides(10, 10, 1 + 1.1 * OCCLUDE_BIAS), true);
  // Depth 0 at (0,0) and (0,100), 1 at (100,0), camera 7: half-way across, (50, 25), the camera sees 1/(7 + d) change
  // evenly, so 1/(7 + d) = (1/7 + 1/8)/2 = 15/112 and d = 112/15 − 7 = 7/15 = 0.46667 (not 0.5).
  const tilted = new Occluder(0, 0, 10, 20, 20, 7);
  tilted.add(0, 0, 0, 100, 0, 1, 0, 100, 0);
  near(tilted.depthAt(50, 25), 7 / 15, 1e-12);
  assert.equal(tilted.hides(50, 25, 7 / 15 + 0.9 * OCCLUDE_BIAS), false);
  assert.equal(tilted.hides(50, 25, 7 / 15 + 1.1 * OCCLUDE_BIAS), true);
  assert.equal(tilted.hides(50, 25, 0.5 + 0.9 * OCCLUDE_BIAS), true); // read straight across the screen this would show
  assert.equal(flat.depthAt(90, 90), Infinity);
});

test("hand-worked: the parts of a line a face hides, and the parts it leaves", () => {
  // The square (0,0)..(100,100) at depth 1. A line at y = 50 from x = −100 to 200 at depth 2, asked every 10 px: 30 steps,
  // sample k at x = −100 + 10k, hidden for k = 10..20 (x 0..100), the changes half-way between samples: 9.5/30 and 20.5/30.
  const occ = new Occluder(0, 0, 10, 11, 11); // cells to x = 110, so the square's right edge is in the grid
  occ.add(0, 0, 1, 100, 0, 1, 100, 100, 1);
  occ.add(0, 0, 1, 100, 100, 1, 0, 100, 1);
  const runs = visibleRuns(-100, 50, 2, 200, 50, 2, occ, 10);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r[2]), [true, false, true]);
  near(runs[0][0], 0);
  near(runs[0][1], 9.5 / 30);
  near(runs[1][1], 20.5 / 30);
  near(runs[2][1], 1);
  // In front of the square (depth 0.5): shown all along.
  assert.deepEqual(visibleRuns(-100, 50, 0.5, 200, 50, 0.5, occ, 10), [[0, 1, true]]);
  // A long line is asked at most 33 times.
  let asked = 0;
  const counting = { hides: () => (asked++, false) } as unknown as Occluder;
  visibleRuns(0, 0, 0, 5000, 0, 0, counting, 8);
  assert.equal(asked, 33);
});

test("hand-worked: flat faces, how lit they are, and which way they face", () => {
  // The cube's 12 triangles are 6 flat faces of 2, their normals the six axis directions.
  const cube = NEUTRAL_SURFACES[0];
  const g = groupFaces(cube.positions, cube.indices);
  assert.equal(g.tris.length, 6);
  for (const tris of g.tris) assert.equal(tris.length, 2);
  const normals = g.normals.map((n) => n.map((v) => Math.round(v)).join(",")).sort();
  assert.deepEqual(normals, ["-1,0,0", "0,-1,0", "0,0,-1", "0,0,1", "0,1,0", "1,0,0"]);
  for (const d of g.offsets) near(d, 1); // every face 1 from the middle
  // A triangle with no area is left out.
  assert.equal(groupFaces([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2]).tris.length, 0);
  // The light is (−0.48, 0.8, −0.36) as the camera sees it (right, up, away): length 0.2304 + 0.64 + 0.1296 = 1.
  near(Math.hypot(...LIGHT), 1);
  // Level camera, no turn: the top faces up (0.8), the front faces the camera (0.36), the left side faces left (0.48),
  // the back and right get none.
  near(toneOf([0, 0, 1], 0, 0), 0.8);
  near(toneOf([0, -1, 0], 0, 0), 0.36);
  near(toneOf([-1, 0, 0], 0, 0), 0.48);
  near(toneOf([0, 1, 0], 0, 0), 0);
  near(toneOf([1, 0, 0], 0, 0), 0);
  // Tipped 0.5: the top turns towards the camera: 0.8 cos 0.5 + 0.36 sin 0.5 = 0.70206 + 0.17259 = 0.87466.
  near(toneOf([0, 0, 1], 0, 0.5), 0.8 * Math.cos(0.5) + 0.36 * Math.sin(0.5));
  near(toneOf([0, 0, 1], 0, 0.5), 0.87466, 1e-5);
  // On the canvas (y down), corners (0,0) (0,10) (10,0) run clockwise: (0)(0 − 0) − (10)(10) = −100 < 0, facing the viewer.
  assert.equal(facesViewer(0, 0, 0, 10, 10, 0), true);
  assert.equal(facesViewer(0, 0, 10, 0, 0, 10), false);
  // The face colour's mix of the accent: lit faces glow more on a dark page and stay whiter on a light one.
  near(faceMix(1, true, true), 0.31);
  near(faceMix(0, true, true), 0.09);
  near(faceMix(1, true, false), 0.05);
  near(faceMix(0, true, false), 0.23);
  assert.ok(faceMix(0.5, false, true) < faceMix(0, true, true)); // the inside is darker than any outside face
});

test("hand-worked: one frame of the cube's faces: what is painted, in what order, and what it hides", () => {
  // Seen from the front, tipped 0.5 (yaw 0): only the front (y = −1) and the top face the camera (the sides are seen from
  // inside the cube's width, so they turn away). The top's middle (0, 0, 1) is at depth −sin 0.5 = −0.479, the front's
  // (0, −1, 0) at −cos 0.5 = −0.878: the top is farther, so it is painted first.
  const cube = NEUTRAL_SURFACES[0];
  const g = groupFaces(cube.positions, cube.indices);
  const at = (x: number, y: number, z: number) => {
    const p = project(x, y, z, 0, 0.5);
    return { x: 100 * p.x, y: 100 * p.y, depth: p.depth };
  };
  const one = faceFrame(g, cube.positions, cube.indices, at, null, false);
  assert.equal(one.front, 2);
  assert.equal(one.paint.length, 2);
  assert.deepEqual(one.paint.map((f) => g.normals[f.group].map((v) => Math.round(v)).join(",")), ["0,0,1", "0,-1,0"]);
  near(one.paint[0].depth, -Math.sin(0.5), 1e-9);
  near(one.paint[1].depth, -Math.cos(0.5), 1e-9);
  assert.equal(one.whole, null);
  // The back bottom edge's middle (0, 1, −1) is behind the front face: hidden. The back top edge's middle (0, 1, 1) is on
  // the top face's edge: shown.
  const back = at(0, 1, -1);
  const rim = at(0, 1, 1);
  assert.equal(one.occ.hides(back.x, back.y, back.depth), true);
  assert.equal(one.occ.hides(rim.x, rim.y, rim.depth), false);
  // Half built (the plane at z = 0): the top is not built, the front is cut to its lower half, and with the inside shown
  // the back, the bottom and both sides are painted as inside (facing away), the back first. Behind the open top the back
  // bottom edge shows; the whole design's faces (for the ghosts) still hide it.
  const half = faceFrame(g, cube.positions, cube.indices, at, 0, true);
  assert.equal(half.front, 1);
  assert.equal(half.paint.filter((f) => !f.front).length, 4);
  const front = half.paint.find((f) => f.front)!;
  assert.equal(front.polys.length, 2);
  assert.equal(half.occ.hides(back.x, back.y, back.depth), false);
  assert.equal(half.whole!.hides(back.x, back.y, back.depth), true);
  for (let k = 1; k < half.paint.length; k++) assert.ok(half.paint[k - 1].depth >= half.paint[k].depth, "farthest first");
});

test("waiting for the screen: nothing drawn until revealed, then placed for good and the story starts with the build", () => {
  let strokes = 0;
  let fills = 0;
  let frame: ((t: number) => void) | null = null;
  let clock = 5000;
  const ctx = new Proxy({}, { get: (_t, k) => (k === "stroke" ? () => void strokes++ : k === "fill" ? () => void fills++ : String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  const canvas = { dataset: {} as Record<string, string>, width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as HTMLCanvasElement;
  const win = {
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, navigator: { hardwareConcurrency: 8 },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: (n: string) => (n === "--surface" ? "#161d2a" : "#4da3ff") }),
    requestAnimationFrame: (f: (t: number) => void) => ((frame = f), 1), cancelAnimationFrame: () => (frame = null),
    addEventListener: () => {}, removeEventListener: () => {}, performance: { now: () => clock }, setTimeout: () => 0, clearTimeout: () => {},
  } as unknown as Window & typeof globalThis;
  const doc = { hidden: false, documentElement: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document;
  let room = 100;
  const b = homeBackdrop(canvas, { win, doc, waits: true, room: () => room });
  b.start();
  assert.equal(b.mode, "live");
  assert.equal(canvas.dataset.ready, undefined);
  assert.equal(frame, null); // no loop while waiting
  b.redraw();
  assert.equal(strokes + fills, 0);
  // The list grew while waiting (the room moved from 100 to 400 px): nothing was drawn at the old place.
  room = 400;
  // The cube, with its 12 triangles, arrives just before the reveal.
  const box = NEUTRAL_SURFACES[0];
  b.setSource(() => NEUTRAL_SHAPES[0], () => box);
  assert.equal(strokes + fills, 0);
  b.reveal();
  assert.equal(canvas.dataset.ready, "yes");
  assert.equal(canvas.dataset.faces, "6"); // the cube's six flat faces are painted
  clock += 40;
  frame!(clock);
  assert.ok(strokes > 0);
  assert.equal(canvas.dataset.stage, "building"); // the story starts at the start: the build
  assert.equal(canvas.dataset.build, "0.0");
  b.stop();
  assert.equal(canvas.dataset.ready, undefined); // shown again only once revealed again
  // Without faces (a design that gives only lines) nothing is painted solid.
  b.start();
  b.setSource(() => [0, 0, 0, 10, 0, 4, 10, 0, 4, 0, 5, 4]);
  b.reveal();
  assert.equal(canvas.dataset.faces, "0");
  b.stop();
  // Without `waits` it is ready at once, as before.
  const plain = homeBackdrop(canvas, { win, doc });
  plain.start();
  assert.equal(canvas.dataset.ready, "yes");
  plain.stop();
});

test("regression: under reduced motion the picture moves gently, never still: no build, flash, ripple or extrude in a whole story", () => {
  // Ben, 2026-11-16: with Windows' animation effects off (prefers-reduced-motion: reduce) the home screen showed only a
  // still picture, which read as broken. It now moves gently: drawn frame after frame, always built (data-build 1.0),
  // only ever at rest (never building, sinking or a ripple), the top face never pulled (data-extrude 0.00).
  const seen = { stage: new Set<string>(), build: new Set<string>(), extrude: new Set<string>() };
  const calm = timed(() => 5, { reduce: true });
  const frames = Math.ceil((STORY_SECONDS * 1000) / 65) + 20; // 65 ms a frame on the fake clock (60 apart, 5 to draw)
  calm.run(frames, (d) => (seen.stage.add(d.stage), seen.build.add(d.build), seen.extrude.add(d.extrude)));
  assert.equal(calm.backdrop.mode, "live");
  assert.equal(calm.canvas.dataset.motion, "gentle");
  assert.equal(calm.draws(), frames); // every frame drawn: it moves
  assert.deepEqual([...seen.stage], ["rest"]);
  assert.deepEqual([...seen.build], ["1.0"]);
  assert.deepEqual([...seen.extrude], ["0.00"]);
  calm.backdrop.stop();
  // The control: the same story with no reduced motion goes through every stage, so the check above can fail.
  const full = timed(() => 5);
  const stages = new Set<string>();
  full.run(frames, (d) => stages.add(d.stage));
  assert.equal(full.canvas.dataset.motion, "full");
  for (const s of ["building", "ripple", "extrude", "sinking"]) assert.ok(stages.has(s), s);
  full.backdrop.stop();
});

test("hand-worked: moving gently, a circuit line is whole at once and only fades; a simple part fades at the story's turn; the slower turn", () => {
  // A 92 px line takes 92 / 46 = 2 s to grow, so it lives 2 + 5 + 3 = 10 s (growthLife). Gently it is whole from the start
  // (92 px), half faded in at 1 s (1 / GENTLE_FADE_IN, 2 s), whole from 2 s, held to 2 + 5 = 7 s, half gone at 8.5 s
  // (1 − 1.5 / 3), and gone at 10 s: the same life.
  assert.equal(GENTLE_FADE_IN, 2);
  near(growthLife(92), 10);
  assert.deepEqual(gentleGrowthAt(0, 92), { grown: 92, alpha: 0 });
  near(gentleGrowthAt(1, 92).alpha, 0.5);
  assert.equal(gentleGrowthAt(1, 92).grown, 92);
  near(growthAt(1, 92).grown, 46); // growing, only 46 px at 1 s
  near(gentleGrowthAt(2, 92).alpha, 1);
  near(gentleGrowthAt(7, 92).alpha, 1);
  near(gentleGrowthAt(8.5, 92).alpha, 0.5);
  near(gentleGrowthAt(10, 92).alpha, 0);
  near(gentleGrowthAt(12, 92).alpha, 0);
  // A simple part: PART_FADE is 0.05 of a 36 s story, 1.8 s. At the turn nothing shows; 0.9 s in, smoothstep(0.5) = 0.5;
  // whole from 1.8 s; 0.36 s before the end (0.01 of the story) smoothstep(0.2) = 0.04 × 2.6 = 0.104.
  near(PART_FADE * STORY_SECONDS, 1.8);
  near(partFade(0), 0);
  near(partFade(0.9), 0.5);
  near(partFade(1.8), 1);
  near(partFade(18), 1);
  near(partFade(STORY_SECONDS - 0.36), 0.104, 1e-9);
  near(partFade(STORY_SECONDS + 0.9), 0.5); // every story the same
  // The turn: 360° / 60 s = 6° a second gently, against 360° / 40 s = 9°; the motes at half their speed.
  near(360 / GENTLE_TURN, 6);
  near(360 / TURN_SECONDS, 9);
  near(GENTLE_DRIFT, 0.5);
});

test("hand-worked: a paused picture keeps the moment on the screen, unless the design hardly shows in it", () => {
  // Gently, with the simple parts: 0.9 s into a story the part is half faded in (above), so STILL_AT; at 10 s it shows.
  near(pauseAt(0.9, true, false), STILL_AT);
  near(pauseAt(10, true, false), 10);
  // Gently with a project: never built or faded, so always that moment.
  near(pauseAt(0.9, true, true), 0.9);
  // The full story: 1 s in, buildAt = smoothstep(1 / 10.8 = 0.0926) = 0.0926² × (3 − 0.185) = 0.024, under a quarter: STILL_AT.
  // 5.4 s in, half built: kept. 33 s in, sinking: 1 − smoothstep((0.9167 − 0.9) / 0.1 = 0.167) = 1 − 0.074 = 0.926: kept.
  // 35.9 s in: 1 − smoothstep(0.972) = 0.002: STILL_AT.
  near(buildAt(1), 0.024, 0.001);
  near(pauseAt(1, false, false), STILL_AT);
  near(pauseAt(5.4, false, false), 5.4);
  near(buildAt(33), 0.926, 0.001);
  near(pauseAt(33, false, false), 33);
  near(pauseAt(35.9, false, false), STILL_AT);
  // STILL_AT itself shows the design whole either way.
  near(buildAt(STILL_AT), 1);
  near(partFade(STILL_AT), 1);
});

test("the person's choice: Still keeps the moment; Full moves fully even under reduced motion; Gentle anywhere; a chosen motion never stops for a slow computer", () => {
  // Still while moving keeps that moment: 333 frames of 65 ms is 21.64 s, 0.601 of the story, the top face held pulled
  // out (0.58 to 0.68): the still picture shows it pulled out (STILL_AT, 14.4 s, would be a ripple).
  const t = timed(() => 5);
  t.run(333);
  assert.equal(t.canvas.dataset.extrude, "0.24");
  const n = t.draws();
  t.backdrop.choose("still");
  assert.equal(t.backdrop.mode, "still");
  assert.equal(t.canvas.dataset.still, "paused");
  assert.equal(t.draws(), n + 1); // drawn once, at that moment
  assert.equal(t.canvas.dataset.stage, "extrude");
  assert.equal(t.canvas.dataset.extrude, "0.24");
  t.run(30);
  assert.equal(t.draws(), n + 1); // no loop
  // Moving again carries the story on from there: 5 frames later still in the hold (it ends at 24.48 s).
  t.backdrop.choose("full");
  t.run(5);
  assert.equal(t.backdrop.mode, "live");
  assert.equal(t.draws(), n + 6);
  assert.equal(t.canvas.dataset.extrude, "0.24");
  t.backdrop.stop();
  // Full on a computer set to show less motion: the whole story (Ben, 2026-11-16).
  const fullCalm = timed(() => 5, { reduce: true, choice: "full" });
  assert.equal(fullCalm.canvas.dataset.motion, "full");
  const stages = new Set<string>();
  fullCalm.run(400, (d) => stages.add(d.stage)); // 26 s: built, a ripple, the top face pulled out
  for (const s of ["building", "ripple", "extrude"]) assert.ok(stages.has(s), s);
  fullCalm.backdrop.stop();
  // Gentle on a computer that asks for nothing: only at rest.
  const g = timed(() => 5, { choice: "gentle" });
  assert.equal(g.canvas.dataset.motion, "gentle");
  const rest = new Set<string>();
  g.run(400, (d) => rest.add(d.stage));
  assert.deepEqual([...rest], ["rest"]);
  g.backdrop.stop();
  // Following the computer, 20 ms frames step down and then stop, saying why; Full then moves it on the lightest, for good.
  const slow = timed(() => 20);
  slow.run(3 * (WARM_FRAMES + SLOW_WINDOW));
  assert.equal(slow.backdrop.mode, "still");
  assert.equal(slow.canvas.dataset.still, "slow");
  slow.backdrop.choose("full");
  assert.equal(slow.backdrop.mode, "live");
  assert.equal(slow.canvas.dataset.quality, String(QUALITY.length - 1));
  slow.run(4 * (WARM_FRAMES + SLOW_WINDOW));
  assert.equal(slow.backdrop.mode, "live");
  slow.backdrop.stop();
  // Gentle chosen is a chosen motion too: never stopped.
  const slowGentle = timed(() => 20, { choice: "gentle" });
  slowGentle.run(5 * (WARM_FRAMES + SLOW_WINDOW));
  assert.equal(slowGentle.backdrop.mode, "live");
  slowGentle.backdrop.stop();
});

test("the screen is told after every change of what is drawn, once a choice changes, and the kept choice is read back safely", () => {
  let told = 0;
  const c = timed(() => 5, { changed: () => void told++ });
  const atStart = told;
  assert.ok(atStart >= 1); // started
  c.backdrop.choose("still");
  assert.equal(told, atStart + 1);
  c.backdrop.choose("still"); // the same choice: nothing to do
  assert.equal(told, atStart + 1);
  c.backdrop.stop();
  assert.equal(told, atStart + 2);
  assert.equal(c.backdrop.mode, "off");
  // What a store gives back: one of the four, else following the computer.
  assert.deepEqual(MOTION_CHOICES, ["system", "full", "gentle", "still"]);
  for (const m of MOTION_CHOICES) assert.equal(motionChoiceOf(m), m);
  for (const bad of [null, undefined, "", "Full", "pause", 3, {}]) assert.equal(motionChoiceOf(bad), "system");
});
