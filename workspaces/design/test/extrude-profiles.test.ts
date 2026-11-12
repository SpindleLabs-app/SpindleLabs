// An extrude of several profiles at once (Ben, 2026-11-11, as Fusion's
// Extrude with several profiles picked; Design data version 18): one
// timeline item, its first profile as before (`sketch`, `region`) and the
// rest in `more`. As a new body, profiles that touch come out as one body
// and profiles apart as separate bodies: the body holding the first
// profile keeps the extrude's own id, the others are its pieces. Built by
// the real rebuild on the real kernel; every volume worked out by hand
// from the rectangles drawn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { numberPieces, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { designBodies } from "../src/browser.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { moreProfiles, type ProfileRef } from "../src/extrude-profiles.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline, settleKept, type TimelineBuild } from "../src/rebuild.ts";
import { regionRef, sketchRegions, type RegionRef } from "../src/regions.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { deleteItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
type Rect = [[number, number], [number, number]];

/** `doc` with a sketch on XY holding each rectangle: the sketch's id. */
function sketched(doc: DesignDocument, ...rects: Rect[]): { doc: DesignDocument; id: string } {
  const s = addSketch(doc);
  let d = s.doc;
  for (const [a, c] of rects) d = drawRectangle(d, s.id, a, c).doc;
  return { doc: d, id: s.id };
}

/** The region of sketch `id` whose centroid is (x, y), as an extrude saves it. */
async function regionAt(doc: DesignDocument, id: string, x: number, y: number): Promise<RegionRef> {
  const found = await sketchRegions(kernel, doc.sketches.find((s) => s.id === id)!);
  const r = found.regions.find((g) => Math.hypot(g.centroid[0] - x, g.centroid[1] - y) < 1e-6);
  assert.ok(r, `no region of ${id} with its centroid at ${x}, ${y}: ${found.regions.map((g) => g.centroid.join(",")).join(" ")}`);
  return regionRef(r, found.ids);
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; volumes: (item: string) => Promise<Map<string, number>> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const volumes = async (item: string) => {
    const r = build.results[item];
    assert.equal(r.status, "built", JSON.stringify(r));
    const ids = r.status === "built" ? r.bodies : [];
    return new Map(await Promise.all(ids.map(async (b) => [b, (await cache.view(build.bodies[b].handle)).volume] as const)));
  };
  return { build, volumes };
}

