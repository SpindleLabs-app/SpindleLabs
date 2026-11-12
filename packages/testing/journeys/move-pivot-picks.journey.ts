// Timeline and rebuild bug hunt (2026-11-11, E1) regressions: an edited Move's pivot after "Centre of the bodies",
// when a body is then clicked in or out, or the design builds again with the panel open. The pivot follows the
// bodies where they were just BEFORE the edited Move (move-tool.ts `heldBefore`), never where the view shows them
// (after it and every later Move). The 2026-11-01 hunt fixed the button itself (move-hunt.journey.ts); these are
// the other doors to the same mistake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyReference, insertMove, insertPreset, NO_MOVE, partDocument, type MoveValues } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
type Box3 = [number[], number[]];
const meshBox = (positions: readonly number[]): Box3 => [
  [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k))),
  [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k))),
];
// The view's mesh is float32: 1e-5 mm is its rounding at these sizes, as in move-hunt.journey.ts.
const near = (a: App, want: Box3, what: string) => {
  const got = meshBox(a.mesh()!.positions);
  got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-5, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
};
const pivot = (a: App) => ["X", "Y", "Z"].map((k) => (a.$(`#move-pivot${k}`) as HTMLInputElement).value);
const press = async (a: App, sel: string) => {
  (a.$(sel) as HTMLButtonElement).click();
  await a.settle();
};
/** A click on the body in the view: the first face of the `n`th body shown (a box has six, joined in order), as the viewport hands it over. */
const clickBody = (a: App, n: number) => a.pick({ face: 6 * n });

/**
 * Box 1 40 × 30 × 20 at x 0..40, y 0..30, z 0..20: centre (20, 15, 10).
 * Rotate 1: Box 1 90° about Z through (20, 15, 10): (x, y) → (20 − (y − 15), 15 + (x − 20)), so x 5..35, y −5..35.
 * Move 1: Box 1 100 mm along X: x 105..135, y −5..35. That is where the view shows it: centre (120, 15, 10).
 */
function turnedThenShifted() {
  const r = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], v({ turnZ: 90, pivotX: 20, pivotY: 15, pivotZ: 10 }), "rotate");
  return { doc: insertMove(r.doc, ["body:feature-1"], v({ x: 100 })).doc, rotate: r.id };
}

test("Edit Rotate 1, Centre of the bodies, the box clicked out and in again: the pivot is still its centre before Rotate 1, and OK leaves the box where it was", async () => {
  const { doc, rotate } = turnedThenShifted();
  const a = await app(doc);
  near(a, [[105, -5, 0], [135, 35, 20]], "as built");
  await a.doubleClick(rotate);
  await press(a, "#move-pivot-centre");
  assert.deepEqual(pivot(a), ["20", "15", "10"], "Centre of the bodies: Box 1 before Rotate 1 is 0..40 × 0..30 × 0..20");
  await clickBody(a, 0); // out of the Rotate
  assert.doesNotMatch(a.$("#move-bodies")!.textContent, /Box 1/, "the box is out of the Rotate");
  await clickBody(a, 0); // and in again
  assert.match(a.$("#move-bodies")!.textContent, /Box 1/);
  // By hand: nothing about Box 1 before Rotate 1 changed, so its centre is (20, 15, 10) still.
  // The mistake read the view's box (105..135, −5..35, 0..20) and gave (120, 15, 10).
  assert.deepEqual(pivot(a), ["20", "15", "10"], "the centre of Box 1 before Rotate 1, whatever was clicked");
  await press(a, "#move-ok");
  // The same turn about the same point, then the same shift: x 105..135, y −5..35.
  // (About (120, 15, 10) it would be (x, y) → (120 − (y − 15), 15 + (x − 120)) then +100: x 205..235, y −105..−65.)
  near(a, [[105, -5, 0], [135, 35, 20]], "after OK");
  assert.ok(await a.close());
});

/**
 * Box 1 as above and Box 2, a 10 mm cube, with a Move before Rotate 1 and one after it, so neither body is shown where
 * it was before Rotate 1:
 *   Move 1: Box 2 60 mm along X: x 60..70, y 0..10, z 0..10.
 *   Rotate 1: Box 1 90° about Z through (20, 15, 10).   Move 2: Box 1 100 mm along X.   Move 3: Box 2 50 mm along Y.
 * Just before Rotate 1: Box 1 at 0..40 × 0..30 × 0..20, Box 2 at 60..70 × 0..10 × 0..10. The box round both is
 * 0..70 × 0..30 × 0..20: centre (35, 15, 10).
 * The view shows Box 1 at 105..135 × −5..35 and Box 2 at 60..70 × 50..60: the box round those is 60..135 × −5..60,
 * centre (97.5, 27.5, 10), which is what the mistake gave.
 */
