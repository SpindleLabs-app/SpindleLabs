// The Laser page (page.ts): reading parts through a registry, the saved choices, the view's mesh, and the page in a DOM
// (happy-dom). The real app in Chromium: apps/fission/e2e/laser-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type Outline, type WorkspaceContext } from "@fission/core";
import { bedMesh, laserWorkspace, layOut, layoutWords, mountLaserPage, OUTLINES_LISTER, partMeshes, readLaserData, readParts, setLaserShown, type SaveText } from "../src/index.ts";

const { Window } = await import("happy-dom");

const rect = (w: number, h: number): Outline => ({ outer: { path: { corners: [0, 0, w, 0, w, h, 0, h], bulges: [] } }, holes: [] });

function fakeRegistry(open: string[] = []) {
  const r = new RepresentationRegistry();
  r.registerProducer("fake.sketch", "outline", (o) => {
    if (open.includes(o.id)) throw new Error("the sketch is not closed");
    return { kind: "outline", plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] }, outline: o.id === "b" ? rect(30, 10) : rect(60, 40) };
  });
  return r;
}
const objects = ["a", "b", "c"].map((id) => ({ type: "fake.sketch", id, label: `Sketch ${id}` }));

test("the lister's name is Design's (workspaces/design representations.ts DESIGN_OUTLINES)", () => {
  assert.equal(OUTLINES_LISTER, "design:outlines");
});

test("readParts reads every shape as an outline, and one that can't be read says why instead of throwing", async () => {
  const parts = await readParts(fakeRegistry(["b"]), objects);
  assert.deepEqual(parts.map((p) => ("refused" in p ? `${p.label}: ${p.refused}` : p.label)), ["Sketch a", "Sketch b: the sketch is not closed", "Sketch c"]);
});

test("the saved choices read back; anything missing or unusable falls back to the default and never throws", () => {
  assert.deepEqual(readLaserData({ version: 1, bed: { width: 300, height: 200 }, gap: 2, thickness: 6, off: ["x"] }), { version: 1, bed: { width: 300, height: 200 }, gap: 2, thickness: 6, off: ["x"] });
  for (const bad of [undefined, null, 7, "x", {}, { bed: { width: -1, height: 5 } }, { gap: 1e9 }, { thickness: 0 }, { thickness: 51 }])
    assert.deepEqual(readLaserData(bad), { version: 1, bed: { width: 400, height: 400 }, gap: 3, thickness: 3, off: [] }, JSON.stringify(bad));
  assert.deepEqual(readLaserData({ off: ["a", 3, null, "b"] }).off, ["a", "b"]);
});

/** A stand-in kernel: make_extrude answers one triangle and one line per corner of the outline's outer path, at the given height. */
const extrudes: { outline: Outline; height: number }[] = [];
const kernel = {
  call: async (op: string, outline: Outline, height: number) => {
    if (op !== "make_extrude") throw new Error(`unexpected ${op}`);
    if ("circle" in outline.outer) throw new Error("the kernel said no");
    extrudes.push({ outline, height });
    const n = outline.outer.path.corners.length / 2;
    return { mesh: { positions: [0, 0, height, 1, 0, height, 0, 1, height], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], triangle_faces: [0], edge_lines: new Array(6 * n).fill(height), edge_line_edges: Array.from({ length: n }, (_, i) => i) } };
  },
};

test("hand-worked: the view is the bed just under z = 0, outlined, with each part as the kernel made it, indices counting on", async () => {
  const bed = { width: 100, height: 50 };
  const layout = layOut([{ id: "a", label: "a", outline: rect(10, 10) }, { id: "b", label: "b", outline: rect(20, 10) }], bed, 5);
  const { meshes, failed } = await partMeshes(kernel as never, layout, 3);
  assert.equal(failed.length, 0);
  // Each placed outline goes to make_extrude as it sits on the bed, 3 mm thick: a at (5,5), b at 5 + 10 + 5 = 20.
  assert.deepEqual(extrudes.slice(-2).map((e) => [e.outline.outer, e.height]), [
    [{ path: { corners: [5, 5, 15, 5, 15, 15, 5, 15], bulges: [] } }, 3],
    [{ path: { corners: [20, 5, 40, 5, 40, 15, 20, 15], bulges: [] } }, 3],
  ]);
  const m = bedMesh(bed, meshes);
  // The bed: (0,0) (100,0) (100,50) (0,50) at z = −0.05, two triangles, four outline lines.
  assert.deepEqual(m.positions.slice(0, 12), [0, 0, -0.05, 100, 0, -0.05, 100, 50, -0.05, 0, 50, -0.05]);
  assert.deepEqual(m.indices, [0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 8, 9]); // each part's triangle after the bed's 4 points, then 3 more
  assert.deepEqual(m.triangle_faces, [0, 0, 1, 2]); // the bed is face 0; each part's faces count on
  assert.equal(m.edge_lines.length / 6, 4 + 4 + 4);
  assert.equal(m.edge_line_edges.length, 12);
});

