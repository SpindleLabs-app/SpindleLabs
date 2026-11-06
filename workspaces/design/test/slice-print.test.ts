// Slice for printing (slice-print.ts): the files handed to the engine, the
// words a slice is described in (worked by hand), the dialog in a real DOM
// (happy-dom) with a stand-in slicer, and real slices on the shipped kernel build (a 20 mm cube; supports under a plate on a column;
// the cube's P1S print file, unpacked by the test's own reader).
// The Chromium checks are apps/fission/e2e/slice-print.mjs and print-preview.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playback, type SlicedPrint, type SliceProgress } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { bodyIdOf, insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { createHash } from "node:crypto";
import { fileNameFor } from "@fission/ui";
import { PRESET_PICKED_KEY, writePresets, type PrintPreset } from "@fission/print";
import { printFileOf, sliceBodies, slicePrint } from "../src/slice-print.ts";
import { gcodeName, progressWords, gcodeOfPackage, printMovesOf, refusalWords, SliceDropped, printFileName, printLead, refusalOf, levelNote, levelNoteOf, stopSlices, fileCrawl, FILE_CRAWL_MIN_MS, printWords, stackStl, stlLowestZ, timeWords, unprintedWords, type PrintFacts } from "@fission/print";
import { FILE_DEFAULTS, NOZZLE_KEY, rememberedNozzle, rememberedWarmUp, WARM_UP_KEY, rememberedBetterGrip, GRIP_KEY, PRINT_DEFAULTS, type FileChoices, type PrintChoices } from "@fission/print";

const print = (over: Partial<SlicedPrint> = {}): SlicedPrint => ({ gcode: "G1 X1\n", layers: 100, filamentMm: 1730, filamentG: 5.16, retractions: 0, unprintedVolume: 0, printTimeS: 257, preview: [], ...over });

test("the bodies' files go to the engine back to back, each whole", () => {
  // [1, 2] then [3] then nothing then [4, 5]: 1, 2, 3, 4, 5 in that order.
  assert.deepEqual([...stackStl([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([]), new Uint8Array([4, 5])])], [1, 2, 3, 4, 5]);
  assert.equal(stackStl([]).length, 0);
});

test("a slice in words, worked by hand", () => {
  // 1730 mm is 1.73 m; 5.16 g is under 10, so to one decimal: 5.2 g; 257 s is 4.28 min, so 4 min.
  assert.equal(printWords(print()), "100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  // 12.6 g is 10 or more, so a whole number: 13 g. One layer is "layer". 3900 s is 65 min: 1 h 5 min.
  assert.equal(printWords(print({ layers: 1, filamentG: 12.6, filamentMm: 4220, printTimeS: 3900 })), "1 layer, 13 g of PLA (4.22 m of filament), about 1 h 5 min of printing (plus heating and levelling).");
  // An engine fault (not a number) shows no time rather than a wrong one.
  assert.equal(printWords(print({ printTimeS: Number.NaN })), "100 layers, 5.2 g of PLA (1.73 m of filament).");
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "off", warmUp: true, betterGrip: false }), "spindlelabs-0.16mm-3w-20pc.gcode");
  // Supports on gets its own name, so the same part with and without never overwrite each other.
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "normal", warmUp: true, betterGrip: false }), "spindlelabs-0.16mm-3w-20pc-supports.gcode");
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "tree", warmUp: true, betterGrip: false }), "spindlelabs-0.16mm-3w-20pc-tree-supports.gcode");
  // The P1S's defaults, the engine's own: 0.2 mm layers, 2 walls, 15 %, no supports.
  assert.deepEqual(PRINT_DEFAULTS, { layerHeight: 0.2, walls: 2, infill: 15, supports: "off", warmUp: true, betterGrip: false });
});

test("print time in words rounds to the nearest minute, worked by hand", () => {
  // Half a minute is where rounding turns over: 29 s is 0.48 min (0), 30 s is 0.5 min (1).
  assert.equal(timeWords(0), "under a minute");
  assert.equal(timeWords(29), "under a minute");
  assert.equal(timeWords(30), "1 min");
  // 3569 s is 59.48 min (59); 3570 s is 59.5 min, which rounds to 60: a whole hour, no "0 min".
  assert.equal(timeWords(3569), "59 min");
  assert.equal(timeWords(3570), "1 h");
  // 7 h 23 min = 26580 s; 2 s either side still rounds to it.
  assert.equal(timeWords(26580 + 2), "7 h 23 min");
  assert.equal(timeWords(26580 - 2), "7 h 23 min");
  // Faults give no figure: not a number, below 0, endless.
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) assert.equal(timeWords(bad), null, String(bad));
});

test("plastic left out is warned about from half a hundredth of a mm³ (it rounds to 0.01): 0.9× stays quiet, 1.1× warns", () => {
  assert.equal(unprintedWords(print()), null);
  assert.equal(unprintedWords(print({ unprintedVolume: 0.005 * 0.9 })), null);
  assert.equal(unprintedWords(print({ unprintedVolume: 0.005 * 1.1 })), "Some walls are thinner than about 0.65 mm, which can't be printed yet, so about 0.01 mm³ of the part won't print: make them at least 0.65 mm thick.");
  assert.match(unprintedWords(print({ unprintedVolume: 12.345 }))!, /about 12\.35 mm³/);
  // Slicer hunt 2026-11-04 (SH2): walls from 0.43 to 0.64 mm are left out too, though wider than one 0.4 mm line, so the
  // words name the thickness that prints (0.65 mm), never "thinner than one printed line".
  assert.doesNotMatch(unprintedWords(print({ unprintedVolume: 90 }))!, /one printed line/);
  assert.match(unprintedWords(print({ unprintedVolume: 90 }))!, /at least 0\.65 mm thick\.$/);
  // Not a number (an engine fault) gives no figure to warn with.
  assert.equal(unprintedWords(print({ unprintedVolume: Number.NaN })), null);
});

const { Window } = await import("happy-dom");

/** The name a stand-in saves under: the one the workspace offers. */
const nameFor = (c: PrintChoices, f: FileChoices) => (f.format === "p1s" ? printFileName(c, f.plate, f.nozzle) : gcodeName(c));

/** A clock a second further on at each read: every press is a second after the last, so none is a double press. */
function slowHand() {
  let t = 0;
  return () => (t += 1000);
}

function dialog(slice: (c: PrintChoices, f: FileChoices, alive: () => boolean) => Promise<{ print: PrintFacts; saved: boolean; name?: string }>, preview: (c: PrintChoices, f: FileChoices, alive: () => boolean, changed: () => boolean) => Promise<void> = async () => {}, now: () => number = slowHand()) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const keys: string[] = [];
  doc.addEventListener("keydown", (e) => keys.push((e as KeyboardEvent).key));
  const asked: PrintChoices[] = [];
  const files: FileChoices[] = [];
  const d = slicePrint(slot, {
    slice: async (c, f, alive) => {
      asked.push(c);
      files.push(f);
      const r = await slice(c, f, alive);
      return { ...r, name: r.name ?? nameFor(c, f) };
    },
    preview: (c, f, alive, changed) => (asked.push(c), files.push(f), preview(c, f, alive, changed)),
    now,
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { d, doc, keys, asked, files, $, settle, window };
}

test("the dialog slices with the choices picked, then says what the slice came to", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  assert.equal(t.d.open, false);
  t.d.ask();
  assert.equal(t.d.open, true);
  // The defaults are what it opens on.
  assert.equal(t.$<HTMLSelectElement>("slice-print-quality").value, "0.2");
  assert.equal(t.$<HTMLSelectElement>("slice-print-walls").value, "2");
  assert.equal(t.$<HTMLSelectElement>("slice-print-infill").value, "15");
  assert.equal(t.$<HTMLSelectElement>("slice-print-supports").value, "off");
  assert.deepEqual([...t.$<HTMLSelectElement>("slice-print-supports").options].map((o) => o.textContent), ["Off", "Normal (columns)", "Tree (less plastic)"]);
  t.$<HTMLSelectElement>("slice-print-quality").value = "0.16";
  t.$<HTMLSelectElement>("slice-print-walls").value = "3";
  t.$<HTMLSelectElement>("slice-print-infill").value = "40";
  // Plain G-code here; the P1S's file (the default) has its own test below.
  t.$<HTMLSelectElement>("slice-print-format").value = "gcode";
  t.$<HTMLSelectElement>("slice-print-format").dispatchEvent(new t.window.Event("change") as unknown as Event);
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked, [{ layerHeight: 0.16, walls: 3, infill: 40, supports: "off", warmUp: true, betterGrip: false }]);
  assert.equal(t.$("slice-print-status").textContent, "Saved spindlelabs-0.16mm-3w-40pc.gcode: 100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), false);
  // Normal supports picked: the next slice asks for them, and the file's name says so; then trees, likewise.
  t.$<HTMLSelectElement>("slice-print-supports").value = "normal";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked[1], { layerHeight: 0.16, walls: 3, infill: 40, supports: "normal", warmUp: true, betterGrip: false });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.16mm-3w-40pc-supports\.gcode: /);
  t.$<HTMLSelectElement>("slice-print-supports").value = "tree";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked[2], { layerHeight: 0.16, walls: 3, infill: 40, supports: "tree", warmUp: true, betterGrip: false });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.16mm-3w-40pc-tree-supports\.gcode: /);
  t.$("slice-print-close").click();
  assert.equal(t.d.open, false);
  await t.window.happyDOM.close();
});

test("a double press on Slice and download, or on Preview, is one slice; a changed choice or a pause lets the next through", async () => {
  // The clumsy-user hunt (11-04): a double-click saved two files. The clock stands still unless the test moves it.
  const clock = { t: 0 };
  const t = dialog(async () => ({ print: print(), saved: true }), async () => {}, () => clock.t);
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle(); // the first slice done, at 0 ms
  clock.t = 120;
  t.$("slice-print-go").click(); // 120 ms after: the double-click's second click
  await t.settle();
  assert.equal(t.asked.length, 1, "one slice for a double-click");
  t.$<HTMLSelectElement>("slice-print-supports").value = "normal";
  t.$<HTMLSelectElement>("slice-print-supports").dispatchEvent(new t.window.Event("change", { bubbles: true }) as unknown as Event);
  clock.t = 200;
  t.$("slice-print-go").click(); // 80 ms after the last press, but a choice changed: a new file is asked for
  await t.settle();
  assert.equal(t.asked.length, 2);
  assert.equal(t.asked[1].supports, "normal");
  clock.t = 200 + 0.9 * 500;
  t.$("slice-print-go").click(); // 0.9 × 500 ms after the last press (and after the slice's end): still the same burst
  await t.settle();
  assert.equal(t.asked.length, 2, "0.9 × REPEAT_MS: a repeat");
  clock.t += 1.1 * 500;
  t.$("slice-print-go").click(); // 1.1 × 500 ms after: meant
  await t.settle();
  assert.equal(t.asked.length, 3, "1.1 × REPEAT_MS: a new slice");
  // Preview has its own guard: its first press is meant, its double press isn't.
  clock.t += 10;
  t.$("slice-print-preview").click();
  clock.t += 10;
  t.$("slice-print-preview").click();
  await t.settle();
  assert.equal(t.asked.length, 4, "one preview for a double-click");
  await t.window.happyDOM.close();
});

