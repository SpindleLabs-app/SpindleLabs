/**
 * An item's description said again from its own parameters, every other item in it named as its provenance names
 * that item now (SL #819, E-1/B-1). Rename uses it to change the names in the descriptions of the items made from the
 * renamed one, never by replacing text: renaming "Box" must leave "Cut Box 2 from Box" as "Cut Box 2 from Plate", and
 * an item named "XY" or "5" must not change a plane's name or a number.
 */
import type { Feature } from "@fission/core";
import { combineSummary } from "./combine.ts";
import { chamferSummary } from "./chamfer.ts";
import { bodyItem, isChamferItem, isCombineItem, isDuplicateItem, isMoveItem, isPatternItem, isPiece, isShellItem, isSketchItem } from "./document.ts";
import { duplicateSummary } from "./duplicate.ts";
import { extrudeSummaryOf } from "./extrude.ts";
import { moveSummary, moveValues } from "./move.ts";
import { patternSummary } from "./pattern.ts";
import { patternValuesOf } from "./pattern-values.ts";
import { shellSummary } from "./shell.ts";
import type { CombineOperation } from "./document.ts";
import type { SketchPlane } from "./document.ts";

/** Item `id`'s name as `f`'s provenance holds it, or the id when it holds none. */
const labelIn = (f: Feature, id: string) => f.provenance.from.find((p) => p.id === id)?.label ?? id;
/** A body's words in a description: its item's name, or "a piece of" it for a piece (combine.ts, move.ts and the rest). */
const bodyIn = (f: Feature, body: string) => {
  const name = labelIn(f, bodyItem(body) ?? body);
  return isPiece(body) ? `a piece of ${name}` : name;
};
const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * `f`'s description said from its parameters and its provenance's names, or null for a kind whose description names
 * no other item (a preset, a construction) or that this does not know. The caller compares it with the description
 * as saved before trusting it (`renamedSummary`).
 */
export function summaryNamed(f: Feature): string | null {
  const p = f.intent.parameters;
  if (isCombineItem(f)) {
    const tools = Array.isArray(p.tools) ? (p.tools as string[]) : [];
    return combineSummary(bodyIn(f, text(p.target)), tools.map((b) => bodyIn(f, b)), p.operation as CombineOperation, p.keepTools === true);
  }
  if (isMoveItem(f)) {
    const bodies = Array.isArray(p.bodies) ? (p.bodies as string[]) : [];
    const verb = f.intent.summary.startsWith("Rotate ") ? "Rotate" : f.intent.summary.startsWith("Scale ") ? "Scale" : "Move";
    return moveSummary(bodies.map((b) => labelIn(f, bodyItem(b) ?? b)), moveValues(f), verb);
  }
  if (isDuplicateItem(f)) return duplicateSummary(bodyIn(f, text(p.body)), p.mirror as SketchPlane | undefined);
  if (isChamferItem(f)) {
    const edges = Array.isArray(p.edges) ? p.edges.length : 0;
    const d = p.distance as number;
    const size = typeof p.second === "number" ? { two: [d, p.second] as [number, number] } : typeof p.angle === "number" ? { angle: [d, p.angle] as [number, number] } : { equal: d };
    return chamferSummary(bodyIn(f, text(p.body)), edges, size, p.flip === true);
  }
  if (isPatternItem(f)) {
    const bodies = Array.isArray(p.bodies) ? (p.bodies as string[]) : [];
    return patternSummary(bodies.map((b) => bodyIn(f, b)), patternValuesOf(p));
  }
  if (isShellItem(f)) return shellSummary(bodyIn(f, text(p.body)), Array.isArray(p.faces) ? p.faces.length : 0, p.thickness as number);
  if (f.intent.type === "extrude" && typeof p.sketch === "string") return extrudeSummaryOf(f);
  if (isSketchItem(f) && f.provenance.from.length === 1) {
    // "Sketch 2 on a face of Box 1": its own words, then the face's item (sketch.ts addFaceSketch).
    const on = " on a face of ";
    const at = f.intent.summary.indexOf(on);
    return at < 0 ? null : `${f.intent.summary.slice(0, at)}${on}${f.provenance.from[0].label}`;
  }
  return null;
}

/**
 * `after`'s description (its provenance already naming the renamed item anew) when `before`'s saved description is
 * exactly what its parameters and old names say; else `before`'s description unchanged, since words that can't be
 * said again from the parameters can't be rewritten safely (an old file's, or a kind made by hand).
 */
export function renamedSummary(before: Feature, after: Feature): string {
  if (summaryNamed(before) !== before.intent.summary) return before.intent.summary;
  return summaryNamed(after) ?? before.intent.summary;
}
