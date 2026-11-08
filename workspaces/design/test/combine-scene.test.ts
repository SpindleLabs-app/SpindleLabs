// Step 35f1e: names across the whole design once a Combine built (rules 3,
// 5 and 6 of docs/document-model.md section 8), as the app uses them: the
// scene's references to faces and edges of a Combine's result, finding them
// again, a click putting a sketch on such a face, and a sketch drawn on a
// face that a Combine later split. Every name and number is worked out by
// hand from the boxes' corners beside it, on the real rebuild and kernel.
// (The cuts here leave no faces lying on each other, so the shipped kernel
// and the next one with face merging answer alike.)

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GeometryReference, StableId } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { faceHeld, sketchEdgeTargets } from "../src/face-edges.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, settleKept } from "../src/rebuild.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { editFeature } from "../src/feature-edit.ts";
import { readDesignReference } from "../src/references.ts";
import { suppressItem } from "../src/timeline-edits.ts";
import { findInScene, joinBodies, sceneReference, shownBodies, type Scene } from "../src/scene.ts";
import { referenceLabel } from "../src/selection.ts";
import { addFaceSketch, drawCircle } from "../src/sketch.ts";

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

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  return { build, scene, cache };
}

/** The joined index of the face of shown body `body` whose outward normal is `n` and whose centroid has `x` within 1e-9 (the faces here are axis-aligned). */
function faceAt(scene: Scene, body: string, n: [number, number, number], x?: number): number {
  const b = scene.bodies.findIndex((s) => s.body === body);
  const v = scene.bodies[b].view;
  const k = v.face_normals.findIndex((m, i) => m !== null && m.every((c, j) => Math.abs(c - n[j]) < 1e-12) && (x === undefined || Math.abs(v.face_centroids[i][0] - x) < 1e-9));
  assert.ok(k >= 0, `${body} has a face facing ${n}${x === undefined ? "" : ` at x ${x}`}`);
  return scene.faceStart[b] + k;
}

const face = (id: string): GeometryReference => ({ kind: "face", id: id as StableId });

