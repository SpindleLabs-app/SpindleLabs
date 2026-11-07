// Design's part of the project: profiles, sketches and the timeline
// (docs/document-model.md).
//
// Version 3 (step 24d1): every solid feature is its own body ("New body",
// until booleans join them), presets are ordinary features with ids from
// the counter, and the rollback marker is saved with the timeline. A new
// item goes in just after the marker and the marker moves onto it, the
// model's rule (packages/testing/src/timeline-model.ts). The part the
// panel edits is the last solid feature that builds (`partFeature`), or
// none: a design with no body (24f4) is one like any other, shown as an
// empty view. Each body is built from its
// feature's intent (specOf), so the intent is the source of truth, not a
// description written next to the geometry.

import type { BodySpec, Feature, Plane } from "@fission/core";
import { NewerFormatError, XY_PLANE } from "@fission/core";
import { faceFeature, isFacePlane, squared, type SketchFace, type SketchPlacement } from "./face-sketch.ts";
import type { SketchPin } from "./face-edges.ts";
import type { SketchProjection } from "./projection.ts";
import { outline, SHAPE_LABELS, type ProfileKind, type ShapeKind } from "./profiles.ts";

/** A ready-made outline on a plane (until the sketcher, step 21, adds sketches next to these). */
export interface ReadyProfile {
  id: string;
  kind: ProfileKind;
  width: number;
  depth: number;
  plane: Plane;
}

/** A sketch point, in mm in the sketch plane's own 2D frame (never world coordinates). */
export interface SketchPoint {
  id: string;
  x: number;
  y: number;
}

/** A sketch line between two of its sketch's points, named by id. */
export interface SketchLineCurve {
  id: string;
  kind: "line";
  start: string;
  end: string;
  /** A construction curve (47f): drawn dashed, left out of the outline, held by constraints and dimensions like any other. Absent for an ordinary curve. */
  construction?: true;
}

/** A sketch circle round one of its sketch's points, named by id, with its radius in mm (step 22b). */
export interface SketchCircleCurve {
  id: string;
  kind: "circle";
  centre: string;
  radius: number;
  /** A construction curve (47f): drawn dashed, left out of the outline, held by constraints and dimensions like any other. Absent for an ordinary curve. */
  construction?: true;
}

/**
 * A sketch arc from one of its sketch's points to another, counter-clockwise
 * round a third, all named by id (step 23a; Fusion's convention). The
 * centre is midway between the ends; the kernel holds that rule.
 */
export interface SketchArcCurve {
  id: string;
  kind: "arc";
  start: string;
  end: string;
  centre: string;
  /** A construction curve (47f): drawn dashed, left out of the outline, held by constraints and dimensions like any other. Absent for an ordinary curve. */
  construction?: true;
}

/**
 * A sketch constraint (step 47d2), on points by id: horizontal or vertical
 * keeps two points level or upright (a line's two ends when a line is
 * picked), coincident keeps two points in one place, fix holds a point
 * where it is. The sketch's points are always stored solved
 * (constraints.ts), so a fix needs no value of its own. Kept in the order
 * they were made, oldest first (the solver blames the oldest that fights).
 */
export type SketchConstraint =
  | { id: string; kind: "horizontal" | "vertical" | "coincident"; a: string; b: string }
  | { id: string; kind: "fix"; point: string }
  | SketchDistance
  | SketchDiameter;

/**
 * A dimension (step 47e): two points `value` mm apart, a line's length
 * (its start and end), the distance between two points, or an arc's
 * radius (its centre and start). Solved by the kernel with the others.
 */
export interface SketchDistance {
  id: string;
  kind: "distance";
  a: string;
  b: string;
  value: number;
}

/** A circle's diameter dimension (step 47e): the circle's radius is `value` / 2, and the solver counts one freedom fewer. */
export interface SketchDiameter {
  id: string;
  kind: "diameter";
  circle: string;
  value: number;
}

/** The smallest and largest dimension (mm): the kernel's MIN_FEATURE and the modelling range's width, as the solver takes them. */
export const DIMENSION_LIMITS = { min: 1e-3, max: 2e8 } as const;

/** The points a constraint names: two, one for a fix, none for a diameter (it names its circle). */
export const constraintPoints = (c: SketchConstraint): string[] => (c.kind === "fix" ? [c.point] : c.kind === "diameter" ? [] : [c.a, c.b]);

/** The most constraints one sketch may hold: the solver's own limit (four a point at its 2,000 points). */
export const MAX_SKETCH_CONSTRAINTS = 8000;

/** A sketch's curves: lines, circles and arcs. */
export type SketchCurve = SketchLineCurve | SketchCircleCurve | SketchArcCurve;

/** The points a curve is drawn from: a line's two ends, a circle's centre, an arc's ends and centre. */
export const curvePoints = (c: SketchCurve): string[] => (c.kind === "line" ? [c.start, c.end] : c.kind === "circle" ? [c.centre] : [c.start, c.end, c.centre]);

/**
 * A sketch's content; its place in the build order and its plane are its
 * timeline item with the same id. The plane is an origin plane ("XY",
 * "XZ", "YZ") or, from step 26c, a face's name ("face:feature-2/end",
 * face-sketch.ts); a sketch on a face keeps here (`face`) the frame it was
 * drawn with, its side and, while the face is lost or ambiguous, the
 * placement it holds.
 */
export interface Sketch {
  id: string;
  points: SketchPoint[];
  curves: SketchCurve[];
  /** Its constraints, oldest first (step 47d2). */
  constraints: SketchConstraint[];
  /** Only for a sketch on a face (step 26c). */
  face?: SketchFace;
  /**
   * Its points pinned to a body's edges (face-edges.ts): to the face's
   * (step 26f), from 27c to any body's before it, on any plane; each point
   * once; left out when none are.
   */
  pins?: SketchPin[];
  /**
   * Edges of bodies before it projected into it (step 27d,
   * projection.ts), each with the curve or point it made in `curves` or
   * `points`, in the order they were projected; left out when none are.
   */
  projected?: SketchProjection[];
}

/**
 * An extrude's last shape (the owner's timeline rule, step 24d2): its
 * sketch's points and curves as they were just before the edit that lost
 * the sketch (deleted it, or left it with no outline). Saved in the
 * document's `kept`, by the extrude's id, while the sketch is lost, so the extrude
 * still builds, with a warning, after the file is opened again
 * (`rebuild.ts`, `settleKept`). Its ids are the sketch's old ones, so
 * the extrude's sides keep their names. A sketch not on XY keeps where it
 * lay too (step 26c: `placement`, an origin plane's frame or a face
 * sketch's placement just before), so the extrude stays where it was.
 */
export interface KeptShape {
  points: SketchPoint[];
  curves: SketchCurve[];
  placement?: SketchPlacement;
}

/** An extrude's kept shape, or undefined while its sketch makes an outline. */
export const keptOf = (doc: Pick<DesignDocument, "kept">, f: Feature): KeptShape | undefined => (doc.kept && Object.hasOwn(doc.kept, f.id) ? doc.kept[f.id] : undefined);

/** The origin planes a sketch can be on; a face's name is the other kind of plane (step 26c, face-sketch.ts). */
export const SKETCH_PLANES = ["XY", "XZ", "YZ"] as const;
export type SketchPlane = (typeof SKETCH_PLANES)[number];

/**
 * The most a design file holds (security audit S2): far above any real
 * part, but low enough that a file can't freeze the tab while it opens.
 * `items` counts the timeline, `profiles` the ready-made outlines,
 * `sketch` one sketch's (or kept shape's) points and curves together, and
 * `content` every sketch's and kept shape's points and curves together.
 * The kernel's own limit on one outline is 2,000 corners, so a sketch has
 * ten times that.
 */
export const DESIGN_LIMITS = { items: 5_000, profiles: 5_000, sketch: 20_000, content: 500_000 } as const;

/**
 * The highest id counter a file may hold: 2^52, half the safe integers, so the ids every later edit takes (a few
 * each) never pass Number.MAX_SAFE_INTEGER, where a saved design would no longer open (real-use hunt S3).
 */
export const MAX_NEXT_ID = 2 ** 52;

/**
 * `nextId`, the counter after an edit took its ids, refused past MAX_NEXT_ID: every design that opens still opens
 * after any edit, and one at the top says so instead of saving a file that would not open again (real-use hunt S3).
 */
export function counted(nextId: number): number {
  if (!(nextId <= MAX_NEXT_ID)) throw new Error(`This design has used every id it can hold (${MAX_NEXT_ID}), so nothing more can be added to it`);
  return nextId;
}

/**
 * The rollback marker: the id of the last item built, or "start" when
 * nothing is; left out when everything is built (docs/project-format.md).
 */
export type Marker = string;

export interface DesignDocument {
  /** Version of this part of the project file (see docs/project-format.md). */
  version: 11;
  /** The number the next new id gets. Ids are never reused, even after a delete (docs/document-model.md, section 2). */
  nextId: number;
  profiles: ReadyProfile[];
  sketches: Sketch[];
  timeline: { features: Feature[]; marker?: Marker };
  /** Each extrude's kept shape while its sketch is lost (24d2), by the extrude's id; left out when there is none. */
  kept?: Record<string, KeptShape>;
  /**
   * Every body's id and number (35e, `numberBodies`), in the order they
   * were given. A document read from a file always has them all, and an
   * edit that makes a body numbers it; left out (with `nextBody`) only in
   * data written by hand or by a test, numbered as version 4 data is when
   * read.
   */
  bodies?: BodyRecord[];
  /** The number the next new body gets ("Body 4"): above every number given, even a deleted body's. */
  nextBody?: number;
  /**
   * What the browser's eyes hide (U0f3; Ben 2026-10-29, an eye on
   * everything): bodies by their body ids ("body:feature-3", version 6,
   * step 35ec; version 5 listed their items' ids) and sketches by their
   * items' ids, in timeline order (`eyeOrder`), then the origin's axes
   * ("origin-x"…) and the folders ("folder-bodies"…) whose eyes are shut,
   * in EYE_ROWS' order; left out when nothing is hidden.
   */
  hidden?: string[];
  /** The origin's planes shown by their eyes ("origin-xy"…, in ORIGIN_PLANES' order), hidden at first as in Fusion; left out when none shows. */
  shownPlanes?: string[];
}

/** Whether `id` has its own eye shut (U0f3): a solid feature's body or a sketch built as ever, but not drawn, picked or exported as a whole; an axis or a folder hidden. */
export const isHidden = (doc: Pick<DesignDocument, "hidden">, id: string): boolean => doc.hidden?.includes(id) ?? false;

/** The origin's axes with an eye, X, Y then Z: shown at first. */
export const ORIGIN_AXES = ["origin-x", "origin-y", "origin-z"] as const;
/** The origin's planes with an eye: hidden at first (Fusion's). */
export const ORIGIN_PLANES = ["origin-xy", "origin-xz", "origin-yz"] as const;
/** The browser's folders with an eye: shut, it hides every row in it (the Timeline lists items, not things drawn; the Profiles are drawn by nothing). */
export const EYE_FOLDERS = { bodies: "folder-bodies", sketches: "folder-sketches", origin: "folder-origin" } as const;
/** Every id `hidden` may list that is not a timeline item's, in the order it lists them. */
export const EYE_ROWS: readonly string[] = [...ORIGIN_AXES, ...Object.values(EYE_FOLDERS)];

/** Whether body `bodyId` ("body:feature-3", 35eb) is hidden: its own eye shut (listed by its body id, version 6), or the Bodies folder's. Bad input throws: an id `bodyIdOf` never makes. */
export function bodyHidden(doc: Pick<DesignDocument, "hidden">, bodyId: string): boolean {
  if (bodyItem(bodyId) === null) throw new Error(`${JSON.stringify(bodyId)} is not a body id`);
  return isHidden(doc, bodyId) || isHidden(doc, EYE_FOLDERS.bodies);
}

/**
 * The ids `hidden` lists, in its order (version 6): for each timeline item
 * in turn its own id (a sketch's eye), then the bodies it made by body id
 * (its own, "body:feature-3", then its pieces in the order `bodies` numbers
 * them, 35ec), then the origin's axes and the folders in EYE_ROWS' order.
 * Ids `shut` holds that none of these is are left out.
 */
export function eyeOrder(doc: Pick<DesignDocument, "timeline" | "bodies">, shut: ReadonlySet<string>): string[] {
  const pieces = new Map<string, string[]>();
  for (const b of doc.bodies ?? []) {
    const maker = bodyItem(b.id);
    if (maker !== null && b.id !== bodyIdOf(maker)) pieces.set(maker, [...(pieces.get(maker) ?? []), b.id]);
  }
  const listed = doc.timeline.features.flatMap((f) => [f.id, bodyIdOf(f.id), ...(pieces.get(f.id) ?? [])]);
  return [...listed, ...EYE_ROWS].filter((id) => shut.has(id));
}
/** Whether sketch `id` is hidden: its own eye shut (an extrude of it shuts it, as Fusion does), or the Sketches folder's. */
export const sketchHidden = (doc: Pick<DesignDocument, "hidden">, id: string): boolean => isHidden(doc, id) || isHidden(doc, EYE_FOLDERS.sketches);
/** Whether an origin axis or plane is drawn: an axis unless its eye is shut, a plane only once its eye is opened; neither while the Origin folder's is shut. */
export function originDrawn(doc: Pick<DesignDocument, "hidden" | "shownPlanes">, id: string): boolean {
  if (isHidden(doc, EYE_FOLDERS.origin)) return false;
  return (ORIGIN_PLANES as readonly string[]).includes(id) ? (doc.shownPlanes?.includes(id) ?? false) : !isHidden(doc, id);
}

const profileNames: Record<ProfileKind, string> = {
  "l-bracket": "L-bracket",
  plate: "Plate with two round holes",
  slot: "Slot with round ends",
  star: "Star",
};

/** "40 × 30 × 20": numbers as typed, so the summary matches the panel. */
const dims = (...ns: number[]) => ns.map(String).join(" × ");

/** One profile's display name, e.g. "L-bracket profile". */
export const profileLabel = (p: ReadyProfile) => `${profileNames[p.kind]} profile`;

const SHAPE_TYPES = { box: "box", cylinder: "cylinder", sphere: "sphere" } as const;
const isPrimitive = (kind: ShapeKind): kind is keyof typeof SHAPE_TYPES => Object.hasOwn(SHAPE_TYPES, kind);

