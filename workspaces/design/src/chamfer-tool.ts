// The Chamfer tool's rules (step 44a-app2), pure so they are unit-tested:
// which edges a click picks, what the tool refuses at once in plain words
// (a curved edge, a body with round faces, edges on two bodies, edges that
// meet at a corner), the sizes typed, and each picked edge's design-wide
// held name (design-edges.ts), as the rebuild's `chamferRun` finds it again.
// Anything the kernel itself refuses at OK (a chamfer too big for its edge,
// an inside corner, a sliver) comes back in the kernel's own words through
// the OK's check build. The panel is chamfer-panel.ts; workspace.ts wires it.

import type { BodyView } from "@fission/core";
import { designNames } from "./boolean-names.ts";
import { namedBody } from "./built-body.ts";
import { heldEdgeNames } from "./design-edges.ts";
import { chamferSizeProblem, type ChamferSizing } from "./document.ts";
import type { BuiltBody } from "./rebuild.ts";
import { copyShared } from "./pattern-values.ts";

/** One picked edge: the body it is on (a body id) and its kernel edge index there, as the scene shows it. */
export interface PickedEdge {
  body: string;
  edge: number;
}

/** What a body's view tells the picking. */
export type EdgeFacts = Pick<BodyView, "face_types" | "edge_types" | "edge_faces" | "edge_vertices">;

/** The words for each pick the tool refuses at once. */
export const CURVED_EDGE = "That edge is curved: chamfers on curved edges come with the curved steps. Pick a straight edge.";
export const ROUND_FACES = "That body has round faces (a hole, a cylinder or a sphere): for now only bodies whose faces are all flat can be chamfered.";
export const NOT_BETWEEN = "That edge is not between two faces of the body, so it can't be chamfered.";
export const ONE_BODY = "A chamfer works on one body at a time: pick edges of the same body, or press OK and start another chamfer.";
export const CORNER_SHARED = "That edge meets an edge already picked at a corner: chamfers that meet at a corner come in a later step. Make them as two chamfers for now.";
export const NO_NAME = "That edge has no name of its own (two edges of the design are alike), so a chamfer could not find it again after an edit.";

/** Why edge `edge` of a body whose view is `view` can't be chamfered, in plain words; null when the tool takes it. */
export function edgeRefusal(view: EdgeFacts, edge: number): string | null {
  if (!Number.isInteger(edge) || edge < 0 || edge >= view.edge_types.length) return NOT_BETWEEN;
  if (view.edge_types[edge] !== "line") return CURVED_EDGE;
  if (view.face_types.some((t) => t !== "plane")) return ROUND_FACES;
  if (view.edge_faces[edge] == null) return NOT_BETWEEN;
  return null;
}

/** Whether edges `a` and `b` of one body share an end (a corner). */
export function shareCorner(view: Pick<BodyView, "edge_vertices">, a: number, b: number): boolean {
  const ea = view.edge_vertices[a];
  const eb = view.edge_vertices[b];
  if (ea === undefined || eb === undefined) return false;
  return ea.some((v) => eb.includes(v));
}

/**
 * The picks after a click on `hit` (whose body's view is `view`): an edge
 * already picked is taken out; any other is added at the end, unless it is
 * on another body than the edges picked, can't be chamfered (`edgeRefusal`)
 * or meets a picked edge at a corner, when the picks stay and `refused` says why.
 */
export function togglePick(picks: readonly PickedEdge[], hit: PickedEdge, view: EdgeFacts): { picks: PickedEdge[]; refused: string | null } {
  const at = picks.findIndex((p) => p.body === hit.body && p.edge === hit.edge);
  if (at >= 0) return { picks: picks.filter((_, i) => i !== at), refused: null };
  if (picks.length > 0 && picks[0].body !== hit.body) return { picks: [...picks], refused: ONE_BODY };
  const why = edgeRefusal(view, hit.edge);
  if (why !== null) return { picks: [...picks], refused: why };
  if (picks.some((p) => shareCorner(view, p.edge, hit.edge))) return { picks: [...picks], refused: CORNER_SHARED };
  return { picks: [...picks, hit], refused: null };
}

/**
 * The picks that a list of edges (the selection's, in order) gives when
 * taken one by one as clicks (`togglePick`), each edge once; the first
 * refusal, if any, says why an edge was left out.
 */