test("the dialog saves the P1S's print file by default, for the plate picked; the plate goes with that file only", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  const format = t.$<HTMLSelectElement>("slice-print-format");
  const plate = t.$<HTMLSelectElement>("slice-print-plate");
  // The owner's printer and plate: the P1S file on the textured PEI plate.
  assert.deepEqual(FILE_DEFAULTS, { format: "p1s", plate: "textured", nozzle: "standard" });
  assert.equal(format.value, "p1s");
  assert.equal(plate.value, "textured");
  assert.equal(plate.disabled, false);
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.files, [{ format: "p1s", plate: "textured", nozzle: "standard" }]);
  // The name by hand: the plain file's spindlelabs-0.2mm-2w-15pc, then the plate, then the P1S's ending.
  assert.equal(t.$("slice-print-status").textContent, "Saved spindlelabs-0.2mm-2w-15pc-textured.gcode.3mf: 100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  plate.value = "smooth";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.files[1], { format: "p1s", plate: "smooth", nozzle: "standard" });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-smooth\.gcode\.3mf: /);
  // The four plates Bambu sells for the P1S that PLA prints on (no Engineering Plate: Bambu's PLA profile doesn't list it).
  assert.deepEqual([...plate.options].map((o) => [o.value, o.textContent]), [["textured", "Textured PEI plate"], ["smooth", "Smooth PEI or High Temp plate"], ["cool_plate", "Cool Plate"], ["supertack_plate", "Cool Plate SuperTack"]]);
  for (const [value, part, n] of [["cool_plate", "cool", 2], ["supertack_plate", "supertack", 3]] as const) {
    plate.value = value;
    t.$("slice-print-go").click();
    await t.settle();
    assert.deepEqual(t.files[n], { format: "p1s", plate: value, nozzle: "standard" });
    assert.match(t.$("slice-print-status").textContent!, new RegExp(`^Saved spindlelabs-0\\.2mm-2w-15pc-${part}\\.gcode\\.3mf: `));
  }
  // Plain G-code: the plate box greys out, and the file is .gcode.
  format.value = "gcode";
  format.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(plate.disabled, true);
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.files[4].format, "gcode");
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc\.gcode: /);
  // The plain option says it isn't for the P1S (its start primes a line across the corner the P1S keeps clear).
  assert.match(format.querySelector('option[value="gcode"]')!.textContent!, /not for the P1S/);
  format.value = "p1s";
  format.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(plate.disabled, false);
  // Names by hand, with supports and the other plate.
  assert.equal(printFileName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "normal", warmUp: true, betterGrip: false }, "smooth"), "spindlelabs-0.16mm-3w-20pc-supports-smooth.gcode.3mf");
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "high-flow"), "spindlelabs-0.2mm-2w-15pc-textured-high-flow.gcode.3mf");
  await t.window.happyDOM.close();
});

test("the nozzle: Standard by default, High Flow when picked, remembered for next time, P1S file only", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.window.localStorage.clear();
  t.d.ask();
  const nozzle = t.$<HTMLSelectElement>("slice-print-nozzle");
  const format = t.$<HTMLSelectElement>("slice-print-format");
  // Bambu Studio refuses to send a file made for the other nozzle (Ben's 10-31 send: his P1S has High Flow, the file said Standard).
  assert.equal(nozzle.value, "standard");
  assert.deepEqual([...nozzle.options].map((o) => o.textContent), ["0.4 mm Standard", "0.4 mm High Flow"]);
  nozzle.value = "high-flow";
  nozzle.dispatchEvent(new t.window.Event("change") as unknown as Event);
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.files[0], { format: "p1s", plate: "textured", nozzle: "high-flow" });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-textured-high-flow\.gcode\.3mf: /);
  // Kept for next time: a printer's nozzle rarely changes.
  assert.equal(t.window.localStorage.getItem(NOZZLE_KEY), "high-flow");
  // Plain G-code: the nozzle box greys out, as the plate's does.
  format.value = "gcode";
  format.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(nozzle.disabled, true);
  await t.window.happyDOM.close();
  // What is read back: ours, or the default for anything else or blocked storage.
  const kept = (v: string | null) => ({ getItem: () => v });
  assert.equal(rememberedNozzle(kept("high-flow")), "high-flow");
  assert.equal(rememberedNozzle(kept("standard")), "standard");
  for (const v of [null, "", "High Flow", "hardened"]) assert.equal(rememberedNozzle(kept(v)), "standard", String(v));
  assert.equal(rememberedNozzle(null), "standard");
  assert.equal(rememberedNozzle({ getItem: () => { throw new Error("blocked"); } }), "standard");
});

test("the dialog says a refusal in the engine's words, warns about plastic left out, and keeps its keys", async () => {
  let answer: () => Promise<{ print: PrintFacts; saved: boolean }> = async () => {
    throw new Error("the part is bigger than the printer's bed");
  };
  const t = dialog(() => answer());
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.$("slice-print-status").textContent, "The part is bigger than the printer's bed", "a message kept, but starting with a capital");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  answer = async () => ({ print: print({ unprintedVolume: 2 }), saved: false });
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.$("slice-print-status").textContent, "Sliced, but not saved: 100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling). Some walls are thinner than about 0.65 mm, which can't be printed yet, so about 2.00 mm³ of the part won't print: make them at least 0.65 mm thick.");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  // A key pressed in the dialog never reaches the app's shortcuts.
  t.$("slice-print-go").dispatchEvent(new t.window.KeyboardEvent("keydown", { key: "e", bubbles: true }) as unknown as Event);
  assert.deepEqual(t.keys, []);
  await t.window.happyDOM.close();
});

test("a second click while slicing doesn't start a second slice", async () => {
  let finish!: () => void;
  const t = dialog(() => new Promise((r) => (finish = () => r({ print: print(), saved: true }))));
  t.d.ask();
  t.$("slice-print-go").click();
  t.$("slice-print-go").click();
  assert.equal(t.asked.length, 1);
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, true);
  assert.equal(t.$("slice-print-status").textContent, "Slicing…");
  finish();
  await t.settle();
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, false);
  await t.window.happyDOM.close();
});

test("Preview slices with the choices picked and closes the dialog; a refusal keeps it open and says why", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  t.$<HTMLSelectElement>("slice-print-infill").value = "25";
  t.$("slice-print-preview").click();
  await t.settle();
  assert.deepEqual(t.asked, [{ layerHeight: 0.2, walls: 2, infill: 25, supports: "off", warmUp: true, betterGrip: false }]);
  assert.equal(t.d.open, false);
  const bad = dialog(async () => ({ print: print(), saved: true }), async () => {
    throw new Error("There is no body to slice: make or show one first.");
  });
  bad.d.ask();
  bad.$("slice-print-preview").click();
  await bad.settle();
  assert.equal(bad.d.open, true);
  assert.equal(bad.$("slice-print-status").textContent, "There is no body to slice: make or show one first.");
  assert.equal(bad.$<HTMLButtonElement>("slice-print-preview").disabled, false);
  await t.window.happyDOM.close();
  await bad.window.happyDOM.close();
});

test("the warm-up loop: ticked by default, unticked when turned off, remembered for next time, in both files' names", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.window.localStorage.clear();
  t.d.ask();
  const box = t.$<HTMLInputElement>("slice-print-warm-up");
  // Ben 11-01: the first 10–30 s of a first layer did not stick; the loop takes that plastic instead of the part.
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, true);
  assert.equal(box.closest("label")!.textContent, "Warm-up loop");
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.asked[0].warmUp, true);
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-textured\.gcode\.3mf: /);
  // Turned off: the slice is asked without it, the name says so, the last result is cleared, and it is kept.
  box.checked = false;
  box.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(t.$("slice-print-status").textContent, "");
  assert.equal(t.window.localStorage.getItem(WARM_UP_KEY), "off");
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.asked[1].warmUp, false);
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-no-warm-up-textured\.gcode\.3mf: /);
  // Preview is given it too.
  t.$("slice-print-preview").click();
  await t.settle();
  assert.equal(t.asked[2].warmUp, false);
  await t.window.happyDOM.close();
  // What is read back: off only for our "off"; on for anything else, nothing kept, or blocked storage.
  const kept = (v: string | null) => ({ getItem: () => v });
  assert.equal(rememberedWarmUp(kept("off")), false);
  for (const v of [null, "", "on", "OFF", "false"]) assert.equal(rememberedWarmUp(kept(v)), true, String(v));
  assert.equal(rememberedWarmUp(null), true);
  assert.equal(rememberedWarmUp({ getItem: () => { throw new Error("blocked"); } }), true);
  // Names: off adds "-no-warm-up" before the plate (the default, on, keeps the names files had).
  const off = { ...PRINT_DEFAULTS, warmUp: false };
  assert.equal(gcodeName(off), "spindlelabs-0.2mm-2w-15pc-no-warm-up.gcode");
  assert.equal(printFileName(off, "smooth", "high-flow"), "spindlelabs-0.2mm-2w-15pc-no-warm-up-smooth-high-flow.gcode.3mf");
});

test("Better grip: unticked by default, ticked when turned on, remembered for next time, in both files' names", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.window.localStorage.clear();
  t.d.ask();
  const box = t.$<HTMLInputElement>("slice-print-grip");
  // Ben 11-01: first layers lifting; the brim and a slower, hotter first layer hold them, but cost a brim to peel: off by default.
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, false);
  assert.equal(box.closest("label")!.textContent, "Better grip");
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.asked[0].betterGrip, false);
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-textured\.gcode\.3mf: /);
  // Turned on: asked with it, the name says so, the last result is cleared, and it is kept.
  box.checked = true;
  box.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(t.$("slice-print-status").textContent, "");
  assert.equal(t.window.localStorage.getItem(GRIP_KEY), "on");
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.asked[1].betterGrip, true);
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-grip-textured\.gcode\.3mf: /);
  t.$("slice-print-preview").click();
  await t.settle();
  assert.equal(t.asked[2].betterGrip, true);
  // Off again: kept as off.
  box.checked = false;
  box.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(t.window.localStorage.getItem(GRIP_KEY), "off");
  await t.window.happyDOM.close();
  // What is read back: on only for our "on"; off for anything else, nothing kept, or blocked storage.
  const kept = (v: string | null) => ({ getItem: () => v });
  assert.equal(rememberedBetterGrip(kept("on")), true);
  for (const v of [null, "", "off", "ON", "true"]) assert.equal(rememberedBetterGrip(kept(v)), false, String(v));
  assert.equal(rememberedBetterGrip(null), false);
  assert.equal(rememberedBetterGrip({ getItem: () => { throw new Error("blocked"); } }), false);
  // Names: on adds "-grip" after the warm-up loop's word, before the plate.
  const on = { ...PRINT_DEFAULTS, betterGrip: true };
  assert.equal(gcodeName(on), "spindlelabs-0.2mm-2w-15pc-grip.gcode");
  assert.equal(gcodeName({ ...on, warmUp: false }), "spindlelabs-0.2mm-2w-15pc-no-warm-up-grip.gcode");
  assert.equal(printFileName(on, "smooth", "high-flow"), "spindlelabs-0.2mm-2w-15pc-grip-smooth-high-flow.gcode.3mf");
});