/**
 * A name folded for comparing: two items' names must differ, ignoring case
 * ("Box 1" and "box 1" are one name), since messages name items by them
 * (U0e: "Delete Box 1"), and ignoring how its letters are spelled in code
 * points: "Café" with é as one (U+00E9) or as e and a combining accent
 * (U+0301) reads the same, so it is one name (NFC, app sweep 2026-10-28,
 * finding 18). Look-alikes of other kinds (a zero-width space, a
 * right-to-left mark) stay apart: the owner's call.
 */
export const nameKey = (name: string): string => name.toLowerCase().normalize("NFC");

/** Every timeline item's name (`nameKey`), but item `except`'s. */
export function takenNames(doc: Pick<DesignDocument, "timeline">, except?: string): Set<string> {
  const taken = new Set<string>();
  for (const f of doc.timeline.features) if (f.id !== except && typeof f.provenance?.self?.label === "string") taken.add(nameKey(f.provenance.self.label));
  return taken;
}

/**
 * A new item's short name: `base` and the first number from `count + 1`
 * whose name no item has (`taken`, from `takenNames`), the way Sketch n and
 * Extrude n are named: "Box 3" for a third box, "Box 4" when "Box 3" is
 * taken (U0e).
 */
export function freshName(base: string, count: number, taken: ReadonlySet<string>): string {
  let n = count + 1;
  while (taken.has(nameKey(`${base} ${n}`))) n++;
  return `${base} ${n}`;
}

/** The preset shape each solid feature is ("box", "slot"…), null for a sketch or an extrude of one; the profiles looked up once. */
export function presetKinds(doc: Pick<DesignDocument, "profiles">): (f: Feature) => ShapeKind | null {
  const profiles = new Map<unknown, ShapeKind>();
  for (const p of doc.profiles) if (!profiles.has(p.id)) profiles.set(p.id, p.kind);
  return (f) => {
    if (!makesBody(f) || isSketchExtrude(f)) return null;
    if (isPrimitive(f.intent.type as ShapeKind)) return f.intent.type as ShapeKind;
    return f.intent.type === "extrude" ? (profiles.get(f.intent.parameters.profile) ?? null) : null;
  };
}

/** A new preset's short name ("Box 3", `freshName`), counting the presets of its shape there are, but item `except`. */
function presetName(doc: DesignDocument, kind: ShapeKind, except?: string): string {
  const kindOf = presetKinds(doc);
  const count = doc.timeline.features.filter((f) => f.id !== except && kindOf(f) === kind).length;
  return freshName(SHAPE_LABELS[kind], count, takenNames(doc, except));
}

/** Whether `label` is the short name a preset of shape `kind` is given ("Box 3"), not one the user typed. */
const isShapeName = (label: string, kind: ShapeKind): boolean => label.startsWith(`${SHAPE_LABELS[kind]} `) && /^[1-9]\d*$/.test(label.slice(SHAPE_LABELS[kind].length + 1));

/**
 * The features with item `id` named `label`, and every copy of its name in
 * the others' provenance (`from`: a sketch on its face, an extrude of it)
 * following, so a deleted item is remembered by its name now.
 */
export function relabelled(features: readonly Feature[], id: string, label: string): Feature[] {
  return features.map((f) => {
    const own = f.id === id;
    const from = f.provenance.from.some((p) => p.workspace === "design" && p.id === id) ? f.provenance.from.map((p) => (p.workspace === "design" && p.id === id ? { ...p, label } : p)) : f.provenance.from;
    if (!own && from === f.provenance.from) return f;
    return { ...f, provenance: { ...f.provenance, self: own ? { ...f.provenance.self, label } : f.provenance.self, from } };
  });
}

/**
 * A preset's feature with this id and short name (`label`, "Box 1"), and
 * the ready-made profile it extrudes (with `profileId`) for a profile shape.
 * Boxes, cylinders and spheres are primitives (a cylinder's or sphere's
 * width is its diameter); other shapes extrude a ready-made profile by the
 * height. Every one rests on the XY floor when made (Ben, 2026-10-28): a
 * box, cylinder or profile is built standing on it, and a sphere, which
 * the kernel builds round the origin, keeps its centre's height `centreZ`,
 * its radius (`centre`; from `changePreset` the old sphere's, so a later
 * size change grows it about its centre and may take it below the floor:
 * never snapped back; null for a sphere made before, kept round the origin).
 */
function presetFeature(id: string, label: string, profileId: string | undefined, kind: ShapeKind, w: number, d: number, h: number, centre: number | null = w / 2): { feature: Feature; profile?: ReadyProfile } {
  const feature = (intent: Feature["intent"], dependsOn: string[] = [], from: Feature["provenance"]["from"] = []): Feature => ({
    id,
    intent,
    provenance: { self: { workspace: "design", id, label }, from },
    dependsOn,
    suppressed: false,
  });
  if (kind === "box") return { feature: feature({ type: "box", parameters: { width: w, depth: d, height: h }, summary: `Box: ${dims(w, d, h)} mm` }) };
  if (kind === "cylinder") return { feature: feature({ type: "cylinder", parameters: { diameter: w, height: h }, summary: `Cylinder: ⌀${dims(w)} × ${h} mm` }) };
  if (kind === "sphere") return { feature: feature({ type: "sphere", parameters: centre === null ? { diameter: w } : { diameter: w, centreZ: centre }, summary: `Sphere: ⌀${w} mm` }) };
  if (profileId === undefined) throw new Error(`a ${kind} preset needs a profile id`);
  const profile: ReadyProfile = { id: profileId, kind, width: w, depth: d, plane: XY_PLANE };
  return {
    profile,
    feature: feature(
      { type: "extrude", parameters: { profile: profile.id, distance: h }, summary: `Extrude: ${profileLabel(profile)} ${dims(w, d)} mm, by ${h} mm` },
      [profile.id],
      [{ workspace: "design", id: profile.id, label: profileLabel(profile) }],
    ),
  };
}

/** The document for a new project: one preset, feature-1 named "<Shape> 1" (and profile-1 for a profile shape), the counter at 2. */
export function partDocument(kind: ShapeKind, w: number, d: number, h: number): DesignDocument {
  const { feature, profile } = presetFeature("feature-1", `${SHAPE_LABELS[kind]} 1`, "profile-1", kind, w, d, h);
  return numberBodies({ version: 11, nextId: 2, profiles: profile ? [profile] : [], sketches: [], timeline: { features: [feature] } });
}

/** The index a new timeline item goes in at: just after the marker, first when it is at the start, else last. */
export function insertAt(doc: DesignDocument): number {
  const { features, marker } = doc.timeline;
  if (marker === undefined) return features.length;
  if (marker === "start") return 0;
  return features.findIndex((f) => f.id === marker) + 1;
}

/** The timeline with a new item put in at the marker (insertAt); the marker, when there is one, moves onto it. */
export function insertItem(doc: DesignDocument, item: Feature): DesignDocument["timeline"] {
  const features = [...doc.timeline.features];
  features.splice(insertAt(doc), 0, item);
  return doc.timeline.marker === undefined ? { ...doc.timeline, features } : { ...doc.timeline, features, marker: item.id };
}

/**
 * A new preset feature (a new body), its ids from the counter, put in at
 * the marker, named for its shape ("Box 2", `presetName`). A profile shape
 * takes a second id for its ready-made profile.
 */
export function insertPreset(doc: DesignDocument, kind: ShapeKind, w: number, d: number, h: number): { doc: DesignDocument; id: string } {
  let nextId = doc.nextId;
  const id = `feature-${nextId++}`;
  const { feature, profile } = presetFeature(id, presetName(doc, kind), isPrimitive(kind) ? undefined : `profile-${nextId++}`, kind, w, d, h);
  return { id, doc: numberBodies({ ...doc, nextId: counted(nextId), profiles: profile ? [...doc.profiles, profile] : doc.profiles, timeline: insertItem(doc, feature) }) };
}

/**
 * The document with the preset feature `id` changed to this shape and
 * these sizes: the same feature, so it keeps its id, its place and its
 * profile's id (a profile shape that had none takes one from the counter;
 * a profile no feature uses any more goes). It keeps its name, but for
 * the short name of its old shape when the shape changes: "Box 1" made a
 * cylinder is the next cylinder's name ("Cylinder 1"), a name the user
 * gave stays (U0e), and the copies of it follow (`relabelled`).
 */
export function changePreset(doc: DesignDocument, id: string, kind: ShapeKind, w: number, d: number, h: number): DesignDocument {
  const old = doc.timeline.features.find((f) => f.id === id);
  if (!old || !ownShape(old) || isSketchExtrude(old)) throw new Error(`there is no preset ${shown(id)} in the design`);
  let nextId = doc.nextId;
  const oldProfile = old.dependsOn.find((p) => doc.profiles.some((x) => x.id === p));
  const oldKind = presetKinds(doc)(old);
  const label = oldKind !== null && oldKind !== kind && isShapeName(old.provenance.self.label, oldKind) ? presetName(doc, kind, id) : old.provenance.self.label;
  const keptCentre = old.intent.type === "sphere" ? (centreOf(old) ?? null) : undefined;
  const { feature, profile } = presetFeature(id, label, isPrimitive(kind) ? undefined : (oldProfile ?? `profile-${nextId++}`), kind, w, d, h, keptCentre);
  const changed = doc.timeline.features.map((f) => (f === old ? { ...feature, suppressed: old.suppressed } : f));
  const features = label === old.provenance.self.label ? changed : relabelled(changed, id, label);
  const used = new Set(features.flatMap((f) => f.dependsOn));
  const kept = doc.profiles.flatMap((p) => (p.id === profile?.id ? [profile] : p.id !== oldProfile || used.has(p.id) ? [p] : []));
  const profiles = profile && !kept.includes(profile) ? [...kept, profile] : kept;
  return { ...doc, nextId: counted(nextId), profiles, timeline: { ...doc.timeline, features } };
}

/**
 * The document after the panel or set_part asks for this shape and these
 * sizes: the part (`partFeature`) changed in place when it is a preset,
 * else (an extrude of a sketch, or no part at all: 24f4) a new preset
 * feature put in at the marker, so nothing already in the timeline is
 * replaced. The counter never goes back.
 */
export function withPart(previous: DesignDocument | null | undefined, kind: ShapeKind, w: number, d: number, h: number): DesignDocument {
  if (!previous) return partDocument(kind, w, d, h);
  return withPartAt(previous, partFeature(previous), kind, w, d, h).doc;
}

/**
 * withPart on `part`, the body the panel's size boxes describe (the
 * selected one, workspace.ts; the last, `partFeature`, for withPart):
 * changed in place when it is a preset, else (an extrude of a sketch, or
 * null) a new preset put in at the marker. With the id of the body these
 * sizes now are: `part`'s own, or the new one's.
 */
export function withPartAt(previous: DesignDocument, part: Feature | null, kind: ShapeKind, w: number, d: number, h: number): { doc: DesignDocument; id: string } {
  return part === null || isSketchExtrude(part) ? insertPreset(previous, kind, w, d, h) : { doc: changePreset(previous, part.id, kind, w, d, h), id: part.id };
}

/**
 * An extrude of a sketch (step 21d): `{ sketch, distance }`, its outline
 * found by the kernel from the sketch each time it is built. An extrude of
 * a ready-made profile names a `profile` instead.
 */
export const isSketchExtrude = (f: Feature) => f.intent.type === "extrude" && Object.hasOwn(f.intent.parameters, "sketch");

/** A sketch's timeline item: it places the sketch in the build order and names its plane; it builds no solid. */
export const isSketchItem = (f: Feature) => f.intent.type === "sketch";

/**
 * A Move (step 35e2): moves and turns the bodies it depends on (`dependsOn`,
 * each a body made before it) from its place in the timeline on; it makes
 * no body of its own. Its numbers are `MOVE_PARAMS` (move.ts).
 */
export const isMoveItem = (f: Feature) => f.intent.type === "move";

/**
 * A Combine (step 35f1): Join, Cut or Intersect of its target body with
 * its tool bodies (`COMBINE_PARAMS`, every body one made before it), in
 * the order picked. The target's result keeps the target's id, any other
 * piece is `body:<the Combine>/piece:<k>` (rule 1), and the tools are used
 * up unless `keepTools`. It depends on the items that made those bodies,
 * as a Move does, and makes no body under its own id.
 */
export const isCombineItem = (f: Feature) => f.intent.type === "combine";

/** Combine's operations, as the panel names them. */
export const COMBINE_OPERATIONS = ["join", "cut", "intersect"] as const;
export type CombineOperation = (typeof COMBINE_OPERATIONS)[number];

/** A Combine's parameters, all in every Combine. */
export const COMBINE_PARAMS = ["target", "tools", "operation", "keepTools"] as const;

/** Whether an item works on bodies other items made (a Move, a Combine), depending on those items, rather than making one of its own. */
export const actsOnBodies = (f: Feature) => isMoveItem(f) || isCombineItem(f);

/**
 * An extrude of a sketch with an operation (Fusion's Join, Cut and
 * Intersect in Extrude's panel; Design data version 10): `operation` and
 * `bodies`, the bodies it works on (body ids, each made before it, in the
 * order picked). Its own body never stays a body: Join puts it and every
 * other body picked into the first one picked (which keeps its id), Cut
 * takes it out of each body picked, Intersect keeps only what each body
 * picked shares with it. Every body picked keeps its id; any other piece
 * is `body:<the extrude>/piece:<k>`, as a Combine's. It depends on its
 * sketch, then on the items that made its bodies. Without `operation` an
 * extrude is a new body, as before version 10.
 */
export const isOperationExtrude = (f: Feature) => isSketchExtrude(f) && Object.hasOwn(f.intent.parameters, "operation");

/** An extrude's operation and the bodies it works on (body ids, in the order picked); null for an extrude that is a new body (or any other item). */
export function extrudeOperation(f: Feature): { operation: CombineOperation; bodies: string[] } | null {
  if (!isOperationExtrude(f)) return null;
  const p = f.intent.parameters;
  return { operation: p.operation as CombineOperation, bodies: [...(p.bodies as string[])] };
}

/** The items that made an operation extrude's bodies, each once, in the order picked. */
export const operationMakers = (f: Feature): string[] => [...new Set((extrudeOperation(f)?.bodies ?? []).map((b) => bodyItem(b)!))];

/** Whether an item can leave pieces (`body:<it>/piece:<k>`): a Combine, or an extrude with an operation. */
export const makesPieces = (f: Feature) => isCombineItem(f) || isOperationExtrude(f);

