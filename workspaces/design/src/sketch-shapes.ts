// More sketch shapes (step 52c, pulled forward 2026-11-11): the rectangle
// from its centre and from three points, the circle through three points,
// the polygon (inscribed in or circumscribed round a circle), the slot
// (centre to centre, and overall) and the sketch point. Each is built only
// from what a sketch already holds (lines, arcs, circles and points), so
// the kernel and the file format are unchanged.
//
// Every shape tool keeps its clicks in one list (`clicks`), so the rest of
// the sketcher (the points drawn while a shape is half done, Escape, the
// snap's own clicks) treats them alike. A click goes through `shapeClick`:
// until the tool has all its clicks it only keeps them; the last one turns
// them into a plan (`shapePlan`: points by index, the curves between them,
// the point pairs to keep level or upright) or a refusal in words, and
// `drawPlan` draws the plan into the sketch as one undo step, sharing the
// sketch's points the way the line and arc tools do.
//
// Constraints, as Fusion gives them, where the solver (step 47) has them:
// a side or slot edge drawn exactly level gets Horizontal, one exactly
// upright Vertical (the rectangle tool's rule, constraints.ts
// `squaredRectangle`), so a centre rectangle stays a rectangle under any
// size typed on it, and a level or upright slot keeps its straight sides
// level, its arc ends square to them (tangent) and its centres midway.
// What Fusion adds beyond that waits for the constraints themselves (step
// 49: parallel, perpendicular, equal, tangent; 49b: midpoint): a tilted
// rectangle or slot and a polygon's equal sides are exact as drawn, but a
// drag or a size can bend them until then. Recorded in docs/progress/cad.md
// under 52c.

import type { SketchArc, SketchXY } from "@fission/core";
import { counted, type DesignDocument, type Sketch, type SketchConstraint, type SketchCurve, type SketchLineCurve } from "./document.ts";
import { arcThere, MIN_CHORD } from "./centre-arc.ts";
import { drawArc, drawCircle, drawLine, drawPoint, pointAt, pointNear, type LineEnd } from "./sketch.ts";
import { followingPoints } from "./constraints.ts";
import { angleOf, direction, lineEnd, type Locks, type TypedField } from "./typed-entry.ts";
import { SAME_PLACE } from "./snap.ts";
import { arcSegments, arcThrough, circleSegments } from "./sketch-tool.ts";

/** The shape tools, each named by what it draws. */
export type ShapeKind = "centre-rectangle" | "three-rectangle" | "three-circle" | "polygon" | "outside-polygon" | "slot" | "overall-slot" | "point";

/** A shape tool on one sketch: the clicks so far (none, or fewer than `SHAPE_CLICKS`), and a polygon's number of sides. */
export interface ShapeTool {
  kind: ShapeKind;
  sketch: string;
  clicks: readonly SketchXY[];
  /** A polygon's sides, 3 to MAX_SIDES (DEFAULT_SIDES until another is typed; kept from one polygon to the next). */
  sides?: number;
}

/** How many clicks each shape takes: a centre and a corner; three corners; three points; a centre and a corner or a side's middle; two centres (or ends) and the width; one place. */
export const SHAPE_CLICKS: Record<ShapeKind, number> = { "centre-rectangle": 2, "three-rectangle": 3, "three-circle": 3, polygon: 2, "outside-polygon": 2, slot: 3, "overall-slot": 3, point: 1 };

export const SHAPE_KINDS = Object.keys(SHAPE_CLICKS) as ShapeKind[];

export const isShapeKind = (kind: string): kind is ShapeKind => Object.hasOwn(SHAPE_CLICKS, kind);
export const isShapeTool = (tool: { kind: string }): tool is ShapeTool => isShapeKind(tool.kind);

/** Fusion's first polygon: a hexagon (a nut trap). */
export const DEFAULT_SIDES = 6;
/** The most sides a polygon may have: past this it is a circle to the eye, and a circle is the better curve for it. */
export const MAX_SIDES = 100;

/** A shape tool of this kind on a sketch, nothing clicked yet. */
export function startShape(kind: ShapeKind, sketch: string): ShapeTool {
  return kind === "polygon" || kind === "outside-polygon" ? { kind, sketch, clicks: [], sides: DEFAULT_SIDES } : { kind, sketch, clicks: [] };
}

/** The modeller's smallest piece (centre-arc.ts MIN_CHORD, sketch-tool.ts MIN_SIZE): no side, slot edge or radius shorter. */
const MIN = MIN_CHORD;

