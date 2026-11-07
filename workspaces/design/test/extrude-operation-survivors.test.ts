// Mutation testing of Extrude's operation (Design data version 10): each
// test here kills changes to the code that no other test noticed (Stryker,
// 2026-11-05), worked out by hand where it is a number or a word. The
// reader's refusals word for word, the summaries' words, the panel's
// choices refused, Edit's unchanged choices, and the rebuild's failures,
// greying, pieces numbered across bodies and bodies alike in the kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { bodyChoices, boxesMeet, operationNote, REACH, type Bounds } from "../src/extrude-operation.ts";
import { extrudeSketch, setExtrudeDistance, setExtrudeOperation, type OperationChoice } from "../src/extrude.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { addFaceSketch, addSketch, deleteCurve, drawLine, drawRectangle, projectEdges } from "../src/sketch.ts";
import { suppressItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const json = (d: DesignDocument) => JSON.parse(JSON.stringify(d));

/** Boxes, each `[w, d, h]` with its low corner moved to `[x, y, z]`; Box n's body "body:<its item>". */
function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[] } {
  let doc: DesignDocument | null = null;
  const bodies: string[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (doc === null) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x !== 0 || y !== 0 || z !== 0) doc = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z }).doc;
  }
  return { doc: doc!, bodies };
}

