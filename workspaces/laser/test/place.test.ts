// Parts placed by hand (place.ts), worked by hand. Bed 100 × 50 mm, gap 5 mm unless said.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Loop, Outline } from "@fission/core";
import { boxesOverlap, cleanMm, EDGE_SLACK, FLIP, flippedOnTheSpot, layOutPlaced, mirrorOutline, MAX_REACH, normalAngle, offBed, offBedWords, overlapCandidates, placementRefusal, placeOutline, readPlacements, snapMm, turnedOnTheSpot, turnOutline, type LaidPart } from "../src/place.ts";
import { layOut, outlineBox, type PlacedPart, type SheetPart } from "../src/sheet.ts";

const path = (corners: number[], bulges: number[] = []): Loop => ({ path: { corners, bulges } });
const rect = (w: number, h: number, x = 0, y = 0): Outline => ({ outer: path([x, y, x + w, y, x + w, y + h, x, y + h]), holes: [] });
const part = (id: string, outline: Outline): SheetPart => ({ id, label: `Sketch ${id}`, outline });
const BED = { width: 100, height: 50 };
/** A slot: a 40 × 20 rectangle from (10, 0) whose ends are half circles of radius 10, with a round hole of radius 4 at (30, 10). Its box is 0…60 × 0…20. */
const SLOT: Outline = { outer: path([10, 0, 50, 0, 50, 20, 10, 20], [0, 1, 0, 1]), holes: [{ circle: { center: [30, 10], radius: 4 } }] };
const near = (got: number, want: number, what: string, eps = 1e-12) => assert.ok(Math.abs(got - want) <= eps, `${what}: got ${got}, want ${want}`);

test("an angle is brought into 0 up to 360, never −0 or 360", () => {
  assert.deepEqual([450, -90, 360, -0, 0, 720.5, -360, 359.5, -450].map(normalAngle), [90, 270, 0, 0, 0, 0.5, 0, 359.5, 270]);
});

test("hand-worked: quarter turns move corners onto whole numbers, exactly, with no −0", () => {
  // Counter-clockwise by 90°, (x, y) goes to (−y, x): (0,0) (40,0) (40,30) (0,30) become (0,0) (0,40) (−30,40) (−30,0).
  assert.deepEqual(turnOutline(rect(40, 30), 90), { outer: path([0, 0, 0, 40, -30, 40, -30, 0]), holes: [] });
  // By 180°, (x, y) goes to (−x, −y).
  assert.deepEqual(turnOutline(rect(40, 30), 180), { outer: path([0, 0, -40, 0, -40, -30, 0, -30]), holes: [] });
  // By 270°, (x, y) goes to (y, −x).
  assert.deepEqual(turnOutline(rect(40, 30), 270), { outer: path([0, 0, 0, -40, 30, -40, 30, 0]), holes: [] });
  assert.deepEqual(turnOutline(rect(40, 30), 0), rect(40, 30));
  assert.deepEqual(turnOutline(rect(40, 30), -90), turnOutline(rect(40, 30), 270));
  assert.deepEqual(turnOutline(rect(40, 30), 360 + 90), turnOutline(rect(40, 30), 90));
});