// The bar: 100 × 20 × 10 from the origin (feature-1). The slot's tool: 10 × 40 × 20 (feature-2) moved to (30, −10, −5)
// (feature-3), so x 30..40 right through, poking out at y and z. The Cut (feature-4) leaves the near piece x 0..30,
// which keeps the bar's id (rule 1: a box's faces in made order are bottom, top, front, back, left, right; left, at
// x = 0, is the first wholly in one piece), and the far piece x 40..100, piece 1.
const BAR = () => {
  const { doc, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  return { ...insertCombine(doc, bodies[0], [bodies[1]], "cut"), bodies };
};

test("hand-worked: the split top of a cut bar is named by rule 3, each piece tagged by the walls only it borders", async () => {
  const { doc, id, bodies } = BAR();
  assert.deepEqual([bodies, id], [["body:feature-1", "body:feature-2"], "feature-4"]);
  const { scene, cache } = await sceneOf(doc);
  const far = `body:${id}/piece:1`;
  // Both tops carry the bar's "top". The near one (x 0..30) borders the bar's front and back, as the far one does, and
  // its own left wall (x = 0, the bar's left) and the cut's wall at x = 30, the tool's left face (rule 2: it lies on
  // the tool's left); the far one the bar's right (x = 100) and the tool's right (x = 40). Each tag is what the
  // other piece doesn't border, sorted.
  const nearTop = faceAt(scene, "body:feature-1", [0, 0, 1]);
  const farTop = faceAt(scene, far, [0, 0, 1]);
  assert.equal(sceneReference("face", scene, nearTop)?.id, "face:feature-1/top#face:feature-1/left,face:feature-2/left");
  assert.equal(sceneReference("face", scene, farTop)?.id, "face:feature-1/top#face:feature-1/right,face:feature-2/right");
  // Each finds its own piece again; the bar's front, on both pieces too, is tagged alike by each one's end wall.
  for (const i of [nearTop, farTop]) assert.deepEqual(findInScene(sceneReference("face", scene, i)!, scene), { status: "found", index: i });
  // A face no other carries keeps its plain name: the tool's x = 40 wall, on the far piece.
  const wall = faceAt(scene, far, [-1, 0, 0], 40);
  assert.equal(sceneReference("face", scene, wall)?.id, "face:feature-2/right");
  // The top named on the whole face (a selection made before the Cut): the larger piece, 60 × 20 = 1200 mm² against
  // 30 × 20 = 600 mm² (a selection has no point it was picked at; a sketch has, below).
  assert.deepEqual(findInScene(face("face:feature-1/top"), scene), { status: "found", index: farTop });
  // A tag no piece has finds nothing (never a guess): the bar's own right wall is on the far piece only, with the
  // tool's left wall, which is on the near one.
  assert.deepEqual(findInScene(face("face:feature-1/top#face:feature-1/right,face:feature-2/left"), scene), { status: "gone" });
  // The tag's order is not part of it: a set.
  assert.deepEqual(findInScene(face("face:feature-1/top#face:feature-2/left,face:feature-1/left"), scene), { status: "found", index: nearTop });
  await cache.clear();
});

test("hand-worked: an edge of a Combine's result is named by its two faces' full names, and found again (rule 5)", async () => {
  const { doc } = BAR();
  const { scene, cache } = await sceneOf(doc);
  // The near piece's top (z = 10) meets the cut's wall (x = 30) along y 0..20 at x = 30, z = 10. Its two faces' full
  // names sorted ("face:feature-1/…" before "face:feature-2/…"), joined by "+"; no other edge joins those two, so no ";ends:".
  const b = scene.bodies.findIndex((s) => s.body === "body:feature-1");
  const v = scene.bodies[b].view;
  const e = v.edge_faces.findIndex((p, k) => p !== null && v.vertex_points.length > 0 && edgeMid(v, k).every((c, j) => Math.abs(c - [30, 10, 10][j]) < 1e-9));
  assert.ok(e >= 0, "the near piece has an edge through (30, 10, 10)");
  const ref = sceneReference("edge", scene, scene.edgeStart[b] + e)!;
  assert.equal(ref.id, "edge:face:feature-1/top#face:feature-1/left,face:feature-2/left+face:feature-2/left");
  assert.deepEqual(findInScene(ref, scene), { status: "found", index: scene.edgeStart[b] + e });
  assert.deepEqual(readDesignReference(ref), { kind: "edge", featureId: "feature-1", part: ref.id.slice(5), pair: true });
  assert.equal(referenceLabel(ref), "Edge of Top and Left");
  // An edge named before the Cut, between the bar's top and its left (rule 6): found between a face answering to each,
  // the near piece's top and the bar's x = 0 wall, at x = 0, z = 10, y 0..20.
  const old: GeometryReference = { kind: "edge", id: "edge:feature-1/left+top" as StableId }; // naming.ts: the two parts sorted
  const found = findInScene(old, scene);
  assert.equal(found.status, "found");
  const at = (found as { index: number }).index - scene.edgeStart[b];
  assert.deepEqual(edgeMid(v, at), [0, 10, 10]);
  await cache.clear();
});

/** The middle of edge `e` of a view: halfway between its two ends. */
function edgeMid(v: Scene["bodies"][number]["view"], e: number): number[] {
  const [a, b] = v.edge_vertices[e];
  return [0, 1, 2].map((j) => (v.vertex_points[a][j] + v.vertex_points[b][j]) / 2);
}

test("a click on a face of a Combine's result puts a sketch on it by its full name, a tool's face too", async () => {
  const { doc } = BAR();
  const { scene, cache } = await sceneOf(doc);
  const nearTop = faceAt(scene, "body:feature-1", [0, 0, 1]);
  const spot = sketchSpot({ face: nearTop, shift: false }, scene);
  assert.equal(spot?.kind, "face");
  assert.deepEqual(spot?.kind === "face" && spot.face, { plane: "face:feature-1/top#face:feature-1/left,face:feature-2/left", feature: "feature-1" });
  // The far piece's x = 40 wall came from the tool (feature-2), whose own body the Cut used up: before 35f1e the click
  // was refused as a face with no name of its own.
  const wall = faceAt(scene, "body:feature-4/piece:1", [-1, 0, 0], 40);
  const onWall = sketchSpot({ face: wall, shift: false }, scene);
  assert.deepEqual(onWall?.kind === "face" && onWall.face, { plane: "face:feature-2/right", feature: "feature-2" });
  await cache.clear();
});

test("hand-worked: a sketch drawn on a whole face a Combine split goes to the piece holding its origin, with a warning, and holds nothing", async () => {
  // The sketch on the bar's top drawn where 26e draws it: the frame's origin is the top's plane's nearest point to the
  // world's origin, (0, 0, 10), a corner of the near piece (x 0..30), not of the larger far one (x 40..100).
  const { doc: cut } = BAR();
  const { doc, id } = addFaceSketch(cut, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [50, 10, 10]));
  const { build, cache } = await sceneOf(doc);
  const r = build.results[id];
  assert.equal(r.status, "built");
  assert.ok(r.status === "built");
  assert.equal(r.plane?.cause, "plane-split");
  assert.deepEqual(r.placement?.plane.origin, [0, 0, 10]);
  // Tagged as the near piece, the same sketch is placed with no warning.
  const tagged = addFaceSketch(cut, { plane: "face:feature-1/top#face:feature-1/left,face:feature-2/left", feature: "feature-1" }, drawnFrame([0, 0, 1], [50, 10, 10]));
  const again = (await sceneOf(tagged.doc)).build.results[tagged.id];
  assert.ok(again.status === "built" && again.plane === undefined && again.placement?.plane.origin[2] === 10);
  // The origin breaks a tie too: the tool at x 45..55 leaves two tops of 45 × 20 = 900 mm² each, and the one holding
  // (0, 0, 10) takes the sketch (without its origin it could only be ambiguous, as the next test's).
  const { doc: even, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [45, -10, -5]]);
  const halves = addFaceSketch(insertCombine(even, bodies[0], [bodies[1]], "cut").doc, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [50, 10, 10]));
  const tie = (await sceneOf(halves.doc)).build.results[halves.id];
  assert.ok(tie.status === "built");
  assert.equal(tie.plane?.cause, "plane-split");
  await cache.clear();
});

