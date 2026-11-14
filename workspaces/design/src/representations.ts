// What Design hands to other workspaces, through the one representation
// registry in core: its features as exact Solids (and Meshes for targets
// that can't take solids), its profiles as exact Outlines.
//
// The Outline producer is generic: it takes any OutlineSource. Ready-made
// profiles are one kind; sketches (step 21b) register as another type with
// this same producer, so there is no sketch-only path.

import type { BodyFaces, BodyReference, BodySpec, FaceFound, FaceReference, KernelCalls, Outline, Plane, Producible, Producer, Project, RepresentationRegistry, SourceLookup } from "@fission/core";
import { bodyFeatures, designBodies } from "./browser.ts";
import { bodyHidden, bodyIdOf, bodyItem, bodyNumbers, makesPieces, profileLabel, readDesignDocument, type DesignDocument } from "./document.ts";
import { endSpec, endStls } from "./move-tool.ts";
import { BodyCache, rebuildTimeline } from "./rebuild.ts";
import { outline } from "./profiles.ts";
import { bodyReference, readDesignReference, profileReference, readProfileReference } from "./references.ts";
import { bodyOf, findInScene, joinBodies, sceneHit, shownBodies, shownReference, type Scene } from "./scene.ts";
import { referenceLabel } from "./selection.ts";
import { sketchOutline, sketchPlane, sketchSide } from "./sketch.ts";
import { buildSpec } from "./spec.ts";

/** Anything in Design that is a closed 2D shape on a plane; a sketch's outline comes from the kernel, so it may be a promise. */
export interface OutlineSource extends Producible {
  plane: Plane;
  /** −1 when it is drawn and seen against the plane's normal (a sketch on a back or bottom face, `sketchSide`); left out otherwise. */
  side?: -1;
  outline(): Outline | Promise<Outline>;
}

/** Outline of any OutlineSource: profiles and sketches. */
export const outlineProducer: Producer = async (object) => {
  const source = object as OutlineSource;
  return { kind: "outline", plane: source.plane, ...(source.side === -1 && { side: -1 as const }), outline: await source.outline() };
};

/**
 * A feature's result, handed over by id. In a design with a Combine (or an
 * extrude with an operation) it also names its `body` (35f1f2d): a
 * Combine's result, each of its pieces and a copy of one have no spec of
 * their own, only the kernel holds them, so they are handed over from a
 * rebuild by body (`bodyNow`).
 */
export interface FeatureHandle extends Producible {
  type: "design.feature";
  document: DesignDocument;
  body?: string;
}

/** Whether a design's bodies are handed over by body (35f1f2d): it holds an item that makes pieces. */
const byBody = (document: DesignDocument) => document.timeline.features.some(makesPieces);

/**
 * Body `body` where the timeline ends it, from one rebuild on a body store
 * of its own: its spec when it has one, and its triangles. A Combine's
 * result has no spec: asked for one, it says so in words, never a wrong
 * body. A body the rebuild doesn't make is refused in words.
 */
async function bodyNow(kernel: KernelCalls, document: DesignDocument, body: string, want: "spec"): Promise<BodySpec>;
async function bodyNow(kernel: KernelCalls, document: DesignDocument, body: string, want: "mesh"): Promise<{ positions: number[]; indices: number[] }>;
async function bodyNow(kernel: KernelCalls, document: DesignDocument, body: string, want: "spec" | "mesh"): Promise<BodySpec | { positions: number[]; indices: number[] }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(document, cache, kernel);
    const built = build.bodies[body];
    if (built === undefined) throw new Error(`${body} is not built`);
    if (want === "spec") {
      if (built.spec === null) throw new Error(`${body} is a Combine's result: only the kernel holds it, so it is handed over as a mesh, not as an exact solid`);
      return built.spec;
    }
    const { mesh } = await cache.view(built.handle);
    return { positions: [...mesh.positions], indices: [...mesh.indices] };
  } finally {
    await cache.close();
  }
}

