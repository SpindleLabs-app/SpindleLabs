// TestLab step T5b, Run on the real kernel: TestLab's page (happy-dom) on a project whose design is Design's own data,
// through Design's real lister, face finder and body lender, the kernel's own stress test. A steel bar 100 mm long,
// 10 × 10 mm across, held at its x = 0 end: pulled 1000 N along +X at the other end, then pushed 100 N down. Every
// answer is worked out by hand from beam theory in the comment beside it; a cylinder is refused in the kernel's words;
// every body the runs build is freed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, emptyProject, materialLibrary, RepresentationRegistry, weakerWay, type AnalysisOverlay, type DisplayMesh, type ViewportPick, type WorkspaceContext } from "@fission/core";
import { changePreset, partDocument, registerDesign, syncGraph, type DesignDocument } from "@fission/design";
import { mountTestLabPage, readTestLab, RESULT_OVERLAY, setLoad } from "@fission/simulate";
import { nodeKernel } from "../src/node-kernel.ts";

const { Window } = await import("happy-dom");
const kernel = nodeKernel();
const settle = async (until: () => boolean) => {
  for (let i = 0; i < 2000 && !until(); i++) await new Promise((r) => setTimeout(r, 1));
};

/** The face of `m` whose every corner has coordinate `axis` equal to `at`. */
function faceAt(m: DisplayMesh, axis: number, at: number): number {
  const faces = new Set(m.triangle_faces.filter((_, t) => [0, 1, 2].every((k) => Math.abs(m.positions[3 * m.indices[3 * t + k] + axis] - at) < 1e-9)));
  assert.equal(faces.size, 1, `one face at ${"xyz"[axis]} = ${at}`);
  return [...faces][0];
}

function setUp(start: DesignDocument) {
  const doc = new Window().document as unknown as Document;
  const el = () => doc.createElement("div") as unknown as HTMLElement;
  const registry = new RepresentationRegistry();
  registerDesign(registry, kernel);
  const graph = new DependencyGraph();
  const notes = new ChangeNotes();
  const project = emptyProject();
  project.workspaces.design = start;
  syncGraph(graph, start, null, notes);
  const overlays = new Map<string, AnalysisOverlay>();
  let mesh: DisplayMesh | null = null;
  let colours: readonly number[] | null = null;
  const viewport = {
    element: el(), // the view's element: TestLab's picking hint goes in it (T5c5a)
    onPick: null as ((p: ViewportPick) => void) | null,
    showBody: (m: DisplayMesh) => void (mesh = m),
    showColourMap: (c: readonly number[] | null) => void (colours = c),
    fit: () => null,
    setOverlay: (o: AnalysisOverlay) => void overlays.set(o.id, o),
    clearOverlay: (id: string) => void overlays.delete(id),
  };
  const ctx = { project, projectChanged: () => {}, graph, changeNotes: notes, toolbar: el(), browser: el(), properties: el(), viewport, representations: registry, kernel } as unknown as WorkspaceContext;
  const last = (sel: string) => [...ctx.properties.querySelectorAll<HTMLElement>(sel)].at(-1) ?? null;
  const click = (sel: string) => last(sel)!.click();
  const tap = async (face: number) => {
    viewport.onPick!({ face, shift: false });
    await settle(() => false);
  };
  const choose = (name: string, value: string) => {
    const s = last(`select[name=${name}]`) as HTMLSelectElement;
    s.value = value;
    s.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).Event("change"));
  };
  const status = () => last(".testlab-page-status")!.textContent!;
  /** Run pressed, waited on until the panel shows a result or says why not. */
  const run = async () => {
    click("[data-testlab=run]");
    await settle(() => last("[data-testlab=cancel]") !== null || status() !== "");
    await settle(() => last("[data-testlab=cancel]") === null);
  };
  return { ctx, project, overlays, last, click, tap, choose, status, run, mesh: () => mesh!, colours: () => colours, data: () => readTestLab(project.workspaces.simulate) };
}

