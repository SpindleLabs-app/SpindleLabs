// The Slice page (page.ts): the plate's mesh worked out by hand, the words, reading bodies through a registry, and the page
// in a DOM (happy-dom). The real app in Chromium: apps/fission/e2e/slice-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type WorkspaceContext } from "@fission/core";
import { leftOutWords, mountSlicePage, plateFiles, plateMesh, plateWords, printPanel, readPlate, sliceWords, slicePageWorkspace } from "../src/index.ts";
import { PRINT_DEFAULTS } from "@fission/print";

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
  assert.deepEqual(slicePageWorkspace.representations.accepts, ["mesh", "data"]);
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
    kernel: { call: async () => ({}) },
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

// ---- The print panel (print-panel.ts) ----

/** A binary STL of one triangle (80-byte header, count 1, 50 bytes), its corners at height z, so each body's file is told apart. */
function triangle(z: number): Uint8Array {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  [[0, 0, z], [10, 0, z], [0, 10, z]].forEach((c, i) => c.forEach((v, k) => view.setFloat32(96 + i * 12 + k * 4, v, true)));
  return bytes;
}
const stlRegistry = (fail: string[] = []) => {
  const r = new RepresentationRegistry();
  r.registerProducer("fake.body", "data", (o) => {
    if (fail.includes(o.id)) return { kind: "data", values: { format: "obj" } };
    return { kind: "data", values: { format: "stl", bytes: triangle(o.id.charCodeAt(0)) } };
  });
  return r;
};

test("plateFiles reads each body's STL in order, and a body that gives no STL stops the slice in words naming it", async () => {
  const files = await plateFiles(stlRegistry(), objects);
  assert.equal(files.length, 3);
  assert.equal(new DataView(files[0].buffer).getFloat32(96 + 8, true), 97); // "a" is char code 97: its file's first corner is at z 97
  await assert.rejects(plateFiles(stlRegistry(["b"]), objects), /Body b could not be turned into a print file/);
});

test("the words of a slice: layers, grams and time as the dialog says them, with the warnings after", () => {
  const done = { layers: 100, filamentMm: 2000, filamentG: 5.97, printTimeS: 4800, unprintedVolume: 0, levelNote: "Body 2 floats." };
  const words = sliceWords(done);
  assert.match(words, /^100 layers, /);
  assert.match(words, /Body 2 floats\.$/);
});

/** The panel's choice boxes (quality … nozzle), not the presets list that sits above them. */
const choiceSelects = (doc: Document) => [...doc.querySelectorAll("select")].filter((x) => (x as unknown as HTMLElement).id !== "slice-presets-list") as unknown as HTMLSelectElement[];

