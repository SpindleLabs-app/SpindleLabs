// TestLab's Export test file (Ben, 19 Nov) on the real kernel: a steel A36 bar 100 × 10 × 10 mm in TestLab's page
// (happy-dom) through Design's real lister, face finder and body lender, held at x = 0 and pulled 1,000 N along +X at
// x = 100, Run, then Export test file pressed. The file saved is checked by hand (its faces' areas and normals, the
// test as sent, the project it keeps, the card's summary), then run again headless (src/testlab-rerun.ts) on the same
// kernel: every check passes. Then one thing in the file is broken at a time (a stress in the answer, the load sent,
// the design's length, the kernel's version, the material's numbers) and the re-run must fail exactly the checks that
// break catches. Every body is freed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, emptyProject, RepresentationRegistry, type AnalysisOverlay, type DisplayMesh, type ViewportPick, type WorkspaceContext } from "@fission/core";
import { partDocument, registerDesign, syncGraph } from "@fission/design";
import { mountTestLabPage, readTestFile, readTestLab, setLoad, TEST_FILE_FORMAT, type TestFile } from "@fission/simulate";
import { nodeKernel } from "../src/node-kernel.ts";
import { rerunTestFile, type RerunReport } from "../src/testlab-rerun.ts";

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

/** The bar's run in TestLab's page, and the file Export test file saved, with the name it gave it. */
async function exportedRun(): Promise<{ text: string; name: string; summary: string }> {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const el = () => doc.createElement("div") as unknown as HTMLElement;
  const registry = new RepresentationRegistry();
  registerDesign(registry, kernel);
  const graph = new DependencyGraph();
  const notes = new ChangeNotes();
  const project = emptyProject("Bar");
  project.workspaces.design = partDocument("box", 100, 10, 10);
  syncGraph(graph, project.workspaces.design as never, null, notes);
  let mesh: DisplayMesh | null = null;
  const overlays = new Map<string, AnalysisOverlay>();
  const viewport = {
    element: el(),
    onPick: null as ((p: ViewportPick) => void) | null,
    showBody: (m: DisplayMesh) => void (mesh = m),
    showColourMap: () => {},
    fit: () => null,
    setOverlay: (o: AnalysisOverlay) => void overlays.set(o.id, o),
    clearOverlay: (id: string) => void overlays.delete(id),
  };
  const ctx = { project, projectChanged: () => {}, graph, changeNotes: notes, toolbar: el(), browser: el(), properties: el(), viewport, representations: registry, kernel } as unknown as WorkspaceContext;
  doc.body.append(ctx.properties);
  const last = (sel: string) => [...ctx.properties.querySelectorAll<HTMLElement>(sel)].at(-1) ?? null;
  const click = (sel: string) => last(sel)!.click();
  const tap = async (face: number) => {
    viewport.onPick!({ face, shift: false });
    await settle(() => false);
  };
  const page = mountTestLabPage(ctx);
  await page.ready;
  const left = faceAt(mesh!, 0, 0);
  const right = faceAt(mesh!, 0, 100);
  const material = last("select[name=material]") as HTMLSelectElement;
  material.value = "steel-a36";
  material.dispatchEvent(new window.Event("change") as unknown as Event);
  click("[data-testlab=pick-held]");
  await tap(left);
  click("[data-testlab=add-load]");
  await tap(right);
  click("[data-testlab=pick-load]");
  const data = readTestLab(project.workspaces.simulate);
  const s = data.studies[0];
  const r = setLoad(data, s.id, s.loads[0].id, { amount: 1000, direction: "+x" });
  assert.ok("data" in r);
  project.workspaces.simulate = r.data;
  click("[data-testlab=run]");
  await settle(() => last("[data-testlab=cancel]") !== null || last(".testlab-page-status")!.textContent !== "");
  await settle(() => last("[data-testlab=cancel]") === null);
  assert.equal(last(".testlab-page-status")!.textContent, "");
  // Export test file: the browser's download caught where it is made (the Blob's text, the link's name).
  let blob: Blob | null = null;
  let name = "";
  window.URL.createObjectURL = ((b: Blob) => ((blob = b), "blob:test")) as typeof window.URL.createObjectURL;
  window.URL.revokeObjectURL = () => {};
  const click0 = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    name = this.download;
  };
  click("[data-testlab=export-file]");
  window.HTMLAnchorElement.prototype.click = click0;
  assert.equal(last(".testlab-results-copied")!.textContent, "Test file saved.");
  assert.ok(blob, "a file was saved");
  const text = await (blob as Blob).text();
  const shown = last(".testlab-results-card")!;
  const summary = shown.querySelector(".testlab-results-verdict")!.textContent!;
  page.unmount();
  await window.happyDOM.close();
  return { text, name, summary };
}

const failed = (r: RerunReport) => r.checks.filter((c) => !c.ok).map((c) => c.name);

let made: { text: string; name: string; summary: string };
let file: TestFile;

