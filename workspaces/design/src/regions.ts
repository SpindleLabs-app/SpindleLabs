// Sketch regions in Design (step 48): an extrude of a sketch names the
// region it extrudes by the curves round its outside, by id, never by an
// index, so a curve drawn elsewhere in the sketch never makes it extrude a
// different region (docs/document-model.md section 3). Holes come with the
// region, as in Fusion: a circle drawn inside it makes a hole in its
// extrude. Two regions can have the same name (a symmetric sketch: a circle
// with a line across it through two points each side of the centre); the
// one whose centroid is nearest the centroid saved is picked.
//
// The kernel (sketch_regions) lists every region by its curves' places in
// the lists it was given; `CurveIds` maps those back to the sketch's ids.

import type { KernelCalls, OutlinePiece, Outline, SketchRegion, SketchRegions } from "@fission/core";
import type { Sketch } from "./document.ts";
import { profileCurves } from "./projection.ts";
import type { CurveIds } from "./rebuild.ts";
import { curvesOf } from "./sketch.ts";

/** A piece of a region's name: a sketch curve by id, and whether the region runs it backwards (from its end to its start). */
export interface RegionPiece {
  curve: string;
  reversed: boolean;
}

/**
 * The region an extrude of a sketch extrudes (Design data version 9): the
 * curves round its outside, counter-clockwise, as the kernel names them
 * (a curve that runs on through several corners named once), and its
 * centroid (sketch mm), which tells two regions with the same name apart:
 * both as when it was picked, then as the sketch makes the region after
 * each settled edit that leaves it found (rebuild.ts `settleKept`,
 * `regionNow`).
 */
export interface RegionRef {
  outer: RegionPiece[];
  centroid: [number, number];
}

/** A kernel piece as a region piece: its curve's id (null when the ids don't reach it, never for an answer to these curves). */
function pieceOf(p: OutlinePiece, ids: CurveIds): RegionPiece | null {
  const curve = ids[p.curve]?.[p.index];
  return curve === undefined ? null : { curve, reversed: p.reversed };
}

/** The region's name by curve id (null if a piece names a curve the ids don't have). */
export function regionName(region: Pick<SketchRegion, "outer">, ids: CurveIds): RegionPiece[] | null {
  const named = region.outer.map((p) => pieceOf(p, ids));
  return named.every((p) => p !== null) ? (named as RegionPiece[]) : null;
}

/** What an extrude saves for `region`: its name by id and its centroid. */
export function regionRef(region: SketchRegion, ids: CurveIds): RegionRef {
  const outer = regionName(region, ids);
  if (outer === null) throw new Error("the region names a curve the sketch doesn't have");
  return { outer, centroid: [region.centroid[0], region.centroid[1]] };
}

const samePiece = (a: RegionPiece, b: RegionPiece) => a.curve === b.curve && a.reversed === b.reversed;

/**
 * Whether two names are the same loop: the same pieces in the same order
 * round it, wherever each list starts (the kernel starts at its smallest
 * entry by the curves' places in its lists, which a curve deleted before
 * them can't reorder, but a name read back is never trusted to start there).
 */
export function sameLoop(a: readonly RegionPiece[], b: readonly RegionPiece[]): boolean {
  const n = a.length;
  if (n !== b.length || n === 0) return false;
  for (let shift = 0; shift < n; shift++) {
    let k = 0;
    while (k < n && samePiece(a[(k + shift) % n], b[k])) k++;
    if (k === n) return true;
  }
  return false;
}

/** The same loop run the other way: the pieces in reverse order, each flipped (a region turned over by a drag keeps its curves, but the kernel names it counter-clockwise, so the other way round). */
export function mirroredLoop(a: readonly RegionPiece[], b: readonly RegionPiece[]): boolean {
  return sameLoop(a, [...b].reverse().map((p) => ({ curve: p.curve, reversed: !p.reversed })));
}

/**
 * How far (sketch mm) a region's centroid may be from the one saved for it
 * to be the same region found by its shape, when the curves round it are no
 * longer the ones named (a side deleted and drawn again between the same
 * corners): the kernel's 10 nm, so only the very same shape, never one moved.
 */
export const REDRAWN_CENTROID = 1e-5;