/** Whether an item makes a body of its own: anything but a sketch, a Move, a Combine or an extrude with an operation (a Duplicate's copy is its own body). */
export const makesBody = (f: Feature) => !isSketchItem(f) && !actsOnBodies(f) && !isOperationExtrude(f);

/** Whether an item's own faces can be named in the design (sketched on, pinned to, projected): one that makes a body, or an extrude with an operation (its faces carried onto the bodies it joined or cut). */
export const hasOwnFaces = (f: Feature) => makesBody(f) || isOperationExtrude(f);

/**
 * A Duplicate (step 35e2): a copy of one body made before it (its `body`,
 * by body id), where that body is at the Duplicate's place in the timeline.
 * The copy is a body of its own, `body:<the Duplicate>`, numbered like any
 * (`makesBody`), its faces named by the Duplicate as an extrude's are by
 * the extrude; it follows its source (an edit to the source's sizes
 * changes the copy too) but not what is done to the source after it. It
 * depends on the item that made its body, as a Move does.
 */
export const isDuplicateItem = (f: Feature) => f.intent.type === "duplicate";

/** The body a Duplicate copies, by body id. */
export const duplicatedBody = (f: Feature): string => f.intent.parameters.body as string;

/** Whether an item is built from bodies other items made: a Move, a Combine or a Duplicate. */
export const onBodies = (f: Feature) => actsOnBodies(f) || isDuplicateItem(f);

/** Whether an item's body is a shape of its own (a preset, an extrude), with sizes to edit: every item that makes a body but a Duplicate, whose body is a copy. */
export const ownShape = (f: Feature) => makesBody(f) && !isDuplicateItem(f);

/** A Combine's bodies by body id: its target, then its tools in the order picked. */
export function combineBodies(f: Feature): { target: string; tools: string[]; operation: CombineOperation; keepTools: boolean } {
  const p = f.intent.parameters;
  return { target: p.target as string, tools: [...(p.tools as string[])], operation: p.operation as CombineOperation, keepTools: p.keepTools === true };
}

/**
 * A body's own id and the number people read in "Body 3" (step 35e;
 * docs/document-model.md, section 8, rule 1). The id is the body's, not
 * a feature's: `body:<the item that first made it>` (a Combine at 35f can
 * leave pieces with ids of their own). The number is given once, when the
 * body first appears, and stored, so a reorder, a suppress or a body
 * before it failing never renumbers it.
 */
export interface BodyRecord {
  id: string;
  number: number;
}

/** The id of the body item `featureId` makes (rule 1): "body:feature-3". */
export const bodyIdOf = (featureId: string) => `body:${featureId}`;

/**
 * The item that made a body ("body:feature-3" → "feature-3"), the inverse
 * of `bodyIdOf`; for a piece a feature split off a body (rule 1, 35ec:
 * "body:feature-5/piece:2", k a counting number written without leading
 * zeros) the feature that split it, "feature-5"; null for anything else
 * (35eb). Since version 6 a file lists bodies (the eyes, a Move's) by
 * these ids.
 */
export function bodyItem(bodyId: string): string | null {
  const m = /^body:([^:/]+)(?:\/piece:([1-9][0-9]*))?$/.exec(bodyId);
  return m === null || (m[2] !== undefined && !Number.isSafeInteger(Number(m[2]))) ? null : m[1];
}

/** Whether `bodyId` is a piece's id ("body:feature-5/piece:2"), not the body an item made itself. */
export const isPiece = (bodyId: string): boolean => bodyItem(bodyId) !== null && bodyId.includes("/");

/**
 * The document with every body numbered (`bodies`, `nextBody`): a body
 * with no number yet gets the next one, ones that build first, each in
 * timeline order (so a version 4 file's bodies keep the numbers it showed,
 * "Body n" by place among the bodies that build, and then the suppressed
 * and rolled-back ones follow); a body whose item is deleted loses its
 * number, which is never given again (the counter only goes up). The same
 * document back when every body is numbered and none is gone, so each
 * edit that makes or deletes a body numbers it once, in its own undo step.
 */
export function numberBodies(doc: DesignDocument): DesignDocument {
  const made = doc.timeline.features.filter(makesBody);
  const live = new Set(made.map((f) => bodyIdOf(f.id)));
  // A Combine's pieces (35f1) keep their numbers while the Combine is there; `numberPieces` gives them theirs.
  const combines = new Set(doc.timeline.features.filter(makesPieces).map((f) => f.id));
  const old = doc.bodies ?? [];
  const kept = old.filter((b) => live.has(b.id) || (isPiece(b.id) && combines.has(bodyItem(b.id)!)));
  const have = new Set(kept.map((b) => b.id));
  const missing = made.filter((f) => !have.has(bodyIdOf(f.id)));
  // Which build is asked only when a body needs a number (the browser asks for the numbers on every draw of a 5,000-item timeline).
  const building = missing.length === 0 ? null : buildingItems(doc);
  const fresh = building === null ? [] : [...missing.filter((f) => building.has(f)), ...missing.filter((f) => !building.has(f))].map((f) => bodyIdOf(f.id));
  if (fresh.length === 0 && kept.length === old.length && doc.bodies !== undefined && doc.nextBody !== undefined) return doc;
  let next = Math.max(doc.nextBody ?? 1, ...kept.map((b) => b.number + 1));
  return { ...doc, bodies: [...kept, ...fresh.map((id) => ({ id, number: next++ }))], nextBody: next };
}

/**
 * The document with each of `pieces` (the pieces a rebuild made of a
 * Combine or an extrude with an operation, "body:<item>/piece:<k>", 35f1) that has no number yet numbered, in
 * the order given, the counter going up; the same document when all have
 * one. Called once a rebuild shows which pieces there are, so a piece is
 * numbered when it first appears and keeps that number from then on.
 */
export function numberPieces(doc: DesignDocument, pieces: readonly string[]): DesignDocument {
  const numbered = numberBodies(doc);
  const have = new Set(numbered.bodies!.map((b) => b.id));
  const combines = new Set(doc.timeline.features.filter(makesPieces).map((f) => f.id));
  const fresh = [...new Set(pieces)].filter((id) => isPiece(id) && combines.has(bodyItem(id)!) && !have.has(id));
  if (fresh.length === 0) return numbered;
  let next = numbered.nextBody!;
  return { ...numbered, bodies: [...numbered.bodies!, ...fresh.map((id) => ({ id, number: next++ }))], nextBody: next };
}

/** Each body's number by its id, numbered as `numberBodies` would. */
export function bodyNumbers(doc: DesignDocument): ReadonlyMap<string, number> {
  return new Map(numberBodies(doc).bodies!.map((b) => [b.id, b.number]));
}

/** A Move's numbers, all in every Move: the shift (mm), the turns about X, Y and Z (degrees, in that order) and the point they turn about (mm). */
export const MOVE_PARAMS = ["x", "y", "z", "turnX", "turnY", "turnZ", "pivotX", "pivotY", "pivotZ"] as const;
export type MoveParam = (typeof MOVE_PARAMS)[number];

/**
 * A Move's scale factor (step 35e2, Scale): a number above 0 that sizes its
 * bodies about the pivot, after the turns and before the shift. Only in a
 * Move that scales: a Move without one scales by 1, so every older Move
 * reads (and writes) as it did.
 */
export const MOVE_SCALE = "scale";

/**
 * A value from a file, for a message: text as it is, anything else by
 * kind. String() would run a file's own "toString" and can throw
 * (found by fuzzing the loader).
 */
export const shown = (x: unknown): string => (typeof x === "object" && x !== null ? (Array.isArray(x) ? "a list" : "an object") : String(x));

const num = (f: Feature, name: string) => {
  const v = f.intent.parameters[name];
  if (typeof v !== "number") throw new Error(`${f.intent.summary}: ${name} must be a number`);
  return v;
};

/** A sphere feature's centre height `centreZ` (mm), checked; undefined when it has none (made before 2026-10-28: round the origin). */
export function centreOf(f: Feature): number | undefined {
  if (!Object.hasOwn(f.intent.parameters, "centreZ")) return undefined;
  const z = f.intent.parameters.centreZ;
  if (!isFiniteNumber(z)) throw new Error(`${f.intent.summary}: centreZ ${shown(z)} is not a number of mm`);
  return z;
}

/** The body a feature builds, read from its intent. */
export function specOf(document: DesignDocument, feature: Feature): BodySpec {
  const p = feature.intent.parameters;
  switch (feature.intent.type) {
    case "box":
      return { box: { width: num(feature, "width"), depth: num(feature, "depth"), height: num(feature, "height") } };
    case "cylinder":
      return { cylinder: { radius: num(feature, "diameter") / 2, height: num(feature, "height") } };
    case "sphere": {
      const sphere = { sphere: { radius: num(feature, "diameter") / 2 } };
      const centre = centreOf(feature);
      return centre === undefined ? sphere : { moved: { body: sphere, moves: [{ move: [0, 0, centre] }] } };
    }
    case "extrude": {
      // Its outline comes from the kernel: featureSpec (extrude.ts) builds it.
      if (isSketchExtrude(feature)) throw new Error(`${feature.intent.summary}: an extrude of a sketch is built through featureSpec, which asks the kernel for the outline`);
      const profile = document.profiles.find((x) => x.id === p.profile);
      if (!profile) throw new Error(`${feature.intent.summary}: its profile ${shown(p.profile)} is missing`);
      return { extrude: { profile: outline(profile.kind, profile.width, profile.depth), distance: num(feature, "distance") } };
    }
    case "duplicate":
      throw new Error(`${feature.intent.summary}: a copy is built by the rebuild, from its body as built there`);
    default:
      throw new Error(`unknown feature type ${feature.intent.type}`);
  }
}

/** The sizes the panel edits, keyed like its inputs; a shape fills only the ones it uses. */
export type PartSizes = Partial<Record<"width" | "depth" | "height", number>>;

/** What the part is: a preset shape, or an extrude of a sketch (step 21d), whose one size is its distance (the panel's height box). */
export type PartKind = ShapeKind | "sketch-extrude";

/**
 * The shape and sizes the part (`partFeature`) was made from: the inverse
 * of partDocument, for the panel showing a loaded part; null when the
 * design has no body (24f4). Throws a clear message for a feature the
 * panel can't show.
 */
export function partOf(document: DesignDocument): { shape: PartKind; sizes: PartSizes } | null {
  const part = partFeature(document);
  return part === null ? null : shapeOf(document, part);
}

/** The shape and sizes a solid feature was made from (presetFeature's inverse; an extrude of a sketch has its distance). */
export function shapeOf(document: DesignDocument, f: Feature): { shape: PartKind; sizes: PartSizes } {
  return shapeWith(f, (id) => document.profiles.find((x) => x.id === id));
}

/** shapeOf with the profile found by `profileOf` (readDesignDocument's is a Map, so a big file reads in linear time). */
function shapeWith(f: Feature, profileOf: (id: unknown) => ReadyProfile | undefined): { shape: PartKind; sizes: PartSizes } {
  switch (f.intent.type) {
    case "box":
      return { shape: "box", sizes: { width: num(f, "width"), depth: num(f, "depth"), height: num(f, "height") } };
    case "cylinder":
      return { shape: "cylinder", sizes: { width: num(f, "diameter"), height: num(f, "height") } };
    case "sphere":
      centreOf(f);
      return { shape: "sphere", sizes: { width: num(f, "diameter") } };
    case "extrude": {
      if (isSketchExtrude(f)) return { shape: "sketch-extrude", sizes: { height: num(f, "distance") } };
      const profile = profileOf(f.intent.parameters.profile);
      if (!profile) throw new Error(`${f.intent.summary}: its profile ${shown(f.intent.parameters.profile)} is missing`);
      // A kind that isn't text never reaches Object.hasOwn, which would turn it into text (issue #139).
      if (typeof profile.kind !== "string" || !Object.hasOwn(profileNames, profile.kind)) throw new Error(`profile ${profile.id} has an unknown kind ${shown(profile.kind)}`);
      if (typeof profile.width !== "number" || typeof profile.depth !== "number") throw new Error(`profile ${profile.id}: width and depth must be numbers`);
      return { shape: profile.kind, sizes: { width: profile.width, depth: profile.depth, height: num(f, "distance") } };
    }
    default:
      throw new Error(`unknown feature type ${shown(f.intent.type)}`);
  }
}

/**
 * Version 2 (steps 21b to 24c) showed one body, the last solid feature's,
 * and had no rollback marker. In version 3 every solid feature is a body,
 * so each solid feature but the last becomes suppressed: the design opens
 * looking as it did, and nothing is lost (unsuppressing one brings it
 * back). Ids, sizes and the counter are kept as they were.
 */
export function migrateDesignV2(d: Record<string, unknown>): Record<string, unknown> {
  const timeline = d.timeline as Record<string, unknown> | undefined;
  if (isRecord(timeline) && Object.hasOwn(timeline, "marker")) throw new Error("Design data says version 2 but has a timeline marker, which version 2 never had");
  if (!isRecord(timeline) || !Array.isArray(timeline.features)) return { ...d, version: 3 };
  const solids = new Set(timeline.features.filter((f) => !(isRecord(f) && isRecord(f.intent) && f.intent.type === "sketch")));
  const last = [...solids].at(-1);
  const features = timeline.features.map((f) => (solids.has(f) && f !== last && isRecord(f) ? { ...f, suppressed: true } : f));
  return { ...d, version: 3, timeline: { ...timeline, features } };
}

/**
 * Version 5 listed bodies by their items' ids: the eyes' (`hidden`) and a
 * Move's (its `dependsOn`). Version 6 (step 35ec) lists them by body id,
 * since a feature that splits a body leaves pieces that are bodies of
 * their own ("body:feature-5/piece:1") with no item of their own: each
 * hidden item that is neither a sketch nor a Move becomes its body's id
 * (`bodyIdOf`), and each Move gains `bodies`, its items' bodies in its
 * order, keeping `dependsOn` (the items, which the timeline's graph
 * follows). Anything else is kept as it was, for the version 6 checks.
 */
