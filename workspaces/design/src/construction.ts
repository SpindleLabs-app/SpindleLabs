// Construction curves (step 47f, Fusion's construction lines): a curve
// marked `construction` is drawn dashed and left out of the sketch's
// outline (projection.ts `profileCurves`), so it can guide a shape (a
// centre line, a circle the corners sit on) without making or breaking a
// profile; snapping, constraints and dimensions treat it like any other
// curve. Construction (X, or the sketch toolbar's button) turns the Select
// tool's picked curves into construction curves, or back when every one
// already is, as one undo step. Projected curves follow a body and can't
// be turned. `dashes` cuts the drawn segments into dashes for the view.

import type { SketchXY } from "@fission/core";
import type { DesignDocument, Sketch, SketchCurve } from "./document.ts";

/** What Construction did: the document with the curves turned and the undo step's name, or why nothing changed. */
export type Turned = { doc: DesignDocument; step: string } | { refused: string };

/** The undo steps: curves made construction curves, and turned back. */
export const CONSTRUCTION_STEPS = { on: "Construction", off: "Normal curve" } as const;

/** The Select tool's picked curves `ids` of sketch `sketchId` turned into construction curves, or back to ordinary ones when every one already is. */
export function toggleConstruction(doc: DesignDocument, sketchId: string, ids: readonly string[]): Turned {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId} in the design`);
  const projected = new Set((sketch.projected ?? []).map((p) => p.made));
  const picked = sketch.curves.filter((c) => ids.includes(c.id));
  if (picked.length === 0) return { refused: "Pick a line, circle or arc with Select first, then press Construction." };
  if (picked.some((c) => projected.has(c.id))) return { refused: "A projected edge follows its body, so it can't be made a construction line: pick only the sketch's own curves." };
  const on = !picked.every((c) => c.construction === true);
  const turned = new Set(picked.map((c) => c.id));
  const curves = sketch.curves.map((c): SketchCurve => {
    if (!turned.has(c.id)) return c;
    // A construction circle makes no hole or peg, so a fit it held (FK2) goes with it.
    if (on) {
      const { fit: _fit, ...rest } = c as SketchCurve & { fit?: unknown };
      return { ...rest, construction: true } as SketchCurve;
    }
    const { construction: _, ...rest } = c;
    return rest as SketchCurve;
  });
  const next: Sketch = { ...sketch, curves };
  return { doc: { ...doc, sketches: doc.sketches.map((s) => (s.id === sketchId ? next : s)) }, step: on ? CONSTRUCTION_STEPS.on : CONSTRUCTION_STEPS.off };
}

/** A dash and the gap after it, as parts of a dash's period. */
const DASH = 0.6;
/** The most dashes one segment is cut into: a longer one gets longer dashes, so a far zoom out never draws millions. */
export const MAX_DASHES = 200;

/**
 * `segments` cut into dashes `period` mm apart along their length (a dash
 * of DASH of it, then a gap), a run of joined segments (a circle's or an
 * arc's sides, each starting where the last ended) dashed as one path, so
 * its short sides still show dashes. A run shorter than one period is
 * drawn whole, so a short line still shows. A period over a run's
 * length / MAX_DASHES is used instead of a smaller one, so a far zoom out
 * never draws millions.
 */
export function dashes(segments: readonly (readonly [SketchXY, SketchXY])[], period: number): (readonly [SketchXY, SketchXY])[] {
  const out: (readonly [SketchXY, SketchXY])[] = [];
  // The runs: consecutive segments each starting exactly where the one before ended.
  const runs: (readonly [SketchXY, SketchXY])[][] = [];
  for (const s of segments) {
    const last = runs.at(-1)?.at(-1);
    if (last && last[1][0] === s[0][0] && last[1][1] === s[0][1]) runs.at(-1)!.push(s);
    else runs.push([s]);
  }
  for (const run of runs) {
    const lengths = run.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
    const total = lengths.reduce((x, y) => x + y, 0);
    if (!(period > 0) || !(total > period)) {
      out.push(...run);
      continue;
    }
    const step = Math.max(period, total / MAX_DASHES);
    // Where along the run each dash starts and ends, cut at the segments' joins.
    let start = 0; // where this segment starts along the run
    run.forEach(([a, b], k) => {
      const len = lengths[k];
      const at = (t: number): SketchXY => (len === 0 ? a : [a[0] + ((b[0] - a[0]) * (t - start)) / len, a[1] + ((b[1] - a[1]) * (t - start)) / len]);
      // The first dash that reaches into this segment, then each after it that starts in it.
      for (let d = Math.floor(start / step) * step; d < start + len; d += step) {
        const from = Math.max(d, start);
        const to = Math.min(d + step * DASH, start + len);
        if (to > from) out.push([at(from), at(to)]);
      }
      start += len;
    });
  }
  return out;
}
