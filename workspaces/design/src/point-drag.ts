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
// - After each solve, no arc turned inside out (BS3's own addition): an
//   arc's counter-clockwise sweep from its start to its end (`sweepOf`, in
//   [0, 2π)) changes smoothly while its points move, through a half turn
//   too (a quarter arc dragged round to three quarters is an ordinary
//   bigger arc, SL #612). It turns inside out only when its end passes its
//   start, where the sweep wraps through 0 (or 2π) to the other end of the
//   range, or when the solver jumps to the arc's other branch (its centre
//   mirrored across its chord), a jump the user didn't ask for: a step
//   whose sweep changes by more than MAX_SWEEP_STEP from the step before
//   is refused. (Three points the drag itself carries across each other,
//   like a rectangle's corner pulled past the opposite corner, turn over
//   because the user moved them, as in Fusion, so other triangles are free.)
//   An arc joined smoothly to its neighbour (a slot's end, a tangent arc)
//   turns inside out too when the neighbour reverses past a zero length
//   and the smooth joint becomes a cusp, with the arc's own sweep
//   unchanged (SL #630): `cornerTurned` refuses that step as well.
// - A step that the solver refuses, that conflicts, that turns an arc
//   over or that would shrink a line or arc below MIN_FEATURE is refused:
//   the sketch stays where the last step left it, and the drag goes on
//   from there when the pointer moves again.
// - The newest pointer wins: the workspace starts the next target's steps
//   from the last solved answer and drops what is left of the old ones;
//   one drag is one undo step ("Move point").

import type { KernelCalls } from "@fission/core";
import type { DesignDocument, Sketch } from "./document.ts";
import { curveWord, followingPoints, MIN_FEATURE, readAnswer, shrunk, solvedPoints, solverRequest } from "./constraints.ts";
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
 * The counter-clockwise sweep of an arc round `centre` from `start` to
 * `end`, in radians in [0, 2π): the angle from start − centre to
 * end − centre (atan2 of their cross and dot products), a turn added when
 * that is below 0.
 */
export function sweepOf(centre: XY, start: XY, end: XY): number {
  const [ux, uy, vx, vy] = [start[0] - centre[0], start[1] - centre[1], end[0] - centre[0], end[1] - centre[1]];
  const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  return a < 0 ? a + 2 * Math.PI : a;
}

/**
 * The most an arc's sweep may change in one solve, a third of a turn (SL
 * #612). An end passing its start wraps the sweep across [0, 2π), a change
 * of nearly a whole turn; the solver jumping to the arc's other branch
 * changes it from s to 2π − s, by 2π − 2s, half a turn for a quarter arc. A
 * drag step moves its point at most DRAG_STEP_PIXELS, so an arc more than
 * a few pixels across sweeps far less than this in one step, and a quarter
 * turn (a centre moved onto its chord) is still taken.
 */
export const MAX_SWEEP_STEP = (2 * Math.PI) / 3;

/**
 * The first arc whose sweep (`sweepOf`) changed by more than MAX_SWEEP_STEP
 * between the points `before` and `after`, by id, or null: an arc turned
 * inside out (its end carried past its start) or jumped to its other
 * branch. An arc passing a half turn, or an exact half circle a rounding
 * either side of it, is not turned over.
 */
export function turnedOver(sketch: Sketch, before: ReadonlyMap<string, XY>, after: ReadonlyMap<string, XY>): string | null {
  for (const c of sketch.curves) {
    if (c.kind !== "arc") continue;
    const was = sweepOf(before.get(c.centre)!, before.get(c.start)!, before.get(c.end)!);
    const now = sweepOf(after.get(c.centre)!, after.get(c.start)!, after.get(c.end)!);
    if (Math.abs(now - was) > MAX_SWEEP_STEP) return c.id;
  }
  return null;
}

/**
 * How a curve leaves its end `p` (one of its start and end), as a
 * direction: a line toward its other end; an arc along itself, its tangent
 * there (it runs counter-clockwise from its start, so it leaves its start
 * a quarter turn left of the radius and its end a quarter turn right).
 */
function leaving(c: Sketch["curves"][number], p: string, at: ReadonlyMap<string, XY>): XY {
  const q = at.get(p)!;
  if (c.kind === "line") {
    const o = at.get(c.start === p ? c.end : c.start)!;
    return [o[0] - q[0], o[1] - q[1]];
  }
  const m = at.get((c as { centre: string }).centre)!;
  const [rx, ry] = [q[0] - m[0], q[1] - m[1]];
  return (c as { start: string }).start === p ? [-ry, rx] : [ry, -rx];
}

/** The signed angle from direction `u` to direction `v`, in (−π, π]. */
const angleFrom = (u: XY, v: XY): number => Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);

