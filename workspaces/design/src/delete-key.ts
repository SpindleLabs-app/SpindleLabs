// Delete or Backspace outside a sketch (round 2 hunt E5: they did nothing
// there; only the row menu deleted). The key asks to delete the item the
// user is on: the timeline row or bar item that has focus, else the item
// whose body everything selected lies on. It then goes the menu's way
// (timeline-menu.ts chooseEntry with "delete"): the are-you-sure box when
// something is built from the item, an entry that is off refused in its
// words, one undo step. Nothing is guessed: a selection over two bodies,
// or nothing that stands for an item, asks nothing.

import type { GeometryReference } from "@fission/core";
import { rowItem } from "./browser.ts";
import type { DesignDocument } from "./document.ts";
import { bodyOf, type Scene } from "./scene.ts";

/** What has focus: a browser row (`node`, its data-node) or a timeline bar item (`item`, its id). */
export type DeleteFocus = { node?: string; item?: string } | null;

/** The item Delete asks to delete, or null for none. `failed`: the items the last rebuild failed (rowItem's). */
export function deleteKeyTarget(doc: DesignDocument, scene: Scene | null, selected: readonly GeometryReference[], focus: DeleteFocus, failed?: ReadonlySet<string>): string | null {
  if (focus?.item !== undefined) return doc.timeline.features.some((f) => f.id === focus.item) ? focus.item : null;
  if (focus?.node !== undefined) return rowItem(focus.node, doc, failed);
  if (scene === null || selected.length === 0) return null;
  const bodies = new Set(selected.map((r) => bodyOf(scene, r)));
  if (bodies.size !== 1 || bodies.has(-1)) return null;
  const [b] = bodies;
  return rowItem(`body-${scene.bodies[b].place}`, doc, failed);
}
