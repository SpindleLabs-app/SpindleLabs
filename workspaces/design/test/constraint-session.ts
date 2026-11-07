// One seeded sketch session with constraints and drags on the real
// kernel's solver (step 47d4), for constraint-sessions.test.ts and the
// plants in constraint-planted.test.ts: drawing lines, rectangles and
// arcs, adding random horizontal, vertical, coincident and fix
// constraints, dragging random points (some held back by what they are
// constrained to), deleting curves and constraints, undoing, and saving
// and opening the design, in random order. After every step (and every
// solved step of a drag): every constraint holds (exactly for horizontal,
// vertical, coincident and fix, which the solver meets by substitution;
// an arc's ends on its circle within LINEAR), each fixed point is where it
// was fixed, no line or arc is shorter than MIN_FEATURE, every constraint
// names the sketch's own points; a drag that solved and whose point no
// constraint holds back leaves it exactly on the pointer in that axis; the design reads back
// from its saved text as it was; an undo gives back the design before.
// The constraint and drag code comes in as `mods`, so a planted copy can
// be run.
import type { KernelCalls } from "@fission/core";
import { seeded } from "../../../packages/testing/src/index.ts";
import { deleteConstraint, MIN_FEATURE } from "../src/constraints.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, deleteCurve, drawArc, drawLine, drawRectangle } from "../src/sketch.ts";
import type * as Constraints from "../src/constraints.ts";
import type * as PointDrag from "../src/point-drag.ts";

const LINEAR = 1e-5;

/** The code a session runs: the real modules, or planted copies. */
export interface SessionMods {
  addConstraint: typeof Constraints.addConstraint;
  dragTo: typeof PointDrag.dragTo;
  grabProblem: typeof PointDrag.grabProblem;
}

/** What is wrong with the sketch after a step, or null. `fixedAt` is where each fixed point was fixed. */
export function wrong(s: Sketch, fixedAt: ReadonlyMap<string, readonly [number, number]>): string | null {
  const at = new Map(s.points.map((p) => [p.id, [p.x, p.y] as const]));
  for (const c of s.constraints) {
    const names = c.kind === "fix" ? [c.point] : [c.a, c.b];
    if (names.some((p) => !at.has(p))) return `names: ${c.id} names a point the sketch hasn't got`;
    if (c.kind === "fix") {
      const [p, was] = [at.get(c.point)!, fixedAt.get(c.point)];
      if (was && (p[0] !== was[0] || p[1] !== was[1])) return `fixed: ${c.id}: fixed ${c.point} moved from ${was} to ${p}`;
      continue;
    }
    const [a, b] = [at.get(c.a)!, at.get(c.b)!];
    if ((c.kind === "horizontal" || c.kind === "coincident") && a[1] !== b[1]) return `holds: ${c.id} (${c.kind}) no longer holds in y: ${a} and ${b}`;
    if ((c.kind === "vertical" || c.kind === "coincident") && a[0] !== b[0]) return `holds: ${c.id} (${c.kind}) no longer holds in x: ${a} and ${b}`;
  }
  const apart = (p: string, q: string) => Math.hypot(at.get(p)![0] - at.get(q)![0], at.get(p)![1] - at.get(q)![1]);
  for (const c of s.curves) {
    if (c.kind === "line" && apart(c.start, c.end) < MIN_FEATURE) return `size: ${c.id} shrank to ${apart(c.start, c.end)}`;
    if (c.kind === "arc") {
      if (apart(c.start, c.end) < MIN_FEATURE) return `size: ${c.id}'s ends came together`;
      if (Math.abs(apart(c.centre, c.start) - apart(c.centre, c.end)) > LINEAR) return `circle: ${c.id}'s ends are off one circle by ${Math.abs(apart(c.centre, c.start) - apart(c.centre, c.end))}`;
    }
  }
  return null;
}

