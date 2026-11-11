// SL #583 item 3 (Combine hunt 4, 2026-11-11): a pad on a pocket's wall that a Combine Cut made. Joined into Body 1
// as an Extrude Join, then the Combine switched to Join, the bump lies wholly inside Body 1: the row said "adds
// nothing: it doesn't reach Body 1". A Join's tool none of whose faces is left on the result lies inside, so the words
// say so (misses.ts, cut-ask.ts). The sketch itself staying silently on the tool's own face once the wall is gone is
// not fixed here (it needs the sketch to know its face was a cut's wall: a data version). Every number is worked out
// by hand from the boxes' corners in the comment beside it, on the real rebuild and kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedCombine, insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { askWords } from "../src/cut-ask.ts";
import { missWords } from "../src/misses.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { addFaceSketch, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${got}, expected ${want}`);

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; cache: BodyCache; scene: Scene }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The joined index of the face of body `body` facing `n` whose centroid's x is `x`. */
function faceAt(scene: Scene, body: string, n: number[], x: number): number {
  const b = scene.bodies.findIndex((s) => s.body === body);
  const v = scene.bodies[b].view;
  const k = v.face_normals.findIndex((m, i) => m !== null && m.every((c, j) => Math.abs(c - n[j]) < 1e-12) && Math.abs(v.face_centroids[i][0] - x) < 1e-9);
  assert.ok(k >= 0, `${body} has a face facing ${n} at x ${x}`);
  return scene.faceStart[b] + k;
}

/**
 * Box 1 80 × 60 × 40 (feature-1) cut by Box 2 20 × 20 × 30 (feature-2) moved (30, 20, 20) (feature-3), so x 30..50,
 * y 20..40, z 20..50: Combine 1 (feature-4) leaves 80·60·40 − 20·20·20 = 192,000 − 8,000 = 184,000 and a pocket whose
 * wall at x = 30 (y 20..40, z 20..40) faces +x, into the pocket. A sketch on that wall (feature-5) holds the square
 * y 24..36, z 24..36 (on a face facing x the sketch's x and y are the world's y and z), extruded 4 along +x
 * (feature-6) as a new body, or joined to Box 1.
 */
async function pocketPad(join: boolean) {
  let doc = partDocument("box", 80, 60, 40);
  doc = insertPreset(doc, "box", 20, 20, 30).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 30, y: 20, z: 20 }).doc;
  doc = insertCombine(doc, "body:feature-1", ["body:feature-2"], "cut").doc;
  const before = await built(doc);
  const spot = sketchSpot({ face: faceAt(before.scene, "body:feature-1", [1, 0, 0], 30), shift: false }, before.scene);
  assert.ok(spot?.kind === "face");
  // The wall is the tool's left face (rule 2), whole: one face carries the name, so it has no tag.
  assert.equal(spot.face.plane, "face:feature-2/left");
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  doc = drawRectangle(s.doc, s.id, [24, 24], [36, 36]).doc;
  await before.cache.close();
  const e = extrudeSketch(doc, s.id, 4, false, undefined, join ? { operation: "join", bodies: ["body:feature-1"] } : null);
  return { doc: e.doc, sketch: s.id, extrude: e.id };
}

const combineAs = (doc: DesignDocument, op: CombineOperation) => changedCombine(doc, "feature-4", "body:feature-1", ["body:feature-2"], op, false);

test("hand-worked control: on the Cut the sketch lies on the pocket wall x = 30 facing +x, with no warning, and the pad fills x 30..34", async () => {
  const p = await pocketPad(false);
  const b = await built(p.doc);
  const r = b.build.results[p.sketch];
  assert.ok(r.status === "built" && r.plane === undefined, JSON.stringify(r));
  // The frame on a face facing +x is YZ's: normal (1, 0, 0), origin the plane x = 30's nearest point to the world's origin.
  assert.deepEqual(r.placement!.plane.normal, [1, 0, 0]);
  assert.deepEqual(r.placement!.plane.origin, [30, 0, 0]);
  // The pad: 12 × 12 × 4 = 576 mm³, x 30..34 (out of the wall into the pocket), y and z 24..36.
  const pad = await b.cache.view(b.build.bodies[`body:${p.extrude}`].handle);
  near(pad.volume, 576);
  assert.deepEqual(pad.bounds, [[30, 24, 24], [34, 36, 36]]);
  await b.cache.close();
});

test("an Extrude Join whose bump lies wholly inside Body 1 once the Combine is a Join says it lies inside, not that it doesn't reach", async () => {
  const p = await pocketPad(true);
  const cut = await built(p.doc);
  // On the Cut the bump fills part of the pocket: 184,000 + 576 = 184,576, one body, and no warning.
  const r0 = cut.build.results[p.extrude];
  assert.ok(r0.status === "built" && r0.misses === undefined, JSON.stringify(r0));
  near((await cut.cache.view(cut.build.bodies["body:feature-1"].handle)).volume, 184576);
  await cut.cache.close();
  // Joined: Box 1 ∪ Box 2 = 192,000 + 20·20·10 above the top = 196,000; the bump x 30..34, y and z 24..36 is wholly
  // inside Box 1 (x 0..80, y 0..60, z 0..40), so it adds nothing, and none of its faces is left on the result.
  const b = await built(combineAs(p.doc, "join"));
  const r = b.build.results[p.extrude];
  assert.ok(r.status === "built");
  near((await b.cache.view(b.build.bodies["body:feature-1"].handle)).volume, 196000);
  assert.equal(r.misses?.message, "Extrude 1 adds nothing: it lies wholly inside Body 1");
  await b.cache.close();
});

test("the words: an extrude joined wholly inside says so on its row and in the question; one that misses still says it doesn't reach", () => {
  const name = (b: string) => ({ b1: "Body 1", own: "Extrude 1" })[b] ?? b;
  assert.equal(missWords("Extrude 1", "join", [{ target: "b1", tools: ["own"], inside: ["own"] }], name, "own"), "Extrude 1 adds nothing: it lies wholly inside Body 1");
  assert.equal(missWords("Extrude 1", "join", [{ target: "b1", tools: ["own"] }], name, "own"), "Extrude 1 adds nothing: it doesn't reach Body 1");
  const asking = { kind: "extrude", label: "Extrude 1", own: "own" } as const;
  const inside = askWords("join", [{ target: "b1", tools: ["own"], inside: ["own"] }], name, asking);
  assert.equal(inside.words, "Extrude 1 lies wholly inside Body 1, so joining it adds nothing. It may point the wrong way: Flip turns it round. Join anyway, or cancel and change it?");
  assert.match(askWords("join", [{ target: "b1", tools: ["own"] }], name, asking).words, /^Extrude 1 doesn't reach Body 1, so it stays a separate piece\./);
});

