// SL #677 item 3 (final Combine hunt, 2026-11-12): an Extrude Join that lies
// wholly inside the body adds nothing, also when it starts flush with one of
// the body's faces (a sketch on a face, extruded into the body: the usual
// wrong-way mistake). Its face in the body's face is merged into it, so the
// old rule (one result body holds faces of both) took it as adding. It adds
// nothing when the result is the body unchanged: every face of the body
// still there (whole, or with the extrude's flush face merged in), none the
// extrude's alone (misses.ts `joinsInside`). On the
// real kernel; volumes worked by hand beside each case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, type OperationChoice } from "../src/extrude.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { joinsInside, mayJoinInside } from "../src/misses.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${got}, expected ${want}`);

/** The rectangle a..c sketched on XY and extruded `distance` up, or down from the plane when it is negative (Flip). */
function extruded(doc: DesignDocument, a: [number, number], c: [number, number], distance: number, choice: OperationChoice | null) {
  const s = addSketch(doc);
  return extrudeSketch(drawRectangle(s.doc, s.id, a, c).doc, s.id, Math.abs(distance), distance < 0, undefined, choice);
}

/** Box 1 40 × 30 × 20 at the origin (24,000 mm³), then the items `more` adds; the last one's result and Body 1's volume. */
async function built(more: (doc: DesignDocument, body: string) => { doc: DesignDocument; id: string }) {
  const box = partDocument("box", 40, 30, 20);
  const body = `body:${box.timeline.features[0].id}`;
  const made = more(box, body);
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(made.doc, cache, kernel);
    const r = build.results[made.id];
    assert.equal(r.status, "built", JSON.stringify(r));
    return { r: r as Extract<typeof r, { status: "built" }>, volume: (await cache.view(build.bodies[body].handle)).volume, body, bodies: Object.keys(build.bodies), held: await kernel.call("body_count") };
  } finally {
    await cache.close();
  }
}
const join = (a: [number, number], c: [number, number], distance: number) => built((doc, body) => extruded(doc, a, c, distance, { operation: "join", bodies: [body] }));

test("inside the body and flush with its bottom: adds nothing, and says so", async () => {
  // The square x 5..15, y 5..15 on XY, 10 up: z 0..10, every point in Box 1 (z 0..20). 0 mm³ added: 24,000.
  const { r, volume, body, bodies } = await join([5, 5], [15, 15], 10);
  near(volume, 24_000);
  assert.deepEqual(bodies, [body]);
  assert.equal(r.misses?.message, "Extrude 1 adds nothing: it lies wholly inside Body 1");
  assert.deepEqual(r.misses?.list.map((m) => [m.target, m.tools.length, m.inside?.length]), [[body, 1, 1]]);
});

test("the whole height (flush with bottom and top) and in a corner (flush with three faces): adds nothing", async () => {
  // z 0..20 inside x 5..15, y 5..15; and x 0..10, y 0..10, z 0..10: both inside Box 1.
  for (const [a, c, d] of [[[5, 5], [15, 15], 20], [[0, 0], [10, 10], 10]] as const) {
    const { r, volume } = await join([...a], [...c], d);
    near(volume, 24_000);
    assert.equal(r.misses?.message, "Extrude 1 adds nothing: it lies wholly inside Body 1", `${JSON.stringify([a, c, d])}`);
  }
});

test("the same square pointing out of the body adds a pad and is not questioned", async () => {
  // 10 down from XY: z −10..0 under the box, 10 · 10 · 10 = 1,000 more: 25,000.
  const { r, volume } = await join([5, 5], [15, 15], -10);
  near(volume, 25_000);
  assert.equal(r.misses, undefined);
  // Half in, half out (the whole box's height and 5 more): x 5..15, y 5..15, z 0..25 adds z 20..25, 500: 24,500.
  const through = await join([5, 5], [15, 15], 25);
  near(through.volume, 24_500);
  assert.equal(through.r.misses, undefined);
});

test("a pocket filled level again adds what was cut, though no face of the result is the extrude's alone", async () => {
  // Cut x 10..20, y 10..20, z 0..10 from the bottom: 24,000 − 1,000 = 23,000. The same square joined 10 up fills it:
  // its bottom is merged into the box's, its sides and top lie on the pocket's walls and roof, which go. 24,000 again.
  const { r, volume } = await built((doc, body) => {
    const cut = extruded(doc, [10, 10], [20, 20], 10, { operation: "cut", bodies: [body] });
    return extruded(cut.doc, [10, 10], [20, 20], 10, { operation: "join", bodies: [body] });
  });
  near(volume, 24_000);
  assert.equal(r.misses, undefined);
});

test("an extension beside the body, flush on four sides, adds its volume and is not questioned", async () => {
  // x 40..50, y 0..30, z 0..20 against the box's x = 40 face: four of its faces are merged into the box's, its far
  // end is its own. 10 · 30 · 20 = 6,000 more: 30,000.
  const { r, volume } = await join([40, 0], [50, 30], 20);
  near(volume, 30_000);
  assert.equal(r.misses, undefined);
});

