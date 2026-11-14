// SL #583 item 3 (Combine hunt 4, 2026-11-11): a sketch on a pocket's wall that a Combine Cut made, after the Combine is
// switched to Join or Intersect, or suppressed. The wall's name is the cut tool's own face (rule 2: a hole's wall is
// the cut tool's side), so the name still finds a face, the tool's own, facing the other way with the solid on its far
// side: the sketch sat there silently, its pad buried in the solid. From Design data version 19 a face sketch records
// whether its face was a cut tool's face turned round (`SketchFace.reversed`), so a face found the other way about is
// its face gone. And an Extrude Join whose bump lies wholly inside Body 1 said it "doesn't reach" it. Every number is
// worked out by hand from the boxes' corners in the comment beside it, on the real rebuild and kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedCombine, insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, readDesignDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { sketchEdgeTargets } from "../src/face-edges.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { askWords } from "../src/cut-ask.ts";
import { missWords } from "../src/misses.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { addFaceSketch, drawRectangle, pinNewPoints } from "../src/sketch.ts";
import { moveMarker, suppressItem } from "../src/timeline-edits.ts";

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
 * y 24..36, z 24..36 (on a face facing x the sketch's x and y are the world's y and z), pinned to the wall's corners
 * instead when `pinned` (the square y 20..40, z 20..40), extruded 4 along +x (feature-6) as a new body, or joined to Box 1.
 */
async function pocketPad(pinned: boolean, join: boolean) {
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
  const [a, c]: [number, number][] = pinned ? [[20, 20], [40, 40]] : [[24, 24], [36, 36]];
  const drawn = drawRectangle(s.doc, s.id, a, c).doc;
  doc = pinned ? pinNewPoints(s.doc, drawn, s.id, sketchEdgeTargets(drawn, s.id, before.scene, spot.drawn.plane)) : drawn;
  if (pinned) assert.equal(doc.sketches.find((k) => k.id === s.id)!.pins?.length, 4, "the four corners pinned to the wall's");
  await before.cache.close();
  const e = extrudeSketch(doc, s.id, 4, false, undefined, join ? { operation: "join", bodies: ["body:feature-1"] } : null);
  return { doc: e.doc, sketch: s.id, extrude: e.id };
}

const combineAs = (doc: DesignDocument, op: CombineOperation) => changedCombine(doc, "feature-4", "body:feature-1", ["body:feature-2"], op, false);