test("a dialog opened where Better grip was turned on opens ticked", async () => {
  const window = new Window();
  window.localStorage.setItem(GRIP_KEY, "on");
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const asked: PrintChoices[] = [];
  const d = slicePrint(slot, { slice: async (c) => (asked.push(c), { print: print(), saved: true, name: "x" }), preview: async () => {} });
  d.ask();
  assert.equal((doc.getElementById("slice-print-grip") as HTMLInputElement).checked, true);
  (doc.getElementById("slice-print-go") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked[0].betterGrip, true);
  await window.happyDOM.close();
});

test("Better grip on the shipped build: the 20 mm cube's ten brim loops after the warm-up loop, worked by hand", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const choices = { ...PRINT_DEFAULTS, betterGrip: true };
  const on = await sliceBodies(kernel, doc, bodyFeatures(doc), choices);
  const roles = on.preview[0].paths.map((x) => x.role);
  // Two warm-up loops, then the brim: ⌊(5 − 0.5) / 0.457⌋ + 1 = 10 loops (0.457 the beads' spacing, 0.5 − 0.2 × (1 − π/4)).
  assert.deepEqual(roles.slice(0, 12), ["skirt", "skirt", ...Array(10).fill("brim")]);
  assert.notEqual(roles[12], "brim");
  assert.ok(on.preview.slice(1).every((l) => l.paths.every((x) => x.role !== "brim")));
  // The cube is centred, 118–138 mm, and its first layer is pulled in 0.15 mm by the bulge fix (the app's elephant-foot
  // 0.15), 118.15–137.85; the brim and the warm-up loop go round the first layer as printed (kernel 0.33.27, slicer hunt
  // 11-04 F1: before, round the sliced outline, the brim stood 0.25 mm off the part instead of its 0.1). Brim loop k's
  // centre is 0.1 mm + 0.25 + k × 0.457 out, the outer one (k = 9) first: its least x 118.15 − 4.4637 = 113.6863; the
  // warm-up loop goes round the brim's edge (4.7137 out, + 1 µm), 3 mm + 0.25 further: 118.15 − 7.9647 = 110.1853 for
  // its inner loop.
  const least = (k: number) => Math.min(...on.preview[0].paths[k].points.filter((_, i) => i % 2 === 0));
  assert.ok(Math.abs(least(2) - 113.6862833) < 1e-5, `${least(2)}`);
  assert.ok(Math.abs(least(1) - 110.1852833) < 1e-5, `${least(1)}`);
  assert.match(on.gcode, /^;TYPE:Brim$/m);
  // The first layer is 5 °C hotter (225 for PLA's 220), back to 220 on the second, and no faster than 30 mm/s (F1800).
  assert.match(on.gcode, /^M109 S225$/m);
  assert.match(on.gcode, /^M104 S220$/m);
  // Off: no brim; round the 19.7 mm first layer, Σ (78.8 + 2π·d_k) = 939.23 mm of a 0.0914159 mm² bead less (35.697 mm
  // of 1.75 mm filament, 2.405282 mm²), and the warm-up loop's two loops each 4.7147 mm nearer the part, 2 × 2π × 4.7147
  // = 59.25 mm shorter (2.252 mm): 37.948 mm less filament, and up to 12 × 2π × 0.001 mm more where the round corners'
  // polygons lie outside their circles (0.003 mm).
  const off = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  assert.ok(off.preview[0].paths.every((x) => x.role !== "brim"));
  assert.doesNotMatch(off.gcode, /;TYPE:Brim/);
  assert.doesNotMatch(off.gcode, /^M109 S225$/m);
  const less = on.filamentMm - off.filamentMm;
  assert.ok(less > 37.947 && less < 37.952, `${less}`);
  // The P1S's file too.
  const file = await printFileOf(kernel, doc, bodyFeatures(doc), choices, "textured");
  const g = gcodeOfPackage(file.package)!;
  assert.match(g, /^;TYPE:Brim$/m);
  assert.match(g, /^; nozzle_temperature_initial_layer = 225$/m);
  assert.match(g, /^; brim_width = 5$/m);
});

test("a dialog opened where the warm-up loop was turned off opens unticked", async () => {
  // happy-dom keeps one storage per window: the setting is put in before the dialog is made.
  const window = new Window();
  window.localStorage.setItem(WARM_UP_KEY, "off");
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const asked: PrintChoices[] = [];
  const d = slicePrint(slot, { slice: async (c) => (asked.push(c), { print: print(), saved: true, name: "x" }), preview: async () => {} });
  d.ask();
  const box = doc.getElementById("slice-print-warm-up") as HTMLInputElement;
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(window.localStorage.getItem(WARM_UP_KEY), "on");
  (doc.getElementById("slice-print-go") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked[0].warmUp, true);
  await window.happyDOM.close();
});

test("the warm-up loop on the shipped build: the 20 mm cube's first layer starts with its two loops, 3.25 and 3.71 mm out, worked by hand", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const on = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  const roles = on.preview[0].paths.map((x) => x.role);
  assert.deepEqual(roles.slice(0, 2), ["skirt", "skirt"]);
  assert.notEqual(roles[2], "skirt");
  assert.ok(on.preview.slice(1).every((l) => l.paths.every((x) => x.role !== "skirt")));
  // The cube is centred, 118–138 mm, its first layer pulled in 0.15 mm by the bulge fix (118.15–137.85), and the loops
  // go round the first layer as printed (kernel 0.33.27, slicer hunt 11-04 F1). Loop k's centre is 3 mm + 0.25 (half
  // the 0.5 mm line) + k × 0.457 (the beads' spacing, 0.5 − 0.2 × (1 − π/4)) out: the outer one first, its least x
  // 118.15 − 3.707 = 114.443, then 118.15 − 3.25 = 114.9.
  const least = (k: number) => Math.min(...on.preview[0].paths[k].points.filter((_, i) => i % 2 === 0));
  assert.ok(Math.abs(least(0) - 114.4429204) < 1e-5, `${least(0)}`);
  assert.ok(Math.abs(least(1) - 114.9) < 1e-5, `${least(1)}`);
  assert.match(on.gcode, /^;TYPE:Skirt$/m);
  // Off: none, and round the 19.7 mm first layer 78.8 + 2π·3.25 + 78.8 + 2π·3.707 = 201.31 mm less of a 0.0914159 mm²
  // bead, 201.31 × 0.0914159 / 2.405282 = 7.651 mm less filament.
  const off = await sliceBodies(kernel, doc, bodyFeatures(doc), { ...PRINT_DEFAULTS, warmUp: false });
  assert.ok(off.preview[0].paths.every((x) => x.role !== "skirt"));
  assert.doesNotMatch(off.gcode, /;TYPE:Skirt/);
  const less = on.filamentMm - off.filamentMm;
  assert.ok(less > 7.650 && less < 7.653, `${less}`);
  // The P1S's file too.
  const file = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  assert.match(gcodeOfPackage(file.package)!, /^;TYPE:Skirt$/m);
});

test("a 20 mm cube, sliced on the shipped build: 100 layers of 0.2 mm, G-code a printer reads", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const p = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  // 20 mm / 0.2 mm = 100 layers, the first 0.2 mm too; layer k's top is 0.2 × (k + 1).
  assert.equal(p.layers, 100);
  assert.equal(p.preview.length, 100);
  assert.ok(Math.abs(p.preview[99].zTop - 20) < 1e-9, `top ${p.preview[99].zTop}`);
  assert.match(p.gcode, /^G1 /m);
  assert.equal(p.unprintedVolume, 0);
  // Each layer now takes at least the engine's 8 s minimum layer time (Generic PLA), so the moves take at least
  // 100 × 8 = 800 s; the engine's own tests time it at about 877 s, 15 min (861 s, 14 min, until the nozzle
  // lifted over finished tops to stop scratching them, kernel 0.33.21). Here, that it reaches the app.
  assert.ok(p.printTimeS >= 800, `time ${p.printTimeS}`);
  assert.equal(timeWords(p.printTimeS), "15 min", `time ${p.printTimeS}`);
  // Weight from length: 1.75 mm filament, π × 0.875² mm² × length × 1.24 g/cm³ (self-consistency, not a hand-worked figure).
  assert.ok(Math.abs(p.filamentG - (Math.PI * 0.875 ** 2 * p.filamentMm * 1.24) / 1000) < 1e-6 * p.filamentG);
  // Two walls: layer 50 starts with one outer and one inner wall.
  const roles = p.preview[50].paths.map((x) => x.role);
  assert.equal(roles.filter((r) => r === "outer-wall").length, 1);
  assert.equal(roles.filter((r) => r === "inner-wall").length, 1);
});

test("two bodies print together, each its own mesh; none is refused before slicing", async () => {
  const kernel = nodeKernel();
  const doc = insertPreset(partDocument("box", 20, 20, 20), "box", 10, 10, 30).doc;
  const two = bodyFeatures(doc);
  assert.equal(two.length, 2);
  // The taller box sets the height: 30 mm / 0.2 mm = 150 layers.
  const p = await sliceBodies(kernel, doc, two, PRINT_DEFAULTS);
  assert.equal(p.layers, 150);
  // Planted: the second body's file left out gives the first box's 100 layers, so the count above can fail.
  const one = await sliceBodies(kernel, doc, two.slice(0, 1), PRINT_DEFAULTS);
  assert.equal(one.layers, 100);
  await assert.rejects(sliceBodies(kernel, doc, [], PRINT_DEFAULTS), /no body to slice/);
});