test("a part the kernel refuses is counted with why, never drawn", async () => {
  const bed = { width: 100, height: 50 };
  const layout = layOut([{ id: "c", label: "Sketch c", outline: { outer: { circle: { center: [0, 0], radius: 5 } }, holes: [] } }], bed, 5);
  const { meshes, failed } = await partMeshes(kernel as never, layout, 3);
  assert.equal(meshes.length, 0);
  assert.deepEqual(failed, [{ label: "Sketch c", why: "the kernel said no" }]);
});

test("the words: nothing offered, parts on the bed, and each left off with why", () => {
  assert.equal(layoutWords({ placed: [], left: [] }, 0), "Nothing to cut yet: draw a closed sketch in DesignLab and it appears here.");
  const one = layOut([{ id: "a", label: "Sketch 1", outline: rect(10, 10) }, { id: "b", label: "Sketch 2", outline: rect(500, 10) }], { width: 100, height: 100 }, 5);
  assert.equal(layoutWords(one, 2), "1 part on the bed. Sketch 2 is left off: it is 500 × 10 mm, bigger than the bed (100 × 100 mm, 5 mm in from each edge).");
});

function mount(save?: SaveText) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = () => doc.body.appendChild(doc.createElement("div"));
  const shown: number[] = [];
  const views: string[] = [];
  const changes: string[] = [];
  const registry = fakeRegistry(["c"]);
  registry.registerLister(OUTLINES_LISTER, () => objects);
  const project = { name: "Box", workspaces: {} as Record<string, unknown> };
  const ctx = {
    project,
    projectChanged: (label: string) => changes.push(label),
    kernel,
    toolbar: slot(),
    browser: slot(),
    properties: slot(),
    representations: registry,
    viewport: { showBody: (m: { edge_lines: number[] }) => shown.push(m.edge_lines.length / 6), fit: () => null, setView: (v: string) => views.push(v) },
  } as unknown as WorkspaceContext;
  return { ctx, shown, views, changes, project, mounted: mountLaserPage(ctx, save), window };
}

test("the page lists the parts with their sizes, lays them on the bed, draws them from above, and keeps a part turned off in the project", async () => {
  const { ctx, shown, views, changes, project, mounted } = mount();
  await mounted.ready;
  const rows = [...ctx.browser.querySelectorAll("li")].map((l) => l.textContent!.trim());
  assert.deepEqual(rows, ["Sketch a, 60 × 40 mm", "Sketch b, 30 × 10 mm", "Sketch c: can't be cut: the sketch is not closed"]);
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "2 parts on the bed.");
  assert.deepEqual(shown, [12]); // the bed's four lines and two rectangles' four each
  assert.deepEqual(views, ["top"]);
  // Turning Sketch b off: one change, kept in the project's Laser data; one part left, drawn without re-framing.
  const box = ctx.browser.querySelector<HTMLInputElement>('input[data-part="b"]')!;
  box.checked = false;
  box.dispatchEvent(new ctx.browser.ownerDocument.defaultView!.Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(changes, ["Take Sketch b off the laser bed"]);
  assert.deepEqual((project.workspaces.laser as { off: string[] }).off, ["b"]);
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "1 part on the bed.");
  assert.deepEqual(shown, [12, 8]);
  assert.deepEqual(views, ["top"]);
  mounted.unmount();
  assert.equal(ctx.browser.children.length, 0);
  assert.equal(ctx.properties.children.length, 0);
});

