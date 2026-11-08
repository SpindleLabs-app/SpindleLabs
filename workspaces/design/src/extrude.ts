// Extrude a sketch (step 21d, docs/document-model.md sections 3 and 6): a
// new extrude feature after the sketch, depending on it, whose intent is
// `{ sketch, distance }`. The outline is never stored: the kernel finds it
// from the sketch's lines every time the feature is built, so an edit to
// the sketch rebuilds the solid (a live link). A sketch that no longer
// closes leaves the extrude its last shape with a warning (the owner's
// rule, step 24d2, rebuild.ts), or fails it with the kernel's reason when
// it never closed.
//
// Every extrude is a new body ("New body", step 24d1) until booleans join
// them: it is added to the timeline at the marker and replaces nothing.

import type { BodySpec, BodyView, ExtrudeArrow, Feature, KernelCalls } from "@fission/core";
import { bodyIdOf, bodyItem, bodyNumbers, combineBodies, COMBINE_OPERATIONS, counted, extrudeOperation, isCombineItem, isDuplicateItem, isMoveItem, freshName, insertAt, insertItem, isPiece, isSketchExtrude, makesBody, makesPieces, numberBodies, numberedWhenBuilt, takenNames, partFeature, shown, specOf, type CombineOperation, type DesignDocument } from "./document.ts";
import { extrudeSpec, type CurveIds } from "./rebuild.ts";
import { sketchItem } from "./sketch.ts";
import { lengthRefused } from "./typed-entry.ts";
import type { RegionRef } from "./regions.ts";

/**
 * How far a new extrude goes until the user drags the arrow or types a
 * distance (mm): 0 (Ben, 2026-10-28: "instead of defaulting to 10mm just
 * start at extrude of 0"), so nothing is built until the user says how far;
 * the arrow stands on the profile, ready to drag.
 */
export const DEFAULT_DISTANCE = 0;

/** What the Extrude panel says when every sketch is after the rollback marker or suppressed, so none is offered. */
export const NO_USABLE_SKETCH = "No sketch can be extruded here: each comes after the rollback marker or is suppressed. Move the marker past one, or unsuppress it.";

/** What the Extrude panel says when the design has no sketch at all. */
export const NO_SKETCH = "There is no sketch to extrude yet: draw one with Create sketch.";

/** What it says while no sketch or face is chosen (UX1b: ✕ cleared it, or none was offered first; UX1c: flat faces too). */
export const PICK_PROFILE_STATUS = "Click a closed sketch or a flat face in the view, or a sketch's row in the browser, to extrude it.";

/** Why an extrude command does nothing with a distance of 0 (UX1b: a negative one goes the other way, so only 0 builds nothing). */
export const ZERO_DISTANCE = "Type a distance other than 0 mm: a negative one goes the other way.";

/** What the Extrude panel's OK says at 0 mm, where Extrude starts (Ben, 2026-10-28): what to do next, in plain words. */
export const ZERO_OK = "Drag the arrow or type a distance first: at 0 mm there is nothing to make. A negative distance goes the other way.";

/** The undo step an extrude is recorded as: "Extrude Sketch 1". */
export const extrudeStep = (doc: DesignDocument, sketchId: string) => `Extrude ${sketchItem(doc, sketchId).provenance.self.label}`;

/** The undo step a typed distance is recorded as, merged per box like the other sizes. */
export const DISTANCE_STEP = "Change extrude distance";

const summary = (sketchLabel: string, distance: number, flip: boolean, f: Feature) => `Extrude ${sketchLabel} by ${distance} mm${flip ? ", flipped" : ""}${operationWords(f)}`;

/** An operation extrude's bodies and what they are called, as it names them (its provenance): an item's name, or "a piece of" the item that made it. */
function bodyWords(f: Feature, bodies: readonly string[]): string[] {
  return bodies.map((b) => {
    const item = bodyItem(b) ?? b;
    const label = f.provenance.from.find((x) => x.id === item)?.label ?? item;
    return isPiece(b) ? `a piece of ${label}` : label;
  });
}

