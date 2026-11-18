// The Construct tool's rules (step 59a2), pure so they are unit-tested: what
// each slot of each kind wants (a plane, a line, a point, a straight edge, a
// round one), which picks in the view fit it and what is refused in plain
// words, the choices offered without picking (the origin's planes, axes and
// point, and the constructions made earlier), the number typed, and the
// words the panel and the hint use. The kernel itself refuses what these
// rules can't see (planes that never meet) in its own words. The panel is
// construct-panel.ts, the controller construct-view.ts; workspace.ts wires it.

import { CONSTRUCT_KINDS, kindNumber, ORIGIN_REFS, type ConstructAnswer, type ConstructKind, type ConstructShape } from "./construct-data.ts";
import { KIND_WORDS } from "./construct.ts";
import { constructNumberProblem, constructOf, insertAt, isConstructItem, type DesignDocument } from "./document.ts";

/** What a slot wants: a plane, a line (an axis or a straight edge), a point, a straight edge, or a round one (a circle or a curved face). */
export type SlotRole = "plane" | "line" | "point" | "edge" | "round";

/** The role of `slot` of `kind`: "first", "second" and "third" are points for the kinds through points and planes for the others. */
export function slotRole(kind: ConstructKind, slot: string): SlotRole {
  if (slot === "plane" || slot === "line" || slot === "point" || slot === "edge" || slot === "round") return slot;
  return kind === "plane_through_points" || kind === "axis_through_points" ? "point" : "plane";
}

const ROLE_WORDS: Record<SlotRole, string> = { plane: "plane", line: "line", point: "point", edge: "edge", round: "round edge or face" };
const ORDINALS: Record<string, string> = { first: "First", second: "Second", third: "Third" };

/** A slot's name on the panel: "Plane", "Line", "First point", "Second plane". */
export function slotLegend(kind: ConstructKind, slot: string): string {
  const role = slotRole(kind, slot);
  const base = { plane: "Plane", line: "Line", point: "Point", edge: "Edge", round: "Round edge or face" }[role];
  return ORDINALS[slot] === undefined ? base : `${ORDINALS[slot]} ${base.toLowerCase()}`;
}

/** The kinds as the menu and the panel's Type list group them, in menu order. */
export const KIND_GROUPS: readonly { shape: ConstructShape; heading: string; kinds: readonly ConstructKind[] }[] = (["plane", "axis", "point"] as const).map((shape) => ({
  shape,
  heading: { plane: "Plane", axis: "Axis", point: "Point" }[shape],
  kinds: (Object.keys(CONSTRUCT_KINDS) as ConstructKind[]).filter((k) => CONSTRUCT_KINDS[k].makes === shape),
}));

/** What each kind does, in a few plain words, for its menu tooltip. */
export const KIND_DOES: Record<ConstructKind, string> = {
  offset_plane: "a plane a distance away from a plane or flat face",
  angle_plane: "a plane turned by an angle about a line, from a plane or flat face",
  mid_plane: "a plane exactly midway between two planes or flat faces",
  plane_through_points: "a plane through three points",
  plane_through_line_and_point: "a plane through a line and a point off it",
  axis_through_points: "an axis through two points",
  axis_along: "an axis along a straight edge or another axis",
  axis_where_planes_meet: "an axis where two planes or flat faces cross",
  axis_square_to_plane: "an axis square to a plane, through a point",
  point_at: "a point at a corner, the origin or another point",
  point_midway: "a point halfway along a straight edge",
  point_centre: "a point at the centre of a circle or round face",
  point_where_line_crosses: "a point where a line goes through a plane",
  point_where_planes_meet: "a point where three planes or flat faces meet",
};

/** A menu item's tooltip for `kind`: its words, what it makes, what to pick. */
export const kindTitle = (kind: ConstructKind): string => `${KIND_WORDS[kind]}: ${KIND_DOES[kind]}. Pick what it is made from, then OK. A construction in the timeline, at the marker.`;

/** The panel's refusal words for a pick that does not fit the slot. */
export const NO_NAME = "That has no name of its own (two alike in the design), so a construction could not find it again after an edit.";
export const CURVED_FACE = "That face is curved: pick a flat face, a plane, or choose one from the list.";
export const STRAIGHT_ONLY = "That edge is curved: pick a straight edge, or choose an axis from the list.";
export const ROUND_ONLY = "That edge is straight: pick a circle or arc, or a round face.";

/** A thing picked in the view. */
export type Target = { kind: "face"; flat: boolean } | { kind: "edge"; straight: boolean } | { kind: "corner" };

