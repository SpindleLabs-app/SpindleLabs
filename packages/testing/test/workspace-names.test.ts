// The workspaces' names as people read them (Ben, 2026-11-12: the app is
// SpindleLabs, each workspace a "Lab"). core's WORKSPACE_NAMES is the one
// list; each workspace's own title, its placeholder page and the ids that
// projects and links save must agree with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_NAMES, workspaceName, type WorkspaceId } from "@fission/core";
import { circuitWorkspace } from "../../../workspaces/circuit/src/index.ts";
import { designWorkspace } from "../../../workspaces/design/src/index.ts";
import { imageWorkspace } from "../../../workspaces/image/src/index.ts";
import { laserWorkspace } from "../../../workspaces/laser/src/index.ts";
import { layoutWorkspace } from "../../../workspaces/layout/src/index.ts";
import { manufactureWorkspace } from "../../../workspaces/manufacture/src/index.ts";
import { renderWorkspace } from "../../../workspaces/render/src/index.ts";
import { simulateWorkspace } from "../../../workspaces/simulate/src/index.ts";
import { slicePageWorkspace, sliceWorkspace } from "../../../workspaces/slice/src/index.ts";
import { vectorWorkspace } from "../../../workspaces/vector/src/index.ts";

const plugins = [designWorkspace, renderWorkspace, simulateWorkspace, manufactureWorkspace, laserWorkspace, sliceWorkspace, circuitWorkspace, vectorWorkspace, imageWorkspace, layoutWorkspace];

test("the names Ben chose, written out by hand", () => {
  // Ben's words: DesignLab, SliceLab, TestLab for Simulate; the rest "<X>Lab"
  // the same way (CNCLab for Manufacture, PCBLab for Circuit).
  assert.deepEqual(WORKSPACE_NAMES, {
    design: "DesignLab",
    render: "RenderLab",
    simulate: "TestLab",
    manufacture: "CNCLab",
    laser: "LaserLab",
    slice: "SliceLab",
    circuit: "PCBLab",
    vector: "VectorLab",
    image: "ImageLab",
    layout: "LayoutLab",
  });
});

test("the ids saved in projects and links stay as they were", () => {
  // A rename that touched an id would leave every saved project unable to
  // find its workspace's data, so the ids are pinned here by hand.
  assert.deepEqual(
    plugins.map((p) => p.id),
    ["design", "render", "simulate", "manufacture", "laser", "slice", "circuit", "vector", "image", "layout"],
  );
});

test("every workspace's own title is its name in the one list", () => {
  for (const p of [...plugins, slicePageWorkspace]) assert.equal(p.title, workspaceName(p.id as WorkspaceId), p.id);
});

/** Every `title: "…",` written in a workspace's index.ts (its own and its placeholder page's) that is not its name. */
const wrongTitles = (src: string, name: string) => [...src.matchAll(/^\s*title: "([^"]+)",$/gm)].map((m) => m[1]).filter((t) => t !== name);
const indexOf = (id: string) => readFileSync(join(import.meta.dirname, "../../../workspaces", id, "src/index.ts"), "utf8");

test("a placeholder page's heading is its workspace's name", () => {
  // showPlaceholder({ title: "…" }) in each index.ts: the page says the
  // same name as the switcher.
  for (const p of plugins) assert.deepEqual(wrongTitles(indexOf(p.id), p.title), [], p.id);
});

test("an old name left in a placeholder page is caught", () => {
  // The check above must be able to fail: Simulate's page with its old heading put back.
  const broken = indexOf("simulate").replace(/(showPlaceholder\([^]*?title: )"TestLab"/, '$1"Simulate"');
  assert.notEqual(broken, indexOf("simulate"), "the plant applied");
  assert.deepEqual(wrongTitles(broken, workspaceName("simulate")), ["Simulate"]);
});
