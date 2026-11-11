// The bodies as a sketch sees them (sketch-place.ts, timeline hunt 2026-11-11, #540 item 1), worked by hand: a body
// made before the sketch taken back through the built Moves after it; one made after, or moved by a Move that didn't
// build, as it is. The app's drawing, snapping and projecting with it: packages/testing/journeys/sketch-before-move.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh } from "@fission/core";
import { insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE, type MoveValues } from "../src/move.ts";
import { nameBody } from "../src/naming.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { addSketch } from "../src/sketch.ts";
import { sketchPlaceScene } from "../src/sketch-place.ts";
import { boxView, cylinderView } from "./views.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const close = (got: readonly number[], want: readonly number[], what: string) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= 1e-12, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** Body `feature` whose mesh has the point `p` (normal `n`) first, and whose first corner (vertex 0) and face 0's centroid are at `p` too. */
function shownAt(feature: string, made: BodyView, p: number[], n: number[], place: number, bounds: BodyView["bounds"]): ShownBody {
  const view: BodyView = { ...made, bounds, face_centroids: Array.from({ length: made.faces }, () => [0, 0, 0]), face_normals: Array.from({ length: made.faces }, (_, i) => (i === 0 ? (n as [number, number, number]) : null)) };
  const mesh: DisplayMesh = { positions: [...p, p[0], p[1] + 1, p[2], p[0], p[1], p[2] + 1], normals: [...n, ...n, ...n], indices: [0, 1, 2], triangle_faces: [0], edge_lines: [...p, p[0] + 1, p[1], p[2]], edge_line_edges: [0] };
  const vw: BodyView = { ...view, mesh, vertex_points: view.vertex_points.map((q, i) => (i === 0 ? (p as [number, number, number]) : q)), face_centroids: view.face_centroids.map((q, i) => (i === 0 ? (p as [number, number, number]) : q)) };
  return { feature, body: `body:${feature}`, place, view: vw, names: nameBody(feature, vw, () => null) };
}

test("a sketch before a Move sees the body where it was before the Move, by hand; one after it, or a Move that failed, as built", () => {
  // Box 1 (feature-1); Sketch 1 on XY (sketch-2); Move 1 (feature-3): Box 1 turned 90° about Z through the origin, then
  // shifted x +50; Cylinder 1 (feature-4) made after the sketch, never moved.
  const s = addSketch(partDocument("box", 40, 30, 20), "XY");
  const doc = insertPreset(insertMove(s.doc, ["body:feature-1"], v({ turnZ: 90, x: 50 })).doc, "cylinder", 20, 20, 10).doc;
  assert.deepEqual(doc.timeline.features.map((f) => f.id), ["feature-1", s.id, "feature-3", "feature-4"]);
  const built = Object.fromEntries(doc.timeline.features.map((f) => [f.id, { status: "built" }]));
  // Box 1's corner (40, 30, 0) with normal (1, 0, 0) as made; Move 1 turns (x, y) to (−y, x): (−30, 40, 0), normal (0, 1, 0),
  // then +50 in x: built at (20, 40, 0).
  const scene = joinBodies([shownAt("feature-1", boxView(40, 30, 20), [20, 40, 0], [0, 1, 0], 1, [[20, 0, 0], [50, 40, 20]]), shownAt("feature-4", cylinderView(10, 10), [100, 0, 0], [1, 0, 0], 2, [[90, -10, 0], [110, 10, 10]])]);
  const seen = sketchPlaceScene(scene, doc, built, s.id);
  // Taken back: shifted −50 to (−30, 40, 0), turned −90° about Z ((x, y) to (y, −x)): (40, 30, 0), the corner as made; normal (1, 0, 0).
  close(seen.mesh.positions.slice(0, 3), [40, 30, 0], "the joined mesh");
  close(seen.mesh.normals.slice(0, 3), [1, 0, 0], "its normal");
  close(seen.bodies[0].view.vertex_points[0], [40, 30, 0], "the exact corner a pin snaps to");
  close(seen.bodies[0].view.face_centroids[0], [40, 30, 0], "a face's centroid");
  close(seen.bodies[0].view.mesh.edge_lines.slice(0, 3), [40, 30, 0], "an edge line");
  close(seen.bodies[0].view.face_normals[0]!, [1, 0, 0], "a face's exact normal, only turned");
  // Vertex 1 as built, (40, 0, 0) of boxView, taken back the same way: (−10, 0, 0), then (0, 10, 0).
  close(seen.bodies[0].view.vertex_points[1], [0, 10, 0], "another corner");
  // Its box as built, x 20..50, y 0..40 (the 30 × 40 footprint turned), taken back: x 0..40, y 0..30, as made.
  close(seen.bodies[0].view.bounds.flat(), [0, 0, 0, 40, 30, 20], "the box round it");
  // The cylinder, made after the sketch: as built. The lists keep their lengths, so every joined index names the same face.
  assert.equal(seen.bodies[1], scene.bodies[1]);
  assert.equal(seen.mesh.positions.length, scene.mesh.positions.length);
  assert.deepEqual(seen.mesh.positions.slice(9), scene.mesh.positions.slice(9));
  // Controls: Move 1 failed (it moved nothing), or a sketch after Move 1: the scene itself.
  assert.equal(sketchPlaceScene(scene, doc, { ...built, "feature-3": { status: "failed" } }, s.id), scene);
  assert.equal(sketchPlaceScene(scene, doc, built, "feature-4"), scene);
  assert.equal(sketchPlaceScene(scene, doc, built, "no-such-sketch"), scene);
});