test("supports on the shipped build: a plate on a column gets them, normal or tree, a cube needs none, and off means none", async () => {
  const kernel = nodeKernel();
  // A 30 × 30 × 2 mm plate moved up onto a 10 × 10 × 10 mm column (both centred), made as the app makes them.
  const plate = insertPreset(partDocument("box", 10, 10, 10), "box", 30, 30, 2);
  const doc = insertMove(plate.doc, [bodyIdOf(plate.id)], { ...NO_MOVE, z: 10 }).doc;
  const bodies = bodyFeatures(doc);
  const supportLayers = (p: SlicedPrint) => p.preview.filter((l) => l.paths.some((x) => x.role === "support")).length;
  const on = await sliceBodies(kernel, doc, bodies, { ...PRINT_DEFAULTS, supports: "normal" });
  const tree = await sliceBodies(kernel, doc, bodies, { ...PRINT_DEFAULTS, supports: "tree" });
  const off = await sliceBodies(kernel, doc, bodies, PRINT_DEFAULTS);
  // 12 mm / 0.2 mm = 60 layers either way.
  assert.equal(on.layers, 60);
  assert.equal(off.layers, 60);
  // By hand: the plate's first layer is layer 50 (10.0 to 10.2 mm), its rim past the column hanging in the air.
  // One layer is left empty under it (the gap that lets the support break away), so supports fill layers 0 to 48 from the bed: 49 layers.
  assert.equal(supportLayers(on), 49);
  assert.equal(supportLayers(off), 0);
  // The G-code marks them as the kind "Support", which the preview's switches read.
  assert.match(on.gcode, /^;TYPE:Support$/m);
  assert.doesNotMatch(off.gcode, /;TYPE:Support/);
  // Supports cost plastic and time.
  assert.ok(on.filamentMm > off.filamentMm && on.printTimeS > off.printTimeS, `${on.filamentMm} vs ${off.filamentMm}`);
  // Trees: the same 60 layers and the same roof (support up to layer 48, the gap layer 49 empty), but branches, not columns:
  // a different slice, and less plastic than columns under the whole rim.
  assert.equal(tree.layers, 60);
  const topSupport = (p: SlicedPrint) => Math.max(...p.preview.flatMap((l, i) => (l.paths.some((x) => x.role === "support") ? [i] : [])));
  assert.equal(topSupport(tree), 48);
  assert.equal(topSupport(on), 48);
  assert.match(tree.gcode, /^;TYPE:Support$/m);
  assert.notEqual(tree.gcode, on.gcode);
  assert.ok(tree.filamentMm > off.filamentMm && tree.filamentMm < on.filamentMm, `${tree.filamentMm} between ${off.filamentMm} and ${on.filamentMm}`);
  // A 20 mm cube has nothing hanging out: supports on still adds none.
  const cube = partDocument("box", 20, 20, 20);
  assert.equal(supportLayers(await sliceBodies(kernel, cube, bodyFeatures(cube), { ...PRINT_DEFAULTS, supports: "normal" })), 0);
  assert.equal(supportLayers(await sliceBodies(kernel, cube, bodyFeatures(cube), { ...PRINT_DEFAULTS, supports: "tree" })), 0);
});

/** The files of a ZIP of stored (uncompressed) files, read from its local headers: name → bytes. Throws on anything else. */
function storedZip(b: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    assert.equal(v.getUint16(at + 8, true), 0, "stored, not compressed");
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const extra = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(b.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    out.set(name, b.subarray(start, start + size));
    at = start + size;
  }
  assert.equal(v.getUint32(at, true), 0x02014b50, "the central directory follows the files");
  return out;
}

/** A file's layer moves, feeds left out: from the first layer's first path to the end routine. */
function layerMoves(gcode: string): string[] {
  const start = gcode.indexOf(";LAYER_CHANGE");
  const first = gcode.indexOf(";TYPE:", start);
  const end = gcode.search(/;===== end|; end/);
  return gcode
    .slice(first, end)
    .split("\n")
    .filter((l) => l.startsWith("G0 ") || l.startsWith("G1 "))
    .map((l) => l.split(/\s+/).filter((w) => !w.startsWith("F")).join(" "));
}

test("the cube's P1S print file on the shipped build: a package the printer checks, for the plate picked, the same layers as the plain slice", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const f = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  assert.ok(f.package instanceof Uint8Array, "bytes, not a list of numbers");
  const files = storedZip(f.package);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "Metadata/plate_1.gcode", "Metadata/plate_1.gcode.md5", "Metadata/plate_1.json", "Metadata/slice_info.config"]) assert.ok(files.has(name), name);
  const gcode = new TextDecoder().decode(files.get("Metadata/plate_1.gcode"));
  // The printer checks the G-code against its MD5 (worked here by node's own MD5, apart from the engine's), upper-case hex.
  assert.equal(new TextDecoder().decode(files.get("Metadata/plate_1.gcode.md5")), createHash("md5").update(files.get("Metadata/plate_1.gcode")!).digest("hex").toUpperCase());
  // 20 mm / 0.2 mm = 100 layers, as the file marks them and the answer says.
  assert.equal((gcode.match(/^;LAYER_CHANGE$/gm) ?? []).length, 100);
  assert.equal(f.layers, 100);
  assert.equal(f.unprintedVolume, 0);
  assert.match(gcode, /^; total layer number: 100$/m);
  // The textured plate: its key, and its first layer 0.04 mm lower.
  assert.match(new TextDecoder().decode(files.get("Metadata/plate_1.json")), /"bed_type":"textured_plate"/);
  assert.match(gcode, /^G29\.1 Z-0\.04/m);
  // The printer model the P1S checks for (C12).
  assert.match(new TextDecoder().decode(files.get("Metadata/slice_info.config")), /key="printer_model_id" value="C12"/);
  // The smooth plate's file has no trim and its own key.
  const smooth = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "smooth");
  const smoothFiles = storedZip(smooth.package);
  assert.match(new TextDecoder().decode(smoothFiles.get("Metadata/plate_1.json")), /"bed_type":"hot_plate"/);
  assert.doesNotMatch(new TextDecoder().decode(smoothFiles.get("Metadata/plate_1.gcode")), /G29\.1 Z-0\.04/);
  // Bambu's Generic PLA heats the bed to 55 °C on the textured and smooth plates, 35 °C on the Cool Plate and 45 °C on the
  // SuperTack (Ben's Bambu Studio file: cool_plate_temp 35, supertack_plate_temp 45), first layer and the rest alike;
  // the bed goes off (S0) at the end. Each smooth-faced plate has no trim and its own key.
  const beds = (g: string) => (g.match(/^M140 S\d+/gm) ?? []).concat(g.match(/^M190 S\d+/gm) ?? []);
  assert.deepEqual(beds(gcode), ["M140 S55", "M140 S0", "M190 S55"]);
  assert.deepEqual(beds(new TextDecoder().decode(smoothFiles.get("Metadata/plate_1.gcode"))), ["M140 S55", "M140 S0", "M190 S55"]);
  for (const [plate, key, name, bed] of [["cool_plate", "cool_plate", "Cool Plate", 35], ["supertack_plate", "supertack_plate", "Supertack Plate", 45]] as const) {
    const files = storedZip((await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, plate)).package);
    const g = new TextDecoder().decode(files.get("Metadata/plate_1.gcode"));
    assert.match(new TextDecoder().decode(files.get("Metadata/plate_1.json")), new RegExp(`"bed_type":"${key}"`));
    assert.deepEqual(beds(g), [`M140 S${bed}`, "M140 S0", `M190 S${bed}`], plate);
    assert.match(g, new RegExp(`^; curr_bed_type = ${name}$`, "m"));
    assert.doesNotMatch(g, /G29\.1 Z-0\.04/);
    // Only the plate's own lines change, not one move.
    assert.deepEqual(layerMoves(g), layerMoves(new TextDecoder().decode(smoothFiles.get("Metadata/plate_1.gcode"))), plate);
  }
  // Two code paths agreeing: the same layer moves as the plain slice of the same choices; 3 walls differ, so the comparison can fail.
  const plain = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  assert.deepEqual(layerMoves(gcode), layerMoves(plain.gcode));
  const three = await sliceBodies(kernel, doc, bodyFeatures(doc), { ...PRINT_DEFAULTS, walls: 3 });
  assert.notDeepEqual(layerMoves(gcode), layerMoves(three.gcode));
  // A plate the engine doesn't know is the app's bug, refused as a bad request.
  await assert.rejects(printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "glass" as never), (e: Error & { kind?: string }) => e.kind === "bad-request" && /bad plate/.test(e.message));
  await assert.rejects(printFileOf(kernel, doc, [], PRINT_DEFAULTS, "textured"), /no body to slice/);
  // The nozzle: named where Bambu Studio's send window reads it, and its G-code dialect named, so its time reads our speed limits in mm/s (Ben's 10-31 file showed 1h32m for this cube without it).
  const settings = (p: Uint8Array) => new TextDecoder().decode(storedZip(p).get("Metadata/project_settings.config"));
  assert.match(settings(f.package), /"nozzle_volume_type": \["Standard"\]/);
  assert.match(settings(f.package), /"gcode_flavor": "marlin"/);
  const hf = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured", "high-flow");
  assert.match(settings(hf.package), /"nozzle_volume_type": \["High Flow"\]/);
  assert.match(new TextDecoder().decode(storedZip(hf.package).get("Metadata/slice_info.config")), /key="nozzle_volume_type" value="1"/);
  // Only what the file says changes, not one move.
  assert.deepEqual(layerMoves(new TextDecoder().decode(storedZip(hf.package).get("Metadata/plate_1.gcode"))), layerMoves(gcode));
  await assert.rejects(printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured", "hardened" as never), (e: Error & { kind?: string }) => e.kind === "bad-request" && /bad nozzle/.test(e.message));
});

// ---- Slicer hunt 2026-10-31: the dialog's follow-ups ----

test("the supports hint: recommended after a slice that hangs, with one tap to turn supports on; not needed, with one to turn them off", async () => {
  let hang = 900;
  const t = dialog(async () => ({ print: print({ overhangMm2: hang } as Partial<SlicedPrint>), saved: true }));
  t.d.ask();
  const hint = t.$("slice-print-supports-hint");
  const flip = t.$<HTMLButtonElement>("slice-print-supports-flip");
  const supports = t.$<HTMLSelectElement>("slice-print-supports");
  assert.equal(hint.hidden, true, "nothing before a slice");
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(hint.hidden, false);
  assert.equal(hint.dataset.recommended, "true");
  assert.equal(t.$("slice-print-supports-hint-words").textContent, "Supports recommended: part of it hangs out more than 45° with nothing under it.");
  assert.equal(flip.hidden, false);
  assert.equal(flip.textContent, "Turn supports on");
  // One tap: Supports is Normal, the last result (made without them) is cleared, and the words say to slice again.
  flip.click();
  assert.equal(supports.value, "normal");
  assert.equal(hint.hidden, true);
  assert.equal(t.$("slice-print-status").textContent, "Supports turned on (Normal). Slice again to make the file with them.");
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.asked.at(-1)!.supports, "normal", "the next slice has them");
  assert.equal(flip.hidden, true, "already on: nothing to switch");
  assert.equal(hint.hidden, false);
  // Nothing hangs, supports on: offer to turn them off.
  hang = 0;
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(hint.dataset.recommended, "false");
  assert.equal(t.$("slice-print-supports-hint-words").textContent, "Supports not needed: nothing hangs out more than 45°.");
  assert.equal(flip.textContent, "Turn supports off");
  flip.click();
  assert.equal(supports.value, "off");
  assert.equal(t.$("slice-print-status").textContent, "Supports turned off. Slice again to make the file without them.");
  // A slice that knows nothing of overhangs (no figure) shows no hint; any change of choice hides one.
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(hint.hidden, false);
  t.$<HTMLSelectElement>("slice-print-walls").value = "3";
  t.$<HTMLSelectElement>("slice-print-walls").dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(hint.hidden, true, "a change hides it");
  await t.window.happyDOM.close();
  const u = dialog(async () => ({ print: print(), saved: true }));
  u.d.ask();
  u.$("slice-print-go").click();
  await u.settle();
  assert.equal(u.$("slice-print-supports-hint").hidden, true, "no figure, no hint");
  await u.window.happyDOM.close();
});

