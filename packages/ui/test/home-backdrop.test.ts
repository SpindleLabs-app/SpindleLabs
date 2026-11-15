// The home screen's living background (home-backdrop.ts): the pure parts worked out by hand, then the canvas in a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushWords, extentOf, EXTRUDE_IN, EXTRUDE_OUT, extrudeAmount, hslOf, linksOf, placeShape, shadesOf, SPARK_SPEED, stepSpark, topFace, fitShape, flash, FLASH_AT, floorOf, FRAME_MS, homeBackdrop, lowEnd, luminance, makeTraces, MAX_ALPHA, NEUTRAL_SHAPE, project, rgbOf, depthCue, seeded, sizeWords, growthAt, growthLife, grownPath, GROW_SPEED, GROW_HOLD, GROW_FADE, makeMotes, moteAt, MOTE_LOW, MOTE_HIGH, NEUTRAL_SHAPES, prismEdges, STORY_SECONDS, storyPhase, buildAt, BUILD_END, UNBUILD_AT, rippleAt, RIPPLE_REACH, glowOf, cornerOf, sphereGap, reachOf, CAMERA, dolly, DOLLY, DOLLY_SECONDS, ABOVE, BELOW } from "../src/home-backdrop.ts";

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

test("the backdrop with a drawing context: live draws and runs, reduced motion draws once, a hidden tab and stop draw nothing", () => {
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

  calls.stroke = 0;
  const still = build(true);
  still.backdrop.start();
  assert.equal(still.backdrop.mode, "still");
  const once = calls.stroke;
  assert.ok(once > 0);
  still.tick(1000);
  assert.equal(calls.stroke, once); // no loop
  const weak = build(false, false, 2);
  weak.backdrop.start();
  assert.equal(weak.backdrop.mode, "still");

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

test("the backdrop survives a DOM with no canvas support", () => {
  const canvas = { dataset: {} as Record<string, string>, getContext: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }) } as unknown as HTMLCanvasElement;
  const b = homeBackdrop(canvas, { win: { innerWidth: 1, innerHeight: 1, navigator: {}, getComputedStyle: () => ({ getPropertyValue: () => "" }), requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, addEventListener: () => {}, removeEventListener: () => {}, performance: { now: () => 0 }, setTimeout: () => 0, clearTimeout: () => {} } as unknown as Window & typeof globalThis, doc: { hidden: false, documentElement: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document });
  b.setSource(() => [0, 0, 0, 1, 1, 1]);
  b.start();
  b.stop();
  assert.equal(b.mode, "off");
});

test("a body that arrives after the screen opened replaces the neutral cube within a second (reduced motion: drawn again)", () => {
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
  // Pitch 30° (sin 0.5, cos √3/2), CAMERA 7. A point on the up axis at height 1 is drawn 7 · (√3/2) / (7 + 0.5) = 0.80829 up
  // whichever way it turns; a point on the ground 1 from the axis reaches 7 · 0.5 / (7 − √3/2) = 0.57059 up (turned
  // nearest) and 7 · 0.5 / (7 + √3/2) = 0.44495 down (turned away).
  assert.equal(CAMERA, 7);
  const c = Math.sqrt(3) / 2;
  const one = reachOf([{ z: 0, rho: 1 }], [Math.PI / 6]);
  near(one.above, 3.5 / (7 - c), 1e-12);
  near(one.below, 3.5 / (7 + c), 1e-12);
  const both = reachOf([{ z: 0, rho: 1 }, { z: 1, rho: 0 }], [Math.PI / 6]);
  near(both.above, (7 * c) / 7.5, 1e-12);
  near(both.below, 3.5 / (7 + c), 1e-12);
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
