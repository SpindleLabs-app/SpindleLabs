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

import { extrudeSketches, hasMoreProfiles, moreProfiles, profileParts, sameProfile, type ProfileRef } from "./extrude-profiles.ts";
import { contactGroups, mergedOutline } from "./extrude-merge.ts";
import { KERNEL_TOOK_TOO_LONG, KernelError, type BodyHandle, type BodySpec, type BodyView, type BooleanOp, type BooleanResult, type Motion, type KernelTouch, type KernelThin, type Feature, type KernelCalls, type KernelInput, type Outline, type Plane, type SketchXY } from "@fission/core";
import { bodyIdOf, bodyItem, bodyNumbers, buildingItems, isPiece, numberPieces, combineBodies, duplicatedBody, extrudeOperation, isCombineItem, isDuplicateItem, isOperationExtrude, isMoveItem, isSketchExtrude, isSketchItem, keptOf, ownShape, profileSizeRefused, sketchInputs, specOf, type CombineOperation, type DesignDocument, type KeptShape, type Sketch, type SketchPlane } from "./document.ts";
import { carried, faceFeature, faceReference, frameNow, frameOf, isFaceSketch, movedFrame, planeWords, sketchMiddle, squared, type PlaneWarning, type SketchPlacement } from "./face-sketch.ts";
import { pinNow, pointWords, vertexNames, type PinNow, type PointWarning } from "./face-edges.ts";
import type { BodyNames } from "./naming.ts";
import { combineNames, designNames, resolveFaceName, shownFaces, type DesignNames, type FaceNames, type NamedBody } from "./boolean-names.ts";
import { DESIGN_EDGE, isHeldDesignName, pinNameNow, withHeldEdges } from "./design-edges.ts";
import { copiedNames, frameOfFace, framesOfResult, namedBody, namesOfBody, reversedOfResult } from "./built-body.ts";
import { pieceIds } from "./boolean-names.ts";
import { cornerOrder, edgeNamed, edgeShape, madeKind, madePoints, profileCurves, placesOf, projectedOpen, projectionWords, type HeldCause, type ProjectionWarning } from "./projection.ts";
import { changedMove, movedBodies, moveMotions, movedSpec, moveValues } from "./move.ts";
import { mirrorMotion, mirrorOf } from "./duplicate.ts";
import { readDesignReference, resolveReference, sharedBy } from "./references.ts";
import { planeOf, plainOutline, sketchCurves } from "./sketch.ts";
import { curveWord, readAnswer, shrunk, solvedPoints, solverRequest } from "./constraints.ts";
import { cornerTurned, HELD_STILL, turnedOver } from "./point-drag.ts";
import { findRegion, refusalReason, regionCurveIds, regionName, regionNow, regionOutline, regionRef, sameLoop, type RegionRef } from "./regions.ts";
import { joinsInside, leavesNoFace, mayJoinInside, missedTools, missWords, type Miss } from "./misses.ts";

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
      /** A Move's (SL #583 item 2): the pieces it moved that it doesn't hold yet, new pieces of a body it holds; `followedDoc` adds them to it. */
      takes?: string[];
      /** A Combine's or an operation extrude's pieces (35f1) by id, each with the shown names of its faces as the item made them: what the data remembers a piece by when it is first numbered (hunt 11-06). */
      pieceFaces?: Record<string, string[]>;
      /** An item whose numbered pieces no longer have the faces they were numbered with, so a piece number may now be another piece (hunt 11-06): why, and those pieces' ids. */
      pieces?: { message: string; renumbered: string[] };
      /** A Move some of whose bodies are no longer there (SL #506 item 4): it moves the rest, and says which it can't and why; their body ids. */
      missing?: { message: string; bodies: string[] };
      /** A Cut or Join whose tools change nothing (misses.ts; Ben 11 Nov, SL #506 item 5, #521): which, and the row's words. */
      /** `operation` is kept so the words can be said again once the build's new bodies have their numbers (`missesMessage`, SL #677 item 5). */
      misses?: { message: string; list: Miss[]; operation: "cut" | "join" };
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
  const ids = new Set(upTo.flatMap((f) => [f.id, ...(typeof f.intent.parameters.sketch === "string" ? extrudeSketches(f) : [])]));
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
  /** A piece (SL #583 item 2): the body whose boolean it split from (its item's target), so a Move holding that body finds it. */
  from?: string;
  /** An extrude's profile after the first (version 18), counted from 1: its caps are named by it ("end:2"; SL #632 item 2). */
  profile?: number;
  /**
   * SL #583 item 3: by kernel face index, whether each face of a boolean's result is the face its first name comes from
   * turned round (a Cut's wall: the tool's face facing into the hole), carried through later booleans, Moves and
   * copies; left out when none is. A face sketch records it when drawn (`SketchFace.reversed`).
   */
  reversed?: readonly boolean[];
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

/**
 * One boolean step's result bodies as `combineNames` names them (SL #677 item 2), each with what Design keeps of it
 * worked out from the meshes of the step's inputs and answer: its faces with their origins (`withOrigins`), their
 * frames (`framesOfResult`) and which are turned round (`reversedOfResult`). Or the naming's refusal.
 */
export type NamedStep =
  | { bodies: { id: string; handle: BodyHandle; faces: readonly FaceNames[]; made: NamedBody["made"]; frames?: (Plane | null)[]; reversed?: boolean[] }[] }
  | { failed: string };

export class BodyCache {
  /** `hidden`: the kernel holds no display mesh for it (35d4, `showOnly`); a body is built with one. */
  private bodies = new Map<string, { handle: BodyHandle; view?: Promise<BodyView>; hidden?: true }>();
  /** Each kept body's key by its handle, so `view` finds it in one step (security audit S2). */
  private keys = new Map<BodyHandle, string>();
  /** Each boolean's answer by its inputs (`boolean`); its bodies are kept in `bodies` like built ones. */
  private booleans = new Map<string, BooleanResult>();
  /** Each body_move's answer by its input and moves (`moved`, 35f1f2a): the body it moved and the one it made, kept in `bodies` like built ones. */
  private moves = new Map<string, { from: BodyHandle; to: BodyHandle }>();
  /**
   * Each boolean answer's names (`keepNaming`), by what they were worked out from (`namingKey`): an unchanged step
   * named again finds them here instead of asking the kernel to mesh its inputs and answer again. The kernel keeps a
   * mesh only for the bodies on screen (`showOnly`), so every rebuild meshed every earlier Cut's inputs and answer
   * again, about 0.4 s more for each Extrude Cut of a part (SL #677 item 2). Held by the answer itself, so they go
   * when `boolean` lets that answer go, and an answer asked again (a new one) is named again. Only the last names of
   * each answer are kept, so editing a step's other inputs never piles them up.
   */
  private namings = new WeakMap<BooleanResult, { key: string; named: NamedStep }>();
  /** A number for each object `namingKey` names by identity (a Combine's result's names, which `keepNaming` hands out again unchanged). */
  private objects = new WeakMap<object, number>();
  private nextObject = 0;
  /** Bodies asked of the kernel and not answered yet: the same spec asked again waits for the same answer, so asking ahead never builds twice. */
  private building = new Map<string, Promise<BodyHandle>>();
  /** Booleans and moves asked of the kernel and not answered yet (`once`), by their keys. */
  private asking = new Map<string, Promise<unknown>>();
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
   * Keeps `handle` at `at`. A body already kept there that is another one
   * (an answer asked again because one of its pieces was freed) moves to a
   * key of its own, so `freeUnwanted` still frees it: a body leaves the map
   * only by being freed.
   */
  private keep(at: string, handle: BodyHandle): void {
    const old = this.bodies.get(at);
    if (old !== undefined && old.handle !== handle) {
      const moved = `${at}~${old.handle}`;
      this.bodies.set(moved, old);
      this.keys.set(old.handle, moved);
    }
    this.bodies.set(at, { handle });
    this.keys.set(handle, at);
  }

