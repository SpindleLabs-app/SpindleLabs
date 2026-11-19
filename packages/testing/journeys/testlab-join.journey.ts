// TestLab, bodies joined for a test (Ben, 2026-11-19), on the real kernel: TestLab's page (happy-dom) on Design's own
// data through Design's real lister, face finder and body lender, the kernel's union and stress test. Box 1 is a steel
// bar 50 × 10 × 10 at x 0..50; Box 2 the same moved along X. Joined, they are one bar: held at x = 0, pushed down at
// the other end, the answer is worked out by hand from beam theory beside it. Every refusal (bodies apart, a face
// inside the join, a held and a pushed face made one) is said in words; the design is never changed; every body the
// runs and checks build is freed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, emptyProject, materialLibrary, RepresentationRegistry, weakerWay, type AnalysisOverlay, type DisplayMesh, type ViewportPick, type WorkspaceContext } from "@fission/core";
import { changePreset, insertMove, insertPreset, partDocument, registerDesign, syncGraph, type DesignDocument } from "@fission/design";
import { mountTestLabPage, readTestFile, readTestLab, setLoad } from "@fission/simulate";
import { rerunTestFile, type RerunReport } from "../src/testlab-rerun.ts";
import { nodeKernel } from "../src/node-kernel.ts";

const { Window } = await import("happy-dom");
const kernel = nodeKernel();
const settle = async (until: () => boolean) => {
  for (let i = 0; i < 4000 && !until(); i++) await new Promise((r) => setTimeout(r, 1));
};
const NO = { x: 0, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };

/** Box 1 (`long` × 10 × 10 at the origin) and Box 2, the same moved `dx` along X. */
function twoBars(dx: number, long = 20): DesignDocument {
  const one = partDocument("box", long, 10, 10);
  const two = insertPreset(one, "box", long, 10, 10);
  return insertMove(two.doc, [`body:${two.id}`], { ...NO, x: dx }).doc;
}

/** The faces of `m` whose every corner has coordinate `axis` equal to `at`, by face, in order. */
function facesAt(m: DisplayMesh, axis: number, at: number): number[] {
  return [...new Set(m.triangle_faces.filter((_, t) => [0, 1, 2].every((k) => Math.abs(m.positions[3 * m.indices[3 * t + k] + axis] - at) < 1e-9)))].sort((a, b) => a - b);
}

function setUp(start: DesignDocument) {
  const win = new Window();
  const doc = win.document as unknown as Document;
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
  const find = (root: HTMLElement, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)].at(-1) ?? null;
  const last = (sel: string) => find(ctx.properties, sel);
  const inList = (sel: string) => find(ctx.browser, sel);
  const Ev = (win as unknown as typeof globalThis).Event;
  const tick = (value: string) => {
    const c = ctx.browser.querySelector<HTMLInputElement>(`input[name=join-body][value="${value}"], input[name=join-all][value="${value}"]`)!;
    c.checked = !c.checked;
    c.dispatchEvent(new Ev("change"));
  };
  const tap = async (face: number) => {
    viewport.onPick!({ face, shift: false });
    await settle(() => false);
  };
  const choose = (name: string, value: string) => {
    const s = last(`select[name=${name}]`) as HTMLSelectElement;
    s.value = value;
    s.dispatchEvent(new Ev("change"));
  };
  const status = () => last(".testlab-page-status")?.textContent ?? "";
  const run = async () => {
    last("[data-testlab=run]")!.click();
    await settle(() => last("[data-testlab=cancel]") !== null || status() !== "");
    await settle(() => last("[data-testlab=cancel]") === null);
  };
  const data = () => readTestLab(project.workspaces.simulate);
  /** Body `n` (from 0) chosen to test, as a tap on its row does. */
  const testBody = async (n: number) => {
    const r = ctx.browser.querySelectorAll<HTMLInputElement>("input[name=testlab-body]")[n];
    r.checked = true;
    r.dispatchEvent(new Ev("change"));
    await settle(() => false);
  };
  /** Sets the first load's amount and direction. */
  const load = (amount: number, direction: "down" | "+x") => {
    const s = data().studies[0];
    const r = setLoad(data(), s.id, s.loads[0].id, { amount, direction });
    assert.ok("data" in r);
    project.workspaces.simulate = r.data;
  };
  /** Waits for the join check started by the last look-up. */
  const checked = () => settle(() => false);
  /** Export test file pressed: the text the browser would save (its Blob caught where it is made). */
  const exported = async (): Promise<string> => {
    let blob: Blob | null = null;
    const w = win as unknown as typeof globalThis;
    w.URL.createObjectURL = ((b: Blob) => ((blob = b), "blob:test")) as typeof URL.createObjectURL;
    w.URL.revokeObjectURL = () => {};
    const click0 = w.HTMLAnchorElement.prototype.click;
    w.HTMLAnchorElement.prototype.click = () => {};
    last("[data-testlab=export-file]")!.click();
    w.HTMLAnchorElement.prototype.click = click0;
    assert.ok(blob, "a file was saved");
    return (blob as Blob).text();
  };
  return { ctx, project, graph, notes, last, inList, testBody, tick, tap, choose, status, run, data, load, checked, exported, mesh: () => mesh! };
}

