// Whether two parts on the bed overlap, touch or lie apart (overlap.ts), on the real kernel.
// Squares are 10 × 10 mm with the lower-left corner at the origin unless said; every expected word is worked out
// in the comment beside it from the shapes' numbers, never from the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls, Loop, Outline } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { BOX_MARGIN, CLEARANCE, NUDGE, outlineCurves, partsRelation, type PartsRelation } from "../src/overlap.ts";
import { moveOutline } from "../src/sheet.ts";

const kernel = nodeKernel();

const path = (corners: number[], bulges: number[] = []): Loop => ({ path: { corners, bulges } });
const box = (x: number, y: number, w: number, h: number): Loop => path([x, y, x + w, y, x + w, y + h, x, y + h]);
const disc = (x: number, y: number, r: number): Loop => ({ circle: { center: [x, y], radius: r } });
const part = (outer: Loop, ...holes: Loop[]): Outline => ({ outer, holes });
const SQUARE = part(box(0, 0, 10, 10));
/** A slot: two straight sides `len` long and a half circle of radius r at each end (bulge 1), its axis from (x, y) to (x + len, y). */
const slot = (x: number, y: number, len: number, r: number): Loop => path([x, y - r, x + len, y - r, x + len, y + r, x, y + r], [0, 1, 0, 1]);
/** A rectangle with every corner rounded to radius r: quarter turns, bulge tan(π/8). */
const QUARTER = Math.tan(Math.PI / 8);
const rounded = (x: number, y: number, w: number, h: number, r: number): Loop =>
  path([x + r, y, x + w - r, y, x + w, y + r, x + w, y + h - r, x + w - r, y + h, x + r, y + h, x, y + h - r, x, y + r], [0, QUARTER, 0, QUARTER, 0, QUARTER, 0, QUARTER]);
/** A star of n corners in turn on circles r1 and r2 round (cx, cy). */
const star = (cx: number, cy: number, n: number, r1: number, r2: number): Loop =>
  path(
    Array.from({ length: n }, (_, i) => {
      const a = 0.01 + (2 * Math.PI * i) / n;
      const r = i % 2 ? r1 : r2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }).flat(),
  );

const relation = async (a: Outline, b: Outline, k: KernelCalls = kernel) => (await partsRelation(k, a, b)).relation;
/** The word both ways round: which part is named first must not matter. */
async function both(a: Outline, b: Outline): Promise<PartsRelation["relation"]> {
  const [ab, ba] = [await relation(a, b), await relation(b, a)];
  assert.equal(ba, ab, "the answer changed when the parts swapped places");
  return ab;
}

/** A kernel that answers nothing: every call fails. `calls` counts them. */
function deadKernel(): KernelCalls & { calls: number } {
  const k = {
    calls: 0,
    call: ((..._args: unknown[]) => {
      k.calls++;
      return Promise.reject(new Error("no kernel in this test"));
    }) as KernelCalls["call"],
  };
  return k;
}

/** The real kernel with one operation's answer replaced (`change` gets the real call to make, and its arguments). */
function lyingKernel(op: string, change: (real: () => Promise<unknown>, args: unknown[]) => Promise<unknown>): KernelCalls {
  const real = kernel.call as (op: string, ...args: unknown[]) => Promise<unknown>;
  return { call: ((o: string, ...args: unknown[]) => (o === op ? change(() => real(o, ...args), args) : real(o, ...args))) as KernelCalls["call"] };
}

// ── The conversion to sketch curves ─────────────────────────────────────────

test("hand-worked: a square is four lines corner to corner; holes are numbered from 1; a circle loop is a sketch circle", () => {
  const c = outlineCurves(part(box(0, 0, 10, 10), disc(5, 5, 2), box(1, 1, 2, 2)));
  assert.deepEqual(c.lines.slice(0, 4), [
    { a: [0, 0], b: [10, 0] },
    { a: [10, 0], b: [10, 10] },
    { a: [10, 10], b: [0, 10] },
    { a: [0, 10], b: [0, 0] },
  ]);
  assert.deepEqual(c.circles, [{ centre: [5, 5], radius: 2 }]);
  // Four lines of the outer loop (0), then four of the second hole (2); the circle is the first hole (1).
  assert.deepEqual(c.loops, { line: [0, 0, 0, 0, 2, 2, 2, 2], circle: [1], arc: [] });
});

test("hand-worked: a bulge's arc has the centre the kernel's bulge rule gives, and a clockwise one swaps its ends", () => {
  // Half turn, bulge 1, chord (0,0) → (10,0): k = (1 − 1)/4 = 0, so the centre is the chord's midpoint (5, 0).
  // The other piece, (10,0) → (0,0) straight, closes it.
  const half = outlineCurves(part(path([0, 0, 10, 0], [1, 0])));
  assert.deepEqual(half.arcs, [{ start: [0, 0], end: [10, 0], centre: [5, 0] }]);
  assert.deepEqual(half.lines, [{ a: [10, 0], b: [0, 0] }]);
  // Quarter turn of radius 10 round the origin, (10,0) → (0,10), bulge b = tan(π/8) = √2 − 1:
  // b² = 3 − 2√2, so k = (1 − b²)/(4b) = (2√2 − 2)/(4√2 − 4) = 1/2. Midpoint (5,5), chord (−10, 10):
  // centre = (5 − 10·½, 5 + (−10)·½) = (0, 0).
  const quarter = outlineCurves(part(path([10, 0, 0, 10, 0, 0], [QUARTER, 0, 0])));
  assert.deepEqual(quarter.arcs[0].start, [10, 0]);
  assert.deepEqual(quarter.arcs[0].end, [0, 10]);
  assert.ok(Math.hypot(...quarter.arcs[0].centre) < 1e-12, `centre ${quarter.arcs[0].centre}`);
  // The same arc drawn the other way, (0,10) → (10,0) with bulge −(√2 − 1): k = −½, midpoint (5,5), chord (10, −10):
  // centre = (5 − (−10)(−½), 5 + 10(−½)) = (0, 0); a sketch arc runs counter-clockwise, so it starts at (10,0).
  const back = outlineCurves(part(path([0, 10, 10, 0, 0, 0], [-QUARTER, 0, 0])));
  assert.deepEqual(back.arcs[0].start, [10, 0]);
  assert.deepEqual(back.arcs[0].end, [0, 10]);
  assert.ok(Math.hypot(...back.arcs[0].centre) < 1e-12, `centre ${back.arcs[0].centre}`);
  assert.deepEqual(back.loops, { line: [0, 0], circle: [], arc: [0] });
});

