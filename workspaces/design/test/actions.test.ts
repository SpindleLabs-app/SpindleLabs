import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, outlineToSvg, RepresentationRegistry, type AnalysisOverlay, type KernelCalls, type Selected, type SolidReport, type StlFile, type WorkspaceContext } from "@fission/core";
import { COPY_SVG, DOWNLOAD_STL, partBody, registerDesignActions, representationsOf, STL_OVERLAY, targetsOf, type CopySvg } from "../src/actions.ts";
import { lastFeature, partDocument, specOf } from "../src/document.ts";
import { outline } from "../src/profiles.ts";
import { registerDesign } from "../src/representations.ts";
import { SOLID_OVERLAY } from "../src/solid-badge.ts";

const box = partDocument("box", 40, 30, 20);
const body: Selected = { kind: "body", id: "body:feature-1" };

function registry() {
  const saved: { name: string; bytes: number[] }[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, (bytes, name) => saved.push({ name, bytes: [...bytes] }));
  return { r, saved };
}

/** Just what Download STL reads: the project, the kernel and the viewport's overlays. */
function context(doc: unknown, call: (op: string, ...args: unknown[]) => Promise<unknown>) {
  const overlays: (AnalysisOverlay | string)[] = [];
  const project = emptyProject();
  if (doc) project.workspaces.design = doc;
  const ctx = {
    project,
    kernel: { call } as unknown as KernelCalls,
    viewport: {
      setOverlay: (o: AnalysisOverlay) => overlays.push(o),
      clearOverlay: (id: string) => overlays.push(`clear ${id}`),
    },
  } as unknown as WorkspaceContext;
  return { ctx, overlays };
}

test("Design's verbs for its body: Download STL; none for a face, an edge or an empty selection", () => {
  const { r } = registry();
  // Feature 1 builds the part's one body, "body:feature-1": an exact solid
  // that can also be a mesh, and STL is a mesh, so Download STL applies.
  assert.equal(partBody(box).id, "body:feature-1");
  assert.deepEqual(representationsOf(body, box), ["solid", "mesh"]);
  assert.deepEqual(r.actionsFor(targetsOf([body], box)).map((a) => a.label), ["Download STL"]);
  assert.deepEqual(r.actionsFor(targetsOf([{ kind: "face", id: "face:feature-1/0" }], box)), []);
  assert.deepEqual(r.actionsFor(targetsOf([{ kind: "edge", id: "edge:feature-1/0" }], box)), []);
  assert.deepEqual(r.actionsFor(targetsOf([], box)), []);
  // A body that is not the part's (an id from before a file was opened): nothing to download.
  assert.deepEqual(r.actionsFor(targetsOf([{ kind: "body", id: "body:feature-9" }], box)), []);
  assert.deepEqual(r.actionsFor(targetsOf([body], undefined)), []);
});

/** A binary STL of `n` triangles (all zero) with this header text: 84 + 50n bytes. */
function stl(header: string, n = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(84 + 50 * n);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  new DataView(out.buffer).setUint32(80, n, true);
  return out;
}

/** The 40 × 30 × 20 box judged solid: 12 triangles, one piece, 40 · 30 · 20 = 24,000 mm³. */
const SOLID: SolidReport = { verdict: "solid", triangles: 12, shells: 1, volume: 24000, problems: [] };

/** The kernel as Download STL uses it: export_stl gives `file`, check_solid gives `report` (or throws it); every call is noted. */
function kernel(file: StlFile, report: SolidReport | Error = SOLID, calls: unknown[][] = []) {
  return async (op: string, ...args: unknown[]) => {
    calls.push([op, ...args]);
    if (op !== "check_solid") return file;
    if (report instanceof Error) throw report;
    return report;
  };
}

const header = (bytes: number[]) => String.fromCharCode(...bytes.slice(0, 80)).trimEnd();

test("Download STL saves the kernel's file under the shape's name, checked solid, and clears both overlays", async () => {
  const { r, saved } = registry();
  const calls: unknown[][] = [];
  const file = stl("SpindleLabs STL: box");
  const { ctx, overlays } = context(box, kernel({ bytes: file, rounding: 0, warning: null }, SOLID, calls));
  const outcome = await r.get(DOWNLOAD_STL)!.run([body], ctx);
  assert.deepEqual(outcome, { message: "Exported spindlelabs-box.stl. Checked solid.", bad: false, solid: SOLID });
  // The kernel is asked for the part's own spec, named by its shape, then checks exactly that file.
  assert.deepEqual(calls, [["export_stl", specOf(box, lastFeature(box)), "box"], ["check_solid", file]]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "spindlelabs-box.stl");
  // The saved file says it was checked; everything after the header is the kernel's.
  assert.equal(header(saved[0].bytes), "SpindleLabs STL, checked solid: box");
  assert.deepEqual(saved[0].bytes.slice(80), [...file.slice(80)]);
  assert.deepEqual(overlays, [`clear ${SOLID_OVERLAY}`, `clear ${STL_OVERLAY}`]);
});

