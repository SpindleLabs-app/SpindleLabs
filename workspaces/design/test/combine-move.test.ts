// Step 35f1f2a: moving a Combine's result. A Combine's result has no spec
// (only the kernel's store holds it), so a Move after it asks the kernel's
// body_move for the body moved, and carries each face's frame on from where
// its input body's was, so a sketch on it goes where the face went. Every
// number is worked out by hand from the boxes' corners beside it, on the
// real rebuild and kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { changedMove, insertMove, NO_MOVE, type MoveValues } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { addFaceSketch } from "../src/sketch.ts";

const kernel = nodeKernel();

/** Boxes `[w, d, h]` moved to `[x, y, z]` (a ready-made box from the origin, then a Move), Box n's body "body:<its item>". */
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

// Cube A x 0..10, y 0..10, z 0..10 (feature-1); cube B the same (feature-2) moved (5, 5, 5) (feature-3); Join (feature-4).
// The result keeps A's id, body:feature-1: x 0..15, y 0..15, z 0..15, volume 1000 + 1000 − 125 = 1875 mm³.
const JOINED = () => {
  const { doc, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 5, 5]]);
  return { ...insertCombine(doc, bodies[0], [bodies[1]], "join"), bodies };
};

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; scene: Scene }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  return { build, cache, scene };
}

const rounded = (v: readonly number[]) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0);

async function boundsOf(doc: DesignDocument, body: string) {
  const { build, cache } = await built(doc);
  const view = await cache.view(build.bodies[body].handle);
  const out = { bounds: view.bounds.map(rounded), volume: Math.round(view.volume * 1e9) / 1e9, results: build.results };
  await cache.close();
  return out;
}

const moveBy = (v: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...v });

test("hand-worked: a Combine's result moves by a Move after it, its volume and every face kept", async () => {
  const { doc, id } = JOINED();
  assert.equal(id, "feature-4");
  const before = await boundsOf(doc, "body:feature-1");
  assert.deepEqual(before.bounds, [[0, 0, 0], [15, 15, 15]]);
  assert.equal(before.volume, 1875);
  // Moved +20 along X: x 20..35, y and z as they were; the volume is the same 1,875 mm³.
  const { doc: moved, id: m } = insertMove(doc, ["body:feature-1"], moveBy({ x: 20 }));
  const after = await boundsOf(moved, "body:feature-1");
  assert.equal(after.results[m].status, "built", JSON.stringify(after.results[m]));
  assert.deepEqual(after.bounds, [[20, 0, 0], [35, 15, 15]]);
  assert.equal(after.volume, 1875);
});

test("hand-worked: a Combine's result turned a quarter about Z through the origin, then shifted", async () => {
  const { doc } = JOINED();
  // A quarter turn counter-clockwise seen from above takes (x, y) to (−y, x): x 0..15, y 0..15 becomes x −15..0, y 0..15.
  const turned = insertMove(doc, ["body:feature-1"], moveBy({ turnZ: 90 })).doc;
  assert.deepEqual((await boundsOf(turned, "body:feature-1")).bounds, [[-15, 0, 0], [0, 15, 15]]);
  // The turn first, then the shift (move.ts `moveMotions`): x −15..0 shifted +15 is 0..15, z shifted +3 is 3..18.
  const both = insertMove(doc, ["body:feature-1"], moveBy({ turnZ: 90, x: 15, z: 3 })).doc;
  assert.deepEqual((await boundsOf(both, "body:feature-1")).bounds, [[0, 0, 3], [15, 15, 18]]);
  // Two Moves one after the other add up: +20 then +7 along X is x 27..42.
  const twice = insertMove(insertMove(doc, ["body:feature-1"], moveBy({ x: 20 })).doc, ["body:feature-1"], moveBy({ x: 7 })).doc;
  assert.deepEqual((await boundsOf(twice, "body:feature-1")).bounds, [[27, 0, 0], [42, 15, 15]]);
});

