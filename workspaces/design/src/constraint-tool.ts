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
//
// Dimension (step 47e) takes a line (its length), an arc (its radius), a
// circle (its diameter) or two points (the distance between them); the
// picks then wait (`pending`) for the value, typed in a box that starts at
// the size as drawn, before the dimension is added. Its mark is a
// dimension line beside what it sizes, with the value as a label
// (`dimensionLabels`).

import type { SketchXY } from "@fission/core";
import type { Sketch, SketchConstraint } from "./document.ts";
import type { NewConstraint } from "./constraints.ts";
import { shownValue } from "./typed-entry.ts";
import { curveAt, toSegment } from "./sketch-select.ts";

/** The constraint tools' kinds: the constraints' own, and Dimension for distances and diameters. */
export type ConstraintKind = Exclude<SketchConstraint["kind"], "distance" | "diameter"> | "dimension";

/** The constraint kinds the toolbar offers, in its order, with their names. */
export const CONSTRAINT_TOOLS: readonly { kind: ConstraintKind; label: string }[] = [
  { kind: "horizontal", label: "Horizontal" },
  { kind: "vertical", label: "Vertical" },
  { kind: "coincident", label: "Coincident" },
  { kind: "fix", label: "Fix" },
  { kind: "dimension", label: "Dimension" },
];

/** What a constraint tool's pointer is over: a point, (Horizontal and Vertical) a line, or (Dimension) a line, arc or circle. */
export type ConstraintPick = { point: string } | { line: string } | { curve: string };

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
  /** Dimension: the dimension the picks made, waiting for its value (its `value` the size as drawn). */
  pending?: NewDimension | null;
  /** Dimension: the box the pending value is typed in, "radius" for an arc's (a line's or two points' is a length). */
  pendingField?: "length" | "radius";
  /** Dimension: the dimension whose value the pending one changes (its label double-clicked), absent for a new one. */
  changing?: string;
}

/** A dimension the Dimension tool's picks made, before its value is typed. */
export type NewDimension = Extract<NewConstraint, { kind: "distance" | "diameter" }>;

export const isConstraintKind = (kind: string): kind is ConstraintKind => CONSTRAINT_TOOLS.some((t) => t.kind === kind);

/** Whether a sketch tool is one of the constraint tools. */
export const isConstraintTool = <T extends { kind: string }>(tool: T): tool is T & ConstraintTool => isConstraintKind(tool.kind);

/** A constraint tool on a sketch, nothing picked. */
export const startConstraintTool = (kind: ConstraintKind, sketch: string): ConstraintTool => ({ kind, sketch, first: null, hover: null, fighting: [], ...(kind === "dimension" ? { pending: null } : {}) });

/** The point or line within `reach` mm of `at` that the tool can take, the nearest point first; null for none. */
export function constraintPickAt(sketch: Sketch, kind: ConstraintKind, at: SketchXY, reach: number): ConstraintPick | null {
  let point: string | null = null;
  let nearest = Infinity;
  for (const p of sketch.points) {
    const d = Math.hypot(p.x - at[0], p.y - at[1]);
    if (d <= reach && d < nearest) [point, nearest] = [p.id, d];
  }
  if (point !== null) return { point };
  if (kind === "dimension") {
    const curve = curveAt(sketch, at, reach);
    return curve === null ? null : { curve };
  }
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
  if (tool.kind === "dimension") return clickDimension(next, sketch, pick);
  if ("line" in pick) {
    const line = sketch.curves.find((c) => c.id === pick.line);
    if (line?.kind !== "line" || (tool.kind !== "horizontal" && tool.kind !== "vertical")) return { tool: next, add: null };
    return { tool: { ...next, first: null }, add: { kind: tool.kind, a: line.start, b: line.end } };
  }
  if ("curve" in pick) return { tool: next, add: null };
  if (tool.kind === "fix") return { tool: { ...next, first: null }, add: { kind: "fix", point: pick.point } };
  if (tool.first === null || tool.first === pick.point || !sketch.points.some((p) => p.id === tool.first)) return { tool: { ...next, first: pick.point }, add: null };
  return { tool: { ...next, first: null }, add: { kind: tool.kind, a: tool.first, b: pick.point } };
}

