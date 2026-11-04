// The menu on a body in the 3D view (missing basics, Ben 2026-11-04): a
// right-click, or a finger held still, on a body's face or edge opens the
// same menu as its Body row in the browser (its feature's: Edit feature,
// Move the marker here, Suppress, Rename, Delete) with Hide first, which
// the row has as its eye. Pure: workspace.ts asks `viewMenuTarget` what is
// under the pointer, selects it, and opens `viewMenuEntries`.

import type { GeometryReference, ViewportPick } from "@fission/core";
import { rowItem } from "./browser.ts";
import type { DesignDocument } from "./document.ts";
import { designReference } from "./references.ts";
import { sceneHit, type Scene } from "./scene.ts";
import { menuEntries } from "./timeline-menu.ts";
import type { MenuEntry } from "./timeline-bar.ts";

/** What a menu opened on the view acts on: the body's browser row ("body-2"), the timeline item it is the body of, and the face or edge under the pointer (selected as the menu opens). */
export interface ViewMenuTarget {
  row: string;
  feature: string;
  item: GeometryReference;
}

/**
 * The body under a right-click or a held finger (`pick`: an edge wins over
 * a face, as a click picks), on the bodies on screen (`scene`, joined
 * numbering); null on empty space, before a body is built, on a face or
 * edge with no name (a click selects nothing there either), or on a body
 * whose row the design no longer has (`failed`: the last rebuild's).
 */
export function viewMenuTarget(doc: DesignDocument, scene: Scene | null, pick: ViewportPick, failed?: ReadonlySet<string>): ViewMenuTarget | null {
  if (scene === null) return null;
  const hit = pick.edge != null ? ({ kind: "edge", index: pick.edge } as const) : pick.face !== null ? ({ kind: "face", index: pick.face } as const) : null;
  if (hit === null) return null;
  const on = sceneHit(scene, hit.kind, hit.index);
  if (on === null) return null;
  const body = scene.bodies[on.body];
  const item = designReference(hit.kind, body.names, on.index);
  if (item === null) return null;
  const row = `body-${body.place}`;
  const feature = rowItem(row, doc, failed);
  return feature === null ? null : { row, feature, item };
}

/** An entry of the view's menu: the browser row menu's, or Hide (the row's eye; never off, as a body on screen can always be hidden). */
export type ViewMenuEntry = MenuEntry | { action: "hide"; label: "Hide"; off: null };

/** The view's menu on the body of item `feature`, with sketch `editing` open or none: Hide, then the item's menu as its rows have it. */
export function viewMenuEntries(doc: DesignDocument, feature: string, editing: string | null = null): ViewMenuEntry[] {
  return [{ action: "hide", label: "Hide", off: null }, ...menuEntries(doc, feature, editing)];
}
