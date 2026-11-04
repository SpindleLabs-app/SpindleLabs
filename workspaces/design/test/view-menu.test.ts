import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh, Feature } from "@fission/core";
import type { DesignDocument } from "../src/document.ts";
import { nameBody } from "../src/naming.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { survivors } from "../src/selection.ts";
import { viewMenuEntries, viewMenuTarget } from "../src/view-menu.ts";
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

test("hand-worked: the body under a right-click, its row, the item it is the body of, and what is selected", () => {
  // Joined face 7 is past the box's 6 faces (0-5), so the cylinder's own face 1, its top (the kernel lists a
  // cylinder's faces bottom, top, side): Body 2's row, made by feature-4, with "face:feature-4/top" selected.
  assert.deepEqual(viewMenuTarget(doc, scene, { face: 7, shift: false }), { row: "body-2", feature: "feature-4", item: { kind: "face", id: "face:feature-4/top" } });
  // Edge 4 is the box's top front edge (corners 4→5, as picking.test.ts works out): Body 1, an edge selected. An edge
  // wins over a face under the same pointer, as a click picks.
  assert.deepEqual(viewMenuTarget(doc, scene, { face: 7, edge: 4, shift: false }), { row: "body-1", feature: "feature-1", item: { kind: "edge", id: "edge:feature-1/front+top" } });
  assert.deepEqual(viewMenuTarget(doc, scene, { face: 0, edge: null, shift: false })?.row, "body-1");
  // Face 5, the box's last, and face 6, the cylinder's first: the two sides of the join.
  assert.equal(viewMenuTarget(doc, scene, { face: 5, shift: false })?.row, "body-1");
  assert.equal(viewMenuTarget(doc, scene, { face: 6, shift: false })?.row, "body-2");
});

test("no menu on empty space, before a body is built, past the last face, or on a body the last rebuild lost", () => {
  assert.equal(viewMenuTarget(doc, scene, { face: null, shift: false }), null);
  assert.equal(viewMenuTarget(doc, scene, { face: null, edge: null, shift: false }), null);
  assert.equal(viewMenuTarget(doc, null, { face: 1, shift: false }), null);
  // 6 + 3 = 9 faces and 12 + 2 = 14 edges in all: 9 and 14 are on no body.
  assert.equal(viewMenuTarget(doc, scene, { face: 9, shift: false }), null);
  assert.equal(viewMenuTarget(doc, scene, { face: null, edge: 14, shift: false }), null);
  // feature-1 failed in the last rebuild: no Body 1 row any more (browser.test.ts), so its stale body opens nothing,
  // and Body 2 still opens feature-4's.
  const failed = new Set(["feature-1"]);
  assert.equal(viewMenuTarget(doc, scene, { face: 1, shift: false }, failed), null);
  assert.equal(viewMenuTarget(doc, scene, { face: 7, shift: false }, failed)?.feature, "feature-4");
  // A face the kernel gave no role has no name, so a click selects nothing there: no menu either (the box's face 0).
  const unnamed = { ...shown("feature-1", BOX_VIEW, 1), names: nameBody("feature-1", { ...BOX_VIEW, face_roles: [null, ...BOX_VIEW.face_roles.slice(1)] } as typeof BOX_VIEW, () => null) };
  assert.equal(viewMenuTarget(doc, joinBodies([unnamed]), { face: 0, shift: false }), null);
  assert.equal(viewMenuTarget(doc, joinBodies([unnamed]), { face: 1, shift: false })?.row, "body-1", "its named faces still open it");
  // A bad index is refused, as a click's is, never read as a body.
  assert.throws(() => viewMenuTarget(doc, scene, { face: -1, shift: false }), /kernel index/);
});

test("the menu is Hide, then the body's item menu as its browser row has it", () => {
  const entries = viewMenuEntries(doc, "feature-4");
  assert.deepEqual(
    entries.map((e) => [e.action, e.label]),
    [
      ["hide", "Hide"],
      ["edit", "Edit feature"],
      ["marker", "Move the marker here"],
      ["suppress", "Suppress"],
      ["rename", "Rename"],
      ["delete", "Delete"],
    ],
  );
  assert.equal(entries[0].off, null, "Hide is never off");
});

test("regression (found by the view menu's journey, 2026-11-04): a face or edge of a deleted item leaves the selection after the rebuild", () => {
  // Box 1's bottom face (its kernel face 0) and front top edge were selected, then Box 1 was deleted (its menu's
  // Delete, or its row's): the rebuild shows only Body 2, and feature-1 is no longer in the timeline. Like a gone
  // body's own reference (hunt 11-01), they leave with no note, the user took them away; Body 2's face stays.
  const bottom = { kind: "face" as const, id: "face:feature-1/bottom" };
  const edge = { kind: "edge" as const, id: "edge:feature-1/front+top" };
  const top = { kind: "face" as const, id: "face:feature-4/top" };
  const after = joinBodies([shown("feature-4", CYLINDER_VIEW, 2)]);
  const inTimeline = (id: string) => id !== "feature-1";
  assert.deepEqual(survivors([bottom, edge, top], after, [], inTimeline), { kept: [top], dropped: [], shared: [] });
  // Still in the timeline (suppressed, say), they are left alone for Unsuppress, as before.
  assert.deepEqual(survivors([bottom, edge, top], after, [], () => true), { kept: [bottom, edge, top], dropped: [], shared: [] });
});