/** Dimension's click: a curve, or a second point, makes the dimension that then waits for its value. */
function clickDimension(tool: ConstraintTool, sketch: Sketch, pick: ConstraintPick): { tool: ConstraintTool; add: NewConstraint | null } {
  const xy = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as SketchXY]));
  const apart = (a: string, b: string) => Math.hypot(xy.get(a)![0] - xy.get(b)![0], xy.get(a)![1] - xy.get(b)![1]);
  let pending: NewDimension | null = null;
  if ("point" in pick) {
    if (tool.first === null || tool.first === pick.point || !xy.has(tool.first)) return { tool: { ...tool, first: pick.point, pending: null }, add: null };
    // An arc's centre and one of its ends, in either order, is its radius: centre first, as when the arc is picked (the solver bug hunt, 2026-11-06).
    const [p, q] = [tool.first, pick.point];
    const ends = (c: { start: string; end: string }, x: string) => c.start === x || c.end === x;
    const arc = sketch.curves.find((c) => c.kind === "arc" && ((c.centre === p && ends(c, q)) || (c.centre === q && ends(c, p))));
    if (arc?.kind === "arc") {
      const end = arc.centre === p ? q : p;
      return { tool: { ...tool, first: null, pending: { kind: "distance", a: arc.centre, b: end, value: apart(arc.centre, end) }, pendingField: "radius" }, add: null };
    }
    pending = { kind: "distance", a: tool.first, b: pick.point, value: apart(tool.first, pick.point) };
  } else {
    const c = sketch.curves.find((q) => q.id === ("curve" in pick ? pick.curve : pick.line));
    if (c?.kind === "line") pending = { kind: "distance", a: c.start, b: c.end, value: apart(c.start, c.end) };
    else if (c?.kind === "arc") return { tool: { ...tool, first: null, pending: { kind: "distance", a: c.centre, b: c.start, value: apart(c.centre, c.start) }, pendingField: "radius" }, add: null };
    else if (c?.kind === "circle") pending = { kind: "diameter", circle: c.id, value: 2 * c.radius };
  }
  return { tool: { ...tool, first: null, pending, pendingField: "length" }, add: null };
}

/** The Dimension tool changing dimension `id` (its label double-clicked or tapped): its value waits in the box; null when it is no dimension. */
export function changeDimensionTool(sketch: Sketch, id: string): ConstraintTool | null {
  const c = sketch.constraints.find((q) => q.id === id);
  if (c?.kind !== "distance" && c?.kind !== "diameter") return null;
  const { id: _, ...pending } = c;
  return { ...startConstraintTool("dimension", sketch.id), pending, pendingField: dimensionWord(sketch, c) === "Radius" ? "radius" : "length", changing: id };
}

/** What a pending dimension sizes, in the value box's words: "Length", "Radius", "Diameter" or "Distance". */
export function dimensionWord(sketch: Sketch, d: NewDimension | SketchConstraint): string {
  if (d.kind === "diameter") return "Diameter";
  if (d.kind !== "distance") return "";
  if (sketch.curves.some((c) => c.kind === "line" && ((c.start === d.a && c.end === d.b) || (c.start === d.b && c.end === d.a)))) return "Length";
  if (sketch.curves.some((c) => c.kind === "arc" && c.centre === d.a && (c.start === d.b || c.end === d.b))) return "Radius";
  return "Distance";
}