test("a bed size typed in is kept; one that can't be used is refused in words and the files can't be saved", async () => {
  const { ctx, changes, project, mounted } = mount();
  await mounted.ready;
  const field = (n: string) => ctx.properties.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
  const change = (n: string, v: string) => {
    field(n).value = v;
    field(n).dispatchEvent(new ctx.properties.ownerDocument.defaultView!.Event("change"));
  };
  change("width", "50");
  // 50 wide less two 3 mm gaps leaves 44: Sketch a (60 wide) no longer fits.
  assert.deepEqual((project.workspaces.laser as { bed: unknown }).bed, { width: 50, height: 400 });
  assert.match(ctx.properties.querySelector(".laser-page-words")!.textContent!, /^1 part on the bed\. Sketch a is left off: it is 60 × 40 mm, bigger than the bed/);
  change("thickness", "0");
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "The sheet's thickness must be a number of mm above 0.");
  change("thickness", "3");
  change("height", "0");
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "The bed's height must be a number of mm above 0.");
  assert.ok([...ctx.properties.querySelectorAll("button")].every((b) => b.disabled));
  assert.equal(changes.length, 2); // the width, then the thickness put back; the refused numbers were not kept
  mounted.unmount();
});

test("a view still asking the kernel when a newer one is asked for is dropped: the newer one is what stays drawn", async () => {
  const { ctx, shown, mounted } = mount();
  await mounted.ready;
  // The kernel now answers the first call late and the second at once: the late answer (both parts) must not be drawn last.
  const answers: (() => void)[] = [];
  let calls = 0;
  (ctx as unknown as { kernel: unknown }).kernel = {
    call: async (op: string, outline: Outline, height: number) => {
      calls++;
      if (calls <= 2) await new Promise<void>((r) => answers.push(r));
      return kernel.call(op, outline, height);
    },
  };
  const box = ctx.browser.querySelector<HTMLInputElement>('input[data-part="b"]')!;
  const flip = (on: boolean) => {
    box.checked = on;
    box.dispatchEvent(new ctx.browser.ownerDocument.defaultView!.Event("change"));
  };
  flip(false); // asks for a's view: its one call waits
  flip(true); // asks for a and b: the first of its two calls waits too, then the second answers
  await new Promise((r) => setTimeout(r, 0));
  for (const r of answers) r();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(shown, [12, 12]); // the first view (12 lines) and the newest (both parts again); never a view of a alone (8)
  mounted.unmount();
});

test("Save SVG and Save DXF hand over the sheet named after the design, and say what was saved", async () => {
  const saved: { text: string; name: string; ext: string }[] = [];
  const { ctx, mounted } = mount(async (text, name, kind) => {
    saved.push({ text, name, ext: kind.extension });
    return `${name}${kind.extension}`;
  });
  await mounted.ready;
  const [svg, dxf] = [...ctx.properties.querySelectorAll<HTMLButtonElement>("button[data-save]")];
  svg.click();
  await new Promise((r) => setTimeout(r, 0));
  dxf.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved.map((s) => [s.name, s.ext]), [["Box", ".svg"], ["Box", ".dxf"]]);
  assert.match(saved[0].text, /^<svg [^>]*width="400mm" height="400mm"/);
  assert.equal((saved[0].text.match(/<path /g) ?? []).length, 2);
  assert.match(saved[1].text, /AC1009/);
  assert.equal((saved[1].text.match(/\nPOLYLINE\n/g) ?? []).length, 2);
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "Saved Box.dxf: 2 parts on the bed.");
  mounted.unmount();
});

test("without ?laser the workspace is the placeholder; with it, the page", async () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = () => doc.body.appendChild(doc.createElement("div"));
  const registry = fakeRegistry();
  registry.registerLister(OUTLINES_LISTER, () => []);
  const ctx = { project: { workspaces: {} }, projectChanged: () => {}, kernel, toolbar: slot(), browser: slot(), properties: slot(), representations: registry, viewport: { showBody: () => {}, fit: () => null, setView: () => null } } as unknown as WorkspaceContext;
  setLaserShown(false);
  const off = laserWorkspace.mount(ctx);
  assert.equal(ctx.browser.querySelector(".laser-page"), null);
  off.unmount();
  setLaserShown(true);
  const on = laserWorkspace.mount(ctx);
  await on.ready;
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "Nothing to cut yet: draw a closed sketch in DesignLab and it appears here.");
  on.unmount();
  setLaserShown(null);
});
