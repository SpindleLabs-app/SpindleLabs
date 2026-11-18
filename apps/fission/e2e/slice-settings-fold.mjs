// Browser check of Slice for printing's folded printer settings (Ben 2026-11-16): the file, plate, nozzle, quality,
// walls, infill and the fits line sit in one section that starts closed, showing one line of words (the preset's
// settings, kept up to date as they change); Supports, Warm-up loop and Better grip stay in view outside it and never
// mark a preset "(changed)"; opened or closed is remembered across a reload. At 1280 px with clicks, at 375 px with taps.
// Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4192, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4192/";
const browser = await launch();
const shots = process.env.SHOTS;
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

for (const [width, tap] of [[1280, false], [375, true]]) {
  await check(`${width} px${tap ? ", taps" : ""}: printer settings start folded to a line; Supports and the ticks stay out and never mark a preset changed; open or closed is remembered`, async () => {
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    const visible = (sel) => page.$eval(sel, (e) => e.checkVisibility() && e.getBoundingClientRect().height > 0);
    const open = async () => {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
    };
    try {
      await page.goto(url);
      await startWithBox(page, tap);
      await open();
      // Folded by default: the one line says the settings; the lists are hidden; Supports and the ticks are not.
      assert.equal(await page.$eval(".slice-print-settings", (d) => d.open), false);
      assert.equal(await page.textContent("#slice-print-settings-words"), "Bambu Lab P1S · Textured PEI plate · 0.4 mm Standard · 0.2 mm layers · 2 walls · 15 % infill");
      for (const id of ["slice-print-format", "slice-print-plate", "slice-print-nozzle", "slice-print-quality", "slice-print-walls", "slice-print-infill"]) assert.equal(await visible(`#${id}`), false, `${id} folded away`);
      for (const id of ["slice-print-supports", "slice-print-warm-up", "slice-print-grip"]) assert.equal(await visible(`#${id}`), true, `${id} stays in view`);
      if (shots) await page.screenshot({ path: `${shots}/fold-${width}-closed.png` });
      // Save a preset, then change the three per-print choices: not "changed". A printer setting is (opened first).
      await press("#slice-presets-save-as");
      await page.fill("#slice-presets-name", "home P1S");
      await press("#slice-presets-name-ok");
      await page.selectOption("#slice-print-supports", "tree");
      await press("#slice-print-warm-up");
      await press("#slice-print-grip");
      assert.deepEqual(await page.$$eval("#slice-presets-list option", (os) => os.map((o) => o.textContent)), ["No preset", "home P1S"]);
      await press(".slice-print-settings summary");
      assert.equal(await page.$eval(".slice-print-settings", (d) => d.open), true);
      assert.equal(await visible("#slice-print-quality"), true);
      await page.selectOption("#slice-print-walls", "3");
      assert.deepEqual(await page.$$eval("#slice-presets-list option", (os) => os.map((o) => o.textContent)), ["No preset", "home P1S (changed)"]);
      if (shots) await page.screenshot({ path: `${shots}/fold-${width}-open.png` });
      // Closed again, the line follows the change.
      await press(".slice-print-settings summary");
      assert.equal(await page.textContent("#slice-print-settings-words"), "Bambu Lab P1S · Textured PEI plate · 0.4 mm Standard · 0.2 mm layers · 3 walls · 15 % infill");
      assert.equal(await page.evaluate(() => localStorage.getItem("spindlelabs.slice.settings-open")), "closed");
      // Open it, reload: it opens open.
      await press(".slice-print-settings summary");
      await page.waitForFunction(() => localStorage.getItem("spindlelabs.slice.settings-open") === "open");
      await page.reload();
      await startWithBox(page, tap);
      await open();
      assert.equal(await page.$eval(".slice-print-settings", (d) => d.open), true, "left open, it opens open");
    } finally {
      await context.close();
    }
  });
}

await browser.close();
await server.close();
if (failed) process.exit(1);
