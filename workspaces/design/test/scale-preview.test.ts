// Regression (found 11-11 while adding Scale's slider): Scale's preview
// never showed. `movedMesh` took a Move that shifts and turns nothing as
// "still" and drew the bodies as they were, whatever the factor, and an
// edited Scale whose factor alone changed was drawn as built. So the
// bodies only changed size after OK. Worked by hand on a one-triangle box.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE, type MoveValues } from "../src/move.ts";
import { editedMoveMesh, movedMesh } from "../src/move-tool.ts";
import { nameBody } from "../src/naming.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { BOX_VIEW } from "./views.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const close = (got: readonly number[], want: readonly number[], what: string) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= 1e-12, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** Box 1 with one triangle per face, its first at (1, 1, 0), (1, 2, 0), (1, 1, 1), normal +X, as move-bodies.test.ts lays them out. */
function boxScene() {
  const mesh: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  for (let f = 0; f < BOX_VIEW.faces; f++) {
    mesh.positions.push(1, 1 + f, 0, 1, 2 + f, 0, 1, 1 + f, 1);
    mesh.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    mesh.indices.push(3 * f, 3 * f + 1, 3 * f + 2);
    mesh.triangle_faces.push(f);
  }
  const view: BodyView = { ...BOX_VIEW, bounds: [[0, 0, 0], [40, 30, 20]], mesh };
  const body: ShownBody = { feature: "feature-1", body: "body:feature-1", place: 1, view, names: nameBody("feature-1", view, () => null) };
  return joinBodies([body]);
}

test("a new Scale's preview, by hand: the picked body drawn at the factor about the pivot before OK", () => {
  const scene = boxScene();
  // 2× about the origin: (1, 1, 0) → (2, 2, 0), (1, 2, 0) → (2, 4, 0), (1, 1, 1) → (2, 2, 2); the normal stays +X (a scale above 0 never turns it).
  const twice = movedMesh(scene, ["body:feature-1"], v({ scale: 2 }));
  assert.notEqual(twice, scene.mesh, "a factor alone is a change");
  close(twice.positions.slice(0, 9), [2, 2, 0, 2, 4, 0, 2, 2, 2], "2× about the origin");
  close(twice.normals.slice(0, 3), [1, 0, 0], "its normal");
  // 0.5× about (1, 1, 0): (1, 1, 0) stays; (1, 2, 0) → (1, 1.5, 0); (1, 1, 1) → (1, 1, 0.5).
  const half = movedMesh(scene, ["body:feature-1"], v({ scale: 0.5, pivotX: 1, pivotY: 1 }));
  close(half.positions.slice(0, 9), [1, 1, 0, 1, 1.5, 0, 1, 1, 0.5], "0.5× about (1, 1, 0)");
  // 1× (no factor) is still the mesh itself, as before.
  assert.equal(movedMesh(scene, ["body:feature-1"], v({})), scene.mesh);
  assert.equal(movedMesh(scene, ["body:feature-1"], v({ scale: 1 })), scene.mesh);
});

test("an edited Scale's preview, by hand: a new factor is drawn; its own factor is the mesh as built", () => {
  // Scale 1 (feature-2) sized Box 1 2× about the origin, and the scene draws it as built: its point (1, 1, 0) was (0.5, 0.5, 0)
  // before Scale 1. Edited to 3×: (1.5, 1.5, 0).
  const doc = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], v({ scale: 2 }), "scale").doc;
  const scene = boxScene();
  const built = { "feature-1": { status: "built" }, "feature-2": { status: "built" } };
  const thrice = editedMoveMesh(scene, doc, built, "feature-2", v({ scale: 3 }));
  assert.notEqual(thrice, scene.mesh, "a changed factor alone is a change");
  close(thrice.positions.slice(0, 3), [1.5, 1.5, 0], "edited to 3×");
  // Back to 1×: drawn unscaled, (0.5, 0.5, 0).
  close(editedMoveMesh(scene, doc, built, "feature-2", v({})).positions.slice(0, 3), [0.5, 0.5, 0], "edited to 1×");
  // Its own 2×: the mesh as built.
  assert.equal(editedMoveMesh(scene, doc, built, "feature-2", v({ scale: 2 })), scene.mesh);
});
