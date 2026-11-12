// An extrude of several profiles at once (Ben, 2026-11-11, as Fusion's
// Extrude with several profiles picked; Design data version 18). The
// first profile stays where every extrude of a sketch keeps it (`sketch`,
// `region`), so a one-profile extrude reads and builds as before; the
// others are `more`, each a sketch and (when it has several) the region of
// it, possibly of other sketches. The item depends on each sketch once,
// the first profile's first.
//
// Built as a new body, each profile's prism is built as a one-profile
// extrude is (the owner's kept-shape rule per sketch: `profileParts`), and
// the prisms are joined by the kernel (rebuild.ts `unitedRun`): profiles
// that touch come out as one body, profiles apart as separate bodies. The
// body holding the first profile keeps the extrude's own id
// (`body:<extrude>`), the others are its pieces (`body:<extrude>/piece:k`),
// numbered when built and remembered by their faces as a Combine's are.
// Join, Cut and Intersect take one profile until the next substep.

import type { Feature } from "@fission/core";
import type { RegionRef } from "./regions.ts";

/** One more profile of an extrude: a sketch, and the region of it (left out for a sketch of one outline). */
export interface ProfileRef {
  sketch: string;
  region?: RegionRef;
}

/** The most profiles one extrude takes beyond its first (a sketch's regions are fewer than its curves, at most 2,000). */
export const MORE_PROFILES_LIMIT = 200;

/** An extrude's profiles after its first, as saved (`more`); none for an extrude of one profile or any other item. */
export function moreProfiles(f: Feature): ProfileRef[] {
  const more = f.intent.parameters.more;
  return Array.isArray(more) ? (more as ProfileRef[]) : [];
}

/** Whether an extrude has more than one profile. */
export const hasMoreProfiles = (f: Feature): boolean => moreProfiles(f).length > 0;

/** Every sketch an extrude of a sketch is built from, each once: its first profile's, then the others' in the order picked. */
export function extrudeSketches(f: Feature): string[] {
  const first = f.intent.parameters.sketch;
  return [...new Set([...(typeof first === "string" ? [first] : []), ...moreProfiles(f).map((p) => p.sketch)])];
}

/**
 * The key the kept shape of an extrude's profile `k` is filed under in the
 * document's `kept` (Design data version 19, SL #632): the extrude's id for
 * its first profile (k = 0, as before version 18), else the extrude's id
 * and "profile:k", k its place in `more` counted from 1 (a "/" and a ":",
 * in no id Design makes). Each profile keeps its own shape, so two of one
 * sketch never share one (version 18 filed every profile of a sketch under
 * one key, and the one lost second came back at the shape the first was
 * lost with). By place, because a profile's place is all that stays: its
 * region is rewritten as its sketch is edited (`settleKept`), two profiles
 * may share a sketch, and nothing in Design adds, takes out or reorders an
 * extrude's profiles once made (an edit that ever does must move these
 * keys with them).
 */
export const keptKey = (f: Feature, k: number): string => (k === 0 ? f.id : `${f.id}/profile:${k}`);

/** Whether `id` is the kept-shape key of one of `f`'s profiles after its first (`keptKey`, k from 1 to the number in `more`). */
export function isMoreKeptKey(f: Feature, id: string): boolean {
  const n = moreProfiles(f).length;
  for (let k = 1; k <= n; k++) if (keptKey(f, k) === id) return true;
  return false;
}

/**
 * An extrude's profiles, each as a one-profile extrude of it (its sketch,
 * region, distance and Flip; the first is the extrude itself), its id the
 * key its own kept shape goes by (`keptKey`), so the rebuild and the kept-shape
 * rule treat each as they always treated an extrude.
 */
export function profileParts(f: Feature): Feature[] {
  const { more: _more, sketch: _s, region: _r, operation: _o, bodies: _b, ...rest } = f.intent.parameters;
  return [
    f,
    ...moreProfiles(f).map((p, j): Feature => ({
      ...f,
      id: keptKey(f, j + 1),
      intent: { ...f.intent, parameters: { ...rest, sketch: p.sketch, ...(p.region ? { region: p.region } : {}) } },
      dependsOn: [p.sketch],
    })),
  ];
}

/** Whether two profiles are the same: one sketch, and the same region saved (or neither naming one). */
export const sameProfile = (a: ProfileRef, b: ProfileRef): boolean => a.sketch === b.sketch && JSON.stringify(a.region ?? null) === JSON.stringify(b.region ?? null);