/**
 * Whether a length measured between points no further than `scale` from
 * the origin is under MIN, with a line's allowance for its ends' rounding
 * (4εM, sketch-tool.ts `underMin`): a decimal side of exactly 0.001 mm
 * can come out a rounding short.
 */
const short = (length: number, scale: number): boolean => length < MIN - 4 * Number.EPSILON * Math.max(scale, length);

/** The largest coordinate size among points. */
const sizeOf = (...ps: readonly SketchXY[]): number => Math.max(0, ...ps.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));

/** √(dx² + dy²), not Math.hypot (sketch-tool.ts `distance` says why). */
const apart = (a: SketchXY, b: SketchXY): number => Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);

const same = (a: SketchXY, b: SketchXY): boolean => a[0] === b[0] && a[1] === b[1];

export const SAME_CLICK = "Click away from the last point: the shape needs a size there.";
export const FLAT_CENTRE_RECTANGLE = "A rectangle needs a width and a height: click its corner off the centre's row and column.";
export const SMALL_CENTRE_RECTANGLE = `A rectangle must be at least ${MIN} mm wide and high, the smallest piece the modeller keeps: click its corner further from the centre.`;
export const SHORT_FIRST_SIDE = `A rectangle's side must be at least ${MIN} mm long, the smallest piece the modeller keeps: click its second corner further away.`;
export const NO_HEIGHT = "A rectangle needs a height: click off the line through its first side.";
export const SMALL_HEIGHT = `A rectangle must be at least ${MIN} mm high, the smallest piece the modeller keeps: click further from its first side.`;
export const IN_LINE = "A circle can't pass through three points on one line: click the third point off the line through the first two.";
export const SMALL_THREE_CIRCLE = `A circle's radius must be at least ${MIN} mm, the smallest piece the modeller keeps: click the points further apart.`;
export const SMALL_POLYGON = `A polygon's sides must be at least ${MIN} mm long, the smallest piece the modeller keeps: click further from its centre.`;
export const SHORT_SLOT = `A slot's centres must be at least ${MIN} mm apart, the smallest piece the modeller keeps: click the second further away.`;
export const SHORT_OVERALL_SLOT = `A slot's ends must be more than its width apart, with at least ${MIN} mm between its centres: click nearer the line through its ends, or make it longer.`;
export const NO_WIDTH = "A slot needs a width: click off the line through its centres.";
export const SMALL_SLOT = `A slot must be at least ${2 * MIN} mm wide (a radius of ${MIN} mm, the smallest piece the modeller keeps): click further from the line through its centres.`;
export const POINT_THERE = "There is a point here already.";
export const SAME_SHAPE = "This shape is there already: a second one on top of it would break the outline.";
export const TOO_CLOSE = "Two points of this shape would land on one point of the sketch: draw it bigger, or away from that point.";
export const SIDES_WORDS = `A polygon has 3 to ${MAX_SIDES} sides: type a whole number.`;

/**
 * A shape to draw: points by index, the curves between them (lines, a
 * construction line dashed and left out of the outline, arcs
 * counter-clockwise from start to end round centre, circles round a point),
 * and the pairs of points to keep level or upright where they are exactly
 * so as drawn (`levelled`).
 */
export interface ShapePlan {
  points: SketchXY[];
  curves: ({ kind: "line"; a: number; b: number; construction?: true } | { kind: "arc"; start: number; end: number; centre: number } | { kind: "circle"; centre: number; radius: number })[];
  level: [number, number][];
}

/** A closed chain of lines through the points in order, each side's ends a pair to keep level or upright. */
function loop(points: SketchXY[], extra: ShapePlan["curves"] = []): ShapePlan {
  const n = points.length;
  const sides = points.map((_, i) => [i, (i + 1) % n] as [number, number]);
  return { points, curves: [...sides.map(([a, b]) => ({ kind: "line" as const, a, b })), ...extra], level: sides };
}

/**
 * The rectangle with centre `c` and a corner at `p`: corners c ± (dx, dy),
 * d = p − c, in the order p, then round counter-clockwise or clockwise as
 * it falls (the four lines are a closed chain either way), with its two
 * diagonals as construction lines, as Fusion draws it. Each corner's
 * coordinates are c ± d worked once, so opposite corners share x or y
 * exactly and every side is exactly level or upright.
 */