/**
 * How near (radians) two curves must leave a shared end to opposite
 * directions to count as joined smoothly (tangent), as a slot's sides and
 * ends, a tangent arc or a rounded corner are: a twelfth of a turn, so one
 * bent a little by a drag (a tilted slot is not held tangent yet, step
 * 49) still counts.
 */
export const SMOOTH_JOINT = Math.PI / 6;

/**
 * The first point where two of the sketch's lines and arcs meet (an end of
 * each, construction curves left out) whose corner turned over between the
 * points `before` and `after`, or null: the angle from one curve's way out
 * of the point to the other's changed by more than MAX_SWEEP_STEP, as when
 * a side reverses past a zero length or the solver jumps to the shape's
 * mirror image (SL #630). Corners move smoothly in a drag step, so only a
 * flip changes one that much. With `smoothArcs`, only joints with an arc
 * that were smooth before (within SMOOTH_JOINT of a straight run) count:
 * those turn into a cusp, the arc turned inside out against its
 * neighbour, while a plain corner the drag carries across turns over
 * because the user moved it (the top comment).
 */
export function cornerTurned(sketch: Sketch, before: ReadonlyMap<string, XY>, after: ReadonlyMap<string, XY>, smoothArcs: boolean): string | null {
  const ends = new Map<string, Sketch["curves"][number][]>();
  for (const c of sketch.curves) {
    if (c.kind === "circle" || c.construction === true) continue;
    for (const p of [c.start, c.end]) ends.set(p, [...(ends.get(p) ?? []), c]);
  }
  for (const [p, cs] of ends) {
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        if (smoothArcs && cs[i].kind !== "arc" && cs[j].kind !== "arc") continue;
        const was = angleFrom(leaving(cs[i], p, before), leaving(cs[j], p, before));
        if (smoothArcs && Math.abs(was) < Math.PI - SMOOTH_JOINT) continue;
        const now = angleFrom(leaving(cs[i], p, after), leaving(cs[j], p, after));
        const change = Math.abs(now - was);
        if (Math.min(change, 2 * Math.PI - change) > MAX_SWEEP_STEP) return p;
      }
    }
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
export async function dragStep(kernel: KernelCalls, doc: DesignDocument, sketchId: string, pointId: string, to: XY): Promise<DragStep> {
  const moved = movePoint(doc, sketchId, pointId, to[0], to[1]).sketches.find((s) => s.id === sketchId)!; // throws for a sketch or point not there
  const sketch = doc.sketches.find((s) => s.id === sketchId)!;
  const request = solverRequest(moved, [pointId], [pointId]); // its own connected part only (#545 item 2)
  const answer = readAnswer(await kernel.call("solve_sketch", request.text));
  if (answer.result === "refused") return { refused: `The sketch can't be solved there: ${answer.message}.` };
  if (answer.result === "conflict") return { refused: "The sketch's constraints can't all hold there, so the point stays where it last was." };
  const solved = solvedPoints(moved, request, answer.points);
  const tiny = shrunk(moved, solved);
  if (tiny !== null) return { refused: `That would shrink ${curveWord(moved, tiny, "a")} below ${MIN_FEATURE} mm, so the point stays where it last was.` };
  if (turnedOver(sketch, pointsOf(sketch), solved) !== null || cornerTurned(sketch, pointsOf(sketch), solved, true) !== null) return { refused: ARC_TURNED };
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
 * says a newer target came (the rest of these steps are dropped). Gives
 * the last solved document (`doc` itself when no step solved) and the
 * refusal, if one stopped it.
 */
export async function dragTo(kernel: KernelCalls, doc: DesignDocument, sketchId: string, pointId: string, to: XY, pixel: number | undefined, newer: () => boolean = () => false, shown: (doc: DesignDocument) => void = () => {}): Promise<{ doc: DesignDocument; refused: string | null }> {
  let at = doc;
  for (const step of dragSteps(pointOf(doc, sketchId, pointId), to, pixel)) {
    if (newer()) break;
    const got = await dragStep(kernel, at, sketchId, pointId, step);
    if ("refused" in got) return { doc: at, refused: got.refused };
    at = got.doc;
    shown(at);
  }
  // Every step solved but the point never moved: its constraints hold it there. Said, so a drag that does nothing is not
  // silent (the solver bug hunt, 2026-11-06); a fixed point is refused before the drag (grabProblem).
  const [from, now] = [pointOf(doc, sketchId, pointId), pointOf(at, sketchId, pointId)];
  if (!newer() && Math.hypot(now[0] - from[0], now[1] - from[1]) <= HELD_STILL && Math.hypot(to[0] - from[0], to[1] - from[1]) > HELD_STILL) return { doc: at, refused: HELD };
  return { doc: at, refused: null };
}

/** How far (mm) a dragged point may move and still count as held still by its constraints: the solver's LINEAR. */
export const HELD_STILL = 1e-5;

/** The words for a drag its constraints hold still. */
export const HELD = "Its constraints and dimensions hold this point where it is: take one off to move it.";