test("hand-worked: turning keeps arcs exact: corners and centres turn, bulges and radii are the same numbers", () => {
  // The slot by 90°: corners (10,0) (50,0) (50,20) (10,20) become (0,10) (0,50) (−20,50) (−20,10); the hole's centre
  // (30,10) becomes (−10,30). The half-circle ends still bulge by 1, the hole's radius is still 4.
  const turned = turnOutline(SLOT, 90);
  assert.deepEqual(turned, { outer: path([0, 10, 0, 50, -20, 50, -20, 10], [0, 1, 0, 1]), holes: [{ circle: { center: [-10, 30], radius: 4 } }] });
  // Its box: the 60 × 20 slot stood on end, 20 wide and 60 tall, left of the y axis.
  assert.deepEqual(outlineBox(turned), { minX: -20, minY: 0, maxX: 0, maxY: 60 });
  // By 30°: (10, 0) goes to (10·cos 30°, 10·sin 30°) = (8.660254…, 5); (0, 10) to (−5, 8.660254…).
  const tilted = turnOutline({ outer: path([10, 0, 0, 10, -3, -3]), holes: [] }, 30).outer as { path: { corners: number[] } };
  near(tilted.path.corners[0], 5 * Math.sqrt(3), "x of (10,0)");
  near(tilted.path.corners[1], 5, "y of (10,0)");
  near(tilted.path.corners[2], -5, "x of (0,10)");
  near(tilted.path.corners[3], 5 * Math.sqrt(3), "y of (0,10)");
  // A turn keeps every distance: the turned rectangle's sides are still 40 and 30 (by 37°, to a hair).
  const c = (turnOutline(rect(40, 30), 37).outer as { path: { corners: number[] } }).path.corners;
  near(Math.hypot(c[2] - c[0], c[3] - c[1]), 40, "the 40 side", 1e-12);
  near(Math.hypot(c[4] - c[2], c[5] - c[3]), 30, "the 30 side", 1e-12);
  // The outline given is never changed.
  assert.deepEqual(SLOT.outer, path([10, 0, 50, 0, 50, 20, 10, 20], [0, 1, 0, 1]));
});

test("hand-worked: a placed part's box corner is where the person put it, turned first", () => {
  // The 40 × 30 rectangle turned 90° covers x −30…0, y 0…40. Put at (100, 50) it moves by (130, 50):
  // (130,50) (130,90) (100,90) (100,50), a box 30 wide and 40 tall from (100, 50).
  assert.deepEqual(placeOutline(rect(40, 30), { x: 100, y: 50, angle: 90 }), { outline: { outer: path([130, 50, 130, 90, 100, 90, 100, 50]), holes: [] }, box: { minX: 100, minY: 50, maxX: 130, maxY: 90 } });
  // A sketch drawn far from its origin lands in the same place: only the shape matters, not where it was drawn.
  assert.deepEqual(placeOutline(rect(40, 30, 700, -200), { x: 7, y: 8, angle: 0 }), { outline: rect(40, 30, 7, 8), box: { minX: 7, minY: 8, maxX: 47, maxY: 38 } });
  // The slot on end at (5, 5): its turned box is x −20…0, so it moves by (25, 5); 20 × 60 from (5, 5).
  const slot = placeOutline(SLOT, { x: 5, y: 5, angle: 90 });
  assert.deepEqual(slot.box, { minX: 5, minY: 5, maxX: 25, maxY: 65 });
  assert.deepEqual(slot.outline, { outer: path([25, 15, 25, 55, 5, 55, 5, 15], [0, 1, 0, 1]), holes: [{ circle: { center: [15, 35], radius: 4 } }] });
  // A malformed outline is refused in words.
  assert.throws(() => placeOutline({ outer: path([0, 0, 1, 1]), holes: [] }, { x: 0, y: 0, angle: 0 }), /2 corners/);
  assert.throws(() => placeOutline({ outer: path([0, 0, 1, 1, 5]), holes: [] }, { x: 0, y: 0, angle: 90 }), /corner numbers/);
});

test("hand-worked: a part turns on the spot, about the middle of its box, and four quarter turns bring it back", () => {
  // 40 × 30 at (10, 10): its middle is (30, 25). Turned 90° it is 30 × 40, so its corner goes to (30 − 15, 25 − 20) = (15, 5).
  const once = turnedOnTheSpot(rect(40, 30), { x: 10, y: 10, width: 40, height: 30 }, 90);
  assert.deepEqual(once, { x: 15, y: 5, angle: 90 });
  const twice = turnedOnTheSpot(rect(40, 30), { x: 15, y: 5, width: 30, height: 40 }, 180);
  assert.deepEqual(twice, { x: 10, y: 10, angle: 180 });
  const thrice = turnedOnTheSpot(rect(40, 30), { x: 10, y: 10, width: 40, height: 30 }, 270);
  assert.deepEqual(thrice, { x: 15, y: 5, angle: 270 });
  assert.deepEqual(turnedOnTheSpot(rect(40, 30), { x: 15, y: 5, width: 30, height: 40 }, 360), { x: 10, y: 10, angle: 0 });
  // By 45° a 10 × 10 square's box is 10√2 = 14.142136 wide: from a middle at (50, 20) its corner is at 50 − 7.071068.
  assert.deepEqual(turnedOnTheSpot(rect(10, 10), { x: 45, y: 15, width: 10, height: 10 }, 45), { x: 42.928932, y: 12.928932, angle: 45 });
});

