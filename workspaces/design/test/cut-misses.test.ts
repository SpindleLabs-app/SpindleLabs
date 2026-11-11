// A Cut or Join that changes nothing (Ben, 11 Nov, SL #506 item 5 and #521):
// the rebuild says which tools remove or add nothing (misses.ts, from the
// boolean's own history, never from volumes), the row warns in words, and
// OK's question (cut-ask.ts) says what recording would really do. Built by
// the real rebuild on the real kernel; every volume worked by hand from the
// boxes' corners in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, setExtrudeOperation, type OperationChoice } from "../src/extrude.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { askWords, checkedItem, cutAsk } from "../src/cut-ask.ts";
import { missedTools, missWords } from "../src/misses.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/** Boxes, each `[w, d, h]` with its low corner moved to `[x, y, z]` (a ready-made box, then a Move); Box n's body "body:<its item>". */
function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[]; moves: (string | null)[] } {
  let doc: DesignDocument | null = null;
  const bodies: string[] = [];
  const moves: (string | null)[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (doc === null) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x !== 0 || y !== 0 || z !== 0) {
      const m = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z });
      doc = m.doc;
      moves.push(m.id);
    } else moves.push(null);
  }
  return { doc: doc!, bodies, moves };
}

/** A Combine of the first body with the rest, built: its result's misses and the target's volume. */
async function combined(list: Parameters<typeof boxes>, operation: CombineOperation, keepTools = false) {
  const { doc, bodies } = boxes(...list);
  const made = insertCombine(doc, bodies[0], bodies.slice(1), operation, keepTools);
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(made.doc, cache, kernel);
    const r = build.results[made.id];
    assert.equal(r.status, "built", JSON.stringify(r));
    const volume = build.bodies[bodies[0]] ? (await cache.view(build.bodies[bodies[0]].handle)).volume : NaN;
    return { r: r as Extract<typeof r, { status: "built" }>, volume, bodies, doc: made.doc, id: made.id };
  } finally {
    await cache.close();
  }
}

const BOX: [[number, number, number], [number, number, number]] = [[40, 30, 20], [0, 0, 0]];

test("a Cut whose tool is far away removes nothing, and the row says which tool and body in words", async () => {
  // Box 1 is x 0..40, y 0..30, z 0..20: 40 × 30 × 20 = 24,000 mm³. Box 2, a 10 mm cube, x 100..110: no common point.
  const { r, volume, bodies } = await combined([BOX, [[10, 10, 10], [100, 0, 0]]], "cut");
  near(volume, 24_000);
  assert.deepEqual(r.misses?.list, [{ target: bodies[0], tools: [bodies[1]] }]);
  assert.equal(r.misses?.message, "Combine 1: Body 2 removes nothing from Body 1");
});

test("a Cut whose tool only touches a face removes nothing", async () => {
  // Box 2 x 40..50 shares only the plane x = 40 with Box 1 (y 0..10, z 0..10 of its end face): no volume in common.
  const { r, volume, bodies } = await combined([BOX, [[10, 10, 10], [40, 0, 0]]], "cut");
  near(volume, 24_000);
  assert.deepEqual(r.misses?.list, [{ target: bodies[0], tools: [bodies[1]] }]);
});

test("a Cut whose tool only touches along an edge removes nothing", async () => {
  // Box 2 x 40..50, y 30..40 meets Box 1 only on the line x = 40, y = 30, z 0..10.
  const { r, volume } = await combined([BOX, [[10, 10, 10], [40, 30, 0]]], "cut");
  near(volume, 24_000);
  assert.equal(r.misses?.list.length, 1);
});

test("a Cut whose tool lies wholly inside makes a hollow, so it removes something", async () => {
  // Box 2 x 5..15, y 5..15, z 5..15 lies inside Box 1: 24,000 − 10³ = 23,000 mm³, a hollow with Box 2's six faces.
  const { r, volume } = await combined([BOX, [[10, 10, 10], [5, 5, 5]]], "cut");
  near(volume, 23_000);
  assert.equal(r.misses, undefined);
});

test("a Cut that bites into the body removes something", async () => {
  // Box 2 x 35..45 overlaps Box 1 in x 35..40, y 0..10, z 0..10: 5 × 10 × 10 = 500, so 23,500 mm³ left.
  const { r, volume } = await combined([BOX, [[10, 10, 10], [35, 0, 0]]], "cut");
  near(volume, 23_500);
  assert.equal(r.misses, undefined);
});

test("with several tools only the ones that remove nothing are named", async () => {
  // Box 2 bites 500 mm³ as above; Box 3 x 100..110 is far away: 23,500 mm³, and only Body 3 is named.
  const { r, volume, bodies } = await combined([BOX, [[10, 10, 10], [35, 0, 0]], [[10, 10, 10], [100, 0, 0]]], "cut");
  near(volume, 23_500);
  assert.deepEqual(r.misses?.list, [{ target: bodies[0], tools: [bodies[2]] }]);
  assert.equal(r.misses?.message, "Combine 1: Body 3 removes nothing from Body 1");
});

