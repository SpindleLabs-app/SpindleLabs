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
// A constraint may name a point that follows a body beside one of the
// sketch's own (Design data version 17, #517: a rectangle drawn from a
// body's corner keeps its sides square); one naming only followed points is
// refused (document.ts `heldByBody`): the body, not the sketch, says where
// they are, so it could only fight. A body's edit that moves such a point
// solves the sketch again with it fixed where the body put it (rebuild.ts
// `follow`, 47d4), so an arc through it stays on its circle; when the
// constraints can't hold there, only the followed points move, with a
// warning.
//
// Dimensions (step 47e): a distance (a line's length, two points apart, an
// arc's radius from its centre to its start) is the solver's
// ["distance", a, b, value]; a circle's diameter sets its radius and takes
// that circle's free radius from the count (`circles`), since the solver
// knows circles only as one free radius each. A dimension's value can be
// changed later (`changeDimension`), solved again the same way.

import type { KernelCalls } from "@fission/core";
import { constraintPoints, counted, curvePoints, DIMENSION_LIMITS, idNumber, MAX_SKETCH_CONSTRAINTS, type DesignDocument, type Sketch, type SketchConstraint } from "./document.ts";
import { constraintsFull, sketchRoom } from "./sketch-room.ts";
import { madePoints } from "./projection.ts";

/** The smallest feature the kernel builds (the kernel's MIN_FEATURE, mm): no constraint may shrink a line or an arc below it. */
export const MIN_FEATURE = 1e-3;

/** A constraint to add: its kind and the points it names, the first pick first. */
export type NewConstraint =
  | { kind: "horizontal" | "vertical" | "coincident"; a: string; b: string }
  | { kind: "fix"; point: string }
  | { kind: "distance"; a: string; b: string; value: number }
  | { kind: "diameter"; circle: string; value: number };

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
  | { result: "solved"; points: [number, number][]; free: number; redundant: [number, "x" | "y" | "arc" | "distance"][] }
  | { result: "conflict"; blame: number; group: number[] }
  | { result: "refused"; message: string };

/** The points of the sketch that follow a body: pinned to an edge (26f) or made by a projection (27d). */
export function followingPoints(sketch: Sketch): Set<string> {
  return new Set([...(sketch.pins ?? []).map((p) => p.point), ...(sketch.projected ?? []).flatMap((p) => madePoints(sketch, p))]);
}

/**
 * The sketch for the solver (see the top comment), `held` the points to
 * keep still if they can be. Only the points a constraint or arc ties, and
 * the held ones, are sent (`points`, in the sketch's order): a point
 * nothing ties stays where it is in any least change, so a big sketch with
 * few constraints is not refused for its size (the solver bug hunt,
 * 2026-11-06: 1,001 lines could take no constraint and no drag).
 * `solvedPoints` gives every point's place from the answer. With `part`,
 * only the connected part of the sketch round `part` and `held` is sent
 * (points tied through any chain of equations): a constraint or drag is
 * judged against its own part (#545 item 2).
 */
