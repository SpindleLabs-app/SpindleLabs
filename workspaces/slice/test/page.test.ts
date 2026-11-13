// The Slice page (page.ts): the plate's mesh worked out by hand, the words, reading bodies through a registry, and the page
// in a DOM (happy-dom). The real app in Chromium: apps/fission/e2e/slice-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type WorkspaceContext } from "@fission/core";
import { mountSlicePage, plateFiles, plateMesh, plateWords, printPanel, readPlate, sliceWords, slicePageWorkspace } from "../src/index.ts";
import { PRINT_DEFAULTS } from "@fission/print";

const { Window } = await import("happy-dom");

test("hand-worked: one triangle (0,0,0), (1,0,0), (0,1,0) lies flat, so its normal is +z, at all three corners", () => {
  // u = (1,0,0), v = (0,1,0), u × v = (0·0−0·1, 0·0−1·0, 1·1−0·0) = (0,0,1).
  const m = plateMesh([{ label: "Body 1", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }]);
  assert.deepEqual(m.positions, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(m.normals, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(m.indices, [0, 1, 2]);
  assert.deepEqual(m.triangle_faces, [0]);
});

test("the winding sets the normal's side (the same triangle reversed faces −z), a degenerate triangle falls back to +z, and a NaN corner is left out", () => {
  const rev = plateMesh([{ label: "b", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 2, 1] }]);
  assert.deepEqual(rev.normals.slice(0, 3), [0, 0, -1]);
  const flat = plateMesh([{ label: "b", positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], indices: [0, 1, 2] }]); // all on a line: no area
  assert.deepEqual(flat.normals.slice(0, 3), [0, 0, 1]);
  const bad = plateMesh([{ label: "b", positions: [0, 0, 0, 1, 0, 0, Number.NaN, 1, 0], indices: [0, 1, 2] }]);
  assert.deepEqual(bad.positions, []);
});

