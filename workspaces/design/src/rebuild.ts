// The timeline rebuilt on the kernel's body store (step 24d2): every
// feature in order, each solid one's result a body handle or the reason it
// has none. A body is never changed in place, so a feature whose spec is
// the same as last time keeps its handle (`BodyCache`), and handles no
// feature holds any more are freed.
//
// The owner's rule (docs/progress/cad.md, packages/testing/src/
// timeline-model.ts, the model this is checked against): an extrude whose
// sketch is lost (deleted, or making no outline) builds from its kept
// shape, the sketch as it was just before the edit that lost it, with a
// warning naming the sketch; with no kept shape it fails with the cause.
// `settleKept` keeps and forgets those shapes after every edit. Causes and
// the curves at fault come from the kernel's `kind` and `inputs` (and
// sketch_outline's `invalid`), never from its words.
//
// Step 26e: suppressing an item greys everything built on it, all the way
// down, with no warning (Q3): an extrude of a suppressed sketch is greyed
// too, where until 26e it failed.
//
// Step 26c: a sketch item's result says where it lies (`placement`); a
// sketch on a face is placed on its face as built just before it (rule 8,
// face-sketch.ts), or held at its last placement with a plane warning when
// the face's name finds no face or two (rule 6), and greyed while its
// face's feature is suppressed or greyed (Q3). An extrude of a sketch not
// on XY, or flipped, is built placed (the kernel's frame and flip, 26b);
// one whose face sketch is held says its source is lost (rule 7).
// `settleKept` also keeps and forgets the held placements, judged with
// nothing suppressed and no marker, as the naming model's `settle` does.
//
// Step 35d4: an item whose kernel call ran past its time limit (the
// error's kind "timed-out", never its words) fails with "took too long";
// the kernel was started again, so the design is built once more from the
// document, and that item is not tried again (`SlowItems`) until the user
// asks (Retry on its row) or changes it or anything before it: a call that
// always runs too long would otherwise stop every fresh kernel in turn.

import { KERNEL_TOOK_TOO_LONG, KernelError, type BodyHandle, type BodySpec, type BodyView, type BooleanOp, type BooleanResult, type Motion, type KernelTouch, type KernelThin, type Feature, type KernelCalls, type KernelInput, type Outline, type Plane, type SketchXY } from "@fission/core";
import { bodyIdOf, bodyItem, buildingItems, isPiece, combineBodies, duplicatedBody, extrudeOperation, isCombineItem, isDuplicateItem, isOperationExtrude, isMoveItem, isSketchExtrude, isSketchItem, keptOf, ownShape, sketchInputs, specOf, type CombineOperation, type DesignDocument, type KeptShape, type Sketch, type SketchPlane } from "./document.ts";
import { carried, faceFeature, faceReference, frameNow, frameOf, isFaceSketch, movedFrame, planeWords, squared, type PlaneWarning, type SketchPlacement } from "./face-sketch.ts";
import { pinNow, pointWords, vertexNames, type PinNow, type PointWarning } from "./face-edges.ts";
import type { BodyNames } from "./naming.ts";
import { combineNames, designNames, resolveFaceName, shownFaces, type DesignNames, type NamedBody } from "./boolean-names.ts";
import { DESIGN_EDGE, isHeldDesignName, pinNameNow, withHeldEdges } from "./design-edges.ts";
import { copiedNames, frameOfFace, framesOfResult, namedBody, namesOfBody } from "./built-body.ts";
import { pieceIds } from "./boolean-names.ts";
import { cornerOrder, edgeNamed, edgeShape, madeKind, profileCurves, placesOf, projectedOpen, projectionWords, type HeldCause, type ProjectionWarning } from "./projection.ts";
import { movedBodies, moveMotions, movedSpec, moveValues } from "./move.ts";
import { mirrorMotion, mirrorOf } from "./duplicate.ts";
import { readDesignReference, resolveReference, sharedBy } from "./references.ts";
import { planeOf, plainOutline, sketchCurves } from "./sketch.ts";
import { curveWord, readAnswer, shrunk, solvedPoints, solverRequest } from "./constraints.ts";
import { findRegion, refusalReason, regionOutline, type RegionRef } from "./regions.ts";

/** Why an extrude's sketch gives it no outline (the model's causes). */
export type LostCause = "deleted-input" | "open-outline" | "invalid-outline";

/** The sketch's curve ids by kind, in the order sketchCurves lists them: how an outline's pieces name their curves. */
export interface CurveIds {
  line: string[];
  arc: string[];
  circle: string[];
}

/** An extrude built from its kept shape: which sketch, why, the kernel's words, and the curves it named. */
export interface KeptWarning {
  cause: LostCause;
  sketch: string;
  message: string;
  curves: string[];
}

export type FeatureResult =
  /**
   * A sketch item with where it lies (`placement`) and, for a sketch on a
   * face held at its last placement, why (`plane`); or a solid feature with
   * the ids of the bodies it made (`bodies`; 35eb: each held in the
   * build's `bodies`, by body id, as the Moves after it leave it) and, for
   * an extrude of a sketch, `source` when its sketch is held (rule 7).
   */
  | {
      status: "built";
      bodies?: string[];
      warning?: KeptWarning;
      placement?: SketchPlacement;
      plane?: PlaneWarning;
      source?: PlaneWarning & { sketch: string };
      /** A face sketch's pinned points that found their edge, where they are now (26f), and why the others are held. */
      pinned?: { point: string; at: SketchXY }[];
      points?: PointWarning;
      /** Step 27d: each projection that found its edge, where its points are now (and a circle's radius), and why the others are held. */
      projected?: { id: string; points: { point: string; at: SketchXY }[]; radius?: number }[];
      projections?: ProjectionWarning;
      /**
       * Step 47d4: a sketch with constraints whose followed points moved, solved
       * again with them where they are now: the other points the solve moved,
       * where they are now; or, when its constraints can't hold there, why
       * (the followed points are taken, the rest left where they were).
       */
      solved?: { point: string; at: SketchXY }[];
      constraints?: { message: string };
      /** A Move's (35e2): the bodies it moved, as they were before it, kept so the next rebuild needn't build them again. */
      holds?: BodyHandle[];
      /** A Combine's or an operation extrude's pieces (35f1) by id, each with the shown names of its faces as the item made them: what the data remembers a piece by when it is first numbered (hunt 11-06). */
      pieceFaces?: Record<string, string[]>;
      /** An item whose numbered pieces no longer have the faces they were numbered with, so a piece number may now be another piece (hunt 11-06): why, and those pieces' ids. */
      pieces?: { message: string; renumbered: string[] };
    }
  | { status: "suppressed" }
  /** Built on a suppressed item (`by`), directly or through others (Q3; from 26e an extrude of a suppressed sketch too): off, with no warning, until it is unsuppressed. */
  | { status: "greyed"; by: string }
  | { status: "rolled-back" }
  /**
   * `cause` the model's (an input lost or failed) or "error":
   * the kernel refused something that isn't the sketch (a distance) or
   * isn't built yet (a sketch on another plane). `curves`: the sketch
   * curves at fault, when the kernel named them.
   */
  | {
      status: "failed";
      cause: LostCause | "failed-input" | "error" | "timed-out";
      input?: string;
      message: string;
      curves?: string[];
      /** A Combine whose result would touch itself (35f1, the kernel's "non-manifold-result"): where, in the world, for the overlay on its row (36d). */
      touches?: KernelTouch[];
      /** A Combine whose result would be too thin (36d, the kernel's "thin-result"): where, in the world, for the same overlay. */
      thin?: KernelThin[];
      /** A Combine refused: the bodies it made for a body picked twice (equal bodies), kept so the next rebuild needn't build them again. */
      holds?: BodyHandle[];
    }

/**
 * The items whose build took the kernel too long (35d4), each with what it
 * was built from then: the items up to it in the timeline and their
 * sketches. A rebuild fails such an item at once, without asking the
 * kernel, while that is unchanged; an edit to it or to anything before it,
 * or `retry`, lets the next rebuild try it again.
 */
export class SlowItems {
  private items = new Map<string, string>();

  /** `f` took too long, built as `doc` has it. */
  note(doc: DesignDocument, f: Feature): void {
    this.items.set(f.id, builtFrom(doc, f.id));
  }

  /** Whether `f` took too long built from what `doc` has before it, and so is not tried again. */
  has(doc: DesignDocument, f: Feature): boolean {
    const was = this.items.get(f.id);
    return was !== undefined && was === builtFrom(doc, f.id);
  }

  /** The next rebuild tries `id` again; false when it hadn't taken too long. */
  retry(id: string): boolean {
    return this.items.delete(id);
  }

  /** The ids noted, in the order they were. */
  get ids(): string[] {
    return [...this.items.keys()];
  }
}

/** What item `id` is built from: the timeline up to it and the sketches of those items, as text. */
function builtFrom(doc: DesignDocument, id: string): string {
  const { features } = doc.timeline;
  const upTo = features.slice(0, features.findIndex((f) => f.id === id) + 1);
  const ids = new Set(upTo.flatMap((f) => [f.id, ...(typeof f.intent.parameters.sketch === "string" ? [f.intent.parameters.sketch] : [])]));
  return JSON.stringify({ items: upTo, sketches: doc.sketches.filter((s) => ids.has(s.id)) });
}

/** A failed item's words when it took the kernel too long (35d4). */
export const tookTooLong = (label: string) => `${label} took too long: ${KERNEL_TOOK_TOO_LONG} Retry on its row tries it again.`;

/** Whether `e` is a kernel call that ran past its time limit (its kind, never its words). */
export const timedOut = (e: unknown): boolean => e instanceof KernelError && e.kind === "timed-out";

/**
 * A body as a rebuild leaves it (35eb): the item that made it, its handle
 * in the kernel's store, the spec it was built from (moved by the Moves
 * so far), and for an extrude of a sketch the curves its faces are named
 * by. Held by body id, so a feature may one day make several (35ec: a
 * Combine's pieces) and a Move moves bodies, not items.
 */
export interface BuiltBody {
  feature: string;
  handle: BodyHandle;
  /** What builds it; null for a Combine's result (35f1), which only the kernel's store holds (`named` has its names). */
  spec: BodySpec | null;
  curves?: CurveIds;
  /**
   * A Combine's result (35f1): each face's names by kernel face index and
   * where each name comes in made order (boolean-names.ts `NamedBody`), so
   * a later Combine names its result from them.
   */
  named?: Pick<NamedBody, "faces" | "made">;
  /** A Combine's result (35f1f2b): the Combine that made it, the item its pins and projections depend on. */
  by?: string;
  /**
   * A Combine's result (35f1e2): where the Moves before it had put the
   * frame of the body each face came from (`bodyFrame`), by kernel face
   * index; null for a face whose body never moved, all left out when none
   * did. Per face, as a target's Move carries the target's faces, never a
   * tool's (built-body.ts `frameOfFace`).
   */
  frames?: readonly (Plane | null)[];
}


