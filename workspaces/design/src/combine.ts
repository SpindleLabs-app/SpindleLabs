// Combine (step 35f1): Join, Cut or Intersect of a target body with tool
// bodies, as a timeline item (document.ts `isCombineItem`); built in the
// rebuild (rebuild.ts `combineRun`), named by boolean-names.ts. Here: the
// item put in at the marker, and changed. The rules a Combine follows are
// the kernel repo's booleans plan, "Behaviour questions, answered": tools
// applied in the order picked, Keep tools off by default (Fusion's), the
// target's piece keeping its id.

import type { Feature } from "@fission/core";
import { bodyItem, COMBINE_OPERATIONS, counted, freshName, insertAt, insertItem, isCombineItem, isPiece, makesBody, shown, takenNames, type CombineOperation, type DesignDocument } from "./document.ts";

/** What the panel calls each operation. */
export const OPERATION_WORDS: Record<CombineOperation, string> = { join: "Join", cut: "Cut", intersect: "Intersect" };

/** A Combine's description: "Cut Box 2 from Box 1", "Join Box 2 and Box 3 to Box 1", "Intersect Box 1 with Box 2". */
export function combineSummary(target: string, tools: readonly string[], operation: CombineOperation, keepTools: boolean): string {
  const list = tools.length === 1 ? tools[0] : `${tools.slice(0, -1).join(", ")} and ${tools.at(-1)}`;
  const words = operation === "cut" ? `Cut ${list} from ${target}` : operation === "join" ? `Join ${list} to ${target}` : `Intersect ${target} with ${list}`;
  return keepTools ? `${words}, keeping the tools` : words;
}

/** Whether the data numbers this piece (a Combine's pieces are numbered when they first appear). */
const numbered = (doc: DesignDocument, body: string) => (doc.bodies ?? []).some((b) => b.id === body);

/**
 * Each picked body's item for a Combine, target first: refused for
 * anything that is no body of the design in range before the marker (a
 * bare item id included), a body picked twice, the target among the tools,
 * and no tools.
 */
function itemsFor(doc: DesignDocument, target: string, tools: readonly string[]): Feature[] {
  if (tools.length === 0) throw new Error("pick at least one tool body");
  if (tools.includes(target)) throw new Error(`${shown(target)} is the target, so it can't be a tool too`);
  const end = insertAt(doc);
  const bodies = [target, ...tools];
  return bodies.map((b, i) => {
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    const item = bodyItem(b);
    const at = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[at];
    if (f === undefined || !(isPiece(b) ? isCombineItem(f) && numbered(doc, b) : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (at >= end) throw new Error(`${f.provenance.self.label} comes after the rollback marker, so a Combine put in at the marker can't use it`);
    return f;
  });
}

/** A body's words in a summary: its item's name, or "a piece of" the Combine that made it. */
const bodyWords = (b: string, f: Feature) => (isPiece(b) ? `a piece of ${f.provenance.self.label}` : f.provenance.self.label);

/**
 * The design with a new Combine of `target` with `tools` (body ids, in the
 * order picked) put in at the marker ("Combine 1", its id from the
 * counter), and its id. Refused in words for anything `itemsFor` refuses
 * and an operation that isn't one.
 */
export function insertCombine(doc: DesignDocument, target: string, tools: readonly string[], operation: CombineOperation, keepTools = false): { doc: DesignDocument; id: string } {
  if (!(COMBINE_OPERATIONS as readonly string[]).includes(operation)) throw new Error(`${shown(operation)} is not join, cut or intersect`);
  const items = itemsFor(doc, target, tools);
  const id = `feature-${doc.nextId}`;
  const label = freshName("Combine", doc.timeline.features.filter(isCombineItem).length, takenNames(doc));
  const [t, ...ts] = [target, ...tools].map((b, i) => bodyWords(b, items[i]));
  const feature: Feature = {
    id,
    intent: { type: "combine", parameters: { target, tools: [...tools], operation, keepTools }, summary: combineSummary(t, ts, operation, keepTools) },
    provenance: { self: { workspace: "design", id, label }, from: [...new Map(items.map((f) => [f.id, { workspace: "design" as const, id: f.id, label: f.provenance.self.label }])).values()] },
    dependsOn: [...new Set(items.map((f) => f.id))],
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}