test("a Combine Join never asks or warns: one whose tool is far away keeps both bodies, as Fusion does (F2)", async () => {
  // Far: Box 2 stays a body of its own, Box 1 still 24,000 mm³; Ben's Fusion answer F2 keeps both with no warning.
  const far = await combined([BOX, [[10, 10, 10], [100, 0, 0]]], "join");
  near(far.volume, 24_000);
  assert.equal(far.r.misses, undefined);
  // Inside: x 5..15 etc. is already Box 1's, so the union is Box 1, 24,000 mm³, with no question either.
  const inside = await combined([BOX, [[10, 10, 10], [5, 5, 5]]], "join");
  near(inside.volume, 24_000);
  assert.equal(inside.r.misses, undefined);
  // Overlapping: 24,000 + 1,000 − 500 = 24,500 mm³.
  const over = await combined([BOX, [[10, 10, 10], [35, 0, 0]]], "join");
  near(over.volume, 24_500);
  assert.equal(over.r.misses, undefined);
});

test("a Join through another tool counts as reaching", async () => {
  // Box 2 x 35..45 overlaps Box 1; Box 3 x 44..54 overlaps only Box 2 (x 44..45). One body holds all three, so neither misses.
  const { r } = await combined([BOX, [[10, 10, 10], [35, 0, 0]], [[10, 10, 10], [44, 0, 0]]], "join");
  assert.equal(r.misses, undefined);
});

test("Intersect never asks: one that leaves nothing is refused as before", async () => {
  const { doc, bodies } = boxes(BOX, [[10, 10, 10], [5, 5, 5]]);
  const made = insertCombine(doc, bodies[0], [bodies[1]], "intersect", false);
  const checked = await checkedItem(kernel, made.doc, made.id);
  assert.deepEqual(checked, { refused: null, misses: [] });
});

test("an upstream edit that makes a recorded Cut miss shows the warning on the next rebuild", async () => {
  // Recorded biting 500 mm³ (Box 2 moved to x 35); then the Move is edited to x 100, so the tool no longer reaches.
  const { doc, bodies, moves } = boxes(BOX, [[10, 10, 10], [35, 0, 0]]);
  const made = insertCombine(doc, bodies[0], [bodies[1]], "cut", false);
  const before = await checkedItem(kernel, made.doc, made.id);
  assert.deepEqual(before.misses, []);
  const edited = changedMove(made.doc, moves[1]!, { ...NO_MOVE, x: 100 });
  const after = await checkedItem(kernel, edited, made.id);
  assert.equal(after.refused, null);
  assert.deepEqual(after.misses, [{ target: bodies[0], tools: [bodies[1]] }]);
});

/** `doc` with a rectangle from `a` to `c` sketched on XY (z = 0) and extruded `distance` mm up with `choice`. */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice | null) {
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, a, c).doc;
  return extrudeSketch(drawn, s.id, distance, false, undefined, choice);
}

test("an Extrude Cut that points away from the body cuts nothing (#521)", async () => {
  // Box 1 moved up to z 50..70; the 20 × 10 rectangle on XY extruded 10 up fills z 0..10: no common point, still 24,000 mm³.
  const { doc, bodies } = boxes([[40, 30, 20], [0, 0, 50]]);
  const made = extruded(doc, [10, 10], [30, 20], 10, { operation: "cut", bodies: [bodies[0]] });
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(made.doc, cache, kernel);
    const r = build.results[made.id];
    assert.equal(r.status, "built");
    near((await cache.view(build.bodies[bodies[0]].handle)).volume, 24_000);
    assert.equal(r.status === "built" ? r.misses?.message : null, "Extrude 1 cuts nothing: it doesn't reach Body 1");
  } finally {
    await cache.close();
  }
});

test("an Extrude Cut that reaches the body says nothing; changed to miss by an edit, it warns", async () => {
  // Box 1 z 0..20; the rectangle x 10..30, y 10..20 extruded 10 up cuts 20 × 10 × 10 = 2,000: 22,000 mm³.
  const { doc, bodies } = boxes(BOX);
  const made = extruded(doc, [10, 10], [30, 20], 10, { operation: "cut", bodies: [bodies[0]] });
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(made.doc, cache, kernel);
    near((await cache.view(build.bodies[bodies[0]].handle)).volume, 22_000);
    const r = build.results[made.id];
    assert.equal(r.status === "built" ? r.misses : "not built", undefined);
  } finally {
    await cache.close();
  }
  // An Extrude Join that reaches nothing (Box 1 moved to z 50): it stays a piece of its own.
  const up = boxes([[40, 30, 20], [0, 0, 50]]);
  const join = extruded(up.doc, [10, 10], [30, 20], 10, { operation: "join", bodies: [up.bodies[0]] });
  const checked = await checkedItem(kernel, join.doc, join.id);
  assert.equal(checked.refused, null);
  assert.equal(checked.misses.length, 1);
  // The same extrude edited to New body asks nothing.
  const plain = await checkedItem(kernel, setExtrudeOperation(join.doc, join.id, null), join.id);
  assert.deepEqual(plain.misses, []);
});

