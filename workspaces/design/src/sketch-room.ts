// What one sketch, and a design's sketches together, may hold while it is edited: no more than the reader opens
// (SL #641 item 2). The edit functions call `sketchRoom` on the sketch they make; the tools say its words.
import { DESIGN_LIMITS, MAX_SKETCH_CONSTRAINTS, type DesignDocument, type Sketch } from "./document.ts";

/** An edit refused because it would take a sketch, or the design's sketches together, past what the reader opens (`sketchRoom`). */
export class SketchFull extends Error {}

/**
 * Refuses (throws `SketchFull`, in words) an edit that would make sketch `after`, in place of `doc`'s sketch of its id,
 * hold more than the reader opens (#641 item 2: the 2,001st rectangle in one sketch made a design the app's own reader
 * refused, the file, the kept copy and every undo step): more than DESIGN_LIMITS.sketch points and curves or
 * MAX_SKETCH_CONSTRAINTS constraints, or the design's sketches and kept shapes together more than DESIGN_LIMITS.content.
 * Only growth is refused: an edit that takes something away always goes through.
 */
export function sketchRoom(doc: DesignDocument, after: Sketch): void {
  const before = doc.sketches.find((s) => s.id === after.id);
  const size = (s: Pick<Sketch, "points" | "curves"> | undefined) => (s === undefined ? 0 : s.points.length + s.curves.length);
  const grows = size(after) > size(before);
  if (grows && size(after) > DESIGN_LIMITS.sketch) throw new SketchFull(`This sketch is full: it holds ${DESIGN_LIMITS.sketch.toLocaleString("en")} points and curves, the most one sketch can. Draw the rest in a new sketch.`);
  if (after.constraints.length > (before?.constraints.length ?? 0) && after.constraints.length > MAX_SKETCH_CONSTRAINTS) throw new SketchFull(constraintsFull());
  if (!grows) return;
  let total = size(after);
  for (const s of doc.sketches) if (s.id !== after.id) total += size(s);
  for (const k of Object.values(doc.kept ?? {})) total += size(k);
  if (total > DESIGN_LIMITS.content) throw new SketchFull(`This design is full: its sketches hold ${DESIGN_LIMITS.content.toLocaleString("en")} points and curves together, the most one design can. Delete some, or start the rest in a new design.`);
}

/** Why a sketch takes no more constraints (`sketchRoom`, `addConstraint`). */
export const constraintsFull = (): string => `This sketch is full: it holds ${MAX_SKETCH_CONSTRAINTS.toLocaleString("en")} constraints, the most one sketch can. Draw the rest in a new sketch.`;
