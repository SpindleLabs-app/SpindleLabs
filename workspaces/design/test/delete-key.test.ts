// Delete or Backspace outside a sketch (round 2 hunt E5): the item it asks to delete, from the timeline row or bar
// item that has focus, else from what is selected when it all lies on one body. Fixtures as view-menu.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh, Feature, GeometryReference } from "@fission/core";
import type { DesignDocument } from "../src/document.ts";
import { nameBody } from "../src/naming.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { deleteKeyTarget } from "../src/delete-key.ts";
import { BOX_VIEW, CYLINDER_VIEW } from "./views.ts";

/** A display mesh with one triangle per face and one line per edge, the way the kernel lays them out (as scene.test.ts). */
function meshFor(faces: number, edges: number): DisplayMesh {
  const mesh: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  for (let f = 0; f < faces; f++) {
    mesh.positions.push(f, 0, 0, f, 1, 0, f, 0, 1);
    mesh.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    mesh.indices.push(3 * f, 3 * f + 1, 3 * f + 2);
    mesh.triangle_faces.push(f);
  }
  for (let e = 0; e < edges; e++) {
    mesh.edge_lines.push(e, 0, 0, e, 1, 1);
    mesh.edge_line_edges.push(e);
  }
  return mesh;
}
const shown = (feature: string, view: BodyView, place: number): ShownBody => {
  const v = { ...view, mesh: meshFor(view.faces, view.edges) };
  return { feature, body: `body:${feature}`, place, view: v, names: nameBody(feature, v, () => null) };
};
const feature = (id: string, label: string, suppressed = false): Feature => ({
  id,
  intent: { type: "box", parameters: {}, summary: label },
  provenance: { self: { workspace: "design", id, label }, from: [] },
  dependsOn: [],
  suppressed,
});

// Box 1 (feature-1) builds Body 1, Box 2 (feature-2) is suppressed and builds none, Box 3 (feature-4) builds Body 2:
// on screen the box (6 faces, 12 edges) then the cylinder view standing for Body 2 (3 faces, 2 edges).
const doc: DesignDocument = {
  version: 2,
  nextId: 5,
  sketches: [],
  profiles: [],
  timeline: { features: [feature("feature-1", "Box 1"), feature("feature-2", "Box 2", true), feature("feature-4", "Box 3")] },
};
const scene = joinBodies([shown("feature-1", BOX_VIEW, 1), shown("feature-4", CYLINDER_VIEW, 2)]);

const ref = (kind: GeometryReference["kind"], id: string) => ({ kind, id }) as GeometryReference;

test("hand-worked: a selection on one body asks to delete the item that body is made by", () => {
  // Body 2 is the cylinder view, made by feature-4 (Box 3): its top face, or its body, or both, all say feature-4.
  assert.equal(deleteKeyTarget(doc, scene, [ref("face", "face:feature-4/top")], null), "feature-4");
  assert.equal(deleteKeyTarget(doc, scene, [ref("body", "body:feature-4")], null), "feature-4");
  assert.equal(deleteKeyTarget(doc, scene, [ref("body", "body:feature-4"), ref("face", "face:feature-4/top")], null), "feature-4");
  // Body 1's front top edge: feature-1 (Box 1).
  assert.equal(deleteKeyTarget(doc, scene, [ref("edge", "edge:feature-1/front+top")], null), "feature-1");
});

test("a selection on two bodies, nothing selected, or nothing on screen asks nothing: no guess at which to delete", () => {
  assert.equal(deleteKeyTarget(doc, scene, [ref("body", "body:feature-1"), ref("body", "body:feature-4")], null), null);
  assert.equal(deleteKeyTarget(doc, scene, [], null), null);
  assert.equal(deleteKeyTarget(doc, null, [ref("body", "body:feature-1")], null), null);
  // A sketch's outline (a profile row's pick) is not on a body.
  assert.equal(deleteKeyTarget(doc, scene, [ref("outline", "outline:sketch-1/0")], null), null);
});

test("a focused timeline row or bar item wins over the selection: the item it stands for, even one with no body", () => {
  // The bar item of Box 2 (suppressed, so no body) with Body 1 selected: Box 2, the one the user is on.
  assert.equal(deleteKeyTarget(doc, scene, [ref("body", "body:feature-1")], { item: "feature-2" }), "feature-2");
  // The browser's Timeline row and its Body row: "feature-4" and "body-2" both say feature-4.
  assert.equal(deleteKeyTarget(doc, scene, [], { node: "feature-4" }), "feature-4");
  assert.equal(deleteKeyTarget(doc, scene, [], { node: "body-2" }), "feature-4");
  // A row that is no item (a group's row) and an item not in the design ask nothing, whatever is selected.
  assert.equal(deleteKeyTarget(doc, scene, [ref("body", "body:feature-1")], { node: "timeline" }), null);
  assert.equal(deleteKeyTarget(doc, scene, [ref("body", "body:feature-1")], { item: "feature-9" }), null);
});