/** The hint under the pointer: what to pick next. */
export function constraintHint(tool: ConstraintTool): string {
  if (tool.kind === "dimension") {
    if (tool.pending) return "Type the size and press Enter, or Escape to leave it";
    return tool.first === null ? "Click a line, arc or circle to size it, or a point to measure from" : "Click the point to measure to";
  }
  if (tool.kind === "fix") return "Click a point to fix it where it is";
  if (tool.kind === "coincident") return tool.first === null ? "Click a point to keep still" : "Click the point to move onto it";
  const word = tool.kind === "horizontal" ? "level with" : "straight above or below";
  return tool.first === null ? `Click a line, or a point to keep still` : `Click the point to make ${word} the first`;
}

/** The undo step's name for a constraint added: "Horizontal", "Fix"… */
export const constraintStep = (kind: ConstraintKind | SketchConstraint["kind"]): string => (kind === "distance" || kind === "diameter" ? "Dimension" : CONSTRAINT_TOOLS.find((t) => t.kind === kind)!.label);

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
    if (c.kind === "distance" || c.kind === "diameter") {
      const d = dimensionLine(sketch, c, size);
      if (d) marks.set(c.id, d.segments);
      continue;
    }
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

/** How far beside what it sizes a dimension line is drawn, in mark sizes. */
const DIMENSION_OFFSET = 2.5;

/**
 * A dimension's drawing (47e), `size` mm a mark: a distance's line beside
 * its two points (to the left going from the first to the second, with a
 * short tick at each end), a radius from the arc's centre to its start, a
 * diameter across the circle; and where its label sits. Null when its
 * points are gone.
 */
export function dimensionLine(sketch: Sketch, c: NewDimension | SketchConstraint, size: number): { segments: Segment[]; label: SketchXY } | null {
  const xy = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as SketchXY]));
  if (c.kind === "diameter") {
    const circle = sketch.curves.find((q) => q.id === c.circle);
    const centre = circle?.kind === "circle" ? xy.get(circle.centre) : undefined;
    if (circle?.kind !== "circle" || !centre) return null;
    const r = circle.radius * Math.SQRT1_2;
    const a: SketchXY = [centre[0] - r, centre[1] - r];
    const b: SketchXY = [centre[0] + r, centre[1] + r];
    return { segments: [[a, b]], label: [b[0] + size / 2, b[1] + size / 2] };
  }
  if (c.kind !== "distance") return null;
  const [a, b] = [xy.get(c.a), xy.get(c.b)];
  if (!a || !b) return null;
  if (dimensionWord(sketch, c) === "Radius") return { segments: [[a, b]], label: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: SketchXY = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const off = DIMENSION_OFFSET * size;
  const p: SketchXY = [a[0] + n[0] * off, a[1] + n[1] * off];
  const q: SketchXY = [b[0] + n[0] * off, b[1] + n[1] * off];
  const tick = (m: SketchXY): Segment => [[m[0] - (n[0] * size) / 2, m[1] - (n[1] * size) / 2], [m[0] + (n[0] * size) / 2, m[1] + (n[1] * size) / 2]];
  return { segments: [[p, q], tick(p), tick(q)], label: [(p[0] + q[0]) / 2 + n[0] * size, (p[1] + q[1]) / 2 + n[1] * size] };
}

/** Each dimension's label (47e): where it sits and the value it shows ("12.5", "R 4", "⌀ 10"), by constraint id. */
export function dimensionLabels(sketch: Sketch, size: number): { id: string; at: SketchXY; text: string }[] {
  const out: { id: string; at: SketchXY; text: string }[] = [];
  for (const c of sketch.constraints) {
    if (c.kind !== "distance" && c.kind !== "diameter") continue;
    const d = dimensionLine(sketch, c, size);
    if (!d) continue;
    const word = dimensionWord(sketch, c);
    const prefix = word === "Diameter" ? "⌀ " : word === "Radius" ? "R " : "";
    out.push({ id: c.id, at: d.label, text: `${prefix}${shownValue(c.value)}` });
  }
  return out;
}
