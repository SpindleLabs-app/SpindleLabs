// Step 35h2c-app1: the Shell item built by the real rebuild on the real kernel
// (rebuild.ts `shellRun`), its data (document.ts `checkShell`, Design data
// version 26) and `insertShell` (shell.ts). Every volume is worked out by hand
// from the box's sizes beside it: walls t thick inside a box take away the box
// moved in by t on every closed face, so a w × d × h box loses
// (w − 2t)(d − 2t)(h − 2t) sealed, (w − 2t)(d − 2t)(h − t) with its top open.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertShell, SHELL_STEP, shellSummary } from "../src/shell.ts";
import { changePreset, DESIGN_VERSION, insertPreset, insideWallName, partDocument, readDesignDocument, SHELL_MAX, SHELL_MIN, shellOf, type DesignDocument } from "../src/document.ts";
import { insertCombine } from "../src/combine.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem, suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { namedBody } from "../src/built-body.ts";

const kernel = nodeKernel();

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; view: (body: string) => Promise<BodyView> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, view: (body) => cache.view(build.bodies[body].handle) };
}

const near = (got: number, want: number, what = "") => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what} ${got}, expected ${want}`);

/** The shown name (as the screen gives it) of the face of `body` whose outward normal is `normal`, in `doc` as built; exactly one such face. */
async function faceFacing(doc: DesignDocument, body: string, normal: [number, number, number]): Promise<string> {
  const { build, cache } = await built(doc);
  const b = build.bodies[body];
  const nb = namedBody(body, b, await cache.view(b.handle), 0);
  const at = nb.view.face_normals.flatMap((n, i) => (n !== null && n !== undefined && n.every((x, k) => Math.abs(x - normal[k]) < 1e-12) ? [i] : []));
  await cache.clear();
  assert.equal(at.length, 1, `one face facing ${normal}`);
  const name = nb.faces[at[0]].names[0];
  assert.ok(name !== undefined, "the face has a name");
  return name;
}

const UP: [number, number, number] = [0, 0, 1];
const DOWN: [number, number, number] = [0, 0, -1];

/** The 10 mm cube (x, y, z 0..10) and its body. */
const cube = () => ({ doc: partDocument("box", 10, 10, 10), body: "body:feature-1" });

test("hand-worked: the 10 mm cube with its top open and 1 mm walls keeps 1000 − 8 · 8 · 9 = 424 mm³, its id and its faces' names; the inside walls are named after the faces they moved in from", async () => {
  const start = await kernel.call("body_count");
  const { doc: d0, body } = cube();
  const top = await faceFacing(d0, body, UP);
  const bottom = await faceFacing(d0, body, DOWN);
  const { doc, id } = insertShell(d0, body, [top], 1);
  assert.equal(doc.timeline.features.at(-1)!.intent.summary, "Shell Box 1, 1 mm walls, 1 face open");
  const { build, cache, view } = await built(doc);
  assert.equal(build.results[id].status, "built");
  // The inside taken away: x and y 1..9 (8 each), z 1..10 (9, the top not moved in): 576; 1,000 − 576 = 424.
  const v = await view(body);
  near(v.volume, 424, "volume");
  // Faces: the cube's six (its top now a ring round the opening) and five inside walls (four sides and the floor): 11.
  assert.equal(v.faces, 11);
  assert.deepEqual(Object.keys(build.bodies), [body], "one body, the cube's id");
  const named = build.bodies[body].named!;
  const all = named.faces.flatMap((f) => f.names);
  for (const role of ["top", "bottom", "front", "back", "left", "right"]) assert.ok(all.some((n) => n.startsWith(`face:feature-1/${role}`)), role);
  // The floor inside is the bottom moved up 1 mm, turned over: at z = 1, facing up, named after the bottom.
  const floorName = insideWallName(id, bottom);
  assert.equal(floorName, `face:${id}/inside:${encodeURIComponent(bottom)}`);
  const floor = named.faces.findIndex((f) => f.names.includes(floorName));
  assert.ok(floor >= 0, "the floor is named");
  assert.deepEqual(v.face_normals[floor], [0, 0, 1]);
  near(v.face_areas[floor], 64, "the floor: 8 × 8");
  // No inside wall is named after the top: it was left open.
  assert.ok(!all.includes(insideWallName(id, top)), "the open face has no inside wall");
  assert.equal(all.filter((n) => n.startsWith(`face:${id}/inside:`)).length, 5, "five inside walls");
  // The inside walls are the floor's turned faces: reversed against the faces they moved in from.
  assert.equal(build.bodies[body].reversed?.[floor], true);
  await cache.clear();
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("hand-worked: sealed (no open face) the 10 mm cube with 1 mm walls keeps 1000 − 8³ = 488 mm³, its six faces and six inside walls", async () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertShell(d0, body, [], 1);
  assert.equal(doc.timeline.features.at(-1)!.intent.summary, "Shell Box 1, 1 mm walls, sealed");
  const { build, cache, view } = await built(doc);
  assert.equal(build.results[id].status, "built");
  const v = await view(body);
  near(v.volume, 488, "volume");
  assert.equal(v.faces, 12);
  assert.equal(build.bodies[body].named!.faces.flatMap((f) => f.names).filter((n) => n.startsWith(`face:${id}/inside:`)).length, 6);
  await cache.clear();
});

test("hand-worked: the box made 20 wide before the Shell rebuilds it at 1000 · 2 − 18 · 8 · 9 = 704 mm³, the top found again by its name", async () => {
  const { doc: d0, body } = cube();
  const top = await faceFacing(d0, body, UP);
  const { doc: shelled, id } = insertShell(d0, body, [top], 1);
  const wider = changePreset(shelled, "feature-1", "box", 20, 10, 10);
  const { build, cache, view } = await built(wider);
  assert.equal(build.results[id].status, "built");
  // 20 × 10 × 10 = 2,000; inside 18 × 8 × 9 = 1,296; 2,000 − 1,296 = 704.
  near((await view(body)).volume, 704, "volume");
  await cache.clear();
});

test("hand-worked: a plate with a square hole, top and bottom open, falls apart into two tubes, 360 + 200 mm³: the outer keeps the body's id, the inner is the Shell's piece 1", async () => {
  // The cube cut through by a 4 × 4 bar at x, y 3..7 (z −1..11): a 10 × 10 plate 10 high with a 4 × 4 hole.
  const { doc: d0, body } = cube();
  const bar = insertPreset(d0, "box", 4, 4, 12);
  const moved = insertMove(bar.doc, [`body:${bar.id}`], { ...NO_MOVE, x: 3, y: 3, z: -1 });
  const cut = insertCombine(moved.doc, body, [`body:${bar.id}`], "cut");
  const top = await faceFacing(cut.doc, body, UP);
  const bottom = await faceFacing(cut.doc, body, DOWN);
  const { doc, id } = insertShell(cut.doc, body, [top, bottom], 1);
  const { build, cache, view } = await built(doc);
  assert.equal(build.results[id].status, "built", JSON.stringify(build.results[id]));
  const piece = `body:${id}/piece:1`;
  assert.deepEqual(Object.keys(build.bodies).sort(), [body, piece].sort());
  // Outer tube: 10 × 10 less 8 × 8 = 36 mm², 10 high: 360. Inner tube round the hole: 6 × 6 less 4 × 4 = 20 mm², 10 high: 200.
  near((await view(body)).volume, 360, "outer");
  near((await view(piece)).volume, 200, "inner");
  const r = build.results[id];
  assert.ok(r.status === "built" && r.pieceFaces !== undefined && piece in r.pieceFaces, "the piece is remembered by its faces");
  await cache.clear();
});

test("the Shell's refusals: a deleted, suppressed or failed body, a lost open face, and the kernel's own words for walls too thick", async () => {
  const { doc: d0, body } = cube();
  const top = await faceFacing(d0, body, UP);
  const { doc, id } = insertShell(d0, body, [top], 1);
  // Suppressed: greyed by the box.
  let b = await built(suppressItem(doc, "feature-1", true));
  assert.deepEqual(b.build.results[id], { status: "greyed", by: "feature-1" });
  await b.cache.clear();
  // Deleted: failed naming it.
  b = await built(deleteItem(doc, "feature-1"));
  const gone = b.build.results[id];
  assert.ok(gone.status === "failed" && gone.cause === "deleted-input" && /Box 1 was deleted, so Shell 1 has nothing to hollow out/.test(gone.message), JSON.stringify(gone));
  await b.cache.clear();
  // An open face no face carries: lost, in words.
  const lost = readDesignDocument(JSON.parse(JSON.stringify({ ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === id ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, faces: ["face:feature-1/side:nothing"] } } } : f)) } })));
  b = await built(lost);
  const l = b.build.results[id];
  assert.ok(l.status === "failed" && /Shell 1 can't find its open face on Box 1 any more/.test(l.message), JSON.stringify(l));
  await b.cache.clear();
  // Walls of 5 mm in a 10 mm cube meet in the middle: the kernel refuses, in its own words, and the cube stays as it was.
  const thick = insertShell(d0, body, [top], 5);
  b = await built(thick.doc);
  const t = b.build.results[thick.id];
  assert.ok(t.status === "failed" && t.cause === "error" && t.message.startsWith("Shell 1 can't be made: "), JSON.stringify(t));
  near((await b.view(body)).volume, 1000, "the cube unchanged");
  await b.cache.clear();
});

test("an open face an edit split in two is never guessed between: the Shell fails in words", async () => {
  // The cube's top is picked open, then a slot 2 wide (x 4..6) right across it (y −1..11, z 8..11) is cut before the
  // Shell, leaving the top as two pieces that both carry its name.
  const { doc: d0, body } = cube();
  const top = await faceFacing(d0, body, UP);
  const bar = insertPreset(d0, "box", 2, 12, 3);
  const moved = insertMove(bar.doc, [`body:${bar.id}`], { ...NO_MOVE, x: 4, y: -1, z: 8 });
  const cut = insertCombine(moved.doc, body, [`body:${bar.id}`], "cut");
  const { doc, id } = insertShell(cut.doc, body, [top], 1);
  const { build, cache } = await built(doc);
  const r = build.results[id];
  assert.ok(r.status === "failed" && /Shell 1 can't tell which face of Box 1 is its open face any more: an edit before it split it/.test(r.message), JSON.stringify(r));
  await cache.clear();
});

test("the Shell's data: written as version 26, read back the same; every part checked; version 25 data holding one refused", () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertShell(d0, body, ["face:feature-1/top"], 1);
  assert.equal(DESIGN_VERSION, 26);
  const saved = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(readDesignDocument(saved), doc);
  assert.deepEqual(shellOf(doc.timeline.features.find((f) => f.id === id)!), { body, faces: ["face:feature-1/top"], thickness: 1 });
  const broken = (change: (p: Record<string, unknown>, f: Record<string, unknown>) => void) => {
    const d = JSON.parse(JSON.stringify(doc));
    const f = d.timeline.features.find((x: { id: string }) => x.id === id);
    change(f.intent.parameters, f);
    return () => readDesignDocument(d);
  };
  assert.throws(broken((p) => (p.extra = 1)), /Design shell feature-2 has a parameter "extra" a shell doesn't have/);
  assert.throws(broken((p) => (p.body = "box")), /hollows box, which is not a body made before it/);
  // A body deleted since (an id below the counter no item has) reads; the rebuild fails the Shell naming it.
  assert.throws(broken((p) => (p.body = "body:feature-9")), /must depend on exactly the item that made the body it hollows \(feature-9\)/);
  assert.throws(broken((p) => (p.body = "body:feature-2")), /hollows body:feature-2, which is not a body made before it/);
  assert.throws(broken((p) => (p.faces = "face:feature-1/top")), /has no list of open faces/);
  assert.throws(broken((p) => (p.faces = ["face:feature-1/top", "face:feature-1/top"])), /names open face face:feature-1\/top twice/);
  assert.throws(broken((p) => (p.faces = ["edge:feature-1/top+front"])), /open face edge:feature-1\/top\+front is not a face's name/);
  assert.throws(broken((p) => (p.faces = [3])), /open face 3 is not a face's name/);
  assert.throws(broken((p) => (p.thickness = "1")), /wall thickness "1" is not from 0.001 to 1000000 mm/);
  assert.throws(broken((p) => (p.thickness = 0)), /wall thickness 0 is not from/);
  assert.throws(broken((p) => (p.thickness = Number.NaN)), /wall thickness null is not from|wall thickness NaN is not from/);
  assert.throws(broken((_, f) => (f.dependsOn = [])), /must depend on exactly the item that made the body it hollows \(feature-1\)/);
  // Version 25 data has no Shell: one there is refused, not built by a reader that would drop it.
  const old = { ...JSON.parse(JSON.stringify(doc)), version: 25 };
  assert.throws(() => readDesignDocument(old), /Design data says version 25 but has a Shell, which version 26 brought/);
  // Version 25 data with no Shell reads as it is.
  assert.equal(readDesignDocument({ ...JSON.parse(JSON.stringify(d0)), version: 25 }).version, 26);
});

test("the wall thickness's limits, 1 um and 1 km, at 0.9 x and 1.1 x: inside allowed, outside refused by insertShell and by the reader", () => {
  const { doc: d0, body } = cube();
  // SHELL_MIN = 0.001 mm (the kernel's MIN_FEATURE): 1.1 x = 0.0011 passes, 0.9 x = 0.0009 is refused.
  assert.equal(SHELL_MIN, 0.001);
  assert.equal(SHELL_MAX, 1_000_000);
  for (const ok of [SHELL_MIN, SHELL_MIN * 1.1, SHELL_MAX * 0.9, SHELL_MAX]) {
    const { doc } = insertShell(d0, body, [], ok);
    assert.equal(readDesignDocument(JSON.parse(JSON.stringify(doc))).timeline.features.length, 2, `${ok}`);
  }
  for (const bad of [SHELL_MIN * 0.9, SHELL_MAX * 1.1, -1, Infinity]) assert.throws(() => insertShell(d0, body, [], bad), /The shell can't be made: its wall thickness .* is not from 0.001 to 1000000 mm/, `${bad}`);
  const { doc } = insertShell(d0, body, [], 1);
  for (const bad of [SHELL_MIN * 0.9, SHELL_MAX * 1.1]) {
    const d = JSON.parse(JSON.stringify(doc));
    d.timeline.features[1].intent.parameters.thickness = bad;
    assert.throws(() => readDesignDocument(d), /wall thickness .* is not from 0.001 to 1000000 mm/, `${bad}`);
  }
});

test("insertShell's refusals and its undo step's name", () => {
  const { doc: d0, body } = cube();
  assert.equal(SHELL_STEP, "Shell body");
  assert.equal(shellSummary("Box 1", 2, 0.5), "Shell Box 1, 0.5 mm walls, 2 faces open");
  assert.throws(() => insertShell(d0, body, ["face:feature-1/top", "face:feature-1/top"], 1), /a face is picked twice/);
  assert.throws(() => insertShell(d0, body, ["top"], 1), /top is not a face's name/);
  assert.throws(() => insertShell(d0, "body:feature-7", [], 1), /body:feature-7 is not a body in the design/);
  const { doc } = insertShell(d0, body, [], 1);
  assert.throws(() => insertShell(doc, "body:feature-2", [], 1), /body:feature-2 is not a body in the design/);
});

test("Edit feature on a Shell says plainly it can't be edited yet; the AI's view and the change notes name it", async () => {
  const { editOff } = await import("../src/timeline-bar.ts");
  const { itemCalled } = await import("../src/graph.ts");
  const { bodiesUsed, bodiesChanged } = await import("../src/body-uses.ts");
  const { doc, id } = insertShell(cube().doc, "body:feature-1", [], 1);
  const f = doc.timeline.features.find((x) => x.id === id)!;
  assert.equal(editOff(f), "Shell 1 can't be edited yet: its panel comes with the Shell tool");
  assert.equal(itemCalled(f), "Shell 1");
  assert.deepEqual(bodiesUsed(f), ["body:feature-1"]);
  assert.deepEqual(bodiesChanged(f), ["body:feature-1"]);
});
