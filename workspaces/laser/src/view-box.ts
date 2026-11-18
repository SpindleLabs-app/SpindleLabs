// The flat view's camera (Laser's 2D sheet view, flat-view.ts). Pure: no DOM.
//
// Laser cutting is flat, so the view is too: the bed seen straight from
// above, never turned. A view is then only three numbers: the bed point at
// the middle of the screen (`cx`, `cy`, in mm, the bed's own coordinates:
// origin at its lower-left corner, y up) and how many screen pixels one mm
// takes (`scale`). A bed point (x, y) is drawn at
//
//   sx = W/2 + (x − cx)·scale        sy = H/2 − (y − cy)·scale
//
// (W × H the view's size in px; the minus because the screen's y points
// down). Everything here is that one rule and its inverse:
// - fit: the scale at which the bed just fills the room left inside the
//   margins, and the centre that puts it in the middle of that room;
// - zoom about a point: the bed point under the pointer stays under it;
// - pan: the centre moves by the drag, divided by the scale;
// - the rulers: marks every 1, 2 or 5 × a power of ten mm, the smallest
//   such step that keeps the marks a readable distance apart on screen.
//
// Only straight lines and whole numbers of mm are worked out here: no arcs,
// no curve maths (that lives in the kernel; packages/CLAUDE.md).

import type { Bed } from "./sheet.ts";

/** A size or a point on screen, px. */
export interface Size {
  width: number;
  height: number;
}
export interface ScreenPoint {
  x: number;
  y: number;
}

/** The flat view: the bed point (mm, y up) at the middle of the screen, and px per mm. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
}

/** Room kept clear round the bed when it is fitted, px: its name above, the ruler's numbers left and below, the buttons below. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The margins the page uses: the bed's name (top), the ruler's numbers (left, bottom) and the row of buttons (bottom). */
export const FIT_MARGINS: Margins = { top: 36, right: 20, bottom: 84, left: 48 };
/** At phone width (640 px or less, the app's own break) the app's Browser and Properties buttons lie over the view's top 56 px: the bed's name goes under them. */
export const PHONE_WIDTH = 640;
export const PHONE_TOP = 92;

/** The margins for a view this size: `FIT_MARGINS`, with the phone's deeper top at phone width. */
export const marginsFor = (size: Size): Margins => (size.width <= PHONE_WIDTH ? { ...FIT_MARGINS, top: PHONE_TOP } : FIT_MARGINS);