test("the overhang figure on the shipped build: the plate on its column hangs by its underside, 900 mm²; the cube by nothing", async () => {
  const kernel = nodeKernel();
  const plate = insertPreset(partDocument("box", 10, 10, 10), "box", 30, 30, 2);
  const doc = insertMove(plate.doc, [bodyIdOf(plate.id)], { ...NO_MOVE, z: 10 }).doc;
  // The plate's bottom face, 30 × 30 = 900 mm², 10 mm up and facing straight down (it rests on the column, a separate body).
  const hung = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  assert.ok(Math.abs(hung.overhangMm2 - 900) < 0.01, String(hung.overhangMm2));
  const cube = partDocument("box", 20, 20, 20);
  assert.equal((await sliceBodies(kernel, cube, bodyFeatures(cube), PRINT_DEFAULTS)).overhangMm2, 0);
});

test("a refusal is put in words a beginner can act on, worked by hand", () => {
  // Runs from x = -22 to 278: 278 - (-22) = 300 mm; y 118 to 138: 20 mm. The wider is 300, along x: "wide".
  assert.equal(refusalWords("the part, placed at (128, 128), runs from (-22, 118) to (278, 138), off the 256 × 256 mm bed"), "The part is 300 mm wide, and the P1S's plate takes 256 × 256 mm. Make it smaller or split it into pieces.");
  // Deeper than wide: y 0 to 300.5, x 0 to 10: 300.5 deep.
  assert.equal(refusalWords("the part, placed at (128, 128), runs from (0, 0) to (10, 300.5), off the 256 × 256 mm bed"), "The part is 300.5 mm deep, and the P1S's plate takes 256 × 256 mm. Make it smaller or split it into pieces.");
  assert.equal(refusalWords("layer 1280 reaches z = 256.2 mm, above the printer's 256 mm"), "The part is about 256.2 mm tall, and the P1S prints up to 256 mm. Make it shorter or split it into pieces.");
  // Anything else is kept.
  assert.equal(refusalWords("something else broke"), "Something else broke");
});

test("a part too tall for the P1S is called by its own height, not by the first layer over the limit (slicer hunt 11-04, ui 2)", async () => {
  // Given the part's height, the words use it: a box from z 0 to 400 is 400 mm tall, whatever layer the engine names.
  assert.equal(refusalWords("layer 1280 reaches z = 256.2 mm, above the printer's 256 mm", 400), "The part is 400 mm tall, and the P1S prints up to 256 mm. Make it shorter or split it into pieces.");
  // On the shipped build: boxes 260, 300 and 400 mm tall (from z 0, so the height is the box's) are each called by theirs.
  const kernel = nodeKernel();
  for (const h of [260, 300, 400]) {
    const doc = partDocument("box", 20, 20, h);
    let words = "";
    await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured").then(
      () => assert.fail(`${h} mm sliced`),
      (e) => (words = refusalOf(e)),
    );
    assert.equal(words, `The part is ${h} mm tall, and the P1S prints up to 256 mm. Make it shorter or split it into pieces.`);
  }
  // The plain slice says the same.
  const doc = partDocument("box", 20, 20, 300);
  await assert.rejects(sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS), (e) => (assert.match(refusalOf(e), /^The part is 300 mm tall/), true));
  // Anything that is not an Error is put in words too.
  assert.equal(refusalOf("plain words"), "Plain words");
  // The dialog says it: Slice and download on a 300 mm box, its slice the shipped build's.
  const t = dialog(async (c) => ({ print: await printFileOf(kernel, doc, bodyFeatures(doc), c, "textured"), saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  for (let i = 0; i < 200 && !/tall/.test(t.$("slice-print-status").textContent ?? ""); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.$("slice-print-status").textContent, "The part is 300 mm tall, and the P1S prints up to 256 mm. Make it shorter or split it into pieces.");
  await t.window.happyDOM.close();
});

test("closing the dialog drops a slice still running: nothing is saved; reopened, it still says Slicing… and the buttons stay off", async () => {
  let finish!: () => void;
  let savedAfterClose = false;
  const t = dialog(
    (_c, _f, alive) =>
      new Promise((_, reject) => {
        finish = () => {
          if (alive()) savedAfterClose = true;
          reject(new SliceDropped());
        };
      }),
  );
  t.d.ask();
  t.$("slice-print-go").click();
  assert.equal(t.$<HTMLButtonElement>("slice-print-preview").disabled, true, "Preview is off while Slice and download runs");
  t.$("slice-print-close").click();
  t.d.ask();
  assert.equal(t.$("slice-print-status").textContent, "Slicing…", "reopened mid-slice it still says so");
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, true);
  finish();
  await t.settle();
  assert.equal(savedAfterClose, false, "the dialog was closed since the click: alive() is false");
  assert.equal(t.$("slice-print-status").textContent, "", "a dropped slice says nothing");
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, false);
  assert.equal(t.$<HTMLButtonElement>("slice-print-preview").disabled, false);
  await t.window.happyDOM.close();
});

test("while a slice runs Close reads Stop, and it or Escape stops the engine, so edits don't wait behind it (slicer hunt 11-04, ui 3)", async () => {
  // The shipped build for the bodies' files; the engine's calls wait until stopped, as a long slice does.
  const real = nodeKernel();
  const engineCalls: string[] = [];
  let stops = 0;
  let stop: (() => void) | null = null;
  const kernel = {
    call: ((op: string, ...args: unknown[]) => {
      if (op !== "slice_stl" && op !== "print_file_stl") return (real.call as (...a: unknown[]) => Promise<unknown>)(op, ...args);
      engineCalls.push(op);
      return new Promise((_, reject) => (stop = () => reject(new Error("The slice was stopped."))));
    }) as typeof real.call,
    stopSlicing() {
      stops++;
      const s = stop;
      stop = null;
      s?.();
      return s !== null;
    },
  };
  const doc = partDocument("box", 20, 20, 20);
  let saved = 0;
  const t = dialog(async (c, f, alive) => {
    const print = await printFileOf(kernel, doc, bodyFeatures(doc), c, f.plate);
    if (alive()) saved++;
    return { print, saved: true };
  });
  const until = async (what: () => boolean) => {
    for (let i = 0; i < 300 && !what(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(what());
  };
  const close = () => t.$<HTMLButtonElement>("slice-print-close");
  t.d.ask();
  assert.equal(close().textContent, "Close");
  t.$("slice-print-go").click();
  assert.equal(close().textContent, "Stop", "while it slices");
  await until(() => engineCalls.length === 1);
  close().click();
  assert.equal(stops, 1, "Stop stopped the engine");
  assert.equal(t.d.open, false, "and closed the dialog");
  await until(() => close().textContent === "Close");
  assert.equal(saved, 0);
  // Reopened, it slices again at once; Escape (the dialog's own close) stops it the same way.
  t.d.ask();
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, false);
  t.$("slice-print-go").click();
  await until(() => engineCalls.length === 2);
  (t.$("slice-print-dialog") as HTMLDialogElement).close();
  assert.equal(stops, 2);
  await until(() => close().textContent === "Close");
  // Stopped while the bodies' files are still being made: the engine is never asked.
  t.d.ask();
  t.$("slice-print-go").click();
  close().click();
  await until(() => close().textContent === "Close");
  assert.equal(engineCalls.length, 2, "no third slice reached the engine");
  // With no slice running, Close just closes: nothing is stopped.
  t.d.ask();
  close().click();
  assert.equal(stops, 3);
  // No slice left: stopping asks no kernel.
  stopSlices();
  assert.equal(stops, 3);
  assert.equal(saved, 0);
  await t.window.happyDOM.close();
});

test("the dialog's choices outlive Design being mounted again (Undo, Redo), in a new toolbar of the same id; a new page starts fresh (slicer hunt 11-04, ui 1)", async () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  // A preset picked last time, then two of its choices changed: the dialog shows it as changed.
  const home: PrintPreset = { id: "home", name: "home P1S", printer: "bambu-p1s", settings: { ...PRINT_DEFAULTS, ...FILE_DEFAULTS, infill: 20 }, updatedAt: 1 };
  writePresets(window.localStorage as unknown as Storage, { presets: [home], kept: [], writable: true });
  window.localStorage.setItem(PRESET_PICKED_KEY, "home");
  // Design's toolbar slot: mounted again, it is a new element with the same id.
  const toolbar = () => {
    doc.getElementById("toolbar")?.remove();
    const slot = doc.createElement("div");
    slot.id = "toolbar";
    doc.body.append(slot);
    return slot;
  };
  const events = { slice: async () => ({ print: print(), saved: true, name: "x" }), preview: async () => {} };
  slicePrint(toolbar(), events);
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const set = (id: string, v: string) => {
    $<HTMLSelectElement>(id).value = v;
    $(id).dispatchEvent(new window.Event("change") as unknown as Event);
  };
  assert.equal($<HTMLSelectElement>("slice-print-infill").value, "20", "the preset's");
  set("slice-print-supports", "tree");
  set("slice-print-plate", "smooth");
  set("slice-print-walls", "4");
  set("slice-print-infill", "60");
  const listed = () => $<HTMLSelectElement>("slice-presets-list").selectedOptions[0]?.textContent;
  assert.equal(listed(), "home P1S (changed)");
  // Undo: Design is put away and mounted again, making a new dialog in a new toolbar.
  slicePrint(toolbar(), events);
  assert.deepEqual(["quality", "walls", "infill", "supports", "plate"].map((k) => $<HTMLSelectElement>(`slice-print-${k}`).value), ["0.2", "4", "60", "tree", "smooth"]);
  assert.equal(listed(), "home P1S (changed)", "still the preset picked, still changed");
  // The file kind too, and the plate's list goes off with it as before.
  set("slice-print-format", "gcode");
  slicePrint(toolbar(), events);
  assert.equal($<HTMLSelectElement>("slice-print-format").value, "gcode");
  assert.equal($<HTMLSelectElement>("slice-print-plate").disabled, true);
  // The split view's toolbar keeps its own; a slot with no id (as in the other tests) keeps nothing: both start from the preset picked.
  doc.getElementById("toolbar")?.remove();
  for (const id of ["split-toolbar", ""]) {
    doc.body.replaceChildren();
    const slot = doc.createElement("div");
    slot.id = id;
    doc.body.append(slot);
    slicePrint(slot, events);
    assert.deepEqual(["walls", "infill", "supports"].map((k) => $<HTMLSelectElement>(`slice-print-${k}`).value), ["2", "20", "off"], id);
  }
  // A page loaded again (a new document, the same storage) starts from the preset picked, as before.
  const page = new Window();
  writePresets(page.localStorage as unknown as Storage, { presets: [home], kept: [], writable: true });
  page.localStorage.setItem(PRESET_PICKED_KEY, "home");
  const again = page.document.createElement("div");
  again.id = "toolbar";
  page.document.body.append(again);
  slicePrint(again as unknown as HTMLElement, events);
  assert.equal((page.document.getElementById("slice-print-infill") as unknown as HTMLSelectElement).value, "20");
  await page.happyDOM.close();
  await window.happyDOM.close();
});

