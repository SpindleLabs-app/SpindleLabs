// Pattern's values (step 61): what an item holds, checked in plain words
// (`patternProblem`), the kernel's request, the summary's words and the
// copies' ids. Pure, with no import of document.ts, so the data reader can
// check a Pattern item with the same rules the tool uses (pattern.ts puts
// the item in; rebuild.ts builds it).

import type { PatternSpec } from "@fission/core";
import type { DesignDocument } from "./document.ts";
import { constructPlaneItem, CONSTRUCT_REF, type ConstructAnswer } from "./construct-data.ts";

/** A value from a file, for a message (document.ts `shown`'s rule): text as it is, anything else by kind, never its own toString. */
const shown = (x: unknown): string => (typeof x === "object" && x !== null ? (Array.isArray(x) ? "a list" : "an object") : String(x));

/** The origin's axes a pattern runs along or round. */
export const PATTERN_AXES = ["X", "Y", "Z"] as const;
export type PatternAxis = (typeof PATTERN_AXES)[number];

/**
 * What a pattern turns round (step 59a3b): an origin axis, or a construction
 * axis by its name, "construct:feature-7" (behind ?construct). Round a
 * construction axis the Pattern keeps no centre: the axis's own line says
 * where it turns, found again on every rebuild.
 */
export type TurnAxis = PatternAxis | `${typeof CONSTRUCT_REF}${string}`;

/** The construction a Pattern turns round ("construct:feature-7" → "feature-7"), or null for an origin axis or anything else. */
export const turnAxisItem = (axis: unknown): string | null => constructPlaneItem(axis);

/** The most instances a pattern makes, the original included: the kernel's MAX_INSTANCES (all fit one Join). */
export const MAX_INSTANCES = 256;

/** A spacing's size: a length the kernel takes (1 µm to 1 km), either way. */
export const MIN_SPACING = 0.001;
export const MAX_SPACING = 1_000_000;

/** A full turn, in degrees: the copies spaced evenly all the way round. */
export const FULL_TURN = 360;

/** The kernel's ANGULAR (radians): a partial angle's step must be more, and it must be more short of a full turn. */
const ANGULAR = 1e-9;

/** How far from the origin the centre may be: the kernel's model space, ±100 km. */
export const MAX_COORD = 1e8;

/** A row (with an optional second direction, a grid). Spacings in mm, negative the other way. */
export interface LinearValues {
  kind: "linear";
  direction: PatternAxis;
  spacing: number;
  count: number;
  direction2?: PatternAxis;
  spacing2?: number;
  count2?: number;
}

/**
 * Instances round an axis: an origin axis through `centre`, or a
 * construction axis (no centre: its line is where it turns); over a full
 * turn (`angle` 360) or a partial angle (degrees, negative the other way).
 */
export interface CircularValues {
  kind: "circular";
  axis: TurnAxis;
  centre?: [number, number, number];
  count: number;
  angle: number;
}

export type PatternValues = (LinearValues | CircularValues) & { join: boolean };

/** The kernel's form of a pattern (its `pattern_motions`, core's `PatternSpec`). */
export type PatternRequest = PatternSpec;

/** Each axis as a unit direction. */
const UNIT: Record<PatternAxis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** How many instances a pattern makes, the original included. */
export const instanceCount = (v: PatternValues): number => (v.kind === "linear" ? v.count * (v.direction2 === undefined ? 1 : (v.count2 ?? 1)) : v.count);

const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Why a spacing can't be used, or null. */
function spacingProblem(s: unknown, which: string): string | null {
  if (!finite(s)) return `Type ${which} in mm.`;
  if (Math.abs(s) < MIN_SPACING) return `${cap(which)} must be at least ${MIN_SPACING} mm (it can be negative to go the other way).`;
  if (Math.abs(s) > MAX_SPACING) return `${cap(which)} can be at most ${MAX_SPACING.toLocaleString("en")} mm.`;
  return null;
}

