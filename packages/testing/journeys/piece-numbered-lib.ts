// Helpers of the piece-numbered-move journeys (app-wide hunt 2026-11-14, T-2): the live app against a fresh rebuild of
// its saved design, and undo then redo against forward.
import assert from "node:assert/strict";
import { projectFromJson, projectToJson, emptyProject, type DisplayMesh } from "@fission/core";
import { BodyCache, builtPieceFaces, designWorkspace, followedDoc, numberPieces, rebuildTimeline, type DesignDocument } from "@fission/design";
import { app, kernel, meshVolume } from "./design-app.ts";

export type App = Awaited<ReturnType<typeof app>>;
export type Box3 = number[][];
export const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
export interface Built {
  /** id → volume and bounds, of every body the rebuild leaves. */
  bodies: Map<string, { volume: number; bounds: Box3 }>;
  /** The design after the app's own take-in loop (pieces numbered, Moves taking pieces). */
  doc: DesignDocument;
  /** Rebuild rounds it took until the design stopped changing. */
  rounds: number;
  /** Each item's status. */
  status: Record<string, string>;
  total: number;
}

/** `doc` saved, opened afresh and rebuilt until settled, as the app does on open. */
export async function built(doc0: DesignDocument, reopen = true): Promise<Built> {
  let d = reopen ? (projectFromJson(projectToJson({ ...emptyProject("T"), workspaces: { design: doc0 } }), [designWorkspace]).workspaces.design as DesignDocument) : doc0;
  const cache = new BodyCache(kernel);
  try {
    let build = await rebuildTimeline(d, cache, kernel);
    let rounds = 1;
    for (let i = 0; i < 6; i++) {
      const next = numberPieces(followedDoc(d, build), Object.keys(build.bodies), builtPieceFaces(build));
      if (next === d) break;
      d = next;
      build = await rebuildTimeline(d, cache, kernel);
      rounds++;
    }
    const bodies = new Map<string, { volume: number; bounds: Box3 }>();
    let total = 0;
    for (const [id, b] of Object.entries(build.bodies)) {
      const v = await cache.view(b.handle);
      bodies.set(id, { volume: r6(v.volume), bounds: v.bounds.map((p: number[]) => p.map(r6)) });
      total += v.volume;
    }
    const status: Record<string, string> = {};
    for (const [id, r] of Object.entries(build.results)) status[id] = r.status;
    return { bodies, doc: d, rounds, status, total };
  } finally {
    await cache.close();
  }
}

/** The design as text with every object's keys sorted (key order in memory is not a difference). */
const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);
export const text = (d: DesignDocument) => JSON.stringify(sorted(d));
export const show = (b: Built) => [...b.bodies].map(([id, v]) => `${id} ${v.volume} ${JSON.stringify(v.bounds)}`).join(" | ");

/** The mesh's bounds. */
export function meshBounds(mesh: DisplayMesh | null): Box3 | null {
  if (!mesh || mesh.positions.length === 0) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], mesh.positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], mesh.positions[i]);
  }
  return [lo.map(r6), hi.map(r6)];
}
export function unionBounds(b: Built): Box3 | null {
  if (b.bodies.size === 0) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of b.bodies.values()) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], v.bounds[0][k])), (hi[k] = Math.max(hi[k], v.bounds[1][k]));
  return [lo.map(r6), hi.map(r6)];
}

/**
 * The rules every step must keep, returned as a list of what is broken (empty when fine):
 * 1. the view (the mesh the app last drew) holds the same volume and bounds as a fresh open of the saved design;
 * 2. a fresh open of the saved design changes nothing in it (no more pieces to number, no Move with more to take).
 */
export async function liveAgainstFile(a: App, where: string): Promise<string[]> {
  const bad: string[] = [];
  const doc = a.doc();
  const b = await built(doc);
  const liveV = a.mesh() ? meshVolume(a.mesh()!) : 0;
  if (Math.abs(liveV - b.total) > 1e-6 * Math.max(1, Math.abs(b.total))) bad.push(`${where}: the view holds ${r6(liveV)} mm³ but the saved design opens as ${r6(b.total)} mm³ (${show(b)})`);
  const lb = meshBounds(a.mesh()), fb = unionBounds(b);
  if (JSON.stringify(lb) !== JSON.stringify(fb)) bad.push(`${where}: the view's bounds ${JSON.stringify(lb)} but the saved design opens with ${JSON.stringify(fb)}`);
  const reread = projectFromJson(projectToJson({ ...emptyProject("T"), workspaces: { design: doc } }), [designWorkspace]).workspaces.design as DesignDocument;
  if (text(b.doc) !== text(reread)) {
    const x = text(reread), y = text(b.doc);
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    bad.push(`${where}: opening the saved design changed it at ${i}: «${x.slice(Math.max(0, i - 100), i + 160)}» became «${y.slice(Math.max(0, i - 100), i + 160)}»`);
  }
  return bad;
}

