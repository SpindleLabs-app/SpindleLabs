// Show only this body, and Show all (quick wins, Ben 2026-11-04): what the
// body's menu records. Only eyes change (the `hidden` list), never the
// timeline, so each is one undo step like a row's eye, and Show all puts
// every body back on screen, the Bodies folder's eye included.

import { bodyHidden, EYE_FOLDERS, isHidden, type DesignDocument } from "./document.ts";
import { bodyRows } from "./browser.ts";
import { hideBody, hideRow } from "./timeline-edits.ts";

/** The design with only body `bodyId` shown: every other body's eye shut, its own and the Bodies folder's open. Refuses a body id the design has no row for. */
export function showOnlyBody(doc: DesignDocument, bodyId: string, failed?: ReadonlySet<string>): DesignDocument {
  const rows = bodyRows(doc, failed);
  if (!rows.some((r) => r.body === bodyId)) throw new Error(`the design has no body ${JSON.stringify(bodyId)}`);
  let next = isHidden(doc, EYE_FOLDERS.bodies) ? hideRow(doc, EYE_FOLDERS.bodies, false) : doc;
  for (const r of rows) next = hideBody(next, r.body, r.body !== bodyId);
  return next;
}

/** The design with every body shown: each body's eye and the Bodies folder's open. The same document back when none is hidden. */
export function showAllBodies(doc: DesignDocument, failed?: ReadonlySet<string>): DesignDocument {
  let next = isHidden(doc, EYE_FOLDERS.bodies) ? hideRow(doc, EYE_FOLDERS.bodies, false) : doc;
  for (const r of bodyRows(doc, failed)) next = hideBody(next, r.body, false);
  return next;
}

/** How many of the design's bodies are hidden (by their own eye or the Bodies folder's): Show all is off at 0. */
export function hiddenBodyCount(doc: DesignDocument, failed?: ReadonlySet<string>): number {
  return bodyRows(doc, failed).filter((r) => bodyHidden(doc, r.body)).length;
}
