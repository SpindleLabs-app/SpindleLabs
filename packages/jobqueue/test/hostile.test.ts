// Hostile laser files (security hunt 2026-11-13, D1 and D2, private bug-reports#6): small files built to make the
// file check run for minutes or hours. Each must be answered, passed or refused in words, quickly. The sizes are
// picked so the reader before the fix took tens of seconds or more on each (measured, in the comments); the bounds are
// several times what the fixed reader takes, so a slow test machine doesn't turn them red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLaserFile } from "../src/check.ts";
import { DXF_LIMITS } from "../src/dxf.ts";

const enc = (s: string) => new TextEncoder().encode(s);
function timed(name: string, text: string) {
  const t0 = performance.now();
  const r = checkLaserFile(name, enc(text));
  return { ms: performance.now() - t0, r };
}

/** D1's file: one SPLINE of `points` control points and degree `p` in a block, each block placed `fan` times by the next. */
function blockBomb(points: number, levels: number, fan: number, p = 25): string {
  const L: (string | number)[] = [0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 2, "B0", 10, 0, 20, 0, 0, "SPLINE", 8, "0", 62, 1, 71, p];
  for (let k = 0; k < points + p + 1; k++) L.push(40, k < p + 1 ? 0 : k >= points ? points - p : k - p);
  for (let k = 0; k < points; k++) L.push(10, k % 7, 20, k % 5);
  L.push(0, "ENDBLK");
  for (let l = 1; l <= levels; l++) {
    L.push(0, "BLOCK", 2, `B${l}`, 10, 0, 20, 0);
    for (let f = 0; f < fan; f++) L.push(0, "INSERT", 2, `B${l - 1}`, 10, 0, 20, 0);
    L.push(0, "ENDBLK");
  }
  L.push(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES", 0, "INSERT", 2, `B${levels}`, 10, 0, 20, 0, 0, "ENDSEC", 0, "EOF");
  return L.join("\n") + "\n";
}

test("D1: a spline in blocks placed 2^15 times (8 KB) is refused in words, quickly", () => {
  // Before: about 170 ms a placement, so 32,768 placements were about 90 minutes.
  const { ms, r } = timed("bomb.dxf", blockBomb(400, 15, 2));
  assert.ok(!r.passed && /too detailed to check/.test(r.reason), r.passed ? "passed" : r.reason);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test("D1: the same spline placed 64 times is still read, and quickly (its samples are worked out once)", () => {
  // Before: 10.7 s.
  const { ms, r } = timed("bomb.dxf", blockBomb(400, 6, 2));
  assert.ok(r.passed, r.passed ? "" : r.reason);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test("D1: a cubic spline's many samples placed 2^13 times are charged, not only its groups", () => {
  // 400 control points of degree 3 make 397 spans × 65 samples, about 25,800 points a placement against 1,200 groups:
  // 8,192 placements are 16 million groups' work but 211 million points.
  const { ms, r } = timed("cubic.dxf", blockBomb(400, 13, 2, 3));
  assert.ok(!r.passed && /too detailed to check/.test(r.reason), r.passed ? "passed" : r.reason);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test("D1: many cheap entities fanned out by blocks are capped by the work, not only the count", () => {
  // A 2,000-vertex polyline placed 4^7 = 16,384 times: 33 million vertices from a 30 KB file.
  const L: (string | number)[] = [0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 2, "B0", 10, 0, 20, 0, 0, "LWPOLYLINE", 8, "0", 62, 1, 90, 2000, 70, 0];
  for (let k = 0; k < 2000; k++) L.push(10, k % 13, 20, k % 11);
  L.push(0, "ENDBLK");
  for (let l = 1; l <= 7; l++) {
    L.push(0, "BLOCK", 2, `B${l}`, 10, 0, 20, 0);
    for (let f = 0; f < 4; f++) L.push(0, "INSERT", 2, `B${l - 1}`, 10, 0, 20, 0);
    L.push(0, "ENDBLK");
  }
  L.push(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES", 0, "INSERT", 2, "B7", 10, 0, 20, 0, 0, "ENDSEC", 0, "EOF");
  const { ms, r } = timed("fan.dxf", L.join("\n") + "\n");
  assert.ok(!r.passed && /too detailed to check/.test(r.reason), r.passed ? "passed" : r.reason);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test("D1 (lead U2): one spline at the control-point limit and the highest degree, with no blocks, is answered quickly", () => {
  const { ms, r } = timed("one.dxf", blockBomb(DXF_LIMITS.splinePoints, 0, 1));
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms (${r.passed ? "passed" : r.reason})`);
});

const SVG = (inner: string, attrs = 'width="10mm" height="10mm" viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}<rect width="5" height="5" stroke="#ff0000" fill="none"/></svg>`;
const N = 200_000;

test("D2: hostile SVG text answered quickly (each was quadratic: about 19 s or more at 200 KB before)", () => {
  const cases: [string, string][] = [
    ["a width of 1, spaces, then a bad character", SVG("", `width="1${" ".repeat(N)}!" height="10mm" viewBox="0 0 10 10"`)],
    ["a style sheet with no brace", SVG(`<style>${"a".repeat(N)}</style>`)],
    ["a style sheet of comment openings never closed", SVG(`<style>${"/*".repeat(N / 2)}</style>`)],
    ["a transform, then spaces and no function", SVG(`<rect width="5" height="5" stroke="#ff0000" fill="none" transform="translate(1)${" ".repeat(N)}x"/>`)],
    // Lead U1 (a slice of the file after each attribute): measured harmless, as the engine shares a slice's memory;
    // read without the slice anyway, and kept here as a guard.
    ["an element with very many attributes", SVG(`<g ${Array.from({ length: 20_000 }, (_, k) => `a${k}="1"`).join(" ")}></g>`)],
    // Every element was matched against every style rule: 20,000 × 20,000.
    ["many rules and many elements", SVG(`<style>${Array.from({ length: 20_000 }, (_, k) => `.c${k}{fill:none}`).join("")}</style>${'<rect class="c1" width="1" height="1" stroke="#f00" fill="none"/>'.repeat(20_000)}`)],
    ["an entity reference that never ends", SVG(`<rect id="&${"a".repeat(N)}" width="5" height="5" stroke="#f00" fill="none"/>`)],
  ];
  for (const [what, text] of cases) {
    const { ms, r } = timed("a.svg", text);
    assert.ok(ms < 1000, `${what}: ${ms.toFixed(0)} ms (${r.passed ? "passed" : r.reason})`);
  }
});

test("D2: the refusals stay in words", () => {
  const r = checkLaserFile("a.svg", enc(SVG(`<style>${"a".repeat(1000)}</style>`)));
  assert.ok(!r.passed && /<style> sheet the check can't read/.test(r.reason));
  const w = checkLaserFile("a.svg", enc(SVG("", `width="1${" ".repeat(1000)}!" height="10mm" viewBox="0 0 10 10"`)));
  assert.ok(w.passed || /size/.test(w.reason));
});