function centreRectangle(c: SketchXY, p: SketchXY): ShapePlan | { note: string } {
  const [dx, dy] = [p[0] - c[0], p[1] - c[1]];
  if (dx === 0 || dy === 0) return { note: FLAT_CENTRE_RECTANGLE };
  const far: SketchXY = [c[0] - dx, c[1] - dy];
  const scale = sizeOf(c, p, far);
  if (short(Math.abs(p[0] - far[0]), scale) || short(Math.abs(p[1] - far[1]), scale)) return { note: SMALL_CENTRE_RECTANGLE };
  const corners: SketchXY[] = [p, [far[0], p[1]], far, [p[0], far[1]]];
  return loop(corners, [
    { kind: "line", a: 0, b: 2, construction: true },
    { kind: "line", a: 1, b: 3, construction: true },
  ]);
}

/**
 * The unit normal to a → b turned a quarter left, n = (−uy, ux) with
 * u = (b − a)/|b − a|, and the signed distance of `p` from the line through
 * a along n, h = (p − a)·n. A side along x or y has u exactly (±1, 0) or
 * (0, ±1) (√(dx²) is |dx| in floating point), so n is exact too and a
 * level first side gives exactly upright others.
 */
function across(a: SketchXY, b: SketchXY, p: SketchXY): { n: SketchXY; h: number } {
  const L = apart(a, b);
  const u: SketchXY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: SketchXY = [-u[1], u[0]];
  return { n, h: (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] };
}

/** a + n·h, with a zero component of n adding exactly nothing. */
const offset = (a: SketchXY, n: SketchXY, h: number): SketchXY => [a[0] + n[0] * h, a[1] + n[1] * h];

/**
 * The rectangle with a first side from `a` to `b` and its opposite side
 * through the foot of `p` (Fusion's 3-point rectangle): corners a, b,
 * b + n·h, a + n·h (`across`). Exactly level and upright sides when the
 * first side is along x or y.
 */
function threeRectangle(a: SketchXY, b: SketchXY, p: SketchXY): ShapePlan | { note: string } {
  const scale = sizeOf(a, b, p);
  if (short(apart(a, b), scale)) return { note: SHORT_FIRST_SIDE };
  const { n, h } = across(a, b, p);
  if (h === 0) return { note: NO_HEIGHT };
  if (short(Math.abs(h), scale)) return { note: SMALL_HEIGHT };
  return loop([a, b, offset(b, n, h), offset(a, n, h)]);
}

/** The circle through three points: its centre where the 3-point arc puts one (sketch-tool.ts `arcThrough`), its radius to the first point. */
function threeCircle(a: SketchXY, b: SketchXY, p: SketchXY): ShapePlan | { note: string } {
  if (same(a, b) || same(b, p) || same(a, p)) return { note: SAME_CLICK };
  const arc: SketchArc | null = arcThrough(a, b, p);
  if (!arc) return { note: IN_LINE };
  const r = apart(arc.centre, a);
  if (r < MIN) return { note: SMALL_THREE_CIRCLE };
  return { points: [arc.centre], curves: [{ kind: "circle", centre: 0, radius: r }], level: [] };
}

/**
 * A regular polygon of `sides` round centre `c`. Inscribed (`outside`
 * false), `p` is a corner: corner k is c + R(360k/n)(p − c). Circumscribed,
 * `p` is the middle of a side (the circle touches the sides there): corner
 * k is c + R(−180/n + 360k/n)(p − c)/cos(180/n), so the first side runs
 * from corner 0 to corner 1 with its middle at p. R(θ) turns by the cosine
 * and sine of `direction`, exact at the quarter turns. Corners worked out
 * with cos and sin land a rounding off the row or column of the corner
 * next to them where the side is meant level or upright (a hexagon's flat
 * side: sin 60° and sin 120° differ in the last place), so a side within
 * 8εM of level or upright is made exactly so, moving its second corner by
 * under 1e-9 mm at the largest size, far under the kernel's 10 nm, and
 * gets Horizontal or Vertical (`levelled`).
 */