test("hand-worked: a Combine's result moved with a plain box in one Move: both move; refused past model space (1.1 × its edge, 0.9 × builds), neither does", async () => {
  const { doc } = JOINED();
  // Box C 4 × 4 × 4 at the origin (feature-5), then one Move of the result and C by +100 along Y.
  const { doc: withC, id: c } = insertPreset(doc, "box", 4, 4, 4);
  const { doc: moved, id: m } = insertMove(withC, ["body:feature-1", `body:${c}`], moveBy({ y: 100 }));
  const { build, cache } = await built(moved);
  assert.equal(build.results[m].status, "built", JSON.stringify(build.results[m]));
  assert.deepEqual(rounded((await cache.view(build.bodies["body:feature-1"].handle)).bounds.flat()), [0, 100, 0, 15, 115, 15]);
  assert.deepEqual(rounded((await cache.view(build.bodies[`body:${c}`].handle)).bounds.flat()), [0, 100, 0, 4, 104, 4]);
  await cache.close();
  // Model space is ±100 km (the kernel's MAX_COORD, 1e8 mm) round the origin. Shifted 0.9 × that along Y the result's
  // far side is at 0.9e8 + 15 mm, inside: built. Shifted 1.1 × it is outside: the kernel refuses the plain box's moved
  // spec and the result's body_move alike, the Move fails, and both bodies stay where the Join and C left them.
  {
    const near = insertMove(withC, ["body:feature-1", `body:${c}`], moveBy({ y: 0.9e8 }));
    const r = await built(near.doc);
    assert.equal(r.build.results[near.id].status, "built", JSON.stringify(r.build.results[near.id]));
    assert.deepEqual(rounded((await r.cache.view(r.build.bodies["body:feature-1"].handle)).bounds.flat()), [0, 0.9e8, 0, 15, 0.9e8 + 15, 15]);
    await r.cache.close();
  }
  for (const bodies of [["body:feature-1"], ["body:feature-1", `body:${c}`], [`body:${c}`, "body:feature-1"]]) {
    const far = insertMove(withC, bodies, moveBy({ y: 1.1e8 }));
    const r = await built(far.doc);
    const result = r.build.results[far.id];
    assert.equal(result.status, "failed", JSON.stringify(result));
    assert.ok(result.status === "failed" && result.cause === "error" && !/next kernel release/.test(result.message), JSON.stringify(result));
    assert.deepEqual(rounded((await r.cache.view(r.build.bodies["body:feature-1"].handle)).bounds.flat()), [0, 0, 0, 15, 15, 15]);
    assert.deepEqual(rounded((await r.cache.view(r.build.bodies[`body:${c}`].handle)).bounds.flat()), [0, 0, 0, 4, 4, 4]);
    await r.cache.close();
  }
});

