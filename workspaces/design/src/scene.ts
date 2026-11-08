// Every body the timeline builds, drawn at once (step 24d3b). The bodies'
// display meshes are joined into one, each body's faces and edges numbered
// after the previous bodies', so the viewport draws, picks and highlights
// them as it did one body; a picked face or edge maps back to its body and
// the kernel's index there, and so to its stable name (naming.ts), which
// already carries the feature that built it.

import type { BodyView, DisplayMesh, GeometryReference, KernelError, Plane, StableId } from "@fission/core";
import { bodyHidden, bodyItem, bodyNumbers, isPiece, numberPieces, type DesignDocument } from "./document.ts";
import type { BodyNames } from "./naming.ts";
import { designNames, resolveEdgeName, resolveFaceName, resolveOldEdge, type DesignNames, type NamedBody, type NameFound } from "./boolean-names.ts";
import { frameOfBody, namedBody, namesOfBody } from "./built-body.ts";
import { withHeldEdges } from "./design-edges.ts";
import type { BodyCache, TimelineBuild } from "./rebuild.ts";
import { designReference, oldEdgeFaces, readDesignReference, resolveReference, sharedBy } from "./references.ts";

/** One built body: its id (35eb: "body:<item>", `bodyIdOf`), the feature that built it, the kernel's view of it, and its faces' and edges' names. */
export interface ShownBody {
  body: string;
  feature: string;
  /** Its browser row's number, n in "Body n": the body's own (35e, `bodyNumbers`), given when it first appeared. */
  place: number;
  view: BodyView;
  names: BodyNames;
  /** Where the Moves before it put its own frame (face-sketch.ts `bodyFrame`); none when not moved. */
  frame?: Plane;
  /** A Combine's result (35f1e2): each face's frame, as its input body's was (rebuild.ts `BuiltBody.frames`); read with built-body.ts `shownFrame`. */
  frames?: readonly (Plane | null)[];
  /** A Combine's result (35f1): its faces named by its Combine. */
  combined?: true;
  /** A Combine's result (35f1f2b): the Combine that made it, the item a pin or projection on it names (`madeBy`). */
  by?: string;
  /** Once a Combine has built (35f1e): every body of the design named as one (`SceneDesign`), and this body's place in it. */
  design?: { of: SceneDesign; at: number };
}

/**
 * The design's names across every body (35f1e, rules 3 and 5: section 8 of
 * docs/document-model.md), given once a Combine's result is among them:
 * each body the rebuild holds, hidden ones too (a name's tag reads every
 * face carrying it), named as boolean-names.ts names it.
 */
export interface SceneDesign {
  bodies: readonly NamedBody[];
  names: DesignNames;
}

/** The item a pin or projection on a shown body names (35f1f2b): a Combine's result's Combine, else the item that built it. */
export const madeBy = (b: Pick<ShownBody, "feature" | "by">): string => b.by ?? b.feature;

/** The bodies shown, in build order, and their joined mesh. */
export interface Scene {
  bodies: readonly ShownBody[];
  mesh: DisplayMesh;
  /** The joined index of each body's face 0 and edge 0. */
  faceStart: readonly number[];
  edgeStart: readonly number[];
  /** The design's names, once a Combine built (35f1e), and each of its bodies' index among those shown (−1: hidden). */
  design?: SceneDesign & { shown: readonly number[] };
  /**
   * 35f1e2: the face sketches the rebuild placed on their face (built, with
   * no "plane lost" or "plane ambiguous"), when the scene was joined with
   * its rebuild. The screen names faces over the finished design, a sketch
   * is placed over the bodies built before it, so a Combine after it can
   * leave its face's name on two pieces alike though it is placed: this
   * is the rebuild's verdict (face-edges.ts `faceHeld`).
   */
  placed?: ReadonlySet<string>;
}

/**
 * The bodies to show after a rebuild: one for every solid feature that
 * builds (`bodyFeatures`, the browser's Body rows, in build order) and the
 * rebuild built, with its view from `cache` and its names. A feature the
 * kernel refused has no body, so none is shown for it; nor is a body the
 * browser's eye hides (U0f3), which keeps its place number. A body whose
 * view took the kernel too long (35d4: meshing it again, hidden before) is
 * not shown and goes to `slow`, when given; else that error is thrown.
 */