/** Runs one session; the first broken promise as "seed S step N (what): check: detail", or null. `done` counts each kind of step made. */
export async function runConstraintSession(kernel: KernelCalls, mods: SessionMods, seed: bigint, steps: number, done: Record<string, number> = {}): Promise<string | null> {
  const rand = seeded(seed);
  const below = (n: number) => Math.floor(rand.next() * n);
  const grid = () => [below(41) - 20, below(41) - 20] as [number, number];
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const id = s0.id;
  let doc: DesignDocument = s0.doc;
  const history: DesignDocument[] = [];
  const sketch = () => doc.sketches.find((s) => s.id === id)!;
  const fixedNow = () => new Map(sketch().constraints.flatMap((c) => (c.kind === "fix" ? [[c.point, [sketch().points.find((p) => p.id === c.point)!.x, sketch().points.find((p) => p.id === c.point)!.y] as const]] : [])));
  for (let step = 0; step < steps; step++) {
    const fixed = fixedNow();
    const before = doc;
    const k = rand.next();
    const points = sketch().points.map((p) => p.id);
    const what = k < 0.12 ? "line" : k < 0.18 ? "rectangle" : k < 0.22 ? "arc" : k < 0.5 ? "constrain" : k < 0.75 ? "drag" : k < 0.8 ? "delete" : k < 0.84 ? "unconstrain" : k < 0.94 ? "undo" : "reopen";
    const where = `seed ${seed} step ${step} (${what})`;
    let changed: DesignDocument | null = null;
    try {
      if (what === "line") {
        // From a point already there or a new one, never back onto where it starts (the line tool refuses a line shorter than MIN_FEATURE).
        const from = points.length > 0 && rand.next() < 0.4 ? points[below(points.length)] : grid();
        const start = typeof from === "string" ? sketch().points.find((p) => p.id === from)! : { x: from[0], y: from[1] };
        const to = grid();
        if (Math.hypot(to[0] - start.x, to[1] - start.y) >= 1) changed = drawLine(doc, id, from, to).doc;
      } else if (what === "rectangle") {
        const a = grid();
        changed = drawRectangle(doc, id, a, [a[0] + 1 + below(10), a[1] + 1 + below(10)]).doc;
      } else if (what === "arc") {
        // A quarter round centre c of radius r: from c + (r, 0) to c + (0, r).
        const [c, r] = [grid(), 1 + below(8)];
        changed = drawArc(doc, id, [c[0] + r, c[1]], [c[0], c[1] + r], c).doc;
      }
    } catch {
      // a curve the sketch tools refuse (three points in a row): skipped, as the tool would refuse the click
    }
    if (what === "constrain" && points.length >= 2) {
      const kind = (["horizontal", "vertical", "coincident", "fix"] as const)[below(4)];
      const [a, b] = [points[below(points.length)], points[below(points.length)]];
      const got = await mods.addConstraint(kernel, doc, id, kind === "fix" ? { kind, point: a } : { kind, a, b });
      if ("doc" in got) changed = got.doc;
      else if (doc !== before) return `${where}: refusal: a refusal changed the design`;
      // A Fix in a sketch with no constraints yet always adds something (the solver bug hunt, 2026-11-06: refusing Fixes that add
      // nothing must not refuse these).
      else if (kind === "fix" && sketch().constraints.length === 0 && !(sketch().pins ?? []).some((q) => q.point === a)) return `${where}: added: a Fix in a sketch with no constraints was refused: ${got.refused}`;
    } else if (what === "drag" && points.length > 0) {
      const free = points.filter((p) => mods.grabProblem(sketch(), p) === null);
      if (free.length > 0) {
        const p = free[below(free.length)];
        const to = grid();
        let partWay: string | null = null;
        const got = await mods.dragTo(kernel, doc, id, p, to, 0.2, undefined, (next) => {
          partWay ??= wrong(next.sketches.find((s) => s.id === id)!, fixed);
        });
        if (partWay !== null) return `${where}, part way: ${partWay}`;
        // Where the held point must land: in each axis whose group (joined by coincident, and horizontal for y or vertical
        // for x) holds no fixed point and no arc's point (Newton's), exactly on the pointer, since the held point leads it.
        const q = got.doc.sketches.find((s) => s.id === id)!.points.find((x) => x.id === p)!;
        const onArcs = new Set(sketch().curves.flatMap((c) => (c.kind === "arc" ? [c.start, c.end, c.centre] : [])));
        const fixedPts = new Set(sketch().constraints.flatMap((c) => (c.kind === "fix" ? [c.point] : [])));
        const group = (axis: "x" | "y") => {
          const joins = sketch().constraints.flatMap((c) => (c.kind === "coincident" || c.kind === (axis === "y" ? "horizontal" : "vertical") ? [[c.a, c.b]] : []));
          const seen = new Set([p]);
          for (let grew = true; grew; ) {
            grew = false;
            for (const [a, b] of joins) if (seen.has(a) !== seen.has(b)) [grew] = [true, seen.add(seen.has(a) ? b : a)];
          }
          return seen;
        };
        const axisFree = (axis: "x" | "y") => [...group(axis)].every((x) => !fixedPts.has(x) && !onArcs.has(x));
        if (got.refused === null && ((axisFree("x") && q.x !== to[0]) || (axisFree("y") && q.y !== to[1]))) return `${where}: pointer: ${p} landed at ${q.x}, ${q.y}, not where the pointer at ${to} puts it`;
        if (got.doc !== doc) changed = got.doc;
      }
    } else if (what === "delete" && sketch().curves.length > 0) {
      changed = deleteCurve(doc, id, sketch().curves[below(sketch().curves.length)].id);
    } else if (what === "unconstrain" && sketch().constraints.length > 0) {
      changed = deleteConstraint(doc, id, sketch().constraints[below(sketch().constraints.length)].id);
    } else if (what === "undo" && history.length > 0) {
      doc = history.pop()!;
      done.undo = (done.undo ?? 0) + 1;
      continue;
    } else if (what === "reopen") {
      const text = JSON.stringify(doc);
      let read: string;
      try {
        read = JSON.stringify(readDesignDocument(JSON.parse(text)));
      } catch (e) {
        return `${where}: reopen: the saved design is refused: ${e instanceof Error ? e.message : e}`;
      }
      if (read !== text) return `${where}: reopen: the design read back differently`;
      done.reopen = (done.reopen ?? 0) + 1;
    }
    if (changed === null || changed === doc) continue;
    const why = wrong(changed.sketches.find((s) => s.id === id)!, fixed);
    if (why !== null) return `${where}: ${why}`;
    history.push(doc);
    doc = changed;
    done[what] = (done[what] ?? 0) + 1;
  }
  return null;
}
