// Browser check of the undo hunt's timing bugs B1 (2026-11-12; #624 item 1, #627 item 1, #622 item 4): an edit is
// settled on the kernel after it is recorded (a sketch snapped to a body's corner follows it, or keeps its last shape),
// and what is done before the kernel answers must neither leave that step as first recorded nor drop what was typed.
// The design (regressions/undo-snapped-corner.spindle): Box 1 40 × 30 × 20, Sketch 1 on XY, the outline (0, −20)
// (60, −20) (60, 40) (40, 30) with its last corner snapped to Box 1's bottom back right corner, Extrude 1 by 5. Every
// kernel request is held back `delay` ms (a phone, a bigger part), as the hunts did.
// The outline's area by the shoelace sum: ½ (1200 + 3600 + 200 − 800) = 2100 mm², so Body 2 is 2100 · 5 = 10,500 mm³.
//   - Box 1 made 80 wide, then one click on Body 2's eye before the kernel has answered, then Ctrl+Z: Undo of the eye
//     lands on the settled width: the snapped corner moves to (80, 30), the outline crosses itself, and Extrude 1 keeps
//     its last shape (warned, not red; Body 2 still 10,500 mm³) beside Box 1 at 80 · 30 · 20 = 48,000 mm³. The step as
//     first recorded had Extrude 1 red and no Body 2.
//   - "10" typed key by key in Extrude 1's distance box, then the page reloaded before the kernel has answered: the
//     reloaded page holds 10, not 1: Body 2 2100 · 10 = 21,000 mm³ (with 1 it would be 2,100).
// Run with `npm run e2e` (after `npm run build`); `E2E_BROWSER` picks the engine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";

const PORT = 4624;
const FILE = readFileSync(new URL("./regressions/undo-snapped-corner.spindle", import.meta.url));
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}
const until = (page, fn, arg, what, timeout = 20000) =>
  page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out; volume ${await page.textContent("#volume")}, undo "${await page.getAttribute("#undo", "title")}"`));

/** A page with the design opened and kept, every kernel request held back `window.kernelDelay` ms once set. */
async function opened() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      const wait = window.kernelDelay ?? 0;
      if (wait > 0 && message?.op !== undefined) return void setTimeout(() => send.call(this, message, ...rest), wait);
      return send.call(this, message, ...rest);
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "snapped.spindle", mimeType: "application/json", buffer: FILE });
  await until(page, () => document.querySelectorAll("#timeline .timeline-bar-item").length === 3 && document.querySelector("#volume")?.textContent === "10,500 mm³", null, "the design built, the boxes on Body 2: 2100 · 5");
  await until(page, () => document.querySelector("#save-status")?.dataset.state === "saved", null, "the file kept");
  await pinProperties(page);
  return { context, page, errors };
}
/** The volume the panel shows for the body row `node` clicked in the browser. */
async function bodyVolume(page, node) {
  if (!(await page.$eval("#browser .browser-fold", (d) => d.open))) await page.click("#browser .browser-fold > summary");
  await page.click(`#browser [data-node="${node}"]`);
  await page.waitForTimeout(300);
  return page.textContent("#volume");
}
const failedItems = (page) => page.evaluate(() => [...document.querySelectorAll("#timeline .timeline-bar-item")].filter((li) => li.dataset.failed).map((li) => li.dataset.item));

await check("Box 1 made 80 wide, Body 2's eye clicked before the kernel answered, then Ctrl+Z: the settled width (58,500 mm³, Extrude 1 kept, not red)", async () => {
  const { context, page, errors } = await opened();
  if (!(await page.$eval("#browser .browser-fold", (d) => d.open))) await page.click("#browser .browser-fold > summary");
  await page.click('#browser [data-node="body-1"]');
  await until(page, () => document.querySelector("#width")?.value === "40", null, "the boxes describe Box 1");
  await page.locator('#browser [data-eye="body-2"]').hover();
  await page.evaluate(() => (window.kernelDelay = 300));
  await page.evaluate(() => {
    const w = document.getElementById("width");
    w.value = "80";
    w.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.mouse.down(); // one click on Body 2's eye at once, before the kernel has answered
  await page.mouse.up();
  await page.evaluate(() => (window.kernelDelay = 0));
  await until(page, () => document.getElementById("undo").title.startsWith("Undo Hide Body 2"), null, "the eye recorded after the width");
  await page.keyboard.press("Control+z");
  await until(page, () => document.getElementById("undo").title.startsWith("Undo Change width"), null, "the eye taken back");
  await page.waitForTimeout(1000);
  assert.deepEqual(await failedItems(page), [], "nothing red: Extrude 1 keeps its last shape");
  assert.equal(await page.$eval("#kept-warning", (w) => !w.hidden), true, "the kept-shape warning shown");
  assert.equal(await bodyVolume(page, "body-1"), "48,000 mm³", "Box 1 80 wide");
  assert.equal(await bodyVolume(page, "body-2"), "10,500 mm³", "Extrude 1's kept shape");
  assert.deepEqual(errors, []);
  await context.close();
});

await check('"10" typed key by key in the distance box, then reloaded before the kernel answered: the page comes back with 10 (21,000 mm³)', async () => {
  const { context, page, errors } = await opened();
  await until(page, () => document.querySelector("#height")?.value === "5", null, "the boxes describe Extrude 1's distance");
  await page.evaluate(() => (window.kernelDelay = 400));
  await page.click("#height");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("10", { delay: 120 }); // the 1's settle is still with the kernel when the 0 is typed
  await page.reload();
  await until(page, () => document.querySelector("#volume")?.textContent === "21,000 mm³", null, "10 kept: 2100 · 10");
  assert.equal(await page.inputValue("#height"), "10");
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(failed ? 1 : 0);
