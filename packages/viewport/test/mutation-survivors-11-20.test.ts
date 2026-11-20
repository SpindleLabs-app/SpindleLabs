// Mutation survivors of the 2026-11-19 nightly (SL #219 pane.ts, #443 picking.ts): the thin-face tap (#866) and the
// pane's colour map and keep-angle fit. Each test pins a rule a mutant broke without any test noticing. The fans are
// built by hand, one face number per pixel out from the tap, so every crossing can be worked out by eye.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SharedViewport } from "@fission/core";
import { FACE_TAP_PX, FAN_DIRECTIONS, FAN_PX, faceForTap, fanRays, type FanHit } from "../src/picking.ts";
import { paneViewports, type PaneCamera } from "../src/pane.ts";

/** A ray from a list of faces, the i-th met i px out from the tap. */
const ray = (faces: readonly (number | null)[]): FanHit[] => faces.map((face, at) => ({ face, at }));
/** `n` samples of one face. */
const run = (face: number | null, n: number) => Array.from({ length: n }, () => face);

test("a fan whose rays have no samples picks nothing instead of failing", () => {
  // Two empty rays: nothing under the tap, nothing met, so null (rays[0][0] is missing, not a hit at 0).
  assert.equal(faceForTap([[], []]), null);
});

test("the face under the tap is only the one met at 0 px", () => {
  // Ray 0 meets face 7 first, but 20 px out (past the 12 px reach): no face is under the tap. Ray 1 meets face 8
  // 3 px out, the nearest face within reach, so a tap off the part takes 8, never 7.
  const r0 = ray([...run(null, 20), 7, 7]);
  const r1 = ray([null, null, null, 8, 8]);
  assert.equal(faceForTap([r0, r1]), 8);
});

test("a thin face starting exactly FACE_TAP_PX off is still within reach", () => {
  // By hand: a 3 px strip from x = 12 to 15 beside a wide face; 12 ≤ 12, so the strip is the tap's.
  const look = (x: number) => (x < FACE_TAP_PX ? 1 : x < FACE_TAP_PX + 3 ? 2 : 3);
  assert.equal(faceForTap(fanRays((dx) => look(dx))), 2);
});

test("off the part, the nearest face met wins, the first one on a tie", () => {
  // Rays 0 and 1 are opposites (+x, −x). Wide faces only, so nothing is thin and the nearest start decides.
  // Face 1 from 3 px along +x, face 2 from 9 px along −x: 3 < 9, so 1, whichever ray comes first.
  const near = ray([null, null, null, ...run(1, 30)]);
  const far = ray([...run(null, 9), ...run(2, 24)]);
  assert.equal(faceForTap([near, far]), 1);
  assert.equal(faceForTap([far, near]), 1);
  // Both 5 px off: the first ray's face keeps it.
  const a = ray([...run(null, 5), ...run(1, 28)]);
  const b = ray([...run(null, 5), ...run(2, 28)]);
  assert.equal(faceForTap([a, b]), 1);
  assert.equal(faceForTap([b, a]), 2);
});

test("a face that runs to the end of its ray was not crossed, so it is not thin", () => {
  // Ray 0: the tap on face 1 for 2 px, then face 2 from 2 px to the ray's end (5 px). Face 2 is 4 px across as far as
  // the ray sees, but its far side was never seen, so it is not known to be thin: the face under the tap, 1, stays.
  // Ray 1 (the opposite) is face 1 to its end, so the tap's own face is not crossed either.
  const r0 = ray([1, 1, 2, 2, 2, 2]);
  const r1 = ray(run(1, 6));
  assert.equal(faceForTap([r0, r1]), 1);
});

/** A second direction pair with a thin face 4 one pixel out (crossed, 2 px across) and the tap's face 2 wide the other way. */
const thinFourPair = (n: number) => [ray([2, 4, 4, ...run(5, n - 3)]), ray(run(2, n))];

test("the tap's own face is crossed only if the opposite ray also leaves it before its end", () => {
  // Direction 0: face 2 at the tap, then face 3. Its opposite (rays[2]) is face 2 to the end, 3 samples long: the
  // tap's face is never seen to end that way, so it is not thin, and the thin face 4 met 1 px out on direction 1 wins.
  const [p, q] = thinFourPair(4);
  assert.equal(faceForTap([ray([2, 3, 3]), p, ray([2, 2, 2]), q]), 4);
});

