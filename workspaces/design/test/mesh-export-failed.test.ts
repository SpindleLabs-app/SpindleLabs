// Export and save hunt 2026-11-12 B (SpindleLabs#640), on Download 3MF and OBJ: each a failing test before its fix.
// 1: a timeline item that failed was left out of the 3MF and OBJ without a word, the file "Checked solid" (as #613 was
// for the STL); now the three exports share one set of notes. 2: with a failed Combine in the timeline the 3MF and OBJ
// saved nothing and named an internal id. 3: a tab or line break in an object name made a 3MF the 3MF consortium's
// reader refuses. 4: a body single precision squashes flat stayed in the 3MF as a zero-volume object (a slicer crashed
// loading it). 5: overlapping bodies got a plain "Checked solid" while their STL says they touch or overlap.
// On the real kernel, run as the workspace runs the verbs: every body shown, with the last rebuild's failed set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, type WorkspaceContext } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { DOWNLOAD_STL, registerDesignActions, shownBodyRefs, type DesignOutcome, type DesignRun } from "../src/actions.ts";
import { failedIds } from "../src/browser.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { DOWNLOAD_3MF, DOWNLOAD_OBJ, registerMeshActions } from "../src/mesh-export.ts";
import { modelXml } from "../src/mesh-files.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, addSketch, deleteCurve, drawCircle, drawRectangle } from "../src/sketch.ts";
import { badgeFor } from "../src/solid-badge.ts";

const kernel = nodeKernel();
const VERBS = [["STL", DOWNLOAD_STL], ["3MF", DOWNLOAD_3MF], ["OBJ", DOWNLOAD_OBJ]] as const;

/** The three exports of every body shown, as File ▾ runs them after a rebuild: each one's outcome and saved bytes. */
async function exportAll(start: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(start, cache, kernel);
  await cache.close();
  const held = Object.keys(build.bodies);
  const failed = failedIds(start, build.results, new Set(held));
  // As the workspace does after each rebuild: a Combine's pieces get their body numbers.
  const doc = numberPieces(start, held);
  const saved: Uint8Array[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, (bytes) => void saved.push(bytes));
  registerMeshActions(r, (bytes) => void saved.push(bytes));
  const project = emptyProject();
  project.workspaces.design = doc;
  const ctx = { project, kernel, failed, viewport: { setOverlay: () => {}, clearOverlay: () => {} } } as unknown as DesignRun;
  const targets = shownBodyRefs(doc, failed);
  const out: Record<string, { outcome: DesignOutcome; bytes?: Uint8Array }> = {};
  for (const [name, id] of VERBS) {
    const before = saved.length;
    const outcome = (await r.get(id)!.run(targets, ctx as WorkspaceContext)) as DesignOutcome;
    out[name] = { outcome, bytes: saved.length > before ? saved[before] : undefined };
  }
  return { failed: [...failed], targets: targets.map((t) => t.id), out };
}

/** Boxes [w, d, h], each moved to [x, y, z]. */
function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[] } {
  let doc: DesignDocument | undefined;
  const bodies: string[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (!doc) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x || y || z) doc = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z }).doc;
  }
  return { doc: doc!, bodies };
}

/** Each object in a 3MF's model, as "name: corners, triangles". */
function objectsOf(bytes: Uint8Array): string[] {
  const xml = new TextDecoder().decode(bytes);
  return [...xml.matchAll(/<object id="\d+"[^>]*name="([^"]*)"[\s\S]*?<\/object>/g)].map((m) => `${m[1]}: ${(m[0].match(/<vertex /g) ?? []).length} corners, ${(m[0].match(/<triangle /g) ?? []).length} triangles`);
}

test("control: a plain 20 × 30 × 10 box is 'Checked solid' in all three, with no notes", async () => {
  const { out } = await exportAll(partDocument("box", 20, 30, 10));
  assert.equal(out["3MF"].outcome.message, "Exported spindlelabs-box.3mf. Checked solid.");
  for (const [k] of VERBS) {
    assert.equal(out[k].outcome.bad, false, k);
    assert.equal(out[k].outcome.notes, undefined, k);
  }
});

