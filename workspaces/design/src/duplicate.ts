// Duplicate body (step 35e2, Ben 2026-10-25: "Duplicate body"): a timeline
// item that copies one body where it is at the Duplicate's place in the
// timeline. The copy is a body of its own ("body:<the Duplicate>", numbered
// like any), so it can be moved, combined, sketched on, hidden or exported
// like the body it came from; it follows its source's sizes (an edit to the
// source changes the copy too) but nothing done to the source after the
// Duplicate. Picking several bodies makes one Duplicate each, in one undo
// step. The document change is `insertDuplicates`, a pure function; the
// rebuild builds the copy (rebuild.ts `copyBody`).
//
// Mirror body (step 35e2) is a Duplicate whose `mirror` names an origin
// plane ("XY", "XZ" or "YZ"): the copy is the body's mirror image across it
// (a mirrored body, kernel 0.33.40, inside out never: the kernel turns its
// faces round). Its faces keep the names they had ("side:line-2" is the
// same side, now on the other hand), so what was sketched on the source is
// found on the copy the same way. A face of the body as the plane comes
// later (with step 59's construction planes).

import type { Feature, Motion } from "@fission/core";
import { bodyIdOf, bodyItem, counted, freshName, insertAt, insertItem, isDuplicateItem, isPiece, makesBody, numberBodies, shown, SKETCH_PLANES, takenNames, type DesignDocument, type SketchPlane } from "./document.ts";

/** The undo step new Duplicates are recorded as. */
export const DUPLICATE_STEP = "Duplicate bodies";

/** The undo step new mirrored copies are recorded as. */
export const MIRROR_STEP = "Mirror bodies";

/** What a Duplicate's summary and the timeline row say: "Copy of Box 1", or a Mirror's "Mirror of Box 1 across the XY plane". */
export const duplicateSummary = (source: string, mirror?: SketchPlane): string => (mirror === undefined ? `Copy of ${source}` : `Mirror of ${source} across the ${mirror} plane`);

/** The origin plane Duplicate `f` mirrors its copy across (Mirror body), or undefined for a plain copy. */
export const mirrorOf = (f: Feature): SketchPlane | undefined => f.intent.parameters.mirror as SketchPlane | undefined;

/** The unit normal of each origin plane: the axis it doesn't hold. */
const PLANE_NORMALS: Record<SketchPlane, [number, number, number]> = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] };

/** What the kernel is asked to do to a copy mirrored across origin plane `plane`: reflect it in the plane through the origin square to the axis the plane doesn't hold. */
export const mirrorMotion = (plane: SketchPlane): Motion => ({ mirror: { point: [0, 0, 0], normal: [...PLANE_NORMALS[plane]] } });

/** Whether the design numbers body `id` (a Combine's piece is a body once `bodies` lists it). */
const numbered = (doc: DesignDocument, id: string): boolean => (doc.bodies ?? []).some((b) => b.id === id);

/**
 * The design with a Duplicate of each of `bodies` (body ids) put in at the
 * marker, in the order given ("Copy 1", "Copy 2"…, ids from the counter),
 * and their ids, each Duplicate's copy being `bodyIdOf` its id. Refused,
 * changing nothing, unless each is a body made before the marker, each
 * picked once, at least one.
 */
export function insertDuplicates(doc: DesignDocument, bodies: readonly string[], mirror?: SketchPlane): { doc: DesignDocument; ids: string[] } {
  if (mirror !== undefined && !SKETCH_PLANES.includes(mirror)) throw new Error(`${shown(mirror)} is not an origin plane (XY, XZ or YZ)`);
  if (bodies.length === 0) throw new Error(mirror === undefined ? "pick at least one body to duplicate" : "pick at least one body to mirror");
  const end = insertAt(doc);
  const sources = bodies.map((b, i) => {
    const item = bodyItem(b);
    if (item === null) throw new Error(`${shown(b)} is not a body id`);
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    const at = doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[at];
    if (f === undefined || !(isPiece(b) ? numbered(doc, b) : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (at >= end) throw new Error(`${f.provenance.self.label} comes after the rollback marker, so a copy put in at the marker can't be made of it`);
    return f;
  });
  let next = doc;
  const ids: string[] = [];
  for (const [i, source] of sources.entries()) {
    const id = `feature-${next.nextId}`;
    // Copies count the copies, Mirrors the Mirrors.
    const label = freshName(mirror === undefined ? "Copy" : "Mirror", next.timeline.features.filter((f) => isDuplicateItem(f) && (mirrorOf(f) === undefined) === (mirror === undefined)).length, takenNames(next));
    const name = isPiece(bodies[i]) ? `a piece of ${source.provenance.self.label}` : source.provenance.self.label;
    const feature: Feature = {
      id,
      intent: { type: "duplicate", parameters: mirror === undefined ? { body: bodies[i] } : { body: bodies[i], mirror }, summary: duplicateSummary(name, mirror) },
      provenance: { self: { workspace: "design", id, label }, from: [{ workspace: "design", id: source.id, label: source.provenance.self.label }] },
      dependsOn: [source.id],
      suppressed: false,
    };
    next = { ...next, nextId: counted(next.nextId + 1), timeline: insertItem(next, feature) };
    ids.push(id);
  }
  // Each copy numbered as it appears, in the same undo step (`numberBodies`).
  return { doc: numberBodies(next), ids };
}

/** The copies `insertDuplicates` made, by body id, in order: what the Move panel opens on next. */
export const copiesOf = (ids: readonly string[]): string[] => ids.map(bodyIdOf);

/**
 * Copy and paste of bodies (Ctrl+C, Ctrl+V; missing basics): Copy puts this
 * text on the clipboard, naming the bodies and the design they came from
 * (`design`, a token the open design draws once), and Paste reads it back
 * as a Duplicate of each. Text, so copying anything else after replaces it
 * and Paste then pastes that instead, as everywhere else.
 */
export function copiedText(design: string, bodies: readonly string[]): string {
  if (!/^[a-z0-9]+$/.test(design)) throw new Error(`${shown(design)} is not a design token`);
  return `SpindleLabs bodies ${design}: ${bodies.join(" ")}`;
}

/** The bodies `copiedText` names when it was copied from design `design`; null for any other text (another design's bodies, or none). */
export function pastedBodies(text: string, design: string): string[] | null {
  const m = /^SpindleLabs bodies ([a-z0-9]+): (body:\S+(?: body:\S+)*)$/.exec(text);
  return m === null || m[1] !== design ? null : m[2].split(" ");
}
