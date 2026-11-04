// A circle's diameter typed while drawing (sketch feel SF4, the circle's
// box): once the centre is down a Diameter box follows the pointer with
// twice the distance to it; a typed diameter locks the radius to exactly
// half (the pointer only shows where), refuses a diameter whose radius
// would be under the smallest piece (0.9× and 1.1× of it), and never stays
// on the tool once the circle is drawn or the box is cleared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../src/document.ts";
import { addSketch } from "../src/sketch.ts";
import { clickAt, startTool, SMALL_CIRCLE, type CircleTool } from "../src/sketch-tool.ts";
import { aimOf, anchorOf, liveValues, MIN_TYPED, readDiameter, typedFields, withLocks } from "../src/typed-entry.ts";
import { FIELD_LABELS, typedBoxes } from "../src/typed-boxes.ts";

function fresh() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return { doc: s.doc, id: s.id, tool: startTool("circle", s.id) as CircleTool };
}
const circles = (doc: ReturnType<typeof fresh>["doc"]) => doc.sketches[0].curves.filter((c) => c.kind === "circle");

test("hand-worked: centre (30, 30), diameter typed 25 with the pointer at (40, 31): the radius is exactly 12.5", () => {
  const { doc, tool } = fresh();
  const c = clickAt(doc, tool, [30, 30]);
  assert.deepEqual(typedFields(c.tool), ["diameter"]);
  assert.deepEqual(anchorOf(c.doc, c.tool), [30, 30]);
  // Live: the pointer is √(10² + 1²) = √101 from the centre, so the diameter shown is 2√101 = 20.0997…
  assert.equal(liveValues([30, 30], [40, 31], c.tool).diameter, 2 * Math.sqrt(101));
  const locks = { diameter: 25 };
  // The rim point the preview draws: 12.5 along the pointer's way, (10, 1)·12.5/√101 from the centre.
  const aim = aimOf(c.doc, c.tool, [40, 31], locks)!;
  assert.ok(Math.abs(Math.hypot(aim[0] - 30, aim[1] - 30) - 12.5) < 1e-12);
  // The click: the radius is 25 / 2 = 12.5.
  const drawn = clickAt(c.doc, withLocks(c.tool, locks, [40, 31]), aim);
  assert.equal(drawn.drew, true);
  assert.equal((circles(drawn.doc)[0] as { radius: number }).radius, 12.5);
  // The tool goes back to wanting a centre and keeps no radius.
  assert.deepEqual(drawn.tool, { kind: "circle", sketch: c.tool.sketch, centre: null });
});

test("a typed diameter is exact intent: centre (30.1, 29.7), 25 and 0.3 typed, radii exactly 12.5 and 0.15, where the rim point's own distance rounds off", () => {
  for (const [D, r] of [[25, 12.5], [0.3, 0.15]]) {
    const { doc, tool } = fresh();
    const c = clickAt(doc, tool, [30.1, 29.7]);
    const aim = aimOf(c.doc, c.tool, [40, 31], { diameter: D })!;
    // The rim point's coordinates are rounded, so its distance from the centre is a few ulps off D / 2
    // (12.499999999999996 and 0.14999999999999922): the radius must not be measured from it.
    assert.notEqual(Math.sqrt((aim[0] - 30.1) ** 2 + (aim[1] - 29.7) ** 2), r);
    const drawn = clickAt(c.doc, withLocks(c.tool, { diameter: D }, [40, 31]), aim);
    // Halving a double is exact: 25 / 2 is 12.5 and 0.3 / 2 is the double nearest 0.15.
    assert.equal((circles(drawn.doc)[0] as { radius: number }).radius, r);
  }
});

test("no diameter typed: the click's distance is the radius, as before", () => {
  const { doc, tool } = fresh();
  const c = clickAt(doc, tool, [0, 0]);
  assert.deepEqual(withLocks(c.tool, {}, [3, 4]), c.tool);
  // 3-4-5: the click at (3, 4) is 5 from the centre.
  const drawn = clickAt(c.doc, withLocks(c.tool, {}, [3, 4]), aimOf(c.doc, c.tool, [3, 4], {})!);
  assert.equal((circles(drawn.doc)[0] as { radius: number }).radius, 5);
});

test("the smallest diameter at 0.9× and 1.1× of twice the smallest piece: 0.0018 is refused in the box, 0.0022 draws", () => {
  assert.equal(MIN_TYPED, 1e-3);
  assert.match((readDiameter("0.0018") as { error: string }).error, /diameter must be at least 0.002 mm/);
  assert.equal((readDiameter("0.0022") as { value: number }).value, 0.0022);
  assert.equal((readDiameter("25 mm") as { value: number }).value, 25);
  assert.match((readDiameter("abc") as { error: string }).error, /isn't a length/);
  assert.match((readDiameter("1100000") as { error: string }).error, /at most 1000000 mm/, "the largest size as for a length");
  const { doc, tool } = fresh();
  const c = clickAt(doc, tool, [0, 0]);
  const ok = clickAt(c.doc, withLocks(c.tool, { diameter: 0.0022 }, [5, 0]), aimOf(c.doc, c.tool, [5, 0], { diameter: 0.0022 })!);
  assert.equal(ok.drew, true);
  assert.equal((circles(ok.doc)[0] as { radius: number }).radius, 0.0011);
  // Past the box (as an AI or a test could): the click still refuses a radius under the smallest piece, and the tool keeps no radius.
  const small = clickAt(c.doc, withLocks(c.tool, { diameter: 0.0018 }, [5, 0]), [0.0009, 0]);
  assert.equal(small.drew, false);
  assert.equal(small.note, SMALL_CIRCLE);
  assert.equal("radius" in small.tool, false, "a refused click doesn't leave the typed radius on the tool");
});

const { Window } = await import("happy-dom");

test("the Diameter box in a real DOM: its label and unit, a bad size red with its reason", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const boxes = typedBoxes(host, { locks: () => {}, enter() {}, escape() {} });
  boxes.show(["diameter"], { diameter: 20 }, 10, 10);
  assert.equal(FIELD_LABELS.diameter, "Diameter");
  const input = doc.getElementById("typed-diameter") as HTMLInputElement;
  assert.equal(input.getAttribute("aria-label"), "Diameter (mm)");
  assert.equal(input.placeholder, "20");
  boxes.start("0.001");
  assert.match(doc.querySelector("label[data-field=diameter] .typed-entry-error")!.textContent!, /at least 0.002 mm/);
  assert.deepEqual(boxes.locks, {});
  input.value = "12";
  input.dispatchEvent(new window.Event("input") as unknown as Event);
  assert.deepEqual(boxes.locks, { diameter: 12 });
});