/** Why `target` doesn't fit a slot with `role`, in plain words, or null when it does. */
export function targetRefusal(role: SlotRole, target: Target): string | null {
  if (target.kind === "corner") return role === "point" ? null : `This wants a ${ROLE_WORDS[role]}: a corner is a point. Pick a ${ROLE_WORDS[role]}, or choose one from the list.`;
  if (target.kind === "face") {
    if (role === "plane") return target.flat ? null : CURVED_FACE;
    if (role === "round") return target.flat ? ROUND_ONLY : null;
    return `This wants a ${ROLE_WORDS[role]}: a face is not one. Pick a ${ROLE_WORDS[role]}, or choose one from the list.`;
  }
  if (role === "line" || role === "edge") return target.straight ? null : STRAIGHT_ONLY;
  if (role === "round") return target.straight ? ROUND_ONLY : null;
  return `This wants a ${ROLE_WORDS[role]}: an edge is not one. Pick a ${ROLE_WORDS[role]}, or choose one from the list.`;
}

/** A choice offered in a slot's list: the name an item keeps (construct-data.ts) and its words. */
export interface Choice {
  ref: string;
  label: string;
}

const ORIGIN_CHOICES: Record<SlotRole, readonly Choice[]> = {
  plane: [{ ref: "XY", label: "XY plane" }, { ref: "XZ", label: "XZ plane" }, { ref: "YZ", label: "YZ plane" }],
  line: [{ ref: "X", label: "X axis" }, { ref: "Y", label: "Y axis" }, { ref: "Z", label: "Z axis" }],
  point: [{ ref: "O", label: "Origin" }],
  edge: [],
  round: [],
};

/** What an earlier construction of this shape is to a slot with this role: a plane, an axis as a line, a point. */
const SHAPE_OF: Partial<Record<SlotRole, ConstructShape>> = { plane: "plane", line: "axis", point: "point" };

/** Every origin choice's name is one the data reads (a guard for the table above). */
export const ORIGIN_NAMES: readonly string[] = ORIGIN_REFS;

/**
 * What a slot's list offers without a pick: the origin's planes, axes or
 * point for its role, then the constructions already in the timeline before
 * the marker that make that shape and are not suppressed (by their names,
 * "construct:feature-5").
 */
export function choicesFor(doc: DesignDocument, role: SlotRole): Choice[] {
  const out: Choice[] = [...ORIGIN_CHOICES[role]];
  const shape = SHAPE_OF[role];
  if (shape === undefined) return out;
  const at = insertAt(doc);
  doc.timeline.features.forEach((f, i) => {
    if (i < at && isConstructItem(f) && !f.suppressed && constructOf(f).answer.kind === shape) out.push({ ref: `construct:${f.id}`, label: f.provenance.self.label });
  });
  return out;
}

/** The words for an origin or earlier construction's name, or null for a name this list doesn't hold. */
export function choiceLabel(choices: readonly Choice[], ref: string): string | null {
  return choices.find((c) => c.ref === ref)?.label ?? null;
}

/** A strict number as the size boxes give it ("0x10" and "Infinity" are not numbers). */
function strict(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The number `kind` needs, read from what is typed (millimetres for a
 * distance, degrees for an angle): `none` for a kind that takes none, else
 * the value, or why not in plain words. Limits are the data's (`constructNumberProblem`).
 */
export function readNumber(kind: ConstructKind, text: string): { none: true } | { value: number } | { why: string } {
  const need = kindNumber(kind);
  if (need === null) return { none: true };
  const what = need === "distance" ? "distance in mm" : "angle in degrees";
  const v = strict(text);
  if (v === null) return { why: text.trim() === "" ? `Type the ${what}.` : `"${text.trim()}" is not a number: type the ${what}.` };
  const problem = constructNumberProblem(kind, { [need]: v });
  return problem === null ? { value: v } : { why: `The ${KIND_WORDS[kind].toLowerCase()} can't be made: ${problem}.` };
}

/** The default distance (mm) and angle (degrees) a new offset or angle plane starts with. */
export const DEFAULT_DISTANCE = 10;
export const DEFAULT_ANGLE = 45;

/** The hint over the view: what to pick next for `slot`, or that it is ready. */
export function constructHint(kind: ConstructKind, next: string | null, bodies: number, touch: boolean): string {
  if (next === null) return `${KIND_WORDS[kind]}: ready, press OK`;
  const role = slotRole(kind, next);
  const tap = touch ? "tap" : "click";
  if (bodies === 0 && role !== "plane" && role !== "line" && role !== "point") return `${KIND_WORDS[kind]} needs a body: make one first with Insert or Extrude`;
  return `${KIND_WORDS[kind]}: ${tap} ${role === "round" ? "a circle or round face" : `a ${ROLE_WORDS[role]}`} in the view, or choose from the list`;
}

/** The answer in a few words, for the panel's preview line ("a plane, 12.5 mm from the origin"). */
export function answerWords(a: ConstructAnswer): string {
  const short = (x: number) => String(Number(x.toFixed(3)));
  const at = (p: readonly number[]) => `(${p.map(short).join(", ")})`;
  if (a.kind === "plane") return `A plane through ${at(a.near)}, facing ${at(a.normal)}`;
  if (a.kind === "axis") return `An axis through ${at(a.near)}, along ${at(a.direction)}`;
  return `A point at ${at(a.point)}`;
}
