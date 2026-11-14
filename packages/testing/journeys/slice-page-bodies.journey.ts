// SL #761 (app-wide hunt 2026-11-14, E-1): the Slice page's plate and the files it slices hold every body Design shows,
// through the real Design workspace (design-app.ts) on the real kernel: Design tells the registry what each rebuild said.
// Hand values: Box 1 40 x 30 x 20 = 24,000 mm³ at the origin; Box 2 a 10 mm cube = 1,000 mm³ at x 100..110 (apart).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry } from "@fission/core";
import { addSketch, designWorkspace, drawRectangle, extrudeSketch, insertCombine, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown } from "@fission/design";
import { plateFiles } from "../../../workspaces/slice/src/print-panel.ts";
import { readPlate } from "../../../workspaces/slice/src/page.ts";
import { app, kernel } from "./design-app.ts";

setCombineShown(true);

/** The volume inside a binary STL: Σ a · (b × c) / 6 over its triangles. */
function stlVolume(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let six = 0;
  for (let t = 0; t < v.getUint32(80, true); t++) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => v.getFloat32(84 + 50 * t + 12 + 4 * k, true));
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return six / 6;
}

async function page(doc: Parameters<typeof app>[0]) {
  const a = await app(doc);
  const registry = new RepresentationRegistry();
  designWorkspace.registerRepresentations!(registry, kernel);
  const objects = registry.objectsOf("design", { ...(await import("@fission/core")).emptyProject(), workspaces: { design: a.doc() } });
  const plate = await readPlate(registry, objects);
  const sliced = (await plateFiles(registry, objects)).reduce((v, f) => v + stlVolume(f), 0);
  return { a, labels: plate.bodies.map((b) => b.label), sliced, left: registry.leftOutOf("design", { ...(await import("@fission/core")).emptyProject(), workspaces: { design: a.doc() } }) };
}

const twoApart = () => {
  const made = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10);
  return { made, moved: insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 100 }).doc };
};

test("an Extrude Join that reaches only one of its two bodies: the page holds both (SL #761 case 1)", async () => {
  const { made, moved } = twoApart();
  const s = addSketch(moved, "XY");
  const d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const doc = extrudeSketch(d, s.id, 30, false, undefined, { operation: "join", bodies: ["body:feature-1", `body:${made.id}`] }).doc;
  const r = await page(doc);
  // The square reaches Box 1 only: 24,000 + the 10 x 10 x 10 above its top (z 20..30) = 25,000, and Box 2's 1,000: 26,000.
  assert.deepEqual(r.labels, ["Body 1", "Body 2"]);
  assert.equal(Math.round(r.sliced), 26000);
  assert.equal(Math.round(r.a.volume()), 26000, "the page slices what the view shows");
  await r.a.window.close?.();
});

test("a red Combine: the page holds the bodies it left as they were (SL #761 case 2)", async () => {
  const { made, moved } = twoApart();
  const doc = insertCombine(moved, "body:feature-1", [`body:${made.id}`], "intersect").doc;
  const r = await page(doc);
  // The boxes are apart, so the Intersect fails and both stay: 24,000 + 1,000.
  assert.deepEqual(r.labels, ["Body 1", "Body 2"]);
  assert.equal(Math.round(r.sliced), 25000);
  assert.equal(Math.round(r.a.volume()), 25000);
  // The red Combine is named for the page to say (Slice's words: "Combine 1 failed in Design, ...").
  assert.deepEqual(r.left, { failed: ["Combine 1"], hidden: [] });
});
