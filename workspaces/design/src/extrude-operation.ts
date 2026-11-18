// Extrude's operation (Fusion's New Body, Join, Cut and Intersect; Design
// data version 10): which bodies the panel lists for Join, Cut or
// Intersect, and which it ticks. As Fusion's Extrude, the bodies the
// extrude reaches are listed and ticked by themselves; any of them can be
// unticked, and stays so while the panel is open. "Reaches" is judged by
// the boxes round the bodies (each body's `bounds`, exact): a body whose
// box meets the extrude's, touching counted (a sketch on a face joined to
// its own body), within LINEAR. The kernel's boolean then decides what
// the extrude really does to each one ticked, and says so if it can't.

import type { BodyView } from "@fission/core";
import { COMBINE_OPERATIONS, type CombineOperation } from "./document.ts";

/** What Extrude's panel calls each operation (Fusion's: New Body, Join, Cut, Intersect). */
export const EXTRUDE_OPERATION_WORDS: Record<ExtrudeOperation, string> = { new: "New body", join: "Join", cut: "Cut", intersect: "Intersect" };

/** Extrude's operations: a new body (the default, and the only one while Combine is hidden), or Join, Cut or Intersect with bodies before it. */
export type ExtrudeOperation = "new" | CombineOperation;
export const EXTRUDE_OPERATIONS: readonly ExtrudeOperation[] = ["new", ...COMBINE_OPERATIONS];

/** How near two boxes count as meeting (mm): the kernel's LINEAR tolerance, 10 nm, so a sketch on a face reaches its body. */
export const REACH = 1e-5;

/** A box round a body, [low, high] corners (mm), as the kernel gives it. */
export type Bounds = BodyView["bounds"];

/** Whether two boxes meet, touching counted, within `REACH` on each axis. */
export function boxesMeet(a: Bounds, b: Bounds): boolean {
  for (let i = 0; i < 3; i++) if (a[0][i] > b[1][i] + REACH || b[0][i] > a[1][i] + REACH) return false;
  return true;
}

/** A body the panel can list: its id, its row's words ("Body 2"), and its box. */
export interface ListedBody {
  body: string;
  label: string;
  bounds: Bounds;
}

/** One row of the panel's list: a body the extrude reaches, ticked or not. */
export interface BodyChoice {
  body: string;
  label: string;
  ticked: boolean;
}

/**
 * The panel's list for an extrude whose preview's box is `reach`: every
 * body of `bodies` (in their order, the scene's) whose box meets it,
 * ticked unless `unticked` holds it. A body no longer reached drops off
 * the list (and its untick is kept, for when the distance brings it back),
 * except one `kept` holds (an edited extrude's own bodies, listed reached
 * or not, so OK never drops one silently).
 */
export function bodyChoices(reach: Bounds, bodies: readonly ListedBody[], unticked: ReadonlySet<string>, kept: ReadonlySet<string> = new Set()): BodyChoice[] {
  return bodies.filter((b) => kept.has(b.body) || boxesMeet(reach, b.bounds)).map((b) => ({ body: b.body, label: b.label, ticked: !unticked.has(b.body) }));
}

/** The bodies ticked, in the list's order: what the extrude saves as its `bodies`. */
export const tickedBodies = (list: readonly BodyChoice[]): string[] => list.filter((b) => b.ticked).map((b) => b.body);

/**
 * The bodies of `bodies` whose box the extrude's box `reach` only touches:
 * they meet (`boxesMeet`), but on some axis share no more than `REACH` of
 * thickness, so the extrude has no room inside them. A Cut there removes
 * nothing: the extrude points away from the face it was drawn on, the
 * beginner's commonest slip (SL #677 item 5).
 */
export function touchingOnly(reach: Bounds, bodies: readonly ListedBody[]): Set<string> {
  const thin = (b: Bounds) => [0, 1, 2].some((i) => Math.min(reach[1][i], b[1][i]) - Math.max(reach[0][i], b[0][i]) <= REACH);
  return new Set(bodies.filter((b) => boxesMeet(reach, b.bounds) && thin(b.bounds)).map((b) => b.body));
}

/**
 * What the panel says under the list: why OK is off with nothing to work
 * on, or what OK does; a Cut whose extrude only touches every body ticked
 * (`touching`, from `touchingOnly`) says it cuts nothing and may point the
 * wrong way, as OK's question will.
 */
export function operationNote(operation: "join" | "cut" | "intersect", list: readonly BodyChoice[], touching: ReadonlySet<string> = new Set()): { text: string; ready: boolean } {
  const ticked = list.filter((b) => b.ticked);
  if (list.length === 0) return { text: "The extrude reaches no body yet: change the distance or the profile, or pick New body.", ready: false };
  if (ticked.length === 0) return { text: `Tick a body to ${operation === "join" ? "join to" : operation}.`, ready: false };
  const names = ticked.map((b) => b.label);
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  if (operation === "cut" && ticked.every((b) => touching.has(b.body))) return { text: `The extrude only touches ${listed}, so it cuts nothing: it may point the wrong way (Flip turns it round).`, ready: true };
  const text =
    operation === "join"
      ? `The extrude is joined to ${listed}${ticked.length > 1 ? ", all into the first" : ""}.`
      : operation === "cut"
        ? `The extrude is cut from ${listed}.`
        : `Only what ${listed} ${ticked.length > 1 ? "each share" : "shares"} with the extrude is kept.`;
  return { text, ready: true };
}
