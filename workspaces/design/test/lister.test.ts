// What Design offers other workspaces to list (registerLister, for the Slice page): every body shown, by its browser name,
// read from the project's data alone. Hand-worked: a design with one box has one body, "Body 1"; hiding it leaves none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, RepresentationRegistry, type KernelCalls } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { registerDesign } from "../src/representations.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { hideBody } from "../src/timeline-edits.ts";
import { bodyIdOf } from "../src/document.ts";
import { lastFeature } from "../src/document.ts";

const kernel = { call: async () => ({}) } as unknown as KernelCalls;
const registry = () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  return r;
};
const projectWith = (data: unknown) => ({ ...emptyProject(), workspaces: { design: data } });

test("a design with one box lists one body, Body 1, as a design feature", () => {
  const doc = partDocument("box", 40, 30, 20);
  const listed = registry().objectsOf("design", projectWith(doc));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].type, "design.feature");
  assert.equal(listed[0].label, "Body 1");
  assert.equal(listed[0].id, lastFeature(doc).id);
});

test("a body hidden by its eye is not listed; showing it lists it again", () => {
  const doc = partDocument("box", 40, 30, 20);
  const body = bodyIdOf(lastFeature(doc).id);
  assert.deepEqual(registry().objectsOf("design", projectWith(hideBody(doc, body, true))), []);
  assert.equal(registry().objectsOf("design", projectWith(hideBody(hideBody(doc, body, true), body, false))).length, 1);
});

test("no Design data, or data that does not read, lists nothing and never throws (a test that can fail: the listing is not just always empty)", () => {
  for (const data of [undefined, null, 7, "x", {}, { version: 99 }]) assert.deepEqual(registry().objectsOf("design", projectWith(data)), [], JSON.stringify(data));
  assert.equal(registry().objectsOf("nothing", projectWith(partDocument("box", 1, 1, 1))).length, 0); // a workspace with no lister offers none
});

test("a lister can be registered once per workspace", () => {
  const r = registry();
  assert.throws(() => r.registerLister("design", () => []), /already has a lister/);
});

// The exact STL of a body as data (what the slicer reads): the kernel's own export, the files of every body shown made once.
test("a listed body delivers the kernel's exact STL as data, made once for all bodies shown; a hidden body is refused", async () => {
  const stl = (z: number) => {
    const bytes = new Uint8Array(84 + 50); // one triangle at height z: the file is told apart by its height
    const view = new DataView(bytes.buffer);
    view.setUint32(80, 1, true);
    for (const [i, c] of [[0, 0, z], [10, 0, z], [0, 10, z]].entries()) c.forEach((v, k) => view.setFloat32(84 + 12 + i * 12 + k * 4, v, true));
    return bytes;
  };
  let exports = 0;
  const fake = { call: async (name: string) => (name === "export_stl" ? (exports++, { name: "body", bytes: stl(7) }) : {}) } as unknown as KernelCalls;
  const r = new RepresentationRegistry();
  registerDesign(r, fake);
  const doc = partDocument("box", 40, 30, 20);
  const [body] = r.objectsOf("design", projectWith(doc));
  const first = await r.deliver(body, ["data"]);
  const again = await r.deliver(body, ["data"]);
  assert.equal(first.representation.kind, "data");
  assert.equal((first.representation as { values: { format: string } }).values.format, "stl");
  assert.deepEqual([...(first.representation as { values: { bytes: Uint8Array } }).values.bytes], [...stl(7)], "the kernel's file, untouched");
  assert.equal(exports, 1, "the second delivery reuses the first one's files");
  assert.equal(again.representation.kind, "data");
  // Hidden, the body has no file: a design where it is hidden refuses it in words.
  const hidden = hideBody(doc, bodyIdOf(lastFeature(doc).id), true);
  await assert.rejects(r.deliver({ ...body, document: hidden } as typeof body, ["data"]), /not a body of the design that is shown/);
});

test("a Combine's two pieces are two listed bodies, each delivering its own exact STL from the real kernel", async () => {
  // The bar x 0..100, y 0..20, z 0..10 with a slot cut through at x 30..40 (as combine-rebuild.test.ts works out): two pieces,
  // the near one x 0..30 (Body 1, the bar's own id) and the far one x 40..100 (Body 3: the bar 1, the tool 2). Each is a box: 12 triangles.
  const real = nodeKernel();
  let doc = partDocument("box", 100, 20, 10);
  const bar = doc.timeline.features[0].id;
  let tool: string;
  ({ doc, id: tool } = insertPreset(doc, "box", 10, 40, 20));
  doc = insertMove(doc, [`body:${tool}`], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const { doc: combined } = insertCombine(doc, `body:${bar}`, [`body:${tool}`], "cut");
  const cache = new BodyCache(real);
  const build = await rebuildTimeline(combined, cache, real);
  const numbered = numberPieces(combined, Object.keys(build.bodies));
  const r = new RepresentationRegistry();
  registerDesign(r, real);
  const listed = r.objectsOf("design", projectWith(numbered));
  assert.deepEqual(listed.map((o) => o.label), ["Body 1", "Body 3"]);
  const xs = async (o: (typeof listed)[number]) => {
    const rep = (await r.deliver(o, ["data"])).representation;
    assert.equal(rep.kind, "data");
    const bytes = (rep as { values: { bytes: Uint8Array } }).values.bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(80, true);
    const x: number[] = [];
    for (let t = 0; t < count; t++) for (let c = 0; c < 3; c++) x.push(view.getFloat32(84 + t * 50 + 12 + c * 12, true));
    return { count, min: Math.min(...x), max: Math.max(...x) };
  };
  assert.deepEqual(await xs(listed[0]), { count: 12, min: 0, max: 30 });
  assert.deepEqual(await xs(listed[1]), { count: 12, min: 40, max: 100 });
  await cache.close();
});