function panelIn(kernelCall: (name: string, ...a: unknown[]) => Promise<unknown>, list = objects, extra: Partial<Parameters<typeof printPanel>[1]> = {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const panel = printPanel(doc, { kernel: { call: kernelCall, stopSlicing: () => undefined } as never, registry: stlRegistry(), objects: () => list, storage: null, ...extra });
  doc.body.append(panel.element);
  return { doc, panel };
}

test("the panel starts on the beginner's defaults, and picking a choice changes only that choice", () => {
  const { doc, panel } = panelIn(async () => ({}));
  assert.deepEqual(panel.choices(), PRINT_DEFAULTS);
  const selects = choiceSelects(doc);
  assert.equal(selects.length, 7, "quality, walls, infill, supports, file, build plate, nozzle");
  selects[1].value = "3"; // Walls: the options are 1..6, index 3 is 4 walls
  selects[1].dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.deepEqual(panel.choices(), { ...PRINT_DEFAULTS, walls: 4 });
});

test("Slice asks the engine for the stacked files with the choices and says what it came to; an empty plate says why and never asks", async () => {
  const calls: unknown[][] = [];
  const { doc, panel } = panelIn(async (...a) => (calls.push(a), { layers: 12, filamentMm: 1000, filamentG: 3, printTimeS: 600, unprintedVolume: 0 }));
  await panel.slice();
  assert.equal(calls[0][0], "slice_stl");
  assert.equal(calls[0][2], PRINT_DEFAULTS.layerHeight);
  assert.equal((calls[0][1] as Uint8Array).length, 3 * 134, "three bodies' files back to back");
  assert.match(doc.querySelector(".slice-page-slice-words")!.textContent!, /^12 layers, /);
  const empty = panelIn(async (...a) => (calls.push(a), {}), []);
  await empty.panel.slice();
  assert.equal(calls.length, 1, "no body, no engine call");
  assert.match(empty.doc.querySelector(".slice-page-slice-words")!.textContent!, /Nothing to slice/);
});

test("a refusal from the engine is said in words, and the button works again afterwards", async () => {
  const { doc, panel } = panelIn(async () => {
    throw new Error("the part is too tall");
  });
  await panel.slice();
  const words = doc.querySelector(".slice-page-slice-words")!.textContent!;
  assert.ok(words.length > 0 && !/^Slicing/.test(words), words);
  assert.equal((doc.querySelector("#slice-page-slice") as unknown as HTMLButtonElement).disabled, false);
});

test("Slice and download makes the P1S's file for the plate and nozzle chosen, saves it under the file's name and says what it came to; a cancelled save still says the slice", async () => {
  const calls: unknown[][] = [];
  const saved: { suggestedName: string; kind: { extension: string }; bytes: Uint8Array }[] = [];
  const pkg = new Uint8Array([1, 2, 3]);
  const { doc, panel } = panelIn(
    async (...a) => (calls.push(a), { layers: 12, filamentMm: 1000, filamentG: 3, printTimeS: 600, unprintedVolume: 0, package: pkg }),
    objects,
    { save: async (r) => (saved.push(r), { status: "saved", name: "chosen.gcode.3mf" }), projectName: () => "Bracket" },
  );
  const selects = choiceSelects(doc);
  selects[5].value = "2"; // Cool Plate
  selects[5].dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.deepEqual(panel.file(), { format: "p1s", plate: "cool_plate", nozzle: "standard" });
  await panel.download();
  assert.equal(calls[0][0], "print_file_stl");
  assert.equal(calls[0][6], "cool_plate");
  assert.equal(calls[0][7], "standard");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind.extension, ".gcode.3mf");
  assert.deepEqual([...saved[0].bytes], [1, 2, 3]);
  assert.match(saved[0].suggestedName, /^bracket/i);
  assert.match(doc.querySelector(".slice-page-slice-words")!.textContent!, /^Saved chosen\.gcode\.3mf: 12 layers, /);
  const cancelled = panelIn(async () => ({ layers: 5, filamentMm: 1, filamentG: 1, printTimeS: 60, unprintedVolume: 0, package: pkg }), objects, { save: async () => ({ status: "cancelled" }) });
  await cancelled.panel.download();
  assert.match(cancelled.doc.querySelector(".slice-page-slice-words")!.textContent!, /^Sliced, but not saved: 5 layers/);
});

test("Slice and download: an empty plate never asks the engine or saves, a failed save is said, and a refusal leaves the buttons working", async () => {
  let asked = 0;
  let saves = 0;
  const empty = panelIn(async () => (asked++, {}), [], { save: async () => (saves++, { status: "saved", name: "x" }) });
  await empty.panel.download();
  assert.equal(asked + saves, 0);
  assert.match(empty.doc.querySelector(".slice-page-slice-words")!.textContent!, /Nothing to slice/);
  const failing = panelIn(async () => ({ layers: 5, filamentMm: 1, filamentG: 1, printTimeS: 60, unprintedVolume: 0, package: new Uint8Array(1) }), objects, { save: async () => ({ status: "failed", message: "disk full" }) });
  await failing.panel.download();
  assert.match(failing.doc.querySelector(".slice-page-slice-words")!.textContent!, /not saved \(disk full\)/);
  const refused = panelIn(async () => {
    throw new Error("the part is too tall");
  }, objects, { save: async () => ({ status: "saved", name: "x" }) });
  await refused.panel.download();
  assert.equal((refused.doc.querySelector("#slice-page-download") as unknown as HTMLButtonElement).disabled, false);
  assert.equal((refused.doc.querySelector("#slice-page-slice") as unknown as HTMLButtonElement).disabled, false);
});