export function solverRequest(sketch: Sketch, held: readonly string[] = [], part?: readonly string[]): SolverRequest {
  const all = new Set(sketch.points.map((p) => p.id));
  const known = (id: string): string => {
    if (!all.has(id)) throw new Error(`sketch ${sketch.id} has no point ${id}`);
    return id;
  };
  const equations: (string | number)[][] = [];
  const sources: Source[] = [];
  for (const c of sketch.curves) {
    if (c.kind !== "arc") continue;
    equations.push(["arc", known(c.centre), known(c.start), known(c.end)]);
    sources.push({ arc: c.id });
  }
  for (const p of followingPoints(sketch)) {
    if (!all.has(p)) continue;
    equations.push(["fix", p]);
    sources.push({ follows: p });
  }
  for (const c of sketch.constraints) {
    // A diameter sizes a circle directly: no equation, one radius fewer free (below).
    if (c.kind === "diameter") continue;
    equations.push(c.kind === "fix" ? ["fix", known(c.point)] : c.kind === "distance" ? ["distance", known(c.a), known(c.b), c.value] : [c.kind, known(c.a), known(c.b)]);
    sources.push({ constraint: c.id });
  }
  const named = (q: (string | number)[]) => q.slice(1).filter((x): x is string => typeof x === "string");
  if (part !== undefined) {
    // #545 item 2: only the connected part of the sketch round `part` and the held points (every point an equation ties to
    // them, through any chain); the rest can't change the answer there, and a part an earlier edit left unsolved must not
    // refuse a constraint or a drag on curves that have nothing to do with it.
    const parent = new Map<string, string>();
    const root = (p: string): string => {
      let r = p;
      while (parent.has(r)) r = parent.get(r)!;
      return r;
    };
    for (const q of equations) {
      const [first, ...rest] = named(q).map(root);
      for (const r of rest) if (r !== root(first)) parent.set(r, root(first));
    }
    const roots = new Set([...part, ...held].map((p) => root(known(p))));
    for (let k = equations.length - 1; k >= 0; k--) {
      if (roots.has(root(named(equations[k])[0]))) continue;
      equations.splice(k, 1);
      sources.splice(k, 1);
    }
  }
  const tied = new Set([...equations.flatMap(named), ...held.map(known)]);
  const kept = sketch.points.filter((p) => tied.has(p.id));
  const at = new Map(kept.map((p, i) => [p.id, i]));
  const constraints = equations.map((q) => q.map((x, k) => (k > 0 && typeof x === "string" ? at.get(x)! : x)));
  const sized = new Set(sketch.constraints.flatMap((c) => (c.kind === "diameter" ? [c.circle] : [])));
  const circles = sketch.curves.filter((c) => c.kind === "circle" && !sized.has(c.id)).length;
  const text = JSON.stringify({ points: kept.map((p) => [p.x, p.y]), constraints, held: [...new Set(held)].map((id) => at.get(id)!), circles });
  return { text, points: kept.map((p) => p.id), sources };
}