/** The end of an operation extrude's summary: ", joined to Box 1", ", cut from Box 1 and Box 2", ", intersected with Box 1"; nothing for a new body. */
export function operationWords(f: Feature): string {
  const op = extrudeOperation(f);
  if (op === null) return "";
  const names = bodyWords(f, op.bodies);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return op.operation === "join" ? `, joined to ${list}` : op.operation === "cut" ? `, cut from ${list}` : `, intersected with ${list}`;
}

/** Extrude's operation and the bodies it works on (body ids, in the order picked), as the panel hands them in. */
export interface OperationChoice {
  operation: CombineOperation;
  bodies: readonly string[];
}

/** A body's name as the browser shows it ("Body 2"), or undefined when it has no number. */
const numberOf = (doc: DesignDocument, body: string): string | undefined => {
  const n = bodyNumbers(doc).get(body);
  return n === undefined ? undefined : `Body ${n}`;
};

/**
 * The items an operation extrude put in at `end` (the marker's place, or
 * its own) depends on for `bodies`, each once in the order picked: refused
 * for no bodies, a body picked twice, and anything that is no body of the
 * design before `end` (a body an earlier Combine or extrude used up is
 * refused when the extrude is built, in words, as a Combine's is).
 */
function makersFor(doc: DesignDocument, bodies: readonly string[], end: number, at: string): Feature[] {
  if (bodies.length === 0) throw new Error("pick at least one body for the extrude to work on");
  return bodies.map((b, i) => {
    // Named as the browser shows it ("Body 2"), when it has a number (hunt 11-08).
    if (bodies.indexOf(b) !== i) throw new Error(`${numberOf(doc, b) ?? shown(b)} is picked twice`);
    const item = bodyItem(b);
    const place = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[place];
    if (f === undefined || !(numberedWhenBuilt(b, f) ? makesPieces(f) && (doc.bodies ?? []).some((x) => x.id === b) : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (place >= end) throw new Error(`${f.provenance.self.label} comes after ${at} can't use it`);
    return f;
  });
}

/** An extrude's parameters, dependencies and provenance with `choice` (null: a new body), for sketch `sketchId` named `label`. */
function withOperation(base: Feature, sketchId: string, label: string, choice: OperationChoice | null, makers: readonly Feature[]): Feature {
  const { operation: _o, bodies: _b, ...rest } = base.intent.parameters;
  if (choice === null) return { ...base, intent: { ...base.intent, parameters: rest }, dependsOn: [sketchId], provenance: { ...base.provenance, from: base.provenance.from.filter((x) => x.id === sketchId) } };
  const ids = [...new Set(makers.map((m) => m.id))].filter((m) => m !== sketchId);
  const from = [{ workspace: "design" as const, id: sketchId, label }, ...ids.map((id) => ({ workspace: "design" as const, id, label: makers.find((m) => m.id === id)!.provenance.self.label }))];
  return { ...base, intent: { ...base.intent, parameters: { ...rest, operation: choice.operation, bodies: [...choice.bodies] } }, dependsOn: [sketchId, ...ids], provenance: { ...base.provenance, from } };
}

/** Whether an extrude of a sketch goes the other way from its sketch's plane (step 26c; Fusion's Flip). */
export const isFlipped = (f: Feature): boolean => f.intent.parameters.flip === true;

/**
 * The document with an extrude of this sketch by `distance` mm added: a
 * new feature with the next id, put in at the marker (insertItem), which
 * must be after the sketch, depending on the sketch; every feature already
 * there stays. It is named "Extrude n", n one more than the extrudes of
 * sketches there are, skipping a name any item has (`freshName`, U0e). The kernel judges the
 * distance and the outline when the feature is built. `flip` sends it the
 * other way from the sketch's plane, its start cap still on the plane
 * (step 26c, Fusion's Flip). `region` (step 48) names the region of the
 * sketch it extrudes; without it, the sketch's one closed outline.
 */
export function extrudeSketch(doc: DesignDocument, sketchId: string, distance: number, flip = false, region?: RegionRef, choice: OperationChoice | null = null): { doc: DesignDocument; id: string } {
  const sketch = sketchItem(doc, sketchId);
  if (choice !== null && !(COMBINE_OPERATIONS as readonly string[]).includes(choice.operation)) throw new Error(`${shown(choice.operation)} is not join, cut or intersect`);
  const makers = choice === null ? [] : makersFor(doc, choice.bodies, insertAt(doc), "the rollback marker, so an extrude put in at the marker");
  if (!Number.isFinite(distance)) throw new Error(`an extrude needs its distance in mm, not ${shown(distance)}`);
  if (doc.timeline.features.indexOf(sketch) >= insertAt(doc)) throw new Error(`${sketch.provenance.self.label} comes after the rollback marker, so an extrude put in at the marker can't use it`);
  const id = `feature-${doc.nextId}`;
  const label = sketch.provenance.self.label;
  const name = freshName("Extrude", doc.timeline.features.filter(isSketchExtrude).length, takenNames(doc));
  const plain: Feature = {
    id,
    intent: { type: "extrude", parameters: { sketch: sketchId, distance, ...(flip ? { flip: true } : {}), ...(region ? { region } : {}) }, summary: "" },
    provenance: { self: { workspace: "design", id, label: name }, from: [{ workspace: "design", id: sketchId, label }] },
    dependsOn: [sketchId],
    suppressed: false,
  };
  const made = withOperation(plain, sketchId, label, choice, makers);
  const feature: Feature = { ...made, intent: { ...made.intent, summary: summary(label, distance, flip, made) } };
  return { id, doc: numberBodies({ ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) }) };
}

/** The document with an extrude of a sketch (the part, `partFeature`, unless `id` names another) going `distance` mm instead. */
export function setExtrudeDistance(doc: DesignDocument, distance: number, id?: string): DesignDocument {
  const old = id === undefined ? partFeature(doc) : doc.timeline.features.find((f) => f.id === id);
  if (!old) throw new Error(id === undefined ? "the design has no body to change the distance of" : `there is no feature ${shown(id)} in the design`);
  if (!isSketchExtrude(old)) throw new Error(`${old.intent.summary} is not an extrude of a sketch`);
  // Its sketch may be gone (deleted: the extrude keeps its last shape, 24d2); its summary then names it as the extrude remembers it.
  const sketchId = old.intent.parameters.sketch as string;
  const there = doc.timeline.features.some((f) => f.id === sketchId);
  const sketchLabel = there ? sketchItem(doc, sketchId).provenance.self.label : (old.provenance.from.find((p) => p.id === sketchId)?.label ?? sketchId);
  const feature: Feature = { ...old, intent: { ...old.intent, parameters: { ...old.intent.parameters, distance }, summary: summary(sketchLabel, distance, isFlipped(old), old) } };
  return { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } };
}