test("the kernel reads the converted arcs as the shapes they are: areas worked by hand", async () => {
  const area = async (o: Outline) => {
    const c = outlineCurves(o);
    const found = await kernel.call("sketch_regions", c.lines, c.circles, c.arcs);
    assert.equal(found.regions.length, 1, found.why ?? "the kernel found other regions");
    return found.regions[0].area;
  };
  // Half disc of radius 5 (bulge 1 on a 10 mm chord): π·5²/2 = 39.2699…
  assert.ok(Math.abs((await area(part(path([0, 0, 10, 0], [1, 0])))) - (Math.PI * 25) / 2) < 1e-9);
  // The square with its bottom side bulged −1: clockwise from (0,0) to (10,0) is the half circle through (5,5),
  // inside the square, so it bites a half disc out: 100 − π·5²/2 = 60.7300…
  assert.ok(Math.abs((await area(part(path([0, 0, 10, 0, 10, 10, 0, 10], [-1, 0, 0, 0])))) - (100 - (Math.PI * 25) / 2)) < 1e-9);
  // With bulge +1 the half disc hangs below the square instead: 100 + 39.2699…
  assert.ok(Math.abs((await area(part(path([0, 0, 10, 0, 10, 10, 0, 10], [1, 0, 0, 0])))) - (100 + (Math.PI * 25) / 2)) < 1e-9);
  // A three-quarter turn (3π/2, so bulge tan(3π/8) = 2.414…) is taken whole, not split: the disc of radius 5 round
  // the origin less the quarter between (0,−5) and (5,0), which two radii close: ¾·π·25 = 58.9048…
  assert.ok(Math.abs((await area(part(path([5, 0, 0, -5, 0, 0], [Math.tan((3 * Math.PI) / 8), 0, 0])))) - 0.75 * Math.PI * 25) < 1e-9);
});

// ── The four words, by hand ─────────────────────────────────────────────────

test("hand-worked: a square moved 5 right crosses (50 mm² in both), moved 10 shares an edge, moved 10.5 is apart", async () => {
  // Second square x from 5 to 15: both cover x 5..10, y 0..10, an area of 5 × 10 = 50: overlap.
  // Their bottom and top sides lie on the same lines (y = 0 and y = 10), which is the case the kernel can't split.
  assert.equal(await both(SQUARE, part(box(5, 0, 10, 10))), "overlap");
  // x from 10 to 20: the first's right side and the second's left are both x = 10, y 0..10; no area in both: touch.
  assert.equal(await both(SQUARE, part(box(10, 0, 10, 10))), "touch");
  // x from 10.5: a clear 0.5 mm strip between them: apart.
  assert.equal(await both(SQUARE, part(box(10.5, 0, 10, 10))), "apart");
  // Moved 5 right and 5 up: both cover x 5..10, y 5..10, 25 mm², and no side lies along another: overlap.
  assert.equal(await both(SQUARE, part(box(5, 5, 10, 10))), "overlap");
  // Stacked exactly: all 100 mm² in both.
  assert.equal(await both(SQUARE, part(box(0, 0, 10, 10))), "overlap");
  // Sharing half an edge (moved 10 right, 5 up: x = 10 for y 5..10 in both sides).
  assert.equal(await both(SQUARE, part(box(10, 5, 10, 10))), "touch");
});

test("hand-worked: touching at one point is a touch, not apart", async () => {
  // Corner (10,10) of the first is corner (10,10) of the second; elsewhere the second is right of x = 10 or above y = 10.
  assert.equal(await both(SQUARE, part(box(10, 10, 10, 10))), "touch");
  // A triangle with its corner (10,5) on the square's right side x = 10, the rest of it right of that line.
  assert.equal(await both(SQUARE, part(path([10, 5, 15, 0, 15, 10]))), "touch");
  // Two corners of the second, (0,10) and (10,10), on the square's top corners, a triangle of bed between them
  // (under (5,15)) that is in neither part: bounded by both, yet no overlap.
  assert.equal(await both(SQUARE, part(path([0, 10, 5, 15, 10, 10, 10, 20, 0, 20]))), "touch");
  // The same triangle pushed 1 mm into the square: its tip (9,5) is inside (0 < 9 < 10): overlap.
  assert.equal(await both(SQUARE, part(path([9, 5, 15, 0, 15, 10]))), "overlap");
});

test("hand-worked: inside the other's material is an overlap; inside its hole is apart; on the hole's edge a touch", async () => {
  const frame = part(box(0, 0, 30, 30), box(5, 5, 20, 20)); // a 5 mm wide frame: hole x and y from 5 to 25
  // A 3 mm square at (1,1)..(4,4): wholly in the frame's lower-left corner material (x < 5, y < 5).
  assert.equal(await both(frame, part(box(1, 1, 3, 3))), "overlap");
  // A 3 mm square inside the plain square, away from its sides: 9 mm² in both.
  assert.equal(await both(SQUARE, part(box(2, 2, 3, 3))), "overlap");
  // The same against the square's left side from inside (x from 0): still inside.
  assert.equal(await both(SQUARE, part(box(0, 2, 3, 3))), "overlap");
  // A 10 mm square at (10,10)..(20,20): inside the hole, 5 mm from each of its sides: apart (a part nested in a hole).
  assert.equal(await both(frame, part(box(10, 10, 10, 10))), "apart");
  // Moved to x from 5: its left side is on the hole's left side, x = 5: touch.
  assert.equal(await both(frame, part(box(5, 10, 10, 10))), "touch");
  // x from 20 to 28: it crosses the hole's right side (x = 25) into the frame's material (25..28 of 25..30): overlap.
  assert.equal(await both(frame, part(box(20, 10, 8, 10))), "overlap");
  // The same starting on the hole's bottom line (y from 5): crossing with sides along each other.
  assert.equal(await both(frame, part(box(20, 5, 8, 10))), "overlap");
  // A 26 mm square at (2,2)..(28,28): it covers the hole and 3 mm of frame all round it: overlap.
  assert.equal(await both(frame, part(box(2, 2, 26, 26))), "overlap");
  // A ring (radii 5 and 10) inside the hole (radius 20) of a ring (outer 30), same centre: 10 mm of air between: apart.
  assert.equal(await both(part(disc(0, 0, 30), disc(0, 0, 20)), part(disc(0, 0, 10), disc(0, 0, 5))), "apart");
});