export function migrateDesignV5(d: Record<string, unknown>): Record<string, unknown> {
  const timeline = d.timeline as Record<string, unknown> | undefined;
  if (!isRecord(timeline) || !Array.isArray(timeline.features)) return { ...d, version: 6 };
  const type = (f: unknown) => (isRecord(f) && isRecord(f.intent) ? f.intent.type : undefined);
  const solids = new Set(timeline.features.flatMap((f) => (isRecord(f) && typeof f.id === "string" && type(f) !== "sketch" && type(f) !== "move" ? [f.id] : [])));
  const features = timeline.features.map((f) => {
    if (type(f) !== "move" || !isRecord(f) || !isRecord(f.intent) || !isRecord(f.intent.parameters) || !Array.isArray(f.dependsOn)) return f;
    if (Object.hasOwn(f.intent.parameters, "bodies")) throw new Error(`Design data says version 5 but move ${shown(f.id)} has a bodies list, which version 6 brought`);
    const bodies = f.dependsOn.map((id) => (typeof id === "string" ? bodyIdOf(id) : id));
    return { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, bodies } } };
  });
  for (const id of Array.isArray(d.hidden) ? d.hidden : [])
    if (typeof id === "string" && bodyItem(id) !== null) throw new Error(`Design data says version 5 but hides ${id} by a body id, which version 6 brought`);
  const hidden = Array.isArray(d.hidden) ? { hidden: d.hidden.map((id) => (typeof id === "string" && solids.has(id) ? bodyIdOf(id) : id)) } : {};
  return { ...d, ...hidden, version: 6, timeline: { ...timeline, features } };
}

/** A face, edge or vertex name of version 6 with a ready-made profile's pieces as version 7 names them: "side:piece-2" → "side:l-bracket-piece-2". */
const kindPieces = (name: string, kind: ProfileKind): string => name.replace(/side:(?=(?:hole-\d+-)?piece-\d+(?![\w-]))/g, `side:${kind}-`);

/**
 * Version 6 named a ready-made profile's sides by piece number alone
 * ("side:piece-2", "side:hole-1-piece-0"), alike for every profile shape.
 * Version 7 (face hunt 11-01) puts the shape in ("side:l-bracket-piece-2",
 * naming.ts `outlineCurves`), so each such name in a version 6 (or older)
 * file is read with the shape its preset has in the file: a face sketch's
 * plane, its pins' names (on the face's feature, or the pin's own) and its
 * projected edges. A name on a box, cylinder, sphere or sketch's extrude
 * has no pieces and stays; so does the document when nothing changes. Run
 * once the file is checked.
 */
export function withKindPieces(doc: DesignDocument): DesignDocument {
  const presetKind = presetKinds(doc);
  const byId = new Map(doc.timeline.features.map((f) => [f.id, f]));
  const profileKind = (id: string | null | undefined): ProfileKind | null => {
    const f = id == null ? undefined : byId.get(id);
    const kind = f === undefined ? null : presetKind(f);
    return kind === null || isPrimitive(kind) ? null : (kind as ProfileKind);
  };
  const renamed = (name: string, id: string | null | undefined): string => {
    const kind = profileKind(id);
    return kind === null ? name : kindPieces(name, kind);
  };
  let changed = false;
  const faceOf = new Map<string, string | null>();
  const features = doc.timeline.features.map((f) => {
    const plane = f.intent.parameters.plane;
    if (!isSketchItem(f) || !isFacePlane(plane)) return f;
    const feature = faceFeature(plane);
    faceOf.set(f.id, feature);
    const now = renamed(plane, feature);
    if (now === plane) return f;
    changed = true;
    return { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, plane: now } } };
  });
  const sketches = doc.sketches.map((sketch) => {
    const face = faceOf.get(sketch.id) ?? null;
    const pins = sketch.pins?.map((p) => {
      const name = renamed(p.name, p.feature ?? face);
      return name === p.name ? p : { ...p, name };
    });
    const projected = sketch.projected?.map((p) => {
      const edge = renamed(p.edge, p.feature);
      return edge === p.edge ? p : { ...p, edge };
    });
    if (pins?.every((p, k) => p === sketch.pins![k]) !== false && projected?.every((p, k) => p === sketch.projected![k]) !== false) return sketch;
    changed = true;
    return { ...sketch, ...(pins ? { pins } : {}), ...(projected ? { projected } : {}) };
  });
  return changed ? { ...doc, sketches, timeline: { ...doc.timeline, features } } : doc;
}

/**
 * Version 1 (before step 21b) had no sketches and no id counter. The
 * counter starts above every number already used in an id, so no new id
 * can repeat one; the rest is kept as it was, for the version 2 checks.
 */
export function migrateDesignV1(d: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(d, "nextId") || Object.hasOwn(d, "sketches")) throw new Error("Design data says version 1 but has a nextId or sketches, which version 1 never had");
  const { version: _, ...rest } = d;
  const timeline = d.timeline as { features?: unknown } | undefined;
  const items = [...(Array.isArray(d.profiles) ? d.profiles : []), ...(Array.isArray(timeline?.features) ? timeline.features : [])];
  const used = items.map((x) => idNumber((x as { id?: unknown } | null)?.id)).filter((n) => n !== null);
  return { ...rest, version: 2, nextId: Math.max(0, ...used) + 1, sketches: [] };
}

/**
 * What every id in Design's data looks like: a lower-case word, a dash and
 * the counter's number ("line-4"), or the word alone (a version 1 file's
 * "base", which the counter didn't make). No such id is "__proto__".
 */
const ID_SHAPE = /^[a-z]+(-\d+)?$/;

/** The counter's number in an id such as "line-4" (4); null for an id the counter did not make. */
export function idNumber(id: unknown): number | null {
  const m = typeof id === "string" ? /-(\d+)$/.exec(id) : null;
  return m ? Number(m[1]) : null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * A sketch's content, checked: points with finite mm, lines between two
 * different points of the same sketch, circles round a point of the same
 * sketch with a finite positive radius, arcs between two different points
 * round a third, no constraints yet. The kernel holds the limits on sizes
 * and where an arc's centre may be (sketch_outline), as it does for lines.
 */
function checkSketch(s: unknown, i: number): void {
  if (!isRecord(s) || typeof s.id !== "string") throw new Error(`Design sketch ${i + 1} has no id`);
  const at = `Design sketch ${s.id}`;
  if (!Array.isArray(s.points) || !Array.isArray(s.curves) || !Array.isArray(s.constraints)) throw new Error(`${at} needs points, curves and constraints lists`);
  notTooMany(s.points.length + s.curves.length, DESIGN_LIMITS.sketch, `${at} has`, "points and curves");
  notTooMany(s.constraints.length, MAX_SKETCH_CONSTRAINTS, `${at} has`, "constraints");
  checkContent(s.points, s.curves, at);
  const circles = new Map(s.curves.filter((c) => isRecord(c) && c.kind === "circle").map((c) => [(c as SketchCircleCurve).id, c as SketchCircleCurve]));
  checkConstraints(s.constraints, new Set(s.points.map((p) => (p as SketchPoint).id)), at, circles);
}

/**
 * A sketch's constraints, checked (step 47d2): each with an id of its own,
 * a kind this SpindleLabs knows, and points of the same sketch (two
 * different ones, or one for a fix). Whether they hold is the solver's,
 * the next time one is added.
 */
function checkConstraints(list: unknown[], points: ReadonlySet<string>, at: string, circles: ReadonlyMap<string, SketchCircleCurve> = new Map()): void {
  const ids = new Set<string>();
  const sized = new Set<string>();
  const dimension = (c: Record<string, unknown>) => {
    const v = c.value;
    if (!isFiniteNumber(v) || v < DIMENSION_LIMITS.min || v > DIMENSION_LIMITS.max) throw new Error(`${at}: dimension ${c.id} needs a value from 0.001 to 200000000 mm, not ${shown(v)}`);
  };
  for (const [j, c] of list.entries()) {
    if (!isRecord(c) || typeof c.id !== "string") throw new Error(`${at}: constraint ${j + 1} has no id`);
    if (ids.has(c.id)) throw new Error(`${at}: two constraints are called ${shown(c.id)}`);
    ids.add(c.id);
    if (c.kind === "diameter") {
      // 47e: the circle's radius is stored as the dimension says (the sketch is always stored solved).
      dimension(c);
      const circle = typeof c.circle === "string" ? circles.get(c.circle) : undefined;
      if (!circle) throw new Error(`${at}: dimension ${c.id} sizes ${shown(c.circle)}, which is not one of the sketch's circles`);
      if (sized.has(circle.id)) throw new Error(`${at}: circle ${circle.id} has two diameter dimensions`);
      sized.add(circle.id);
      if (circle.radius !== (c.value as number) / 2) throw new Error(`${at}: circle ${circle.id} has radius ${shown(circle.radius)}, but dimension ${c.id} says its diameter is ${shown(c.value)}`);
      continue;
    }
    if (c.kind === "distance") dimension(c);
    if (c.kind === "fix") {
      if (typeof c.point !== "string" || !points.has(c.point)) throw new Error(`${at}: constraint ${c.id} fixes ${shown(c.point)}, which is not one of the sketch's points`);
      continue;
    }
    if (c.kind !== "horizontal" && c.kind !== "vertical" && c.kind !== "coincident" && c.kind !== "distance") throw new Error(`${at}: constraint ${c.id} is a ${shown(c.kind)}, which this SpindleLabs can't read yet`);
    for (const p of [c.a, c.b]) if (typeof p !== "string" || !points.has(p)) throw new Error(`${at}: constraint ${c.id} names ${shown(p)}, which is not one of the sketch's points`);
    if (c.a === c.b) throw new Error(`${at}: constraint ${c.id} joins point ${c.a} to itself`);
  }
}

/** Refuses a count above its limit (DESIGN_LIMITS) before anything loops over what it counts: "Design data has 6000 timeline items, more than the 5000 …". */
function notTooMany(count: number, limit: number, has: string, what: string): void {
  if (count > limit) throw new Error(`${has} ${count} ${what}, more than the ${limit} this SpindleLabs opens`);
}

/** A sketch's or kept shape's points and curves, checked as checkSketch says; `at` starts each message. */
function checkContent(pointList: unknown[], curves: unknown[], at: string): void {
  const s = { points: pointList, curves };
  const points = new Set<string>();
  for (const [j, p] of s.points.entries()) {
    if (!isRecord(p) || typeof p.id !== "string") throw new Error(`${at}: point ${j + 1} has no id`);
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) throw new Error(`${at}: point ${p.id} needs x and y in mm`);
    points.add(p.id);
  }
  for (const [j, c] of s.curves.entries()) {
    if (!isRecord(c) || typeof c.id !== "string") throw new Error(`${at}: curve ${j + 1} has no id`);
    // 47f: true or left out, so a file never says false where an ordinary curve says nothing.
    if (Object.hasOwn(c, "construction") && c.construction !== true) throw new Error(`${at}: curve ${c.id} has construction ${shown(c.construction)}, which must be true or left out`);
    if (c.kind === "circle") {
      if (typeof c.centre !== "string" || !points.has(c.centre)) throw new Error(`${at}: circle ${c.id} is round ${shown(c.centre)}, which is not one of the sketch's points`);
      if (!isFiniteNumber(c.radius) || c.radius <= 0) throw new Error(`${at}: circle ${c.id} needs a radius in mm above 0, not ${shown(c.radius)}`);
      continue;
    }
    if (c.kind === "arc") {
      for (const [role, p] of [["starts at", c.start], ["ends at", c.end], ["is round", c.centre]] as const)
        if (typeof p !== "string" || !points.has(p)) throw new Error(`${at}: arc ${c.id} ${role} ${shown(p)}, which is not one of the sketch's points`);
      if (c.start === c.end) throw new Error(`${at}: arc ${c.id} starts and ends at the same point`);
      if (c.centre === c.start || c.centre === c.end) throw new Error(`${at}: arc ${c.id} is round one of its own ends`);
      continue;
    }
    if (c.kind !== "line") throw new Error(`${at}: curve ${c.id} is a ${shown(c.kind)}, which this SpindleLabs can't read yet (only lines, circles and arcs)`);
    for (const end of [c.start, c.end])
      if (typeof end !== "string" || !points.has(end)) throw new Error(`${at}: line ${c.id} ends at ${shown(end)}, which is not one of the sketch's points`);
    if (c.start === c.end) throw new Error(`${at}: line ${c.id} starts and ends at the same point`);
  }
}

/** Three finite numbers. */
const isVec3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(isFiniteNumber);

/** A frame from a file, checked: origin, x axis and normal, three finite numbers each, from which a frame can be squared up (face-sketch.ts `squared`). */
function checkPlane(p: unknown, at: string): void {
  if (!isRecord(p) || !isVec3(p.origin) || !isVec3(p.xAxis) || !isVec3(p.normal)) throw new Error(`${at} needs an origin, an xAxis and a normal, each three numbers`);
  if (squared(p as unknown as Plane) === null) throw new Error(`${at} has no frame: its normal is nothing or its xAxis lies along it`);
}

/** A placement from a file, checked: a frame (checkPlane) and a side of 1 or −1. */
function checkPlacement(p: unknown, at: string): void {
  if (!isRecord(p)) throw new Error(`${at} is not an object`);
  checkPlane(p.plane, `${at}'s plane`);
  if (p.side !== 1 && p.side !== -1) throw new Error(`${at}'s side must be 1 or -1, not ${shown(p.side)}`);
}

/**
 * A sketch on a face, checked (step 26c): its plane a face's name as a
 * reference has it, the frame it was drawn with, its side (1 or −1), the
 * placement it holds if any; the face's feature a solid item before it,
 * or gone (deleted: the sketch is held with "plane lost"), and depended on.
 */
function checkFaceSketch(f: Feature, content: Sketch, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const p = f.intent.parameters;
  const at = `Design sketch ${f.id}`;
  const feature = faceFeature(p.plane as string);
  if (feature === null) throw new Error(`${at} is on ${shown(p.plane)}, which is not a face's name this SpindleLabs makes`);
  const face = content.face as unknown;
  if (!isRecord(face)) throw new Error(`${at} is on a face but has no frame it was drawn with`);
  checkPlane(face.frame, `${at}'s frame`);
  if (face.side !== 1 && face.side !== -1) throw new Error(`${at}'s side must be 1 or -1, not ${shown(face.side)}`);
  if (Object.hasOwn(face, "held")) checkPlane(face.held, `${at}'s held plane`);
  if (Object.hasOwn(face, "body")) checkPlane(face.body, `${at}'s body frame`);
  const there = byId.get(feature);
  if (there !== undefined && (there.at > byId.get(f.id)!.at || !hasOwnFaces(there.item))) throw new Error(`${at} is on a face of ${shown(feature)}, which is not a solid item before it in the timeline`);
  if (!Array.isArray(f.dependsOn) || !f.dependsOn.includes(feature)) throw new Error(`${at} is on a face of ${feature} but does not depend on it`);
}