test("Export test file: the bar's run saved whole, checked by hand", async () => {
  const before = await kernel.call("body_count");
  made = await exportedRun();
  assert.equal(await kernel.call("body_count"), before, "the run and the file's STEP free every body");
  assert.equal(made.name, "body-1.testlab.json");
  file = readTestFile(made.text);
  assert.equal(file.format, TEST_FILE_FORMAT);
  assert.equal(file.kernel.version, await kernel.call("kernel_version"));
  assert.deepEqual(Object.keys((file.project as { workspaces: object }).workspaces).sort(), ["design", "simulate"]);
  assert.deepEqual((file.project as { workspaces: { design: unknown } }).workspaces.design, JSON.parse(JSON.stringify(partDocument("box", 100, 10, 10))));
  // The bar's six faces: two ends 10 × 10 = 100 mm², four sides 100 × 10 = 1,000 mm², each normal along an axis.
  const faces = file.part.faces;
  assert.equal(faces.length, 6);
  assert.deepEqual(faces.map((f) => Math.round(f.area * 1e6) / 1e6).sort((a, b) => a - b), [100, 100, 1000, 1000, 1000, 1000]);
  const end = (x: number) => faces.find((f) => Math.abs(f.normal[0] - x) < 1e-12)!;
  assert.deepEqual(end(-1).normal.map((n) => Math.abs(n) < 1e-12 ? 0 : n), [-1, 0, 0]);
  // The test as sent: the x = 0 end held, the x = 100 end pulled 1,000 N along +X; A36's 199,948 MPa and 248.2 MPa
  // (29,000,000 and 36,000 psi at 6.894757 kPa a psi).
  assert.deepEqual(file.sent.held, [end(-1).index]);
  assert.deepEqual(file.sent.loads, [{ faces: [end(1).index], force: [1000, 0, 0] }]);
  assert.ok(Math.abs(file.sent.youngsModulus - 199948) < 1 && Math.abs(file.sent.strength - 248.2) < 0.1, `${file.sent.youngsModulus} ${file.sent.strength}`);
  assert.equal(file.material.id, "steel-a36");
  // The exact part as STEP text, and the kernel's whole answer: σ = F/A = 1000 / 100 = 10 MPa away from the clamp, a
  // little more at its edges (testlab-run.journey.ts), so between 10 and 12 at most.
  assert.match(file.part.step!, /^ISO-10303-21;/);
  assert.equal(file.part.stepRefused, null);
  assert.ok(file.answer.maxVonMises >= 10 && file.answer.maxVonMises <= 12, `${file.answer.maxVonMises}`);
  assert.equal(file.answer.vonMises.length, file.answer.points.length / 3);
  // The summary is the card's Copy summary text, the verdict leading.
  assert.match(file.summary, new RegExp(`^TestLab result: ${made.summary} \\(safety factor `));
});

test("the file run again headless on the same kernel: every check passes", async () => {
  const before = await kernel.call("body_count");
  const r = await rerunTestFile(made.text, kernel);
  assert.deepEqual(failed(r), [], JSON.stringify(r.checks, null, 1));
  assert.deepEqual(
    r.checks.map((c) => c.name),
    ["same kernel", "same material", "same exact part (STEP)", "same faces", "same test sent", "answer checks out", "same answer", "file's loads add up", "file's holds balance the loads", "file's safety factor"],
  );
  assert.equal(r.answer!.maxVonMises, file.answer.maxVonMises);
  assert.equal(await kernel.call("body_count"), before);
});

/** The made file changed by `change`, run again: the names of the checks that failed. */
async function brokenBy(change: (f: Record<string, any>) => void): Promise<string[]> {
  const f = JSON.parse(made.text);
  change(f);
  return failed(await rerunTestFile(JSON.stringify(f), kernel));
}

test("one thing broken at a time: the re-run fails exactly the checks that catch it", async () => {
  const before = await kernel.call("body_count");
  // A stress in the answer lowered a little (not the biggest, so the file still reads): only the answer differs.
  assert.deepEqual(
    await brokenBy((f) => {
      const i = f.answer.vonMises.findIndex((v: number) => v < f.answer.maxVonMises);
      f.answer.vonMises[i] *= 0.999;
    }),
    ["same answer"],
  );
  // The load sent 1,001 N, not the study's 1,000: the study no longer turns into it, the new answer differs, and the
  // kernel applied 1,000 of the 1,001 the file says.
  assert.deepEqual(await brokenBy((f) => (f.sent.loads[0].force = [1001, 0, 0])), ["same test sent", "same answer", "file's loads add up"]);
  // The design's bar 101 long, not 100: a different exact part (its STEP and its sides' areas), so a different answer.
  assert.deepEqual(await brokenBy((f) => (f.project.workspaces.design.timeline.features[0].intent.parameters.width = 101)), ["same exact part (STEP)", "same faces", "same answer"]);
  // Another kernel's version: said, and nothing else.
  assert.deepEqual(await brokenBy((f) => (f.kernel.version = "0.0.1")), ["same kernel"]);
  // The material's stiffness in the file 1% under this build's (steel's two ways are equal, so it is the weaker way
  // TestLab sends): said, and the study turns into a different test from these numbers; the test the file sent still
  // runs to the same answer.
  assert.deepEqual(await brokenBy((f) => (f.material.mechanical.stiffness.acrossLayers *= 0.99)), ["same material", "same test sent"]);
  assert.equal(await kernel.call("body_count"), before, "every rebuild freed");
});
