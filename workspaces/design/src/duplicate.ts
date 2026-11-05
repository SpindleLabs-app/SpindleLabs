// Duplicate body (step 35e2, Ben 2026-10-25: "Duplicate body"): a timeline
// item that copies one body where it is at the Duplicate's place in the
// timeline. The copy is a body of its own ("body:<the Duplicate>", numbered
// like any), so it can be moved, combined, sketched on, hidden or exported
// like the body it came from; it follows its source's sizes (an edit to the
// source changes the copy too) but nothing done to the source after the
// Duplicate. Picking several bodies makes one Duplicate each, in one undo
// step. The document change is `insertDuplicates`, a pure function; the
// rebuild builds the copy (rebuild.ts `copyBody`).

import type { Feature } from "@fission/core";
import { bodyIdOf, bodyItem, counted, freshName, insertAt, insertItem, isDuplicateItem, isPiece, makesBody, numberBodies, shown, takenNames, type DesignDocument } from "./document.ts";

/** The undo step new Duplicates are recorded as. */
export const DUPLICATE_STEP = "Duplicate bodies";

/** What a Duplicate's summary and the timeline row say: "Copy of Box 1". */
export const duplicateSummary = (source: string): string => `Copy of ${source}`;

/** Whether the design numbers body `id` (a Combine's piece is a body once `bodies` lists it). */
const numbered = (doc: DesignDocument, id: string): boolean => (doc.bodies ?? []).some((b) => b.id === id);

/**
 * The design with a Duplicate of each of `bodies` (body ids) put in at the
 * marker, in the order given ("Copy 1", "Copy 2"…, ids from the counter),
 * and their ids, each Duplicate's copy being `bodyIdOf` its id. Refused,
 * changing nothing, unless each is a body made before the marker, each
 * picked once, at least one.
 */
export function insertDuplicates(doc: DesignDocument, bodies: readonly string[]): { doc: DesignDocument; ids: string[] } {
  if (bodies.length === 0) throw new Error("pick at least one body to duplicate");
  const end = insertAt(doc);
  const sources = bodies.map((b, i) => {
    const item = bodyItem(b);
    if (item === null) throw new Error(`${shown(b)} is not a body id`);
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    const at = doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[at];
    if (f === undefined || !(isPiece(b) ? numbered(doc, b) : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (at >= end) throw new Error(`${f.provenance.self.label} comes after the rollback marker, so a copy put in at the marker can't be made of it`);
    return f;
  });
  let next = doc;
  const ids: string[] = [];
  for (const [i, source] of sources.entries()) {
    const id = `feature-${next.nextId}`;
    const label = freshName("Copy", next.timeline.features.filter(isDuplicateItem).length, takenNames(next));
    const name = isPiece(bodies[i]) ? `a piece of ${source.provenance.self.label}` : source.provenance.self.label;
    const feature: Feature = {
      id,
      intent: { type: "duplicate", parameters: { body: bodies[i] }, summary: duplicateSummary(name) },
      provenance: { self: { workspace: "design", id, label }, from: [{ workspace: "design", id: source.id, label: source.provenance.self.label }] },
      dependsOn: [source.id],
      suppressed: false,
    };
    next = { ...next, nextId: counted(next.nextId + 1), timeline: insertItem(next, feature) };
    ids.push(id);
  }
  // Each copy numbered as it appears, in the same undo step (`numberBodies`).
  return { doc: numberBodies(next), ids };
}

/** The copies `insertDuplicates` made, by body id, in order: what the Move panel opens on next. */
export const copiesOf = (ids: readonly string[]): string[] => ids.map(bodyIdOf);
