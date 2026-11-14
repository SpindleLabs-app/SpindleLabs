// The TestLab page (page.ts) in a DOM (happy-dom) over a stand-in Design: a registry with a lister of two bodies and a
// face finder answering from a table the test changes, as a design edit would. Real Design on the real kernel:
// packages/testing journeys/testlab-link.journey.ts; the browser: apps/fission/e2e/testlab-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChangeNotes,
  DependencyGraph,
  emptyProject,
  RepresentationRegistry,
  type AnalysisOverlay,
  type BodyReference,
  type DisplayMesh,
  type FaceFound,
  type FaceReference,
  type StableId,
  type ViewportPick,
  type WorkspaceContext,
} from "@fission/core";
import { HELD_OVERLAY, loadOverlay, mountTestLabPage, NO_SOLVER_YET, pickedFace, readTestLab, studyNode, studyOverlays, studyLost, type StudyNow } from "../src/index.ts";

const { Window } = await import("happy-dom");

const ref = (id: string): FaceReference => ({ kind: "face", id: id as StableId });

/** A stand-in body: face i has one triangle, its name from `names` (null: none of its own). */
function bodyMesh(n: number): DisplayMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    positions.push(i, 0, 0, i + 1, 0, 0, i, 1, 0);
    indices.push(3 * i, 3 * i + 1, 3 * i + 2);
  }
  return { positions, normals: positions.map(() => 0), indices, triangle_faces: Array.from({ length: n }, (_, i) => i), edge_lines: [], edge_line_edges: [] };
}

/** What the stand-in design says now: each body's face names in index order, and which bodies it builds. */
const design = {
  names: { "body:feature-1": ["top", "bottom", "front", null], "body:feature-2": ["top"] } as Record<string, (string | null)[]>,
  shared: new Set<string>(),
};

function context(bodies = 2) {
  const doc = new Window().document as unknown as Document;
  const el = () => doc.createElement("div") as unknown as HTMLElement;
  const overlays = new Map<string, AnalysisOverlay>();
  const shown: DisplayMesh[] = [];
  const viewport = {
    onPick: null as ((p: ViewportPick) => void) | null,
    showBody: (m: DisplayMesh) => void shown.push(m),
    fit: () => null,
    setOverlay: (o: AnalysisOverlay) => void overlays.set(o.id, o),
    clearOverlay: (id: string) => void overlays.delete(id),
  };
  const registry = new RepresentationRegistry();
  registry.registerLister("design", () =>
    [1, 2].slice(0, bodies).map((n) => ({ type: "design.feature", id: `feature-${n}`, label: `Body ${n}`, ref: { kind: "body", id: `body:feature-${n}` as StableId } as BodyReference })),
  );
  registry.registerFaceFinder("design", async (_project, body, refs) => {
    const names = design.names[body.id];
    if (!names) throw new Error("the design doesn't build it now");
    const faces = names.map((n) => (n === null ? null : ref(`${body.id}/${n}`)));
    const found = refs.map((r): FaceFound => {
      if (design.shared.has(r.id)) return { status: "shared", count: 2 };
      const i = faces.findIndex((f) => f?.id === r.id);
      return i >= 0 ? { status: "found", face: i } : { status: "gone", why: "the last edit took it off the body" };
    });
    return { mesh: bodyMesh(names.length), faces, labels: names.map((n, i) => (n === null ? `Face ${i + 1} (no name of its own)` : `${n[0].toUpperCase()}${n.slice(1)} face`)), found, inputs: ["feature-1", "feature-2"] };
  });
  const graph = new DependencyGraph();
  graph.set({ id: "feature-1", label: "Box 1", workspace: "design", cost: "cheap" });
  graph.set({ id: "feature-2", label: "Box 2", workspace: "design", cost: "cheap" });
  const steps: string[] = [];
  const project = emptyProject();
  const ctx = {
    project,
    projectChanged: (label?: string) => void steps.push(label ?? "Edit"),
    graph,
    changeNotes: new ChangeNotes(),
    toolbar: el(),
    browser: el(),
    properties: el(),
    viewport,
    representations: registry,
  } as unknown as WorkspaceContext;
  const status = () => ctx.properties.querySelector(".testlab-page-status")!.textContent!;
  const click = (sel: string) => (ctx.properties.querySelector(sel) as HTMLButtonElement).click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const tap = async (face: number | null) => {
    viewport.onPick!({ face, shift: false });
    await settle();
  };
  return { ctx, viewport, overlays, shown, steps, graph, status, click, settle, tap, data: () => readTestLab(project.workspaces.simulate) };
}

