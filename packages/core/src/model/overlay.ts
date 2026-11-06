// Analysis overlays: any workspace can paint data onto the shared
// viewport's faces and edges — colours, warnings and labels — without
// owning the viewport. Printability, machinability, stress results and
// design-rule errors all arrive this way (I16, I17).
//
// Overlays are display only; they are never saved. Until stable ids exist
// (step 24) a mark names a face by its index in the body on screen, the
// whole body, or triangles of the mesh on screen (for what covers part of a
// curved face, such as the underside of a lying cylinder needing supports:
// the print check, H1).

export type OverlayTarget = { face: number } | { body: true } | { triangles: readonly number[] };

/** Severity sets the colour, so every workspace's warnings look the same. */
export type OverlaySeverity = "info" | "warning" | "error";

export interface OverlayMark {
  target: OverlayTarget;
  severity: OverlaySeverity;
}

export interface AnalysisOverlay {
  /** One overlay per id; setting it again replaces it. */
  id: string;
  /** Shown in the viewport's legend, e.g. "Too big for an accurate STL". */
  label: string;
  /** Longer text for the legend's tooltip. */
  detail?: string;
  marks: OverlayMark[];
  /**
   * Places in the world to point at (36d), drawn over everything in the
   * colour of their severity: a corner as a dot, an edge or a gap as a
   * line between its two ends. For what has no face of its own to colour,
   * such as where a refused Combine's result would touch itself.
   */
  places?: OverlayPlace[];
}

/** A place an overlay points at, in world mm: a point, or a line from one point to another. */
export type OverlayPlace = { severity: OverlaySeverity } & ({ point: [number, number, number] } | { from: [number, number, number]; to: [number, number, number] });

/**
 * The overlays' places as the viewport draws them (36d): every point and
 * every line with its colour, the most severe last so it is drawn on top.
 * A line whose two ends are one point is drawn as that point (a gap of 0
 * would be no line at all).
 */
export function overlayPlaces(overlays: readonly AnalysisOverlay[]): { points: { at: [number, number, number]; colour: [number, number, number] }[]; lines: { from: [number, number, number]; to: [number, number, number]; colour: [number, number, number] }[] } {
  const all = overlays.flatMap((o) => o.places ?? []).sort((a, b) => rank[a.severity] - rank[b.severity]);
  const points: { at: [number, number, number]; colour: [number, number, number] }[] = [];
  const lines: { from: [number, number, number]; to: [number, number, number]; colour: [number, number, number] }[] = [];
  for (const p of all) {
    const colour = SEVERITY_COLOURS[p.severity];
    if ("point" in p) points.push({ at: p.point, colour });
    else if (p.from.every((x, i) => x === p.to[i])) points.push({ at: p.from, colour });
    else lines.push({ from: p.from, to: p.to, colour });
  }
  return { points, lines };
}

/** RGB in 0–1 for each severity. */
export const SEVERITY_COLOURS: Record<OverlaySeverity, [number, number, number]> = {
  info: [0.66, 0.5, 0.95], // violet, not blue: blue is the selection's (packages/viewport highlight.ts)
  warning: [0.96, 0.69, 0.3],
  error: [1, 0.42, 0.42],
};

const rank: Record<OverlaySeverity, number> = { info: 0, warning: 1, error: 2 };

/** The most severe of an overlay's marks and places (its legend line's colour); "warning" when it has none. */
export function worstSeverity(overlay: AnalysisOverlay): OverlaySeverity {
  const all = [...overlay.marks, ...(overlay.places ?? [])].map((m) => m.severity);
  return all.length === 0 ? "warning" : all.reduce((a, b) => (rank[b] > rank[a] ? b : a));
}

/**
 * The colour of each triangle under these overlays (null where nothing is
 * marked). Where marks overlap, the most severe wins. A triangle a mark
 * names that the mesh does not have is passed over.
 */
export function triangleColours(triangleFaces: readonly number[], overlays: readonly AnalysisOverlay[]): ([number, number, number] | null)[] {
  const worst = new Map<number | "body", OverlaySeverity>();
  const perTriangle: (OverlaySeverity | undefined)[] = [];
  for (const o of overlays)
    for (const m of o.marks) {
      if ("triangles" in m.target) {
        for (const t of m.target.triangles) {
          if (!(Number.isInteger(t) && t >= 0 && t < triangleFaces.length)) continue;
          const was = perTriangle[t];
          if (!was || rank[m.severity] > rank[was]) perTriangle[t] = m.severity;
        }
        continue;
      }
      const key = "face" in m.target ? m.target.face : "body";
      const was = worst.get(key);
      if (!was || rank[m.severity] > rank[was]) worst.set(key, m.severity);
    }
  const body = worst.get("body");
  const most = (a: OverlaySeverity | undefined, b: OverlaySeverity | undefined) => (a && b ? (rank[a] >= rank[b] ? a : b) : (a ?? b));
  return triangleFaces.map((f, t) => {
    const s = most(most(worst.get(f), body), perTriangle[t]);
    return s ? SEVERITY_COLOURS[s] : null;
  });
}
