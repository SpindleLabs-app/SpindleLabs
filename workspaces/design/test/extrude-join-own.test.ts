// Design data version 16 (Combine hunt, 2026-11-08): an Extrude Join's
// piece holding only the extrude is the extrude's own body, body:<the
// extrude> (docs/document-model.md section 8), where version 15 named it
// body:<the extrude>/piece:1. When there are several such pieces the first
// by rank keeps the id and the others are numbered from 1, as a Cut's; each
// is remembered by its faces, the extrude's own id too. Version 15 files are
// renamed on opening (migrateDesignV15) and build the same bodies at the
// same places. Every volume is worked out by hand from the boxes' corners
// and the sketch's rectangle in the comment beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { combineNames, shownFaces, type NamedBody } from "../src/boolean-names.ts";
import { bodyRows } from "../src/browser.ts";
import { migrateDesignV15, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, setExtrudeOperation, type OperationChoice } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { deleteItem, hideBody } from "../src/timeline-edits.ts";
import { block, buildBlock, kernel as blockKernel } from "./boolean-combine.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got}, expected ${want}`);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** `doc` with a rectangle from `a` to `c` sketched on XY (z = 0) and extruded `distance` mm up with `choice`. */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice | null) {
  const s = addSketch(doc);
  return extrudeSketch(drawRectangle(s.doc, s.id, a, c).doc, s.id, distance, false, undefined, choice);
}

/** `doc` built, its pieces numbered (and their faces remembered) as the workspace takes them in after a rebuild. */
async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const views = Object.fromEntries(await Promise.all(Object.keys(build.bodies).map(async (id) => [id, await cache.view(build.bodies[id].handle)] as const)));
  await cache.close();
  return { build, doc: numberPieces(doc, Object.keys(build.bodies), builtPieceFaces(build)), views };
}

/** A 10 mm cube at the origin and the square x 20..24, y 0..4 extruded 10 up joined to it: apart from it. */
function apart() {
  const doc0 = partDocument("box", 10, 10, 10);
  const cube = `body:${doc0.timeline.features[0].id}`;
  const e = extruded(doc0, [20, 0], [24, 4], 10, { operation: "join", bodies: [cube] });
  return { doc: e.doc, cube, id: e.id, own: `body:${e.id}` };
}

test("hand-worked: an Extrude Join touching nothing it picked is two bodies, the cube and body:<the extrude>, numbered with its faces", async () => {
  const a = apart();
  const b = await built(a.doc);
  // The cube keeps its id (10³ = 1,000); the extrude's piece holds only the extrude, so it is the extrude's own body,
  // never a piece: 4 × 4 × 10 = 160, x 20..24.
  assert.deepEqual(Object.keys(b.build.bodies).sort(), [a.cube, a.own].sort());
  const r = b.build.results[a.id];
  assert.ok(r.status === "built");
  assert.deepEqual(r.bodies, [a.cube, a.own]);
  near(b.views[a.cube].volume, 1000);
  near(b.views[a.own].volume, 160);
  assert.deepEqual(b.views[a.own].bounds, [[20, 0, 0], [24, 4, 10]]);
  // Numbered once built (the cube is Body 1, so it is Body 2), with its six faces as the extrude made them: start, end
  // and the rectangle's four sides.
  const sides = (r.status === "built" && r.pieceFaces?.[a.own]) || [];
  assert.equal(sides.length, 6);
  assert.deepEqual(b.doc.bodies!.find((x) => x.id === a.own), { id: a.own, number: 2, faces: [...sides].sort() });
  assert.ok(sides.every((n) => n.startsWith(`face:${a.id}/`)), JSON.stringify(sides));
  // The browser shows it, and a saved file holding it opens as it was.
  assert.deepEqual(bodyRows(b.doc).map((x) => [x.label, x.body]), [["Body 1", a.cube], ["Body 2", a.own]]);
  assert.deepEqual(readDesignDocument(json(b.doc)), b.doc);
});

