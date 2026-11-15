// The home screen's living background (home-backdrop.ts): the pure parts worked out by hand, then the canvas in a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extentOf, placeShape, fitShape, flash, FLASH_AT, floorOf, FRAME_MS, homeBackdrop, lowEnd, luminance, makeTraces, MAX_ALPHA, NEUTRAL_SHAPE, project, PULSE_SECONDS, pulse, rgbOf, ripple, scanHeight, seeded, sizeWords, traceStart } from "../src/home-backdrop.ts";

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

test("the pulse: bright where its band is, faint far from it, never above 1, never below the base", () => {
  // At t = 0 the band's middle is −1.4 (below the shape); at t = PULSE/2 it is 0. So at half-time the middle height is brighter than the top.
  const half = PULSE_SECONDS / 2;
  assert.ok(pulse(0, half) > pulse(1, half) + 0.3);
  assert.ok(pulse(0, half) > pulse(-1, half) + 0.3);
  // At the band's middle the band term is 1: (0.32 + 0.68) · breathing (0.9 + 0.1 sin(0.9·t)).
  near(pulse(0, half), 0.9 + 0.1 * Math.sin(half * 0.9));
  for (let t = 0; t < 30; t += 0.37) for (let h = -1; h <= 1; h += 0.25) assert.ok(pulse(h, t) <= 1 && pulse(h, t) >= 0.25);
  // The brightest a line is drawn at is MAX_ALPHA, below full: the words on top stay readable.
  assert.ok(MAX_ALPHA <= 0.5);
});

test("traces: same seed, same lines; every step is along an axis or a 45° diagonal; drift wraps and stays bounded", () => {
  assert.deepEqual(makeTraces(7, 12, 800, 600), makeTraces(7, 12, 800, 600));
  assert.notDeepEqual(makeTraces(7, 12, 800, 600), makeTraces(8, 12, 800, 600));
  assert.equal(seeded(1)() === seeded(1)(), true);
  for (const t of makeTraces(3, 30, 800, 600)) {
    for (let i = 1; i < t.points.length; i++) {
      const dx = Math.abs(t.points[i].x - t.points[i - 1].x);
      const dy = Math.abs(t.points[i].y - t.points[i - 1].y);
      assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6, `not axis or 45°: ${dx},${dy}`);
    }
    for (const s of [0, 10, 1000, 1e5]) {
      const p = traceStart(t, s, 800, 600);
      assert.ok(p.x >= -360 && p.x < 800 + 360 && p.y >= -360 && p.y < 600 + 360);
    }
  }
  // A start at x = 100 drifting 10 px/s for 5 s is at 150.
  const [one] = makeTraces(1, 1, 800, 600);
  const moved = traceStart({ ...one, x: 100, y: 100, vx: 10, vy: 0 }, 5, 800, 600);
  near(moved.x, 150);
  near(moved.y, 100);
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
  const ctx = new Proxy({}, { get: (_t, k) => (k === "stroke" ? () => void calls.stroke++ : k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
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
  const ctx = new Proxy({}, { get: (_t, k) => (k === "stroke" ? () => void strokes++ : k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
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

test("hand-worked: the scan band, the flash, the ripple and the turntable's height", () => {
  // scanHeight = (phase · 2.8) − 1.4: −1.4 at the start, 0 half-way, just under 1.4 at the end.
  near(scanHeight(0), -1.4);
  near(scanHeight(PULSE_SECONDS / 2), 0);
  near(scanHeight(PULSE_SECONDS * 1.5), 0); // every pulse the same
  // The flash peaks at 0.6 at FLASH_AT of the way through; half-way it is 0.6·e^−((0.5−0.86)/0.05)² = 0.6·e^−51.84, about 0.
  near(flash(FLASH_AT * PULSE_SECONDS), 0.6);
  assert.ok(flash(PULSE_SECONDS / 2) < 1e-20);
  // The ripple spreads over the first 40%: 0 at the start, 0.5 at 20%, gone at 50%.
  near(ripple(0)!, 0);
  near(ripple(0.2 * PULSE_SECONDS)!, 0.5);
  assert.equal(ripple(0.5 * PULSE_SECONDS), null);
  // The lowest z of the segment (0,0,−0.4)–(1,0,0.4) is −0.4; nothing at all gives −1.
  near(floorOf([0, 0, -0.4, 1, 0, 0.4]), -0.4);
  near(floorOf([]), -1);
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
  // 1280 × 800, words ending at 442: room 358. Fitted it would be (358 − 72) / 3.1 = 92.3 px a radius, under the smallest
  // (0.17 × 800 = 136). So 136: the picture is 3.1 × 136 + 40 = 461.6 tall, its top 800 − 461.6 − 16 = 322.4, its middle
  // 1.45 × 136 lower: 519.6.
  const small = placeShape(1280, 800, 442);
  near(small.scale, 136, 1e-9);
  near(small.cy, 519.6, 1e-9);
  near(small.cx, 640);
  // 1280 × 1400, the same words: room 958, (958 − 72) / 3.1 = 285.81 a radius (between 0.17 and 0.3 × 1280), the picture
  // 3.1 × 285.81 + 40 = 926 tall, exactly the room less 32: its top 1400 − 958 + 16 = 458, its middle 458 + 1.45 × 285.81.
  const roomy = placeShape(1280, 1400, 442);
  near(roomy.scale, 886 / 3.1, 1e-9);
  near(roomy.cy, 458 + 1.45 * (886 / 3.1), 1e-9);
  // Never bigger than 0.3 of the short side: a tall empty window.
  near(placeShape(400, 3000, 0).scale, 120, 1e-9);
  // Words past the window's foot (a long list): smallest, at the foot.
  const under = placeShape(375, 812, 2000);
  near(under.scale, 0.17 * 375, 1e-9);
  near(under.cy, 812 - (3.1 * 0.17 * 375 + 40) - 16 + 1.45 * 0.17 * 375, 1e-9);
});
