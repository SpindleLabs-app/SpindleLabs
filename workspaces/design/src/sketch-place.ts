// The bodies as a sketch sees them (timeline hunt 2026-11-11, #540 item 1): a
// sketch's pinned points and projections follow the bodies as built at its own
// place in the timeline (rebuild.ts `follow`), so while it is edited the bodies
// made before it are drawn, snapped to and projected from there too: each taken
// back through the built Moves after the sketch that move it (last first), as
// move-tool.ts `editedMoveMesh` takes a body back. Bodies made after the sketch
// (offered nothing: face-edges.ts, projection.ts) stay as built. The scene keeps
// its bodies, their order and every index, so a pick on the drawn mesh names
// the same face or edge.

import type { BodyView, Feature } from "@fission/core";
import { isMoveItem, type DesignDocument } from "./document.ts";
import { movedBodies, moveValues, type MoveValues } from "./move.ts";
import { mappedMesh, unmovedPoint, type PointMap } from "./move-tool.ts";
import { madeBy, type Scene, type ShownBody } from "./scene.ts";

type Point = [number, number, number];

/** `view` with every point and direction in it put through `f` (bounds: the box round its corners put through). */
function mappedView(view: BodyView, f: PointMap): BodyView {
  const list = (xs: readonly number[], vector: boolean) => {
    const out = [...xs];
    for (let n = 0; n + 2 < out.length; n += 3) {
      const p = f(out.slice(n, n + 3), vector);
      for (let k = 0; k < 3; k++) out[n + k] = p[k];
    }
    return out;
  };
  const point = (p: readonly number[]) => f(p, false) as Point;
  // Every list mapped where it is there (a view written by hand in a test may leave some out), a null (no centre, a curved face's normal) kept.
  const each = <T extends readonly number[] | null>(xs: readonly T[] | undefined, g: (p: readonly number[]) => Point): T[] => (xs ?? []).map((x) => (x == null ? x : (g(x) as unknown as T)));
  const [lo, hi] = view.bounds ?? [[0, 0, 0], [0, 0, 0]];
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => point([c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]));
  const bounds: BodyView["bounds"] = [[0, 1, 2].map((k) => Math.min(...corners.map((p) => p[k]))) as Point, [0, 1, 2].map((k) => Math.max(...corners.map((p) => p[k]))) as Point];
  return {
    ...view,
    mesh: { ...view.mesh, positions: list(view.mesh.positions, false), normals: list(view.mesh.normals, true), edge_lines: list(view.mesh.edge_lines, false) },
    ...(view.bounds ? { bounds } : {}),
    ...(view.face_centroids ? { face_centroids: each(view.face_centroids, point) } : {}),
    ...(view.face_normals ? { face_normals: each(view.face_normals, (n) => f(n, true)) } : {}),
    ...(view.vertex_points ? { vertex_points: each(view.vertex_points, point) } : {}),
    ...(view.edge_middles ? { edge_middles: each(view.edge_middles, point) } : {}),
    ...(view.edge_centres ? { edge_centres: each(view.edge_centres, point) } : {}),
  };
}

/**
 * `scene` (as `doc` built it, `results`) as sketch `sketchId` sees it: each
 * body made before the sketch taken back through the built Moves after it
 * that move it, last first; `scene` itself when none does (or no such sketch).
 */
export function sketchPlaceScene(scene: Scene, doc: DesignDocument, results: Readonly<Record<string, { status: string }>>, sketchId: string): Scene {
  const features = doc.timeline.features;
  const at = features.findIndex((f) => f.id === sketchId);
  if (at < 0) return scene;
  const before = new Set(features.slice(0, at).map((f) => f.id));
  const later: Feature[] = features.slice(at + 1).filter((f) => isMoveItem(f) && results[f.id]?.status === "built");
  const undo = new Map<string, PointMap>();
  for (const b of scene.bodies) {
    if (!before.has(madeBy(b))) continue;
    const moves: MoveValues[] = later.filter((f) => movedBodies(f).includes(b.body)).map(moveValues).reverse();
    if (moves.length > 0) undo.set(b.body, (p, vector) => moves.reduce<Point>((q, m) => unmovedPoint(q, m, vector), [p[0], p[1], p[2]]));
  }
  if (undo.size === 0) return scene;
  const bodies: ShownBody[] = scene.bodies.map((b) => {
    const f = undo.get(b.body);
    return f === undefined ? b : { ...b, view: mappedView(b.view, f) };
  });
  return { ...scene, bodies, mesh: mappedMesh(scene, (body) => undo.get(body) ?? null) };
}
