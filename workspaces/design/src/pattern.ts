// Pattern (step 61, Ben 2026-11-11: "do patterns"): repeat bodies in a
// row, a grid or round an axis, as a timeline item. Fusion's behaviour, our
// own words: the count is of instances, the original included (a row of 3
// is the body and two copies), the copies are new bodies of their own, and
// Join (off by default) joins each body's copies to it where they overlap.
//
// Here: the item's values, checked in plain words before the kernel sees
// them (`patternProblem`), the kernel's request (`patternRequest`, for its
// `pattern_motions`, which works out every copy's move or turn: the maths
// lives in the kernel, once), the words a summary and a refusal use, and the
// item put in at the marker (`insertPattern`). The rebuild builds each copy
// as a Move builds a moved body and joins with Combine's booleans (step 61b,
// next). Behind the `?pattern` flag until Ben says it goes public.

import type { Feature } from "@fission/core";
import { bodyItem, counted, freshName, insertAt, insertItem, isPiece, makesBody, shown, takenNames, type DesignDocument } from "./document.ts";

/** The undo step a new Pattern is recorded as. */
export const PATTERN_STEP = "Pattern bodies";

/** The axes a pattern runs along or round (the origin's, until construction axes, step 59). */
export const PATTERN_AXES = ["X", "Y", "Z"] as const;
export type PatternAxis = (typeof PATTERN_AXES)[number];

/** The most instances a pattern makes, the original included: the kernel's MAX_INSTANCES (all fit one Join). */
export const MAX_INSTANCES = 256;

/** A spacing's size: a length the kernel takes (1 µm to 1 km), either way. */
export const MIN_SPACING = 0.001;
export const MAX_SPACING = 1_000_000;

/** A full turn, in degrees: the copies spaced evenly all the way round. */
export const FULL_TURN = 360;

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

/** Instances round an axis through `centre`: over a full turn (`angle` 360) or a partial angle (degrees, negative the other way). */
export interface CircularValues {
  kind: "circular";
  axis: PatternAxis;
  centre: [number, number, number];
  count: number;
  angle: number;
}

export type PatternValues = (LinearValues | CircularValues) & { join: boolean };

/** The kernel's form of a pattern (its `pattern_motions`). */
export type PatternRequest =
  | { linear: { along: [number, number, number]; spacing: number; count: number; across?: { along: [number, number, number]; spacing: number; count: number } } }
  | { circular: { pivot: [number, number, number]; axis: [number, number, number]; count: number; angle?: number } };

/** Each axis as a unit direction. */
const UNIT: Record<PatternAxis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** How many instances a pattern makes, the original included. */
export const instanceCount = (v: PatternValues): number => (v.kind === "linear" ? v.count * (v.count2 ?? 1) : v.count);

const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Why a spacing can't be used, or null. */
function spacingProblem(s: unknown, which: string): string | null {
  if (!finite(s)) return `Type ${which} in mm.`;
  if (Math.abs(s) < MIN_SPACING) return `${cap(which)} must be at least ${MIN_SPACING} mm (it can be negative to go the other way).`;
  if (Math.abs(s) > MAX_SPACING) return `${cap(which)} can be at most ${MAX_SPACING.toLocaleString("en")} mm.`;
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Why these values make no pattern, in plain words, or null when the kernel
 * may be asked: counts whole numbers, at least 1 along each direction, 2 to
 * MAX_INSTANCES in all; spacings 1 µm to 1 km either way; a grid's second
 * direction another axis; round an axis: the centre's numbers finite, the
 * angle above 0 and at most a full turn either way.
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
    if (!PATTERN_AXES.includes(v.axis)) return `${shown(v.axis)} is not X, Y or Z.`;
    if (!whole(v.count)) return "Type how many, a whole number from 2.";
    if (!v.centre.every(finite)) return "Type the centre in mm.";
    if (!finite(v.angle) || v.angle === 0) return "Type the angle in degrees, above 0 (negative turns the other way).";
    if (Math.abs(v.angle) > FULL_TURN) return `The angle can be at most ${FULL_TURN}°, a full turn.`;
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
 * round, so the last copy is one step short of the original).
 */