export function picksFrom(edges: readonly PickedEdge[], viewOf: (body: string) => EdgeFacts | null): { picks: PickedEdge[]; refused: string | null } {
  let picks: PickedEdge[] = [];
  let refused: string | null = null;
  for (const e of edges) {
    if (picks.some((p) => p.body === e.body && p.edge === e.edge)) continue;
    const view = viewOf(e.body);
    if (view === null) continue;
    const next = togglePick(picks, e, view);
    picks = next.picks;
    refused ??= next.refused;
  }
  return { picks, refused };
}

/** The chamfer's three ways to give its size, as Fusion's: one distance both ways, two distances, a distance and an angle. */
export type ChamferKind = "equal" | "two" | "angle";
export const CHAMFER_KINDS: readonly ChamferKind[] = ["equal", "two", "angle"];
export const KIND_WORDS: Record<ChamferKind, string> = { equal: "Equal distance", two: "Two distances", angle: "Distance and angle" };

/** The default size of a new chamfer (mm), and the default angle (degrees). */
export const DEFAULT_CHAMFER = 1;
export const DEFAULT_ANGLE = 45;

/** A number typed as the size boxes give it (millimetres or degrees as text): read strictly, never by Number ("0x10", "Infinity"). */
function strict(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The size typed, as a Chamfer holds it, or why not in plain words:
 * `first` the distance (mm), `second` the second distance (mm) or the
 * angle (degrees) by `kind`. Empty boxes and text that is no number are
 * refused; a number the data can't hold is refused in `chamferSizeProblem`'s words.
 */
export function readChamferSize(kind: ChamferKind, first: string, second: string): { size: ChamferSizing } | { why: string } {
  const d = strict(first);
  if (d === null) return { why: first.trim() === "" ? "Type the chamfer's distance in mm." : `"${first.trim()}" is not a distance: type the chamfer's distance in mm.` };
  if (kind === "equal") {
    const problem = chamferSizeProblem({ distance: d });
    return problem === null ? { size: { equal: d } } : { why: `The chamfer can't be made: ${problem}.` };
  }
  const s = strict(second);
  const what = kind === "two" ? "second distance in mm" : "angle in degrees";
  if (s === null) return { why: second.trim() === "" ? `Type the chamfer's ${what}.` : `"${second.trim()}" is not a number: type the chamfer's ${what}.` };
  const params = kind === "two" ? { distance: d, second: s } : { distance: d, angle: s };
  const problem = chamferSizeProblem(params);
  if (problem !== null) return { why: `The chamfer can't be made: ${problem}.` };
  return { size: kind === "two" ? { two: [d, s] } : { angle: [d, s] } };
}

/** What the panel's Edges row says: "1 edge", "3 edges", or how to pick them (by touch: Tap). */
export function edgesWords(count: number, touch: boolean): string {
  if (count === 0) return touch ? "Tap the edges to chamfer" : "Click the edges to chamfer";
  return count === 1 ? "1 edge" : `${count} edges`;
}

/** The hint over the view while no edge is picked. */
export function chamferHintWords(bodies: number): string {
  if (bodies === 0) return "Chamfer needs a body: make one first with Insert or Extrude";
  return "Chamfer: click or tap the straight edges to cut back";
}

/**
 * Each picked edge's held design-wide name (design-edges.ts), named as the
 * rebuild's `chamferRun` names them: every body of the build (`bodies`, by
 * body id, as rebuilt up to the marker, where the Chamfer goes in) named as
 * one by `designNames`, each body's view from `view`. Null for an edge
 * with no name of its own, or a body the build does not hold, or a name
 * made from the names of a copy of a Pattern in `copied` (`copyShared`).
 */
export async function heldNamesOf(bodies: Readonly<Record<string, BuiltBody>>, view: (b: BuiltBody) => Promise<BodyView>, picks: readonly PickedEdge[], copied: ReadonlySet<string> = new Set()): Promise<(string | null)[]> {
  const ids = Object.keys(bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, bodies[k], await view(bodies[k]), 0)));
  const names = designNames(list);
  return picks.map((p) => {
    const at = ids.indexOf(p.body);
    const name = at < 0 ? null : (heldEdgeNames(names, at)[p.edge] ?? null);
    return name !== null && copyShared(p.body, name, copied) ? null : name; // a Pattern copy's: shared by the copies (A1-2)
  });
}
