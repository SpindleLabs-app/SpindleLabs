// The bed and its layout (sheet.ts), worked by hand. Bed 100 × 50 mm, gap 5 mm throughout unless said.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Loop, Outline } from "@fission/core";
import { bedRefusal, layOut, moveOutline, outlineBox, sheetSvg, type SheetPart } from "../src/sheet.ts";

const path = (corners: number[], bulges: number[] = []): Loop => ({ path: { corners, bulges } });
const rect = (x0: number, y0: number, x1: number, y1: number): Outline => ({ outer: path([x0, y0, x1, y0, x1, y1, x0, y1]), holes: [] });
const part = (id: string, outline: Outline): SheetPart => ({ id, label: `Sketch ${id}`, outline });
const BED = { width: 100, height: 50 };

test("hand-worked: rows from the lower-left corner, gap 5; a part with no room left and one bigger than the bed are left off in words", () => {
  const a = part("A", rect(10, 10, 70, 50)); // 60 × 40
  const b = part("B", { outer: { circle: { center: [0, 0], radius: 10 } }, holes: [] }); // 20 × 20, box from (−10, −10)
  const c = part("C", rect(0, 0, 30, 10)); // 30 × 10
  const d = part("D", rect(0, 0, 120, 10)); // 120 wide: the bed less two gaps is 90
  const { placed, left } = layOut([a, b, c, d], BED, 5);
  // A at (5, 5): moved by (5 − 10, 5 − 10) = (−5, −5), so its corners are (5,5) (65,5) (65,45) (5,45). Next x = 5 + 60 + 5 = 70.
  assert.deepEqual(placed[0].outline, rect(5, 5, 65, 45));
  assert.deepEqual([placed[0].x, placed[0].y, placed[0].width, placed[0].height], [5, 5, 60, 40]);
  // B at (70, 5): 70 + 20 = 90 ≤ 95, moved by (70 − (−10), 5 − (−10)) = (80, 15): its centre is (80, 15). Next x = 95.
  assert.deepEqual(placed[1].outline, { outer: { circle: { center: [80, 15], radius: 10 } }, holes: [] });
  // C: 95 + 30 > 95, so a new row at y = 5 + 40 + 5 = 50; 50 + 10 > 45: no room.
  assert.equal(placed.length, 2);
  assert.deepEqual(left.map((l) => l.id), ["C", "D"]);
  assert.match(left[0].why, /no room left on the bed/);
  assert.equal(left[1].why, "it is 120 × 10 mm, bigger than the bed (100 × 50 mm, 5 mm in from each edge)");
});

test("a part exactly the bed less its two gaps fits; 0.001 mm more does not (the edge is exact, no tolerance)", () => {
  assert.equal(layOut([part("A", rect(0, 0, 90, 40))], BED, 5).placed.length, 1);
  assert.equal(layOut([part("A", rect(0, 0, 90.001, 40))], BED, 5).left.length, 1);
  assert.equal(layOut([part("A", rect(0, 0, 90, 40.001))], BED, 5).left.length, 1);
});

test("the gap holds at the right edge too: a part that would end inside it starts a new row", () => {
  // Bed 100 × 100, gap 5: after a 60-wide part the next x is 70. A 25-wide one ends at 95, on the gap's line: it stays.
  // A 28-wide one would end at 98, inside the last 5 mm: it goes up a row, to (5, 5 + 10 + 5) = (5, 20).
  const bed = { width: 100, height: 100 };
  assert.deepEqual(layOut([part("A", rect(0, 0, 60, 10)), part("B", rect(0, 0, 25, 10))], bed, 5).placed.map((p) => [p.x, p.y]), [[5, 5], [70, 5]]);
  assert.deepEqual(layOut([part("A", rect(0, 0, 60, 10)), part("B", rect(0, 0, 28, 10))], bed, 5).placed.map((p) => [p.x, p.y]), [[5, 5], [5, 20]]);
});

test("a second row starts above the tallest part of the first", () => {
  // 40 × 10 then 40 × 20: x 5 → 50 → 95; the third, 40 × 5, starts a row at y = 5 + 20 + 5 = 30.
  const bed = { width: 100, height: 100 };
  const { placed } = layOut([part("A", rect(0, 0, 40, 10)), part("B", rect(0, 0, 40, 20)), part("C", rect(0, 0, 40, 5))], bed, 5);
  assert.deepEqual(placed.map((p) => [p.x, p.y]), [[5, 5], [50, 5], [5, 30]]);
});

test("moving keeps arcs exact: corners and centres shift, bulges and radii are the same numbers", () => {
  const slot: Outline = { outer: path([10, 0, 50, 0, 50, 20, 10, 20], [0, 1, 0, 1]), holes: [{ circle: { center: [30, 10], radius: 4 } }] };
  const moved = moveOutline(slot, 2.5, -1);
  assert.deepEqual(moved, { outer: path([12.5, -1, 52.5, -1, 52.5, 19, 12.5, 19], [0, 1, 0, 1]), holes: [{ circle: { center: [32.5, 9], radius: 4 } }] });
  // The slot's half-circle ends reach x = 0 and 60 (radius 10 round (10,10) and (50,10)), so its box is 0..60 × 0..20.
  assert.deepEqual(outlineBox(slot), { minX: 0, minY: 0, maxX: 60, maxY: 20 });
});

