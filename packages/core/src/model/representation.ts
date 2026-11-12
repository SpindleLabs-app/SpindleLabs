// "Anything can go anywhere": every object can describe itself in one or
// more standard representations, each workspace declares which ones it
// can accept, and the registry picks what to hand over. Copy/paste and
// drag-and-drop between any two workspaces go through deliver() below, so
// no pair of workspaces needs its own conversion code.
//
// Solid, Mesh and Outline are built for real (Design produces them).
// Image and Data are typed now and get their first producers with the
// Image workspace and with parameters / analysis results.

import type { BodySpec, DisplayMesh, Outline } from "../kernel/kernel-types.ts";
import type { FileFormat, FileImporter } from "./files.ts";
import type { Project } from "./project.ts";
import type { BodyReference, FaceReference, GeometryReference } from "./references.ts";

export type RepresentationKind = "solid" | "outline" | "mesh" | "image" | "data";

/**
 * Most exact first. Solid, Outline and Data carry everything their source
 * knows; Mesh and Image are approximations (facets, pixels), used only
 * when the target can't take anything better.
 */
export const EXACTNESS: readonly RepresentationKind[] = ["solid", "outline", "data", "mesh", "image"];
export const isExact = (kind: RepresentationKind) => kind === "solid" || kind === "outline" || kind === "data";

/** A plane in model space (mm): origin, in-plane x axis and normal, both unit length. */
export interface Plane {
  origin: [number, number, number];
  xAxis: [number, number, number];
  normal: [number, number, number];
}

/** The ground plane, z = 0, seen from above. */
export const XY_PLANE: Plane = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };

/** Exact B-rep: what the kernel builds, described so it can be rebuilt exactly. */
export interface SolidRep {
  kind: "solid";
  spec: BodySpec;
}

/** 2D paths with exact curves (lines and arcs today; Béziers/NURBS at step 69), on a plane. */
export interface OutlineRep {
  kind: "outline";
  plane: Plane;
  /** The side of the plane the outline was drawn and is seen from: −1 for against the normal (a sketch on a back or bottom face), where the same x and y look mirrored; left out means the normal's side. A flat copy (SVG, a laser bed) follows it so it is the picture that was drawn (viewport's `planeSeenAs`). */
  side?: -1;
  outline: Outline;
}

/** Triangles in mm, for display, printing and scans. */
export interface MeshRep {
  kind: "mesh";
  positions: number[];
  indices: number[];
}

/** DRAFT: raster pixels with a physical size. */
export interface ImageRep {
  kind: "image";
  width: number;
  height: number;
  /** Physical size of one pixel. */
  mmPerPixel: number;
  /** RGBA, row by row. */
  rgba: Uint8ClampedArray;
}

/** DRAFT: structured values such as parameters, BOM lines and analysis results. */
export interface DataRep {
  kind: "data";
  values: Record<string, unknown>;
}

export type Representation = SolidRep | OutlineRep | MeshRep | ImageRep | DataRep;
export type RepresentationOf<K extends RepresentationKind> = Extract<Representation, { kind: K }>;

/** Anything a workspace can hand to another: its type names who knows how to describe it. */
export interface Producible {
  /** e.g. "design.feature", "design.profile"; later "design.sketch", "vector.path". */
  type: string;
  id: string;
}

/** An object a workspace offers the others, with the name its owner shows it by ("Body 1"). */
export interface ListedObject extends Producible {
  label: string;
  /** The stable reference a link to it keeps (a body's), when its owner names it so: what `facesOf` takes. */
  ref?: BodyReference;
  /** What the one selection holds when it is picked, when its owner lets it be picked from another workspace (Laser's parts, L1b3). */
  selectAs?: GeometryReference;
}

/**
 * Where a face reference is on a body now (TestLab's held and pushed faces):
 * its face (the kernel's index on that body), gone (`why` in words), or
 * shared by `count` faces after the last edit, so never moved to one of them.
 */
export type FaceFound = { status: "found"; face: number } | { status: "gone"; why: string } | { status: "shared"; count: number };

