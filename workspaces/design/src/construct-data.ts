// Construction planes, axes and points (step 59a1) as a timeline item's
// data: what each kind is made from, how an item names what it is made
// from, and the checks the reader and the rebuild share. The item itself is
// document.ts `isConstructItem` (Design data version 25); built by
// rebuild.ts `constructRun` through the kernel's `body_construct`.
//
// An item holds what it is made from by name, never by kernel index, so it
// follows its body through edits before it (rule 5 and friends, as a pin or
// a Chamfer's edge does):
// - an origin plane "XY", "XZ" or "YZ", an origin axis "X", "Y" or "Z", or
//   the origin "O";
// - a face by its shown name ("face:feature-1/top");
// - an edge by its held design-wide name ("design:…", design-edges.ts
//   `heldEdgeName`, as a Chamfer holds one);
// - a corner by the held names of every edge meeting there, sorted and
//   joined by "&", after "corner:" ("corner:design:…&design:…");
// - an earlier construction by "construct:<its item id>".
// A name found on no face, edge or corner now, or on two, holds the item at
// its last answer with a warning, never moving it onto something else.

import { ruleFiveName } from "./design-edges.ts";

/** What a construction makes. */
export type ConstructShape = "plane" | "axis" | "point";

/** The kernel's kinds (core's `ConstructMake`), with the slots each takes in order and the number it needs. */
export const CONSTRUCT_KINDS = {
  offset_plane: { makes: "plane", slots: ["plane"], number: "distance" },
  angle_plane: { makes: "plane", slots: ["plane", "line"], number: "angle" },
  mid_plane: { makes: "plane", slots: ["first", "second"] },
  plane_through_points: { makes: "plane", slots: ["first", "second", "third"] },
  plane_through_line_and_point: { makes: "plane", slots: ["line", "point"] },
  axis_through_points: { makes: "axis", slots: ["first", "second"] },
  axis_along: { makes: "axis", slots: ["line"] },
  axis_where_planes_meet: { makes: "axis", slots: ["first", "second"] },
  axis_square_to_plane: { makes: "axis", slots: ["plane", "point"] },
  point_at: { makes: "point", slots: ["point"] },
  point_midway: { makes: "point", slots: ["edge"] },
  point_centre: { makes: "point", slots: ["round"] },
  point_where_line_crosses: { makes: "point", slots: ["line", "plane"] },
  point_where_planes_meet: { makes: "point", slots: ["first", "second", "third"] },
} as const satisfies Record<string, { makes: ConstructShape; slots: readonly string[]; number?: "distance" | "angle" }>;

export type ConstructKind = keyof typeof CONSTRUCT_KINDS;

export const isConstructKind = (k: unknown): k is ConstructKind => typeof k === "string" && Object.hasOwn(CONSTRUCT_KINDS, k);

/** The number a kind needs ("distance" in mm, "angle" in degrees), or null. */
export function kindNumber(k: ConstructKind): "distance" | "angle" | null {
  const spec = CONSTRUCT_KINDS[k] as { number?: "distance" | "angle" };
  return spec.number ?? null;
}

/** The origin's planes, axes and point as names. */
export const ORIGIN_REFS = ["XY", "XZ", "YZ", "X", "Y", "Z", "O"] as const;

/** What starts an earlier construction's name, and a corner's. */
export const CONSTRUCT_REF = "construct:";
export const CORNER_REF = "corner:";

/** How far from the world's origin anything given or answered may be: the modelling box's corner, √3 × 100 km (the kernel's REACH), in mm. */
export const CONSTRUCT_REACH = Math.sqrt(3) * 1e8;

/** The most an offset plane's distance can be (the kernel's MAX_SIZE, 1 km), in mm, either way. */
export const CONSTRUCT_DISTANCE_MAX = 1_000_000;

/** The most a plane's angle can be, either way, in degrees (a whole turn, as the kernel takes). */
export const CONSTRUCT_ANGLE_MAX = 360;

/** A name read: what it names, and the parts a rebuild finds it by. */
export type ConstructRef =
  | { kind: "origin"; name: (typeof ORIGIN_REFS)[number] }
  | { kind: "construct"; item: string }
  | { kind: "face"; name: string }
  | { kind: "edge"; held: string }
  | { kind: "corner"; edges: string[] };

const ITEM_ID = /^[a-z]+-\d+$/;

/** A held edge name as a Chamfer keeps one (design-edges.ts), checked. */
const isHeldEdge = (s: string) => ruleFiveName(s) !== null;

