// @fission/laser: the Laser workspace. Laser steps L1a, L1a2 and L1b, behind `?laser`
// (flag.ts): Design's sketches and profiles laid out on the laser's bed, shown
// flat from above (flat-view.ts) and saved as SVG or DXF at true size (page.ts). Without the flag it is the
// placeholder it was. Next steps: cut, engrave and score layers with
// power, speed and passes; kerf; a path preview with the job's time and
// G-code; flat faces of bodies; sending to the machine (docs/progress/laser.md).

import type { WorkspacePlugin } from "@fission/core";
import { showPlaceholder } from "@fission/ui";
import { laserShown } from "./flag.ts";
import { mountLaserPage, readLaserProjectData } from "./page.ts";

export { bulgeNumber, CUT_LAYER, sheetDxf } from "./dxf.ts";
export { LASER_KEY, laserShown, readLaserFlag, setLaserShown } from "./flag.ts";
export { createFlatView, type FlatPart, type FlatScene, type FlatView, type FlatViewOptions } from "./flat-view.ts";
export { defaultLaserData, DXF_KIND, emptyBedNote, flatScene, layoutWords, mountLaserPage, OUTLINES_LISTER, pairWords, partsOn, readLaserData, readParts, SVG_KIND, type LaserData, type OfferedPart, type PairRelation, type Relate, type SaveText } from "./page.ts";
export { LASER_DATA_VERSION, readLaserProjectData } from "./page.ts";
export { BOX_MARGIN, CLEARANCE, NUDGE, outlineCurves, partsRelation, type OutlineCurves, type PartsRelation } from "./overlap.ts";
export { boxesOverlap, cleanMm, EDGE_SLACK, layOutPlaced, MAX_REACH, normalAngle, offBed, offBedWords, overlapCandidates, placementRefusal, placeOutline, readPlacements, snapMm, turnedOnTheSpot, turnOutline, type LaidLayout, type LaidPart, type Placement } from "./place.ts";
export { bedRefusal, DEFAULT_BED, DEFAULT_GAP, DEFAULT_THICKNESS, layOut, MAX_BED, MAX_THICKNESS, thicknessRefusal, moveOutline, outlineBox, outlinePath, sheetSvg, type Bed, type Layout, type PlacedPart, type SheetPart } from "./sheet.ts";
export { CARD_GAP, CARD_MOST, FIT_MARGINS, fitView, marginsClearOf, marginsFor, PHONE_TOP, PHONE_WIDTH, KEEP_IN_SIGHT, keepInSight, MARK_GAP, marksBetween, markStep, MAX_SCALE, MIN_BED_PX, minScale, nameFits, panBy, toBed, toScreen, wheelZoom, wordsWidth, ZOOM_STEP, zoomAt, type Card, type Margins, type ScreenPoint, type Size, type View } from "./view-box.ts";

const SUMMARY = "2D jobs for laser and vinyl cutters: cut, engrave and score layers, preview and machine control.";

export const laserWorkspace: WorkspacePlugin = {
  id: "laser",
  title: "Laser",
  summary: SUMMARY,
  status: "placeholder",
  representations: { produces: [], accepts: [] }, // a placeholder to the app until Ben releases the page; the page reads outlines through the registry
  commands: [],
  // Read with or without the flag: a project's Laser data is brought up to date, or refused as newer, whoever opens it.
  readData: readLaserProjectData,
  mount(ctx) {
    if (laserShown()) return mountLaserPage(ctx);
    showPlaceholder(ctx.properties, {
      title: "Laser",
      summary: SUMMARY,
      plans: ["Cut, engrave and score layers with power and speed settings", "Flat faces and sketches taken straight from Design, by reference (sheet-metal flat patterns later)", "Job preview with time estimate", "DXF and SVG import and export", "Machine control for common controllers"],
      startsAfter: "after CAD step 52 (when the sketcher is solid)",
    });
    return { unmount: () => ctx.properties.replaceChildren() };
  },
};