test("a design with one body tests it without being asked, framed in the view", async () => {
  const c = context(1);
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  assert.equal(c.data().studies[0].body?.label, "Body 1");
  assert.deepEqual(c.steps, ["Test Body 1"]);
  assert.equal(c.shown.length, 1);
  assert.match(c.ctx.properties.textContent!, /Study 1: static stress/);
  assert.match(c.status(), /Pick at least one face to hold in place/);
  page.unmount();
});

/** Chooses what the study's part is made of, as a person would in the Made of box. */
function chooseMaterial(c: ReturnType<typeof context>, id: string) {
  const select = [...c.ctx.properties.querySelectorAll<HTMLSelectElement>("select[name=material]")].at(-1)!;
  select.value = id;
  select.dispatchEvent(new (c.ctx.properties.ownerDocument.defaultView as unknown as typeof globalThis).Event("change"));
}

test("with two bodies it asks which; picking one makes the study, one undo step", async () => {
  const c = context(2);
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  assert.equal(c.data().studies.length, 0);
  const radios = [...c.ctx.browser.querySelectorAll<HTMLInputElement>("input[type=radio]")];
  assert.deepEqual(radios.map((r) => r.parentElement!.textContent!.trim()), ["Body 1", "Body 2"]);
  radios[1].checked = true;
  radios[1].dispatchEvent(new (c.ctx.browser.ownerDocument.defaultView as unknown as typeof globalThis).Event("change"));
  await c.settle();
  await c.settle();
  assert.equal(c.data().studies[0].body?.ref.id, "body:feature-2");
  assert.deepEqual(c.steps, ["Test Body 2"]);
  page.unmount();
});

test("hold a face and push another by tapping them: each tap one named undo step, painted in the view; a second tap lets go", async () => {
  const c = context(1);
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  chooseMaterial(c, "pla");
  c.click("[data-testlab=pick-held]");
  await c.tap(1);
  assert.deepEqual(c.data().studies[0].fixtures[0].faces.map((f) => f.label), ["Bottom face"]);
  c.click("[data-testlab=add-load]");
  await c.tap(0);
  const s = c.data().studies[0];
  assert.deepEqual(s.loads[0].faces.map((f) => f.ref.id), ["body:feature-1/top"]);
  assert.deepEqual(c.steps, ["Test Body 1", "Make it of PLA", "Hold Bottom face", "Add load", "Push Top face with Load 1"]);
  assert.deepEqual(c.overlays.get(HELD_OVERLAY)!.marks, [{ target: { face: 1 }, severity: "info" }]);
  assert.deepEqual(c.overlays.get(loadOverlay(s.loads[0].id))!.marks, [{ target: { face: 0 }, severity: "warning" }]);
  assert.equal(c.status(), "Tap faces of the body to pick them; tap a picked face to let it go.");
  await c.tap(0);
  assert.deepEqual(c.data().studies[0].loads[0].faces, []);
  assert.equal(c.steps.at(-1), "Take Top face off Load 1");
  // A face with no name of its own can't be held: said, nothing recorded.
  const before = c.steps.length;
  await c.tap(3);
  assert.equal(c.steps.length, before);
  assert.match(c.status(), /Face 4 \(no name of its own\): it has no name of its own after the last edit/);
  page.unmount();
});

