// A sketch's snapped points and the Moves around it (timeline hunt 2026-11-11, #540): a sketch edited
// before a Move offers the bodies as they are at its own place in the timeline (item 1), and a Move
// before it that is suppressed is suppressed for its pins too (item 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, BodyCache, designWorkspace, insertMove, NO_MOVE, partDocument, rebuildTimeline, settleKept } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const snapShown = (a: App) => a.drawings().find((d) => d.editing)?.editing?.snap?.label ?? "";
/** The box round the bodies as drawn, lo x y z then hi x y z. */
const drawnBox = (a: App) => {
  const p = a.mesh()!.positions;
  return [0, 1, 2, 0, 1, 2].map((k, i) => (i < 3 ? Math.min : Math.max)(...p.filter((_, j) => j % 3 === k)));
};

/** Box 1 40 × 30 × 20, an empty Sketch 1 on XY, then Move 1 shifting the box x +50: Box 1, Sketch 1, Move 1 in the timeline. */
async function sketchBeforeMove() {
  const s = addSketch(partDocument("box", 40, 30, 20), "XY");
  const a = await app(insertMove(s.doc, ["body:feature-1"], { ...NO_MOVE, x: 50 }).doc, designWorkspace);
  return { a, sketch: s.id };
}

/** The centre of the first circle of sketch `id` as recorded. */
const centre = (a: App, id: string) => {
  const s = a.doc().sketches.find((x) => x.id === id)!;
  const c = s.curves.find((x) => x.kind === "circle") as { centre: string };
  const p = s.points.find((x) => x.id === c.centre)!;
  return [p.x, p.y];
};

test("with the Move before it suppressed, a click in a sketch leaves its snapped point on the corner (#540 item 2)", async () => {
  // Box 1 40 × 30 × 20; Move 1 shifts it x +50 (x 50..90); Sketch 1 on XY: a circle r 3 snapped to the corner (90, 30); Extrude 1 by 5.
  const doc = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 50 }).doc;
  const a = await app(doc);
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  await a.key("sketch-circle");
  await a.click(89.7, 29.8);
  await a.click(93, 30);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  if (a.sketching()) await a.finish();
  const [, move, sketch] = a.doc().timeline.features.map((f) => f.id);
  // By hand: the corner of the moved box is (40 + 50, 30) = (90, 30).
  assert.deepEqual(centre(a, sketch), [90, 30], "snapped to the moved corner");
  assert.equal(await a.menu(move, "suppress"), null);
  // Move 1 off: the box is back at x 0..40, its corner at (40, 30); the pinned centre follows it there.
  assert.deepEqual(centre(a, sketch), [40, 30], "the circle follows the corner back");
  // The recorded design is settled: settling it again changes nothing (the centre stays at the corner as drawn, (40, 30)).
  const cache = new BodyCache(kernel);
  const settled = await settleKept(kernel, a.doc(), a.doc(), cache);
  await cache.close();
  const sp = settled.sketches.find((s) => s.id === sketch)!.points[0];
  assert.deepEqual([sp.x, sp.y], [40, 30], "settling the recorded design leaves the centre on the corner");
  // Edit Sketch 1, draw one line well away, (0, −40) to (10, −40): nothing pinned moves, so the centre stays at (40, 30).
  assert.equal(await a.menu(sketch, "edit-sketch"), null);
  await a.key("sketch-line");
  await a.click(0, -40);
  await a.click(10, -40);
  assert.deepEqual(centre(a, sketch), [40, 30], "a click elsewhere leaves the circle on the corner while the sketch is open");
  await a.key("escape");
  await a.finish();
  assert.deepEqual(centre(a, sketch), [40, 30], "after Finish Sketch");
  // Control: Move 1 back on, the centre follows the corner to (90, 30) again.
  assert.equal(await a.menu(move, "unsuppress"), null);
  assert.deepEqual(centre(a, sketch), [90, 30], "Move 1 on again");
  assert.equal(await a.close(), true);
});

