// What a rebuild's body (rebuild.ts `BuiltBody`) is called and where it
// sits, for the scene and the rebuild alike (step 35f1: a Combine's result
// has no spec, so both are read from what its Combine left). Its own file
// so the scene needs nothing of the rebuild but its types.

import type { BodyHandle, BodyView, BooleanResult, Plane } from "@fission/core";
import { bodyFrame } from "./face-sketch.ts";
import { featureBody, type NamedBody } from "./boolean-names.ts";
import { featureNames, type BodyNames } from "./naming.ts";
import type { BuiltBody } from "./rebuild.ts";

/** Where the Moves so far put a plain body's own frame (face-sketch.ts `bodyFrame`); null for a Combine's result, whose faces each have their own (`frameOfFace`). */
export const frameOfBody = (b: BuiltBody): Plane | null => (b.spec === null ? null : bodyFrame(b.spec));

/**
 * Where the Moves so far put the frame face `face` is carried by (35e2h,
 * 35f1e2): a plain body's own; on a Combine's result, the frame of the
 * input body the face came from, so a sketch on a face from a tool is not
 * carried by the target's Moves. Null: not moved.
 */
export const frameOfFace = (b: BuiltBody, face: number): Plane | null => (b.spec === null ? (b.frames?.[face] ?? null) : bodyFrame(b.spec));

/**
 * A Combine's result body's face frames (BuiltBody `frames`) from its
 * history: each face's first origin's (`h.faces`; a face merged from
 * several takes the first's, the target's before a tool's), read on the
 * input body with that handle (`inputs`). Undefined when none moved.
 */
export function framesOfResult(h: BooleanResult["history"][number] | undefined, inputs: ReadonlyMap<BodyHandle, BuiltBody>): (Plane | null)[] | undefined {
  const frames = (h?.faces ?? []).map((from) => {
    const input = inputs.get(from.body);
    return input === undefined ? null : frameOfFace(input, from.face);
  });
  return frames.some((f) => f !== null) ? frames : undefined;
}

/** A shown body's frame for face `face` (scene.ts `ShownBody`): per face on a Combine's result, else the body's. */
export const shownFrame = (b: { frame?: Plane; frames?: readonly (Plane | null)[] }, face: number): Plane | undefined => (b.frames ? (b.frames[face] ?? undefined) : b.frame);

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

/**
 * A face name of a Combine's result as a Duplicate `dup` of it names that
 * face (35f1f2c): the copy's faces are the Duplicate's own, as a plain
 * copy's are, and each keeps its role, with the feature it came from (and
 * its curve) as its id, so two inputs' faces of one role stay apart:
 * "face:feature-1/top" as "face:<dup>/top:feature-1",
 * "face:feature-2/side:line-4" as "face:<dup>/side:feature-2~line-4". "~"
 * is in no feature id, so no two names read the same.
 */
export function copiedFaceName(name: string, dup: string): string {
  const m = /^face:([^/]+)\/([a-z]+)(?::(.+))?$/.exec(name);
  if (m === null) throw new Error(`not a face name Design makes: ${JSON.stringify(name)}`);
  const [, feature, role, curve] = m;
  return `face:${dup}/${role}:${curve === undefined ? feature : `${feature}~${curve}`}`;
}

/** A Combine's result's names (BuiltBody `named`) as Duplicate `dup`'s copy of it holds them (`copiedFaceName`). */
export function copiedNames(named: NonNullable<BuiltBody["named"]>, dup: string): NonNullable<BuiltBody["named"]> {
  return {
    // A merged face's origins (SL #502) are the original's, in its place: a copy names the face by its first name.
    faces: named.faces.map((f) => ({ names: f.names.map((n) => copiedFaceName(n, dup)) })),
    made: new Map([...named.made].map(([n, order]) => [copiedFaceName(n, dup), order])),
  };
}
