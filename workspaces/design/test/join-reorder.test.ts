// A drag in the timeline never changes which body an Extrude Join's result
// is (SL #538 item 3, hunt 2026-11-11, B2). The joined body keeps the id of
// the earliest made of the bodies it joins (docs/document-model.md section
// 8, rule 1), so swapping the items that made two of them would hand the
// result the other body's id: a later Move of it went red ("an earlier
// Combine or extrude used it up") and dropped its lift, and the Bodies row
// and Export STL named a body that was gone. Such a drag is now refused
// with words, as a drag before an item's own input is; drags that leave the
// joined bodies' order alone still move. On the real kernel, volumes and
// heights worked out by hand from the boxes and the rectangle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { reorderItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/**
 * The hunter's design: Box 1 40 × 30 × 20 at the origin, Box 2 the same moved x +100 by Move 1 (x 100..140), Sketch 1
 * on XY with the rectangle x 30..110, y 10..20 extruded 10 (Extrude 1) with `operation` on Box 1 then Box 2 (or Box 1
 * alone), then Move 2 lifting Box 1's body z +5.
 */
function design(operation: "join" | "cut" | null, both = true) {
  const doc = partDocument("box", 40, 30, 20);
  const box1 = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 40, 30, 20);
  const move1 = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 100 });
  const s = addSketch(move1.doc);
  const drawn = drawRectangle(s.doc, s.id, [30, 10], [110, 20]).doc;
  const bodies = both ? [`body:${box1}`, `body:${b2.id}`] : [`body:${box1}`];
  const e = extrudeSketch(drawn, s.id, 10, false, undefined, operation === null ? undefined : { operation, bodies });
  const move2 = insertMove(e.doc, [`body:${box1}`], { ...NO_MOVE, z: 5 });
  return { doc: move2.doc, box1, box2: b2.id, move1: move1.id, sketch: s.id, extrude: e.id, move2: move2.id };
}

/** Each item's status, and each body built with its volume and its z range. */
async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const statuses = Object.fromEntries(doc.timeline.features.map((f) => [f.id, build.results[f.id].status]));
  const bodies: Record<string, { volume: number; z: [number, number] }> = {};
  for (const [id, b] of Object.entries(build.bodies)) {
    const v = await cache.view(b.handle);
    bodies[id] = { volume: v.volume, z: [v.bounds[0][2], v.bounds[1][2]] };
  }
  await cache.close();
  return { statuses, bodies };
}

test("hand-worked, the hunter's design: the joined body is Box 1's, lifted to z 5..25, and dragging Box 2 to the front is refused in words", async () => {
  const d = design("join");
  const before = await built(d.doc);
  assert.ok(Object.values(before.statuses).every((s) => s === "built"), JSON.stringify(before.statuses));
  // One body: each box 40 × 30 × 20 = 24,000, the pad 80 × 10 × 10 = 8,000, less its overlaps with Box 1 (x 30..40:
  // 10 × 10 × 10 = 1,000) and Box 2 (x 100..110: 1,000): 24,000 + 24,000 + 8,000 − 1,000 − 1,000 = 54,000 mm³. It keeps
  // Box 1's id (Box 1 is made first), and Move 2 lifts it 5: z 0..20 becomes 5..25.
  assert.deepEqual(Object.keys(before.bodies), [`body:${d.box1}`]);
  near(before.bodies[`body:${d.box1}`].volume, 54000);
  assert.deepEqual(before.bodies[`body:${d.box1}`].z, [5, 25]);
  // Box 2 dragged to place 0 (before Box 1) would make it the earliest made, and the joined body Box 2's: refused.
  assert.deepEqual(reorderItem(d.doc, d.box2, 0), { refused: "join-order", message: "Box 2 can't go before Box 1: Extrude 1 joins their bodies, and the joined body is the one made first" });
  // The same swap from the other side: Box 1 dragged to after Move 1 (place 2 of the others) comes after Box 2.
  assert.deepEqual(reorderItem(d.doc, d.box1, 2), { refused: "join-order", message: "Box 1 can't go after Box 2: Extrude 1 joins their bodies, and the joined body is the one made first" });
  // Suppressed, the Join still holds them: unsuppressed later it would join them the other way round.
  const off = { ...d.doc, timeline: { ...d.doc.timeline, features: d.doc.timeline.features.map((f) => (f.id === d.extrude ? { ...f, suppressed: true } : f)) } };
  assert.equal((reorderItem(off, d.box2, 0) as { refused?: string }).refused, "join-order");
});