test("the placements a project holds read back; what is not a usable placement is dropped, never thrown on", () => {
  assert.deepEqual(readPlacements({ a: { x: 1, y: 2, angle: 450 }, b: { x: 3, y: 4 }, c: { x: "1", y: 2 }, d: null, e: { x: 1e9, y: 0, angle: 0 }, f: { x: 0, y: NaN, angle: 0 }, g: 7, h: { x: 0, y: 0, angle: Infinity } }), { a: { x: 1, y: 2, angle: 90 }, b: { x: 3, y: 4, angle: 0 } });
  for (const bad of [undefined, null, 7, "x", [], [{ x: 1, y: 2 }]]) assert.deepEqual(readPlacements(bad), {}, JSON.stringify(bad));
  // The furthest a part may be put, tested just inside and just outside.
  assert.equal(MAX_REACH, 10_000);
  assert.equal(placementRefusal({ x: MAX_REACH * 0.9, y: -MAX_REACH * 0.9, angle: 0 }), null);
  assert.equal(placementRefusal({ x: MAX_REACH, y: 0, angle: 0 }), null);
  assert.equal(placementRefusal({ x: MAX_REACH * 1.1, y: 0, angle: 0 }), "A part can be put at most 10000 mm from the bed's corner.");
  assert.equal(placementRefusal({ x: 0, y: -MAX_REACH * 1.1, angle: 0 }), "A part can be put at most 10000 mm from the bed's corner.");
  assert.equal(placementRefusal({ x: 0, y: 0, angle: NaN }), "A part's place and angle must be numbers.");
});

test("hand-worked: row parts step round a part placed by hand, keeping the gap from it", () => {
  // H, 20 × 20, was put at (30, 5): it and its 5 mm gap cover x 25…55, y 0…30. A to E are 20 × 10, laid in rows.
  const parts = [part("A", rect(20, 10)), part("H", rect(20, 20)), part("B", rect(20, 10)), part("C", rect(20, 10)), part("D", rect(20, 10)), part("E", rect(40, 10))];
  const { placed, left } = layOutPlaced(parts, BED, 5, { H: { x: 30, y: 5, angle: 0 } });
  assert.deepEqual(left, []);
  assert.deepEqual(placed.map((p) => [p.id, p.x, p.y, p.by]), [
    ["A", 5, 5, "rows"], // ends at 25, on the gap's line before H: it stays
    ["H", 30, 5, "hand"], // where it was put, in the list's order
    ["B", 55, 5, "rows"], // x = 30 would be on H: on past it, to 30 + 20 + 5 = 55
    ["C", 5, 20, "rows"], // 80 + 20 > 95: a new row above A and B, y = 5 + 10 + 5 = 20; ends at 25, clear of H
    ["D", 55, 20, "rows"], // x = 30, y 20…30 would be on H (and its gap, up to y = 30): on to 55
    ["E", 5, 35, "rows"], // 80 + 40 > 95: a new row, y = 20 + 10 + 5 = 35, above H's gap (30)
  ]);
  assert.deepEqual(placed[2].outline, rect(20, 10, 55, 5));
  assert.deepEqual(placed.map((p) => p.angle), [0, 0, 0, 0, 0, 0]);
});

