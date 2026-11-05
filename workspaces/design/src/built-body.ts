// What a rebuild's body (rebuild.ts `BuiltBody`) is called and where it
// sits, for the scene and the rebuild alike (step 35f1: a Combine's result
// has no spec, so both are read from what its Combine left). Its own file
// so the scene needs nothing of the rebuild but its types.

import type { BodyView, Plane } from "@fission/core";
import { bodyFrame } from "./face-sketch.ts";
import { featureBody, type NamedBody } from "./boolean-names.ts";
import { featureNames, type BodyNames } from "./naming.ts";
import type { BuiltBody } from "./rebuild.ts";

/** Where the Moves so far put a body's own frame (face-sketch.ts `bodyFrame`): its spec's, or a Combine's result's as its target's was. */
export const frameOfBody = (b: BuiltBody): Plane | null => (b.spec === null ? (b.frame ?? null) : bodyFrame(b.spec));

/**
 * A body's face and edge names on its item (naming.ts `BodyNames`). A
 * Combine's result (35f1) answers there to the names of its item's own
 * faces only, each name on the one face holding it (two holding one are
 * shared, never guessed); its edges are not named yet, nor faces that came
 * from its tools.
 */
export function namesOfBody(b: BuiltBody, view: BodyView): BodyNames {
  if (b.spec !== null) return featureNames(b.feature, { spec: b.spec, curves: b.curves }, view);
  const own = `face:${encodeURIComponent(b.feature)}/`;
  const parts = (b.named?.faces ?? []).map((f) => f.names.find((n) => n.startsWith(own))?.slice(own.length) ?? null);
  const counts = new Map<string, number>();
  for (const n of parts) if (n !== null) counts.set(n, (counts.get(n) ?? 0) + 1);
  const shared = new Map([...counts].filter(([, k]) => k > 1));
  return { feature: b.feature, faces: parts.map((n) => (n !== null && !shared.has(n) ? n : null)), edges: view.edge_faces.map(() => null), shared: { faces: shared, edges: new Map() } };
}

/**
 * A body as boolean-names.ts names it (35f1): a Combine's result with the
 * names its Combine gave; any other with its item's face names (naming.ts),
 * made order its item's place in the timeline (`place`).
 */
export function namedBody(id: string, b: BuiltBody, view: BodyView, place: number): NamedBody {
  if (b.named !== undefined) return { id, handle: b.handle, view, faces: b.named.faces, made: b.named.made };
  return featureBody(id, b.handle, view, featureNames(b.feature, { spec: b.spec!, curves: b.curves }, view), place);
}
