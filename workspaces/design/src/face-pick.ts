// Where Create sketch puts a new sketch (step 26d): a click while the
// planes are offered picks an origin plane or a face of a body on screen
// (the viewport hands over the nearer, never an edge). A flat face with a
// name of its own gets a sketch on it, with the frame the naming model's
// rule 8 gives it (face-sketch.ts `drawnOnFace`); a curved face is refused
// in words (the owner's answer Q5: Fusion offers no sketch on a curved
// face), and so is a face whose name another face shares, since a sketch
// on it could not follow it (the face it names would be a guess).

import type { Plane, StableId, ViewportPick } from "@fission/core";
import { faceHolds, type FaceNames } from "./boolean-names.ts";
import { SKETCH_PLANES, type SketchPlane } from "./document.ts";
import { drawnOnFace, faceFeature, worldFrame, type SketchPlacement } from "./face-sketch.ts";
import { shownFrame } from "./built-body.ts";
import { findInScene, sceneHit, shownReference, type Scene } from "./scene.ts";

/** What a click on a curved face says (Q5). */
export const CURVED_FACE = "Sketches go on flat faces or planes, and this face is curved: pick a flat face or a plane.";

/** What a click on a face with no name of its own says. */
export const UNNAMED_FACE = "This face has no name of its own (another face shares it), so a sketch on it could not follow it: pick another face or a plane.";

/** Where a click puts the new sketch: an origin plane, a flat face (its name, its feature and the frame it is drawn with), or nowhere with the words why. */
export type SketchSpot =
  | { kind: "plane"; plane: SketchPlane }
  | { kind: "face"; face: { plane: string; feature: string }; drawn: SketchPlacement }
  | { kind: "refused"; message: string };

/**
 * Where a click while the planes are offered puts the new sketch: the
 * origin plane it names, or the face it hit on the bodies on screen
 * (`scene`, whose joined numbering the pick uses) when that face is flat
 * and has a name; refused with words for a curved face or one with no
 * name. Null when it hit nothing a sketch could go on (empty space, a
 * plane that is not an origin plane, a face of no body on screen).
 */
export function sketchSpot(pick: ViewportPick, scene: Scene | null): SketchSpot | null {
  if (pick.plane != null) return (SKETCH_PLANES as readonly string[]).includes(pick.plane) ? { kind: "plane", plane: pick.plane as SketchPlane } : null;
  if (pick.face === null || scene === null || !Number.isInteger(pick.face) || pick.face < 0) return null;
  const hit = sceneHit(scene, "face", pick.face);
  if (hit === null) return null;
  const body = scene.bodies[hit.body];
  const drawn = drawnOnFace(body.view, hit.index);
  if (drawn === null) return { kind: "refused", message: CURVED_FACE };
  // 35f1e: once a Combine built, by its name across the design (with its tag when it is a piece of a split face), which
  // must find this face again: a piece no tag tells apart from another could not be followed either.
  // SL #502: a face merged from level faces is named by the input face under the click, so the sketch follows that one.
  const ref = clickedReference(scene, hit.body, hit.index, pick) ?? shownReference(scene, hit.body, "face", hit.index);
  const feature = ref === null ? null : faceFeature(ref.id);
  if (ref === null || feature === null) return { kind: "refused", message: UNNAMED_FACE };
  const again = scene.design === undefined ? null : findInScene(ref, scene);
  if (again === null ? feature !== body.feature : again.status !== "found" || again.index !== pick.face) return { kind: "refused", message: UNNAMED_FACE };
  return { kind: "face", face: { plane: ref.id, feature }, drawn: { ...drawn, body: shownFrame(body, hit.index) ?? worldFrame() } };
}

/** The faces of the bodies on screen a sketch can go on (joined numbering, for the viewport to light): the flat ones with a name of their own. */
export function sketchableFaces(scene: Scene | null): number[] {
  if (scene === null) return [];
  const faces: number[] = [];
  scene.bodies.forEach((body, b) => {
    for (let i = 0; i < body.view.faces; i++) if (sketchSpot({ face: scene.faceStart[b] + i, shift: false }, scene)?.kind === "face") faces.push(scene.faceStart[b] + i);
  });
  return faces;
}

/** A point's coordinates in a frame: along its x axis, its y axis (normal × x) and its normal, from its origin. */
function toLocal(f: Plane, p: readonly number[]): [number, number, number] {
  const [x, n] = [f.xAxis, f.normal];
  const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const d = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  const dot = (a: readonly number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  return [dot(x), dot(y), dot(n)];
}

/** The world point with coordinates `l` in frame `f` (`toLocal`'s inverse). */
function fromLocal(f: Plane, l: readonly number[]): [number, number, number] {
  const [x, n] = [f.xAxis, f.normal];
  const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  return [0, 1, 2].map((i) => f.origin[i] + l[0] * x[i] + l[1] * y[i] + l[2] * n[i]) as [number, number, number];
}

const WORLD: Plane = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };

/**
 * The name a click at `point` on a face merged from several level input
 * faces should take (SL #502): the first name of the first input face
 * holding the point as the boolean saw it (the motion of any Move since,
 * `now` against the face's frame then, taken off first); null when the
 * face is no merged one or none holds it.
 */
export function clickedName(face: FaceNames, now: Plane | undefined, point: readonly number[]): string | null {
  if (face.origins === undefined) return null;
  const then = fromLocal(face.frame ?? WORLD, toLocal(now ?? WORLD, point));
  const holding = face.origins.find((o) => o.names.length > 0 && faceHolds(o.view, o.face, then));
  return holding?.names[0] ?? null;
}

/**
 * The reference a click on a merged face takes (`clickedName`), as the
 * design's full name that finds this very face again (with rule 3's tag
 * when another face carries the name too); null to name it as before.
 */
function clickedReference(scene: Scene, body: number, index: number, pick: ViewportPick) {
  const d = scene.design;
  if (d === undefined || pick.point === undefined) return null;
  const at = d.shown.indexOf(body);
  const face = at < 0 ? undefined : d.bodies[at]?.faces[index];
  const name = face === undefined ? null : clickedName(face, shownFrame(scene.bodies[body], index), pick.point);
  if (name === null) return null;
  for (const id of [name, `${name}#${d.names.tagFor(at, index, name).join(",")}`]) {
    const ref = { kind: "face" as const, id: id as StableId };
    const found = findInScene(ref, scene);
    if (found.status === "found" && found.index === pick.face) return ref;
  }
  return null;
}
