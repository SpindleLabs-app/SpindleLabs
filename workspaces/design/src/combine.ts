// Combine (step 35f1): Join, Cut or Intersect of a target body with tool
// bodies, as a timeline item (document.ts `isCombineItem`); built in the
// rebuild (rebuild.ts `combineRun`), named by boolean-names.ts. Here: the
// item put in at the marker, and changed. The rules a Combine follows are
// the kernel repo's booleans plan, "Behaviour questions, answered": tools
// applied in the order picked, Keep tools off by default (Fusion's), the
// target's piece keeping its id.

import type { Feature } from "@fission/core";
import { bodyItem, bodyNumbers, combineBodies, COMBINE_OPERATIONS, counted, freshName, insertAt, insertItem, isCombineItem, isPiece, makesBody, makesPieces, numberedWhenBuilt, shown, takenNames, type CombineOperation, type DesignDocument } from "./document.ts";

/** The undo step a new Combine is recorded as. */
export const COMBINE_STEP = "Combine bodies";

/** What the panel calls each operation. */
export const OPERATION_WORDS: Record<CombineOperation, string> = { join: "Join", cut: "Cut", intersect: "Intersect" };

/** A Combine's description: "Cut Box 2 from Box 1", "Join Box 2 and Box 3 to Box 1", "Intersect Box 1 with Box 2". */
export function combineSummary(target: string, tools: readonly string[], operation: CombineOperation, keepTools: boolean): string {
  const list = tools.length === 1 ? tools[0] : `${tools.slice(0, -1).join(", ")} and ${tools.at(-1)}`;
  const words = operation === "cut" ? `Cut ${list} from ${target}` : operation === "join" ? `Join ${list} to ${target}` : `Intersect ${target} with ${list}`;
  return keepTools ? `${words}, keeping the tools` : words;
}

/** A body's name as the browser shows it ("Body 2"), or undefined when it has no number. */
const numberOf = (doc: DesignDocument, body: string): string | undefined => {
  const n = bodyNumbers(doc).get(body);
  return n === undefined ? undefined : `Body ${n}`;
};

/** Whether the data numbers this piece (a Combine's pieces are numbered when they first appear). */
const numbered = (doc: DesignDocument, body: string) => (doc.bodies ?? []).some((b) => b.id === body);

/**
 * Each picked body's item for a Combine, target first: refused for
 * anything that is no body of the design in range before the marker (a
 * bare item id included), a body picked twice, the target among the tools,
 * and no tools.
 */