export function patternRequest(v: PatternValues): PatternRequest {
  if (v.kind === "linear") {
    const across = v.direction2 === undefined ? {} : { across: { along: [...UNIT[v.direction2]] as [number, number, number], spacing: v.spacing2!, count: v.count2! } };
    return { linear: { along: [...UNIT[v.direction]] as [number, number, number], spacing: v.spacing, count: v.count, ...across } };
  }
  const full = Math.abs(v.angle) === FULL_TURN;
  // A full turn the other way round lands on the same places, in the other order.
  return { circular: { pivot: [...v.centre] as [number, number, number], axis: v.angle < 0 && full ? [...UNIT[v.axis].map((x) => -x)] as [number, number, number] : [...UNIT[v.axis]] as [number, number, number], count: v.count, ...(full ? {} : { angle: (v.angle * Math.PI) / 180 }) } };
}

/** A pattern's description: "3 of Box 1 in a row along X, 10 mm apart", "6 of Box 1 round the Z axis", ", joined". */
export function patternSummary(names: readonly string[], v: PatternValues): string {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const mm = (n: number) => `${Number(n.toPrecision(12))} mm`;
  const words =
    v.kind === "linear"
      ? v.direction2 === undefined
        ? `${v.count} of ${list} in a row along ${v.direction}, ${mm(v.spacing)} apart`
        : `${v.count} × ${v.count2} of ${list} in a grid along ${v.direction} and ${v.direction2}, ${mm(v.spacing)} and ${mm(v.spacing2!)} apart`
      : Math.abs(v.angle) === FULL_TURN
        ? `${v.count} of ${list} round the ${v.axis} axis`
        : `${v.count} of ${list} over ${Number(v.angle.toPrecision(12))}° round the ${v.axis} axis`;
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

/** Why Join can't be used on a body with curved faces yet (until curved booleans, step 37). */
export const CURVED_JOIN = "Join can't join copies of a body with curved faces yet (that comes with curved Combine). Turn Join off to keep the copies as separate bodies.";

/** The copies' body ids: `body:<pattern>/piece:k`, k from 1, each source's copies in turn, in the kernel's order. */
export function copyIds(pattern: string, sources: number, copiesEach: number): string[] {
  return Array.from({ length: sources * copiesEach }, (_, k) => `body:${pattern}/piece:${k + 1}`);
}

/**
 * The design with a new Pattern of `bodies` (body ids, in the order
 * picked) put in at the marker ("Pattern 1", its id from the counter), and
 * its id. Refused, changing nothing, for values `patternProblem` refuses,
 * no body, a body picked twice, and anything that is no body made before
 * the marker.
 */
export function insertPattern(doc: DesignDocument, bodies: readonly string[], values: PatternValues): { doc: DesignDocument; id: string } {
  const problem = patternProblem(values);
  if (problem !== null) throw new Error(problem);
  if (bodies.length === 0) throw new Error("pick at least one body to pattern");
  const end = insertAt(doc);
  const items = bodies.map((b, i) => {
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    const item = bodyItem(b);
    const at = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[at];
    const numbered = (doc.bodies ?? []).some((x) => x.id === b);
    if (f === undefined || !(isPiece(b) ? numbered : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (at >= end) throw new Error(`${f.provenance.self.label} comes after the rollback marker, so a Pattern put in at the marker can't use it`);
    return f;
  });
  const id = `feature-${doc.nextId}`;
  const label = freshName("Pattern", doc.timeline.features.filter((f) => f.intent.type === "pattern").length, takenNames(doc));
  const names = bodies.map((b, i) => (isPiece(b) ? `a piece of ${items[i].provenance.self.label}` : items[i].provenance.self.label));
  const makers = [...new Map(items.map((f) => [f.id, f])).values()];
  const feature: Feature = {
    id,
    intent: { type: "pattern", parameters: { bodies: [...bodies], ...values } as unknown as Feature["intent"]["parameters"], summary: patternSummary(names, values) },
    provenance: { self: { workspace: "design", id, label }, from: makers.map((f) => ({ workspace: "design" as const, id: f.id, label: f.provenance.self.label })) },
    dependsOn: makers.map((f) => f.id),
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}
