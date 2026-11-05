// Browser check of the print check (H1, Ben 2026-11-05): Inspect ▾ Print
// check, off at first, paints what would go wrong printing the bodies shown.
// A 30 × 30 × 2 mm plate on a 10 mm column: its underside (one face, two
// triangles) needs supports, so the view turns red under it (pixels counted
// from below, against the same view with the check off) and the legend says
// "Needs supports: about 800 mm²" (900 less the column's 100 under it). Hiding the plate (Body 2) leaves the column,
// which prints as it is: the legend says so at once. The choice is kept on
// reload and adds no undo step; off, nothing is painted. At a desktop width
// with clicks and a phone's with taps (the Inspect menu where the button is
// scrolled away).
// Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4211, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4211/";
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

const plateOnColumn = readFileSync(new URL("./plate-on-column.spindle", import.meta.url));
const found = (page) => page.evaluate(() => document.querySelector("#viewport")?.dataset.printCheck ?? null);
const legend = (page) => page.$$eval(".overlay-legend:not([hidden]) li", (ls) => ls.map((l) => l.textContent));
/** The view's pixels that are clearly red (the supports' colour, shaded): red well over green and blue. */
async function redPixels(page) {
  const png = await page.locator("#viewport canvas").first().screenshot();
  return page.evaluate(async (bytes) => {
    const img = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 120 && d[i] > 1.8 * d[i + 1] && d[i] > 1.8 * d[i + 2]) n++;
    return n;
  }, [...png]);
}

for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: Print check paints the plate's underside red with its area, follows a hidden body, is kept on reload, and goes off`, async () => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    const toggle = async () => {
      if (await page.isVisible("#inspect-print-check")) return press("#inspect-print-check");
      await press("#inspect-menu");
      await page.locator("#inspect-menu-print-check").waitFor();
      await press("#inspect-menu-print-check");
    };
    const settled = () => page.waitForFunction(() => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, { timeout: 15000 });
    try {
      await page.goto(url);
      await page.setInputFiles("#open-file", { name: "plate.spindle", mimeType: "application/octet-stream", buffer: plateOnColumn });
      await page.waitForFunction(() => document.querySelectorAll("#timeline li[data-item]").length === 3, null, { timeout: 15000 });
      await settled();
      // Look from below, where the underside is: drag the view cube's way, up across the view.
      const box = await page.locator("#viewport canvas").first().boundingBox();
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(cx, cy + 60);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 120, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      // Off at first: nothing found, no legend, no red.
      assert.equal(await found(page), null);
      assert.deepEqual(await legend(page), []);
      const redOff = await redPixels(page);
      const undoBefore = await page.getAttribute("#undo", "title");
      await toggle();
      // A 30 × 30 mm underside, two triangles, nothing under it but the column's 10 × 10 mm top: both marked, 800 mm² hang.
      await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.printCheck === "supports 2 thin 0 sag 0 weakest 0");
      assert.deepEqual(await legend(page), ["Needs supports: about 800 mm²"]);
      assert.equal(await page.getAttribute("#inspect-print-check", "aria-pressed"), "true");
      assert.equal(await page.getAttribute("#undo", "title"), undoBefore, "no undo step for a view setting");
      const redOn = await redPixels(page);
      assert.ok(redOn > redOff + 2000, `the underside turns red: ${redOff} red pixels off, ${redOn} on`);
      if (shots) await page.screenshot({ path: `${shots}/print-check-${width}-supports.png` });
      // Hide the plate: the column alone prints as it is, said at once.
      await openPanel(page, "browser", tap);
      await press('#browser [data-eye="body-2"]');
      await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.printCheck === "supports 0 thin 0 sag 0 weakest 0");
      assert.deepEqual(await legend(page), ["Print check: nothing to fix (P1S, 0.2 mm layers)"]);
      await press('#browser [data-eye="body-2"]');
      await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.printCheck === "supports 2 thin 0 sag 0 weakest 0");
      await closePanels(page, tap);
      // Kept on reload (this browser's choice; the test's start empties the saved design, so it is opened again).
      await page.reload();
      await page.setInputFiles("#open-file", { name: "plate.spindle", mimeType: "application/octet-stream", buffer: plateOnColumn });
      await page.waitForFunction(() => document.querySelectorAll("#timeline li[data-item]").length === 3, null, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.printCheck === "supports 2 thin 0 sag 0 weakest 0", null, { timeout: 15000 });
      assert.equal(await page.getAttribute("#inspect-print-check", "aria-pressed"), "true");
      // Off: nothing painted, no legend.
      await toggle();
      await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.printCheck === undefined);
      assert.deepEqual(await legend(page), []);
      assert.equal(await page.getAttribute("#inspect-print-check", "aria-pressed"), "false");
    } finally {
      await context.close();
    }
  });
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
server.httpServer.close();
if (failed > 0) process.exit(1);