/** Joins the bodies through the Join chooser (each of `ids` after the first ticked, or All), waits for the view of them. */
async function joinAll(t: ReturnType<typeof setUp>, ids: string[], all = false) {
  t.inList("[data-testlab=join]")!.click();
  // Only the study's own body is ticked: Join is off until a second body (or All) is.
  assert.equal((t.inList("[data-testlab=join-ok]") as HTMLButtonElement).disabled, true);
  if (all) t.tick("all");
  else for (const id of ids.slice(1)) t.tick(id);
  assert.equal((t.inList("[data-testlab=join-ok]") as HTMLButtonElement).disabled, false);
  t.inList("[data-testlab=join-ok]")!.click();
  await settle(() => false);
}

/** Steel, held at x = 0 (Box 1's end) and 100 N down on x = `end` (Box 2's end). */
async function cantilever(t: ReturnType<typeof setUp>, end: number) {
  t.choose("material", "steel-a36");
  t.last("[data-testlab=pick-held]")!.click();
  const [root] = facesAt(t.mesh(), 0, 0);
  await t.tap(root);
  t.last("[data-testlab=add-load]")!.click();
  const [tip] = facesAt(t.mesh(), 0, end);
  await t.tap(tip);
  t.last("[data-testlab=pick-load]")!.click();
  t.load(100, "down");
}

const facts = (t: ReturnType<typeof setUp>) => [...t.ctx.properties.querySelectorAll(".testlab-results-facts dd")].slice(-2).map((d) => d.textContent!);

