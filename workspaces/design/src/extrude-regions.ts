// The regions Extrude offers in the view (step 48c2): every closed region
// of each usable sketch, shaded on its plane, a click or tap picking one
// (Fusion's profiles). A region the kernel can't extrude is still shown,
// marked, so a click on it says why instead of doing nothing. The region
// picked is saved with the extrude by its curves' ids (regions.ts).

import type { KernelCalls, OfferedProfile, Plane, SketchRegion } from "@fission/core";
import type { Sketch } from "./document.ts";
import { projectedOpen } from "./projection.ts";
import { regionOutline, regionRef, sameLoop, sketchRegions, type RegionRef } from "./regions.ts";

/** A region offered in the view: which sketch, what an extrude of it saves (`ref`), and why it can't be extruded when it can't. */
export interface RegionOffer extends OfferedProfile {
  sketch: string;
  ref: RegionRef;
  refused?: string;
}

/**
 * The id an offered region goes by in the view: the sketch's own id when
 * it is the sketch's only region (as before regions, so clicking a sketch
 * of one outline is the same as choosing its row), else the sketch's id
 * and its place in the kernel's list ("#" is in no id Design makes).
 */
export const offerId = (sketch: string, k: number, of: number) => (of === 1 ? sketch : `${sketch}#${k}`);

/** Every number of a region's outline is finite: only then can it be drawn (a doubtful region promises only its area and centroid). */
function drawable(r: SketchRegion): boolean {
  const loops = [r.profile.outer, ...r.profile.holes];
  return loops.every((l) => ("circle" in l ? [...l.circle.center, l.circle.radius] : [...l.path.corners, ...l.path.bulges]).every(Number.isFinite));
}

/**
 * The regions of `sketch` (on `plane`) to offer, in the kernel's order; a
 * sketch that makes none offers none, with the kernel's reason (`why`), as
 * does one whose projected edges join nothing. A curve the kernel refuses
 * outright is its error.
 */
export async function regionOffers(kernel: KernelCalls, sketch: Sketch, plane: Plane): Promise<{ offers: RegionOffer[]; why?: string }> {
  if (sketch.curves.length === 0) return { offers: [] };
  const none = projectedOpen(sketch);
  if (none !== null) return { offers: [], why: none };
  const found = await sketchRegions(kernel, sketch);
  const shown = found.regions.filter(drawable);
  const offers = shown.map((r, k): RegionOffer => {
    const offer: RegionOffer = { id: offerId(sketch.id, k, shown.length), plane, outline: regionOutline(r), sketch: sketch.id, ref: regionRef(r, found.ids) };
    return r.extrudes ? offer : { ...offer, refused: r.refused ?? "this region can't be extruded" };
  });
  return found.why === undefined ? { offers } : { offers, why: found.why };
}

/** The offer among `offers` that is region `ref` of `sketch` (findRegion's rule: the same loop of curves, the nearest centroid of several), or undefined. */
export function offerOf(offers: readonly RegionOffer[], sketch: string, ref: RegionRef): RegionOffer | undefined {
  let best: RegionOffer | undefined;
  let bestD = Infinity;
  for (const o of offers) {
    if (o.sketch !== sketch || !sameLoop(o.ref.outer, ref.outer)) continue;
    const d = Math.hypot(o.ref.centroid[0] - ref.centroid[0], o.ref.centroid[1] - ref.centroid[1]);
    if (best === undefined || d < bestD) [best, bestD] = [o, d];
  }
  return best;
}

/** What the panel says while a sketch with several regions is chosen and none of them is yet. */
export const pickRegionWords = (name: string, n: number) => `${name} has ${n} regions: click or tap the one to extrude.`;

/** What it says for a region chosen. */
export const regionChosenWords = (name: string) => `${name}: region chosen.`;

/** What it says when a click or tap lands on a region that can't be extruded. */
export const regionRefusedWords = (name: string, why: string) => `This region of ${name} can't be extruded: ${why}`;