test("hand-worked: a sketch on a piece of a split face, once no Combine splits it, finds the whole face, and says so when its origin is gone too (SL #430)", async () => {
  // The sketch drawn on the cut bar's near top piece (tag: the bar's x = 0 side and the tool's x = 30 wall), its origin
  // (0, 0, 10), as 26e draws it. With the Combine suppressed nothing is combined: the bar's top is one face again,
  // x 0..100, y 0..20 at z 10, and its corner (0, 0, 10) is the origin, so the face holds it: found, no warning.
  const { doc: cut, id: combine } = BAR();
  const near = addFaceSketch(cut, { plane: "face:feature-1/top#face:feature-1/left,face:feature-2/left", feature: "feature-1" }, drawnFrame([0, 0, 1], [15, 10, 10]));
  const runs = [await sceneOf(suppressItem(near.doc, combine, true))];
  const whole = runs[0].build.results[near.id];
  assert.ok(whole.status === "built");
  assert.equal(whole.plane, undefined);
  assert.equal(whole.placement?.plane.origin[2], 10);
  // The bar made 8 tall as well: its top is the plane z = 8, which (0, 0, 10) is 2 mm off. The one face named
  // feature-1/top now has neither the reference's tag (it borders all four sides, not the tool's wall) nor its origin,
  // so the sketch lies on it with the warning (rule 3, section 8), exactly as it does while a Combine is built (the
  // nightly session that found it: Design placed it silently whenever no body of the design was a Combine's).
  runs.push(await sceneOf(suppressItem(editFeature(near.doc, "feature-1", { height: 8 }), combine, true)));
  const lower = runs[1].build.results[near.id];
  assert.ok(lower.status === "built");
  assert.equal(lower.plane?.cause, "plane-split");
  assert.equal(lower.placement?.plane.origin[2], 8);
  // And with the Combine built, the same lower bar: the near piece is gone from z 10 too, but its tag still finds it.
  runs.push(await sceneOf(editFeature(near.doc, "feature-1", { height: 8 })));
  const built = runs[2].build.results[near.id];
  assert.ok(built.status === "built" && built.plane === undefined && built.placement?.plane.origin[2] === 8);
  for (const r of runs) await r.cache.clear();
});