/**
 * A body's faces as its owner shows and names them now, from one rebuild:
 * its display mesh (mm; `triangle_faces` are its own face indices), each
 * face's stable reference by index (null for one with no name of its own,
 * which nothing may hold) and its name in the owner's words ("Top face"),
 * and where each reference asked about is now, in the order asked.
 */
export interface BodyFaces {
  mesh: DisplayMesh;
  faces: (FaceReference | null)[];
  labels: string[];
  found: FaceFound[];
  /** The dependency-graph nodes the body is made from, so a result on it is marked out of date by any edit that could change it (Design: every timeline item). */
  inputs: string[];
}

/** Gives a body's faces and finds face references on it (`BodyFaces`); throws, in words, for a body its owner doesn't show now. */
export type FaceFinder = (project: Project, body: BodyReference, refs: readonly FaceReference[]) => Promise<BodyFaces>;

/** Lists what a workspace offers the others in `project` (read from the project's data, never from the workspace's screen). */
export type Lister = (project: Project) => ListedObject[];

/** Describes one type of object in one representation. */
export type Producer = (object: Producible) => Representation | Promise<Representation>;

/** Turns one representation into another (e.g. outline → image for a raster engraving). */
export interface Converter {
  from: RepresentationKind;
  to: RepresentationKind;
  convert(rep: Representation): Representation | Promise<Representation>;
}

/** What deliver() handed over, and a note for the user when something was lost on the way. */
export interface Delivery {
  representation: Representation;
  /** Set when a lossy representation was used although the source had an exact one. */
  note: string | null;
}

/** What a lossy representation loses. */
const losses: Partial<Record<RepresentationKind, string>> = {
  mesh: "curved faces become flat facets",
  image: "edges become pixels",
};

const nouns: Record<RepresentationKind, string> = {
  solid: "an exact solid",
  outline: "an exact outline",
  mesh: "a triangle mesh",
  image: "an image",
  data: "data",
};

export class RepresentationRegistry {
  private producers = new Map<string, Map<RepresentationKind, Producer>>();
  private converters: Converter[] = [];
  private listers = new Map<string, Lister>();
  private importers = new Map<FileFormat, FileImporter>();
  private finders = new Map<string, FaceFinder>();

  /** Says that objects of `type` can describe themselves as `kind`. */
  registerProducer(type: string, kind: RepresentationKind, producer: Producer): void {
    let byKind = this.producers.get(type);
    if (!byKind) this.producers.set(type, (byKind = new Map()));
    if (byKind.has(kind)) throw new Error(`${type} already has a ${kind} producer`);
    byKind.set(kind, producer);
  }

  /** Says how to list what workspace `workspace` offers (its bodies, for Slice): one lister per workspace. */
  registerLister(workspace: string, lister: Lister): void {
    if (this.listers.has(workspace)) throw new Error(`${workspace} already has a lister`);
    this.listers.set(workspace, lister);
  }

  /** What workspace `workspace` offers in `project`, in its own order; none when it lists nothing (or the project holds nothing of it). */
  objectsOf(workspace: string, project: Project): ListedObject[] {
    return this.listers.get(workspace)?.(project) ?? [];
  }

  /** Says how workspace `workspace` (the owner of the geometry: Design) gives a body's named faces and finds face references on it; one per workspace. */
  registerFaceFinder(workspace: string, finder: FaceFinder): void {
    if (this.finders.has(workspace)) throw new Error(`${workspace} already has a face finder`);
    this.finders.set(workspace, finder);
  }

