// 36d: where the kernel refused a Combine, shown in the viewport. A Combine
// whose result would touch itself (two blocks sharing only an edge or a
// corner) or be too thin (a sliver, or a gap narrower than the kernel can
// hold) fails on its row; the overlay points at the very places, so the
// user sees what to move instead of guessing from the words alone.

import type { AnalysisOverlay, OverlayPlace } from "@fission/core";
import type { FeatureResult } from "./rebuild.ts";

/** The overlay's id: one for all the refused Combines, set again after each rebuild. */
export const REFUSAL_OVERLAY = "design.refused-combine";

/**
 * The overlay for the rebuild's refused Combines, in timeline order, or
 * null when none was refused with places to show (and the overlay is
 * cleared). A touch along an edge and a too-short edge or a gap are lines
 * between their two ends; a touch at a corner is a dot. Display only: the
 * row still says why in words.
 */
export function refusalOverlay(features: readonly { id: string; provenance: { self: { label: string } } }[], results: Readonly<Record<string, FeatureResult>>): AnalysisOverlay | null {
  const refused: { label: string; message: string; places: OverlayPlace[] }[] = [];
  for (const f of features) {
    const r = results[f.id];
    if (r?.status !== "failed") continue;
    const places: OverlayPlace[] = [
      ...(r.touches ?? []).map((t): OverlayPlace => (t.at === "corner" ? { severity: "error", point: t.point } : { severity: "error", from: t.from, to: t.to })),
      ...(r.thin ?? []).map((t): OverlayPlace => ({ severity: "error", from: t.from, to: t.to })),
    ];
    if (places.length > 0) refused.push({ label: f.provenance.self.label, message: r.message, places });
  }
  if (refused.length === 0) return null;
  const label = refused.length === 1 ? `Where ${refused[0].label} can't be made` : `Where ${refused.length} Combines can't be made`;
  return { id: REFUSAL_OVERLAY, label, detail: refused.map((x) => x.message).join("\n"), marks: [], places: refused.flatMap((x) => x.places) };
}
