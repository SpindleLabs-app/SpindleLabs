// Export hunt 2026-11-12 D (SpindleLabs#613). 1: a timeline item that failed (an Extrude Cut of a circle on a box's top
// face: booleans take flat faces only for now) left Export STL and Slice for printing without it and without a word,
// the STL still "Checked solid". Now both say which item failed and that it is not in the file, and the STL is not
// stamped checked. 2: two bodies that are each solid but touch got a red "Not solid: N crossings"; now each body is
// checked on its own and touching bodies get a milder note offering Combine > Join, while a body broken on its own is
// still "Not solid". On the real kernel, and with a stand-in kernel for the broken body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, type KernelCalls, type SolidReport, type WorkspaceContext } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { DOWNLOAD_STL, failedItemsNote, registerDesignActions, shownBodyRefs, type DesignOutcome, type DesignRun } from "../src/actions.ts";
import { failedIds } from "../src/browser.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { addFaceSketch, drawCircle, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { badgeFor, CHECKED_HEADER } from "../src/solid-badge.ts";
import { slicePrint } from "../src/slice-print.ts";

const kernel = nodeKernel();

/** A 40 × 30 × 20 box with a circle r 5 at (20, 15) sketched on its top face and Extrude Cut 10 mm into it (the hunt's repro). */
function holed() {
  const d = partDocument("box", 40, 30, 20);
  const s = addFaceSketch(d, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const c = drawCircle(s.doc, s.id, [20, 15] as never, 5);
  return extrudeSketch(c.doc, s.id, 10, true, undefined, { operation: "cut", bodies: ["body:feature-1"] });
}

/** A 40 × 30 × 20 box and a 20 × 10 rectangle sketched on its top face, extruded 10 mm up as a new body (the default): it sits on the box, touching it. */
function stacked() {
  const d = partDocument("box", 40, 30, 20);
  const s = addFaceSketch(d, { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const r = drawRectangle(s.doc, s.id, [10, 10], [30, 20]);
  return extrudeSketch(r.doc, s.id, 10);
}

/** Every body shown, downloaded as the workspace runs it: the last rebuild's failed set in the run's context. */
async function download(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  const failed = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
  const saved: Uint8Array[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, (bytes) => void saved.push(bytes));
  const project = emptyProject();
  project.workspaces.design = doc;
  const ctx = { project, kernel, failed, viewport: { setOverlay: () => {}, clearOverlay: () => {} } } as unknown as DesignRun;
  const outcome = (await r.get(DOWNLOAD_STL)!.run(shownBodyRefs(doc, failed), ctx as WorkspaceContext)) as DesignOutcome;
  return { build, failed, saved, outcome };
}

const header = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 80)).trimEnd();

test("regression (hunt D 1): a failed Extrude Cut is named in the STL's outcome, which is bad and never 'Checked solid'", async () => {
  const { doc, id } = holed();
  const { build, failed, saved, outcome } = await download(doc);
  // The circle's side is curved, so the Cut fails today (the kernel roadmap's curved booleans). Should it ever build,
  // this test has nothing to prove, and says so rather than passing quietly.
  assert.equal(build.results[id]?.status, "failed", "the hole's Cut built: this regression needs another failing item");
  // The extrude is the design's first sketch extrude, so the timeline names it "Extrude 1" (freshName("Extrude", 0)).
  assert.equal(failedItemsNote(doc, failed), "Extrude 1 failed, so it is not in the STL: the part is saved without it. Fix it in the timeline (red) to include it.");
  assert.equal(outcome.message, `Exported spindlelabs-box.stl. ${failedItemsNote(doc, failed)} What was built is checked solid.`);
  assert.equal(outcome.bad, true);
  assert.equal(outcome.solid?.verdict, "solid", "the box alone is solid: the file's own check is kept");
  assert.deepEqual(outcome.notes, { missing: failedItemsNote(doc, failed) });
  // The card says it is not the whole design; the file is still saved (what was built), but its header never says checked.
  assert.equal(badgeFor(outcome.solid!, outcome.notes).state, "missing");
  assert.equal(badgeFor(outcome.solid!, outcome.notes).title, "Not the whole design");
  assert.equal(saved.length, 1);
  assert.ok(!header(saved[0]).startsWith(CHECKED_HEADER), header(saved[0]));
});

test("the failed-items note names each failed item in timeline order, and nothing when none failed", () => {
  const { doc } = holed();
  const box = doc.timeline.features[0].id;
  const cut = doc.timeline.features.at(-1)!.id;
  assert.equal(failedItemsNote(doc, new Set()), "");
  // A failed body id ("body:…", a built item whose body is absent) is not an item: no name of its own.
  assert.equal(failedItemsNote(doc, new Set([`body:${box}`])), "");
  // Two failed: "Box 1 and Extrude 1", in the timeline's order whatever the set's.
  assert.equal(failedItemsNote(doc, new Set([cut, box]), "print"), "Box 1 and Extrude 1 failed, so they are not in the print: the part is printed without them. Fix them in the timeline (red) to include them.");
});

test("regression (hunt D 1): Slice for printing says which item failed, as the dialog opens and with the slice's result", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const document = window.document as unknown as Document;
  const slot = document.createElement("div");
  document.body.append(slot);
  let missing = "Extrude 1 failed, so it is not in the print: the part is printed without it. Fix it in the timeline (red) to include it.";
  const facts = { gcode: "G1 X1\n", layers: 100, filamentMm: 1730, filamentG: 5.16, retractions: 0, unprintedVolume: 0, printTimeS: 257, preview: [] };
  const d = slicePrint(slot, { slice: async () => ({ print: facts as never, saved: true, name: "part.gcode.3mf" }), preview: async () => {}, missing: () => missing });
  const $ = (id: string) => document.getElementById(id)!;
  d.ask();
  assert.equal($("slice-print-missing").hidden, false);
  assert.equal($("slice-print-missing").textContent, missing);
  $("slice-print-go").click();
  await new Promise((r) => setTimeout(r, 0));
  // The result leads with it and is a warning: the file was made, without the failed item.
  assert.match($("slice-print-status").textContent!, /^Saved part\.gcode\.3mf: 100 layers, .* Extrude 1 failed, so it is not in the print/);
  assert.equal($("slice-print-status").classList.contains("slice-print-bad"), true);
  // Fixed (nothing failed): the next opening says nothing of it.
  $("slice-print-close").click();
  missing = "";
  d.ask();
  assert.equal($("slice-print-missing").hidden, true);
  await window.happyDOM.close();
});

