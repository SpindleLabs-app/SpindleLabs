// Combine in the timeline model (step 35f1d2): what a Combine item makes,
// exactly, for the bodies the model can answer exactly, and the names on
// it by section 8 of docs/document-model.md.
//
// The exact answer comes from the naming model (boolean-naming-model.ts
// `rebuildBooleans`), whose world is blocks: every solid a union of cells
// of one grid, so no tolerance and no rounding. A timeline body joins that
// world as a "form": the naming model's features that build it, each with
// the timeline place it sorts by, and its body id there.
// - A box preset is one block, x 0..width, y 0..depth, z 0..height, its
//   faces named as Design names a box's (bottom −z, top +z, front −y,
//   back +y, left −x, right +x) in a box's made order (the item's place,
//   then bottom, top, front, back, left, right).
// - A Move turning it by a whole number of quarter turns about Z (any
//   shift) makes a new block where the box went, each face keeping its
//   name and made order (a quarter turn ccw takes a face facing −x to −y).
// - A Combine's result is the two inputs' forms merged (each feature once,
//   by timeline place) and the Combine: the result is that world's body
//   with the target's id, and the pieces `body:<combine>/piece:<k>`.
// Every other body is "curved" (a cylinder, a sphere, an extrude of a
// circle or slot: the kernel refuses curved faces in a boolean until steps
// 37 and 38a, so a Combine with one fails in words) or "flat" (an extrude
// of a polygon, a box turned otherwise): the model has no exact boolean
// for those, so a Combine with one throws `UnmodelledCombine` and the
// session leaves out the edit that made it (counted, never passed off as
// checked). Extrudes of rectangles are flat on purpose: their sides' made
// order follows the outline the kernel is handed, which the model does not
// claim to know.
//
// Rules 3 and 5 are design-wide (`tagDesign`): a face whose shown name
// another face anywhere in the design carries too adds its tag, and a
// combined body's edges are named by their two faces' full names. Plain
// bodies keep their item's edge names (24c), and their faces carry a tag
// only when a name is shared (a kept tool's face and the wall it cut).

import { bodyName, FACINGS, rebuildBooleans, type BlockFeature, type BooleanFeature, type DescribedFace, type Facing, type Rect3 } from "./boolean-naming-model.ts";
import type { EdgeName, FaceName, FaceRole, ModelBody, ModelFace, Motion2, Vec3 } from "./timeline-model.ts";

/** A Combine's operations, as Design's panel has them. */
export type CombineOperation = "join" | "cut" | "intersect";

/** A body in the naming model's world: the features that build it, each with its timeline place, and its body id there. */
export interface Form {
  steps: readonly { at: number; feature: BooleanFeature }[];
  body: string;
}

/** A Combine with a body the model has no exact boolean for (see the top of this file). */
export class UnmodelledCombine extends Error {}

/** What each body built in a model rebuild is, for a Combine: its form, or "curved"; a body with neither is flat. */
const kinds = new WeakMap<ModelBody, Form | "curved">();
/** Where each face of a body with a form lies, as boxes of no thickness (rule 3's "the piece holding the origin"). */
const regions = new WeakMap<ModelFace, readonly Rect3[]>();
/** Each combined body's faces' extra names (rule 4), in order after the shown one. */
export const formOf = (b: ModelBody): Form | undefined => {
  const k = kinds.get(b);
  return k === undefined || k === "curved" ? undefined : k;
};
export const isCurved = (b: ModelBody): boolean => kinds.get(b) === "curved";
/** Whether a Combine can take the body: one with a form, or a curved one (refused in words). */
export const combinable = (b: ModelBody): boolean => kinds.has(b);

/** Marks a body as curved (built with a cylinder's, sphere's, circle's or slot's faces), and gives it back. */
export function curvedBody(b: ModelBody): ModelBody {
  kinds.set(b, "curved");
  return b;
}

/** Gives body `to` what `from` is (a Move's or a lift's copy of a body), and gives it back. */
export function sameKind(from: ModelBody, to: ModelBody): ModelBody {
  if (kinds.get(from) === "curved") kinds.set(to, "curved");
  return to;
}

const esc = encodeURIComponent;
const fullName = (n: FaceName) => `face:${esc(n.feature)}/${n.role}${n.curve === undefined ? "" : `:${esc(n.curve)}`}`;