test("the tap's own face is crossed only if the opposite ray starts on that same face", () => {
  // The opposite ray starts on face 7, not on the tap's face 2: the two rays did not cross one face, so 2 is not
  // thin (and nor is 7, whose opposite starts on 2), and the thin face 4 wins.
  const [p, q] = thinFourPair(4);
  assert.equal(faceForTap([ray([2, 3, 3, 3]), p, ray([7, 7, 8, 8]), q]), 4);
});

test("the tap's own face measured across both ways: 24 px is not thin", () => {
  // Face 2 at the tap for 21 samples along direction 0 (0 to 20 px), then face 3; 4 samples the other way (0 to 3 px),
  // then face 1. Across: 20 + 3 + 1 = 24 px, not under 2 × 12 = 24, so not thin; the thin face 4 (1 px out, 2 across)
  // on direction 1 wins. Counting it 22 (− 1) or 20 − 3 + 1 = 18 would wrongly make the tap's face thin.
  const [p, q] = thinFourPair(22);
  assert.equal(faceForTap([ray([...run(2, 21), 3]), p, ray([...run(2, 4), 1]), q]), 4);
  // One pixel narrower (23 px across: 20 + 2 + 1) it is thin, and the tap's own face (0 px off) wins.
  assert.equal(faceForTap([ray([...run(2, 21), 3]), p, ray([...run(2, 3), 1, 1]), q]), 2);
});

test("of two thin faces the nearer start wins, the first one met on a tie", () => {
  // The tap on face 1, wide every way (30 samples, its opposite rays face 1 to the end, so it is never thin).
  // Face 4 is thin 2 px out (2 to 3), face 5 thin 5 px out (5 to 6), face 6 thin 2 px out like 4.
  const four = ray([1, 1, 4, 4, ...run(1, 26)]);
  const five = ray([1, 1, 1, 1, 1, 5, 5, ...run(1, 23)]);
  const six = ray([1, 1, 6, 6, ...run(1, 26)]);
  const wide = ray(run(1, 30));
  assert.equal(faceForTap([five, four, wide, wide]), 4); // 2 < 5, met second
  assert.equal(faceForTap([four, five, wide, wide]), 4); // 2 < 5, met first
  assert.equal(faceForTap([four, six, wide, wide]), 4); // a tie at 2 px: the first met
});

test("a fan asks the picture once for the tap's own point, then once per pixel out on each ray", () => {
  // 1 look at (0, 0) shared by every ray, then FAN_PX more on each of the 16 directions: 1 + 16 × 36 = 577.
  let looks = 0;
  fanRays(() => (looks++, 1));
  assert.equal(looks, 1 + FAN_DIRECTIONS * FAN_PX);
  assert.equal(looks, 577);
});

/** The least viewer a pane can wrap: only what these tests call. */
function scene(extra: Partial<SharedViewport> = {}): SharedViewport {
  return { onPick: null, onSketchPointer: null, onExtrudePointer: null, onMovePointer: null, ...extra } as unknown as SharedViewport;
}
const view = (extra: Partial<PaneCamera> = {}) => ({ element: {} as HTMLElement, ...extra }) as unknown as PaneCamera;

test("a pane passes the colour map to the viewer, and a viewer without one is left alone", () => {
  const got: (readonly number[] | null)[] = [];
  const pane = paneViewports(scene({ showColourMap: (c: readonly number[] | null) => void got.push(c) } as Partial<SharedViewport>))(view());
  pane.showColourMap?.([1, 2, 3]);
  pane.showColourMap?.(null);
  assert.deepEqual(got, [[1, 2, 3], null]);
  // A viewer with no colour map (a test viewer, an older one): the call does nothing rather than throw.
  const bare = paneViewports(scene())(view());
  assert.doesNotThrow(() => bare.showColourMap?.([4]));
});

test("a pane whose view keeps the angle on a fit offers that fit, and it reaches the view", () => {
  let fits = 0;
  const framed = { centre: [0, 0, 0] as [number, number, number], radius: 2 };
  const pane = paneViewports(scene())(view({ fitKeepAngle: () => (fits++, framed) }));
  assert.equal(typeof pane.fitKeepAngle, "function");
  assert.equal(pane.fitKeepAngle?.(), framed);
  assert.equal(fits, 1);
  // A view without it: the pane offers none.
  assert.equal(paneViewports(scene())(view()).fitKeepAngle, undefined);
});
