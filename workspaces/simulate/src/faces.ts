// A study looked up on the design as it is now (step T1): the body's faces
// and where every face the study holds is, asked of the geometry's owner
// through core's registry (`facesOf`, Design's face finder), never worked
// out here. Each hold or load whose face the last edit took away or split
// says so in words; nothing is dropped or moved to a guess.

import type { BodyFaces, FaceFound, Project, RepresentationRegistry } from "@fission/core";
import { studyFaces, type HeldFace, type Study } from "./study.ts";

/** Who owns the geometry a study points at. */
export const GEOMETRY_OWNER = "design";

/** A study on the design now: the body's faces, each held face's place (by its stable id), and the words for every face that can't be followed. */
export interface StudyNow {
  faces: BodyFaces;
  /** Stable id → where it is now. */
  found: ReadonlyMap<string, FaceFound>;
  /** One sentence per hold or load face that can't be followed, in the study's order (holds, then loads). */
  lost: string[];
}

/** Why one held face can't be followed, in words; null when it is found. */
export function lostWords(owner: string, face: HeldFace, found: FaceFound): string | null {
  if (found.status === "found") return null;
  if (found.status === "shared") return `${owner} is on ${face.label}, which now matches ${found.count} faces after the last edit, so it was not moved to any of them: pick the face you mean again.`;
  return `${owner} lost its face ${face.label}: ${found.why}. Pick a face again or take this one off.`;
}

/** The words for every lost or shared face of the study, holds first ("Held here"), then each load ("Load 2"). */
export function studyLost(study: Study, found: ReadonlyMap<string, FaceFound>): string[] {
  const out: string[] = [];
  const say = (owner: string, faces: readonly HeldFace[]) => {
    for (const f of faces) {
      const where = found.get(f.ref.id);
      const w = where === undefined ? `${owner} lost its face ${f.label}: it was not looked up.` : lostWords(owner, f, where);
      if (w !== null) out.push(w);
    }
  };
  for (const f of study.fixtures) say("Held here", f.faces);
  for (const [i, l] of study.loads.entries()) say(`Load ${i + 1}`, l.faces);
  return out;
}

/**
 * The study's body and faces now, from its owner; refused in words for a
 * study with no body, or a body the design doesn't show or build now.
 */
export async function studyNow(registry: RepresentationRegistry, project: Project, study: Study): Promise<StudyNow | { refused: string }> {
  if (study.body === null) return { refused: "Pick a body to test." };
  const held = studyFaces(study);
  let faces: BodyFaces;
  try {
    faces = await registry.facesOf(GEOMETRY_OWNER, project, study.body.ref, held.map((h) => h.ref));
  } catch (e) {
    return { refused: `${study.body.label} can't be tested now: ${e instanceof Error ? e.message : String(e)}.` };
  }
  const found = new Map(held.map((h, i) => [h.ref.id, faces.found[i]] as const));
  return { faces, found, lost: studyLost(study, found) };
}