/** Every item's result by item id, in timeline order (`order`), and every body built by body id (`bodies`). */
export interface TimelineBuild {
  order: string[];
  results: Record<string, FeatureResult>;
  bodies: Record<string, BuiltBody>;
}

/**
 * The body item `featureId` built in `build` (35eb), or undefined when it
 * built none: not built, or an item that makes no body (a sketch, a
 * Move). What a result's `body`, `spec` and `curves` were before 35eb.
 */
export function builtBody(build: Pick<TimelineBuild, "results" | "bodies">, featureId: string): BuiltBody | undefined {
  return build.results[featureId]?.status === "built" ? build.bodies[bodyIdOf(featureId)] : undefined;
}

/** Each body the build holds for timeline items, by body id; none in the build is never undefined but missing. */
type Bodies = Record<string, BuiltBody>;

/**
 * Bodies kept in the kernel by spec: the same spec gives the same handle
 * without building again, and `keepOnly` frees every other one. One cache
 * per document view; `clear` frees all of it. Uses of it may overlap
 * (`using`: the app's rebuilds and its settling, 26g): nothing is freed
 * while one runs, so none frees a body another is using.
 */
const CLOSED = "Design was closed, so nothing more is built";

export class BodyCache {
  /** `hidden`: the kernel holds no display mesh for it (35d4, `showOnly`); a body is built with one. */
  private bodies = new Map<string, { handle: BodyHandle; view?: Promise<BodyView>; hidden?: true }>();
  /** Each kept body's key by its handle, so `view` finds it in one step (security audit S2). */
  private keys = new Map<BodyHandle, string>();
  /** Each boolean's answer by its inputs (`boolean`); its bodies are kept in `bodies` like built ones. */
  private booleans = new Map<string, BooleanResult>();
  /** Each body_move's answer by its input and moves (`moved`, 35f1f2a): the body it moved and the one it made, kept in `bodies` like built ones. */
  private moves = new Map<string, { from: BodyHandle; to: BodyHandle }>();
  /** Bodies asked of the kernel and not answered yet: the same spec asked again waits for the same answer, so asking ahead never builds twice. */
  private building = new Map<string, Promise<BodyHandle>>();
  /** Set by `close`: nothing more is built, and a body answered after it is freed at once, not kept. */
  private closed = false;
  /** Uses running now (`using`): while any is, `keepOnly` only says what to keep, and the last to end frees the rest. */
  private uses = 0;
  /** Bodies the kernel failed to free (`free`), freed at the next chance. */
  private unfreed: BodyHandle[] = [];
  /** The bodies the last `keepOnly` kept (none before the first). */
  private wanted = new Set<BodyHandle>();
  private kernel: KernelCalls;
  constructor(kernel: KernelCalls) {
    this.kernel = kernel;
  }

  /**
   * The body for `spec`, built once. Equal specs share one body; `copy` n > 0
   * is its own n-th body of the same shape (35f1d: a Combine of two equal
   * bodies in the same place hands the kernel two bodies, never one twice).
   */
  async body(spec: BodySpec, copy = 0): Promise<BodyHandle> {
    if (this.closed) throw new Error(CLOSED);
    const key = JSON.stringify(spec);
    const at = copy === 0 ? key : `${key}#copy${copy}`;
    const hit = this.bodies.get(at);
    if (hit) return hit.handle;
    const asked = this.building.get(at);
    if (asked) return asked;
    const build = this.kernel.call("body_build", spec).then((handle) => {
      if (this.closed) {
        // Asked before Design closed (a rebuild asks for every body at once): the kernel would keep it forever.
        void this.kernel.call("body_free", handle).catch(() => {});
        throw new Error(CLOSED);
      }
      this.bodies.set(at, { handle });
      this.keys.set(handle, at);
      return handle;
    });
    this.building.set(at, build);
    try {
      return await build;
    } finally {
      this.building.delete(at);
    }
  }

  /**
   * `body_boolean(target, tools, op)` once for the same inputs (35f1: the
   * kernel keeps a body as it is, so the same handles and operation give
   * the same answer): its result bodies are kept like built ones, freed by
   * `keepOnly` when no rebuild holds them. Asked again once any of them is
   * gone. A refusal is not kept: asked again, it is asked again. `copy`
   * n > 0 is its own n-th answer of the same shape, as `body`'s copies are
   * (hunt 11-06: two Combines of equal inputs must not hand out one body).
   */
  async boolean(target: BodyHandle, tools: readonly BodyHandle[], op: BooleanOp, copy = 0): Promise<BooleanResult> {
    if (this.closed) throw new Error(CLOSED);
    const key = JSON.stringify(copy === 0 ? ["boolean", target, tools, op] : ["boolean", target, tools, op, copy]);
    const hit = this.booleans.get(key);
    if (hit && hit.bodies.every((h) => this.keys.has(h))) return hit;
    const result = await this.kernel.call("body_boolean", target, [...tools], op);
    if (this.closed) {
      for (const h of result.bodies) void this.kernel.call("body_free", h).catch(() => {});
      throw new Error(CLOSED);
    }
    result.bodies.forEach((handle, i) => {
      const k = `${key}#${i}`;
      this.bodies.set(k, { handle });
      this.keys.set(handle, k);
    });
    this.booleans.set(key, result);
    return result;
  }

  /**
   * `body_move(handle, motions)` once for the same body and motions
   * (35f1f2a: a Combine's result, which no spec builds, moved by a Move):
   * the moved body is kept like built ones, freed by `keepOnly` when no
   * rebuild holds it. Asked again once either body is gone. A refusal is
   * not kept.
   */
  async moved(handle: BodyHandle, motions: readonly Motion[]): Promise<BodyHandle> {
    if (this.closed) throw new Error(CLOSED);
    const key = JSON.stringify(["moved", handle, motions]);
    const hit = this.moves.get(key);
    if (hit && this.keys.has(hit.from) && this.keys.has(hit.to)) return hit.to;
    const to = await this.kernel.call("body_move", handle, [...motions]);
    if (this.closed) {
      void this.kernel.call("body_free", to).catch(() => {});
      throw new Error(CLOSED);
    }
    this.bodies.set(key, { handle: to });
    this.keys.set(to, key);
    this.moves.set(key, { from: handle, to });
    return to;
  }

  /** A kept body's view, asked of the kernel once it answers (a failed ask is forgotten, so the next look asks again: T6b). */
  view(handle: BodyHandle): Promise<BodyView> {
    const key = this.keys.get(handle);
    const entry = key === undefined ? undefined : this.bodies.get(key);
    if (!entry) throw new Error(`body ${handle} is not in this cache`);
    if (entry.view === undefined) {
      const asked = this.kernel.call("body_view", handle);
      entry.view = asked;
      delete entry.hidden; // body_view meshes a hidden body again and keeps the mesh
      asked.catch(() => {
        if (entry.view === asked) entry.view = undefined;
      });
    }
    return entry.view;
  }

  /**
   * The kernel keeps a display mesh only for these of its bodies (35d4,
   * the store's mesh memory, 35d2): every other kept body is hidden
   * (`body_hide`), and its view let go here too, so looking at it again
   * asks `body_view`, which meshes it again. A body the kernel fails to
   * hide stays as it was, shown, and is tried at the next call.
   */
  async showOnly(handles: Iterable<BodyHandle>): Promise<void> {
    const shown = new Set(handles);
    for (const entry of [...this.bodies.values()]) {
      if (entry.hidden || shown.has(entry.handle)) continue;
      try {
        await this.kernel.call("body_hide", entry.handle);
      } catch {
        continue;
      }
      entry.hidden = true;
      entry.view = undefined;
    }
  }

  /** How many kept bodies the kernel holds a display mesh for (35d4). */
  get meshed(): number {
    return [...this.bodies.values()].filter((b) => !b.hidden).length;
  }

  /** Frees every body but these: now, or once the last use running ends. */
  async keepOnly(handles: Iterable<BodyHandle>): Promise<void> {
    // A closed cache keeps nothing: a rebuild still running when Design closed (two quick Undos) ends with its own
    // keepOnly, whose bodies no cache would ever free otherwise (real-use hunt C1, 2026-10-28).
    this.wanted = this.closed ? new Set() : new Set(handles);
    await this.freeUnwanted();
  }

  /**
   * `use`, its bodies kept until it ends: then, with no other use running,
   * every body the last `keepOnly` didn't keep is freed (all it built
   * itself, unless a `keepOnly` kept them meanwhile).
   */
  async using<T>(use: () => Promise<T>): Promise<T> {
    this.uses++;
    try {
      return await use();
    } finally {
      this.uses--;
      await this.freeUnwanted();
    }
  }

  private async freeUnwanted(): Promise<void> {
    for (const handle of this.unfreed.splice(0)) await this.free(handle);
    for (const [key, b] of this.bodies) {
      // A use began while the kernel freed the last one: its bodies (and these) wait for it to end.
      if (this.uses > 0) return;
      if (this.wanted.has(b.handle)) continue;
      this.bodies.delete(key);
      this.keys.delete(b.handle);
      await this.free(b.handle);
    }
    // A boolean none of whose bodies is kept any more is forgotten (one with some kept is asked again when used).
    for (const [key, r] of this.booleans) if (!r.bodies.some((h) => this.keys.has(h))) this.booleans.delete(key);
    // A move whose input or answer is gone is forgotten (its answer, if still kept, is freed with the next keepOnly that drops it).
    for (const [key, m] of this.moves) if (!this.keys.has(m.from) || !this.keys.has(m.to)) this.moves.delete(key);
  }

  /**
   * Frees a body no use holds; one the kernel fails to free is still held
   * there, so it is tried again at the next chance (once more at once when
   * the cache is closed: there is no next chance), and the use that ended
   * keeps its own answer (T6b).
   */
  private async free(handle: BodyHandle): Promise<void> {
    try {
      await this.kernel.call("body_free", handle);
    } catch {
      if (this.closed) await this.kernel.call("body_free", handle).catch(() => {});
      else this.unfreed.push(handle);
    }
  }