test("regression (hunt D 2): a body sitting on another, each solid alone, is said to touch, never 'Not solid'", async () => {
  const { doc } = stacked();
  const { saved, outcome } = await download(doc);
  // The file holding both has crossings where the rectangle's bottom meets the box's top; each body alone is closed.
  assert.equal(outcome.solid?.verdict, "problems");
  assert.deepEqual(outcome.notes, { touching: 2 });
  assert.equal(
    outcome.message,
    "Exported spindlelabs-2-bodies.stl. The 2 bodies touch or overlap: each body is solid on its own, but where they meet their surfaces cross, and some slicers refuse such a file (Slice for printing sends them one by one, which is safe). Combine > Join makes them one part.",
  );
  assert.doesNotMatch(outcome.message, /Not solid/);
  assert.equal(outcome.bad, true, "still a warning: our own slicer refuses touching bodies in one file");
  const b = badgeFor(outcome.solid!, outcome.notes);
  assert.deepEqual([b.state, b.title], ["touching", "The 2 bodies touch or overlap"]);
  assert.ok(!header(saved[0]).startsWith(CHECKED_HEADER));
});

test("hand-worked: two boxes far apart are still checked solid as one file (the per-body check changes nothing there)", async () => {
  let doc = partDocument("box", 40, 30, 20);
  // A second 40 × 30 × 20 box, inserted at the origin like the first would overlap it; moved 200 along x it is clear of it.
  const two = insertPreset(doc, "box", 40, 30, 20);
  const { insertMove, NO_MOVE } = await import("../src/move.ts");
  doc = insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, x: 200 }).doc;
  const { outcome } = await download(doc);
  assert.equal(outcome.solid?.verdict, "solid");
  assert.equal(outcome.notes, undefined);
  assert.match(outcome.message, /^Exported spindlelabs-2-bodies\.stl\. Checked solid\. The 2 bodies are separate shells/);
});

test("a body broken on its own is still 'Not solid' when another body is in the file (stand-in kernel)", async () => {
  // Two bodies far apart; the stand-in kernel says the joined file has gaps, and so does the second body alone.
  let doc = partDocument("box", 40, 30, 20);
  doc = insertPreset(doc, "box", 40, 30, 20).doc;
  const gaps: SolidReport = { verdict: "problems", triangles: 23, shells: 2, volume: 0, problems: [{ kind: "gap", count: 3, places: [] }] };
  const solid: SolidReport = { verdict: "solid", triangles: 12, shells: 1, volume: 24000, problems: [] };
  let checks = 0;
  const file = () => {
    const out = new Uint8Array(84 + 50);
    new DataView(out.buffer).setUint32(80, 1, true);
    return { bytes: out, rounding: 0, warning: null };
  };
  // check_solid: 1st the joined file (gaps), then body 1 alone (solid), then body 2 alone (gaps).
  const call = async (op: string) => (op === "check_solid" ? [gaps, solid, gaps][checks++] : file());
  const r = new ActionRegistry();
  registerDesignActions(r, () => {});
  const project = emptyProject();
  project.workspaces.design = doc;
  const ctx = { project, kernel: { call } as unknown as KernelCalls, viewport: { setOverlay: () => {}, clearOverlay: () => {} } } as unknown as WorkspaceContext;
  const outcome = (await r.get(DOWNLOAD_STL)!.run(shownBodyRefs(doc), ctx)) as DesignOutcome;
  assert.equal(checks, 3, "the joined file, then each body alone");
  assert.match(outcome.message, /^Exported spindlelabs-2-bodies\.stl\. Not solid: 3 gaps\. /);
  assert.equal(outcome.notes, undefined);
  assert.equal(badgeFor(outcome.solid!, outcome.notes).state, "problems");
});
