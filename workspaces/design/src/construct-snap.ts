// Sketches snap onto construction points (step 59a3b2): every construction
// point drawn in the view (construct-draw.ts `drawnConstructs`: before the
// marker, not suppressed, its eye and the Construction folder's open) that
// comes before the sketch in the timeline, as the bodies a sketch snaps to
// do (face-edges.ts: Fusion offers only what is before a sketch), is a
// point to snap to, seen square onto the sketch's plane: the point less its
// part along the plane's normal, in the plane's x and y (face-edges.ts
// `inSketch`, the same frame body corners are put into). A point off the
// plane lands on its foot there, as a body corner above the plane does.
//
// Placed, not pinned (no SketchPin): the sketch point lands where the
// construction point is now and stays there if the construction changes,
// as a point placed on the origin or lined up does. Pinning to a
// construction is later work. A hidden or suppressed construction, one
// after the marker (rolled back) or after the sketch never snaps.

import type { Plane, SketchXY } from "@fission/core";
import { drawnConstructs } from "./construct-draw.ts";
import type { DesignDocument } from "./document.ts";
import { inSketch } from "./face-edges.ts";

/** The construction points sketch `id` may snap to, in its plane's frame `plane` (sketch.ts `sketchPlane`), in timeline order. */
export function constructSnapPoints(doc: DesignDocument, id: string, plane: Plane): SketchXY[] {
  const features = doc.timeline.features;
  const at = features.findIndex((f) => f.id === id);
  // A sketch not in the timeline (none such is drawn on) sees none.
  if (at < 0) return [];
  const before = new Set(features.slice(0, at).map((f) => f.id));
  return drawnConstructs(doc, null).flatMap((d) => (d.answer.kind === "point" && before.has(d.item) ? [inSketch(d.answer.point, plane)] : []));
}
