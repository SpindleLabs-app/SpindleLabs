// The slicing engine on the shipped kernel build, through a design's bodies (SP5b2c: moved from slice-print.test.ts when
// Design's Slice for printing dialog went): a 20 mm cube's slice and P1S file, brim and warm-up loops, supports under a plate
// on a column, the words a slice is described in (worked by hand), file names, the heights note and refusals.
// The page's own tests are in workspaces/slice/test; the Chromium checks in apps/fission/e2e.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playback, type SlicedPrint, type SliceProgress } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { bodyIdOf, insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { createHash } from "node:crypto";
import { fileNameFor } from "@fission/ui";
import { printFileOf, sliceBodies } from "./slice-bodies-lib.ts";
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

function layerMoves(gcode: string): string[] {
  const start = gcode.indexOf(";LAYER_CHANGE");
  const first = gcode.indexOf(";TYPE:", start);
  const end = gcode.search(/;===== end|; end/);
  return gcode
    .slice(first, end)
    .split("\n")
    .filter((l) => /^G[0-3] /.test(l))
    .map((l) => l.split(/\s+/).filter((w) => !w.startsWith("F")).join(" "));
}

function apartFromArcs(file: string[], plain: string[]): string {
  const word = (l: string, k: string) => l.split(" ").find((w) => w.startsWith(k))?.slice(1);
  let j = 0;
  for (const [i, l] of file.entries()) {
    if (!/^G[23] /.test(l)) {
      if (plain[j] !== l) return `move ${i}: ${l} is ${plain[j]} in the plain slice`;
      j += 1;
      continue;
    }
    const end = `X${word(l, "X")} Y${word(l, "Y")}`;
    let e = 0;
    let n = 0;
    while (j < plain.length && plain[j].startsWith("G1 ") && word(plain[j], "E") !== undefined && Number(word(plain[j], "E")) > 0) {
      e += Number(word(plain[j], "E"));
      n += 1;
      j += 1;
      if (plain[j - 1].startsWith(`G1 ${end} `)) break;
    }
    if (n < 2 || !plain[j - 1].startsWith(`G1 ${end} `)) return `arc ${i}: ${l} ends nowhere the plain slice's run does`;
    const arc = Number(word(l, "E"));
    if (Math.abs(arc - e) > 1e-4 * e + 1e-5 * (n + 1)) return `arc ${i}: ${l} lays ${arc} where the run lays ${e}`;
  }
  return j === plain.length ? "" : `the plain slice has ${plain.length - j} moves more`;
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
  // Two code paths agreeing: the same layer moves as the plain slice of the same choices, apart from the P1S file's
  // round runs (the warm-up loop's corners) sent as arcs, which the plain G-code never uses (not every printer reads
  // them); 3 walls differ, so the comparison can fail.
  const plain = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  assert.match(gcode, /^G[23] /m, "the P1S file sends arcs");
  assert.doesNotMatch(plain.gcode, /^G[23] /m, "the plain G-code doesn't");
  assert.equal(apartFromArcs(layerMoves(gcode), layerMoves(plain.gcode)), "");
  const three = await sliceBodies(kernel, doc, bodyFeatures(doc), { ...PRINT_DEFAULTS, walls: 3 });
  assert.notEqual(apartFromArcs(layerMoves(gcode), layerMoves(three.gcode)), "");
  // The comparison catches an arc laying the wrong plastic, or ending somewhere else.
  const moves = layerMoves(gcode);
  const k = moves.findIndex((l) => /^G[23] /.test(l));
  const bent = (f: (l: string) => string) => moves.map((l, i) => (i === k ? f(l) : l));
  assert.match(apartFromArcs(bent((l) => l.replace(/E([\d.]+)/, (_, e) => `E${(Number(e) * 1.01).toFixed(5)}`)), layerMoves(plain.gcode)), /lays/);
  assert.match(apartFromArcs(bent((l) => l.replace(/X([\d.]+)/, (_, x) => `X${(Number(x) + 0.1).toFixed(3)}`)), layerMoves(plain.gcode)), /ends nowhere/);
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
  assert.equal(refusalOf("plain words"), "Plain words");
});
