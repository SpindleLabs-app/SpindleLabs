// The export hunt of 2026-11-11 on step 77 (issue #552, hunter D's findings
// F1, F2, F4, F5, F6): each written as a failing test before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, type AnalysisOverlay, type KernelCalls, type Selected, type SolidReport, type StlFile, type WorkspaceContext } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { registerDesignActions, DOWNLOAD_STL } from "../src/actions.ts";
import { hideBody } from "../src/timeline-edits.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { DOWNLOAD_3MF, DOWNLOAD_OBJ, registerMeshActions } from "../src/mesh-export.ts";
import { meshOfStl, modelXml } from "../src/mesh-files.ts";
import { SOLID_OVERLAY } from "../src/solid-badge.ts";

/** Records what is saved (false: the user closed the save box) and which overlays the view holds. */
function setUp(doc: unknown, call: KernelCalls["call"], answer: false | undefined = undefined) {
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, () => {}, async () => {});
  registerMeshActions(r, (bytes, name) => {
    if (answer === false) return false;
    saved.push({ name, bytes });
  });
  const project = emptyProject();
  project.workspaces.design = doc;
  const overlays = new Set<string>();
  const ctx = {
    project,
    kernel: { call } as KernelCalls,
    viewport: { setOverlay: (o: AnalysisOverlay) => void overlays.add(o.id), clearOverlay: (id: string) => void overlays.delete(id) },
  } as unknown as WorkspaceContext;
  return { r, saved, ctx, overlays };
}

/** Two 10 mm cubes, the second moved `dx` along x: at 10 they share the face x = 10. */
function twoCubes(dx: number) {
  const one = partDocument("box", 10, 10, 10);
  const two = insertPreset(one, "box", 10, 10, 10).doc;
  return insertMove(two, ["body:feature-2"], { ...NO_MOVE, x: dx }).doc;
}
const both: Selected[] = [{ kind: "body", id: "body:feature-1" }, { kind: "body", id: "body:feature-2" }];

const real = nodeKernel();

test("F1: two cubes sharing a face are two solid objects in a 3MF or OBJ, which say they touch (#640 5); the STL of both says so too", async () => {
  // Cube A x 0..10, cube B x 10..20. Each object alone is a cube: 8 corners, 12 triangles, every edge used once each way, so
  // closed and outward, 1000 mm³ each. The 3MF and OBJ keep them apart, so each is checked alone and is solid; the two
  // joined are one triangle soup in which the face x = 10 is shared (edges used by four triangles), so the export says
  // the 2 bodies touch or overlap, as the STL's does, in the words for separate objects (#640 5: was a plain
  // "Checked solid", which says nothing of two parts pressed together).
  const { r, ctx } = setUp(twoCubes(10), real.call.bind(real));
  for (const id of [DOWNLOAD_3MF, DOWNLOAD_OBJ]) {
    const outcome = await r.get(id)!.run(both, ctx);
    assert.match(outcome.message, /\. The 2 bodies touch or overlap: each body is solid on its own and is its own object in the file/, outcome.message);
    assert.equal(outcome.bad, true);
    assert.equal((outcome as { notes?: { touching?: number } }).notes?.touching, 2);
  }
  const stl = await r.get(DOWNLOAD_STL)!.run(both, ctx);
  assert.match(stl.message, /The 2 bodies touch or overlap/);
});

/** A closed tetrahedron's binary STL (legs of 10 mm), its header `name`. */
function tetraStl(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(84 + 4 * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, 4, true);
  const O = [0, 0, 0], X = [10, 0, 0], Y = [0, 10, 0], Z = [0, 0, 10];
  [[O, Y, X], [O, Z, Y], [O, X, Z], [X, Y, Z]].forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => v.setFloat32(84 + i * 50 + 12 + k * 12 + j * 4, c, true))));
  return out;
}
/** An STL of one triangle with no area: every corner at (1, 1, 1). */
function squashedStl(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(84 + 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, 1, true);
  for (let k = 0; k < 9; k++) v.setFloat32(84 + 12 + k * 4, 1, true);
  return out;
}
const SOLID: SolidReport = { verdict: "solid", triangles: 4, shells: 1, volume: 1000 / 6, problems: [] };
const CROSSING: SolidReport = { verdict: "problems", triangles: 4, shells: 1, volume: 1000 / 6, problems: [{ kind: "crossing", count: 2, places: [{ point: [1, 2, 3] }] }] };