test("hand-worked: a sketch on a whole face split into two equal pieces, its origin on neither, is never guessed between", async () => {
  // The bar 100 × 20 × 10 moved to x 10..110; the tool 10 × 40 × 20 at x 55..65, so the pieces x 10..55 and x 65..110
  // are both 45 × 20 = 900 mm² on top. The sketch's origin (0, 0, 10) is on neither: no piece holds it, and the
  // largest is two (a tie), so the sketch stays where it was drawn, its plane ambiguous.
  const { doc: two, bodies } = boxes([[100, 20, 10], [10, 0, 0]], [[10, 40, 20], [55, -10, -5]]);
  const { doc: cut } = insertCombine(two, bodies[0], [bodies[1]], "cut");
  const { doc, id } = addFaceSketch(cut, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [60, 10, 10]));
  const { build, cache } = await sceneOf(doc);
  const r = build.results[id];
  assert.ok(r.status === "built");
  assert.equal(r.plane?.cause, "plane-ambiguous");
  await cache.clear();
});

test("readDesignReference reads a tagged face and an edge between two faces of the design, and refuses broken ones", () => {
  assert.deepEqual(readDesignReference(face("face:feature-1/top#face:feature-1/left,face:feature-2/side:line-4")), {
    kind: "face",
    featureId: "feature-1",
    part: "top",
    tag: ["face:feature-1/left", "face:feature-2/side:line-4"],
  });
  // An empty tag: a piece bordering nothing the others don't.
  assert.deepEqual(readDesignReference(face("face:feature-1/top#")), { kind: "face", featureId: "feature-1", part: "top", tag: [] });
  const edge = (id: string): GeometryReference => ({ kind: "edge", id: id as StableId });
  assert.deepEqual(readDesignReference(edge("edge:face:feature-1/top+face:feature-2/left;ends:face:feature-1/front,face:feature-1/back")), {
    kind: "edge",
    featureId: "feature-1",
    part: "face:feature-1/top+face:feature-2/left;ends:face:feature-1/front,face:feature-1/back",
    pair: true,
  });
  // Each broken in one way: a tag that is not face names, a part that is not a role, a third face, an ends list of no face, a face kind holding an edge's name.
  for (const bad of [face("face:feature-1/top#left"), face("face:feature-1/Top#face:feature-1/left"), edge("edge:face:feature-1/top+face:feature-2/left+face:feature-3/end"), edge("edge:face:feature-1/top+face:feature-2/left;ends:x"), face("edge:face:feature-1/top+face:feature-2/left")])
    assert.equal(readDesignReference(bad), null, bad.id);
});

test("a sketch placed on a piece of its split face holds no placement, and its extrude's source is not lost", async () => {
  // The cut bar's whole top sketched on (origin (0, 0, 10), the near piece's corner) with a circle of radius 2 at
  // (10, 10), inside the near piece, extruded 5 up: a cylinder z 10..15, π·2²·5 = 20π mm³.
  const { doc: cut } = BAR();
  const s = addFaceSketch(cut, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [50, 10, 10]));
  const drawn = drawCircle(s.doc, s.id, [10, 10], 2).doc;
  const e = extrudeSketch(drawn, s.id, 5);
  const doc = await settleKept(kernel, drawn, e.doc);
  // Settling keeps no held placement for it: it is placed, not held (a held one would stay put if the piece moved).
  assert.equal(doc.sketches.find((x) => x.id === s.id)?.face?.held, undefined);
  const { build, cache } = await sceneOf(doc);
  const r = build.results[e.id];
  assert.ok(r.status === "built");
  assert.equal(r.source, undefined);
  const v = await cache.view(build.bodies[`body:${e.id}`].handle);
  assert.ok(Math.abs(v.volume - 20 * Math.PI) < 0.05 * 20 * Math.PI, `${v.volume}`); // the kernel's circle is exact; its mesh volume within 5%
  assert.ok(Math.abs(v.bounds[0][2] - 10) < 1e-9 && Math.abs(v.bounds[1][2] - 15) < 1e-9, `${v.bounds}`);
  await cache.clear();
});

