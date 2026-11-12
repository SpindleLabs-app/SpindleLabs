// The Laser page (page.ts): reading parts through a registry, the saved choices, what the flat view is given, and the
// page in a DOM (happy-dom). The real app in Chromium: apps/fission/e2e/laser-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type Outline, type WorkspaceContext } from "@fission/core";
import { emptyBedNote, flatScene, laserWorkspace, layOut, layoutWords, mountLaserPage, OUTLINES_LISTER, pairWords, readLaserData, readParts, setLaserShown, sheetSvg, type PartsRelation, type Relate, type SaveText } from "../src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";

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
  assert.deepEqual(readLaserData({ version: 2, bed: { width: 300, height: 200 }, gap: 2, thickness: 6, off: ["x"] }), { version: 3, bed: { width: 300, height: 200 }, gap: 2, thickness: 6, off: ["x"], placed: {}, ops: {} });
  for (const bad of [undefined, null, 7, "x", {}, { bed: { width: -1, height: 5 } }, { gap: 1e9 }, { thickness: 0 }, { thickness: 51 }])
    assert.deepEqual(readLaserData(bad), { version: 3, bed: { width: 400, height: 400 }, gap: 3, thickness: 3, off: [], placed: {}, ops: {} }, JSON.stringify(bad));
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
  assert.deepEqual(scene.parts[0], { id: "a", label: "a", op: "cut", d: "M5 -5L15 -5L15 -15L5 -15Z", box: { minX: 5, minY: 5, maxX: 15, maxY: 15 } });
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

function mount(save?: SaveText, laser?: unknown, relate?: Relate, realKernel?: unknown) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = () => doc.body.appendChild(doc.createElement("div"));
  /** What the page asked of the shared viewport, in order. */
  const viewport: string[] = [];
  const changes: string[] = [];
  /** The merge key given with each change (undefined: a step of its own). */
  const keys: (string | undefined)[] = [];
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
    projectChanged: (label: string, mergeKey?: string) => {
      changes.push(label);
      keys.push(mergeKey);
    },
    kernel: realKernel ?? kernel,
    toolbar: slot(),
    browser: slot(),
    properties: slot(),
    representations: registry,
    viewport: { element, showImage: (image: unknown) => viewport.push(`showImage(${image})`), clearImage: () => viewport.push("clearImage"), showBody: refuse("showBody"), setView: refuse("setView"), fit: refuse("fit") },
  } as unknown as WorkspaceContext;
  const drawn = () => [...element.querySelectorAll("path.laser-flat-part")].map((p) => p.getAttribute("d"));
  return { ctx, element, viewport, drawn, design, changes, keys, project, mounted: mountLaserPage(ctx, save, relate), window };
}

test("the page lists the parts with their sizes, lays them on the bed, draws them flat, and keeps a part turned off in the project", async () => {
  const { ctx, element, viewport, drawn, changes, project, mounted } = mount();
  await mounted.ready;
  const rows = [...ctx.browser.querySelectorAll("li")].map((l) => (l.querySelector("label") ?? l).textContent!.trim());
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
  assert.deepEqual([...ctx.properties.querySelectorAll<HTMLButtonElement>("button[data-save]")].map((b) => b.disabled), [true, true]); // Save SVG, Save DXF
  assert.equal(changes.length, 1); // the width; the refused number was not kept
  assert.deepEqual((project.workspaces.laser as { bed: unknown }).bed, { width: 50, height: 400 });
  mounted.unmount();
});

test("the sheet thickness has no box while nothing uses it, and a thickness a project already holds is kept through a change", async () => {
  const { ctx, project, mounted } = mount(undefined, { version: 2, bed: { width: 300, height: 200 }, gap: 2, thickness: 6, off: [], placed: {} });
  await mounted.ready;
  assert.deepEqual([...ctx.properties.querySelectorAll("input")].map((i) => i.name), ["width", "height", "gap", "x", "y", "angle"]); // the bed's, and the picked part's (L1b)
  const width = ctx.properties.querySelector<HTMLInputElement>('input[name="width"]')!;
  assert.equal(width.value, "300");
  width.value = "310";
  width.dispatchEvent(new ctx.properties.ownerDocument.defaultView!.Event("change"));
  assert.deepEqual(project.workspaces.laser, { version: 3, bed: { width: 310, height: 200 }, gap: 2, thickness: 6, off: [], placed: {}, ops: {} });
  mounted.unmount();
});

