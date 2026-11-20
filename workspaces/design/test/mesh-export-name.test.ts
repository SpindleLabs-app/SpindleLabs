// SL #764 item 7 (E-4, app-wide hunt 2026-11-14): Download STL is named after
// the design (Ben 2026-11-11, #507), but 3MF and OBJ still saved
// "spindlelabs-box.3mf" for a design called "box". The three exports now
// name the file by the same rule: the design's name, else the file it was
// saved to or opened from, else the old shape name. Real kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, type AnalysisOverlay, type Selected, type WorkspaceContext } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { DOWNLOAD_STL, registerDesignActions } from "../src/actions.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertCombine } from "../src/combine.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { DOWNLOAD_3MF, DOWNLOAD_OBJ, registerMeshActions } from "../src/mesh-export.ts";

const kernel = nodeKernel();
const box = partDocument("box", 40, 30, 20);
const boxBody: Selected = { kind: "body", id: "body:feature-1" };

/** The name each of the three exports saves under for a design called `name`, saved to or opened from `fileName`. */
async function names(name: string, fileName: string | null, design: DesignDocument = box): Promise<string[]> {
  const saved: string[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, (_bytes, n) => void saved.push(n));
  registerMeshActions(r, (_bytes, n) => void saved.push(n));
  const project = emptyProject();
  project.workspaces.design = design;
  project.name = name;
  const ctx = { project, kernel, fileName: () => fileName, viewport: { setOverlay: (_: AnalysisOverlay) => {}, clearOverlay: () => {} } } as unknown as WorkspaceContext;
  for (const id of [DOWNLOAD_STL, DOWNLOAD_3MF, DOWNLOAD_OBJ]) {
    const outcome = await r.get(id)!.run([boxBody], ctx);
    assert.equal(outcome.bad, false, outcome.message);
  }
  return saved;
}

test("hand-worked: a design called box saves box.stl, box.3mf and box.obj", async () => {
  assert.deepEqual(await names("box", null), ["box.stl", "box.3mf", "box.obj"]);
});

test("the three exports agree: the file's name when the design has none, the shape's when neither", async () => {
  assert.deepEqual(await names("Bracket", "other-file"), ["Bracket.stl", "Bracket.3mf", "Bracket.obj"], "the name wins over the file");
  assert.deepEqual(await names("", "bracket-v3"), ["bracket-v3.stl", "bracket-v3.3mf", "bracket-v3.obj"]);
  assert.deepEqual(await names("Untitled", "bracket-v3"), ["bracket-v3.stl", "bracket-v3.3mf", "bracket-v3.obj"], "Untitled counts as none");
  assert.deepEqual(await names("Untitled", null), ["spindlelabs-box.stl", "spindlelabs-box.3mf", "spindlelabs-box.obj"], "nothing named: as before");
});

test("#507: a body a Combine changed is no longer its first item's shape, so an unnamed design's files say body, not box", async () => {
  // Box 1 40 × 30 × 20 and Box 2 10 × 10 × 40 moved to x 10..20, y 10..20, z −10..30: Combine 1 cuts a square hole through
  // Box 1, which keeps Box 1's id but is no box any more (24,000 − 10 × 10 × 20 = 22,000 mm³).
  let doc = partDocument("box", 40, 30, 20);
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 40));
  ({ doc } = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x: 10, y: 10, z: -10 }));
  const cut = insertCombine(doc, "body:feature-1", [`body:${id}`], "cut").doc;
  assert.deepEqual(await names("Untitled", null, cut), ["spindlelabs-body.stl", "spindlelabs-body.3mf", "spindlelabs-body.obj"]);
  // Control: the same design with the Combine suppressed exports Box 1 as it was made, a box.
  const off = { ...cut, timeline: { ...cut.timeline, features: cut.timeline.features.map((f) => (f.intent.type === "combine" ? { ...f, suppressed: true } : f)) } };
  assert.deepEqual(await names("Untitled", null, off), ["spindlelabs-box.stl", "spindlelabs-box.3mf", "spindlelabs-box.obj"]);
});