test("an Extrude Join's own body can be moved, hidden and is forgotten with its extrude; one wholly joined is no body", async () => {
  const a = apart();
  const b = await built(a.doc);
  // Moved 100 along x: x 120..124.
  const m = insertMove(b.doc, [a.own], { ...NO_MOVE, x: 100 });
  const hidden = hideBody(m.doc, a.own, true);
  assert.deepEqual(hidden.hidden, [a.own]);
  assert.deepEqual(readDesignDocument(json(hidden)), hidden);
  const c = await built(hidden);
  assert.deepEqual(c.views[a.own].bounds, [[120, 0, 0], [124, 4, 10]]);
  // Deleting the extrude takes its own body's number and its eye with it (the Move then names a body whose item is gone).
  const gone = deleteItem(c.doc, a.id);
  assert.equal(gone.bodies!.some((x) => x.id === a.own), false);
  assert.equal(gone.hidden, undefined);
  // The square x 5..9 overlapping the cube: one piece, holding the cube, so the cube's id: no own body, and its eye is refused.
  const doc0 = partDocument("box", 10, 10, 10);
  const into = extruded(doc0, [5, 0], [9, 4], 10, { operation: "join", bodies: ["body:feature-1"] });
  const d = await built(into.doc);
  assert.deepEqual(Object.keys(d.build.bodies), ["body:feature-1"]);
  // x 5..9, y 0..4, z 0..10 lies inside the cube's x 0..10, y 0..10, z 0..10, so the union is the cube: 1,000.
  near(d.views["body:feature-1"].volume, 1000);
  assert.throws(() => hideBody(d.doc, `body:${into.id}`, true), /joins, cuts or intersects other bodies, so it has no body of its own to hide/);
  assert.throws(() => insertMove(d.doc, [`body:${into.id}`], { ...NO_MOVE, x: 1 }), /is not a body in the design/);
});

test("the Join made a Cut gives up its own body (refused while a Move uses it); made a new body again it keeps the number, without faces", async () => {
  const a = apart();
  const b = await built(a.doc);
  const n = b.doc.bodies!.find((x) => x.id === a.own)!.number;
  const m = insertMove(b.doc, [a.own], { ...NO_MOVE, x: 100 });
  assert.throws(() => setExtrudeOperation(m.doc, a.id, { operation: "cut", bodies: [a.cube] }), new RegExp(`uses Body ${n}, which .* would no longer make`));
  const cut = setExtrudeOperation(hideBody(b.doc, a.own, true), a.id, { operation: "cut", bodies: [a.cube] });
  assert.equal(cut.bodies!.some((x) => x.id === a.own), false);
  assert.equal(cut.hidden, undefined);
  assert.deepEqual(readDesignDocument(json(cut)), cut);
  const fresh = setExtrudeOperation(b.doc, a.id, null);
  assert.deepEqual(fresh.bodies!.find((x) => x.id === a.own), { id: a.own, number: n });
  assert.deepEqual(readDesignDocument(json(fresh)), fresh);
});

test("the file checks: an Extrude Join's own body may be listed with faces; a Cut's own body, or faces on a new body's, are refused", async () => {
  const b = await built(apart().doc);
  const ok = json(b.doc);
  assert.deepEqual(readDesignDocument(ok), b.doc);
  const ext = ok.timeline.features.find((f) => f.intent.type === "extrude")!;
  // Each break of the valid file in exactly one way, with its own words.
  const asCut = json(ok);
  asCut.timeline.features.find((f) => f.id === ext.id)!.intent.parameters.operation = "cut";
  assert.throws(() => readDesignDocument(asCut), { message: `Design body body:${ext.id} is not "body:" and the id of an item that makes a body, or a piece of a Combine or of an extrude that joins, cuts or intersects` });
  const asNew = json(ok);
  const p = asNew.timeline.features.find((f) => f.id === ext.id)!;
  delete p.intent.parameters.operation;
  delete p.intent.parameters.bodies;
  p.dependsOn = [p.dependsOn[0]];
  assert.throws(() => readDesignDocument(asNew), { message: `Design body body:${ext.id} has faces, which only a Combine's piece remembers` });
  const plain = json(asNew);
  plain.bodies = plain.bodies!.map(({ id, number }) => ({ id, number }));
  assert.equal(readDesignDocument(plain).bodies!.length, 2);
});

// ---------------------------------------------------------------- several pieces holding only the extrude