test("hand-worked control: on the Cut the sketch lies on the pocket wall x = 30 facing +x, with no warning, and the pad fills x 30..34", async () => {
  const p = await pocketPad(false, false);
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

for (const [how, edit] of [
  ["switched to Join", (d: DesignDocument) => combineAs(d, "join")],
  ["switched to Intersect", (d: DesignDocument) => combineAs(d, "intersect")],
  ["suppressed", (d: DesignDocument) => suppressItem(d, "feature-4", true)],
] as const) {
  test(`a sketch on a Cut's pocket wall says its face is lost once the Combine is ${how}, and stays where it was`, async () => {
    const p = await pocketPad(false, false);
    const b = await built(edit(p.doc));
    const r = b.build.results[p.sketch];
    assert.equal(r.status, "built", JSON.stringify(r));
    assert.ok(r.status === "built");
    // Join: Box 2's left face is left only above Box 1, x = 30, y 20..40, z 40..50, facing −x (the solid is on its +x
    // side). Intersect: the block x 30..50, y 20..40, z 20..40, its x = 30 face facing −x. Suppressed: Box 2 whole, its
    // left face facing −x. Each time the face carrying the name faces the other way from the wall the sketch was drawn
    // on (+x, the solid on its −x side): that wall is gone, so the plane is lost and the sketch stays where it was
    // (planeWords "plane-lost"), never placed silently on a face whose solid lies where the pocket was.
    assert.equal(r.plane?.cause, "plane-lost", `placed with no warning: ${JSON.stringify(r.placement)}`);
    assert.equal(r.plane!.message, "Sketch 1's face is gone, so its plane is lost: it stays where it was");
    // Where it was: x = 30 facing +x, so its pad is still x 30..34 (576 mm³).
    assert.deepEqual(r.placement!.plane.normal, [1, 0, 0]);
    assert.deepEqual(r.placement!.plane.origin, [30, 0, 0]);
    const pad = await b.cache.view(b.build.bodies[`body:${p.extrude}`].handle);
    near(pad.volume, 576);
    assert.deepEqual(pad.bounds, [[30, 24, 24], [34, 36, 36]]);
    await b.cache.close();
  });
}

test("a sketch pinned to the pocket wall's corners: its plane is lost on the Join, greyed when the Combine its pins name is suppressed", async () => {
  const p = await pocketPad(true, false);
  const cut = await built(p.doc);
  const r0 = cut.build.results[p.sketch];
  assert.ok(r0.status === "built" && r0.plane === undefined, JSON.stringify(r0));
  await cut.cache.close();
  // On the Join the wall is gone as for the unpinned sketch: the same plane warning, the pins not judged (rule 10).
  const joined = await built(combineAs(p.doc, "join"));
  const r = joined.build.results[p.sketch];
  assert.ok(r.status === "built" && r.plane?.cause === "plane-lost", JSON.stringify(r));
  await joined.cache.close();
  // Suppressed: its pins name the Combine's edges (the wall's corners are the Combine's, design-edges.ts), so it greys
  // with the Combine (rule 13, Fusion's Q3) before its plane is looked at; the unpinned one names only Box 2's face.
  const off = await built(suppressItem(p.doc, "feature-4", true));
  assert.deepEqual(off.build.results[p.sketch], { status: "greyed", by: "feature-4" });
  await off.cache.close();
});

test("an Extrude Join whose bump lies wholly inside Body 1 once the Combine is a Join says it lies inside, not that it doesn't reach", async () => {
  const p = await pocketPad(false, true);
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


test("the drawn side is recorded: reversed on the pocket wall, not on the tool's own face, and a sketch drawn on that face is lost once the Combine is a Cut", async () => {
  // On the Cut the wall is Box 2's left face turned round (the kernel's result face faces +x, Box 2's own −x).
  const cut = await pocketPad(false, false);
  assert.equal(cut.doc.sketches.find((k) => k.id === cut.sketch)!.face!.reversed, true);
  // Joined: Box 2's left face is left above Box 1 (x = 30, y 20..40, z 40..50), facing −x as Box 2's own: not reversed.
  let doc = combineAs(cut.doc, "join");
  doc = moveMarker(doc, "feature-4");
  const joined = await built(doc);
  const b = joined.scene.bodies.findIndex((s) => s.body === "body:feature-1");
  const v = joined.scene.bodies[b].view;
  // That face: normal (−1, 0, 0), centroid (30, 30, 45).
  const k = v.face_normals.findIndex((m, i) => m !== null && m[0] === -1 && Math.abs(v.face_centroids[i][2] - 45) < 1e-9);
  assert.ok(k >= 0);
  const spot = sketchSpot({ face: joined.scene.faceStart[b] + k, shift: false }, joined.scene);
  assert.ok(spot?.kind === "face");
  assert.equal(spot.face.plane, "face:feature-2/left");
  assert.equal(spot.face.reversed, false);
  await joined.cache.close();
  const s = addFaceSketch(doc, spot.face, spot.drawn);
  // Switched back to a Cut, the name finds the pocket wall facing +x, Box 2's face turned round: the face it was drawn
  // on (the outside, facing −x) is gone, so its plane is lost and it stays at x = 30 facing −x, side −1 (YZ's normal +x).
  const back = await built(combineAs(moveMarker(s.doc, null), "cut"));
  const r = back.build.results[s.id];
  assert.ok(r.status === "built" && r.plane?.cause === "plane-lost", JSON.stringify(r));
  assert.deepEqual(r.placement!.plane.origin, [30, 0, 0]);
  await back.cache.close();
});

test("control: a sketch from before version 19 (no record of its side) is placed as before, never judged", async () => {
  const p = await pocketPad(false, false);
  const old = { ...p.doc, sketches: p.doc.sketches.map((k) => (k.id === p.sketch ? { ...k, face: { ...k.face!, reversed: undefined } } : k)) };
  delete (old.sketches.find((k) => k.id === p.sketch)!.face as { reversed?: boolean }).reversed;
  // Switched to Join it lies on Box 2's own face as it always did: no warning, frame x = 30 facing +x as drawn.
  const b = await built(combineAs(old, "join"));
  const r = b.build.results[p.sketch];
  assert.ok(r.status === "built" && r.plane === undefined, JSON.stringify(r));
  assert.deepEqual(r.placement!.plane.origin, [30, 0, 0]);
  await b.cache.close();
});

test("data version 19: the record reads back, version 18 data opens with none, and a wrong one is refused in words", async () => {
  const p = await pocketPad(false, false);
  assert.equal(p.doc.version, 22);
  const json = JSON.parse(JSON.stringify(p.doc));
  assert.deepEqual(readDesignDocument(json), p.doc);
  // Version 18 data never holds the record: opened as 20, its sketch with none, so never judged.
  const v18 = JSON.parse(JSON.stringify(p.doc));
  v18.version = 18;
  delete v18.sketches.find((k: { id: string }) => k.id === p.sketch).face.reversed;
  const opened = readDesignDocument(v18);
  assert.equal(opened.version, 22);
  assert.equal(opened.sketches.find((k) => k.id === p.sketch)!.face!.reversed, undefined);
  // Version 18 or 17 data holding it is refused: only version 19 brought it.
  for (const version of [18, 17]) {
    const early = JSON.parse(JSON.stringify(p.doc));
    early.version = version;
    assert.throws(() => readDesignDocument(early), new RegExp(`Design data says version ${version} but has a sketch recording which way its face was drawn, which version 19 brought`));
  }
  // Not true or false: refused.
  const bad = JSON.parse(JSON.stringify(p.doc));
  bad.sketches.find((k: { id: string }) => k.id === p.sketch).face.reversed = "yes";
  assert.throws(() => readDesignDocument(bad), new RegExp(`Design sketch ${p.sketch}'s reversed must be true or false, not yes`));
});