function twoBodies() {
  const two = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10);
  const m1 = insertMove(two.doc, ["body:feature-2"], v({ x: 60 }));
  const r = insertMove(m1.doc, ["body:feature-1"], v({ turnZ: 90, pivotX: 20, pivotY: 15, pivotZ: 10 }), "rotate");
  const m2 = insertMove(r.doc, ["body:feature-1"], v({ x: 100 }));
  return { doc: insertMove(m2.doc, ["body:feature-2"], v({ y: 50 })).doc, rotate: r.id };
}

test("Edit Rotate 1, Centre of the bodies, a second body clicked in: the pivot is the centre of the two bodies as they were just before Rotate 1", async () => {
  const { doc, rotate } = twoBodies();
  const a = await app(doc);
  near(a, [[60, -5, 0], [135, 60, 20]], "as built");
  await a.doubleClick(rotate);
  await press(a, "#move-pivot-centre");
  assert.deepEqual(pivot(a), ["20", "15", "10"], "Box 1 alone");
  await clickBody(a, 1); // Box 2 into Rotate 1
  assert.match(a.$("#move-bodies")!.textContent, /Box 1.*Box 2/);
  // (0 + 70) / 2, (0 + 30) / 2, (0 + 20) / 2: worked above.
  assert.deepEqual(pivot(a), ["35", "15", "10"], "the box round Box 1 (0..40) and Box 2 (60..70) before Rotate 1");
  await press(a, "#move-ok");
  assert.equal(a.$("#move-panel")!.hidden, true, `OK took it: ${a.$("#move-error")!.textContent}`);
  // Rotate 1 now turns both 90° about Z through (35, 15, 10): (x, y) → (35 − (y − 15), 15 + (x − 35)).
  //   Box 1 (x 0..40, y 0..30): x 20..50, y −20..20; Move 2 (+100 X): x 120..150, y −20..20.
  //   Box 2 (x 60..70, y 0..10): x 40..50, y 40..50; Move 3 (+50 Y): x 40..50, y 90..100.
  // The box round both: x 40..150, y −20..100, z 0..20.
  near(a, [[40, -20, 0], [150, 100, 20]], "after OK");
  assert.ok(await a.close());
});

test("Edit Rotate 1, Centre of the bodies, then the design builds again with the panel open: the pivot stays the centre before Rotate 1", async () => {
  const { doc, rotate } = turnedThenShifted();
  const a = await app(doc);
  await a.doubleClick(rotate);
  await press(a, "#move-pivot-centre");
  assert.deepEqual(pivot(a), ["20", "15", "10"]);
  // The XY plane's eye in the browser: a recorded step, shown through the rebuild, that leaves the Move open with its bodies.
  const before = a.doc();
  const eye = [...a.window.document.querySelectorAll<HTMLElement>("[data-eye]")].find((e) => e.dataset.eye === "origin-xy");
  assert.ok(eye, "the XY plane's eye");
  eye.click();
  await a.settle();
  assert.notEqual(a.doc(), before, "the eye recorded a step");
  assert.equal(a.$("#move-panel")!.hidden, false, "the Move is still open");
  // Box 1 before Rotate 1 has not changed: (20, 15, 10). The mistake read the view again: (120, 15, 10).
  assert.deepEqual(pivot(a), ["20", "15", "10"], "the centre of Box 1 before Rotate 1, after the design was shown again");
  await press(a, "#move-ok");
  near(a, [[105, -5, 0], [135, 35, 20]], "after OK");
  assert.ok(await a.close());
});

test("control: a new Rotate's pivot follows its bodies where the view shows them, as before", async () => {
  // Not yet in the timeline, a new Rotate comes after every Move there is, so its bodies are where the view shows them.
  const { doc } = twoBodies();
  const a = await app(doc);
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("rotate-tool");
  // Box 1 shown at 105..135 × −5..35 × 0..20: centre (120, 15, 10).
  assert.deepEqual(pivot(a), ["120", "15", "10"]);
  await clickBody(a, 1);
  // With Box 2 shown at 60..70 × 50..60 × 0..10: the box round both is 60..135 × −5..60 × 0..20, centre (97.5, 27.5, 10).
  assert.deepEqual(pivot(a), ["97.5", "27.5", "10"]);
  await clickBody(a, 1);
  assert.deepEqual(pivot(a), ["120", "15", "10"]);
  await press(a, "#move-cancel");
  assert.ok(await a.close());
});