  /** Frees `handle`, a body built for a moment outside the cache (Extrude's preview), as the cache frees its own. */
  release(handle: BodyHandle): Promise<void> {
    return this.free(handle);
  }

  clear(): Promise<void> {
    return this.keepOnly([]);
  }

  /**
   * The kernel was replaced by a fresh one (KernelCalls.onRestart): every
   * body it kept went with it, so all are forgotten, never freed (a fresh
   * kernel hands out the same handles again, for other bodies). The next
   * rebuild builds every body anew.
   */
  forget(): void {
    this.bodies.clear();
    this.keys.clear();
    this.building.clear();
    this.booleans.clear();
    this.moves.clear();
    this.unfreed = [];
    this.wanted = new Set();
  }

  /** Design is gone for good: frees every body, and every one still being built once it is answered. */
  close(): Promise<void> {
    this.closed = true;
    return this.clear();
  }

  get size(): number {
    return this.bodies.size;
  }
}

/** The ids of the curves a sketch's outline is asked from (from 27d without a projected edge that joins none: `profileCurves`). */
function idsOf(content: Pick<Sketch, "points" | "curves" | "projected">): CurveIds {
  const curves = profileCurves(content);
  return {
    line: curves.filter((c) => c.kind === "line").map((c) => c.id),
    arc: curves.filter((c) => c.kind === "arc").map((c) => c.id),
    circle: curves.filter((c) => c.kind === "circle").map((c) => c.id),
  };
}

/** The sketch curves a kernel answer names (line, arc and circle inputs), as ids. */
const namedCurves = (inputs: readonly KernelInput[], ids: CurveIds): string[] =>
  inputs.flatMap((i) => (i.input === "line" || i.input === "arc" || i.input === "circle" ? (ids[i.input][i.index] ?? []) : []));

/** An extrude's region (step 48; Design data version 9), or undefined for one that extrudes its sketch's one outline. */
export const regionOf = (f: Feature): RegionRef | undefined => (Object.hasOwn(f.intent.parameters, "region") ? (f.intent.parameters.region as RegionRef) : undefined);

/** The words, after the sketch's name, for an extrude whose region the sketch no longer makes (step 48): the curves round it changed. */
export const REGION_GONE = "no longer has the region this extrude uses (the curves round it were changed or deleted)";

/**
 * What a sketch's points and curves make (its projected ones only where
 * they join, 27d): the outline, or why there is none, from the kernel's
 * fields. With `region` (step 48), the region of that name instead
 * (`findRegion`), or why it can't be had; `refused` marks words to show
 * as they are, never after "has no closed outline:".
 */
async function outlineOf(kernel: KernelCalls, content: KeptShape & Pick<Sketch, "projected">, region?: RegionRef): Promise<{ outline: Outline } | { lost: "open-outline" | "invalid-outline"; message: string; curves: string[]; refused?: true }> {
  const ids = idsOf(content);
  const none = projectedOpen(content);
  if (none !== null) return { lost: "open-outline", message: none, curves: [] };
  const c = sketchCurves(content);
  try {
    if (region !== undefined) {
      const answer = await kernel.call("sketch_regions", c.lines, c.circles, c.arcs);
      const found = findRegion(answer.regions, ids, region);
      if (found === undefined) return { lost: "open-outline", message: answer.regions.length === 0 && answer.why !== undefined ? answer.why : REGION_GONE, curves: [] };
      if (found.extrudes) return { outline: regionOutline(found) };
      return { lost: "invalid-outline", message: found.refused ?? "this region can't be extruded", curves: namedCurves(found.invalid ?? [], ids) };
    }
    const out = plainOutline(await kernel.call("sketch_outline", c.lines, c.circles, c.arcs));
    if ("closed" in out) return { outline: out.closed };
    if (out.invalid) return { lost: "invalid-outline", message: out.open, curves: namedCurves(out.invalid, ids) };
    return { lost: "open-outline", message: out.open, curves: [] };
  } catch (e) {
    // A curve the kernel refuses outright (a line of length 0): the outline is invalid there.
    if (e instanceof KernelError && e.kind === "invalid-input" && namedCurves(e.inputs, ids).length > 0) return { lost: "invalid-outline", message: e.message, curves: namedCurves(e.inputs, ids), refused: true };
    throw e;
  }
}

/** A sketch's content as it is now, or undefined when it is gone. */
const contentOf = (doc: DesignDocument, id: string): Sketch | undefined => doc.sketches.find((s) => s.id === id);

/** A document's timeline items and sketches by id (each id's first), so a rebuild looks each up in one step (security audit S2). */
export interface DocIndex {
  items: Map<string, Feature>;
  sketches: Map<string, Sketch>;
}

export function indexOf(doc: DesignDocument): DocIndex {
  const items = new Map<string, Feature>();
  for (const f of doc.timeline.features) if (!items.has(f.id)) items.set(f.id, f);
  const sketches = new Map<string, Sketch>();
  for (const s of doc.sketches) if (!sketches.has(s.id)) sketches.set(s.id, s);
  return { items, sketches };
}

/**
 * `kernel` with the outline of every sketch an extrude in `docs` uses (and
 * every kept shape) asked at once, before anything waits on one: asked one
 * after another, each waited a round trip to the kernel's worker, which a
 * busy page stretches to a frame, so a big file took minutes (security
 * audit S2). The same curves asked again get the same answer; the kernel's
 * work is the same, only the waiting goes.
 */
function outlinesAtOnce(kernel: KernelCalls, docs: DesignDocument[]): KernelCalls {
  const asked = new Map<string, ReturnType<KernelCalls["call"]>>();
  const ask = (args: unknown[], op: "sketch_outline" | "sketch_regions" = "sketch_outline") => {
    const key = op + JSON.stringify(args);
    let answer = asked.get(key);
    if (answer === undefined) {
      answer = (kernel.call as (op: string, ...a: unknown[]) => ReturnType<KernelCalls["call"]>)(op, ...args);
      answer.catch(() => {}); // a refusal is read by whoever asks for it; one nobody asks for is not an error
      asked.set(key, answer);
    }
    return answer;
  };
  const curvesOf = (content: KeptShape & Pick<Sketch, "projected">) => {
    const c = sketchCurves(content);
    return [c.lines, c.circles, c.arcs];
  };
  for (const doc of docs) {
    const { sketches } = indexOf(doc);
    for (const f of doc.timeline.features) {
      if (!isSketchExtrude(f)) continue;
      const op = regionOf(f) === undefined ? "sketch_outline" : "sketch_regions";
      const content = sketches.get(f.intent.parameters.sketch as string);
      if (content !== undefined) ask(curvesOf(content), op);
      const kept = keptOf(doc, f);
      if (kept !== undefined) ask(curvesOf(kept), op);
    }
  }
  return { call: ((op: string, ...args: unknown[]) => (op === "sketch_outline" || op === "sketch_regions" ? ask(args, op) : (kernel.call as (op: string, ...a: unknown[]) => unknown)(op, ...args))) as KernelCalls["call"] };
}

/** Whether a sketch makes an outline now, or the extrude's region (suppression and the marker don't count): the owner's "lost" is its opposite. */
async function makesOutline(kernel: KernelCalls, doc: DesignDocument, sketchId: string, region?: RegionRef): Promise<boolean> {
  const content = contentOf(doc, sketchId);
  return content !== undefined && "outline" in (await outlineOf(kernel, content, region));
}

/**
 * The document after an edit from `before` to `after`, with the owner's
 * rule applied: an extrude whose sketch is lost in `after` keeps the
 * sketch's points and curves from `before` (if it made an outline there
 * and the extrude has no kept shape yet), and where it lay when not on XY;
 * one whose sketch makes an outline forgets its kept shape. From step 26c
 * a sketch on a face whose name finds no face or two in `after` holds the
 * placement it had in `before` (if it holds none yet), and forgets it once
 * its face is back; from 26f, each point pinned to its face's edge goes
 * where that edge is now, judged the same way (`follow`), and stays
 * where it was when the edge is gone; from 27d each projection likewise. The same rules as the model's `settle`: suppression
 * and the marker don't count, so a greyed sketch keeps nothing while its
 * face is there, and one whose face went while it was greyed keeps where
 * it was. `after` itself when nothing changes.
 *
 * Placing face sketches builds bodies: on `cache` when given (it may be
 * the one drawn from, even while it rebuilds: bodies built already are
 * reused, and the ones this settle built and no rebuild keeps are freed
 * after, `BodyCache.using`), else on one of its own, freed after.
 */