/** Undo then Redo: the same design text and the same solids as before; what is broken. */
export async function undoRedoSame(a: App, where: string): Promise<string[]> {
  const bad: string[] = [];
  const before = text(a.doc());
  const v = a.volume(), bb = JSON.stringify(meshBounds(a.mesh()));
  if (!a.history.canUndo()) return bad;
  await a.undo();
  await a.redo();
  if (text(a.doc()) !== before) {
    const x = before, y = text(a.doc());
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    bad.push(`${where}: Undo then Redo changed the design at ${i}: «${x.slice(Math.max(0, i - 100), i + 160)}» became «${y.slice(Math.max(0, i - 100), i + 160)}»`);
  }
  if (Math.abs(a.volume() - v) > 1e-6 * Math.max(1, v)) bad.push(`${where}: Undo then Redo changed the volume ${r6(v)} → ${r6(a.volume())}`);
  if (JSON.stringify(meshBounds(a.mesh())) !== bb) bad.push(`${where}: Undo then Redo changed the bounds ${bb} → ${JSON.stringify(meshBounds(a.mesh()))}`);
  return bad;
}

export async function check(a: App, where: string, undo = true) {
  const bad = [...(await liveAgainstFile(a, where)), ...(undo ? await undoRedoSame(a, where) : [])];
  assert.deepEqual(bad, [], bad.join("\n"));
}

export async function setBox(a: App, sel: string, value: string) {
  const box = a.$(sel) as HTMLInputElement;
  assert.ok(box, `box ${sel}`);
  box.value = value;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}
export async function editMove(a: App, id: string, v: Record<string, string>) {
  await a.doubleClick(id);
  for (const [axis, val] of Object.entries(v)) await setBox(a, `#move-${axis}`, val);
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
}
/** Edit feature on `id`: the size boxes by key (width, depth, height), Symmetric when given, then OK. Cut-ask answered `go`. */
export async function editFeatureUI(a: App, id: string, sizes: Record<string, string>, symmetric?: boolean, go = true) {
  assert.equal(await a.menu(id, "edit"), null);
  for (const [k, val] of Object.entries(sizes)) await setBox(a, `#edit-${k}`, val);
  if (symmetric !== undefined) {
    const t = a.$("#edit-symmetric") as HTMLInputElement;
    assert.ok(t, "Edit has Symmetric");
    if (t.checked !== symmetric) {
      t.click();
      await a.settle();
    }
  }
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  const ask = a.$("#cut-ask-go") as HTMLButtonElement | null;
  if (ask && ask.closest("dialog")?.hasAttribute("open")) {
    (go ? ask : (a.$("#cut-ask-cancel") as HTMLButtonElement)).click();
    await a.settle();
  }
}
export const order = (a: App) => a.doc().timeline.features.map((f) => f.id);
export const failedItems = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".timeline-bar-item[data-failed]")].map((li) => li.dataset.item);
export const labels = (a: App) => a.doc().timeline.features.map((f) => `${f.id}:${f.provenance.self.label}`);

import { joinBodies, shownBodies, sketchSpot, addFaceSketch, drawRectangle, extrudeSketch } from "@fission/design";
/** The app's Create-sketch spot on the flat face of body `bodyId` whose normal and middle pass `on`. */
export async function faceSpot(doc: DesignDocument, bodyId: string, on: (n: number[], c: number[]) => boolean) {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const shown = await shownBodies(doc, build, cache);
    const scene = joinBodies(shown, build);
    const b = shown.findIndex((x) => x.body === bodyId);
    if (b < 0) throw new Error(`no body ${bodyId} among ${shown.map((x) => x.body).join(", ")}`);
    const body = shown[b];
    const f = body.view.face_normals.findIndex((n: number[] | null, i: number) => n !== null && on(n, body.view.face_centroids[i]));
    if (f < 0) throw new Error(`no such face on ${bodyId}: normals ${JSON.stringify(body.view.face_normals)} middles ${JSON.stringify(body.view.face_centroids)}`);
    const spot = sketchSpot({ face: scene.faceStart[b] + f, shift: false } as never, scene);
    if (spot?.kind !== "face") throw new Error(`face refused: ${JSON.stringify(spot)}`);
    return spot;
  } finally {
    await cache.close();
  }
}
/** A sketch on that face with the rectangle a..c (sketch coordinates) extruded `distance`: the new design and ids. */
export async function blockOn(doc: DesignDocument, bodyId: string, on: (n: number[], c: number[]) => boolean, a: [number, number], c: [number, number], distance: number, choice: Parameters<typeof extrudeSketch>[5] = null) {
  const spot = await faceSpot(doc, bodyId, on);
  const sk = addFaceSketch(doc, spot.face, spot.drawn);
  const ex = extrudeSketch(drawRectangle(sk.doc, sk.id, a, c).doc, sk.id, distance, false, undefined, choice);
  return { doc: ex.doc, sketch: sk.id, extrude: ex.id };
}