test("hand-worked: two 50 mm bars end to end, joined only for the test, bend as one 100 mm bar", async () => {
  const before = await kernel.call("body_count");
  const design = twoBars(50, 50); // Box 2 at x 50..100: the two meet face to face at x = 50
  const saved = JSON.stringify(design);
  const t = setUp(design);
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  // Two bodies: none chosen without asking, Join offered.
  const ids = [...t.ctx.browser.querySelectorAll<HTMLInputElement>("input[name=testlab-body]")].map((r) => r.closest("li")!.textContent!.trim());
  assert.deepEqual(ids, ["Body 1", "Body 2"]);
  await t.testBody(0);
  const refs = [`body:${design.timeline.features[0].id}`, `body:${design.timeline.features[1].id}`];
  await joinAll(t, refs);
  assert.deepEqual(t.data().studies[0].joined, [{ ref: { kind: "body", id: refs[1] }, label: "Body 2" }]);
  assert.match(t.last(".testlab-page-body")!.textContent!, /^Joined for this test: Body 1 and Body 2\. The design isn't changed\.$/);
  // The view shows both bodies side by side for picking: 6 + 6 faces, two of them on the plane x = 50.
  assert.equal(new Set(t.mesh().triangle_faces).size, 12);
  assert.equal(facesAt(t.mesh(), 0, 50).length, 2);
  await cantilever(t, 100);
  await t.checked();
  await t.run();
  assert.equal(t.status(), "");
  // A36: E = 199,948 MPa. Tip δ = FL³/(3EI), I = b h³/12 = 10 · 10³/12 = 833.33 mm⁴, L = 100:
  // 100 · 100³ / (3 · 199,948 · 833.33) = 0.20005 mm; shear adds about (3/κ)(E/G)(h/L)²/4 of it, under 1% here.
  // (The one-body bar of testlab-run.journey.ts: the same numbers and bounds.)
  const E = weakerWay(materialLibrary().get("steel-a36")!.mechanical!).stiffness / 1e6;
  const tip = (100 * 100 ** 3) / (3 * E * ((10 * 10 ** 3) / 12));
  const bent = Number(facts(t)[0].replace(" mm", ""));
  assert.ok(bent >= tip && bent <= tip * 1.01, `tip ${bent} mm against ${tip} mm`);
  // Root stress M c / I = (100 · 100) · 5 / 833.33 = 60 MPa, a little higher right at the clamp's corners.
  const root = Number(facts(t)[1].split(" ")[0]);
  assert.ok(root >= 60 * 0.99 && root <= 60 * 1.2, `root stress ${root} MPa against 60 MPa`);
  // The card names the joined part; the design was never changed.
  assert.match(t.last(".testlab-results")!.textContent!, /Body 1 and Body 2, joined/);
  assert.equal(JSON.stringify(t.project.workspaces.design), saved);
  // The same bar as one 100 mm body gives the same answer to a part in a thousand (self-consistency).
  const one = setUp(partDocument("box", 100, 10, 10));
  const p2 = mountTestLabPage(one.ctx);
  await p2.ready;
  await cantilever(one, 100);
  await one.run();
  const single = Number(facts(one)[0].replace(" mm", ""));
  assert.ok(Math.abs(single - bent) <= 1e-3 * single, `joined ${bent} mm, one body ${single} mm`);
  console.log(`joined bar: tip ${bent} mm, root ${root} MPa; one body ${single} mm; beam theory ${tip} mm, 60 MPa`);
  // A design edit: Box 2 made 70 long (x 50..120). The join is made again from the design as it is now: the load's
  // face is found at x = 120, nothing is lost, and Run bends the 120 mm bar: 100 · 120³ / (3 E I) = 0.34569 mm.
  const edited = changePreset(design, design.timeline.features[1].id, "box", 70, 10, 10);
  t.project.workspaces.design = edited;
  syncGraph(t.graph, edited, design, t.notes); // as Design does after an edit: the study is marked out of date
  assert.match(t.last(".testlab-page-state")!.textContent!, /Out of date/);
  page.sleep?.();
  page.wake?.();
  await settle(() => false);
  assert.equal(facesAt(t.mesh(), 0, 120).length, 1);
  assert.ok(!/lost/.test(t.status()), t.status());
  await t.run();
  const longer = (100 * 120 ** 3) / (3 * E * ((10 * 10 ** 3) / 12));
  const bent2 = Number(facts(t)[0].replace(" mm", ""));
  assert.ok(bent2 >= longer && bent2 <= longer * 1.01, `tip ${bent2} mm against ${longer} mm`);
  page.unmount();
  p2.unmount();
  assert.equal(await kernel.call("body_count"), before, "every body the join and runs built is freed");
});

test("bodies apart are refused in words before Run, and Run says the same", async () => {
  const before = await kernel.call("body_count");
  const design = twoBars(30); // Box 2 at x 30..50: a 10 mm gap
  const t = setUp(design);
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  await t.testBody(0);
  await joinAll(t, [`body:${design.timeline.features[0].id}`, `body:${design.timeline.features[1].id}`], true);
  assert.equal(t.data().studies[0].joined, "all");
  await t.checked();
  const apart = "Body 1 and Body 2 don't all touch, so they can't be joined into one part (joining them gives 2 separate pieces). Move them in Design so they touch or overlap, or test them one at a time.";
  assert.ok(t.status().includes(apart), t.status());
  // Set up fully (held at x = 0, pushed at x = 50): Run still refuses in the same words, and shows nothing.
  t.choose("material", "pla");
  t.last("[data-testlab=pick-held]")!.click();
  await t.tap(facesAt(t.mesh(), 0, 0)[0]);
  t.last("[data-testlab=add-load]")!.click();
  await t.tap(facesAt(t.mesh(), 0, 50)[0]);
  t.last("[data-testlab=pick-load]")!.click();
  await t.run();
  assert.ok(t.status().includes(apart), t.status());
  assert.equal(t.last(".testlab-results"), null);
  await t.checked(); // the join check the last pick started frees its bodies when it ends
  page.unmount();
  assert.equal(await kernel.call("body_count"), before);
});

test("a face inside the join is lost in words; faces made one with an unpicked face are said; held and pushed made one is refused", async () => {
  const before = await kernel.call("body_count");
  const design = twoBars(20);
  const t = setUp(design);
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  await t.testBody(0);
  await joinAll(t, [`body:${design.timeline.features[0].id}`, `body:${design.timeline.features[1].id}`]);
  t.choose("material", "pla");
  // Hold Box 1's x = 20 end: it lies wholly against Box 2, so the join leaves none of it outside.
  t.last("[data-testlab=pick-held]")!.click();
  const [inner] = facesAt(t.mesh(), 0, 20);
  await t.tap(inner);
  t.last("[data-testlab=add-load]")!.click();
  const [tip] = facesAt(t.mesh(), 0, 40);
  await t.tap(tip);
  t.last("[data-testlab=pick-load]")!.click();
  await t.checked();
  assert.ok(t.status().includes("it is where the bodies join, so none of it is left on the outside of the joined part"), t.status());
  // Hold Box 1's top (z = 10) instead: once joined it is one face with Box 2's top, which the hold then takes too.
  const tops = facesAt(t.mesh(), 2, 10);
  assert.equal(tops.length, 2);
  t.last("[data-testlab=pick-held]")!.click();
  await t.tap(inner); // let go of the inner face
  await t.tap(tops[0]);
  t.last("[data-testlab=pick-held]")!.click();
  await t.checked();
  assert.ok(t.status().includes("Held here: joining makes Top face of Body 2 one face with a face it picked, so it holds that too."), t.status());
  // Push Box 2's top with the load: it is the same joined face as the held one, refused naming both.
  t.last("[data-testlab=pick-load]")!.click();
  await t.tap(tops[1]);
  t.last("[data-testlab=pick-load]")!.click();
  await t.checked();
  assert.ok(t.status().includes("are one face, held and pushed by Load 1 at once: pick faces that stay apart"), t.status());
  await t.checked();
  page.unmount();
  assert.equal(await kernel.call("body_count"), before);
});

test("Export test file of a joined run keeps the joined part, and runs again headless on it", async () => {
  const before = await kernel.call("body_count");
  const design = twoBars(50, 50);
  const t = setUp(design);
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  await t.testBody(0);
  await joinAll(t, [`body:${design.timeline.features[0].id}`, `body:${design.timeline.features[1].id}`]);
  await cantilever(t, 100);
  await t.checked();
  await t.run();
  assert.equal(t.status(), "");
  const text = await t.exported();
  page.unmount();
  const file = readTestFile(text);
  // The part recorded is the joined one, worked by hand: the two 50 × 10 × 10 bars meet face to face at x = 50, so the
  // union is one 100 × 10 × 10 bar, its four long sides merged from level halves: two ends of 10 × 10 = 100 mm² and
  // four sides of 100 × 10 = 1,000 mm². Body 1 alone would have four sides of 500 mm².
  assert.deepEqual(file.part.faces.map((f) => Math.round(f.area * 1e6) / 1e6).sort((a, b) => a - b), [100, 100, 1000, 1000, 1000, 1000]);
  assert.match(file.part.step!, /^ISO-10303-21;/);
  const kept = readTestLab((file.project as { workspaces: { simulate: unknown } }).workspaces.simulate);
  assert.deepEqual(kept.studies[0].joined, t.data().studies[0].joined, "the join is in the file's project");
  // Run again headless: it joins the bodies as the page did, so every check passes.
  const failed = (r: RerunReport) => r.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.deepEqual(failed(await rerunTestFile(text, kernel)), []);
  // Deliberate break: the join taken out of the file's project, the re-run tests Body 1 alone, a 50 mm bar, and says so.
  const f = JSON.parse(text);
  delete f.project.workspaces.simulate.studies[0].joined;
  const broken = failed(await rerunTestFile(JSON.stringify(f), kernel));
  assert.ok(broken.includes("same exact part (STEP)") && broken.includes("same faces"), broken.join(", "));
  assert.equal(await kernel.call("body_count"), before, "every body the run, the file and the re-runs built is freed");
});