/** Box T (x 0..10, the joined body), and A (x 20..24, 4 × 4 × 10 = 160) and B (x 40..46, 6 × 6 × 10 = 360), the extrude's two lumps, unioned. */
async function threeApart() {
  const t = await buildBlock(block("feature-1", [0, 0, 10, 10], [0, 10]), 0);
  const a = await buildBlock(block("feature-2", [20, 0, 24, 4], [0, 10]), 1);
  const b = await buildBlock(block("feature-3", [40, 0, 46, 6], [0, 10]), 2);
  const result = await blockKernel.call("body_boolean", t.handle, [a.handle, b.handle], "union");
  const views = await Promise.all(result.bodies.map((h) => blockKernel.call("body_view", h)));
  const at = (x0: number) => result.bodies[views.findIndex((v) => v.bounds[0][0] === x0)];
  const target: NamedBody = { ...t, keepsId: 0 };
  const names = (remembered: Map<string, readonly string[]>, own?: string) => {
    const r = combineNames("feature-9", "union", target, [a, b], result, views, 1, remembered, own);
    assert.ok(!("failed" in r));
    return { ids: new Map(r.bodies.map((x) => [x.handle, x.id])), faces: new Map(r.bodies.map((x) => [x.handle, shownFaces(x.faces)])), renumbered: r.renumbered, nextPiece: r.nextPiece };
  };
  return { T: at(0), A: at(20), B: at(40), names };
}

test("hand-worked: two pieces hold only the extrude: the first by rank (larger first) is body:<extrude>, the other piece 1; remembered faces keep each", async () => {
  const { T, A, B, names } = await threeApart();
  const own = "body:feature-9";
  // No face of T reaches A or B, so they rank by volume, larger first: B (360) before A (160). B is the extrude's own
  // body, A is piece 1; T keeps its id.
  const first = names(new Map(), own);
  assert.deepEqual([first.ids.get(T), first.ids.get(B), first.ids.get(A)], ["body:feature-1", own, "body:feature-9/piece:1"]);
  assert.deepEqual(first.renumbered, []);
  // The own id is number 1 and piece 1 number 2 (issue #424): piece 1 is taken, so the next piece made is piece 2.
  assert.equal(first.nextPiece, 2);
  // B remembered as piece 1 (by its faces): it stays piece 1, and the own id goes to the first piece left, A.
  const swapped = names(new Map([["body:feature-9/piece:1", first.faces.get(B)!]]), own);
  assert.deepEqual([swapped.ids.get(B), swapped.ids.get(A)], ["body:feature-9/piece:1", own]);
  // The own id remembered with A's faces does the same; remembered with faces no piece has, it goes by rank, with a warning.
  assert.deepEqual(names(new Map([[own, first.faces.get(A)!]]), own).ids.get(A), own);
  const lost = names(new Map([[own, ["face:feature-7/top"]]]), own);
  assert.deepEqual([lost.ids.get(B), lost.ids.get(A), lost.renumbered], [own, "body:feature-9/piece:1", [own]]);
});

test("self-consistency: with every remembered set, version 16's names are version 15's renamed as the upgrade renames them", async () => {
  const { names } = await threeApart();
  const fifteen = names(new Map());
  const keys = [...fifteen.faces.values()];
  const rename = (id: string) => (id === "body:feature-9/piece:1" ? "body:feature-9" : id === "body:feature-9/piece:2" ? "body:feature-9/piece:1" : id);
  const choices: (readonly string[] | undefined)[] = [undefined, keys[1], keys[2], ["face:feature-7/top"]];
  for (const one of choices)
    for (const two of choices) {
      const old = new Map<string, readonly string[]>([...(one ? [["body:feature-9/piece:1", one] as const] : []), ...(two ? [["body:feature-9/piece:2", two] as const] : [])]);
      const v15 = names(old);
      const v16 = names(new Map([...old].map(([id, f]) => [rename(id), f])), "body:feature-9");
      assert.deepEqual(new Map([...v15.ids].map(([h, id]) => [h, rename(id)])), v16.ids, JSON.stringify([one, two]));
      assert.deepEqual(v15.renumbered.map(rename), v16.renumbered);
    }
});

// ---------------------------------------------------------------- version 15 files

