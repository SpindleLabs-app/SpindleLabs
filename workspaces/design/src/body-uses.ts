// Which earlier items shaped the bodies an item works on (SL #506 items 1
// to 3). A Combine, Move, Duplicate or operation extrude depends in the
// file only on the items that first made its bodies (`dependsOn`); the
// Moves and Combines that placed or changed those bodies before it are
// read from the timeline here, never stored, so the file format is
// unchanged and the answer always matches the order on screen:
// - reordering refuses to put such an item before one that shaped its
//   bodies, or one that shaped them after it, and (SL #676 item 1) an item
//   that works on a body after a later one that changes it, or that later
//   one before it (`readings`, timeline-edits.ts);
// - deleting one that shaped a later item's bodies asks first, naming it
//   (delete-ask.ts);
// - editing a Combine so it uses up a tool a later item works on is
//   refused in words (combine.ts `changedCombine`), as Extrude's operation
//   change is (extrude.ts `setExtrudeOperation`).

import type { Feature } from "@fission/core";
import { bodyItem, bodyNumbers, chamferOf, combineBodies, extrudeOperation, isChamferItem, isCombineItem, isDuplicateItem, isMoveItem, isPatternItem, isPiece, isShellItem, isSketchItem, shellOf, sketchInputs, type DesignDocument } from "./document.ts";
import { faceFeature, isFacePlane } from "./face-sketch.ts";

/** The bodies item `f` works on, by body id: a Move's, a Combine's target and tools, a Duplicate's (Combine bug hunt 11-08), a Pattern's (step 61b), an extrude's operation's. */
export function bodiesUsed(f: Feature): string[] {
  if (isDuplicateItem(f)) return typeof f.intent.parameters.body === "string" ? [f.intent.parameters.body] : [];
  if (isChamferItem(f)) return [chamferOf(f).body];
  if (isShellItem(f)) return [shellOf(f).body];
  if (isMoveItem(f) || isPatternItem(f)) return Array.isArray(f.intent.parameters.bodies) ? (f.intent.parameters.bodies as string[]) : [];
  if (isCombineItem(f)) {
    const c = combineBodies(f);
    return [c.target, ...c.tools];
  }
  return extrudeOperation(f)?.bodies ?? [];
}

/**
 * The bodies item `f` changes for the items after it: a Move's (placed),
 * a Chamfer's (cut back), a Shell's (hollowed out), a Combine's target (changed) and tools unless kept (used up), an
 * operation extrude's bodies picked, a Pattern's with Join (each joined to its copies). A Duplicate and a Pattern without Join
 * change none.
 */
