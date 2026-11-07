// The Slice page (page.ts): the plate's mesh worked out by hand, the words, reading bodies through a registry, and the page
// in a DOM (happy-dom). The real app in Chromium: apps/fission/e2e/slice-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type WorkspaceContext } from "@fission/core";
import { mountSlicePage, plateMesh, plateWords, readPlate, slicePageWorkspace } from "../src/index.ts";

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
  assert.deepEqual(slicePageWorkspace.representations.accepts, ["mesh"]);
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