test("hand-worked: a plate with nine round holes, and a disc in a hole, over one, on its edge, and between four", async () => {
  // A 30 mm plate with holes of radius 3 at (5, 15 or 25; 5, 15 or 25).
  const plate = part(box(0, 0, 30, 30), ...[5, 15, 25].flatMap((x) => [5, 15, 25].map((y) => disc(x, y, 3))));
  // Radius 2 at the middle hole's centre: 1 mm of air all round: apart.
  assert.equal(await both(plate, part(disc(15, 15, 2))), "apart");
  // Radius 3.5 there: a ring 0.5 wide of it lies on the plate round the hole: overlap.
  assert.equal(await both(plate, part(disc(15, 15, 3.5))), "overlap");
  // Radius 2 at (16, 15): its east point (18, 15) is the hole's (15 + 3): touch, from inside the hole.
  assert.equal(await both(plate, part(disc(16, 15, 2))), "touch");
  // Radius 2 at (10, 10): the four holes round it are √50 = 7.07 away, more than 3 + 2: wholly on the plate: overlap.
  assert.equal(await both(plate, part(disc(10, 10, 2))), "overlap");
  // The same plate beside it, 1 mm away, is apart; sharing the side x = 30 is a touch; stacked on it is an overlap.
  assert.equal(await both(plate, moveOutline(plate, 31, 0)), "apart");
  assert.equal(await both(plate, moveOutline(plate, 30, 0)), "touch");
  assert.equal(await both(plate, moveOutline(plate, 0, 0)), "overlap");
});

test("hand-worked: circles by their centres' distance d and radii", async () => {
  const five = part(disc(0, 0, 5));
  // d = 10.5 > 5 + 5: apart by 0.5.
  assert.equal(await both(five, part(disc(10.5, 0, 5))), "apart");
  // d = 10 = 5 + 5: they meet at (5, 0) only: touch.
  assert.equal(await both(five, part(disc(10, 0, 5))), "touch");
  // d = 8 < 10: a lens in both: overlap.
  assert.equal(await both(five, part(disc(8, 0, 5))), "overlap");
  // Radius 3 at d = 2 = 5 − 3: inside, touching from within at (5, 0): all of it in both.
  assert.equal(await both(five, part(disc(2, 0, 3))), "overlap");
  // Same centre, radius 3: inside.
  assert.equal(await both(five, part(disc(0, 0, 3))), "overlap");
  // The very same circle twice.
  assert.equal(await both(five, part(disc(0, 0, 5))), "overlap");
  // A disc of radius 3 in a ring's hole of radius 4, same centre: 1 mm of air all round: apart.
  assert.equal(await both(part(disc(0, 0, 5), disc(0, 0, 4)), part(disc(0, 0, 3))), "apart");
  // The circle's east point (5, 0) on a rectangle's left side x = 5: touch. With the side at x = 4 the circle crosses it.
  assert.equal(await both(five, part(box(5, -10, 10, 20))), "touch");
  assert.equal(await both(five, part(box(4, -10, 10, 20))), "overlap");
  // Pythagoras: centres (0,0) and (3,4) are 5 apart; radii 2 and 3 sum to 5: touch. Radii 2 and 2.5: 0.5 of air.
  assert.equal(await both(part(disc(0, 0, 2)), part(disc(3, 4, 3))), "touch");
  assert.equal(await both(part(disc(0, 0, 2)), part(disc(3, 4, 2.5))), "apart");
});

test("hand-worked: arcs against straight sides (a slot, rounded rectangles, half discs)", async () => {
  // A slot of radius 2 along y = 5 from x = 8: its left end reaches x = 6, inside the square (x up to 10): overlap.
  assert.equal(await both(SQUARE, part(slot(8, 5, 10, 2))), "overlap");
  // From x = 12 its left half circle (centre (12,5), radius 2) reaches x = 10 at (10,5) only: touch.
  assert.equal(await both(SQUARE, part(slot(12, 5, 10, 2))), "touch");
  // From x = 11.99 it pokes 0.01 mm through the side: overlap. From 12.5 it is 0.5 mm clear: apart.
  assert.equal(await both(SQUARE, part(slot(11.99, 5, 10, 2))), "overlap");
  assert.equal(await both(SQUARE, part(slot(12.5, 5, 10, 2))), "apart");
  // Two 20 × 10 rectangles with 2 mm rounded corners on one baseline. The second from x = 15: both cover x 15..20
  // between y = 2 and 8 at least (30 mm²): overlap, with their bottom sides on one line.
  const first = part(rounded(0, 0, 20, 10, 2));
  assert.equal(await both(first, part(rounded(15, 0, 20, 10, 2))), "overlap");
  // From x = 20: the sides x = 20 lie along each other for y 2..8: touch. From x = 21: 1 mm apart.
  assert.equal(await both(first, part(rounded(20, 0, 20, 10, 2))), "touch");
  assert.equal(await both(first, part(rounded(21, 0, 20, 10, 2))), "apart");
  // Corner to corner. The first's top-right corner is an arc round (18,8), the second's bottom-left one round
  // (x + 2, y + 2), both of radius 2: they cross when the centres are closer than 4.
  // Second at (19,9): centres (18,8) and (21,11), √18 = 4.243 > 4, and the boxes overlap (19 < 20, 9 < 10): apart,
  // though with square corners they would cross.
  assert.equal(await both(first, part(rounded(19, 9, 20, 10, 2))), "apart");
  // Second at (18.5,8.5): centres (18,8) and (20.5,10.5), √12.5 = 3.536 < 4: the corner arcs cross: overlap.
  assert.equal(await both(first, part(rounded(18.5, 8.5, 20, 10, 2))), "overlap");
  // Two half discs of one circle (radius 5 round the origin), the upper and the lower, back to back on the diameter: touch.
  assert.equal(await both(part(path([-5, 0, 5, 0], [0, 1])), part(path([5, 0, -5, 0], [0, 1]))), "touch");
  // The upper half and the right half (arc from (0,−5) to (0,5), closed by the line x = 0): the quarter x > 0, y > 0
  // is in both, and their arcs lie along each other on it.
  assert.equal(await both(part(path([-5, 0, 5, 0], [0, 1])), part(path([0, 5, 0, -5], [0, 1]))), "overlap");
});

test("loops drawn clockwise answer the same", async () => {
  const clockwise = (x: number, y: number) => part(path([x, y, x, y + 10, x + 10, y + 10, x + 10, y]));
  assert.equal(await both(clockwise(0, 0), clockwise(5, 5)), "overlap");
  assert.equal(await both(clockwise(0, 0), clockwise(10, 5)), "touch");
  assert.equal(await both(clockwise(0, 0), part(box(10.5, 5, 10, 10))), "apart");
  // A clockwise hole (corners in the order up, right, down) holds a part as a counter-clockwise one does.
  const frame = part(box(0, 0, 30, 30), path([5, 5, 5, 25, 25, 25, 25, 5]));
  assert.equal(await both(frame, clockwise(10, 10)), "apart");
  assert.equal(await both(frame, clockwise(1, 10)), "overlap"); // x 1..11 crosses the hole's side x = 5
});