// Regression (files hunt, 2026-11-01): the note named the suggested file even when the person typed another name.
test("Download STL's note names the file actually saved, when the save says which", async () => {
  const r = new ActionRegistry();
  const offered: string[] = [];
  registerDesignActions(r, (_bytes, name) => (offered.push(name), "bracket-v2.stl")); // the person typed "bracket-v2" in the name box
  const { ctx } = context(box, kernel({ bytes: stl(""), rounding: 0, warning: null }));
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([body], ctx), { message: "Exported bracket-v2.stl. Checked solid.", bad: false, solid: SOLID });
  assert.deepEqual(offered, ["spindlelabs-box.stl"], "the shape's name was the one offered");
});

test("a warning from the kernel is shown as bad and marks the whole body", async () => {
  const { r, saved } = registry();
  const warning = "single-precision numbers: this part's corners move by up to 1.250e-2 mm";
  const { ctx, overlays } = context(box, kernel({ bytes: stl(""), rounding: 0.0125, warning }));
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([body], ctx), { message: `Exported spindlelabs-box.stl. Checked solid. ${warning}`, bad: true, solid: SOLID });
  assert.equal(saved.length, 1, "the file is still saved: the warning says how far it is off");
  assert.deepEqual(overlays, [`clear ${SOLID_OVERLAY}`, { id: STL_OVERLAY, label: "Too big for an accurate STL", detail: warning, marks: [{ target: { body: true }, severity: "warning" }] }]);
});

test("a file that is not solid is still saved, unstamped, said as bad, and its places marked in red", async () => {
  const { r, saved } = registry();
  const gaps: SolidReport = {
    verdict: "problems",
    triangles: 11,
    shells: 1,
    volume: 0,
    problems: [{ kind: "gap", count: 3, places: [{ from: [0, 0, 0], to: [0, 30, 0] }] }, { kind: "pinched", count: 1, places: [{ point: [40, 30, 20] }] }],
  };
  const file = stl("SpindleLabs STL: box");
  const { ctx, overlays } = context(box, kernel({ bytes: file, rounding: 0, warning: null }, gaps));
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([body], ctx), { message: "Exported spindlelabs-box.stl. Not solid: 3 gaps, a pinched corner.", bad: true, solid: gaps });
  assert.deepEqual(saved[0].bytes, [...file], "saved as the kernel made it: never blocked, never stamped");
  const marks = overlays[0] as AnalysisOverlay;
  assert.equal(marks.id, SOLID_OVERLAY);
  assert.deepEqual(marks.places, [
    { severity: "error", from: [0, 0, 0], to: [0, 30, 0] },
    { severity: "error", point: [40, 30, 20] },
  ]);
});

test("a solid check that can't run never stops the export and never says solid", async () => {
  const { r, saved } = registry();
  const file = stl("SpindleLabs STL: box");
  const { ctx, overlays } = context(box, kernel({ bytes: file, rounding: 0, warning: null }, new Error("took too long")));
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([body], ctx), {
    message: "Exported spindlelabs-box.stl. The solid check could not run (took too long), so the file is not known to be solid.",
    bad: true,
  });
  assert.deepEqual(saved[0].bytes, [...file]);
  assert.deepEqual(overlays, [`clear ${SOLID_OVERLAY}`, `clear ${STL_OVERLAY}`]);
  // Unfinished: also saved as made, and said.
  const unfinished: SolidReport = { verdict: "unfinished", triangles: 12, shells: 1, volume: 0, problems: [] };
  const again = registry();
  const outcome = await again.r.get(DOWNLOAD_STL)!.run([body], context(box, kernel({ bytes: file, rounding: 0, warning: null }, unfinished)).ctx);
  assert.deepEqual(outcome, { message: "Exported spindlelabs-box.stl. Solid check not finished.", bad: true, solid: unfinished });
  assert.deepEqual(again.saved[0].bytes, [...file]);
});