test("a malformed outline is left off in words, never placed", () => {
  const { placed, left } = layOut([part("A", { outer: path([0, 0, 1, 1]), holes: [] })], BED, 5);
  assert.equal(placed.length, 0);
  assert.match(left[0].why, /enclose nothing/);
});

test("bed numbers that can't be used are refused in words; good ones pass", () => {
  assert.equal(bedRefusal(BED, 5), null);
  assert.equal(bedRefusal(BED, 0), null);
  assert.match(bedRefusal({ width: 0, height: 50 }, 5)!, /width must be a number of mm above 0/);
  assert.match(bedRefusal({ width: 100, height: Number.NaN }, 5)!, /height/);
  assert.match(bedRefusal({ width: 3001, height: 50 }, 5)!, /at most 3000/);
  assert.equal(bedRefusal({ width: 3000, height: 50 }, 5), null);
  assert.match(bedRefusal(BED, -1)!, /0 mm or more/);
  // Two gaps of 25 fill the 50 mm side: nothing fits. 24.9 leaves 0.2 mm.
  assert.match(bedRefusal(BED, 25)!, /too big for the bed/);
  assert.equal(bedRefusal(BED, 24.9), null);
});

test("hand-worked: the sheet's SVG is the bed's size in mm, y flipped, one closed path per part with its name", () => {
  const { placed } = layOut([part("A", rect(10, 10, 70, 50)), part("B", { outer: { circle: { center: [0, 0], radius: 10 } }, holes: [] })], BED, 5);
  const svg = sheetSvg({ placed, left: [] }, BED, "Box & lid");
  // The page is the bed: 100 × 50 mm, model y 0..50 written as −50..0, so the viewBox starts at (0, −50).
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="100mm" height="50mm" viewBox="0 -50 100 50">\n<title>Box &amp; lid<\/title>\n/);
  // A's corners (5,5) (65,5) (65,45) (5,45) with y flipped.
  // Every part is cut when nothing says otherwise: one group, "cut", a red hairline with nothing filled.
  assert.match(svg, /<g id="cut"><title>Cut<\/title>\n<path id="part-A" d="M5 -5L65 -5L65 -45L5 -45Z" fill-rule="evenodd" fill="none" stroke="#f00" stroke-width="0.1" vector-effect="non-scaling-stroke"><title>Sketch A<\/title><\/path>/);
  // B, the circle round (80, 15) of radius 10: four quarter arcs counter-clockwise from its east point (90, 15).
  assert.match(svg, /d="M90 -15A10 10 0 0 0 80 -25A10 10 0 0 0 70 -15A10 10 0 0 0 80 -5A10 10 0 0 0 90 -15Z"/);
  assert.equal((svg.match(/<path /g) ?? []).length, 2);
});

test("hand-worked: layers in the SVG: engrave filled black first, then score in blue, then cut in red, a group each, an empty one left out", () => {
  // Three 10 × 10 squares in one row, gap 5: A at x 5..15, B at 20..30, C at 35..45, all y 5..15 (y flipped: −5..−15).
  const { placed } = layOut([part("A", rect(0, 0, 10, 10)), part("B", rect(0, 0, 10, 10)), part("C", rect(0, 0, 10, 10))], BED, 5);
  const svg = sheetSvg({ placed, left: [] }, BED, "Tag", { A: "cut", B: "engrave", C: "score" });
  const groups = [...svg.matchAll(/<g id="(\w+)">/g)].map((m) => m[1]);
  // The beam's order: nothing is cut loose before what lies on it is done.
  assert.deepEqual(groups, ["engrave", "score", "cut"]);
  assert.match(svg, /<g id="engrave"><title>Engrave<\/title>\n<path id="part-B" d="M20 -5L30 -5L30 -15L20 -15Z" fill-rule="evenodd" fill="#000" stroke="none"><title>Sketch B<\/title><\/path>\n<\/g>/);
  assert.match(svg, /<g id="score"><title>Score<\/title>\n<path id="part-C" d="M35 -5L45 -5L45 -15L35 -15Z" fill-rule="evenodd" fill="none" stroke="#00f" [^>]*><title>Sketch C<\/title><\/path>\n<\/g>/);
  assert.match(svg, /<g id="cut"><title>Cut<\/title>\n<path id="part-A" [^>]*stroke="#f00" [^>]*>/);
  // Only engraving: one group, no empty score or cut groups.
  const only = sheetSvg({ placed: placed.slice(1, 2), left: [] }, BED, "Tag", { B: "engrave" });
  assert.deepEqual([...only.matchAll(/<g id="(\w+)">/g)].map((m) => m[1]), ["engrave"]);
  // A part's layer is found by its id: an entry for a part not on the bed changes nothing.
  assert.equal(sheetSvg({ placed, left: [] }, BED, "Tag", { Z: "engrave" }), sheetSvg({ placed, left: [] }, BED, "Tag"));
});