/**
 * Design's objects that other workspaces can take: each profile, each
 * sketch (its outline found by `kernel` when asked for, never stored) and
 * every solid feature that builds, in build order (25c1; none for a design
 * with no body, 24f4).
 */
export function designObjects(document: DesignDocument, kernel: KernelCalls): (OutlineSource | FeatureHandle)[] {
  const profiles: OutlineSource[] = document.profiles.map((p) => ({
    type: "design.profile",
    id: p.id,
    plane: p.plane,
    outline: () => outline(p.kind, p.width, p.depth),
  }));
  const sketches: OutlineSource[] = document.sketches.map((s) => ({
    type: "design.sketch",
    id: s.id,
    plane: sketchPlane(document, s.id),
    ...(sketchSide(document, s.id) === -1 && { side: -1 as const }),
    outline: () => sketchOutline(kernel, document, s.id),
  }));
  // Every body shown, not only the part's (25c1); a design with no body (24f4) offers no solid.
  const solids: FeatureHandle[] = bodyFeatures(document).map((f) => ({ type: "design.feature", id: f.id, document, ...(byBody(document) && { body: bodyIdOf(f.id) }) }));
  return [...profiles, ...sketches, ...solids];
}

/**
 * How a link another workspace holds finds what it points at in Design
 * (step 25a4), after every rebuild: an object by its id (a profile, a
 * sketch, a body that builds), and a body, face or edge by its stable name on the
 * bodies shown (`scene`, null before the first build), never by the
 * kernel's index. A face or edge found delivers the solid of the body it
 * is on (its feature's), the link keeping the name of which face; one the
 * edit took off its body, or a body not shown, is gone (null, so the link
 * warns); one whose name the edit gave to two or more faces or edges says
 * so and is never moved to one of them. Sources from other workspaces are
 * not Design's to find (null).
 */
export function designLookup(document: DesignDocument, scene: Scene | null, kernel: KernelCalls): SourceLookup {
  // In a design with a Combine, by the body found (a Combine's piece's item is the Combine, which makes no body of its own).
  const solidOf = (featureId: string, body: string): FeatureHandle => ({ type: "design.feature", id: featureId, document, ...(byBody(document) && { body }) });
  return (source) => {
    if (source.origin.workspace !== "design") return null;
    if (source.kind === "object") {
      const object = designObjects(document, kernel).find((o) => o.id === source.origin.id) ?? null;
      // A body the last rebuild failed is not shown, so a link to it is gone until it builds again.
      return object?.type === "design.feature" && scene !== null && !scene.bodies.some((b) => b.feature === object.id) ? null : object;
    }
    const { ref } = source;
    const profile = readProfileReference(ref);
    if (profile !== null) return designObjects(document, kernel).find((o) => o.type === "design.profile" && o.id === profile) ?? null;
    if (scene === null || readDesignReference(ref) === null) return null;
    const b = bodyOf(scene, ref);
    if (b < 0) return null;
    if (ref.kind === "body") return solidOf(scene.bodies[b].feature, scene.bodies[b].body);
    const found = findInScene(ref, scene);
    if (found.status === "shared") return { unresolved: `now matches more than one ${ref.kind} after the last edit, so it was not moved to any of them` };
    return found.status === "found" ? solidOf(scene.bodies[b].feature, scene.bodies[b].body) : null;
  };
}

/**
 * Body `body`'s faces as the design names them now (TestLab's picks), from
 * one rebuild on a body store of its own, and where each of `refs` is: the
 * same scene, names and finding Design's own selection and links use
 * (`shownReference`, `findInScene`), so a face held in another workspace
 * follows an edit exactly as one held here does. A reference found on
 * another body is gone from this one, said so. A body the design doesn't
 * show (hidden, failed, deleted) is refused in words.
 */