test("a slice with the dialog left open is alive when it ends (the other side of the check)", async () => {
  let aliveAtEnd: boolean | null = null;
  const t = dialog(async (_c, _f, alive) => ((aliveAtEnd = alive()), { print: print(), saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(aliveAtEnd, true);
  await t.window.happyDOM.close();
});

test("changing a choice clears the last result, which no longer matches", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.match(t.$("slice-print-status").textContent!, /^Saved /);
  const infill = t.$<HTMLSelectElement>("slice-print-infill");
  infill.value = "25";
  infill.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(t.$("slice-print-status").textContent, "");
  await t.window.happyDOM.close();
});

test("Preview is given the file choices, so it can slice the file that is downloaded", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  t.$("slice-print-preview").click();
  await t.settle();
  assert.deepEqual(t.files, [{ format: "p1s", plate: "textured", nozzle: "standard" }]);
  await t.window.happyDOM.close();
});

test("the G-code inside a P1S print file is the plate's, read back from the package; bytes that are no such package give null", async () => {
  const doc = partDocument("box", 20, 20, 20);
  const f = await printFileOf(nodeKernel(), doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  const gcode = gcodeOfPackage(f.package)!;
  assert.ok(gcode, "found");
  // By hand: the file marks each of 20 mm / 0.2 mm = 100 layers; the md5 beside it is that text's.
  assert.equal((gcode.match(/^;LAYER_CHANGE$/gm) ?? []).length, 100);
  const md5 = createHash("md5").update(gcode).digest("hex").toUpperCase();
  assert.ok(new TextDecoder().decode(f.package).includes(md5), "the md5 file in the package is this text's");
  assert.equal(gcodeOfPackage(new Uint8Array([1, 2, 3])), null);
  assert.equal(gcodeOfPackage(new Uint8Array(0)), null);
  assert.equal(gcodeOfPackage(f.package.subarray(0, 200)), null, "cut short");
});

test("the preview reads a P1S file's layer moves only: 100 layers for the 20 mm cube, as the plain slice, where the whole file reads 99", async () => {
  const doc = partDocument("box", 20, 20, 20);
  const kernel = nodeKernel();
  const f = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  const whole = gcodeOfPackage(f.package)!;
  const moves = printMovesOf(whole)!;
  // By hand: 20 mm / 0.2 mm = 100 layers, the same as the plain slice's replay.
  assert.equal(playback(moves).layers.length, 100);
  // By hand: the first layer is 0.2 mm up and the last 20 mm; the lift before layer 1 is kept (else layer 1 reads 0.00 mm).
  assert.equal(playback(moves).layers[0].z, 0.2);
  assert.equal(playback(moves).layers[99].z, 20);
  assert.equal(playback(moves).layers.length, playback((await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS)).gcode).layers.length);
  assert.equal(playback(whole).layers.length, 99, "the start routine's own plastic confuses the layers (why it is cut off)");
  assert.ok(!moves.includes(";===== end"), "the end routine is cut off");
  assert.equal(printMovesOf("no layers here"), null);
});

test("a file's name starts with the project's name, so files of two projects differ on the printer's list; an unnamed project keeps 'spindlelabs'", () => {
  // By hand: name, then the layer height, walls and infill, then the plate and the ending.
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "standard", "Bracket"), "Bracket-0.2mm-2w-15pc-textured.gcode.3mf");
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "high-flow", "Bracket"), "Bracket-0.2mm-2w-15pc-textured-high-flow.gcode.3mf");
  assert.equal(gcodeName({ ...PRINT_DEFAULTS, supports: "tree" }, "Bracket"), "Bracket-0.2mm-2w-15pc-tree-supports.gcode");
  for (const unnamed of [undefined, "", "   ", "Untitled", "untitled"]) assert.equal(printFileName(PRINT_DEFAULTS, "smooth", "standard", unnamed), "spindlelabs-0.2mm-2w-15pc-smooth.gcode.3mf", String(unnamed));
  assert.notEqual(printFileName(PRINT_DEFAULTS, "textured", "standard", "A"), printFileName(PRINT_DEFAULTS, "textured", "standard", "B"));
});

/** A binary STL of triangles given by their corners' z (the x and y are 0: only z is read). */
const stlOfZ = (triangles: number[][]): Uint8Array => {
  const out = new Uint8Array(84 + 50 * triangles.length);
  const view = new DataView(out.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => t.forEach((z, c) => view.setFloat32(84 + i * 50 + 12 + c * 12 + 8, z, true)));
  return out;
};

test("a long project name is cut, never the settings: two slices of it keep different names (slicer hunt 11-04, package 4a)", () => {
  // 105 characters of name: with "-0.2mm-2w-15pc-textured-high-flow" (33) and ".gcode.3mf" (10) the whole is 148, over the
  // 120 a name may have, so the name keeps 120 - 33 - 10 = 77 characters and the settings stay whole.
  const project = "Bracket for the garden shed door hinge, left side, second try with thicker ribs and a chamfer on the edge";
  assert.equal(project.length, 105);
  const a = printFileName(PRINT_DEFAULTS, "textured", "high-flow", project);
  assert.equal(a, `${project.slice(0, 77)}-0.2mm-2w-15pc-textured-high-flow.gcode.3mf`);
  assert.equal(a.length, 120);
  // The save box's own cut leaves it as it is, and a second slice with other settings gets another name.
  assert.equal(fileNameFor(a, ".gcode.3mf"), a);
  const b = printFileName({ ...PRINT_DEFAULTS, walls: 4, infill: 40 }, "smooth", "high-flow", project);
  assert.notEqual(fileNameFor(b, ".gcode.3mf"), fileNameFor(a, ".gcode.3mf"));
  assert.match(fileNameFor(b, ".gcode.3mf"), /-0\.2mm-4w-40pc-smooth-high-flow\.gcode\.3mf$/);
  // The plain file: "-0.2mm-2w-15pc" (14) and ".gcode" (6) leave the name 100 characters.
  assert.equal(gcodeName(PRINT_DEFAULTS, project), `${project.slice(0, 100)}-0.2mm-2w-15pc.gcode`);
  // A name cut just before a space loses the space, so the settings never follow one.
  assert.equal(gcodeName(PRINT_DEFAULTS, `${"a".repeat(99)} b`), `${"a".repeat(99)}-0.2mm-2w-15pc.gcode`);
  // Bytes too: 60 three-byte characters (180 bytes) with the plain file's 20 ASCII bytes is 200, the most; 61 is cut to 60.
  assert.equal(gcodeName(PRINT_DEFAULTS, "語".repeat(61)), `${"語".repeat(60)}-0.2mm-2w-15pc.gcode`);
  assert.equal(fileNameFor(gcodeName(PRINT_DEFAULTS, "語".repeat(61)), ".gcode"), gcodeName(PRINT_DEFAULTS, "語".repeat(61)));
  // A short name is kept whole.
  assert.equal(gcodeName(PRINT_DEFAULTS, "Bracket"), "Bracket-0.2mm-2w-15pc.gcode");
});

test("a project with no name of its own gives its print files its file's name (slicer hunt 11-04, package 4b)", () => {
  // The app never names a project ("Untitled"): saved or opened as "Garden bracket", its files start with that.
  assert.equal(printLead("Untitled", "Garden bracket"), "Garden bracket");
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "standard", printLead("Untitled", "Garden bracket")), "Garden bracket-0.2mm-2w-15pc-textured.gcode.3mf");
  assert.equal(printLead("", "Garden bracket"), "Garden bracket");
  assert.equal(printLead(undefined, "Garden bracket"), "Garden bracket");
  // A project that has a name keeps it; no file (or a blank one) leaves "spindlelabs".
  assert.equal(printLead("Hinge", "Garden bracket"), "Hinge");
  assert.equal(gcodeName(PRINT_DEFAULTS, printLead("Untitled", null)), "spindlelabs-0.2mm-2w-15pc.gcode");
  assert.equal(gcodeName(PRINT_DEFAULTS, printLead("Untitled", "  ")), "spindlelabs-0.2mm-2w-15pc.gcode");
});

test("the lowest z of a binary STL, worked by hand; no triangle gives NaN", () => {
  // Corners' z: (5, 3, 4) and (7, -2, 9): the smallest of all six is -2.
  assert.equal(stlLowestZ(stlOfZ([[5, 3, 4], [7, -2, 9]])), -2);
  assert.ok(Number.isNaN(stlLowestZ(stlOfZ([]))));
  assert.ok(Number.isNaN(stlLowestZ(new Uint8Array(10)))); // shorter than a header
  // A count larger than the bytes held reads only the triangles there are (one of them), never past the end.
  const lying = stlOfZ([[1, 2, 3]]);
  new DataView(lying.buffer).setUint32(80, 1_000_000, true);
  assert.equal(stlLowestZ(lying), 1);
});

test("bodies at different heights get one sentence naming the first one above the lowest; level ones, one body, or nothing known get none", () => {
  // Lowest points 0, 20 and -3: the floor is -3, so the first above it by more than 0.01 is body 1 (0 - (-3) = 3 mm).
  assert.equal(levelNote([0, 20, -3]), "Body 1 starts 3 mm above the lowest body. The lowest point goes on the plate, so it hangs in the air and only prints with supports on: set the bodies on one level to print them together.");
  // 0 and 20: the floor is 0, body 2 is 20 mm above.
  assert.match(levelNote([0, 20]), /^Body 2 starts 20 mm above the lowest body\./);
  // 0.9× and 1.1× of the 0.1 mm a CAD rounding gap may be (slicer hunt 2026-11-04, inputs 3: 0.011 mm was called
  // "0 mm above", and the engine prints such a gap, its first layer being cut at 0.1 mm): 0.09 is level, 0.11 is not,
  // and rounds to 0.1, never to 0.
  assert.equal(levelNote([0, 0.09]), "");
  assert.match(levelNote([0, 0.11]), /^Body 2 starts 0\.1 mm above/);
  assert.equal(levelNote([5]), "");
  assert.equal(levelNote([]), "");
  assert.equal(levelNote([0, Number.NaN]), "");
});

