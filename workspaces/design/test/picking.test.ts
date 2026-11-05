import { test } from "node:test";
import assert from "node:assert/strict";
import { createSelection } from "@fission/core";
import { nameBody } from "../src/naming.ts";
import { applyChange, pickChange, type SelectionChange } from "../src/picking.ts";
import type { Scene } from "../src/scene.ts";
import { BOX_VIEW, onlyBody } from "./views.ts";

const box = onlyBody(BOX_VIEW, nameBody("feature-1", BOX_VIEW, () => null));

test("a pick on a face names that face of the feature on screen", () => {
  // The default box's top face is kernel face 1 (the kernel lists the
  // faces −Z, +Z, −Y, +Y, −X, +X), so a click on it is "face:feature-1/top".
  assert.deepEqual(pickChange({ face: 1, shift: false }, box), { change: "set", item: { kind: "face", id: "face:feature-1/top" } });
  assert.deepEqual(pickChange({ face: 1, shift: true }, box), { change: "toggle", item: { kind: "face", id: "face:feature-1/top" } });
  assert.deepEqual(pickChange({ face: null, shift: false }, box), { change: "clear" });
  assert.deepEqual(pickChange({ face: null, shift: true }, box), { change: "keep" });
});

test("a pick on an edge names that edge, and wins over a face", () => {
  // The default box's top front edge joins corners 4 and 5 (the kernel's box:
  // the −Z face makes edges 0-3, the +Z face 4-7, and its first is 4→5),
  // where the front and the top meet: "edge:feature-1/front+top".
  assert.deepEqual(pickChange({ face: null, edge: 4, shift: false }, box), { change: "set", item: { kind: "edge", id: "edge:feature-1/front+top" } });
  assert.deepEqual(pickChange({ face: null, edge: 4, shift: true }, box), { change: "toggle", item: { kind: "edge", id: "edge:feature-1/front+top" } });
  assert.deepEqual(pickChange({ face: 1, edge: 4, shift: false }, box), { change: "set", item: { kind: "edge", id: "edge:feature-1/front+top" } });
  assert.deepEqual(pickChange({ face: 1, edge: null, shift: false }, box), { change: "set", item: { kind: "face", id: "face:feature-1/top" } });
  assert.deepEqual(pickChange({ face: null, edge: null, shift: false }, box), { change: "clear" });
  assert.throws(() => pickChange({ face: null, edge: -2, shift: false }, box), /kernel index/);
});

test("click, Shift-click, Shift-click again and a click on nothing, applied to a real selection", () => {
  const selection = createSelection();
  const apply = (c: SelectionChange) => {
    if (c.change === "set") selection.set([c.item]);
    else if (c.change === "toggle") selection.toggle(c.item);
    else if (c.change === "clear") selection.clear();
  };
  const ids = () => selection.items.map((r) => r.id);
  apply(pickChange({ face: 1, shift: false }, box));
  assert.deepEqual(ids(), ["face:feature-1/top"]);
  apply(pickChange({ face: 2, shift: true }, box)); // adds
  assert.deepEqual(ids(), ["face:feature-1/top", "face:feature-1/front"]);
  apply(pickChange({ face: null, shift: true }, box)); // a Shift slip keeps both
  assert.deepEqual(ids(), ["face:feature-1/top", "face:feature-1/front"]);
  apply(pickChange({ face: 1, shift: true }, box)); // takes it out
  assert.deepEqual(ids(), ["face:feature-1/front"]);
  apply(pickChange({ face: 5, shift: false }, box)); // a plain click replaces
  assert.deepEqual(ids(), ["face:feature-1/right"]);
  apply(pickChange({ face: null, shift: false }, box));
  assert.deepEqual(ids(), []);
});

test("a pick with a bad face index is refused, not turned into an id", () => {
  assert.throws(() => pickChange({ face: -1, shift: false }, box), /kernel index/);
  assert.throws(() => pickChange({ face: 1.5, shift: false }, box), /kernel index/);
});

test("before a body is built, or on a face or edge with no name, a click changes nothing", () => {
  assert.deepEqual(pickChange({ face: 1, shift: false }, null), { change: "keep" });
  // Past the box's faces (an index the names don't cover), and a face the kernel gave no role.
  assert.deepEqual(pickChange({ face: 6, shift: false }, box), { change: "keep" });
  const unnamed = nameBody("feature-1", { ...BOX_VIEW, face_roles: [null, ...BOX_VIEW.face_roles.slice(1)] } as typeof BOX_VIEW, () => null);
  assert.deepEqual(pickChange({ face: 0, shift: true }, onlyBody(BOX_VIEW, unnamed)), { change: "keep" });
  // Empty space still clears.
  assert.deepEqual(pickChange({ face: null, shift: false }, null), { change: "clear" });
});

