// The drawing's outer box (box2d.ts): hand-worked curves with the working shown, and seeded random curves under
// random affine maps against a simple model (the curve sampled densely by its own formula, written here apart).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addArc, addCubic, addLine, addQuadratic, Box, bulgeArc, compose, IDENTITY, map, onSweep, unitRoots, type Affine, type Pt } from "../src/box2d.ts";

const close = (a: number, b: number, eps = 1e-12, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);
function boxOf(f: (b: Box) => void): Box {
  const b = new Box();
  f(b);
  return b;
}

test("hand-worked: a quarter of the unit circle, a cubic and a quadratic", () => {
  // The arc from 0 to 90° of the unit circle runs from (1, 0) to (0, 1) through the first quadrant: its box is [0, 1]².
  const q = boxOf((b) => addArc(b, IDENTITY, [0, 0], [1, 0], [0, 1], 0, Math.PI / 2));
  assert.deepEqual([q.minX, q.minY, q.maxX, q.maxY].map((v) => Math.round(v * 1e12) / 1e12), [0, 0, 1, 1]);
  // From 80° to 100°: the top of the circle, y = 1 at 90°, is inside the sweep though neither end reaches it.
  const top = boxOf((b) => addArc(b, IDENTITY, [0, 0], [1, 0], [0, 1], (80 * Math.PI) / 180, (20 * Math.PI) / 180));
  close(top.maxY, 1, 1e-15, "top");
  close(top.maxX, Math.cos((80 * Math.PI) / 180), 1e-15, "right end");
  // Cubic (0,0) (0,1) (1,1) (1,0): y(t) = 3t(1−t)·1 (the two middle Bernstein terms 3(1−t)²t + 3(1−t)t² = 3t(1−t)),
  // largest at t = ½: 3·½·½ = 0.75. Its x runs 0 to 1 without going past.
  const c = boxOf((b) => addCubic(b, IDENTITY, [0, 0], [0, 1], [1, 1], [1, 0]));
  close(c.maxY, 0.75, 1e-15, "cubic top");
  close(c.minX, 0);
  close(c.maxX, 1);
  // Quadratic (0,0) (1,2) (2,0): y(t) = 2·2t(1−t), largest at t = ½: 1 (half the control point's height).
  const qd = boxOf((b) => addQuadratic(b, IDENTITY, [0, 0], [1, 2], [2, 0]));
  close(qd.maxY, 1, 1e-15, "quadratic top");
});

test("hand-worked: an ellipse turned 45° and a map's effect", () => {
  // Ellipse rx 2, ry 1 turned by 45°: x(θ) = 2cos θ cos 45° − sin θ sin 45°, whose largest value is
  // √((2 cos 45°)² + (sin 45°)²) = √(2 + 0.5) = √2.5; the same for y by symmetry.
  const s = Math.SQRT1_2;
  const e = boxOf((b) => addArc(b, IDENTITY, [0, 0], [2 * s, 2 * s], [-s, s], 0, 2 * Math.PI));
  close(e.maxX, Math.sqrt(2.5), 1e-14, "x");
  close(e.maxY, Math.sqrt(2.5), 1e-14, "y");
  close(e.minX, -Math.sqrt(2.5), 1e-14, "−x");
  // The same through a map: the unit circle scaled by (2, 1) then turned 45° is that ellipse.
  const turn: Affine = [s, s, -s, s, 0, 0];
  const viaMap = boxOf((b) => addArc(b, compose(turn, [2, 0, 0, 1, 0, 0]), [0, 0], [1, 0], [0, 1], 0, 2 * Math.PI));
  close(viaMap.maxX, Math.sqrt(2.5), 1e-14, "mapped");
  // compose: outer after inner. Shift by (5, 0) after doubling sends (1, 1) to (7, 2); doubling after the shift to (12, 2).
  assert.deepEqual(map(compose([1, 0, 0, 1, 5, 0], [2, 0, 0, 2, 0, 0]), [1, 1]), [7, 2]);
  assert.deepEqual(map(compose([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 5, 0]), [1, 1]), [12, 2]);
});