/** `doc` with a rectangle from `a` to `c` sketched on XY and extruded `distance` mm up with `choice`. */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice | null): { doc: DesignDocument; id: string; sketch: string; lines: string[] } {
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, a, c);
  return { ...extrudeSketch(drawn.doc, s.id, distance, false, undefined, choice), sketch: s.id, lines: drawn.ids };
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; volume: (body: string) => Promise<number> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, volume: async (body) => (await cache.view(build.bodies[body].handle)).volume };
}
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got}, expected ${want}`);

test("the reader's refusals of an operation, word for word: no bodies to join to, too many, a body made after it or by itself, a wrong dependsOn", () => {
  // Box 1 (feature-1), Box 2 (feature-2) and Sketch 1, extruded joining Box 1.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [20, 0, 0]]);
  const { doc, id } = extruded(two, [2, 2], [6, 6], 20, { operation: "join", bodies: [bodies[0]] });
  const broken = (change: (f: Record<string, any>, d: Record<string, any>) => void) => {
    const d = json(doc);
    change(d.timeline.features.at(-1), d);
    return () => readDesignDocument(d);
  };
  const at = `Design extrude ${id}`;
  assert.throws(broken((f) => (f.intent.parameters.bodies = [])), { message: `${at} joins but names no bodies to join to` });
  assert.throws(broken((f) => (f.intent.parameters.bodies = "body:feature-1")), { message: `${at} joins but names no bodies to join to` });
  // Too many: one more than the items' limit (the same limit a Combine's list has).
  assert.throws(broken((f) => (f.intent.parameters.bodies = Array.from({ length: 5001 }, (_, i) => `body:feature-${i + 1}`))), /names 5,001 bodies|names 5001 bodies|bodies/);
  // A body id that isn't text, or text that is no body id.
  assert.throws(broken((f) => (f.intent.parameters.bodies = [7])), { message: `${at}: 7 is not a body made before it in the timeline` });
  assert.throws(broken((f) => (f.intent.parameters.bodies = ["feature-1"])), { message: `${at}: feature-1 is not a body made before it in the timeline` });
  // Box 2's body, the extrude moved before Box 2 (made after it now); its own id; a sketch's (an item there, making no body).
  assert.throws(
    broken((f, d) => {
      const list = d.timeline.features;
      list.splice(1, 0, list.pop());
      f.intent.parameters.bodies = [bodies[1]];
      f.dependsOn = [f.intent.parameters.sketch, bodies[1].slice("body:".length)];
      // The sketch must come first: put it at the very start.
      const sketch = list.findIndex((x: any) => x.id === f.intent.parameters.sketch);
      list.unshift(...list.splice(sketch, 1));
    }),
    { message: `${at}: ${bodies[1]} is not a body made before it in the timeline` },
  );
  assert.throws(broken((f) => (f.intent.parameters.bodies = [`body:${id}`])), { message: `${at}: body:${id} is not a body made before it in the timeline` });
  assert.throws(broken((f) => (f.intent.parameters.bodies = [`body:${f.intent.parameters.sketch}`])), { message: `${at}: body:${(doc.timeline.features.at(-1)!.intent.parameters.sketch as string)} is not a body made before it in the timeline` });
  // dependsOn: missing, one too many, the right ones in the wrong order, a body item twice over (each once is right).
  const sketch = doc.timeline.features.at(-1)!.intent.parameters.sketch as string;
  const want = `${at} must depend on its sketch, then exactly on the items that made the bodies it joins, in their order (${sketch}, feature-1)`;
  assert.throws(broken((f) => f.dependsOn.pop()), { message: want });
  assert.throws(broken((f) => f.dependsOn.push("feature-2")), { message: want });
  assert.throws(broken((f) => (f.dependsOn = ["feature-1", sketch])), { message: want });
  // Two bodies of two items: both listed, "a, b" in the words.
  const both = extruded(two, [2, 2], [26, 6], 20, { operation: "cut", bodies });
  const d2 = json(both.doc);
  d2.timeline.features.at(-1).dependsOn.reverse();
  assert.throws(() => readDesignDocument(d2), { message: `Design extrude ${both.id} must depend on its sketch, then exactly on the items that made the bodies it cuts, in their order (${both.sketch}, feature-1, feature-2)` });
  // Two pieces of one item depend on it once.
  assert.deepEqual(readDesignDocument(json(both.doc)).timeline.features.at(-1)!.dependsOn, [both.sketch, "feature-1", "feature-2"]);
});

test("an extrude with an operation has faces of its own: sketched on, projected; a Combine's are refused", () => {
  const { doc: cube, bodies } = boxes([[10, 10, 10], [0, 0, 0]]);
  const { doc, id } = extruded(cube, [2, 2], [6, 6], 20, { operation: "join", bodies });
  const on = addFaceSketch(doc, { plane: facePlane(id, "end"), feature: id }, drawnFrame([0, 0, 1], [4, 4, 20]));
  assert.deepEqual(readDesignDocument(json(on.doc)).timeline.features.at(-1)!.dependsOn, [id]);
  const s = addSketch(doc);
  assert.doesNotThrow(() => projectEdges(s.doc, s.id, [{ feature: id, edge: "end+side", shape: { kind: "line", a: [2, 2], b: [6, 2] } }]));
  // A Combine makes no faces of its own.
  const { doc: two, bodies: b2 } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 0, 0]]);
  const c = insertCombine(two, b2[0], [b2[1]], "join");
  assert.throws(() => addFaceSketch(c.doc, { plane: facePlane(c.id, "top"), feature: c.id }, drawnFrame([0, 0, 1], [4, 4, 10])), { message: `there is no solid item ${c.id} to sketch on` });
  const s2 = addSketch(c.doc);
  assert.throws(() => projectEdges(s2.doc, s2.id, [{ feature: c.id, edge: "a+b", shape: { kind: "line", a: [0, 0], b: [1, 0] } }]), /is not a solid item before Sketch 1 in the timeline, so its edges can't be projected into it$/);
});

test("hand-worked: boxes meeting exactly REACH apart touch; the words list three bodies and say 'all into the first' only for two or more", () => {
  // A gap of exactly REACH (the low box's top at 0, the high one's bottom at REACH) still counts: within, not past.
  const low: Bounds = [[0, 0, -1], [1, 1, 0]];
  const high: Bounds = [[0, 0, REACH], [1, 1, 1]];
  assert.equal(boxesMeet(low, high), true);
  assert.equal(boxesMeet(high, low), true);
  const three = ["Body 1", "Body 2", "Body 3"].map((label, i) => ({ body: `body:feature-${i + 1}`, label, ticked: true }));
  assert.equal(operationNote("cut", three).text, "The extrude is cut from Body 1, Body 2 and Body 3.");
  assert.equal(operationNote("join", three).text, "The extrude is joined to Body 1, Body 2 and Body 3, all into the first.");
  assert.equal(operationNote("join", three.slice(0, 1)).text, "The extrude is joined to Body 1.");
  assert.equal(operationNote("intersect", three.slice(0, 1)).text, "Only what Body 1 shares with the extrude is kept.");
  assert.equal(operationNote("intersect", three).text, "Only what Body 1, Body 2 and Body 3 each share with the extrude is kept.");
  // bodyChoices keeps the scene's order and reads each label from its own row.
  const list = bodyChoices([[0, 0, 0], [1, 1, 1]], [{ body: "body:b", label: "Body 9", bounds: low }, { body: "body:a", label: "Body 4", bounds: high }], new Set(["body:a"]));
  assert.deepEqual(list, [{ body: "body:b", label: "Body 9", ticked: true }, { body: "body:a", label: "Body 4", ticked: false }]);
});

test("the summaries word each operation, every body named, a piece as a piece; Flip comes first", async () => {
  const { doc: three, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]], [[10, 10, 10], [40, 0, -5]]);
  const words = (operation: CombineOperation, picked: string[], from = three) => extruded(from, [2, 2], [46, 6], 20, { operation, bodies: picked }).doc.timeline.features.at(-1)!.intent.summary;
  assert.equal(words("join", bodies), "Extrude Sketch 1 by 20 mm, joined to Box 1, Box 2 and Box 3");
  assert.equal(words("cut", bodies.slice(0, 2)), "Extrude Sketch 1 by 20 mm, cut from Box 1 and Box 2");
  assert.equal(words("intersect", bodies.slice(1, 2)), "Extrude Sketch 1 by 20 mm, intersected with Box 2");
  const s = addSketch(three);
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  assert.equal(extrudeSketch(drawn, s.id, 5, true, undefined, { operation: "cut", bodies: [bodies[0]] }).doc.timeline.features.at(-1)!.intent.summary, "Extrude Sketch 1 by 5 mm, flipped, cut from Box 1");
  assert.equal(extrudeSketch(drawn, s.id, 5, false).doc.timeline.features.at(-1)!.intent.summary, "Extrude Sketch 1 by 5 mm");
  // A piece: the bar cut through (x 0..100 by a slot x 30..40), its far piece cut again.
  const { doc: bar, bodies: barBody } = boxes([[100, 20, 10], [0, 0, 0]]);
  const slot = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies: barBody });
  const b = await built(slot.doc);
  const piece = `body:${slot.id}/piece:1`;
  assert.deepEqual(Object.keys(b.build.bodies).sort(), [barBody[0], piece].sort());
  await b.cache.close();
  const numbered = numberPieces(slot.doc, [piece]);
  assert.equal(words("cut", [piece], numbered), "Extrude Sketch 2 by 20 mm, cut from a piece of Extrude 1");
});

test("the panel's choices refused: a piece no rebuild numbered, a piece of a box, a body after the marker, and the words of each", async () => {
  const { doc: bar, bodies } = boxes([[100, 20, 10], [0, 0, 0]]);
  const slot = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies });
  const s = addSketch(slot.doc);
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  const cut = (picked: string[], from = drawn) => () => extrudeSketch(from, s.id, 5, false, undefined, { operation: "cut", bodies: picked });
  // The piece is not numbered yet (no rebuild has shown it): no body of the design.
  assert.throws(cut([`body:${slot.id}/piece:1`]), { message: `body:${slot.id}/piece:1 is not a body in the design` });
  // Numbered, it is one.
  const numbered = numberPieces(drawn, [`body:${slot.id}/piece:1`]);
  assert.doesNotThrow(cut([`body:${slot.id}/piece:1`], numbered));
  // A piece of the box (it makes no pieces), and a body id of no item.
  assert.throws(cut([`${bodies[0]}/piece:1`], numbered), { message: `${bodies[0]}/piece:1 is not a body in the design` });
  assert.throws(cut(["body:feature-99"]), { message: "body:feature-99 is not a body in the design" });
  assert.throws(cut(["Box 1"]), { message: "Box 1 is not a body in the design" });
  // A body made after the extrude being edited, and one made by the very item before it (allowed).
  const later = insertPreset(drawn, "box", 5, 5, 5);
  assert.throws(() => setExtrudeOperation(later.doc, slot.id, { operation: "cut", bodies: [`body:${later.id}`] }), { message: `Box 2 comes after Extrude 1, so it can't use it` });
  assert.doesNotThrow(() => setExtrudeOperation(later.doc, slot.id, { operation: "join", bodies }));
  // A new body made to work on itself.
  const plain = setExtrudeOperation(later.doc, slot.id, null);
  assert.throws(() => setExtrudeOperation(plain, slot.id, { operation: "cut", bodies: [`body:${slot.id}`] }), { message: "Extrude 1 can't join, cut or intersect its own body" });
});

