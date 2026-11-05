// Browser check of Exploded view (Ben, 2026-11-04): Inspect ▾ Exploded view
// draws the bodies pulled apart, view only. 1280 px with a mouse: off with
// one body; with a box and a cylinder it turns on (pressed, its bar shown,
// the view drawn differently), the Spread slider moves them further, Done
// draws them where they were, and nothing goes on Undo; a tool opening
// (Move) turns it off. 375 px with taps: from Inspect ▾, the bar fits the
// screen, takes little of the view, and its Done is finger-sized.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { insertPreset, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4302, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4302/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await pinProperties(page);
  await startWithBox(page, touch);
  return sheetsClearFor(page);
}

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const exploded = (page) => page.evaluate(() => document.querySelector("#viewport").dataset.exploded ?? "");
/** The view's pixels now, after two frames so a redraw has landed. */
async function view(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.locator("#viewport canvas").screenshot();
}

/** Adds a cylinder by Insert ▾ and waits for its Body 2 row. */
async function addCylinder(page, tap = false) {
  await insertPreset(page, "cylinder", tap);
  await until(page, () => document.getElementById("undo").title.startsWith("Undo Insert"), null, "the cylinder inserted");
  await until(page, () => [...document.querySelectorAll("#browser *")].some((e) => e.textContent?.trim() === "Body 2"), null, "Body 2's row");
}

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  await check("1280 px: off with one body; with two it pulls them apart, the slider spreads them further, Done puts the view back, nothing recorded, and Move turns it off", async () => {
    const page = await fresh();
    assert.equal(await page.isDisabled("#inspect-explode"), true, "Exploded view is on with one body");
    await page.click("#inspect-menu");
    assert.match((await page.getAttribute("#inspect-menu-explode", "title")) ?? "", /Exploded view/);
    await page.keyboard.press("Escape");
    await addCylinder(page);
    await until(page, () => !document.getElementById("inspect-explode").disabled, null, "Exploded view on with two bodies");
    const undoBefore = await page.getAttribute("#undo", "title");
    const together = await view(page);
    await page.click("#inspect-explode");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "0.5", null, "exploded at half");
    assert.equal(await page.getAttribute("#inspect-explode", "aria-pressed"), "true");
    assert.equal(await page.isVisible("#explode-bar"), true, "the bar shows");
    assert.equal(await page.inputValue("#explode-spread"), "50");
    const apart = await view(page);
    assert.notDeepEqual(apart, together, "the view is drawn the same exploded");
    await shot(page, "explode-1280");
    // The slider to 100: further apart still.
    await page.locator("#explode-spread").fill("100");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "1", null, "spread 1");
    const further = await view(page);
    assert.notDeepEqual(further, apart, "Spread 100 draws the same as 50");
    assert.equal(await page.getAttribute("#undo", "title"), undoBefore, "Exploded view went on Undo");
    // Done: the bodies drawn where they are again.
    await page.click("#explode-done");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "", null, "off");
    assert.equal(await page.isVisible("#explode-bar"), false);
    assert.equal(await page.getAttribute("#inspect-explode", "aria-pressed"), "false");
    assert.deepEqual(await view(page), together, "Done did not draw the bodies where they were");
    // On again, then Move: the tool works on the bodies where they are, so the view goes back.
    await page.click("#inspect-explode");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "0.5", null, "on again");
    await page.click("#modify-menu");
    await page.click("#modify-menu-move");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "", null, "Move turned it off");
    assert.equal(await page.isVisible("#explode-bar"), false);
    await page.context().close();
  });

  await check("375 px with taps: from Inspect ▾, its bar fits the screen and takes little of the view, Done finger-sized", async () => {
    const page = await fresh(375, true);
    await addCylinder(page, true);
    await page.tap("#inspect-menu");
    await until(page, () => !document.getElementById("inspect-menu-explode")?.hasAttribute("aria-disabled") && !document.getElementById("inspect-menu-explode")?.disabled, null, "the menu's entry on");
    await page.tap("#inspect-menu-explode");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "0.5", null, "exploded");
    const bar = await page.locator("#explode-bar").boundingBox();
    const v = await page.locator("#viewport").boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 375, `the bar is off screen at ${JSON.stringify(bar)}`);
    assert.ok(bar.width * bar.height < 0.15 * v.width * v.height, `the bar covers ${Math.round((100 * bar.width * bar.height) / (v.width * v.height))}% of the view`);
    const done = await page.locator("#explode-done").boundingBox();
    assert.ok(done.height >= 44, `Done is ${done.height} px tall`);
    await shot(page, "explode-375");
    await page.tap("#explode-done");
    await until(page, () => document.querySelector("#viewport").dataset.exploded === "", null, "off");
    await page.context().close();
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
