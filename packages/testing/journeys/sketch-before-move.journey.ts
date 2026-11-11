// A sketch's snapped points and the Moves around it (timeline hunt 2026-11-11, #540): a sketch edited
// before a Move offers the bodies as they are at its own place in the timeline (item 1), and a Move
// before it that is suppressed is suppressed for its pins too (item 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BodyCache, insertMove, NO_MOVE, partDocument, settleKept } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

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
