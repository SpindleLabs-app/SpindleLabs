// What a click in the viewport does to the selection (step 17b). Pure, so
// the rules are unit-tested; workspace.ts applies the result.

import type { GeometryReference, Selection, ViewportPick } from "@fission/core";
import { bodyReference } from "./references.ts";
import { sceneHit, sceneReference, type Scene } from "./scene.ts";

/**
 * The change a pick makes: replace with one face or edge, toggle one, clear,
 * or leave as is; or, for a double-click, the whole `body`: in place of
 * everything (`drop` null), or, with Shift, added to the selection in place
 * of `drop`, the face or edge the double-click's first click toggled.
 */
export type SelectionChange =
  | { change: "set"; item: GeometryReference }
  | { change: "toggle"; item: GeometryReference }
  | { change: "body"; body: GeometryReference; drop: GeometryReference | null }
  | { change: "clear" }
  | { change: "keep" };

/**
 * A click on a face or edge selects only that; Shift adds it (or takes it
 * out again if already selected). An edge wins over a face. A click on empty space clears; with Shift it
 * keeps the selection, so a slip while adding loses nothing. `scene` is
 * the bodies on screen (null before one is built), whose joined numbering
 * the pick uses. A face or
 * edge with no name can't be referred to, so a click on one changes nothing.
 *
 * A double-click or double-tap on a face or edge (Ben's idea, 2026-11-04;
 * Shift-click was taken by adding) picks its whole body: the first click
 * did what a click does, the second puts the body in its place, so a
 * double-click selects just the body and a Shift+double-click adds the body
 * and takes out the face or edge the first click added. Even a face with no
 * name gives its body. A double-click on empty space is two clicks there.
 */
export function pickChange(pick: ViewportPick, scene: Scene | null): SelectionChange {
  const hit = pick.edge != null ? ({ kind: "edge", index: pick.edge } as const) : pick.face !== null ? ({ kind: "face", index: pick.face } as const) : null;
  if (hit === null) return pick.shift ? { change: "keep" } : { change: "clear" };
  const item = scene === null ? null : sceneReference(hit.kind, scene, hit.index);
  if (pick.double && scene !== null) {
    const on = sceneHit(scene, hit.kind, hit.index);
    if (on !== null) return { change: "body", body: bodyReference(scene.bodies[on.body].body), drop: pick.shift ? item : null };
  }
  if (item === null) return { change: "keep" };
  return pick.shift ? { change: "toggle", item } : { change: "set", item };
}

/** Makes the change `pickChange` gave on `selection`. */
export function applyChange(selection: Selection, c: SelectionChange): void {
  if (c.change === "set") selection.set([c.item]);
  else if (c.change === "toggle") selection.toggle(c.item);
  else if (c.change === "clear") selection.clear();
  else if (c.change === "body") {
    const drop = c.drop;
    const kept = drop === null ? [] : selection.items.filter((r) => !(r.kind === drop.kind && r.id === drop.id));
    selection.set([...kept, c.body]);
  }
}
