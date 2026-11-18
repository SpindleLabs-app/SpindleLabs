// The flat view's camera (view-box.ts): every expected number here is worked out by hand from the one drawing rule,
//   sx = W/2 + (x − cx)·scale,  sy = H/2 − (y − cy)·scale,
// never by running the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_GAP, FIT_MARGINS, fitView, KEEP_IN_SIGHT, keepInSight, marginsClearOf, marginsFor, marksBetween, markStep, MAX_SCALE, minScale, nameFits, panBy, toBed, toScreen, wheelZoom, zoomAt, type View } from "../src/view-box.ts";

const near = (got: number, want: number, what: string, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps, `${what}: got ${got}, want ${want}`);
const BED = { width: 400, height: 400 };
/** The app's view at 1280 × 800 with the properties column open: 980 × 756 px. */
const VIEW = { width: 980, height: 756 };

test("hand-worked: a bed point is drawn where the rule says, y up on the bed and down on the screen, and toBed undoes it", () => {
  const view: View = { cx: 200, cy: 200, scale: 2 };
  const size = { width: 1000, height: 800 };
  // The centre point lands mid-screen.
  assert.deepEqual(toScreen(view, size, 200, 200), { x: 500, y: 400 });
  // 50 mm right and 100 mm up of it: 100 px right, 200 px up the screen (a smaller y).
  assert.deepEqual(toScreen(view, size, 250, 300), { x: 600, y: 200 });
  assert.deepEqual(toBed(view, size, { x: 600, y: 200 }), { x: 250, y: 300 });
  // The bed's origin: 200 mm left and down of centre, so 400 px left and 400 px down the screen.
  assert.deepEqual(toScreen(view, size, 0, 0), { x: 100, y: 800 });
});

test("hand-worked: Fit fills the room inside the margins and centres the bed in it", () => {
  // 980 × 756 less the margins (left 48, right 20, top 36, bottom 84) leaves 912 × 636. A 400 × 400 bed is held by the
  // height: 636 / 400 = 1.59 px per mm (the width would allow 2.28). The bed is then 636 px square, centred in the room:
  // across, the room runs 48…960, so the bed runs 504 − 318 = 186 … 822; down, the room runs 36…672, which the bed fills.
  assert.deepEqual(FIT_MARGINS, { top: 36, right: 20, bottom: 84, left: 48 });
  const view = fitView(BED, VIEW);
  near(view.scale, 1.59, "scale");
  const lowerLeft = toScreen(view, VIEW, 0, 0);
  const upperRight = toScreen(view, VIEW, 400, 400);
  near(lowerLeft.x, 186, "left edge");
  near(lowerLeft.y, 672, "bottom edge");
  near(upperRight.x, 822, "right edge");
  near(upperRight.y, 36, "top edge");
});

test("hand-worked: a wide bed is held by the width and centred up and down", () => {
  // 1000 × 500 less the margins leaves 932 × 380. A 600 × 200 bed: 932 / 600 = 1.5533… (the height would allow 1.9).
  // It is 932 px wide (48…980) and 200 × 1.5533… = 310.67 px tall, centred on the room's middle 36 + 190 = 226:
  // 226 − 155.33 = 70.67 … 381.33.
  const size = { width: 1000, height: 500 };
  const bed = { width: 600, height: 200 };
  const view = fitView(bed, size);
  near(view.scale, 932 / 600, "scale");
  near(toScreen(view, size, 0, 0).x, 48, "left edge");
  near(toScreen(view, size, 600, 0).x, 980, "right edge");
  near(toScreen(view, size, 0, 200).y, 226 - 932 / 6, "top edge", 1e-9);
  near(toScreen(view, size, 0, 0).y, 226 + 932 / 6, "bottom edge", 1e-9);
});

test("Fit never divides by nothing: no size gives 1 px per mm about the bed's middle; a tiny view drops its margins; a tiny bed stops at the closest zoom", () => {
  assert.deepEqual(fitView(BED, { width: 0, height: 0 }), { cx: 200, cy: 200, scale: 1 });
  assert.deepEqual(fitView(BED, { width: 500, height: 0 }), { cx: 200, cy: 200, scale: 1 });
  // 100 × 100: under 80 px would be left inside the margins, so there are none: 100 / 400 = 0.25, centred.
  assert.deepEqual(fitView(BED, { width: 100, height: 100 }), { cx: 200, cy: 200, scale: 0.25 });
  // A 1 × 1 mm bed would fit at 636 px per mm; the closest zoom is 200.
  assert.equal(fitView({ width: 1, height: 1 }, VIEW).scale, MAX_SCALE);
});