test("seeded blocks on a 10 mm grid against a model: questioned exactly when the model says nothing is added", async () => {
  // The model, by intervals: the block [x0, x1] × [y0, y1] × [z0, z1] and Box 1 [0, 40] × [0, 30] × [0, 20] share
  // the box (the product of the three overlaps); the Join adds the block's volume less that. They are one body when
  // they share volume or a patch of face (two overlaps positive, the third a touch); apart, the block is a body of
  // its own and also "adds nothing" to Body 1. Touching only along an edge or at a corner the kernel refuses: skipped.
  let seed = 20261112;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  const seen = { inside: 0, adds: 0, apart: 0, refused: 0 };
  for (let n = 0; n < 40; n++) {
    const x0 = 10 * (rnd(7) - 1), x1 = x0 + 10 * (1 + rnd(3));
    const y0 = 10 * (rnd(6) - 1), y1 = y0 + 10 * (1 + rnd(3));
    const h = 10 * (1 + rnd(3)) * (rnd(2) === 0 ? 1 : -1);
    const [z0, z1] = h > 0 ? [0, h] : [h, 0];
    const o = [overlap(x0, x1, 0, 40), overlap(y0, y1, 0, 30), overlap(z0, z1, 0, 20)];
    const shared = o.every((v) => v > 0) ? o[0] * o[1] * o[2] : 0;
    const touching = o.filter((v) => v > 0).length === 2 && o.some((v) => v === 0);
    const added = (x1 - x0) * (y1 - y0) * (z1 - z0) - shared;
    const what = `block ${n}: x ${x0}..${x1}, y ${y0}..${y1}, z ${z0}..${z1}`;
    const box = partDocument("box", 40, 30, 20);
    const body = `body:${box.timeline.features[0].id}`;
    const made = extruded(box, [x0, y0], [x1, y1], h, { operation: "join", bodies: [body] });
    const cache = new BodyCache(kernel);
    try {
      const build = await rebuildTimeline(made.doc, cache, kernel);
      const r = build.results[made.id];
      if (r.status !== "built") {
        assert.ok(shared === 0 && !touching, `${what}: refused though the model joins it: ${JSON.stringify(r)}`);
        seen.refused++;
        continue;
      }
      const joined = shared > 0 || touching;
      near((await cache.view(build.bodies[body].handle)).volume, 24_000 + (joined ? added : 0));
      const expected = !joined || added === 0;
      assert.equal(r.misses !== undefined, expected, `${what}: adds ${added}, joined ${joined}, said ${r.misses?.message}`);
      if (joined && added === 0) assert.match(r.misses!.message, /lies wholly inside Body 1$/, what);
      seen[!joined ? "apart" : added === 0 ? "inside" : "adds"]++;
    } finally {
      await cache.close();
    }
  }
  // The seed must reach each kind, or the test proves nothing about it.
  assert.ok(seen.inside >= 3 && seen.adds >= 3 && seen.apart >= 3, JSON.stringify(seen));
  console.log(`  seeded blocks: ${JSON.stringify(seen)}`);
});

test("joinsInside: the target's every face still there, the tool's faces all merged into them", () => {
  // Hand-made histories: body 1 the target with two faces (0 and 1), body 2 the tool.
  const face = (body: number, n: number, whole = true) => ({ body, face: n, whole, turned: false });
  // The tool's only face left is merged into face 1 of the target; both target faces whole: inside, adds nothing.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0), face(1, 1)], also: [[], [face(2, 0)]], edges: [] }] }), true);
  // The tool's face listed first with the target's merged in: the same.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0), face(2, 0)], also: [[], [face(1, 1)]], edges: [] }] }), true);
  // The kernel gives a face the tool's is merged into as a piece: still inside.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0), face(1, 1, false)], also: [[], [face(2, 0, false)]], edges: [] }] }), true);
  // Only a piece of target face 0 is left, and no face of the tool is merged into it (the tool buried the rest): it adds.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0, false), face(1, 1)], also: [[], [face(2, 0)]], edges: [] }] }), false);
  // Target face 0 is gone (a pocket's wall, filled level): it adds.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 1)], also: [[face(2, 0)]], edges: [] }] }), false);
  // A face of the tool's alone: it sticks out.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0), face(1, 1), face(2, 1)], also: [[], [face(2, 0)], []], edges: [] }] }), false);
  // No face of the tool at all (inside, touching nothing), or a body of its own (far away): `missedTools` has those.
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0), face(1, 1)], edges: [] }] }), false);
  assert.equal(joinsInside(1, 2, 2, { history: [{ faces: [face(1, 0), face(1, 1)], edges: [] }, { faces: [face(2, 0)], edges: [] }] }), false);
  // mayJoinInside is the same reading before the body's faces are counted: yes while it could be so for some count
  // (the face gone above: one face kept, so a body of one face), no once a face is the tool's alone.
  assert.equal(mayJoinInside(1, 2, { history: [{ faces: [face(1, 1)], also: [[face(2, 0)]], edges: [] }] }), true);
  assert.equal(mayJoinInside(1, 2, { history: [{ faces: [face(1, 0), face(1, 1), face(2, 1)], also: [[], [face(2, 0)], []], edges: [] }] }), false);
});