/** Degrees to radians, as the request sends them (the check uses the same). */
const radians = (deg: number) => (deg * Math.PI) / 180;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Why these values make no pattern, in plain words, or null when the kernel
 * may be asked: counts whole numbers, at least 1 along each direction, 2 to
 * MAX_INSTANCES in all; spacings 1 µm to 1 km either way; a grid's second
 * direction another axis (a second count or spacing with no second
 * direction is a leftover and ignored, as the request ignores it); round an
 * axis: the centre three finite numbers within ±100 km, the angle above 0
 * and at most a full turn either way, and a partial angle the kernel can
 * tell from a full turn and whose steps it can tell from no turn.
 */
export function patternProblem(v: PatternValues): string | null {
  if (v.kind === "linear") {
    if (!PATTERN_AXES.includes(v.direction)) return `${shown(v.direction)} is not X, Y or Z.`;
    if (!whole(v.count) || v.count < 1) return "Type how many along the direction, a whole number from 1.";
    const s = spacingProblem(v.spacing, "the spacing");
    if (s !== null) return s;
    if (v.direction2 !== undefined) {
      if (!PATTERN_AXES.includes(v.direction2)) return `${shown(v.direction2)} is not X, Y or Z.`;
      if (v.direction2 === v.direction) return "The second direction must be another axis, or the copies would land on each other.";
      if (!whole(v.count2) || v.count2 < 1) return "Type how many along the second direction, a whole number from 1.";
      const s2 = spacingProblem(v.spacing2, "the second spacing");
      if (s2 !== null) return s2;
    }
  } else {
    const construct = turnAxisItem(v.axis) !== null;
    if (!construct && !PATTERN_AXES.includes(v.axis as PatternAxis)) return `${shown(v.axis)} is not X, Y, Z or a construction axis.`;
    if (!whole(v.count)) return "Type how many, a whole number from 2.";
    if (construct) {
      // The axis's own line is where it turns: a centre too would be a second answer to the same question.
      if (v.centre !== undefined) return "A construction axis says where it turns: a pattern round one has no centre.";
    } else {
      if (!Array.isArray(v.centre) || v.centre.length !== 3 || !v.centre.every(finite)) return "Type the centre in mm.";
      if (v.centre.some((c) => Math.abs(c) > MAX_COORD)) return `The centre must be within 100 km (${MAX_COORD.toLocaleString("en")} mm) of the origin.`;
    }
    if (!finite(v.angle) || v.angle === 0) return "Type the angle in degrees, above 0 (negative turns the other way).";
    if (Math.abs(v.angle) > FULL_TURN) return `The angle can be at most ${FULL_TURN}°, a full turn.`;
    // The kernel's own limits on a partial angle, in the radians it is sent in.
    const theta = Math.abs(radians(v.angle));
    if (Math.abs(v.angle) !== FULL_TURN && theta >= 2 * Math.PI - ANGULAR) return "The angle is too close to a full turn to tell apart: type 360 for a full turn.";
    if (Math.abs(v.angle) !== FULL_TURN && v.count >= 2 && theta / (v.count - 1) <= ANGULAR) return "The angle is too small for that many: each step must be more than about 0.00000006°.";
  }
  const n = instanceCount(v);
  if (n < 2) return "A pattern needs at least 2, the body and one copy.";
  if (n > MAX_INSTANCES) return `A pattern makes at most ${MAX_INSTANCES}, the body included; this one would make ${n}.`;
  return null;
}

/**
 * The kernel's request for checked values (`patternProblem` null): a row's
 * directions as unit axes, its spacings in mm; round an axis, the angle in
 * radians, left out for a full turn (the kernel spaces n evenly all the way
 * round, so the last copy is one step short of the original). Round a
 * construction axis (step 59a3b) the turn is about the line `axis`, the
 * construction as the rebuild answered it: through its point, along its
 * direction; refused, never guessed, with no axis answered.
 */