export async function shownBodies(doc: DesignDocument, build: TimelineBuild, cache: BodyCache, slow?: (feature: string) => void): Promise<ShownBody[]> {
  const shown: ShownBody[] = [];
  // Every body the rebuild holds (35f1: by body id, a Combine's pieces too, its used-up tools gone), in the order their
  // items come in the timeline (a piece after the earlier pieces of its Combine), skipping those the eye hides.
  const places = new Map(doc.timeline.features.map((f, i) => [f.id, i] as const));
  const items = new Map(doc.timeline.features.map((f) => [f.id, f] as const));
  const ids = Object.keys(build.bodies);
  const numbers = bodyNumbers(numberPieces(doc, ids));
  const at = (id: string) => [places.get(bodyItem(id)!) ?? Infinity, isPiece(id) ? (numbers.get(id) ?? Infinity) : 0];
  const order = ids.filter((id) => items.has(build.bodies[id].feature) && !bodyHidden(doc, id)).sort((a, b) => at(a)[0] - at(b)[0] || at(a)[1] - at(b)[1]);
  // Every view asked at once, before the loop waits on one (security audit S2: one round trip each took minutes on a big file).
  for (const id of order) {
    try {
      cache.view(build.bodies[id].handle).catch(() => {}); // a refusal is read in the loop below
    } catch {
      // not in the cache: the loop below says so
    }
  }
  for (const id of order) {
    const b = build.bodies[id];
    let view: BodyView;
    try {
      view = await cache.view(b.handle);
    } catch (e) {
      // Its kind, never its words (a KernelError's; read without importing the class, so this file stands alone: refind-planted.test.ts).
      if (!slow || (e as Partial<KernelError> | null)?.kind !== "timed-out") throw e;
      slow(b.feature);
      continue;
    }
    const frame = frameOfBody(b);
    shown.push({ body: id, feature: b.feature, place: numbers.get(id)!, view, names: namesOfBody(b, view), ...(frame ? { frame } : {}), ...(b.frames && { frames: b.frames }), ...(b.named !== undefined && { combined: true as const }), ...(b.by !== undefined && { by: b.by }) });
  }
  // 35f1e: once a Combine built, the design is named as one, over every body it holds, hidden ones too.
  if (!ids.some((id) => build.bodies[id].named !== undefined)) return shown;
  const all = ids.filter((id) => items.has(build.bodies[id].feature)).sort((a, b) => at(a)[0] - at(b)[0] || at(a)[1] - at(b)[1]);
  const bodies: NamedBody[] = [];
  for (const id of all) {
    const b = build.bodies[id];
    const own = shown.find((x) => x.body === id);
    let view: BodyView;
    try {
      view = own?.view ?? (await cache.view(b.handle));
    } catch {
      continue; // a hidden body whose view the kernel would not give: its faces carry no name here
    }
    bodies.push(namedBody(id, b, view, places.get(b.feature) ?? Infinity));
  }
  const of: SceneDesign = { bodies, names: designNames(bodies) };
  return shown.map((x) => {
    const at = bodies.findIndex((b) => b.id === x.body);
    // 35f1f2b: a Combine's result's edges by rule 5's names, as a pin or projection holds them (design-edges.ts).
    const names = x.combined && at >= 0 ? withHeldEdges(x.names, of.names, at) : x.names;
    return { ...x, names, design: { of, at } };
  });
}

/** The sketches a rebuild placed (Scene `placed`): built with a placement and no lost or ambiguous plane (a split face's piece counts). */
const placedSketches = (build: Pick<TimelineBuild, "results">): ReadonlySet<string> =>
  new Set(Object.entries(build.results).flatMap(([id, r]) => (r.status === "built" && r.placement !== undefined && (r.plane === undefined || r.plane.cause === "plane-split") ? [id] : [])));

/**
 * Joins the bodies' display meshes: positions and normals one after
 * another, each body's triangle corners moved past the previous bodies'
 * points, its faces and edges past their faces and edges. Bad input
 * throws: a mesh whose lists disagree in length, or that names a point,
 * face or edge its body does not have (it would be drawn as another
 * body's).
 */
