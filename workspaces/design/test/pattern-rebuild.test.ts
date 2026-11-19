// Step 61b, the Pattern item built by the real rebuild on the real kernel
// (rebuild.ts `patternRun`, the kernel's `pattern_motions`), its data
// (document.ts `checkPattern`, Design data version 25) and its copies'
// numbers. Every place and volume is worked out by hand beside it from the
// cube's corners and the pattern's moves or turns.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertPattern, type PatternValues } from "../src/pattern.ts";
import { DESIGN_VERSION, insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertCombine } from "../src/combine.ts";
import { deleteItem, suppressItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";

const kernel = nodeKernel();

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; view: (body: string) => Promise<BodyView> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, view: (body) => cache.view(build.bodies[body].handle) };
}

const near = (got: number, want: number, what = "") => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what} ${got}, expected ${want}`);
/** A body's bounds as [min x, min y, min z, max x, max y, max z], rounded to the nanometre. */
const box = (v: BodyView) => [...v.bounds[0], ...v.bounds[1]].map((x) => Math.round(x * 1e6) / 1e6 + 0);

const row = (over: Partial<PatternValues & { kind: "linear" }> = {}): PatternValues => ({ kind: "linear", direction: "X", spacing: 15, count: 3, join: false, ...over }) as PatternValues;
const round = (over: Partial<PatternValues & { kind: "circular" }> = {}): PatternValues => ({ kind: "circular", axis: "Z", centre: [0, 0, 0], count: 4, angle: 360, join: false, ...over }) as PatternValues;

/** The 10 mm cube, x, y and z 0..10, and its body. */
const cube = () => ({ doc: partDocument("box", 10, 10, 10), body: "body:feature-1" });

test("hand-worked: a row of 3 cubes 15 mm apart along X is the cube and two copies at x 15..25 and 30..40, each 1,000 mm³, numbered as the build makes them", async () => {
  const start = await kernel.call("body_count");
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row());
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status, "built");
  // Counts include the original: 3 instances are the cube and 2 copies, the Pattern's pieces 1 and 2.
  assert.deepEqual(r.status === "built" && r.bodies, [`body:${id}/piece:1`, `body:${id}/piece:2`]);
  // The cube moved by 1 × 15 and 2 × 15 along X; y and z as they were.
  assert.deepEqual(box(await view(`body:${id}/piece:1`)), [15, 0, 0, 25, 10, 10]);
  assert.deepEqual(box(await view(`body:${id}/piece:2`)), [30, 0, 0, 40, 10, 10]);
  for (const k of [1, 2]) near((await view(`body:${id}/piece:${k}`)).volume, 1000, `copy ${k}`);
  // The cube itself is left where it was.
  assert.deepEqual(box(await view(body)), [0, 0, 0, 10, 10, 10]);
  // Numbered when first built, after the cube's Body 1: Body 2 and Body 3.
  const numbered = numberPieces(doc, Object.keys(build.bodies));
  assert.deepEqual(numbered.bodies, [{ id: body, number: 1 }, { id: `body:${id}/piece:1`, number: 2 }, { id: `body:${id}/piece:2`, number: 3 }]);
  await cache.close();
  assert.equal(await kernel.call("body_count"), start, "every body built is freed");
});

test("hand-worked: Join on a row of 3 cubes 5 mm apart makes one block x 0..20, 2,000 mm³, keeping the cube's id", async () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row({ spacing: 5, join: true }));
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status, "built", r.status === "failed" ? r.message : "");
  // The copies at x 5..15 and 10..20 overlap the cube and each other: one body from x 0 to 20, 20 × 10 × 10 = 2,000 mm³.
  assert.deepEqual(r.status === "built" && r.bodies, [body]);
  near((await view(body)).volume, 2000, "joined");
  assert.deepEqual(box(await view(body)), [0, 0, 0, 20, 10, 10]);
  assert.deepEqual(Object.keys(build.bodies), [body], "no copy is left as a body of its own");
  await cache.close();
});

test("Join with copies that meet nothing keeps them as the Pattern's pieces, as Combine's Join does", async () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row({ join: true }));
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status, "built");
  // 15 mm apart, the 10 mm cubes leave 5 mm gaps: three bodies of 1,000 mm³, the cube keeping its id.
  const ids = r.status === "built" ? r.bodies! : [];
  assert.equal(ids.length, 3);
  assert.ok(ids.includes(body));
  for (const b of ids) near((await view(b)).volume, 1000, b);
  // A copy is no piece split from the cube: a Move of the cube made later never takes it along.
  for (const b of ids) assert.equal(build.bodies[b].from, undefined, b);
  const boxes = (await Promise.all(ids.map(async (b) => box(await view(b))))).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(boxes, [[0, 0, 0, 10, 10, 10], [15, 0, 0, 25, 10, 10], [30, 0, 0, 40, 10, 10]]);
  await cache.close();
});

test("hand-worked: a plus sign, a 2 × 1 × 1 bar four times round Z through (0.5, 0.5), joined: 5 unit cubes, 5 mm³ and 14 faces", async () => {
  // The bar x 0..2, y 0..1, z 0..1: the centre square x, y 0..1 and an arm x 1..2. Turned 90°, 180° and 270° about the
  // line x = y = 0.5, the arm lands at y 1..2, x −1..0 and y −1..0, the centre square on itself. The union: the centre and
  // four arms, 5 × 1 = 5 mm³; its outline a plus of 12 sides, so 12 side faces, the top and the bottom: 14.
  const d0 = partDocument("box", 2, 1, 1);
  const { doc, id } = insertPattern(d0, ["body:feature-1"], round({ centre: [0.5, 0.5, 0], join: true }));
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status, "built", r.status === "failed" ? r.message : "");
  assert.deepEqual(r.status === "built" && r.bodies, ["body:feature-1"]);
  const v = await view("body:feature-1");
  near(v.volume, 5, "plus");
  assert.equal(v.faces, 14);
  assert.deepEqual(box(v), [-1, -1, 0, 2, 2, 1]);
  await cache.close();
});

test("hand-worked: round Z, 4 over a full turn and 3 over 90°: each copy where the turn puts the cube", async () => {
  const { doc: d0, body } = cube();
  // A full turn, 4: 90°, 180° and 270° about the Z axis through the origin. The cube's corner (10, 10) goes to (−10, 10),
  // (−10, −10) and (10, −10).
  const full = insertPattern(d0, [body], round());
  const a = await built(full.doc);
  const ids = [1, 2, 3].map((k) => `body:${full.id}/piece:${k}`);
  assert.deepEqual(a.build.results[full.id].status === "built" && (a.build.results[full.id] as { bodies: string[] }).bodies, ids);
  assert.deepEqual(await Promise.all(ids.map(async (b) => box(await a.view(b)))), [[-10, 0, 0, 0, 10, 10], [-10, -10, 0, 0, 0, 10], [0, -10, 0, 10, 0, 10]]);
  await a.cache.close();
  // 3 over 90°: steps of 45° and 90°. Turned 45° the cube's corners (10, 0), (10, 10) and (0, 10) go to (7.07, 7.07),
  // (0, 14.14) and (−7.07, 7.07): x from −10/√2 to 10/√2, y from 0 to 20/√2.
  const part = insertPattern(d0, [body], round({ count: 3, angle: 90 }));
  const b = await built(part.doc);
  const s = 10 / Math.SQRT2;
  const v1 = await b.view(`body:${part.id}/piece:1`);
  near(v1.bounds[0][0], -s, "min x");
  near(v1.bounds[1][0], s, "max x");
  near(v1.bounds[1][1], 2 * s, "max y");
  near(v1.volume, 1000, "a turn keeps the volume");
  assert.deepEqual(box(await b.view(`body:${part.id}/piece:2`)), [-10, 0, 0, 0, 10, 10]);
  await b.cache.close();
});

test("a 2 × 3 grid of a cube is 5 copies, along X then up Y, numbered in the kernel's order", async () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row({ count: 2, direction2: "Y", spacing2: 20, count2: 3 }));
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  assert.equal(r.status === "built" && r.bodies!.length, 5);
  // The kernel's order: (15, 0), then the second row (0, 20), (15, 20), then (0, 40), (15, 40).
  const corners = await Promise.all([1, 2, 3, 4, 5].map(async (k) => box(await view(`body:${id}/piece:${k}`)).slice(0, 2)));
  assert.deepEqual(corners, [[15, 0], [0, 20], [15, 20], [0, 40], [15, 40]]);
  await cache.close();
});

test("two bodies patterned: each one's copies in turn, the order picked", async () => {
  const d0 = insertPreset(partDocument("box", 10, 10, 10), "box", 10, 10, 10).doc;
  // Both boxes sit at the origin; picked Box 2 first: its copy is piece 1, Box 1's piece 2. Equal shapes, so placed alike.
  const { doc, id } = insertPattern(d0, ["body:feature-2", "body:feature-1"], row({ count: 2 }));
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  assert.deepEqual(r.status === "built" && r.bodies, [`body:${id}/piece:1`, `body:${id}/piece:2`]);
  for (const k of [1, 2]) assert.deepEqual(box(await view(`body:${id}/piece:${k}`)), [15, 0, 0, 25, 10, 10]);
  await cache.close();
});

test("a Combine's result is patterned by the kernel's move, its copies' faces named by the Pattern", async () => {
  // Box 1 (10 mm cube) joined with Box 2 (10 × 20 × 5) at the origin: 1,000 + 1,000 − 500 = 1,500 mm³, x 0..10, y 0..20.
  const two = insertPreset(partDocument("box", 10, 10, 10), "box", 10, 20, 5).doc;
  const joined = insertCombine(two, "body:feature-1", ["body:feature-2"], "join", false).doc;
  const { doc, id } = insertPattern(joined, ["body:feature-1"], row({ count: 2 }));
  const { build, cache, view } = await built(doc);
  assert.equal(build.results[id].status, "built");
  const copy = `body:${id}/piece:1`;
  near((await view(copy)).volume, 1500, "copy");
  assert.deepEqual(box(await view(copy)), [15, 0, 0, 25, 20, 10]);
  assert.equal(build.bodies[copy].spec, null);
  const names = build.bodies[copy].named!.faces.flatMap((f) => f.names);
  assert.ok(names.length > 0 && names.every((n) => n.startsWith(`face:${id}/`)), "every face named by the Pattern");
  await cache.close();
});

test("refusals: a deleted, suppressed or used-up body; a copy out past model space; nothing changed", async () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row());
  // Suppressed: greyed by it, never failed (Q3).
  const off = await built(suppressItem(doc, "feature-1", true));
  assert.deepEqual(off.build.results[id], { status: "greyed", by: "feature-1" });
  await off.cache.close();
  // Deleted: failed naming it.
  const gone = await built(deleteItem(doc, "feature-1"));
  assert.deepEqual(gone.build.results[id], { status: "failed", cause: "deleted-input", input: "feature-1", message: "Box 1 was deleted, so Pattern 1 has nothing to copy" });
  await gone.cache.close();
  // Used up by an earlier Combine (Box 1 a tool of Box 2).
  const two = insertPreset(d0, "box", 10, 10, 10).doc;
  const used = insertCombine(two, "body:feature-2", [body], "join", false).doc;
  const p = insertPattern(used, [body], row());
  const u = await built(p.doc);
  assert.deepEqual(u.build.results[p.id], { status: "failed", cause: "failed-input", input: "feature-1", message: "Pattern 1 can't copy Box 1: an earlier Combine or extrude used it up or left no such piece" });
  await u.cache.close();
  // 120 cubes 1 km apart: the last at x 119 km, out past the kernel's model space (±100 km). Refused in its words, no copy left.
  const far = insertPattern(d0, [body], row({ spacing: 1_000_000, count: 120 }));
  const f = await built(far.doc);
  const r = f.build.results[far.id];
  assert.deepEqual(r, { status: "failed", cause: "error", message: "Pattern 1 can't be made: result would reach 1.0000001e8 mm from the origin; the limit is 1e8 mm" });
  assert.deepEqual(Object.keys(f.build.bodies), [body]);
  await f.cache.close();
});

test("Join of a body with a curved face is refused in the Pattern's words while the kernel can't join it", async () => {
  // A cylinder Ø10 at the origin, copies 5 mm along X: they overlap, so the Join needs a curved boolean.
  const d0 = partDocument("cylinder", 10, 10, 10);
  const { doc, id } = insertPattern(d0, ["body:feature-1"], row({ spacing: 5, count: 2, join: true }));
  const { build, cache, view } = await built(doc);
  const r = build.results[id];
  if (r.status === "built") {
    // A kernel that joins them: one body, two discs Ø10 5 mm apart, 10 high: 2 · 250π − the lens (2r²·acos(d/2r) − (d/2)·√(4r² − d²)) · 10.
    const lens = 2 * 25 * Math.acos(5 / 10) - 2.5 * Math.sqrt(100 - 25);
    near((await view("body:feature-1")).volume, (2 * 25 * Math.PI - lens) * 10, "joined discs");
  } else assert.deepEqual(r, { status: "failed", cause: "error", message: "Pattern 1 can't be made: Join can't join copies of a body with curved faces yet (that comes with curved Combine). Turn Join off to keep the copies as separate bodies." });
  await cache.close();
});

test("the data: version 25 holds a Pattern and reads back the same; version 24 holding one is refused; every break is refused", () => {
  assert.equal(DESIGN_VERSION, 30);
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row({ direction2: "Y", spacing2: 20, count2: 2 }));
  const saved = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(readDesignDocument(saved), doc, "round trip");
  const at = saved.timeline.features.findIndex((f: { id: string }) => f.id === id);
  const broken = (patch: (f: Record<string, any>) => void, version = 28) => {
    const copy = JSON.parse(JSON.stringify(saved));
    patch(copy.timeline.features[at]);
    return { ...copy, version };
  };
  assert.throws(() => readDesignDocument(broken(() => {}, 24)), { message: "Design data says version 24 but has a Pattern, which version 25 brought" });
  const p = (f: Record<string, any>) => f.intent.parameters;
  assert.throws(() => readDesignDocument(broken((f) => (p(f).kind = "spiral"))), { message: `Design pattern ${id}: its kind spiral is not linear or circular` });
  assert.throws(() => readDesignDocument(broken((f) => (p(f).axis = "Z"))), { message: `Design pattern ${id}: it has a value "axis" a linear pattern doesn't have` });
  assert.throws(() => readDesignDocument(broken((f) => delete p(f).count2)), { message: `Design pattern ${id}: it has no count2` });
  assert.throws(() => readDesignDocument(broken((f) => (p(f).join = "yes"))), { message: `Design pattern ${id}: its join yes is not true or false` });
  assert.throws(() => readDesignDocument(broken((f) => (p(f).direction2 = "X"))), { message: `Design pattern ${id}: The second direction must be another axis, or the copies would land on each other.` });
  assert.throws(() => readDesignDocument(broken((f) => (p(f).bodies = []))), { message: `Design pattern ${id} patterns no body` });
  assert.throws(() => readDesignDocument(broken((f) => (p(f).bodies = [body, body]))), { message: `Design pattern ${id} patterns ${body} twice` });
  assert.throws(() => readDesignDocument(broken((f) => (p(f).bodies = ["body:feature-2"]))), { message: `Design pattern ${id} patterns body:feature-2, which is not a body made before it in the timeline` });
  assert.throws(() => readDesignDocument(broken((f) => (f.dependsOn = []))), { message: `Design pattern ${id} must depend on exactly the items that made the bodies it patterns (feature-1), in that order` });
  // Its own copies are pieces of the design once numbered, and a body deleted since still opens (the rebuild fails it in words).
  assert.equal(readDesignDocument(JSON.parse(JSON.stringify(deleteItem(doc, "feature-1")))).timeline.features.length, 1);
});

