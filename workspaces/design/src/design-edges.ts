// Pins and projections on a Combine's result (step 35f1f2b).
//
// A plain body's edges are named by its own item (naming.ts: "side:line-4+top"),
// and a sketch's pin or projection holds that part with the item in its
// `feature`. A Combine's result has no item of its own to name its edges by:
// they are named across the whole design by rule 5 (boolean-names.ts
// `designNames`: "edge:<full face>+<full face>", with ";ends:" when two edges
// anywhere share the two faces). A pin or projection on one holds that rule 5
// name, escaped so it holds no "/" (or "&", which joins a vertex's edges), after
// DESIGN_EDGE: "design:face%3Afeature-1%2Ftop%2Bface%3Afeature-3%2Fside%3Aline-2".
// Its `feature` stays the Combine's item, whose result the pin is on.
//
// The screen names the edges over the finished design, the rebuild over the
// bodies built before the sketch: so a held name is found again by rule 5's
// own reading (`resolveEdgeName`: by its two faces, then the faces at its ends),
// never by matching the text, and is found only on the Combine's result the pin
// names. A name now on two edges, or on none, holds the point where it was with a
// warning ("point-ambiguous", "point-lost"), never guessed.

import type { DesignNames, NameFound } from "./boolean-names.ts";
import { resolveEdgeName } from "./boolean-names.ts";
import type { BodyNames } from "./naming.ts";

/** What a held edge name of a Combine's result starts with. */
export const DESIGN_EDGE = "design:";

/** Rule 5's name `name` ("edge:…") as a pin or projection holds it: "design:" and the rest escaped. */
export function heldEdgeName(name: string): string {
  if (!name.startsWith("edge:")) throw new Error(`not a rule 5 edge name: ${JSON.stringify(name)}`);
  return DESIGN_EDGE + encodeURIComponent(name.slice("edge:".length));
}

/** Rule 5's name a held one stands for; null for one that isn't held so ("design:" and escaped text). */
export function ruleFiveName(held: string): string | null {
  if (!held.startsWith(DESIGN_EDGE)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(held.slice(DESIGN_EDGE.length));
  } catch {
    return null; // a broken escape ("%E0"): written by hand, never by SpindleLabs
  }
  return rest.length === 0 ? null : `edge:${rest}`;
}

/** Each edge of body `at` of the design as a pin or projection would hold it; null where rule 5 gives it no name. */
export function heldEdgeNames(names: DesignNames, at: number): (string | null)[] {
  return (names.edges[at] ?? []).map((e) => (e?.name == null ? null : heldEdgeName(e.name)));
}

/** Whether a pin's or projection's name is a Combine result's (any one of a vertex's edges is). */
export const isHeldDesignName = (name: string): boolean => name.split("&").some((part) => part.startsWith(DESIGN_EDGE));

/**
 * A held edge name on the design now: the body rule 5 finds its edge on
 * (any body: the screen and the rebuild name every body's edges so) and the
 * name that edge is held by now in `heldEdgeNames(names, body)`; or why
 * not: "point-ambiguous" when rule 5 finds two or more alike, "point-lost"
 * when it finds none or the name isn't one.
 */
export function edgeNow(held: string, names: DesignNames): { body: number; name: string } | { cause: "point-lost" | "point-ambiguous" } {
  const rule5 = ruleFiveName(held);
  if (rule5 === null) return { cause: "point-lost" };
  const found: NameFound = resolveEdgeName(names, rule5);
  if ("ambiguous" in found) return { cause: "point-ambiguous" };
  if ("lost" in found) return { cause: "point-lost" };
  const now = names.edges[found.body]?.[found.index]?.name;
  return now == null ? { cause: "point-ambiguous" } : { body: found.body, name: heldEdgeName(now) };
}

/**
 * A pin's held name (an edge's, or a vertex's: its edges' joined by "&",
 * sorted) on the design now: `edgeNow` for each edge, all on one body,
 * joined and sorted again; or why not: any edge ambiguous makes it
 * ambiguous, else any lost (or edges now on two bodies: they meet nowhere)
 * makes it lost.
 */
export function pinNameNow(name: string, names: DesignNames): { body: number; name: string } | { cause: "point-lost" | "point-ambiguous" } {
  const parts = name.split("&").map((p) => edgeNow(p, names));
  if (parts.some((p) => "cause" in p && p.cause === "point-ambiguous")) return { cause: "point-ambiguous" };
  const now: string[] = [];
  let body = -1;
  for (const p of parts) {
    if ("cause" in p) return { cause: p.cause };
    if (body >= 0 && p.body !== body) return { cause: "point-lost" };
    body = p.body;
    now.push(p.name);
  }
  return { body, name: now.sort().join("&") };
}

/** Body `at`'s names (`own`, naming.ts) with its edges as pins and projections on the design hold them (`heldEdgeNames`), and nothing else said of its edges. */
export function withHeldEdges(own: BodyNames, names: DesignNames, at: number): BodyNames {
  const { ends: _, ...rest } = own;
  return { ...rest, edges: heldEdgeNames(names, at), shared: { faces: own.shared.faces, edges: new Map() } };
}