function polygon(c: SketchXY, p: SketchXY, sides: number, outside: boolean): ShapePlan | { note: string } {
  const n = Math.trunc(sides);
  if (!(n >= 3 && n <= MAX_SIDES)) return { note: SIDES_WORDS };
  const v: SketchXY = [p[0] - c[0], p[1] - c[1]];
  const half = 180 / n;
  const stretch = outside ? 1 / direction(half)[0] : 1;
  const corners: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const [cos, sin] = direction((outside ? -half : 0) + (360 * k) / n);
    corners.push([c[0] + (v[0] * cos - v[1] * sin) * stretch, c[1] + (v[0] * sin + v[1] * cos) * stretch]);
  }
  const scale = sizeOf(c, p, ...corners);
  const tidy = 8 * Number.EPSILON * scale;
  for (let k = 0; k < n; k++) {
    const [a, b] = [corners[k], corners[(k + 1) % n]];
    // The last side's second corner is the first, which stays: its first corner moves instead.
    const [keep, move] = k === n - 1 ? [b, a] : [a, b];
    if (Math.abs(move[1] - keep[1]) <= tidy && move[1] !== keep[1]) move[1] = keep[1];
    else if (Math.abs(move[0] - keep[0]) <= tidy && move[0] !== keep[0]) move[0] = keep[0];
  }
  for (let k = 0; k < n; k++) if (short(apart(corners[k], corners[(k + 1) % n]), scale)) return { note: SMALL_POLYGON };
  return loop(corners);
}

/**
 * The slot round centres `c1` and `c2` with radius `r`: its straight sides
 * a1 → a2 and b1 → b2 at c ± n·r (`across`'s n, left of c1 → c2), and a
 * half circle round each centre, counter-clockwise from a1 to b1 round c1
 * (the far end from c2) and from b2 to a2 round c2, with the centre line
 * c1 → c2 as a construction line, as Fusion draws it. Points 0–5 are a1,
 * b1, c1, a2, b2, c2. Kept level or upright where so (`levelled`): the two
 * sides, and each end's two points with its centre. With the centres on a
 * row (or column) that is all eight a slot needs: each side level, each
 * end's radius upright (so the side leaves its arc tangent), each arc's
 * ends equally far from its centre (the arc itself) put the centre midway,
 * and both radii follow from the sides: four free, its place, length and
 * width.
 */
function slotFrom(c1: SketchXY, c2: SketchXY, n: SketchXY, r: number): ShapePlan {
  const points: SketchXY[] = [offset(c1, n, r), offset(c1, n, -r), c1, offset(c2, n, r), offset(c2, n, -r), c2];
  return {
    points,
    curves: [
      { kind: "line", a: 0, b: 3 },
      { kind: "arc", start: 0, end: 1, centre: 2 },
      { kind: "line", a: 1, b: 4 },
      { kind: "arc", start: 4, end: 3, centre: 5 },
      { kind: "line", a: 2, b: 5, construction: true },
    ],
    level: [
      [0, 3],
      [1, 4],
      [0, 2],
      [2, 1],
      [3, 5],
      [5, 4],
    ],
  };
}

/** A centre-to-centre slot: centres `c1` and `c2`, its half width the distance of `p` from the line through them. */
function slot(c1: SketchXY, c2: SketchXY, p: SketchXY): ShapePlan | { note: string } {
  const scale = sizeOf(c1, c2, p);
  if (short(apart(c1, c2), scale)) return { note: SHORT_SLOT };
  const { n, h } = across(c1, c2, p);
  if (h === 0) return { note: NO_WIDTH };
  const r = Math.abs(h);
  if (r < MIN) return { note: SMALL_SLOT };
  return slotFrom(c1, c2, n, r);
}

/** An overall slot: its ends `e1` and `e2` (the far points of its arcs), its half width r the distance of `p` from the line through them, its centres r in from the ends. */
function overallSlot(e1: SketchXY, e2: SketchXY, p: SketchXY): ShapePlan | { note: string } {
  const scale = sizeOf(e1, e2, p);
  const L = apart(e1, e2);
  if (short(L, scale)) return { note: SHORT_OVERALL_SLOT };
  const { n, h } = across(e1, e2, p);
  if (h === 0) return { note: NO_WIDTH };
  const r = Math.abs(h);
  if (r < MIN) return { note: SMALL_SLOT };
  if (short(L - 2 * r, scale)) return { note: SHORT_OVERALL_SLOT };
  // u along e1 → e2 is n turned a quarter right: (ny, −nx).
  const u: SketchXY = [n[1], -n[0]];
  return slotFrom(offset(e1, u, r), offset(e2, u, -r), n, r);
}

