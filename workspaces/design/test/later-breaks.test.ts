// SL #676 item 2: two edits that broke a later step and asked nothing.
// - A new Combine (or Extrude Join) put in at a rolled-back marker that uses
//   up a body an item after the marker works on: refused in the words a
//   Combine edit is refused with (#506 item 3).
// - A Combine (or an operation extrude) edited so a later step no longer
//   finds its body (a Cut made a Join, so the piece a later Move moves is
//   gone): OK's check build finds it (`checkedItem`'s `breaks`) and asks
//   first (`breaksWords`), as a Cut that changes nothing does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedCombine, insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { moveMarker } from "../src/timeline-edits.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { brokenLater, breaksWords, checkedItem } from "../src/cut-ask.ts";
import { BodyCache, builtPieceFaces, followedDoc, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);
const refusal = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return "not refused";
};

/** `doc` rebuilt and taken in as the workspace takes it in (pieces numbered), with its results and each body's volume. */
async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const volumes: Record<string, number> = {};
  for (const [id, b] of Object.entries(build.bodies)) volumes[id] = (await cache.view(b.handle)).volume;
  await cache.close();
  return { results: build.results, volumes, doc: numberPieces(followedDoc(doc, build), Object.keys(build.bodies), builtPieceFaces(build)) };
}

/** S4: Box 1, Box 2 (Move 1 by 20, 15, 10), Box 3 (Move 2 by 40, 15, 10), Combine 1 joining `joined` to Box 1. */
function threeBoxes(joined: 2 | 3) {
  let doc = partDocument("box", 40, 30, 20);
  let b2: string;
  let b3: string;
  ({ doc, id: b2 } = insertPreset(doc, "box", 40, 30, 20));
  ({ doc } = insertMove(doc, [`body:${b2}`], { ...NO_MOVE, x: 20, y: 15, z: 10 }));
  ({ doc, id: b3 } = insertPreset(doc, "box", 40, 30, 20));
  const m2 = insertMove(doc, [`body:${b3}`], { ...NO_MOVE, x: 40, y: 15, z: 10 });
  doc = m2.doc;
  ({ doc } = insertCombine(doc, "body:feature-1", [`body:${joined === 2 ? b2 : b3}`], "join"));
  return { doc, b2, b3, move2: m2.id };
}

test("#676 item 2, by hand: a Combine put in at a rolled-back marker can't use up a tool a later Combine joins", async () => {
  const { doc, b2, b3, move2 } = threeBoxes(2);
  // Box 2 at x 20..60, y 15..45, z 10..30 overlaps Box 1 in 20 × 15 × 10 = 3,000, so Combine 1 is 24,000 × 2 − 3,000 =
  // 45,000; Box 3 apart: 69,000 in all.
  const all = await built(doc);
  near(Object.values(all.volumes).reduce((a, b) => a + b, 0), 69000);
  // The marker on Move 2 (Combine 1 rolled back); Combine 2 joining Box 2 into Box 3 would use Box 2 up, and Combine 1,
  // rolled forward, would find no Box 2: refused, naming both, as editing a Combine to use a tool up is.
  const back = moveMarker(all.doc, move2);
  assert.equal(refusal(() => insertCombine(back, `body:${b3}`, [`body:${b2}`], "join")), "Combine 1 uses Body 2, which Combine 2 would use up: change or delete Combine 1 first");
  // Keeping the tools uses nothing up, and a tool no later item uses is fine: both go in.
  assert.equal(insertCombine(back, `body:${b3}`, [`body:${b2}`], "join", true).id.startsWith("feature-"), true);
  assert.equal(insertCombine(back, "body:feature-1", [`body:${b3}`], "cut").id.startsWith("feature-"), true);
});

test("#676 item 2: an Extrude Join put in at the marker can't use up a body a later Combine joins either", () => {
  const { doc, b2, b3, move2 } = threeBoxes(3);
  // Joining Box 2 and Box 3 keeps the earlier made, Box 2, and uses Box 3 up, which Combine 1 joins: refused.
  const back = moveMarker(doc, move2);
  const s = addSketch(back, "XY");
  const drawn = drawRectangle(s.doc, s.id, [30, 20], [50, 40]).doc;
  assert.equal(refusal(() => extrudeSketch(drawn, s.id, 15, false, undefined, { operation: "join", bodies: [`body:${b2}`, `body:${b3}`] })), "Combine 1 uses Body 3, which Extrude 1 would use up: change or delete Combine 1 first");
  // A Cut of the same two uses neither up, and a Join of Box 2 alone keeps it: both go in.
  assert.ok(extrudeSketch(drawn, s.id, 15, false, undefined, { operation: "cut", bodies: [`body:${b2}`, `body:${b3}`] }).id);
  assert.ok(extrudeSketch(drawn, s.id, 15, false, undefined, { operation: "join", bodies: [`body:${b2}`] }).id);
});