test("hand-worked: arcs from a DXF bulge", () => {
  // Bulge 1 from (0,0) to (2,0): sweep 4·atan 1 = π, a half circle on the chord, centre (1, 0), radius 1, turning
  // counter-clockwise from the start (angle π) to angle 2π through 3π/2, so it dips to (1, −1).
  const half = bulgeArc([0, 0], [2, 0], 1)!;
  close(half.c[0], 1);
  close(half.c[1], 0, 1e-15);
  close(half.r, 1);
  close(half.sweep, Math.PI);
  const hb = boxOf((b) => addArc(b, IDENTITY, half.c, [half.r, 0], [0, half.r], half.theta0, half.sweep));
  close(hb.minY, -1);
  close(hb.maxY, 0, 1e-15);
  // Bulge ½ on the same chord: sagitta = bulge × half-chord = 0.5, so the arc dips to y = −0.5; the radius is
  // (h² + s²) / 2s = (1 + 0.25) / 1 = 1.25 and the centre sits above the chord at 1.25 − 0.5 = 0.75.
  const shallow = bulgeArc([0, 0], [2, 0], 0.5)!;
  close(shallow.r, 1.25, 1e-15);
  close(shallow.c[1], 0.75, 1e-15);
  const sb = boxOf((b) => addArc(b, IDENTITY, shallow.c, [shallow.r, 0], [0, shallow.r], shallow.theta0, shallow.sweep));
  close(sb.minY, -0.5, 1e-15);
  // A negative bulge turns clockwise: the arc bulges up instead.
  const up = bulgeArc([0, 0], [2, 0], -0.5)!;
  const ub = boxOf((b) => addArc(b, IDENTITY, up.c, [up.r, 0], [0, up.r], up.theta0, up.sweep));
  close(ub.maxY, 0.5, 1e-15);
  assert.equal(bulgeArc([0, 0], [2, 0], 0), null);
  assert.equal(bulgeArc([1, 1], [1, 1], 1), null);
});

test("sweeps either way round, and roots of the derivative", () => {
  assert.equal(onSweep(Math.PI / 2, 0, Math.PI), true);
  assert.equal(onSweep(Math.PI / 2, 0, -Math.PI), false, "clockwise from 0 goes through −π/2, not π/2");
  assert.equal(onSweep(-Math.PI / 2, 0, -Math.PI), true);
  assert.equal(onSweep(0.1, 2 * Math.PI - 0.2, 0.4), true, "across 0");
  assert.equal(onSweep(3, 0, 7), true, "a whole turn holds every angle");
  // (t − ¼)(t − ½) = t² − ¾t + ⅛, (2t − 1) = 0 for a vanishing t² term, and roots outside (0, 1) left out.
  assert.deepEqual(unitRoots(1, -0.75, 0.125).sort(), [0.25, 0.5]);
  assert.deepEqual(unitRoots(0, 2, -1), [0.5]);
  assert.deepEqual(unitRoots(1, -3, 2), []);
});

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded random curves under random maps: the box holds every sampled point and is reached by them", () => {
  const N = 4000;
  for (let seed = 1; seed <= 300; seed++) {
    const r = mulberry(seed);
    const v = () => (r() - 0.5) * 200;
    const m: Affine = [v() / 50, v() / 50, v() / 50, v() / 50, v(), v()];
    const pt = (): Pt => [v(), v()];
    const kind = seed % 4;
    // The model: the curve's points by its own formula, mapped point by point.
    const samples: Pt[] = [];
    const ours = new Box();
    if (kind === 0) {
      const p = [pt(), pt(), pt(), pt()] as [Pt, Pt, Pt, Pt];
      addCubic(ours, m, ...p);
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const s = 1 - t;
        const w = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
        samples.push(map(m, [0, 1].map((a) => w.reduce((acc, wi, i) => acc + wi * (p[i] as Pt)[a]!, 0)) as Pt));
      }
    } else if (kind === 1) {
      const p = [pt(), pt(), pt()] as [Pt, Pt, Pt];
      addQuadratic(ours, m, ...p);
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const s = 1 - t;
        samples.push(map(m, [0, 1].map((a) => s * s * p[0][a]! + 2 * s * t * p[1][a]! + t * t * p[2][a]!) as Pt));
      }
    } else if (kind === 2) {
      const c = pt();
      const u = pt();
      const w = pt();
      const t0 = (r() - 0.5) * 20;
      const sw = (r() - 0.5) * 16;
      addArc(ours, m, c, u, w, t0, sw);
      for (let k = 0; k <= N; k++) {
        const t = t0 + (sw * k) / N;
        samples.push(map(m, [c[0] + u[0] * Math.cos(t) + w[0] * Math.sin(t), c[1] + u[1] * Math.cos(t) + w[1] * Math.sin(t)]));
      }
    } else {
      const a = pt();
      const b = pt();
      addLine(ours, m, a, b);
      for (let k = 0; k <= N; k++) samples.push(map(m, [a[0] + ((b[0] - a[0]) * k) / N, a[1] + ((b[1] - a[1]) * k) / N]));
    }
    const model = new Box();
    for (const s of samples) model.add(s);
    const size = Math.max(model.width, model.height, 1);
    // Ours holds every sample (to rounding)…
    assert.ok(ours.minX <= model.minX + 1e-9 * size && ours.maxX >= model.maxX - 1e-9 * size && ours.minY <= model.minY + 1e-9 * size && ours.maxY >= model.maxY - 1e-9 * size, `seed ${seed}: a sample outside the box`);
    // …and is no bigger than the samples, but for the gap between samples (a smooth curve sampled 4000 times comes
    // within (step)²·curvature of its extreme: well under 1e-4 of its size here).
    const slack = 1e-4 * size;
    assert.ok(ours.minX >= model.minX - slack && ours.maxX <= model.maxX + slack && ours.minY >= model.minY - slack && ours.maxY <= model.maxY + slack, `seed ${seed} kind ${kind}: the box is bigger than the curve`);
  }
});
