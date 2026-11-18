// Shell (step 35h2c): one body hollowed out, walls of one thickness inside
// it, the faces picked left open, as a timeline item (document.ts
// `isShellItem`, Design data version 27); built in the rebuild (rebuild.ts
// `shellRun`) by the kernel's shell. Here: the item put in at the marker,
// its description and its undo step. The open faces are held by their
// design-wide names, as the screen names them, so a Shell finds them again
// after edits before it, whatever made the body. No tool yet (35h2c-app2).

import type { Feature } from "@fission/core";
import { bodyItem, counted, freshName, insertAt, insertItem, isPiece, isShellItem, makesBody, makesPieces, numberedWhenBuilt, shellThicknessProblem, shown, takenNames, type DesignDocument } from "./document.ts";
import { faceFeature, isFacePlane } from "./face-sketch.ts";

/** The undo step a new Shell is recorded as. */
export const SHELL_STEP = "Shell body";

/** A thickness in a summary: "1 mm", "0.5 mm"; at most three decimals, as the panels show sizes. */
const mm = (d: number) => `${Number(d.toFixed(3))} mm`;

/** A Shell's description: "Shell Box 1, 1 mm walls, 1 face open", "…, 2 faces open", "…, sealed". */
export function shellSummary(body: string, open: number, thickness: number): string {
  return `Shell ${body}, ${mm(thickness)} walls, ${open === 0 ? "sealed" : `${open} ${open === 1 ? "face" : "faces"} open`}`;
}

/**
 * The design with a new Shell of `body` (a body id) with walls `thickness`
 * mm thick and `faces` (held face names, in the order picked; none for a
 * sealed hollow) left open, put in at the marker ("Shell 1", its id from
 * the counter), and its id. Refused in words for a face given twice or not
 * a face's name, a thickness the data can't hold (`shellThicknessProblem`),
 * and a body that is not a body of the design before the marker.
 */
export function insertShell(doc: DesignDocument, body: string, faces: readonly string[], thickness: number): { doc: DesignDocument; id: string } {
  for (const [i, face] of faces.entries()) {
    if (!isFacePlane(face) || faceFeature(face) === null) throw new Error(`${shown(face)} is not a face's name`);
    if (faces.indexOf(face) !== i) throw new Error("a face is picked twice");
  }
  const problem = shellThicknessProblem(thickness);
  if (problem !== null) throw new Error(`The shell can't be made: ${problem}`);
  const item = bodyItem(body);
  const place = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
  const maker = doc.timeline.features[place];
  if (maker === undefined || !(numberedWhenBuilt(body, maker) ? makesPieces(maker) && (doc.bodies ?? []).some((b) => b.id === body) : makesBody(maker))) throw new Error(`${shown(body)} is not a body in the design`);
  if (place >= insertAt(doc)) throw new Error(`${maker.provenance.self.label} comes after the rollback marker, so a Shell put in at the marker can't use it`);
  const id = `feature-${doc.nextId}`;
  const label = freshName("Shell", doc.timeline.features.filter(isShellItem).length, takenNames(doc));
  const what = isPiece(body) ? `a piece of ${maker.provenance.self.label}` : maker.provenance.self.label;
  const feature: Feature = {
    id,
    intent: { type: "shell", parameters: { body, faces: [...faces], thickness }, summary: shellSummary(what, faces.length, thickness) },
    provenance: { self: { workspace: "design", id, label }, from: [{ workspace: "design", id: maker.id, label: maker.provenance.self.label }] },
    dependsOn: [maker.id],
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}