  /**
   * `ask()` once for `key` while it is on its way: the same key asked again
   * meanwhile waits for the same answer (issue #487: two settles asking one
   * Combine's boolean at once each got their own, and the first was never
   * freed).
   */
  private once<T>(key: string, ask: () => Promise<T>): Promise<T> {
    const on = this.asking.get(key);
    if (on !== undefined) return on as Promise<T>;
    const asked: Promise<T> = ask().finally(() => {
      if (this.asking.get(key) === asked) this.asking.delete(key);
    });
    this.asking.set(key, asked);
    return asked;
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
      this.keep(at, handle);
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
    return this.once(key, async () => {
      const result = await this.kernel.call("body_boolean", target, [...tools], op);
      if (this.closed) {
        for (const h of result.bodies) void this.kernel.call("body_free", h).catch(() => {});
        throw new Error(CLOSED);
      }
      result.bodies.forEach((handle, i) => this.keep(`${key}#${i}`, handle));
      this.booleans.set(key, result);
      return result;
    });
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
    return this.once(key, async () => {
      const to = await this.kernel.call("body_move", handle, [...motions]);
      if (this.closed) {
        void this.kernel.call("body_free", to).catch(() => {});
        throw new Error(CLOSED);
      }
      this.keep(key, to);
      this.moves.set(key, { from: handle, to });
      return to;
    });
  }

  /**
   * What a boolean step's names (`NamedStep`) are worked out from, but the meshes, as one string: the item, the
   * operation, each input's body id, handle, place in made order, kept id, frames and turned faces, and what its
   * names come from (a Combine's result's kept names, by identity; else its item and curves: the handle stands for
   * its spec, `body`'s key), the first piece number and the extrude's own body (the pieces remembered are matched
   * after every step, `pieceIds`, so they are no part of a step's names). A mesh is the
   * kernel's of a kept body, the same for the same handle while the body is kept, so it needs no place here.
   */
  namingKey(feature: string, op: BooleanOp, inputs: readonly StepInput[], firstPiece: number, own: string | undefined): string {
    const idOf = (o: object): number => {
      let n = this.objects.get(o);
      if (n === undefined) this.objects.set(o, (n = this.nextObject++));
      return n;
    };
    return JSON.stringify([
      feature,
      op,
      inputs.map(({ id, handle, b, place, keepsId }) => [id, handle, place, keepsId ?? null, b.frames ?? null, b.reversed ?? null, b.named === undefined ? [b.feature, b.curves ?? null] : [idOf(b.named.faces), idOf(b.named.made)]]),
      firstPiece,
      own ?? null,
    ]);
  }

  /** The names `keepNaming` kept under `key` for this very answer of `boolean`, else undefined. */
  naming(result: BooleanResult, key: string): NamedStep | undefined {
    const kept = this.namings.get(result);
    return kept?.key === key ? kept.named : undefined;
  }

  /** Keeps `named`, worked out from `key` for `result` (an answer of `boolean`), for `naming`. */
  keepNaming(result: BooleanResult, key: string, named: NamedStep): void {
    this.namings.set(result, { key, named });
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
    this.asking.clear();
    this.booleans.clear();
    this.namings = new WeakMap();
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

/**
 * Region `region` of a sketch as its points and curves make it now
 * (regions.ts `regionNow`): `region` itself when it already says so, or
 * when it is not found. Asked of the kernel as `outlineOf` asks, so a
 * settle that asked for the outline already has the answer.
 */
async function regionToday(kernel: KernelCalls, content: KeptShape & Pick<Sketch, "projected">, region: RegionRef): Promise<RegionRef> {
  const c = sketchCurves(content);
  return regionNow((await kernel.call("sketch_regions", c.lines, c.circles, c.arcs)).regions, idsOf(content), region) ?? region;
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
    for (const f of doc.timeline.features.filter(isSketchExtrude).flatMap(profileParts)) {
      const op = regionOf(f) === undefined ? "sketch_outline" : "sketch_regions";
      const content = sketches.get(f.intent.parameters.sketch as string);
      if (content !== undefined) ask(curvesOf(content), op);
      const kept = keptOf(doc, f);
      if (kept !== undefined) ask(curvesOf(kept), op);
    }
  }
  return { call: ((op: string, ...args: unknown[]) => (op === "sketch_outline" || op === "sketch_regions" ? ask(args, op) : (kernel.call as (op: string, ...a: unknown[]) => unknown)(op, ...args))) as KernelCalls["call"] };
}

/**
 * The region an extrude of a sketch's one outline (no `region`: Design
 * data before version 9, or an assistant's extrude) takes when an edit
 * from `before` to `after` stops the sketch making one outline but leaves
 * that outline whole as a region's outside, every curve of the sketch
 * round some region (issue #541: a circle drawn inside the square, or a
 * loop beside it; a stray or loose curve is not): the one region `before` made,
 * found in `after` by the very same loop of curves and extrudable, so the
 * extrude goes on as an extrude with that region picked does (the hole
 * cut, the loop beside it left out). Undefined otherwise (the loop broken,
 * crossed or changed: the extrude keeps its last shape as before), and
 * for curves the kernel refuses outright.
 */
async function outlineRegion(kernel: KernelCalls, before: DesignDocument, after: DesignDocument, sketchId: string): Promise<RegionRef | undefined> {
  const was = contentOf(before, sketchId);
  const now = contentOf(after, sketchId);
  if (was === undefined || now === undefined || !(await makesOutline(kernel, before, sketchId))) return undefined;
  const regions = async (content: Sketch) => {
    const c = sketchCurves(content);
    return (await kernel.call("sketch_regions", c.lines, c.circles, c.arcs)).regions;
  };
  try {
    const one = await regions(was);
    if (one.length !== 1 || !one[0].extrudes) return undefined;
    const ref = regionRef(one[0], regionCurveIds(was));
    const ids = regionCurveIds(now);
    const all = await regions(now);
    // Only a sketch made wholly of closed loops: a loose or stray curve still breaks the one outline, as before (the owner's rule, 25a).
    const round = new Set(all.flatMap((r) => regionName(r, ids) ?? []).map((p) => p.curve));
    if (![...ids.line, ...ids.arc, ...ids.circle].every((id) => round.has(id))) return undefined;
    const found = findRegion(all, ids, ref);
    const name = found === undefined ? null : regionName(found, ids);
    return found?.extrudes === true && name !== null && sameLoop(name, ref.outer) ? ref : undefined;
  } catch (e) {
    if (e instanceof KernelError && e.kind === "invalid-input") return undefined;
    throw e;
  }
}

/** Extrude `f` extruding `region` (`outlineRegion`), or `f` itself when there is none. */
const withRegion = (f: Feature, region: RegionRef | undefined): Feature => (region === undefined ? f : { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, region } } });

/**
 * An extrude with its `more` profiles' regions as the sketch makes them now (SL #611 C3), by their places in `more`;
 * one that would then be the same profile as another of its profiles is left as it was (the reader refuses a profile
 * twice).
 */