test("Edit's operation: an unknown item, one that is no extrude of a sketch, an operation that is none, and the same choice changing nothing", () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
  const { doc, id, sketch } = extruded(two, [2, 2], [26, 6], 20, { operation: "cut", bodies });
  assert.throws(() => setExtrudeOperation(doc, "feature-99", null), { message: "there is no feature feature-99 in the design" });
  assert.throws(() => setExtrudeOperation(doc, "feature-1", null), { message: "Box: 10 × 10 × 10 mm is not an extrude of a sketch, so it has no operation to change" });
  assert.throws(() => setExtrudeOperation(doc, id, { operation: "glue" as CombineOperation, bodies }), { message: "glue is not join, cut or intersect" });
  // The same operation and bodies: the same document. Another order, another operation or New body: changed.
  assert.equal(setExtrudeOperation(doc, id, { operation: "cut", bodies: [...bodies] }), doc);
  assert.notEqual(setExtrudeOperation(doc, id, { operation: "cut", bodies: [bodies[1], bodies[0]] }), doc);
  assert.notEqual(setExtrudeOperation(doc, id, { operation: "join", bodies }), doc);
  const plain = setExtrudeOperation(doc, id, null);
  assert.equal(setExtrudeOperation(plain, id, null), plain);
  assert.notEqual(setExtrudeOperation(plain, id, { operation: "cut", bodies }), plain);
  // New body: the extrude's provenance is its sketch's alone; with bodies, its sketch then each body's item, once.
  assert.deepEqual(plain.timeline.features.at(-1)!.provenance.from.map((x) => x.id), [sketch]);
  const one = setExtrudeOperation(plain, id, { operation: "join", bodies: [bodies[1]] }).timeline.features.at(-1)!;
  assert.deepEqual(one.provenance.from.map((x) => [x.id, x.label]), [[sketch, "Sketch 1"], ["feature-3", "Box 2"]]);
  assert.equal(one.intent.summary, "Extrude Sketch 1 by 20 mm, joined to Box 2");
  // Its sketch deleted: the summary names it as the extrude remembers it.
  const gone: DesignDocument = { ...doc, sketches: doc.sketches.filter((x) => x.id !== sketch), timeline: { ...doc.timeline, features: doc.timeline.features.filter((f) => f.id !== sketch) } };
  assert.equal(setExtrudeOperation(gone, id, { operation: "intersect", bodies }).timeline.features.at(-1)!.intent.summary, "Extrude Sketch 1 by 20 mm, intersected with Box 1 and Box 2");
});