test("a design edit: the faces found again by name, one taken away said in words, a shared one never moved; marked out of date until Run", async () => {
  const c = context(1);
  design.names["body:feature-1"] = ["top", "bottom", "front", null];
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  chooseMaterial(c, "abs");
  c.click("[data-testlab=pick-held]");
  await c.tap(1);
  c.click("[data-testlab=add-load]");
  await c.tap(2);
  c.click("[data-testlab=run]");
  await c.settle();
  await c.settle();
  assert.match(c.status(), new RegExp(`Set up and checked against the design as it is now\\. ${NO_SOLVER_YET.replace(/[.()]/g, "\\$&")}`));
  const node = studyNode("study-1");
  assert.equal(c.graph.isStale(node), false);
  assert.equal(c.ctx.properties.querySelector(".testlab-page-state")!.textContent, "Up to date with the design: set up and checked.");
  // A change to the set-up after Run (here what it is made of) means Run checked another set-up.
  chooseMaterial(c, "pla");
  assert.equal([...c.ctx.properties.querySelectorAll(".testlab-page-state")].at(-1)!.textContent, "Not run yet.");
  c.click("[data-testlab=run]");
  await c.settle();
  await c.settle();
  assert.equal([...c.ctx.properties.querySelectorAll(".testlab-page-state")].at(-1)!.textContent, "Up to date with the design: set up and checked.");

  // The edit renumbers the faces and takes the front away: the bottom is found at its new index.
  design.names["body:feature-1"] = ["bottom", "top", "left"];
  c.graph.changed("feature-1");
  assert.equal(c.graph.isStale(node), true);
  assert.match(c.ctx.properties.querySelector(".testlab-page-state")!.textContent!, /^Out of date: the design changed/);
  page.sleep!();
  page.wake!();
  await c.settle();
  await c.settle();
  assert.deepEqual(c.overlays.get(HELD_OVERLAY)!.marks, [{ target: { face: 0 }, severity: "info" }]);
  assert.match(c.status(), /Load 1 lost its face Front face: the last edit took it off the body\. Pick a face again or take this one off\./);
  // Run refuses while a face is lost, and the study stays out of date.
  c.click("[data-testlab=run]");
  await c.settle();
  await c.settle();
  assert.match(c.status(), /^Not run: fix what is said below first\./);
  assert.equal(c.graph.isStale(node), true);
  // A name the edit gave to two faces is never moved to one of them.
  design.shared.add("body:feature-1/bottom");
  page.sleep!();
  page.wake!();
  await c.settle();
  await c.settle();
  assert.match(c.status(), /Held here is on Bottom face, which now matches 2 faces after the last edit, so it was not moved to any of them/);
  assert.deepEqual(c.overlays.get(HELD_OVERLAY)!.marks, []);
  design.shared.clear();
  design.names["body:feature-1"] = ["top", "bottom", "front", null];
  page.unmount();
});

