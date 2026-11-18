// App bug hunt 2026-11-18, C-1 (SL #762's fix by other doors): the bodies Design hands other workspaces were right only
// once Design itself had rebuilt that exact design. After a reload or an Open on the Slice page, or an Undo there, Design
// is not on screen, so the list read the data alone: a red Combine was taken as built, its tool used up, and the plate
// and the print left a body out with no word. The STL files were then kept for that wrong list, so once Design had
// rebuilt the same design the plate was right but every Slice failed ("body:feature-2 is not a body of the design that is
// shown"). Now a workspace waits for `registry.settled("design", project)`, which rebuilds a design no one has rebuilt
// yet, before listing, and the STL files are kept per list.
// Hand working: Box 1 40 x 30 x 20 = 24,000 mm³ at the origin; Box 2 a 10 mm cube (1,000 mm³) moved to x 100..110, so it
// is far from Box 1; Combine 1 intersects Box 1 with Box 2: they don't meet, so the kernel refuses it and the Combine is
// red. Both bodies stay as they were, as Design shows them: Body 1 and Body 2, 25,000 mm³ in all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, RepresentationRegistry, type ListedObject } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { failedIds } from "../src/browser.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { noteRebuild, registerDesign } from "../src/representations.ts";

const kernel = nodeKernel();

function redCombine(): DesignDocument {
  const made = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10);
  const moved = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 100 }).doc;
  return insertCombine(moved, "body:feature-1", [`body:${made.id}`], "intersect").doc;
}

/** A binary STL's volume by the divergence theorem: the sum of each triangle's signed tetrahedron to the origin. */
function stlVolume(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let six = 0;
  for (let t = 0; t < v.getUint32(80, true); t++) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => v.getFloat32(84 + 50 * t + 12 + 4 * k, true));
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return six / 6;
}

async function sliced(r: RepresentationRegistry, objects: readonly ListedObject[]): Promise<number> {
  let sum = 0;
  for (const o of objects) {
    const { representation } = await r.deliver(o, ["data"]);
    assert.equal(representation.kind, "data");
    sum += stlVolume((representation as { values: { bytes: Uint8Array } }).values.bytes);
  }
  return Math.round(sum);
}

test("a design no one has rebuilt (a reload on the Slice page): once settled, the list and the files are the bodies Design shows", async () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  const project = { ...emptyProject(), workspaces: { design: redCombine() } };
  await r.settled("design", project);
  assert.deepEqual(r.objectsOf("design", project).map((o) => o.label), ["Body 1", "Body 2"]);
  assert.deepEqual(r.leftOutOf("design", project).failed, ["Combine 1"], "the red Combine is said");
  assert.equal(await sliced(r, r.objectsOf("design", project)), 25_000);
});

test("files made for a list read before the rebuild are never handed out for the right list after it (the stuck Slice)", async () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  const doc = redCombine();
  const project = { ...emptyProject(), workspaces: { design: doc } };
  // Listed and sliced before any rebuild was noted (a workspace that does not wait): the data alone's guess.
  await sliced(r, r.objectsOf("design", project));
  // Design rebuilds the same design (a visit to Design, no edit) and says what it found.
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  noteRebuild(doc, failedIds(doc, build.results, new Set(Object.keys(build.bodies))));
  await cache.close();
  const listed = r.objectsOf("design", project);
  assert.deepEqual(listed.map((o) => o.label), ["Body 1", "Body 2"]);
  assert.equal(await sliced(r, listed), 25_000);
});

test("control: settling a design Design has rebuilt asks the kernel for nothing more and keeps Design's answer", async () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  const doc = redCombine();
  noteRebuild(doc, new Set(["sentinel"])); // what Design said wins: settled never replaces it
  const project = { ...emptyProject(), workspaces: { design: doc } };
  await r.settled("design", project);
  assert.deepEqual(r.leftOutOf("design", project).failed, [], "no item is called sentinel, and Combine 1 is not said");
});

test("Design's own answer noted while a settle is still rebuilding is the one kept", async () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  const doc = redCombine();
  const project = { ...emptyProject(), workspaces: { design: doc } };
  const running = r.settled("design", project);
  noteRebuild(doc, new Set()); // Design's rebuild lands first (an empty set: nothing failed, as a stand-in answer)
  await running;
  // The settle's own rebuild found Combine 1 red; Design's answer said nothing failed, and Design's is kept.
  assert.deepEqual(r.leftOutOf("design", project).failed, []);
});
