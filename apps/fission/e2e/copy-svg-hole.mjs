// Copy as SVG of a plate with a hole (export hunt 2026-11-12, SL #639 item 3): a 60 x 40 rectangle with a circle of
// radius 10 inside it, drawn with the real tools, was refused ("Sketch 1 has no closed outline: the sketch makes 2
// separate loops"), though Extrude takes the same sketch. It copies as one path of two closed pieces, 60 mm by
// 40 mm, the hole as four quarter arcs of radius 10. Chromium only (the clipboard is read back).
// Needs `?test-hooks` for the camera. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { gridSnapOn, pickPlane } from "./start.mjs";

if (browserName !== "chromium") {
  console.log(`copy-svg-hole: skipped in ${browserName} (reads the clipboard back)`);
  process.exit(0);
}
const PORT = 4799;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
let failed = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 640 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.goto(`http://localhost:${PORT}/?test-hooks`);
  await page.locator("#start-hint").waitFor();
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
  await gridSnapOn(page);
  await page.waitForTimeout(600);
  // Clicks placed by the app's own camera, read before each one (the view may refit; its field of view is 45°).
  const at = async ([x, y]) => {
    await page.waitForTimeout(400);
    const cam = await page.evaluate(() => window.fissionTest.camera());
    const box = await page.locator("#viewport canvas").boundingBox();
    const half = (cam.position[2] - cam.target[2]) * Math.tan(Math.PI / 8);
    await page.mouse.click(box.x + box.width / 2 + ((x - cam.target[0]) / half) * (box.height / 2), box.y + box.height / 2 - ((y - cam.target[1]) / half) * (box.height / 2));
  };
  await page.click("#sketch-tool-rectangle");
  await at([0, 0]);
  await at([60, 40]);
  await page.click("#sketch-tool-circle");
  await at([30, 20]);
  await at([40, 20]);
  await page.waitForTimeout(500);
  await page.click("#finish-sketch");
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching !== "true");
  await page.evaluate(() => document.querySelectorAll("#browser details").forEach((d) => d.setAttribute("open", "")));
  const row = (await page.$$eval("#browser [data-node^='sketches/']", (r) => r.map((e) => e.dataset.node)))[0];
  await page.click(`#browser [data-node="${row}"]`);
  await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
  await page.click("#selection-actions [data-action='design.copy-svg']");
  await page.waitForFunction(() => document.querySelector("#action-note")?.textContent !== "");
  const said = await page.textContent("#action-note");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`  Copy as SVG said: ${said}\n  clipboard: ${clip.slice(0, 260)}`);
  try {
    assert.match(clip, /^<svg/, `a plate with a hole is not copied as SVG; the app said: "${said}"`);
    assert.match(clip, /width="60mm" height="40mm"/);
    assert.equal((clip.match(/Z/g) ?? []).length, 2, "the plate and its hole: two closed pieces");
    assert.equal((clip.match(/A10 10 /g) ?? []).length, 4, "the hole's four quarter arcs of radius 10");
    console.log("ok - a rectangle with a circle inside copies as SVG, with its hole");
  } catch (e) {
    failed++;
    console.log(`not ok - a rectangle with a circle inside copies as SVG, with its hole\n  ${e.message}`);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
