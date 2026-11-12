// The Laser page (page.ts): reading parts through a registry, the saved choices, what the flat view is given, and the
// page in a DOM (happy-dom). The real app in Chromium: apps/fission/e2e/laser-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type Outline, type WorkspaceContext } from "@fission/core";
import { emptyBedNote, flatScene, laserWorkspace, layOut, layoutWords, mountLaserPage, OUTLINES_LISTER, readLaserData, readParts, setLaserShown, sheetSvg, type SaveText } from "../src/index.ts";

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

/** A stand-in kernel that counts what it is asked: the flat page asks it nothing (the view is drawn from the file's own path data). */
const asked: string[] = [];
const kernel = {
  call: async (op: string) => {
    asked.push(op);
    throw new Error(`unexpected ${op}`);
  },
};

test("hand-worked: the flat view is given the bed and each placed part as the file's own path data, with its box on the bed", () => {
  const bed = { width: 100, height: 50 };
  const slot: Outline = { outer: { path: { corners: [0, 0, 20, 0, 20, 10, 0, 10], bulges: [0, 1, 0, 1] } }, holes: [{ circle: { center: [10, 5], radius: 2 } }] };
  const layout = layOut([{ id: "a", label: "a", outline: rect(10, 10) }, { id: "b", label: "Slot", outline: slot }], bed, 5);
  const scene = flatScene(layout, bed, 2);
  assert.deepEqual(scene.bed, bed);
  assert.deepEqual(scene.note, []);
  // a: a 10 × 10 square placed 5 mm in from the lower-left corner: (5,5) (15,5) (15,15) (5,15), y flipped in the path.
  assert.deepEqual(scene.parts[0], { id: "a", label: "a", d: "M5 -5L15 -5L15 -15L5 -15Z", box: { minX: 5, minY: 5, maxX: 15, maxY: 15 } });
  // Slot: a 20 × 10 rectangle whose two ends are half circles of radius 5 (bulge 1), so its box is 5 mm wider each end:
  // 30 × 10. It goes right of a: its box starts at x = 5 + 10 + 5 = 20, so the outline moves by 20 − (−5) = 25 across and
  // 5 up: corners (25,5) (45,5) (45,15) (25,15). Each half circle is drawn as two quarter turns of radius 5 through its
  // outermost point, (50,10) on the right and (20,10) on the left; the hole, radius 2 round (35,10), as four quarter turns
  // from its east point (37,10).
  assert.deepEqual(scene.parts[1].box, { minX: 20, minY: 5, maxX: 50, maxY: 15 });
  assert.equal(scene.parts[1].d, "M25 -5L45 -5A5 5 0 0 0 50 -10A5 5 0 0 0 45 -15L25 -15A5 5 0 0 0 20 -10A5 5 0 0 0 25 -5Z" + "M37 -10A2 2 0 0 0 35 -12A2 2 0 0 0 33 -10A2 2 0 0 0 35 -8A2 2 0 0 0 37 -10Z");
  // What is drawn is what is saved: the same path data is in the SVG file.
  for (const p of scene.parts) assert.ok(sheetSvg(layout, bed).includes(`d="${p.d}"`), p.label);
  // A part left off the bed (too big) is not drawn.
  const tight = layOut([{ id: "a", label: "a", outline: rect(10, 10) }, { id: "big", label: "Big", outline: rect(500, 10) }], bed, 5);
  assert.deepEqual(flatScene(tight, bed, 2).parts.map((p) => p.id), ["a"]);
});

test("an empty bed says why in its middle: nothing offered yet, or every part turned off or left off", () => {
  const none = { placed: [], left: [] };
  assert.deepEqual(emptyBedNote(none, 0), ["Nothing to cut yet.", "Closed sketches from Design appear here."]);
  assert.deepEqual(emptyBedNote(none, 2), ["No parts on the bed."]);
  assert.deepEqual(emptyBedNote(layOut([{ id: "a", label: "a", outline: rect(10, 10) }], { width: 100, height: 50 }, 5), 1), []);
});

test("the words: nothing offered, parts on the bed, and each left off with why", () => {
  assert.equal(layoutWords({ placed: [], left: [] }, 0), "Nothing to cut yet: draw a closed sketch in Design and it appears here.");
  const one = layOut([{ id: "a", label: "Sketch 1", outline: rect(10, 10) }, { id: "b", label: "Sketch 2", outline: rect(500, 10) }], { width: 100, height: 100 }, 5);
  assert.equal(layoutWords(one, 2), "1 part on the bed. Sketch 2 is left off: it is 500 × 10 mm, bigger than the bed (100 × 100 mm, 5 mm in from each edge).");
});