/** Two boxes side by side, joined as `joinBodies` numbers them: a box has 6 faces and 12 edges, so the second's start at face 6 and edge 12. */
function twoBoxes(): Scene {
  const a = onlyBody(BOX_VIEW, nameBody("feature-1", BOX_VIEW, () => null)).bodies[0];
  const b = onlyBody(BOX_VIEW, nameBody("feature-2", BOX_VIEW, () => null)).bodies[0];
  return { bodies: [a, { ...b, place: 2 }], mesh: box.mesh, faceStart: [0, 6], edgeStart: [0, 12] };
}

test("a double-click on a face or edge picks its whole body, worked out from the numbering by hand", () => {
  const two = twoBoxes();
  // Joined face 7 is past the first box's 6 faces (0-5), so it is the second box's face 7 − 6 = 1, its top: the body is body:feature-2.
  assert.deepEqual(pickChange({ face: 7, shift: false, double: true }, two), { change: "body", body: { kind: "body", id: "body:feature-2" }, drop: null });
  // Joined edge 4 is under the second box's start (12): the first box's top front edge, so body:feature-1; an edge still wins over the face.
  assert.deepEqual(pickChange({ face: 7, edge: 4, shift: false, double: true }, two), { change: "body", body: { kind: "body", id: "body:feature-1" }, drop: null });
  // With Shift, the first click toggled the second box's top in; the double takes it out again for the body.
  assert.deepEqual(pickChange({ face: 7, shift: true, double: true }, two), { change: "body", body: { kind: "body", id: "body:feature-2" }, drop: { kind: "face", id: "face:feature-2/top" } });
  // A double on empty space is two clicks there; before any body, nothing to pick.
  assert.deepEqual(pickChange({ face: null, shift: false, double: true }, two), { change: "clear" });
  assert.deepEqual(pickChange({ face: null, shift: true, double: true }, two), { change: "keep" });
  assert.deepEqual(pickChange({ face: 1, shift: false, double: true }, null), { change: "keep" });
  // Past the last body's faces (12 = 6 + 6): no body there, so nothing changes, as for a single click.
  assert.deepEqual(pickChange({ face: 12, shift: false, double: true }, two), { change: "keep" });
  assert.throws(() => pickChange({ face: -1, shift: false, double: true }, two), /kernel index/);
});

test("a face with no name still gives its body to a double-click", () => {
  const unnamed = nameBody("feature-1", { ...BOX_VIEW, face_roles: [null, ...BOX_VIEW.face_roles.slice(1)] } as typeof BOX_VIEW, () => null);
  const scene = onlyBody(BOX_VIEW, unnamed);
  assert.deepEqual(pickChange({ face: 0, shift: false }, scene), { change: "keep" }); // a single click can't name it
  assert.deepEqual(pickChange({ face: 0, shift: false, double: true }, scene), { change: "body", body: { kind: "body", id: "body:feature-1" }, drop: null });
});

test("double-clicks and Shift+double-clicks applied to a real selection, as the view sends them", () => {
  const two = twoBoxes();
  const selection = createSelection();
  const ids = () => selection.items.map((r) => r.id);
  // A double-click is a click then the same click marked double.
  const click = (face: number | null, shift: boolean) => applyChange(selection, pickChange({ face, shift }, two));
  const second = (face: number | null, shift: boolean) => applyChange(selection, pickChange({ face, shift, double: true }, two));
  click(1, false);
  assert.deepEqual(ids(), ["face:feature-1/top"]);
  second(1, false); // the face makes way for its body
  assert.deepEqual(ids(), ["body:feature-1"]);
  click(7, true); // Shift+double-click on the other box: the first click adds its top...
  assert.deepEqual(ids(), ["body:feature-1", "face:feature-2/top"]);
  second(7, true); // ...the second swaps that for the whole body
  assert.deepEqual(ids(), ["body:feature-1", "body:feature-2"]);
  click(2, true); // Shift+double-click on a face already picked as part of a body that is selected: the body stays, once
  second(2, true);
  assert.deepEqual(ids(), ["body:feature-1", "body:feature-2"]);
  click(8, false); // a plain double-click replaces everything with one body
  second(8, false);
  assert.deepEqual(ids(), ["body:feature-2"]);
  click(null, false); // and a click on nothing clears, as ever
  assert.deepEqual(ids(), []);
});