/** A card lying over the view (the parts list): its box in the view's px, from the view's top-left corner. */
export interface Card {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** The clear strip kept between a card and the bed's margin, px. */
export const CARD_GAP = 12;
/** A card over more than this share of the view is a sheet drawn over it for a moment, not something to fit around. */
export const CARD_MOST = 0.4;

/**
 * The margins widened so the fitted bed is clear of each card lying over
 * the view. A card can be cleared four ways: by starting the bed right of
 * it, below it, left of it or above it; the way that leaves the bed
 * largest is taken (the first of those on a tie), card after card. A card
 * that can't be cleared with any room left for the bed, one outside the
 * view, and one over most of the view are left out.
 */
export function marginsClearOf(bed: Bed, size: Size, base: Margins, cards: readonly Card[]): Margins {
  const scaleOf = (m: Margins) => Math.min((size.width - m.left - m.right) / bed.width, (size.height - m.top - m.bottom) / bed.height);
  let margins = base;
  for (const c of cards) {
    const card = { left: Math.max(0, c.left), top: Math.max(0, c.top), right: Math.min(size.width, c.right), bottom: Math.min(size.height, c.bottom) };
    if (!(card.right > card.left) || !(card.bottom > card.top)) continue;
    if ((card.right - card.left) * (card.bottom - card.top) > CARD_MOST * size.width * size.height) continue;
    const ways: Margins[] = [
      { ...margins, left: Math.max(margins.left, card.right + CARD_GAP) },
      { ...margins, top: Math.max(margins.top, card.bottom + CARD_GAP) },
      { ...margins, right: Math.max(margins.right, size.width - card.left + CARD_GAP) },
      { ...margins, bottom: Math.max(margins.bottom, size.height - card.top + CARD_GAP) },
    ];
    let best: Margins | null = null;
    for (const w of ways) if (scaleOf(w) > 0 && (best === null || scaleOf(w) > scaleOf(best))) best = w;
    if (best) margins = best;
  }
  return margins;
}

/**
 * The closest the view goes: 200 px per mm, a pixel being 5 µm. Closer, a
 * 3 m bed's far corner would sit 600 000 px from the origin, where a
 * browser's single-precision drawing starts to wobble by a tenth of a pixel.
 */
export const MAX_SCALE = 200;
/** Zoomed all the way out, the bed's longer side still takes this many px (or its fitted size, when that is smaller). */
export const MIN_BED_PX = 48;
/** However the view is slid, this many px of the bed stay in sight on each axis, so the bed can't be lost. */
export const KEEP_IN_SIGHT = 40;
/** The least distance between two ruler marks, px. */
export const MARK_GAP = 56;
/** One press of Zoom in or Zoom out, and one notch of a mouse wheel. */
export const ZOOM_STEP = 1.25;

/** Where the bed point (x, y) is drawn. */
export function toScreen(view: View, size: Size, x: number, y: number): ScreenPoint {
  return { x: size.width / 2 + (x - view.cx) * view.scale, y: size.height / 2 - (y - view.cy) * view.scale };
}

/** The bed point drawn at the screen point `at`: `toScreen`'s inverse. */
export function toBed(view: View, size: Size, at: ScreenPoint): { x: number; y: number } {
  return { x: view.cx + (at.x - size.width / 2) / view.scale, y: view.cy - (at.y - size.height / 2) / view.scale };
}

/**
 * The view that shows the whole bed as large as the room inside `margins`
 * allows, in the middle of that room. A view too small for its margins
 * (under 80 px left either way) is fitted without them; a view with no size
 * yet (not laid out) gets 1 px per mm about the bed's middle, never a
 * division by zero.
 */
export function fitView(bed: Bed, size: Size, margins: Margins = FIT_MARGINS): View {
  let m = margins;
  if (size.width - m.left - m.right < 80 || size.height - m.top - m.bottom < 80) m = { top: 0, right: 0, bottom: 0, left: 0 };
  const roomW = size.width - m.left - m.right;
  const roomH = size.height - m.top - m.bottom;
  if (!(roomW > 0) || !(roomH > 0)) return { cx: bed.width / 2, cy: bed.height / 2, scale: 1 };
  const scale = Math.min(roomW / bed.width, roomH / bed.height, MAX_SCALE);
  // The room's middle on screen, and the centre that draws the bed's middle there (toScreen solved for cx, cy).
  const mid = { x: m.left + roomW / 2, y: m.top + roomH / 2 };
  return { cx: bed.width / 2 - (mid.x - size.width / 2) / scale, cy: bed.height / 2 + (mid.y - size.height / 2) / scale, scale };
}

/** The furthest out the view goes: the bed's longer side `MIN_BED_PX` wide, or its fitted scale when that is smaller still. */
export function minScale(bed: Bed, size: Size): number {
  return Math.min(MIN_BED_PX / Math.max(bed.width, bed.height), fitView(bed, size).scale);
}

/** The view slid no further than leaves `KEEP_IN_SIGHT` px of the bed in sight on each axis (less in a view too small for that). */
export function keepInSight(view: View, bed: Bed, size: Size): View {
  const reachX = Math.max(0, size.width / 2 - KEEP_IN_SIGHT) / view.scale;
  const reachY = Math.max(0, size.height / 2 - KEEP_IN_SIGHT) / view.scale;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // The bed's right edge is drawn at W/2 + (width − cx)·scale; it must stay right of KEEP_IN_SIGHT, so cx ≤ width + reach.
  // Its left edge, at W/2 − cx·scale, must stay left of W − KEEP_IN_SIGHT, so cx ≥ −reach. The same up and down.
  return { cx: clamp(view.cx, 0 - reachX, bed.width + reachX), cy: clamp(view.cy, 0 - reachY, bed.height + reachY), scale: view.scale }; // 0 − reach, so a reach of 0 gives 0, never −0
}

/** The view zoomed by `factor` (above 1: closer) with the bed point under the screen point `at` staying under it, within the zoom's limits. */
export function zoomAt(view: View, bed: Bed, size: Size, at: ScreenPoint, factor: number): View {
  if (!Number.isFinite(factor) || factor <= 0) return view;
  const scale = Math.min(MAX_SCALE, Math.max(minScale(bed, size), view.scale * factor));
  const p = toBed(view, size, at);
  return keepInSight({ cx: p.x - (at.x - size.width / 2) / scale, cy: p.y + (at.y - size.height / 2) / scale, scale }, bed, size);
}

/** The view slid by a drag of (dx, dy) px: what was under the pointer stays under it. */
export function panBy(view: View, bed: Bed, size: Size, dx: number, dy: number): View {
  return keepInSight({ cx: view.cx - dx / view.scale, cy: view.cy + dy / view.scale, scale: view.scale }, bed, size);
}

/**
 * The ruler's step, mm: the smallest of 1, 2 or 5 × a power of ten whose
 * marks are at least `gap` px apart at this scale. At 2 px per mm and 56 px
 * the marks must be 28 mm apart or more, so the step is 50.
 */
export function markStep(scale: number, gap = MARK_GAP): number {
  const least = gap / scale;
  const power = 10 ** Math.floor(Math.log10(least));
  for (const m of [1, 2, 5]) {
    const step = Number((m * power).toPrecision(12)); // 5 × 0.01 is 0.05, not 0.05000000000000001
    if (step >= least) return step;
  }
  return Number((10 * power).toPrecision(12));
}

/** The ruler's marks between `from` and `to` along a bed side `length` long: every whole `step` from 0, those in sight only. */
export function marksBetween(from: number, to: number, length: number, step: number): number[] {
  const lo = Math.max(0, Math.ceil(Math.max(0, from) / step - 1e-9));
  const hi = Math.floor(Math.min(length, to) / step + 1e-9);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(Number((i * step).toPrecision(12)));
  return out;
}

/**
 * The zoom for one wheel event, at the 3D view's own rate (its
 * navigation.ts: the scale changes by e^(0.002 · pixels scrolled), a 100 px
 * notch being ×1.22; a trackpad pinch, which arrives as a wheel event with
 * Ctrl held, counts five times; lines are 16 px and pages 800 px; one event
 * never zooms more than ×4 either way). Scrolling away (deltaY below 0)
 * zooms in. A delta that is not a finite number zooms nothing.
 */
export function wheelZoom(deltaY: number, deltaMode: number, pinch: boolean): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  return Math.min(4, Math.max(1 / 4, Math.exp(-px * 0.002 * (pinch ? 5 : 1))));
}

/** About how wide `text` is drawn at 11 px, px: 6.2 px a character (the app's font; a little wide, so a name is hidden sooner rather than cut). */
export const wordsWidth = (text: string) => text.length * 6.2;

/** Whether a part's name fits on the part: its drawn box is as wide as the name plus 8 px, and 16 px tall or more. */
export function nameFits(text: string, widthPx: number, heightPx: number): boolean {
  return wordsWidth(text) + 8 <= widthPx && heightPx >= 16;
}