function mount(save?: SaveText, laser?: unknown) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = () => doc.body.appendChild(doc.createElement("div"));
  /** What the page asked of the shared viewport, in order. */
  const viewport: string[] = [];
  const changes: string[] = [];
  const registry = fakeRegistry(["c"]);
  /** What Design lists now; `design` changes it, as an edit in Design would. */
  let listed = objects;
  const design = (now: typeof objects) => (listed = now);
  registry.registerLister(OUTLINES_LISTER, () => listed);
  const project = { name: "Box", workspaces: (laser === undefined ? {} : { laser }) as Record<string, unknown> };
  const element = slot();
  element.setAttribute("aria-label", "3D view");
  element.innerHTML = `<canvas></canvas><div class="view-controls"></div>`;
  const refuse = (what: string) => () => {
    throw new Error(`the flat page must not call viewport.${what}`);
  };
  const ctx = {
    project,
    projectChanged: (label: string) => changes.push(label),
    kernel,
    toolbar: slot(),
    browser: slot(),
    properties: slot(),
    representations: registry,
    viewport: { element, showImage: (image: unknown) => viewport.push(`showImage(${image})`), clearImage: () => viewport.push("clearImage"), showBody: refuse("showBody"), setView: refuse("setView"), fit: refuse("fit") },
  } as unknown as WorkspaceContext;
  const drawn = () => [...element.querySelectorAll("path.laser-flat-part")].map((p) => p.getAttribute("d"));
  return { ctx, element, viewport, drawn, design, changes, project, mounted: mountLaserPage(ctx, save), window };
}

test("the page lists the parts with their sizes, lays them on the bed, draws them flat, and keeps a part turned off in the project", async () => {
  const { ctx, element, viewport, drawn, changes, project, mounted } = mount();
  await mounted.ready;
  const rows = [...ctx.browser.querySelectorAll("li")].map((l) => l.textContent!.trim());
  assert.deepEqual(rows, ["Sketch a, 60 × 40 mm", "Sketch b, 30 × 10 mm", "Sketch c: can't be cut: the sketch is not closed"]);
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "2 parts on the bed.");
  // The view: the shared viewport's empty 2D view (no body, no 3D grid, no view cube) with the flat drawing over it.
  // Sketch a (60 × 40) sits 3 mm in from the lower-left corner; Sketch b (30 × 10) 3 mm right of it, at x = 66.
  assert.deepEqual(viewport, ["showImage(null)"]);
  assert.equal(element.children[1]?.className, "laser-flat"); // straight after the canvas, before the 3D row of buttons, which the style sheet then hides
  assert.deepEqual(drawn(), ["M3 -3L63 -3L63 -43L3 -43Z", "M66 -3L96 -3L96 -13L66 -13Z"]);
  assert.deepEqual([...element.querySelectorAll("text.laser-flat-bed-name")].map((t) => t.textContent), ["Bed 400 × 400 mm"]);
  assert.deepEqual(asked, []); // nothing was asked of the kernel: no 3D parts are built for a flat view
  // Turning Sketch b off: one change, kept in the project's Laser data; one part left.
  const box = ctx.browser.querySelector<HTMLInputElement>('input[data-part="b"]')!;
  box.checked = false;
  box.dispatchEvent(new ctx.browser.ownerDocument.defaultView!.Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(changes, ["Take Sketch b off the laser bed"]);
  assert.deepEqual((project.workspaces.laser as { off: string[] }).off, ["b"]);
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "1 part on the bed.");
  assert.deepEqual(drawn(), ["M3 -3L63 -3L63 -43L3 -43Z"]);
  mounted.unmount();
  assert.equal(ctx.browser.children.length, 0);
  assert.equal(ctx.properties.children.length, 0);
  // The viewport is given back: the flat drawing gone, the 3D view and its name as they were.
  assert.deepEqual(viewport, ["showImage(null)", "clearImage"]);
  assert.equal(element.querySelector(".laser-flat") === null, true, "the flat view is off the page");
  assert.deepEqual([...element.children].map((c) => c.tagName + (c.className ? `.${c.className}` : "")), ["CANVAS", "DIV.view-controls"]);
  assert.equal(element.getAttribute("aria-label"), "3D view");
  assert.deepEqual(asked, []);
});