// ── Tolerances ──────────────────────────────────────────────────────────────

test(`touch or apart: the kernel's smallest feature (${CLEARANCE} mm), at 0.9× a touch and at 1.1× apart, near and 2900 mm from the origin`, async () => {
  for (const at of [0, 2900]) {
    const first = part(box(at, at, 10, 10));
    // Side by side with a gap g between x = at + 10 and the second's left side.
    assert.equal(await both(first, part(box(at + 10 + 0.9 * CLEARANCE, at, 10, 10))), "touch", `gap 0.9× at ${at}`);
    assert.equal(await both(first, part(box(at + 10 + 1.1 * CLEARANCE, at, 10, 10))), "apart", `gap 1.1× at ${at}`);
    // Corner to corner on the diagonal: moved g/√2 each way, the corners are g apart.
    const d = (g: number) => at + 10 + g / Math.SQRT2;
    assert.equal(await both(first, part(box(d(0.9 * CLEARANCE), d(0.9 * CLEARANCE), 10, 10))), "touch", `corner gap 0.9× at ${at}`);
    assert.equal(await both(first, part(box(d(1.1 * CLEARANCE), d(1.1 * CLEARANCE), 10, 10))), "apart", `corner gap 1.1× at ${at}`);
    // Two circles of radius 5, centres 10 + g apart.
    assert.equal(await both(part(disc(at, at, 5)), part(disc(at + 10 + 0.9 * CLEARANCE, at, 5))), "touch", `circles 0.9× at ${at}`);
    assert.equal(await both(part(disc(at, at, 5)), part(disc(at + 10 + 1.1 * CLEARANCE, at, 5))), "apart", `circles 1.1× at ${at}`);
  }
  // Inside a hole (x from 5), g from its left side.
  const frame = part(box(0, 0, 30, 30), box(5, 5, 20, 20));
  assert.equal(await both(frame, part(box(5 + 0.9 * CLEARANCE, 10, 10, 10))), "touch");
  assert.equal(await both(frame, part(box(5 + 1.1 * CLEARANCE, 10, 10, 10))), "apart");
});

test("overlap or touch: the kernel's 10 nm, a side 1.1× inside is an overlap and 0.9× a touch, near and 2900 mm from the origin", async () => {
  const LINEAR = 1e-5; // the kernel's length tolerance, mm
  for (const at of [0, 2900]) {
    const first = part(box(at, at, 10, 10));
    // The second square 3 mm up (no sides on one line), its left side w inside the first's right side: a strip w × 7 in both.
    assert.equal(await both(first, part(box(at + 10 - 1.1 * LINEAR, at + 3, 10, 10))), "overlap", `1.1× at ${at}`);
    assert.equal(await both(first, part(box(at + 10 - 0.9 * LINEAR, at + 3, 10, 10))), "touch", `0.9× at ${at}`);
    // 0.001 mm inside (a 0.007 mm² strip): overlap.
    assert.equal(await both(first, part(box(at + 10 - 0.001, at + 3, 10, 10))), "overlap", `0.001 at ${at}`);
  }
  // A triangle's tip 0.001 mm and 0.00002 mm through the square's right side: overlap both (2× the 10 nm).
  assert.equal(await both(SQUARE, part(path([10 - 0.001, 5, 15, 0, 15, 10]))), "overlap");
  assert.equal(await both(SQUARE, part(path([10 - 0.00002, 5, 15, 0, 15, 10]))), "overlap");
});

test("hand-worked: on one baseline the kernel can't split the edges, so a thin overlap is unknown-but-meeting until it is past what a nudge could make", async () => {
  // Two squares on y = 0 overlapping by w: w × 10 mm² in both, but their bottom sides lie along each other and the
  // kernel gives no regions. The second is asked about again moved by NUDGE (0.0001 mm) × (±0.96, ±0.26) and so on.
  // A move can add at most NUDGE × the square's 40 mm of edge = 0.004 mm², and twice that, 0.008 mm², is asked for.
  // w = 0.002: moved at most 0.000096 sideways the strip is at least 0.0019 × 10 = 0.019 mm² > 0.008: overlap.
  assert.deepEqual(await partsRelation(kernel, SQUARE, part(box(10 - 0.002, 0, 10, 10))), { relation: "overlap" });
  // w = 0.0005: at most 0.000596 × 10 = 0.00596 mm² < 0.008, and no move of 0.0001 takes it out (0.0005 > 0.0001):
  // not provable either way. It says so, and that they meet.
  const thin = await partsRelation(kernel, SQUARE, part(box(10 - 0.0005, 0, 10, 10)));
  assert.equal(thin.relation, "unknown");
  assert.equal(thin.meet, true);
  assert.match(thin.why ?? "", /lies along an edge of the other/);
  // w = 0.00005, half a NUDGE: moved 0.000096 right it is clear, so the overlap is a sliver under 2 × NUDGE: touch.
  assert.equal(2 * NUDGE, 0.0002);
  assert.deepEqual(await partsRelation(kernel, SQUARE, part(box(10 - 0.00005, 0, 10, 10))), { relation: "touch" });
});

test("a part fitting another snugly on opposite sides is unknown, and known to meet", async () => {
  // A U (30 wide, arms 10 wide, the slot x 10..20 above y = 10) and a 10 mm bar exactly filling the slot: three of
  // its sides lie on the U's. No area is in both (a touch), but every nudge pushes it into one arm or the floor.
  const u = part(path([0, 0, 30, 0, 30, 20, 20, 20, 20, 10, 10, 10, 10, 20, 0, 20]));
  const snug = await partsRelation(kernel, u, part(box(10, 10, 10, 10)));
  assert.deepEqual([snug.relation, snug.meet], ["unknown", true]);
  // 1 mm narrower all round and clear of the floor: apart, though the boxes overlap.
  assert.equal(await both(u, part(box(11, 11, 8, 10))), "apart");
  // Against one arm only (x from 10, 8 wide, 1 above the floor): touch.
  assert.equal(await both(u, part(box(10, 11, 8, 10))), "touch");
  // In the corner of the slot (against the left arm and the floor): it can come away up and right: touch.
  assert.equal(await both(u, part(box(10, 10, 8, 10))), "touch");
});

