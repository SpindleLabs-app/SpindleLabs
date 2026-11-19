// Thin faces (Ben, 2026-11-19): the rules that let a face a few pixels wide on screen be picked (picking.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { beyondNeeded, CORNER_PICK_PX, EDGE_PICK_PX, edgeTakesPick, FACE_TAP_PX, FAN_DIRECTIONS, FAN_PX, faceForTap, fanRays } from "../src/picking.ts";

test("an edge takes the pick only in the outer quarter of a face across the pointer, and only within reach", () => {
  // By hand: a face 3 px wide on screen (a 1 mm plate's side at 3 px/mm) with the pointer 1.5 px from either long edge:
  // 1.5 px is within the edge's 5 px reach, but the face's quarter is 3/4 = 0.75 px, so the face keeps the pick.
  assert.equal(edgeTakesPick(1.5, 1.5, EDGE_PICK_PX), false);
  // The same face, the pointer 0.5 px in from an edge (2.5 px of face beyond): 0.5 < 3/4, the edge's.
  assert.equal(edgeTakesPick(0.5, 2.5, EDGE_PICK_PX), true);
  // A wide face (beyond past three reaches): the old rule, the edge within its reach.
  assert.equal(edgeTakesPick(4.9, Infinity, EDGE_PICK_PX), true);
  assert.equal(edgeTakesPick(4.9, beyondNeeded(EDGE_PICK_PX), EDGE_PICK_PX), true); // 3 × 4.9 = 14.7 < 15
  assert.equal(edgeTakesPick(5, Infinity, EDGE_PICK_PX), false); // exactly the reach is a miss, as before
  assert.equal(edgeTakesPick(0, 0, EDGE_PICK_PX), false); // a face that ends at the pointer: on the line, but nothing to steal
  assert.equal(edgeTakesPick(0, 0.1, EDGE_PICK_PX), true); // right on the edge's line
  // Corners by the same rule at their own reach (16 px for a finger): a 5 × 5 mm end face 8 px across, the tap in
  // its middle, 4√2 ≈ 5.66 px from each corner with 5.66 px of face beyond: the face's.
  assert.equal(edgeTakesPick(4 * Math.SQRT2, 4 * Math.SQRT2, CORNER_PICK_PX.touch), false);
});

test("the quarter line: 0.9 × of it the edge's, 1.1 × the face's", () => {
  // A face w = 4 px across: its quarter is 1 px from the edge (distance d, beyond w − d).
  const w = 4;
  const quarter = w / 4;
  assert.equal(edgeTakesPick(0.9 * quarter, w - 0.9 * quarter, EDGE_PICK_PX), true);
  assert.equal(edgeTakesPick(1.1 * quarter, w - 1.1 * quarter, EDGE_PICK_PX), false);
  assert.equal(edgeTakesPick(quarter, w - quarter, EDGE_PICK_PX), false); // exactly on it the face keeps it
  // And the reach: 0.9 × and 1.1 × of it on a wide face.
  assert.equal(edgeTakesPick(0.9 * EDGE_PICK_PX, Infinity, EDGE_PICK_PX), true);
  assert.equal(edgeTakesPick(1.1 * EDGE_PICK_PX, Infinity, EDGE_PICK_PX), false);
});

/** A picture on screen: x < `split` is face 1 (wide), then face 2 for `thin` px, then face 3 (wide) up to x = `end`, nothing past it. */
const strip = (split: number, thin: number, end = 1000) => (x: number) => (x < split ? 1 : x < split + thin ? 2 : x < end ? 3 : null);

test("a tap: a thin face within reach wins over the wide face under the finger", () => {
  // By hand: a 3 px strip (face 2) from x = 8 to 11 with wide faces either side. A tap at x = 0 on face 1: along +x the
  // fan meets face 2 at 8 px (within 12) and leaves it at 11, 3 px across (< 24): thin, so it is face 2's.
  const look = strip(8, 3);
  assert.equal(faceForTap(fanRays((dx) => look(dx))), 2);
  // A tap on the strip itself keeps it.
  assert.equal(faceForTap(fanRays((dx) => look(9 + dx))), 2);
  // The strip 13 px off (start past 12): the wide face under the tap.
  assert.equal(faceForTap(fanRays((dx) => strip(13, 3)(dx))), 1);
  // A strip 24 px across is not thin (23 is): the wide face under the tap / the strip.
  assert.equal(faceForTap(fanRays((dx) => strip(5, 24)(dx))), 1);
  assert.equal(faceForTap(fanRays((dx) => strip(5, 23)(dx))), 2);
});

test("the reach: a thin face starting 0.9 × FACE_TAP_PX off is the tap's, 1.1 × off is not", () => {
  // Samples fall on whole pixels: 0.9 × 12 = 10.8 → first met at 11 (≤ 12); 1.1 × 12 = 13.2 → at 14 (> 12).
  assert.equal(faceForTap(fanRays((dx) => strip(0.9 * FACE_TAP_PX, 3)(dx))), 2);
  assert.equal(faceForTap(fanRays((dx) => strip(1.1 * FACE_TAP_PX, 3)(dx))), 1);
});

test("a tap off the part takes the nearest face within reach, else nothing", () => {
  // Nothing for x < 0 (beyond the silhouette), a wide face from x = 7: the tap at x = −7 meets it 7 px out.
  const look = (x: number) => (x < 0 ? null : 1);
  assert.equal(faceForTap(fanRays((dx) => look(dx - 7))), 1);
  assert.equal(faceForTap(fanRays((dx) => look(dx - 13))), null); // 13 px off: nothing
  assert.equal(faceForTap(fanRays(() => null)), null);
});

test("the bar's end seen end-on: the tap anywhere on it, or just beside it, picks the end face", () => {
  // A 3 × 3 px square end face (face 5) at the tap's place, the bar's long faces round it on one side only (x < 0).
  const look = (x: number, y: number) => (Math.abs(x) <= 1 && Math.abs(y) <= 1 ? 5 : x < -1 && Math.abs(y) < 40 ? 4 : null);
  assert.equal(faceForTap(fanRays(look)), 5);
  // A tap 6 px left of it, on the long face 4: the end face is 5 px off and 3 across, so it is the end's.
  assert.equal(faceForTap(fanRays((dx, dy) => look(dx - 6, dy))), 5);
  // A big face under the tap with no thin face near: that face.
  assert.equal(faceForTap(fanRays((dx, dy) => look(dx - 30, dy))), 4);
});

test("a fan with an odd number of directions or none picks nothing (no opposite to pair with)", () => {
  assert.equal(faceForTap([]), null);
  assert.equal(faceForTap(fanRays(() => 1, 3)), null);
  assert.equal(fanRays(() => 1).length, FAN_DIRECTIONS);
  assert.equal(fanRays(() => 1)[0].length, FAN_PX + 1);
});