test("Preview slices as the download would and hands the preview its G-code and the slice's words; an empty plate never asks, a refusal is said and the buttons work again", async () => {
  const calls: unknown[][] = [];
  const shown: { gcode: string; words: string }[] = [];
  const result = { layers: 12, filamentMm: 1000, filamentG: 3, printTimeS: 600, unprintedVolume: 0, package: new Uint8Array(0), gcode: "G1 X1 ; plain slice" };
  const { doc, panel } = panelIn(async (...a) => (calls.push(a), result), objects, { openPreview: (gcode, words) => shown.push({ gcode, words }) });
  await panel.preview();
  // The P1S file is asked first (its own G-code is what plays); this stand-in package holds none, so the plain slice's G-code is used.
  assert.deepEqual(calls.map((c) => c[0]), ["print_file_stl", "slice_stl"]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].gcode, "G1 X1 ; plain slice");
  assert.match(shown[0].words, /^12 layers, /);
  assert.equal((doc.querySelector("#slice-page-preview") as unknown as HTMLButtonElement).disabled, false);
  const empty = panelIn(async () => (calls.push(["never"]), {}), [], { openPreview: () => shown.push({ gcode: "never", words: "" }) });
  const before = calls.length;
  await empty.panel.preview();
  assert.equal(calls.length, before);
  assert.equal(shown.length, 1, "no body, no preview");
  assert.match(empty.doc.querySelector(".slice-page-slice-words")!.textContent!, /Nothing to slice/);
  const refused = panelIn(async () => {
    throw new Error("the part is too tall");
  }, objects, { openPreview: () => shown.push({ gcode: "never", words: "" }) });
  await refused.panel.preview();
  assert.equal(shown.length, 1);
  assert.equal((refused.doc.querySelector("#slice-page-preview") as unknown as HTMLButtonElement).disabled, false);
  assert.ok(refused.doc.querySelector(".slice-page-slice-words")!.textContent!.length > 0);
});

test("the warm-up loop and Better grip ticks change the choices and are remembered; the defaults are warm-up on, grip off", () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
  const { doc, panel } = panelIn(async () => ({}), objects, { storage });
  assert.equal(panel.choices().warmUp, true);
  assert.equal(panel.choices().betterGrip, false);
  const warm = doc.querySelector("#slice-page-warm-up") as unknown as HTMLInputElement;
  const grip = doc.querySelector("#slice-page-grip") as unknown as HTMLInputElement;
  const Ev = (doc.defaultView as unknown as { Event: typeof Event }).Event;
  warm.checked = false;
  warm.dispatchEvent(new Ev("change"));
  grip.checked = true;
  grip.dispatchEvent(new Ev("change"));
  assert.equal(panel.choices().warmUp, false);
  assert.equal(panel.choices().betterGrip, true);
  assert.equal(stored.get("spindlelabs.slice.warm-up"), "off");
  assert.equal(stored.get("spindlelabs.slice.better-grip"), "on");
  // A page opened again starts from what was remembered.
  const again = panelIn(async () => ({}), objects, { storage });
  assert.equal(again.panel.choices().warmUp, false);
  assert.equal(again.panel.choices().betterGrip, true);
});

test("after a slice the cost line says plastic, money and time, follows the price typed, and keeps the last price that reads; a saved file goes into the print log", async () => {
  const logged: { name: string; settings: string; grams: number; seconds: number }[] = [];
  const result = { layers: 12, filamentMm: 1000, filamentG: 40, printTimeS: 4800, unprintedVolume: 0, package: new Uint8Array(1) };
  const { doc, panel } = panelIn(async () => result, objects, {
    save: async () => ({ status: "saved", name: "x.gcode.3mf" }),
    log: (m) => (logged.push(m), true),
    projectName: () => "Bracket",
  });
  const cost = doc.querySelector(".slice-page-cost") as unknown as HTMLElement;
  assert.equal(cost.hidden, true, "no line before a slice");
  await panel.download();
  assert.equal(cost.hidden, false);
  // 40 g at the default A$25 per kg is 40 / 1000 × 25 = A$1.00; 4800 s is 1 h 20 min.
  assert.match(cost.textContent!, /About 40 g of PLA, A\$1\.00, 1 h 20 min of printing/);
  const price = doc.querySelector("#slice-page-price") as unknown as HTMLInputElement;
  const Ev = (doc.defaultView as unknown as { Event: typeof Event }).Event;
  price.value = "50"; // 40 g at A$50 per kg: A$2.00
  price.dispatchEvent(new Ev("input"));
  assert.match(cost.textContent!, /A\$2\.00/);
  price.value = "abc"; // unreadable: the line keeps the last price
  price.dispatchEvent(new Ev("input"));
  assert.match(cost.textContent!, /A\$2\.00/);
  assert.equal(price.getAttribute("aria-invalid"), "true");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].name, "Bracket");
  assert.equal(logged[0].grams, 40);
  assert.equal(logged[0].seconds, 4800);
  assert.match(doc.querySelector(".slice-page-slice-words")!.textContent!, /Added to your print log\.$/);
  // A cancelled save is not logged.
  const cancelled = panelIn(async () => result, objects, { save: async () => ({ status: "cancelled" }), log: (m) => (logged.push(m), true) });
  await cancelled.panel.download();
  assert.equal(logged.length, 1);
});