/**
 * The document with an extrude of a sketch (the part unless `id` names
 * another) flipped (`on`) or not: it goes the other way from its sketch's
 * plane, its start cap staying on the plane (step 26c). `flip` is left out
 * when off, so a file without flips reads as before. The same document
 * back when it already is.
 */
export function setExtrudeFlip(doc: DesignDocument, on: boolean, id?: string): DesignDocument {
  const old = id === undefined ? partFeature(doc) : doc.timeline.features.find((f) => f.id === id);
  if (!old) throw new Error(id === undefined ? "the design has no body to flip" : `there is no feature ${shown(id)} in the design`);
  if (!isSketchExtrude(old)) throw new Error(`${old.intent.summary} is not an extrude of a sketch`);
  if (typeof on !== "boolean") throw new Error(`flipping ${old.provenance.self.label} needs true or false, not ${shown(on)}`);
  if (isFlipped(old) === on) return doc;
  const { flip: _, ...rest } = old.intent.parameters;
  const sketchId = old.intent.parameters.sketch as string;
  const there = doc.timeline.features.some((f) => f.id === sketchId);
  const sketchLabel = there ? sketchItem(doc, sketchId).provenance.self.label : (old.provenance.from.find((p) => p.id === sketchId)?.label ?? sketchId);
  const feature: Feature = { ...old, intent: { ...old.intent, parameters: on ? { ...rest, flip: true } : rest, summary: summary(sketchLabel, old.intent.parameters.distance as number, on, old) } };
  return { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } };
}

