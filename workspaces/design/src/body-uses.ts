// Which earlier items shaped the bodies an item works on (SL #506 items 1
// to 3). A Combine, Move, Duplicate or operation extrude depends in the
// file only on the items that first made its bodies (`dependsOn`); the
// Moves and Combines that placed or changed those bodies before it are
// read from the timeline here, never stored, so the file format is
// unchanged and the answer always matches the order on screen:
// - reordering refuses to put such an item before one that shaped its
//   bodies, or one that shaped them after it (timeline-edits.ts);
// - deleting one that shaped a later item's bodies asks first, naming it
//   (delete-ask.ts);
// - editing a Combine so it uses up a tool a later item works on is
//   refused in words (combine.ts `changedCombine`), as Extrude's operation
//   change is (extrude.ts `setExtrudeOperation`).

import type { Feature } from "@fission/core";
import { bodyItem, combineBodies, extrudeOperation, isCombineItem, isDuplicateItem, isMoveItem, isPiece, type DesignDocument } from "./document.ts";

/** The bodies item `f` works on, by body id: a Move's, a Combine's target and tools, a Duplicate's (Combine bug hunt 11-08), an extrude's operation's. */
export function bodiesUsed(f: Feature): string[] {
  if (isDuplicateItem(f)) return typeof f.intent.parameters.body === "string" ? [f.intent.parameters.body] : [];
  if (isMoveItem(f)) return Array.isArray(f.intent.parameters.bodies) ? (f.intent.parameters.bodies as string[]) : [];
  if (isCombineItem(f)) {
    const c = combineBodies(f);
    return [c.target, ...c.tools];
  }
  return extrudeOperation(f)?.bodies ?? [];
}

/**
 * The bodies item `f` changes for the items after it: a Move's (placed),
 * a Combine's target (changed) and tools unless kept (used up), an
 * operation extrude's bodies picked. A Duplicate changes none.
 */
export function bodiesChanged(f: Feature): string[] {
  if (isMoveItem(f)) return bodiesUsed(f);
  if (isCombineItem(f)) {
    const c = combineBodies(f);
    return c.keepTools ? [c.target] : [c.target, ...c.tools];
  }
  if (isDuplicateItem(f)) return [];
  return extrudeOperation(f)?.bodies ?? [];
}

/** One item shaping a body a later item works on. */
export interface Shaping {
  /** The earlier item. */
  by: Feature;
  /** The later item. */
  of: Feature;
  /** The body. */
  body: string;
}

/** Every pair in `features` (in order) where an earlier item changes a body a later one works on, the later's first body for each. */
export function shapings(features: readonly Feature[]): Shaping[] {
  const out: Shaping[] = [];
  features.forEach((of, j) => {
    const used = bodiesUsed(of);
    if (used.length === 0) return;
    for (const by of features.slice(0, j)) {
      const changed = new Set(bodiesChanged(by));
      const body = used.find((b) => changed.has(b));
      if (body !== undefined) out.push({ by, of, body });
    }
  });
  return out;
}

/** A body in a timeline message: its item's name ("Box 2"), or "a piece of Combine 1". */
export function bodyWords(doc: DesignDocument, body: string): string {
  const item = doc.timeline.features.find((f) => f.id === bodyItem(body));
  const name = item?.provenance.self.label ?? body;
  return isPiece(body) ? `a piece of ${name}` : name;
}