test("hand-worked: a row a hand-placed part leaves no room in moves up above it; with no room above, the part is left off in words", () => {
  // H, 85 × 10 at (5, 5), fills the first row. A (30 × 10): x = 5 is on H, on to 95: past the edge. The row placed
  // nothing, so the next starts above H and its gap: y = 5 + 10 + 5 = 20.
  const first = layOutPlaced([part("H", rect(85, 10)), part("A", rect(30, 10))], BED, 5, { H: { x: 5, y: 5, angle: 0 } });
  assert.deepEqual(first.placed.map((p) => [p.id, p.x, p.y]), [["H", 5, 5], ["A", 5, 20]]);
  // H, 85 × 30 at (5, 5): above it and its gap is y = 40, and 40 + 10 > 45: no room.
  const full = layOutPlaced([part("H", rect(85, 30)), part("A", rect(30, 10))], BED, 5, { H: { x: 5, y: 5, angle: 0 } });
  assert.deepEqual(full.placed.map((p) => p.id), ["H"]);
  assert.deepEqual(full.left, [{ id: "A", label: "Sketch A", why: "there is no room left on the bed: make the bed bigger, or turn off another part" }]);
});

test("a hand-placed part is placed wherever it was put, turned as it was turned; one that can't be read is left off in words", () => {
  const parts = [part("A", rect(40, 30)), part("B", { outer: path([0, 0, 1, 1]), holes: [] }), part("C", rect(500, 10)), part("D", { outer: path([0, 0, 1, 1]), holes: [] })];
  const { placed, left } = layOutPlaced(parts, BED, 5, { A: { x: 90, y: -10, angle: 90 }, B: { x: 0, y: 0, angle: 0 } });
  // A turned 90° is 30 × 40, its corner at (90, −10): off the bed, and still placed there (offBed says so).
  assert.deepEqual(placed.map((p) => [p.id, p.x, p.y, p.width, p.height, p.angle, p.by]), [["A", 90, -10, 30, 40, 90, "hand"]]);
  assert.deepEqual(placed[0].outline, { outer: path([120, -10, 120, 30, 90, 30, 90, -10]), holes: [] });
  // B (hand-placed) and D (rows) can't be read; C is bigger than the bed. In the list's order.
  assert.deepEqual(left.map((l) => l.id), ["B", "C", "D"]);
  assert.match(left[0].why, /2 corners/);
  assert.match(left[1].why, /bigger than the bed/);
  // A placement for a part no longer in the design is nothing; "constructor" is no placement.
  assert.deepEqual(layOutPlaced([part("constructor", rect(10, 10))], BED, 5, { gone: { x: 1, y: 1, angle: 0 } }).placed.map((p) => [p.x, p.y, p.by]), [[5, 5, "rows"]]);
});