test("a change in the page keeps what the project's Laser data holds beside the fields the page knows (lost-work hunt, 2026-11-12)", async () => {
  // A bed change, a part moved and a part turned off each store the data again: `note` (a field this page has no name
  // for) must come through all three.
  const { ctx, project, type, mounted } = await withPicked(undefined, { version: 2, bed: { width: 300, height: 200 }, gap: 2, thickness: 3, off: [], placed: {}, note: "kept" });
  const held = () => project.workspaces.laser as Record<string, unknown>;
  type("width", "310");
  assert.deepEqual(held(), { version: 3, bed: { width: 310, height: 200 }, gap: 2, thickness: 3, off: [], placed: {}, note: "kept", ops: {} });
  // Sketch b (picked) typed to X 100: the first hand move, which also fixes Sketch a where the rows put it, (2, 2).
  type("x", "100");
  assert.deepEqual(held(), { version: 3, bed: { width: 310, height: 200 }, gap: 2, thickness: 3, off: [], placed: { a: { x: 2, y: 2, angle: 0 }, b: { x: 100, y: 2, angle: 0 } }, note: "kept", ops: {} });
  const box = ctx.browser.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  box.checked = false;
  box.dispatchEvent(new ctx.properties.ownerDocument.defaultView!.Event("change", { bubbles: true }));
  assert.equal(held().note, "kept");
  assert.deepEqual(held().off, ["a"]);
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

// Found by the review of L1a2 (each failed before its fix).

test("before the parts have been read the view already shows the project's own bed, empty, and never a made-up one", async () => {
  const { element, mounted } = mount(undefined, { version: 2, bed: { width: 300, height: 200 }, gap: 2, thickness: 3, off: [], placed: {} });
  const names = () => [...element.querySelectorAll("text.laser-flat-bed-name")].map((t) => t.textContent);
  // Straight after mounting: the read of Design's shapes has not answered yet.
  assert.deepEqual(names(), ["Bed 300 × 200 mm"]);
  assert.equal(element.querySelectorAll("path.laser-flat-part").length, 0);
  assert.deepEqual([...element.querySelectorAll("text.laser-flat-note")].map((t) => t.textContent), []); // not "nothing to cut" either: it is not known yet
  await mounted.ready;
  assert.deepEqual(names(), ["Bed 300 × 200 mm"]);
  assert.equal(element.querySelectorAll("path.laser-flat-part").length, 2);
  mounted.unmount();
});

test("a new gap leaves the view where the person put it; a new bed size shows the whole bed again", async () => {
  const { ctx, element, mounted, window } = mount();
  // The view's size, which the test page has none of: 980 × 756 (view-box.test.ts's worked view).
  const flat = element.querySelector<HTMLElement>(".laser-flat")!;
  Object.defineProperty(flat, "clientWidth", { value: 980 });
  Object.defineProperty(flat, "clientHeight", { value: 756 });
  await mounted.ready;
  const change = (n: string, v: string) => {
    const field = ctx.properties.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
    field.value = v;
    field.dispatchEvent(new ctx.properties.ownerDocument.defaultView!.Event("change"));
  };
  change("width", "400"); // any bed change frames it: 1.59 px per mm
  assert.equal(flat.dataset.scale, "1.59");
  const wheel = new window.Event("wheel", { bubbles: true, cancelable: true });
  Object.assign(wheel, { clientX: 186, clientY: 672, deltaY: -100, deltaMode: 0 });
  flat.querySelector("svg")!.dispatchEvent(wheel as unknown as Event);
  const moved = flat.dataset.scale;
  assert.notEqual(moved, "1.59");
  change("gap", "10");
  assert.equal(flat.dataset.scale, moved, "the gap moved the parts, not the view");
  assert.deepEqual([...flat.querySelectorAll("path.laser-flat-part")].map((p) => p.getAttribute("d")), ["M10 -10L70 -10L70 -50L10 -50Z", "M80 -10L110 -10L110 -20L80 -20Z"]); // 10 mm in, 10 mm apart
  change("height", "300");
  // 400 × 300 in the 912 × 636 room: 912 / 400 = 2.28 across, 636 / 300 = 2.12 down; the smaller fits both.
  assert.equal(flat.dataset.scale, "2.12");
  mounted.unmount();
});

// Parts put by hand (L1b). The parts: Sketch a, 60 × 40, in the rows at (3, 3); Sketch b, 30 × 10, right of it at (66, 3).

/** The page with Sketch b picked by a click on its outline, and what a test needs to type and press. */
async function withPicked(save?: SaveText, laser?: unknown, relate?: Relate, realKernel?: unknown) {
  const all = mount(save, laser, relate, realKernel);
  await all.mounted.ready;
  const { ctx, element, window } = all;
  const fireOn = (target: Element, type: string, init: Record<string, unknown> = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, clientX: 0, clientY: 0, ...init });
    target.dispatchEvent(e as unknown as Event);
  };
  const path = (id: string) => element.querySelector(`path.laser-flat-part[data-part="${id}"]`)!;
  const click = (id: string) => {
    fireOn(path(id), "pointerdown");
    fireOn(path(id), "pointerup");
  };
  const field = (n: string) => ctx.properties.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
  const type = (n: string, v: string) => {
    field(n).value = v;
    field(n).dispatchEvent(new window.Event("change") as unknown as Event);
  };
  const press = (selector: string) => ctx.properties.querySelector<HTMLButtonElement>(selector)!.click();
  const words = () => ctx.properties.querySelector(".laser-page-words")!.textContent;
  const partWords = () => ctx.properties.querySelector(".laser-page-part-words")!.textContent;
  const placed = () => (all.project.workspaces.laser as { placed?: unknown } | undefined)?.placed;
  click("b");
  return { ...all, fireOn, path, click, field, type, press, words, partWords, placed };
}

