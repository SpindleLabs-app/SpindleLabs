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
import { partDocument } from "../src/document.ts";
import { DOWNLOAD_3MF, DOWNLOAD_OBJ, registerMeshActions } from "../src/mesh-export.ts";

const kernel = nodeKernel();
const box = partDocument("box", 40, 30, 20);
const boxBody: Selected = { kind: "body", id: "body:feature-1" };

/** The name each of the three exports saves under for a design called `name`, saved to or opened from `fileName`. */
async function names(name: string, fileName: string | null): Promise<string[]> {
  const saved: string[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, (_bytes, n) => void saved.push(n));
  registerMeshActions(r, (_bytes, n) => void saved.push(n));
  const project = emptyProject();
  project.workspaces.design = box;
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
