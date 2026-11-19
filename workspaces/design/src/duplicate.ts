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
// found on the copy the same way. From step 59a3 the plane can be a
// construction plane ("construct:feature-7", behind ?construct): the Mirror
// then depends on the construction too (after the body's item), so it is
// greyed with it, can't go before it, and follows it when an edit before
// moves the plane.

import type { Feature, Motion } from "@fission/core";
import { bodyIdOf, bodyItem, constructOf, counted, freshName, insertAt, insertItem, isConstructItem, isDuplicateItem, isPiece, makesBody, numberBodies, numberedWhenBuilt, shown, SKETCH_PLANES, takenNames, type DesignDocument, type SketchPlane } from "./document.ts";
import { CONSTRUCT_KINDS, CONSTRUCT_REF, constructPlaneItem, type ConstructAnswer } from "./construct-data.ts";

/** What a Mirror mirrors across: an origin plane, or (step 59a3) a construction plane by its name, "construct:feature-7". */
export type MirrorPlane = SketchPlane | `${typeof CONSTRUCT_REF}${string}`;

/** The undo step new Duplicates are recorded as. */
export const DUPLICATE_STEP = "Duplicate bodies";

/** The undo step new mirrored copies are recorded as. */
export const MIRROR_STEP = "Mirror bodies";

/**
 * What a Duplicate's summary and the timeline row say: "Copy of Box 1", or a
 * Mirror's "Mirror of Box 1 across the XY plane", or across a construction
 * plane by its name ("Mirror of Box 1 across Plane 1").
 */
export const duplicateSummary = (source: string, mirror?: MirrorPlane, planeName?: string): string => (mirror === undefined ? `Copy of ${source}` : planeName !== undefined ? `Mirror of ${source} across ${planeName}` : `Mirror of ${source} across the ${mirror} plane`);

/** The plane Duplicate `f` mirrors its copy across (Mirror body): an origin plane or a construction plane's name; undefined for a plain copy. */
export const mirrorOf = (f: Feature): MirrorPlane | undefined => f.intent.parameters.mirror as MirrorPlane | undefined;

/** The unit normal of each origin plane: the axis it doesn't hold. */
const PLANE_NORMALS: Record<SketchPlane, [number, number, number]> = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] };

/**
 * What the kernel is asked to do to a copy mirrored across `plane`: an
 * origin plane reflects it in the plane through the origin square to the
 * axis the plane doesn't hold; a construction plane's answer (`answer`, the
 * plane as the rebuild found it) in that plane, through its foot point with
 * its normal.
 */
export function mirrorMotion(plane: MirrorPlane, answer?: ConstructAnswer): Motion {
  if ((SKETCH_PLANES as readonly string[]).includes(plane)) return { mirror: { point: [0, 0, 0], normal: [...PLANE_NORMALS[plane as SketchPlane]] } };
  if (answer?.kind !== "plane") throw new Error(`${shown(plane)} is mirrored across with no plane answered for it`);
  return { mirror: { point: [...answer.point], normal: [...answer.normal] } };
}

/** Why `plane` can't be a new Mirror's plane in `doc` (a construction plane: one before the marker, not suppressed), in words, or null. */
export function mirrorPlaneProblem(doc: DesignDocument, plane: string): string | null {
  if ((SKETCH_PLANES as readonly string[]).includes(plane)) return null;
  const item = constructPlaneItem(plane);
  if (item === null) return `${plane} is not an origin plane (XY, XZ or YZ) or a construction plane`;
  const at = doc.timeline.features.findIndex((f) => f.id === item);
  const f = doc.timeline.features[at];
  if (f === undefined || !isConstructItem(f) || CONSTRUCT_KINDS[constructOf(f).make].makes !== "plane") return `${JSON.stringify(plane)} is not a construction plane in the design`;
  if (at >= insertAt(doc)) return `${f.provenance.self.label} comes after the rollback marker, so a Mirror put in at the marker can't use it`;
  if (f.suppressed) return `${f.provenance.self.label} is suppressed: turn it back on to mirror across it`;
  return null;
}