// The bar joined with a 10 × 10 × 20 post (feature-2) moved to (30, 5, 2) (feature-3), x 30..40, y 5..15, z 2..22, so
// it pokes 12 out of the bar's top; Keep tools on, so the post stays as a body of its own too (Join, feature-4).
const POST = () => {
  const { doc, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 10, 20], [30, 5, 2]]);
  return insertCombine(doc, bodies[0], [bodies[1]], "join", true);
};

test("hand-worked: with the tool kept, its faces on two bodies; one no tag tells apart is refused for a sketch, an old edge found on the kept tool", async () => {
  const { doc } = POST();
  const { scene, cache } = await sceneOf(doc);
  // The post's top (z = 22) is on the kept post and on the join, each bordered by the post's four walls only: neither
  // borders anything the other doesn't, so both tags are empty, "face:feature-2/top#", and the name finds two faces.
  const onJoin = faceAt(scene, "body:feature-1", [0, 0, 1], 35);
  const onPost = faceAt(scene, "body:feature-2", [0, 0, 1]);
  const join = scene.bodies.findIndex((b) => b.body === "body:feature-1");
  const v = scene.bodies[join].view;
  assert.ok(Math.abs(v.face_centroids[onJoin - scene.faceStart[join]][2] - 22) < 1e-9, "the join's top at x 35 is the post's, at z 22");
  for (const i of [onJoin, onPost]) {
    assert.equal(sceneReference("face", scene, i)?.id, "face:feature-2/top#");
    assert.deepEqual(findInScene(sceneReference("face", scene, i)!, scene), { status: "shared", count: 2 });
    // A sketch there could not follow it: refused, as a face with no name of its own.
    assert.equal(sketchSpot({ face: i, shift: false }, scene)?.kind, "refused");
  }
  // The post's left wall: the kept post's whole one (z 2..22) borders the post's bottom; the join's (z 10..22) the bar's
  // top instead: told apart by those.
  assert.equal(sceneReference("face", scene, faceAt(scene, "body:feature-2", [-1, 0, 0]))?.id, "face:feature-2/left#face:feature-2/bottom");
  assert.equal(sceneReference("face", scene, faceAt(scene, "body:feature-1", [-1, 0, 0], 30))?.id, "face:feature-2/left#face:feature-1/top");
  // The post's own edge between its left and top, named before the Join (rule 6), is on both bodies; its own feature's
  // body, the kept post, has it, so it is found there and not called shared.
  const found = findInScene({ kind: "edge", id: "edge:feature-2/left+top" as StableId }, scene);
  assert.equal(found.status, "found");
  const post = scene.bodies.findIndex((b) => b.body === "body:feature-2");
  const at = (found as { index: number }).index;
  assert.ok(at >= scene.edgeStart[post] && at < scene.edgeStart[post] + scene.bodies[post].view.edges, "on the kept post");
  await cache.clear();
});

test("a face on a hidden body is not found on screen, though its name still counts in other faces' tags", async () => {
  // The cut bar with its far piece's eye shut: the far top is not on screen, so its full name finds nothing shown;
  // the near top keeps its tag, as the far piece still carries the bar's top.
  const { doc: cut, id } = BAR();
  const doc = { ...cut, hidden: [`body:${id}/piece:1`] };
  const { scene, cache } = await sceneOf(doc);
  assert.equal(scene.bodies.length, 1);
  assert.deepEqual(findInScene(face("face:feature-1/top#face:feature-1/right,face:feature-2/right"), scene), { status: "gone" });
  const nearTop = faceAt(scene, "body:feature-1", [0, 0, 1]);
  assert.equal(sceneReference("face", scene, nearTop)?.id, "face:feature-1/top#face:feature-1/left,face:feature-2/left");
  await cache.clear();
});