/** A stand-in kernel: export_stl gives `files` in turn (the doc's bodies in build order), check_solid gives `reports` in turn (or throws one). */
function standIn(files: StlFile[], reports: (SolidReport | Error)[], calls: string[] = []): KernelCalls["call"] {
  let f = 0;
  let c = 0;
  return (async (op: string) => {
    calls.push(op);
    if (op === "check_solid") {
      const r = reports[Math.min(c++, reports.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }
    return files[f++ % files.length];
  }) as KernelCalls["call"];
}
const file = (bytes = tetraStl(), warning: string | null = null): StlFile => ({ bytes, rounding: 0, warning });

test("F6 and F2: a not-solid object marks the view red and is bad; a solid export clears the marks", async () => {
  const { r, ctx, overlays } = setUp(twoCubes(30), standIn([file()], [SOLID, CROSSING]));
  const bad = await r.get(DOWNLOAD_3MF)!.run(both, ctx);
  // Body 1 solid, Body 2 two crossings: not solid, the places marked, bad.
  assert.equal(bad.bad, true);
  assert.match(bad.message, /Not solid: 2 crossings/);
  assert.equal(bad.solid?.verdict, "problems");
  assert.ok(overlays.has(SOLID_OVERLAY));
  const { r: r2, ctx: ctx2 } = setUp(twoCubes(30), standIn([file()], [SOLID]));
  // The same view (the marks from the bad export) and a solid export: the marks go.
  (ctx2 as unknown as { viewport: unknown }).viewport = (ctx as unknown as { viewport: unknown }).viewport;
  const good = await r2.get(DOWNLOAD_OBJ)!.run(both, ctx2);
  assert.equal(good.bad, false);
  assert.ok(!overlays.has(SOLID_OVERLAY));
});

test("F2: every object is checked on its own (one check call per body), and the merged report adds them up", async () => {
  const calls: string[] = [];
  const { r, ctx } = setUp(twoCubes(30), standIn([file()], [SOLID, SOLID], calls));
  const outcome = await r.get(DOWNLOAD_3MF)!.run(both, ctx);
  // One check per body, then one of the two joined (#640 5: do they touch or overlap?), here solid too, so nothing more is said.
  assert.equal(calls.filter((c) => c === "check_solid").length, 3);
  // Two tetrahedra: 2 shells, 8 triangles, 2 × 1000/6 mm³.
  assert.deepEqual(outcome.solid, { verdict: "solid", triangles: 8, shells: 2, volume: 2000 / 6, problems: [] });
});

test("F2: a check that cannot run never says solid; the file is still saved", async () => {
  const { r, ctx, saved } = setUp(partDocument("box", 10, 10, 10), standIn([file()], [new Error("worker gone")]));
  const outcome = await r.get(DOWNLOAD_3MF)!.run([both[0]], ctx);
  assert.equal(saved.length, 1);
  assert.equal(outcome.bad, true);
  assert.equal(outcome.solid, undefined);
  assert.match(outcome.message, /The solid check could not run \(worker gone\), so the file is not known to be solid\./);
});

test("F2 and F4: the precision warning is kept, said of the 3MF (not of an STL), and makes the export bad", async () => {
  const warning = "STL stores single-precision numbers: this part's corners move by up to 1.250e-2 mm, more than the smallest feature.";
  const { r, ctx } = setUp(partDocument("box", 10, 10, 10), standIn([file(tetraStl(), warning)], [SOLID]));
  const outcome = await r.get(DOWNLOAD_3MF)!.run([both[0]], ctx);
  assert.equal(outcome.bad, true);
  assert.match(outcome.message, /The 3MF holds single-precision numbers, as STL does: this part's corners move by up to 1\.250e-2 mm/);
});

test("F2: a closed save box saves nothing and says so; a hidden body is refused; picked order and repeats give build order once", async () => {
  const closed = setUp(partDocument("box", 10, 10, 10), standIn([file()], [SOLID]), false);
  assert.deepEqual(await closed.r.get(DOWNLOAD_OBJ)!.run([both[0]], closed.ctx), { message: "Export OBJ cancelled: nothing was saved.", bad: false });
  const hidden = setUp(hideBody(twoCubes(30), "body:feature-2", true), standIn([file()], [SOLID]));
  const refused = await hidden.r.get(DOWNLOAD_3MF)!.run(both, hidden.ctx);
  // Named by its browser row's number, as Download STL names it, never its id (#640 2).
  assert.deepEqual(refused, { message: "Body 2 is not a body shown in the design, so there is nothing to download.", bad: true });
  assert.equal(hidden.saved.length, 0);
  const order = setUp(twoCubes(30), real.call.bind(real));
  await order.r.get(DOWNLOAD_3MF)!.run([both[1], both[0], both[1]], order.ctx);
  const xml = new TextDecoder().decode(order.saved[0].bytes);
  assert.deepEqual([...xml.matchAll(/<object id="(\d+)" type="model" name="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`), ["1 Body 1", "2 Body 2"]);
});

test("F4: a body single precision squashes to nothing is left out of the file, saying so; with nothing left nothing is saved", async () => {
  const some = setUp(twoCubes(30), standIn([file(), file(squashedStl())], [SOLID, SOLID]));
  const outcome = await some.r.get(DOWNLOAD_3MF)!.run(both, some.ctx);
  const xml = new TextDecoder().decode(some.saved[0].bytes);
  assert.equal(xml.match(/<object /g)?.length, 1);
  assert.match(outcome.message, /Body 2 is left out of the 3MF: single precision squashes it to nothing, so it has no triangles\./);
  assert.equal(outcome.bad, true);
  const none = setUp(partDocument("box", 10, 10, 10), standIn([file(squashedStl())], [SOLID]));
  const refused = await none.r.get(DOWNLOAD_OBJ)!.run([both[0]], none.ctx);
  assert.equal(none.saved.length, 0);
  assert.deepEqual(refused, { message: "Nothing to export as OBJ: single precision squashes Body 1 to nothing, so it has no triangles.", bad: true });
});

test("F5: control characters in a name never reach the XML raw; a line feed or tab becomes a space (#640 3)", () => {
  const mesh = meshOfStl(tetraStl(), "x");
  // XML 1.0 allows no U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE or U+FFFF at all, even as references: replaced by U+FFFD.
  const xml = modelXml([{ ...mesh, name: "bell\u0007here￿" }]);
  assert.match(xml, /name="bell�here�"/);
  // A line feed, carriage return or tab is written as a space: as a character reference the 3MF consortium's own
  // reader refuses the file (export hunt 2026-11-12 B), and a raw one is read back as a space anyway.
  assert.match(modelXml([{ ...mesh, name: "a\nb\tc\rd" }]), /name="a b c d"/);
});

test("F2: merged reports: problems of any object win over unfinished, unfinished over solid, each kind once with counts added", async () => {
  const { mergeReports } = await import("../src/mesh-export.ts");
  const UNFINISHED: SolidReport = { verdict: "unfinished", triangles: 10, shells: 1, volume: 5, problems: [] };
  const merged = mergeReports([CROSSING, SOLID, UNFINISHED, CROSSING]);
  // 4 + 4 + 10 + 4 = 22 triangles, 4 pieces, volume 3 × 1000/6 + 5; the two crossing kinds as one of count 2 + 2 = 4, both places.
  assert.deepEqual(merged, { verdict: "problems", triangles: 22, shells: 4, volume: 3 * (1000 / 6) + 5, problems: [{ kind: "crossing", count: 4, places: [{ point: [1, 2, 3] }, { point: [1, 2, 3] }] }] });
  assert.equal(mergeReports([SOLID, UNFINISHED]).verdict, "unfinished");
  assert.equal(mergeReports([SOLID, SOLID]).verdict, "solid");
  // The inputs are left as they were.
  assert.equal(CROSSING.problems[0].count, 2);
});

test("F4: with several bodies each warning names its body and is said of the file's own format", async () => {
  const warning = "STL stores single-precision numbers: this part's corners move by up to 1.250e-2 mm, more than the smallest feature.";
  const { r, ctx } = setUp(twoCubes(30), standIn([file(tetraStl(), warning)], [SOLID]));
  const outcome = await r.get(DOWNLOAD_OBJ)!.run(both, ctx);
  assert.match(outcome.message, /Body 1: The OBJ holds single-precision numbers, as STL does: .* Body 2: The OBJ holds single-precision numbers, as STL does:/);
  assert.doesNotMatch(outcome.message, /STL stores/);
});
