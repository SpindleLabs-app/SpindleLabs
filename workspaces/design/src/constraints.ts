// Sketch constraints (step 47d2): horizontal, vertical, coincident and fix,
// solved by the kernel's sketch solver (`solve_sketch`, the sketch and its
// answer as the solver's JSON text). The points a sketch stores are always
// solved: a constraint is added only when the solver says the sketch with
// it solves, adds something (not wholly redundant) and leaves every line and
// arc at least MIN_FEATURE long; otherwise it is refused with the reason and
// the constraints and arcs that fight, and nothing moves (Fusion refuses
// the constraint just added).
//
// What the solver is told (`solverRequest`): the sketch's points in order;
// every arc's ends on one circle (arcs come first: they hold from the
// moment they are drawn); every point that follows a body (pinned to an
// edge, 26f, or projected, 27d) fixed, since the body, not the sketch,
// says where it is; then the constraints, oldest first, so the newest is
// last and is the one blamed when it makes a conflict; the points held
// (the first pick: Fusion keeps it still); one free radius per circle.
//
// Constraints never name a point that follows a body (refused): the body,
// not the sketch, says where it is. A body's edit that moves such a point
// solves the sketch again with it fixed where the body put it (rebuild.ts
// `follow`, 47d4), so an arc through it stays on its circle; when the
// constraints can't hold there, only the followed points move, with a
// warning.

import type { KernelCalls } from "@fission/core";
import { constraintPoints, counted, type DesignDocument, type Sketch, type SketchConstraint } from "./document.ts";
import { madePoints } from "./projection.ts";

/** The smallest feature the kernel builds (tolerance.rs MIN_FEATURE, mm): no constraint may shrink a line or an arc below it. */
export const MIN_FEATURE = 1e-3;

/** A constraint to add: its kind and the points it names, the first pick first. */
export type NewConstraint = { kind: "horizontal" | "vertical" | "coincident"; a: string; b: string } | { kind: "fix"; point: string };

/** What each of the solver's constraints stands for: one of the sketch's, an arc's ends on its circle, or a point that follows a body. */
export type Source = { constraint: string } | { arc: string } | { follows: string };

/** The sketch as the solver's JSON text, with the point ids in the solver's order and what each of its constraints stands for. */
export interface SolverRequest {
  text: string;
  points: string[];
  sources: Source[];
}

/** The solver's answer (solve::input::to_json). */
export type SolveAnswer =
  | { result: "solved"; points: [number, number][]; free: number; redundant: [number, "x" | "y" | "arc"][] }
  | { result: "conflict"; blame: number; group: number[] }
  | { result: "refused"; message: string };

/** The points of the sketch that follow a body: pinned to an edge (26f) or made by a projection (27d). */
export function followingPoints(sketch: Sketch): Set<string> {
  return new Set([...(sketch.pins ?? []).map((p) => p.point), ...(sketch.projected ?? []).flatMap((p) => madePoints(sketch, p))]);
}

/** The sketch for the solver (see the top comment), `held` the points to keep still if they can be. */
export function solverRequest(sketch: Sketch, held: readonly string[] = []): SolverRequest {
  const points = sketch.points.map((p) => p.id);
  const at = new Map(points.map((id, i) => [id, i]));
  const n = (id: string): number => {
    const i = at.get(id);
    if (i === undefined) throw new Error(`sketch ${sketch.id} has no point ${id}`);
    return i;
  };
  const constraints: (string | number)[][] = [];
  const sources: Source[] = [];
  for (const c of sketch.curves) {
    if (c.kind !== "arc") continue;
    constraints.push(["arc", n(c.centre), n(c.start), n(c.end)]);
    sources.push({ arc: c.id });
  }
  for (const p of followingPoints(sketch)) {
    if (!at.has(p)) continue;
    constraints.push(["fix", n(p)]);
    sources.push({ follows: p });
  }
  for (const c of sketch.constraints) {
    constraints.push(c.kind === "fix" ? ["fix", n(c.point)] : [c.kind, n(c.a), n(c.b)]);
    sources.push({ constraint: c.id });
  }
  const circles = sketch.curves.filter((c) => c.kind === "circle").length;
  const text = JSON.stringify({ points: sketch.points.map((p) => [p.x, p.y]), constraints, held: [...new Set(held)].map(n), circles });
  return { text, points, sources };
}

/** Reads the solver's answer, refusing text that is not one (a kernel fault, never the user's). */
export function readAnswer(text: string): SolveAnswer {
  const a = JSON.parse(text) as SolveAnswer;
  if (a?.result === "solved" && Array.isArray(a.points) && Array.isArray(a.redundant) && typeof a.free === "number") return a;
  if (a?.result === "conflict" && typeof a.blame === "number" && Array.isArray(a.group)) return a;
  if (a?.result === "refused" && typeof a.message === "string") return a;
  throw new Error(`the sketch solver gave an answer the app can't read: ${text.slice(0, 200)}`);
}

/** The axes an equation of each kind is in: a constraint wholly redundant in all of them adds nothing. */
const AXES: Record<SketchConstraint["kind"], ("x" | "y")[]> = { horizontal: ["y"], vertical: ["x"], coincident: ["x", "y"], fix: ["x", "y"] };