/** A small seeded generator (mulberry32): the same seed gives the same parts. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded: with nothing placed by hand the layout is the rows' own (sheet.ts layOut), for 300 random lists", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = random(seed);
    const bed = { width: 60 + Math.floor(r() * 300), height: 60 + Math.floor(r() * 300) };
    const gap = Math.floor(r() * 8);
    const parts = Array.from({ length: 1 + Math.floor(r() * 12) }, (_, i) => part(`p${i}`, r() < 0.1 ? { outer: path([0, 0, 1, 1]), holes: [] } : rect(1 + Math.floor(r() * 120), 1 + Math.floor(r() * 120), Math.floor(r() * 50) - 25, Math.floor(r() * 50) - 25)));
    const rows = layOut(parts, bed, gap);
    const laid = layOutPlaced(parts, bed, gap);
    assert.deepEqual(laid.placed.map(({ angle: _a, flip: _f, by: _b, ...p }) => p), rows.placed, `seed ${seed}`);
    assert.deepEqual(laid.left, rows.left, `seed ${seed}`);
  }
});

test("seeded: round hand-placed parts, every row part is on the bed inside the gap and at least the gap from every other box (400 random beds, checked by plain comparisons)", () => {
  let rowsPlaced = 0;
  let stepped = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = random(seed * 7919);
    const bed = { width: 100 + Math.floor(r() * 300), height: 100 + Math.floor(r() * 300) };
    const gap = Math.floor(r() * 6);
    const parts = Array.from({ length: 2 + Math.floor(r() * 12) }, (_, i) => part(`p${i}`, rect(5 + Math.floor(r() * 80), 5 + Math.floor(r() * 80))));
    const placements: Record<string, { x: number; y: number; angle: number }> = {};
    for (const p of parts) if (r() < 0.35) placements[p.id] = { x: Math.floor(r() * bed.width) - 20, y: Math.floor(r() * bed.height) - 20, angle: [0, 90, 180, 270][Math.floor(r() * 4)] };
    const { placed, left } = layOutPlaced(parts, bed, gap, placements);
    assert.equal(placed.length + left.length, parts.length, `seed ${seed}: every part placed or left off`);
    const plain = layOut(parts.filter((p) => !(p.id in placements)), bed, gap);
    for (const p of placed) {
      if (p.by === "hand") {
        assert.deepEqual([p.x, p.y, p.angle], [placements[p.id].x, placements[p.id].y, placements[p.id].angle], `seed ${seed}: ${p.id} where it was put`);
        continue;
      }
      rowsPlaced++;
      const at = plain.placed.find((q) => q.id === p.id);
      if (!at || at.x !== p.x || at.y !== p.y) stepped++;
      assert.ok(p.x >= gap && p.y >= gap && p.x + p.width <= bed.width - gap && p.y + p.height <= bed.height - gap, `seed ${seed}: ${p.id} on the bed inside the gap`);
      for (const q of placed) {
        if (q === p) continue;
        // The clear distance between two boxes, across and up: the gap must hold on at least one of them.
        const across = Math.max(q.x - (p.x + p.width), p.x - (q.x + q.width));
        const up = Math.max(q.y - (p.y + p.height), p.y - (q.y + q.height));
        assert.ok(across >= gap || up >= gap, `seed ${seed}: ${p.id} and ${q.id} are ${across} across and ${up} up apart, under the gap ${gap}`);
      }
    }
  }
  // The test is not empty: thousands of row parts were placed, and hundreds were moved from where plain rows would put them.
  assert.ok(rowsPlaced > 1500, `${rowsPlaced} row parts placed`);
  assert.ok(stepped > 300, `${stepped} row parts stepped round a hand-placed part`);
});

const placedAt = (x: number, y: number, width: number, height: number, by: "hand" | "rows" = "hand", label = "Sketch A"): LaidPart => ({ id: label, label, outline: rect(width, height, x, y), x, y, width, height, angle: 0, flip: false, by });

test("hand-worked: a part past the bed's edge is said so in words, side by side; one on the bed is not", () => {
  assert.equal(offBed(placedAt(0, 0, 100, 50), BED), null); // exactly the bed
  assert.equal(offBedWords(placedAt(5, 5, 20, 20), BED), null);
  // 10 wide from x = 95 on a 100 mm bed: 5 mm past the right side.
  assert.deepEqual(offBed(placedAt(95, 5, 10, 10), BED), { left: 0, right: 5, bottom: 0, top: 0 });
  assert.equal(offBedWords(placedAt(95, 5, 10, 10), BED), "Sketch A is off the bed: 5 mm past the right side.");
  // From (−5, 42), 10 × 10: 5 mm past the left side, and 42 + 10 − 50 = 2 mm past the top.
  assert.equal(offBedWords(placedAt(-5, 42, 10, 10), BED), "Sketch A is off the bed: 5 mm past the left side and 2 mm past the top.");
  assert.equal(offBedWords(placedAt(10, -2.5, 10, 10), BED), "Sketch A is off the bed: 2.5 mm past the bottom.");
  // The edge is known to a nanometre: 0.9 of that past it is still on the bed, 1.1 is off.
  assert.equal(EDGE_SLACK, 1e-6);
  assert.equal(offBed(placedAt(90 + EDGE_SLACK * 0.9, 0, 10, 10), BED), null);
  assert.notEqual(offBed(placedAt(90 + EDGE_SLACK * 1.1, 0, 10, 10), BED), null);
  assert.equal(offBed(placedAt(0, -EDGE_SLACK * 0.9, 10, 10), BED), null);
  assert.notEqual(offBed(placedAt(0, -EDGE_SLACK * 1.1, 10, 10), BED), null);
});

test("boxes overlap only by more than a nanometre both ways; the pairs to ask the kernel about have a hand-placed part", () => {
  const a = placedAt(0, 0, 10, 10);
  assert.equal(boxesOverlap(a, placedAt(5, 5, 10, 10)), true); // 5 × 5 shared
  assert.equal(boxesOverlap(a, placedAt(10, 0, 10, 10)), false); // side by side, touching
  assert.equal(boxesOverlap(a, placedAt(10, 10, 10, 10)), false); // corner to corner
  assert.equal(boxesOverlap(a, placedAt(5, 20, 10, 10)), false); // over each other across, apart up
  assert.equal(boxesOverlap(a, placedAt(10 - EDGE_SLACK * 0.9, 0, 10, 10)), false);
  assert.equal(boxesOverlap(a, placedAt(10 - EDGE_SLACK * 1.1, 0, 10, 10)), true);
  assert.equal(boxesOverlap(a, placedAt(0, 10 - EDGE_SLACK * 0.9, 10, 10)), false);
  assert.equal(boxesOverlap(a, placedAt(0, 10 - EDGE_SLACK * 1.1, 10, 10)), true);
  assert.equal(boxesOverlap(a, placedAt(2, 2, 3, 3)), true); // one inside the other
  // Parts 0 and 2 overlap and 0 is hand-placed; 1 and 3 overlap but are both row parts (the rows never do that; never asked);
  // 2 and 4 overlap, 4 hand-placed.
  const placed = [placedAt(0, 0, 10, 10, "hand"), placedAt(50, 0, 10, 10, "rows"), placedAt(5, 5, 10, 10, "rows"), placedAt(55, 5, 10, 10, "rows"), placedAt(12, 12, 10, 10, "hand")];
  assert.deepEqual(overlapCandidates(placed), [[0, 2], [2, 4]]);
  assert.deepEqual(overlapCandidates([]), []);
});

test("hand-worked: a dragged part snaps to whole millimetres; numbers are cleaned of dust below a nanometre", () => {
  assert.deepEqual([12.4, 12.5, -0.4, -12.6, 0].map((v) => snapMm(v)), [12, 13, 0, -13, 0]);
  assert.equal(Object.is(snapMm(-0.4), 0), true); // never −0
  assert.deepEqual([12.3, 12.2, 0.74].map((v) => snapMm(v, 0.5)), [12.5, 12, 0.5]);
  assert.equal(snapMm(12.3456789, 0), 12.345679); // no step: only cleaned
  assert.equal(cleanMm(0.1 + 0.2), 0.3);
  assert.equal(Object.is(cleanMm(-1e-9), 0), true);
});

test("PlacedPart from the rows and LaidPart are the same shape plus the angle and who placed it", () => {
  const rows: PlacedPart = layOut([part("A", rect(10, 10))], BED, 5).placed[0];
  const laid = layOutPlaced([part("A", rect(10, 10))], BED, 5).placed[0];
  assert.deepEqual(laid, { ...rows, angle: 0, flip: false, by: "rows" });
});

test("hand-worked: pairs are worth asking about when their boxes overlap or come within the margin given, and one of the two was placed by hand", () => {
  const laid = (x: number, y: number, w: number, h: number, by: "hand" | "rows"): LaidPart => ({ id: `${x},${y}`, label: "p", outline: { outer: { path: { corners: [], bulges: [] } }, holes: [] }, x, y, width: w, height: h, angle: 0, flip: false, by });
  // A 10 × 10 at the origin placed by hand; one touching its right side; one 5 away; a row part over it; two row parts over each other.
  const parts = [laid(0, 0, 10, 10, "hand"), laid(10, 0, 10, 10, "rows"), laid(15, 0, 10, 10, "rows"), laid(5, 5, 10, 10, "rows")];
  // Overlap only: part 0 with part 3 (5 × 5 shared). Parts 1, 2 and 3 overlap each other but are all row parts.
  assert.deepEqual(overlapCandidates(parts), [[0, 3]]);
  // Within 0.002 mm: the touching one (gap 0) counts too; the one 5 away still not.
  assert.deepEqual(overlapCandidates(parts, 0.002), [[0, 1], [0, 3]]);
  // The margin's own line: a gap of 0.9 × 0.002 counts, 1.1 × 0.002 does not (across, and up).
  for (const [gap, counts] of [[0.0018, true], [0.0022, false]] as const) {
    assert.equal(overlapCandidates([parts[0], laid(10 + gap, 0, 10, 10, "rows")], 0.002).length === 1, counts, `across, ${gap}`);
    assert.equal(overlapCandidates([parts[0], laid(0, 10 + gap, 10, 10, "rows")], 0.002).length === 1, counts, `up, ${gap}`);
    assert.equal(overlapCandidates([parts[0], laid(10 + gap, 10 + gap, 10, 10, "rows")], 0.002).length === 1, counts, `corner to corner, ${gap}`);
  }
});

// Mirrors (L1b4): a sketch seen from behind its plane, and Flip.

/** Twice the signed area of a path loop's corners (shoelace): positive when it goes round counter-clockwise. */
const turning = (l: Loop) => {
  if ("circle" in l) return 0;
  const c = l.path.corners;
  let s = 0;
  for (let i = 0; i < c.length; i += 2) s += c[i] * c[(i + 3) % c.length] - c[(i + 2) % c.length] * c[i + 1];
  return s;
};

