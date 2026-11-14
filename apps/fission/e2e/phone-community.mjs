// Browser check of SL #522 items 4 and 5 (app bug hunt 2026-11-11) on a phone, 375 × 667 with taps and a keyboard:
// 4. Menu > Community shows the Community page over the whole area under the top bar, with no Properties pill and no
//    3D view showing (it was inside the shut Properties sheet, over Design's box); Community again goes back to Design
//    with its view and pills.
// 5. Escape puts the AI sheet away (it stayed), and Menu > Community with the AI sheet open puts it away (it stayed over
//    the Community page). At 1280 px the AI panel sits beside the view and Escape leaves it open, as before.
// SHOTS=dir saves screenshots. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4362, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4362/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(() => assert.fail(`${what}: timed out`));
async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  return page;
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
const menu = async (page, id) => {
  await page.tap("#menu-toggle");
  await page.tap(`#${id}`);
};
/** The share of the 3D view's box that `sel` covers, from their boxes on screen. */
async function covers(page, sel) {
  return page.evaluate((s) => {
    const a = document.querySelector("#viewport").getBoundingClientRect();
    const el = document.querySelector(s);
    if (!el || el.offsetParent === null) return 0;
    const b = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return (w * h) / (a.width * a.height);
  }, sel);
}

try {
  await check("375 px: Menu > Community fills the view with its page, no Properties pill; again goes back to Design", async () => {
    const page = await fresh(375, 667, true);
    assert.equal(await page.isVisible("#properties-toggle"), true, "Design shows its Properties pill");
    await menu(page, "community");
    await until(page, () => document.body.dataset.activeWorkspace === "community", null, "Community shown");
    await page.locator("#properties .placeholder h2", { hasText: "Community" }).waitFor();
    assert.equal(await page.isVisible("#properties .placeholder h2"), true, "the Community page shows without a tap on Properties");
    assert.ok((await covers(page, "#properties")) > 0.95, `the page covers the view (${await covers(page, "#properties")})`);
    assert.equal(await page.isVisible("#properties-toggle"), false, "no Properties pill");
    // The page's own words, under the top bar and reachable.
    const box = await page.locator("#properties .placeholder .coming-soon").boundingBox();
    assert.ok(box && box.y > 40 && box.y < 667, `Coming soon on screen at ${box?.y}`);
    if (shots) await page.screenshot({ path: `${shots}/community-375.png` });
    await menu(page, "community");
    await until(page, () => document.body.dataset.activeWorkspace === "design", null, "back to Design");
    assert.equal(await page.isVisible("#properties-toggle"), true, "Design's Properties pill back");
    assert.ok((await covers(page, "#properties")) < 0.01, "the Properties sheet shut again over Design");
    await page.context().close();
  });

  await check("375 px: Escape puts the AI sheet away; Menu > Community with it open puts it away", async () => {
    const page = await fresh(375, 667, true);
    await menu(page, "assistant-toggle");
    await until(page, () => !document.getElementById("assistant").hidden, null, "the AI sheet open");
    await page.keyboard.press("Escape");
    await until(page, () => document.getElementById("assistant").hidden, null, "Escape put the AI sheet away");
    await menu(page, "assistant-toggle");
    await until(page, () => !document.getElementById("assistant").hidden, null, "the AI sheet open again");
    await menu(page, "community");
    await until(page, () => document.body.dataset.activeWorkspace === "community", null, "Community shown");
    assert.equal(await page.isHidden("#assistant"), true, "the AI sheet went with Community");
    assert.equal(await page.isVisible("#properties .placeholder h2"), true);
    await page.context().close();
  });

  await check("1280 px: the AI panel beside the view stays open on Escape; Community shows its card as before", async () => {
    const page = await fresh(1280, 800, false);
    await page.click("#assistant-toggle");
    await until(page, () => !document.getElementById("assistant").hidden, null, "the AI panel open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(await page.isVisible("#assistant"), true, "Escape is Design's at 1280 px");
    await page.click("#community");
    await page.locator("#properties .placeholder h2", { hasText: "Community" }).waitFor();
    assert.ok((await covers(page, "#properties")) < 0.6, "a card over the view, not a page over all of it");
    if (shots) await page.screenshot({ path: `${shots}/community-1280.png` });
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
