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
  type StressTest,
  type StressTestResult,
  type ViewportPick,
  type WorkspaceContext,
} from "@fission/core";
import { pickHint } from "../src/page.ts";
import { HELD_OVERLAY, loadOverlay, mountTestLabPage, pickedFace, RESULT_OVERLAY, STOPPED, readTestLab, studyNode, studyOverlays, studyLost, type StudyNow } from "../src/index.ts";

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

/**
 * A stand-in answer for `test`: a 1 mm right-angle triangle's three corners (a surface of one triangle on face 0),
 * the first moving `bend` mm along x, stressed 10, 5 and 0 MPa; balanced, converged, the safety factor `strength` / 10.
 */
export function standInAnswer(test: StressTest, bend = 0.002): StressTestResult {
  const applied: [number, number, number] = [0, 0, 0];
  for (const l of test.loads) if ("force" in l) l.force.forEach((x, k) => (applied[k] += x));
  if (applied.every((x) => x === 0)) applied[2] = -1; // a pressure's total, any non-zero one
  return {
    points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    triangles: [0, 1, 2],
    triangleFaces: [0],
    displacement: [bend, 0, 0, 0, 0, 0, 0, 0, 0],
    vonMises: [10, 5, 0],
    maxDisplacement: bend,
    maxDisplacementAt: [0, 0, 0],
    maxVonMises: 10,
    maxVonMisesAt: [0, 0, 0],
    safetyFactor: test.strength / 10,
    applied,
    reaction: [-applied[0], -applied[1], -applied[2]],
    size: 0.5,
    nodes: 10,
    elements: 1,
    worstQuality: 0.8,
    method: "direct",
    iterations: 1,
    relativeResidual: 1e-14,
  };
}