test("hand-worked: a D mirrored left to right bulges to the left, keeps going round counter-clockwise, and its arc stays a half circle", () => {
  // The D: the square (0,0) (10,0) (10,10) (0,10), its right side a half circle (bulge 1, radius 5) out to x = 15.
  const d: Outline = { outer: path([0, 0, 10, 0, 10, 10, 0, 10], [0, 1, 0, 0]), holes: [{ circle: { center: [4, 5], radius: 2 } }] };
  const m = mirrorOutline(d, FLIP);
  // x → −x: (0,0) (−10,0) (−10,10) (0,10), clockwise now, so written backwards: (0,0) (0,10) (−10,10) (−10,0). The half
  // circle is now the piece from (−10,10) down to (−10,0); a mirror turns its way round (−1) and going it backwards turns
  // it again (+1): bulge 1, counter-clockwise going down, which lies to the west, out to x = −15.
  assert.deepEqual(m.outer, path([0, 0, 0, 10, -10, 10, -10, 0], [0, 0, 1, 0]));
  assert.deepEqual(m.holes, [{ circle: { center: [-4, 5], radius: 2 } }]);
  assert.deepEqual(outlineBox(m), { minX: -15, minY: 0, maxX: 0, maxY: 10 });
  assert.ok(turning(m.outer) > 0, "still counter-clockwise");
  // Top to bottom (a bottom face): y → −y, the half circle on the right still, the box upside down.
  assert.deepEqual(outlineBox(mirrorOutline(d, { right: 1, up: -1 })), { minX: 0, minY: -10, maxX: 15, maxY: 0 });
  // No mirror at all is the outline itself.
  assert.equal(mirrorOutline(d, { right: 1, up: 1 }) === d, true);
});

