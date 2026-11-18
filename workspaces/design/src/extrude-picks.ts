// Picking several profiles in the Extrude tool (Ben, 2026-11-11, as
// Fusion's Ctrl-click; Design data version 18). A plain click picks one
// profile in place of all picked; a click with Ctrl, Cmd or Shift held,
// or any tap while the panel's "Pick several" is on (a phone has no
// Ctrl), adds the profile, or takes it away when it is picked already.
// The first picked is the extrude's first profile (its arrow stands on
// it); taking it away makes the next one first. The preview of several is
// each profile's prism drawn together (`joinedView`): the kernel joins
// them only when OK builds the extrude.

import type { BodyView, DisplayMesh } from "@fission/core";
import type { RegionRef } from "./regions.ts";

/** A profile picked in the view: its id there, its sketch and the region of it the extrude saves. */
export interface PickedProfile {
  id: string;
  sketch: string;
  region: RegionRef | null;
}

/** The profiles picked: the first (null for none) and the others in the order picked. */
export interface Picks {
  first: PickedProfile | null;
  more: PickedProfile[];
}

/** The picks after `p` is added, or taken away when it is picked already (by its id in the view). */
export function togglePick(picks: Picks, p: PickedProfile): Picks {
  const all = picks.first === null ? picks.more : [picks.first, ...picks.more];
  const kept = all.filter((q) => q.id !== p.id);
  const next = kept.length === all.length ? [...all, p] : kept;
  return { first: next[0] ?? null, more: next.slice(1) };
}

/** How many profiles are picked. */
export const pickedCount = (picks: Picks): number => (picks.first === null ? 0 : 1 + picks.more.length);

/** What the panel's profile row says: the one profile's name, or "3 selected" for several (as Fusion's). */
export const pickedWords = (picks: Picks, nameOfFirst: string | null): string | null => (pickedCount(picks) > 1 ? `${pickedCount(picks)} selected` : nameOfFirst);

/** What the panel says when a flat face is added to several picks: a face extrudes alone for now. */
export const FACE_ALONE = "A flat face extrudes on its own for now: pick sketch regions to extrude several at once, or click the face without Ctrl to extrude just it.";

/** What OK says with several profiles and Join, Cut or Intersect chosen: those take one profile for now. */
export const ONE_PROFILE_OPERATION = "Join, Cut and Intersect take one profile for now: pick one, or choose New body to extrude them all.";

/** The status line with several profiles picked, all closed. */
export const severalWords = (n: number) => `${n} profiles picked: OK extrudes them as one item. Profiles that touch become one body.`;

/** One display mesh holding every mesh in `meshes`, each's points numbered after the ones before (for drawing only). */
export function joinedMesh(meshes: readonly DisplayMesh[]): DisplayMesh {
  const out: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  for (const m of meshes) {
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    out.normals.push(...m.normals);
    for (const i of m.indices) out.indices.push(base + i);
    out.triangle_faces.push(...m.triangle_faces);
    out.edge_lines.push(...m.edge_lines);
    out.edge_line_edges.push(...m.edge_line_edges);
  }
  return out;
}

/**
 * The preview of several prisms as one view: the first's (its caps stand
 * the arrow on the first profile), with every prism's mesh drawn, the
 * smallest box round all of them, and their volumes added (the volume OK
 * makes when no two profiles overlap, which two regions of one sketch
 * never do).
 */
export function joinedView(views: readonly BodyView[]): BodyView {
  if (views.length === 1) return views[0];
  const [first] = views;
  const low = [0, 1, 2].map((i) => Math.min(...views.map((v) => v.bounds[0][i]))) as [number, number, number];
  const high = [0, 1, 2].map((i) => Math.max(...views.map((v) => v.bounds[1][i]))) as [number, number, number];
  return { ...first, mesh: joinedMesh(views.map((v) => v.mesh)), volume: views.reduce((a, v) => a + v.volume, 0), bounds: [low, high] };
}
