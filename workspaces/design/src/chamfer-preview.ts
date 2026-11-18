// The Chamfer's live preview (step 44a-app3): before OK, the body drawn as
// the kernel would chamfer it at the size typed, in place of the body as it
// is. The kernel's own chamfer of the body shown (never a guess drawn over
// it), asked once per picks and size, its display mesh kept and the
// chamfered body freed at once, so a preview holds nothing in the kernel.
// For an edited Chamfer the body it was made from (the rebuild's `holds`)
// is chamfered again with its edges as the rebuild found them, while no
// later item has changed the body (else the preview would draw a body no
// longer shown: `editPreviewInput`). The tool still picks edges while the
// preview is drawn, and the view answers a click by the drawn mesh's face
// and edge numbers, so the preview is drawn numbered as the body it stands
// for (`pickableView`): a face kept from the body by that face, an edge by
// the body's edge it lies on (the bodies Chamfer takes have only straight
// edges, so a trimmed edge lies on its old one), the chamfer's own edges by
// the edge it cut, and each chamfer's face by a number after the body's own
// (`cuts` says which edge it cut), so a click on it takes that edge out
// again. Only face numbers after the previewed body's move on by those; the
// edges keep the scene's numbers throughout, and the tool reads a face by
// the drawn layout (`cutAt`).
// The workspace drives it.

import type { BodyHandle, BodyView, ChamferResult, ChamferSize, DisplayMesh, KernelCalls } from "@fission/core";
import { joinBodies, type Scene } from "./scene.ts";

/** What the preview reads of a Chamfer's rebuild result (rebuild.ts `FeatureResult`). */
export interface ChamferBuilt {
  status: string;
  holds?: readonly BodyHandle[];
  chamfered?: { edges: readonly number[]; body: BodyHandle };
}

/** The view of `handle` chamfered on its kernel edges `edges` at `size` and `flip`, and where each face came from; the chamfered body is freed before it returns. A refusal is the kernel's error. */
export async function previewChamfer(kernel: KernelCalls, handle: BodyHandle, edges: readonly number[], size: ChamferSize, flip: boolean): Promise<{ view: BodyView; faces: ChamferResult["faces"] }> {
  const out = await kernel.call("body_chamfer", handle, [...edges], size, flip);
  try {
    return { view: await kernel.call("body_view", out.body), faces: out.faces };
  } finally {
    await kernel.call("body_free", out.body).catch(() => {}); // a kernel restarted meanwhile holds it no more
  }
}

/** The scene's mesh drawn with body `body`'s view swapped for `view` (the preview); the scene itself when it doesn't show that body. */
export function previewedMesh(scene: Scene, body: string, view: BodyView): DisplayMesh {
  if (!scene.bodies.some((b) => b.body === body)) return scene.mesh;
  // Drawn only: the swapped body's names are not the preview's, so no design names go with it and nothing picks on it.
  const drawn = scene.bodies.map((b) => {
    const copy = { ...b, ...(b.body === body && { view }) };
    delete copy.design;
    return copy;
  });
  return joinBodies(drawn).mesh;
}

/** Why an edited Chamfer has no preview: a later item changed its body (its handle now is not the one the Chamfer made). */
export const LATER_CHANGES = "No preview: an item after this Chamfer changes the body, so the result shows after OK.";

/**
 * What an edited Chamfer's preview chamfers: the body as it was before the
 * Chamfer (`holds`) and the kernel edges the rebuild cut, when the body
 * shown now (`now`, its handle in the last build) is still the one the
 * Chamfer made; else why not, or null when the Chamfer did not build.
 */
export function editPreviewInput(result: ChamferBuilt | undefined, now: BodyHandle | undefined): { handle: BodyHandle; edges: number[] } | { why: string } | null {
  if (result?.status !== "built" || result.chamfered === undefined || result.holds === undefined || result.holds.length !== 1) return null;
  if (now !== result.chamfered.body) return { why: LATER_CHANGES };
  return { handle: result.holds[0], edges: [...result.chamfered.edges] };
}

/** How near (mm, a share of the body's size) a preview edge's end must lie to a body edge's line to be on it. */
const ON_EDGE = 1e-9;

/** The distance from `p` to the segment a..b. */
function toSegment(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
  const d = [ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]];
  return Math.hypot(d[0], d[1], d[2]);
}

/**
 * The preview `preview` (whose faces came from `faces`, the kernel's answer)
 * numbered as `body`, the body drawn now, so the view's picks on it are the
 * body's faces and edges: each triangle of a kept face by that face, of the
 * k-th chamfer's face by body.faces + k, whose edge is `cuts[k]`; each edge
 * line by the edge a chamfer's face cut when it borders one, else by the
 * body's edge both its ends lie on; a line matching none is left undrawn
 * (never numbered as another edge). Its volume, area and bounds stay the
 * preview's.
 */
export function pickableView(body: BodyView, preview: BodyView, faces: ChamferResult["faces"]): { view: BodyView; cuts: number[] } {
  const scale = Math.max(1, ...body.bounds.flat().map(Math.abs));
  const cutBy = (f: number): number | null => {
    const from = faces[f];
    return from !== undefined && from.from === "edge" ? from.edge : null;
  };
  const cuts: number[] = [];
  const faceOf = Array.from({ length: preview.faces }, (_, f) => {
    const from = faces[f];
    if (from?.from === "face") return from.face;
    cuts.push(from?.from === "edge" ? from.edge : -1);
    return body.faces + cuts.length - 1;
  });
  const edgeOf = Array.from({ length: preview.edges }, (_, e): number | null => {
    const pair = preview.edge_faces[e];
    const cut = pair === null || pair === undefined ? null : (cutBy(pair[0]) ?? cutBy(pair[1]));
    if (cut !== null) return cut;
    const ends = preview.edge_vertices[e];
    if (ends === undefined) return null;
    const [a, b] = ends.map((v) => preview.vertex_points[v]);
    const on = body.edge_vertices.findIndex(([p, q]) => toSegment(a, body.vertex_points[p], body.vertex_points[q]) <= ON_EDGE * scale && toSegment(b, body.vertex_points[p], body.vertex_points[q]) <= ON_EDGE * scale);
    return on < 0 ? null : on;
  });
  const m = preview.mesh;
  const lines: number[] = [];
  const lineEdges: number[] = [];
  m.edge_line_edges.forEach((e, k) => {
    const to = edgeOf[e];
    if (to === null || to === undefined) return;
    lines.push(...m.edge_lines.slice(6 * k, 6 * k + 6));
    lineEdges.push(to);
  });
  const mesh: DisplayMesh = { ...m, triangle_faces: m.triangle_faces.map((f) => faceOf[f] ?? 0), edge_lines: lines, edge_line_edges: lineEdges };
  return { view: { ...preview, mesh, faces: body.faces + cuts.length, edges: body.edges }, cuts };
}

/**
 * The edge a click on face `face` (numbered as the drawn mesh numbers it)
 * takes out, when that face is a previewed chamfer's: the faces before the
 * previewed body counted from the scene's bodies as drawn (`drawn` for it),
 * then its own; null for any other face.
 */
export function cutAt(scene: Scene, body: string, drawn: { view: BodyView; cuts: readonly number[] }, face: number): number | null {
  const at = scene.bodies.findIndex((b) => b.body === body);
  if (at < 0) return null;
  const start = scene.bodies.slice(0, at).reduce((n, b) => n + b.view.faces, 0);
  const k = face - start - (drawn.view.faces - drawn.cuts.length);
  const cut = k >= 0 && k < drawn.cuts.length ? drawn.cuts[k] : -1;
  return cut >= 0 ? cut : null;
}