test("File: plain G-code slices without the P1S's file, saves the G-code as text under the .gcode name, and turns the plate and nozzle off; the P1S file turns them on again", async () => {
  const calls: string[] = [];
  const saved: { suggestedName: string; kind: { extension: string }; bytes: Uint8Array }[] = [];
  const { doc, panel } = panelIn(
    async (name) => (calls.push(String(name)), { layers: 12, filamentMm: 1000, filamentG: 3, printTimeS: 600, unprintedVolume: 0, gcode: "G1 X1\n" }),
    objects,
    { save: async (r) => (saved.push(r), { status: "saved", name: "plain.gcode" }), projectName: () => "Bracket" },
  );
  const selects = choiceSelects(doc);
  const Ev = (doc.defaultView as unknown as { Event: typeof Event }).Event;
  const [file, plate, nozzle] = [selects[4], selects[5], selects[6]];
  assert.equal(plate.disabled, false);
  file.value = "1"; // Plain G-code
  file.dispatchEvent(new Ev("change"));
  assert.equal(panel.file().format, "gcode");
  assert.equal(plate.disabled && nozzle.disabled, true, "they matter to the P1S's file only");
  await panel.download();
  assert.deepEqual(calls, ["slice_stl"], "the plain slice, never the P1S file");
  assert.equal(saved[0].kind.extension, ".gcode");
  assert.match(saved[0].suggestedName, /^bracket.*\.gcode$/i);
  assert.equal(new TextDecoder().decode(saved[0].bytes), "G1 X1\n");
  assert.equal(plate.disabled, true, "still off after the slice");
  file.value = "0";
  file.dispatchEvent(new Ev("change"));
  assert.equal(plate.disabled || nozzle.disabled, false);
});

test("the bar shows while it slices, follows the engine's reports forward only, and goes when it is done, even when it fails", async () => {
  let report: ((p: { fraction: number; stage: string; done: number; total: number }) => void) | null = null;
  let stopped = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  const { doc, panel } = panelIn(
    async () => {
      await held;
      return { layers: 3, filamentMm: 1, filamentG: 1, printTimeS: 60, unprintedVolume: 0 };
    },
    objects,
    { onProgress: (l) => ((report = l as typeof report), () => void stopped++) },
  );
  const bar = doc.querySelector(".slice-page-progress") as unknown as HTMLElement;
  const meter = doc.querySelector(".slice-page-meter") as unknown as HTMLProgressElement;
  const stage = doc.querySelector(".slice-page-stage") as unknown as HTMLElement;
  assert.equal(bar.hidden, true);
  const running = panel.slice();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bar.hidden, false);
  report!({ fraction: 0.5, stage: "walls", done: 5, total: 10 });
  assert.equal(meter.value, 0.5);
  assert.equal(stage.textContent, "Walls: layer 5 of 10");
  report!({ fraction: 0.2, stage: "walls", done: 2, total: 10 }); // a report that goes back is ignored
  assert.equal(meter.value, 0.5);
  release();
  await running;
  assert.equal(bar.hidden, true);
  assert.equal(stopped, 1, "stopped listening");
  const failing = panelIn(async () => {
    throw new Error("the part is too tall");
  }, objects, { onProgress: () => () => void stopped++ });
  await failing.panel.slice();
  assert.equal((failing.doc.querySelector(".slice-page-progress") as unknown as HTMLElement).hidden, true);
  assert.equal(stopped, 2);
});