test("regression (#640 1): a failed Extrude Cut is named by the 3MF and OBJ as by the STL, the file never 'Checked solid'", async () => {
  // A 40 × 30 × 20 box with a circle r 5 on its top, Extrude Cut 10 mm: the design is 24,000 − π × 25 × 10 = 23,214.6
  // mm³, but the Cut fails (curved booleans come later), so every file holds the plain box, 24,000 mm³.
  const d = partDocument("box", 40, 30, 20);
  const s = addFaceSketch(d, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const c = drawCircle(s.doc, s.id, [20, 15] as never, 5);
  const { doc, id } = extrudeSketch(c.doc, s.id, 10, true, undefined, { operation: "cut", bodies: ["body:feature-1"] });
  const { failed, out } = await exportAll(doc);
  assert.deepEqual(failed, [id], "the Cut fails today; should it ever build, this test proves nothing");
  for (const [k] of VERBS) {
    const { outcome, bytes } = out[k];
    assert.ok(bytes, `${k}: the file is still made`);
    assert.equal(outcome.bad, true, `${k}: ${outcome.message}`);
    assert.match(outcome.message, new RegExp(`Extrude 1 failed, so it is not in the ${k}: the part is saved without it\\.`), k);
    assert.ok(!outcome.message.includes("Checked solid"), `${k}: ${outcome.message}`);
    assert.match(outcome.message, /What was built is checked solid\./, k);
    // The card: "Not the whole design", as the STL's.
    assert.equal(badgeFor(outcome.solid!, outcome.notes).title, "Not the whole design", k);
  }
});

test("regression (#640 1, no switch needed): an Extrude whose sketch was edited open is named by the 3MF and OBJ", async () => {
  // A 20 × 30 × 10 box (6,000 mm³) and a 20 × 10 rectangle at (100, 100) extruded 5 mm (1,000 mm³ more); then one line
  // of the rectangle deleted: the outline is open, the Extrude fails and only the box is left, 6,000 mm³.
  const s = addSketch(partDocument("box", 20, 30, 10), "XY");
  const r = drawRectangle(s.doc, s.id, [100, 100], [120, 110]);
  const x = extrudeSketch(r.doc, s.id, 5);
  const before = await exportAll(x.doc);
  assert.deepEqual([before.failed, before.targets.length, before.out["3MF"].outcome.bad], [[], 2, false], "both bodies, nothing failed");
  const { failed, targets, out } = await exportAll(deleteCurve(x.doc, s.id, r.ids[0]));
  assert.deepEqual([failed, targets], [[x.id], ["body:feature-1"]]);
  for (const k of ["3MF", "OBJ"]) {
    assert.equal(out[k].outcome.bad, true, out[k].outcome.message);
    assert.match(out[k].outcome.message, new RegExp(`Extrude 1 failed, so it is not in the ${k}`));
  }
});

test("regression (#640 2): with a failed Combine in the timeline the 3MF and OBJ save the two boxes shown, as the STL does", async () => {
  // Box 2 moved to (10, 10, 0) touches Box 1 along a line only, so the kernel refuses the Join; both boxes stay on
  // screen, and every file holds two cubes, 2 × 1,000 = 2,000 mm³.
  const { doc: two, bodies } = boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [10, 10, 0]]);
  const { doc, id } = insertCombine(two, bodies[0], [bodies[1]], "join");
  const { failed, targets, out } = await exportAll(doc);
  assert.deepEqual([failed, targets], [[id], bodies]);
  for (const [k] of VERBS) {
    const { outcome, bytes } = out[k];
    assert.ok(bytes, `${k}: nothing saved: ${outcome.message}`);
    assert.ok(!outcome.message.includes("body:"), `${k} names an internal id: ${outcome.message}`);
    assert.match(outcome.message, new RegExp(`Combine 1 failed, so it is not in the ${k}`), k);
  }
  assert.deepEqual(objectsOf(out["3MF"].bytes!), ["Body 1: 8 corners, 12 triangles", "Body 2: 8 corners, 12 triangles"]);
});

test("regression (#640 3): a tab, line feed or carriage return in an object name is written as a space", () => {
  // XML reads a raw tab or line break in an attribute back as a space anyway; written as a character reference, the 3MF
  // consortium's own reader (strict) refuses the whole file. A name is a label, so a space loses nothing.
  const mesh = { name: "", corners: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], triangles: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] };
  const xml = modelXml([{ ...mesh, name: "a\nb\tc\rd" }] as never);
  assert.match(xml, /name="a b c d"/);
  assert.ok(!/&#(9|10|13);/.test(xml), "no character references for tab or line breaks");
  // The five named entities are kept, as before.
  assert.match(modelXml([{ ...mesh, name: 'A & <B> "c"' }] as never), /name="A &amp; &lt;B&gt; &quot;c&quot;"/);
});

test("regression (#640 4): a body single precision squashes flat is left out of the 3MF and OBJ, in words, beside a good body", async () => {
  // A 10 mm cube and a 10 × 10 × 0.002 mm plate 100 m out: single precision steps by 2^-7 = 0.0078 mm there, so the
  // plate's top and bottom land on one plane, volume 0; only the cube (1,000 mm³) belongs in the file.
  const { out } = await exportAll(boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 0.002], [1e5, 1e5, 1e5]]).doc);
  assert.deepEqual(objectsOf(out["3MF"].bytes!), ["Body 1: 8 corners, 12 triangles"]);
  const obj = new TextDecoder().decode(out.OBJ.bytes!);
  assert.deepEqual(obj.match(/^o .*$/gm), ["o Body_1"]);
  for (const k of ["3MF", "OBJ"]) {
    assert.equal(out[k].outcome.bad, true);
    assert.match(out[k].outcome.message, new RegExp(`Body 2 is left out of the ${k}: single precision squashes it flat`), out[k].outcome.message);
  }
});

test("regression (#640 5): overlapping bodies get the STL's 'touch or overlap' words in the 3MF and OBJ, never a plain 'Checked solid'", async () => {
  // A 10 mm cube and a 10 mm cube moved 5 mm along x overlap in a 5 × 10 × 10 block: each is solid alone, the two
  // together cross.
  const { out } = await exportAll(boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 0, 0]]).doc);
  for (const [k] of VERBS) {
    const { outcome } = out[k];
    assert.match(outcome.message, /The 2 bodies touch or overlap: each body is solid on its own/, `${k}: ${outcome.message}`);
    // The 3MF and OBJ keep each body its own object, so their words say so instead of the STL's "some slicers refuse".
    assert.equal(/some slicers refuse/.test(outcome.message), k === "STL", `${k}: ${outcome.message}`);
    assert.equal(/its own object in the file/.test(badgeFor(outcome.solid!, outcome.notes).detail), k !== "STL", k);
    assert.equal(outcome.notes?.touching, 2, k);
    assert.equal(badgeFor(outcome.solid!, outcome.notes).state, "touching", k);
    assert.equal(outcome.bad, true, k);
  }
  // Two cubes apart: no such words, Checked solid.
  const apart = await exportAll(boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [20, 0, 0]]).doc);
  assert.match(apart.out["3MF"].outcome.message, /^Exported spindlelabs-2-bodies\.3mf\. Checked solid\.$/);
});