export async function settleKept(calls: KernelCalls, before: DesignDocument, after: DesignDocument, cache?: BodyCache): Promise<DesignDocument> {
  // Every outline `after` needs asked at once; `before`'s, needed only for a sketch just lost, as they come.
  const kernel = outlinesAtOnce(calls, [after]);
  const bodies = cache ?? new BodyCache(calls);
  const placed = (doc: DesignDocument) => placeOpen(doc, bodies, kernel);
  let was: Promise<Record<string, FeatureResult>> | undefined;
  /**
   * Where a face sketch lay in `before` with nothing suppressed and no
   * marker. One that failed there (the kernel failed it: it is placed or
   * held otherwise, never failed for its own sake) lay somewhere this
   * can't tell, so the settle fails, and the edit with it, rather than
   * keep a shape with no place (T6b: a sketch deleted while its face's
   * view failed once kept its extrude's shape on XY, not on the face).
   */
  const wasAt = async (id: string) => {
    was ??= placed(before);
    const r = (await was)[id];
    if (r?.status === "failed") throw new Error(r.message);
    return r?.status === "built" ? r.placement : undefined;
  };
  // Its own cache is closed after: a body the kernel failed to free is tried once more then (T6b).
  const own = cache === undefined;
  const settling = bodies.using(async () => {
    const beforeItems = indexOf(before).items;
    /**
     * `doc` (`after`, its pinned points and projected edges followed so far)
     * with its kept shapes settled: judged on the points as they now lie, so a
     * sketch a followed point makes cross itself is lost too (hunt A, 2026-11-04:
     * judged before the points followed, it kept nothing and its extrude failed).
     */
    const keepLost = async (doc: DesignDocument): Promise<DesignDocument> => {
      const next: Record<string, KeptShape> = {};
      for (const f of doc.timeline.features) {
        if (!isSketchExtrude(f)) continue;
        const sketch = f.intent.parameters.sketch as string;
        if (await makesOutline(kernel, doc, sketch, regionOf(f))) continue;
        const had = keptOf(after, f);
        const was = contentOf(before, sketch);
        if (had !== undefined) next[f.id] = had;
        else if (was !== undefined && (await makesOutline(kernel, before, sketch, regionOf(f)))) {
          const item = beforeItems.get(sketch)!;
          const placement = isFaceSketch(item) ? await wasAt(sketch) : (originPlacement(item) ?? undefined);
          const shape = keptCurves(was);
          next[f.id] = placement ? { ...shape, placement } : shape;
        }
      }
      const { kept: old, ...rest } = doc;
      if (JSON.stringify(old ?? {}) === JSON.stringify(next)) return doc;
      return Object.keys(next).length === 0 ? rest : { ...rest, kept: next };
    };
    let doc = await keepLost(after);
    const faces = doc.timeline.features.filter((f) => placedOnBodies(doc, f)).length;
    if (faces === 0) return doc;
    // Held placements and followed points, decided on the document with its kept shapes settled, pass after pass on the
    // design the last pass made, until nothing changes: a sketch held, or a point followed, moves what is built on it, so
    // a sketch on that (and its points) is placed right only on the next pass (hunt 26g: one pass placed them on the
    // body built at the held sketch's first-drawn frame). Each pass settles one more sketch of a chain, so at most one
    // per face sketch, and a last to see nothing change. The kept shapes are decided again on each pass's design.
    for (let pass = 0; pass <= faces; pass++) {
      const now = await placed(doc);
      let changed = false;
      const sketches: Sketch[] = [];
      for (const content of doc.sketches) {
        const r = now[content.id];
        if (content.face === undefined || r?.status !== "built") {
          // 27c: a sketch on an origin plane with pinned points follows them too.
          const followed = content.face === undefined ? followedSketch(content, r) : content;
          changed ||= followed !== content;
          sketches.push(followed);
          continue;
        }
        const { held, ...face } = content.face;
        let keep = held;
        // 35f1e: a sketch on a piece of its split face is placed there, so it holds nothing.
        if (r.plane === undefined || r.plane.cause === "plane-split") keep = undefined;
        else if (held === undefined) keep = (await wasAt(content.id))?.plane;
        changed ||= keep !== held;
        const settled = keep === held ? content : { ...content, face: keep ? { ...face, held: keep } : face };
        // Step 26f: each pinned point that found its edge goes where the edge is now; one that didn't stays where it was.
        const followed = followedSketch(settled, r);
        changed ||= followed !== settled;
        sketches.push(followed);
      }
      if (!changed) return doc;
      // Kept shapes again, on the points as they now lie: a followed point can lose a sketch, or find its outline again.
      doc = await keepLost({ ...doc, sketches });
    }
    return doc;
  });
  return own ? settling.finally(() => bodies.close()) : settling;
}

/**
 * What an extrude keeps of a sketch it loses: its points and curves, or
 * from 27d, for a sketch with projections, the curves its outline was made
 * of (`profileCurves`) and the points they are drawn from, each now an
 * ordinary curve of the kept shape (a kept shape follows nothing).
 */
function keptCurves(was: Sketch): KeptShape {
  if (!was.projected) return { points: was.points, curves: was.curves };
  const curves = profileCurves(was);
  const used = new Set(curves.flatMap((c) => (c.kind === "line" ? [c.start, c.end] : c.kind === "circle" ? [c.centre] : [c.start, c.end, c.centre])));
  return { points: was.points.filter((p) => used.has(p.id)), curves };
}

/** Whether a sketch follows a body: points pinned to edges (27c), or edges projected (27d). */
const follows = (content: Sketch | undefined): boolean => content?.pins !== undefined || content?.projected !== undefined;

/** Whether sketch item `f` lies on or follows a body: on a face (26c), or with points pinned to edges (27c) or edges projected (27d). */
export const placedOnBodies = (doc: DesignDocument, f: Feature): boolean => isFaceSketch(f) || (isSketchItem(f) && follows(doc.sketches.find((s) => s.id === f.id)));

/**
 * Every item of `doc` up to its last sketch on a face or with pins,
 * built with nothing suppressed and no marker, without freeing anything:
 * where each face sketch would lie, and each pinned point would be, with
 * everything on (none for a document without one).
 */
async function placeOpen(doc: DesignDocument, cache: BodyCache, kernel: KernelCalls): Promise<Record<string, FeatureResult>> {
  const last = doc.timeline.features.filter((f) => placedOnBodies(doc, f)).at(-1);
  if (last === undefined) return {};
  const features = doc.timeline.features.map((f) => (f.suppressed ? { ...f, suppressed: false } : f));
  return (await buildTimeline({ ...doc, timeline: { features, marker: last.id } }, cache, kernel)).results;
}

/**
 * Rebuilds every feature in order with bodies from `cache`, then frees
 * every body no feature holds. Sketch items build no body; a solid
 * feature's result is its handle or why it has none.
 */
export async function rebuildTimeline(doc: DesignDocument, cache: BodyCache, calls: KernelCalls, slow?: SlowItems): Promise<TimelineBuild> {
  return cache.using(async () => {
    const build = await buildTimeline(doc, cache, calls, slow);
    await cache.keepOnly(handlesOf(build));
    return build;
  });
}

/** The bodies a rebuild holds: each body as built, and those the Moves hold as they were before them. */
const handlesOf = (build: TimelineBuild): BodyHandle[] => [
  ...Object.values(build.bodies).map((b) => b.handle),
  ...Object.values(build.results).flatMap((r) => (r.status === "built" || r.status === "failed" ? (r.holds ?? []) : [])),
];

/** `rebuildTimeline` without freeing anything: every result, its bodies in `cache` with whatever else is there. */
async function buildTimeline(doc: DesignDocument, cache: BodyCache, calls: KernelCalls, slow?: SlowItems): Promise<TimelineBuild> {
  const kernel = outlinesAtOnce(calls, [doc]);
  const index = indexOf(doc);
  // 35d4: an item that took too long is failed below without asking the kernel, so nothing of it is asked ahead either.
  const skipped = new Set(slow ? doc.timeline.features.filter((f) => slow.has(doc, f)) : []);
  const aheadSlow = bodiesAtOnce(doc, cache, kernel, index, skipped);
  // No prototype: every id is an entry, even one named like an object's own (results["__proto__"], re-check N1).
  const results: Record<string, FeatureResult> = Object.create(null);
  const bodies: Bodies = Object.create(null);
  const { features, marker } = doc.timeline;
  let rolled = marker === "start";
  for (const f of features) {
    if (rolled) results[f.id] = { status: "rolled-back" };
    else if (f.suppressed) results[f.id] = { status: "suppressed" };
    else if (skipped.has(f)) results[f.id] = { status: "failed", cause: "timed-out", message: tookTooLong(f.provenance.self.label) };
    else if (aheadSlow.has(f)) {
      // Its body, asked ahead, took too long while an item before it was built: asked again it would stop the fresh kernel too.
      slow?.note(doc, f);
      results[f.id] = { status: "failed", cause: "timed-out", message: tookTooLong(f.provenance.self.label) };
    } else {
      const r = await buildFeature(doc, f, results, bodies, cache, kernel, index);
      if (r.status === "failed" && r.cause === "timed-out") slow?.note(doc, f);
      results[f.id] = r;
    }
    if (marker === f.id) rolled = true;
  }
  return { order: features.map((f) => f.id), results, bodies };
}

const words = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Asks the kernel for every body the loop below will build, at once and
 * in timeline order, without waiting: built one after another, each waited
 * a round trip, so a big file took minutes (security audit S2). Only the
 * items that build (`buildingItems`) with a spec that reads are asked, the
 * very bodies `buildFeature` asks for, so nothing extra is built; the loop
 * then finds each one asked or answered (`BodyCache.body`). A refusal is
 * read there, with its words. Returns the items whose ask took too long
 * (35d4), filled as the answers come: such an ask is gone from the cache
 * by the time the loop reaches its item, and asked again would run on the
 * fresh kernel, as long.
 */
function bodiesAtOnce(doc: DesignDocument, cache: BodyCache, kernel: KernelCalls, index: DocIndex, skipped: ReadonlySet<Feature>): Set<Feature> {
  const slow = new Set<Feature>();
  const building = buildingItems(doc);
  for (const f of doc.timeline.features) {
    if (!ownShape(f) || !building.has(f) || skipped.has(f)) continue;
    // A sketch on a face is placed on its face as built, and a pinned point (27c) follows its body, so its extrude waits for the loop.
    const on = isSketchExtrude(f) ? index.items.get(f.intent.parameters.sketch as string) : undefined;
    if (on !== undefined && (isFaceSketch(on) || follows(index.sketches.get(on.id)))) continue;
    const ask = isSketchExtrude(f)
      ? extrudeSpec(kernel, doc, f, index, on && originPlacement(on)).then((made) => ("status" in made ? undefined : cache.body(made.spec)))
      : Promise.resolve().then(() => cache.body(specOf(doc, f)));
    ask.catch((e) => void (timedOut(e) && slow.add(f)));
  }
  return slow;
}

/** Where a sketch on an origin plane lies; null for XY, where an extrude is built as before 26c, with no frame. */
const originPlacement = (item: Feature): SketchPlacement | null => (item.intent.parameters.plane === "XY" ? null : { plane: planeOf(item.intent.parameters.plane as SketchPlane), side: 1 });

const XY_PLACEMENT: SketchPlacement = { plane: planeOf("XY"), side: 1 };

/**
 * A sketch item's result: where it lies. On an origin plane, that plane.
 * On a face (rule 8): greyed while the face's feature is suppressed or
 * greyed (Q3); else the face its name finds on that feature's body, as
 * built just before, with the frame drawn carried by the Moves since
 * (35e2h) and turned onto it (`frameNow`);
 * else held (the placement kept by `settleKept`, or the frame as drawn
 * when a file has none) with "plane lost" (no face of that name, the
 * feature gone or not built, or the face no longer flat) or "plane
 * ambiguous" (two or more faces would have the name; never one of them).
 * From 27c, on any plane, greyed too while a feature a pin names is (rule
 * 13, after the face's own; from 27d a projection's too), and placed, its
 * pinned points and projections followed (`follow`); held, they are not judged (the plane's warning says it
 * all, as the naming model's rule 10).
 */