test("the rebuild's failures word the operation: a body's item deleted, not built, or a piece used up", async () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
  // Box 2's item (feature-3) deleted from the file, with its Move: the extrude cuts what was Box 2.
  for (const [operation, verb] of [["cut", "cut"], ["join", "join to"], ["intersect", "intersect"]] as const) {
    const { doc, id } = extruded(two, [2, 2], [26, 6], 20, { operation, bodies: operation === "join" ? [bodies[1], bodies[0]] : [bodies[1]] });
    const d = json(doc);
    d.timeline.features = d.timeline.features.filter((f: any) => f.id !== "feature-3" && f.id !== "feature-4");
    const read = readDesignDocument(d);
    const b = await built(read);
    assert.deepEqual(b.build.results[id], { status: "failed", cause: "deleted-input", input: "feature-3", message: `Box 2 was deleted, so Extrude 1 has nothing to ${verb}` });
    // All or none: Box 1 is as it was (1,000 mm³).
    near(await b.volume(bodies[0]), 1000);
    await b.cache.close();
  }
  // Not built: Extrude 1, a new body of a sketch whose outline no longer closes and with nothing kept, then Extrude 2 cuts it.
  {
    const first = extruded(two, [2, 2], [6, 6], 20, null);
    const second = extruded(first.doc, [2, 2], [6, 6], 5, { operation: "cut", bodies: [`body:${first.id}`] });
    const open = deleteCurve(second.doc, first.sketch, first.lines[0]);
    const b = await built({ ...open, kept: {} });
    assert.equal(b.build.results[first.id].status, "failed");
    assert.deepEqual(b.build.results[second.id], { status: "failed", cause: "failed-input", input: first.id, message: "Extrude 1 is not built, so Extrude 2 can't use it" });
    await b.cache.close();
  }
  // A piece used up: the slot's far piece joined into a box by a Combine, then cut by an extrude.
  {
    const { doc: bar, bodies: barBody } = boxes([[100, 20, 10], [0, 0, 0]]);
    const slot = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies: barBody });
    const piece = `body:${slot.id}/piece:1`;
    const numbered = numberPieces(slot.doc, [piece]);
    const box = insertPreset(numbered, "box", 100, 20, 10);
    const joined = insertCombine(box.doc, `body:${box.id}`, [piece], "join").doc;
    const again = extruded(joined, [50, 2], [60, 6], 20, { operation: "cut", bodies: [piece] });
    const b = await built(again.doc);
    assert.deepEqual(b.build.results[again.id], { status: "failed", cause: "failed-input", input: slot.id, message: "Extrude 2 can't use a piece: an earlier Combine or extrude used it up or left no such piece" });
    await b.cache.close();
  }
});

