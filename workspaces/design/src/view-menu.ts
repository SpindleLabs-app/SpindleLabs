// The menu on a body in the 3D view (missing basics, Ben 2026-11-04): a
// right-click, or a finger held still, on a body's face or edge opens the
// same menu as its Body row in the browser (its feature's: Edit feature,
// Move the marker here, Suppress, Rename, Delete) with Hide first, which
// the row has as its eye. Pure: workspace.ts asks `viewMenuTarget` what is
// under the pointer, selects it, and opens `viewMenuEntries`.

import type { GeometryReference, ViewportPick } from "@fission/core";
import { bodyRows, rowItem } from "./browser.ts";
import { hiddenBodyCount } from "./show-only.ts";
import type { DesignDocument } from "./document.ts";
import { sceneHit, shownReference, type Scene } from "./scene.ts";
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
  const item = shownReference(scene, on.body, hit.kind, on.index);
  if (item === null) return null;
  const row = `body-${body.place}`;
  const feature = rowItem(row, doc, failed);
  return feature === null ? null : { row, feature, item };
}

/**
 * An entry of the view's menu: the browser row menu's, Hide (the row's eye; never off, as a body on screen can always
 * be hidden), or Show only this body and Show all bodies (quick wins, `show-only.ts`), each off with why when it would
 * change nothing.
 */
export type ViewMenuEntry = MenuEntry | { action: "hide"; label: "Hide"; off: null } | { action: "show-only" | "show-all"; label: string; off: string | null };

/** Show only this body and Show all bodies for Body row `row` ("body-2"), as the view's menu and a Body row's menu offer them. */
export function showEntries(doc: DesignDocument, row: string, failed?: ReadonlySet<string>): ViewMenuEntry[] {
  const rows = bodyRows(doc, failed);
  if (!rows.some((r) => r.id === row)) return [];
  return [
    { action: "show-only", label: "Show only this body", off: rows.length < 2 ? "It is the only body" : null },
    { action: "show-all", label: "Show all bodies", off: hiddenBodyCount(doc, failed) === 0 ? "Every body is shown already" : null },
  ];
}

/** The view's menu on the body of item `feature` (on Body row `row`), with sketch `editing` open or none: Hide, Show only and Show all, then the item's menu as its rows have it. */
export function viewMenuEntries(doc: DesignDocument, feature: string, editing: string | null = null, row?: string, failed?: ReadonlySet<string>): ViewMenuEntry[] {
  return [{ action: "hide", label: "Hide", off: null }, ...(row === undefined ? [] : showEntries(doc, row, failed)), ...menuEntries(doc, feature, editing)];
}