test("hand-worked: a sketch on a moved Combine's result slides with it when that Move changes, on a target's face and a tool's alike", async () => {
  const { doc: joined } = JOINED();
  // M (feature-5) moves the result +20 along X: x 20..35. Then a sketch on B's top (z = 15, x 25..35, centroid x 30)
  // and one on A's top (z = 10, x 20..30 less B's corner x 25..30 y 5..10: centroid x (100 · 25 − 25 · 27.5) / 75 = 24.1666…).
  const { doc: moved, id: m } = insertMove(joined, ["body:feature-1"], moveBy({ x: 20 }));
  const { scene, cache } = await built(moved);
  const faceAt = (n: [number, number, number], x: number): number => {
    const b = scene.bodies.findIndex((s) => s.body === "body:feature-1");
    const v = scene.bodies[b].view;
    const k = v.face_normals.findIndex((q, i) => q !== null && q.every((c, j) => Math.abs(c - n[j]) < 1e-12) && Math.abs(v.face_centroids[i][0] - x) < 1e-9);
    assert.ok(k >= 0, `a face facing ${n} at x ${x}`);
    return scene.faceStart[b] + k;
  };
  const clicked = (doc: DesignDocument, x: number, z: number) => {
    const b = scene.bodies.findIndex((s) => s.body === "body:feature-1");
    const v = scene.bodies[b].view;
    const k = v.face_normals.findIndex((q, i) => q !== null && q[2] === 1 && Math.abs(v.face_centroids[i][2] - z) < 1e-9);
    assert.ok(k >= 0, `a top at z ${z}`);
    const spot = sketchSpot({ face: faceAt([0, 0, 1], v.face_centroids[k][0]), shift: false }, scene);
    assert.ok(spot?.kind === "face", JSON.stringify(spot));
    assert.ok(Math.abs(v.face_centroids[k][0] - x) < 1e-9, `${v.face_centroids[k][0]} ≠ ${x}`);
    return addFaceSketch(doc, spot.face, spot.drawn);
  };
  const onB = clicked(moved, 30, 15);
  const onA = clicked(onB.doc, (100 * 25 - 25 * 27.5) / 75, 10);
  await cache.close();
  const placed = async (doc: DesignDocument) => {
    const { build, cache: c } = await built(doc);
    const at = (sid: string) => {
      const r = build.results[sid];
      assert.ok(r.status === "built" && r.plane === undefined, JSON.stringify(r));
      return { origin: rounded(r.placement!.plane.origin), x: rounded(r.placement!.plane.xAxis) };
    };
    const out = { b: at(onB.id), a: at(onA.id) };
    await c.close();
    return out;
  };
  // As drawn (26e): each frame's origin is its top's plane's nearest point to the world's origin, x along the world's X.
  assert.deepEqual(await placed(onA.doc), { b: { origin: [0, 0, 15], x: [1, 0, 0] }, a: { origin: [0, 0, 10], x: [1, 0, 0] } });
  // M now moves the result +30: both tops went 10 mm further along X, so both sketches slide 10 mm, to x = 10.
  assert.deepEqual(await placed(changedMove(onA.doc, m, moveBy({ x: 30 }))), { b: { origin: [10, 0, 15], x: [1, 0, 0] }, a: { origin: [10, 0, 10], x: [1, 0, 0] } });
  // M turns it a quarter about Z through the origin instead of shifting it. A point drawn at p on the body shifted +20 is
  // q = p − (20, 0, 0) on the body as the Join left it, and now at R q, where R (x, y, z) = (−y, x, z). The frame's
  // origin (0, 0, z) is q = (−20, 0, z), now (0, −20, z); its x axis (1, 0, 0) turns to (0, 1, 0).
  assert.deepEqual(await placed(changedMove(onA.doc, m, moveBy({ turnZ: 90 }))), { b: { origin: [0, -20, 15], x: [0, 1, 0] }, a: { origin: [0, -20, 10], x: [0, 1, 0] } });
});

test("a moved Combine's result is moved once for the same Move and kept between rebuilds, and freed with the cache", async () => {
  const { doc } = JOINED();
  const moved = insertMove(doc, ["body:feature-1"], moveBy({ x: 20 })).doc;
  const start = await kernel.call("body_count");
  const cache = new BodyCache(kernel);
  const first = await rebuildTimeline(moved, cache, kernel);
  const second = await rebuildTimeline(moved, cache, kernel);
  assert.equal(second.bodies["body:feature-1"].handle, first.bodies["body:feature-1"].handle);
  await cache.close();
  assert.equal(await kernel.call("body_count"), start);
});

test("hand-worked: each face's frame on a moved Combine's result is carried on from its own input body's, a scale too", async () => {
  const { doc } = JOINED();
  // Scaled ×2 about the origin: x, y, z 0..30, volume 1,875 · 8 = 15,000 mm³.
  const scaled = insertMove(doc, ["body:feature-1"], moveBy({ scale: 2 })).doc;
  const { build, cache } = await built(scaled);
  const b = build.bodies["body:feature-1"];
  const view = await cache.view(b.handle);
  assert.deepEqual(view.bounds.map(rounded), [[0, 0, 0], [30, 30, 30]]);
  assert.equal(Math.round(view.volume * 1e6) / 1e6, 15000);
  // B's frame was put at (5, 5, 5) by its Move; the scale about the origin takes it to (10, 10, 10), axes unchanged.
  // A never moved before the Join: its frame is the world's, whose origin the scale leaves at (0, 0, 0).
  // B's top is the face at z = 30 (15 · 2); A's bottom the one at z = 0.
  const at = (z: number) => view.face_centroids.findIndex((c, i) => view.face_normals[i]?.[2] !== 0 && Math.abs(c[2] - z) < 1e-9);
  const frame = (k: number) => {
    const f = b.frames?.[k];
    assert.ok(f, `face ${k} has a frame`);
    return { origin: rounded(f.origin), x: rounded(f.xAxis), normal: rounded(f.normal) };
  };
  assert.deepEqual(frame(at(30)), { origin: [10, 10, 10], x: [1, 0, 0], normal: [0, 0, 1] });
  assert.deepEqual(frame(at(0)), { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] });
  await cache.close();
});