const near = (got: number | undefined, want: number) => assert.ok(got !== undefined && Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got}, expected ${want}`);

test("hand-worked: two touching squares of one sketch extruded together make one body", async () => {
  // Squares x 0..10 and x 10..20, y 0..10, sharing the side x = 10: two regions, centroids (5, 5) and (15, 5).
  const s = sketched(freshDesign(), [[0, 0], [10, 10]], [[10, 0], [20, 10]]);
  const a = await regionAt(s.doc, s.id, 5, 5);
  const b = await regionAt(s.doc, s.id, 15, 5);
  const made = extrudeSketch(s.doc, s.id, 5, false, a, null, [{ sketch: s.id, region: b }]);
  const f = made.doc.timeline.features.find((x) => x.id === made.id)!;
  assert.deepEqual(moreProfiles(f), [{ sketch: s.id, region: b }]);
  // One item, depending on its one sketch.
  assert.deepEqual(f.dependsOn, [s.id]);
  const { build, volumes } = await built(made.doc);
  const v = await volumes(made.id);
  // The two prisms joined: a 20 × 10 × 5 block, 1,000 mm³, one body, the extrude's own.
  assert.deepEqual([...v.keys()], [`body:${made.id}`]);
  near(v.get(`body:${made.id}`), 1000);
  // A block: 6 faces, the shared side gone and the two top caps one face.
  const cache = new BodyCache(kernel);
  const again = await rebuildTimeline(made.doc, cache, kernel);
  assert.equal((await cache.view(again.bodies[`body:${made.id}`].handle)).face_roles.length, 6);
  assert.ok(build.bodies[`body:${made.id}`]);
});

test("hand-worked: two squares apart make two bodies from one item, the first profile's keeping the extrude's id", async () => {
  // Squares x 0..10 and x 15..25 (5 mm apart), extruded 4 mm: 10 × 10 × 4 = 400 mm³ each, two bodies.
  const s = sketched(freshDesign(), [[0, 0], [10, 10]], [[15, 0], [25, 10]]);
  const a = await regionAt(s.doc, s.id, 5, 5);
  const b = await regionAt(s.doc, s.id, 20, 5);
  // The second square picked first: its body is the extrude's own; the first square's is piece 1.
  const made = extrudeSketch(s.doc, s.id, 4, false, b, null, [{ sketch: s.id, region: a }]);
  const v = await volumes2(made.doc, made.id);
  assert.deepEqual([...v.keys()].sort(), [`body:${made.id}`, `body:${made.id}/piece:1`]);
  near(v.get(`body:${made.id}`), 400);
  near(v.get(`body:${made.id}/piece:1`), 400);
  // The own body is the one over x 15..25 (the profile picked first).
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(made.doc, cache, kernel);
  const low = (await cache.view(build.bodies[`body:${made.id}`].handle)).bounds;
  near(low[0][0], 15);
  near(low[1][0], 25);
  // Both are bodies of the design once numbered: Body 1 and Body 2.
  const numbered = numberPieces(made.doc, Object.keys(build.bodies), builtPieceFaces(build));
  assert.deepEqual(designBodies(numbered).map((x) => x.body).sort(), [`body:${made.id}`, `body:${made.id}/piece:1`]);
});

async function volumes2(doc: DesignDocument, id: string) {
  return (await built(doc)).volumes(id);
}

test("hand-worked: profiles from two sketches, two touching and one apart, make two bodies", async () => {
  // Sketch 1: x 0..10, y 0..10. Sketch 2 (also on XY): x 10..20 (touching sketch 1's square along x = 10) and x 30..40.
  // Extruded 3 mm: the touching pair is 20 × 10 × 3 = 600 mm³, the square apart 10 × 10 × 3 = 300 mm³.
  const one = sketched(freshDesign(), [[0, 0], [10, 10]]);
  const two = sketched(one.doc, [[10, 0], [20, 10]], [[30, 0], [40, 10]]);
  const near2 = await regionAt(two.doc, two.id, 15, 5);
  const far = await regionAt(two.doc, two.id, 35, 5);
  const more: ProfileRef[] = [{ sketch: two.id, region: near2 }, { sketch: two.id, region: far }];
  const made = extrudeSketch(two.doc, one.id, 3, false, undefined, null, more);
  const f = made.doc.timeline.features.find((x) => x.id === made.id)!;
  // It depends on both sketches, the first profile's first.
  assert.deepEqual(f.dependsOn, [one.id, two.id]);
  const v = await volumes2(made.doc, made.id);
  near(v.get(`body:${made.id}`), 600);
  near(v.get(`body:${made.id}/piece:1`), 300);
  assert.equal(v.size, 2);
});

test("self-consistency: flipped, the bodies go the other way with the same volumes", async () => {
  const s = sketched(freshDesign(), [[0, 0], [10, 10]], [[10, 0], [20, 10]]);
  const a = await regionAt(s.doc, s.id, 5, 5);
  const b = await regionAt(s.doc, s.id, 15, 5);
  const made = extrudeSketch(s.doc, s.id, 5, true, a, null, [{ sketch: s.id, region: b }]);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(made.doc, cache, kernel);
  const view = await cache.view(build.bodies[`body:${made.id}`].handle);
  near(view.volume, 1000);
  // Flipped from XY: z −5..0.
  near(view.bounds[0][2], -5);
  near(view.bounds[1][2], 0);
});

test("refusals: no profile twice, no sketch after the marker, no other item, and no operation with several profiles yet", async () => {
  const s = sketched(freshDesign(), [[0, 0], [10, 10]], [[10, 0], [20, 10]]);
  const a = await regionAt(s.doc, s.id, 5, 5);
  const b = await regionAt(s.doc, s.id, 15, 5);
  assert.throws(() => extrudeSketch(s.doc, s.id, 5, false, a, null, [{ sketch: s.id, region: a }]), /picked twice/);
  assert.throws(() => extrudeSketch(s.doc, s.id, 5, false, a, null, [{ sketch: s.id, region: b }, { sketch: s.id, region: b }]), /picked twice/);
  assert.throws(() => extrudeSketch(s.doc, s.id, 5, false, a, null, [{ sketch: "feature-99" }]), /not a sketch/);
  const box = extrudeSketch(s.doc, s.id, 5, false, a);
  assert.throws(() => extrudeSketch(box.doc, s.id, 5, false, a, null, [{ sketch: box.id }]), /not a sketch/);
  assert.throws(() => extrudeSketch(s.doc, s.id, 5, false, a, { operation: "join", bodies: [`body:${box.id}`] }, [{ sketch: s.id, region: b }]), /one profile/);
});

test("the file: version 18 keeps `more`; the reader refuses bad ones and older versions holding one", async () => {
  const s = sketched(freshDesign(), [[0, 0], [10, 10]], [[10, 0], [20, 10]]);
  const a = await regionAt(s.doc, s.id, 5, 5);
  const b = await regionAt(s.doc, s.id, 15, 5);
  const made = extrudeSketch(s.doc, s.id, 5, false, a, null, [{ sketch: s.id, region: b }]).doc;
  const text = JSON.parse(JSON.stringify(made));
  assert.deepEqual(readDesignDocument(text), made);
  const withMore = (more: unknown, dependsOn?: string[]) => {
    const d = JSON.parse(JSON.stringify(made));
    const f = d.timeline.features.at(-1);
    f.intent.parameters.more = more;
    if (dependsOn) f.dependsOn = dependsOn;
    return d;
  };
  assert.throws(() => readDesignDocument(withMore([])), /more profiles/);
  assert.throws(() => readDesignDocument(withMore("x")), /more profiles/);
  assert.throws(() => readDesignDocument(withMore([{ sketch: s.id, region: a }])), /twice/);
  assert.throws(() => readDesignDocument(withMore([{ sketch: s.id, region: b, extra: 1 }])), /extra/);
  assert.throws(() => readDesignDocument(withMore([{ sketch: "feature-99" }])), /feature-99/);
  assert.throws(() => readDesignDocument(withMore([{ sketch: s.id, region: { outer: [], centroid: [0, 0] } }])), /region/);
  // A sketch of `more` must be in dependsOn, after the first profile's.
  const other = sketched(made, [[30, 0], [40, 10]]);
  const late = JSON.parse(JSON.stringify(other.doc));
  // Moved before the extrude so it is a sketch before it, but not depended on.
  const ext = late.timeline.features.find((f: { id: string }) => f.id === made.timeline.features.at(-1)!.id);
  late.timeline.features = late.timeline.features.filter((f: { id: string }) => f !== ext);
  late.timeline.features.push(ext);
  delete late.timeline.marker;
  ext.intent.parameters.more = [{ sketch: other.id }];
  assert.throws(() => readDesignDocument(late), /depend/);
  ext.dependsOn = [s.id, other.id];
  assert.equal(moreProfiles(readDesignDocument(late).timeline.features.at(-1)!).length, 1);
  // Older data never held one.
  const old = JSON.parse(JSON.stringify(made));
  old.version = 16;
  assert.throws(() => readDesignDocument(old), /version 18/);
});

test("the owner's rule: a profile whose sketch is deleted keeps its last shape, with a warning", async () => {
  const one = sketched(freshDesign(), [[0, 0], [10, 10]]);
  const two = sketched(one.doc, [[30, 0], [40, 10]]);
  const made = extrudeSketch(two.doc, one.id, 2, false, undefined, null, [{ sketch: two.id }]);
  // 10 × 10 × 2 = 200 mm³ each, apart: two bodies.
  const v = await volumes2(made.doc, made.id);
  near(v.get(`body:${made.id}`), 200);
  near(v.get(`body:${made.id}/piece:1`), 200);
  const gone = await settleKept(kernel, made.doc, deleteItem(made.doc, two.id));
  const after = await built(gone);
  const r = after.build.results[made.id];
  assert.equal(r.status, "built");
  assert.ok(r.status === "built" && r.warning !== undefined && r.warning.sketch === two.id, JSON.stringify(r));
  const w = await after.volumes(made.id);
  near(w.get(`body:${made.id}/piece:1`), 200);
  // Its kept shape is filed under the extrude and its place among the profiles (version 19, SL #632).
  assert.deepEqual(Object.keys(gone.kept ?? {}), [`${made.id}/profile:1`]);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(gone))), gone);
});
