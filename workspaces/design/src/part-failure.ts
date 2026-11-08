// Whether the part (`partFeature`: the last item that makes a body) failed
// in a rebuild, and in what words: the properties' red line, its body's
// numbers marked out of date and the folded panel's ⚠ all follow it. A
// part whose body a later Combine or Extrude Join used up (cut, joined or
// intersected into another body) built as it should: its body is simply part
// of another now (Ben 2026-11-05, "Box 5 is built" in red over a design with
// nothing wrong; hunt 11-08 for the Extrude Join).

import type { Feature } from "@fission/core";
import { bodyIdOf, combineBodies, extrudeOperation, isCombineItem } from "./document.ts";
import type { TimelineBuild } from "./rebuild.ts";

/** Whether a Combine or an Extrude Join that built took `body` in: a Combine's target or a tool it didn't keep, a Join's body it put into another (only one after the body's item can: the timeline's own rule). An Extrude Cut or Intersect keeps every body it works on. */
function usedUp(features: readonly Feature[], body: string, results: TimelineBuild["results"]): boolean {
  return features.some((f) => {
    if (results[f.id]?.status !== "built") return false;
    const op = extrudeOperation(f);
    if (op !== null) return op.operation === "join" && op.bodies.includes(body);
    if (!isCombineItem(f)) return false;
    const { target, tools, keepTools } = combineBodies(f);
    return target === body || (!keepTools && tools.includes(body));
  });
}

/**
 * Why `feature`, the part of the design whose timeline is `features`, failed
 * in `build`, or undefined when it didn't (or there is no part): a failed
 * build's own words; one that didn't build; one built with no body that no
 * Combine or Extrude Join after it used up.
 */
export function partFailure(features: readonly Feature[], feature: Feature | null, build: Pick<TimelineBuild, "results" | "bodies">): string | undefined {
  const result = feature && build.results[feature.id];
  if (!feature || !result) return undefined;
  const label = feature.provenance.self.label;
  if (result.status === "failed") return result.message;
  if (result.status !== "built") return `${label} is ${result.status}`;
  const body = bodyIdOf(feature.id);
  if (build.bodies[body] !== undefined || usedUp(features, body, build.results)) return undefined;
  return `${label} built no body`;
}