test("editing a sketch before a Move: the body is drawn, and snapped to, where it is at the sketch's place (#540 item 1)", async () => {
  const { a, sketch } = await sketchBeforeMove();
  // Built: the box at x 50..90 (Move 1 shifts 0..40 by 50).
  assert.deepEqual(drawnBox(a), [50, 0, 0, 90, 30, 20], "built, at the end of the timeline");
  assert.equal(await a.menu(sketch, "edit-sketch"), null);
  assert.ok(a.sketching(), "Sketch 1 is open");
  // Sketch 1 comes before Move 1, so it sees the box as made, x 0..40: drawn there while it is edited.
  assert.deepEqual(drawnBox(a), [0, 0, 0, 40, 30, 20], "drawn at the sketch's place");
  await a.key("sketch-circle");
  // The corner (40, 30) is offered there; nothing at (90, 30), where the box is only after Move 1.
  a.pointer("move", [39.7, 29.8]);
  await a.settle();
  assert.match(snapShown(a), /40, ?30/, "the corner at the sketch's place is offered");
  a.pointer("move", [89.7, 29.8]);
  await a.settle();
  assert.doesNotMatch(snapShown(a), /90, ?30/, "no corner where Move 1 puts the box");
  // Snapped to the shown corner: the centre at (40, 30) as clicked, and after Finish (the pin follows the box as built at the sketch).
  await a.click(39.7, 29.8);
  await a.click(42, 30);
  const centreNow = centre(a, sketch);
  await a.finish();
  assert.deepEqual(centreNow, [40, 30], "where the snap showed and the click was");
  assert.deepEqual(centre(a, sketch), [40, 30], "after Finish Sketch");
  assert.equal(a.doc().sketches.find((x) => x.id === sketch)!.pins?.length, 1, "pinned to the corner");
  // Out of the sketch, the box is drawn at the end of the timeline again.
  assert.deepEqual(drawnBox(a), [50, 0, 0, 90, 30, 20], "back at the end of the timeline");
  assert.equal(await a.close(), true);
});

test("control: a sketch after the Move sees the moved box, corner (90, 30) (#540 item 1)", async () => {
  // Box 1, Move 1 (x +50), then Sketch 1 on XY: the sketch is after the Move, so the box is at x 50..90 for it.
  const moved = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 50 }).doc;
  const s = addSketch(moved, "XY");
  const a = await app(s.doc, designWorkspace);
  assert.equal(await a.menu(s.id, "edit-sketch"), null);
  assert.deepEqual(drawnBox(a), [50, 0, 0, 90, 30, 20], "drawn moved");
  await a.key("sketch-circle");
  await a.click(89.7, 29.8);
  await a.click(92, 30);
  await a.finish();
  assert.deepEqual(centre(a, s.id), [90, 30]);
  assert.equal(await a.close(), true);
});

// Project was already right before the fix (the settle after the click follows the projection to the sketch's place at
// once); it lands where the box is now drawn while the sketch is open.
test("control: editing a sketch before a Move, Project takes the body's edges where the sketch sees (and now draws) them (#540 item 1)", async () => {
  const { a, sketch } = await sketchBeforeMove();
  // The box's top face, by its kernel index (the one body is first in the joined mesh, so the joined index is the same).
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(a.doc(), cache, kernel);
  const view = await cache.view(build.bodies["body:feature-1"].handle);
  const top = view.face_centroids.findIndex((c) => c[2] === 20);
  await cache.close();
  assert.ok(top >= 0);
  assert.equal(await a.menu(sketch, "edit-sketch"), null);
  await a.key("sketch-project");
  assert.deepEqual(drawnBox(a), [0, 0, 0, 40, 30, 20], "drawn at the sketch's place");
  await a.click(20, 15, { face: top });
  const xs = () => a.doc().sketches.find((x) => x.id === sketch)!.points.map((p) => p.x);
  // By hand: at Sketch 1's place the box is x 0..40, y 0..30, so the top's four edges project to the rectangle x 0..40.
  assert.equal(a.doc().sketches.find((x) => x.id === sketch)!.projected?.length, 4, "four edges projected");
  assert.deepEqual([Math.min(...xs()), Math.max(...xs())], [0, 40], "projected at the sketch's place");
  await a.finish();
  assert.deepEqual([Math.min(...xs()), Math.max(...xs())], [0, 40], "and they stay there once rebuilt");
  assert.equal(await a.close(), true);
});
