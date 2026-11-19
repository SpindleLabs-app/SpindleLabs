// @fission/simulate: the Simulate workspace, called TestLab (the id stays
// "simulate" in code and in project files). Step T1, behind `?testlab`
// (flag.ts): a static stress study set up on a Design body with no export,
// its held and pushed faces kept by stable name and followed through design
// edits (page.ts, study.ts, faces.ts), made of a library material (T2), and
// Run (T5b) works it out on the kernel's stress test for flat-faced parts,
// showing a checked result in the shared view (run.ts, results.ts). Without
// the flag it is the placeholder it was. Next steps: docs/progress/testlab.md.

import type { WorkspacePlugin } from "@fission/core";
import { showPlaceholder, workspaceEta } from "@fission/ui";
import { testlabShown } from "./flag.ts";
import { mountTestLabPage } from "./page.ts";
import { readTestLab } from "./study.ts";

export { GEOMETRY_OWNER, lostWords, studyLost, studyNow, studyOn, type StudyNow } from "./faces.ts";
export * from "./run.ts";
export * from "./results.ts";
export * from "./suggest.ts";
export { readTestLabFlag, setTestLabShown, TESTLAB_KEY, testlabShown } from "./flag.ts";
export { BODIES_LISTER, GETTING_READY, HELD_OVERLAY, loadOverlay, mountTestLabPage, pickedFace, STOPPED, studyNode, studyOverlays, type Picking } from "./page.ts";
export * from "./study.ts";
export * from "./test-file.ts";

const SUMMARY = "Finite element analysis on the kernel's exact geometry: static stress first, then thermal and modal.";

/** DRAFT: solves a study. Not implemented: the page's Run (T5b) is how a study is worked out. */
export function solve(_study: unknown): Promise<never> {
  throw new Error("not implemented");
}

export const simulateWorkspace: WorkspacePlugin = {
  id: "simulate",
  title: "TestLab",
  summary: SUMMARY,
  status: "placeholder",
  representations: { produces: [], accepts: [] }, // a placeholder to the app until Ben releases TestLab; the page reads bodies and faces through the registry
  commands: [],
  readData: (data) => readTestLab(data),
  mount(ctx) {
    if (testlabShown()) return mountTestLabPage(ctx);
    showPlaceholder(ctx.properties, {
      eta: workspaceEta("simulate"),
      title: "TestLab",
      summary: SUMMARY,
      plans: ["Static stress, then thermal and modal studies", "Materials from the shared library (density, stiffness, strength)", "Loads and constraints placed on design faces by reference: they follow the face when the design changes", "Meshing from the exact geometry", "Results: stress, displacement and safety factor drawn in the shared viewport"],
      startsAfter: "after CAD step 40 (booleans and full topological naming), so loads stay on the right faces",
    });
    return { unmount: () => ctx.properties.replaceChildren() };
  },
};