export async function bodyFaces(kernel: KernelCalls, project: Project, body: BodyReference, refs: readonly FaceReference[]): Promise<BodyFaces> {
  const document = readDesignDocument(project.workspaces.design);
  if (bodyItem(body.id) === null) throw new Error(`${JSON.stringify(body.id)} is not a body of the design`);
  if (bodyHidden(document, body.id)) throw new Error("it is hidden in Design: show it there to pick its faces");
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(document, cache, kernel);
    const scene = joinBodies(await shownBodies(document, build, cache), build);
    const b = scene.bodies.findIndex((x) => x.body === body.id);
    if (b < 0) throw new Error("the design doesn't build it now");
    const view = scene.bodies[b].view;
    const faces = Array.from({ length: view.faces }, (_, i) => shownReference(scene, b, "face", i) as FaceReference | null);
    const labels = faces.map((f, i) => (f === null ? `Face ${i + 1} (no name of its own)` : referenceLabel(f)));
    const found = refs.map((ref): FaceFound => {
      const f = findInScene(ref, scene);
      if (f.status === "shared") return { status: "shared", count: f.count };
      if (f.status === "gone") return { status: "gone", why: "the last edit took it off the body" };
      const hit = sceneHit(scene, "face", f.index);
      if (hit === null || hit.body !== b) return { status: "gone", why: "it is on another body now" };
      return { status: "found", face: hit.index };
    });
    const m = view.mesh;
    return { mesh: { positions: [...m.positions], normals: [...m.normals], indices: [...m.indices], triangle_faces: [...m.triangle_faces], edge_lines: [...m.edge_lines], edge_line_edges: [...m.edge_line_edges] }, faces, labels, found, inputs: document.timeline.features.map((f) => f.id) };
  } finally {
    await cache.close();
  }
}

/** The name Design's flat outlines (profiles and sketches) are listed under, for Laser: `registry.objectsOf(DESIGN_OUTLINES, project)`. */
export const DESIGN_OUTLINES = "design:outlines";

/** Says what Design produces. `kernel` builds meshes. */
/**
 * What each design's last rebuild said (`failedIds`: the failed items, a mark for each body an Extrude Join left alone, the
 * numbered pieces it did not make), by the project's own Design data. The lister and the STL producer read it, so other
 * workspaces are handed the bodies Design shows (SL #761); data nobody has rebuilt yet is read from the data alone.
 */
const rebuilt = new WeakMap<object, ReadonlySet<string>>();
/** The failed set the lister read for each design it listed, so that design's STL files are made for those bodies. */
const listedWith = new WeakMap<DesignDocument, ReadonlySet<string>>();
const NO_FAILED: ReadonlySet<string> = new Set();

/** Design says what its rebuild of `data` (the design in the project) found: its failed set, as the workspace works it out. */
export function noteRebuild(data: object, failed: ReadonlySet<string>): void {
  rebuilt.set(data, failed);
}