test("the controls: drags that leave the joined bodies' order alone still move, and so do swaps under a new body, a Cut, or a Join of one body", async () => {
  const d = design("join");
  // Sketch 1 to the front: it makes none of the bodies joined. Move 1 to just after Box 2 (where it is): the same order.
  const sketchFirst = reorderItem(d.doc, d.sketch, 0);
  assert.ok("doc" in sketchFirst, JSON.stringify(sketchFirst));
  assert.deepEqual(reorderItem(d.doc, d.move1, 2), { doc: d.doc });
  // Built after the drag: still one body of 54,000 at z 5..25 (nothing about the shape depends on where the sketch is).
  const s = await built(sketchFirst.doc);
  near(s.bodies[`body:${d.box1}`].volume, 54000);
  assert.deepEqual(s.bodies[`body:${d.box1}`].z, [5, 25]);
  // Box 2 to the front under a new-body extrude, a Cut of both boxes (each body keeps its own id), or a Join of Box 1 alone.
  for (const [what, op, both] of [["new body", null, true], ["cut", "cut", true], ["join of Box 1 alone", "join", false]] as const) {
    const c = design(op, both);
    const r = reorderItem(c.doc, c.box2, 0);
    assert.ok("doc" in r, `${what}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.doc.timeline.features.map((f) => f.id).slice(0, 2), [c.box2, c.box1], what);
  }
  // Under a new-body extrude, Box 2 first: Move 2 still lifts Box 1 alone, 24,000 mm³ at z 5..25.
  const n = design(null);
  const moved = reorderItem(n.doc, n.box2, 0);
  assert.ok("doc" in moved);
  const b = await built(moved.doc);
  assert.ok(Object.values(b.statuses).every((x) => x === "built"), JSON.stringify(b.statuses));
  near(b.bodies[`body:${n.box1}`].volume, 24000);
  assert.deepEqual(b.bodies[`body:${n.box1}`].z, [5, 25]);
});

// SL #760 item 2 (app-wide hunt 2026-11-14, T-3): the same rule under a Combine Join. The joined body keeps the
// target's id, but once a later Cut splits it, the piece that stays "Body 1" is the one holding the input made first,
// so swapping the items that made the Combine's bodies quietly makes Body 1 the other piece.
/**
 * Box 1 100 × 40 × 10 (x 0..100). Box 2 40 × 40 × 10 moved x +100 by Move 1 (x 100..140). Combine 1 joins Box 2 to
 * Box 1 (or cuts it, or joins keeping the tool): x 0..140. Box 3 15 × 60 × 30 moved (50, −10, −10) by Move 2, x 50..65
 * right across. Combine 2 cuts Box 3 from Body 1. Then a Copy of Body 1.
 */
function combined(operation: "join" | "cut", keep = false) {
  let doc: DesignDocument = partDocument("box", 100, 40, 10);
  const box1 = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 40, 40, 10);
  const move1 = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 100 });
  const c1 = insertCombine(move1.doc, `body:${box1}`, [`body:${b2.id}`], operation, keep);
  const b3 = insertPreset(c1.doc, "box", 15, 60, 30);
  doc = insertMove(b3.doc, [`body:${b3.id}`], { ...NO_MOVE, x: 50, y: -10, z: -10 }).doc;
  doc = insertCombine(doc, `body:${box1}`, [`body:${b3.id}`], "cut").doc;
  const copy = insertDuplicates(doc, [`body:${box1}`]);
  return { doc: copy.doc, box1, box2: b2.id, move1: move1.id, combine1: c1.id, copy: copy.ids[0] };
}

test("hand-worked, #760 item 2: under a Combine Join, Body 1 is the piece with Box 1's end and its Copy holds 20,000; dragging Box 2 to the front is refused in words", async () => {
  const d = combined("join");
  const before = await built(d.doc);
  assert.ok(Object.values(before.statuses).every((s) => s === "built"), JSON.stringify(before.statuses));
  // The joined bar x 0..140 cut at x 50..65: x 0..50 is 50 × 40 × 10 = 20,000 and x 65..140 is 75 × 40 × 10 = 30,000.
  // Body 1 is the piece with Box 1's own end (Box 1 was made first), so the Copy of Body 1 is 20,000:
  // 20,000 + 30,000 + 20,000 = 70,000 in three bodies.
  near(before.bodies[`body:${d.box1}`].volume, 20000);
  near(before.bodies[`body:${d.copy}`].volume, 20000);
  near(Object.values(before.bodies).reduce((sum, b) => sum + b.volume, 0), 70000);
  // Box 2 first would make its end (x 65..140, 30,000) Body 1, and the Copy 30,000: refused, as under an Extrude Join.
  assert.deepEqual(reorderItem(d.doc, d.box2, 0), { refused: "join-order", message: "Box 2 can't go before Box 1: Combine 1 joins their bodies, and the joined body is the one made first" });
  assert.deepEqual(reorderItem(d.doc, d.box1, 2), { refused: "join-order", message: "Box 1 can't go after Box 2: Combine 1 joins their bodies, and the joined body is the one made first" });
  // Keeping the tool changes nothing about which input was made first.
  assert.equal((reorderItem(combined("join", true).doc, d.box2, 0) as { refused?: string }).refused, "join-order");
});

test("the controls, #760 item 2: drags that keep the joined bodies' order still move, and so does the swap under a Combine Cut", async () => {
  const d = combined("join");
  assert.deepEqual(reorderItem(d.doc, d.move1, 2), { doc: d.doc });
  // A Cut keeps the target's body alone (the tool is used up), so which box came first names nothing later.
  const c = combined("cut");
  const r = reorderItem(c.doc, c.box2, 0);
  assert.ok("doc" in r, JSON.stringify(r));
  assert.deepEqual(r.doc.timeline.features.map((f) => f.id).slice(0, 2), [c.box2, c.box1]);
});