test("a kernel error comes back as a bad outcome, never thrown, and saves nothing", async () => {
  const { r, saved } = registry();
  const { ctx, overlays } = context(box, () => Promise.reject(new Error("width must be greater than 0")));
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([body], ctx), { message: "width must be greater than 0", bad: true });
  assert.deepEqual(saved, []);
  assert.deepEqual(overlays, []);
});

test("Download STL refuses without a part, with nothing, or with anything not a body shown, before asking the kernel", async () => {
  const { r, saved } = registry();
  const never = () => Promise.reject(new Error("the kernel must not be asked"));
  const run = (doc: unknown, targets: Selected[]) => r.get(DOWNLOAD_STL)!.run(targets, context(doc, never).ctx);
  assert.deepEqual(await run(undefined, [body]), { message: "There is no part to download yet.", bad: true });
  assert.deepEqual(await run(box, []), { message: "Download STL takes at least one body.", bad: true });
  assert.deepEqual(await run(box, [{ kind: "body", id: "body:feature-9" }]), { message: "body:feature-9 is not a body shown in the design, so there is nothing to download.", bad: true });
  assert.deepEqual(await run(box, [{ kind: "face", id: "face:feature-1/0" }]), { message: "face:feature-1/0 is not a body shown in the design, so there is nothing to download.", bad: true });
  // One bad target among good ones refuses the lot: nothing half downloaded.
  assert.deepEqual(await run(box, [body, { kind: "body", id: "body:feature-9" }]), { message: "body:feature-9 is not a body shown in the design, so there is nothing to download.", bad: true });
  assert.deepEqual(saved, []);
});

test("the same body picked twice is downloaded once, as its own file", async () => {
  const { r, saved } = registry();
  const { ctx } = context(box, kernel({ bytes: stl("SpindleLabs STL: box"), rounding: 0, warning: null }));
  assert.deepEqual(await r.get(DOWNLOAD_STL)!.run([body, body], ctx), { message: "Exported spindlelabs-box.stl. Checked solid.", bad: false, solid: SOLID });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].bytes.length, 134, "one triangle's file, not two joined");
});

// ---- Copy as SVG (X6b) ----

const slot = partDocument("slot", 60, 20, 5);
const profile: Selected = { kind: "outline", id: "outline:profile-1" };

/** What Copy as SVG reads: the project and the representation registry with Design's producers. */
function copying(doc: unknown, copy: CopySvg, registerProducers = true) {
  const copied: string[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, () => assert.fail("nothing is saved"), async (svg) => {
    copied.push(svg);
    await copy(svg);
  });
  const representations = new RepresentationRegistry();
  const never = { call: () => Promise.reject(new Error("the kernel must not be asked")) } as unknown as KernelCalls;
  if (registerProducers) registerDesign(representations, never);
  const project = emptyProject();
  if (doc) project.workspaces.design = doc;
  const ctx = { project, representations } as unknown as WorkspaceContext;
  return { run: (targets: Selected[]) => r.get(COPY_SVG)!.run(targets, ctx), copied, r };
}
const fine: CopySvg = async () => {};

test("Copy as SVG's tooltip names its key", () => {
  const { r } = registry();
  const a = r.actionsFor(targetsOf([profile], slot))[0];
  assert.match(a.title ?? "", /Ctrl\+C/);
});

test("a selected profile offers Copy as SVG; a part with no profile, or a profile it lacks, offers nothing", () => {
  const { r } = registry();
  assert.deepEqual(representationsOf(profile, slot), ["outline"]);
  assert.deepEqual(r.actionsFor(targetsOf([profile], slot)).map((a) => a.label), ["Copy as SVG"]);
  // A box is not extruded from a profile.
  assert.deepEqual(r.actionsFor(targetsOf([profile], box)), []);
  assert.deepEqual(r.actionsFor(targetsOf([{ kind: "outline", id: "outline:profile-9" }], slot)), []);
  // A profile and the body together: neither verb takes both.
  assert.deepEqual(r.actionsFor(targetsOf([profile, body], slot)), []);
  // And the body alone still offers only Download STL.
  assert.deepEqual(r.actionsFor(targetsOf([body], slot)).map((a) => a.label), ["Download STL"]);
});