function itemsFor(doc: DesignDocument, target: string, tools: readonly string[], end = insertAt(doc), at = "the rollback marker, so a Combine put in at the marker"): Feature[] {
  if (tools.length === 0) throw new Error("pick at least one tool body");
  if (tools.includes(target)) throw new Error(`${shown(target)} is the target, so it can't be a tool too`);
  const bodies = [target, ...tools];
  return bodies.map((b, i) => {
    // Named as the browser shows it ("Body 2"), when it has a number (hunt 11-08).
    if (bodies.indexOf(b) !== i) throw new Error(`${numberOf(doc, b) ?? shown(b)} is picked twice`);
    const item = bodyItem(b);
    const place = item === null ? -1 : doc.timeline.features.findIndex((f) => f.id === item);
    const f = doc.timeline.features[place];
    if (f === undefined || !(numberedWhenBuilt(b, f) ? makesPieces(f) && numbered(doc, b) : makesBody(f))) throw new Error(`${shown(b)} is not a body in the design`);
    if (place >= end) throw new Error(`${f.provenance.self.label} comes after ${at} can't use it`);
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
  const feature: Feature = { id, ...combineFields(target, tools, operation, keepTools, items), provenance: { self: { workspace: "design", id, label }, from: fromOf(items) }, suppressed: false };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}

/** The items a Combine's bodies come from, each once, as its provenance names them. */
const fromOf = (items: readonly Feature[]) => [...new Map(items.map((f) => [f.id, { workspace: "design" as const, id: f.id, label: f.provenance.self.label }])).values()];

/** A Combine's intent and dependencies for these bodies (their items `items`, target first). */
function combineFields(target: string, tools: readonly string[], operation: CombineOperation, keepTools: boolean, items: readonly Feature[]): Pick<Feature, "intent" | "dependsOn"> {
  const [t, ...ts] = [target, ...tools].map((b, i) => bodyWords(b, items[i]));
  return { intent: { type: "combine", parameters: { target, tools: [...tools], operation, keepTools }, summary: combineSummary(t, ts, operation, keepTools) }, dependsOn: [...new Set(items.map((f) => f.id))] };
}

/**
 * The design with Combine `id` changed to these bodies and choices, in its
 * place (its id and name kept): refused as `insertCombine` refuses, a body
 * made after the Combine counting as one after the marker does. Choices
 * that change nothing give back the same design. A change forgets the
 * faces `forget` (the pieces the last build warned had changed, hunt
 * 11-06) were numbered with, so the next build records them afresh:
 * editing the Combine is how the person confirms those pieces as they are,
 * and its warning goes. Every other piece keeps its faces, so none whose
 * faces still match moves to another number.
 */
export function changedCombine(doc: DesignDocument, id: string, target: string, tools: readonly string[], operation: CombineOperation, keepTools: boolean, forget: readonly string[] = []): DesignDocument {
  const at = doc.timeline.features.findIndex((f) => f.id === id);
  const old = doc.timeline.features[at];
  if (old === undefined || !isCombineItem(old)) throw new Error(`there is no Combine ${shown(id)} in the design`);
  if (!(COMBINE_OPERATIONS as readonly string[]).includes(operation)) throw new Error(`${shown(operation)} is not join, cut or intersect`);
  const was = combineBodies(old);
  if (was.target === target && was.tools.join() === tools.join() && was.operation === operation && was.keepTools === keepTools) return doc;
  if (was.target === target && was.tools.join() === tools.join() && [target, ...tools].every((b) => bodyItem(b) !== null)) {
    // Only the operation or Keep tools changed: the bodies stay as picked, even one whose item is gone now (the Combine
    // says so when it fails), so that choice is never refused for it; their words from the Combine's provenance.
    const words = (b: string) => {
      const item = bodyItem(b)!; // a body id, checked above (a broken one from a file goes on to be refused in words)
      const label = old.provenance.from.find((x) => x.id === item)?.label ?? item;
      return isPiece(b) ? `a piece of ${label}` : label;
    };
    const [t, ...ts] = [target, ...tools].map(words);
    const intent = { ...old.intent, parameters: { ...old.intent.parameters, operation, keepTools }, summary: combineSummary(t, ts, operation, keepTools) };
    return forgetPieces({ ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === id ? { ...old, intent } : f)) } }, id, forget);
  }
  const items = itemsFor(doc, target, tools, at, `${old.provenance.self.label}, so it`);
  const changed: Feature = { ...old, ...combineFields(target, tools, operation, keepTools, items), provenance: { ...old.provenance, from: fromOf(items) } };
  return forgetPieces({ ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === id ? changed : f)) } }, id, forget);
}

/** The design with the remembered faces of item `id`'s pieces in `forget` dropped (hunt 11-06), their numbers kept: a Combine's, or an operation extrude's (its edit confirms them, as a Combine's does). */
export function forgetPieces(doc: DesignDocument, id: string, forget: readonly string[]): DesignDocument {
  // An Extrude Join's own body too (version 16): it is remembered as its pieces are.
  const ours = (b: { id: string; faces?: string[] }) => b.faces !== undefined && (isPiece(b.id) || b.id === `body:${id}`) && bodyItem(b.id) === id && forget.includes(b.id);
  if (!doc.bodies?.some(ours)) return doc;
  return { ...doc, bodies: doc.bodies.map((b) => (ours(b) ? { id: b.id, number: b.number } : b)) };
}