/**
 * The item among `items` that is region `ref`, best first: one with the
 * same name (the same loop of curves, from any start); else the same loop
 * turned over (a corner dragged through the far side); of several, the one
 * whose centroid is nearest the saved one (the first listed of equally near
 * ones). Else the one region with the saved centroid within
 * REDRAWN_CENTROID that still has a curve of the old name (a side drawn
 * again); two such are not told apart. Undefined when none is.
 */
export function pickRegion<T>(items: readonly T[], nameOf: (t: T) => readonly RegionPiece[] | null, centroidOf: (t: T) => readonly [number, number], ref: RegionRef): T | undefined {
  const from = (t: T) => Math.hypot(centroidOf(t)[0] - ref.centroid[0], centroidOf(t)[1] - ref.centroid[1]);
  for (const same of [sameLoop, mirroredLoop]) {
    let best: T | undefined;
    let bestD = Infinity;
    for (const t of items) {
      const name = nameOf(t);
      if (name === null || !same(name, ref.outer)) continue;
      const d = from(t);
      if (best === undefined || d < bestD) [best, bestD] = [t, d];
    }
    if (best !== undefined) return best;
  }
  const old = new Set(ref.outer.map((p) => p.curve));
  const shaped = items.filter((t) => from(t) <= REDRAWN_CENTROID && (nameOf(t) ?? []).some((p) => old.has(p.curve)));
  return shaped.length === 1 ? shaped[0] : undefined;
}

/** The region `ref` names among `regions` (the kernel's answer for curves `ids`), by `pickRegion`'s rule; undefined when none is (the sketch changed round it). */
export function findRegion(regions: readonly SketchRegion[], ids: CurveIds, ref: RegionRef): SketchRegion | undefined {
  return pickRegion(regions, (r) => regionName(r, ids), (r) => r.centroid, ref);
}

/**
 * Region `ref` as it is among `regions` now (the kernel's answer for curves
 * `ids`): the curves round the one `findRegion` finds and its centroid
 * today, to save in `ref`'s place once the sketch is reshaped (timeline hunt
 * 2026-11-11: the centroid stayed where the region was picked, so a side
 * drawn again between the same corners of a dragged region was measured from
 * the wrong place; and a region found again by its shape kept its old
 * curves' names, so the next drag lost it). `ref` itself when it says
 * exactly that already; undefined when the region is not there.
 */
export function regionNow(regions: readonly SketchRegion[], ids: CurveIds, ref: RegionRef): RegionRef | undefined {
  const found = findRegion(regions, ids, ref);
  const outer = found && regionName(found, ids);
  if (!found || !outer) return undefined;
  const same = outer.length === ref.outer.length && outer.every((p, k) => samePiece(p, ref.outer[k])) && found.centroid[0] === ref.centroid[0] && found.centroid[1] === ref.centroid[1];
  return same ? ref : { outer, centroid: [found.centroid[0], found.centroid[1]] };
}

/** A region's profile as an extrude's outline: what make_extrude takes, with its holes' pieces kept for the side faces' names. */
export const regionOutline = (region: SketchRegion): Outline => ({ ...region.profile, holePieces: region.holePieces });

/** The ids of the curves a sketch's regions are found from (construction curves and projected edges that join none left out: `profileCurves`), by kind in the kernel's order. */
export function regionCurveIds(content: Pick<Sketch, "points" | "curves" | "projected">): CurveIds {
  const curves = profileCurves(content);
  return {
    line: curves.filter((c) => c.kind === "line").map((c) => c.id),
    arc: curves.filter((c) => c.kind === "arc").map((c) => c.id),
    circle: curves.filter((c) => c.kind === "circle").map((c) => c.id),
  };
}

/** How the kernel starts the words of a region it can't extrude (kernel #143: then the reason, naming the curves). */
export const REFUSED_PREFIX = "this region can't be extruded: ";

/** A refused region's reason without the kernel's opening words, for words that say "can't be extruded" themselves; other words as they are. */
export const refusalReason = (why: string): string => (why.startsWith(REFUSED_PREFIX) ? why.slice(REFUSED_PREFIX.length) : why);

/** Every region of a sketch's points and curves, from the kernel, with the ids its pieces name (`ids`). A curve the kernel refuses outright is its error. */
export async function sketchRegions(kernel: KernelCalls, content: Pick<Sketch, "points" | "curves" | "projected">): Promise<SketchRegions & { ids: CurveIds }> {
  const c = curvesOf(content.points, profileCurves(content));
  return { ...(await kernel.call("sketch_regions", c.lines, c.circles, c.arcs)), ids: regionCurveIds(content) };
}