async function placeSketch(f: Feature, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache, index: DocIndex, kernel: KernelCalls): Promise<FeatureResult> {
  const content = index.sketches.get(f.id)!;
  const featureId = isFaceSketch(f) ? faceFeature(f.intent.parameters.plane as string)! : null;
  // Q3 and rule 13: the face's feature first, then each a pin names, then each a projection names (27d), in order.
  for (const id of sketchInputs(f, content)) {
    const on = done[id];
    if (on?.status === "suppressed") return { status: "greyed", by: id };
    if (on?.status === "greyed") return { status: "greyed", by: on.by };
  }
  if (featureId === null) {
    const placement = originPlacement(f) ?? XY_PLACEMENT;
    return { status: "built", placement, ...(await follow(f, index, done, bodies, cache, placement.plane, null, kernel)) };
  }
  const plane = f.intent.parameters.plane as string;
  const p = content.face!;
  let cause: PlaneWarning["cause"] = "plane-lost";
  const place = async (on: BuiltBody, view: BodyView, face: number, split: boolean, whole = false): Promise<FeatureResult> => {
    // 35e2h: carried first by what the Moves before it did to the body since the sketch was drawn (not known before 35e2h: not carried).
    const carry = p.body === undefined ? null : carried(p.body, frameOfFace(on, face) ?? undefined);
    const outward = view.face_normals[face]!;
    const placement = { plane: frameNow(squared(p.frame)!, outward, view.face_centroids[face], carry), side: p.side };
    const warn = split ? { plane: { cause: "plane-split" as const, face: plane, message: planeWords("plane-split", f.provenance.self.label, whole) } } : {};
    return { status: "built", placement, ...warn, ...(await follow(f, index, done, bodies, cache, placement.plane, featureId, kernel)) };
  };
  // SL #430: a reference made on a piece (it holds a tag) is read by rule 3 even when no Combine is built now (the one
  // that split its face suppressed, or no longer touching): found on the face whole again, with a warning when that face
  // has neither its tag nor its origin, as while one is. Read as a plain name it was placed silently.
  if (Object.values(bodies).some((b) => b.named !== undefined) || readDesignReference(faceReference(plane))?.tag !== undefined) {
    // 35f1e, rule 3: once a Combine built, the face is found by its name on every body built so far: the one face carrying
    // it, the piece with its tag, or (made on a whole face now split) the piece holding the origin it was drawn with,
    // else the largest, with a warning; two alike are never guessed between. The made order is not read here (0).
    const ids = Object.keys(bodies);
    const list = await Promise.all(ids.map((id) => namedOf(id, bodies[id], cache, 0)));
    const r = readDesignReference(faceReference(plane))!;
    const found = resolveFaceName(list, designNames(list), { name: `face:${r.featureId}/${r.part}`, ...(r.tag && { tag: r.tag }), origin: p.frame.origin });
    if ("body" in found && list[found.body].view.face_normals[found.index]) return place(bodies[ids[found.body]], list[found.body].view, found.index, found.warning === "split" || found.warning === "whole", found.warning === "whole");
    if ("ambiguous" in found) cause = "plane-ambiguous";
    // A name two faces of its own plain body would share carries on neither (naming.ts): ambiguous, as before a Combine.
    const own = bodies[bodyIdOf(featureId)];
    if ("lost" in found && own !== undefined && own.named === undefined && sharedBy(faceReference(plane), namesOfBody(own, await cache.view(own.handle))) > 1) cause = "plane-ambiguous";
  } else {
    const on = done[featureId]?.status === "built" ? bodies[bodyIdOf(featureId)] : undefined;
    if (on !== undefined) {
      const view = await cache.view(on.handle);
      const names = namesOfBody(on, view);
      const ref = faceReference(plane);
      const face = resolveReference(ref, names);
      if (face !== null && view.face_normals[face]) return place(on, view, face, false);
      if (sharedBy(ref, names) > 1) cause = "plane-ambiguous";
    }
  }
  return { status: "built", placement: { plane: squared(p.held ?? p.frame)!, side: p.side }, plane: { cause, face: plane, message: planeWords(cause, f.provenance.self.label) } };
}

/**
 * Sketch `content` with each of its pinned points where `r` (its result in
 * a rebuild) found it (26f), and each projection that found its edge where
 * that edge is seen now, a circle's radius too (27d); `content` itself
 * when nothing moved.
 */
export function followedSketch(content: Sketch, r: FeatureResult | undefined): Sketch {
  if (r?.status !== "built" || (!r.pinned && !r.projected)) return content;
  return movedTo(content, [...(r.pinned ?? []), ...(r.projected ?? []).flatMap((q) => q.points), ...(r.solved ?? [])], (r.projected ?? []).flatMap((q) => (q.radius === undefined ? [] : [{ projection: q.id, radius: q.radius }])));
}

/** `content` with these points at these places and these projected circles at these radii; `content` itself when none changes. */
function movedTo(content: Sketch, points: readonly { point: string; at: SketchXY }[], radii: readonly { projection: string; radius: number }[]): Sketch {
  const to = new Map(points.map((p) => [p.point, p.at]));
  const made = new Map((content.projected ?? []).map((q) => [q.id, q.made]));
  const r = new Map(radii.flatMap((x) => (made.has(x.projection) ? [[made.get(x.projection)!, x.radius] as const] : [])));
  const moves = content.points.some((p) => to.has(p.id) && (to.get(p.id)![0] !== p.x || to.get(p.id)![1] !== p.y));
  const grows = content.curves.some((c) => c.kind === "circle" && r.has(c.id) && r.get(c.id) !== c.radius);
  if (!moves && !grows) return content;
  return {
    ...content,
    points: moves ? content.points.map((p) => (to.has(p.id) ? { ...p, x: to.get(p.id)![0], y: to.get(p.id)![1] } : p)) : content.points,
    curves: grows ? content.curves.map((c) => (c.kind === "circle" && r.has(c.id) ? { ...c, radius: r.get(c.id)! } : c)) : content.curves,
  };
}

/**
 * `doc` with every pinned point where `build` (a rebuild of `doc`) found
 * it (26f), or `doc` itself when none moved: what the app takes into the
 * edit's undo step once the edit has rebuilt, so the sketch is drawn, and
 * a point whose edge goes later held, where the point followed to.
 */
export function followedDoc(doc: DesignDocument, build: TimelineBuild): DesignDocument {
  let moved = false;
  const sketches = doc.sketches.map((s) => {
    const next = followedSketch(s, build.results[s.id]);
    moved ||= next !== s;
    return next;
  });
  return moved ? { ...doc, sketches } : doc;
}

/**
 * A sketch's pinned points on their bodies as built now (step 26f, Q4; any
 * earlier body's from 27c, rule 11): each found one where its vertex or
 * edge is now, seen along the sketch's normal through `plane` (`pinned`;
 * the sketch's content in `index` takes those places, so the extrude built
 * from it uses them), each one not found left where it was, counted in a
 * warning ("point-lost" when any lost its edge, else "point-ambiguous"). A
 * pin's body is that of its feature (`SketchPin.feature`, or left out
 * `face`, the sketch's face's feature, null on an origin plane) in `done`:
 * none (deleted, failed or not built) loses the point. Nothing for a
 * sketch without pins.
 */
async function follow(f: Feature, index: DocIndex, done: Record<string, FeatureResult>, built: Bodies, cache: BodyCache, plane: Plane, face: string | null, kernel: KernelCalls): Promise<Partial<Extract<FeatureResult, { status: "built" }>>> {
  const content = index.sketches.get(f.id)!;
  if (!follows(content)) return {};
  type Seen = { key: string; view: BodyView; names: BodyNames };
  const bodies = new Map<string, Seen | null>();
  const bodyOf = async (id: string) => {
    if (!bodies.has(id)) {
      const b = done[id]?.status === "built" ? built[bodyIdOf(id)] : undefined;
      const view = b && (await cache.view(b.handle));
      bodies.set(id, b && view ? { key: id, view, names: namesOfBody(b, view) } : null);
    }
    return bodies.get(id)!;
  };
  // 35f1f2b (design-edges.ts): a pin or projection on a Combine's result holds rule 5's name, found over every body
  // built so far, as the screen names them, on whichever body has it now; its item (the Combine) must have built.
  let design: { ids: string[]; names: DesignNames; seen: Map<number, Seen> } | undefined;
  const designBody = async (feature: string, name: string): Promise<{ body: Seen; name: string } | { cause: "point-lost" | "point-ambiguous" }> => {
    if (done[feature]?.status !== "built") return { cause: "point-lost" };
    if (design === undefined) {
      const ids = Object.keys(built);
      const list = await Promise.all(ids.map((k) => namedOf(k, built[k], cache, 0)));
      const names = designNames(list);
      design = { ids, names, seen: new Map(list.map((n, k) => [k, { key: `${DESIGN_EDGE}${k}`, view: n.view, names: withHeldEdges(namesOfBody(built[ids[k]], n.view), names, k) }])) };
    }
    const now = pinNameNow(name, design.names);
    return "cause" in now ? now : { body: design.seen.get(now.body)!, name: now.name };
  };
  const pinned: { point: string; at: SketchXY }[] = [];
  const held = { "point-lost": 0, "point-ambiguous": 0 };
  for (const pin of content.pins ?? []) {
    const feature = pin.feature ?? face;
    let now: PinNow;
    if (feature !== null && isHeldDesignName(pin.name)) {
      const on = await designBody(feature, pin.name);
      now = "cause" in on ? on : pinNow({ ...pin, name: on.name }, on.body.view, on.body.names, plane);
    } else {
      const body = feature === null ? null : await bodyOf(feature);
      now = body === null ? { cause: "point-lost" } : pinNow(pin, body.view, body.names, plane);
    }
    if ("at" in now) pinned.push({ point: pin.point, at: now.at });
    else held[now.cause]++;
  }
  // Step 27d (rule 12): each projection where its edge is seen now, when it is still seen as what it made; else held.
  const projected: { id: string; points: { point: string; at: SketchXY }[]; radius?: number }[] = [];
  const lost: { id: string; cause: HeldCause }[] = [];
  const cornersOf = new Map<string, (string | null)[]>();
  for (const q of content.projected ?? []) {
    let body: Seen | null;
    let found: { edge: number } | { cause: HeldCause };
    if (isHeldDesignName(q.edge)) {
      const on = await designBody(q.feature, q.edge);
      body = "cause" in on ? null : on.body;
      found = "cause" in on ? { cause: on.cause === "point-lost" ? "projection-lost" : "projection-ambiguous" } : edgeNamed(on.body.names, on.body.view.edges, on.name);
    } else {
      body = await bodyOf(q.feature);
      found = body === null ? ({ cause: "projection-lost" } as const) : edgeNamed(body.names, body.view.edges, q.edge);
    }
    if ("cause" in found) {
      lost.push({ id: q.id, cause: found.cause });
      continue;
    }
    if (!cornersOf.has(body!.key)) cornersOf.set(body!.key, vertexNames(body!.view, body!.names).vertices);
    const corners = cornersOf.get(body!.key)!;
    const shape = edgeShape(body!.view, found.edge, plane, corners);
    if ("refused" in shape || shape.kind !== madeKind(content, q)) {
      lost.push({ id: q.id, cause: "projection-changed" });
      continue;
    }
    projected.push({ id: q.id, ...placesOf(content, q, shape, cornerOrder(body!.view, found.edge, corners) !== null) });
  }
  const label = f.provenance.self.label;
  const followed = movedTo(content, [...pinned, ...projected.flatMap((q) => q.points)], projected.flatMap((q) => (q.radius === undefined ? [] : [{ projection: q.id, radius: q.radius }])));
  // Step 47d4: a sketch with constraints or arcs is solved again when a followed point moved (an arc through it is off its
  // circle now; the solver bug hunt, 2026-11-06: an arc with no constraint in the sketch was left off its circle, unsaid).
  const again = followed !== content && (content.constraints.length > 0 || content.curves.some((c) => c.kind === "arc")) ? await solvedAgain(kernel, followed, label) : null;
  const settled = again !== null && "solved" in again ? movedTo(followed, again.solved, []) : followed;
  if (settled !== content) index.sketches.set(f.id, settled);
  const n = held["point-lost"] + held["point-ambiguous"];
  const words = (["point-lost", "point-ambiguous"] as const).filter((c) => held[c] > 0).map((c) => pointWords(c, held[c], label));
  return {
    ...(content.pins ? { pinned } : {}),
    ...(n > 0 ? { points: { cause: held["point-lost"] > 0 ? "point-lost" : "point-ambiguous", points: n, message: words.join(". ") } } : {}),
    ...(content.projected ? { projected } : {}),
    ...(lost.length > 0 ? { projections: projectionWords(lost, content, label) } : {}),
    ...(again === null ? {} : "solved" in again ? (again.solved.length > 0 ? { solved: again.solved } : {}) : { constraints: { message: again.message } }),
  };
}

