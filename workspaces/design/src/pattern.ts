// Pattern (step 61, Ben 2026-11-11: "do patterns"): repeat bodies in a
// row, a grid or round an axis, as a timeline item. Fusion's behaviour, our
// own words: the count is of instances, the original included (a row of 3
// is the body and two copies), the copies are new bodies of their own, and
// Join (off by default) joins each body's copies to it where they overlap.
//
// Here: the item's values, checked in plain words before the kernel sees
// them (`patternProblem`), the kernel's request (`patternRequest`, for its
// `pattern_motions`, which works out every copy's move or turn: the maths
// lives in the kernel, once), the words a summary and a refusal use, and the
// item put in at the marker (`insertPattern`). The rebuild builds each copy
// as a Move builds a moved body and joins with Combine's booleans (step 61b,
// next). Behind the `?pattern` flag until Ben says it goes public.

import type { Feature } from "@fission/core";
import { bodyItem, counted, freshName, insertAt, insertItem, isPatternItem, isPiece, makesBody, shown, takenNames, type DesignDocument } from "./document.ts";
import { patternProblem, patternSummary, patternValuesOf, savedValues, type PatternValues } from "./pattern-values.ts";

export * from "./pattern-values.ts";

/** The undo step a new Pattern is recorded as. */
export const PATTERN_STEP = "Pattern bodies";

/**
 * The design with a new Pattern of `bodies` (body ids, in the order
 * picked) put in at the marker ("Pattern 1", its id from the counter), and
 * its id. Refused, changing nothing, for values `patternProblem` refuses,
 * no body, a body picked twice, and anything that is no body made before
 * the marker.
 */
export function insertPattern(doc: DesignDocument, bodies: readonly string[], values: PatternValues): { doc: DesignDocument; id: string } {
  const problem = patternProblem(values);
  if (problem !== null) throw new Error(problem);
  if (bodies.length === 0) throw new Error("pick at least one body to pattern");
  const end = insertAt(doc);
  const items = bodies.map((b, i) => {
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    const item = bodyItem(b);
    const at = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[at];
    const numbered = (doc.bodies ?? []).some((x) => x.id === b);
    if (f === undefined || !(isPiece(b) ? numbered : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (at >= end) throw new Error(`${f.provenance.self.label} comes after the rollback marker, so a Pattern put in at the marker can't use it`);
    return f;
  });
  const id = `feature-${doc.nextId}`;
  const label = freshName("Pattern", doc.timeline.features.filter((f) => f.intent.type === "pattern").length, takenNames(doc));
  const names = bodies.map((b, i) => (isPiece(b) ? `a piece of ${items[i].provenance.self.label}` : items[i].provenance.self.label));
  const makers = [...new Map(items.map((f) => [f.id, f])).values()];
  const feature: Feature = {
    id,
    intent: { type: "pattern", parameters: { bodies: [...bodies], ...savedValues(values) } as unknown as Feature["intent"]["parameters"], summary: patternSummary(names, values) },
    provenance: { self: { workspace: "design", id, label }, from: makers.map((f) => ({ workspace: "design" as const, id: f.id, label: f.provenance.self.label })) },
    dependsOn: makers.map((f) => f.id),
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}

/** A Pattern as Edit feature opens it (step 61c): its id, name, bodies (body ids, as picked) and values. */
export interface EditablePattern {
  id: string;
  name: string;
  bodies: string[];
  values: PatternValues;
}

/** Pattern `id`'s values for Edit feature; refused in words for anything that is no Pattern in the timeline. */
export function editablePattern(doc: DesignDocument, id: string): EditablePattern {
  const f = doc.timeline.features.find((x) => x.id === id);
  if (f === undefined || !isPatternItem(f)) throw new Error(`${shown(id)} is not a Pattern in the timeline`);
  return { id, name: f.provenance.self.label, bodies: [...(f.intent.parameters.bodies as string[])], values: savedValues(patternValuesOf(f.intent.parameters)) };
}

/** The words over an edited Pattern's bodies: they stay as picked (as an edited Combine's do). */
export const EDIT_BODIES_NOTE = "Its bodies stay as they were picked: to pattern other bodies, make another Pattern.";

/**
 * The design with Pattern `id` given `values` (Edit feature, step 61c): the
 * same item, keeping its id, place, bodies, name and flags; its summary
 * said again with the names it holds. The document itself comes back when
 * the saved values are unchanged (a leftover second count with no second
 * direction is no change), so nothing is recorded. Refused, changing
 * nothing, for values `patternProblem` refuses.
 */
export function changedPattern(doc: DesignDocument, id: string, values: PatternValues): DesignDocument {
  const at = doc.timeline.features.findIndex((x) => x.id === id);
  const f = doc.timeline.features[at];
  if (f === undefined || !isPatternItem(f)) throw new Error(`${shown(id)} is not a Pattern in the timeline`);
  const problem = patternProblem(values);
  if (problem !== null) throw new Error(problem);
  const saved = savedValues(values);
  const bodies = [...(f.intent.parameters.bodies as string[])];
  if (JSON.stringify(savedValues(patternValuesOf(f.intent.parameters))) === JSON.stringify(saved)) return doc;
  const names = bodies.map((b) => {
    const maker = bodyItem(b);
    const label = f.provenance.from.find((r) => r.id === maker)?.label ?? b;
    return isPiece(b) ? `a piece of ${label}` : label;
  });
  const changed: Feature = { ...f, intent: { ...f.intent, parameters: { bodies, ...saved } as unknown as Feature["intent"]["parameters"], summary: patternSummary(names, saved) } };
  const features = [...doc.timeline.features];
  features[at] = changed;
  return { ...doc, timeline: { ...doc.timeline, features } };
}