test("greyed: by the suppressed item itself, or by what greyed the item it uses, for an extrude and a Combine alike", async () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
  // Extrude 1 a new body of Sketch 1; Extrude 2 cuts it; Combine 1 joins Box 1 and Extrude 1's body.
  const first = extruded(two, [2, 2], [6, 6], 20, null);
  const second = extruded(first.doc, [3, 3], [5, 5], 5, { operation: "cut", bodies: [`body:${first.id}`] });
  const combined = insertCombine(second.doc, bodies[0], [`body:${first.id}`], "join");
  // Sketch 1 suppressed greys Extrude 1 (by Sketch 1), so Extrude 2 and Combine 1 are greyed by Sketch 1 too, not by Extrude 1.
  const off = suppressItem(combined.doc, first.sketch, true);
  const b = await built(off);
  assert.deepEqual(b.build.results[first.id], { status: "greyed", by: first.sketch });
  assert.deepEqual(b.build.results[second.id], { status: "greyed", by: first.sketch });
  assert.deepEqual(b.build.results[combined.id], { status: "greyed", by: first.sketch });
  await b.cache.close();
  // Extrude 1 itself suppressed: greyed by Extrude 1.
  const self = suppressItem(combined.doc, first.id, true);
  const c = await built(self);
  assert.deepEqual(c.build.results[second.id], { status: "greyed", by: first.id });
  assert.deepEqual(c.build.results[combined.id], { status: "greyed", by: first.id });
  await c.cache.close();
});

test("hand-worked: a Cut through two bars numbers its pieces on across them; the target keeps its item, the pieces are the extrude's", async () => {
  // Bars x 0..100, y 0..20 at z 0..10 and at y 40..60; a slot x 30..40, y −10..70 extruded 20 mm up cuts both in two.
  const { doc: bars, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[100, 20, 10], [0, 40, 0]]);
  const { doc, id } = extruded(bars, [30, -10], [40, 70], 20, { operation: "cut", bodies });
  const b = await built(doc);
  assert.equal(b.build.results[id].status, "built");
  const r = b.build.results[id];
  // Each bar keeps x 0..30 (30 × 20 × 10 = 6,000 mm³); its far part x 40..100 (12,000) is piece 1, then piece 2.
  assert.deepEqual(r.status === "built" && r.bodies, [bodies[0], `body:${id}/piece:1`, bodies[1], `body:${id}/piece:2`]);
  for (const body of bodies) near(await b.volume(body), 6000);
  for (const k of [1, 2]) near(await b.volume(`body:${id}/piece:${k}`), 12000);
  // The bars stay their items' bodies; the pieces are the extrude's.
  assert.equal(b.build.bodies[bodies[0]].feature, "feature-1");
  assert.equal(b.build.bodies[bodies[1]].feature, bodies[1].slice("body:".length));
  assert.equal(b.build.bodies[`body:${id}/piece:2`].feature, id);
  // The second bar was moved (y 40): its frame kept with it, so a sketch on its face follows the Move (35f1e2).
  assert.ok(b.build.bodies[bodies[1]].frames !== undefined);
  // The extrude's own body is used up: no body:<extrude>.
  assert.equal(b.build.bodies[`body:${id}`], undefined);
  await b.cache.close();
});

test("hand-worked: two boxes alike in the same place are two bodies to the kernel, so a Join of both with the extrude works", async () => {
  // Both 10 mm cubes at x 0..10, y 0..10, z −5..5 (one kernel body for the cache), the square x 2..6 up to z 20: the union is the
  // cube and the 240 mm³ above it, 1,240 mm³, Box 2 used up.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [0, 0, -5]]);
  const { doc, id } = extruded(two, [2, 2], [6, 6], 20, { operation: "join", bodies });
  const b = await built(doc);
  assert.equal(b.build.results[id].status, "built", JSON.stringify(b.build.results[id]));
  assert.deepEqual(Object.keys(b.build.bodies), [bodies[0]]);
  near(await b.volume(bodies[0]), 1240);
  await b.cache.close();
});