/**
 * A sketch's pins, checked (step 26f; on any sketch from 27c): a list of
 * at least one, each one of the sketch's points (each point once), what on
 * the edge (an endpoint, a middle or a centre), a name (a vertex's for an
 * endpoint, edge names joined by "&"; an edge's for the others,
 * face-edges.ts) and the feature whose body it is on: named (27c), or
 * left out for the feature whose face the sketch is on (0.26's pins; a
 * sketch on an origin plane has none, so names it), a solid item before
 * the sketch (or gone: deleted, the point is held) that the sketch depends
 * on.
 */
function checkPins(f: Feature, content: Sketch, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const at = `Design sketch ${f.id}`;
  const pins = content.pins as unknown;
  if (!Array.isArray(pins) || pins.length === 0) throw new Error(`${at}'s pins must be a list of at least one pin, or left out`);
  const points = new Set(content.points.map((p) => p.id));
  const seen = new Set<string>();
  const onFace = isFacePlane(f.intent.parameters.plane);
  for (const [j, pin] of pins.entries()) {
    if (!isRecord(pin) || typeof pin.point !== "string" || !points.has(pin.point)) throw new Error(`${at}'s pin ${j + 1} is not on one of the sketch's points`);
    if (seen.has(pin.point)) throw new Error(`${at} pins point ${pin.point} twice`);
    seen.add(pin.point);
    if (pin.kind !== "endpoint" && pin.kind !== "midpoint" && pin.kind !== "centre") throw new Error(`${at}'s pin on ${pin.point} must be an endpoint, a midpoint or a centre, not ${shown(pin.kind)}`);
    if (typeof pin.name !== "string" || pin.name.length === 0 || pin.name.includes("/") || (pin.kind !== "endpoint" && pin.name.includes("&"))) throw new Error(`${at}'s pin on ${pin.point} has no ${pin.kind === "endpoint" ? "vertex" : "edge"} name`);
    if (!Object.hasOwn(pin, "feature")) {
      if (!onFace) throw new Error(`${at} is on the ${shown(f.intent.parameters.plane)} plane, so its pin on ${pin.point} must name the feature whose body it is on`);
      continue;
    }
    const feature = pin.feature;
    if (typeof feature !== "string" || feature.length === 0) throw new Error(`${at}'s pin on ${pin.point} names no feature`);
    const there = byId.get(feature);
    if (there !== undefined && (there.at > byId.get(f.id)!.at || !hasOwnFaces(there.item))) throw new Error(`${at}'s pin on ${pin.point} is on ${shown(feature)}, which is not a solid item before it in the timeline`);
    if (!Array.isArray(f.dependsOn) || !f.dependsOn.includes(feature)) throw new Error(`${at} has a point pinned to ${feature} but does not depend on it`);
  }
}

/**
 * A sketch's projections, checked (step 27d): a list of at least one, each
 * with an id shaped as Design's are (counted with every other id below),
 * the feature whose body its edge is on (a solid item before the sketch,
 * or gone: deleted, the projection is held; depended on, as a pin's), the
 * edge's name (no "/"), and what it made: one of the sketch's curves, or
 * one of its points (27e: curves may be drawn from it, as from a projected
 * line's end), never another projection's. No edge is projected twice, no point is made by two
 * projections, and none is pinned too (it follows its edge already).
 */
function checkProjections(f: Feature, content: Sketch, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const at = `Design sketch ${f.id}`;
  const list = content.projected as unknown;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${at}'s projections must be a list of at least one, or left out`);
  const points = new Set(content.points.map((p) => p.id));
  const curves = new Map(content.curves.map((c) => [c.id, c]));
  const edges = new Set<string>();
  const owned = new Set<string>();
  const pinned = new Set((content.pins ?? []).map((p) => p.point));
  for (const [j, p] of list.entries()) {
    if (!isRecord(p) || typeof p.id !== "string") throw new Error(`${at}'s projection ${j + 1} has no id`);
    const name = `${at}'s projection ${p.id}`;
    if (typeof p.feature !== "string" || p.feature.length === 0) throw new Error(`${name} names no feature`);
    const there = byId.get(p.feature);
    if (there !== undefined && (there.at > byId.get(f.id)!.at || !hasOwnFaces(there.item))) throw new Error(`${name} is of ${shown(p.feature)}, which is not a solid item before it in the timeline`);
    if (!Array.isArray(f.dependsOn) || !f.dependsOn.includes(p.feature)) throw new Error(`${at} projects an edge of ${p.feature} but does not depend on it`);
    if (typeof p.edge !== "string" || p.edge.length === 0 || p.edge.includes("/")) throw new Error(`${name} has no edge name`);
    if (edges.has(`${p.feature}/${p.edge}`)) throw new Error(`${at} projects the edge ${p.edge} of ${p.feature} twice`);
    edges.add(`${p.feature}/${p.edge}`);
    if (typeof p.made !== "string") throw new Error(`${name} made nothing`);
    const curve = curves.get(p.made);
    // A point (an edge seen end on) may be one a curve is drawn from: the sketch tool shares a point it lands on (27e).
    if (curve === undefined && !points.has(p.made)) throw new Error(`${name} made ${shown(p.made)}, which is not one of the sketch's curves or points`);
    for (const q of [p.made, ...(curve ? curvePoints(curve) : [])]) {
      if (owned.has(q)) throw new Error(`${at}: ${q} is made by two projections`);
      if (pinned.has(q)) throw new Error(`${at}: ${q} is projected, so it can't be pinned too`);
      owned.add(q);
    }
  }
}

/** An extrude's kept shape, checked: a sketch's points and curves (checkContent), each id once, and where it lay if not on XY. */
function checkKept(kept: unknown, feature: string): void {
  const at = `Design feature ${feature}'s kept shape`;
  if (!isRecord(kept) || !Array.isArray(kept.points) || !Array.isArray(kept.curves)) throw new Error(`${at} needs points and curves lists`);
  if (Object.hasOwn(kept, "placement")) checkPlacement(kept.placement, `${at}'s placement`);
  notTooMany(kept.points.length + kept.curves.length, DESIGN_LIMITS.sketch, `${at} has`, "points and curves");
  checkContent(kept.points, kept.curves, at);
  const seen = new Set<string>();
  for (const { id } of [...kept.points, ...kept.curves] as { id: string }[]) {
    if (seen.has(id)) throw new Error(`${at} uses the id ${shown(id)} twice`);
    seen.add(id);
  }
}

/** An item's provenance, checked: its own name, and a `from` list of where it came from, each a workspace, an id and a name. */
function checkProvenance(provenance: unknown, feature: string): void {
  const at = `Design feature ${feature}`;
  const entry = (p: unknown): boolean => isRecord(p) && typeof p.workspace === "string" && typeof p.id === "string" && typeof p.label === "string";
  if (!isRecord(provenance)) throw new Error(`${at} has no provenance`);
  // Its name itself is checked with the naming rules (withRuledNames: "must be text").
  if (!isRecord(provenance.self) || typeof provenance.self.workspace !== "string" || typeof provenance.self.id !== "string") throw new Error(`${at}'s provenance has no name of its own`);
  if (!Array.isArray(provenance.from)) throw new Error(`${at}'s provenance has no 'from' list`);
  if (!provenance.from.every(entry)) throw new Error(`${at}'s provenance lists something that is not a workspace, id and name`);
}

/** The name a preset was given before U0e, from its id's number and its type: "Feature 3 (box)", "Feature 5 (extrude)" for a slot. */
export const oldPresetName = (f: Feature): string => `Feature ${idNumber(f.id) ?? f.id} (${f.intent.type})`;

/**
 * An older project's presets with short names (U0e): each named exactly
 * as presets were before (`oldPresetName`) is named for its shape and its
 * place among the presets of that shape ("Box 1", "Box 2", `freshName`,
 * skipping names in use), and every copy of its old name follows: in the
 * others' provenance (`from`) and in the descriptions of the items made
 * from it ("Sketch 3 on a face of Box 1"). A name the user gave, or any
 * other, stays. The document itself when nothing is renamed.
 */
export function withShortNames(doc: DesignDocument): DesignDocument {
  const kindOf = presetKinds(doc);
  const taken = takenNames(doc);
  const counts = new Map<ShapeKind, number>();
  const renamed = new Map<string, { old: string; label: string }>();
  for (const f of doc.timeline.features) {
    const kind = kindOf(f);
    if (kind === null) continue;
    const count = counts.get(kind) ?? 0;
    counts.set(kind, count + 1);
    const old = f.provenance?.self?.label;
    if (old !== oldPresetName(f)) continue;
    const label = freshName(SHAPE_LABELS[kind], count, taken);
    taken.add(nameKey(label));
    renamed.set(f.id, { old, label });
  }
  if (renamed.size === 0) return doc;
  const features = doc.timeline.features.map((f) => {
    const own = renamed.get(f.id);
    const from = Array.isArray(f.provenance?.from) ? f.provenance.from : [];
    const made = from.flatMap((p) => {
      const r = p?.workspace === "design" ? renamed.get(p.id) : undefined;
      return r === undefined ? [] : [r];
    });
    if (own === undefined && made.length === 0) return f;
    const summary = made.reduce((words, r) => words.split(r.old).join(r.label), f.intent.summary);
    const copies = from.map((p) => {
      const r = p?.workspace === "design" ? renamed.get(p.id) : undefined;
      return r !== undefined && p.label === r.old ? { ...p, label: r.label } : p;
    });
    return { ...f, intent: { ...f.intent, summary }, provenance: { ...f.provenance, self: own ? { ...f.provenance.self, label: own.label } : f.provenance.self, from: copies } };
  });
  return { ...doc, timeline: { ...doc.timeline, features } };
}

/**
 * The most characters a name may have (U0e2): a browser row shows about
 * 30 before its "…" and the bar's tooltip has it whole; a name is for
 * telling items apart, and the description says the rest. Each character
 * is counted once, however many code units it takes.
 */
export const NAME_LIMIT = 40;

/**
 * A file's names held to Rename's rules (app sweep 2026-10-28, finding 17),
 * so an opened design is one Rename could have made: each control
 * character run becomes a space and the spaces round a name go; a name
 * over NAME_LIMIT characters keeps its first NAME_LIMIT; a name another
 * item before it has (`nameKey`) gets " (2)", " (3)"… after it, the first
 * free one, cut to fit; and an empty name is its kind's next free name
 * ("Box 2", `freshName`), never one a named item has. Every copy of a
 * changed name follows it (`relabelled`). The document itself when every
 * name keeps to the rules. A name that is not text (a number, null) is
 * refused, naming its item: there is nothing to repair it from.
 */
export function withRuledNames(doc: DesignDocument): DesignDocument {
  const features = doc.timeline.features;
  const cleaned = features.map((f) => {
    const label: unknown = f.provenance?.self?.label;
    if (typeof label !== "string") throw new Error(`Design feature ${f.id}'s name must be text, not ${shown(label)}`);
    const spaced = label.replace(/\p{Cc}+/gu, " ").trim();
    const chars = [...spaced];
    return chars.length > NAME_LIMIT ? chars.slice(0, NAME_LIMIT).join("").trimEnd() : spaced;
  });
  // Every name now in the file, so a name made below repeats none of them, the later items' too.
  const used = new Set(cleaned.filter((n) => n !== "").map(nameKey));
  const kept = new Set<string>();
  // Where each repeated name's numbers carry on from, so 5,000 items of one name open in a moment (audit S2).
  const nextNumber = new Map<string, number>();
  const names = cleaned.map((name) => {
    if (name === "") return name;
    const key = nameKey(name);
    if (!kept.has(key)) {
      kept.add(key);
      return name;
    }
    for (let n = nextNumber.get(key) ?? 2; ; n++) {
      const suffix = ` (${n})`;
      const tried = `${[...name].slice(0, NAME_LIMIT - suffix.length).join("").trimEnd()}${suffix}`;
      if (used.has(nameKey(tried)) || kept.has(nameKey(tried))) continue;
      nextNumber.set(key, n + 1);
      kept.add(nameKey(tried));
      used.add(nameKey(tried));
      return tried;
    }
  });
  const kindOf = presetKinds(doc);
  const base = (f: Feature): string => {
    if (isSketchItem(f)) return "Sketch";
    if (isMoveItem(f)) return "Move";
    if (isCombineItem(f)) return "Combine";
    if (isDuplicateItem(f)) return "Copy";
    if (isSketchExtrude(f)) return "Extrude";
    const kind = kindOf(f);
    return kind === null ? "Item" : SHAPE_LABELS[kind];
  };
  // Counted in one pass, so a big file with every name empty opens in a moment (audit S2).
  const counts = new Map<string, number>();
  for (const [i, f] of features.entries()) {
    const kind = base(f);
    const before = counts.get(kind) ?? 0;
    counts.set(kind, before + 1);
    if (names[i] !== "") continue;
    names[i] = freshName(kind, before, kept);
    kept.add(nameKey(names[i]));
  }
  // Each changed name and its copies, in one pass (as `relabelled` does for one).
  const changed = new Map<string, string>();
  for (const [i, f] of features.entries()) if (names[i] !== f.provenance.self.label) changed.set(f.id, names[i]);
  if (changed.size === 0) return doc;
  const renamedTo = (o: Feature["provenance"]["self"]) => (o.workspace === "design" && changed.has(o.id) ? { ...o, label: changed.get(o.id)! } : o);
  const out = features.map((f) => ({ ...f, provenance: { ...f.provenance, self: changed.has(f.id) ? { ...f.provenance.self, label: changed.get(f.id)! } : f.provenance.self, from: Array.isArray(f.provenance.from) ? f.provenance.from.map(renamedTo) : f.provenance.from } }));
  return { ...doc, timeline: { ...doc.timeline, features: out } };
}

/**
 * Design's part of a loaded project, checked all the way down to the
 * numbers the panel shows, so a bad file is refused when it is opened
 * rather than failing later. Version 1 is migrated to version 2, and
 * version 2 to version 3 (migrateDesignV2), first.
 */
/**
 * A Move, checked (step 35e2): every one of its numbers (`MOVE_PARAMS`) a
 * finite number and nothing else; at least one body, each once, each an
 * item before it that makes a body (a Move moves bodies, never a sketch or
 * another Move).
 */
