// Extrude's operation (Fusion's New Body, Join, Cut, Intersect; Design
// data version 10), built by the real rebuild on the real kernel.
// Hand-worked cases first (every number worked out from the boxes' corners
// and the sketch's rectangle beside it, never from the code), then the
// refusals, all or none, and the same answer as a Combine of the same
// bodies (two code paths agreeing: self-consistency, on top of the hand
// cases).

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { designBodies } from "../src/browser.ts";
import { extrudeSketch, setExtrudeDistance, setExtrudeOperation, type OperationChoice } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();

/** Boxes, each `[w, d, h]` with its low corner moved to `[x, y, z]` (a ready-made box from the origin, then a Move); Box n's body "body:<its item>". */
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

/** `doc` with a rectangle from `a` to `c` sketched on XY (z = 0) and extruded `distance` mm up with `choice`. */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice | null): { doc: DesignDocument; id: string } {
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, a, c).doc;
  return extrudeSketch(drawn, s.id, distance, false, undefined, choice);
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; volume: (body: string) => Promise<number> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, volume: async (body) => (await cache.view(build.bodies[body].handle)).volume };
}

const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got}, expected ${want}`);

// The cube: x 0..10, y 0..10, z −5..5 (a 10 mm box moved 5 mm down), so the sketch's plane z = 0 cuts through its middle and
// no face of the extrude lies in a face of the cube. The rectangle x 2..6, y 2..6 (16 mm²) extruded 20 mm up runs z 0..20.
const CUBE = () => boxes([[10, 10, 10], [0, 0, -5]]);
const SQUARE: [[number, number], [number, number]] = [[2, 2], [6, 6]];

test("hand-worked: Join, Cut and Intersect of a square extruded up out of the middle of a cube", async () => {
  const cases: [CombineOperation, number][] = [
    // Join: the cube 1,000 mm³ and the part of the extrude above the cube's top, z 5..20: 16 × 15 = 240. 1,240 mm³.
    ["join", 1240],
    // Cut: the extrude takes out what it shares with the cube, z 0..5: 16 × 5 = 80. 1,000 − 80 = 920 mm³.
    ["cut", 920],
    // Intersect: only what the two share, 16 × 5 = 80 mm³.
    ["intersect", 80],
  ];
  for (const [operation, want] of cases) {
    const { doc: cube, bodies } = CUBE();
    const { doc, id } = extruded(cube, ...SQUARE, 20, { operation, bodies });
    const { build, cache, volume } = await built(doc);
    assert.equal(build.results[id].status, "built", JSON.stringify(build.results[id]));
    // The cube keeps its id (Fusion: the body you join to or cut stays that body); the extrude is no body of its own.
    assert.deepEqual(Object.keys(build.bodies), [bodies[0]], operation);
    near(await volume(bodies[0]), want);
    assert.deepEqual(designBodies(doc).map((b) => b.body), [bodies[0]]);
    // No body number is used on it: the cube is Body 1 and the counter still says 2, so the next new body is Body 2.
    assert.deepEqual(doc.bodies, [{ id: bodies[0], number: 1 }]);
    assert.equal(doc.nextBody, 2);
    await cache.close();
  }
});

test("hand-worked: a slot cut right through a bar leaves two bodies, the far one a piece of the extrude", async () => {
  // The bar: x 0..100, y 0..20, z −5..5. The slot: the rectangle x 30..40, y −10..30 extruded z 0..20, through the bar's top
  // half (z 0..5) only, so the bar stays one body: 20,000 − 10 × 20 × 5 = 19,000 mm³.
  {
    const { doc: bar, bodies } = boxes([[100, 20, 10], [0, 0, -5]]);
    const { doc, id } = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies });
    const { build, cache, volume } = await built(doc);
    assert.equal(build.results[id].status, "built");
    assert.deepEqual(Object.keys(build.bodies), [bodies[0]]);
    near(await volume(bodies[0]), 19000);
    await cache.close();
  }
  // Flipped and 10 mm, it runs z 0..−10 and cuts the bottom half (z −5..0) instead: the bar keeps x 0..30 and x 40..100 joined
  // only by the top half: still one body, 20,000 − 10 × 20 × 5 = 19,000 mm³. Through both halves (a second cut), it splits.
  {
    const { doc: bar, bodies } = boxes([[100, 20, 10], [0, 0, -5]]);
    const top = extruded(bar, [30, -10], [40, 30], 20, { operation: "cut", bodies });
    const s = addSketch(top.doc);
    const drawn = drawRectangle(s.doc, s.id, [30, -10], [40, 30]).doc;
    const { doc, id } = extrudeSketch(drawn, s.id, 10, true, undefined, { operation: "cut", bodies });
    const { build, cache, volume } = await built(doc);
    assert.equal(build.results[id].status, "built", JSON.stringify(build.results[id]));
    // Rule 1, as a Combine's slot: the near piece x 0..30 keeps the bar's id (its left end, first of the bar's faces in made
    // order wholly in one piece), the far x 40..100 is piece 1 of the second extrude. 30 × 20 × 10 = 6,000; 60 × 20 × 10 = 12,000.
    const piece = `body:${id}/piece:1`;
    assert.deepEqual(Object.keys(build.bodies).sort(), [bodies[0], piece].sort());
    near(await volume(bodies[0]), 6000);
    near(await volume(piece), 12000);
    // Numbered once it appears: Body 2 (the bar is 1; neither extrude took a number).
    const numbered = numberPieces(doc, Object.keys(build.bodies));
    assert.deepEqual(numbered.bodies?.at(-1), { id: piece, number: 2 });
    assert.deepEqual(designBodies(numbered).map((b) => b.body), [bodies[0], piece]);
    await cache.close();
  }
});

test("hand-worked: Join with two bodies picked puts the extrude and the second into the first, as Fusion's", async () => {
  // Cube A x 0..10, cube B x 20..30, both y 0..10, z −5..5. The bridge: the rectangle x 5..25, y 2..6 extruded z 0..20, 1,600 mm³,
  // of which it shares x 5..10 × 4 × z 0..5 = 100 with A and x 20..25 × 4 × 5 = 100 with B. 1,000 + 1,000 + 1,600 − 200 = 3,400 mm³.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
  const { doc, id } = extruded(two, [5, 2], [25, 6], 20, { operation: "join", bodies });
  const { build, cache, volume } = await built(doc);
  assert.equal(build.results[id].status, "built", JSON.stringify(build.results[id]));
  assert.deepEqual(Object.keys(build.bodies), [bodies[0]]);
  near(await volume(bodies[0]), 3400);
  assert.deepEqual(designBodies(doc).map((b) => b.body), [bodies[0]]);
  await cache.close();
});

test("hand-worked: Cut with two bodies picked takes the extrude out of each; Intersect keeps what each shares with it", async () => {
  // The same cubes and bridge: Cut leaves 1,000 − 100 = 900 mm³ of each; Intersect 100 mm³ of each.
  for (const [operation, want] of [["cut", 900], ["intersect", 100]] as const) {
    const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
    const { doc, id } = extruded(two, [5, 2], [25, 6], 20, { operation, bodies });
    const { build, cache, volume } = await built(doc);
    assert.equal(build.results[id].status, "built", JSON.stringify(build.results[id]));
    assert.deepEqual(Object.keys(build.bodies), bodies, operation);
    near(await volume(bodies[0]), want);
    near(await volume(bodies[1]), want);
    await cache.close();
  }
});

test("the same answer as an extrude followed by a Combine of the same bodies (two code paths agreeing)", async () => {
  for (const operation of ["join", "cut", "intersect"] as const) {
    const { doc: cube, bodies } = CUBE();
    const one = extruded(cube, ...SQUARE, 20, { operation, bodies });
    const plain = extruded(cube, ...SQUARE, 20, null);
    const two = insertCombine(plain.doc, bodies[0], [`body:${plain.id}`], operation);
    const a = await built(one.doc);
    const b = await built(two.doc);
    const va = await a.cache.view(a.build.bodies[bodies[0]].handle);
    const vb = await b.cache.view(b.build.bodies[bodies[0]].handle);
    assert.equal(va.volume, vb.volume, operation);
    assert.equal(va.faces, vb.faces, operation);
    assert.deepEqual(va.bounds, vb.bounds, operation);
    await a.cache.close();
    await b.cache.close();
  }
});

test("all or none: an Intersect that would leave nothing fails in words, and every body stays as it was", async () => {
  // The square x 2..6 extruded z 0..20 never reaches cube B at x 20..30, so B ∩ extrude is empty: refused, as a Combine's is.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
  const { doc, id } = extruded(two, ...SQUARE, 20, { operation: "intersect", bodies });
  const { build, cache, volume } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status, "failed");
  assert.equal(r.status === "failed" && r.message, "Extrude 1 can't be made: the bodies don't overlap, so they have nothing in common");
  // Cube A's step came first and worked, but nothing of it is kept: both cubes are whole, and the extrude left no body.
  assert.deepEqual(Object.keys(build.bodies), bodies);
  near(await volume(bodies[0]), 1000);
  near(await volume(bodies[1]), 1000);
  await cache.close();
});

test("a curved body is refused in the same words a Combine of it gets, and stays as it was", async () => {
  // A sphere (curved faces): the booleans are flat-only until steps 37 to 43.
  const sphere = partDocument("sphere", 10, 10, 10);
  const body = `body:${sphere.timeline.features[0].id}`;
  const { doc, id } = extruded(sphere, [-2, -2], [2, 2], 20, { operation: "cut", bodies: [body] });
  const plain = extruded(sphere, [-2, -2], [2, 2], 20, null);
  const combined = insertCombine(plain.doc, body, [`body:${plain.id}`], "cut");
  const a = await built(doc);
  const b = await built(combined.doc);
  const ra = a.build.results[id];
  const rb = b.build.results[combined.id];
  assert.equal(ra.status, "failed");
  assert.equal(rb.status, "failed");
  const words = (r: typeof ra, label: string) => (r.status === "failed" ? r.message.replace(label, "ITEM") : "");
  assert.equal(words(ra, "Extrude 1"), words(rb, "Combine 1"));
  assert.ok(words(ra, "Extrude 1").length > "ITEM can't be made: ".length);
  assert.deepEqual(Object.keys(a.build.bodies), [body]);
  await a.cache.close();
  await b.cache.close();
});

test("a body deleted, suppressed or used up: the extrude fails or greys naming it, as a Combine does", async () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, -5]], [[10, 10, 10], [20, 0, -5]]);
  // Used up: a Join puts B into A, so a later Cut of B finds no B.
  const join = insertCombine(two, bodies[0], [bodies[1]], "join").doc;
  const { doc, id } = extruded(join, [22, 2], [26, 6], 20, { operation: "cut", bodies: [bodies[1]] });
  const { build, cache } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status, "failed");
  assert.equal(r.status === "failed" && r.message, "Extrude 1 can't use Box 2: an earlier Combine or extrude used it up or left no such piece");
  await cache.close();
  // Suppressed: the cube's item suppressed greys the extrude (Q3), as it greys a Combine.
  const cube = CUBE();
  const cut = extruded(cube.doc, ...SQUARE, 20, { operation: "cut", bodies: cube.bodies });
  const box = cut.doc.timeline.features[0];
  const off: DesignDocument = { ...cut.doc, timeline: { ...cut.doc.timeline, features: cut.doc.timeline.features.map((f) => (f === box ? { ...f, suppressed: true } : f)) } };
  const b = await built(off);
  assert.deepEqual(b.build.results[cut.id], { status: "greyed", by: box.id });
  await b.cache.close();
});

test("changing the distance keeps the operation; New body takes it off; the panel's choices refuse what isn't a body", async () => {
  const { doc: cube, bodies } = CUBE();
  const { doc, id } = extruded(cube, ...SQUARE, 20, { operation: "cut", bodies });
  // 10 mm: z 0..10, so the cut is still z 0..5 (the cube's top is at 5): 920 mm³ again. 3 mm: 16 × 3 = 48, 1,000 − 48 = 952.
  const shorter = setExtrudeDistance(doc, 3, id);
  assert.equal(shorter.timeline.features.at(-1)!.intent.parameters.operation, "cut");
  assert.equal(shorter.timeline.features.at(-1)!.intent.summary, "Extrude Sketch 1 by 3 mm, cut from Box 1");
  const s = await built(shorter);
  near(await s.volume(bodies[0]), 952);
  await s.cache.close();
  // New body: no operation, no bodies, depending on its sketch alone; it makes Body 2.
  const plain = setExtrudeOperation(doc, id, null);
  const f = plain.timeline.features.at(-1)!;
  assert.deepEqual(Object.keys(f.intent.parameters).sort(), ["distance", "sketch"]);
  assert.deepEqual(f.dependsOn, [f.intent.parameters.sketch]);
  assert.equal(f.intent.summary, "Extrude Sketch 1 by 20 mm");
  assert.deepEqual(plain.bodies?.at(-1), { id: `body:${id}`, number: 2 });
  assert.equal(setExtrudeOperation(doc, id, { operation: "cut", bodies }), doc);
  // Refused: no bodies, one twice, a sketch, a body made after the marker, an operation that isn't one.
  const s1 = addSketch(cube);
  const drawn = drawRectangle(s1.doc, s1.id, ...SQUARE).doc;
  assert.throws(() => extrudeSketch(drawn, s1.id, 5, false, undefined, { operation: "cut", bodies: [] }), { message: "pick at least one body for the extrude to work on" });
  assert.throws(() => extrudeSketch(drawn, s1.id, 5, false, undefined, { operation: "cut", bodies: [bodies[0], bodies[0]] }), { message: `${bodies[0]} is picked twice` });
  assert.throws(() => extrudeSketch(drawn, s1.id, 5, false, undefined, { operation: "cut", bodies: [`body:${s1.id}`] }), { message: `body:${s1.id} is not a body in the design` });
  assert.throws(() => extrudeSketch(drawn, s1.id, 5, false, undefined, { operation: "glue" as CombineOperation, bodies }), { message: "glue is not join, cut or intersect" });
  const rolled: DesignDocument = { ...drawn, timeline: { ...drawn.timeline, marker: drawn.timeline.features[0].id } };
  const later = insertPreset(rolled, "box", 5, 5, 5);
  const back: DesignDocument = { ...later.doc, timeline: { ...later.doc.timeline, marker: drawn.timeline.features[0].id } };
  assert.throws(() => setExtrudeOperation(back, id, { operation: "cut", bodies: [`body:${later.id}`] }));
});

test("saved and read back exactly; version 9 data with an operation, and every broken operation, refused with the reason", () => {
  const { doc: cube, bodies } = CUBE();
  const { doc } = extruded(cube, ...SQUARE, 20, { operation: "cut", bodies });
  const json = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(readDesignDocument(json), doc);
  assert.equal(json.version, 11);
  const broken = (change: (f: Record<string, any>, d: Record<string, any>) => void, message: string | RegExp) => {
    const d = JSON.parse(JSON.stringify(doc));
    change(d.timeline.features.at(-1), d);
    assert.throws(() => readDesignDocument(d), typeof message === "string" ? { message } : message);
  };
  const ext = doc.timeline.features.at(-1)!.id;
  broken((_, d) => (d.version = 9), "Design data says version 9 but has an extrude that joins, cuts or intersects, which version 10 brought");
  broken((f) => (f.intent.parameters.operation = "glue"), `Design extrude ${ext}'s operation glue is not join, cut or intersect`);
  broken((f) => (f.intent.parameters.bodies = []), `Design extrude ${ext} cuts but names no bodies to cut`);
  broken((f) => delete f.intent.parameters.bodies, `Design extrude ${ext} cuts but names no bodies to cut`);
  broken((f) => delete f.intent.parameters.operation, `Design extrude ${ext} names bodies but no operation (join, cut or intersect) to use them in`);
  broken((f) => (f.intent.parameters.bodies = [bodies[0], bodies[0]]), `Design extrude ${ext} picks ${bodies[0]} twice`);
  broken((f) => (f.intent.parameters.bodies = [`body:${ext}`]), `Design extrude ${ext}: body:${ext} is not a body made before it in the timeline`);
  broken((f) => (f.intent.parameters.bodies = ["Box 1"]), `Design extrude ${ext}: Box 1 is not a body made before it in the timeline`);
  broken((f) => (f.dependsOn = [f.intent.parameters.sketch]), new RegExp(`Error: Design extrude ${ext} must depend on its sketch, then exactly on the items that made the bodies it cuts`));
  broken((f) => f.dependsOn.reverse(), new RegExp(`Error: Design extrude ${ext} must depend on its sketch`));
  // An extrude of a ready-made profile, or a new-body extrude depending on more than its sketch.
  broken((f, d) => {
    const box = d.timeline.features[0];
    box.intent.parameters.operation = "cut";
  }, /^Design feature feature-1 has an operation, which only an extrude of a sketch has$|has an operation/);
  broken((f) => {
    delete f.intent.parameters.operation;
    delete f.intent.parameters.bodies;
  }, new RegExp(`Error: Design feature ${ext} extrudes sketch-\\d+ but does not depend on it|Error: Design feature ${ext} extrudes`));
  // A body deleted since is kept (the extrude fails naming it), as a Combine's.
  const d = JSON.parse(JSON.stringify(doc));
  d.timeline.features.at(-1).intent.parameters.bodies = ["body:feature-99"];
  d.timeline.features.at(-1).dependsOn = [d.timeline.features.at(-1).intent.parameters.sketch, "feature-99"];
  d.nextId = 100;
  assert.equal(readDesignDocument(d).timeline.features.at(-1)!.intent.parameters.operation, "cut");
});