export function patternRequest(v: PatternValues, axis?: ConstructAnswer): PatternRequest {
  if (v.kind === "linear") {
    const across = v.direction2 === undefined ? {} : { across: { along: [...UNIT[v.direction2]] as [number, number, number], spacing: v.spacing2!, count: v.count2! } };
    return { linear: { along: [...UNIT[v.direction]] as [number, number, number], spacing: v.spacing, count: v.count, ...across } };
  }
  const full = Math.abs(v.angle) === FULL_TURN;
  let pivot: [number, number, number];
  let along: [number, number, number];
  if (turnAxisItem(v.axis) !== null) {
    if (axis?.kind !== "axis") throw new Error(`${shown(v.axis)} is turned round with no axis answered for it`);
    [pivot, along] = [[...axis.point], [...axis.direction]];
  } else [pivot, along] = [[...v.centre!], [...UNIT[v.axis as PatternAxis]]];
  // A full turn the other way round lands on the same places, in the other order.
  return { circular: { pivot, axis: v.angle < 0 && full ? (along.map((x) => -x) as [number, number, number]) : along, count: v.count, ...(full ? {} : { angle: radians(v.angle) }) } };
}

/**
 * A pattern's description: "3 of Box 1 in a row along X, 10 mm apart", "6 of
 * Box 1 round the Z axis", round a construction axis by its name (`axisName`,
 * "6 of Box 1 round Axis 1"), ", joined".
 */
export function patternSummary(names: readonly string[], v: PatternValues, axisName?: string): string {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const mm = (n: number) => `${Number(n.toPrecision(12))} mm`;
  const words =
    v.kind === "linear"
      ? v.direction2 === undefined
        ? `${v.count} of ${list} in a row along ${v.direction}, ${mm(v.spacing)} apart`
        : `${v.count} × ${v.count2} of ${list} in a grid along ${v.direction} and ${v.direction2}, ${mm(v.spacing)} and ${mm(v.spacing2!)} apart`
      : `${v.count} of ${list}${Math.abs(v.angle) === FULL_TURN ? "" : ` over ${Number(v.angle.toPrecision(12))}°`} round ${turnAxisItem(v.axis) !== null ? (axisName ?? v.axis) : `the ${v.axis} axis`}`;
  return v.join ? `${words}, joined` : words;
}

/** What the kernel's refusal names (its `inputs`' param names) means in the pattern's own words. */
export const KERNEL_INPUT_WORDS: Record<string, string> = {
  along: "the direction",
  spacing: "the spacing",
  count: "the count",
  across: "the second direction",
  spacing2: "the second spacing",
  count2: "the second count",
  pivot: "the centre",
  axis: "the axis",
  angle: "the angle",
};

/** Why Join can't be used on a body with a sphere face yet (cylinders it joins since curved Combine, 37df). */
export const CURVED_JOIN = "Join can't join copies of a body with a sphere face yet (spheres are coming). Turn Join off to keep the copies as separate bodies.";

/** The copies' body ids: `body:<pattern>/piece:k`, k from 1, each source's copies in turn, in the kernel's order. */
export function copyIds(pattern: string, sources: number, copiesEach: number): string[] {
  return Array.from({ length: sources * copiesEach }, (_, k) => `body:${pattern}/piece:${k + 1}`);
}


/** A Pattern item's parameters: `bodies` (body ids) and `join`, with the values of its kind. */
const LINEAR_KEYS = ["kind", "direction", "spacing", "count", "join"] as const;
const GRID_KEYS = ["direction2", "spacing2", "count2"] as const;
const CIRCULAR_KEYS = ["kind", "axis", "centre", "count", "angle", "join"] as const;
/** Round a construction axis (step 59a3b): no centre. */
const CONSTRUCT_TURN_KEYS = ["kind", "axis", "count", "angle", "join"] as const;