test("the data's limits either side: a spacing 0.9 × and 1.1 × of 1 µm, 256 instances and 257", () => {
  const { doc: d0, body } = cube();
  const { doc, id } = insertPattern(d0, [body], row());
  const saved = JSON.parse(JSON.stringify(doc));
  const at = saved.timeline.features.findIndex((f: { id: string }) => f.id === id);
  const withParams = (over: Record<string, unknown>) => {
    const copy = JSON.parse(JSON.stringify(saved));
    Object.assign(copy.timeline.features[at].intent.parameters, over);
    return copy;
  };
  // 1 µm is the least spacing: 0.0011 mm opens, 0.0009 mm is refused in the tool's words.
  assert.equal(readDesignDocument(withParams({ spacing: 0.0011 })).version, 30);
  assert.throws(() => readDesignDocument(withParams({ spacing: 0.0009 })), { message: `Design pattern ${id}: The spacing must be at least 0.001 mm (it can be negative to go the other way).` });
  // 256 instances fit one Join; 257 are refused.
  assert.equal(readDesignDocument(withParams({ count: 256 })).version, 30);
  assert.throws(() => readDesignDocument(withParams({ count: 257 })), { message: `Design pattern ${id}: A pattern makes at most 256, the body included; this one would make 257.` });
});

test("what a Pattern uses and changes for the items after it: its bodies; changed only with Join", async () => {
  const { bodiesUsed, bodiesChanged } = await import("../src/body-uses.ts");
  const { doc: d0, body } = cube();
  const plain = insertPattern(d0, [body], row());
  const joined = insertPattern(d0, [body], row({ join: true }));
  const item = (d: DesignDocument, id: string) => d.timeline.features.find((f) => f.id === id)!;
  assert.deepEqual(bodiesUsed(item(plain.doc, plain.id)), [body]);
  assert.deepEqual(bodiesChanged(item(plain.doc, plain.id)), [], "the copies are new bodies; the cube stays as it was");
  assert.deepEqual(bodiesChanged(item(joined.doc, joined.id)), [body], "with Join the cube is joined to its copies");
});
