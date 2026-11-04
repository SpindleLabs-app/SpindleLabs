// The constraint tools (step 47d2): Horizontal, Vertical, Coincident and
// Fix on the sketch toolbar's Constraints group. Pure functions: what the
// pointer is over (`constraintPickAt`), what a click does (`clickConstraint`:
// the constraint to add once enough is picked), the marks each constraint
// is drawn with (`constraintMarks`) and the words the hint shows. Adding is
// constraints.ts's `addConstraint`, on the kernel's solver.
//
// Picks, as Fusion's: Horizontal and Vertical take a line (its start held,
// its end moving) or two points (the first held); Coincident takes two
// points (the second moves onto the first); Fix takes one point. A point
// within reach wins over a line, since a line's end is on the line too.

import type { SketchXY } from "@fission/core";
import type { Sketch, SketchConstraint } from "./document.ts";
import type { NewConstraint } from "./constraints.ts";
import { toSegment } from "./sketch-select.ts";

export type ConstraintKind = SketchConstraint["kind"];

/** The constraint kinds the toolbar offers, in its order, with their names. */
export const CONSTRAINT_TOOLS: readonly { kind: ConstraintKind; label: string }[] = [
  { kind: "horizontal", label: "Horizontal" },
  { kind: "vertical", label: "Vertical" },
  { kind: "coincident", label: "Coincident" },
  { kind: "fix", label: "Fix" },
];

/** What a constraint tool's pointer is over: a point, or (Horizontal and Vertical) a line. */
export type ConstraintPick = { point: string } | { line: string };

/**
 * A constraint tool on one sketch: the first point picked (Horizontal,
 * Vertical and Coincident between two points), what the pointer is over,
 * and, after a refusal, the constraints and arcs that fight (drawn red
 * until the next pick).
 */
export interface ConstraintTool {
  kind: ConstraintKind;
  sketch: string;
  first: string | null;
  hover: ConstraintPick | null;
  fighting: readonly string[];
}

export const isConstraintKind = (kind: string): kind is ConstraintKind => CONSTRAINT_TOOLS.some((t) => t.kind === kind);

/** Whether a sketch tool is one of the constraint tools. */
export const isConstraintTool = <T extends { kind: string }>(tool: T): tool is T & ConstraintTool => isConstraintKind(tool.kind);

/** A constraint tool on a sketch, nothing picked. */
export const startConstraintTool = (kind: ConstraintKind, sketch: string): ConstraintTool => ({ kind, sketch, first: null, hover: null, fighting: [] });

/** The point or line within `reach` mm of `at` that the tool can take, the nearest point first; null for none. */
export function constraintPickAt(sketch: Sketch, kind: ConstraintKind, at: SketchXY, reach: number): ConstraintPick | null {
  let point: string | null = null;
  let nearest = Infinity;
  for (const p of sketch.points) {
    const d = Math.hypot(p.x - at[0], p.y - at[1]);
    if (d <= reach && d < nearest) [point, nearest] = [p.id, d];
  }
  if (point !== null) return { point };
  if (kind !== "horizontal" && kind !== "vertical") return null;
  const xy = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as SketchXY]));
  let line: string | null = null;
  nearest = Infinity;
  for (const c of sketch.curves) {
    if (c.kind !== "line") continue;
    const d = toSegment(at, xy.get(c.start)!, xy.get(c.end)!);
    if (d <= reach && d < nearest) [line, nearest] = [c.id, d];
  }
  return line === null ? null : { line };
}

/**
 * A click on `pick` (null: on nothing): the tool after it, and the
 * constraint to add once the click completes one. A click on nothing, or
 * on the first point again, keeps the first pick.
 */
export function clickConstraint(tool: ConstraintTool, sketch: Sketch, pick: ConstraintPick | null): { tool: ConstraintTool; add: NewConstraint | null } {
  const next = { ...tool, hover: pick, fighting: [] };
  if (pick === null) return { tool: next, add: null };
  if ("line" in pick) {
    const line = sketch.curves.find((c) => c.id === pick.line);
    if (line?.kind !== "line" || (tool.kind !== "horizontal" && tool.kind !== "vertical")) return { tool: next, add: null };
    return { tool: { ...next, first: null }, add: { kind: tool.kind, a: line.start, b: line.end } };
  }
  if (tool.kind === "fix") return { tool: { ...next, first: null }, add: { kind: "fix", point: pick.point } };
  if (tool.first === null || tool.first === pick.point || !sketch.points.some((p) => p.id === tool.first)) return { tool: { ...next, first: pick.point }, add: null };
  return { tool: { ...next, first: null }, add: { kind: tool.kind, a: tool.first, b: pick.point } };
}

/** The hint under the pointer: what to pick next. */
export function constraintHint(tool: ConstraintTool): string {
  if (tool.kind === "fix") return "Click a point to fix it where it is";
  if (tool.kind === "coincident") return tool.first === null ? "Click a point to keep still" : "Click the point to move onto it";
  const word = tool.kind === "horizontal" ? "level with" : "straight above or below";
  return tool.first === null ? `Click a line, or a point to keep still` : `Click the point to make ${word} the first`;
}

/** The undo step's name for a constraint added: "Horizontal", "Fix"… */
export const constraintStep = (kind: ConstraintKind): string => CONSTRAINT_TOOLS.find((t) => t.kind === kind)!.label;

type Segment = readonly [SketchXY, SketchXY];

/**
 * Each constraint's mark, as segments `size` mm across (the drawing gives
 * a size in screen pixels): Horizontal a bar above the middle of its two
 * points, Vertical a bar to the right of it, Coincident a diamond round
 * its first point, Fix a square with a cross. By constraint id, so the ones
 * that fight can be drawn red.
 */
export function constraintMarks(sketch: Sketch, size: number): Map<string, Segment[]> {
  const xy = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as SketchXY]));
  const h = size / 2;
  const marks = new Map<string, Segment[]>();
  for (const c of sketch.constraints) {
    if (c.kind === "fix") {
      const p = xy.get(c.point);
      if (!p) continue;
      const [x, y] = p;
      const box: SketchXY[] = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
      marks.set(c.id, [...box.map((q, i) => [q, box[(i + 1) % 4]] as Segment), [box[0], box[2]], [box[1], box[3]]]);
      continue;
    }
    const [a, b] = [xy.get(c.a), xy.get(c.b)];
    if (!a || !b) continue;
    if (c.kind === "coincident") {
      const [x, y] = a;
      const d: SketchXY[] = [[x, y - h], [x + h, y], [x, y + h], [x - h, y]];
      marks.set(c.id, d.map((q, i) => [q, d[(i + 1) % 4]] as Segment));
      continue;
    }
    const m: SketchXY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    marks.set(c.id, c.kind === "horizontal" ? [[[m[0] - h, m[1] + size], [m[0] + h, m[1] + size]]] : [[[m[0] + size, m[1] - h], [m[0] + size, m[1] + h]]]);
  }
  return marks;
}

/** The constraint whose mark (drawn `size` mm across) passes within `reach` mm of `at`, the nearest; null for none. The Select tool picks it, so Delete takes the constraint off. */
export function markAt(sketch: Sketch, at: SketchXY, reach: number, size: number): string | null {
  let best: string | null = null;
  let nearest = Infinity;
  for (const [id, segments] of constraintMarks(sketch, size)) {
    for (const [a, b] of segments) {
      const d = toSegment(at, a, b);
      if (d <= reach && d < nearest) [best, nearest] = [id, d];
    }
  }
  return best;
}