/**
 * The document with extrude `id` of a sketch extruding region `region` of
 * its sketch (step 48d4, Edit feature picking another region): the same
 * item, its id, distance, Flip and place kept. The same document back when
 * it already names that region (the same curves, the same way round, the
 * same centroid).
 */
export function setExtrudeRegion(doc: DesignDocument, region: RegionRef, id: string): DesignDocument {
  const old = doc.timeline.features.find((f) => f.id === id);
  if (!old) throw new Error(`there is no feature ${shown(id)} in the design`);
  if (!isSketchExtrude(old)) throw new Error(`${old.intent.summary} is not an extrude of a sketch, so it has no region to pick`);
  if (JSON.stringify(old.intent.parameters.region) === JSON.stringify({ outer: region.outer, centroid: region.centroid })) return doc;
  const feature: Feature = { ...old, intent: { ...old.intent, parameters: { ...old.intent.parameters, region: { outer: region.outer.map((p) => ({ curve: p.curve, reversed: p.reversed })), centroid: [region.centroid[0], region.centroid[1]] } } } };
  return { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } };
}

/**
 * The document with extrude `id` of a sketch made a new body (`choice`
 * null) or joining, cutting or intersecting `choice.bodies` (Edit feature,
 * as Fusion's Extrude panel changes its operation): the same item, its id,
 * name, distance, Flip, region and place kept; its dependencies and
 * provenance its sketch's, then its bodies' items. Refused as a new
 * extrude's choice is, a body made after it counting as one after the
 * marker does. The same document back when nothing changes.
 */
export function setExtrudeOperation(doc: DesignDocument, id: string, choice: OperationChoice | null): DesignDocument {
  const at = doc.timeline.features.findIndex((f) => f.id === id);
  const old = doc.timeline.features[at];
  if (!old) throw new Error(`there is no feature ${shown(id)} in the design`);
  if (!isSketchExtrude(old)) throw new Error(`${old.intent.summary} is not an extrude of a sketch, so it has no operation to change`);
  if (choice !== null && !(COMBINE_OPERATIONS as readonly string[]).includes(choice.operation)) throw new Error(`${shown(choice.operation)} is not join, cut or intersect`);
  const was = extrudeOperation(old);
  if (was === null ? choice === null : choice !== null && was.operation === choice.operation && was.bodies.join() === choice.bodies.join()) return doc;
  const sketchId = old.intent.parameters.sketch as string;
  const there = doc.timeline.features.some((f) => f.id === sketchId);
  const label = there ? sketchItem(doc, sketchId).provenance.self.label : (old.provenance.from.find((p) => p.id === sketchId)?.label ?? sketchId);
  if (choice?.bodies.includes(bodyIdOf(id))) throw new Error(`${old.provenance.self.label} can't join, cut or intersect its own body`);
  const makers = choice === null ? [] : makersFor(doc, choice.bodies, at, `${old.provenance.self.label}, so it`);
  const made = withOperation(old, sketchId, label, choice, makers);
  const feature: Feature = { ...made, intent: { ...made.intent, summary: summary(label, old.intent.parameters.distance as number, isFlipped(old), made) } };
  // The bodies it stops making: its own (a new body becoming Join, Cut or Intersect), or its pieces (back to a new body).
  // A later item working on one of them refuses the change; an eye shut on one goes with it (else the file would not open).
  // A Join's own body (version 16) goes when it stops being a Join: as a new body again it is that body, so it stays.
  const gone = was === null ? [bodyIdOf(id)] : choice === null ? (doc.bodies ?? []).map((b) => b.id).filter((b) => isPiece(b) && bodyItem(b) === id) : was.operation === "join" && choice.operation !== "join" ? [bodyIdOf(id)] : [];
  for (const later of doc.timeline.features.slice(at + 1)) {
    const used = bodiesUsed(later).find((b) => gone.includes(b));
    if (used !== undefined) {
      const name = `Body ${bodyNumbers(doc).get(used) ?? "?"}`;
      throw new Error(`${later.provenance.self.label} uses ${name}, which ${old.provenance.self.label} would no longer make: change or delete ${later.provenance.self.label} first`);
    }
  }
  const eyes: DesignDocument = { ...doc };
  const hidden = doc.hidden?.filter((h) => !gone.includes(h)) ?? [];
  if (hidden.length === 0) delete eyes.hidden;
  else if (hidden.length !== doc.hidden!.length) eyes.hidden = hidden;
  // A Join made a new body again: its own body is that body, which remembers no faces (version 16 keeps them only on a Join's).
  if (choice === null && eyes.bodies?.some((b) => b.id === bodyIdOf(id) && b.faces !== undefined)) eyes.bodies = eyes.bodies.map((b) => (b.id === bodyIdOf(id) ? { id: b.id, number: b.number } : b));
  return numberBodies({ ...eyes, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } });
}