test("hand-worked: a picked part shows its place; a typed X moves it there, every other part stays, and the file is saved with it moved", async () => {
  let saved = "";
  const { ctx, drawn, changes, field, type, press, placed, partWords, mounted } = await withPicked(async (text) => {
    saved = text;
    return "Box.svg";
  });
  const box = ctx.properties.querySelector<HTMLElement>(".laser-page-part")!;
  assert.equal(box.hidden, false);
  assert.equal(box.querySelector("legend")!.textContent, "Sketch b");
  assert.deepEqual([field("x").value, field("y").value, field("angle").value], ["66", "3", "0"]);
  assert.equal(partWords(), "In the rows. Move or turn it and every part stays where it is.");
  assert.equal(ctx.properties.querySelector<HTMLElement>("button[data-arrange]")!.hidden, true); // nothing placed by hand yet
  assert.equal(placed(), undefined); // picking changes nothing in the project
  assert.deepEqual(changes, []);
  type("x", "100");
  // Sketch b's corner is at (100, 3) now; Sketch a, never touched, is fixed where the rows had it, (3, 3), so it can't shift.
  assert.deepEqual(placed(), { a: { x: 3, y: 3, angle: 0 }, b: { x: 100, y: 3, angle: 0 } });
  assert.deepEqual(changes, ["Move Sketch b on the laser bed"]);
  assert.deepEqual(drawn(), ["M3 -3L63 -3L63 -43L3 -43Z", "M100 -3L130 -3L130 -13L100 -13Z"]);
  assert.equal(partWords(), "");
  assert.equal(ctx.properties.querySelector<HTMLElement>("button[data-arrange]")!.hidden, false);
  press("button[data-save=svg]");
  await new Promise((r) => setTimeout(r, 0));
  assert.match(saved, /<path id="part-b" d="M100 -3L130 -3L130 -13L100 -13Z"/);
  mounted.unmount();
});