test("on the real kernel: a cube beside one 20 mm up is noted, two on the floor are not", async () => {
  const kernel = nodeKernel();
  const cube = (z: number) => kernel.call("export_stl", { moved: { body: { box: { width: 10, depth: 10, height: 10 } }, moves: [{ move: [0, 0, z] }] } }, "body");
  const low = stlLowestZ((await cube(0)).bytes);
  const up = stlLowestZ((await cube(20)).bytes);
  assert.equal(low, 0);
  assert.equal(up, 20);
  assert.match(levelNote([low, up]), /^Body 2 starts 20 mm above/);
  assert.equal(levelNote([low, low]), "");
});

test("a body standing on another one is never said to hang in the air; one with nothing under it is (slicer hunt 11-04, inputs 2)", async () => {
  const kernel = nodeKernel();
  // Boxes are centred on x and y at the origin (then moved), their bottoms at z 0 before the move.
  const box = async (w: number, d: number, h: number, at: [number, number, number]) => (await kernel.call("export_stl", { moved: { body: { box: { width: w, depth: d, height: h } }, moves: [{ move: at }] } }, "body")).bytes;
  const block = await box(20, 20, 20, [0, 0, 0]); // x and y -10 to 10, z 0 to 20
  // A post on the block's top (z 20): it stands on the block, and the engine prints it with supports off.
  assert.equal(levelNoteOf([block, await box(10, 10, 10, [0, 0, 20])]), "");
  // A lid wider than the block, on its top: it overhangs, but stands on the block.
  assert.equal(levelNoteOf([block, await box(40, 40, 3, [0, 0, 20])]), "");
  // A wide plate on a thin column (no corner of the plate's underside is over the column: the column is under it).
  assert.equal(levelNoteOf([await box(10, 10, 20, [0, 0, 0]), await box(80, 80, 3, [0, 0, 20])]), "");
  // A post sunk 5 mm into the block (z 15 to 25): the engine joins them.
  assert.equal(levelNoteOf([block, await box(10, 10, 10, [0, 0, 15])]), "");
  // A stack of three: a lid on the post on the block.
  assert.equal(levelNoteOf([block, await box(10, 10, 10, [0, 0, 20]), await box(12, 12, 2, [0, 0, 30])]), "");
  // Beside the block at z 5, with nothing under it (x 25 to 35, the block ends at 10): it really floats.
  assert.match(levelNoteOf([block, await box(10, 10, 10, [30, 0, 5])]), /^Body 2 starts 5 mm above the lowest body\./);
  // Over the block with a gap: 0.9× and 1.1× of the 0.1 mm a CAD rounding gap may be. At z 20.09 (0.09 above the top) it
  // stands on it; at z 20.11 (0.11 above) it floats, 20.11 mm above the lowest body, which rounds to 20.1.
  assert.equal(levelNoteOf([block, await box(10, 10, 10, [0, 0, 20.09])]), "");
  assert.match(levelNoteOf([block, await box(10, 10, 10, [0, 0, 20.11])]), /^Body 2 starts 20\.1 mm above the lowest body\./);
  // Beside the block, 0.05 mm up (CAD rounding): no note; the engine prints it.
  assert.equal(levelNoteOf([block, await box(10, 10, 10, [30, 0, 0.05])]), "");
  // A body resting on one that floats: the floating one is named, not the one on it.
  assert.match(levelNoteOf([block, await box(10, 10, 10, [30, 0, 5]), await box(6, 6, 6, [30, 0, 15])]), /^Body 2 starts/);
  // Nothing readable, or one body: no note.
  assert.equal(levelNoteOf([block]), "");
  assert.equal(levelNoteOf([new Uint8Array(10), block]), "");
});

test("the dialog adds the heights note after the result and marks it as a warning; without it the result is plain", async () => {
  let note = "Body 2 starts 20 mm above the lowest body.";
  const t = dialog(async () => ({ print: { ...print(), levelNote: note }, saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.match(t.$("slice-print-status").textContent ?? "", /plus heating and levelling\)\. Body 2 starts 20 mm above the lowest body\.$/);
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  note = "";
  t.$("slice-print-go").click();
  await t.settle();
  assert.doesNotMatch(t.$("slice-print-status").textContent ?? "", /Body 2/);
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), false);
});

test("a body floating above the plate is refused with advice when supports are off, and sliced with supports on (real kernel)", async () => {
  const kernel = nodeKernel();
  const cube = (x: number, z: number) => kernel.call("export_stl", { moved: { body: { box: { width: 10, depth: 10, height: 10 } }, moves: [{ move: [x, 0, z] }] } }, "body");
  // One cube on the plate at x 0, one 20 mm up at x 30: its centre is (35, 5) once the lowest point is on the plate.
  const stl = stackStl([(await cube(0, 0)).bytes, (await cube(30, 20)).bytes]);
  const words = (m: string) => refusalWords(m);
  await assert.rejects(kernel.call("slice_stl", stl, 0.2, 2, 15, "off"), (e: Error) => {
    assert.equal(words(e.message), "Part of the model hangs in the air 20 mm above the plate, around (35, 5) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.");
    return true;
  });
  assert.ok((await kernel.call("slice_stl", stl, 0.2, 2, 15, "normal")).layers > 0);
  // The wording by hand, for a message of the same shape.
  assert.equal(refusalWords("part of the model starts in mid-air at z = 3.5 mm, around (-2, 7.5), with nothing under it: turn on supports"), "Part of the model hangs in the air 3.5 mm above the plate, around (-2, 7.5) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.");
});

test("progress words: the stage, with the layer when it goes layer by layer; nothing before the first report", () => {
  assert.equal(progressWords(null), "");
  assert.equal(progressWords({ fraction: 0.05, stage: "layers", done: 0, total: 1 }), "Cutting the bodies into layers…");
  assert.equal(progressWords({ fraction: 0.325, stage: "walls", done: 120, total: 254 }), "Walls: layer 120 of 254");
  assert.equal(progressWords({ fraction: 0.5, stage: "infill", done: 1, total: 1 }), "Infill and solid layers…");
  assert.equal(progressWords({ fraction: 0.6, stage: "supports", done: 50, total: 254 }), "Supports: layer 50 of 254");
  assert.equal(progressWords({ fraction: 0.8, stage: "paths", done: 7, total: 254 }), "Putting the paths in order: layer 7 of 254");
  assert.equal(progressWords({ fraction: 0.95, stage: "file", done: 0, total: 1 }), "Writing the file…");
});

