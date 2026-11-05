// Step 35f1: the Combine item built by the real rebuild on the real
// kernel. Hand-worked cases first (every number worked out from the boxes'
// corners beside it, never from the code), then each refusal and the
// rebuild's bookkeeping (bodies held, freed, numbered).

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { KernelError } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { combineBodies, insertPreset, numberPieces, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { designBodies } from "../src/browser.ts";
import { insertMove } from "../src/move.ts";
import { NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { shownBodies } from "../src/scene.ts";
import { endStls } from "../src/move-tool.ts";

const kernel = nodeKernel();

/** A design of boxes, each `[w, d, h]` at `[x, y, z]` (a ready-made box from the origin, then a Move), Box n's body "body:<its item>". */
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

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; volume: (body: string) => Promise<number> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, volume: async (body) => (await cache.view(build.bodies[body].handle)).volume };
}

const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got}, expected ${want}`);

test("hand-worked: a slot cut through a bar leaves two bodies, the piece whose face comes first in made order keeping the bar's id", async () => {
  // The bar: x 0..100, y 0..20, z 0..10. The slot's tool: 10 × 40 × 20 moved to (30, −10, −5), so x 30..40 right through.
  // Rule 1: walk the bar's faces in made order (a box's: bottom, top, front, back, left, right). Bottom, top, front and back
  // run the whole length and are split; left (x = 0) is the first wholly in one piece, the near one (x 0..30), so that piece
  // keeps the bar's id and the far one (x 40..100) is piece 1. (Fusion's F1 bar is an extrude, whose order reaches its far
  // end first: the golden test of 35f4 checks that one.)
  const { doc: two, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const { doc, id } = insertCombine(two, bodies[0], [bodies[1]], "cut");
  const { build, cache, volume } = await built(doc);
  assert.equal(build.results[id].status, "built");
  const piece = `body:${id}/piece:1`;
  assert.deepEqual(Object.keys(build.bodies).sort(), [bodies[0], piece].sort());
  // Near x 0..30: 30 × 20 × 10 = 6,000 mm³; far x 40..100: 60 × 20 × 10 = 12,000 mm³.
  near(await volume(bodies[0]), 6000);
  near(await volume(piece), 12000);
  // The slot's tool is used up: no longer a body. Numbered, the piece is Body 3 (the bar 1, the tool 2, never given again).
  const numbered = numberPieces(doc, Object.keys(build.bodies));
  assert.deepEqual(numbered.bodies?.at(-1), { id: piece, number: 3 });
  assert.deepEqual(designBodies(numbered, new Set()).map((b) => b.body), [bodies[0], piece]);
  // The scene shows both, the piece as Body 3, the target answering to the bar's own face names (its left end whole).
  const shown = await shownBodies(numbered, build, cache);
  assert.deepEqual(shown.map((b) => [b.body, b.place]), [[bodies[0], 1], [piece, 3]]);
  assert.ok(shown[0].names.faces.includes("left"), JSON.stringify(shown[0].names.faces));
  // Both in one STL by handle: the near piece's 12 triangles (a box) and the far piece's 12.
  const files = await endStls(kernel, numbered, shown.map((b) => ({ body: b.body, feature: doc.timeline.features.find((f) => f.id === b.feature)!, name: "body" })));
  assert.deepEqual(files.map((f) => new DataView(f.bytes.buffer).getUint32(80, true)), [12, 12]);
  await cache.close();
});

test("hand-worked: Join, Cut and Intersect of two overlapping cubes, tools kept or used up", async () => {
  // Cube A x 0..10, y 0..10, z 0..10; cube B the same moved (5, 5, 5): they share the cube x 5..10, y 5..10, z 5..10 = 125 mm³.
  const cases: [CombineOperation, number][] = [
    ["join", 1000 + 1000 - 125], // 1,875
    ["cut", 1000 - 125], // 875
    ["intersect", 125],
  ];
  for (const [operation, want] of cases)
    for (const keepTools of [false, true]) {
      const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 5, 5]]);
      const { doc, id } = insertCombine(two, bodies[0], [bodies[1]], operation, keepTools);
      assert.deepEqual(combineBodies(doc.timeline.features.at(-1)!), { target: bodies[0], tools: [bodies[1]], operation, keepTools });
      const { build, cache, volume } = await built(doc);
      assert.equal(build.results[id].status, "built", operation);
      near(await volume(bodies[0]), want);
      // The tool: kept, still its 1,000 mm³; else gone.
      assert.equal(bodies[1] in build.bodies, keepTools, `${operation} keep ${keepTools}`);
      if (keepTools) near(await volume(bodies[1]), 1000);
      await cache.close();
    }
});

test("each refusal fails the Combine in words and changes no body", async () => {
  // Cubes 10 mm apart (x 0..10 and x 20..30): an Intersect has nothing in common.
  const apart = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [20, 0, 0]]);
  const inter = insertCombine(apart.doc, apart.bodies[0], [apart.bodies[1]], "intersect");
  let { build, cache } = await built(inter.doc);
  const r = build.results[inter.id];
  assert.equal(r.status, "failed");
  assert.match(r.status === "failed" ? r.message : "", /^Combine 1 can't be made: /);
  assert.deepEqual(Object.keys(build.bodies).sort(), apart.bodies.slice().sort());
  await cache.close();
  // A tool swallowing the target: a cut would leave nothing (Fusion check F3). Target x 5..15, tool 0..20 around it.
  const swallow = boxes([[10, 10, 10], [5, 5, 5]], [[20, 20, 20], [0, 0, 0]]);
  const cut = insertCombine(swallow.doc, swallow.bodies[0], [swallow.bodies[1]], "cut");
  ({ build, cache } = await built(cut.doc));
  assert.deepEqual(build.results[cut.id], { status: "failed", cause: "error", message: "Combine 1 can't be made: the tool covers the whole target, so nothing would be left" });
  assert.deepEqual(Object.keys(build.bodies).sort(), swallow.bodies.slice().sort());
  await cache.close();
  // A result the kernel says would touch itself (decision 2): the Combine fails with its words and where (`touches`), for
  // the overlay on its row. A kernel stand-in answers so (the committed kernel predates 36b's refusal; the real case is in
  // the journeys once it ships).
  const edge = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [10, 0, 10]]);
  const join = insertCombine(edge.doc, edge.bodies[0], [edge.bodies[1]], "join");
  const touch = { at: "edge" as const, from: [10, 0, 10] as [number, number, number], to: [10, 10, 10] as [number, number, number] };
  const refusing = {
    ...kernel,
    call: ((op: string, ...args: unknown[]) =>
      op === "body_boolean"
        ? Promise.reject(new KernelError({ kind: "non-manifold-result", inputs: [], message: "the result would touch itself along an edge", touches: [touch] }))
        : (kernel.call as (o: string, ...a: unknown[]) => unknown)(op, ...args)) as typeof kernel.call,
  };
  cache = new BodyCache(refusing);
  build = await rebuildTimeline(join.doc, cache, refusing);
  assert.deepEqual(build.results[join.id], { status: "failed", cause: "error", message: "Combine 1 can't be made: the result would touch itself along an edge", touches: [touch] });
  assert.deepEqual(Object.keys(build.bodies).sort(), edge.bodies.slice().sort());
  await cache.close();
  // Suppress the tool: the Combine is greyed by it, and the target stays as it was.
  const off = { ...inter.doc, timeline: { ...inter.doc.timeline, features: inter.doc.timeline.features.map((f) => (`body:${f.id}` === apart.bodies[1] ? { ...f, suppressed: true } : f)) } };
  ({ build, cache } = await built(off));
  assert.equal(build.results[inter.id].status, "greyed");
  await cache.close();
});

test("a second Combine can't use a tool the first used up, and says so; one using the first's piece works", async () => {
  // The bar cut in two (as F1), then Box 2 (the used-up slot tool) cut again from the bar: refused in words.
  const { doc: two, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]], [[5, 5, 30], [80, 5, -10]]);
  const first = insertCombine(two, bodies[0], [bodies[1]], "cut");
  const doc1 = numberPieces(first.doc, [`body:${first.id}/piece:1`]);
  const again = insertCombine(doc1, bodies[0], [bodies[1]], "cut");
  let { build, cache } = await built(again.doc);
  const r = build.results[again.id];
  assert.equal(r.status, "failed");
  assert.match(r.status === "failed" ? r.message : "", /an earlier Combine used it up/);
  await cache.close();
  // The far piece (x 40..100) cut by a 5 × 5 post at x 80..85, y 5..10 right through: 12,000 − 5 · 5 · 10 = 11,750 mm³.
  const piece = `body:${first.id}/piece:1`;
  const second = insertCombine(doc1, piece, [bodies[2]], "cut");
  ({ build, cache } = await built(second.doc));
  assert.equal(build.results[second.id].status, "built");
  near((await cache.view(build.bodies[piece].handle)).volume, 11750);
  await cache.close();
});

test("the rebuild keeps a Combine's inputs and result, frees them when it goes, and builds it once for the same inputs", async () => {
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 5, 5]]);
  const { doc } = insertCombine(two, bodies[0], [bodies[1]], "join");
  const before = await kernel.call("body_count");
  let calls = 0;
  const counting = { ...kernel, call: ((op: string, ...args: unknown[]) => (op === "body_boolean" && calls++, (kernel.call as (o: string, ...a: unknown[]) => unknown)(op, ...args))) as typeof kernel.call };
  const cache = new BodyCache(counting);
  const a = await rebuildTimeline(doc, cache, counting);
  const b = await rebuildTimeline(doc, cache, counting);
  // The same handles both times: the boolean asked once.
  assert.equal(calls, 1);
  assert.equal(a.bodies[bodies[0]].handle, b.bodies[bodies[0]].handle);
  await cache.close();
  assert.equal(await kernel.call("body_count"), before);
});

test("regression (35f1d monkey): two equal boxes in the same place combine, though the rebuild shares one body for equal shapes", async () => {
  // Both 10 × 10 × 10 from the origin, not moved: the same shape, so the body cache handed the kernel one body as target
  // and tool, refused as "a body can't be its own tool" though the person picked two bodies. Each input must be its own body.
  // Worked by hand: the cubes lie wholly on each other, so Join is one 10 × 10 × 10 = 1,000 mm³ body and Intersect the same
  // 1,000 mm³; Cut takes everything away, which the Combine refuses as leaving nothing. A kernel from before faces lying on
  // each other were supported (36b, kernel 0.33.27) refuses all three in those words instead: still never "its own tool".
  const version = (JSON.parse(readFileSync(new URL("../../../packages/core/src/kernel/wasm/kernel.json", import.meta.url), "utf8")) as { version: string }).version;
  const [, minor, patch] = version.split(".").map(Number);
  const flush = minor > 33 || (minor === 33 && patch >= 27);
  const run = async (op: CombineOperation) => {
    const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [0, 0, 0]]);
    const { doc, id } = insertCombine(two, bodies[0], [bodies[1]], op);
    const { build, cache, volume } = await built(doc);
    return { r: build.results[id], build, cache, volume, bodies };
  };
  for (const [op, want] of [["join", 1000], ["intersect", 1000], ["cut", null]] as [CombineOperation, number | null][]) {
    const { r, build, cache, volume, bodies } = await run(op);
    const said = r.status === "failed" ? r.message : "";
    assert.doesNotMatch(said, /its own tool/, op);
    if (want !== null && flush) {
      assert.equal(r.status, "built", `${op}: ${said}`);
      assert.deepEqual(Object.keys(build.bodies), [bodies[0]], op);
      near(await volume(bodies[0]), want);
    } else {
      assert.equal(r.status, "failed", op);
      assert.match(said, want === null && flush ? /nothing/ : /lying on each other/, op);
    }
    await cache.close();
  }
});
