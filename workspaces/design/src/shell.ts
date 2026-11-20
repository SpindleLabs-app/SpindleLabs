// Shell (step 35h2c): one body hollowed out, walls of one thickness inside
// it, the faces picked left open, as a timeline item (document.ts
// `isShellItem`, Design data version 27); built in the rebuild (rebuild.ts
// `shellRun`) by the kernel's shell. Here: the item put in at the marker,
// its description and its undo step. The open faces are held by their
// design-wide names, as the screen names them, so a Shell finds them again
// after edits before it, whatever made the body. The tool is shell-tool.ts
// and shell-panel.ts (35h2c-app2); Edit feature changes its thickness here.

import { notABody } from "./body-uses.ts";
import type { Feature } from "@fission/core";
import { bodyItem, counted, shellOf, freshName, insertAt, insertItem, isPiece, isShellItem, makesBody, makesPieces, numberedWhenBuilt, shellThicknessProblem, shown, takenNames, type DesignDocument } from "./document.ts";
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
  if (maker === undefined || !(numberedWhenBuilt(body, maker) ? makesPieces(maker) && (doc.bodies ?? []).some((b) => b.id === body) : makesBody(maker))) throw new Error(notABody(doc, body));
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

/** What Edit feature on a Shell opens with (35h2c-app2): its name, how many faces it leaves open, and its thickness. */
export interface EditableShell {
  id: string;
  name: string;
  open: number;
  thickness: number;
}

/** Item `id`'s Shell as the panel opens it; refused in words when it is no Shell. */
export function editableShell(doc: DesignDocument, id: string): EditableShell {
  const f = doc.timeline.features.find((x) => x.id === id);
  if (f === undefined || !isShellItem(f)) throw new Error(`${shown(id)} is not a Shell in the timeline`);
  const s = shellOf(f);
  return { id, name: f.provenance.self.label, open: s.faces.length, thickness: s.thickness };
}

/** The words over an edited Shell's open faces: they stay as they were picked. */
export const EDIT_FACES_NOTE = "Its open faces stay as they were picked: to open other faces, make another Shell.";

/**
 * The design with Shell `id` given walls `thickness` mm thick (Edit
 * feature): the same item, keeping its id, place, body, open faces, name and
 * flags; its summary said again. The document itself comes back when the
 * thickness is the same, so nothing is recorded. Refused in words for a
 * thickness the data can't hold, as `insertShell` refuses it.
 */
export function changedShell(doc: DesignDocument, id: string, thickness: number): DesignDocument {
  const at = doc.timeline.features.findIndex((x) => x.id === id);
  const f = doc.timeline.features[at];
  if (f === undefined || !isShellItem(f)) throw new Error(`${shown(id)} is not a Shell in the timeline`);
  const problem = shellThicknessProblem(thickness);
  if (problem !== null) throw new Error(`The shell can't be made: ${problem}`);
  const now = shellOf(f);
  if (now.thickness === thickness) return doc;
  const maker = f.provenance.from[0]?.label ?? f.dependsOn[0];
  const what = isPiece(now.body) ? `a piece of ${maker}` : maker;
  const changed: Feature = { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, thickness }, summary: shellSummary(what, now.faces.length, thickness) } };
  const features = [...doc.timeline.features];
  features[at] = changed;
  return { ...doc, timeline: { ...doc.timeline, features } };
}