/** The bodies item `f` works on, by body id: a Move's, a Combine's target and tools, a Duplicate's (Combine bug hunt 11-08), an extrude's operation's. */
function bodiesUsed(f: Feature): string[] {
  if (isDuplicateItem(f)) return typeof f.intent.parameters.body === "string" ? [f.intent.parameters.body] : [];
  if (isMoveItem(f)) return Array.isArray(f.intent.parameters.bodies) ? (f.intent.parameters.bodies as string[]) : [];
  if (isCombineItem(f)) {
    const c = combineBodies(f);
    return [c.target, ...c.tools];
  }
  return extrudeOperation(f)?.bodies ?? [];
}

/**
 * The body a feature builds, as the kernel's BodySpec. An extrude of a
 * sketch asks the kernel for the sketch's outline now (never stored), or
 * uses its kept shape (`extrudeSpec`); every other feature is read from
 * its intent alone (specOf).
 */
export async function featureSpec(kernel: KernelCalls, doc: DesignDocument, feature: Feature): Promise<BodySpec> {
  return (await featureBuild(kernel, doc, feature)).spec;
}

/** `featureSpec` with, for an extrude of a sketch, the ids of the curves its outline came from (the kept shape's while its sketch is lost), as `featureNames` takes them. */
export async function featureBuild(kernel: KernelCalls, doc: DesignDocument, feature: Feature): Promise<{ spec: BodySpec; curves?: CurveIds }> {
  if (!isSketchExtrude(feature)) return { spec: specOf(doc, feature) };
  // The owner's rule (rebuild.ts): a lost sketch's extrude is built from its kept shape.
  const made = await extrudeSpec(kernel, doc, feature);
  if ("status" in made) throw new Error(made.message);
  return { spec: made.spec, curves: made.curves };
}

// UX1b, Fusion's feel: the extrude previewed in the view as the distance is
// typed or its arrow dragged, before OK records anything. A distance is
// signed there: negative goes the other way from the sketch's plane, which
// is how OK records it (`extrudeSketch` with |d| and Flip).

/**
 * Why a signed distance can't be previewed or recorded, in the words OK
 * uses (`lengthRefused` on its size: under 0.001 mm or over 1 km), or null.
 * The preview asked the kernel first and showed its 330-character refusal
 * for 1e-320 (extrude hunt 2026-11-01). 0 is not refused here: it is
 * where Extrude starts, building nothing but standing the arrow on the
 * profile, and OK says `ZERO_OK` for it.
 */
export function distanceRefused(signed: number): string | null {
  if (signed === 0) return null;
  const refused = lengthRefused(Math.abs(signed));
  return refused === null ? null : `The distance${refused.slice("A length".length)}`;
}

/** A typed distance as the signed mm it means, or null for one that isn't a number or is 0 (which builds nothing). */
export function signedDistance(typed: string): number | null {
  const d = Number(typed);
  return typed.trim() === "" || !Number.isFinite(d) || d === 0 ? null : d;
}