// 35f1e2: Box A 20 × 20 × 10 (feature-1) moved +10 in x by Move M (feature-2), so x 10..30, y 0..20, z 0..10. Box B
// 20 × 10 × 30 (feature-3) moved to (25, 5, −5) (feature-4): x 25..45, y 5..15, z −5..25, so it overlaps A at x 25..30
// and no face of one lies on a face of the other. Join, A the target (feature-5). B's top (z = 25) is whole on the
// result, A's top (z = 10) keeps a notch where B goes through it.
const JOINED = () => {
  const { doc, bodies } = boxes([[20, 20, 10], [10, 0, 0]], [[20, 10, 30], [25, 5, -5]]);
  return { ...insertCombine(doc, bodies[0], [bodies[1]], "join"), bodies };
};

test("hand-worked: a sketch on a face that came from a Combine's tool stays put when the target's Move changes; one on the target's face slides with it", async () => {
  const { doc: joined, id } = JOINED();
  assert.equal(id, "feature-5");
  const { scene, cache } = await sceneOf(joined);
  // Each sketch put where a click on its face puts it (the app's pick, which records where its body's Moves had put it).
  const clicked = (doc: DesignDocument, n: [number, number, number], x: number) => {
    const spot = sketchSpot({ face: faceAt(scene, "body:feature-1", n, x), shift: false }, scene);
    assert.ok(spot?.kind === "face", JSON.stringify(spot));
    return addFaceSketch(doc, spot.face, spot.drawn);
  };
  // B's top: centroid x (25 + 45) / 2 = 35. A's top: x 10..30 less the notch x 25..30, y 5..15; its centroid x is
  // (400 · 20 − 50 · 27.5) / 350 = (8000 − 1375) / 350 = 18.928…
  const onB = clicked(joined, [0, 0, 1], 35);
  const onA = clicked(onB.doc, [0, 0, 1], 6625 / 350);
  const placed = async (doc: DesignDocument) => {
    const { build, cache: c } = await sceneOf(doc);
    const at = (sid: string) => {
      const r = build.results[sid];
      assert.ok(r.status === "built" && r.plane === undefined, JSON.stringify(r));
      return { origin: r.placement!.plane.origin.map((v) => Math.round(v * 1e9) / 1e9 + 0), x: r.placement!.plane.xAxis.map((v) => Math.round(v * 1e9) / 1e9 + 0) };
    };
    const out = { b: at(onB.id), a: at(onA.id) };
    await c.clear();
    return out;
  };
  // As drawn (26e): each frame's origin is its top's plane's nearest point to the world's origin, x along the world's X.
  assert.deepEqual(await placed(onA.doc), { b: { origin: [0, 0, 25], x: [1, 0, 0] }, a: { origin: [0, 0, 10], x: [1, 0, 0] } });
  // M now moves A +20: A is at x 20..40, B where it was (x 25..45, its top still whole at z = 25, above A's top). The
  // sketch on B's top must not move at all; the one on A's top slides the 10 mm A moved further (35e2h), to (10, 0, 10).
  const moved = changedMove(onA.doc, "feature-2", { ...NO_MOVE, x: 20 });
  assert.deepEqual(await placed(moved), { b: { origin: [0, 0, 25], x: [1, 0, 0] }, a: { origin: [10, 0, 10], x: [1, 0, 0] } });
  await cache.clear();
});