/** What the clicks make: the plan, or why they make nothing. `clicks` must be the kind's full count (SHAPE_CLICKS). */
export function shapePlan(kind: ShapeKind, clicks: readonly SketchXY[], sides = DEFAULT_SIDES): ShapePlan | { note: string } {
  if (clicks.length !== SHAPE_CLICKS[kind]) throw new Error(`a ${kind} takes ${SHAPE_CLICKS[kind]} clicks, not ${clicks.length}`);
  const [a, b, p] = clicks;
  if (kind !== "point" && kind !== "three-circle" && clicks.some((q, i) => i > 0 && same(q, clicks[i - 1]))) return { note: SAME_CLICK };
  switch (kind) {
    case "centre-rectangle":
      return centreRectangle(a, b);
    case "three-rectangle":
      return threeRectangle(a, b, p);
    case "three-circle":
      return threeCircle(a, b, p);
    case "polygon":
    case "outside-polygon":
      return polygon(a, b, sides, kind === "outside-polygon");
    case "slot":
      return slot(a, b, p);
    case "overall-slot":
      return overallSlot(a, b, p);
    case "point":
      return { points: [a], curves: [], level: [] };
  }
}

/**
 * The document with Horizontal on each pair of points exactly level
 * (same y) and Vertical on each exactly upright (same x), as the rectangle
 * tool gives its sides (constraints.ts `squaredRectangle`): only where it
 * holds exactly as drawn, so the sketch stays solved with no solve and
 * nothing can fight. A pair of points that both follow a body (#517: one is fine), or
 * already so by a constraint of its own, gets none. Ids from the counter.
 */