  /**
   * Body `body`'s faces in `project` as workspace `workspace` names them now,
   * and where each of `refs` is on it. Refused in words when that workspace
   * finds no faces, and checked: a mesh, face list or answer that doesn't
   * fit together is refused, never handed on.
   */
  async facesOf(workspace: string, project: Project, body: BodyReference, refs: readonly FaceReference[]): Promise<BodyFaces> {
    const finder = this.finders.get(workspace);
    if (!finder) throw new Error(`${workspace} doesn't say where its faces are`);
    const got = await finder(project, body, refs);
    const n = got.faces.length;
    const bad = (why: string) => new Error(`${workspace} gave ${body.id}'s faces ${why}`);
    if (got.labels.length !== n) throw bad(`with ${got.labels.length} names for ${n} faces`);
    if (got.mesh.indices.length !== 3 * got.mesh.triangle_faces.length) throw bad("with a mesh whose lists disagree in length");
    if (got.mesh.triangle_faces.some((f) => !(Number.isInteger(f) && f >= 0 && f < n))) throw bad("with a triangle on a face it did not list");
    if (got.found.length !== refs.length) throw bad(`with ${got.found.length} answers for ${refs.length} references`);
    if (got.found.some((f) => f.status === "found" && !(Number.isInteger(f.face) && f.face >= 0 && f.face < n))) throw bad("with a reference found on a face it did not list");
    return got;
  }

  registerConverter(converter: Converter): void {
    this.converters.push(converter);
  }

  /** Says who opens files of these formats when they are dropped or pasted (files.ts); one importer per format. */
  registerImporter(importer: FileImporter): void {
    for (const f of importer.formats) if (this.importers.has(f)) throw new Error(`${f} files already have an importer`);
    for (const f of importer.formats) this.importers.set(f, importer);
  }

  /** Who opens files of this format, or null while nothing does. */
  importerFor(format: FileFormat): FileImporter | null {
    return this.importers.get(format) ?? null;
  }

  /** The representations an object of this type can give directly, most exact first. */
  produces(type: string): RepresentationKind[] {
    const byKind = this.producers.get(type);
    return EXACTNESS.filter((k) => byKind?.has(k));
  }

  /** The representation an object would arrive in, without producing it; null if none fits. */
  plan(type: string, accepts: readonly RepresentationKind[]): { kind: RepresentationKind; via: RepresentationKind | null } | null {
    const direct = this.produces(type);
    const reachable: { kind: RepresentationKind; via: RepresentationKind | null }[] = [];
    for (const kind of direct) reachable.push({ kind, via: null });
    for (const c of this.converters)
      if (direct.includes(c.from) && !direct.includes(c.to)) reachable.push({ kind: c.to, via: c.from });
    for (const kind of EXACTNESS) {
      if (!accepts.includes(kind)) continue;
      // Prefer a direct producer; otherwise convert from the most exact source kind.
      const options = reachable.filter((r) => r.kind === kind);
      if (options.length === 0) continue;
      const best = options.find((r) => r.via === null) ?? options.sort((a, b) => EXACTNESS.indexOf(a.via!) - EXACTNESS.indexOf(b.via!))[0];
      return best;
    }
    return null;
  }

  /**
   * Hands `object` over in the most exact representation the target
   * accepts. Falls back to a lossy one (e.g. solid → mesh) only when the
   * target can't take better, and says so in the note.
   */
  async deliver(object: Producible, accepts: readonly RepresentationKind[]): Promise<Delivery> {
    const route = this.plan(object.type, accepts);
    if (!route) {
      const has = this.produces(object.type);
      throw new Error(
        has.length === 0
          ? `nothing knows how to describe a ${object.type}`
          : `a ${object.type} can be ${has.map((k) => nouns[k]).join(" or ")}, but the target only takes ${accepts.map((k) => nouns[k]).join(" or ")}`,
      );
    }
    const source = route.via ?? route.kind;
    let representation = await this.producers.get(object.type)!.get(source)!(object);
    if (route.via) {
      const c = this.converters.find((c) => c.from === route.via && c.to === route.kind)!;
      representation = await c.convert(representation);
    }
    if (representation.kind !== route.kind) throw new Error(`the ${source} producer for ${object.type} returned ${representation.kind}`);
    const bestExact = this.produces(object.type).find(isExact);
    const note =
      !isExact(route.kind) && bestExact
        ? `Sent as ${nouns[route.kind]}: the target can't take ${nouns[bestExact]}, so ${losses[route.kind]}.`
        : null;
    return { representation, note };
  }
}