export function joinBodies(bodies: readonly ShownBody[], build?: Pick<TimelineBuild, "results">): Scene {
  const mesh: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  const faceStart: number[] = [];
  const edgeStart: number[] = [];
  let faces = 0;
  let edges = 0;
  for (const { feature, view } of bodies) {
    const m = view.mesh;
    const points = m.positions.length / 3;
    const bad = (why: string) => new Error(`the body ${feature} built has a display mesh ${why}`);
    if (!Number.isInteger(points) || m.normals.length !== m.positions.length) throw bad("whose points and normals disagree");
    if (m.indices.length !== 3 * m.triangle_faces.length || m.edge_lines.length !== 6 * m.edge_line_edges.length) throw bad("whose lists disagree in length");
    if (m.indices.some((i) => !(Number.isInteger(i) && i >= 0 && i < points))) throw bad("with a triangle corner it has no point for");
    if (m.triangle_faces.some((f) => !(Number.isInteger(f) && f >= 0 && f < view.faces))) throw bad("with a triangle on a face it does not have");
    if (m.edge_line_edges.some((e) => !(Number.isInteger(e) && e >= 0 && e < view.edges))) throw bad("with a line on an edge it does not have");
    const first = mesh.positions.length / 3;
    faceStart.push(faces);
    edgeStart.push(edges);
    append(mesh.positions, m.positions, 0);
    append(mesh.normals, m.normals, 0);
    append(mesh.indices, m.indices, first);
    append(mesh.triangle_faces, m.triangle_faces, faces);
    append(mesh.edge_lines, m.edge_lines, 0);
    append(mesh.edge_line_edges, m.edge_line_edges, edges);
    faces += view.faces;
    edges += view.edges;
  }
  const of = bodies.find((b) => b.design !== undefined)?.design?.of;
  const placed = build === undefined ? {} : { placed: placedSketches(build) };
  if (of === undefined) return { bodies, mesh, faceStart, edgeStart, ...placed };
  const shown = of.bodies.map((nb) => bodies.findIndex((b) => b.body === nb.id));
  return { bodies, mesh, faceStart, edgeStart, design: { ...of, shown }, ...placed };
}

/** Adds `from` to the end of `to`, each plus `by` (a loop: a big mesh would overflow push's argument list). */
function append(to: number[], from: readonly number[], by: number) {
  for (const x of from) to.push(x + by);
}

/** Which body a joined face or edge index is on, and its kernel index there; null past the last body. */
export function sceneHit(scene: Scene, kind: "face" | "edge", index: number): { body: number; index: number } | null {
  if (!Number.isInteger(index) || index < 0) throw new Error(`a ${kind} reference needs a kernel index (a whole number ≥ 0), got ${index}`);
  const starts = kind === "face" ? scene.faceStart : scene.edgeStart;
  for (let b = scene.bodies.length - 1; b >= 0; b--) {
    if (index < starts[b]) continue;
    const local = index - starts[b];
    const count = kind === "face" ? scene.bodies[b].view.faces : scene.bodies[b].view.edges;
    return local < count ? { body: b, index: local } : null;
  }
  return null;
}

/** The reference for a joined face or edge index: its body's name for it; null when it has none. */
export function sceneReference(kind: "face" | "edge", scene: Scene, index: number): GeometryReference | null {
  const hit = sceneHit(scene, kind, index);
  return hit === null ? null : shownReference(scene, hit.body, kind, hit.index);
}

/**
 * The reference for face or edge `index` (the kernel's) of shown body
 * `body`: its body's name for it (`designReference`), and once a Combine
 * built (35f1e) the design's: a face's full name, with its tag when another
 * face carries its name too (rule 3); an edge of a Combine's result by its
 * two faces (rule 5; an edge of another body keeps its own feature's name).
 * Null when it has none.
 */
export function shownReference(scene: Scene, body: number, kind: "face" | "edge", index: number): GeometryReference | null {
  const shown = scene.bodies[body];
  const d = scene.design;
  const at = d === undefined ? -1 : d.shown.indexOf(body);
  // A Combine's result's edge names are held names (35f1f2b), never a reference's: without the design's names it has none.
  if (d === undefined || at < 0) return shown.combined && kind === "edge" ? null : designReference(kind, shown.names, index);
  if (!Number.isInteger(index) || index < 0) throw new Error(`a ${kind} reference needs a kernel index (a whole number ≥ 0), got ${index}`);
  if (kind === "face") {
    const full = d.names.full[at][index] ?? null;
    return full === null ? null : { kind, id: full as StableId };
  }
  if (shown.combined) {
    const e = d.names.edges[at][index] ?? null;
    return e?.name == null ? null : { kind, id: e.name as StableId };
  }
  return designReference(kind, shown.names, index);
}

/** The shown body a reference is on (a body reference by its body id, a face's or edge's by the feature its name holds), or -1. */
export function bodyOf(scene: Scene, ref: GeometryReference): number {
  const r = readDesignReference(ref);
  if (r === null) return -1;
  if (r.kind === "body") return scene.bodies.findIndex((b) => b.body === ref.id);
  if (scene.design !== undefined) {
    // 35f1e: the body its name finds across the design; for a name two or more carry, the first shown that does.
    const found = designFind(ref, scene);
    if (found.status === "found") return sceneHit(scene, ref.kind as "face" | "edge", found.index)!.body;
    const carrier = carriers(ref, scene);
    if (carrier >= 0) return carrier;
  }
  return scene.bodies.findIndex((b) => b.names.feature === r.featureId);
}