export function levelled(doc: DesignDocument, sketchId: string, pairs: readonly (readonly [string, string])[]): DesignDocument {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId} in the design`);
  const at = new Map(sketch.points.map((p) => [p.id, p]));
  const follows = followingPoints(sketch);
  let nextId = doc.nextId;
  const added: SketchConstraint[] = [];
  for (const [a, b] of pairs) {
    const [p, q] = [at.get(a), at.get(b)];
    if (!p || !q || a === b || (follows.has(a) && follows.has(b))) continue;
    const kind = p.y === q.y ? "horizontal" : p.x === q.x ? "vertical" : null;
    if (kind === null) continue;
    const holds = (c: SketchConstraint) => c.kind === kind && ((c.a === a && c.b === b) || (c.a === b && c.b === a));
    if ([...sketch.constraints, ...added].some(holds)) continue;
    added.push({ id: `constraint-${nextId}`, kind, a, b });
    nextId = counted(nextId + 1);
  }
  if (added.length === 0) return doc;
  return { ...doc, nextId, sketches: doc.sketches.map((s) => (s === sketch ? { ...s, constraints: [...s.constraints, ...added] } : s)) };
}

const sketchOf = (doc: DesignDocument, id: string): Sketch => {
  const s = doc.sketches.find((x) => x.id === id);
  if (!s) throw new Error(`there is no sketch ${id} in the design`);
  return s;
};

/**
 * The plan drawn into the sketch, one edit: each point a point already
 * there where it lands on one (exactly for an arc's points, which must stay
 * as far from their centre as worked out; within SAME_PLACE for the rest,
 * the line tool's `pointNear`), else a new one, shared by every curve of
 * the shape through it; a line or arc on top of one already there between
 * the same points is that one (the rectangle tool's rule), a construction
 * line only on a construction line; then `levelled`. The document itself
 * when nothing is new (the same shape twice), null when two of the
 * shape's points would be one point of the sketch (a shape that small is
 * refused before).
 */
export function drawPlan(doc: DesignDocument, sketchId: string, plan: ShapePlan): DesignDocument | null {
  const onArc = new Set(plan.curves.flatMap((c) => (c.kind === "arc" ? [c.start, c.end, c.centre] : [])));
  const ids: (string | null)[] = plan.points.map(() => null);
  let next = doc;
  const end = (i: number): LineEnd => {
    const s = sketchOf(next, sketchId);
    return ids[i] ?? (onArc.has(i) ? pointAt(s, plan.points[i]) : pointNear(s, plan.points[i])) ?? plan.points[i];
  };
  const projected = (s: Sketch, id: string) => (s.projected ?? []).some((p) => p.made === id);
  const turned: string[] = [];
  for (const c of plan.curves) {
    const s = sketchOf(next, sketchId);
    if (c.kind === "circle") {
      const centre = end(c.centre);
      if (typeof centre === "string" && s.curves.some((x) => x.kind === "circle" && x.centre === centre && Math.abs(x.radius - c.radius) <= SAME_PLACE)) continue;
      const drawn = drawCircle(next, sketchId, centre, c.radius);
      next = drawn.doc;
      const made = sketchOf(next, sketchId).curves.find((x) => x.id === drawn.id);
      if (made?.kind === "circle") ids[c.centre] = made.centre;
      continue;
    }
    if (c.kind === "line") {
      const [a, b] = [end(c.a), end(c.b)];
      if (typeof a === "string" && a === b) return null;
      const there = typeof a === "string" && typeof b === "string" ? s.curves.find((x): x is SketchLineCurve => x.kind === "line" && !projected(s, x.id) && (x.construction === true) === (c.construction === true) && ((x.start === a && x.end === b) || (x.start === b && x.end === a))) : undefined;
      if (there) {
        [ids[c.a], ids[c.b]] = there.start === a ? [there.start, there.end] : [there.end, there.start];
        continue;
      }
      const drawn = drawLine(next, sketchId, a, b);
      next = drawn.doc;
      const made = sketchOf(next, sketchId).curves.find((x) => x.id === drawn.id) as SketchLineCurve;
      [ids[c.a], ids[c.b]] = [made.start, made.end];
      if (c.construction) turned.push(made.id);
      continue;
    }
    const [st, en, ce] = [end(c.start), end(c.end), end(c.centre)];
    if ((typeof st === "string" && (st === en || st === ce)) || (typeof en === "string" && en === ce)) return null;
    if (arcThere(s, st, en, ce)) {
      const arc = s.curves.find((x) => x.kind === "arc" && x.start === st && x.end === en);
      if (arc?.kind === "arc") [ids[c.start], ids[c.end], ids[c.centre]] = [arc.start, arc.end, arc.centre];
      continue;
    }
    const drawn = drawArc(next, sketchId, st, en, ce);
    next = drawn.doc;
    const made = sketchOf(next, sketchId).curves.find((x) => x.id === drawn.id);
    if (made?.kind === "arc") [ids[c.start], ids[c.end], ids[c.centre]] = [made.start, made.end, made.centre];
  }
  if (plan.curves.length === 0) {
    // A sketch point: one place, a new point unless one is already there.
    const there = pointNear(sketchOf(next, sketchId), plan.points[0]);
    if (there !== null) return doc;
    next = drawPoint(next, sketchId, plan.points[0]).doc;
  }
  if (turned.length > 0) {
    const s = sketchOf(next, sketchId);
    const curves = s.curves.map((c): SketchCurve => (turned.includes(c.id) ? { ...c, construction: true } : c));
    next = { ...next, sketches: next.sketches.map((x) => (x.id === sketchId ? { ...s, curves } : x)) };
  }
  const pairs = plan.level.flatMap(([i, j]) => (ids[i] !== null && ids[j] !== null ? [[ids[i]!, ids[j]!] as const] : []));
  return levelled(next, sketchId, pairs);
}

/**
 * A shape tool's click at `at` (snapped): kept until the tool has all its
 * clicks, then the shape drawn (`drawPlan`), one undo step, and the tool
 * starts again (a polygon keeping its sides). A click on the last one, or
 * clicks that make nothing (`shapePlan`'s refusals), draw nothing and say
 * why; the clicks before stay.
 */
export function shapeClick(doc: DesignDocument, tool: ShapeTool, at: SketchXY): { doc: DesignDocument; tool: ShapeTool; drew: boolean; note?: string } {
  sketchOf(doc, tool.sketch);
  const clicks = [...tool.clicks, [at[0], at[1]] as SketchXY];
  const last = tool.clicks.at(-1);
  if (last && same(last, at)) return { doc, tool, drew: false, note: SAME_CLICK };
  if (clicks.length < SHAPE_CLICKS[tool.kind]) return { doc, tool: { ...tool, clicks }, drew: false };
  const plan = shapePlan(tool.kind, clicks, tool.sides);
  if ("note" in plan) return { doc, tool, drew: false, note: plan.note };
  const drawn = drawPlan(doc, tool.sketch, plan);
  const done: ShapeTool = { ...tool, clicks: [] };
  if (drawn === null) return { doc, tool, drew: false, note: TOO_CLOSE };
  // Drawn already: nothing placed, so the clicks before stay, as for any refusal (and the typed boxes with them, hunt 2026-11-12).
  if (drawn === doc) return { doc, tool, drew: false, note: tool.kind === "point" ? POINT_THERE : SAME_SHAPE };
  return { doc: drawn, tool: done, drew: true };
}

/** A plan as the viewport draws it: lines (construction ones too), arcs and circles as segments (sketch-tool.ts). */
export function planSegments(plan: ShapePlan): (readonly [SketchXY, SketchXY])[] {
  const at = plan.points;
  return plan.curves.flatMap((c) => {
    if (c.kind === "line") return [[at[c.a], at[c.b]] as const];
    if (c.kind === "circle") return circleSegments(at[c.centre], c.radius);
    const xy = (i: number): [number, number] => [at[i][0], at[i][1]];
    return arcSegments({ start: xy(c.start), end: xy(c.end), centre: xy(c.centre) });
  });
}

/**
 * What a click at `pointer` would draw: the whole shape once that click is
 * its last, else the line from the first click (a 3-point rectangle's first
 * side, a slot's centre line); nothing where the click would draw nothing.
 */
export function shapePreview(tool: ShapeTool, pointer: SketchXY): (readonly [SketchXY, SketchXY])[] {
  const clicks = [...tool.clicks, pointer];
  if (clicks.length < SHAPE_CLICKS[tool.kind]) return clicks.length === 2 && !same(clicks[0], clicks[1]) ? [[clicks[0], clicks[1]]] : [];
  if (tool.kind === "point") return [];
  const plan = shapePlan(tool.kind, clicks, tool.sides);
  if ("note" in plan) return clicks.length === 3 && !same(clicks[0], clicks[1]) ? [[clicks[0], clicks[1]]] : [];
  return planSegments(plan);
}

/** The shape's name in words, for the hints and the unfinished-shape note. */
export const SHAPE_NAMES: Record<ShapeKind, string> = { "centre-rectangle": "rectangle", "three-rectangle": "rectangle", "three-circle": "circle", polygon: "polygon", "outside-polygon": "polygon", slot: "slot", "overall-slot": "slot", point: "point" };

/** What the shape tool's next click places, in a few words (pointer-hint.ts). */
export function shapeHint(tool: ShapeTool): string {
  const k = tool.clicks.length;
  switch (tool.kind) {
    case "centre-rectangle":
      return k === 0 ? "Place centre point" : "Place corner";
    case "three-rectangle":
      return k === 0 ? "Place first corner" : k === 1 ? "Place second corner" : "Place third corner";
    case "three-circle":
      return k === 0 ? "Place first point" : k === 1 ? "Place second point" : "Place third point";
    case "polygon":
      return k === 0 ? "Place centre point" : "Place corner";
    case "outside-polygon":
      return k === 0 ? "Place centre point" : "Place middle of a side";
    case "slot":
      return k === 0 ? "Place first centre" : k === 1 ? "Place second centre" : "Place point on the slot's side";
    case "overall-slot":
      return k === 0 ? "Place first end" : k === 1 ? "Place second end" : "Place point on the slot's side";
    case "point":
      return "Place point";
  }
}

/** The rest of the clicks a half drawn shape needs, in words (sketch-tool.ts `unfinishedWords`): "its corner", "its second and third corners". */
export function shapeStillNeeds(tool: ShapeTool): string {
  const one = tool.clicks.length >= SHAPE_CLICKS[tool.kind] - 1;
  switch (tool.kind) {
    case "centre-rectangle":
      return "its corner";
    case "three-rectangle":
      return one ? "its third corner" : "its second and third corners";
    case "three-circle":
      return one ? "its third point" : "its second and third points";
    case "polygon":
      return "a corner";
    case "outside-polygon":
      return "the middle of a side";
    case "slot":
      return one ? "a point on its side" : "its second centre, then a point on its side";
    case "overall-slot":
      return one ? "a point on its side" : "its second end, then a point on its side";
    case "point":
      return "where it goes";
  }
}

/** The typed-size boxes a shape tool shows now (typed-entry.ts): a centre rectangle's width and height; a 3-point rectangle's first side by length and angle, then its height; a polygon's sides, diameter and angle; a slot's second centre or end by length and angle, then its width. */
export function shapeFields(tool: ShapeTool): TypedField[] {
  const k = tool.clicks.length;
  if (k === 0) return [];
  switch (tool.kind) {
    case "centre-rectangle":
      return ["width", "height"];
    case "three-rectangle":
      return k === 1 ? ["length", "angle"] : ["height"];
    case "polygon":
    case "outside-polygon":
      return ["sides", "diameter", "angle"];
    case "slot":
    case "overall-slot":
      return k === 1 ? ["length", "angle"] : ["width"];
    default:
      return [];
  }
}

/** What a shape tool's boxes measure from: its last click (a centre, the first corner, the second corner, a slot's second centre), or null with no boxes. */
export function shapeAnchor(tool: ShapeTool): SketchXY | null {
  return shapeFields(tool).length > 0 ? (tool.clicks.at(-1) ?? null) : null;
}

/** The side of `from` the pointer is on along one axis: +1 ahead or level, −1 behind (typed-entry.ts `rectangleCorner`'s rule). */
const sideOf = (from: number, to: number | undefined): 1 | -1 => (to === undefined || to >= from ? 1 : -1);

/**
 * Where the shape tool places its next point with these locks and the
 * pointer at `p` (null: no answer). A centre rectangle's width W puts the
 * corner W/2 from the centre on the pointer's side, its height the same
 * along y; a polygon's diameter D its corner (or side's middle) D/2 from
 * the centre, the pointer's way or along a typed angle; a length and angle
 * the second click as a line's end; a 3-point rectangle's height H the
 * third click H from the first side, on the pointer's side (left of the
 * side with no pointer), and a slot's width W the third click W/2 from the
 * centre line the same way.
 */
export function shapeAim(tool: ShapeTool, p: SketchXY | null, locks: Locks): SketchXY | null {
  const anchor = shapeAnchor(tool);
  if (!anchor) return p;
  const fields = shapeFields(tool);
  if (tool.kind === "centre-rectangle") {
    const W = locks.width, H = locks.height;
    if (!p && (W === undefined || H === undefined)) return null;
    const x = W === undefined ? p![0] : anchor[0] + sideOf(anchor[0], p?.[0]) * (W / 2);
    const y = H === undefined ? p![1] : anchor[1] + sideOf(anchor[1], p?.[1]) * (H / 2);
    return [x, y];
  }
  if (fields.includes("diameter")) {
    const radius = locks.diameter === undefined ? undefined : locks.diameter / 2;
    // A typed diameter with the pointer still on the centre (a tap) goes along +x, as the circle tool's does.
    return lineEnd(anchor, p, { length: radius, angle: locks.angle }) ?? (radius === undefined ? null : lineEnd(anchor, null, { length: radius, angle: locks.angle ?? 0 }));
  }
  if (fields.includes("length")) return lineEnd(anchor, p, locks);
  const size = fields.includes("height") ? locks.height : locks.width === undefined ? undefined : locks.width / 2;
  if (size === undefined) return p;
  const [a, b] = [tool.clicks[0], tool.clicks[1]];
  if (apart(a, b) === 0) return p;
  const { n, h } = across(a, b, p ?? b);
  return offset(b, n, (h < 0 ? -1 : 1) * size);
}

/** The tool a click with these locks goes to: a polygon with a typed number of sides takes it (kept for the next polygon); any other tool is itself. */
export function shapeWithLocks(tool: ShapeTool, locks: Locks): ShapeTool {
  // The same tool when the sides typed are its own already: the workspace tells a placed click by a new tool (hunt 2026-11-12).
  return locks.sides !== undefined && locks.sides !== tool.sides && (tool.kind === "polygon" || tool.kind === "outside-polygon") ? { ...tool, sides: locks.sides } : tool;
}

/** What each box shows while not typed in: the size the aim would draw (twice the centre's distance for a centre rectangle's width and height and a slot's width, the polygon's sides as they stand). */
export function shapeLive(tool: ShapeTool, anchor: SketchXY, aim: SketchXY): Locks {
  const fields = shapeFields(tool);
  if (tool.kind === "centre-rectangle") return { width: 2 * Math.abs(aim[0] - anchor[0]), height: 2 * Math.abs(aim[1] - anchor[1]) };
  const degrees = angleOf(anchor, aim);
  if (fields.includes("diameter")) return { sides: tool.sides ?? DEFAULT_SIDES, diameter: 2 * apart(anchor, aim), angle: degrees };
  if (fields.includes("length")) return { length: apart(anchor, aim), angle: degrees };
  const [a, b] = [tool.clicks[0], tool.clicks[1]];
  if (apart(a, b) === 0) return {};
  const h = Math.abs(across(a, b, aim).h);
  return fields.includes("height") ? { height: h } : { width: 2 * h };
}

/** The clicks a shape tool has made that are not yet points of the sketch (drawn as points meanwhile, and never snapped onto: snap.ts). */
export const shapeClicks = (tool: ShapeTool): SketchXY[] => [...tool.clicks];