// Saved by main a8fd6ec4 (version 15) with its own document functions and rebuild, on the node kernel: Box 1 a 10 mm
// cube (feature-1); Sketch 1's square x 20..24, y 0..4 extruded 10 up as a Join with the cube (feature-11), apart from it,
// so its piece was body:feature-11/piece:1 (Body 2, its six faces remembered); Sketch 2 on that piece's top
// (face:feature-11/end) with a circle of radius 1 round (22, 2), extruded 5 (feature-15); Move 1 the piece 100 along x
// (feature-16); Copy 1 of the piece (feature-17); Combine 1 cutting the piece from the cube, keeping it (feature-18,
// they don't meet); Sketch 3's square x 121..123, y 1..3 cut 20 up out of the piece (feature-28); the piece's eye shut.
// Main built: the cube 1,000 at 0..10; the piece 4 × 4 × 10 − 2 × 2 × 10 = 120 at x 120..124, y 0..4, z 0..10; the
// cylinder π · 1² · 5 = 5π at x 21..23, y 1..3, z 10..15 (on the top where the piece was drawn); the copy 160 at x 120..124.
const V15 = String.raw`{"version":15,"nextId":29,"profiles":[],"sketches":[{"id":"sketch-2","points":[{"id":"point-3","x":20,"y":0},{"id":"point-4","x":24,"y":0},{"id":"point-6","x":24,"y":4},{"id":"point-8","x":20,"y":4}],"curves":[{"id":"line-5","kind":"line","start":"point-3","end":"point-4"},{"id":"line-7","kind":"line","start":"point-4","end":"point-6"},{"id":"line-9","kind":"line","start":"point-6","end":"point-8"},{"id":"line-10","kind":"line","start":"point-8","end":"point-3"}],"constraints":[]},{"id":"sketch-12","points":[{"id":"point-13","x":22,"y":2}],"curves":[{"id":"circle-14","kind":"circle","centre":"point-13","radius":1}],"constraints":[],"face":{"frame":{"origin":[0,0,10],"xAxis":[1,0,0],"normal":[0,0,1]},"side":1}},{"id":"sketch-19","points":[{"id":"point-20","x":121,"y":1},{"id":"point-21","x":123,"y":1},{"id":"point-23","x":123,"y":3},{"id":"point-25","x":121,"y":3}],"curves":[{"id":"line-22","kind":"line","start":"point-20","end":"point-21"},{"id":"line-24","kind":"line","start":"point-21","end":"point-23"},{"id":"line-26","kind":"line","start":"point-23","end":"point-25"},{"id":"line-27","kind":"line","start":"point-25","end":"point-20"}],"constraints":[]}],"timeline":{"features":[{"id":"feature-1","intent":{"type":"box","parameters":{"width":10,"depth":10,"height":10},"summary":"Box: 10 \u00d7 10 \u00d7 10 mm"},"provenance":{"self":{"workspace":"design","id":"feature-1","label":"Box 1"},"from":[]},"dependsOn":[],"suppressed":false},{"id":"sketch-2","intent":{"type":"sketch","parameters":{"plane":"XY"},"summary":"Sketch 1 on the XY plane"},"provenance":{"self":{"workspace":"design","id":"sketch-2","label":"Sketch 1"},"from":[]},"dependsOn":[],"suppressed":false},{"id":"feature-11","intent":{"type":"extrude","parameters":{"sketch":"sketch-2","distance":10,"operation":"join","bodies":["body:feature-1"]},"summary":"Extrude Sketch 1 by 10 mm, joined to Box 1"},"provenance":{"self":{"workspace":"design","id":"feature-11","label":"Extrude 1"},"from":[{"workspace":"design","id":"sketch-2","label":"Sketch 1"},{"workspace":"design","id":"feature-1","label":"Box 1"}]},"dependsOn":["sketch-2","feature-1"],"suppressed":false},{"id":"sketch-12","intent":{"type":"sketch","parameters":{"plane":"face:feature-11/end"},"summary":"Sketch 2 on a face of Extrude 1"},"provenance":{"self":{"workspace":"design","id":"sketch-12","label":"Sketch 2"},"from":[{"workspace":"design","id":"feature-11","label":"Extrude 1"}]},"dependsOn":["feature-11"],"suppressed":false},{"id":"feature-15","intent":{"type":"extrude","parameters":{"sketch":"sketch-12","distance":5},"summary":"Extrude Sketch 2 by 5 mm"},"provenance":{"self":{"workspace":"design","id":"feature-15","label":"Extrude 2"},"from":[{"workspace":"design","id":"sketch-12","label":"Sketch 2"}]},"dependsOn":["sketch-12"],"suppressed":false},{"id":"feature-16","intent":{"type":"move","parameters":{"x":100,"y":0,"z":0,"turnX":0,"turnY":0,"turnZ":0,"pivotX":0,"pivotY":0,"pivotZ":0,"bodies":["body:feature-11/piece:1"]},"summary":"Move Extrude 1 by (100, 0, 0) mm"},"provenance":{"self":{"workspace":"design","id":"feature-16","label":"Move 1"},"from":[{"workspace":"design","id":"feature-11","label":"Extrude 1"}]},"dependsOn":["feature-11"],"suppressed":false},{"id":"feature-17","intent":{"type":"duplicate","parameters":{"body":"body:feature-11/piece:1"},"summary":"Copy of a piece of Extrude 1"},"provenance":{"self":{"workspace":"design","id":"feature-17","label":"Copy 1"},"from":[{"workspace":"design","id":"feature-11","label":"Extrude 1"}]},"dependsOn":["feature-11"],"suppressed":false},{"id":"feature-18","intent":{"type":"combine","parameters":{"target":"body:feature-1","tools":["body:feature-11/piece:1"],"operation":"cut","keepTools":true},"summary":"Cut a piece of Extrude 1 from Box 1, keeping the tools"},"dependsOn":["feature-1","feature-11"],"provenance":{"self":{"workspace":"design","id":"feature-18","label":"Combine 1"},"from":[{"workspace":"design","id":"feature-1","label":"Box 1"},{"workspace":"design","id":"feature-11","label":"Extrude 1"}]},"suppressed":false},{"id":"sketch-19","intent":{"type":"sketch","parameters":{"plane":"XY"},"summary":"Sketch 3 on the XY plane"},"provenance":{"self":{"workspace":"design","id":"sketch-19","label":"Sketch 3"},"from":[]},"dependsOn":[],"suppressed":false},{"id":"feature-28","intent":{"type":"extrude","parameters":{"sketch":"sketch-19","distance":20,"operation":"cut","bodies":["body:feature-11/piece:1"]},"summary":"Extrude Sketch 3 by 20 mm, cut from a piece of Extrude 1"},"provenance":{"self":{"workspace":"design","id":"feature-28","label":"Extrude 3"},"from":[{"workspace":"design","id":"sketch-19","label":"Sketch 3"},{"workspace":"design","id":"feature-11","label":"Extrude 1"}]},"dependsOn":["sketch-19","feature-11"],"suppressed":false}]},"bodies":[{"id":"body:feature-1","number":1},{"id":"body:feature-11/piece:1","number":2,"faces":["face:feature-11/end","face:feature-11/side:line-10","face:feature-11/side:line-5","face:feature-11/side:line-7","face:feature-11/side:line-9","face:feature-11/start"]},{"id":"body:feature-15","number":3},{"id":"body:feature-17","number":4}],"nextBody":5,"hidden":["body:feature-11/piece:1"]}`;

