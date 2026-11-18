// An edited Move's preview with a Copy or Mirror of the moved body after it (timeline hunt 2026-11-11, #539 item 3):
// the preview left the copy where it was, and OK then moved it; the workspace's rule is that the preview shows what OK does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertDuplicates, insertMove, NO_MOVE, partDocument, type MoveValues } from "@fission/design";
import { app } from "./design-app.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
type Box3 = number[][];
const meshBox = (positions: readonly number[]): Box3 => [
  [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k))),
  [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k))),
];
const near = (got: Box3, want: Box3, what: string) =>
  got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-4, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
type App = Awaited<ReturnType<typeof app>>;
const type = (a: App, sel: string, value: string) => {
  const el = a.$(sel) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new a.window.Event("input") as unknown as Event);
};

/** Edit Move `id` to X `x` in the Move panel: the drawn box while typed (the preview) and after OK. */
async function editX(a: App, id: string, x: string) {
  await a.doubleClick(id);
  assert.ok(a.$("#move-x"), "the Move panel is open");
  type(a, "#move-x", x);
  await a.settle();
  const preview = meshBox(a.mesh()!.positions);
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  return { preview, after: meshBox(a.mesh()!.positions) };
}

test("editing a Move: the preview draws a later Copy of the moved body where OK puts it", async () => {
  // Box 1 40 × 30 × 20 at the origin. Move 1: x 10 → x 10..50. Copy 1 of Box 1 (there): x 10..50. Move 2: Copy 1 by y 50 → y 50..80.
  const m1 = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], v({ x: 10 }));
  const d = insertDuplicates(m1.doc, ["body:feature-1"]);
  const a = await app(insertMove(d.doc, [`body:${d.ids[0]}`], v({ y: 50 })).doc);
  near(meshBox(a.mesh()!.positions), [[10, 0, 0], [50, 80, 20]], "built");
  const { preview, after } = await editX(a, m1.id, "110");
  // By hand: Move 1 at x 110 puts Box 1 at x 110..150, y 0..30; Copy 1 copies it there, x 110..150, and Move 2 takes it to
  // y 50..80: together x 110..150, y 0..80, z 0..20; before the fix the preview still drew Copy 1 at x 10..50.
  near(after, [[110, 0, 0], [150, 80, 20]], "after OK");
  near(preview, after, "the preview is what OK does");
  assert.equal(await a.close(), true);
});

test("editing a Move: the preview draws a later Mirror of the moved body where OK puts it; a body copied before the Move stays", async () => {
  // Box 1 40 × 30 × 20. Copy 1 of it made BEFORE Move 1 (stays x 0..40, Move 1 never moves it); Move 1: Box 1 x 10 → 10..50;
  // Mirror 1 of Box 1 across YZ after it: x −50..−10.
  const c = insertDuplicates(partDocument("box", 40, 30, 20), ["body:feature-1"]);
  const m1 = insertMove(c.doc, ["body:feature-1"], v({ x: 10 }));
  const a = await app(insertDuplicates(m1.doc, ["body:feature-1"], "YZ").doc);
  near(meshBox(a.mesh()!.positions), [[-50, 0, 0], [50, 30, 20]], "built");
  const { preview, after } = await editX(a, m1.id, "60");
  // By hand: Box 1 at x 60..100; the Mirror negates x: −100..−60; Copy 1 still 0..40. Together x −100..100, y 0..30, z 0..20.
  near(after, [[-100, 0, 0], [100, 30, 20]], "after OK");
  near(preview, after, "the preview is what OK does");
  assert.equal(await a.close(), true);
});