/** Why a sketch's constraints can't hold where its followed points are now (47d4), `label` the sketch's name. */
export const constraintsWords = (label: string, why: string): string => `${label}'s constraints can't all hold where its points on the body are now (${why}), so only the points on the body moved`;

/**
 * Sketch `followed` (its followed points where the body put them) solved
 * with them fixed (constraints.ts `solverRequest`): the other points the
 * solve moved and where to, or why its constraints can't hold there (a
 * conflict, a refusal, a line or arc shrunk below MIN_FEATURE, or the
 * solver failing or taking too long).
 */
async function solvedAgain(kernel: KernelCalls, followed: Sketch, label: string): Promise<{ solved: { point: string; at: SketchXY }[] } | { message: string }> {
  const request = solverRequest(followed);
  let answer: ReturnType<typeof readAnswer>;
  try {
    answer = readAnswer(await kernel.call("solve_sketch", request.text));
  } catch (e) {
    // Too slow, or the kernel failed: the sketch is built with its followed points as they are, and says so.
    return { message: constraintsWords(label, `the solver failed: ${e instanceof Error ? e.message : String(e)}`) };
  }
  if (answer.result === "refused") return { message: constraintsWords(label, `the solver refused it: ${answer.message}`) };
  if (answer.result === "conflict") return { message: constraintsWords(label, "they fight there") };
  const at = solvedPoints(followed, request, answer.points);
  const tiny = shrunk(followed, at);
  if (tiny !== null) return { message: constraintsWords(label, `${curveWord(followed, tiny, "a")} would shrink below the smallest size`) };
  return { solved: followed.points.flatMap((p) => {
    const [x, y] = at.get(p.id)!;
    return x === p.x && y === p.y ? [] : [{ point: p.id, at: [x, y] as SketchXY }];
  }) };
}

async function buildFeature(doc: DesignDocument, f: Feature, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache, kernel: KernelCalls, index: DocIndex): Promise<FeatureResult> {
  // A solid item's one body (35eb: by its body id, `bodyIdOf`), held in `bodies`, and its result naming it.
  const made = (body: Omit<BuiltBody, "feature">, rest: Partial<Extract<FeatureResult, { status: "built" }>> = {}): FeatureResult => {
    const id = bodyIdOf(f.id);
    bodies[id] = { feature: f.id, ...body };
    return { status: "built", bodies: [id], ...rest };
  };
  try {
    if (isSketchItem(f)) return await placeSketch(f, done, bodies, cache, index, kernel);
    if (isMoveItem(f)) return await moveBodies(f, done, bodies, cache);
    if (isCombineItem(f)) return await combineRun(doc, f, done, bodies, cache);
    if (isDuplicateItem(f)) return await copyBody(f, done, bodies, cache);
    if (!isSketchExtrude(f)) {
      const spec = specOf(doc, f);
      return made({ handle: await cache.body(spec), spec });
    }
    const sketchId = f.intent.parameters.sketch as string;
    const item = index.items.get(sketchId);
    const input = done[sketchId];
    // Q3, unified in 26e: built on a suppressed sketch, or on one greyed, it is greyed too, with no warning.
    if (item !== undefined && input?.status === "suppressed") return { status: "greyed", by: sketchId };
    if (item !== undefined && input?.status === "greyed") return { status: "greyed", by: input.by };
    if (item !== undefined && input?.status !== "built") return { status: "failed", cause: "failed-input", input: sketchId, message: `${item.provenance.self.label} is not built` };
    // A face sketch's placement is the rebuild's; an origin plane's, extrudeSpec's own.
    const placed = item !== undefined && isFaceSketch(item) && input?.status === "built" ? input.placement : undefined;
    const spec = await extrudeSpec(kernel, doc, f, index, placed);
    if ("status" in spec) return spec;
    // 35f1e: a sketch placed on a piece of its split face is not held, so its extrude's source is not lost.
    const lost = input?.status === "built" && input.plane?.cause !== "plane-split" ? input.plane : undefined;
    const source = lost && { ...lost, sketch: sketchId, message: `${f.provenance.self.label}'s source is lost: ${item!.provenance.self.label}'s plane is ${lost.cause === "plane-lost" ? "lost" : "ambiguous"}, so it stays where it was` };
    const rest = { ...(spec.warning ? { warning: spec.warning } : {}), ...(source ? { source } : {}) };
    const self = { handle: await cache.body(spec.spec), spec: spec.spec, curves: spec.curves };
    if (isOperationExtrude(f)) return await operationRun(doc, f, self, rest, done, bodies, cache);
    return made(self, rest);
  } catch (e) {
    if (timedOut(e)) return { status: "failed", cause: "timed-out", message: tookTooLong(f.provenance.self.label) };
    return { status: "failed", cause: "error", message: words(e) };
  }
}

/**
 * A Move's result (step 35e2): greyed while an item whose body it moves
 * is suppressed or greyed (Q3), failed naming the first that isn't built;
 * else every body it moves is built moved (`movedSpec`; a Combine's
 * result, which has no spec, by the kernel's body_move, 35f1f2a) and held in
 * `bodies` under its own id (35eb) in place of the body as it was, so
 * everything after the Move (a sketch on its face, the view, the STL)
 * finds it where the Move put it. All or none: a body the kernel refuses
 * to move (out past model space) leaves every body where it was and fails
 * the Move with the kernel's words. The Move holds the bodies as they
 * were (`holds`), so the next rebuild finds them built. Its bodies are
 * stored by body id (`movedBodies`, Design data version 6, 35ec), each
 * made by an item it depends on (`bodyItem`).
 */
async function moveBodies(f: Feature, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  for (const id of f.dependsOn) {
    const r = done[id];
    if (r?.status === "suppressed") return { status: "greyed", by: id };
    if (r?.status === "greyed") return { status: "greyed", by: r.by };
  }
  const label = (id: string) => f.provenance.from.find((x) => x.id === id)?.label ?? id;
  const motions = moveMotions(moveValues(f));
  const from: [string, BuiltBody][] = [];
  for (const body of movedBodies(f)) {
    const id = bodyItem(body)!;
    const r = done[id];
    const b = r?.status === "built" ? bodies[body] : undefined;
    if (r === undefined) return { status: "failed", cause: "deleted-input", input: id, message: `${label(id)} was deleted, so ${f.provenance.self.label} has nothing to move` };
    if (r?.status !== "built") return { status: "failed", cause: "failed-input", input: id, message: `${label(id)} is not built, so ${f.provenance.self.label} can't move it` };
    // Built, but gone from here on: an earlier Combine or extrude used it up, or left no such piece (as `booleanSteps` says it; hunts 11-06, 11-08).
    if (b === undefined) return { status: "failed", cause: "failed-input", input: id, message: `${f.provenance.self.label} can't move ${body === bodyIdOf(id) ? label(id) : "a piece"}: an earlier Combine or extrude used it up or left no such piece` };
    from.push([body, b]);
  }
  // Built only once every body is there, so a Move that fails builds nothing.
  // A Combine's result has no spec (35f1f2a): the kernel moves the body it keeps (body_move), and each face's frame is
  // carried on from where its input body's was, so a sketch on it goes where the face went. A refusal (out past model
  // space) fails the Move in the kernel's words, as a refused spec does.
  const moved: [string, BuiltBody][] = [];
  for (const [id, b] of from) {
    if (b.spec !== null) {
      const spec = movedSpec(b.spec, motions);
      moved.push([id, { ...b, spec, handle: spec === b.spec ? b.handle : await cache.body(spec) }]);
      continue;
    }
    if (motions.length === 0) {
      moved.push([id, b]);
      continue;
    }
    const handle = await cache.moved(b.handle, motions);
    // Its faces by kernel index are its names' (`named`, one entry a face): a move keeps every face and its order.
    const frames = (b.named?.faces ?? []).map((_, k) => movedFrame(b.frames?.[k] ?? null, motions));
    moved.push([id, { ...b, handle, frames }]);
  }
  const holds = from.map(([, b]) => b.handle);
  for (const [id, b] of moved) bodies[id] = b;
  return { status: "built", holds };
}