/** A name read (module comment), or null for one this SpindleLabs never writes. */
export function readConstructRef(ref: unknown): ConstructRef | null {
  if (typeof ref !== "string") return null;
  if ((ORIGIN_REFS as readonly string[]).includes(ref)) return { kind: "origin", name: ref as (typeof ORIGIN_REFS)[number] };
  if (ref.startsWith(CONSTRUCT_REF)) {
    const item = ref.slice(CONSTRUCT_REF.length);
    return ITEM_ID.test(item) ? { kind: "construct", item } : null;
  }
  if (ref.startsWith(CORNER_REF)) {
    const edges = ref.slice(CORNER_REF.length).split("&");
    if (edges.length === 0 || !edges.every(isHeldEdge)) return null;
    // Sorted and once each, as the corner's name is written, so one corner has one name.
    if (edges.some((e, i) => i > 0 && !(edges[i - 1] < e))) return null;
    return { kind: "corner", edges };
  }
  if (isHeldEdge(ref)) return { kind: "edge", held: ref };
  if (ref.startsWith("face:") && ref.length > "face:".length) return { kind: "face", name: ref };
  return null;
}

/**
 * The construction a sketch's plane or a Mirror's plane names (step 59a3:
 * "construct:feature-7"), or null for anything else (an origin plane, a
 * face's name, a name this SpindleLabs never writes).
 */
export function constructPlaneItem(plane: unknown): string | null {
  const r = readConstructRef(plane);
  return r?.kind === "construct" ? r.item : null;
}

/** Whether a sketch's or a Mirror's plane is a construction plane's name (step 59a3). */
export const isConstructPlane = (plane: unknown): plane is string => constructPlaneItem(plane) !== null;

/** A corner's name from the held names of the edges meeting there. */
export const cornerRef = (edges: readonly string[]): string => CORNER_REF + [...new Set(edges)].sort().join("&");

/** The items a face name (or a rule 5 edge name) is named after: each id right after "face:", once, in order. */
function namedItems(name: string): string[] {
  return [...new Set([...name.matchAll(/face:([a-z]+-\d+)(?=[/;+,&]|$)/g)].map((m) => m[1]))];
}

/**
 * The items a construction is built on, each once, in slot order: an
 * earlier construction itself, a face's, edge's or corner's the items its
 * faces are named after; none for the origin's. Its `dependsOn` is exactly
 * these, so the timeline greys it with any of them suppressed and never lets
 * it go before one.
 */
export function constructInputs(inputs: Readonly<Record<string, unknown>>, kind: ConstructKind): string[] {
  const out: string[] = [];
  for (const slot of CONSTRUCT_KINDS[kind].slots) {
    const r = readConstructRef(inputs[slot]);
    if (r === null || r.kind === "origin") continue;
    const ids = r.kind === "construct" ? [r.item] : r.kind === "face" ? namedItems(r.name) : (r.kind === "edge" ? [r.held] : r.edges).flatMap((e) => namedItems(ruleFiveName(e)!));
    for (const id of ids) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** A construction's answer as the kernel gives it (core's `ConstructMade`), as the item keeps its last one. */
export type ConstructAnswer =
  | { kind: "plane"; point: [number, number, number]; normal: [number, number, number]; near: [number, number, number] }
  | { kind: "axis"; point: [number, number, number]; direction: [number, number, number]; near: [number, number, number] }
  | { kind: "point"; point: [number, number, number] };

/** How far a unit normal or direction may be from length 1 and still be kept (the kernel's are unit to a few ulps). */
export const UNIT_SLACK = 1e-9;

const isPoint = (p: unknown): p is [number, number, number] => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === "number" && Number.isFinite(x)) && Math.hypot(...(p as number[])) <= CONSTRUCT_REACH;
const isUnit = (d: unknown): d is [number, number, number] => isPoint(d) && Math.abs(Math.hypot(...d) - 1) <= UNIT_SLACK;

/** Why a kept answer can't be one for `makes`, in words, or null: its keys exactly the kernel's, points within CONSTRUCT_REACH, a normal or direction of length 1. */
export function answerProblem(a: unknown, makes: ConstructShape): string | null {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return "it is not an answer";
  const r = a as Record<string, unknown>;
  if (r.kind !== makes) return `it is not a ${makes}`;
  const keys = makes === "plane" ? ["kind", "point", "normal", "near"] : makes === "axis" ? ["kind", "point", "direction", "near"] : ["kind", "point"];
  for (const k of Object.keys(r)) if (!keys.includes(k)) return `it has ${JSON.stringify(k)}, which a ${makes} doesn't have`;
  for (const k of keys.slice(1)) {
    const ok = k === "normal" || k === "direction" ? isUnit(r[k]) : isPoint(r[k]);
    if (!ok) return k === "normal" || k === "direction" ? `its ${k} is not three numbers of length 1` : `its ${k} is not three numbers within ${Math.round(CONSTRUCT_REACH / 1e6)} km of the origin`;
  }
  return null;
}

/** Whether two answers are the same, number for number (keys in any order). */
export function sameAnswer(a: ConstructAnswer, b: unknown): boolean {
  if (typeof b !== "object" || b === null) return false;
  const r = b as Record<string, unknown>;
  const keys = Object.keys(a) as (keyof ConstructAnswer)[];
  if (Object.keys(r).length !== keys.length) return false;
  return keys.every((k) => (k === "kind" ? a.kind === r.kind : Array.isArray(r[k]) && (a[k] as unknown as number[]).every((x, i) => Object.is(x, (r[k] as unknown[])[i]))));
}