/** Whether the design numbers body `id` (a Combine's piece is a body once `bodies` lists it). */
const numbered = (doc: DesignDocument, id: string): boolean => (doc.bodies ?? []).some((b) => b.id === id);

/**
 * The design with a Duplicate of each of `bodies` (body ids) put in at the
 * marker, in the order given ("Copy 1", "Copy 2"…, ids from the counter),
 * and their ids, each Duplicate's copy being `bodyIdOf` its id. Refused,
 * changing nothing, unless each is a body made before the marker, each
 * picked once, at least one.
 */
export function insertDuplicates(doc: DesignDocument, bodies: readonly string[], mirror?: MirrorPlane): { doc: DesignDocument; ids: string[] } {
  const problem = mirror === undefined ? null : mirrorPlaneProblem(doc, mirror);
  if (problem !== null) throw new Error(problem);
  const across = mirror === undefined ? null : constructPlaneItem(mirror);
  const plane = across === null ? undefined : doc.timeline.features.find((f) => f.id === across)!;
  if (bodies.length === 0) throw new Error(mirror === undefined ? "pick at least one body to duplicate" : "pick at least one body to mirror");
  const end = insertAt(doc);
  const sources = bodies.map((b, i) => {
    const item = bodyItem(b);
    if (item === null) throw new Error(`${shown(b)} is not a body id`);
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    const at = doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[at];
    if (f === undefined || !(numberedWhenBuilt(b, f) ? numbered(doc, b) : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
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
      intent: { type: "duplicate", parameters: mirror === undefined ? { body: bodies[i] } : { body: bodies[i], mirror }, summary: duplicateSummary(name, mirror, plane?.provenance.self.label) },
      provenance: { self: { workspace: "design", id, label }, from: [{ workspace: "design", id: source.id, label: source.provenance.self.label }, ...(plane ? [{ workspace: "design" as const, id: plane.id, label: plane.provenance.self.label }] : [])] },
      // The body's item first (rebuild.ts `copyBody` reads it there), then the construction mirrored across (59a3).
      dependsOn: plane === undefined ? [source.id] : [source.id, plane.id],
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
 * and Paste then pastes that instead, as everywhere else. Each body is
 * written with its item's kind and name as copied (`bodyMark`): the token
 * stays through Undo, and an item made after an Undo takes the id of the one
 * undone, so the id alone pasted a copy of a different body (Undo hunt
 * 2026-11-12, #623: a sphere copied, undone, a cylinder inserted, Ctrl+V).
 */
export function copiedText(design: string, bodies: readonly string[], doc: DesignDocument): string {
  if (!/^[a-z0-9]+$/.test(design)) throw new Error(`${shown(design)} is not a design token`);
  return `SpindleLabs bodies ${design}: ${bodies.map((b) => `${b}=${bodyMark(doc, b)}`).join(" ")}`;
}

/** What tells body `body`'s item from another that later takes its id: its kind and its name, with no space in it; "" when the design has no such item. */
function bodyMark(doc: DesignDocument, body: string): string {
  const item = bodyItem(body);
  const f = doc.timeline.features.find((x) => x.id === item);
  return f === undefined ? "" : encodeURIComponent(`${f.intent.type} ${f.provenance.self.label}`);
}

/**
 * The bodies `copiedText` names when it was copied from design `design`, as
 * `doc` still has them; null for any other text (another design's bodies, or
 * none) and when any of them is no longer the item that was copied (gone, or
 * another in its place).
 */
export function pastedBodies(text: string, design: string, doc: DesignDocument): string[] | null {
  const m = /^SpindleLabs bodies ([a-z0-9]+): (body:[^\s=]+=\S+(?: body:[^\s=]+=\S+)*)$/.exec(text);
  if (m === null || m[1] !== design) return null;
  const bodies = m[2].split(" ").map((b) => b.split("="));
  return bodies.every(([id, mark]) => bodyMark(doc, id) === mark) ? bodies.map(([id]) => id) : null;
}