export function registerDesign(registry: RepresentationRegistry, kernel: KernelCalls): void {
  registry.registerProducer("design.profile", "outline", outlineProducer);
  registry.registerProducer("design.sketch", "outline", outlineProducer);
  const spec = (o: Producible) => {
    const { document, body } = o as FeatureHandle;
    if (body !== undefined) return bodyNow(kernel, document, body, "spec");
    const feature = document.timeline.features.find((f) => f.id === o.id);
    if (!feature) throw new Error(`feature ${o.id} is not in the design`);
    // An extrude of a sketch asks the kernel for the outline, now.
    return endSpec(kernel, document, feature); // where the timeline puts it: moved by any Move (35e2b)
  };
  // What Slice (and any workspace that takes bodies) can list: every body shown (not hidden by its eye), by its browser name.
  registry.registerLister("design", (project) => {
    let doc: DesignDocument;
    try {
      doc = readDesignDocument(project.workspaces.design);
    } catch {
      return []; // no Design data yet, or data that does not read: nothing to offer
    }
    const failed = rebuilt.get(project.workspaces.design as object) ?? NO_FAILED;
    listedWith.set(doc, failed);
    const numbers = bodyNumbers(doc);
    const seen = new Set<string>();
    // With a Combine, each body by itself (35f1f2d: a Combine's pieces share their item); else by its item, as before.
    const pieces = byBody(doc);
    return designBodies(doc, failed).flatMap(({ body, feature }) => {
      const key = pieces ? body : feature.id;
      if (bodyHidden(doc, body) || seen.has(key)) return [];
      seen.add(key);
      return [{ type: "design.feature", id: feature.id, document: doc, label: `Body ${numbers.get(body) ?? "?"}`, ref: bodyReference(body) as BodyReference, ...(pieces && { body }) }];
    });
  });
  // What Laser (and any workspace that takes flat shapes) can list: every ready-made profile and every sketch with
  // curves that is not suppressed, by its name in the browser, as exact outlines (a sketch's found by the kernel when
  // delivered, so an open one is refused then, in words). A lister of its own, so the bodies' list stays bodies.
  registry.registerLister(DESIGN_OUTLINES, (project) => {
    let doc: DesignDocument;
    try {
      doc = readDesignDocument(project.workspaces.design);
    } catch {
      return [];
    }
    const items = new Map(doc.timeline.features.map((f) => [f.id, f]));
    // Each picked in the one selection as Design picks it (its outline's reference), so a part picked in Laser is the
    // profile or sketch picked in Design and back (L1b3).
    const selectAs = (id: string) => (/^[^:/]+$/.test(id) ? { selectAs: profileReference(id) } : {});
    return designObjects(doc, kernel).flatMap((o) => {
      if (o.type === "design.profile") {
        const p = doc.profiles.find((x) => x.id === o.id);
        return p ? [{ ...o, label: profileLabel(p), ...selectAs(o.id) }] : [];
      }
      if (o.type !== "design.sketch") return [];
      const sketch = doc.sketches.find((x) => x.id === o.id);
      const item = items.get(o.id);
      if (!sketch || sketch.curves.length === 0 || !item || item.suppressed) return [];
      return [{ ...o, label: item.provenance.self.label, ...selectAs(o.id) }];
    });
  });
  // Where a body's faces are now, by name (TestLab's held and pushed faces).
  registry.registerFaceFinder("design", (project, body, refs) => bodyFaces(kernel, project, body, refs));
  // A body's exact STL file from the kernel (the file the slicer reads, a Combine's pieces too), as data: the files of every
  // body shown are made together, once for the design as it stands, since a Combine's rebuild is the costly part.
  const stlFiles = new WeakMap<DesignDocument, Promise<Map<string, Uint8Array>>>();
  const stlOf = async (o: Producible): Promise<Uint8Array> => {
    const { document, body } = o as FeatureHandle;
    let made = stlFiles.get(document);
    if (!made) {
      const bodies = designBodies(document, listedWith.get(document) ?? NO_FAILED).filter((b) => !bodyHidden(document, b.body));
      made = endStls(kernel, document, bodies.map((b) => ({ ...b, name: "body" }))).then((files) => new Map(bodies.map((b, i) => [b.body, files[i].bytes])));
      stlFiles.set(document, made);
      made.catch(() => stlFiles.delete(document)); // a failed build is tried again next time
    }
    const bytes = (await made).get(body ?? bodyIdOf(o.id));
    if (!bytes) throw new Error(`${body ?? o.id} is not a body of the design that is shown`);
    return bytes;
  };
  registry.registerProducer("design.feature", "data", async (o) => ({ kind: "data", values: { format: "stl", bytes: await stlOf(o) } }));
  registry.registerProducer("design.feature", "solid", async (o) => ({ kind: "solid", spec: await spec(o) }));
  registry.registerProducer("design.feature", "mesh", async (o) => {
    const { document, body } = o as FeatureHandle;
    if (body !== undefined) return { kind: "mesh", ...(await bodyNow(kernel, document, body, "mesh")) };
    const view = await buildSpec(kernel, await spec(o));
    return { kind: "mesh", positions: view.mesh.positions, indices: view.mesh.indices };
  });
}