test("hand-worked: zooming about a point keeps the bed point under it, and stops at the limits", () => {
  const view = fitView(BED, VIEW);
  // Twice as close about the bed's lower-left corner, drawn at (186, 672): it stays there, at 3.18 px per mm, so the
  // 100 mm mark moves from 186 + 159 = 345 to 186 + 318 = 504.
  const closer = zoomAt(view, BED, VIEW, { x: 186, y: 672 }, 2);
  near(closer.scale, 3.18, "scale");
  near(toScreen(closer, VIEW, 0, 0).x, 186, "corner x");
  near(toScreen(closer, VIEW, 0, 0).y, 672, "corner y");
  near(toScreen(closer, VIEW, 100, 0).x, 504, "the 100 mm mark");
  // The limits: never closer than 200 px per mm; never further than the bed's longer side at 48 px (48 / 400 = 0.12).
  assert.equal(zoomAt(view, BED, VIEW, { x: 500, y: 300 }, 1000).scale, 200);
  near(zoomAt(view, BED, VIEW, { x: 500, y: 300 }, 0.001).scale, 0.12, "furthest");
  near(minScale(BED, VIEW), 0.12, "minScale");
  // A bed whose fitted size is already under 48 px (a 3 m bed in a 30 px view) goes no further out than fitted.
  near(minScale({ width: 3000, height: 3000 }, { width: 30, height: 30 }), 0.01, "minScale of a fitted speck");
  // Just inside and just outside the closest limit: from 100 px per mm, ×1.9 is 190 (allowed), ×2.1 would be 210 (held at 200).
  const at100: View = { cx: 200, cy: 200, scale: 100 };
  near(zoomAt(at100, BED, VIEW, { x: 490, y: 378 }, 1.9).scale, 190, "inside the limit");
  assert.equal(zoomAt(at100, BED, VIEW, { x: 490, y: 378 }, 2.1).scale, 200);
  // A factor that is no factor changes nothing.
  for (const bad of [0, -2, NaN, Infinity]) assert.deepEqual(zoomAt(view, BED, VIEW, { x: 10, y: 10 }, bad), view, String(bad));
});

test("hand-worked: a drag slides the view by the drag over the scale, and what was under the pointer stays under it", () => {
  const size = { width: 1000, height: 800 };
  const view: View = { cx: 200, cy: 200, scale: 2 };
  // 30 px right and 20 px up the screen (dy = −20): the centre moves 15 mm left and 10 mm down on the bed.
  const slid = panBy(view, BED, size, 30, -20);
  assert.deepEqual(slid, { cx: 185, cy: 190, scale: 2 });
  // The bed point (250, 300), drawn at (600, 200) before, is now at (630, 180).
  assert.deepEqual(toScreen(slid, size, 250, 300), { x: 630, y: 180 });
});

test("the bed can't be slid out of sight: 40 px of it stay in view, tested just inside and just outside that reach", () => {
  const size = { width: 1000, height: 800 };
  assert.equal(KEEP_IN_SIGHT, 40);
  // At 1 px per mm the centre may go 500 − 40 = 460 mm left of the bed's left side (the bed's left edge is then drawn at
  // 500 + 460 = 960 = 1000 − 40) and 460 mm right of its right side, cx 860 (its right edge at 500 − 460 = 40).
  // Up and down: 400 − 40 = 360 mm, so cy from −360 to 760.
  const far = (cx: number, cy: number) => keepInSight({ cx, cy, scale: 1 }, BED, size);
  assert.deepEqual(far(-460 * 0.9, 200), { cx: -414, cy: 200, scale: 1 }); // inside the reach: left alone
  assert.deepEqual(far(-460 * 1.1, 200), { cx: -460, cy: 200, scale: 1 }); // outside: held at the reach
  assert.deepEqual(far(400 + 460 * 1.1, 200), { cx: 860, cy: 200, scale: 1 });
  assert.deepEqual(far(200, -360 * 0.9), { cx: 200, cy: -324, scale: 1 });
  assert.deepEqual(far(200, -360 * 1.1), { cx: 200, cy: -360, scale: 1 });
  assert.deepEqual(far(200, 400 + 360 * 1.1), { cx: 200, cy: 760, scale: 1 });
  assert.equal(toScreen(far(-9999, 200), size, 0, 0).x, 960);
  assert.equal(toScreen(far(9999, 200), size, 400, 0).x, 40);
  // A huge drag ends there too, and a view narrower than 80 px keeps the bed's edge at its middle.
  assert.deepEqual(panBy({ cx: 200, cy: 200, scale: 1 }, BED, size, 1e9, 0), { cx: -460, cy: 200, scale: 1 });
  assert.deepEqual(keepInSight({ cx: -50, cy: 200, scale: 1 }, BED, { width: 60, height: 800 }), { cx: 0, cy: 200, scale: 1 });
});