test("a kept shape's warning is carried by an extrude with an operation, as by a new body", async () => {
  const { doc: cube, bodies } = boxes([[10, 10, 10], [0, 0, -5]]);
  const e = extruded(cube, [2, 2], [6, 6], 20, { operation: "cut", bodies });
  const whole = e.doc.sketches.find((s) => s.id === e.sketch)!;
  const open = deleteCurve(e.doc, e.sketch, e.lines[0]);
  const b = await built({ ...open, kept: { [e.id]: { points: whole.points, curves: whole.curves } } });
  const r = b.build.results[e.id];
  assert.equal(r.status, "built");
  assert.ok(r.status === "built" && r.warning !== undefined, "the kept shape's warning");
  near(await b.volume(bodies[0]), 920);
  await b.cache.close();
});

/** Sketch `sketchId` with the closed polyline through `corners` (each line from the last one's end, the last back to the first). */
function polyline(doc: DesignDocument, sketchId: string, corners: [number, number][]): DesignDocument {
  let d = drawLine(doc, sketchId, corners[0], corners[1]);
  const first = d.doc.sketches.find((s) => s.id === sketchId)!.curves.find((c) => c.id === d.id)! as { start: string; end: string };
  let end = first.end;
  for (let i = 2; i < corners.length; i++) {
    d = drawLine(d.doc, sketchId, end, corners[i]);
    end = (d.doc.sketches.find((s) => s.id === sketchId)!.curves.find((c) => c.id === d.id)! as { end: string }).end;
  }
  return drawLine(d.doc, sketchId, end, first.start).doc;
}

test("hand-worked: a comb cutting two bars in three each numbers the four pieces on across them, piece 1 to 4", async () => {
  // Bars x 0..100, y 0..20, one at z 0..5, one moved up to z 10..15. The comb: prongs x 20..30 and x 60..70 down from a
  // bridge y 30..40 (outside the bars), extruded z 0..20, so each bar is cut at x 20..30 and x 60..70 into x 0..20
  // (20 × 20 × 5 = 2,000 mm³), x 30..60 and x 70..100 (30 × 20 × 5 = 3,000 each): one keeps the bar's id, two are pieces.
  const { doc: bars, bodies } = boxes([[100, 20, 5], [0, 0, 0]], [[100, 20, 5], [0, 0, 10]]);
  const s = addSketch(bars);
  const comb = polyline(s.doc, s.id, [[20, -10], [30, -10], [30, 30], [60, 30], [60, -10], [70, -10], [70, 40], [20, 40]]);
  const { doc, id } = extrudeSketch(comb, s.id, 20, false, undefined, { operation: "cut", bodies });
  const b = await built(doc);
  const r = b.build.results[id];
  assert.equal(r.status, "built", JSON.stringify(r));
  const pieces = [1, 2, 3, 4].map((k) => `body:${id}/piece:${k}`);
  assert.deepEqual(Object.keys(b.build.bodies).sort(), [...bodies, ...pieces].sort());
  // The first bar's two pieces are 1 and 2, the second's 3 and 4: each bar and its two pieces hold 8,000 mm³ (2,000 + 3,000 + 3,000).
  const vol = async (ids: string[]) => (await Promise.all(ids.map(b.volume))).reduce((x, y) => x + y, 0);
  near(await vol([bodies[0], pieces[0], pieces[1]]), 8000);
  near(await vol([bodies[1], pieces[2], pieces[3]]), 8000);
  const all = (await Promise.all([...bodies, ...pieces].map(b.volume))).sort((x, y) => x - y);
  all.forEach((v, i) => near(v, [2000, 2000, 3000, 3000, 3000, 3000][i]));
  // What the rebuild holds is kernel bodies (numbers), one per input of each boolean: two bars and the extrude twice.
  assert.ok(r.status === "built" && r.holds!.length === 4 && r.holds!.every((h) => typeof h === "number"));
  await b.cache.close();
});