/**
 * Why an item's saved parameters (less `bodies`) are no Pattern's values, in
 * words, or null: exactly a row's keys (with a grid's three together) or a
 * turn's (no centre round a construction axis), `join` true or false, and
 * values `patternProblem` takes.
 */
export function patternParamsProblem(p: Record<string, unknown>): string | null {
  const keys = Object.keys(p).filter((k) => k !== "bodies");
  const want: readonly string[] = p.kind === "linear" ? [...LINEAR_KEYS, ...(Object.hasOwn(p, "direction2") ? GRID_KEYS : [])] : p.kind === "circular" ? (turnAxisItem(p.axis) !== null ? CONSTRUCT_TURN_KEYS : CIRCULAR_KEYS) : [];
  if (want.length === 0) return `its kind ${shown(p.kind)} is not linear or circular`;
  // An axis that is neither kind says so before its keys are judged by it (a misspelt construction is no origin axis lacking a centre).
  if (p.kind === "circular" && turnAxisItem(p.axis) === null && !PATTERN_AXES.includes(p.axis as PatternAxis)) return `its axis ${typeof p.axis === "string" ? JSON.stringify(p.axis) : shown(p.axis)} is not X, Y, Z or a construction axis`;
  const extra = keys.find((k) => !want.includes(k));
  if (extra !== undefined) return `it has a value ${JSON.stringify(extra)} a ${p.kind} pattern doesn't have`;
  const lacking = want.find((k) => !Object.hasOwn(p, k));
  if (lacking !== undefined) return `it has no ${lacking}`;
  if (typeof p.join !== "boolean") return `its join ${shown(p.join)} is not true or false`;
  // Only the values just checked to be there are read: no leftover second count (the tool's leftovers are never saved).
  return patternProblem(p as unknown as PatternValues);
}

/** A Pattern item's values (its parameters less `bodies`), as `insertPattern` saved them. */
export function patternValuesOf(p: Record<string, unknown>): PatternValues {
  const { bodies: _bodies, ...values } = p;
  return values as unknown as PatternValues;
}

/** Checked values as a Pattern item saves them: only its kind's keys, a grid's second direction only when there is one, a centre only round an origin axis (leftovers dropped). */
export function savedValues(v: PatternValues): PatternValues {
  if (v.kind === "circular") return { kind: "circular", axis: v.axis, ...(turnAxisItem(v.axis) === null ? { centre: [...v.centre!] as [number, number, number] } : {}), count: v.count, angle: v.angle, join: v.join };
  const grid = v.direction2 === undefined ? {} : { direction2: v.direction2, spacing2: v.spacing2!, count2: v.count2! };
  return { kind: "linear", direction: v.direction, spacing: v.spacing, count: v.count, ...grid, join: v.join };
}

/**
 * The Patterns whose copies are bodies of their own (not joined): until 61d tells copies apart in names, every face
 * and edge name made from a copy's names is shared by the copies, so Chamfer and Shell hold none of them
 * (`copyShared`; bug sweep 2026-11-28, A1-2: a later item changing one copy made another's name look unique).
 */
export function patternCopyMakers(doc: DesignDocument): Set<string> {
  return new Set(doc.timeline.features.filter((f) => f.intent.type === "pattern" && f.intent.parameters.join !== true).map((f) => f.id));
}

/** Whether `name` (a face's, or an edge's held name, which may be URI-encoded) on body `body` is made from the names of a copy of a Pattern in `copied`. */
export function copyShared(body: string, name: string, copied: ReadonlySet<string>): boolean {
  const maker = /^body:([^/]+)\/piece:\d+$/.exec(body)?.[1];
  if (maker === undefined || !copied.has(maker)) return false;
  let text = name;
  for (let k = 0; k < 4; k++) {
    if (text.includes(`face:${maker}/`)) return true;
    let next: string;
    try {
      next = decodeURIComponent(text);
    } catch {
      return false;
    }
    if (next === text) return false;
    text = next;
  }
  return false;
}
