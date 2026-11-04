// Dragging a sketch point with the solver (step 47d3), as in Fusion: with
// the Select tool, a press on a point and a drag moves it, and the rest of
// the sketch follows its constraints. Each step of the drag moves the
// point to where the pointer is and asks the kernel's sketch solver with
// that point held (constraints.ts `solverRequest`), so the point stays
// under the pointer whenever the constraints let it, and slides along
// what they allow when they don't (a point vertical to a fixed one goes
// up and down only).
//
// The contract (cases in test/point-drag.test.ts):
// - What can't be dragged: a point that follows a body (pinned to an edge,
//   26f, or projected, 27d: the body says where it is), and a point fixed
//   by a Fix constraint or coincident, through any chain of coincident
//   constraints, with one (the solver would keep it still). Each is
//   refused with the reason and nothing moves.
// - Big jumps go in small steps (borrowed idea BS3): from where the point
//   last solved to the pointer in steps of at most DRAG_STEP_PIXELS on
//   screen, at most MAX_DRAG_STEPS of them (a longer jump takes longer
//   steps), each solved from the last one's answer, so Newton (arcs)
//   always starts near its answer and follows the branch it is on.
// - After each solve, no triangle turned over (BS3's own addition): the
//   triangles whose turning is a jump the user didn't ask for are each
//   arc's centre, start and end (its centre on the other side of its chord
//   is the arc sweeping the other way round); a step that turns one over,
//   against the step before or against where the drag began (so a step
//   landing exactly flat can't carry it across: 47d4 review), is refused. (Three points the drag itself carries across each other,
//   like a rectangle's corner pulled past the opposite corner, turn over
//   because the user moved them, as in Fusion, so other triangles are free.)
// - A step that the solver refuses, that conflicts, that turns an arc
//   over or that would shrink a line or arc below MIN_FEATURE is refused:
//   the sketch stays where the last step left it, and the drag goes on
//   from there when the pointer moves again.
// - The newest pointer wins: the workspace starts the next target's steps
//   from the last solved answer and drops what is left of the old ones;
//   one drag is one undo step ("Move point").

import type { KernelCalls } from "@fission/core";
import type { DesignDocument, Sketch } from "./document.ts";
import { followingPoints, MIN_FEATURE, readAnswer, shrunk, solverRequest } from "./constraints.ts";
import { movePoint, PROJECTED_POINT } from "./sketch.ts";
import { madePoints } from "./projection.ts";

type XY = readonly [number, number];

/** The furthest one solve moves the dragged point, in screen pixels. */
export const DRAG_STEP_PIXELS = 8;

/** The most solves one pointer move is split into: a longer jump takes longer steps. */
export const MAX_DRAG_STEPS = 32;

/** Why a pinned point can't be dragged. */
export const PINNED_POINT = "This point is pinned to a body's edge and follows it: it can't be dragged.";

/** Why a fixed point can't be dragged. */
export const FIXED_POINT = "This point is fixed: take its Fix constraint off to drag it.";

/** Why a step was refused because an arc would turn over. */
export const ARC_TURNED = "An arc would turn inside out there, so the point stays where it last was.";

/**
 * The points a drag passes on its way from `from` to `to`, `pixel` mm a
 * screen pixel: the fewest equal steps of at most DRAG_STEP_PIXELS each
 * (at most MAX_DRAG_STEPS), the last exactly `to`. Empty when `to` is
 * `from`. A pixel that isn't a positive number takes one step.
 */
export function dragSteps(from: XY, to: XY, pixel: number | undefined): [number, number][] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const reach = pixel !== undefined && pixel > 0 ? DRAG_STEP_PIXELS * pixel : Infinity; // NaN, 0 or below: one step
  const n = Math.min(MAX_DRAG_STEPS, Math.max(1, Math.ceil(length / reach)));
  const steps: [number, number][] = [];
  for (let k = 1; k < n; k++) steps.push([from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n]);
  steps.push([to[0], to[1]]);
  return steps;
}

/** The points a Fix constraint keeps still: each fixed one and every point coincident with it, through any chain. */
export function fixedPoints(sketch: Sketch): Set<string> {
  const parent = new Map<string, string>();
  const root = (p: string): string => {
    let r = p;
    while (parent.has(r)) r = parent.get(r)!;
    return r;
  };
  for (const c of sketch.constraints) {
    if (c.kind !== "coincident") continue;
    const [a, b] = [root(c.a), root(c.b)];
    if (a !== b) parent.set(a, b);
  }
  const fixedRoots = new Set(sketch.constraints.flatMap((c) => (c.kind === "fix" ? [root(c.point)] : [])));
  return new Set(sketch.points.map((p) => p.id).filter((p) => fixedRoots.has(root(p))));
}