test("a Combine whose target's item was deleted fails naming it, in a Combine's words; a name the file lacks is the id", async () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 0, 0]]);
  const c = insertCombine(two, bodies[1], [bodies[0]], "join");
  const d = json(c.doc);
  // Box 2 (feature-2) and its Move (feature-3) deleted.
  d.timeline.features = d.timeline.features.filter((f: any) => f.id !== "feature-2" && f.id !== "feature-3");
  const b = await built(readDesignDocument(d));
  assert.deepEqual(b.build.results[c.id], { status: "failed", cause: "deleted-input", input: "feature-2", message: "Box 2 was deleted, so Combine 1 has nothing to combine" });
  await b.cache.close();
  // The same with the Combine's provenance not naming Box 2: called by its id.
  d.timeline.features.at(-1).provenance.from = d.timeline.features.at(-1).provenance.from.filter((x: any) => x.id !== "feature-2");
  const n = await built(readDesignDocument(d));
  assert.equal(n.build.results[c.id].status === "failed" && (n.build.results[c.id] as { message: string }).message, "feature-2 was deleted, so Combine 1 has nothing to combine");
  await n.cache.close();
  // And an extrude's summary, its provenance not naming its body's item, names the id.
  const { doc: e } = extruded(two, [2, 2], [6, 6], 20, { operation: "cut", bodies: [bodies[0]] });
  const f = json(e);
  f.timeline.features.at(-1).provenance.from = f.timeline.features.at(-1).provenance.from.filter((x: any) => x.id !== "feature-1");
  const read = readDesignDocument(f);
  assert.equal(setExtrudeDistance(read, 5, read.timeline.features.at(-1)!.id).timeline.features.at(-1)!.intent.summary, "Extrude Sketch 1 by 5 mm, cut from feature-1");
});

test("the panel's choices at the edges: a name that is no body id, a body made at the marker's place, a piece Combine can't take unnumbered", async () => {
  // Sketch 1 first, then Box 1 and Box 2; the marker after Box 1, so a new extrude goes in at Box 2's place.
  const s = addSketch(partDocument("box", 10, 10, 10));
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  const two = insertPreset(drawn, "box", 10, 10, 10);
  const ordered: DesignDocument = { ...two.doc, timeline: { ...two.doc.timeline, features: [two.doc.timeline.features[1], two.doc.timeline.features[0], two.doc.timeline.features[2]] } };
  const box1 = ordered.timeline.features[1].id;
  const rolled: DesignDocument = { ...ordered, timeline: { ...ordered.timeline, marker: box1 } };
  const cut = (picked: string[]) => () => extrudeSketch(rolled, s.id, 5, false, undefined, { operation: "cut", bodies: picked });
  assert.doesNotThrow(cut([`body:${box1}`]));
  assert.throws(cut([`body:${two.id}`]), { message: "Box 2 comes after the rollback marker, so an extrude put in at the marker can't use it" });
  // "Box 2" is no body id, though the item at place 1 (Box 1) makes a body.
  assert.throws(cut(["Box 2"]), { message: "Box 2 is not a body in the design" });
  // Combine: a piece of the cut's not yet numbered, and a "piece" of a box, are no bodies.
  const { doc: bar, bodies: barBody } = boxes([[100, 20, 10], [0, 0, 0]]);
  const slot = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies: barBody });
  const box = insertPreset(slot.doc, "box", 5, 5, 5);
  assert.throws(() => insertCombine(box.doc, `body:${box.id}`, [`body:${slot.id}/piece:1`], "join"), { message: `body:${slot.id}/piece:1 is not a body in the design` });
  const numbered = numberPieces(box.doc, [`body:${slot.id}/piece:1`]);
  assert.throws(() => insertCombine(numbered, `body:${box.id}`, [`${barBody[0]}/piece:1`], "join"), { message: `${barBody[0]}/piece:1 is not a body in the design` });
});

