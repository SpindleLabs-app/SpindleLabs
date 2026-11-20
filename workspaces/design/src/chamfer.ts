// Chamfer (step 44a): straight edges of one body cut back flat, as a
// timeline item (document.ts `isChamferItem`, Design data version 24);
// built in the rebuild (rebuild.ts `chamferRun`) by the kernel's chamfer.
// Here: the item put in at the marker, its description and its undo step.
// The edges are held by their design-wide names (design-edges.ts
// `heldEdgeName`, rule 5), as the screen names them, so a Chamfer finds
// them again after edits before it, whatever made the body.

import { notABody } from "./body-uses.ts";
import type { Feature } from "@fission/core";
import { bodyItem, CHAMFER_MAX, chamferOf, chamferSizeProblem, counted, freshName, insertAt, insertItem, isChamferItem, isPiece, makesBody, makesPieces, numberedWhenBuilt, shown, takenNames, type ChamferSizing, type DesignDocument } from "./document.ts";
import { ruleFiveName } from "./design-edges.ts";

/** The undo step a new Chamfer is recorded as. */
export const CHAMFER_STEP = "Chamfer edges";

/** A size in a summary: "2 mm", "2.5 mm"; at most three decimals, as the panels show sizes. */
const mm = (d: number) => `${Number(d.toFixed(3))} mm`;

/** A Chamfer's description: "Chamfer 1 edge of Box 1, 2 mm", "Chamfer 3 edges of Box 1, 2 mm × 3 mm", "…, 2 mm at 30°", ", flipped". */
export function chamferSummary(body: string, edges: number, size: ChamferSizing, flip: boolean): string {
  const how = "equal" in size ? mm(size.equal) : "two" in size ? `${mm(size.two[0])} × ${mm(size.two[1])}` : `${mm(size.angle[0])} at ${Number(size.angle[1].toFixed(3))}°`;
  return `Chamfer ${edges} ${edges === 1 ? "edge" : "edges"} of ${body}, ${how}${flip && !("equal" in size) ? ", flipped" : ""}`;
}

/** A size as a Chamfer's parameters hold it: `distance`, and `second` or `angle` when not equal. */
function sizeParams(size: ChamferSizing): Record<string, number> {
  if ("equal" in size) return { distance: size.equal };
  if ("two" in size) return { distance: size.two[0], second: size.two[1] };
  return { distance: size.angle[0], angle: size.angle[1] };
}

/**
 * The design with a new Chamfer of `edges` (held design-wide edge names,
 * in the order picked) of `body` (a body id) at `size` put in at the
 * marker ("Chamfer 1", its id from the counter), and its id. Refused in
 * words for no edges, an edge given twice or not an edge's name, a size
 * the data can't hold (`chamferSizeProblem`), and a body that is not a
 * body of the design before the marker.
 */
export function insertChamfer(doc: DesignDocument, body: string, edges: readonly string[], size: ChamferSizing, flip = false): { doc: DesignDocument; id: string } {
  if (edges.length === 0) throw new Error("pick at least one edge");
  for (const [i, e] of edges.entries()) {
    if (ruleFiveName(e) === null) throw new Error(`${shown(e)} is not an edge's name`);
    if (edges.indexOf(e) !== i) throw new Error("an edge is picked twice");
  }
  const params = sizeParams(size);
  const problem = chamferSizeProblem(params);
  if (problem !== null) throw new Error(`The chamfer's size can't be used: ${problem}`);
  const item = bodyItem(body);
  const place = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
  const maker = doc.timeline.features[place];
  if (maker === undefined || !(numberedWhenBuilt(body, maker) ? makesPieces(maker) && (doc.bodies ?? []).some((b) => b.id === body) : makesBody(maker))) throw new Error(notABody(doc, body));
  if (place >= insertAt(doc)) throw new Error(`${maker.provenance.self.label} comes after the rollback marker, so a Chamfer put in at the marker can't use it`);
  const id = `feature-${doc.nextId}`;
  const label = freshName("Chamfer", doc.timeline.features.filter(isChamferItem).length, takenNames(doc));
  const what = isPiece(body) ? `a piece of ${maker.provenance.self.label}` : maker.provenance.self.label;
  const feature: Feature = {
    id,
    intent: { type: "chamfer", parameters: { body, edges: [...edges], ...params, flip }, summary: chamferSummary(what, edges.length, size, flip) },
    provenance: { self: { workspace: "design", id, label }, from: [{ workspace: "design", id: maker.id, label: maker.provenance.self.label }] },
    dependsOn: [maker.id],
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}

export { CHAMFER_MAX };

/** What Edit feature on a Chamfer opens with (44a-app3): its name, how many edges it holds, its size and Flip. */
export interface EditableChamfer {
  id: string;
  name: string;
  edges: number;
  size: ChamferSizing;
  flip: boolean;
}

/** Item `id`'s Chamfer as the panel opens it; refused in words when it is no Chamfer. */
export function editableChamfer(doc: DesignDocument, id: string): EditableChamfer {
  const f = doc.timeline.features.find((x) => x.id === id);
  if (f === undefined || !isChamferItem(f)) throw new Error(`${shown(id)} is not a Chamfer in the timeline`);
  const c = chamferOf(f);
  return { id, name: f.provenance.self.label, edges: c.edges.length, size: c.size, flip: c.flip };
}

/** The words over an edited Chamfer's edge count: its edges stay as picked (picking them again with the timeline rolled back is 44a-app4). */
export const EDIT_EDGES_NOTE = "Its edges stay as they were picked: to chamfer other edges, make another Chamfer.";

/**
 * The design with Chamfer `id` given `size` and `flip` (Edit feature,
 * 44a-app3): the same item, keeping its id, place, body, edges, name and
 * flags; its summary said again. Flip means nothing for an equal chamfer
 * and is kept off there. The document itself comes back when nothing
 * changes, so nothing is recorded. Refused in words for a size the data
 * can't hold, as `insertChamfer` refuses it.
 */
export function changedChamfer(doc: DesignDocument, id: string, size: ChamferSizing, flip: boolean): DesignDocument {
  const at = doc.timeline.features.findIndex((x) => x.id === id);
  const f = doc.timeline.features[at];
  if (f === undefined || !isChamferItem(f)) throw new Error(`${shown(id)} is not a Chamfer in the timeline`);
  if (typeof flip !== "boolean") throw new Error(`Flip must be true or false, not ${shown(flip)}`);
  const params = sizeParams(size);
  const problem = chamferSizeProblem(params);
  if (problem !== null) throw new Error(`The chamfer's size can't be used: ${problem}`);
  const now = chamferOf(f);
  const flipped = "equal" in size ? false : flip;
  if (JSON.stringify(now.size) === JSON.stringify(size) && now.flip === flipped) return doc;
  const rest = Object.fromEntries(Object.entries(f.intent.parameters).filter(([k]) => !["distance", "second", "angle", "flip"].includes(k)));
  const maker = f.provenance.from[0]?.label ?? f.dependsOn[0];
  const what = isPiece(now.body) ? `a piece of ${maker}` : maker;
  const changed: Feature = { ...f, intent: { ...f.intent, parameters: { ...rest, ...params, flip: flipped }, summary: chamferSummary(what, now.edges.length, size, flipped) } };
  const features = [...doc.timeline.features];
  features[at] = changed;
  return { ...doc, timeline: { ...doc.timeline, features } };
}
