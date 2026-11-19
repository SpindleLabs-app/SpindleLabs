// SL #759 items 3 and 4: the frame maths behind a body's base frame (face-sketch.ts `onBase`, `offBase`, `bareFrame`,
// `movedFrame` keeping `base`) and a body's points carried with a change of size (`bodyMap`), each worked out by hand.
// A frame is a map of points u ↦ s R u + o (s its size, R its axes x, y = normal × x, normal as columns, o its origin).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bareFrame, bodyMap, movedFrame, offBase, onBase, type BodyFrame } from "../src/face-sketch.ts";
import { originFrameNow } from "../src/built-body.ts";

const near = (got: readonly number[], want: readonly number[], what: string) => assert.ok(got.every((g, k) => Math.abs(g - want[k]) < 1e-12), `${what}: ${got} want ${want}`);

test("onBase by hand: p∘base puts p's point at base's origin and turns base's axes by p's, keeping p's size", () => {
  // p: origin (10, 0, 0), the world's axes, size 2. base: origin (0, 5, 0), x along Y, normal along Z.
  // p∘base's origin is p((0, 5, 0)) = (10, 0, 0) + 2 (0, 5, 0) = (10, 10, 0); its axes R_p (0, 1, 0) = (0, 1, 0) and
  // R_p (0, 0, 1) = (0, 0, 1) (R_p is no turn); its size p's, 2.
  const p: BodyFrame = { origin: [10, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1], size: 2 };
  const got = onBase(p, { origin: [0, 5, 0], xAxis: [0, 1, 0], normal: [0, 0, 1] });
  near(got.origin, [10, 10, 0], "origin");
  near(got.xAxis, [0, 1, 0], "x");
  near(got.normal, [0, 0, 1], "normal");
  assert.equal(got.size, 2);
  assert.equal(Object.hasOwn(got, "base"), false, "never holds a base: it is written to a file");
  // Turned: p a quarter turn about Z (x along Y). base's origin (0, 5, 0) turns to (−5, 0, 0): origin (10 − 10, 0, 0)
  // with size 2 = (0, 0, 0); base's x (0, 1, 0) turns to (−1, 0, 0).
  const turned = onBase({ ...p, xAxis: [0, 1, 0] }, { origin: [0, 5, 0], xAxis: [0, 1, 0], normal: [0, 0, 1] });
  near(turned.origin, [0, 0, 0], "turned origin");
  near(turned.xAxis, [-1, 0, 0], "turned x");
});

test("offBase by hand: a face frame M∘B with its base B gives M back; a frame with no base is itself", () => {
  // M: origin (3, 4, 5), a quarter turn about Z (x along Y), size 2. B: origin (1, 0, 0), the world's axes.
  // M∘B's origin is M((1, 0, 0)) = (3, 4, 5) + 2 (0, 1, 0) = (3, 6, 5), its axes M's (B turns nothing), its size 2.
  const B = { origin: [1, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };
  const now: BodyFrame = { origin: [3, 6, 5], xAxis: [0, 1, 0], normal: [0, 0, 1], size: 2, base: B };
  const m = offBase(now);
  near(m.origin, [3, 4, 5], "origin");
  near(m.xAxis, [0, 1, 0], "x");
  near(m.normal, [0, 0, 1], "normal");
  assert.equal(m.size, 2);
  assert.equal(m.base, undefined);
  const plain: BodyFrame = { origin: [1, 2, 3], xAxis: [1, 0, 0], normal: [0, 0, 1] };
  assert.equal(offBase(plain), plain);
});

test("movedFrame keeps the base through every Move; bareFrame takes it off", () => {
  const B = { origin: [50, 0, 0], xAxis: [0, 1, 0], normal: [1, 0, 0] };
  // Moved 20 along x: the frame's origin (50, 0, 0) goes to (70, 0, 0), its axes stay; its base is still B.
  const moved = movedFrame({ ...B, base: B }, [{ move: [20, 0, 0] }])!;
  near(moved.origin, [70, 0, 0], "moved origin");
  assert.deepEqual(moved.base, B);
  assert.deepEqual(bareFrame(moved), { origin: moved.origin, xAxis: moved.xAxis, normal: moved.normal });
  assert.equal(movedFrame(null, [{ move: [20, 0, 0] }])!.base, undefined, "the world's frame has no base");
});

test("bodyMap by hand: a Scale by 2 about the origin takes the body's point (50, 15, 20) to (100, 30, 40)", () => {
  // From the world's (size 1) to a frame with the same origin and axes and size 2: F(q) = 2 q. `carried` sees no
  // motion (same frame), so the rigid carry SL #759 item 3 found left the point where it was.
  const scaled: BodyFrame = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1], size: 2 };
  near(bodyMap(undefined, scaled)([50, 15, 20]), [100, 30, 40], "scaled");
  // Back again: the click's way (face-pick.ts `clickedName`), halved.
  near(bodyMap(scaled, undefined)([100, 30, 40]), [50, 15, 20], "back");
  // A Scale by 2 about (20, 0, 0) after a shift: from origin (20, 0, 0) size 1 to (40, 0, 0) size 2 (the frame's origin
  // (20, 0, 0) scaled about (0, 0, 0) is (40, 0, 0)): q ↦ 2 (q − (20, 0, 0)) + (40, 0, 0) = 2 q, (50, 15, 20) to (100, 30, 40).
  near(bodyMap({ origin: [20, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] }, { origin: [40, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1], size: 2 })([50, 15, 20]), [100, 30, 40], "after a shift");
});

test("originFrameNow by hand (SL #759 item 3): Box 2's input frame on a merged top is scaled about the Scale's centre", () => {
  // Box 2 moved 20 along x: its frame's origin (20, 0, 0). Joined to Box 1 (the merged face's first input: the world's),
  // then the joined body scaled by 2 about the origin: the face's frame then the world's, now size 2. Box 2's origin, a
  // point of the body, goes to 2 (20, 0, 0) = (40, 0, 0), size 2. The rigid carry kept (20, 0, 0) with no size.
  const got = originFrameNow({ origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1], size: 2 }, undefined, { origin: [20, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] })!;
  near(got.origin, [40, 0, 0], "origin");
  assert.equal(got.size, 2);
  // No change of size and no motion: the origin itself, as before.
  const o = { origin: [20, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };
  assert.equal(originFrameNow(undefined, undefined, o), o);
});
