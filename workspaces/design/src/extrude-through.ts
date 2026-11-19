// Through all (Fusion's "All" extent, Ben 2026-11-14; Design data version
// 23): a Cut or Intersect extrude that goes from its sketch's plane through
// every body it works on, however thick they are now. Its length is never
// stored: each rebuild works it out from the exact boxes round the bodies
// it picks as they are built at that point of the timeline (`bounds`, exact
// for lines, circles and arcs), so making the part thicker later keeps the
// hole going right through instead of silently stopping halfway.
//
// The length: the extrude goes from the sketch's plane along its way n (the
// frame's normal, turned round when flipped). A box's corner c is
// (c − o)·n ahead of the plane through the frame's origin o; the farthest
// corner of any box picked is how far the bodies reach that way, and no
// point of a body inside its box is farther. The extrude goes THROUGH_PAST
// beyond that, so its end cap never lies on a body's far face (a face lying
// on a face is the boolean's hardest case, and here it would decide nothing:
// past the body there is nothing to cut). One way only, as Fusion's; no
// Symmetric (a body going both ways through all is two Cuts).

import type { BodySpec } from "@fission/core";
import type { Bounds } from "./extrude-operation.ts";
import { REACH } from "./extrude-operation.ts";
import { MAX_TYPED, MIN_TYPED } from "./typed-entry.ts";
import { XY_FRAME } from "./extrude-symmetric.ts";

/** How far past the farthest body a Through all extrude ends (mm): far beyond the kernel's 10 nm, and the 100 nm boolean cap. */
export const THROUGH_PAST = 1;

/** What the panels and the timeline call it. */
export const THROUGH_WORDS = "Through all";

/** Through all's tooltip: what it does and why it is the one to use for a hole. */
export const THROUGH_TITLE = "Cut through every body picked, however thick it is: if the part is made thicker later, the cut still goes right through";

/** Why Through all is off for a new body or a Join: there is nothing to go through, or it would stick out past the bodies. */
export const THROUGH_ONLY_CUT = "Through all is for Cut and Intersect: a new body or a Join has nothing to go through.";

/** Why a Through all extrude has no Symmetric. */
export const THROUGH_NO_SYMMETRIC = "Through all goes one way from the sketch: untick Through all for Symmetric (Flip turns its way round).";

/** Whether an extrude's parameters say it goes through all (version 23). */
export const isThroughParams = (p: Readonly<Record<string, unknown>>): boolean => p.through === true;

/** The farthest any of `boxes` reaches ahead of the extrude `spec`'s plane along its way (mm; negative when all lie behind), or null with no boxes. */
export function farthestAhead(spec: BodySpec, boxes: readonly Bounds[]): number | null {
  if (!("extrude" in spec) || boxes.length === 0) return null;
  const e = spec.extrude;
  const frame = e.frame ?? XY_FRAME;
  const way = e.flip === true ? -1 : 1;
  const n = frame.normal.map((x) => x * way);
  const o = frame.origin;
  let far = -Infinity;
  for (const [lo, hi] of boxes)
    for (const x of [lo[0], hi[0]])
      for (const y of [lo[1], hi[1]])
        for (const z of [lo[2], hi[2]]) far = Math.max(far, (x - o[0]) * n[0] + (y - o[1]) * n[1] + (z - o[2]) * n[2]);
  return far;
}

/** Why a Through all extrude can't be built, in words: nothing ahead, or the bodies reach past what the modeller works at. */
export type ThroughRefusal = "behind" | "too-far";

/**
 * The distance a Through all extrude `spec` goes through `boxes` (the
 * boxes round the bodies it picks): THROUGH_PAST beyond the farthest any
 * reaches ahead of its plane, at most MAX_TYPED (1 km). Refused when every
 * box lies behind the plane or on it within REACH ("behind": a sketch on a
 * box's top face with Flip off points away from the box), or when the
 * bodies reach so far that even 1 km would not get MIN_TYPED past them.
 */
export function throughDistance(spec: BodySpec, boxes: readonly Bounds[]): number | ThroughRefusal {
  const far = farthestAhead(spec, boxes);
  if (far === null || !(far > REACH)) return "behind";
  if (far + MIN_TYPED > MAX_TYPED) return "too-far";
  return Math.min(far + THROUGH_PAST, MAX_TYPED);
}

/** The extrude `spec` going `distance` mm instead, nothing else changed. */
export function withDistance(spec: BodySpec, distance: number): BodySpec {
  if (!("extrude" in spec)) return spec;
  return { extrude: { ...spec.extrude, distance } };
}

/** A refusal in the words the item's row and the panel show, `label` the extrude's name. */
export function throughWords(label: string, why: ThroughRefusal): string {
  return why === "behind"
    ? `${label} goes through all, but no body it works on lies ahead of its sketch: Flip turns it round.`
    : `${label} goes through all, but its bodies reach past 1 km from its sketch, the largest size the modeller works at.`;
}
