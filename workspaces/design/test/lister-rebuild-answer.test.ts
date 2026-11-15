// SL #761 (app-wide hunt 2026-11-14, E-1 and R-8): the bodies Design hands other workspaces (the Slice page, TestLab)
// are the bodies Design shows. The list used to read the data alone, so an Extrude Join that reaches only one of its
// bodies, a red Combine or one failed extrude left bodies out (and refused every body's STL). Design now tells the
// registry what each rebuild said (`noteRebuild`), as the workspace does after every rebuild; these tests do the same.
// Hand working, join: cubes of 10. Box 1 x 0..10; Box 2 moved to x 30..40. Sketch rectangle x 6..14, y 2..6 extruded 20,
// Operation Join, both cubes picked. The bar reaches only Box 1 (x 14 < 30), so Box 1 + bar is one body (1,000 + the bar's
// part outside the cube: 4 x 4 x 20 beside it + 4 x 4 x 10 above it = 320 + 160 = 1,480) and Box 2 stays a body of its own
// (1,000): two bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, RepresentationRegistry } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyRows, failedIds } from "../src/browser.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { noteRebuild, registerDesign } from "../src/representations.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";

const kernel = nodeKernel();

function joined(bx: number) {
  let doc = partDocument("box", 10, 10, 10);
  const box1 = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: bx }).doc;
  const s = addSketch(doc);
  return extrudeSketch(drawRectangle(s.doc, s.id, [6, 2], [14, 6]).doc, s.id, 20, false, undefined, { operation: "join", bodies: [`body:${box1}`, `body:${b2.id}`] }).doc;
}

async function both(doc0: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies), builtPieceFaces(build));
  const shown = bodyRows(doc, failedIds(doc, build.results, new Set(Object.keys(build.bodies)))).map((r) => r.label);
  const volumes: number[] = [];
  for (const b of Object.values(build.bodies)) volumes.push(Math.round((await cache.view(b.handle)).volume));
  await cache.close();
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  noteRebuild(doc, failedIds(doc, build.results, new Set(Object.keys(build.bodies))));
  const listed = r.objectsOf("design", { ...emptyProject(), workspaces: { design: doc } }).map((o) => o.label);
  return { shown, listed, volumes: volumes.sort((a, b) => a - b) };
}

for (const [bx, name, want] of [[10, "control: the Join reaches both cubes (Box 2 at x 10..20)", 1], [30, "the Join does not reach Box 2 (x 30..40)", 2]] as const)
  test(`${name}: other workspaces are offered the ${want} bod${want === 1 ? "y" : "ies"} Design shows`, async () => {
    const r = await both(joined(bx));
    console.log(JSON.stringify(r));
    assert.equal(r.shown.length, want, "bodies Design shows (hand-worked)");
    assert.deepEqual(r.listed, r.shown, "the bodies offered to other workspaces are the bodies shown");
  });

// A Combine the rebuild fails (a cylinder cut from a box: curved booleans are not built yet, a known limit, so the Combine
// is red and both bodies stay as they were, 2 bodies shown: the box 24,000 and the cylinder). The data alone says the
// tool is used up.
test("a Combine that fails in the rebuild (box cut by a cylinder): other workspaces are offered the 2 bodies Design shows", async () => {
  let doc = partDocument("box", 40, 30, 20);
  const box = doc.timeline.features[0].id;
  const c = insertPreset(doc, "cylinder", 10, 10, 30);
  doc = insertCombine(c.doc, `body:${box}`, [`body:${c.id}`], "cut").doc;
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const combine = doc.timeline.features.at(-1)!.id;
  console.log("the Combine is", build.results[combine].status, (build.results[combine] as { message?: string }).message ?? "");
  await cache.close();
  const r = await both(doc);
  console.log(JSON.stringify(r));
  assert.equal(build.results[combine].status, "failed", "the Combine is refused (the known limit)");
  assert.equal(r.shown.length, 2, "bodies Design shows");
  assert.deepEqual(r.listed, r.shown, "the bodies offered to other workspaces are the bodies shown");
});

// One item that fails (an extrude of a sketch that is one open line) beside a good box: Design shows the box (Body 1,
// 40 x 30 x 20 = 24,000 mm3) and Export STL saves it, naming the failed item. The list from the data alone also offers
// the failed extrude as a body, and because every listed body's STL file is made together (representations.ts:242-246),
// the box's own file is refused with it.
test("a box beside an extrude that fails: the box is offered and its exact STL is delivered", async () => {
  const { drawLine } = await import("../src/sketch.ts");
  let doc = partDocument("box", 40, 30, 20);
  const box = doc.timeline.features[0].id;
  const s = addSketch(doc);
  doc = extrudeSketch(drawLine(s.doc, s.id, [100, 0], [110, 0]).doc, s.id, 5).doc;
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const extrude = doc.timeline.features.at(-1)!.id;
  console.log("the extrude is", build.results[extrude].status, (build.results[extrude] as { message?: string }).message ?? "");
  await cache.close();
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  noteRebuild(doc, failedIds(doc, build.results, new Set(Object.keys(build.bodies))));
  const listed = r.objectsOf("design", { ...emptyProject(), workspaces: { design: doc } });
  console.log("listed:", JSON.stringify(listed.map((o) => o.label)));
  const mine = listed.find((o) => o.id === box)!;
  assert.ok(mine, "the box is listed");
  const got = await r.deliver(mine, ["data"]).then((d) => `delivered ${(d.representation as { values: { bytes: Uint8Array } }).values.bytes.length} bytes`, (e: Error) => `refused: ${e.message}`);
  console.log("the box's STL:", got);
  assert.equal(build.results[extrude].status, "failed");
  // A box's binary STL: 80 header + 4 count + 12 triangles x 50 bytes = 684 bytes.
  assert.equal(got, "delivered 684 bytes");
  assert.deepEqual(listed.map((o) => o.label), ["Body 1"], "only the body Design shows is offered");
});

// What the list leaves out, for the page to say (SL #761 follow-up). The box beside an extrude that fails: the failed extrude
// is named by its timeline name; hiding the box's eye names Body 1 as hidden and the failed one stays only in `failed`.
test("the registry says which items failed and which bodies are hidden", async () => {
  const { drawLine } = await import("../src/sketch.ts");
  let doc = partDocument("box", 40, 30, 20);
  const s = addSketch(doc);
  doc = extrudeSketch(drawLine(s.doc, s.id, [100, 0], [110, 0]).doc, s.id, 5).doc;
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  const project = { ...emptyProject(), workspaces: { design: doc } };
  assert.deepEqual(r.leftOutOf("design", project), { failed: [], hidden: [] }, "before a rebuild has been told, nothing is said");
  noteRebuild(doc, failedIds(doc, build.results, new Set(Object.keys(build.bodies))));
  const extrude = doc.timeline.features.at(-1)!.provenance.self.label;
  assert.deepEqual(r.leftOutOf("design", project), { failed: [extrude], hidden: [] });
  // Box 1's eye shut: it is named as hidden, and the list offers nothing but still says why.
  const shut = { ...doc, hidden: [...(doc.hidden ?? []), "body:feature-1"] };
  noteRebuild(shut, failedIds(shut, build.results, new Set(Object.keys(build.bodies))));
  assert.deepEqual(r.leftOutOf("design", { ...project, workspaces: { design: shut } }), { failed: [extrude], hidden: ["Body 1"] });
});