function checkMove(d: Partial<DesignDocument>, f: Feature, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const at = `Design move ${f.id}`;
  const p = f.intent.parameters;
  for (const key of MOVE_PARAMS) if (!isFiniteNumber(p[key])) throw new Error(`${at}: ${key} ${shown(p[key])} is not a number`);
  for (const key of Object.keys(p)) if (key !== "bodies" && key !== MOVE_SCALE && !(MOVE_PARAMS as readonly string[]).includes(key)) throw new Error(`${at} has a number ${JSON.stringify(key)} a move doesn't have`);
  // Scale (step 35e2): only when it scales, so never 1, and above 0 (0 would squash the bodies flat, a minus turn them inside out).
  if (Object.hasOwn(p, MOVE_SCALE) && !(isFiniteNumber(p[MOVE_SCALE]) && p[MOVE_SCALE] > 0 && p[MOVE_SCALE] !== 1)) throw new Error(`${at}: scale ${typeof p[MOVE_SCALE] === "string" ? JSON.stringify(p[MOVE_SCALE]) : shown(p[MOVE_SCALE])} is not a number above 0 other than 1`);
  // Version 6: the bodies by body id, and `dependsOn` the items that made them, in the same order, each once (35ec).
  const bodies: unknown = p.bodies;
  if (!Array.isArray(bodies) || bodies.length === 0) throw new Error(`${at} moves no body`);
  const once = new Set<unknown>();
  for (const id of bodies as unknown[]) {
    const maker = typeof id === "string" ? bodyItem(id) : null;
    const there = maker === null ? undefined : byId.get(maker);
    // A body deleted since is allowed, as an extrude's deleted sketch is: the rebuild fails the move naming it (the id's counter check is below).
    // So is a piece of a Combine deleted since (hunt 11-06: deleting the Combine left a file that would not open again, and broke redo).
    const deleted = maker !== null && there === undefined && ID_SHAPE.test(maker);
    if (!deleted && (there === undefined || there.at > byId.get(f.id)!.at || !isBodyOf(d, byId, id as string))) throw new Error(`${at} moves ${shown(id)}, which is not a body made before it in the timeline`);
    if (once.has(id)) throw new Error(`${at} moves ${id} twice`);
    once.add(id);
  }
  const makers = [...new Set((bodies as string[]).map((b) => bodyItem(b)!))];
  if (!Array.isArray(f.dependsOn) || f.dependsOn.length !== makers.length || makers.some((m, i) => f.dependsOn[i] !== m))
    throw new Error(`${at} must depend on exactly the items that made the bodies it moves, in their order (${makers.join(", ")})`);
}

/**
 * A Combine, checked (step 35f1): its parameters exactly `COMBINE_PARAMS`;
 * a target and at least one tool, each a body made before it (by body id,
 * as a Move's; one deleted since is allowed, the rebuild fails the
 * Combine naming it), none twice and the target not a tool; an operation
 * of `COMBINE_OPERATIONS`; `keepTools` true or false; and `dependsOn` the
 * items that made them, target's first, each once.
 */
function checkCombine(d: Partial<DesignDocument>, f: Feature, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const at = `Design combine ${f.id}`;
  const p = f.intent.parameters;
  for (const key of Object.keys(p)) if (!(COMBINE_PARAMS as readonly string[]).includes(key)) throw new Error(`${at} has a parameter ${JSON.stringify(key)} a combine doesn't have`);
  if (!(COMBINE_OPERATIONS as readonly unknown[]).includes(p.operation)) throw new Error(`${at}'s operation ${shown(p.operation)} is not join, cut or intersect`);
  if (typeof p.keepTools !== "boolean") throw new Error(`${at}'s keepTools ${shown(p.keepTools)} is not true or false`);
  if (!Array.isArray(p.tools) || p.tools.length === 0) throw new Error(`${at} has no tool bodies`);
  const bodies = [p.target, ...(p.tools as unknown[])];
  const once = new Set<unknown>();
  for (const [i, id] of bodies.entries()) {
    const maker = typeof id === "string" ? bodyItem(id) : null;
    const there = maker === null ? undefined : byId.get(maker);
    const deleted = maker !== null && there === undefined && ID_SHAPE.test(maker);
    const what = i === 0 ? "its target" : `tool ${shown(id)}`;
    if (!deleted && (there === undefined || there.at > byId.get(f.id)!.at || !isBodyOf(d, byId, id as string))) throw new Error(`${at}: ${what === "its target" ? `its target ${shown(id)}` : what} is not a body made before it in the timeline`);
    if (once.has(id)) throw new Error(i > 0 && id === p.target ? `${at}'s target ${id} is also a tool` : `${at} picks ${id} twice`);
    once.add(id);
  }
  const makers = [...new Set((bodies as string[]).map((b) => bodyItem(b)!))];
  if (!Array.isArray(f.dependsOn) || f.dependsOn.length !== makers.length || makers.some((m, i) => f.dependsOn[i] !== m))
    throw new Error(`${at} must depend on exactly the items that made its target and tools, in their order (${makers.join(", ")})`);
}

/**
 * An extrude's operation, checked (version 10): `operation` join, cut or
 * intersect, always with `bodies`, a list of one or more bodies made
 * before it (an item's own, or a numbered piece), none twice; or neither.
 * A body whose item was deleted is kept (the extrude then fails, naming
 * it, as a Combine does). It depends on its sketch, then exactly on the
 * items that made its bodies, in their order.
 */
function checkOperation(d: Partial<DesignDocument>, f: Feature, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const at = `Design extrude ${f.id}`;
  const p = f.intent.parameters;
  if (!(COMBINE_OPERATIONS as readonly unknown[]).includes(p.operation)) throw new Error(`${at}'s operation ${shown(p.operation)} is not join, cut or intersect`);
  if (!Array.isArray(p.bodies) || p.bodies.length === 0) throw new Error(`${at} ${p.operation}s but names no bodies to ${p.operation === "join" ? "join to" : p.operation}`);
  notTooMany(p.bodies.length, DESIGN_LIMITS.items, `${at} names`, "bodies");
  const once = new Set<unknown>();
  for (const id of p.bodies as unknown[]) {
    const maker = typeof id === "string" ? bodyItem(id) : null;
    const there = maker === null ? undefined : byId.get(maker);
    const deleted = maker !== null && there === undefined && ID_SHAPE.test(maker) && !isPiece(id as string);
    if (!deleted && (there === undefined || there.at > byId.get(f.id)!.at || maker === f.id || !isBodyOf(d, byId, id as string))) throw new Error(`${at}: ${shown(id)} is not a body made before it in the timeline`);
    if (once.has(id)) throw new Error(`${at} picks ${id} twice`);
    once.add(id);
  }
  const want = [p.sketch as string, ...operationMakers(f).filter((m) => m !== p.sketch)];
  if (!Array.isArray(f.dependsOn) || f.dependsOn.length !== want.length || want.some((m, i) => f.dependsOn[i] !== m))
    throw new Error(`${at} must depend on its sketch, then exactly on the items that made the bodies it ${p.operation}s, in their order (${want.join(", ")})`);
}

/**
 * Whether `id` is a body of the design by its body id (version 6): an
 * item's own ("body:feature-3", the item making a body), or a piece
 * ("body:feature-5/piece:1") the data's bodies list numbers (35ec).
 */
/**
 * A Duplicate, checked (step 35e2): its one parameter `body`, a body made
 * before it (one deleted since is allowed, as a Move's: the rebuild fails
 * the Duplicate naming it), and `dependsOn` the item that made it.
 */
function checkDuplicate(d: Partial<DesignDocument>, f: Feature, byId: ReadonlyMap<string, { item: Feature; at: number }>): void {
  const at = `Design duplicate ${f.id}`;
  const p = f.intent.parameters;
  for (const key of Object.keys(p)) if (key !== "body" && key !== "mirror") throw new Error(`${at} has a parameter ${JSON.stringify(key)} a duplicate doesn't have`);
  // Mirror body (step 35e2): the origin plane its copy is mirrored across, when it is a Mirror.
  if (Object.hasOwn(p, "mirror") && !(SKETCH_PLANES as readonly unknown[]).includes(p.mirror)) throw new Error(`${at} mirrors across ${typeof p.mirror === "string" ? JSON.stringify(p.mirror) : shown(p.mirror)}, which is not an origin plane (XY, XZ or YZ)`);
  const id: unknown = p.body;
  const maker = typeof id === "string" ? bodyItem(id) : null;
  const there = maker === null ? undefined : byId.get(maker);
  const deleted = maker !== null && there === undefined && ID_SHAPE.test(maker) && !isPiece(id as string);
  if (!deleted && (there === undefined || there.at >= byId.get(f.id)!.at || !isBodyOf(d, byId, id as string))) throw new Error(`${at} copies ${shown(id)}, which is not a body made before it in the timeline`);
  if (f.dependsOn.length !== 1 || f.dependsOn[0] !== maker) throw new Error(`${at} must depend on exactly the item that made the body it copies (${maker})`);
}

function isBodyOf(d: Partial<DesignDocument>, byId: ReadonlyMap<string, { item: Feature }>, id: string): boolean {
  const maker = bodyItem(id);
  if (maker === null) return false;
  const at = byId.get(maker);
  if (!isPiece(id)) return at !== undefined && makesBody(at.item);
  return at !== undefined && makesPieces(at.item) && Array.isArray(d.bodies) && d.bodies.some((b) => isRecord(b) && b.id === id);
}

/**
 * A version 5 file's bodies (35e): each listed once, as "body:" and an
 * item's id, never a sketch's or a Move's, no number given twice, and the
 * counter above all of them, so no new body could take one. A body whose
 * item is gone, or an item with no number, is what a file edited by hand
 * (or by another program) can hold: the reader settles both as an edit
 * would (`numberBodies`: the number dropped, the next number given), so
 * every number the file gives stays as it is.
 */
function checkBodies(d: Partial<DesignDocument>, byId: ReadonlyMap<string, { item: Feature }>) {
  const { bodies, nextBody } = d;
  if (!Array.isArray(bodies)) throw new Error("Design data has no bodies list (each body's id and number)");
  notTooMany(bodies.length, DESIGN_LIMITS.items, "Design data has", "bodies");
  if (!Number.isSafeInteger(nextBody) || nextBody! < 1) throw new Error(`Design data's nextBody ${shown(nextBody)} is not a counting number`);
  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const [i, b] of bodies.entries()) {
    if (!isRecord(b) || typeof b.id !== "string") throw new Error(`Design body ${i + 1} has no id`);
    const m = /^body:([^:/]+)$/.exec(b.id);
    const item = m ? byId.get(m[1])?.item : undefined;
    // A piece (35f1): "body:<a Combine>/piece:<k>"; one whose Combine is gone is dropped by `numberBodies`, as a body whose item is.
    const maker = isPiece(b.id) ? byId.get(bodyItem(b.id)!)?.item : undefined;
    if (isPiece(b.id) ? maker !== undefined && !makesPieces(maker) : !m || (item && !makesBody(item)))
      throw new Error(`Design body ${shown(b.id)} is not "body:" and the id of an item that makes a body, or a piece of a Combine or of an extrude that joins, cuts or intersects`);
    if (ids.has(b.id)) throw new Error(`Design body ${b.id} is listed twice`);
    ids.add(b.id);
    if (!Number.isSafeInteger(b.number) || b.number < 1) throw new Error(`Design body ${b.id}'s number ${typeof b.number === "string" ? JSON.stringify(b.number) : shown(b.number)} is not a counting number`);
    if (numbers.has(b.number)) throw new Error(`Design body number ${b.number} is given twice`);
    numbers.add(b.number);
    if (b.number >= nextBody!) throw new Error(`Design data's nextBody ${nextBody} is not above body ${b.id}'s number ${b.number}, so a new body could repeat it`);
  }
}

/** Whether version 7 data holds what only version 8 brought (47e, 47f): a construction curve, or a distance or diameter dimension, in a sketch or a kept shape. */
function hasVersion8Fields(d: Record<string, unknown>): boolean {
  const curves = (list: unknown) => Array.isArray(list) && list.some((c) => isRecord(c) && Object.hasOwn(c, "construction"));
  const dims = (list: unknown) => Array.isArray(list) && list.some((c) => isRecord(c) && (c.kind === "distance" || c.kind === "diameter"));
  const sketches = Array.isArray(d.sketches) ? d.sketches.filter(isRecord) : [];
  const kept = isRecord(d.kept) ? Object.values(d.kept).filter(isRecord) : [];
  return sketches.some((s) => curves(s.curves) || dims(s.constraints)) || kept.some((k) => curves(k.curves));
}

/** Whether version 8 data holds what only version 9 brought (step 48): an extrude of a sketch naming its region. */
function hasVersion9Fields(d: Record<string, unknown>): boolean {
  const features = isRecord(d.timeline) && Array.isArray(d.timeline.features) ? d.timeline.features : [];
  return features.some((f) => isRecord(f) && isRecord(f.intent) && isRecord(f.intent.parameters) && Object.hasOwn(f.intent.parameters, "region"));
}

/** Whether version 9 data holds what only version 10 brought: an extrude with an operation (Join, Cut or Intersect) or the bodies it works on. */
function hasVersion10Fields(d: Record<string, unknown>): boolean {
  const features = isRecord(d.timeline) && Array.isArray(d.timeline.features) ? d.timeline.features : [];
  return features.some((f) => isRecord(f) && isRecord(f.intent) && f.intent.type === "extrude" && isRecord(f.intent.parameters) && (Object.hasOwn(f.intent.parameters, "operation") || Object.hasOwn(f.intent.parameters, "bodies")));
}

/** Whether version 10 data holds what only version 11 brought (step 35e2m): a Duplicate. */
function hasVersion11Fields(d: Record<string, unknown>): boolean {
  const features = isRecord(d.timeline) && Array.isArray(d.timeline.features) ? d.timeline.features : [];
  return features.some((f) => isRecord(f) && isRecord(f.intent) && f.intent.type === "duplicate");
}

/**
 * Checks an extrude's `region` (step 48): `{ outer, centroid }`, `outer`
 * the curves round the region's outside as `{ curve, reversed }` (a curve
 * id and true or false), one at least and at most a sketch's limit, and
 * `centroid` two finite numbers (mm). The ids need not be curves of the
 * sketch now: a region whose curves were deleted is lost, not wrong.
 */