test("hand-worked: copying the 60 × 20 slot profile puts its SVG on the clipboard and says its size", async () => {
  const { run, copied } = copying(slot, fine);
  assert.deepEqual(await run([profile]), { message: "Copied as SVG: Slot with round ends profile, 60 × 20 mm.", bad: false });
  // The slot fits 60 × 20 with half-circle ends of radius 10 (profiles.ts):
  // straight sides (10,0)–(50,0) and (50,20)–(10,20), each end two quarter
  // turns through (60,10) and (0,10); in SVG, y flipped (svg.ts's tests work this through).
  assert.equal(copied.length, 1);
  assert.match(copied[0], /width="60mm" height="20mm" viewBox="0 -20 60 20"/);
  assert.match(copied[0], /d="M10 0L50 0A10 10 0 0 0 60 -10A10 10 0 0 0 50 -20L10 -20A10 10 0 0 0 0 -10A10 10 0 0 0 10 0Z"/);
  assert.match(copied[0], /<title>Slot with round ends profile<\/title>/);
  assert.equal(copied[0], outlineToSvg(outline("slot", 60, 20), "Slot with round ends profile").text);
});

test("hand-worked: the star's size is its points' box, not the 40 × 40 it was asked to fit", async () => {
  // Star at 40 × 40: outer radius 20 round (20,20), points at 0°, 72°, 144°,
  // 216°, 288°. Widest: x from 20 + 20·cos 144° = 20 − 16.1803 = 3.8197 to
  // 40, so 36.1803; y = 20 ± 20·sin 72° = 20 ± 19.0211, so 38.0423 (6 digits).
  const { run } = copying(partDocument("star", 40, 40, 5), fine);
  assert.deepEqual(await run([profile]), { message: "Copied as SVG: Star profile, 36.1803 × 38.0423 mm.", bad: false });
});

test("Copy as SVG refuses without a part, with two things, or with a profile no longer in the part", async () => {
  const { run, copied } = copying(slot, fine);
  assert.deepEqual(await copying(undefined, fine).run([profile]), { message: "There is no profile to copy yet.", bad: true });
  assert.deepEqual(await run([profile, profile]), { message: "Copy as SVG takes one profile or sketch, not 2 things.", bad: true });
  assert.deepEqual(await run([{ kind: "outline", id: "outline:profile-9" }]), { message: "outline:profile-9 is not a profile or a sketch with curves, so there is nothing to copy.", bad: true });
  assert.deepEqual(await run([body]), { message: "body:feature-1 is not a profile or a sketch with curves, so there is nothing to copy.", bad: true });
  assert.deepEqual(await copying(box, fine).run([profile]), { message: "outline:profile-1 is not a profile or a sketch with curves, so there is nothing to copy.", bad: true });
  assert.deepEqual(copied, []);
});

test("the outline comes through the representation registry: with no producer there is nothing to copy", async () => {
  const { run, copied } = copying(slot, fine, false);
  assert.deepEqual(await run([profile]), { message: "Could not copy the profile: nothing knows how to describe a design.profile", bad: true });
  assert.deepEqual(copied, []);
});

test("a clipboard the browser refuses comes back as a bad outcome, never thrown", async () => {
  const { run } = copying(slot, () => Promise.reject(new Error("Write permission denied.")));
  assert.deepEqual(await run([profile]), { message: "Could not copy the profile: Write permission denied.", bad: true });
});

// Ben 2026-11-11 (#507): a downloaded STL is named after the design, not after the target's first shape.
test("Download STL is named after the design: its name, else the file it was saved to, else the old shape name", async () => {
  const run = async (name: string, fileName: string | null) => {
    const { r, saved } = registry();
    const { ctx } = context(box, kernel({ bytes: stl(""), rounding: 0, warning: null }));
    (ctx.project as { name: string }).name = name;
    (ctx as { fileName?: () => string | null }).fileName = () => fileName;
    await r.get(DOWNLOAD_STL)!.run([body], ctx);
    return saved[0].name;
  };
  assert.equal(await run("Bracket", null), "Bracket.stl", "the design's own name");
  assert.equal(await run("Bracket", "other-file"), "Bracket.stl", "the name wins over the file");
  assert.equal(await run("", "bracket-v3"), "bracket-v3.stl", "no name: the file it was saved to or opened from");
  assert.equal(await run("Untitled", "bracket-v3"), "bracket-v3.stl", "the starting name Untitled counts as none");
  assert.equal(await run("", null), "spindlelabs-box.stl", "nothing named: as before");
  assert.equal(await run("Untitled", null), "spindlelabs-box.stl");
});