/**
 * What a face or edge reference finds on the bodies shown (step 25a4): its
 * one face or edge, by joined index; nothing, when no shown body is its
 * feature's or the edit took its face off that body; or more than one, when
 * the edit gave its name to two or more faces or edges (`count`, from
 * `sharedBy`). Then it is never moved to any of them, as a sketch on a face
 * whose name two faces share holds its last place (naming-model.ts
 * `placeOn`): the holder shows a warning and the user picks again.
 */
/** `followed` (35f1e2): an edge reference whose ends no longer fit, found on the only edge left between its two faces (rule 5), so the user is told. */
export type Found = { status: "found"; index: number; followed?: true } | { status: "gone" } | { status: "shared"; count: number };

export function findInScene(ref: GeometryReference, scene: Scene): Found {
  if (scene.design !== undefined && ref.kind !== "body") return designFind(ref, scene);
  return ownFind(ref, scene);
}

/** `findInScene` on the body of the feature the name holds (before any Combine, the only one carrying it). */
function ownFind(ref: GeometryReference, scene: Scene): Found {
  const r = readDesignReference(ref);
  const b = r === null || r.kind === "body" ? -1 : scene.bodies.findIndex((x) => x.names.feature === r.featureId && !x.combined);
  if (b < 0) return { status: "gone" };
  const names = scene.bodies[b].names;
  const i = resolveReference(ref, names);
  if (i !== null) return { status: "found", index: i + (ref.kind === "face" ? scene.faceStart[b] : scene.edgeStart[b]) };
  const count = sharedBy(ref, names);
  return count > 1 ? { status: "shared", count } : { status: "gone" };
}

/**
 * `findInScene` once a Combine built (35f1e, rules 3, 5 and 6 across the
 * design): a face by its name on every body (boolean-names.ts
 * `resolveFaceName`: a tagged one to the piece with its tag, an untagged
 * one finding its face split to the largest piece); an edge of a Combine's
 * result by its two faces (`resolveEdgeName`); an older edge name on its
 * own feature's body, else between a face answering to each of its two
 * (`resolveOldEdge`). A face or edge on a hidden body is not on screen:
 * gone.
 */
function designFind(ref: GeometryReference, scene: Scene): Found {
  const d = scene.design!;
  const r = readDesignReference(ref);
  if (r === null || r.kind === "body" || r.kind === "outline") return { status: "gone" };
  let found: NameFound;
  if (r.kind === "face") found = resolveFaceName(d.bodies, d.names, { name: `face:${r.featureId}/${r.part}`, ...(r.tag && { tag: r.tag }) });
  else if (r.pair) found = resolveEdgeName(d.names, ref.id);
  else {
    const own = ownFind(ref, scene);
    if (own.status !== "gone") return own;
    const [a, b] = oldEdgeFaces(ref)!;
    found = resolveOldEdge(d.bodies, a, b);
  }
  // A name two faces of its own plain body would share carries on neither (naming.ts): said as before a Combine, shared.
  // Only that: a name no face carries, or a tag no piece has (rule 3: a reference holding a tag finds the one piece with
  // that tag), is gone, never found on its own body without its tag (35f1e2, seed 48 on the next kernel).
  if ("lost" in found) {
    const own = r.kind === "face" ? ownFind(ref, scene) : null;
    return own?.status === "shared" ? own : { status: "gone" };
  }
  if ("ambiguous" in found) return { status: "shared", count: found.ambiguous };
  const shown = d.shown[found.body];
  if (shown < 0) return { status: "gone" };
  return { status: "found", index: found.index + (ref.kind === "face" ? scene.faceStart[shown] : scene.edgeStart[shown]), ...(found.warning === "ends" && { followed: true as const }) };
}

/** The first shown body with a face carrying the face name a reference holds (an edge's: either of its faces'), or −1. */
function carriers(ref: GeometryReference, scene: Scene): number {
  const d = scene.design!;
  const r = readDesignReference(ref);
  if (r === null || r.kind === "body" || r.kind === "outline") return -1;
  const wanted = r.kind === "face" ? [`face:${r.featureId}/${r.part}`] : r.pair ? r.part!.split(";")[0].split("+").map((n) => n.split("#")[0]) : oldEdgeFaces(ref)!;
  for (let k = 0; k < d.bodies.length; k++) if (d.shown[k] >= 0 && d.bodies[k].faces.some((f) => f.names.some((n) => wanted.includes(n)))) return d.shown[k];
  return -1;
}

/** The joined index of the face or edge a reference names; null when no shown body has it, or more than one face or edge does. */
export function resolveInScene(ref: GeometryReference, scene: Scene): number | null {
  const found = findInScene(ref, scene);
  return found.status === "found" ? found.index : null;
}
