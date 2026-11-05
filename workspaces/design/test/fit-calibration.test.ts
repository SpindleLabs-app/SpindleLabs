// Printer fits' dialog (fit-calibration.ts) and its line in Slice for
// printing (slice-print.ts): typing the numbers, what it says, saving and
// forgetting per nozzle, and the test piece's download.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_BOXES, fitCalibration, fitsLine, typedMm } from "../src/fit-calibration.ts";
import { fitKey, keptMeasures, profileFor, TYPICAL_PROFILE } from "../src/fits.ts";
import { slicePrint, type FileChoices, type PrintChoices } from "../src/slice-print.ts";

const { Window } = await import("happy-dom");

// The worked printer of fits.test.ts: length 119.76; pegs 5.38, 10.26, 15.18; holes 4.48, 9.56, 14.64.
const WORKED = ["119.76", "5.38", "10.26", "15.18", "4.48", "9.56", "14.64"];

function setup(nozzle: "standard" | "high-flow" = "standard") {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const storage = window.localStorage as unknown as Storage;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const pieces: boolean[] = [];
  let changes = 0;
  let piece: () => Promise<{ saved: boolean; name: string }> = async () => ({ saved: true, name: "fit-test-piece.gcode.3mf" });
  const state = { nozzle };
  const d = fitCalibration(slot, storage, {
    nozzle: () => state.nozzle,
    testPiece: (alive) => (pieces.push(alive()), piece()),
    changed: () => changes++,
    now: () => new Date("2026-11-05T04:00:00Z"),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const type = (values: readonly string[]) =>
    FIT_BOXES.forEach((b, i) => {
      const input = $<HTMLInputElement>(b.id);
      input.value = values[i] ?? "";
      input.dispatchEvent(new window.Event("input") as unknown as Event);
    });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { d, doc, storage, $, type, settle, pieces, state, changes: () => changes, setPiece: (f: typeof piece) => (piece = f) };
}

test("typed numbers: a point or a comma, spaces round it; anything else is not a number", () => {
  assert.equal(typedMm("15.18"), 15.18);
  assert.equal(typedMm(" 15,18 "), 15.18);
  assert.equal(typedMm("15"), 15);
  assert.equal(typedMm(".5"), 0.5);
  for (const bad of ["", "abc", "15.1.8", "-3", "1e2", "15 mm", "Infinity", "0x10"]) assert.ok(Number.isNaN(typedMm(bad)), bad);
});

test("opened with nothing kept: the typical sizes, said to be an estimate, with what common fits would print at", () => {
  const t = setup();
  t.d.ask();
  assert.equal(t.d.open, true);
  assert.match(t.$("fit-cal-result").textContent!, /^Typical for a P1S with PLA \(an estimate/);
  // Typical: holes close 0.2 a side under 5 mm, so an M3 bolt's 3.40 clearance is printed at 3.40 + 0.40 = 3.80.
  const items = [...t.$("fit-cal-examples").children].map((li) => li.textContent);
  assert.equal(items[0], "clearance for an M3 bolt: 3.00 mm in the design, should come out 3.40 mm, printed at 3.80 mm");
  assert.equal(items.length, 3);
  assert.equal(t.$<HTMLButtonElement>("fit-cal-save").disabled, true);
  assert.equal(t.$<HTMLButtonElement>("fit-cal-forget").disabled, true);
  // Says plainly that tagging holes comes next.
  assert.match(t.$("fit-cal-soon").textContent!, /^Coming next: tag a hole or peg/);
});

test("typing the worked piece shows what it means before saving; Save keeps it for this nozzle only", () => {
  const t = setup();
  t.d.ask();
  t.type(WORKED);
  assert.equal(t.$("fit-cal-result").textContent, "Measured on your printer: shrinks to 99.60 %; outsides grow 0.15 mm on each side, holes close in 0.20 mm on each side (at 10 mm). Not saved yet.");
  // fits.test.ts' hand-worked M3: 3.9 / 0.996 = 3.9157 → 3.92.
  assert.match(t.$("fit-cal-examples").children[0]!.textContent!, /printed at 3\.92 mm$/);
  assert.equal(keptMeasures(t.storage, "standard"), null, "nothing kept before Save");
  t.$("fit-cal-save").click();
  assert.match(t.$("fit-cal-result").textContent!, /^Saved\. Measured on your printer/);
  assert.equal(t.changes(), 1);
  assert.deepEqual(keptMeasures(t.storage, "standard")!.measured, { length: 119.76, pegs: [5.38, 10.26, 15.18], holes: [4.48, 9.56, 14.64] });
  assert.equal(profileFor(t.storage, "high-flow"), TYPICAL_PROFILE);
  // Opened again: the numbers kept are in the boxes.
  t.$("fit-cal-close").click();
  t.d.ask();
  assert.deepEqual(FIT_BOXES.map((b) => t.$<HTMLInputElement>(b.id).value), WORKED);
  // Use typical forgets it.
  assert.equal(t.$<HTMLButtonElement>("fit-cal-forget").disabled, false);
  t.$("fit-cal-forget").click();
  assert.equal(keptMeasures(t.storage, "standard"), null);
  assert.equal(t.changes(), 2);
  assert.deepEqual(FIT_BOXES.map((b) => t.$<HTMLInputElement>(b.id).value), ["", "", "", "", "", "", ""]);
});

test("a half-typed piece asks for the rest; a slip is said in words and can't be saved", () => {
  const t = setup();
  t.d.ask();
  t.type(WORKED.slice(0, 3));
  assert.match(t.$("fit-cal-result").textContent!, /^Type all seven numbers \(3 of 7 so far\)\./);
  assert.equal(t.$("fit-cal-result").classList.contains("fit-cal-bad"), false, "not an error while still typing");
  assert.equal(t.$<HTMLButtonElement>("fit-cal-save").disabled, true);
  // The 10 mm hole typed as 6.56 (a slipped 9): refused by name, amber, Save off.
  t.type([...WORKED.slice(0, 5), "6.56", WORKED[6]!]);
  assert.match(t.$("fit-cal-result").textContent!, /^The 10 mm hole was measured as 6\.56 mm, too far from 10\.00 mm/);
  assert.equal(t.$("fit-cal-result").classList.contains("fit-cal-bad"), true);
  assert.equal(t.$<HTMLButtonElement>("fit-cal-save").disabled, true);
  assert.equal(t.$("fit-cal-examples").children.length, 0);
  // Pegs typed in the holes' boxes: caught.
  t.type([WORKED[0]!, ...WORKED.slice(4), ...WORKED.slice(1, 4)]);
  assert.match(t.$("fit-cal-result").textContent!, /look swapped/);
});

test("each nozzle has its own fits", () => {
  const t = setup("high-flow");
  t.d.ask();
  t.type(WORKED);
  t.$("fit-cal-save").click();
  assert.notEqual(t.storage.getItem(fitKey("high-flow")), null);
  assert.equal(t.storage.getItem(fitKey("standard")), null);
  assert.equal(fitsLine(t.storage, "high-flow"), "Fits: measured on your printer on 5 Nov 2026 (High Flow nozzle).");
  assert.equal(fitsLine(t.storage, "standard"), "Fits: typical sizes for the Standard nozzle (not measured yet).");
});

test("Download test piece: one at a time, says where it was saved, and a refusal in words", async () => {
  const t = setup();
  t.d.ask();
  let release!: () => void;
  t.setPiece(() => new Promise((r) => (release = () => r({ saved: true, name: "fit-test-piece-0.2mm.gcode.3mf" }))));
  t.$("fit-cal-download").click();
  t.$("fit-cal-download").click();
  assert.equal(t.pieces.length, 1, "a second press while it slices is the same piece");
  assert.equal(t.$<HTMLButtonElement>("fit-cal-download").disabled, true);
  assert.equal(t.$("fit-cal-result").textContent, "Slicing the test piece…");
  release();
  await t.settle();
  assert.equal(t.$("fit-cal-result").textContent, "Saved fit-test-piece-0.2mm.gcode.3mf. Print it, then type what you measure below.");
  t.setPiece(async () => {
    throw new Error("The engine refused it.");
  });
  t.$("fit-cal-download").click();
  await t.settle();
  assert.equal(t.$("fit-cal-result").textContent, "The engine refused it.");
  assert.equal(t.$("fit-cal-result").classList.contains("fit-cal-bad"), true);
});

test("closed while the piece slices: nothing said after", async () => {
  const t = setup();
  t.d.ask();
  let release!: () => void;
  t.setPiece(() => new Promise((r) => (release = () => r({ saved: true, name: "x" }))));
  t.$("fit-cal-download").click();
  t.$("fit-cal-close").click();
  release();
  await t.settle();
  assert.equal(t.$("fit-cal-result").textContent, "Slicing the test piece…");
  assert.equal(t.d.open, false);
});

test("keys typed in the dialog never reach the app's shortcuts", () => {
  const t = setup();
  const keys: string[] = [];
  t.doc.addEventListener("keydown", (e) => keys.push((e as KeyboardEvent).key));
  t.d.ask();
  t.$("fit-cal-length").dispatchEvent(new (t.doc.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: "e", bubbles: true }));
  assert.deepEqual(keys, []);
});

test("Slice for printing: the fits line follows the nozzle, and Printer fits gets the dialog's choices", async () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const asked: [PrintChoices, FileChoices][] = [];
  const d = slicePrint(slot, {
    slice: async () => ({ print: { layers: 1, filamentMm: 1, filamentG: 1, printTimeS: 1, unprintedVolume: 0 }, saved: true, name: "x" }),
    preview: async () => {},
    testPiece: async (c, f) => (asked.push([c, f]), { saved: true, name: "piece" }),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  d.ask();
  assert.equal($("slice-print-fits").hidden, false);
  assert.match($("slice-print-fits-words").textContent!, /^Fits: typical sizes for the (Standard|High Flow) nozzle/);
  const nozzle = $<HTMLSelectElement>("slice-print-nozzle");
  nozzle.value = "high-flow";
  nozzle.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal($("slice-print-fits-words").textContent, "Fits: typical sizes for the High Flow nozzle (not measured yet).");
  $<HTMLSelectElement>("slice-print-walls").value = "4";
  $("slice-print-fits-open").click();
  assert.equal($<HTMLDialogElement>("fit-cal-dialog").open, true);
  $("fit-cal-download").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked.length, 1);
  assert.equal(asked[0]![0].walls, 4);
  assert.equal(asked[0]![1].nozzle, "high-flow");
  // Saving fits updates the line at once.
  FIT_BOXES.forEach((b, i) => {
    const input = $<HTMLInputElement>(b.id);
    input.value = WORKED[i]!;
    input.dispatchEvent(new window.Event("input") as unknown as Event);
  });
  $("fit-cal-save").click();
  assert.match($("slice-print-fits-words").textContent!, /^Fits: measured on your printer on .* \(High Flow nozzle\)\.$/);
});

test("Slice for printing without a test piece maker offers no Printer fits", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  slicePrint(slot, { slice: async () => ({ print: { layers: 1, filamentMm: 1, filamentG: 1, printTimeS: 1, unprintedVolume: 0 }, saved: true, name: "x" }), preview: async () => {} });
  assert.equal(doc.getElementById("slice-print-fits")!.hidden, true);
  assert.equal(doc.getElementById("fit-cal-dialog"), null);
});