test(`boxes more than ${BOX_MARGIN} mm apart are apart without the kernel; at 0.9× of that the kernel is asked`, async () => {
  const dead = deadKernel();
  // Gap 1.1 × 0.002 = 0.0022 between the boxes: answered at once, no kernel call.
  assert.deepEqual(await partsRelation(dead, SQUARE, part(box(10 + 1.1 * BOX_MARGIN, 0, 10, 10))), { relation: "apart" });
  assert.deepEqual(await partsRelation(dead, SQUARE, part(box(0, 10 + 1.1 * BOX_MARGIN, 10, 10))), { relation: "apart" });
  assert.deepEqual(await partsRelation(dead, part(disc(100, 100, 5)), part(disc(89.9, 100, 5))), { relation: "apart" }); // boxes 0.1 apart
  assert.equal(dead.calls, 0);
  // Gap 0.9 × 0.002 = 0.0018: the dead kernel is asked, so the answer is unknown with its words; the real one says apart (0.0018 > 0.001).
  assert.deepEqual(await partsRelation(dead, SQUARE, part(box(10 + 0.9 * BOX_MARGIN, 0, 10, 10))), { relation: "unknown", why: "the kernel can't cut the two parts out of one sheet: no kernel in this test" });
  assert.ok(dead.calls > 0);
  assert.equal(await both(SQUARE, part(box(10 + 0.9 * BOX_MARGIN, 0, 10, 10))), "apart");
  // The margin is never under the kernel's own line: a pair 0.9 × CLEARANCE apart (a touch) is never waved through
  // by its boxes, and the margin leaves room for the 1e-6 mm a box's two corners are each rounded by.
  assert.equal(await relation(SQUARE, part(box(10 + 0.9 * CLEARANCE, 0, 10, 10)), dead), "unknown");
  assert.ok(BOX_MARGIN >= CLEARANCE + 2e-6, `BOX_MARGIN ${BOX_MARGIN}`);
  assert.deepEqual([CLEARANCE, BOX_MARGIN, NUDGE], [0.001, 0.002, 0.0001]);
  // Boxes that overlap though the parts are far apart (an L and a block in its notch) are for the kernel too.
  assert.equal(await relation(part(path([0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30])), part(box(15, 15, 10, 10)), dead), "unknown");
  assert.equal(await both(part(path([0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30])), part(box(15, 15, 10, 10))), "apart");
});

// ── Refusals: never a throw, never "apart" ──────────────────────────────────

