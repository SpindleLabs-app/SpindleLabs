// Selecting and deleting single sketch curves (missing basics, Ben 2026-11-04):
// while a sketch is edited, the Select tool (Escape with no shape half drawn,
// or its button) picks lines, circles and arcs under the pointer; Delete,
// Backspace or the toolbar's Delete takes them out, one undo step. Pure
// functions: the workspace asks `curveAt` what a click is on, keeps the
// picks in the tool (`pickCurve`) and records `deleteCurves`.

import type { SketchXY } from "@fission/core";
import type { DesignDocument, Sketch, SketchCurve } from "./document.ts";
import { deleteCurve } from "./sketch.ts";

/**
 * How far from a curve a click still picks it, in screen pixels: a snap's
 * reach (snap.ts SNAP_PIXELS) with a mouse, more for a finger, as Move's
 * handles allow (viewport MOVE_GRAB_PX; app hunt 2026-11-04: a tap 12 px
 * off a circle's rim picked nothing).
 */
export const PICK_PIXELS = { mouse: 10, touch: 24 } as const;

/** Distance between two points. */
const apart = (p: SketchXY, q: SketchXY): number => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** The distance from `p` to the segment a–b (the nearest point on it, clamped to its ends). */
export function toSegment(p: SketchXY, a: SketchXY, b: SketchXY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (!(length2 > 0)) return apart(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return apart(p, [a[0] + t * dx, a[1] + t * dy]);
}

/**
 * The distance from `p` to the arc counter-clockwise from `start` to `end`
 * round `centre` (radius |start − centre|): off its circle by | |p − c| − r |
 * when `p` lies within its sweep seen from the centre, else to the nearer end.
 */
export function toArc(p: SketchXY, start: SketchXY, end: SketchXY, centre: SketchXY): number {
  const r = apart(start, centre);
  // Turns from the start counter-clockwise, in [0, 2π): each atan2 is in (−π, π], so a difference is in (−2π, 2π).
  const turn = (q: SketchXY) => Math.atan2(q[1] - centre[1], q[0] - centre[0]);
  const from = turn(start);
  const sweep = (turn(end) - from + 2 * Math.PI) % (2 * Math.PI);
  const at = (turn(p) - from + 2 * Math.PI) % (2 * Math.PI);
  return at <= sweep ? Math.abs(apart(p, centre) - r) : Math.min(apart(p, start), apart(p, end));
}

/** The distance from `p` to one curve of `sketch` (Infinity for a curve naming a point the sketch lacks). */
export function toCurve(sketch: Sketch, curve: SketchCurve, p: SketchXY): number {
  const point = (id: string): SketchXY | null => {
    const found = sketch.points.find((q) => q.id === id);
    return found ? [found.x, found.y] : null;
  };
  if (curve.kind === "circle") {
    const c = point(curve.centre);
    return c ? Math.abs(apart(p, c) - curve.radius) : Infinity;
  }
  const a = point(curve.start);
  const b = point(curve.end);
  if (!a || !b) return Infinity;
  if (curve.kind === "line") return toSegment(p, a, b);
  const c = point(curve.centre);
  return c ? toArc(p, a, b, c) : Infinity;
}

/**
 * The curve a click at `p` is on: the nearest of the sketch's curves within
 * `reach` (mm, a few pixels at the zoom), the later drawn on a tie (it is
 * drawn on top), or null when none is that close.
 */
export function curveAt(sketch: Sketch, p: SketchXY, reach: number): string | null {
  let best: string | null = null;
  let nearest = Infinity;
  for (const c of sketch.curves) {
    const d = toCurve(sketch, c, p);
    if (d <= reach && d <= nearest) {
      best = c.id;
      nearest = d;
    }
  }
  return best;
}

/**
 * The picks after a click on curve `hit` (null: on nothing): a click picks
 * only that curve, Shift adds it or, when picked already, takes it out; a
 * click on nothing clears the picks, Shift keeps them.
 */
export function pickCurve(picked: readonly string[], hit: string | null, shift: boolean): string[] {
  if (hit === null) return shift ? [...picked] : [];
  if (!shift) return [hit];
  return picked.includes(hit) ? picked.filter((id) => id !== hit) : [...picked, hit];
}

/** The picks the sketch still holds (an undo may have taken one out), in their order. */
export function stillPicked(sketch: Sketch | undefined, picked: readonly string[]): string[] {
  if (!sketch) return [];
  const there = new Set(sketch.curves.map((c) => c.id));
  return picked.filter((id) => there.has(id));
}

/** The document without these curves of the sketch (each through `deleteCurve`: points only they used go, a projected one takes its projection); ids it lacks are passed over. */
export function deleteCurves(doc: DesignDocument, sketchId: string, ids: readonly string[]): DesignDocument {
  let next = doc;
  for (const id of ids) {
    const sketch = next.sketches.find((s) => s.id === sketchId);
    if (sketch?.curves.some((c) => c.id === id)) next = deleteCurve(next, sketchId, id);
  }
  return next;
}

/** How the picks read: "1 line", "2 lines and 1 circle", "1 line, 1 arc and 1 circle"; "" for none. Projected curves count as projected edges. */
export function pickedWords(sketch: Sketch | undefined, picked: readonly string[]): string {
  if (!sketch) return "";
  const made = new Set((sketch.projected ?? []).map((p) => p.made));
  const kinds = picked.flatMap((id) => {
    const c = sketch.curves.find((x) => x.id === id);
    return c ? [made.has(c.id) ? "projected edge" : c.kind] : [];
  });
  const words = ["line", "arc", "circle", "projected edge"].flatMap((kind) => {
    const n = kinds.filter((k) => k === kind).length;
    return n ? [`${n} ${kind}${n === 1 ? "" : "s"}`] : [];
  });
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The undo step deleting these picks is recorded as: "Delete line", "Delete circle", "Delete arc", "Delete projected edge" for one, "Delete 3 curves" for more. */
export function deleteStep(sketch: Sketch | undefined, picked: readonly string[]): string {
  const ids = stillPicked(sketch, picked);
  if (ids.length !== 1) return `Delete ${ids.length} curves`;
  return `Delete ${pickedWords(sketch, ids).slice("1 ".length)}`;
}

/** What the sketch panel says while the Select tool is in use: the picks and what to do with them, or how to pick. */
export function selectStatus(sketch: Sketch | undefined, picked: readonly string[]): string {
  const ids = stillPicked(sketch, picked);
  const words = pickedWords(sketch, ids);
  return words ? `Selected: ${words}. Press Delete or Backspace, or the Delete button, to remove ${ids.length === 1 ? "it" : "them"}.` : "";
}