/**
 * A Duplicate's result (step 35e2): greyed while the item that made its
 * body is suppressed or greyed (Q3); failed naming it when it was deleted
 * or isn't built, or when an earlier Combine used the body up; else its
 * copy, the body as it is here (moved by the Moves before, sized as its
 * item is now), held under the Duplicate's own body id with the Duplicate
 * as its feature, so its faces are named by the Duplicate. The kernel body
 * is the source's own (a body is never changed, only built anew), so a copy
 * costs nothing to build; a Combine's result is copied so too (35f1f2c),
 * its faces named by the Duplicate from its Combine's names. A Mirror (Mirror body) is built
 * anew, the source's spec mirrored across its plane (duplicate.ts
 * `mirrorMotion`), its faces named as the source's.
 */
async function copyBody(f: Feature, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  const [maker] = f.dependsOn;
  const r = done[maker];
  if (r?.status === "suppressed") return { status: "greyed", by: maker };
  if (r?.status === "greyed") return { status: "greyed", by: r.by };
  const label = f.provenance.self.label;
  const name = f.provenance.from.find((x) => x.id === maker)?.label ?? maker;
  if (r === undefined) return { status: "failed", cause: "deleted-input", input: maker, message: `${name} was deleted, so ${label} has nothing to copy` };
  if (r.status !== "built") return { status: "failed", cause: "failed-input", input: maker, message: `${name} is not built, so ${label} can't copy it` };
  const b = bodies[duplicatedBody(f)];
  if (b === undefined) return { status: "failed", cause: "failed-input", input: maker, message: `${label} can't copy ${name}: an earlier Combine used it up or left no such piece` };
  const id = bodyIdOf(f.id);
  const plane = mirrorOf(f);
  if (b.spec === null) {
    // 35f1f2c: a Combine's result copied as it is (the same kernel body), or mirrored by the kernel's body_move; its faces the
    // Duplicate's, each keeping its role with the feature it came from (built-body.ts `copiedFaceName`), in the same order
    // (a move or a mirror keeps every face and its order), each frame carried across the plane with it.
    const motions = plane === undefined ? [] : [mirrorMotion(plane)];
    const handle = motions.length === 0 ? b.handle : await cache.moved(b.handle, motions);
    const frames = motions.length === 0 ? b.frames : b.named!.faces.map((_, k) => movedFrame(b.frames?.[k] ?? null, motions));
    bodies[id] = { feature: f.id, handle, spec: null, named: copiedNames(b.named!, f.id), ...(frames && { frames }) };
    return { status: "built", bodies: [id] };
  }
  const spec = plane === undefined ? b.spec : movedSpec(b.spec, [mirrorMotion(plane)]);
  bodies[id] = { feature: f.id, handle: spec === b.spec ? b.handle : await cache.body(spec), spec, ...(b.curves ? { curves: b.curves } : {}) };
  return { status: "built", bodies: [id] };
}

/** Combine's operations as the kernel names them. */
const KERNEL_OP: Record<string, BooleanOp> = { join: "union", cut: "subtract", intersect: "intersect" };

/** A body as boolean-names.ts names it (built-body.ts `namedBody`), its view asked of the cache. */
const namedOf = async (id: string, b: BuiltBody, cache: BodyCache, place: number): Promise<NamedBody> => namedBody(id, b, await cache.view(b.handle), place);

/**
 * A Combine's result (step 35f1; rules: docs/document-model.md section 8,
 * and the behaviour answers in the kernel repo's booleans plan): greyed
 * while an item whose body it uses is suppressed or greyed (Q3); failed
 * naming the first of its target and tools that was deleted, isn't built
 * or is gone (used up by an earlier Combine); else the kernel's boolean of
 * the target with each tool in the order picked, its result named by
 * rule 1 to 4 (`combineNames`): the piece keeping the target's id takes
 * its place, the others are `body:<combine>/piece:<k>`, and the tools are
 * gone from here on unless kept. All or none: a refusal (in the kernel's
 * words, with where a result would touch itself) or a result with nothing
 * left changes no body. The inputs are held (`holds`), so the next rebuild
 * finds them built.
 */
async function combineRun(doc: DesignDocument, f: Feature, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  for (const id of f.dependsOn) {
    const r = done[id];
    if (r?.status === "suppressed") return { status: "greyed", by: id };
    if (r?.status === "greyed") return { status: "greyed", by: r.by };
  }
  const { target, tools, operation, keepTools } = combineBodies(f);
  return await booleanSteps(doc, f, [{ target, tools, keepTools }], operation, "combine", done, bodies, cache);
}

/** One boolean of a target body with tools (body ids), in an item's run: the target keeps its id, the tools are used up unless kept. */
interface BooleanStep {
  target: string;
  tools: readonly string[];
  keepTools: boolean;
}

/**
 * Item `f`'s booleans (a Combine's one; an operation extrude's, `operationRun`),
 * in order, each piece not keeping a target's id numbered on from the
 * last: failed naming the first body that was deleted, isn't built or is
 * gone (used up by an earlier item), or with the kernel's refusal, or a
 * result with nothing left, and then no body changes (all or none).
 * `verb` words a body with nothing to work on. The inputs are held.
 */
async function booleanSteps(doc: DesignDocument, f: Feature, steps: readonly BooleanStep[], operation: CombineOperation, verb: string, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  const label = f.provenance.self.label;
  const nameOf = (id: string) => f.provenance.from.find((x) => x.id === id)?.label ?? id;
  const places = new Map(doc.timeline.features.map((x, i) => [x.id, i] as const));
  // Worked on a copy, so a step refused leaves every body as it was.
  const work: Bodies = Object.assign(Object.create(null), bodies);
  const holds: BodyHandle[] = [];
  const made: BodyHandle[] = []; // the bodies of its own an equal pick needed (below)
  const ids: string[] = [];
  let firstPiece = 1;
  // Each piece the data numbered with its faces (hunt 11-06): it stays on the piece with those faces. An operation
  // extrude's too (hunt 11-08: an earlier edit could hand a Move another bar's piece without a word); editing the
  // extrude confirms them, as editing a Combine does (combine.ts `forgetPieces`).
  const remembers = isCombineItem(f) || isOperationExtrude(f);
  // Rule 1 for an Extrude join (docs/document-model.md section 8): each piece holding a body it joins keeps the
  // earliest made one's id, by the item in the id, then the item's own body before its pieces, by number.
  const joins = isOperationExtrude(f) && operation === "join";
  // And its piece holding only the extrude is its own body (version 16), numbered and remembered by its faces as a piece.
  const own = joins ? bodyIdOf(f.id) : undefined;
  const madeKey = (id: string): [number, number] => [places.get(bodyItem(id)!) ?? Infinity, isPiece(id) ? Number(id.slice(id.lastIndexOf(":") + 1)) : 0];
  const remembered = new Map(remembers ? (doc.bodies ?? []).flatMap((b) => (b.faces !== undefined && (isPiece(b.id) || b.id === own) && bodyItem(b.id) === f.id ? [[b.id, b.faces] as const] : [])) : []);
  const pieceFaces: Record<string, string[]> = {};
  // Two of the item's bodies under one id would lose one of them without a word (SL #538 item 1): the numbering below
  // never gives one, and were it ever to, the item fails here and no body changes.
  const clash = (id: string): FeatureResult => ({ status: "failed", cause: "error", message: `${label} can't be made: two of its bodies would both be ${id}, so one would be lost (a fault in SpindleLabs, not in the design)`, ...(made.length > 0 ? { holds: made } : {}) });
  for (const step of steps) {
    const inputs: NamedBody[] = [];
    const built = new Map<BodyHandle, BuiltBody>();
    const joined = joins ? [step.target, ...step.tools].filter((b) => bodyItem(b) !== f.id).sort((a, b) => madeKey(a)[0] - madeKey(b)[0] || madeKey(a)[1] - madeKey(b)[1]) : [];
    for (const body of [step.target, ...step.tools]) {
      const maker = bodyItem(body)!;
      // The item's own body (an operation extrude's, built just before) is no input of an earlier item.
      if (maker !== f.id) {
        const r = done[maker];
        if (r === undefined) return { status: "failed", cause: "deleted-input", input: maker, message: `${nameOf(maker)} was deleted, so ${label} has nothing to ${verb}` };
        if (r.status !== "built") return { status: "failed", cause: "failed-input", input: maker, message: `${nameOf(maker)} is not built, so ${label} can't use it` };
      }
      const b = work[body];
      if (b === undefined) return { status: "failed", cause: "failed-input", input: maker, message: `${label} can't use ${body === bodyIdOf(maker) ? nameOf(maker) : "a piece"}: an earlier Combine or extrude used it up or left no such piece` };
      // Equal bodies share one kernel body (`BodyCache.body`): a second pick of it gets a body of its own, so the
      // kernel sees the bodies the person picked, not one body as its own tool (35f1d, found by the monkey).
      const copies = inputs.filter((x) => x.handle === b.handle).length;
      const own = copies > 0 && b.spec !== null ? { ...b, handle: await cache.body(b.spec, copies) } : b;
      if (own !== b) made.push(own.handle);
      built.set(own.handle, own);
      const named = await namedOf(body, own, cache, places.get(b.feature) ?? places.get(maker)!);
      inputs.push(joined.includes(body) ? { ...named, keepsId: joined.indexOf(body) } : named);
    }
    const [t, ...ts] = inputs;
    const op = KERNEL_OP[operation];
    let result: BooleanResult;
    try {
      result = await cache.boolean(t.handle, ts.map((x) => x.handle), op);
      // Equal inputs give the cached answer: when an earlier Combine already holds it (two equal boxes each cut by
      // one kept tool), this one asks for a body of its own, so no two bodies share one kernel body (hunt 11-06).
      const taken = new Set(Object.values(work).map((b) => b.handle));
      for (let copy = 1; result.bodies.some((h) => taken.has(h)); copy++) result = await cache.boolean(t.handle, ts.map((x) => x.handle), op, copy);
    } catch (e) {
      if (timedOut(e)) throw e;
      if (e instanceof KernelError && (e.kind === "invalid-input" || e.kind === "non-manifold-result" || e.kind === "thin-result")) {
        // Refused, it still holds the bodies it made for an equal pick, so the next rebuild needn't build them again
        // (a body cut by its own Duplicate, then joined with it: SL #360's seed 11).
        return { status: "failed", cause: "error", message: `${label} can't be made: ${e.message}`, ...(e.touches.length > 0 ? { touches: e.touches } : {}), ...(e.thin.length > 0 ? { thin: e.thin } : {}), ...(made.length > 0 ? { holds: made } : {}) };
      }
      throw e;
    }
    const views = await Promise.all(result.bodies.map((h) => cache.view(h)));
    // Numbered here by rank alone, on from the last boolean's; the remembered pieces are found once all are made (below).
    const named = combineNames(f.id, op, t, ts, result, views, firstPiece, undefined, own);
    if ("failed" in named) return { status: "failed", cause: "error", message: `${label} can't be made: ${named.failed}`, ...(made.length > 0 ? { holds: made } : {}) };
    const targetFeature = work[step.target].feature;
    // Each input's item, for a piece keeping its id (an Extrude join's other bodies, hunt 11-08).
    const featureOf = new Map([step.target, ...step.tools].map((b) => [b, work[b].feature] as const));
    for (const tool of step.keepTools ? [] : step.tools) delete work[tool];
    delete work[step.target];
    const twice = named.bodies.find((nb, i) => nb.id in work || named.bodies.findIndex((x) => x.id === nb.id) !== i);
    if (twice !== undefined) return clash(twice.id);
    for (const nb of named.bodies) {
      const frames = framesOfResult(result.history[result.bodies.indexOf(nb.handle)], built);
      work[nb.id] = { feature: nb.id === step.target ? targetFeature : (featureOf.get(nb.id) ?? f.id), handle: nb.handle, spec: null, named: { faces: nb.faces, made: nb.made }, by: f.id, ...(frames && { frames }) };
      if (!ids.includes(nb.id)) ids.push(nb.id);
      if (!featureOf.has(nb.id) || nb.id === own) {
        firstPiece++;
        if (remembers) pieceFaces[nb.id] = shownFaces(nb.faces);
      }
    }
    holds.push(...inputs.map((x) => x.handle));
  }
  // One numbering for the whole item (docs/document-model.md section 8, "one feature, one renaming"): each remembered
  // piece stays on the piece with its faces, whichever boolean made it, and the others take the numbers no piece has.
  // Numbered a boolean at a time, a new chunk of one body took the number a chunk of another body was remembered with,
  // and one overwrote the other: a whole chunk gone from the design, by the order the bodies were picked in.
  const numbered = Object.keys(pieceFaces);
  const settled = pieceIds(f.id, numbered.map((id) => pieceFaces[id]), remembered, own);
  const pieces = numbered.map((id) => ({ body: work[id], faces: pieceFaces[id] }));
  for (const id of numbered) {
    delete work[id];
    delete pieceFaces[id];
  }
  for (const [i, { body, faces }] of pieces.entries()) {
    if (settled.ids[i] in work || settled.ids[i] in pieceFaces) return clash(settled.ids[i]);
    if (body !== undefined) work[settled.ids[i]] = body;
    pieceFaces[settled.ids[i]] = faces;
  }
  const renumbered = settled.renumbered;
  for (const [i, id] of ids.entries()) if (numbered.includes(id)) ids[i] = settled.ids[numbered.indexOf(id)];
  for (const id of Object.keys(bodies)) if (!(id in work)) delete bodies[id];
  Object.assign(bodies, work);
  const kept = ids.filter((id) => id in work);
  const faces = Object.fromEntries(Object.entries(pieceFaces).filter(([id]) => id in work));
  // By the numbers the browser shows them with ("Body 5"); a remembered piece always has one.
  const shown = renumbered.map((id) => `Body ${doc.bodies!.find((b) => b.id === id)!.number}`);
  const warn = shown.length === 0 ? {} : { pieces: { renumbered, message: `${label}'s pieces changed since they were numbered, so ${shown.join(" and ")} may now be ${shown.length === 1 ? "another piece" : "other pieces"}: check the items that use ${shown.length === 1 ? "it" : "them"}, then edit ${label} to keep its pieces as they are now` } };
  return { status: "built", bodies: kept, holds, ...(Object.keys(faces).length > 0 ? { pieceFaces: faces } : {}), ...warn };
}

