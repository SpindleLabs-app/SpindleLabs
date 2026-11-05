// Whether the part (`partFeature`: the last item that makes a body) failed
// in a rebuild, and in what words: the properties' red line, its body's
// numbers marked out of date and the folded panel's ⚠ all follow it. A
// part whose body a later Combine used up (cut, joined or intersected into
// another body) built as it should: its body is simply part of another now
// (Ben 2026-11-05, "Box 5 is built" in red over a design with nothing wrong).

import type { Feature } from "@fission/core";
import { bodyIdOf, combineBodies, isCombineItem } from "./document.ts";
import type { TimelineBuild } from "./rebuild.ts";

/** Whether a Combine that built took `body` in, as its target or as a tool it didn't keep (only one after the body's item can: the timeline's own rule). */
function usedUp(features: readonly Feature[], body: string, results: TimelineBuild["results"]): boolean {
  return features.some((f) => {
    if (!isCombineItem(f) || results[f.id]?.status !== "built") return false;
    const { target, tools, keepTools } = combineBodies(f);
    return target === body || (!keepTools && tools.includes(body));
  });
}

/**
 * Why `feature`, the part of the design whose timeline is `features`, failed
 * in `build`, or undefined when it didn't (or there is no part): a failed
 * build's own words; one that didn't build; one built with no body that no
 * Combine after it used up.
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