test("#676 item 2 S5, by hand: a Cut edited to a Join would break the Move of the piece it no longer makes, so OK asks", async () => {
  // Box 1 40 × 30 × 20; Box 2 10 × 30 × 20 moved to x 10..20; Combine 1 cuts Box 2 from Box 1, leaving x 0..10
  // (10 × 30 × 20 = 6,000, Box 1's id) and x 20..40 (20 × 30 × 20 = 12,000, a piece). Move 2 lifts that piece by 50.
  let doc = partDocument("box", 40, 30, 20);
  let b2: string;
  ({ doc, id: b2 } = insertPreset(doc, "box", 10, 30, 20));
  ({ doc } = insertMove(doc, [`body:${b2}`], { ...NO_MOVE, x: 10 }));
  const c = insertCombine(doc, "body:feature-1", [`body:${b2}`], "cut");
  const cut = await built(c.doc);
  near(cut.volumes["body:feature-1"], 6000);
  const piece = Object.keys(cut.volumes).find((b) => b !== "body:feature-1")!;
  near(cut.volumes[piece], 12000);
  const m = insertMove(cut.doc, [piece], { ...NO_MOVE, z: 50 });
  const before = await built(m.doc);
  assert.equal(before.results[m.id].status, "built");
  // As a Join, Box 2 fills the gap: one body x 0..40 of 24,000, no piece, so Move 2 has nothing left to move.
  const join = changedCombine(before.doc, c.id, "body:feature-1", [`body:${b2}`], "join", false);
  const checked = await checkedItem(kernel, join, c.id, before.results);
  assert.equal(checked.refused, null);
  assert.deepEqual(checked.breaks, ["Move 2"]);
  assert.deepEqual(breaksWords("Combine 1", checked.breaks!), {
    heading: "A later step would break",
    words: "This change to Combine 1 would break Move 2: it would no longer find a body it works on and show red. Record it anyway, or cancel and change it?",
    go: "Record anyway",
  });
  // Control: keeping the tools still makes both pieces, so nothing breaks and OK records at once.
  const kept = changedCombine(before.doc, c.id, "body:feature-1", [`body:${b2}`], "cut", true);
  assert.deepEqual((await checkedItem(kernel, kept, c.id, before.results)).breaks, []);
  // With nothing to compare with (a new Combine), nothing is called broken.
  assert.deepEqual((await checkedItem(kernel, join, c.id)).breaks, []);
});

test("#676 item 2: brokenLater counts a later step failing now, or a Move leaving out more bodies, and never one already broken", () => {
  let doc = partDocument("box", 10, 10, 10);
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  const m1 = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, z: 5 });
  const m2 = insertMove(m1.doc, [`body:${id}`], { ...NO_MOVE, z: 5 });
  const m3 = insertMove(m2.doc, ["body:feature-1", `body:${id}`], { ...NO_MOVE, x: 5 });
  const d = m3.doc;
  const before = { [m1.id]: { status: "built" }, [m2.id]: { status: "failed" }, [m3.id]: { status: "built", missing: { bodies: ["body:x"] } } };
  // Checked from Box 2: Move 1 fails now (broken), Move 2 failed before (not counted), Move 3 leaves out one more.
  const after = { [m1.id]: { status: "failed" }, [m2.id]: { status: "failed" }, [m3.id]: { status: "built", missing: { bodies: ["body:x", "body:y"] } } };
  assert.deepEqual(brokenLater(d, id, before, after), ["Move 1", "Move 3"]);
  // Leaving out as many as before is no break; nor are items before the checked one.
  assert.deepEqual(brokenLater(d, m1.id, before, { ...after, [m3.id]: before[m3.id] }), []);
  assert.deepEqual(breaksWords("Extrude 1", ["Move 1", "Move 3"]).words, "This change to Extrude 1 would break Move 1 and Move 3: they would no longer find a body they work on and show red. Record it anyway, or cancel and change it?");
});