/** Each piece the build made, by id, with the shown names of its faces as its item made them (hunt 11-06). */
export function builtPieceFaces(build: Pick<TimelineBuild, "results">): Map<string, string[]> {
  return new Map(Object.values(build.results).flatMap((r) => (r.status === "built" && r.pieceFaces ? Object.entries(r.pieceFaces) : [])));
}

/**
 * An extrude with an operation (Design data version 10), its own body
 * `self` just built: greyed while an item whose body it uses is suppressed
 * or greyed; else, as Fusion's Extrude does, Join puts it and the other
 * bodies picked into the first (one boolean), Cut takes it out of each body
 * picked and Intersect keeps what each shares with it (one boolean each,
 * in the order picked), its own body used up at the end. All or none, as
 * a Combine.
 */
async function operationRun(doc: DesignDocument, f: Feature, self: Omit<BuiltBody, "feature">, rest: Partial<Extract<FeatureResult, { status: "built" }>>, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  const { operation, bodies: picked } = extrudeOperation(f)!;
  for (const id of f.dependsOn.slice(1)) {
    const r = done[id];
    if (r?.status === "suppressed") return { status: "greyed", by: id };
    if (r?.status === "greyed") return { status: "greyed", by: r.by };
  }
  const own = bodyIdOf(f.id);
  const steps: BooleanStep[] =
    operation === "join" ? [{ target: picked[0], tools: [...picked.slice(1), own], keepTools: false }] : picked.map((target, i) => ({ target, tools: [own], keepTools: i < picked.length - 1 }));
  bodies[own] = { feature: f.id, ...self };
  const r = await booleanSteps(doc, f, steps, operation, operation === "join" ? "join to" : operation, done, bodies, cache);
  // Refused: its own body is no body of the design (the bodies picked stay as they were).
  if (r.status !== "built") {
    delete bodies[own];
    return r;
  }
  return { ...r, ...rest };
}

/** What an extrude of a sketch is built from, and the warning when that is its kept shape. */
export interface ExtrudeSpec {
  spec: BodySpec;
  curves: CurveIds;
  warning?: KeptWarning;
}

/**
 * An extrude of a sketch's spec by the owner's rule: its sketch's outline
 * now, else its kept shape with a warning, else failed with the cause.
 * Suppression and the marker are the timeline's (`rebuildTimeline`); this
 * is the one place the rule is applied, so Design's view, the Extrude
 * panel and what other workspaces are handed (`featureSpec`) all agree.
 */
export async function extrudeSpec(
  kernel: KernelCalls,
  doc: DesignDocument,
  f: Feature,
  index: DocIndex = indexOf(doc),
  placed?: SketchPlacement | null,
): Promise<ExtrudeSpec | Extract<FeatureResult, { status: "failed" }>> {
  const sketchId = f.intent.parameters.sketch as string;
  const distance = f.intent.parameters.distance as number;
  const flip = f.intent.parameters.flip === true;
  const item = index.items.get(sketchId);
  const region = regionOf(f);
  const lost = (cause: LostCause, message: string, curves: string[]) => keptSpec(keptOf(doc, f), distance, flip, { cause, sketch: sketchId, message, curves }, kernel, region);
  // The extrude's provenance names the sketch it was made from, so a deleted one is still called by its label.
  if (item === undefined) return await lost("deleted-input", `${f.provenance.from.find((r) => r.id === sketchId)?.label ?? sketchId} was deleted`, []);
  const content = index.sketches.get(sketchId)!;
  const out = await outlineOf(kernel, content, region);
  // A curve the kernel refused is named in its own words ("line 1 must be …"), as before 24d2; an outline that doesn't close says whose.
  const name = item.provenance.self.label;
  // A region gone from a sketch that still has others says so; from one that has none, why it has none (a line deleted: "not joined"), as before regions.
  const said = (o: { lost: LostCause; message: string; refused?: true }) =>
    o.refused ? o.message : o.message === REGION_GONE ? `${name} ${REGION_GONE}` : region !== undefined && o.lost === "invalid-outline" ? `${name}'s region can't be extruded: ${refusalReason(o.message)}` : `${name} has no closed outline: ${o.message}`;
  if (!("outline" in out)) return await lost(out.lost, said(out), out.curves);
  // Where the sketch lies: given by the rebuild, an origin plane's, or (asked from outside a rebuild) its face's as the timeline builds it.
  const at = placed !== undefined ? placed : isFaceSketch(item) ? await placementOf(kernel, doc, sketchId) : originPlacement(item);
  return { spec: placedSpec(out.outline, distance, at, flip), curves: idsOf(content) };
}

/**
 * An extrude's spec: on XY (`at` null) as before 26c, with no frame unless
 * flipped; else in the sketch's frame (squared up, face-sketch.ts), going
 * the way the sketch faces (rule 2), the other way when flipped.
 */
function placedSpec(profile: Outline, distance: number, at: SketchPlacement | null, flip: boolean): BodySpec {
  if (at === null) return { extrude: flip ? { profile, distance, flip: true } : { profile, distance } };
  const back = (at.side === -1) !== flip;
  return { extrude: { profile, distance, frame: frameOf(squared(at.plane)!), ...(back ? { flip: true } : {}) } };
}

/**
 * Where a sketch lies in `doc` as its timeline builds up to it (for an
 * extrude asked for outside a rebuild: featureSpec, the Extrude panel's
 * check), built on a cache of its own that is freed after.
 */
async function placementOf(kernel: KernelCalls, doc: DesignDocument, sketchId: string): Promise<SketchPlacement> {
  const cache = new BodyCache(kernel);
  try {
    const r = (await buildTimeline({ ...doc, timeline: { ...doc.timeline, marker: sketchId } }, cache, kernel)).results[sketchId];
    if (r?.status !== "built" || r.placement === undefined) throw new Error(`${sketchId} is not built, so it lies nowhere`);
    return r.placement;
  } finally {
    // Closed, not only cleared: a body the kernel failed to free is tried once more now (T6b), not left for a next use.
    await cache.close();
  }
}

/** An extrude whose sketch is lost: its kept shape with the warning, or failed with the cause when it has none. */
async function keptSpec(kept: KeptShape | undefined, distance: number, flip: boolean, warning: KeptWarning, kernel: KernelCalls, region?: RegionRef): Promise<ExtrudeSpec | Extract<FeatureResult, { status: "failed" }>> {
  if (kept === undefined) return { status: "failed", cause: warning.cause, input: warning.sketch, message: warning.message, curves: warning.curves };
  const out = await outlineOf(kernel, kept, region);
  // A kept shape made an outline when it was kept; one that doesn't (a hand-edited file) fails the extrude with the kernel's words.
  if (!("outline" in out)) return { status: "failed", cause: "error", message: `the kept shape makes no outline: ${out.message}` };
  return { spec: placedSpec(out.outline, distance, kept.placement ?? null, flip), curves: idsOf(kept), warning };
}
