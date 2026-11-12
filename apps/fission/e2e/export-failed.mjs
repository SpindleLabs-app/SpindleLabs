// Browser check of export hunt 2026-11-12 D (SL #613): a design whose hole failed (failed-hole.spindle: a 40 × 30 ×
// 20 box with a circle r 5 sketched on its top face and Extrude Cut 10 mm into it, which fails while booleans take
// flat faces only) exports a box without its hole. Export STL must say that Extrude 1 failed and is not in the file
// (amber card "Not the whole design", never "Checked solid", the file unstamped), and Slice for printing must say it
// as the dialog opens. At 1280 and 375 px (taps). SHOTS=<dir> also saves screenshots.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { chooseFile, closePanels } from "./start.mjs";

const server = await preview({ preview: { port: 4413, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4413/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
const project = readFileSync(new URL("./failed-hole.spindle", import.meta.url));

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

const MISSING_STL = "Extrude 1 failed, so it is not in the STL: the part is saved without it. Fix it in the timeline (red) to include it.";
const MISSING_PRINT = "Extrude 1 failed, so it is not in the print: the part is printed without it. Fix it in the timeline (red) to include it.";

try {
  for (const width of [1280, 375]) {
    const tap = width < 700;
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, acceptDownloads: true });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.waitForSelector("#open-file", { state: "attached" });
    await page.setInputFiles("#open-file", { name: "failed-hole.spindle", mimeType: "application/octet-stream", buffer: project });
    // The Cut's item goes red once the rebuild has tried it.
    await page.waitForFunction(() => [...document.querySelectorAll("#timeline li[data-item]")].some((li) => li.dataset.failed === "true"), null, { timeout: 20000 });
    if (tap) await closePanels(page, tap);

    await check(`Export STL names the failed Cut, never "Checked solid", and leaves the file unstamped (${width} px)`, async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl", tap)]);
      await page.waitForFunction(() => document.getElementById("solid-badge")?.hidden === false);
      const bytes = readFileSync(await download.path());
      // The box alone: 12 triangles, 80 + 4 + 12 · 50 = 684 bytes; its header never says checked.
      assert.equal(bytes.length, 684);
      assert.ok(!bytes.subarray(0, 80).toString("latin1").includes("checked solid"));
      const b = await page.evaluate(() => {
        const el = document.getElementById("solid-badge");
        return { state: el.dataset.state, title: el.querySelector("h2").textContent, detail: el.querySelector(".solid-badge-detail").textContent };
      });
      assert.equal(b.state, "missing");
      assert.equal(b.title, "Not the whole design");
      assert.ok(b.detail.startsWith(`${MISSING_STL} What was built is solid.`), b.detail);
      assert.equal(await page.textContent("#action-note"), `Exported spindlelabs-box.stl. ${MISSING_STL} What was built is checked solid.`);
      if (shots) await page.screenshot({ path: `${shots}/export-failed-${width}.png` });
      await (tap ? page.tap("#solid-badge-close") : page.click("#solid-badge-close"));
    });

    await check(`Slice for printing says the failed Cut is not in the print as it opens (${width} px)`, async () => {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      assert.equal(await page.textContent("#slice-print-missing"), MISSING_PRINT);
      assert.ok(await page.isVisible("#slice-print-missing"));
      if (shots) await page.screenshot({ path: `${shots}/slice-failed-${width}.png` });
      await (tap ? page.tap("#slice-print-close") : page.click("#slice-print-close"));
    });
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.log(`FAIL no page errors\n  ${errors.join("\n  ")}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