export function bodiesChanged(f: Feature): string[] {
  if (isMoveItem(f) || isChamferItem(f) || isShellItem(f)) return bodiesUsed(f);
  if (isCombineItem(f)) {
    const c = combineBodies(f);
    return c.keepTools ? [c.target] : [c.target, ...c.tools];
  }
  if (isDuplicateItem(f)) return [];
  if (isPatternItem(f)) return f.intent.parameters.join === true ? bodiesUsed(f) : [];
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

/** One item working on a body that a later item changes (SL #676 item 1): the other way round from a Shaping. */
export interface Reading {
  /** The earlier item, which works on the body as it is before `then`. */
  first: Feature;
  /** The later item, which changes it. */
  then: Feature;
  /** The body. */
  body: string;
}

/**
 * Every pair in `features` (in order) where an earlier item works on a body
 * a later one changes, the earlier's first such body: a Copy, a Mirror or a
 * Combine keeping its tools reads a body that a later Move or Combine
 * changes, so swapping the two would silently read the changed body.
 */
export function readings(features: readonly Feature[]): Reading[] {
  const out: Reading[] = [];
  features.forEach((first, i) => {
    const used = bodiesUsed(first);
    if (used.length === 0) return;
    for (const then of features.slice(i + 1)) {
      const changed = new Set(bodiesChanged(then));
      const body = used.find((b) => changed.has(b));
      if (body !== undefined) out.push({ first, then, body });
    }
  });
  return out;
}

/**
 * A body in a timeline message: its item's name ("Box 2"), or "a piece of
 * Combine 1". Once that item is deleted (SL #676 item 4), the name an item
 * using it kept in its provenance, else "a deleted body": never the raw id.
 */
export function bodyWords(doc: DesignDocument, body: string): string {
  const id = bodyItem(body);
  const item = doc.timeline.features.find((f) => f.id === id);
  const kept = item === undefined ? doc.timeline.features.flatMap((f) => f.provenance.from).find((x) => x.id === id)?.label : undefined;
  const name = item?.provenance.self.label ?? kept;
  if (name === undefined) return "a deleted body";
  return isPiece(body) ? `a piece of ${name}` : name;
}

/** How a sketch hangs on a body (SL #676 item 3): drawn on one of its faces, or following one of its edges (a pin or a projection). */
export type SketchHold = "drawn on" | "following an edge of";

/**
 * The bodies sketch `f` lies on or follows, at its place in `doc`'s
 * timeline (SL #676 item 3), for reordering only: the body of its face's
 * item and of each item a pin or projection names, then, through each
 * Combine or operation extrude before it that takes one of those bodies
 * in, the body that comes out (its target, its picked bodies) and its
 * pieces. The rebuild finds the face and edges on those bodies as the items
 * before the sketch leave them, so a Move or Combine of one of them passing
 * the sketch would quietly put the sketch somewhere else. A sketch on an
 * origin or construction plane with no pins or projections holds none.
 * Errs towards more bodies: a drag it refuses wrongly is refused in words,
 * one it misses changes the part with none.
 */
export function sketchHolds(doc: DesignDocument, f: Feature): ((body: string) => SketchHold | null) | null {
  if (!isSketchItem(f)) return null;
  const content = doc.sketches.find((s) => s.id === f.id);
  const plane = f.intent.parameters.plane;
  const face = isFacePlane(plane) ? faceFeature(plane) : null;
  const inputs = sketchInputs(f, content);
  if (inputs.length === 0) return null;
  // Per hold: the items whose bodies and pieces it is on, and the bodies taken in since.
  const chains = new Map<SketchHold, { items: Set<string>; bodies: Set<string> }>();
  const add = (hold: SketchHold, item: string) => {
    const c = chains.get(hold) ?? { items: new Set<string>(), bodies: new Set<string>() };
    c.items.add(item);
    chains.set(hold, c);
  };
  for (const id of inputs) add(id === face ? "drawn on" : "following an edge of", id);
  const inChain = (c: { items: Set<string>; bodies: Set<string> }, b: string) => c.bodies.has(b) || (bodyItem(b) !== null && c.items.has(bodyItem(b)!));
  for (const g of doc.timeline.features) {
    if (g === f) break;
    const into = isCombineItem(g) ? [combineBodies(g).target] : (extrudeOperation(g)?.bodies ?? []);
    if (into.length === 0) continue;
    for (const c of chains.values()) {
      if (!c.items.has(g.id) && !bodiesUsed(g).some((b) => inChain(c, b))) continue;
      c.items.add(g.id);
      for (const b of into) c.bodies.add(b);
    }
  }
  return (body) => {
    for (const [hold, c] of chains) if (inChain(c, body)) return hold;
    return null;
  };
}

/**
 * SL #676 item 2: a new item put in at the marker (place `at`, named
 * `label`) that would use up `usedUp` refuses when an item after it works
 * on one of them, in the words `changedCombine` refuses the same with: a
 * Combine put in with the marker rolled back would otherwise take a later
 * Combine's tool, and that Combine would go red when rolled forward.
 */
export function refuseUsedUpLater(doc: DesignDocument, at: number, usedUp: readonly string[], label: string): void {
  if (usedUp.length === 0) return;
  for (const later of doc.timeline.features.slice(at)) {
    const used = bodiesUsed(later).find((b) => usedUp.includes(b));
    if (used === undefined) continue;
    const n = bodyNumbers(doc).get(used);
    throw new Error(`${later.provenance.self.label} uses ${n === undefined ? bodyWords(doc, used) : `Body ${n}`}, which ${label} would use up: change or delete ${later.provenance.self.label} first`);
  }
}