test("an outline that is no part is unknown, with why in words", async () => {
  // Three corner numbers: not whole x, y pairs (core's check, through the box).
  assert.deepEqual(await partsRelation(kernel, SQUARE, part(path([0, 0, 1]))), { relation: "unknown", why: "the outline can't be written as SVG: it has 3 corner numbers, not whole x, y pairs" });
  assert.match((await partsRelation(kernel, part(path([0, 0, NaN, 1, 2, 2])), SQUARE)).why ?? "", /not finite/);
  // A bow tie (its sides cross at (10,10)) is two triangles to the kernel, not one closed shape.
  const bow = await partsRelation(kernel, SQUARE, part(path([5, 5, 15, 15, 15, 5, 5, 15])));
  assert.deepEqual(bow, { relation: "unknown", why: "the kernel does not read the second part as one closed shape with its holes: its curves make other regions" });
  assert.match((await partsRelation(kernel, part(path([5, 5, 15, 15, 15, 5, 5, 15])), SQUARE)).why ?? "", /the first part/);
  // A hole outside its part (the part itself is wrong, not the pair).
  const stray = await partsRelation(kernel, part(box(0, 0, 10, 10), box(8, 8, 5, 5)), part(box(9, 9, 3, 3)));
  assert.equal(stray.relation, "unknown");
  assert.match(stray.why ?? "", /the first part/);
  // An arc flatter than the kernel's 1 km radius (bulge 1e-8 on a 10 mm chord): its refusal, in its words.
  const flat = await partsRelation(kernel, SQUARE, part(path([5, 5, 15, 5, 15, 15, 5, 15], [1e-8, 0, 0, 0])));
  assert.equal(flat.relation, "unknown");
  assert.match(flat.why ?? "", /can't cut the two parts out of one sheet: .*radius/);
  // Parts past the kernel's 2000 corners for one profile (two stars of 1000).
  const big = await partsRelation(kernel, part(star(0, 0, 1000, 40, 50)), part(star(75, 75, 1000, 40, 50)));
  assert.equal(big.relation, "unknown");
  assert.match(big.why ?? "", /2000/);
});

test("a kernel that fails or answers nonsense gives unknown, never a throw and never apart", async () => {
  const crossing = part(box(5, 5, 10, 10));
  assert.equal(await relation(SQUARE, crossing, deadKernel()), "unknown");
  // sketch_regions answering with no regions and no reason.
  const empty = lyingKernel("sketch_regions", async () => ({ regions: [], loose: [] }));
  assert.equal(await relation(SQUARE, crossing, empty), "unknown");
  // sketch_regions naming curves that don't exist.
  const stray = lyingKernel("sketch_regions", async (real) => {
    const found = (await real()) as { regions: { outer: { index: number }[] }[] };
    for (const r of found.regions) for (const p of r.outer) p.index += 100;
    return found;
  });
  assert.equal(await relation(SQUARE, crossing, stray), "unknown");
  // A region the kernel says it is unsure of (it can't be cut out, and no curves are named to mark) is not read:
  // with every answer for the two together so marked, nothing is proved either way.
  const unsure = lyingKernel("sketch_regions", async (real, args) => {
    const found = (await real()) as { regions: { extrudes: boolean; refused?: string; invalid?: unknown[] }[] };
    if ((args[0] as unknown[]).length === 8) for (const r of found.regions) [r.extrudes, r.refused, r.invalid] = [false, "the curves meet too closely near (10, 5) to tell the regions apart", undefined];
    return found;
  });
  const doubted = await partsRelation(unsure, SQUARE, crossing);
  assert.deepEqual([doubted.relation, doubted.meet], ["unknown", true]);
  assert.match(doubted.why ?? "", /meet too closely for the kernel to tell a touch from an overlap \(the curves meet too closely near/);
  // A kernel that throws something that is no Error.
  const rude: KernelCalls = { call: (() => Promise.reject("boom")) as KernelCalls["call"] };
  assert.deepEqual(await partsRelation(rude, SQUARE, crossing), { relation: "unknown", why: "the kernel can't cut the two parts out of one sheet: boom" });
});

test("these tests can fail: with a kernel made to lie, the same pairs get the wrong word", async () => {
  // A kernel that builds every sheet (never finding two loops too close): the crossing squares pass as apart.
  const builds = lyingKernel("body_build", (real) => real().catch(() => -1));
  const free = builds.call;
  builds.call = ((op: string, ...args: unknown[]) => (op === "body_free" && args[0] === -1 ? Promise.resolve() : (free as (op: string, ...args: unknown[]) => Promise<unknown>)(op, ...args))) as KernelCalls["call"];
  assert.equal(await relation(SQUARE, part(box(5, 5, 10, 10)), builds), "apart");
  assert.equal(await relation(SQUARE, part(box(5, 5, 10, 10))), "overlap");
  // A kernel that lists every curve the other way round each region of the two together (the call with all 8 lines):
  // the 25 mm² in both reads as in neither, so the overlap is lost.
  const turned = lyingKernel("sketch_regions", async (real, args) => {
    const found = (await real()) as { regions: { outer: { reversed: boolean }[]; holes: { reversed: boolean }[][] }[] };
    if ((args[0] as unknown[]).length === 8) for (const r of found.regions) for (const p of [...r.outer, ...r.holes.flat()]) p.reversed = !p.reversed;
    return found;
  });
  assert.notEqual(await relation(SQUARE, part(box(5, 5, 10, 10)), turned), "overlap");
  // A kernel that leaves the nested square out of the big one's holes: inside-the-material is no longer seen as an overlap.
  const flat = lyingKernel("sketch_regions", async (real) => {
    const found = (await real()) as { regions: { holes: unknown[] }[] };
    for (const r of found.regions) r.holes = [];
    return found;
  });
  assert.notEqual(await relation(SQUARE, part(box(2, 2, 3, 3)), flat), "overlap");
  assert.equal(await relation(SQUARE, part(box(2, 2, 3, 3))), "overlap");
});

test("what the kernel answers, that this file leans on (a change here means overlap.ts can be made simpler, or must change)", async () => {
  const lines = (o: Outline) => outlineCurves(o).lines;
  // Curves lying along each other: no regions, and the two curves named (the first square's bottom, line 0; the second's, line 4).
  const along = await kernel.call("sketch_regions", [...lines(SQUARE), ...lines(part(box(5, 0, 10, 10)))], [], []);
  assert.deepEqual([along.regions.length, along.invalid], [0, [{ input: "line", index: 0 }, { input: "line", index: 4 }]]);
  // Touching at a corner: two regions as if apart, nothing saying they meet (so "apart" is never read from regions).
  const corner = await kernel.call("sketch_regions", [...lines(SQUARE), ...lines(part(box(10, 10, 10, 10)))], [], []);
  assert.deepEqual(corner.regions.map((r) => [r.outer.length, r.holes.length]), [[4, 0], [4, 0]]);
  // Two loops closer than 0.001 mm as holes of one sheet: refused, naming a piece of each (loops 1 and 2).
  const sheet = box(-5, -5, 40, 40);
  const close = await kernel.call("body_build", { extrude: { profile: { outer: sheet, holes: [box(0, 0, 10, 10), box(10.0005, 0, 10, 10)] }, distance: 1 } }).then(
    () => null,
    (e: { kind: string; inputs: { input: string; boundary?: number }[] }) => e,
  );
  assert.deepEqual([close?.kind, close?.inputs.map((i) => [i.input, i.boundary])], ["invalid-input", [["piece", 1], ["piece", 2]]]);
  // One inside the other: refused, naming the two loops.
  const nested = await kernel.call("body_build", { extrude: { profile: { outer: sheet, holes: [box(0, 0, 10, 10), box(2, 2, 3, 3)] }, distance: 1 } }).then(
    () => null,
    (e: { kind: string; inputs: { input: string }[] }) => e,
  );
  assert.deepEqual([nested?.kind, nested?.inputs.map((i) => i.input)], ["invalid-input", ["loop", "loop"]]);
});

test("every body built to ask is freed", async () => {
  const before = await kernel.call("body_count");
  const frame = part(box(0, 0, 30, 30), box(5, 5, 20, 20));
  for (const b of [box(40, 0, 5, 5), box(10, 10, 10, 10), box(5, 10, 10, 10), box(20, 10, 8, 10), box(30.0005, 0, 5, 5), box(5, 5, 20, 20)]) await partsRelation(kernel, frame, part(b));
  assert.equal(await kernel.call("body_count"), before);
});

// ── Many corners ────────────────────────────────────────────────────────────

test("two 200-corner stars: the right word, in well under a second each", async (t) => {
  const big = part(star(0, 0, 200, 40, 50));
  const cases: [string, Outline, PartsRelation["relation"]][] = [
    // Centres (0,0) and (75,75): 106.07 apart, more than 50 + 50, but the boxes overlap (75 − 50 < 50): apart.
    ["apart", part(star(75, 75, 200, 40, 50)), "apart"],
    // Centres 60 apart, less than 40 + 40 (the inner circles): overlap.
    ["crossing", part(star(60, 0, 200, 40, 50)), "overlap"],
    // Radii 20 and 25 round the same centre: inside the big one's inner circle (40): overlap.
    ["inside", part(star(0, 0, 200, 20, 25)), "overlap"],
    // The same star twice: every edge along its twin.
    ["stacked", big, "overlap"],
  ];
  for (const [name, other, want] of cases) {
    const start = performance.now();
    assert.equal(await relation(big, other), want, name);
    const ms = performance.now() - start;
    t.diagnostic(`${name}: ${ms.toFixed(0)} ms`);
    assert.ok(ms < 5000, `${name} took ${ms.toFixed(0)} ms`);
  }
});

// ── Seeded random pairs against a model that only compares numbers ──────────

/** A seeded generator (mulberry32): the same seed gives the same numbers. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const rectLoop = (r: Rect): Loop => box(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
/** How far two spans overlap (negative: the gap between them). */
const span = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Two axis-aligned rectangles by numbers alone: the x spans and the y spans each overlap by a length, touch (0) or
 * leave a gap (negative). Overlap: both overlap. Apart: either leaves a gap. Else touch.
 */
function rectModel(a: Rect, b: Rect): PartsRelation["relation"] {
  const [ox, oy] = [span(a.x0, a.x1, b.x0, b.x1), span(a.y0, a.y1, b.y0, b.y1)];
  return ox > 0 && oy > 0 ? "overlap" : ox < 0 || oy < 0 ? "apart" : "touch";
}

/** A rectangle on a half-millimetre grid inside 40 × 40, 1 to 15 mm a side. */
function gridRect(random: () => number): Rect {
  const half = (max: number) => Math.floor(random() * (2 * max + 1)) / 2;
  const [w, h] = [1 + half(14), 1 + half(14)];
  const [x0, y0] = [half(40 - w), half(40 - h)];
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** `b` slid so that one of its sides is on the line of one of `a`'s (which, by `pick` 0 to 5): the cases a layout in rows makes all the time. */
function lineUp(a: Rect, b: Rect, pick: number): Rect {
  const [w, h] = [b.x1 - b.x0, b.y1 - b.y0];
  const at = (x0: number, y0: number): Rect => ({ x0, y0, x1: x0 + w, y1: y0 + h });
  return [at(a.x1, b.y0), at(a.x0 - w, b.y0), at(b.x0, a.y1), at(b.x0, a.y0 - h), at(b.x0, a.y0), at(a.x0, b.y0)][pick];
}

test("seeded: 400 pairs of grid rectangles agree with the number model, both ways round, also 2900 mm out", async (t) => {
  const SEED = 20261111;
  const random = seeded(SEED);
  const seen = { apart: 0, overlap: 0, touch: 0, unknown: 0 };
  const wrongModel = { misses: 0 };
  for (let i = 0; i < 400; i++) {
    // A third of the pairs anywhere; the rest with a side of the second on a side's line of the first
    // (its right, left, top, bottom: abutting when the other spans meet; or the same baseline, or the same left line).
    const a = gridRect(random);
    const b = i % 3 === 0 ? gridRect(random) : lineUp(a, gridRect(random), Math.floor(random() * 6));
    const want = rectModel(a, b);
    const at = i % 4 === 3 ? 2900 : 0;
    const [pa, pb] = [moveOutline(part(rectLoop(a)), at, at), moveOutline(part(rectLoop(b)), at, at)];
    const got = await both(pa, pb);
    assert.equal(got, want, `seed ${SEED}, pair ${i}, moved by ${at}: ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
    seen[got]++;
    // A model that takes touching for apart (≤ in place of <) must disagree somewhere, or this test compares nothing.
    const [ox, oy] = [span(a.x0, a.x1, b.x0, b.x1), span(a.y0, a.y1, b.y0, b.y1)];
    if ((ox > 0 && oy > 0 ? "overlap" : "apart") !== got) wrongModel.misses++;
  }
  t.diagnostic(`apart ${seen.apart}, overlap ${seen.overlap}, touch ${seen.touch}`);
  assert.ok(seen.apart > 20 && seen.overlap > 20 && seen.touch > 20, `the pairs are one-sided: ${JSON.stringify(seen)}`);
  assert.ok(wrongModel.misses > 20, "a model without touch agreed: the test can't tell touch from apart");
});

test("seeded: 200 pairs of rectangles at any position agree with the number model", async () => {
  const SEED = 7;
  const random = seeded(SEED);
  let tried = 0;
  while (tried < 200) {
    const any = (): Rect => {
      const [x0, y0] = [random() * 30, random() * 30];
      return { x0, y0, x1: x0 + 1 + random() * 12, y1: y0 + 1 + random() * 12 };
    };
    const [a, b] = [any(), any()];
    const [ox, oy] = [span(a.x0, a.x1, b.x0, b.x1), span(a.y0, a.y1, b.y0, b.y1)];
    // Skip pairs within 0.01 mm of touching, where the word depends on the tolerances tested above.
    if (Math.abs(ox) < 0.01 || Math.abs(oy) < 0.01) continue;
    tried++;
    assert.equal(await both(part(rectLoop(a)), part(rectLoop(b))), rectModel(a, b), `seed ${SEED}, pair ${tried}: ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
});

/** A w × h rectangle centred on (cx, cy), turned by `angle` radians: its corners, counter-clockwise. */
function turned(cx: number, cy: number, w: number, h: number, angle: number): [number, number][] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/**
 * How far apart two convex shapes are along the best of their sides' normals (the separating-axis rule): for each
 * side, the gap between the two shapes' shadows on its normal; the largest gap. Above 0 they are apart (a line
 * parts them); below 0 on every normal, they overlap. Its size is a lower bound of how far they must move.
 */
function widestGap(p: [number, number][], q: [number, number][]): number {
  let widest = -Infinity;
  for (const shape of [p, q]) {
    for (let i = 0; i < shape.length; i++) {
      const [ax, ay] = shape[i];
      const [bx, by] = shape[(i + 1) % shape.length];
      const len = Math.hypot(bx - ax, by - ay);
      const [nx, ny] = [(by - ay) / len, -(bx - ax) / len];
      const shadow = (pts: [number, number][]) => pts.map(([x, y]) => x * nx + y * ny);
      const [sp, sq] = [shadow(p), shadow(q)];
      widest = Math.max(widest, Math.max(Math.min(...sp) - Math.max(...sq), Math.min(...sq) - Math.max(...sp)));
    }
  }
  return widest;
}

test("seeded: 200 pairs of rectangles turned to any angle agree with the separating-axis model, and a turned one slid along its own side", async (t) => {
  const SEED = 31337;
  const random = seeded(SEED);
  const seen = { apart: 0, overlap: 0, touch: 0, unknown: 0 };
  let tried = 0;
  while (tried < 200) {
    const any = () => turned(5 + random() * 25, 5 + random() * 25, 2 + random() * 14, 2 + random() * 14, random() * Math.PI);
    const [p, q] = [any(), any()];
    const gap = widestGap(p, q);
    // Skip pairs within 0.01 mm of touching, where the word depends on the tolerances tested above.
    if (Math.abs(gap) < 0.01) continue;
    tried++;
    const got = await both(part(path(p.flat())), part(path(q.flat())));
    assert.equal(got, gap > 0 ? "apart" : "overlap", `seed ${SEED}, pair ${tried}: ${JSON.stringify(p)} and ${JSON.stringify(q)}`);
    seen[got]++;
  }
  // A 12 × 5 rectangle turned by a random angle, and its copy slid along its long side's direction (cos, sin) by s:
  // by 6 it covers half of the first (overlap, long sides along each other at an odd angle); by 12 its short side
  // is the first's (touch); by 12.5 there is 0.5 mm between them (apart).
  for (let i = 0; i < 30; i++) {
    const angle = random() * Math.PI;
    const slid = (s: number) => part(path(turned(20 + s * Math.cos(angle), 20 + s * Math.sin(angle), 12, 5, angle).flat()));
    const told = `seed ${SEED}, turned ${i}: angle ${angle}`;
    assert.equal(await both(slid(0), slid(6)), "overlap", told);
    assert.equal(await both(slid(0), slid(12)), "touch", told);
    assert.equal(await both(slid(0), slid(12.5)), "apart", told);
  }
  t.diagnostic(`apart ${seen.apart}, overlap ${seen.overlap}`);
  assert.ok(seen.apart > 20 && seen.overlap > 20, `the pairs are one-sided: ${JSON.stringify(seen)}`);
});

/**
 * A frame (a rectangle with a rectangular hole) and a rectangle b, by numbers alone. The area of b in the frame's
 * material is its area inside the outer rectangle less its area inside the hole (the hole is inside the outer one):
 * above 0 is an overlap. With none: b strictly inside the hole is apart; else b reaching the outer rectangle
 * (spans touching or overlapping) touches the material's edge; else apart.
 */
function frameModel(outer: Rect, hole: Rect, b: Rect): PartsRelation["relation"] {
  const shared = (r: Rect) => Math.max(0, span(r.x0, r.x1, b.x0, b.x1)) * Math.max(0, span(r.y0, r.y1, b.y0, b.y1));
  if (shared(outer) - shared(hole) > 0) return "overlap";
  if (b.x0 > hole.x0 && b.x1 < hole.x1 && b.y0 > hole.y0 && b.y1 < hole.y1) return "apart";
  return span(outer.x0, outer.x1, b.x0, b.x1) >= 0 && span(outer.y0, outer.y1, b.y0, b.y1) >= 0 ? "touch" : "apart";
}

test("seeded: 300 rectangles against a frame agree with the number model; unknown only for a touch, and then known to meet", async (t) => {
  const SEED = 4242;
  const random = seeded(SEED);
  const whole = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const seen = { apart: 0, overlap: 0, touch: 0, unknown: 0 };
  for (let i = 0; i < 300; i++) {
    // The frame: outer (0,0)..(30,30); a hole with whole-millimetre sides at least 2 from the outer sides.
    const outer: Rect = { x0: 0, y0: 0, x1: 30, y1: 30 };
    const hole: Rect = { x0: whole(2, 8), y0: whole(2, 8), x1: whole(20, 28), y1: whole(20, 28) };
    // The other part, whole millimetres. A third anywhere from −12 to 42, 1 to 26 a side; a third small, inside the
    // hole's box; a third with a side on a line of the hole or of the outer rectangle.
    const [w, h] = i % 3 === 0 ? [whole(1, 26), whole(1, 26)] : [whole(1, 9), whole(1, 9)];
    const [x0, y0] = i % 3 === 0 ? [whole(-12, 42 - w), whole(-12, 42 - h)] : [whole(hole.x0, hole.x1 - w), whole(hole.y0, hole.y1 - h)];
    let b: Rect = { x0, y0, x1: x0 + w, y1: y0 + h };
    if (i % 3 === 2) b = lineUp(random() < 0.5 ? hole : outer, b, whole(0, 5));
    const want = frameModel(outer, hole, b);
    const told = `seed ${SEED}, pair ${i}: hole ${JSON.stringify(hole)}, part ${JSON.stringify(b)}`;
    const frame = part(rectLoop(outer), rectLoop(hole));
    const got = await partsRelation(kernel, frame, part(rectLoop(b)));
    const back = await partsRelation(kernel, part(rectLoop(b)), frame);
    seen[got.relation]++;
    for (const answer of [got, back]) {
      if (answer.relation === "unknown") {
        // Only a part snug in the hole (touching without a way out) may be unknown; it must be known to meet.
        assert.deepEqual([want, answer.meet], ["touch", true], `${told}: ${answer.why}`);
      } else assert.equal(answer.relation, want, told);
    }
  }
  t.diagnostic(`apart ${seen.apart}, overlap ${seen.overlap}, touch ${seen.touch}, unknown ${seen.unknown}`);
  assert.ok(seen.apart > 20 && seen.overlap > 20 && seen.touch > 20, `the pairs are one-sided: ${JSON.stringify(seen)}`);
  assert.ok(seen.unknown < 30, `too many unknown: ${JSON.stringify(seen)}`);
});

/**
 * A ring (radii `hole` < `outer` round the origin; hole 0 for a disc) and a disc of radius r at (x, y), by whole
 * numbers alone: d² = x² + y² against squares of sums and differences. The disc is inside the hole when d + r ≤ hole,
 * that is r ≤ hole and d² ≤ (hole − r)² (equal: it touches the hole's edge from inside; less: apart). Else it is clear
 * of the ring when d² > (outer + r)², touches it when equal, and overlaps its material otherwise.
 */
function ringModel(outer: number, hole: number, x: number, y: number, r: number): PartsRelation["relation"] {
  const d2 = x * x + y * y;
  if (r <= hole && d2 <= (hole - r) ** 2) return r < hole && d2 < (hole - r) ** 2 ? "apart" : "touch";
  return d2 > (outer + r) ** 2 ? "apart" : d2 === (outer + r) ** 2 ? "touch" : "overlap";
}

test("seeded: 300 discs against a ring or a disc agree with the whole-number model, tangent ones included", async (t) => {
  const SEED = 99;
  const random = seeded(SEED);
  const whole = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  // Whole-number right triangles, so that a centre is a whole distance away and tangency is exact: (x, y, d).
  const TRIPLES = [
    [3, 4, 5],
    [6, 8, 10],
    [5, 12, 13],
    [8, 15, 17],
    [12, 16, 20],
    [7, 24, 25],
    [0, 9, 9],
    [14, 0, 14],
  ];
  const seen = { apart: 0, overlap: 0, touch: 0, unknown: 0 };
  for (let i = 0; i < 300; i++) {
    const outer = whole(6, 14);
    const hole = i % 3 === 0 ? 0 : whole(2, outer - 2);
    let [x, y, r] = [whole(-20, 20), whole(-20, 20), whole(1, 8)];
    if (i % 2 === 0) {
      // Half the pairs made tangent: outside the ring (d = outer + r), or inside its hole (d = hole − r) when it fits.
      const [tx, ty, d] = TRIPLES[whole(0, TRIPLES.length - 1)];
      [x, y] = random() < 0.5 ? [tx, ty] : [-ty, tx];
      if (i % 4 === 0 && hole - d >= 1) r = hole - d;
      else if (d - outer >= 1) r = d - outer;
    }
    const want = ringModel(outer, hole, x, y, r);
    const ring = part(disc(0, 0, outer), ...(hole > 0 ? [disc(0, 0, hole)] : []));
    const told = `seed ${SEED}, pair ${i}: ring ${outer}/${hole}, disc radius ${r} at (${x}, ${y})`;
    // A disc exactly filling the hole lies along its edge all round: the one case that may be unknown (and meets).
    if (r === hole && x === 0 && y === 0) {
      const snug = await partsRelation(kernel, ring, part(disc(x, y, r)));
      assert.deepEqual([snug.relation, snug.meet], ["unknown", true], told);
      seen.unknown++;
      continue;
    }
    const got = await both(ring, part(disc(x, y, r)));
    assert.equal(got, want, told);
    seen[got]++;
  }
  t.diagnostic(`apart ${seen.apart}, overlap ${seen.overlap}, touch ${seen.touch}, unknown ${seen.unknown}`);
  assert.ok(seen.apart > 20 && seen.overlap > 20 && seen.touch > 20, `the pairs are one-sided: ${JSON.stringify(seen)}`);
});
