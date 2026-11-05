// Very small L-brackets, plates and stars (clumsy-user hunt 2026-11-04): typed into the panel, they reached the kernel
// and failed in its words ("profile pieces (0, 0) and (0, 2) (loop, piece) are 8.9e-4 mm apart"), kept as a broken
// part. The panel now refuses them in plain words (properties.ts panelSizeRefused, presetTooSmall), worked out here by
// hand from each outline (profiles.ts), and checked against the kernel on both sides of each limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument } from "../src/document.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { panelSizeRefused } from "../src/properties.ts";

const sizes = (width: number, depth: number, height = 10) => ({ width: String(width), depth: String(depth), height: String(height) });
const kernel = nodeKernel();
async function builds(kind: "l-bracket" | "plate" | "star", w: number, d: number): Promise<boolean> {
  const build = await rebuildTimeline(partDocument(kind, w, d, 10), new BodyCache(kernel), kernel);
  return Object.values(build.results)[0]?.status === "built";
}

test("hand-worked: an L-bracket's arms are 0.3 of its smaller side thick, so it needs a side of 0.001 / 0.3 = 0.00333 mm", async () => {
  // Its thinnest straight is the arm's end, 0.3·min(w, d): at 0.0034 mm that is 0.00102 mm (taken), at 0.0033 mm 0.00099 mm (refused).
  const small = panelSizeRefused("l-bracket", sizes(0.0033, 0.0033));
  assert.ok(small !== null && /L-bracket this small/.test(small) && /at least 0\.0034 mm/.test(small), String(small));
  assert.equal(panelSizeRefused("l-bracket", sizes(0.0034, 0.0034)), null);
  assert.equal(panelSizeRefused("l-bracket", sizes(100, 0.0034)), null, "only the smaller side counts");
  assert.notEqual(panelSizeRefused("l-bracket", sizes(100, 0.0033)), null);
  // 0.9× and 1.1× of the limit side (0.001 / 0.3 mm), and the kernel agrees on both.
  const limit = 0.001 / 0.3;
  assert.notEqual(panelSizeRefused("l-bracket", sizes(0.9 * limit, 0.9 * limit)), null);
  assert.equal(panelSizeRefused("l-bracket", sizes(1.1 * limit, 1.1 * limit)), null);
  assert.equal(await builds("l-bracket", 0.9 * limit, 0.9 * limit), false);
  assert.equal(await builds("l-bracket", 1.1 * limit, 1.1 * limit), true);
});

test("hand-worked: a plate's holes are 0.15 of its smaller side in radius, a quarter in from each end", async () => {
  // Radius 0.15·m (m = min(w, d)) must be 0.001 mm: m ≥ 0.00667. The gap from a hole to the near end is w/4 − 0.15·m:
  // at w = d = 0.008 the holes are 0.0012 mm in radius (fine) but 0.002 − 0.0012 = 0.0008 mm from the ends (refused);
  // at 0.01 the gap is 0.0025 − 0.0015 = 0.001 mm, just enough.
  for (const [w, d] of [[0.006, 0.006], [0.008, 0.008], [0.008, 100], [100, 0.006]]) {
    const why = panelSizeRefused("plate", sizes(w, d));
    assert.ok(why !== null && /plate this small/.test(why) && /at least 0\.01 mm/.test(why), `${w} × ${d}: ${why}`);
  }
  assert.equal(panelSizeRefused("plate", sizes(0.0101, 0.0101)), null);
  assert.equal(panelSizeRefused("plate", sizes(100, 0.00667)), null, "a long plate's holes are far from its ends: only their radius counts");
  // 0.9× and 1.1× of each limit, and the kernel agrees on both: the radius (a long plate) and the end gap (a square one).
  const radiusLimit = 0.001 / 0.15;
  assert.notEqual(panelSizeRefused("plate", sizes(100, 0.9 * radiusLimit)), null);
  assert.equal(panelSizeRefused("plate", sizes(100, 1.1 * radiusLimit)), null);
  assert.equal(await builds("plate", 100, 0.9 * radiusLimit), false);
  assert.equal(await builds("plate", 100, 1.1 * radiusLimit), true);
  const gapLimit = 0.001 / 0.1; // w = d = m: w/4 − 0.15·m = 0.1·m
  assert.notEqual(panelSizeRefused("plate", sizes(0.9 * gapLimit, 0.9 * gapLimit)), null);
  assert.equal(panelSizeRefused("plate", sizes(1.1 * gapLimit, 1.1 * gapLimit)), null);
  assert.equal(await builds("plate", 0.9 * gapLimit, 0.9 * gapLimit), false);
  assert.equal(await builds("plate", 1.1 * gapLimit, 1.1 * gapLimit), true);
});

test("hand-worked: a star's nearest sides are 0.2221 of its smaller side apart, so it needs a side of 0.0045 mm", async () => {
  // Outer radius r = m/2, inner 0.4·r, ten corners 36° apart. With r = 1: inner corner 1 at 36° is (0.3236, 0.2351), outer
  // corner 2 at 72° is (0.3090, 0.9511), inner corner 3 at 108° is (−0.1236, 0.3804). Side 2 runs from corner 2 to 3:
  // v = (−0.4326, −0.5706), |v| = 0.7160. Corner 1 from corner 2: (0.0146, −0.7159); cross product 0.3180, so corner 1
  // is 0.3180 / 0.7160 = 0.4442·r = 0.2221·m from side 2, nearer than any side is long (0.7160·r).
  const gap = 0.2221;
  const limit = 0.001 / gap; // 0.004502 mm
  const small = panelSizeRefused("star", sizes(0.0045, 0.0045));
  assert.ok(small !== null && /star this small/.test(small) && /at least 0\.0046 mm/.test(small), String(small));
  assert.equal(panelSizeRefused("star", sizes(0.0046, 0.0046)), null);
  assert.notEqual(panelSizeRefused("star", sizes(100, 0.004)), null, "only the smaller side counts");
  assert.notEqual(panelSizeRefused("star", sizes(0.9 * limit, 0.9 * limit)), null);
  assert.equal(panelSizeRefused("star", sizes(1.1 * limit, 1.1 * limit)), null);
  assert.equal(await builds("star", 0.9 * limit, 0.9 * limit), false);
  assert.equal(await builds("star", 1.1 * limit, 1.1 * limit), true);
});

test("seeded sweep: every L-bracket, plate and star size the panel takes builds, and every one it refuses for its size fails", async () => {
  // mulberry32 seed 11: sides from 0.002 to 0.03 mm, each side drawn on its own (lopsided ones too).
  let a = 11;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 60; i++) {
    const kind = (["l-bracket", "plate", "star"] as const)[i % 3];
    const w = Number((0.002 + r() * 0.028).toPrecision(4));
    const d = r() < 0.2 ? 50 : Number((0.002 + r() * 0.028).toPrecision(4));
    const refused = panelSizeRefused(kind, sizes(w, d)) !== null;
    assert.equal(await builds(kind, w, d), !refused, `${kind} ${w} × ${d}: the panel ${refused ? "refuses" : "takes"} it`);
  }
});
