// Browser check of Printer fits (fit-calibration.ts, fits.ts, fit-piece.ts; P13, Ben 2026-11-05): from Slice for
// printing, Printer fits opens over it; Download test piece slices the test piece with the real engine and saves a
// P1S print file; the seven caliper numbers of a worked printer show what they mean before saving (the M3 bolt's
// clearance hole printed at 3.92 mm to come out 3.40 mm), a slipped number is refused in words, and Save keeps them
// in this browser for the nozzle chosen, so the fits line says "measured" after a reload too. Escape closes Printer
// fits and leaves Slice for printing open. At a desktop width with clicks and a phone's with taps: nothing sideways
// off the screen. Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4320, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4320/";
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

// The worked printer of fits.test.ts: shrink 99.6 %; plate 119.76; pegs 5.38, 10.26, 15.18; holes 4.48, 9.56, 14.64.
const WORKED = { "fit-cal-length": "119.76", "fit-cal-peg-5": "5.38", "fit-cal-peg-10": "10.26", "fit-cal-peg-15": "15.18", "fit-cal-hole-5": "4.48", "fit-cal-hole-10": "9.56", "fit-cal-hole-15": "14.64" };

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: download the test piece, type the measures, see the sizes, save, and the fits line says measured after a reload`, async () => {
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    const open = async () => {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
    };
    const onScreen = async (sel) => {
      const r = await page.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
      assert.ok(r.left >= 0 && r.right <= width + 0.5 && r.width > 0, `${sel} on screen: ${JSON.stringify(r)}`);
    };
    try {
      await page.goto(url);
      await startWithBox(page, tap);
      await open();
      assert.match(await page.textContent("#slice-print-fits-words"), /^Fits: typical sizes for the Standard nozzle \(not measured yet\)\.$/);
      await onScreen("#slice-print-fits-open");
      if (shots) await page.screenshot({ path: `${shots}/fits-${width}-slice-line.png` });
      await press("#slice-print-fits-open");
      await page.waitForSelector("#fit-cal-dialog[open]");
      assert.match(await page.textContent("#fit-cal-result"), /^Typical for a P1S with PLA \(an estimate/);
      // Nothing runs off the side.
      assert.equal(await page.$eval("#fit-cal-dialog", (d) => d.scrollWidth <= d.clientWidth), true, "no sideways scroll in Printer fits");
      for (const id of Object.keys(WORKED)) await onScreen(`#${id}`);
      for (const id of ["fit-cal-download", "fit-cal-save", "fit-cal-close"]) await onScreen(`#${id}`);
      if (shots) await page.screenshot({ path: `${shots}/fits-${width}-open.png` });

      // The test piece: the real engine slices it, and the P1S file is a ZIP with the plate's G-code in it.
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), press("#fit-cal-download")]);
      await page.waitForFunction(() => document.getElementById("fit-cal-result")?.textContent.startsWith("Saved"), null, { timeout: 120_000 });
      assert.equal(d.suggestedFilename(), "fit-test-piece-0.2mm-2w-15pc-textured.gcode.3mf");
      const bytes = await readFile(await d.path());
      assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "a ZIP");
      assert.ok(bytes.includes(Buffer.from("Metadata/plate_1.gcode")), "with the plate's G-code");
      assert.match(await page.textContent("#fit-cal-result"), /^Saved fit-test-piece-.*\. Print it, then type what you measure below\.$/);

      // A slipped 10 mm hole (6.56): refused in words, nothing kept.
      for (const [id, v] of Object.entries({ ...WORKED, "fit-cal-hole-10": "6.56" })) await page.fill(`#${id}`, v);
      assert.match(await page.textContent("#fit-cal-result"), /^The 10 mm hole was measured as 6\.56 mm, too far from 10\.00 mm/);
      assert.equal(await page.$eval("#fit-cal-save", (b) => b.disabled), true);
      if (shots) await page.screenshot({ path: `${shots}/fits-${width}-refused.png` });

      // The worked printer: what it means, shown before saving, then kept.
      await page.fill("#fit-cal-hole-10", WORKED["fit-cal-hole-10"]);
      assert.match(await page.textContent("#fit-cal-result"), /^Measured on your printer: shrinks to 99\.60 %.* Not saved yet\.$/);
      assert.equal(await page.textContent("#fit-cal-examples li"), "clearance for an M3 bolt: 3.00 mm in the design, should come out 3.40 mm, printed at 3.92 mm");
      if (shots) await page.screenshot({ path: `${shots}/fits-${width}-typed.png` });
      await press("#fit-cal-save");
      assert.match(await page.textContent("#fit-cal-result"), /^Saved\. Measured on your printer/);
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("spindlelabs.fits.standard") ?? "null"));
      assert.deepEqual(kept.measured, { length: 119.76, pegs: [5.38, 10.26, 15.18], holes: [4.48, 9.56, 14.64] });
      assert.match(await page.textContent("#slice-print-fits-words"), /^Fits: measured on your printer on .* \(Standard nozzle\)\.$/);
      if (shots) await page.screenshot({ path: `${shots}/fits-${width}-saved.png` });

      // Escape closes Printer fits only.
      await page.keyboard.press("Escape");
      assert.equal(await page.$eval("#fit-cal-dialog", (e) => e.open), false);
      assert.equal(await page.$eval("#slice-print-dialog", (e) => e.open), true, "Slice for printing stays open");

      // After a reload: still measured, and the numbers are back in the boxes.
      await page.reload();
      await startWithBox(page, tap);
      await open();
      assert.match(await page.textContent("#slice-print-fits-words"), /^Fits: measured on your printer/);
      await press("#slice-print-fits-open");
      await page.waitForSelector("#fit-cal-dialog[open]");
      assert.equal(await page.inputValue("#fit-cal-peg-15"), "15.18");
    } finally {
      await context.close();
    }
  });
}

await browser.close();
await server.close();
if (errors.length) {
  failed++;
  console.log(`not ok - page errors:\n  ${errors.join("\n  ")}`);
}
if (failed) process.exit(1);
