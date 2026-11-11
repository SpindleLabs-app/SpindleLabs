// @fission/laser: the Laser workspace. Laser step L1a, behind `?laser`
// (flag.ts): Design's sketches and profiles laid out on the laser's bed and
// saved as SVG or DXF at true size (page.ts). Without the flag it is the
// placeholder it was. Next steps: cut, engrave and score layers with
// power, speed and passes; kerf; a path preview with the job's time and
// G-code; flat faces of bodies; sending to the machine (docs/progress/laser.md).

import type { WorkspacePlugin } from "@fission/core";
import { showPlaceholder } from "@fission/ui";
import { laserShown } from "./flag.ts";
import { mountLaserPage } from "./page.ts";

export { bulgeNumber, CUT_LAYER, sheetDxf } from "./dxf.ts";
export { LASER_KEY, laserShown, readLaserFlag, setLaserShown } from "./flag.ts";
export { BED_DROP, bedMesh, defaultLaserData, DXF_KIND, layoutWords, mountLaserPage, OUTLINES_LISTER, partMeshes, partsOn, readLaserData, readParts, SVG_KIND, type LaserData, type OfferedPart, type SaveText } from "./page.ts";
export { bedRefusal, DEFAULT_BED, DEFAULT_GAP, DEFAULT_THICKNESS, layOut, MAX_BED, MAX_THICKNESS, thicknessRefusal, moveOutline, outlineBox, sheetSvg, type Bed, type Layout, type PlacedPart, type SheetPart } from "./sheet.ts";

const SUMMARY = "2D jobs for laser and vinyl cutters: cut, engrave and score layers, preview and machine control.";

export const laserWorkspace: WorkspacePlugin = {
  id: "laser",
  title: "Laser",
  summary: SUMMARY,
  status: "placeholder",
  representations: { produces: [], accepts: ["outline"] },
  commands: [],
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