test("hand-worked: Turn left turns the part a quarter turn about its middle; reaching past the bed is said in words and marked, never mended", async () => {
  const { drawn, path, type, press, placed, words, partWords, changes, mounted } = await withPicked();
  type("x", "100");
  press('button[data-turn="90"]');
  // Sketch b, 30 × 10 at (100, 3), has its middle at (115, 8). A quarter turn makes it 10 × 30 about the same middle:
  // from (110, −7) to (120, 23). Its corners (0,0) (30,0) (30,10) (0,10) turn to (0,0) (0,30) (−10,30) (−10,0), then
  // move by (120, −7): (120,−7) (120,23) (110,23) (110,−7). In the path y is flipped.
  assert.deepEqual(placed(), { a: { x: 3, y: 3, angle: 0 }, b: { x: 110, y: -7, angle: 90 } });
  assert.equal(drawn()[1], "M120 7L120 -23L110 -23L110 7Z");
  assert.equal(changes.at(-1), "Turn Sketch b on the laser bed");
  // 7 mm of it is below the bed's bottom edge.
  assert.equal(words(), "2 parts on the bed. Sketch b is off the bed: 7 mm past the bottom.");
  assert.equal(partWords(), "Sketch b is off the bed: 7 mm past the bottom.");
  assert.equal(path("b").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-warn laser-flat-part-picked");
  assert.equal(path("b").querySelector("title")!.textContent, "Sketch b, cut, 10 × 30 mm, off the bed: 7 mm past the bottom");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  // Y typed as 0 brings it wholly onto the bed: the warning goes.
  type("y", "0");
  assert.equal(drawn()[1], "M120 0L120 -30L110 -30L110 0Z");
  assert.equal(words(), "2 parts on the bed.");
  assert.equal(path("b").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-picked");
  // The angle typed back to 0: 10 × 30 at (110, 0) has its middle at (115, 15); 30 × 10 about it starts at (100, 10).
  type("angle", "0");
  assert.deepEqual(placed(), { a: { x: 3, y: 3, angle: 0 }, b: { x: 100, y: 10, angle: 0 } });
  // Turn right from there: a quarter turn the other way is 270°; 10 × 30 about (115, 15) starts at (110, 0). The corners
  // turn by (x, y) → (y, −x): (0,0) (0,−30) (10,−30) (10,0), moved by (110, 30): (110,30) (110,0) (120,0) (120,30).
  press('button[data-turn="-90"]');
  assert.deepEqual(placed(), { a: { x: 3, y: 3, angle: 0 }, b: { x: 110, y: 0, angle: 270 } });
  assert.equal(drawn()[1], "M110 -30L110 0L120 0L120 -30Z");
  // And left again: 270° + 90° is a whole turn, 0°, back at (100, 10).
  press('button[data-turn="90"]');
  assert.deepEqual(placed(), { a: { x: 3, y: 3, angle: 0 }, b: { x: 100, y: 10, angle: 0 } });
  mounted.unmount();
});

test("a picked part taken off the bed is let go: back on the bed, it is not picked", async () => {
  const { ctx, window, mounted } = await withPicked();
  const box = ctx.properties.querySelector<HTMLElement>(".laser-page-part")!;
  assert.equal(box.hidden, false);
  const tick = (on: boolean) => {
    const b = ctx.browser.querySelector<HTMLInputElement>('input[data-part="b"]')!;
    b.checked = on;
    b.dispatchEvent(new window.Event("change") as unknown as Event);
  };
  tick(false);
  assert.equal(box.hidden, true);
  tick(true);
  assert.equal(box.hidden, true);
  mounted.unmount();
});

test("a place that can't be used is refused in words and nothing is kept; the arrows move the picked part in one undo step", async () => {
  const { element, fireOn, type, placed, partWords, changes, keys, mounted } = await withPicked();
  type("x", "20000");
  assert.equal(partWords(), "A part can be put at most 10000 mm from the bed's corner.");
  type("y", "");
  assert.equal(partWords(), "A part's place and angle must be numbers.");
  type("angle", "");
  assert.equal(partWords(), "A part's place and angle must be numbers.");
  assert.equal(placed(), undefined);
  assert.deepEqual(changes, []);
  // → twice and Shift+↑: 66 + 1 + 1 = 68 across, 3 + 10 = 13 up; each press carries the same key, so they undo as one step.
  const svg = element.querySelector(".laser-flat svg")!;
  fireOn(svg, "keydown", { key: "ArrowRight" });
  fireOn(svg, "keydown", { key: "ArrowRight" });
  fireOn(svg, "keydown", { key: "ArrowUp", shiftKey: true });
  assert.deepEqual(placed(), { a: { x: 3, y: 3, angle: 0 }, b: { x: 68, y: 13, angle: 0 } });
  assert.deepEqual(keys, ["laser-move-b", "laser-move-b", "laser-move-b"]);
  // R turns it (a step of its own); Escape lets it go and the part's numbers are put away.
  fireOn(svg, "keydown", { key: "r" });
  assert.equal(changes.at(-1), "Turn Sketch b on the laser bed");
  assert.equal(keys.at(-1), undefined);
  fireOn(svg, "keydown", { key: "Escape" });
  assert.equal(element.ownerDocument.querySelector<HTMLElement>(".laser-page-part")!.hidden, true);
  mounted.unmount();
});

test("hand-worked: Back in the rows gives one part back to the rows, round the parts still placed by hand; Arrange in rows forgets every place", async () => {
  const { ctx, drawn, click, type, press, placed, changes, mounted } = await withPicked();
  type("x", "200");
  click("a");
  type("x", "20"); // Sketch a, 60 × 40, now from (20, 3) to (80, 43)
  assert.deepEqual(placed(), { a: { x: 20, y: 3, angle: 0 }, b: { x: 200, y: 3, angle: 0 } });
  click("b");
  press("button[data-rows]");
  // Sketch b goes back to the rows: its first spot, (3, 3), would come within the 3 mm gap of Sketch a (30 wide from 3
  // reaches 33, past a's 20 − 3), so it steps on past a: 80 + 3 = 83.
  assert.deepEqual(placed(), { a: { x: 20, y: 3, angle: 0 } });
  assert.equal(changes.at(-1), "Put Sketch b back in the rows");
  assert.deepEqual(drawn(), ["M20 -3L80 -3L80 -43L20 -43Z", "M83 -3L113 -3L113 -13L83 -13Z"]);
  assert.equal(ctx.properties.querySelector<HTMLElement>("button[data-rows]")!.hidden, true); // it is in the rows now
  press("button[data-arrange]");
  assert.deepEqual(placed(), {});
  assert.equal(changes.at(-1), "Arrange the laser parts in rows");
  assert.deepEqual(drawn(), ["M3 -3L63 -3L63 -43L3 -43Z", "M66 -3L96 -3L96 -13L66 -13Z"]);
  assert.equal(ctx.properties.querySelector<HTMLElement>("button[data-arrange]")!.hidden, true);
  mounted.unmount();
});

test("places a project holds are used as they are, and ones that are not usable are dropped without a word", async () => {
  assert.deepEqual(readLaserData({ placed: { a: { x: 1, y: 2, angle: 450 }, b: { x: "1", y: 2 }, c: null, d: { x: 1e9, y: 0 }, e: { x: 5, y: 6 } } }).placed, { a: { x: 1, y: 2, angle: 90 }, e: { x: 5, y: 6, angle: 0 } });
  assert.deepEqual(readLaserData({ placed: [1, 2] }).placed, {});
  const { drawn, mounted } = mount(undefined, { version: 2, bed: { width: 400, height: 400 }, gap: 3, thickness: 3, off: [], placed: { b: { x: 200, y: 50, angle: 0 } } });
  await mounted.ready;
  // Sketch a in the rows at (3, 3); Sketch b where it was put, (200, 50).
  assert.deepEqual(drawn(), ["M3 -3L63 -3L63 -43L3 -43Z", "M200 -50L230 -50L230 -60L200 -60Z"]);
  mounted.unmount();
});

// Overlap warnings (L1b2). The page asks about each pair whose boxes overlap or all but touch; the answer is the kernel's
// (overlap.test.ts), stood in for here by `answer` except in the last test.

const tick = () => new Promise((r) => setTimeout(r, 0));

test("the words for a pair: overlapping and too-close-to-tell are marked on the parts, a touch and a failed check are only said, apart says nothing", () => {
  assert.equal(pairWords("A", "B", { relation: "apart" }), null);
  assert.deepEqual(pairWords("A", "B", { relation: "overlap" }), { words: "A and B overlap.", mark: true });
  assert.deepEqual(pairWords("A", "B", { relation: "touch" }), { words: "A and B touch: their cuts would share a line.", mark: false });
  assert.deepEqual(pairWords("A", "B", { relation: "unknown", why: "x", meet: true }), { words: "A and B touch or overlap: they are too close to tell which.", mark: true });
  assert.deepEqual(pairWords("A", "B", { relation: "unknown", why: "the kernel stopped" }), { words: "Couldn't check whether A and B overlap: the kernel stopped.", mark: false });
});

test("a part put over another is asked about once, said in words and marked on both; moved clear the warning goes; put back, the kept answer is used", async () => {
  const askedOf: string[] = [];
  let answer: PartsRelation = { relation: "overlap" };
  const { path, click, type, words, partWords, mounted } = await withPicked(undefined, undefined, async (a, b) => {
    askedOf.push(JSON.stringify([a.outer, b.outer]));
    return answer;
  });
  assert.deepEqual(askedOf, []); // in the rows nothing can overlap: nothing is asked
  type("x", "10"); // Sketch b, 30 × 10 at (10, 3), lies inside Sketch a's box, (3, 3) to (63, 43)
  assert.equal(words(), "2 parts on the bed."); // not said before the answer is in
  await tick();
  // Asked with both parts as they sit on the bed: a's corners from (3, 3), b's from (10, 3).
  assert.deepEqual(askedOf, [JSON.stringify([{ path: { corners: [3, 3, 63, 3, 63, 43, 3, 43], bulges: [] } }, { path: { corners: [10, 3, 40, 3, 40, 13, 10, 13], bulges: [] } }])]);
  assert.equal(words(), "2 parts on the bed. Sketch a and Sketch b overlap.");
  assert.equal(partWords(), "Sketch a and Sketch b overlap.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-warn");
  assert.equal(path("b").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-warn laser-flat-part-picked");
  assert.equal(path("a").querySelector("title")!.textContent, "Sketch a, cut, 60 × 40 mm, overlaps Sketch b");
  assert.equal(path("b").querySelector("title")!.textContent, "Sketch b, cut, 30 × 10 mm, overlaps Sketch a");
  click("a"); // a redraw that moved nothing asks nothing
  await tick();
  assert.equal(askedOf.length, 1);
  click("b");
  type("x", "200"); // clear of a: boxes 137 mm apart, so nothing to ask and nothing to say
  await tick();
  assert.equal(askedOf.length, 1);
  assert.equal(words(), "2 parts on the bed.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  answer = { relation: "apart" }; // were it asked again, the warning would not come back
  type("x", "10");
  assert.equal(words(), "2 parts on the bed. Sketch a and Sketch b overlap."); // at once, from the answer kept for these two as they sit
  assert.equal(askedOf.length, 1);
  mounted.unmount();
});

test("a touch is said but not marked; too close to tell is said and marked; a check that fails says why; an answer for a layout since changed is not shown", async () => {
  let answer: () => Promise<PartsRelation> = async () => ({ relation: "touch" });
  const { path, type, words, mounted } = await withPicked(undefined, undefined, () => answer());
  type("x", "63"); // b's left side on a's right side: the boxes touch, so the pair is asked about
  await tick();
  assert.equal(words(), "2 parts on the bed. Sketch a and Sketch b touch: their cuts would share a line.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  answer = async () => ({ relation: "unknown", why: "an edge lies along another", meet: true });
  type("x", "62");
  await tick();
  assert.equal(words(), "2 parts on the bed. Sketch a and Sketch b touch or overlap: they are too close to tell which.");
  assert.equal(path("a").querySelector("title")!.textContent, "Sketch a, cut, 60 × 40 mm, touches or overlaps Sketch b");
  answer = async () => {
    throw new Error("the kernel was restarted");
  };
  type("x", "61");
  await tick();
  assert.equal(words(), "2 parts on the bed. Couldn't check whether Sketch a and Sketch b overlap: the kernel was restarted.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  // A slow answer: the part is moved clear before it comes, and the answer, about where the part was, is not shown.
  let late: (r: PartsRelation) => void = () => {};
  answer = () => new Promise<PartsRelation>((r) => (late = r));
  type("x", "20");
  type("x", "300");
  late({ relation: "overlap" });
  await tick();
  assert.equal(words(), "2 parts on the bed.");
  assert.equal(path("b").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-picked");
  // Boxes 0.5 mm apart are apart: nothing is asked at all.
  let asked = 0;
  answer = async () => (asked++, { relation: "overlap" });
  type("x", "63.5");
  await tick();
  assert.equal(asked, 0);
  mounted.unmount();
});

test("hand-worked, on the real kernel: a part inside another overlaps it, one sharing its edge touches it, one half a mm off is apart", async () => {
  const real = nodeKernel();
  const { type, words, mounted } = await withPicked(undefined, undefined, undefined, real);
  const settled = async (want: string) => {
    for (let i = 0; i < 200 && words() !== want; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(words(), want);
  };
  // Sketch a is the rectangle (3, 3) to (63, 43). Sketch b, 30 × 10, at (10, 3) is (10, 3) to (40, 13): wholly inside a.
  type("x", "10");
  await settled("2 parts on the bed. Sketch a and Sketch b overlap.");
  // At x = 63 its left side lies on a's right side, x = 63, from y = 3 to 13: a shared line, no shared area.
  type("x", "63");
  await settled("2 parts on the bed. Sketch a and Sketch b touch: their cuts would share a line.");
  // At x = 62.5 it reaches 0.5 mm into a: 0.5 × 10 = 5 mm² in both.
  type("x", "62.5");
  await settled("2 parts on the bed. Sketch a and Sketch b overlap.");
  type("x", "63.5");
  await settled("2 parts on the bed.");
  mounted.unmount();
});

// Layers (L1c): each part cut, scored or engraved, chosen in its row of the parts list.

test("a part's layer is chosen in its row: kept in the project by its id (cut keeps nothing), one undo step each, drawn in its look, carried into both files", async () => {
  const saved: string[] = [];
  const { ctx, project, changes, element, mounted, window } = mount(async (text) => {
    saved.push(text);
    return "x";
  });
  await mounted.ready;
  const choose = (id: string, op: string) => {
    const s = ctx.browser.querySelector<HTMLSelectElement>(`select[data-op="${id}"]`)!;
    s.value = op;
    s.dispatchEvent(new window.Event("change") as unknown as Event);
  };
  const select = (id: string) => ctx.browser.querySelector<HTMLSelectElement>(`select[data-op="${id}"]`)!;
  // Each part with an outline has a choice, cut at first, offered in the order Cut, Score, Engrave; the refused one has none.
  assert.deepEqual([...ctx.browser.querySelectorAll<HTMLSelectElement>("select")].map((s) => [s.dataset.op, s.value]), [["a", "cut"], ["b", "cut"]]);
  assert.deepEqual([...select("a").querySelectorAll("option")].map((o) => [o.value, o.textContent]), [["cut", "Cut"], ["score", "Score"], ["engrave", "Engrave"]]);
  assert.equal(select("a").getAttribute("aria-label"), "What the laser does to Sketch a");
  choose("a", "engrave");
  choose("b", "score");
  const ops = () => (project.workspaces.laser as { ops?: unknown }).ops;
  assert.deepEqual(ops(), { a: "engrave", b: "score" });
  assert.deepEqual(changes.slice(-2), ["Engrave Sketch a on the laser", "Score Sketch b on the laser"]);
  // Drawn in the layer's look, and said in the part's words.
  const part = (id: string) => element.querySelector(`path.laser-flat-part[data-part="${id}"]`)!;
  assert.equal(part("a").getAttribute("class"), "laser-flat-part laser-flat-part-engrave");
  assert.equal(part("b").getAttribute("class"), "laser-flat-part laser-flat-part-score");
  assert.equal(part("a").querySelector("title")!.textContent, "Sketch a, engrave, 60 × 40 mm");
  // The files: the SVG's groups engrave then score (no cut group: nothing is cut), the DXF's entities on those layers.
  for (const b of ctx.properties.querySelectorAll<HTMLButtonElement>("button[data-save]")) {
    b.click();
    await tick();
  }
  assert.deepEqual([...saved[0].matchAll(/<g id="(\w+)">/g)].map((m) => m[1]), ["engrave", "score"]);
  assert.deepEqual([...saved[1].matchAll(/0\nPOLYLINE\n8\n(\w+)\n/g)].map((m) => m[1]), ["ENGRAVE", "SCORE"]);
  // Back to cut: the entry goes; the choice reads back from the project after the page is drawn again.
  choose("a", "cut");
  assert.deepEqual(ops(), { b: "score" });
  assert.equal(select("b").value, "score");
  assert.equal(part("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  mounted.unmount();
});

test("layers a project holds are used when the page opens; one for a part that isn't there changes nothing", async () => {
  const { ctx, element, mounted } = mount(undefined, { version: 3, bed: { width: 400, height: 400 }, gap: 3, thickness: 3, off: [], placed: {}, ops: { b: "engrave", gone: "score" } });
  await mounted.ready;
  assert.deepEqual([...ctx.browser.querySelectorAll<HTMLSelectElement>("select")].map((s) => s.value), ["cut", "engrave"]);
  assert.deepEqual([...element.querySelectorAll("path.laser-flat-part")].map((p) => p.getAttribute("class")), ["laser-flat-part laser-flat-part-cut", "laser-flat-part laser-flat-part-engrave"]);
  mounted.unmount();
});

test("an engraving or a score lying on a cut part is not asked about or warned of; two cut parts still are", async () => {
  const askedOf: string[] = [];
  const { ctx, path, type, words, mounted, window } = await withPicked(undefined, undefined, async (a) => {
    askedOf.push(JSON.stringify(a.outer));
    return { relation: "overlap" };
  });
  const choose = (id: string, op: string) => {
    const s = ctx.browser.querySelector<HTMLSelectElement>(`select[data-op="${id}"]`)!;
    s.value = op;
    s.dispatchEvent(new window.Event("change") as unknown as Event);
  };
  choose("b", "engrave");
  type("x", "10"); // Sketch b, now engraved, inside Sketch a's box (as in the overlap test above)
  await tick();
  assert.deepEqual(askedOf, []);
  assert.equal(words(), "2 parts on the bed.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  choose("b", "score");
  await tick();
  assert.deepEqual(askedOf, []);
  assert.equal(words(), "2 parts on the bed.");
  choose("b", "cut"); // two cut parts: asked, said and marked
  await tick();
  assert.equal(askedOf.length, 1);
  assert.equal(words(), "2 parts on the bed. Sketch a and Sketch b overlap.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-warn");
  choose("a", "engrave"); // the kept answer is not shown for a pair that no longer matters
  assert.equal(words(), "2 parts on the bed.");
  assert.equal(path("a").getAttribute("class"), "laser-flat-part laser-flat-part-engrave");
  mounted.unmount();
});
