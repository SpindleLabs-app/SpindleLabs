// TestLab step T1: Design's face finder (representations.ts `bodyFaces`,
// registered as core's `facesOf("design", …)`). Another workspace asks for a
// body's faces and where the faces it holds are now; the answers come from
// the same scene and names Design's own selection uses, on the real rebuild
// and kernel. Every number is worked out by hand from the box's sizes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, emptyProject, type BodyReference, type DisplayMesh, type FaceReference, type StableId } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changePreset, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { registerDesign } from "../src/representations.ts";
import { deleteItem, hideBody } from "../src/timeline-edits.ts";

const kernel = nodeKernel();
const registry = new RepresentationRegistry();
registerDesign(registry, kernel);
const projectWith = (doc: DesignDocument) => ({ ...emptyProject(), workspaces: { design: doc } });
const body = (id: string): BodyReference => ({ kind: "body", id: id as StableId });

/** The summed area (mm²) and the z values of the triangles on face `f`. */
function onFace(mesh: DisplayMesh, f: number): { area: number; zs: Set<number> } {
  let area = 0;
  const zs = new Set<number>();
  for (let t = 0; t < mesh.triangle_faces.length; t++) {
    if (mesh.triangle_faces[t] !== f) continue;
    const p = [0, 1, 2].map((k) => mesh.indices[3 * t + k] * 3).map((i) => mesh.positions.slice(i, i + 3));
    const u = p[1].map((x, i) => x - p[0][i]);
    const v = p[2].map((x, i) => x - p[0][i]);
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    for (const q of p) zs.add(q[2]);
  }
  return { area, zs };
}

test("Design lists each body with its stable reference, the one the face finder takes", () => {
  let doc = partDocument("box", 40, 30, 20);
  doc = insertPreset(doc, "cylinder", 10, 10, 5).doc;
  const listed = registry.objectsOf("design", projectWith(doc));
  assert.deepEqual(
    listed.map((o) => [o.label, o.ref]),
    [
      ["Body 1", { kind: "body", id: "body:feature-1" }],
      ["Body 2", { kind: "body", id: "body:feature-2" }],
    ],
  );
});

test("hand-worked: a 40 × 30 × 20 box's six named faces, its top found again after the box is made 35 high", async () => {
  const doc = partDocument("box", 40, 30, 20);
  const first = await registry.facesOf("design", projectWith(doc), body("body:feature-1"), []);
  assert.equal(first.faces.length, 6); // a box has six faces, each with a name of its own
  assert.ok(first.faces.every((f) => f !== null));
  const top = first.labels.indexOf("Top face");
  assert.ok(top >= 0, `the labels were ${first.labels.join(", ")}`);
  const ref = first.faces[top]!;
  // The top is the 40 × 30 face at the box's highest z, 20 above its lowest: area 40 × 30 = 1200 mm².
  const zAll = first.mesh.positions.filter((_, i) => i % 3 === 2);
  const lo = Math.min(...zAll);
  const t1 = onFace(first.mesh, top);
  assert.ok(Math.abs(t1.area - 1200) < 1e-9, `area ${t1.area}`);
  assert.deepEqual([...t1.zs].map((z) => z - lo), [20]);
  assert.deepEqual(first.inputs, ["feature-1"]);

  // Made 35 high: the same reference finds the top again, now 35 above the bottom, still 1200 mm².
  const taller = changePreset(doc, "feature-1", "box", 40, 30, 35);
  const again = await registry.facesOf("design", projectWith(taller), body("body:feature-1"), [ref]);
  assert.equal(again.found[0].status, "found");
  const at = (again.found[0] as { face: number }).face;
  assert.equal(again.labels[at], "Top face");
  const t2 = onFace(again.mesh, at);
  assert.ok(Math.abs(t2.area - 1200) < 1e-9, `area ${t2.area}`);
  assert.deepEqual([...t2.zs].map((z) => z - Math.min(...again.mesh.positions.filter((_, i) => i % 3 === 2))), [35]);
});

test("a face of another body is gone from this one, and a name no face has is gone, in words; the answers keep the asked order", async () => {
  let doc = partDocument("box", 40, 30, 20);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  const one = await registry.facesOf("design", projectWith(doc), body("body:feature-1"), []);
  const two = await registry.facesOf("design", projectWith(doc), body("body:feature-2"), []);
  const topOfTwo = two.faces[two.labels.indexOf("Top face")]!;
  const topOfOne = one.faces[one.labels.indexOf("Top face")]!;
  const madeUp: FaceReference = { kind: "face", id: "face:feature-9/top" as StableId };
  const asked = await registry.facesOf("design", projectWith(doc), body("body:feature-1"), [topOfTwo, madeUp, topOfOne]);
  assert.deepEqual(asked.found[0], { status: "gone", why: "it is on another body now" });
  assert.deepEqual(asked.found[1], { status: "gone", why: "the last edit took it off the body" });
  assert.equal(asked.found[2].status, "found");
});

test("a body the design doesn't build or show now is refused in words, never answered with another body", async () => {
  let doc = partDocument("box", 40, 30, 20);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  await assert.rejects(registry.facesOf("design", projectWith(deleteItem(doc, "feature-2")), body("body:feature-2"), []), /the design doesn't build it now/);
  await assert.rejects(registry.facesOf("design", projectWith(hideBody(doc, "body:feature-2", true)), body("body:feature-2"), []), /it is hidden in Design/);
  await assert.rejects(registry.facesOf("design", projectWith(doc), body("feature-2"), []), /is not a body of the design/);
});

test("the bodies the kernel holds come back to where they started after every look-up", async () => {
  const before = await kernel.call("body_count");
  const doc = partDocument("box", 40, 30, 20);
  await registry.facesOf("design", projectWith(doc), body("body:feature-1"), []);
  await assert.rejects(registry.facesOf("design", projectWith(deleteItem(insertPreset(doc, "box", 1, 1, 1).doc, "feature-2")), body("body:feature-2"), []));
  assert.equal(await kernel.call("body_count"), before);
});
