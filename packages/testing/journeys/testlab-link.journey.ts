// TestLab step T1, the live link on the real kernel: TestLab's page (happy-dom) on a project whose design is Design's own
// data, read through Design's real lister and face finder, with Design's own dependency-graph sync and change notes.
// A 40 × 30 × 20 box: its bottom held, its top pushed by 5 kg; the box made 35 high keeps both faces (found again by
// name, at the heights worked out by hand) and marks the study out of date with a note naming the edit; the box made a
// sphere loses both faces, said in words, never dropped; Undo's data brings them back. No export, no copy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, emptyProject, RepresentationRegistry, type AnalysisOverlay, type DisplayMesh, type ViewportPick, type WorkspaceContext } from "@fission/core";
import { changePreset, partDocument, registerDesign, syncGraph, type DesignDocument } from "@fission/design";
import { HELD_OVERLAY, loadOverlay, mountTestLabPage, readTestLab, setTestLabShown, simulateWorkspace, studyNode } from "@fission/simulate";
import { nodeKernel } from "../src/node-kernel.ts";

const { Window } = await import("happy-dom");
const kernel = nodeKernel();
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

/** The z values of the corners of the triangles on face `f`. */
const zsOn = (m: DisplayMesh, f: number) => new Set(m.triangle_faces.flatMap((t, i) => (t === f ? [0, 1, 2].map((k) => m.positions[3 * m.indices[3 * i + k] + 2]) : [])));

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
  const viewport = {
    onPick: null as ((p: ViewportPick) => void) | null,
    showBody: (m: DisplayMesh) => void (mesh = m),
    fit: () => null,
    setOverlay: (o: AnalysisOverlay) => void overlays.set(o.id, o),
    clearOverlay: (id: string) => void overlays.delete(id),
  };
  const steps: string[] = [];
  const ctx = { project, projectChanged: (l?: string) => void steps.push(l ?? "Edit"), graph, changeNotes: notes, toolbar: el(), browser: el(), properties: el(), viewport, representations: registry } as unknown as WorkspaceContext;
  /** Design's edit, as its workspace records one: the data, then the graph and the notes. */
  const edit = (next: DesignDocument) => {
    const before = project.workspaces.design as DesignDocument;
    project.workspaces.design = next;
    syncGraph(graph, next, before, notes);
  };
  /** The face the body shows with these words now, by asking Design as the page does. */
  const faceCalled = async (label: string) => {
    const s = readTestLab(project.workspaces.simulate).studies[0];
    const got = await registry.facesOf("design", project, s.body!.ref, []);
    const i = got.labels.indexOf(label);
    assert.ok(i >= 0, `no ${label}: ${got.labels.join(", ")}`);
    return i;
  };
  const tap = async (face: number) => {
    viewport.onPick!({ face, shift: false });
    await settle();
  };
  const click = (sel: string) => (ctx.properties.querySelector(sel) as HTMLButtonElement).click();
  const status = () => ctx.properties.querySelector(".testlab-page-status")!.textContent!;
  return { ctx, graph, notes, overlays, steps, edit, faceCalled, tap, click, status, mesh: () => mesh!, data: () => readTestLab(project.workspaces.simulate) };
}

test("TestLab is still the placeholder without ?testlab, and its page with it", () => {
  assert.equal(simulateWorkspace.status, "placeholder");
  assert.equal(simulateWorkspace.title, "TestLab");
  setTestLabShown(true);
  setTestLabShown(null);
});

test("hand-worked: the box's bottom held and top pushed follow it made 35 high, out of date with a note; a sphere loses both, in words", async () => {
  const before = await kernel.call("body_count");
  const box = partDocument("box", 40, 30, 20);
  const t = setUp(box);
  const page = mountTestLabPage(t.ctx);
  await page.ready;
  assert.equal(t.data().studies[0].body?.label, "Body 1"); // the only body, set up without being asked

  // Hold the bottom, add a load, push the top, make it 5 kg hanging.
  t.click("[data-testlab=pick-held]");
  await t.tap(await t.faceCalled("Bottom face"));
  t.click("[data-testlab=add-load]");
  await settle();
  await t.tap(await t.faceCalled("Top face"));
  t.click("[data-testlab=pick-load]"); // Done picking
  const Event = (t.ctx.properties.ownerDocument.defaultView as unknown as typeof globalThis).Event;
  const amount = t.ctx.properties.querySelector<HTMLInputElement>("input[name=amount]")!;
  amount.value = "5";
  amount.dispatchEvent(new Event("change"));
  const unit = t.ctx.properties.querySelector<HTMLSelectElement>("select[name=unit]")!;
  unit.value = "kg";
  unit.dispatchEvent(new Event("change"));
  await settle();
  assert.deepEqual(t.steps, ["Test Body 1", "Hold Bottom face", "Add load", "Push Top face with Load 1", "Change Load 1", "Change Load 1"]);
  assert.match(t.ctx.properties.textContent!, /5 kg hanging \(49\.0 N\) down on 1 face/); // 5 × 9.80665 = 49.03 N
  t.click("[data-testlab=run]");
  await settle();
  const node = studyNode("study-1");
  assert.equal(t.graph.isStale(node), false);

  // Made 35 high: both faces found again; the pushed face's triangles at z 35 above the held one's (hand-worked: the height).
  t.edit(changePreset(box, "feature-1", "box", 40, 30, 35));
  assert.equal(t.graph.isStale(node), true);
  assert.ok(
    t.notes.current(t.graph).some((n) => n.node === node && /^Study 1 out of date: you changed the box in DesignLab\./.test(n.text)),
    JSON.stringify(t.notes.current(t.graph)),
  );
  page.sleep!();
  page.wake!();
  await settle();
  const held = t.overlays.get(HELD_OVERLAY)!.marks.map((m) => (m.target as { face: number }).face);
  const s = t.data().studies[0];
  const pushed = t.overlays.get(loadOverlay(s.loads[0].id))!.marks.map((m) => (m.target as { face: number }).face);
  assert.equal(held.length, 1);
  assert.equal(pushed.length, 1);
  const [low] = [...zsOn(t.mesh(), held[0])];
  assert.deepEqual([...zsOn(t.mesh(), pushed[0])].map((z) => z - low), [35]);
  assert.equal(t.status(), "");
  assert.match(t.ctx.properties.querySelector(".testlab-page-state")!.textContent!, /^Out of date/);

  // Made a sphere: neither face is on it; both said, nothing dropped, and Run refuses.
  const sphere = changePreset(box, "feature-1", "sphere", 40, 30, 20);
  t.edit(sphere);
  page.sleep!();
  page.wake!();
  await settle();
  assert.match(t.status(), /Held here lost its face Bottom face: the last edit took it off the body\./);
  assert.match(t.status(), /Load 1 lost its face Top face: the last edit took it off the body\./);
  assert.deepEqual(t.data().studies[0].fixtures[0].faces.map((f) => f.label), ["Bottom face"]);
  t.click("[data-testlab=run]");
  await settle();
  assert.match(t.status(), /^Not run/);

  // Undo's data (the box back): both found again.
  t.edit(box);
  page.sleep!();
  page.wake!();
  await settle();
  assert.equal(t.status(), "");
  assert.equal(t.overlays.get(HELD_OVERLAY)!.marks.length, 1);
  page.unmount();
  assert.equal(await kernel.call("body_count"), before);
});