/** Every point of `sketch` where a solved answer to `request` puts it: the ones sent where the solver says, the rest where they are. */
export function solvedPoints(sketch: Sketch, request: SolverRequest, answered: readonly (readonly [number, number])[]): Map<string, readonly [number, number]> {
  const at = new Map<string, readonly [number, number]>(sketch.points.map((p) => [p.id, [p.x, p.y]]));
  request.points.forEach((p, i) => at.set(p, answered[i]));
  return at;
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
const AXES: Record<Exclude<SketchConstraint["kind"], "diameter">, ("x" | "y" | "distance")[]> = { horizontal: ["y"], vertical: ["x"], coincident: ["x", "y"], fix: ["x", "y"], distance: ["distance"] };

/** A constraint's name in a refusal: "That horizontal constraint…", "That dimension…". */
const named = (kind: SketchConstraint["kind"]): string => (kind === "distance" || kind === "diameter" ? "dimension" : `${kind} constraint`);

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

/** A curve in a refusal's words: "the line", "the arc" (never its id). */
export function curveWord(sketch: Sketch, id: string, article: "the" | "a" = "the"): string {
  const kind = sketch.curves.find((c) => c.id === id)?.kind ?? "curve";
  return article === "the" ? `the ${kind}` : `${kind === "arc" ? "an" : "a"} ${kind}`;
}

/** What adding a constraint came to: the document with it (its points solved), or why not, with the constraints and arcs that fight it (by id). */
export type Added = { doc: DesignDocument; id: string } | { refused: string; fighting: string[] };

/** Why a new constraint can't name these points, or null: the points must be the sketch's, two different ones, none following a body. */
export function namingProblem(sketch: Sketch, c: NewConstraint): string | null {
  if (c.kind === "diameter") {
    if (!sketch.curves.some((q) => q.id === c.circle && q.kind === "circle")) return `The sketch has no circle ${c.circle}.`;
    if ((sketch.projected ?? []).some((p) => p.made === c.circle)) return "That circle is projected from a body, so the body says its size: it can't be given a dimension.";
    if (sketch.constraints.some((q) => q.kind === "diameter" && q.circle === c.circle)) return "That circle already has a diameter: double-click its dimension to change it.";
    return dimensionProblem(c.value);
  }
  const names = c.kind === "fix" ? [c.point] : [c.a, c.b];
  for (const p of names) if (!sketch.points.some((q) => q.id === p)) return `The sketch has no point ${p}.`;
  if (c.kind !== "fix" && c.a === c.b) return "Pick two different points.";
  const follows = followingPoints(sketch);
  if (names.every((p) => follows.has(p))) return names.length === 1 ? "That point follows a body's edge, so the body says where it is: constraints can't move it." : "Both points follow a body's edge, so the body says where they are: a constraint between them could only fight it.";
  if (c.kind === "distance") return dimensionProblem(c.value);
  return null;
}

/** Why a dimension can't take this value, or null: a number of mm from the smallest feature to the modelling range's width. */
export function dimensionProblem(value: number): string | null {
  if (!Number.isFinite(value) || value < DIMENSION_LIMITS.min || value > DIMENSION_LIMITS.max) return `A dimension must be from ${DIMENSION_LIMITS.min} mm to ${DIMENSION_LIMITS.max} mm.`;
  return null;
}

/**
 * The point a distance between `a` and `b` holds still (hunt 2026-11-12,
 * SL #612): `a`, the first pick, unless a line joins the two, a line's
 * length. Then the end nearer, along the sketch's curves, to the oldest
 * point joined to it (the id counter's smallest: the corner a rectangle or
 * a chain was started from) stays and the far end moves, so a rectangle
 * drawn from the origin keeps that corner whichever side is sized; on a
 * tie the older end.
 */
export function heldEnd(sketch: Sketch, a: string, b: string): string {
  if (!sketch.curves.some((c) => c.kind === "line" && ((c.start === a && c.end === b) || (c.start === b && c.end === a)))) return a;
  const next = new Map<string, Set<string>>();
  for (const c of sketch.curves) {
    const ps = curvePoints(c);
    for (const p of ps) for (const q of ps) if (p !== q) (next.get(p) ?? next.set(p, new Set()).get(p)!).add(q);
  }
  const age = (p: string): number => idNumber(p) ?? Infinity;
  const joined = new Set([a]);
  for (const p of joined) for (const q of next.get(p) ?? []) joined.add(q);
  const oldest = [...joined].reduce((x, y) => (age(y) < age(x) ? y : x));
  const steps = new Map([[oldest, 0]]);
  for (const [p, n] of steps) for (const q of next.get(p) ?? []) if (!steps.has(q)) steps.set(q, n + 1);
  const [da, db] = [steps.get(a)!, steps.get(b)!];
  return da < db || (da === db && age(a) <= age(b)) ? a : b;
}

/**
 * Adds a constraint to sketch `sketchId` (the first pick held; a line's
 * length holds `heldEnd`), solved by
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
  // A sketch at the reader's limit takes no more (#641 item 2), said before the solver is asked.
  if (sketch.constraints.length >= MAX_SKETCH_CONSTRAINTS) return { refused: constraintsFull(), fighting: [] };
  const id = `constraint-${doc.nextId}`;
  const made: SketchConstraint = { id, ...c };
  const trial: Sketch = { ...sketch, constraints: [...sketch.constraints, made] };
  const got = await solvedWith(kernel, trial, made, made.kind === "diameter" ? [] : made.kind === "distance" ? [heldEnd(sketch, made.a, made.b)] : [constraintPoints(made)[0]], true);
  if ("refused" in got) return got;
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), sketches: doc.sketches.map((s) => (s.id === sketchId ? got.sketch : s)) } };
}

/**
 * `trial` (holding `made`, its newest or changed constraint) solved, with
 * `held` kept still if they can be; or why not. A new constraint that adds
 * nothing is refused (`newest`); a changed dimension is not checked for it.
 */
async function solvedWith(kernel: KernelCalls, trial: Sketch, made: SketchConstraint, held: string[], newest: boolean): Promise<{ sketch: Sketch } | { refused: string; fighting: string[] }> {
  if (made.kind === "diameter") {
    // The circle takes the size; the solver is still asked, so a sketch it can't solve is refused as any constraint's is.
    trial = { ...trial, curves: trial.curves.map((q) => (q.id === made.circle && q.kind === "circle" ? { ...q, radius: made.value / 2 } : q)) };
  }
  const part = made.kind === "diameter" ? trial.curves.filter((q) => q.id === made.circle).flatMap(curvePoints) : constraintPoints(made);
  const request = solverRequest(trial, held, part);
  const answer = readAnswer(await kernel.call("solve_sketch", request.text));
  if (answer.result === "refused") return { refused: `The sketch can't be solved: ${answer.message}.`, fighting: [] };
  if (answer.result === "conflict") {
    const fighting = answer.group.map((k) => request.sources[k]).flatMap((s) => ("constraint" in s ? [s.constraint] : "arc" in s ? [s.arc] : []));
    return { refused: `That ${named(made.kind)} fights the ones shown in red, so it can't be ${newest ? "added" : "changed"}.`, fighting };
  }
  const k = request.sources.findIndex((s) => "constraint" in s && s.constraint === made.id);
  const redundantAxes = new Set(answer.redundant.filter(([j]) => j === k).map(([, axis]) => axis));
  if (newest && made.kind !== "diameter" && AXES[made.kind].every((axis) => redundantAxes.has(axis))) {
    const why = made.kind === "distance" ? "the others already set that size" : "it already holds";
    return { refused: `That ${named(made.kind)} would add nothing: ${why}.`, fighting: [] };
  }
  if (newest && made.kind !== "diameter" && made.kind !== "distance") {
    // Wholly redundant through a size (the solver bug hunt, 2026-11-06): a second Fix on a corner a size and a Fix already hold
    // was taken, since the solver names the older size redundant, not the newest; it then blocked every change. A constraint
    // that leaves as many freedoms as before adds nothing. The same points are told both times (`held` ties them), so the
    // counts compare.
    const before: Sketch = { ...trial, constraints: trial.constraints.filter((c) => c !== made) };
    const was = readAnswer(await kernel.call("solve_sketch", solverRequest(before, [...held, ...constraintPoints(made)], part).text));
    if (was.result === "solved" && answer.free >= was.free) {
      const why = made.kind === "fix" ? "the others already hold that point" : "the others already hold it";
      return { refused: `That ${named(made.kind)} would add nothing: ${why}.`, fighting: [] };
    }
  }
  const solved = solvedPoints(trial, request, answer.points);
  const tiny = shrunk(trial, solved);
  if (tiny !== null) return { refused: `That ${named(made.kind)} would shrink ${curveWord(trial, tiny)} shown in red to almost nothing, so it can't be ${newest ? "added" : "changed"}.`, fighting: [tiny] };
  const points = trial.points.map((p) => {
    const [x, y] = solved.get(p.id)!;
    return x === p.x && y === p.y ? p : { ...p, x, y };
  });
  return { sketch: { ...trial, points } };
}

/** What changing a dimension came to: the document with the new value (its points solved), or why not. */
export type Changed = { doc: DesignDocument } | { refused: string; fighting: string[] };

/**
 * Changes dimension `id` of sketch `sketchId` to `value` mm, solved by the
 * kernel with the point `heldEnd` holds (the same one as when it was
 * made), or refuses it with the reason and what
 * fights. One undo step for the caller.
 */
export async function changeDimension(kernel: KernelCalls, doc: DesignDocument, sketchId: string, id: string, value: number): Promise<Changed> {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId} in the design`);
  const old = sketch.constraints.find((c) => c.id === id);
  if (old?.kind !== "distance" && old?.kind !== "diameter") throw new Error(`sketch ${sketchId} has no dimension ${id}`);
  const problem = dimensionProblem(value);
  if (problem !== null) return { refused: problem, fighting: [] };
  if (value === old.value) return { doc };
  const made: SketchConstraint = { ...old, value };
  const trial: Sketch = { ...sketch, constraints: sketch.constraints.map((c) => (c.id === id ? made : c)) };
  const got = await solvedWith(kernel, trial, made, made.kind === "distance" ? [heldEnd(sketch, made.a, made.b)] : [], false);
  if ("refused" in got) return got;
  return { doc: { ...doc, sketches: doc.sketches.map((s) => (s.id === sketchId ? got.sketch : s)) } };
}

/** The sketch without constraint `id` (taking one away never breaks the others, so nothing moves). */
export function deleteConstraint(doc: DesignDocument, sketchId: string, id: string): DesignDocument {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch?.constraints.some((c) => c.id === id)) throw new Error(`sketch ${sketchId} has no constraint ${id}`);
  return { ...doc, sketches: doc.sketches.map((s) => (s === sketch ? { ...s, constraints: s.constraints.filter((c) => c.id !== id) } : s)) };
}

/** The two points a curve's own size or direction is about: a line's two ends, an arc's centre with its start and with its end. */
function curvePairs(c: Sketch["curves"][number]): [string, string][] {
  return c.kind === "line" ? [[c.start, c.end]] : c.kind === "arc" ? [[c.centre, c.start], [c.centre, c.end]] : [];
}

/**
 * The constraints left when curve `removed` goes and `left` stay: a
 * horizontal, vertical or distance on the two points of `removed`'s own
 * pairs (its length, its radius, its level) goes with it, as in Fusion,
 * unless a curve left has the same pair (a line drawn over the arc's
 * radius); its ends may stay, shared with the curves next to it, but the
 * constraint was about the curve, and a hidden one would hold a line drawn
 * there later without the user knowing why. A coincident or fix is about
 * its points and stays (`keptConstraints` takes a gone point's).
 */
export function withoutCurveConstraints(constraints: SketchConstraint[], removed: Sketch["curves"][number], left: readonly Sketch["curves"][number][]): SketchConstraint[] {
  const key = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const still = new Set(left.flatMap(curvePairs).map(([a, b]) => key(a, b)));
  const gone = new Set(curvePairs(removed).map(([a, b]) => key(a, b)).filter((k) => !still.has(k)));
  if (gone.size === 0) return constraints;
  const kept = constraints.filter((c) => !((c.kind === "horizontal" || c.kind === "vertical" || c.kind === "distance") && gone.has(key(c.a, c.b))));
  return kept.length === constraints.length ? constraints : kept;
}

/** The constraints of a sketch that still name only its points (a deleted curve takes its points' constraints with it). */
export function keptConstraints(sketch: Pick<Sketch, "points" | "constraints" | "curves">): SketchConstraint[] {
  const points = new Set(sketch.points.map((p) => p.id));
  const circles = new Set(sketch.curves.filter((c) => c.kind === "circle").map((c) => c.id));
  const kept = sketch.constraints.filter((c) => (c.kind === "diameter" ? circles.has(c.circle) : constraintPoints(c).every((p) => points.has(p))));
  return kept.length === sketch.constraints.length ? sketch.constraints : kept;
}

/**
 * The document with Horizontal on each level side of a rectangle just
 * drawn (`sides`, line ids) and Vertical on each upright one, as Fusion
 * gives a rectangle (the beginner check, 2026-11-06: without them a size
 * on one side made a trapezoid). Only where it holds exactly as drawn, so
 * the sketch stays solved without a solve and nothing can fight; a side
 * with both ends following a body (#517: one end is fine), or already level or upright by its
 * own constraint, gets none. The ids from the one counter.
 */
export function squaredRectangle(doc: DesignDocument, sketchId: string, sides: readonly string[]): DesignDocument {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId} in the design`);
  const at = new Map(sketch.points.map((p) => [p.id, p]));
  const follows = followingPoints(sketch);
  let nextId = doc.nextId;
  const added: SketchConstraint[] = [];
  for (const id of sides) {
    const line = sketch.curves.find((c) => c.id === id);
    if (line?.kind !== "line" || (follows.has(line.start) && follows.has(line.end))) continue;
    const [a, b] = [at.get(line.start)!, at.get(line.end)!];
    const kind = a.y === b.y ? "horizontal" : a.x === b.x ? "vertical" : null;
    if (kind === null) continue;
    const same = (c: SketchConstraint) => c.kind === kind && ((c.a === line.start && c.b === line.end) || (c.a === line.end && c.b === line.start));
    if ([...sketch.constraints, ...added].some(same)) continue;
    added.push({ id: `constraint-${nextId}`, kind, a: line.start, b: line.end });
    nextId = counted(nextId + 1);
  }
  if (added.length === 0) return doc;
  const squared = { ...sketch, constraints: [...sketch.constraints, ...added] };
  sketchRoom(doc, squared); // no more than the reader opens (#641 item 2)
  return { ...doc, nextId, sketches: doc.sketches.map((s) => (s === sketch ? squared : s)) };
}

/** The points a line picked gives a horizontal or vertical constraint: its start, held, then its end. */
export function lineEnds(sketch: Sketch, curveId: string): [string, string] | null {
  const c = sketch.curves.find((x) => x.id === curveId);
  return c?.kind === "line" ? [c.start, c.end] : null;
}