/**
 * The BodySpec of an extrude going `signed` mm, from the spec of the same
 * extrude going 1 mm unflipped (`base`, `featureSpec`'s, worked out once
 * per profile so a drag never asks for its outline or placement again):
 * |signed| mm, flipped when `signed` is negative. The base's own `flip`
 * (a sketch on a back or bottom face faces into the body, rebuild.ts
 * `placedSpec`) is kept and turned by the sign, so the result is exactly
 * what `featureSpec` gives for `extrudeSketch(doc, sketch, |signed|,
 * signed < 0)`.
 */
export function previewSpec(base: BodySpec, signed: number): BodySpec {
  if (!("extrude" in base)) throw new Error("a preview is of an extrude of a sketch");
  const { flip: baseFlip, ...rest } = base.extrude;
  const flip = (baseFlip === true) !== signed < 0;
  return { extrude: { ...rest, distance: Math.abs(signed), ...(flip ? { flip: true } : {}) } };
}

/**
 * Where the distance arrow goes for a preview built `signed` mm (UX1b):
 * its line starts at the start cap's centroid (on the sketch's plane; a
 * point on the cap when the centroid is off it, `onFace`) and
 * runs the way a positive distance goes, which is from that centroid to
 * the end cap's over `signed` (the end cap is |signed| along the
 * extrude's direction, so for a negative distance the direction turns
 * back). Null for a view without the two caps (not an extrude).
 */
export function arrowOf(view: BodyView, signed: number): ExtrudeArrow | null {
  const start = view.face_roles.findIndex((r) => r?.role === "start");
  const end = view.face_roles.findIndex((r) => r?.role === "end");
  if (start < 0 || end < 0 || !(signed !== 0)) return null;
  const s = view.face_centroids[start], e = view.face_centroids[end];
  const way = [0, 1, 2].map((i) => (e[i] - s[i]) / signed);
  const n = Math.hypot(...way);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const base = onFace(view, start, [s[0], s[1], s[2]]);
  // + 0: a component 0 divided by a negative distance is −0, the same direction.
  return { base, direction: [way[0] / n + 0, way[1] / n + 0, way[2] / n + 0], distance: signed };
}

type Vec3 = [number, number, number];

/** Whether `p`, on the plane of triangle a b c, is inside it or on its sides (barycentric coordinates, a millionth of slack). */
function inTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const d = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const [v0, v1, v2] = [sub(b, a), sub(c, a), sub(p, a)];
  const [d00, d01, d11, d20, d21] = [d(v0, v0), d(v0, v1), d(v1, v1), d(v2, v0), d(v2, v1)];
  const den = d00 * d11 - d01 * d01;
  if (!(den > 0)) return false;
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return v >= -1e-6 && w >= -1e-6 && v + w <= 1 + 1e-6;
}

/**
 * A point on face `face` of the view for the arrow's foot (step 48 hunt):
 * its centroid `c` when that lies on the face, as before; else the centre
 * of the face's triangle nearest it. A plate with a hole has its centroid
 * in the hole, where the arrow stood over the hole's own region, so a
 * click meant to pick the region inside grabbed the arrow instead. A view
 * without a mesh (a test's) keeps the centroid.
 */
function onFace(view: BodyView, face: number, c: Vec3): Vec3 {
  const m = view.mesh;
  if (!m || !Array.isArray(m.triangle_faces) || !Array.isArray(m.indices) || !Array.isArray(m.positions)) return c;
  const at = (i: number): Vec3 => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (let t = 0; t < m.triangle_faces.length; t++) {
    if (m.triangle_faces[t] !== face) continue;
    const [a, b, d] = [at(m.indices[3 * t]), at(m.indices[3 * t + 1]), at(m.indices[3 * t + 2])];
    if (inTriangle(c, a, b, d)) return c;
    const g: Vec3 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
    const dist = Math.hypot(g[0] - c[0], g[1] - c[1], g[2] - c[2]);
    if (dist < bestD) [best, bestD] = [g, dist];
  }
  return best ?? c;
}