/** Why point `pointId` of the sketch can't be dragged, or null when it can. */
export function grabProblem(sketch: Sketch, pointId: string): string | null {
  if (!sketch.points.some((p) => p.id === pointId)) return `The sketch has no point ${pointId}.`;
  if ((sketch.projected ?? []).some((p) => madePoints(sketch, p).includes(pointId))) return PROJECTED_POINT;
  if (followingPoints(sketch).has(pointId)) return PINNED_POINT;
  if (fixedPoints(sketch).has(pointId)) return FIXED_POINT;
  return null;
}

/** Twice the signed area of the triangle a, b, c: positive anticlockwise. */
export const turn = (a: XY, b: XY, c: XY): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * The first arc whose triangle (centre, start, end) turned over between
 * the points `before` and `after` (its signed area changed from one sign
 * to the other; one that was or is now flat is not turned over), by id,
 * or null.
 */
export function turnedOver(sketch: Sketch, before: ReadonlyMap<string, XY>, after: ReadonlyMap<string, XY>): string | null {
  for (const c of sketch.curves) {
    if (c.kind !== "arc") continue;
    const was = turn(before.get(c.centre)!, before.get(c.start)!, before.get(c.end)!);
    const now = turn(after.get(c.centre)!, after.get(c.start)!, after.get(c.end)!);
    if ((was > 0 && now < 0) || (was < 0 && now > 0)) return c.id;
  }
  return null;
}

/** One step of a drag: the document with the point there and the sketch solved, or why the step was refused. */
export type DragStep = { doc: DesignDocument } | { refused: string };

const pointsOf = (sketch: Sketch): Map<string, XY> => new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as const]));

/**
 * One step of dragging point `pointId` of sketch `sketchId` to `to`: the
 * point moved there and the sketch solved with it held (see the top
 * comment for what is refused). The caller has checked grabProblem.
 */
export async function dragStep(kernel: KernelCalls, doc: DesignDocument, sketchId: string, pointId: string, to: XY, origin: DesignDocument = doc): Promise<DragStep> {
  const moved = movePoint(doc, sketchId, pointId, to[0], to[1]).sketches.find((s) => s.id === sketchId)!; // throws for a sketch or point not there
  const sketch = doc.sketches.find((s) => s.id === sketchId)!;
  const request = solverRequest(moved, [pointId]);
  const answer = readAnswer(await kernel.call("solve_sketch", request.text));
  if (answer.result === "refused") return { refused: `The sketch can't be solved there: ${answer.message}.` };
  if (answer.result === "conflict") return { refused: "The sketch's constraints can't all hold there, so the point stays where it last was." };
  const solved = new Map(request.points.map((p, i) => [p, answer.points[i]] as const));
  const tiny = shrunk(moved, solved);
  if (tiny !== null) return { refused: `That would shrink ${tiny} below ${MIN_FEATURE} mm, so the point stays where it last was.` };
  const began = origin.sketches.find((s) => s.id === sketchId);
  if (turnedOver(sketch, pointsOf(sketch), solved) !== null || (began && turnedOver(sketch, pointsOf(began), solved) !== null)) return { refused: ARC_TURNED };
  const points = sketch.points.map((p) => {
    const [x, y] = solved.get(p.id)!;
    return x === p.x && y === p.y ? p : { ...p, x, y };
  });
  return { doc: { ...doc, sketches: doc.sketches.map((s) => (s.id === sketchId ? { ...sketch, points } : s)) } };
}

/** Where point `pointId` of sketch `sketchId` is in `doc`. */
export function pointOf(doc: DesignDocument, sketchId: string, pointId: string): [number, number] {
  const p = doc.sketches.find((s) => s.id === sketchId)?.points.find((q) => q.id === pointId);
  if (!p) throw new Error(`sketch ${sketchId} has no point ${pointId}`);
  return [p.x, p.y];
}

/**
 * Drags point `pointId` from where it is in `doc` to `to` (`pixel` mm a
 * screen pixel), step by step (dragSteps): each step's answer to `shown`
 * as it comes, stopping at the first refused step, or as soon as `newer()`
 * says a newer target came (the rest of these steps are dropped); no arc
 * turned over against `origin`, where the drag began, either. Gives
 * the last solved document (`doc` itself when no step solved) and the
 * refusal, if one stopped it.
 */
export async function dragTo(kernel: KernelCalls, doc: DesignDocument, sketchId: string, pointId: string, to: XY, pixel: number | undefined, newer: () => boolean = () => false, shown: (doc: DesignDocument) => void = () => {}, origin: DesignDocument = doc): Promise<{ doc: DesignDocument; refused: string | null }> {
  let at = doc;
  for (const step of dragSteps(pointOf(doc, sketchId, pointId), to, pixel)) {
    if (newer()) break;
    const got = await dragStep(kernel, at, sketchId, pointId, step, origin);
    if ("refused" in got) return { doc: at, refused: got.refused };
    at = got.doc;
    shown(at);
  }
  return { doc: at, refused: null };
}