test("hand-worked: a steel bar pulled and bent, the kernel's answers against beam theory", async () => {
  const before = await kernel.call("body_count");
  const t = setUp(partDocument("box", 100, 10, 10));
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  const m = t.mesh();
  const left = faceAt(m, 0, 0);
  const right = faceAt(m, 0, 100);
  t.choose("material", "steel-a36");
  t.click("[data-testlab=pick-held]");
  await t.tap(left);
  t.click("[data-testlab=add-load]");
  await t.tap(right);
  t.click("[data-testlab=pick-load]");
  const s = t.data().studies[0];
  const r = setLoad(t.data(), s.id, s.loads[0].id, { amount: 1000, direction: "+x" });
  assert.ok("data" in r);
  t.project.workspaces.simulate = r.data;
  await t.run();
  assert.equal(t.status(), "");
  // A36: E = 29,000,000 psi = 199,948 MPa (6.894757 kPa a psi); yield 36,000 psi = 248.2 MPa.
  const steel = weakerWay(materialLibrary().get("steel-a36")!.mechanical!);
  const E = steel.stiffness / 1e6;
  const yieldMpa = steel.strength / 1e6;
  assert.ok(Math.abs(E - 199948) < 1);
  // Pulled: σ = F/A = 1000 N / 100 mm² = 10 MPa; δ = FL/(EA) = 1000 · 100 / (199,948 · 100) = 0.0050013 mm. The clamp
  // stops the held end narrowing (Poisson), which stiffens the bar a little near it: the end moves slightly less, by
  // under 1%, and the stress at the clamp's edges reads a little higher than 10 MPa.
  const facts = () => [...t.ctx.properties.querySelectorAll(".testlab-results-facts dd")].slice(-2).map((d) => d.textContent!);
  const delta = (1000 * 100) / (E * 100);
  const shownBend = Number(facts()[0].replace(" mm", ""));
  assert.ok(shownBend <= delta * 1.000001 && shownBend >= delta * 0.99, `bend ${shownBend} mm against ${delta} mm`);
  const stress = Number(facts()[1].split(" ")[0]);
  assert.ok(stress >= 10 && stress <= 12, `stress ${stress} MPa against 10 MPa`);
  // Safety factor: 248.2 / about 10.9: about 23, safe.
  assert.equal(t.last(".testlab-results-factor")!.getAttribute("data-band"), "safe");
  const factor = Number(t.last(".testlab-results-factor-value")!.textContent);
  assert.ok(Math.abs(factor - yieldMpa / stress) / factor < 0.01, `factor ${factor} against ${yieldMpa / stress}`);
  assert.ok(t.overlays.has(RESULT_OVERLAY));
  assert.equal(t.colours()!.length, t.mesh().positions.length, "a colour for every vertex drawn");

  // Bent: 100 N down on the free end. Tip δ = FL³/(3EI), I = b h³/12 = 10 · 10³ / 12 = 833.33 mm⁴:
  // 100 · 100³ / (3 · 199,948 · 833.33) = 0.20005 mm; shear adds about (3/κ)(E/G)(h/L)²/4 of it, under 1% here.
  // Root stress M c / I = (100 · 100) · 5 / 833.33 = 60 MPa, a little higher right at the clamp's corners.
  const s2 = t.data().studies[0];
  const r2 = setLoad(t.data(), s2.id, s2.loads[0].id, { amount: 100, direction: "down" });
  assert.ok("data" in r2);
  t.project.workspaces.simulate = r2.data;
  await t.run();
  const tip = (100 * 100 ** 3) / (3 * E * ((10 * 10 ** 3) / 12));
  const bent = Number(facts()[0].replace(" mm", ""));
  assert.ok(bent >= tip && bent <= tip * 1.01, `tip ${bent} mm against ${tip} mm`);
  const root = Number(facts()[1].split(" ")[0]);
  assert.ok(root >= 60 * 0.99 && root <= 60 * 1.2, `root stress ${root} MPa against 60 MPa`);
  page.unmount();
  assert.equal(await kernel.call("body_count"), before, "every body the runs built is freed");
});

test("a cylinder is refused in the kernel's words, nothing shown", async () => {
  const before = await kernel.call("body_count");
  const t = setUp(changePreset(partDocument("box", 10, 10, 10), "feature-1", "cylinder", 10, 10, 20));
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  t.choose("material", "pla");
  t.click("[data-testlab=pick-held]");
  await t.tap(faceAt(t.mesh(), 2, 0));
  t.click("[data-testlab=add-load]");
  await t.tap(faceAt(t.mesh(), 2, 20));
  t.click("[data-testlab=pick-load]");
  await t.run();
  assert.equal(t.status(), "Not run: TestLab can mesh only flat-faced bodies so far; curved faces come next.");
  assert.equal(t.last(".testlab-results"), null);
  page.unmount();
  assert.equal(await kernel.call("body_count"), before);
});