test("hand-worked: the ruler's step is the smallest of 1, 2, 5 × a power of ten that keeps the marks 56 px apart", () => {
  // The marks must be 56 / scale mm apart or more.
  assert.equal(markStep(2), 50); // 28 mm: 10 and 20 are too close, 50 is the next
  assert.equal(markStep(1.59), 50); // 35.2 mm
  assert.equal(markStep(0.7675), 100); // 72.96 mm (a phone)
  assert.equal(markStep(0.12), 500); // 466.7 mm
  assert.equal(markStep(200), 0.5); // 0.28 mm
  assert.equal(markStep(56), 1); // exactly 1 mm
  assert.equal(markStep(28), 2);
  assert.equal(markStep(11.2), 5);
  assert.equal(markStep(1120), 0.05); // 0.05 written as 0.05, not 0.05000000000000001
  // Just either side of a change: at 5.6 px per mm 10 mm marks are exactly 56 px apart. 10% further out (5.04) they
  // would be 50.4 px apart, too close, so the step is 20; 10% closer (6.16) they are 61.6 px apart, so 10 stays.
  assert.equal(markStep(5.6), 10);
  assert.equal(markStep(5.6 * 0.9), 20);
  assert.equal(markStep(5.6 * 1.1), 10);
  // The marks of a whole range of zooms are never closer than 56 px, nor more than 2.5 times that apart (the 2 → 5 jump).
  for (let s = 0.01; s <= 200; s *= 1.07) {
    const px = markStep(s) * s;
    assert.ok(px >= 56 - 1e-9 && px <= 140 + 1e-9, `scale ${s}: marks ${px} px apart`);
  }
});

test("hand-worked: the marks are every whole step along the bed's side, those in sight only", () => {
  assert.deepEqual(marksBetween(-50, 430, 400, 100), [0, 100, 200, 300, 400]); // the whole 400 mm side in sight
  assert.deepEqual(marksBetween(120, 260, 400, 50), [150, 200, 250]); // zoomed in: three marks in sight
  assert.deepEqual(marksBetween(0.1, 0.3, 400, 0.05), [0.1, 0.15, 0.2, 0.25, 0.3]); // small steps stay clean numbers
  assert.deepEqual(marksBetween(-50, 430, 360, 100), [0, 100, 200, 300]); // a 360 mm side has no 400 mark
  assert.deepEqual(marksBetween(500, 900, 400, 100), []); // the bed is out of sight this way
  assert.deepEqual(marksBetween(-900, -100, 400, 100), []);
  // A 3 m bed at the closest zoom still gets only the marks in sight: 980 px is 4.9 mm, marks every 0.5 mm.
  assert.equal(marksBetween(1000, 1004.9, 3000, 0.5).length, 10);
});

test("hand-worked: the wheel zooms at the 3D view's rate, away from you is closer, and one event is never more than ×4", () => {
  near(wheelZoom(-100, 0, false), Math.E ** 0.2, "one notch away"); // e^(0.002 × 100) = 1.2214
  near(wheelZoom(-100, 0, false), 1.2214027581601699, "one notch away, as a number");
  near(wheelZoom(100, 0, false), 1 / 1.2214027581601699, "one notch towards");
  near(wheelZoom(-3, 1, false), Math.E ** 0.096, "three lines are 48 px");
  near(wheelZoom(-10, 0, true), Math.E ** 0.1, "a pinch counts five times");
  assert.equal(wheelZoom(-1e6, 0, false), 4);
  assert.equal(wheelZoom(1e6, 0, false), 0.25);
  assert.equal(wheelZoom(NaN, 0, false), 1);
  assert.equal(wheelZoom(0, 0, false), 1);
});