test("hand-worked: a sketch placed on a whole face before a Cut splits it into two pieces alike still takes points from the bodies (35f1e2)", async () => {
  // The bar 100 × 20 × 10 (feature-1); a block 10 × 10 × 10 (feature-2) moved to y 30..40 (feature-3), its top at z =
  // 10 too; a sketch on the bar's top (feature-4) drawn before anything cuts it; then the tool 10 × 40 × 20 moved to x
  // 45..55 and the Cut: the bar's top ends as two pieces of 45 × 20 = 900 mm² each that no untagged name tells apart.
  // The rebuild placed the sketch on the whole top, built before the Cut, at z = 10 with no warning; the screen names
  // the faces of the finished design, where "feature-1/top" is two pieces alike. Before 35f1e2 that read as a lost
  // face, so the sketch took no points from any body (no snap to the block's corners) though it is placed. The
  // rebuild's verdict (the scene's `placed`) has the last word.
  const block = insertPreset(partDocument("box", 100, 20, 10), "box", 10, 10, 10);
  const blockMoved = insertMove(block.doc, [`body:${block.id}`], { ...NO_MOVE, y: 30 }).doc;
  const s = addFaceSketch(blockMoved, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [50, 10, 10]));
  const p = insertPreset(s.doc, "box", 10, 40, 20);
  const moved = insertMove(p.doc, [`body:${p.id}`], { ...NO_MOVE, x: 45, y: -10, z: -5 }).doc;
  const { doc } = insertCombine(moved, "body:feature-1", [`body:${p.id}`], "cut");
  const { build, scene, cache } = await sceneOf(doc);
  const r = build.results[s.id];
  assert.ok(r.status === "built" && r.plane === undefined && r.placement?.plane.origin[2] === 10, JSON.stringify(r));
  assert.equal(findInScene(face(facePlane("feature-1", "top")), scene).status, "shared");
  assert.equal(faceHeld(doc, s.id, scene), false);
  // The block's top corners lie on the sketch's plane (z = 10), whose frame is the world's lifted to z = 10: (0, 30)
  // and (10, 40) in sketch x, y.
  const corners = (sc: Scene) => sketchEdgeTargets(doc, s.id, sc, r.placement!.plane).filter((t) => t.kind === "endpoint").map((t) => t.at.join(","));
  for (const c of ["0,30", "10,40"]) assert.ok(corners(scene).includes(c), `${c} in ${corners(scene).join(" ")}`);
  // A scene without the rebuild's verdict (a caller that has none) still reads the shared name as held, as before.
  const bare = joinBodies(scene.bodies);
  assert.equal(faceHeld(doc, s.id, bare), true);
  assert.deepEqual(corners(bare), []);
  await cache.clear();
});

test("hand-worked: a reference holding a tag no piece has any more is lost, never found on its own body without the tag (35f1e2, seed 48)", async () => {
  // The bar 100 × 20 × 10 (feature-1) cut by the tool 10 × 40 × 20 (feature-2) moved to (30, −10, −5) (feature-3),
  // Keep tools on (feature-4). The tool's left (x = 30) is on two faces: its own, and the near piece's wall the Cut left
  // there (rule 2). Its own borders the tool's back, bottom, front and top, none of which the wall borders (the wall
  // borders the bar's top, bottom, front and back): that is its tag (rule 3).
  const { doc: two, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]]);
  const { doc } = insertCombine(two, bodies[0], [bodies[1]], "cut", true);
  const old = face("face:feature-2/left#face:feature-2/back,face:feature-2/bottom,face:feature-2/front,face:feature-2/top");
  const before = await sceneOf(doc);
  assert.equal(findInScene(old, before.scene).status, "found");
  await before.cache.clear();
  // The tool 12 tall instead: z −5..7, so it notches the bar from below, its top now the notch's roof at z = 7 (rule 2:
  // the roof carries the tool's top). The wall at x = 30 now borders that roof, feature-2/top, as the tool's own left
  // does, so the tool's own left is tagged by its back, bottom and front only. Rule 3: "a reference holding a tag finds
  // the one piece with that tag": none has the old one, so the reference is lost (gone), as the model has it; before
  // this fix Design fell back on the tool's own body, where the name without its tag found the face.
  const taller = editFeature(doc, "feature-2", { height: 12 });
  const after = await sceneOf(taller);
  assert.equal(findInScene(old, after.scene).status, "gone");
  assert.equal(findInScene(face("face:feature-2/left#face:feature-2/back,face:feature-2/bottom,face:feature-2/front"), after.scene).status, "found");
  await after.cache.clear();
});