test("asleep (another workspace on screen) the page gives the viewport back; awake again it draws the design as it is now", async () => {
  const { element, viewport, drawn, design, mounted } = mount();
  await mounted.ready;
  mounted.sleep!();
  assert.deepEqual(viewport, ["showImage(null)", "clearImage"]);
  assert.equal(element.querySelector(".laser-flat") === null, true, "the flat view is off the page");
  mounted.sleep!(); // twice is nothing
  assert.deepEqual(viewport, ["showImage(null)", "clearImage"]);
  // Sketch b was deleted in Design meanwhile.
  design([objects[0]]);
  mounted.wake!();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(viewport, ["showImage(null)", "clearImage", "showImage(null)"]);
  assert.equal(element.querySelectorAll(".laser-flat").length, 1);
  assert.deepEqual(drawn(), ["M3 -3L63 -3L63 -43L3 -43Z"]);
  mounted.unmount();
  assert.deepEqual(viewport, ["showImage(null)", "clearImage", "showImage(null)", "clearImage"]);
});

test("unmounted while asleep, the page takes nothing more from the viewport", async () => {
  const { viewport, mounted } = mount();
  await mounted.ready;
  mounted.sleep!();
  mounted.unmount();
  assert.deepEqual(viewport, ["showImage(null)", "clearImage"]);
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
  change("height", "0");
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "The bed's height must be a number of mm above 0.");
  assert.ok([...ctx.properties.querySelectorAll("button")].every((b) => b.disabled));
  assert.equal(changes.length, 1); // the width; the refused number was not kept
  assert.deepEqual((project.workspaces.laser as { bed: unknown }).bed, { width: 50, height: 400 });
  mounted.unmount();
});

test("the sheet thickness has no box while nothing uses it, and a thickness a project already holds is kept through a change", async () => {
  const { ctx, project, mounted } = mount(undefined, { version: 1, bed: { width: 300, height: 200 }, gap: 2, thickness: 6, off: [] });
  await mounted.ready;
  assert.deepEqual([...ctx.properties.querySelectorAll("input")].map((i) => i.name), ["width", "height", "gap"]);
  const width = ctx.properties.querySelector<HTMLInputElement>('input[name="width"]')!;
  assert.equal(width.value, "300");
  width.value = "310";
  width.dispatchEvent(new ctx.properties.ownerDocument.defaultView!.Event("change"));
  assert.deepEqual(project.workspaces.laser, { version: 1, bed: { width: 310, height: 200 }, gap: 2, thickness: 6, off: [] });
  mounted.unmount();
});

test("a slow read of the parts that a newer read overtook is dropped: the newest design is what stays drawn", async () => {
  const { ctx, drawn, design, mounted } = mount();
  await mounted.ready;
  // Asleep and awake twice in a row: the first read is made to answer after the second, with a part the design no longer has.
  const registry = ctx.representations as unknown as { deliver: (o: { id: string }, kinds: string[]) => Promise<unknown> };
  const deliver = registry.deliver.bind(registry);
  let reads = 0;
  let late: (() => void) | null = null;
  registry.deliver = async (o, kinds) => {
    if (o.id === "a" && ++reads === 1) await new Promise<void>((r) => (late = r));
    return deliver(o, kinds);
  };
  mounted.sleep!();
  mounted.wake!(); // reads a (waits), b, c
  mounted.sleep!();
  design([objects[1]]);
  mounted.wake!(); // reads b only, at once
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(drawn(), ["M3 -3L33 -3L33 -13L3 -13Z"]);
  late!();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(drawn(), ["M3 -3L33 -3L33 -13L3 -13Z"]); // the overtaken read (a and b) drew nothing
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
  const ctx = { project: { workspaces: {} }, projectChanged: () => {}, kernel, toolbar: slot(), browser: slot(), properties: slot(), representations: registry, viewport: { element: slot(), showImage: () => {}, clearImage: () => {} } } as unknown as WorkspaceContext;
  setLaserShown(false);
  const off = laserWorkspace.mount(ctx);
  assert.equal(ctx.browser.querySelector(".laser-page"), null);
  off.unmount();
  setLaserShown(true);
  const on = laserWorkspace.mount(ctx);
  await on.ready;
  assert.equal(ctx.properties.querySelector(".laser-page-words")!.textContent, "Nothing to cut yet: draw a closed sketch in Design and it appears here.");
  on.unmount();
  setLaserShown(null);
});