test("missedTools reads merged faces too, and only the history", () => {
  // Hand-made histories: body 1 the target, 2 and 3 tools. A face of 3 merged into a face of 1 (`also`) counts as 3's.
  const face = (body: number) => ({ body, face: 0, whole: false, turned: false });
  const history = [{ faces: [face(1), face(2)], also: [[face(3)], []], edges: [] }];
  assert.deepEqual(missedTools("cut", 1, [2, 3], { history }), []);
  assert.deepEqual(missedTools("cut", 1, [2, 3], { history: [{ faces: [face(1), face(2)], edges: [] }] }), [1]);
  // Join: a tool in a body of its own (only its faces) misses; Intersect never asks.
  assert.deepEqual(missedTools("join", 1, [2, 3], { history: [{ faces: [face(1), face(2)], edges: [] }, { faces: [face(3)], edges: [] }] }), [1]);
  assert.deepEqual(missedTools("intersect", 1, [2], { history: [{ faces: [face(1)], edges: [] }] }), []);
  // Words: a name list, the extrude's own body as "it".
  const name = (b: string) => b.replace("b", "Body ");
  assert.equal(missWords("Combine 2", "cut", [{ target: "b1", tools: ["b2", "b3"] }], name), "Combine 2: Body 2 and Body 3 remove nothing from Body 1");
  assert.equal(missWords("Extrude 1", "join", [{ target: "b1", tools: ["own"] }], name, "own"), "Extrude 1 adds nothing: it doesn't reach Body 1");
  assert.equal(missWords("Extrude 1", "cut", [{ target: "b1", tools: ["own"] }, { target: "b4", tools: ["own"] }], name, "own"), "Extrude 1 cuts nothing: it doesn't reach Body 1 or Body 4");
});

test("the question says what OK would do: delete the tool, record it, or cut or join anyway", () => {
  const name = (b: string) => b.replace("b", "Body ");
  const miss = [{ target: "b1", tools: ["b2"] }];
  const off = askWords("cut", miss, name, { kind: "combine", keepTools: false });
  assert.equal(off.go, "Delete Body 2");
  assert.match(off.words, /^Body 2 doesn't reach Body 1, so cutting it removes nothing\. The Combine uses its tools up, so Body 2 would only be deleted\./);
  // Keep tools on: nothing is deleted, so nothing would change.
  assert.equal(askWords("cut", miss, name, { kind: "combine", keepTools: true }).go, "Record anyway");
  assert.equal(askWords("join", miss, name, { kind: "combine", keepTools: false }).go, "Join anyway");
  const two = askWords("cut", [{ target: "b1", tools: ["b2", "b3"] }], name, { kind: "combine", keepTools: false });
  assert.equal(two.go, "Delete Body 2 and Body 3");
  const ext = askWords("cut", [{ target: "b1", tools: ["own"] }], name, { kind: "extrude", label: "Extrude 1", own: "own" });
  assert.equal(ext.go, "Cut anyway");
  assert.match(ext.words, /Extrude 1 doesn't reach Body 1, so it cuts nothing and leaves no body of its own\. It may point the wrong way: Flip turns it round\./);
});

test("the box answers once: its button records, Cancel, Escape and a second ask don't", async () => {
  const window = new Window();
  const slot = window.document.createElement("div");
  window.document.body.append(slot);
  const box = cutAsk(slot as unknown as HTMLElement);
  const words = { heading: "The cut removes nothing", words: "w", go: "Delete Body 2" };
  let answer = box.ask(words);
  assert.equal(box.open, true);
  assert.equal(slot.querySelector("#cut-ask-go")?.textContent, "Delete Body 2");
  // Cancel has the focus, so Enter alone records nothing.
  assert.equal(window.document.activeElement?.id, "cut-ask-cancel");
  (slot.querySelector("#cut-ask-go") as unknown as HTMLElement).click();
  assert.equal(await answer, true);
  assert.equal(box.open, false);
  answer = box.ask(words);
  (slot.querySelector("#cut-ask-cancel") as unknown as HTMLElement).click();
  assert.equal(await answer, false);
  answer = box.ask(words);
  slot.querySelector("#cut-ask")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(await answer, false);
  answer = box.ask(words);
  const again = box.ask(words);
  assert.equal(await answer, false);
  box.close();
  assert.equal(await again, false);
  await window.happyDOM.close();
});