function checkRegion(region: unknown, id: string): void {
  const where = `Design feature ${id}'s region`;
  if (!isRecord(region)) throw new Error(`${where} is not an object with outer and centroid`);
  for (const key of Object.keys(region)) if (key !== "outer" && key !== "centroid") throw new Error(`${where} has ${shown(key)}, which a region never holds`);
  const { outer, centroid } = region;
  if (!Array.isArray(outer) || outer.length === 0) throw new Error(`${where}'s outer is not a list of the curves round it`);
  notTooMany(outer.length, DESIGN_LIMITS.sketch, `${where} names`, "curves");
  for (const [k, p] of outer.entries()) {
    if (!isRecord(p) || typeof p.curve !== "string" || typeof p.reversed !== "boolean" || Object.keys(p).length !== 2)
      throw new Error(`${where}'s curve ${k + 1} is not { curve: an id, reversed: true or false }`);
  }
  if (!Array.isArray(centroid) || centroid.length !== 2 || !centroid.every(isFiniteNumber)) throw new Error(`${where}'s centroid ${shown(centroid)} is not two numbers of mm`);
}

export function readDesignDocument(data: unknown): DesignDocument {
  if (!isRecord(data)) throw new Error("Design data is missing");
  // Counted before migrating, which spreads every id of a version 1 file.
  for (const [list, limit, what] of [[data.profiles, DESIGN_LIMITS.profiles, "profiles"], [isRecord(data.timeline) ? data.timeline.features : undefined, DESIGN_LIMITS.items, "timeline items"], [data.sketches, DESIGN_LIMITS.items, "sketches"]] as const)
    if (Array.isArray(list)) notTooMany(list.length, limit, "Design data has", what);
  // The version the file says, for words about it: the steps below raise older data's version as they migrate it (48d hunt).
  const given = data.version;
  const v2 = data.version === 1 ? migrateDesignV1(data) : data;
  const v3 = v2.version === 2 ? migrateDesignV2(v2) : v2;
  // Version 4 has version 3's fields; only data saved before it can hold the old preset names, renamed once checked (below).
  const old = v3.version === 3;
  // Version 5 adds the bodies' numbers (35e); version 4 and older data gets the ones it showed, once checked (below), and so
  // does version 5 data leaving both out (written by hand or by a test: what an edit or a save writes always has them).
  const numbered = Object.hasOwn(v3, "bodies") || Object.hasOwn(v3, "nextBody");
  if ((old || v3.version === 4) && numbered) throw new Error(`Design data says version ${v3.version} but has bodies' numbers, which version 5 brought`);
  const unnumbered = old || v3.version === 4 || ((v3.version === 5 || v3.version === 6 || v3.version === 7 || v3.version === 8 || v3.version === 9 || v3.version === 10 || v3.version === 11) && !numbered);
  const v5 = old || v3.version === 4 ? { ...v3, version: 5 } : v3;
  // Version 6 lists bodies by body id (35ec), where version 5 and older listed their items' ids.
  const v6 = v5.version === 5 ? migrateDesignV5(v5) : v5;
  // Version 7 names a ready-made profile's pieces with its shape (face hunt 11-01): version 6 and older names are read so, once checked (below).
  const pieceNames = v6.version === 6;
  const v7 = pieceNames ? { ...v6, version: 7 } : v6;
  // Version 8 (47f) adds construction curves and dimensions, which version 7 never held; its fields are read as they are.
  if (v7.version === 7 && hasVersion8Fields(v7)) throw new Error(`Design data says version ${shown(given)} but has construction curves or dimensions, which version 8 brought`);
  const v8 = v7.version === 7 ? { ...v7, version: 8 } : v7;
  // Version 9 (48) adds an extrude's region, which version 8 never held; its fields are read as they are.
  if (v8.version === 8 && hasVersion9Fields(v8)) throw new Error(`Design data says version ${shown(given)} but has an extrude naming its sketch region, which version 9 brought`);
  const v9 = v8.version === 8 ? { ...v8, version: 9 } : v8;
  // Version 10 adds an extrude's operation (Join, Cut, Intersect) and its bodies, which version 9 never held; its fields are read as they are.
  if (v9.version === 9 && hasVersion10Fields(v9)) throw new Error(`Design data says version ${shown(given)} but has an extrude that joins, cuts or intersects, which version 10 brought`);
  const v10 = v9.version === 9 ? { ...v9, version: 10 } : v9;
  // Version 11 (35e2m) adds the Duplicate item, which version 10 never held; its fields are read as they are.
  if (v10.version === 10 && hasVersion11Fields(v10)) throw new Error(`Design data says version ${shown(given)} but has a Duplicate, which version 11 brought`);
  const d = (v10.version === 10 ? { ...v10, version: 11 } : v10) as Partial<DesignDocument>;
  // Text quoted, so "5" (text) never reads as the 5 it is not (app sweep, finding 25).
  // A whole number above 11 is from a newer SpindleLabs (kept by the unsaved-changes journal for it); anything else is wrong.
  if (d.version !== 11) throw new (Number.isSafeInteger(d.version) && d.version! > 11 ? NewerFormatError : Error)(`Design data version ${typeof d.version === "string" ? JSON.stringify(d.version) : shown(d.version)} is not one this SpindleLabs reads (1, 2, 3, 4, 5, 6, 7, 8, 9, 10 or 11)`);
  // An empty timeline is an empty design (24f4: everything deleted), shown with no body.
  if (!Array.isArray(d.profiles) || !Array.isArray(d.timeline?.features)) throw new Error("Design data has no timeline");
  if (!Array.isArray(d.sketches)) throw new Error("Design data has no sketches list");
  if (!Number.isSafeInteger(d.nextId) || d.nextId! < 1) throw new Error(`Design data's nextId ${shown(d.nextId)} is not a counting number`);
  if (d.nextId! > MAX_NEXT_ID) throw new Error(`Design data's nextId ${d.nextId} is above ${MAX_NEXT_ID}, more ids than a design can use`);
  for (const [i, profile] of d.profiles.entries()) {
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) throw new Error(`Design profile ${i + 1} is not an object`);
    // Before anything turns it into text (the id check's regular expression, the profile's own messages): issue #139.
    if (typeof profile.id !== "string") throw new Error(`Design profile ${i + 1} has no id`);
  }
  for (const [i, f] of d.timeline.features.entries()) {
    const intent = (f as Partial<Feature> | null)?.intent;
    if (typeof f?.id !== "string" || typeof intent?.type !== "string" || typeof intent.summary !== "string" || typeof intent.parameters !== "object" || intent.parameters === null)
      throw new Error(`Design feature ${i + 1} has no id or intent`);
    if (typeof f.suppressed !== "boolean") throw new Error(`Design feature ${f.id}: suppressed must be true or false, not ${shown(f.suppressed)}`);
    // The graph, the edits and the browser panel read these on every item (file fuzz hunt 10-28: a file without them opened, then crashed).
    if (!Array.isArray(f.dependsOn)) throw new Error(`Design feature ${f.id} has no dependsOn list`);
    checkProvenance(f.provenance, f.id);
  }
  // Two items with one id are said as that first (timeline hunt, finding 12: a sketch item's id given to another item
  // was refused as "a sketch with no content", sending the reader to the wrong place); every id is checked below.
  const itemIds = new Set<string>();
  for (const f of d.timeline.features) {
    if (itemIds.has(f.id)) throw new Error(`Design id ${shown(f.id)} is used twice`);
    itemIds.add(f.id);
  }
  // Each id's item (one each, checked above), so every lookup below is one step (a search in a loop took minutes on a big file, audit S2).
  const byId = new Map<string, { item: Feature; at: number }>();
  for (const [at, item] of d.timeline.features.entries()) byId.set(item.id, { item, at });
  const marker = d.timeline.marker;
  if (Object.hasOwn(d.timeline, "marker") && marker !== "start" && !byId.has(marker as string))
    throw new Error(`Design timeline marker ${shown(marker)} is not "start" or the id of an item in the timeline`);
  let content = 0;
  for (const [i, s] of d.sketches.entries()) {
    checkSketch(s, i);
    content += s.points.length + s.curves.length;
    notTooMany(content, DESIGN_LIMITS.content, "Design data's sketches have at least", "points and curves together");
  }
  // Each sketch has exactly one timeline item, on a plane this SpindleLabs knows, and each sketch item its sketch.
  const sketchIds = new Map<string, Sketch>();
  for (const s of d.sketches) {
    // A second copy would be looked past here, unchecked, yet read further on (#262).
    if (sketchIds.has(s.id)) throw new Error(`Design sketch ${s.id} is listed twice in the sketches list`);
    sketchIds.set(s.id, s);
  }
  const items = d.timeline.features.filter(isSketchItem);
  for (const f of items) {
    const content = sketchIds.get(f.id);
    if (content === undefined) throw new Error(`Design timeline item ${f.id} is a sketch with no content in the sketches list`);
    if (isFacePlane(f.intent.parameters.plane)) checkFaceSketch(f, content, byId);
    else if (Object.hasOwn(content, "face")) throw new Error(`Design sketch ${f.id} is on the ${shown(f.intent.parameters.plane)} plane but keeps a face's frame`);
    else if (!(SKETCH_PLANES as readonly unknown[]).includes(f.intent.parameters.plane)) throw new Error(`Design sketch ${f.id} is on ${shown(f.intent.parameters.plane)}, not a plane this SpindleLabs knows (XY, XZ, YZ or a face)`);
    // Any sketch's points may be pinned to an earlier body's edges (27c), checked once its plane is.
    if (Object.hasOwn(content, "pins")) checkPins(f, content, byId);
    // And its projections (27d).
    if (Object.hasOwn(content, "projected")) checkProjections(f, content, byId);
  }
  const sketchItemIds = new Set(items.map((f) => f.id));
  for (const s of d.sketches) if (!sketchItemIds.has(s.id)) throw new Error(`Design sketch ${s.id} has no place in the timeline`);
  // An extrude of a sketch comes after its sketch and depends on it, so a rebuild in order always has the outline.
  for (const [i, f] of d.timeline.features.entries()) {
    // Only an extrude of a sketch has a region: one anywhere else is refused, never kept unread (48d hunt).
    if (!isSketchExtrude(f) && isRecord(f.intent?.parameters) && Object.hasOwn(f.intent.parameters, "region"))
      throw new Error(`Design feature ${f.id} has a region, which only an extrude of a sketch has`);
    // Only an extrude of a sketch has an operation (version 10), always with its bodies, and bodies only with one.
    if (!isSketchExtrude(f) && !actsOnBodies(f) && isRecord(f.intent?.parameters) && (Object.hasOwn(f.intent.parameters, "operation") || Object.hasOwn(f.intent.parameters, "bodies")))
      throw new Error(`Design feature ${f.id} has an operation, which only an extrude of a sketch has`);
    if (!isSketchExtrude(f)) continue;
    const p = f.intent.parameters;
    if (Object.hasOwn(p, "bodies") && !Object.hasOwn(p, "operation")) throw new Error(`Design extrude ${f.id} names bodies but no operation (join, cut or intersect) to use them in`);
    if (Object.hasOwn(p, "profile")) throw new Error(`Design feature ${f.id} extrudes both a sketch and a profile`);
    // Its sketch may be gone (deleted: the extrude keeps its last shape, or fails naming it), but never another item or a later one.
    const there = byId.get(p.sketch as string)?.at ?? -1;
    if (typeof p.sketch !== "string" || (there >= 0 && (there > i || !isSketchItem(d.timeline.features[there]))))
      throw new Error(`Design feature ${f.id} extrudes ${shown(p.sketch)}, which is not a sketch before it in the timeline`);
    if (!Array.isArray(f.dependsOn) || !f.dependsOn.includes(p.sketch as string) || (!Object.hasOwn(p, "operation") && f.dependsOn.length !== 1)) throw new Error(`Design feature ${f.id} extrudes ${p.sketch} but does not depend on it`);
    if (!isFiniteNumber(p.distance)) throw new Error(`Design feature ${f.id}: distance ${shown(p.distance)} is not a number of mm`);
    if (Object.hasOwn(p, "flip") && p.flip !== true) throw new Error(`Design feature ${f.id}: flip must be true or left out, not ${shown(p.flip)}`);
    if (Object.hasOwn(p, "region")) checkRegion(p.region, f.id);
  }
  if (Object.hasOwn(d, "kept")) {
    if (!isRecord(d.kept)) throw new Error("Design data's kept shapes are not an object of extrude ids");
    for (const [id, kept] of Object.entries(d.kept)) {
      const f = byId.get(id)?.item;
      if (!f || !isSketchExtrude(f)) throw new Error(`Design data keeps a shape for ${shown(id)}, which is not an extrude of a sketch in the timeline`);
      checkKept(kept, id);
      content += (kept as KeptShape).points.length + (kept as KeptShape).curves.length;
      notTooMany(content, DESIGN_LIMITS.content, "Design data's sketches and kept shapes have at least", "points and curves together");
    }
  }
  // What the eyes hide (U0f3): each a body of the design by its body id (version 6), a sketch in the timeline, an origin axis or a folder, once.
  if (Object.hasOwn(d, "hidden")) {
    const hidden: unknown = (d as { hidden?: unknown }).hidden;
    if (!Array.isArray(hidden) || hidden.length === 0) throw new Error("Design data's hidden list is not a list of ids (left out when everything shows)");
    const once = new Set<string>();
    for (const id of hidden) {
      const at = byId.get(id as string);
      if (typeof id !== "string" || !((at && isSketchItem(at.item)) || EYE_ROWS.includes(id) || isBodyOf(d, byId, id))) throw new Error(`Design data hides ${shown(id)}, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder`);
      if (once.has(id)) throw new Error(`Design data hides ${id} twice`);
      once.add(id);
    }
  }
  // The origin's planes shown by their eyes: each one of them, once.
  if (Object.hasOwn(d, "shownPlanes")) {
    const planes: unknown = (d as { shownPlanes?: unknown }).shownPlanes;
    if (!Array.isArray(planes) || planes.length === 0) throw new Error("Design data's shown planes are not a list of origin planes (left out when none shows)");
    const once = new Set<string>();
    for (const id of planes) {
      if (typeof id !== "string" || !(ORIGIN_PLANES as readonly string[]).includes(id)) throw new Error(`Design data shows ${shown(id)}, which is not an origin plane`);
      if (once.has(id)) throw new Error(`Design data shows ${id} twice`);
      once.add(id);
    }
  }
  // Ids are unique in the document (a sketch shares its id with its timeline item), and the counter is above all of them.
  const seen = new Set<string>();
  const ids = [
    ...d.profiles.map((p) => p.id),
    ...d.timeline.features.map((f) => f.id),
    ...d.sketches.flatMap((s) => [...s.points.map((p) => p.id), ...s.curves.map((c) => c.id), ...(s.projected ?? []).map((p) => p.id), ...s.constraints.map((c) => c.id)]),
  ];
  // A kept shape holds a sketch's old ids (some may still be in the sketch): never repeated by a new id, so the counter is above them too.
  // So does a move's deleted body, so no new body takes its id and is moved by it.
  const kept = [...Object.values(d.kept ?? {}).flatMap((k) => [...k.points.map((p) => p.id), ...k.curves.map((c) => c.id)]), ...d.timeline.features.filter((f) => actsOnBodies(f) || isOperationExtrude(f)).flatMap((f) => f.dependsOn)];
  for (const id of kept) {
    const n = idNumber(id);
    if (n !== null && n >= d.nextId!) throw new Error(`Design data's nextId ${d.nextId} is not above ${id}, so a new id could repeat it`);
  }
  for (const id of ids) {
    // Shaped as Design makes ids (sketch-3), so no id is a name every object has, like __proto__ (re-check N1).
    if (!ID_SHAPE.test(id)) throw new Error(`Design id ${JSON.stringify(id)} is not shaped like Design's ids: a lower-case word and its number, like sketch-3`);
    if (seen.has(id)) throw new Error(`Design id ${shown(id)} is used twice`);
    seen.add(id);
    const n = idNumber(id);
    if (n !== null && n >= d.nextId!) throw new Error(`Design data's nextId ${d.nextId} is not above ${id}, so a new id could repeat it`);
  }
  // No constraint names a point that follows a body (47d4 review): a body's edit moves it without a solve, so the constraint would stop holding.
  for (const s of d.sketches) {
    if (s.constraints.length === 0) continue;
    const curves = new Map(s.curves.map((c) => [c.id, c]));
    const follows = new Set((s.pins ?? []).map((p) => p.point));
    for (const p of s.projected ?? []) {
      const c = curves.get(p.made);
      for (const q of c === undefined ? [p.made] : c.kind === "line" ? [c.start, c.end] : c.kind === "circle" ? [c.centre] : [c.start, c.end, c.centre]) follows.add(q);
    }
    for (const c of s.constraints) for (const q of constraintPoints(c)) if (follows.has(q)) throw new Error(`Design sketch ${s.id}: constraint ${c.id} names ${q}, which follows a body's edge, so a constraint can't hold it`);
    // A projected circle's size is the body's (47e).
    for (const c of s.constraints) if (c.kind === "diameter" && (s.projected ?? []).some((p) => p.made === c.circle)) throw new Error(`Design sketch ${s.id}: dimension ${c.id} sizes ${c.circle}, which is projected from a body, so the body says its size`);
  }
  // Every solid feature is its own body (24d1), so each one's sizes or profile are checked, not only the part's.
  // Whether any of them builds doesn't matter: a design with no body opens as one (24f4).
  const profiles = new Map<unknown, ReadyProfile>();
  for (const p of d.profiles) if (!profiles.has(p.id)) profiles.set(p.id, p);
  for (const f of d.timeline.features) if (ownShape(f) || isOperationExtrude(f)) shapeWith(f, (id) => profiles.get(id));
  // A Move's numbers and bodies (step 35e2).
  for (const f of d.timeline.features) if (isMoveItem(f)) checkMove(d, f, byId);
  // A Combine's bodies and operation (step 35f1).
  for (const f of d.timeline.features) if (isCombineItem(f)) checkCombine(d, f, byId);
  // A Duplicate's body (step 35e2).
  for (const f of d.timeline.features) if (isDuplicateItem(f)) checkDuplicate(d, f, byId);
  // An extrude's operation and its bodies (Design data version 10).
  for (const f of d.timeline.features) if (isOperationExtrude(f)) checkOperation(d, f, byId);
  // Each dependency an id (after the Move's own check, which says what a move's should be).
  for (const f of d.timeline.features)
    for (const id of f.dependsOn as unknown[]) {
      if (typeof id !== "string") throw new Error(`Design feature ${f.id} depends on ${shown(id)}, which is not an id`);
      // Built in timeline order, so an item can only depend on one before it; the graph refuses a loop, and the design showed nothing (real-use hunt S4).
      const there = byId.get(id);
      if (there !== undefined && there.at >= byId.get(f.id)!.at) throw new Error(`Design feature ${f.id} depends on ${id}, which is not before it in the timeline`);
    }
  if (!unnumbered) checkBodies(d, byId);
  const read = withRuledNames(d as DesignDocument);
  const short = old ? withShortNames(read) : read;
  const named = pieceNames ? withKindPieces(short) : short;
  // Numbered as version 4 data showed, or (version 5) any body the file gives no number gets the next one.
  return numberBodies(named);
}