test("a part's name is drawn only where it fits: tested just inside and just outside the width and the height it needs", () => {
  // "Sketch 1" is 8 characters: 8 × 6.2 = 49.6 px, plus 8 px of room, 57.6 px; and 16 px of height.
  assert.equal(nameFits("Sketch 1", 57.6 * 1.1, 40), true);
  assert.equal(nameFits("Sketch 1", 57.6 * 0.9, 40), false);
  assert.equal(nameFits("Sketch 1", 100, 16 * 1.1), true);
  assert.equal(nameFits("Sketch 1", 100, 16 * 0.9), false);
  // A 40 × 30 mm part: named at the desktop's fitted 1.59 px per mm (63.6 × 47.7 px), not at a phone's 0.7675 (30.7 px wide).
  assert.equal(nameFits("Sketch 1", 40 * 1.59, 30 * 1.59), true);
  assert.equal(nameFits("Sketch 1", 40 * 0.7675, 30 * 0.7675), false);
});

test("hand-worked: the fitted bed keeps clear of a card over the view, the way that leaves the bed largest", () => {
  assert.equal(CARD_GAP, 12);
  // The parts list at the view's top-left corner, (8, 8) to (248, 108). Starting the bed right of it: left margin
  // 248 + 12 = 260, room 980 − 260 − 20 = 700 wide by 636 tall: 1.59 px per mm. Starting it below: top margin 120, room
  // 912 by 756 − 120 − 84 = 552: 1.38. Right of it wins, and the bed is no smaller than with no card at all.
  const card = { left: 8, top: 8, right: 248, bottom: 108 };
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [card]), { top: 36, right: 20, bottom: 84, left: 260 });
  const view = fitView(BED, VIEW, marginsClearOf(BED, VIEW, FIT_MARGINS, [card]));
  near(view.scale, 1.59, "scale");
  // The bed (636 px) sits in the middle of the 700 px room, 260…960: 610 − 318 = 292, clear of the card's 248.
  near(toScreen(view, VIEW, 0, 0).x, 292, "left edge");
  // A tall list, (8, 8) to (248, 600): below it would leave 756 − 612 − 84 = 60 px (0.15); right of it still 1.59.
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 8, top: 8, right: 248, bottom: 600 }]).left, 260);
  // A card on the right, (700, 8) to (972, 300): left of it, right margin 980 − 700 + 12 = 292, room 640 by 636: 1.59;
  // below it, top 312, room 912 by 360: 0.9. Left of it wins.
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 700, top: 8, right: 972, bottom: 300 }]), { top: 36, right: 292, bottom: 84, left: 48 });
  // A wide, short bed with the same top-left card: below it (room 912 by 552: min(912/900, 552/100) = 1.0133) beats right of
  // it (700 by 636: 0.7778).
  assert.deepEqual(marginsClearOf({ width: 900, height: 100 }, VIEW, FIT_MARGINS, [card]), { top: 120, right: 20, bottom: 84, left: 48 });
});

test("cards that are not in the way are left out: outside the view, empty, or a sheet over most of it", () => {
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 990, top: 0, right: 1280, bottom: 756 }]), FIT_MARGINS); // the properties column beside the view
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 0, top: 0, right: 0, bottom: 0 }]), FIT_MARGINS); // a hidden panel
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 0, top: 300, right: 980, bottom: 756 }]), FIT_MARGINS); // a sheet over 60% of the view
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, []), FIT_MARGINS);
  // Just under and just over the 40% that makes a card a sheet: 980 × 756 × 0.4 = 296 352 px²; 980 wide, that is 302.4 px tall.
  assert.notDeepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 0, top: 0, right: 980, bottom: 302.4 * 0.9 }]), FIT_MARGINS);
  assert.deepEqual(marginsClearOf(BED, VIEW, FIT_MARGINS, [{ left: 0, top: 0, right: 980, bottom: 302.4 * 1.1 }]), FIT_MARGINS);
});

test("at phone width the bed's name sits below the app's Browser and Properties buttons", () => {
  assert.deepEqual(marginsFor({ width: 375, height: 756 }), { top: 92, right: 20, bottom: 84, left: 48 });
  assert.deepEqual(marginsFor({ width: 640, height: 756 }), { top: 92, right: 20, bottom: 84, left: 48 });
  assert.deepEqual(marginsFor({ width: 641, height: 756 }), FIT_MARGINS);
  // 375 × 756: room 307 × 580, so 307 / 400 = 0.7675 px per mm; the bed's top edge is at 92 + 290 − 153.5 = 228.5.
  const size = { width: 375, height: 756 };
  const view = fitView(BED, size, marginsFor(size));
  near(view.scale, 0.7675, "scale");
  near(toScreen(view, size, 0, 400).y, 228.5, "top edge");
});
