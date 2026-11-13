// SL #641 item 1: a sketch on a face of a body a later Scale resizes keeps
// its sizes and its position scales with the body (SL #539 item 2): the
// rebuild carries the middle of its own points as the body's point under
// it. A point tied by a constraint to a projected corner is moved by the
// solve that follows the corner, so it can't count towards that middle:
// it did, and the middle moved with every rebuild, so each open of the
// saved file moved the sketch a little again and rewrote the file.
// On the real kernel's build and solver, the file read back each time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { projectPick } from "../src/projection.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { addFaceSketch, drawLine, pointAt, projectEdges } from "../src/sketch.ts";
import { suppressItem } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const at = (doc: DesignDocument, id: string, p: string): [number, number] => {
  const q = sketchOf(doc, id).points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
const near = (got: readonly number[], want: readonly number[], what: string) =>
  assert.ok(got.every((v, k) => Math.abs(v - want[k]) < 1e-9), `${what} at ${got}, not ${want}`);

/** The design rebuilt, its followed (and solved) points taken in as the app takes them, then saved and opened again. */
async function openSaved(doc: DesignDocument): Promise<DesignDocument> {
  const cache = new BodyCache(kernel);
  try {
    return readDesignDocument(JSON.parse(JSON.stringify(followedDoc(doc, await rebuildTimeline(doc, cache, kernel)))));
  } finally {
    await cache.close();
  }
}

/**
 * A 40 × 30 × 20 box scaled 2 about the origin (0..80 × 0..60 × 0..40);
 * a sketch on its top (z = 40; the sketch's x, y are the world's): the
 * top's four edges projected, a triangle (10, 10), (30, 10), (20, 25), and
 * its top corner made Horizontal with the projected corner (80, 60).
 */
async function drawn() {
  const scaled = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, scale: 2 }, "scale");
  const cache = new BodyCache(kernel);
  const scene = joinBodies(await shownBodies(scaled.doc, await rebuildTimeline(scaled.doc, cache, kernel), cache));
  const view = scene.bodies[0].view;
  const top = view.face_normals.findIndex((n, f) => n[2] > 0.5 && view.face_centroids[f][2] === 40);
  const spot = sketchSpot({ face: scene.faceStart[0] + top, shift: false }, scene);
  assert.ok(spot?.kind === "face", JSON.stringify(spot));
  const s = addFaceSketch(scaled.doc, spot.face, spot.drawn);
  const placed = await rebuildTimeline(s.doc, cache, kernel);
  const r = placed.results[s.id];
  assert.ok(r.status === "built");
  const pick = projectPick(s.doc, s.id, scene, r.placement.plane, { face: scene.faceStart[0] + top });
  await cache.close();
  assert.equal(pick.note, null);
  assert.equal(pick.edges.length, 4, "the top's four edges");
  let doc = projectEdges(s.doc, s.id, pick.edges).doc;
  doc = drawLine(doc, s.id, [10, 10], [30, 10]).doc;
  const id = (p: [number, number]) => pointAt(sketchOf(doc, s.id), p)!;
  doc = drawLine(doc, s.id, id([30, 10]), [20, 25]).doc;
  doc = drawLine(doc, s.id, id([20, 25]), id([10, 10])).doc;
  const [a, b, c, corner] = [id([10, 10]), id([30, 10]), id([20, 25]), id([80, 60])];
  assert.ok(corner !== null && !new Set([a, b, c]).has(corner), "the projected corner (80, 60) is its own point");
  const tied = await addConstraint(kernel, doc, s.id, { kind: "horizontal", a: c, b: corner });
  assert.ok("doc" in tied, JSON.stringify(tied));
  // The corner follows the body, so the solve moves the triangle's top corner level with it: (20, 60).
  near(at(tied.doc, s.id, c), [20, 60], "the top corner, level with the corner");
  return { doc: tied.doc, sketch: s.id, scale: scaled.id, points: { a, b, c, corner } };
}

test("hand-worked: a sketch on a scaled body tied to a projected corner opens where it was saved, every time (SL #641 item 1)", async () => {
  const d = await drawn();
  // Scale 1 suppressed: the box is 0..40 × 0..30 × 0..20 again (size 1 where the sketch was drawn at size 2, so k = 1/2).
  // The sketch keeps its sizes; the middle of its own points the solve can't move, the box round (10, 10) and (30, 10),
  // (20, 10) on the old top, i.e. the body's point (20, 10, 40), goes where the body puts that point: (10, 5, 20). So the
  // sketch's (x, y) now lies at the world's (x − 10, y − 5) on the top at z = 20. The corner, the body's (40, 30, 20),
  // is the sketch's (50, 35); the top corner, level with it, is (20, 35); the base is left at (10, 10) and (30, 10).
  let doc = await openSaved(suppressItem(d.doc, d.scale, true));
  near(at(doc, d.sketch, d.points.corner), [50, 35], "the projected corner");
  near(at(doc, d.sketch, d.points.c), [20, 35], "the top corner");
  near(at(doc, d.sketch, d.points.a), [10, 10], "the base's left end");
  near(at(doc, d.sketch, d.points.b), [30, 10], "the base's right end");
  // Saved after a rebuild, opened, rebuilt and saved again five times: the very same file each time.
  const saved = JSON.stringify(doc);
  const moved: string[] = [];
  for (let open = 1; open <= 5; open++) {
    doc = await openSaved(doc);
    if (JSON.stringify(doc) !== saved) moved.push(`open ${open}: top corner at ${at(doc, d.sketch, d.points.c)}`);
  }
  assert.deepEqual(moved, [], "no open moves the sketch");
});

test("hand-worked: every point of the triangle tied to a projected corner: no middle is left, the sketch follows its corners alone and opens the same every time (SL #641 item 1)", async () => {
  const d = await drawn();
  // The base's ends made Horizontal with the projected corner (0, 0) too: on the scaled top the base is at y 0.
  const origin = pointAt(sketchOf(d.doc, d.sketch), [0, 0])!;
  let doc = d.doc;
  for (const p of [d.points.a, d.points.b]) {
    const tied = await addConstraint(kernel, doc, d.sketch, { kind: "horizontal", a: p, b: origin });
    assert.ok("doc" in tied, JSON.stringify(tied));
    doc = tied.doc;
  }
  near(at(doc, d.sketch, d.points.a), [10, 0], "the base's left end, level with (0, 0)");
  // Scale 1 suppressed: every own point is tied to a corner, so nothing is left to carry the size change by and the sketch's frame
  // is carried as one drawn before the rule: the body frame is the world's both times (origin (0, 0, 0), size 2 then 1), so the
  // sketch's (x, y) is the world's (x, y) on the top at z = 20. The corners are the body's (40, 30) and (0, 0); the top corner
  // levels with the first, (20, 30); the base with the second, (10, 0) and (30, 0).
  doc = await openSaved(suppressItem(doc, d.scale, true));
  near(at(doc, d.sketch, d.points.corner), [40, 30], "the projected corner");
  near(at(doc, d.sketch, d.points.c), [20, 30], "the top corner");
  near(at(doc, d.sketch, d.points.a), [10, 0], "the base's left end");
  near(at(doc, d.sketch, d.points.b), [30, 0], "the base's right end");
  const saved = JSON.stringify(doc);
  for (let open = 1; open <= 3; open++) {
    doc = await openSaved(doc);
    assert.equal(JSON.stringify(doc), saved, `open ${open} moved the sketch`);
  }
});
