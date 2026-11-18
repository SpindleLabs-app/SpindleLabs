// What constructions look like in the view (step 59a2): a plane a faint
// translucent square round the point the kernel says to draw it at (its
// `near`, beside what it was made from), an axis a dashed line through its
// `near`, a point a dot. The planes go to the shared viewport's origin
// planes (core `OriginShown.planes`, `centred`), the axes and points to one
// analysis overlay in the violet info colour. Pure: the workspace gives the
// answers kept in the document (and the preview's, before OK) and the size
// the dashes run to.

import type { AnalysisOverlay, OriginShown } from "@fission/core";
import type { ConstructAnswer } from "./construct-data.ts";
import { constructHidden, constructOf, insertAt, isConstructItem, type DesignDocument } from "./document.ts";

/** The overlay's id (one for every construction's axes and points). */
export const CONSTRUCT_OVERLAY = "construct";

/** The plane's id in the view's origin planes: "construct-feature-7", and the preview's. */
export const planeId = (item: string) => `construct-${item}`;
export const PREVIEW_ITEM = "preview";

type V3 = [number, number, number];

/** A unit vector square to `n` (a unit vector): the plane's x direction. */
export function squareTo(n: readonly number[]): V3 {
  const [x, y, z] = n;
  // Cross with the axis n is least along, so the result is never near zero.
  const axis: V3 = Math.abs(x) <= Math.abs(y) && Math.abs(x) <= Math.abs(z) ? [1, 0, 0] : Math.abs(y) <= Math.abs(z) ? [0, 1, 0] : [0, 0, 1];
  const c: V3 = [n[1] * axis[2] - n[2] * axis[1], n[2] * axis[0] - n[0] * axis[2], n[0] * axis[1] - n[1] * axis[0]];
  const len = Math.hypot(...c);
  return [c[0] / len, c[1] / len, c[2] / len];
}

/** Dashes along an axis: `DASHES` drawn pieces, each as long as the gap after it. */
export const DASHES = 12;

/** An axis through `at` along unit `d`, out `half` each way, as dashed pieces (from and to). */
export function dashedLine(at: readonly number[], d: readonly number[], half: number): { from: V3; to: V3 }[] {
  const out: { from: V3; to: V3 }[] = [];
  const step = (2 * half) / (2 * DASHES);
  for (let k = 0; k < DASHES; k++) {
    const a = -half + 2 * k * step;
    const b = a + step;
    out.push({ from: [at[0] + d[0] * a, at[1] + d[1] * a, at[2] + d[2] * a], to: [at[0] + d[0] * b, at[1] + d[1] * b, at[2] + d[2] * b] });
  }
  return out;
}

/** A construction answer to draw: its item's id ("preview" for the one before OK) and the answer. */
export interface Drawn {
  item: string;
  answer: ConstructAnswer;
}

/**
 * Every construction before the marker that is not suppressed or hidden
 * by its eye or the Construction folder's (59a3), with the
 * answer the document keeps for it, and `preview` (the answer asked for the
 * picks now, null for none) last.
 */
export function drawnConstructs(doc: DesignDocument, preview: ConstructAnswer | null): Drawn[] {
  const at = insertAt(doc);
  const out: Drawn[] = [];
  doc.timeline.features.forEach((f, i) => {
    if (i < at && isConstructItem(f) && !f.suppressed && !constructHidden(doc, f.id)) out.push({ item: f.id, answer: constructOf(f).answer });
  });
  if (preview !== null) out.push({ item: PREVIEW_ITEM, answer: preview });
  return out;
}

/** The planes for the origin's `planes` list: each centred on its `near`, the normal as the kernel answered. */
export function constructPlanes(drawn: readonly Drawn[]): NonNullable<OriginShown["planes"]>[number][] {
  return drawn.flatMap((d) => (d.answer.kind === "plane" ? [{ id: planeId(d.item), plane: { origin: d.answer.near, xAxis: squareTo(d.answer.normal), normal: d.answer.normal }, centred: true }] : []));
}

/**
 * The overlay for the axes (dashed, `half` mm each way) and points (dots) of
 * `drawn`, or null when there are none. The preview is drawn as a warning
 * (amber) so it reads apart from what is kept (violet).
 */
export function constructOverlay(drawn: readonly Drawn[], half: number): AnalysisOverlay | null {
  const places: NonNullable<AnalysisOverlay["places"]> = [];
  for (const d of drawn) {
    const severity = d.item === PREVIEW_ITEM ? ("warning" as const) : ("info" as const);
    if (d.answer.kind === "axis") for (const s of dashedLine(d.answer.near, d.answer.direction, half)) places.push({ severity, ...s });
    else if (d.answer.kind === "point") places.push({ severity, point: d.answer.point });
  }
  return places.length === 0 ? null : { id: CONSTRUCT_OVERLAY, label: "Construction axes and points", marks: [], places };
}