test("Made of: asked once, each choice one named undo step, the numbers used and every source shown; kept through a remount", async () => {
  const c = context(1);
  let page = mountTestLabPage(c.ctx);
  await page.ready;
  // querySelectorAll, never querySelector: happy-dom can answer querySelector with an element a redraw already replaced.
  const select = () => [...c.ctx.properties.querySelectorAll<HTMLSelectElement>("select[name=material]")].at(-1)!;
  assert.deepEqual([...select().options].map((o) => o.textContent), ["Choose a material", "PLA", "PETG", "ABS", "Aluminium 6061-T6", "Steel (A36 structural)"]);
  assert.match(c.status(), /Choose what the part is made of\./);
  chooseMaterial(c, "petg");
  assert.equal(c.data().studies[0].material, "petg");
  assert.equal(c.steps.at(-1), "Make it of PETG");
  assert.doesNotMatch(c.status(), /Choose what the part is made of/);
  const box = () => [...c.ctx.properties.querySelectorAll(".testlab-page-material")].at(-1)!;
  // PETG across the layers: min(1540, 1810) = 1540 MPa, 23 MPa; 1.28 g/cm³.
  assert.match(box().textContent!, /Stiffness 1,540 MPa, breaking strength 23 MPa, 1\.28 g\/cm³\./);
  assert.match(box().textContent!, /Poisson's ratio is assumed/);
  assert.equal(box().querySelectorAll(".testlab-page-sources p").length, 4);
  assert.deepEqual([...select().options].map((o) => o.value), ["pla", "petg", "abs", "aluminium-6061", "steel-a36"], "no Choose once chosen");
  chooseMaterial(c, "aluminium-6061");
  assert.deepEqual(c.steps.slice(-2), ["Make it of PETG", "Make it of Aluminium 6061-T6"]);
  assert.match(box().textContent!, /Stiffness 68,900 MPa, yield strength 276 MPa/);
  assert.doesNotMatch(box().textContent!, /across the layers/);
  // An Undo remounts TestLab: the choice is the project's, so it is still there.
  page.unmount();
  page = mountTestLabPage(c.ctx);
  await page.ready;
  assert.equal(select().value, "aluminium-6061");
  page.unmount();
});

test("an unmount and mount again (an Undo) keeps the out-of-date mark; sleeping clears the view's paint and the pick", async () => {
  const c = context(1);
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  c.graph.changed("feature-1");
  page.unmount();
  const again = mountTestLabPage(c.ctx);
  await again.ready;
  assert.equal(c.graph.isStale(studyNode("study-1")), true);
  assert.equal(c.ctx.properties.querySelector(".testlab-page-state")!.getAttribute("data-stale"), "true");
  again.sleep!();
  assert.equal(c.viewport.onPick, null);
  assert.equal(c.overlays.size, 0);
  again.unmount();
});

test("a body the design no longer builds is said in words, never drawn from the last look", async () => {
  const c = context(1);
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  const names = design.names["body:feature-1"];
  delete design.names["body:feature-1"];
  page.sleep!();
  page.wake!();
  await c.settle();
  await c.settle();
  assert.equal(c.status(), "Body 1 can't be tested now: the design doesn't build it now.");
  design.names["body:feature-1"] = names;
  page.unmount();
});

test("the pure parts: a tap's face, the overlays, the lost words in study order", () => {
  const now: StudyNow = {
    faces: { mesh: bodyMesh(2), faces: [ref("a"), null], labels: ["Top face", "Face 2 (no name of its own)"], found: [], inputs: [] },
    found: new Map<string, FaceFound>([["a", { status: "found", face: 0 }], ["b", { status: "gone", why: "the last edit took it off the body" }]]),
    lost: [],
  };
  assert.deepEqual(pickedFace(now, 0), { ref: ref("a"), label: "Top face" });
  assert.deepEqual(pickedFace(now, null), { refused: "Tap a face of the body." });
  assert.deepEqual(pickedFace(now, 7), { refused: "That is not a face of this body." });
  const study = {
    id: "study-1", name: "Study 1", kind: "static" as const, body: null, mesh: "normal" as const,
    fixtures: [{ id: "fixture-2", faces: [{ ref: ref("a"), label: "Top face" }] }],
    loads: [{ id: "load-3", faces: [{ ref: ref("b"), label: "Side face" }], amount: 1, unit: "N" as const, direction: "down" as const }],
  };
  const o = studyOverlays(study, now);
  assert.deepEqual(o.map((x) => [x.id, x.marks.length]), [[HELD_OVERLAY, 1], ["testlab-load-3", 0]]);
  assert.deepEqual(studyLost(study, now.found), ["Load 1 lost its face Side face: the last edit took it off the body. Pick a face again or take this one off."]);
});