test("a printer preset picked puts every setting in (the selects, ticks, file, plate and nozzle), and a change afterwards marks it changed", () => {
  const stored = new Map<string, string>();
  const settings = { layerHeight: 0.12, walls: 4, infill: 40, supports: "tree", warmUp: false, betterGrip: true, format: "p1s", plate: "smooth", nozzle: "high-flow" };
  stored.set("spindlelabs.slice.presets", JSON.stringify({ version: 1, presets: [{ id: "p-1", name: "Strong", printer: "bambu-p1s", settings, updatedAt: 1 }] }));
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
  const { doc, panel } = panelIn(async () => ({}), objects, { storage });
  const Ev = (doc.defaultView as unknown as { Event: typeof Event }).Event;
  const list = doc.querySelector("#slice-presets-list") as unknown as HTMLSelectElement;
  assert.ok(list, "the presets bar is on the page");
  list.value = "p-1";
  list.dispatchEvent(new Ev("change"));
  assert.deepEqual(panel.choices(), { ...PRINT_DEFAULTS, layerHeight: 0.12, walls: 4, infill: 40, supports: "tree", warmUp: false, betterGrip: true });
  assert.deepEqual(panel.file(), { format: "p1s", plate: "smooth", nozzle: "high-flow" });
  const selects = choiceSelects(doc);
  assert.equal(selects[1].selectedOptions[0].textContent, "4", "the Walls box shows 4");
  assert.equal((doc.querySelector("#slice-page-grip") as unknown as HTMLInputElement).checked, true);
  assert.equal((doc.querySelector("#slice-page-warm-up") as unknown as HTMLInputElement).checked, false);
  assert.equal(stored.get("spindlelabs.slice.nozzle"), "high-flow", "remembered as if picked");
  assert.match(doc.querySelector(".slice-page-fits-words")?.textContent ?? "", /High Flow/, "the fits line follows the nozzle");
});

test("Printer fits: the row shows only where the page can save a test piece, says typical sizes until measured, and its button opens the calibration", () => {
  const without = panelIn(async () => ({}));
  assert.equal((without.doc.querySelector(".slice-page-fits") as unknown as HTMLElement).hidden, true);
  const withIt = panelIn(async () => ({}), objects, { testPiece: async () => ({ saved: true, name: "x" }) });
  const row = withIt.doc.querySelector(".slice-page-fits") as unknown as HTMLElement;
  assert.equal(row.hidden, false);
  assert.match(row.textContent!, /typical sizes for the Standard nozzle \(not measured yet\)/);
  (withIt.doc.querySelector("#slice-page-fits-open") as unknown as HTMLButtonElement).click();
  assert.ok(withIt.doc.querySelector("dialog[open], dialog"), "the calibration dialog exists once asked");
});

// SL #761 follow-up: the page says what a failed Design item or a hidden body leaves off the plate, in Slice's own words.
test("leftOutWords names the failed items and the hidden bodies, and says nothing when nothing is left out", () => {
  assert.equal(leftOutWords({ failed: [], hidden: [] }), "");
  assert.equal(leftOutWords({ failed: ["Extrude 2"], hidden: [] }), "Extrude 2 failed in Design, so the print is without what it makes. Fix it in the Design timeline (red) to include it.");
  assert.equal(leftOutWords({ failed: ["Extrude 2", "Combine 1"], hidden: [] }), "Extrude 2 and Combine 1 failed in Design, so the print is without what they make. Fix them in the Design timeline (red) to include them.");
  assert.equal(leftOutWords({ failed: ["A", "B", "C", "D"], hidden: [] }).slice(0, 25), "A, B and 2 more failed in");
  assert.equal(leftOutWords({ failed: [], hidden: ["Body 2"] }), "Body 2 is hidden in Design, so it is not on the plate.");
  assert.equal(leftOutWords({ failed: [], hidden: ["Body 1", "Body 3"] }), "Body 1 and Body 3 are hidden in Design, so they are not on the plate.");
  assert.equal(leftOutWords({ failed: ["Extrude 2"], hidden: ["Body 1"] }).endsWith("Body 1 is hidden in Design, so it is not on the plate."), true);
});