test("the reader: an operation's piece must be numbered and an operation extrude's; a shut eye on one is kept; too many bodies refused in words", () => {
  const { doc: bar, bodies } = boxes([[100, 20, 10], [0, 0, 0]]);
  const slot = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies });
  const piece = `body:${slot.id}/piece:1`;
  const numbered = numberPieces(slot.doc, [piece]);
  const again = extruded(numbered, [50, 2], [60, 6], 20, { operation: "cut", bodies: [piece] });
  assert.deepEqual(readDesignDocument(json(again.doc)), again.doc);
  const at = `Design extrude ${again.id}`;
  const d = json(again.doc);
  d.bodies = d.bodies.filter((b: any) => b.id !== piece);
  assert.throws(() => readDesignDocument(d), { message: `${at}: ${piece} is not a body made before it in the timeline` });
  // A piece's eye shut: kept; a box's "piece" numbered in the list: refused.
  const hidden = { ...again.doc, hidden: [piece] };
  assert.deepEqual(readDesignDocument(json(hidden)).hidden, [piece]);
  const boxPiece = json(again.doc);
  boxPiece.bodies.push({ id: `${bodies[0]}/piece:1`, number: 99 });
  boxPiece.nextBody = 100;
  assert.throws(() => readDesignDocument(boxPiece), /piece/);
  const many = json(again.doc);
  many.timeline.features.at(-1).intent.parameters.bodies = Array.from({ length: 5001 }, (_, i) => `body:feature-${i + 1}`);
  assert.throws(() => readDesignDocument(many), /^Error: Design extrude feature-\d+ names 5001 bodies, more than the 5000 this SpindleLabs opens$/);
});

test("Edit's operation names the sketch as it is called now, or as the extrude remembers it, or by its id", () => {
  const { doc: cube, bodies } = boxes([[10, 10, 10], [0, 0, -5]]);
  const { doc, id, sketch } = extruded(cube, [2, 2], [6, 6], 20, null);
  // Renamed since: the sketch's name now.
  const renamed: DesignDocument = { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === sketch ? { ...f, provenance: { ...f.provenance, self: { ...f.provenance.self, label: "Profile A" } } } : f)) } };
  assert.equal(setExtrudeOperation(renamed, id, { operation: "cut", bodies }).timeline.features.at(-1)!.intent.summary, "Extrude Profile A by 20 mm, cut from Box 1");
  // Deleted and not remembered: its id.
  const gone: DesignDocument = {
    ...doc,
    sketches: doc.sketches.filter((x) => x.id !== sketch),
    timeline: { ...doc.timeline, features: doc.timeline.features.filter((f) => f.id !== sketch).map((f) => (f.id === id ? { ...f, provenance: { ...f.provenance, from: [] } } : f)) },
  };
  assert.equal(setExtrudeOperation(gone, id, { operation: "cut", bodies }).timeline.features.at(-1)!.intent.summary, `Extrude ${sketch} by 20 mm, cut from Box 1`);
});

test("Edit's operation off and on again: another extrude's shut piece stays shut; a later Combine or extrude using the body refuses it", async () => {
  // Bar x 0..100 cut through by Extrude 1 (a slot, its far piece 1 hidden), and Extrude 2, a new body, cut by nothing yet.
  const { doc: bar, bodies } = boxes([[100, 20, 10], [0, 0, 0]]);
  const slot = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies });
  const piece = `body:${slot.id}/piece:1`;
  const second = extruded(numberPieces(slot.doc, [piece]), [50, 2], [60, 6], 20, { operation: "cut", bodies });
  const shut = numberPieces({ ...second.doc, hidden: [piece] }, [`body:${second.id}/piece:1`]);
  // Extrude 2 back to a new body: its own pieces go, Extrude 1's piece stays hidden.
  assert.deepEqual(setExtrudeOperation(shut, second.id, null).hidden, [piece]);
  // Extrude 1 back to a new body: its piece goes, and so does its eye.
  assert.equal(setExtrudeOperation({ ...slot.doc, ...numberPieces(slot.doc, [piece]), hidden: [piece] }, slot.id, null).hidden, undefined);
  // A new body used by a later Combine, or by a later extrude's operation, can't become a Join.
  const plain = extruded(bar, [2, 2], [6, 6], 20, null);
  const used = insertCombine(plain.doc, bodies[0], [`body:${plain.id}`], "join").doc;
  assert.throws(() => setExtrudeOperation(used, plain.id, { operation: "join", bodies }), { message: "Combine 1 uses Body 2, which Extrude 1 would no longer make: change or delete Combine 1 first" });
  const usedByCut = extruded(plain.doc, [3, 3], [5, 5], 5, { operation: "cut", bodies: [`body:${plain.id}`] }).doc;
  assert.throws(() => setExtrudeOperation(usedByCut, plain.id, { operation: "join", bodies }), { message: "Extrude 2 uses Body 2, which Extrude 1 would no longer make: change or delete Extrude 2 first" });
});