/** A line or arc a solve would shrink below MIN_FEATURE, by curve id, or null. Circles keep their radius. */
export function shrunk(sketch: Sketch, points: ReadonlyMap<string, readonly [number, number]>): string | null {
  const apart = (p: string, q: string) => {
    const [a, b] = [points.get(p)!, points.get(q)!];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  for (const c of sketch.curves) {
    if (c.kind === "line" && apart(c.start, c.end) < MIN_FEATURE) return c.id;
    if (c.kind === "arc" && (apart(c.start, c.end) < MIN_FEATURE || apart(c.centre, c.start) < MIN_FEATURE)) return c.id;
  }
  return null;
}

/** What adding a constraint came to: the document with it (its points solved), or why not, with the constraints and arcs that fight it (by id). */
export type Added = { doc: DesignDocument; id: string } | { refused: string; fighting: string[] };

/** Why a new constraint can't name these points, or null: the points must be the sketch's, two different ones, none following a body. */
export function namingProblem(sketch: Sketch, c: NewConstraint): string | null {
  const names = c.kind === "fix" ? [c.point] : [c.a, c.b];
  for (const p of names) if (!sketch.points.some((q) => q.id === p)) return `The sketch has no point ${p}.`;
  if (c.kind !== "fix" && c.a === c.b) return "Pick two different points.";
  const follows = followingPoints(sketch);
  if (names.some((p) => follows.has(p))) return "That point follows a body's edge, so the body says where it is: constraints can't move it.";
  return null;
}

/**
 * Adds a constraint to sketch `sketchId` (the first pick held), solved by
 * the kernel, or refuses it: a point it can't name (`namingProblem`), a
 * conflict (the constraints and arcs that fight), a constraint that
 * already holds (wholly redundant: Fusion refuses one too), or one that
 * would shrink a line or arc below MIN_FEATURE (horizontal and vertical
 * on one line's two ends: Fusion refuses it). One undo step for the caller.
 */
export async function addConstraint(kernel: KernelCalls, doc: DesignDocument, sketchId: string, c: NewConstraint): Promise<Added> {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId} in the design`);
  const problem = namingProblem(sketch, c);
  if (problem !== null) return { refused: problem, fighting: [] };
  const id = `constraint-${doc.nextId}`;
  const made: SketchConstraint = { id, ...c };
  const trial: Sketch = { ...sketch, constraints: [...sketch.constraints, made] };
  const request = solverRequest(trial, [constraintPoints(made)[0]]);
  const answer = readAnswer(await kernel.call("solve_sketch", request.text));
  if (answer.result === "refused") return { refused: `The sketch can't be solved: ${answer.message}.`, fighting: [] };
  if (answer.result === "conflict") {
    const fighting = answer.group.map((k) => request.sources[k]).flatMap((s) => ("constraint" in s ? [s.constraint] : "arc" in s ? [s.arc] : []));
    return { refused: `That ${made.kind} constraint fights the ones shown in red, so it can't be added.`, fighting };
  }
  const newest = request.sources.length - 1;
  const redundantAxes = new Set(answer.redundant.filter(([k]) => k === newest).map(([, axis]) => axis));
  if (AXES[made.kind].every((axis) => redundantAxes.has(axis))) return { refused: `That ${made.kind} constraint already holds, so it would add nothing.`, fighting: [] };
  const solved = new Map(request.points.map((p, i) => [p, answer.points[i]] as const));
  const tiny = shrunk(trial, solved);
  if (tiny !== null) return { refused: `That ${made.kind} constraint would shrink ${tiny} to almost nothing, so it can't be added.`, fighting: [] };
  const points = trial.points.map((p) => {
    const [x, y] = solved.get(p.id)!;
    return x === p.x && y === p.y ? p : { ...p, x, y };
  });
  const next: Sketch = { ...trial, points };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), sketches: doc.sketches.map((s) => (s.id === sketchId ? next : s)) } };
}

/** The sketch without constraint `id` (taking one away never breaks the others, so nothing moves). */
export function deleteConstraint(doc: DesignDocument, sketchId: string, id: string): DesignDocument {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch?.constraints.some((c) => c.id === id)) throw new Error(`sketch ${sketchId} has no constraint ${id}`);
  return { ...doc, sketches: doc.sketches.map((s) => (s === sketch ? { ...s, constraints: s.constraints.filter((c) => c.id !== id) } : s)) };
}

/** The constraints of a sketch that still name only its points (a deleted curve takes its points' constraints with it). */
export function keptConstraints(sketch: Pick<Sketch, "points" | "constraints">): SketchConstraint[] {
  const points = new Set(sketch.points.map((p) => p.id));
  const kept = sketch.constraints.filter((c) => constraintPoints(c).every((p) => points.has(p)));
  return kept.length === sketch.constraints.length ? sketch.constraints : kept;
}

/** The points a line picked gives a horizontal or vertical constraint: its start, held, then its end. */
export function lineEnds(sketch: Sketch, curveId: string): [string, string] | null {
  const c = sketch.curves.find((x) => x.id === curveId);
  return c?.kind === "line" ? [c.start, c.end] : null;
}