/** A full face name of the naming model's world ("face:item-3/top") as the timeline model's. */
export function parseName(full: string): FaceName {
  const m = /^face:([^/]*)\/([^:#]*)(?::([^#]*))?$/.exec(full);
  if (m === null) throw new Error(`harness: ${full} is not a face name`);
  const feature = decodeURIComponent(m[1]);
  return m[3] === undefined ? { feature, role: m[2] as FaceRole } : { feature, role: m[2] as FaceRole, curve: decodeURIComponent(m[3]) };
}

/** A box's faces by the way they face, with their place in a box's own order (section 8: bottom, top, front, back, left, right). */
const BOX_FACES: Record<Facing, [FaceRole, number]> = { "-z": ["bottom", 0], "+z": ["top", 1], "-y": ["front", 2], "+y": ["back", 3], "-x": ["left", 4], "+x": ["right", 5] };

/** The form of box item `id`, w × d × h with a corner at the origin, at timeline place `place`; its body gets it. */
export function boxForm(body: ModelBody, id: string, w: number, d: number, h: number, place: number): ModelBody {
  const faces = Object.fromEntries(FACINGS.map((f) => [f, { name: fullName({ feature: id, role: BOX_FACES[f][0] }), made: [place, BOX_FACES[f][1]] }])) as unknown as BlockFeature["faces"];
  const feature: BlockFeature = { kind: "block", id, rect: [0, 0, w, d], z: [0, h], operation: "new", faces };
  const form: Form = { steps: [{ at: place, feature }], body: bodyName(id) };
  kinds.set(body, form);
  for (const f of body.faces) regions.set(f, boxRegion(feature, f.name.role));
  return body;
}

/** A quarter turn ccw seen from above: where each facing goes. */
const TURNED: Record<Facing, Facing> = { "-x": "-y", "-y": "+x", "+x": "+y", "+y": "-x", "-z": "-z", "+z": "+z" };

/**
 * What a Move does to a body's form (35e2): turned `turnZ` degrees ccw
 * about the upright through `pivot`, then shifted. A whole number of
 * quarter turns keeps a block a block; `to` gets the new form (the block
 * with the Move's id added to its own, made at the Move's place `place`).
 * Anything else leaves `to` flat. Only a single block is moved (a
 * Combine's result can't be moved yet: Design fails that Move in words).
 */
export function movedForm(from: ModelBody, to: ModelBody, move: { id: string; turnZ: number; pivot: readonly [number, number]; shift: Vec3 }, place: number): ModelBody {
  const k = kinds.get(from);
  if (k === "curved") return curvedBody(to);
  if (k === undefined || k.steps.length !== 1 || k.steps[0].feature.kind !== "block") return to;
  const turn = ((move.turnZ % 360) + 360) % 360;
  if (turn % 90 !== 0) return to;
  const b = k.steps[0].feature;
  const [px, py] = move.pivot;
  const quarter = (p: readonly [number, number]): [number, number] => [px - (p[1] - py), py + (p[0] - px)];
  let corners: [number, number][] = [
    [b.rect[0], b.rect[1]],
    [b.rect[2], b.rect[3]],
  ];
  let faces = { ...b.faces! };
  for (let q = 0; q < turn / 90; q++) {
    corners = corners.map(quarter);
    const next = { ...faces };
    for (const f of FACINGS) next[TURNED[f]] = faces[f];
    faces = next;
  }
  const [sx, sy, sz] = move.shift;
  const xs = corners.map((c) => c[0] + sx);
  const ys = corners.map((c) => c[1] + sy);
  const feature: BlockFeature = {
    kind: "block",
    id: `${b.id}~${move.id}`,
    rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    z: [b.z[0] + sz, b.z[1] + sz],
    operation: "new",
    faces,
  };
  kinds.set(to, { steps: [{ at: place, feature }], body: bodyName(feature.id) });
  for (const f of to.faces) regions.set(f, boxRegion(feature, f.name.role));
  return to;
}

/**
 * What a Duplicate does to a body's form (35e2): `to`, the copy, is the
 * same block where `from` is now, its faces named by the Duplicate `id`
 * (each keeping its role and its place in the box's own order) and made at
 * the Duplicate's place `place`, as Design names a copy's faces by the
 * Duplicate. A curved body's copy is curved; one the model has no single
 * block for is left with no form (a Combine with it is not modelled).
 */
export function copiedForm(from: ModelBody, to: ModelBody, id: string, place: number): ModelBody {
  const k = kinds.get(from);
  if (k === "curved") return curvedBody(to);
  if (k === undefined || k.steps.length !== 1 || k.steps[0].feature.kind !== "block") return to;
  const b = k.steps[0].feature;
  const faces = Object.fromEntries(FACINGS.map((f) => [f, { name: fullName({ feature: id, role: parseName(b.faces![f].name).role }), made: [place, b.faces![f].made[1]] }])) as unknown as BlockFeature["faces"];
  const feature: BlockFeature = { kind: "block", id, rect: [...b.rect], z: [...b.z], operation: "new", faces };
  kinds.set(to, { steps: [{ at: place, feature }], body: bodyName(id) });
  for (const f of to.faces) regions.set(f, boxRegion(feature, f.name.role));
  return to;
}

/** Where a block's face named by `role` lies (a box's faces, found by their name's role among the block's six). */
function boxRegion(b: BlockFeature, role: FaceRole): readonly Rect3[] {
  const d = FACINGS.find((f) => parseName(b.faces![f].name).role === role);
  if (d === undefined) return [];
  const lo: [number, number, number] = [b.rect[0], b.rect[1], b.z[0]];
  const hi: [number, number, number] = [b.rect[2], b.rect[3], b.z[1]];
  const axis = FACINGS.indexOf(d) >> 1;
  const at = FACINGS.indexOf(d) & 1 ? hi[axis] : lo[axis];
  const a: [number, number, number] = [...lo];
  const z: [number, number, number] = [...hi];
  a[axis] = at;
  z[axis] = at;
  return [[a, z]];
}

/** Whether face `f` holds point `p` (on its border counts), for a face whose region the model knows. */
export function faceHolds(f: ModelFace, p: readonly number[]): boolean {
  return (regions.get(f) ?? []).some(([lo, hi]) => lo.every((x, i) => x - 1e-9 <= p[i] && p[i] <= hi[i] + 1e-9));
}

/** What a Combine made: the target's body, the new pieces in order, or why it failed (in the kernel's words, as the naming model has them). */
export type Combined = { target: ModelBody; pieces: ModelBody[] } | { failed: string };

/**
 * The Combine `id` (at timeline place `place`) of `target` with `tool`, both
 * with forms: the forms merged (each feature once, in timeline order) and
 * the Combine run in the naming model's world. Each face of the result
 * and the pieces keeps where the Moves had put the input body it came
 * from (35f1e2, `ModelFace.motion`, found by `motionFrom`), so a later
 * sketch on a tool's face is carried by the tool's Moves, never the
 * target's. With `targetMotion` (the planted bug "combine-face-moves-with-target"),
 * every face has the target's.
 */
export function combineBodies(target: ModelBody, tool: ModelBody, c: { id: string; operation: CombineOperation; keep: boolean }, place: number, targetMotion = false): Combined {
  const a = formOf(target);
  const b = formOf(tool);
  if (a === undefined || b === undefined) throw new Error("harness: a Combine of a body with no form");
  const byId = new Map<string, { at: number; feature: BooleanFeature }>();
  for (const s of [...a.steps, ...b.steps]) if (!byId.has(s.feature.id)) byId.set(s.feature.id, s);
  const steps = [...byId.values()].sort((x, y) => x.at - y.at);
  steps.push({ at: place, feature: { kind: "combine", id: c.id, target: a.body, tools: [b.body], operation: c.operation, keepTools: c.keep } });
  const r = rebuildBooleans(steps.map((s) => s.feature));
  const failed = r.failed.get(c.id);
  if (failed !== undefined) return { failed };
  if (r.failed.size > 0) throw new Error(`harness: an earlier feature of a Combine's inputs failed again: ${[...r.failed.keys()].join(", ")}`);
  const piece = `${bodyName(c.id)}/piece:`;
  const made = (id: string): ModelBody => {
    const d = r.bodies.find((x) => x.id === id)!;
    const body = toModel(d.volume, d.faces, d.edges, (f) => (targetMotion ? target.motion : motionFrom(f, [target, tool])));
    kinds.set(body, { steps, body: id });
    return body;
  };
  const pieces = r.bodies
    .filter((x) => x.id.startsWith(piece))
    .map((x) => x.id)
    .sort((x, y) => Number(x.slice(piece.length)) - Number(y.slice(piece.length)));
  return { target: made(a.body), pieces: pieces.map(made) };
}

/** A body of the naming model's world in the timeline model's terms: faces by their names (the shown one first, rule 4), edges by their two faces (rule 5, named in `tagDesign`). */
function toModel(volume: number, faces: readonly DescribedFace[], edges: readonly { length: number; centroid: readonly number[]; between: readonly [number, number] }[], motionOf: (f: DescribedFace) => Motion2 | undefined): ModelBody {
  const out: ModelFace[] = faces.map((f) => {
    const [shown, ...rest] = f.names.map(parseName);
    const motion = motionOf(f);
    const face: ModelFace = {
      name: shown,
      ...(rest.length > 0 && { also: rest }),
      area: f.area,
      centroid: [...f.centroid] as unknown as Vec3,
      ...(f.facing === "-z" && { down: true as const }),
      ...(motion && { motion: { a: motion.a, t: [motion.t[0], motion.t[1]] as [number, number] } }),
    };
    regions.set(face, f.rects);
    return face;
  });
  return {
    volume,
    faces: out,
    edges: edges.map((e) => ({ name: pairName(out[e.between[0]].name, out[e.between[1]].name), length: e.length, centroid: [...e.centroid] as unknown as Vec3, between: [e.between[0], e.between[1]] })),
    combined: true,
  };
}

/** Where the Moves had put the body face `f` of `b` came from (35e2h, 35f1e2): a combined body's per face, a plain body's its own. */
export const faceMotion = (b: ModelBody, f: ModelFace): Motion2 | undefined => (b.combined ? f.motion : b.motion);

/**
 * The motion of the input face a result face lies on (35f1e2): the first
 * face of the inputs (target first) carrying its shown name (feature,
 * role and curve; tags are new each Combine) whose region holds the middle
 * of the result face's first rectangle; else the first carrying the name
 * at all (a face merged from two lies on the target's first, rule 4).
 * Found by name and region, not by the kernel's history as Design does.
 */
function motionFrom(f: DescribedFace, inputs: readonly ModelBody[]): Motion2 | undefined {
  const key = plainKey(parseName(f.names[0]));
  const r = f.rects[0];
  const mid = r === undefined ? undefined : r[0].map((x, i) => (x + r[1][i]) / 2);
  let first: { motion: Motion2 | undefined } | undefined;
  for (const b of inputs)
    for (const g of b.faces) {
      if (![g.name, ...(g.also ?? [])].some((n) => plainKey(n) === key)) continue;
      if (mid !== undefined && faceHolds(g, mid)) return faceMotion(b, g);
      first ??= { motion: faceMotion(b, g) };
    }
  return first?.motion;
}

/** Rule 5's edge name: its two faces' full names (with their tags), as a set. */
export const pairName = (a: FaceName, b: FaceName): EdgeName => ({ feature: a.feature, faces: [a, b], ordered: false, pair: true });

// Rule 3, design-wide --------------------------------------------------------------------------------------------

const plainKey = (n: FaceName) => `${n.feature}/${n.role}${n.curve === undefined ? "" : `:${n.curve}`}`;

/** Every face of `bodies` in one list, with the names it carries and its neighbours' shown names (by `plainKey`). */
function designFaces(bodies: readonly ModelBody[]) {
  const all: { body: number; face: number; f: ModelFace }[] = [];
  const at: number[][] = [];
  bodies.forEach((b, bi) => at.push(b.faces.map((f, fi) => all.push({ body: bi, face: fi, f }) - 1)));
  const neighbours = all.map(() => new Set<string>());
  bodies.forEach((b, bi) => {
    const byName = new Map(b.faces.map((f, fi) => [plainKey(f.name), fi] as const));
    for (const e of b.edges) {
      const [x, y] = e.between ?? [byName.get(plainKey(e.name.faces[0])), byName.get(plainKey(e.name.faces[1]))];
      if (x === undefined || y === undefined) continue;
      neighbours[at[bi][x]].add(plainKey(b.faces[y].name));
      neighbours[at[bi][y]].add(plainKey(b.faces[x].name));
    }
  });
  const carrying = new Map<string, number[]>();
  all.forEach((x, k) => {
    for (const n of new Set([x.f.name, ...(x.f.also ?? [])].map(plainKey))) carrying.set(n, [...(carrying.get(n) ?? []), k]);
  });
  /** Face k's tag among the faces carrying `name`: its neighbours bordering none of the others, sorted. */
  const tagOf = (k: number, name: string): string[] => {
    const others = new Set<string>();
    for (const p of carrying.get(name) ?? [k]) if (p !== k) for (const n of neighbours[p]) others.add(n);
    return [...neighbours[k]].filter((n) => !others.has(n)).sort();
  };
  return { all, at, carrying, tagOf };
}

const fromKey = (bodies: readonly ModelBody[]) => {
  const names = new Map<string, FaceName>();
  for (const b of bodies) for (const f of b.faces) for (const n of [f.name, ...(f.also ?? [])]) names.set(plainKey(n), { feature: n.feature, role: n.role, ...(n.curve !== undefined && { curve: n.curve }) });
  return (k: string) => names.get(k)!;
};

/**
 * Rule 3 and 5 on every body shown: each face whose shown name another face
 * carries too gets its tag (`name.tag`, the neighbours' shown names), every
 * other loses any; a combined body's edges are named again from their two
 * faces. In place: the bodies are this rebuild's own.
 */
export function tagDesign(bodies: readonly ModelBody[], untagged = false, edgesUntagged = false): void {
  const { all, carrying, tagOf } = designFaces(bodies);
  const name = fromKey(bodies);
  // Only a Combine shares a name between faces: two faces of plain bodies carrying one are a naming bug, left untagged
  // so the session's "two faces share a name" sees it.
  const split = (n: string) => (carrying.get(n)?.length ?? 1) > 1 && carrying.get(n)!.some((k) => bodies[all[k].body].combined);
  all.forEach((x, k) => {
    const shown = plainKey(x.f.name);
    const { tag: _, ...base } = x.f.name;
    x.f.name = split(shown) && !untagged ? { ...base, tag: tagOf(k, shown).map(name) } : base;
  });
  // Planted bug ("combine-edge-tags-dropped", 35f1e2): a combined body's edges named by their faces' names without tags.
  const plain = (n: FaceName): FaceName => (edgesUntagged ? { feature: n.feature, role: n.role, ...(n.curve !== undefined && { curve: n.curve }) } : n);
  for (const b of bodies) if (b.combined) b.edges = b.edges.map((e) => ({ ...e, name: pairName(plain(b.faces[e.between![0]].name), plain(b.faces[e.between![1]].name)) }));
}

/** What a face reference (a held name, a sketch's plane) finds on the bodies (rule 3). */
export type Found = { body: number; face: number; split: boolean } | { ambiguous: number } | null;

/**
 * Rule 3's references on `bodies`: the one face carrying the name is it (a
 * tagged reference too: the face is whole again); among pieces a tagged
 * reference takes the one piece with its tag; one made on the whole face
 * the piece holding `origin`, else the largest, with a warning ("split").
 * Two pieces with the same tag, or two largest (within a billionth), are
 * never guessed between.
 */
export function findFace(bodies: readonly ModelBody[], ref: FaceName, origin?: readonly number[], faults: { firstPiece?: boolean } = {}): Found {
  const { all, carrying, tagOf } = designFaces(bodies);
  const key = plainKey(ref);
  const pieces = carrying.get(key) ?? [];
  const hit = (k: number, split: boolean) => ({ body: all[k].body, face: all[k].face, split });
  if (pieces.length === 0) return null;
  if (pieces.length === 1) return hit(pieces[0], false);
  // Planted bug ("combine-first-piece"): the first face carrying the name, never a tag, an origin or a tie.
  if (faults.firstPiece) return hit(pieces[0], false);
  if (ref.tag !== undefined) {
    const want = ref.tag.map(plainKey).sort().join(",");
    const match = pieces.filter((k) => tagOf(k, key).join(",") === want);
    if (match.length === 0) return null;
    if (match.length > 1) return { ambiguous: match.length };
    return hit(match[0], false);
  }
  const holding = origin === undefined ? [] : pieces.filter((k) => faceHolds(all[k].f, origin));
  if (holding.length === 1) return hit(holding[0], true);
  const largest = Math.max(...pieces.map((k) => all[k].f.area));
  const big = pieces.filter((k) => Math.abs(all[k].f.area - largest) <= 1e-9 * largest);
  if (big.length > 1) return { ambiguous: big.length };
  return hit(big[0], true);
}