/**
 * What a sketch is built on, by id, each once: the feature whose face it is
 * drawn on (26c), then each feature its points are pinned to (27c, the
 * naming model's rule 13), then each an edge is projected from (27d); none
 * on an origin plane with no pins or projections.
 */
export function sketchInputs(f: Feature, content: Pick<Sketch, "pins" | "projected"> | undefined): string[] {
  const plane = f.intent.parameters.plane;
  const face = isFacePlane(plane) ? faceFeature(plane) : null;
  return [...new Set([...(face === null ? [] : [face]), ...(content?.pins ?? []).flatMap((p) => p.feature ?? []), ...(content?.projected ?? []).map((p) => p.feature)])];
}

/**
 * One question's lookups and answers (app hunt 11-04): `greyedBy` and
 * `builds` ask again about what each item is built on, so without these a
 * stack of sketches each pinned to the two bodies before it took time
 * exponential in its length (61 items froze the tab for 17 s on open).
 */
interface Asked {
  document: DesignDocument;
  byId: Map<unknown, Feature>;
  sketches: Map<unknown, Feature>;
  contents: Map<string, Sketch>;
  marker: number | null;
  greyed: Map<Feature, string | null>;
  builds: Map<Feature, boolean>;
}

function asking(document: DesignDocument): Asked {
  const { features, marker } = document.timeline;
  const byId = new Map<unknown, Feature>();
  const sketches = new Map<unknown, Feature>();
  for (const f of features) {
    if (!byId.has(f.id)) byId.set(f.id, f);
    if (isSketchItem(f) && !sketches.has(f.id)) sketches.set(f.id, f);
  }
  const contents = new Map<string, Sketch>();
  for (const s of document.sketches) if (!contents.has(s.id)) contents.set(s.id, s);
  // The last index in range: none for "start", all for no marker, and none for a marker naming no item (findIndex's -1).
  const end = marker === "start" ? -1 : marker === undefined ? null : features.findIndex((x) => x.id === marker);
  return { document, byId, sketches, contents, marker: end, greyed: new Map(), builds: new Map() };
}

/** What an item is built on, of the items in the timeline: a sketch's (`sketchInputs`); an extrude of a sketch, the sketch, then (with an operation) the items that made its bodies; else nothing. */
function inputsOf(a: Asked, f: Feature): Feature[] {
  if (isSketchItem(f)) return sketchInputs(f, a.contents.get(f.id)).flatMap((id) => a.byId.get(id) ?? []);
  if (onBodies(f)) return f.dependsOn.flatMap((id) => a.byId.get(id) ?? []);
  const sketch = isSketchExtrude(f) ? a.sketches.get(f.intent.parameters.sketch) : undefined;
  return [...(sketch === undefined ? [] : [sketch]), ...makersOf(a.byId, f)];
}

/** The items that made an operation extrude's bodies, those still in the timeline (none for any other item). */
const makersOf = (byId: ReadonlyMap<unknown, Feature>, f: Feature): Feature[] => operationMakers(f).flatMap((id) => byId.get(id) ?? []);

function greyedIn(a: Asked, f: Feature): string | null {
  const known = a.greyed.get(f);
  if (known !== undefined) return known;
  // Nothing greys it while it is being asked about: an item built on itself (a file with a loop is refused when read).
  a.greyed.set(f, null);
  let by: string | null = null;
  for (const input of inputsOf(a, f)) if ((by = input.suppressed ? input.id : greyedIn(a, input)) !== null) break;
  a.greyed.set(f, by);
  return by;
}

function buildsIn(a: Asked, f: Feature): boolean {
  const known = a.builds.get(f);
  if (known !== undefined) return known;
  a.builds.set(f, false);
  const answer = buildsNow(a, f);
  a.builds.set(f, answer);
  return answer;
}

function buildsNow(a: Asked, f: Feature): boolean {
  const { document } = a;
  const at = document.timeline.features.indexOf(f);
  if (at < 0 || f.suppressed) return false;
  if (a.marker !== null && at > a.marker) return false;
  if (greyedIn(a, f) !== null) return false;
  // A Move builds when every body it moves does; a Combine when its target and tools do; a Duplicate when its body does.
  if (onBodies(f)) return inputsOf(a, f).every((x) => buildsIn(a, x));
  if (isSketchItem(f) || !isSketchExtrude(f)) return true;
  // An extrude with an operation also needs every body it works on (version 10).
  if (!makersOf(a.byId, f).every((x) => buildsIn(a, x))) return false;
  const sketch = a.sketches.get(f.intent.parameters.sketch);
  // A deleted sketch: the extrude builds from its kept shape, if it has one (24d2).
  if (sketch === undefined) return keptOf(document, f) !== undefined;
  return buildsIn(a, sketch);
}

/**
 * The suppressed item that greys `f` (Q3; from 26e for every item built
 * on another, an extrude of a suppressed sketch too; from 27c a sketch
 * whose point is pinned to a suppressed feature's body): of what it is
 * built on, in order, the first suppressed, or else whatever greys it;
 * null when nothing does, `f` itself suppressed included.
 */
export function greyedBy(document: DesignDocument, f: Feature): string | null {
  return greyedIn(asking(document), f);
}

/**
 * Whether a timeline item builds: it is at or before the marker, not
 * suppressed, not greyed (`greyedBy`), and (an extrude of a sketch) its
 * sketch builds too, or it has a kept shape. A sketch on a face whose
 * feature is gone or fails still builds, held where it was (26c, Q1). The
 * kernel judges the rest (an outline that doesn't close) when it builds;
 * the rebuild gives each item's real result.
 */
export function builds(document: DesignDocument, f: Feature): boolean {
  return buildsIn(asking(document), f);
}

/** Each item's state from the data alone, the whole timeline at once (`buildingItems`, `greyedItems`). */
function walk(document: DesignDocument): { building: Set<Feature>; greyed: Map<Feature, string> } {
  const { features, marker } = document.timeline;
  // Items before `end` are in range; a marker naming no item leaves none (as `builds` finds no index for it).
  const end = marker === "start" ? 0 : marker === undefined ? features.length : features.findIndex((x) => x.id === marker) + 1;
  const sketches = new Map<unknown, Feature>();
  const byId = new Map<unknown, Feature>();
  for (const f of features) {
    if (isSketchItem(f) && !sketches.has(f.id)) sketches.set(f.id, f);
    if (!byId.has(f.id)) byId.set(f.id, f);
  }
  const contents = new Map<string, Sketch>();
  for (const s of document.sketches) if (!contents.has(s.id)) contents.set(s.id, s);
  const open = new Set(features.filter((f, i) => i < end && !f.suppressed));
  const building = new Set<Feature>();
  const greyed = new Map<Feature, string>();
  // In timeline order, so what an item is built on (always before it; a file that puts it later is refused when opened) is decided first.
  for (const f of open) {
    // A sketch: its face's feature, then each feature a pin (27c) or a projection (27d) names, as `inputsOf` (one lookup each, audit S2).
    const sketch = isSketchExtrude(f) ? sketches.get(f.intent.parameters.sketch) : undefined;
    const inputs = isSketchItem(f) ? sketchInputs(f, contents.get(f.id)).flatMap((id) => byId.get(id) ?? []) : onBodies(f) ? f.dependsOn.flatMap((id) => byId.get(id) ?? []) : [...(sketch === undefined ? [] : [sketch]), ...makersOf(byId, f)];
    const input = sketch;
    // An extrude with an operation builds only when every body it works on does (version 10).
    const bodiesBuild = makersOf(byId, f).every((x) => building.has(x));
    let by: string | null = null;
    for (const x of inputs) if ((by = x.suppressed ? x.id : (greyed.get(x) ?? null)) !== null) break;
    if (by !== null) greyed.set(f, by);
    // A sketch builds, on a face followed or held (26c); an extrude when its sketch does (a sketch on an origin plane
    // whenever it is in range and on, wherever it is), or from its kept shape when it is gone.
    // A Move when every body it moves builds (step 35e2), a Combine when its target and tools do (35f1), a Duplicate when its body does.
    else if (onBodies(f) ? inputs.every((x) => building.has(x)) : !isSketchExtrude(f) || (bodiesBuild && (input === undefined ? keptOf(document, f) !== undefined : building.has(input) || (!isFacePlane(input.intent.parameters.plane) && open.has(input))))) building.add(f);
  }
  return { building, greyed };
}

/**
 * Every timeline item that builds (`builds`), for the whole timeline at
 * once in time in proportion to it (security audit S2): `builds` searches
 * the timeline on each call, so asking it about every item takes the
 * timeline's length squared, which froze the tab on a big file.
 */
export function buildingItems(document: DesignDocument): Set<Feature> {
  return walk(document).building;
}

/** Every greyed item (`greyedBy`, 26e) in range and not suppressed itself, with what greys it, for the whole timeline at once. */
export function greyedItems(document: DesignDocument): Map<Feature, string> {
  return walk(document).greyed;
}

/**
 * The part the panel edits: the last solid feature that builds, or null
 * when none does (24f4: the marker at the start, every solid suppressed,
 * rolled back or deleted, or only sketches left). Every solid feature is
 * its own body in the data from version 3.
 */
export function partFeature(document: DesignDocument): Feature | null {
  const { features } = document.timeline;
  // One set of answers for the whole search, so each item is worked out once.
  const a = asking(document);
  for (let i = features.length - 1; i >= 0; i--) if (ownShape(features[i]) && buildsIn(a, features[i])) return features[i];
  return null;
}

/** The part (`partFeature`) where one is needed (a test's or a command's build); throws when the design has no body. */
export function lastFeature(document: DesignDocument): Feature {
  const f = partFeature(document);
  if (!f) throw new Error("Design builds no body: every solid feature is suppressed, rolled back or deleted");
  return f;
}