test("seeded: a mirror twice is the outline back, every loop keeps its way round, and the box is the box mirrored (300 random outlines)", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = random(seed);
    const n = 3 + Math.floor(r() * 6);
    // A star-shaped loop round (cx, cy), counter-clockwise, with small bulges, and a clockwise hole near its middle.
    const [cx, cy] = [Math.floor(r() * 200) - 100, Math.floor(r() * 200) - 100];
    const corners: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const rad = 20 + Math.floor(r() * 20);
      corners.push(cx + Math.round(rad * Math.cos(a)), cy + Math.round(rad * Math.sin(a)));
    }
    const bulges = Array.from({ length: n }, () => (r() < 0.5 ? 0 : Math.round((r() * 0.6 - 0.3) * 1000) / 1000));
    const outline: Outline = { outer: path(corners, bulges), holes: [path([cx - 2, cy - 2, cx - 2, cy + 2, cx + 2, cy + 2, cx + 2, cy - 2])] };
    let box;
    try {
      box = outlineBox(outline);
    } catch {
      continue; // a corner landed twice on one point: not an outline
    }
    for (const m of [FLIP, { right: 1, up: -1 } as const, { right: -1, up: -1 } as const]) {
      const once = mirrorOutline(outline, m);
      assert.ok(turning(once.outer) > 0 && turning(once.holes[0]) < 0, `seed ${seed}: ways round kept`);
      const b = outlineBox(once);
      const want = { minX: m.right === 1 ? box.minX : -box.maxX, maxX: m.right === 1 ? box.maxX : -box.minX, minY: m.up === 1 ? box.minY : -box.maxY, maxY: m.up === 1 ? box.maxY : -box.minY };
      for (const k of ["minX", "maxX", "minY", "maxY"] as const) near(b[k], want[k], `seed ${seed} ${k}`, 2e-6);
      // Twice: the same corners and bulges, perhaps starting at another corner (a loop has no first corner).
      const twice = mirrorOutline(once, m);
      const key = (l: Loop) => ("circle" in l ? "" : [...Array(l.path.corners.length / 2).keys()].map((i) => `${l.path.corners[2 * i]},${l.path.corners[2 * i + 1]},${l.path.bulges[i] ?? 0}`).sort().join(" "));
      assert.equal(key(twice.outer), key(outline.outer), `seed ${seed}: twice is back`);
    }
  }
});

