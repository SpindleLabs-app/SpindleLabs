// The timeline model's rule for SL #624 item 2 (broken-solids hunt,
// 2026-11-12): a Move that is OFF (suppressed, or rolled back by the marker)
// when a Cut before it first splits a body it holds takes the new piece all
// the same (`takeIn`), so both pieces move once it is back on. Worked by
// hand, with a control: a piece that was there when the Move was made, and
// not picked, is never taken. Design does the same on the real kernel:
// workspaces/design test/combine-split-move-off.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, createModel, rebuild, takeIn, type ConcreteOp, type ModelBody, type TimelineModel } from "../src/timeline-model.ts";

/** The edits made, each taken in as the sessions take it in after every rebuild. */
function run(m: TimelineModel, ...ops: ConcreteOp[]) {
  for (const op of ops) {
    assert.equal(applyOp(m, op).kind, "done", JSON.stringify(op));
    m.doc = takeIn(m.doc);
  }
}
/** The lowest and highest z of a body's face centroids: a 10 mm thick bar lying at z0 has its bottom's at z0 and its top's at z0 + 10. */
const zs = (b: ModelBody | undefined) => {
  const z = (b?.faces ?? []).map((f) => f.centroid[2]);
  return [Math.min(...z), Math.max(...z)];
};

// The bar 100 × 20 × 10 (item-1); a 10 × 40 × 20 box (item-2) moved by item-3 to x 95..105, y −10..30, z −5..15, so
// the Cut (item-4) takes the bar's last 5 mm off: one piece, x 0..95, 95·20·10 = 19,000.
function endCut(): TimelineModel {
  const m = createModel();
  run(
    m,
    { op: "add-preset", kind: "box", sizes: [100, 20, 10] },
    { op: "add-preset", kind: "box", sizes: [10, 40, 20] },
    { op: "add-move", bodies: ["item-2"], shift: [95, -10, -5], turnZ: 0, pivot: [0, 0] },
    { op: "add-combine", target: "item-1", tool: "item-2", operation: "cut", keep: false },
  );
  return m;
}
/** The tool slid to x 30..40: the Cut goes through the middle, leaving x 0..30 (30·20·10 = 6,000, the bar's id) and x 40..100 (60·20·10 = 12,000, the Cut's piece). */
const through: ConcreteOp = { op: "set-move", item: "item-3", shift: [30, -10, -5], turnZ: 0, pivot: [0, 0] };
const bodies = (m: TimelineModel) => {
  const r = rebuild(m.doc);
  return { r, near: (r.results["item-1"] as { body?: ModelBody }).body, far: (r.results["item-4"] as { pieces?: ModelBody[] }).pieces?.[0] };
};

for (const way of ["suppressed", "rolled back by the marker"] as const) {
  test(`hand-worked: the Cut splits the bar while the Move that lifts it is ${way}: the Move takes the new piece, and lifts both once it is back on`, () => {
    const m = endCut();
    run(m, { op: "add-move", bodies: ["item-1"], shift: [0, 0, 50], turnZ: 0, pivot: [0, 0] });
    assert.deepEqual(zs(bodies(m).near), [50, 60], "the bar lifted 50");
    run(m, way === "suppressed" ? { op: "suppress", item: "item-5", on: true } : { op: "marker", at: "item-4" });
    assert.deepEqual(zs(bodies(m).near), [0, 10], "back on the ground while the Move is off");
    run(m, through);
    const off = bodies(m);
    assert.deepEqual([off.near?.volume, off.far?.volume], [6000, 12000]);
    assert.deepEqual([zs(off.near), zs(off.far)], [[0, 10], [0, 10]], "both pieces on the ground while the Move is off");
    assert.deepEqual((m.doc.items.find((i) => i.id === "item-5") as { pieces?: string[] }).pieces, ["item-4#1"], "the Move holds the new piece");
    run(m, way === "suppressed" ? { op: "suppress", item: "item-5", on: false } : { op: "marker", at: null });
    const on = bodies(m);
    assert.deepEqual(on.r.results["item-5"], { status: "built" });
    // Both lifted 50: bottoms at z 50, tops at z 60; nothing left at z 0..10.
    assert.deepEqual([zs(on.near), zs(on.far)], [[50, 60], [50, 60]]);
    assert.deepEqual([on.near?.volume, on.far?.volume], [6000, 12000]);
  });
}

test("control: a Move made, and suppressed, when the bar was already in two pieces takes nothing: the far piece was there to pick and was not picked", () => {
  const m = endCut();
  run(m, through, { op: "add-move", bodies: ["item-1"], shift: [0, 0, 50], turnZ: 0, pivot: [0, 0] }, { op: "suppress", item: "item-5", on: true }, { op: "suppress", item: "item-5", on: false });
  assert.equal((m.doc.items.find((i) => i.id === "item-5") as { pieces?: string[] }).pieces, undefined);
  const now = bodies(m);
  assert.deepEqual([zs(now.near), zs(now.far)], [[50, 60], [0, 10]], "only the near piece is lifted");
});