test("upgrade: a version 15 file whose Join's piece a Move, a Copy, a Combine, a Cut and an eye use opens as 16 and builds the same bodies at the same places", async () => {
  const raw = JSON.parse(V15);
  assert.equal(raw.version, 15);
  const doc = readDesignDocument(raw);
  assert.equal(doc.version, 22);
  // Every name of the piece is the extrude's own id now, its number and faces kept; nothing else changed.
  const own = "body:feature-11";
  const was = "body:feature-11/piece:1";
  assert.deepEqual(doc.bodies, raw.bodies.map((b: { id: string }) => (b.id === was ? { ...b, id: own } : b)));
  const params = (id: string) => doc.timeline.features.find((f) => f.id === id)!.intent.parameters;
  assert.deepEqual(params("feature-16").bodies, [own]);
  assert.equal(params("feature-17").body, own);
  assert.deepEqual(params("feature-18").tools, [own]);
  assert.deepEqual(params("feature-28").bodies, [own]);
  assert.deepEqual(doc.hidden, [own]);
  assert.equal(JSON.stringify(doc).includes("piece:"), false);
  assert.equal(JSON.stringify({ ...doc, version: 15 }), JSON.stringify(raw).replaceAll(was, own));
  const b = await built(doc);
  for (const id of Object.keys(b.build.results)) assert.equal(b.build.results[id].status, "built", id);
  assert.deepEqual(Object.keys(b.build.bodies).sort(), ["body:feature-1", own, "body:feature-15", "body:feature-17"]);
  near(b.views["body:feature-1"].volume, 1000);
  assert.deepEqual(b.views["body:feature-1"].bounds, [[0, 0, 0], [10, 10, 10]]);
  near(b.views[own].volume, 120);
  assert.deepEqual(b.views[own].bounds, [[120, 0, 0], [124, 4, 10]]);
  near(b.views["body:feature-15"].volume, 5 * Math.PI);
  assert.deepEqual(b.views["body:feature-15"].bounds, [[21, 1, 10], [23, 3, 15]]);
  near(b.views["body:feature-17"].volume, 160);
  assert.deepEqual(b.views["body:feature-17"].bounds, [[120, 0, 0], [124, 4, 10]]);
  // The sketch on the piece's top is placed where main placed it, with no warning, and no piece is renumbered.
  const s = b.build.results["sketch-12"];
  assert.deepEqual(s, { status: "built", placement: { plane: { origin: [0, 0, 10], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1 } });
  assert.ok(Object.values(b.build.results).every((r) => r.status !== "built" || r.pieces === undefined));
  // Its bodies list unchanged by the build (the faces were remembered), and saved it is version 16 and reads back the same.
  assert.deepEqual(b.doc, doc);
  assert.deepEqual(readDesignDocument(json(doc)), doc);
});

test("upgrade, by hand: a Join's piece k is k − 1 and piece 1 the extrude's own id; a Cut's pieces and other ids stay; version 15 naming the own id is refused", () => {
  const join = { id: "feature-5", intent: { type: "extrude", parameters: { sketch: "sketch-2", distance: 1, operation: "join", bodies: ["body:feature-1"] } } };
  const cut = { id: "feature-6", intent: { type: "extrude", parameters: { sketch: "sketch-2", distance: 1, operation: "cut", bodies: ["body:feature-5/piece:2"] } } };
  const move = { id: "feature-7", intent: { type: "move", parameters: { bodies: ["body:feature-5/piece:1", "body:feature-6/piece:1", "body:feature-1", "body:feature-4/piece:3"] } } };
  const combine = { id: "feature-8", intent: { type: "combine", parameters: { target: "body:feature-5/piece:3", tools: ["body:feature-5/piece:1"] } } };
  const copy = { id: "feature-9", intent: { type: "duplicate", parameters: { body: "body:feature-5/piece:2" } } };
  const d = { version: 15, timeline: { features: [join, cut, move, combine, copy] }, bodies: [{ id: "body:feature-5/piece:2", number: 3, faces: ["face:feature-5/end"] }, { id: "body:feature-5/piece:1", number: 2 }, { id: "body:feature-6/piece:1", number: 4 }], hidden: ["body:feature-5/piece:1", "folder-origin"] };
  const up = migrateDesignV15(d) as typeof d;
  assert.equal(up.version, 16);
  assert.deepEqual(up.bodies, [{ id: "body:feature-5/piece:1", number: 3, faces: ["face:feature-5/end"] }, { id: "body:feature-5", number: 2 }, { id: "body:feature-6/piece:1", number: 4 }]);
  assert.deepEqual(up.hidden, ["body:feature-5", "folder-origin"]);
  const p = (k: number) => up.timeline.features[k].intent.parameters as Record<string, unknown>;
  assert.deepEqual(p(1).bodies, ["body:feature-5/piece:1"]);
  // A deleted item's piece (feature-4) and a Cut's (feature-6) are left as they are.
  assert.deepEqual(p(2).bodies, ["body:feature-5", "body:feature-6/piece:1", "body:feature-1", "body:feature-4/piece:3"]);
  assert.deepEqual([p(3).target, p(3).tools], ["body:feature-5/piece:2", ["body:feature-5"]]);
  assert.equal(p(4).body, "body:feature-5/piece:1");
  // No Join: only the version changes.
  assert.deepEqual(migrateDesignV15({ ...d, timeline: { features: [cut, move] } }), { ...d, version: 16, timeline: { features: [cut, move] } });
  // Version 15 never wrote a Join's own id: refused wherever it is named, never read as the piece it would become.
  for (const named of [{ ...d, hidden: ["body:feature-5"] }, { ...d, bodies: [{ id: "body:feature-5", number: 9 }] }, { ...d, timeline: { features: [join, { ...copy, intent: { type: "duplicate", parameters: { body: "body:feature-5" } } }] } }])
    assert.throws(() => migrateDesignV15(named), { message: "Design data says version 15 but names body:feature-5, an Extrude Join's own body, which version 16 brought" });
  // And through the reader: version 16 data with the same id is read as written.
  const b = { ...JSON.parse(V15), version: 15 };
  b.hidden = ["body:feature-11"];
  assert.throws(() => readDesignDocument(b), /says version 15 but names body:feature-11, an Extrude Join's own body/);
  assert.equal(readDesignDocument({ ...readDesignDocument(JSON.parse(V15)), version: 16 }).hidden![0], "body:feature-11");
});
