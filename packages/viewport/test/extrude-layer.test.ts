// Which offered outline a click in the view picks (ExtrudeLayer.profileAt):
// two closed sketches on one plane, a small circle drawn inside a big
// rectangle. Coplanar outlines are as far away, so the click inside the
// circle (which the user sees as the circle) picked whichever was listed
// first, and with the rectangle first the circle could never be picked or
// hovered in the view; now the smaller region wins, as in Fusion.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfferedProfile, Plane } from "@fission/core";
import { ExtrudeLayer, TIE_REL } from "../src/extrude-layer.ts";
import { outlineArea } from "../src/extrude-pick.ts";

const XY: Plane = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };
const rectangle: OfferedProfile = { id: "sketch-1", plane: XY, outline: { outer: { path: { corners: [0, 0, 40, 0, 40, 30, 0, 30], bulges: [] } }, holes: [] } };
const circle: OfferedProfile = { id: "sketch-2", plane: XY, outline: { outer: { circle: { center: [20, 15], radius: 5 } }, holes: [] } };

function pickAt(profiles: OfferedProfile[], x: number, y: number) {
  const layer = new ExtrudeLayer();
  layer.show({ profiles, chosen: null, preview: null, arrow: null });
  // Looking straight down at (x, y) from 100 mm above XY; no body in the way.
  return layer.profileAt([x, y, 100], [0, 0, -1], null);
}

test("a click inside a small circle drawn inside a bigger rectangle on the same plane picks the circle, whichever is listed first", () => {
  // (20, 15) is the circle's centre: inside both outlines; the circle (25π = 78.5 mm²) is smaller than the rectangle (1200 mm²).
  assert.equal(pickAt([circle, rectangle], 20, 15), "sketch-2", "circle listed first");
  assert.equal(pickAt([rectangle, circle], 20, 15), "sketch-2", "rectangle listed first (Sketch 1 drawn first, the usual order)");
});

test("control: a click in the rectangle outside the circle picks the rectangle", () => {
  assert.equal(pickAt([rectangle, circle], 2, 2), "sketch-1");
  assert.equal(pickAt([circle, rectangle], 2, 2), "sketch-1");
});

test("the nearer outline still wins over a smaller one behind it: the circle's plane TIE_REL × 0.9 below is as near, 1.1 × is further", () => {
  // Seen from 100 mm above XY: the rectangle at 100 mm, the circle on a plane dz below it at 100 + dz. Within
  // TIE_REL × 100 they are as near and the smaller (the circle) wins; past it the rectangle is nearer and wins.
  const lowered = (dz: number): OfferedProfile => ({ ...circle, plane: { ...XY, origin: [0, 0, -dz] } });
  assert.equal(pickAt([rectangle, lowered(0.9 * TIE_REL * 100)], 20, 15), "sketch-2");
  assert.equal(pickAt([rectangle, lowered(1.1 * TIE_REL * 100)], 20, 15), "sketch-1");
});

test("hand-worked: outline areas, a rectangle with a hole and a half disc", () => {
  // 40 × 30 less a hole of radius 5: 1200 − 25π = 1121.460…
  const holed = { outer: rectangle.outline.outer, holes: [circle.outline.outer] };
  assert.ok(Math.abs(outlineArea(holed) - (1200 - 25 * Math.PI)) < 1e-9, `${outlineArea(holed)}`);
  // (−10, 0) to (10, 0), then back round with bulge 1 (a half turn): the half disc of radius 10, 50π = 157.08…
  const half = { outer: { path: { corners: [-10, 0, 10, 0], bulges: [0, 1] } }, holes: [] };
  assert.ok(Math.abs(outlineArea(half) - 50 * Math.PI) < 1e-9, `${outlineArea(half)}`);
  // A 10 × 10 square (counter-clockwise) whose top, run (10, 10) to (0, 10), bulges in by a quarter turn (bulge −tan(θ/4),
  // θ = π/2): r = chord / (2 sin(θ/2)) = 10/√2, so 100 less the segment r²(θ − sin θ)/2 = 25(π/2 − 1): 85.73…
  const dented = { outer: { path: { corners: [0, 0, 10, 0, 10, 10, 0, 10], bulges: [0, 0, -Math.tan(Math.PI / 8), 0] } }, holes: [] };
  assert.ok(Math.abs(outlineArea(dented) - (100 - 25 * (Math.PI / 2 - 1))) < 1e-9, `${outlineArea(dented)}`);
});