test("hand-worked: Flip mirrors a part on the spot; a turned part's angle goes to minus itself; flipping twice is where it started", () => {
  // A 30 × 10 L-ish step: (0,0) (30,0) (30,10) (10,10) (10,5) (0,5)... kept simple: a right triangle (0,0) (30,0) (0,10).
  const tri: Outline = { outer: path([0, 0, 30, 0, 0, 10]), holes: [] };
  // Sitting at (5, 5) unturned, box 30 × 10: flipped about its middle (20, 10) it keeps the box and puts its right angle
  // on the right: placed it is (35,5) (5,5) (35,15) in some order.
  const at = flippedOnTheSpot(tri, { x: 5, y: 5, width: 30, height: 10, angle: 0, flip: false });
  assert.deepEqual(at, { x: 5, y: 5, angle: 0, flip: true });
  assert.deepEqual(new Set(placeOutline(tri, at).outline.outer.path.corners.join(",").match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g)), new Set(["35,5", "5,5", "35,15"]));
  // Turned 90 (box 10 × 30 at (5, 5)), then flipped: mirror then turn −90 (M·R(90) = R(−90)·M), the same box.
  const turned = flippedOnTheSpot(tri, { x: 5, y: 5, width: 10, height: 30, angle: 90, flip: false });
  assert.deepEqual(turned, { x: 5, y: 5, angle: 270, flip: true });
  // What Flip makes of a turned part is the turned part seen in a mirror across its box's middle line x = 10: the turned
  // triangle is (15,5) (15,35) (5,5); mirrored about x = 10: (5,5) (5,35) (15,5).
  assert.deepEqual(new Set(placeOutline(tri, turned).outline.outer.path.corners.join(",").match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g)), new Set(["5,5", "5,35", "15,5"]));
  // Twice: back to unflipped at the same angle.
  assert.deepEqual(flippedOnTheSpot(tri, { x: 5, y: 5, width: 10, height: 30, angle: 270, flip: true }), { x: 5, y: 5, angle: 90 });
});

test("a flip a project holds is kept only as true; anything else is no flip", () => {
  assert.deepEqual(readPlacements({ a: { x: 1, y: 2, angle: 0, flip: true }, b: { x: 1, y: 2, flip: "yes" }, c: { x: 1, y: 2, flip: false } }), { a: { x: 1, y: 2, angle: 0, flip: true }, b: { x: 1, y: 2, angle: 0 }, c: { x: 1, y: 2, angle: 0 } });
  const laid = layOutPlaced([part("a", rect(10, 10)), part("b", rect(10, 10))], BED, 5, { a: { x: 50, y: 20, angle: 0, flip: true } });
  assert.deepEqual(laid.placed.map((p) => [p.id, p.flip, p.by]), [["a", true, "hand"], ["b", false, "rows"]]);
});