function context(bodies = 2) {
  const doc = new Window().document as unknown as Document;
  const el = () => doc.createElement("div") as unknown as HTMLElement;
  const overlays = new Map<string, AnalysisOverlay>();
  const shown: DisplayMesh[] = [];
  const coloured: (readonly number[] | null)[] = [];
  const viewport = {
    element: el(),
    onPick: null as ((p: ViewportPick) => void) | null,
    showBody: (m: DisplayMesh) => void shown.push(m),
    showColourMap: (colours: readonly number[] | null) => void coloured.push(colours),
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
  // The same body lent for a Run: handle 70 + the body's number, let go after (`lent` counts what is out).
  const lending = { out: 0, lent: 0 };
  registry.registerBodyLender("design", async (project, body, refs, use) => {
    const faces = await registry.facesOf("design", project, body, refs);
    lending.out++;
    lending.lent++;
    try {
      return await use({ handle: 70 + Number(body.id.at(-1)), faces });
    } finally {
      lending.out--;
    }
  });
  // A stand-in kernel: each stress test is kept, answered by `kernel.answer` when `kernel.release` is called (or at once).
  const kernel = {
    tests: [] as { body: number; test: StressTest }[],
    answer: (test: StressTest): StressTestResult | Error => standInAnswer(test),
    hold: false,
    release: null as (() => void) | null,
    stage: null as ((s: "meshing" | "solving" | "stresses") => void) | null,
    stopped: 0,
    call: async (op: string, body: number, test: StressTest) => {
      if (op !== "stress_test") throw new Error(`unexpected kernel call ${op}`);
      kernel.tests.push({ body, test });
      if (kernel.hold) await new Promise<void>((r) => (kernel.release = r));
      const a = kernel.answer(test);
      if (a instanceof Error) throw a;
      return a;
    },
    onTestProgress: (l: (s: "meshing" | "solving" | "stresses") => void) => {
      kernel.stage = l;
      return () => void (kernel.stage = null);
    },
    stopTesting: () => {
      kernel.stopped++;
      return false;
    },
  };
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
    kernel,
  } as unknown as WorkspaceContext;
  const status = () => ctx.properties.querySelector(".testlab-page-status")!.textContent!;
  const click = (sel: string) => (ctx.properties.querySelector(sel) as HTMLButtonElement).click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const tap = async (face: number | null) => {
    viewport.onPick!({ face, shift: false });
    await settle();
  };
  return { ctx, viewport, overlays, shown, coloured, steps, graph, status, click, settle, tap, kernel, lending, data: () => readTestLab(project.workspaces.simulate) };
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

test("T5c5: the picking hint over the view says what a tap does while picking, and goes when picking ends, on sleep and on unmount", async () => {
  const c = context(1);
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  const hints = () => [...c.viewport.element.querySelectorAll<HTMLElement>("#testlab-view-hint")];
  const hint = () => hints()[0]!;
  assert.equal(hints().length, 1, "one hint, in the view");
  assert.equal(hint().hidden, true, "nothing picked: no hint");
  chooseMaterial(c, "pla");
  c.click("[data-testlab=pick-held]");
  assert.equal(hint().hidden, false);
  assert.equal(hint().textContent, "Tap the faces to hold. Tap a held face to let it go.");
  c.click("[data-testlab=add-load]");
  assert.equal(hint().textContent, "Tap the faces Load 1 pushes. Tap a pushed face to let it go.");
  c.click("[data-testlab=add-load]");
  assert.equal(hint().textContent, "Tap the faces Load 2 pushes. Tap a pushed face to let it go.", "the load just added, by its number");
  c.click("[data-testlab=pick-load]"); // Load 1's Pick faces to push: Load 1 picks now
  assert.equal(hint().textContent, "Tap the faces Load 1 pushes. Tap a pushed face to let it go.");
  c.click("[data-testlab=pick-load][aria-pressed=true]"); // Done picking
  assert.equal(hint().hidden, true, "done picking: no hint");
  c.click("[data-testlab=pick-held]");
  assert.equal(hint().hidden, false);
  page.sleep!();
  assert.equal(hint().hidden, true, "asleep: another workspace's view has no TestLab hint");
  page.wake!();
  page.unmount();
  assert.equal(hints().length, 0, "unmounted: the hint is gone from the view");
});

test("pickHint: none when nothing is picked, no study, or a load no longer there", () => {
  const s = { loads: [{ id: "load-a" }, { id: "load-b" }] } as unknown as Parameters<typeof pickHint>[1];
  assert.equal(pickHint(null, s), null);
  assert.equal(pickHint({ kind: "held", fixture: "f" }, null), null);
  assert.equal(pickHint({ kind: "load", load: "load-b" }, s), "Tap the faces Load 2 pushes. Tap a pushed face to let it go.");
  assert.equal(pickHint({ kind: "load", load: "gone" }, s), null);
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
  // ABS, the weaker way (across the layers), sent in MPa: stiffness the lower of the tensile and bending moduli across,
  // min(2960, 1590) = 1590 MPa (along: min(3800, 1880) = 1880, higher); strength 32 MPa across (41 along); ratio 0.36.
  // Held face 1 (the bottom); Load 1's starting 10 N down (−Z) on face 2 (the front).
  assert.equal(c.kernel.tests.length, 1);
  assert.equal(c.kernel.tests[0].test.youngsModulus, 1590);
  assert.equal(c.kernel.tests[0].test.strength, 32);
  assert.equal(c.kernel.tests[0].test.poissonsRatio, 0.36);
  assert.equal(c.kernel.tests[0].test.size, undefined, "the mesh size is the kernel's own choice");
  assert.equal(c.lending.out, 0, "the body lent is let go after the run");
  assert.equal(c.kernel.tests[0].body, 71);
  assert.deepEqual(c.kernel.tests[0].test.held, [1]);
  assert.deepEqual(c.kernel.tests[0].test.loads, [{ faces: [2], force: [0, 0, -10] }]);
  assert.equal(c.status(), "");
  const node = studyNode("study-1");
  assert.equal(c.graph.isStale(node), false);
  assert.equal(c.ctx.properties.querySelector(".testlab-page-state")!.textContent, "Up to date with the design.");
  // A change to the set-up after Run (here what it is made of) means Run checked another set-up.
  chooseMaterial(c, "pla");
  assert.equal([...c.ctx.properties.querySelectorAll(".testlab-page-state")].at(-1)!.textContent, "Not run yet.");
  c.click("[data-testlab=run]");
  await c.settle();
  await c.settle();
  assert.equal([...c.ctx.properties.querySelectorAll(".testlab-page-state")].at(-1)!.textContent, "Up to date with the design.");

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

/** A study set up on Body 1 as a person would: made of `material`, the bottom held, Load 1 (10 N down) on the top. */
async function setUp(c: ReturnType<typeof context>, material = "pla") {
  const page = mountTestLabPage(c.ctx);
  await page.ready;
  chooseMaterial(c, material);
  c.click("[data-testlab=pick-held]");
  await c.tap(1);
  c.click("[data-testlab=add-load]");
  await c.tap(0);
  c.click("[data-testlab=pick-load]"); // done picking
  return page;
}
const last = <E extends Element>(c: ReturnType<typeof context>, sel: string) => [...c.ctx.properties.querySelectorAll<E>(sel)].at(-1) ?? null;

test("Run: the result drawn bent and coloured by stress, the numbers and the safety factor in the panel, an estimate; Bend recolours", async () => {
  const c = context(1);
  design.names["body:feature-1"] = ["top", "bottom", "front", null];
  const page = await setUp(c, "pla");
  c.click("[data-testlab=run]");
  for (let i = 0; i < 4; i++) await c.settle();
  // PLA across the layers: 35 MPa breaking strength; the stand-in's biggest stress 10 MPa, so 35 / 10 = 3.5, safe.
  const box = last<HTMLElement>(c, ".testlab-results")!;
  assert.ok(box, "a result is shown");
  assert.equal(box.dataset.stale, "false");
  assert.equal(last(c, ".testlab-results-factor")!.getAttribute("data-band"), "safe");
  assert.equal(last(c, ".testlab-results-factor-value")!.textContent, "3.5");
  assert.match(box.textContent!, /Biggest bend0\.002 mm/);
  assert.match(box.textContent!, /Biggest stress10 MPa \(PLA's breaking strength: 35 MPa, across the layers\)/);
  assert.match(box.textContent!, /An estimate, not a promise: real prints are weaker across their layers/);
  // The stand-in's box diagonal is √2 mm and its bend 0.002 mm: a twentieth of √2 is 0.0707 mm, 35.4 times the bend,
  // rounded down to 1, 2 or 5 times a power of ten: 20.
  assert.match(box.textContent!, /The bend is drawn 20 times bigger than it really is/);
  const drawn = c.shown.at(-1)!;
  assert.deepEqual(drawn.positions.slice(0, 3), [20 * 0.002, 0, 0], "the first corner drawn moved 20 × 0.002 mm");
  // Coloured by stress from 0 to 10 MPa: the first corner (10) red, the third (0) blue.
  const near = (got: readonly number[], want: number[]) => assert.ok(got.every((x, i) => Math.abs(x - want[i]) < 1e-12), `${got} is not ${want}`);
  const colours = c.coloured.at(-1)!;
  near(colours.slice(0, 3), [0.85, 0.15, 0.12]);
  near(colours.slice(6, 9), [0.13, 0.33, 0.85]);
  assert.ok(c.overlays.has(RESULT_OVERLAY));
  assert.ok(!c.overlays.has(HELD_OVERLAY), "the set-up's paint gives way to the result");
  // Coloured by bend: only the first corner moves, so it is red and the others blue.
  (last<HTMLButtonElement>(c, "[data-testlab-by=bend]")!).click();
  const byBend = c.coloured.at(-1)!;
  near(byBend.slice(0, 3), [0.85, 0.15, 0.12]);
  near(byBend.slice(3, 6), [0.13, 0.33, 0.85]);
  // A design edit marks it out of date: still in the panel, said so; the view shows the body as it is now.
  c.graph.changed("feature-1");
  for (let i = 0; i < 4; i++) await c.settle();
  assert.equal(last<HTMLElement>(c, ".testlab-results")!.dataset.stale, "true");
  assert.match(last(c, ".testlab-results h3")!.textContent!, /out of date/);
  assert.ok(c.overlays.has(HELD_OVERLAY));
  // A set-up change takes the result away (it was for another set-up).
  chooseMaterial(c, "abs");
  assert.equal(last(c, ".testlab-results"), null);
  page.sleep!();
  assert.equal(c.coloured.at(-1), null, "sleeping takes the colours off the shared view");
  page.unmount();
});

test("Run: a progress line and Cancel while it works; Cancel stops the test and shows nothing", async () => {
  const c = context(1);
  design.names["body:feature-1"] = ["top", "bottom", "front", null];
  const page = await setUp(c);
  c.kernel.hold = true;
  c.click("[data-testlab=run]");
  for (let i = 0; i < 4; i++) await c.settle();
  assert.equal(last(c, ".testlab-page-progress")!.textContent, "Getting the part ready…");
  c.kernel.stage!("solving");
  assert.equal(last(c, ".testlab-page-progress")!.textContent, "Solving…");
  assert.equal(last(c, "[data-testlab=run]"), null, "no second Run while one works");
  c.click("[data-testlab=cancel]");
  assert.equal(c.kernel.stopped, 1);
  c.kernel.release!(); // the stand-in answers anyway: the page must still drop it
  for (let i = 0; i < 4; i++) await c.settle();
  assert.equal(c.status(), STOPPED);
  assert.equal(last(c, ".testlab-results"), null);
  assert.ok(last(c, "[data-testlab=run]"));
  assert.equal(c.lending.out, 0);
  page.unmount();
});

test("Run: the kernel's refusal (a curved part) said in its words; an answer that fails its checks is never shown", async () => {
  const c = context(1);
  design.names["body:feature-1"] = ["top", "bottom", "front", null];
  const page = await setUp(c);
  const curved = Object.assign(new Error("TestLab can mesh only flat-faced bodies so far; curved faces come next."), { kind: "invalid-input" });
  c.kernel.answer = () => curved;
  c.click("[data-testlab=run]");
  for (let i = 0; i < 4; i++) await c.settle();
  assert.equal(c.status(), "Not run: TestLab can mesh only flat-faced bodies so far; curved faces come next.");
  assert.equal(last(c, ".testlab-results"), null);
  // Loads and reactions that don't balance: refused, nothing drawn.
  c.kernel.answer = (t) => ({ ...standInAnswer(t), reaction: [0, 0, 5] });
  c.click("[data-testlab=run]");
  for (let i = 0; i < 4; i++) await c.settle();
  assert.match(c.status(), /TestLab's answer didn't check out \(the loads and what holds the part don't balance\), so it is not shown/);
  assert.equal(last(c, ".testlab-results"), null);
  assert.equal(last(c, ".testlab-page-state")!.textContent, "Not run yet.", "a refused run never counts as run");
  page.unmount();
});

test("Run: a set-up changed while the test works shows nothing from it", async () => {
  const c = context(1);
  design.names["body:feature-1"] = ["top", "bottom", "front", null];
  const page = await setUp(c);
  c.kernel.hold = true;
  c.click("[data-testlab=run]");
  for (let i = 0; i < 4; i++) await c.settle();
  chooseMaterial(c, "steel-a36");
  c.kernel.release!();
  for (let i = 0; i < 4; i++) await c.settle();
  assert.match(c.status(), /The set-up changed while it ran/);
  assert.equal(last(c, ".testlab-results"), null);
  page.unmount();
});
