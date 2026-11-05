// Extrude a flat face of a body, with no sketch drawn first (UX1c, Fusion's
// press-pull from a face; Ben, 2026-10-26). A click on a flat face while
// Extrude is open puts a sketch on that face (sketch.ts `addFaceSketch`,
// the frame Create sketch on a face would give it) holding every edge of
// the face projected (`projectEdges`, each live-linked to its edge by
// name, 27d), and Extrude extrudes that sketch. So the face's outline is
// exact and follows the face through edits upstream with the naming rules
// already proved for face sketches and projections; the timeline shows the
// sketch and the extrude (Fusion shows only the extrude: a known
// difference, to revisit with regions at step 48). Until Combine (35f) the
// extrude is a new body, which the panel says.

import type { KernelCalls, Outline, Plane } from "@fission/core";
import type { DesignDocument, Sketch } from "./document.ts";
import { sketchSpot } from "./face-pick.ts";
import { projectPick } from "./projection.ts";
import { regionOutline, regionRef, sketchRegions, type RegionRef } from "./regions.ts";
import { sceneHit, type Scene } from "./scene.ts";
import { addFaceSketch, projectEdges, sketchPlane } from "./sketch.ts";

/** A flat face Extrude can use: the design with the face's sketch in it (not yet recorded), that sketch, where it lies and what the panel calls it. */
export interface FaceProfile {
  /** The face's name, as a reference names it ("face:feature-2/end"): its id among the outlines offered. */
  face: string;
  /** The design the face was offered in: the profile is out of date once the design changes. */
  from: DesignDocument;
  doc: DesignDocument;
  sketch: string;
  plane: Plane;
  label: string;
  /** The face's exact area (mm²) and centroid in the world, from its body's view: what tells its region from the holes' (48d2). */
  area: number;
  centroid: [number, number, number];
  /** A face with holes: the region of its sketch that is the face (`faceRegion`), which its extrude saves; none for a face of one outline, extruded as before. */
  region?: RegionRef;
}

/** What a click on a curved face says while Extrude is open. */
export const CURVED_EXTRUDE = "Only flat faces can be extruded, and this face is curved: pick a flat face or a closed sketch.";

/** Why a flat face whose edges make no region that is the face is not offered (`why`: the kernel's or the app's words). */
export const faceOpen = (why: string) => `This face's edges don't make one closed outline (${why}), so it can't be extruded.`;

/** What a face says when two regions of its edges are each as big as it and centred where it is (a ring round a disc of the same area): never guessed. */
export const FACE_TWO_REGIONS = "two regions of its edges match it";

/**
 * How near a region of a face's edges must be to the face to be it (48d2):
 * its area within FACE_MATCH of the face's (relative) and its centroid
 * within FACE_MATCH · √area (the face's size) of the face's. Both are exact
 * from the kernel, from the same edges, so they agree to rounding; the
 * other regions (a hole's inside) differ by at least a hole's area.
 */
export const FACE_MATCH = 1e-6;

/** Whether a region of area `area` and centroid `c` (world mm) is the face of area `faceArea` and centroid `faceC`. */
export function matchesFace(area: number, c: readonly number[], faceArea: number, faceC: readonly number[]): boolean {
  const size = Math.sqrt(Math.abs(faceArea));
  return Math.abs(area - faceArea) <= FACE_MATCH * Math.abs(faceArea) && Math.hypot(c[0] - faceC[0], c[1] - faceC[1], c[2] - faceC[2]) <= FACE_MATCH * size;
}

/** A point (x, y) of a sketch on `plane` in the world: origin + x·xAxis + y·(normal × xAxis). */
export function onPlane(plane: Plane, [x, y]: readonly [number, number]): [number, number, number] {
  const [o, a, n] = [plane.origin, plane.xAxis, plane.normal];
  const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  return [o[0] + x * a[0] + y * b[0], o[1] + x * a[1] + y * b[1], o[2] + x * a[2] + y * b[2]];
}

/**
 * The region of a face's sketch that is the face itself (48d2): of the
 * regions its projected edges make (the face, with its holes, and each
 * hole's inside), the one whose area and centroid are the face's
 * (`matchesFace`), with what an extrude of it saves. So a face with holes
 * extrudes with its holes, as in Fusion. Refused in words when none or two
 * match, or the one that does can't be extruded.
 */
export async function faceRegion(kernel: KernelCalls, face: Pick<FaceProfile, "area" | "centroid" | "plane">, sketch: Sketch): Promise<{ outline: Outline; ref: RegionRef } | { refused: string }> {
  const found = await sketchRegions(kernel, sketch);
  const matched = found.regions.filter((r) => matchesFace(r.area, onPlane(face.plane, r.centroid), face.area, face.centroid));
  if (matched.length === 0) return { refused: faceOpen(found.why ?? "no region of its edges is the face") };
  if (matched.length > 1) return { refused: faceOpen(FACE_TWO_REGIONS) };
  const r = matched[0];
  if (!r.extrudes) return { refused: faceOpen(r.refused ?? "its region can't be extruded") };
  return { outline: regionOutline(r), ref: regionRef(r, found.ids) };
}

/** What the panel says about a face's extrude, after its outline is found closed. */
export const FACE_NEW_BODY = "Joining the new body to the one under the face comes with the Combine tool.";

/** The words for face `face` of the body `feature` built (its label). */
export const faceLabel = (featureLabel: string) => `Face of ${featureLabel}`;

/**
 * The face `face` (the scene's joined numbering) as something Extrude can
 * use: a sketch on it holding all its edges, put in at the marker of `doc`.
 * Refused in words for a curved face, a face with no name of its own, a
 * body after the marker, or a face with an edge that can't be projected
 * (all or nothing: a face missing an edge would extrude the wrong shape).
 * Null for no face of a body on screen.
 */
export function faceProfile(doc: DesignDocument, scene: Scene | null, face: number): FaceProfile | { refused: string } | null {
  const spot = sketchSpot({ face, shift: false }, scene);
  if (spot === null || spot.kind === "plane") return null;
  if (spot.kind === "refused") return { refused: spot.message.startsWith("Sketches go on flat faces") ? CURVED_EXTRUDE : spot.message.replace("a sketch on it could not follow it: pick another face or a plane", "an extrude of it could not follow it: pick another face or a closed sketch") };
  let made: { doc: DesignDocument; id: string };
  try {
    made = addFaceSketch(doc, spot.face, spot.drawn);
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) };
  }
  const plane = sketchPlane(made.doc, made.id);
  const picked = projectPick(made.doc, made.id, scene, plane, { face });
  if (picked.note !== null || picked.edges.length === 0) return { refused: picked.note ?? "This face has no edges to extrude." };
  const projected = projectEdges(made.doc, made.id, picked.edges);
  const featureLabel = doc.timeline.features.find((f) => f.id === spot.face.feature)?.provenance.self.label ?? spot.face.feature;
  const hit = sceneHit(scene!, "face", face)!;
  const view = scene!.bodies[hit.body].view;
  const c = view.face_centroids[hit.index];
  return { face: spot.face.plane, from: doc, doc: projected.doc, sketch: made.id, plane, label: faceLabel(featureLabel), area: view.face_areas[hit.index], centroid: [c[0], c[1], c[2]] };
}