function withMoreRegions(f: Feature, regions: ReadonlyMap<number, RegionRef> | undefined): Feature {
  if (regions === undefined || regions.size === 0) return f;
  const more = moreProfiles(f).map((p, k) => (regions.has(k) ? { ...p, region: regions.get(k)! } : p));
  const first: ProfileRef = { sketch: f.intent.parameters.sketch as string, ...(regionOf(f) ? { region: regionOf(f)! } : {}) };
  const all = [first, ...more];
  const kept = more.map((p, k) => (regions.has(k) && all.some((q, j) => j !== k + 1 && sameProfile(p, q)) ? moreProfiles(f)[k] : p));
  return { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, more: kept } } };
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
 * one whose sketch makes an outline forgets its kept shape, and saves its
 * region (step 48) as the sketch makes it now, its curves and centroid
 * (`regionNow`: the timeline hunt of 2026-11-11). From step 26c
 * a sketch on a face whose name finds no face or two in `after` holds the
 * placement it had in `before` (if it holds none yet), and forgets it once
 * its face is back; from 26f, each point pinned to its face's edge goes
 * where that edge is now, judged the same way (`follow`), and stays
 * where it was when the edge is gone; from 27d each projection likewise. The same rules as the model's `settle`: suppression
 * and the marker don't count, so a greyed sketch keeps nothing while its
 * face is there, and one whose face went while it was greyed keeps where
 * it was. Only a followed point of a sketch that builds with the
 * suppressed items off follows its edge as built so, as the rebuild draws
 * it (hunt 11-11, #540 item 2). `after` itself when nothing changes.
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
      // Each extrude whose sketch makes its region saves the region as it is now (regions.ts `regionNow`).
      const regions = new Map<string, RegionRef>();
      // Each profile of each extrude (version 18: several), its kept shape its own, filed by the extrude and its place
      // among the profiles (`keptKey`, version 20, SL #632: two profiles of one sketch each keep the shape they were lost
      // with). Every profile has its region brought up to date here (SL #611 C3: a `more` profile's too, saved at its
      // place in `more`, `moreRegions`).
      const own = new Set<Feature>(doc.timeline.features);
      const moreRegions = new Map<string, Map<number, RegionRef>>();
      const parts = doc.timeline.features.filter(isSketchExtrude).flatMap((x) => profileParts(x).map((part, k) => ({ part, k: k - 1, item: x.id })));
      for (const { part: f, k, item } of parts) {
        const sketch = f.intent.parameters.sketch as string;
        if (await makesOutline(kernel, doc, sketch, regionOf(f))) {
          const region = regionOf(f);
          const now = region && (await regionToday(kernel, contentOf(doc, sketch)!, region));
          if (now && now !== region) {
            if (k < 0) regions.set(item, now);
            else moreRegions.set(item, new Map([...(moreRegions.get(item) ?? []), [k, now]]));
          }
          continue;
        }
        if (Object.hasOwn(next, f.id)) continue;
        const first = own.has(f);
        const had = keptOf(after, f);
        const was = contentOf(before, sketch);
        // Issue #541: an extrude of the one outline whose outline is still there whole, as a region's outside, takes that region.
        const region = first && had === undefined && regionOf(f) === undefined ? await outlineRegion(kernel, before, doc, sketch) : undefined;
        if (region !== undefined) regions.set(f.id, region);
        // Lost by this edit (it made its outline in `before`): its shape in `before`, even when a shape is filed for it
        // already (a version 18 file's shape shared with another profile of its sketch, copied to each when read, SL #632);
        // lost before it: the shape it keeps.
        else if (was !== undefined && (await makesOutline(kernel, before, sketch, regionOf(f)))) {
          const item = beforeItems.get(sketch)!;
          const placement = isFaceSketch(item) ? await wasAt(sketch) : (originPlacement(item) ?? undefined);
          const shape = keptCurves(was);
          next[f.id] = placement ? { ...shape, placement } : shape;
        } else if (had !== undefined) next[f.id] = had;
      }
      const moved = regions.size > 0 || moreRegions.size > 0;
      const { kept: old, ...rest } = !moved ? doc : { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => withMoreRegions(withRegion(f, regions.get(f.id)), moreRegions.get(f.id))) } };
      if (!moved && JSON.stringify(old ?? {}) === JSON.stringify(next)) return doc;
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
      // Pinned points follow their bodies as the rebuild draws them, an earlier suppressed Move left off (hunt 11-11, #540
      // item 2: followed with it on, every edit in the sketch threw a point to where the Move would put it, and the rebuild
      // put it back); a sketch that isn't built that way (itself suppressed or greyed) as it would be with everything on.
      const drawn = doc.timeline.features.some((f) => f.suppressed) ? await placeOpen(doc, bodies, kernel, true) : now;
      const pinsOf = (id: string) => (drawn[id]?.status === "built" ? drawn[id] : now[id]);
      let changed = false;
      const sketches: Sketch[] = [];
      for (const content of doc.sketches) {
        const r = now[content.id];
        if (content.face === undefined || r?.status !== "built") {
          // 27c: a sketch on an origin plane with pinned points follows them too.
          const followed = content.face === undefined ? followedSketch(content, pinsOf(content.id)) : content;
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
        const followed = followedSketch(settled, pinsOf(content.id));
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
 * Whether settling an edit from `before` (a settled design) to `after` can
 * change what an extrude keeps (`settleKept`) in a design with no sketch
 * placed on bodies: only when an extrude asks for another outline than
 * before, because it names another region (Edit feature's region pick,
 * timeline hunt 2026-11-11: the sketch makes the new region, so the shape
 * kept for the old one is forgotten) or its sketch's points or curves
 * changed. A new extrude of an unchanged sketch asks nothing new; one whose
 * sketch is gone and that keeps a shape already is settled (a delete settles
 * itself before it is recorded). Asks the kernel nothing.
 */
export function keptUnsettled(before: DesignDocument, after: DesignDocument): boolean {
  const drawn = (doc: DesignDocument, id: string) => doc.sketches.find((s) => s.id === id);
  const was = new Map(before.timeline.features.map((f) => [f.id, f]));
  // Every profile (version 18: several, `profileParts`; SL #611, broken-solids hunt A7: only the first was looked at).
  return after.timeline.features.some((whole) => {
    if (!isSketchExtrude(whole)) return false;
    const was0 = was.get(whole.id);
    const olds = was0 === undefined ? [] : profileParts(was0);
    if (was0 !== undefined && JSON.stringify(moreProfiles(was0)) !== JSON.stringify(moreProfiles(whole))) return true;
    return profileParts(whole).some((f, k) => {
      const old = olds[k];
      if (old !== undefined && JSON.stringify(regionOf(old)) !== JSON.stringify(regionOf(f))) return true;
      const now = drawn(after, f.intent.parameters.sketch as string);
      const then = drawn(before, (old ?? f).intent.parameters.sketch as string);
      if (now === then || (now !== undefined && then !== undefined && now.points === then.points && now.curves === then.curves && now.projected === then.projected)) return false;
      return now !== undefined || keptOf(after, f) === undefined;
    });
  });
}

/**
 * Every item of `doc` up to its last sketch on a face or with pins,
 * built with nothing suppressed and no marker, without freeing anything:
 * where each face sketch would lie, and each pinned point would be, with
 * everything on (none for a document without one). With `suppressed`
 * the suppressed items stay off (the marker still doesn't count): where
 * each pinned point is drawn (hunt 11-11, #540 item 2).
 */
async function placeOpen(doc: DesignDocument, cache: BodyCache, kernel: KernelCalls, suppressed = false): Promise<Record<string, FeatureResult>> {
  const last = doc.timeline.features.filter((f) => placedOnBodies(doc, f)).at(-1);
  if (last === undefined) return {};
  const features = suppressed ? doc.timeline.features : doc.timeline.features.map((f) => (f.suppressed ? { ...f, suppressed: false } : f));
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
    // A profile size outside the limits is never asked for (the kernel built a negative one mirrored): `buildFeature` fails it.
    if (!ownShape(f) || !building.has(f) || skipped.has(f) || profileSizeRefused(doc, f) !== null) continue;
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

/** A sketch's points that are its own (SL #539): neither pinned to an edge or corner nor made by a projection, so only an edit of the sketch moves them. */
export function ownPoints(content: Sketch): Sketch["points"] {
  const followed = new Set([...(content.pins ?? []).map((p) => p.point), ...(content.projected ?? []).flatMap((p) => madePoints(content, p))]);
  return followed.size === 0 ? content.points : content.points.filter((p) => !followed.has(p.id));
}

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
/**
 * An extrude's later profile's cap (version 18) as a file saved before
 * SL #632 named it: every profile's caps were "start" and "end", told
 * apart by a tag of the faces round each (rule 3), so a profile's cap was
 * `name` tagged with its sides' names. Since then a profile k after the
 * first names its caps `start:k` and `end:k` (naming.ts `nameBody`); the
 * cap of that kind whose bordering faces are exactly the tag's names, or
 * null when none is (the name is read as it is).
 */
function profileCapNamed(list: readonly NamedBody[], name: string, tag: readonly string[]): string | null {
  if (!/\/(start|end)$/.test(name)) return null;
  const want = [...tag].sort().join(",");
  for (const b of list) {
    for (let i = 0; i < b.faces.length; i++) {
      const cap = b.faces[i].names.find((n) => n.startsWith(`${name}:`) && /^\d+$/.test(n.slice(name.length + 1)));
      if (cap === undefined) continue;
      const round = new Set<string>();
      for (const pair of b.view.edge_faces) {
        if (pair === null || !pair.includes(i)) continue;
        const other = b.faces[pair[0] === i ? pair[1] : pair[0]]?.names[0];
        if (other !== undefined) round.add(other);
      }
      if ([...round].sort().join(",") === want) return cap;
    }
  }
  return null;
}

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
  const held = (): FeatureResult => ({ status: "built", placement: { plane: squared(p.held ?? p.frame)!, side: p.side }, plane: { cause, face: plane, message: planeWords(cause, f.provenance.self.label) } });
  const place = async (on: BuiltBody, view: BodyView, face: number, split: boolean, whole = false): Promise<FeatureResult> => {
    // 35e2h: carried first by what the Moves before it did to the body since the sketch was drawn (not known before 35e2h: not carried);
    // SL #539: a change of size since by a Scale carries the middle of its own points (not those pinned or projected, which follow
    // edges by name and are written back after: the middle never moves by settling) as the body's point under it, its sizes kept.
    // SL #583 item 3: drawn on a Cut's wall (its name's face turned round) and found now as that face itself (the Combine
    // made a Join or Intersect, or suppressed), or the other way about: not the face it was drawn on, which is gone. A
    // sketch from before version 19 records neither, and is placed as before.
    if (p.reversed !== undefined && (on.reversed?.[face] ?? false) !== p.reversed) return held();
    const carry = p.body === undefined ? null : carried(p.body, frameOfFace(on, face) ?? undefined, sketchMiddle(squared(p.frame)!, ownPoints(content)));
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
    // SL #632 item 2: a file from before names a later profile's cap "end" tagged by its sides; read as that profile's own name.
    const capNow = r.tag === undefined ? null : profileCapNamed(list, `face:${r.featureId}/${r.part}`, r.tag);
    const found = resolveFaceName(list, designNames(list), capNow !== null ? { name: capNow, origin: p.frame.origin } : { name: `face:${r.featureId}/${r.part}`, ...(r.tag && { tag: r.tag }), origin: p.frame.origin });
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
  return held();
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
 * a point whose edge goes later held, where the point followed to. And
 * each Move holding the new pieces it moved (`takes`, SL #583 item 2).
 */
export function followedDoc(doc: DesignDocument, build: TimelineBuild): DesignDocument {
  let moved = false;
  const sketches = doc.sketches.map((s) => {
    const next = followedSketch(s, build.results[s.id]);
    moved ||= next !== s;
    return next;
  });
  const followed = moved ? { ...doc, sketches } : doc;
  // A Move that moved new pieces of a body it holds (SL #583 item 2) holds them from now on, numbered first as the
  // workspace numbers them (`numberPieces`; its own call after this one gives them their remembered faces), so they
  // stay moved after this rebuild.
  // A Move that is off when a body it holds is first split (suppressed, rolled back by the marker, greyed or failed:
  // SL #624 item 2) moved nothing, so named nothing in `takes`; it holds the whole body all the same, and this rebuild
  // is about to number the new piece, after which no later one could tell it from a piece left unpicked. So it takes
  // the piece now: one split (`from`) from a body it holds, not numbered yet, made by an item before the Move.
  const numbered = followed.bodies === undefined ? null : new Set(followed.bodies.map((b) => b.id));
  const place = new Map(followed.timeline.features.map((f, i) => [f.id, i] as const));
  const takers = followed.timeline.features.flatMap((f) => {
    if (!isMoveItem(f)) return [];
    const r = build.results[f.id];
    if (r?.status === "built") return r.takes !== undefined ? [[f, r.takes] as const] : [];
    if (numbered === null) return [];
    const held = movedBodies(f);
    const takes: string[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (const [id, b] of Object.entries(build.bodies)) {
        const made = place.get(bodyItem(id) ?? "");
        if (b.from === undefined || numbered.has(id) || held.includes(id) || takes.includes(id) || made === undefined || made > place.get(f.id)!) continue;
        if (!held.includes(b.from) && !takes.includes(b.from)) continue;
        takes.push(id);
        grew = true;
      }
    }
    return takes.length > 0 ? [[f, takes] as const] : [];
  });
  if (takers.length === 0) return followed;
  let next = numberPieces(followed, Object.keys(build.bodies));
  for (const [f, takes] of takers) next = changedMove(next, f.id, moveValues(f), [...movedBodies(f), ...takes]);
  return next;
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
  // #545 item 2: one whose followed points stayed is judged as stored, on every rebuild, so a sketch an earlier edit left
  // unsolved keeps saying so; nothing is moved then (the edit that left it so already decided where its points are).
  const solving = content.constraints.length > 0 || content.curves.some((c) => c.kind === "arc");
  const again = !solving ? null : followed !== content ? await solvedAgain(kernel, followed, content, label) : await stillSolved(kernel, content, label);
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
 * conflict, a refusal, a line or arc shrunk below MIN_FEATURE, the solver
 * failing or taking too long, or a shape turned over).
 *
 * One solve from the stored points can land on the shape's mirror image,
 * the nearer answer the lengths allow: an arc turned inside out
 * (point-drag.ts `turnedOver`, #545 item 1) or a corner where two curves
 * meet turned over (`cornerTurned`, SL #630: a sized rectangle drawn from
 * a box's corner mirrored past it, a slot's ends turned inward). Nobody
 * moved these points by hand, so every corner counts, and it is said
 * rather than taken.
 */
async function solvedAgain(kernel: KernelCalls, followed: Sketch, before: Sketch, label: string): Promise<{ solved: { point: string; at: SketchXY }[] } | { message: string }> {
  const got = await solvedOnce(kernel, followed, label);
  if ("message" in got) return got;
  const { at } = got;
  const was = new Map(before.points.map((p) => [p.id, [p.x, p.y] as const]));
  // #545 item 1: an arc the solve would turn inside out (its end past its start, or its sweep jumping to its other branch;
  // passing a half turn is fine, SL #612), refused as a drag refuses it.
  if (turnedOver(followed, was, at) !== null) return { message: constraintsWords(label, "an arc would turn inside out") };
  if (cornerTurned(followed, was, at, false) !== null) return { message: constraintsWords(label, "the shape would turn over") };
  return { solved: followed.points.flatMap((p) => {
    const [x, y] = at.get(p.id)!;
    return x === p.x && y === p.y ? [] : [{ point: p.id, at: [x, y] as SketchXY }];
  }) };
}

/** Sketch `sketch` solved once with its followed points fixed: every point's place, or why not (solvedAgain). */
async function solvedOnce(kernel: KernelCalls, sketch: Sketch, label: string): Promise<{ at: Map<string, readonly [number, number]> } | { message: string }> {
  const request = solverRequest(sketch);
  let answer: ReturnType<typeof readAnswer>;
  try {
    answer = readAnswer(await kernel.call("solve_sketch", request.text));
  } catch (e) {
    // Too slow, or the kernel failed: the sketch is built with its followed points as they are, and says so.
    return { message: constraintsWords(label, `the solver failed: ${e instanceof Error ? e.message : String(e)}`) };
  }
  if (answer.result === "refused") return { message: constraintsWords(label, `the solver refused it: ${answer.message}`) };
  if (answer.result === "conflict") return { message: constraintsWords(label, "they fight there") };
  const at = solvedPoints(sketch, request, answer.points);
  const tiny = shrunk(sketch, at);
  if (tiny !== null) return { message: constraintsWords(label, `${curveWord(sketch, tiny, "a")} would shrink below the smallest size`) };
  return { at };
}

/**
 * Sketch `stored`, whose followed points stayed where they were, judged as
 * it is (#545 item 2): null when it is solved there (no point of it more
 * than HELD_STILL from where the solve puts it), else why not. Its points
 * are never moved here.
 */
async function stillSolved(kernel: KernelCalls, stored: Sketch, label: string): Promise<{ message: string } | null> {
  const got = await solvedAgain(kernel, stored, stored, label);
  if ("message" in got) return got;
  const at = new Map(stored.points.map((p) => [p.id, p] as const));
  const off = got.solved.some(({ point, at: [x, y] }) => Math.hypot(x - at.get(point)!.x, y - at.get(point)!.y) > HELD_STILL);
  return off ? { message: constraintsWords(label, "an earlier change left them unsolved") } : null;
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
    if (isMoveItem(f)) return await moveBodies(doc, f, done, bodies, cache);
    if (isCombineItem(f)) return await combineRun(doc, f, done, bodies, cache);
    if (isDuplicateItem(f)) return await copyBody(f, done, bodies, cache);
    if (!isSketchExtrude(f)) {
      // Save-load hunt B4: failed in words as a size the kernel refuses is, never built (a negative one came out mirrored).
      const refused = profileSizeRefused(doc, f);
      if (refused !== null) return { status: "failed", cause: "error", message: refused };
      const spec = specOf(doc, f);
      return made({ handle: await cache.body(spec), spec });
    }
    // Each profile as a one-profile extrude (version 18: several, `profileParts`; the first is the extrude itself).
    const parts: { self: Omit<BuiltBody, "feature">; rest: Partial<Extract<FeatureResult, { status: "built" }>> }[] = [];
    for (const part of profileParts(f)) {
      const sketchId = part.intent.parameters.sketch as string;
      const item = index.items.get(sketchId);
      const input = done[sketchId];
      // Q3, unified in 26e: built on a suppressed sketch, or on one greyed, it is greyed too, with no warning.
      if (item !== undefined && input?.status === "suppressed") return { status: "greyed", by: sketchId };
      if (item !== undefined && input?.status === "greyed") return { status: "greyed", by: input.by };
      if (item !== undefined && input?.status !== "built") return { status: "failed", cause: "failed-input", input: sketchId, message: `${item.provenance.self.label} is not built` };
      // A face sketch's placement is the rebuild's; an origin plane's, extrudeSpec's own.
      const placed = item !== undefined && isFaceSketch(item) && input?.status === "built" ? input.placement : undefined;
      const spec = await extrudeSpec(kernel, doc, part, index, placed);
      if ("status" in spec) return spec;
      // 35f1e: a sketch placed on a piece of its split face is not held, so its extrude's source is not lost.
      const lost = input?.status === "built" && input.plane?.cause !== "plane-split" ? input.plane : undefined;
      const source = lost && { ...lost, sketch: sketchId, message: `${f.provenance.self.label}'s source is lost: ${item!.provenance.self.label}'s plane is ${lost.cause === "plane-lost" ? "lost" : "ambiguous"}, so it stays where it was` };
      const rest = { ...(spec.warning ? { warning: spec.warning } : {}), ...(source ? { source } : {}) };
      parts.push({ self: { handle: await cache.body(spec.spec), spec: spec.spec, curves: spec.curves }, rest });
    }
    // The first warning and lost source of any profile is the item's (one each per item).
    const rest = Object.assign({}, ...parts.map((p) => p.rest).reverse()) as Partial<Extract<FeatureResult, { status: "built" }>>;
    const self = parts[0].self;
    if (isOperationExtrude(f)) return await operationRun(doc, f, self, rest, done, bodies, cache);
    if (parts.length > 1) return await unitedRun(doc, f, parts.map((p) => p.self), rest, done, bodies, cache);
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
 * the Move with the kernel's words. A body no longer there (deleted, not
 * built, or used up by an earlier Combine) is left out with a warning
 * (`missing`, SL #506 item 4), the rest moved; with none left it fails.
 * The Move holds the bodies as they
 * were (`holds`), so the next rebuild finds them built. Its bodies are
 * stored by body id (`movedBodies`, Design data version 6, 35ec), each
 * made by an item it depends on (`bodyItem`).
 *
 * A body it holds that an earlier item's boolean has split since the Move
 * was made (SL #583 item 2: an upstream edit makes a Cut go right
 * through) is moved whole: every new piece split from it (`from`), one
 * the design hasn't numbered yet, is moved too and named in `takes`, so
 * the design takes it into the Move (`followedDoc`) and it stays moved.
 * A piece it holds that its item no longer makes (that edit undone) is
 * no failure while the Move holds the body it split from: that body has
 * it again.
 */
async function moveBodies(doc: DesignDocument, f: Feature, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  for (const id of f.dependsOn) {
    const r = done[id];
    if (r?.status === "suppressed") return { status: "greyed", by: id };
    if (r?.status === "greyed") return { status: "greyed", by: r.by };
  }
  const label = (id: string) => f.provenance.from.find((x) => x.id === id)?.label ?? id;
  const name = f.provenance.self.label;
  const motions = moveMotions(moveValues(f));
  const from: [string, BuiltBody][] = [];
  // SL #506 item 4: a body that is no longer there is left out, and the Move moves the rest with a warning naming it,
  // so a body it also moves never jumps back for it. With none left the Move fails, naming the first as before.
  const gone: { body: string; said: string; failed: Extract<FeatureResult, { status: "failed" }> }[] = [];
  const held = movedBodies(f);
  for (const body of held) {
    const id = bodyItem(body)!;
    const r = done[id];
    const b = r?.status === "built" ? bodies[body] : undefined;
    const what = body === bodyIdOf(id) ? label(id) : `a piece of ${label(id)}`;
    if (r === undefined) gone.push({ body, said: `${label(id)} was deleted`, failed: { status: "failed", cause: "deleted-input", input: id, message: `${label(id)} was deleted, so ${name} has nothing to move` } });
    else if (r.status !== "built") gone.push({ body, said: `${label(id)} is not built`, failed: { status: "failed", cause: "failed-input", input: id, message: `${label(id)} is not built, so ${name} can't move it` } });
    // A piece its item no longer makes, split from a body this Move holds that is here: that body holds it again (SL #583 item 2).
    else if (b === undefined && isPiece(body) && !r.bodies?.includes(body) && splitBy(doc, id).some((t) => held.includes(t) && bodies[t] !== undefined)) continue;
    // Built, but gone from here on: an earlier Combine or extrude used it up, or left no such piece (as `booleanSteps` says it; hunts 11-06, 11-08).
    else if (b === undefined) gone.push({ body, said: `an earlier Combine or extrude used up ${what} or left no such piece`, failed: { status: "failed", cause: "failed-input", input: id, message: `${name} can't move ${body === bodyIdOf(id) ? label(id) : "a piece"}: an earlier Combine or extrude used it up or left no such piece` } });
    else from.push([body, b]);
  }
  if (from.length === 0 && gone.length > 0) return gone[0].failed;
  const list = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  const words = (body: string) => (isPiece(body) ? `a piece of ${label(bodyItem(body)!)}` : label(bodyItem(body)!));
  const missing = gone.length === 0 ? {} : { missing: { message: `${name} moves only ${list(from.map(([b]) => words(b)))}: ${list(gone.map((g) => g.said))}`, bodies: gone.map((g) => g.body) } };
  // New pieces split from a body it holds (or from such a piece), not numbered yet: made since the Move was, so moved with it.
  const numbered = doc.bodies === undefined ? null : new Set(doc.bodies.map((b) => b.id));
  const takes: string[] = [];
  for (let grew = numbered !== null; grew; ) {
    grew = false;
    for (const [id, b] of Object.entries(bodies))
      if (b.from !== undefined && !numbered!.has(id) && !from.some(([x]) => x === id) && from.some(([x]) => x === b.from)) {
        from.push([id, b]);
        takes.push(id);
        grew = true;
      }
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
  return { status: "built", holds, ...missing, ...(takes.length > 0 ? { takes } : {}) };
}

/** The bodies item `id`'s booleans split pieces from (SL #583 item 2): a Combine's target, an operation extrude's bodies. */
function splitBy(doc: DesignDocument, id: string): string[] {
  const item = doc.timeline.features.find((x) => x.id === id);
  if (item === undefined) return [];
  if (isCombineItem(item)) return [combineBodies(item).target];
  return isOperationExtrude(item) ? [...extrudeOperation(item)!.bodies] : [];
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
    // Duplicate's, each keeping its role with the feature it came from (built-body.ts `copiedFaceName`; the source's own as a
    // plain copy's, SL #538 item 5), in the same order
    // (a move or a mirror keeps every face and its order), each frame carried across the plane with it.
    const motions = plane === undefined ? [] : [mirrorMotion(plane)];
    const handle = motions.length === 0 ? b.handle : await cache.moved(b.handle, motions);
    const frames = motions.length === 0 ? b.frames : b.named!.faces.map((_, k) => movedFrame(b.frames?.[k] ?? null, motions));
    bodies[id] = { feature: f.id, handle, spec: null, named: copiedNames(b.named!, f.id, b.feature, (id) => Object.hasOwn(done, id)), ...(frames && { frames }), ...(b.reversed && { reversed: b.reversed }) };
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

/** A boolean step's input (`booleanSteps`): its body id, kernel body, body, place in made order and the id it keeps (an Extrude join's). */
export interface StepInput {
  id: string;
  handle: BodyHandle;
  b: BuiltBody;
  place: number;
  keepsId?: number;
}

/** Each input of a step named, as boolean-names.ts names a body (each is meshed for it). */
async function namedInputs(pending: readonly StepInput[], cache: BodyCache): Promise<NamedBody[]> {
  const inputs: NamedBody[] = [];
  for (const x of pending) {
    const named = await namedOf(x.id, x.b, cache, x.place);
    inputs.push(x.keepsId !== undefined ? { ...named, keepsId: x.keepsId } : named);
  }
  return inputs;
}

/**
 * A boolean step's answer named (`combineNames`) from the meshes of its inputs and answer, with each result body's
 * faces' origins, frames and turned faces (`NamedStep`): all that Design keeps of the step but the bodies' places.
 */
async function namedStep(feature: string, op: BooleanOp, inputs: readonly NamedBody[], result: BooleanResult, built: ReadonlyMap<BodyHandle, BuiltBody>, cache: BodyCache, firstPiece: number, own: string | undefined): Promise<NamedStep> {
  const [t, ...ts] = inputs;
  const views = await Promise.all(result.bodies.map((h) => cache.view(h)));
  // Numbered by rank alone, on from the last boolean's; the remembered pieces are found once all are made (booleanSteps).
  const named = combineNames(feature, op, t, ts, result, views, firstPiece, undefined, own);
  if ("failed" in named) return named;
  const bodies: Extract<NamedStep, { bodies: unknown }>["bodies"] = [];
  for (const nb of named.bodies) {
    const h = result.history[result.bodies.indexOf(nb.handle)];
    const frames = framesOfResult(h, built);
    const faces = withOrigins(nb.faces, h, inputs, frames);
    const reversed = reversedOfResult(h, views[result.bodies.indexOf(nb.handle)], new Map(inputs.map((x) => [x.handle, { built: built.get(x.handle)!, view: x.view }])));
    bodies.push({ id: nb.id, handle: nb.handle, faces, made: nb.made, ...(frames && { frames }), ...(reversed && { reversed }) });
  }
  return { bodies };
}

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
async function booleanSteps(doc: DesignDocument, f: Feature, steps: readonly BooleanStep[], operation: CombineOperation, verb: string, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache, grouped = false): Promise<FeatureResult> {
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
  // A new body of several profiles' too (version 18, `unitedRun`).
  const remembers = isCombineItem(f) || isOperationExtrude(f) || hasMoreProfiles(f);
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
  const misses: Miss[] = [];
  for (const step of steps) {
    // Each input as it goes in: named (meshed) only when its step's names are not kept (`BodyCache.naming`).
    const pending: StepInput[] = [];
    const built = new Map<BodyHandle, BuiltBody>();
    const joined = joins ? [step.target, ...step.tools].filter((b) => bodyItem(b) !== f.id).sort((a, b) => madeKey(a)[0] - madeKey(b)[0] || madeKey(a)[1] - madeKey(b)[1]) : [];
    for (const body of [step.target, ...step.tools]) {
      // A profile's prism of the item's own (`unitedRun`: no body id of the design) is the item's.
      const maker = bodyItem(body) ?? f.id;
      // The item's own body (an operation extrude's, built just before) is no input of an earlier item.
      if (maker !== f.id) {
        const r = done[maker];
        if (r === undefined) return { status: "failed", cause: "deleted-input", input: maker, message: `${nameOf(maker)} was deleted, so ${label} has nothing to ${verb}` };
        if (r.status !== "built") return { status: "failed", cause: "failed-input", input: maker, message: `${nameOf(maker)} is not built, so ${label} can't use it` };
      }
      const b = work[body];
      if (b === undefined) return { status: "failed", cause: "failed-input", input: maker, message: `${label} can't use ${body === bodyIdOf(maker) ? nameOf(maker) : "a piece"}: an earlier Combine or extrude used it up or left no such piece` };
      // Equal bodies share one kernel body (`BodyCache.body`): a second pick of it gets a body of its own, so the
      // kernel sees the bodies the person picked, not one body as its own tool (35f1d, found by the monkey). A body
      // with no spec (a Combine's result, which its Copy shares: SL #624 item 3) gets its own from the kernel's
      // body_move by nothing, once more for each pick before it: the same faces in the same order, where they are.
      const copies = pending.filter((x) => x.handle === b.handle).length;
      const own = copies === 0 ? b : { ...b, handle: b.spec !== null ? await cache.body(b.spec, copies) : await cache.moved(b.handle, Array.from({ length: copies }, (): Motion => ({ move: [0, 0, 0] }))) };
      if (own !== b) made.push(own.handle);
      built.set(own.handle, own);
      pending.push({ id: body, handle: own.handle, b: own, place: places.get(b.feature) ?? places.get(maker)!, ...(joined.includes(body) ? { keepsId: joined.indexOf(body) } : {}) });
    }
    const [t, ...ts] = pending;
    const op = KERNEL_OP[operation];
    // A grouped join needs each input's bounds, so its inputs are named first.
    let inputs = grouped ? await namedInputs(pending, cache) : undefined;
    let result: BooleanResult;
    try {
      // An extrude of several profiles (`unitedRun`): only the groups that may share a face are joined (SL #611 C1).
      if (grouped) result = await groupedJoin(cache, inputs!, new Set(Object.values(work).filter((b) => !pending.some((x) => x.handle === b.handle)).map((b) => b.handle)));
      else {
      result = await cache.boolean(t.handle, ts.map((x) => x.handle), op);
      // Equal inputs give the cached answer: when an earlier Combine already holds it (two equal boxes each cut by
      // one kept tool), this one asks for a body of its own, so no two bodies share one kernel body (hunt 11-06).
      const taken = new Set(Object.values(work).map((b) => b.handle));
      for (let copy = 1; result.bodies.some((h) => taken.has(h)); copy++) result = await cache.boolean(t.handle, ts.map((x) => x.handle), op, copy);
      }
    } catch (e) {
      if (timedOut(e)) throw e;
      if (e instanceof KernelError && (e.kind === "invalid-input" || e.kind === "non-manifold-result" || e.kind === "thin-result")) {
        // Refused, it still holds the bodies it made for an equal pick, so the next rebuild needn't build them again
        // (a body cut by its own Duplicate, then joined with it: SL #360's seed 11).
        // SL #677 item 1: a round body is refused whatever else is asked (the kernel's booleans take flat faces only for
        // now), so with one among the inputs the item says so in the app's words, told by the bodies' own face types.
        // Asked of the cache only here, on a refusal (a step that builds never meshes its inputs for this).
        const round = e.kind !== "invalid-input" ? [] : await Promise.all(pending.map(async (x) => (await cache.view(x.handle)).face_types.some((type) => type !== "plane")));
        const who = !round.some(Boolean) ? null : round[0] ? "target" : step.tools.some((b, i) => round[i + 1] && (bodyItem(b) ?? f.id) !== f.id) ? "tool" : "extrude";
        return { status: "failed", cause: "error", message: `${label} can't be made: ${who === null ? e.message : roundWords(who)}`, ...(e.touches.length > 0 ? { touches: e.touches } : {}), ...(e.thin.length > 0 ? { thin: e.thin } : {}), ...(made.length > 0 ? { holds: made } : {}) };
      }
      throw e;
    }
    const missed = missedTools(operation, t.handle, ts.map((x) => x.handle), result);
    // SL #583 item 3: a Join's tool none of whose faces is left lies wholly inside, so its words never say it doesn't reach.
    const inside = operation === "join" ? missed.filter((i) => leavesNoFace(ts[i].handle, result)).map((i) => step.tools[i]) : [];
    // SL #677 item 3: an extrude joined wholly inside the body and flush with a face of it (the sketch on a face,
    // extruded into the body) adds nothing, though its flush face is merged into the body's (misses.ts `joinsInside`).
    // Only an operation extrude's Join asks or warns (a Combine's never does), so only it is looked at.
    if (joins && !grouped)
      for (const [i, tool] of ts.entries())
        if (!missed.includes(i) && mayJoinInside(t.handle, tool.handle, result) && joinsInside(t.handle, (await cache.view(t.handle)).faces, tool.handle, result)) {
          missed.push(i);
          inside.push(step.tools[i]);
        }
    if (missed.length > 0) misses.push({ target: step.target, tools: missed.map((i) => step.tools[i]), ...(inside.length > 0 && { inside }) });
    // The same step's names for this very answer, else worked out from the meshes and kept (SL #677 item 2).
    const key = cache.namingKey(f.id, op, pending, firstPiece, own);
    let named = cache.naming(result, key);
    if (named === undefined) {
      inputs ??= await namedInputs(pending, cache);
      named = await namedStep(f.id, op, inputs, result, built, cache, firstPiece, own);
      cache.keepNaming(result, key, named);
    }
    if ("failed" in named) return { status: "failed", cause: "error", message: `${label} can't be made: ${named.failed}`, ...(made.length > 0 ? { holds: made } : {}) };
    const targetFeature = work[step.target].feature;
    // Each input's item, for a piece keeping its id (an Extrude join's other bodies, hunt 11-08).
    const featureOf = new Map([step.target, ...step.tools].map((b) => [b, work[b].feature] as const));
    for (const tool of step.keepTools ? [] : step.tools) delete work[tool];
    delete work[step.target];
    const twice = named.bodies.find((nb, i) => nb.id in work || named.bodies.findIndex((x) => x.id === nb.id) !== i);
    if (twice !== undefined) return clash(twice.id);
    for (const nb of named.bodies) {
      const { faces, frames, reversed } = nb;
      const piece = !featureOf.has(nb.id) || nb.id === own;
      work[nb.id] = { feature: nb.id === step.target ? targetFeature : (featureOf.get(nb.id) ?? f.id), handle: nb.handle, spec: null, named: { faces, made: nb.made }, by: f.id, ...(frames && { frames }), ...(piece && { from: step.target }), ...(reversed && { reversed }) };
      if (!ids.includes(nb.id)) ids.push(nb.id);
      if (piece) {
        firstPiece++;
        if (remembers) pieceFaces[nb.id] = shownFaces(nb.faces);
      }
    }
    holds.push(...pending.map((x) => x.handle));
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
  // A Combine Join of bodies that don't meet keeps them as separate bodies with no warning (Ben's Fusion answer F2); an
  // Extrude Join that reaches nothing still warns (#521).
  const missing = misses.length === 0 || operation === "intersect" || (operation === "join" && !isOperationExtrude(f)) ? {} : { misses: { list: misses, operation, message: missesMessage(doc, f, misses, operation) } };
  return { status: "built", bodies: kept, holds, ...(Object.keys(faces).length > 0 ? { pieceFaces: faces } : {}), ...warn, ...missing };
}

/**
 * The row's words for item `f`'s Cut or Join whose tools change nothing,
 * each body named as the browser shows it ("Body 2"), else by its item. A
 * piece the build itself made (an Extrude Join's own block) has no number
 * until the build is over, so the app says the words again with the
 * numbered document (workspace.ts `warningsOf`): the same file then reads
 * the same on its first build as when opened again (SL #677 item 5).
 */
export function missesMessage(doc: DesignDocument, f: Feature, misses: readonly Miss[], operation: "cut" | "join"): string {
  const label = f.provenance.self.label;
  const nameOf = (id: string) => f.provenance.from.find((x) => x.id === id)?.label ?? id;
  const numbers = bodyNumbers(doc);
  const bodyWords = (b: string) => (numbers.has(b) ? `Body ${numbers.get(b)}` : bodyItem(b) === f.id ? label : nameOf(bodyItem(b)!));
  return missWords(label, operation, misses, bodyWords, isOperationExtrude(f) ? bodyIdOf(f.id) : undefined);
}

/**
 * A boolean result's face names with, on each face merged from several
 * input faces lying level (the history's `also`), the input faces it lies on
 * (boolean-names.ts `FaceNames.origins`, SL #502) and its frame then.
 */
function withOrigins(faces: readonly FaceNames[], h: BooleanResult["history"][number] | undefined, inputs: readonly NamedBody[], frames: readonly (Plane | null)[] | undefined): readonly FaceNames[] {
  if (h?.also === undefined || !h.also.some((a) => a.length > 0)) return faces;
  const byHandle = new Map(inputs.map((x) => [x.handle, x] as const));
  return faces.map((face, i) => {
    const more = h.also![i] ?? [];
    if (more.length === 0) return face;
    const origins = [h.faces[i], ...more].flatMap((from) => {
      const input = from === undefined ? undefined : byHandle.get(from.body);
      return input === undefined ? [] : [{ names: input.faces[from.face]?.names ?? [], view: input.view, face: from.face }];
    });
    const frame = frames?.[i] ?? null;
    return { ...face, origins, ...(frame !== null && { frame }) };
  });
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

/**
 * An extrude of several profiles as a new body (version 18), each
 * profile's prism just built (`prisms`, the first profile's first), as
 * Fusion's Extrude makes them: profiles that touch come out as one body,
 * profiles apart as separate bodies. SL #611 C1: no boolean where none is
 * needed (extrude-merge.ts). Regions of one sketch side by side with a
 * curved side are made as the one region they tile (`mergedOutline`), so a plate and its hole make
 * the block; prisms that can't share a face stay as they are
 * (`contactGroups`); only a group that may share one goes to the kernel,
 * whose booleans take flat faces only for now (said in plain words). The
 * body holding the first profile keeps the extrude's own id, as a Combine's
 * target keeps its id; the others are its pieces, numbered when built and
 * remembered by their faces (`booleanSteps`). The prisms after the first go
 * by ids no body of the design has, and are gone after.
 */
async function unitedRun(doc: DesignDocument, f: Feature, built: readonly Omit<BuiltBody, "feature">[], rest: Partial<Extract<FeatureResult, { status: "built" }>>, done: Record<string, FeatureResult>, bodies: Bodies, cache: BodyCache): Promise<FeatureResult> {
  const own = bodyIdOf(f.id);
  const prisms = await joinedRegions(built.map((p, k) => (k === 0 ? p : { ...p, profile: k + 1 })), cache);
  if (prisms.length === 1) {
    bodies[own] = { feature: f.id, ...prisms[0] };
    return { status: "built", bodies: [own], ...rest };
  }
  const others = prisms.slice(1).map((_, k) => `${own}#profile:${k + 2}`);
  bodies[own] = { feature: f.id, ...prisms[0] };
  others.forEach((id, k) => (bodies[id] = { feature: f.id, ...prisms[k + 1] }));
  const r = await booleanSteps(doc, f, [{ target: own, tools: others, keepTools: false }], "join", "join", done, bodies, cache, true);
  if (r.status !== "built") {
    for (const id of [own, ...others]) delete bodies[id];
    if (r.status === "failed" && (await curvedMeeting(prisms, cache))) return { ...r, message: `${f.provenance.self.label} can't be made: ${CURVED_TOUCHING}` };
    return r;
  }
  return { ...r, ...rest };
}

/**
 * The bodies an extrude of several profiles makes from these prisms
 * (each profile's spec and curves, the first profile's first), as
 * `unitedRun` makes them, for Extrude's preview (SL #632 item 3: the
 * preview drew the prisms apart and added their volumes, counting an
 * overlap twice): the regions of one sketch merged (`joinedRegions`), each
 * group that may share a face joined by the kernel, a prism alone in its
 * group as it is. On a body store of its own, closed after; only the views
 * are kept. A join the kernel refuses rejects, with its error.
 */
export async function unitedViews(kernel: KernelCalls, prisms: readonly { spec: BodySpec; curves?: CurveIds }[]): Promise<BodyView[]> {
  const cache = new BodyCache(kernel);
  try {
    const built = await Promise.all(prisms.map(async (p, k) => ({ handle: await cache.body(p.spec, k), spec: p.spec, ...(p.curves ? { curves: p.curves } : {}) })));
    const joined = await joinedRegions(built, cache);
    const views = await Promise.all(joined.map((p) => cache.view(p.handle)));
    const out: BodyView[] = [];
    for (const group of contactGroups(views.map((v) => v.bounds))) {
      if (group.length === 1) {
        out.push(views[group[0]]);
        continue;
      }
      const [t, ...ts] = group.map((i) => joined[i].handle);
      const r = await cache.boolean(t, ts, "union").catch(async (err: unknown) => {
        // In the same plain words as OK's refusal (`unitedRun`), never the kernel's.
        if (await curvedMeeting(joined, cache)) throw new Error(`These profiles can't be extruded together: ${CURVED_TOUCHING}`);
        throw err;
      });
      for (const h of r.bodies) out.push(await cache.view(h));
    }
    return out;
  } finally {
    await cache.close();
  }
}

/** Why an extrude of several profiles whose curved prisms touch is refused, while the kernel's booleans take flat faces only. */
export const CURVED_TOUCHING = "profiles with curved sides can only be extruded together when they don't touch or overlap, or are side by side regions of one sketch, for now: extrude them one at a time";

/**
 * SL #677 item 1: why a Combine or an operation extrude with a round body is refused, in the app's words. `who` is the
 * round one: the body changed, a tool body of a Combine, or the extrude's own shape.
 */
export function roundWords(who: "target" | "tool" | "extrude"): string {
  const round = who === "target" ? "the body it changes has a round face" : who === "tool" ? "a tool body has a round face" : "this extrude has a round side";
  return `${round}. Cut, Join and Intersect work on flat-sided shapes for now; round shapes are coming.`;
}

/** Whether an extrude's spec has a curved side (a circle or an arc in its profile). */
function curvedSpec(spec: BodySpec | null): boolean {
  if (spec === null || !("extrude" in spec)) return true;
  const { outer, holes } = spec.extrude.profile;
  return [outer, ...holes].some((l) => "circle" in l || l.path.bulges.some((b) => b !== 0));
}

/** Whether a group of prisms that may share a face holds one with a curved side (what the kernel refuses for now). */
async function curvedMeeting(prisms: readonly Omit<BuiltBody, "feature">[], cache: BodyCache): Promise<boolean> {
  const boxes = await Promise.all(prisms.map(async (p) => (await cache.view(p.handle)).bounds));
  return contactGroups(boxes).some((g) => g.length > 1 && g.some((i) => curvedSpec(prisms[i].spec)));
}

/**
 * The prisms with each group that may share a face, is of one sketch
 * extruded alike (the same distance, frame, way and curves) and has a
 * curved side (which the kernel's booleans can't join yet) made as the one
 * region its regions tile, where they do (`mergedOutline`); in order, a
 * joined prism where its first was.
 */
async function joinedRegions(prisms: readonly Omit<BuiltBody, "feature">[], cache: BodyCache): Promise<Omit<BuiltBody, "feature">[]> {
  const boxes = await Promise.all(prisms.map(async (p) => (await cache.view(p.handle)).bounds));
  const out: (Omit<BuiltBody, "feature"> | null)[] = [...prisms];
  for (const group of contactGroups(boxes)) {
    const alike = new Map<string, number[]>();
    for (const i of group) {
      const spec = prisms[i].spec;
      if (spec === null || !("extrude" in spec)) continue;
      const { profile: _p, ...how } = spec.extrude;
      const key = JSON.stringify([how, prisms[i].curves ?? null]);
      alike.set(key, [...(alike.get(key) ?? []), i]);
    }
    for (const same of alike.values()) {
      // Flat ones the kernel joins as it always has (merging level faces, each named by every input face it came from).
      if (same.length < 2 || !same.some((i) => curvedSpec(prisms[i].spec))) continue;
      const first = prisms[same[0]].spec as Extract<BodySpec, { extrude: unknown }>;
      const profile = mergedOutline(same.map((i) => (prisms[i].spec as Extract<BodySpec, { extrude: unknown }>).extrude.profile));
      if (profile === null) continue;
      const spec: BodySpec = { extrude: { ...first.extrude, profile } };
      const { curves, profile: k } = prisms[same[0]];
      out[same[0]] = { handle: await cache.body(spec), spec, ...(curves ? { curves } : {}), ...(k !== undefined ? { profile: k } : {}) };
      for (const i of same.slice(1)) out[i] = null;
    }
  }
  return out.filter((p): p is Omit<BuiltBody, "feature"> => p !== null);
}

/**
 * A join of disjoint groups of bodies (an extrude of several profiles'):
 * each group that may share a face joined by the kernel, a body alone in
 * its group kept as it is (every face and edge its own), as one answer.
 */
async function groupedJoin(cache: BodyCache, inputs: readonly NamedBody[], taken: ReadonlySet<BodyHandle>): Promise<BooleanResult> {
  const out: BooleanResult = { bodies: [], history: [] };
  for (const group of contactGroups(inputs.map((x) => x.view.bounds))) {
    if (group.length === 1) {
      const x = inputs[group[0]];
      out.bodies.push(x.handle);
      out.history.push({
        faces: x.view.face_areas.map((_, face) => ({ body: x.handle, face, whole: true, turned: false })),
        edges: x.view.edge_vertices.map((_, edge) => ({ along: [{ body: x.handle, edge, whole: true }], crossing: [] })),
      });
      continue;
    }
    const [t, ...ts] = group.map((i) => inputs[i].handle);
    let r = await cache.boolean(t, ts, "union");
    for (let copy = 1; r.bodies.some((h) => taken.has(h)); copy++) r = await cache.boolean(t, ts, "union", copy);
    out.bodies.push(...r.bodies);
    out.history.push(...r.history);
  }
  return out;
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