test("the progress bar follows the engine's reports while a slice runs, only forward, and goes when it ends", async () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  let tell: ((p: SliceProgress) => void) | null = null;
  let stopped = 0;
  let finish!: () => void;
  const d = slicePrint(slot, {
    slice: () => new Promise((r) => (finish = () => r({ print: print(), saved: true, name: "part.gcode.3mf" }))),
    preview: async () => {},
    onProgress: (l) => ((tell = l), () => void (stopped++, (tell = null))),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const meter = $<HTMLProgressElement>("slice-print-meter");
  assert.equal($("slice-print-progress").hidden, true, "no bar before a slice");
  d.ask();
  $("slice-print-go").click();
  assert.equal($("slice-print-progress").hidden, false, "the bar shows as the slice starts");
  assert.equal(meter.hasAttribute("value"), false, "no value (a moving bar) before the first report");
  assert.equal($("slice-print-status").textContent, "Slicing…");
  tell!({ fraction: 0.325, stage: "walls", done: 120, total: 254 });
  assert.equal(meter.value, 0.325);
  assert.equal($("slice-print-stage").textContent, "Walls: layer 120 of 254");
  // A report behind the last (a second engine call starting from 0) never moves the bar back.
  tell!({ fraction: 0.1, stage: "layers", done: 0, total: 1 });
  assert.equal(meter.value, 0.325);
  assert.equal($("slice-print-stage").textContent, "Walls: layer 120 of 254");
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal($("slice-print-progress").hidden, true, "the bar goes when the slice ends");
  assert.equal(stopped, 1, "and stops listening");
  assert.equal(tell, null);
  await window.happyDOM.close();
});

test("while the engine writes the file, which tells no progress, the bar keeps creeping on and says how long it has been (slicer hunt 11-04, ui 4)", async () => {
  // By hand: from 0.95, with 10 s of slicing before the file (so a time constant of 2 × 10 = 20 s), 20 s into writing
  // the bar is 0.95 + (0.99 - 0.95) × (1 - e^-1) = 0.95 + 0.04 × 0.632121 = 0.975285; it never passes 0.99.
  assert.ok(Math.abs(fileCrawl(0.95, 10_000, 20_000) - 0.975285) < 1e-6, `${fileCrawl(0.95, 10_000, 20_000)}`);
  assert.equal(fileCrawl(0.95, 10_000, 0), 0.95);
  assert.ok(fileCrawl(0.95, 10_000, 1e9) <= 0.99);
  // A quick slice before the file still creeps slowly: the time constant is at least FILE_CRAWL_MIN_MS.
  assert.ok(Math.abs(fileCrawl(0.95, 0, FILE_CRAWL_MIN_MS) - (0.95 + 0.04 * (1 - Math.exp(-1)))) < 1e-9);
  // A bar already past 0.99 stays where it is; nonsense times give the fraction as it was.
  assert.equal(fileCrawl(0.995, 10_000, 5_000), 0.995);
  assert.equal(fileCrawl(0.95, Number.NaN, Number.NaN), 0.95);
  // In the dialog: the file stage's report, then the bar moves on by itself and the words say it is still writing.
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  let tell: ((p: SliceProgress) => void) | null = null;
  let finish!: () => void;
  const d = slicePrint(slot, {
    slice: () => new Promise((r) => (finish = () => r({ print: print(), saved: true, name: "part.gcode.3mf" }))),
    preview: async () => {},
    onProgress: (l) => ((tell = l), () => void (tell = null)),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const meter = $<HTMLProgressElement>("slice-print-meter");
  d.ask();
  $("slice-print-go").click();
  tell!({ fraction: 0.95, stage: "file", done: 0, total: 1 });
  assert.equal(meter.value, 0.95);
  assert.equal($("slice-print-stage").textContent, "Writing the file…");
  await new Promise((r) => setTimeout(r, 1300));
  assert.ok(meter.value > 0.95 && meter.value < 0.99, `the bar crept on: ${meter.value}`);
  assert.match($("slice-print-stage").textContent ?? "", /^Still writing the file… [12] s so far$/);
  // The engine's own end puts the bar at the end.
  tell!({ fraction: 1, stage: "file", done: 1, total: 1 });
  assert.equal(meter.value, 1);
  const at = meter.value;
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(meter.value, at, "no creeping once the engine said it is done");
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal($("slice-print-progress").hidden, true);
  await window.happyDOM.close();
});

test("a choice changed while a preview slices: the preview is told, so it says it shows the earlier choices (slicer hunt 11-04 leftover)", async () => {
  let finish!: () => void;
  const told: boolean[] = [];
  const t = dialog(
    async () => ({ print: print(), saved: true }),
    (_c, _f, _alive, changed) => new Promise((r) => (finish = () => (told.push(changed()), r()))),
  );
  t.d.ask();
  t.$("slice-print-preview").click();
  t.$<HTMLSelectElement>("slice-print-walls").value = "4";
  t.$("slice-print-walls").dispatchEvent(new t.window.Event("change") as unknown as Event);
  finish();
  await t.settle();
  assert.deepEqual(told, [true]);
  // The slice ran with the choices of the moment Preview was pressed; the next one has the new walls.
  assert.equal(t.asked[0]!.walls, 2);
  // Previewed again with nothing changed meanwhile: not told, though the last one was.
  t.d.ask();
  t.$("slice-print-preview").click();
  finish();
  await t.settle();
  assert.deepEqual(told, [true, false]);
  assert.equal(t.asked[1]!.walls, 4);
  // A change during Slice and download, then a preview with none: the preview is not told about the earlier slice's change.
  let done!: () => void;
  const u = dialog(
    () => new Promise((r) => (done = () => r({ print: print(), saved: true }))),
    async (_c, _f, _alive, changed) => void told.push(changed()),
  );
  u.d.ask();
  u.$("slice-print-go").click();
  u.$<HTMLSelectElement>("slice-print-infill").value = "40";
  u.$("slice-print-infill").dispatchEvent(new u.window.Event("change") as unknown as Event);
  done();
  await u.settle();
  u.$("slice-print-preview").click();
  await u.settle();
  assert.deepEqual(told, [true, false, false]);
  await t.window.happyDOM.close();
  await u.window.happyDOM.close();
});

test("a choice changed while a slice runs: the result says it is the earlier choices' slice (slicer hunt 11-04, ui 5)", async () => {
  let finish!: () => void;
  const t = dialog(() => new Promise((r) => (finish = () => r({ print: print(), saved: true }))));
  t.d.ask();
  t.$("slice-print-go").click();
  t.$<HTMLSelectElement>("slice-print-infill").value = "100";
  t.$("slice-print-infill").dispatchEvent(new t.window.Event("change") as unknown as Event);
  finish();
  await t.settle();
  assert.match(t.$("slice-print-status").textContent ?? "", /^Saved .*\. A choice was changed while it sliced, so this is the slice of the earlier choices: slice again for the new ones\.$/);
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  // Sliced again with nothing changed meanwhile: the plain result.
  t.$("slice-print-go").click();
  finish();
  await t.settle();
  assert.doesNotMatch(t.$("slice-print-status").textContent ?? "", /earlier choices/);
  await t.window.happyDOM.close();
});

test("a choice focused under the sticky button row is scrolled up above it (slicer hunt 11-04, ui 6)", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  const box = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  const dialogEl = t.$("slice-print-dialog");
  // The button row from y 600 to 667; Supports from 590 to 634, 34 px under its top: scrolled up 34 + 8 = 42 px.
  t.$("slice-print-actions").getBoundingClientRect = box(600, 667);
  t.$("slice-print-supports").getBoundingClientRect = box(590, 634);
  dialogEl.scrollTop = 100;
  t.$("slice-print-supports").focus();
  assert.equal(dialogEl.scrollTop, 142);
  // One clear of the row (ending at 592, 8 above it) is left alone.
  t.$("slice-print-walls").getBoundingClientRect = box(548, 592);
  t.$("slice-print-walls").focus();
  assert.equal(dialogEl.scrollTop, 142);
  // The buttons themselves are never scrolled for.
  t.$("slice-print-go").focus();
  assert.equal(dialogEl.scrollTop, 142);
  await t.window.happyDOM.close();
});

test("closing the Slice dialog gives the keyboard back to File ▾ (slicer hunt 11-04, ui 7)", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  const file = t.doc.createElement("button");
  file.id = "file-menu";
  t.doc.body.append(file);
  t.d.ask();
  t.$("slice-print-close").click();
  assert.ok(t.doc.activeElement === file, `focus on ${t.doc.activeElement?.id}`);
  // Escape (the dialog's own close) too.
  t.d.ask();
  (t.$("slice-print-dialog") as HTMLDialogElement).close();
  assert.ok(t.doc.activeElement === file, `focus on ${t.doc.activeElement?.id}`);
  await t.window.happyDOM.close();
});

// ---- App hunt 2026-11-04: refused only for the warm-up loop or Better grip's brim ----

test("a part refused only with its warm-up loop or brim round it: the words give its own size and say turning that off makes it fit", async () => {
  const kernel = nodeKernel();
  /** The engine's refusal of a w × d × 1 mm box with these extras. */
  const refusal = async (w: number, d: number, warmUp: boolean, betterGrip: boolean) => {
    const f = await kernel.call("export_stl", { box: { width: w, depth: d, height: 1 } }, "body");
    try {
      await kernel.call("print_file_stl", f.bytes, 0.2, 2, 15, "off", "textured", "standard", warmUp, betterGrip);
    } catch (e) {
      return (e as Error).message;
    }
    assert.fail(`${w} × ${d} sliced`);
  };
  // The hunt's part, 230 × 251 with the loop (on by default): the engine says it runs from y = −1.457 to 257.457, so
  // 258.914 deep, 258.9; the loop reaches 3.957 each side, so the part is 258.914 − 7.914 = 251 deep. Without the loop
  // 230 × 251 fits (256 wide, 251 deep, and 230 ≤ 238 moves right clear of the corner).
  assert.equal(
    refusalWords(await refusal(230, 251, true, false)),
    "The part is 251 mm deep, 258.9 mm with its warm-up loop, and the P1S's plate takes 256 × 256 mm. Without its warm-up loop it fits: turn Warm-up loop off and slice again.",
  );
  // 255 × 200: 255 + 7.914 = 262.9 wide with the loop; 255 alone fits (200 ≤ 228 moves back clear of the corner).
  assert.equal(
    refusalWords(await refusal(255, 200, true, false)),
    "The part is 255 mm wide, 262.9 mm with its warm-up loop, and the P1S's plate takes 256 × 256 mm. Without its warm-up loop it fits: turn Warm-up loop off and slice again.",
  );
  // The front-left corner, both on: 222 + 2 × 8.672 = 239.3 each way. With the brim alone 222 + 2 × 4.714 = 231.4 ≤ 238
  // moves right clear, so turning the loop off is enough.
  assert.equal(
    refusalWords(await refusal(222, 222, true, true)),
    "The part is 222 × 222 mm, 239.3 × 239.3 mm with Better grip's brim and its warm-up loop, and reaches into the P1S plate's front-left corner, which must stay clear, with no room on the plate to move it clear. Without its warm-up loop it fits: turn Warm-up loop off and slice again.",
  );
  // 240 × 240 with the loop doesn't fit without it either (over 238 wide and 228 deep): what fits with the loop,
  // 238 − 7.914 = 230.1 wide or 228 − 7.914 = 220.1 deep.
  assert.equal(
    refusalWords(await refusal(240, 240, true, false)),
    "The part is 240 × 240 mm, 247.9 × 247.9 mm with its warm-up loop, and reaches into the P1S plate's front-left corner, which must stay clear, with no room on the plate to move it clear. Make it smaller or turn it so it clears the corner (with its warm-up loop, up to 230.1 mm wide or 220.1 mm deep fits).",
  );
  // The front strip, 100 × 248 with the loop: 255.914 deep, 248 itself. The refusal doesn't give the width, and 248 is
  // over 228 (too deep to move back clear of the corner), so it fits without the loop only if at most 238 wide.
  assert.equal(
    refusalWords(await refusal(100, 248, true, false)),
    "The part is 248 mm deep, 255.9 mm with its warm-up loop, and the P1S takes up to 251 mm: the front 5 mm of the plate is kept for the nozzle's prime line. Without its warm-up loop it fits if it is at most 238 mm wide: turn Warm-up loop off and slice again.",
  );
  // The brim alone, 100 × 248: y from −0.714 to 256.714, 257.4 deep; 248 itself fits without it.
  assert.equal(
    refusalWords(await refusal(100, 248, false, true)),
    "The part is 248 mm deep, 257.4 mm with Better grip's brim, and the P1S's plate takes 256 × 256 mm. Without Better grip's brim it fits: turn Better grip off and slice again.",
  );
  // Too big either way: no "turn off". 300 + 7.914 = 307.9.
  assert.equal(
    refusalWords("the part with its warm-up loop, placed at (128, 128), runs from (-25.957, 118.043) to (281.957, 137.957), off the 256 × 256 mm bed"),
    "The part is 300 mm wide, 307.9 mm with its warm-up loop, and the P1S's plate takes 256 × 256 mm. Make it smaller or split it into pieces.",
  );
  // Without the extras, the corner's and the strip's refusals are put in plain words too.
  assert.equal(
    refusalWords(await refusal(240, 240, false, false)),
    "The part is 240 × 240 mm and reaches into the P1S plate's front-left corner, which must stay clear, with no room on the plate to move it clear. Make it smaller or turn it so it clears the corner (up to 238 mm wide or 228 mm deep fits).",
  );
  assert.equal(
    refusalWords(await refusal(20, 252, false, false)),
    "The part is 252 mm deep, and the P1S takes up to 251 mm: the front 5 mm of the plate is kept for the nozzle's prime line. Make it smaller or split it into pieces.",
  );
});

test("the dialog tells the build area when the warm-up loop or Better grip is ticked", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  window.localStorage.clear();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const told: { warmUp: boolean; betterGrip: boolean }[] = [];
  const d = slicePrint(slot, { slice: async () => ({ print: { layers: 1, filamentMm: 1, filamentG: 1, printTimeS: 1, unprintedVolume: 0 }, saved: true, name: "x" }), preview: async () => {}, extrasChanged: (e) => told.push(e) });
  d.ask();
  const tick = (id: string, on: boolean) => {
    const box = doc.getElementById(id) as HTMLInputElement;
    box.checked = on;
    box.dispatchEvent(new window.Event("change") as unknown as Event);
  };
  tick("slice-print-warm-up", false);
  tick("slice-print-grip", true);
  assert.deepEqual(told, [{ warmUp: false, betterGrip: false }, { warmUp: false, betterGrip: true }]);
  await window.happyDOM.close();
});