test("two bodies are one mesh with their own triangles, indices counting on", () => {
  const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  const m = plateMesh([{ label: "a", ...tri }, { label: "b", ...tri }]);
  assert.equal(m.positions.length, 18);
  assert.deepEqual(m.indices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(m.triangle_faces, [0, 0]);
});

test("the words: none, one, several, and bodies that could not be read", () => {
  assert.equal(plateWords(0, 0), "Nothing to print yet: the design has no body shown.");
  assert.equal(plateWords(1, 0), "1 body on the plate.");
  assert.equal(plateWords(3, 0), "3 bodies on the plate.");
  assert.equal(plateWords(2, 1), "2 bodies on the plate. 1 body could not be read.");
  assert.equal(plateWords(0, 2), "Nothing to print yet: the design has no body shown. 2 bodies could not be read.");
});

function fakeRegistry(fail: string[] = []) {
  const r = new RepresentationRegistry();
  r.registerProducer("fake.body", "mesh", (o) => {
    if (fail.includes(o.id)) throw new Error("kernel said no");
    return { kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  });
  return r;
}
const objects = ["a", "b", "c"].map((id) => ({ type: "fake.body", id, label: `Body ${id}` }));

test("readPlate reads every body as a mesh, and counts one that can't be read instead of throwing", async () => {
  const all = await readPlate(fakeRegistry(), objects);
  assert.deepEqual(all.bodies.map((b) => b.label), ["Body a", "Body b", "Body c"]);
  assert.equal(all.failed, 0);
  const some = await readPlate(fakeRegistry(["b"]), objects);
  assert.deepEqual(some.bodies.map((b) => b.label), ["Body a", "Body c"]);
  assert.equal(some.failed, 1);
});

test("the page is a working workspace that takes meshes, and lists the plate in the browser and draws it in the view", async () => {
  assert.equal(slicePageWorkspace.status, "working");
  assert.deepEqual(slicePageWorkspace.representations.accepts, ["mesh", "data"]);
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = () => doc.body.appendChild(doc.createElement("div"));
  const shown: number[] = [];
  const registry = fakeRegistry();
  registry.registerLister("design", () => objects);
  const ctx = {
    project: {},
    toolbar: slot(),
    browser: slot(),
    properties: slot(),
    representations: registry,
    kernel: { call: async () => ({}) },
    viewport: { showBody: (m: { indices: number[] }) => shown.push(m.indices.length / 3), fit: () => null },
  } as unknown as WorkspaceContext;
  const mounted = mountSlicePage(ctx);
  await mounted.ready;
  assert.deepEqual([...ctx.browser.querySelectorAll("li")].map((l) => l.textContent), ["Body a", "Body b", "Body c"]);
  assert.equal(ctx.browser.querySelector(".slice-page-words")!.textContent, "3 bodies on the plate.");
  assert.deepEqual(shown, [3]); // three triangles drawn
  // Asleep it draws nothing; waking reads and draws again.
  mounted.sleep!();
  mounted.wake!();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(shown.length, 2);
  mounted.unmount();
  assert.equal(ctx.browser.children.length, 0);
});

// ---- The print panel (print-panel.ts) ----

/** A binary STL of one triangle (80-byte header, count 1, 50 bytes), its corners at height z, so each body's file is told apart. */
function triangle(z: number): Uint8Array {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  [[0, 0, z], [10, 0, z], [0, 10, z]].forEach((c, i) => c.forEach((v, k) => view.setFloat32(96 + i * 12 + k * 4, v, true)));
  return bytes;
}
const stlRegistry = (fail: string[] = []) => {
  const r = new RepresentationRegistry();
  r.registerProducer("fake.body", "data", (o) => {
    if (fail.includes(o.id)) return { kind: "data", values: { format: "obj" } };
    return { kind: "data", values: { format: "stl", bytes: triangle(o.id.charCodeAt(0)) } };
  });
  return r;
};

test("plateFiles reads each body's STL in order, and a body that gives no STL stops the slice in words naming it", async () => {
  const files = await plateFiles(stlRegistry(), objects);
  assert.equal(files.length, 3);
  assert.equal(new DataView(files[0].buffer).getFloat32(96 + 8, true), 97); // "a" is char code 97: its file's first corner is at z 97
  await assert.rejects(plateFiles(stlRegistry(["b"]), objects), /Body b could not be turned into a print file/);
});

test("the words of a slice: layers, grams and time as the dialog says them, with the warnings after", () => {
  const done = { layers: 100, filamentMm: 2000, filamentG: 5.97, printTimeS: 4800, unprintedVolume: 0, levelNote: "Body 2 floats." };
  const words = sliceWords(done);
  assert.match(words, /^100 layers, /);
  assert.match(words, /Body 2 floats\.$/);
});

function panelIn(kernelCall: (name: string, ...a: unknown[]) => Promise<unknown>, list = objects) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const panel = printPanel(doc, { kernel: { call: kernelCall, stopSlicing: () => undefined } as never, registry: stlRegistry(), objects: () => list, storage: null });
  doc.body.append(panel.element);
  return { doc, panel };
}

test("the panel starts on the beginner's defaults, and picking a choice changes only that choice", () => {
  const { doc, panel } = panelIn(async () => ({}));
  assert.deepEqual(panel.choices(), PRINT_DEFAULTS);
  const selects = [...doc.querySelectorAll("select")] as unknown as HTMLSelectElement[];
  assert.equal(selects.length, 4, "quality, walls, infill, supports");
  selects[1].value = "3"; // Walls: the options are 1..6, index 3 is 4 walls
  selects[1].dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.deepEqual(panel.choices(), { ...PRINT_DEFAULTS, walls: 4 });
});

test("Slice asks the engine for the stacked files with the choices and says what it came to; an empty plate says why and never asks", async () => {
  const calls: unknown[][] = [];
  const { doc, panel } = panelIn(async (...a) => (calls.push(a), { layers: 12, filamentMm: 1000, filamentG: 3, printTimeS: 600, unprintedVolume: 0 }));
  await panel.slice();
  assert.equal(calls[0][0], "slice_stl");
  assert.equal(calls[0][2], PRINT_DEFAULTS.layerHeight);
  assert.equal((calls[0][1] as Uint8Array).length, 3 * 134, "three bodies' files back to back");
  assert.match(doc.querySelector(".slice-page-slice-words")!.textContent!, /^12 layers, /);
  const empty = panelIn(async (...a) => (calls.push(a), {}), []);
  await empty.panel.slice();
  assert.equal(calls.length, 1, "no body, no engine call");
  assert.match(empty.doc.querySelector(".slice-page-slice-words")!.textContent!, /Nothing to slice/);
});

test("a refusal from the engine is said in words, and the button works again afterwards", async () => {
  const { doc, panel } = panelIn(async () => {
    throw new Error("the part is too tall");
  });
  await panel.slice();
  const words = doc.querySelector(".slice-page-slice-words")!.textContent!;
  assert.ok(words.length > 0 && !/^Slicing/.test(words), words);
  assert.equal((doc.querySelector("#slice-page-slice") as unknown as HTMLButtonElement).disabled, false);
});
