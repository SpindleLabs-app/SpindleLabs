// Browser check of the Custom theme (Ben, 2026-11-04): Settings > Theme > Custom shows three colour pickers with hex boxes (primary, secondary, highlight);
// each applies at once, text stays readable (a too-close primary is nudged and says so), it survives a reload before the first paint,
// the 3D view's sky takes the secondary, Reset goes back to the standard colours, and another theme takes every custom colour off.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4202, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4202/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

async function fresh({ width = 1280, height = 720 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("custom-e2e-seen")) {
      sessionStorage.setItem("custom-e2e-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector("#settings-open", { state: "attached" });
  await page.waitForTimeout(1000);
  return page;
}
async function openSettings(page) {
  if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
}
const hexBox = (page, key) => page.locator(`#settings [data-colour=${key}] .settings-custom-hex`);
const rootVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
async function setHex(page, key, value) {
  await hexBox(page, key).fill(value);
}
async function pixel(page, x, y) {
  const png = decodePng(await page.screenshot({ clip: { x, y, width: 1, height: 1 } }));
  return [png.data[0], png.data[1], png.data[2]];
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

try {
  await check("Custom shows the three pickers; the others hide them; each hex applies at once", async () => {
    const page = await fresh();
    await openSettings(page);
    assert.equal(await page.locator("#settings .settings-custom").isVisible(), false, "hidden until Custom is chosen");
    await page.click("#settings [data-choice=custom]");
    assert.equal(await page.locator("#settings .settings-custom").isVisible(), true);
    assert.equal(await page.locator("#settings .settings-custom-row").count(), 3);
    // The standard custom colours are the dark theme itself.
    assert.equal(await rootVar(page, "--page"), "#0f141c");
    await setHex(page, "highlight", "#ff8800");
    assert.equal(await rootVar(page, "--accent"), "#ff8800");
    // A half-typed hex waits; a refused one says so and keeps the last good colour.
    await setHex(page, "highlight", "#ff88");
    assert.equal(await rootVar(page, "--accent"), "#ff8800");
    await hexBox(page, "highlight").blur();
    assert.match(await page.locator("#settings .settings-custom-notes").textContent(), /not a hex colour/);
    if (shots) await page.screenshot({ path: `${shots}/custom-settings-1280.png` });
    await page.context().close();
  });

  await check("a light primary makes a light theme with the page that colour; a mid grey is nudged and says so", async () => {
    const page = await fresh();
    await openSettings(page);
    await page.click("#settings [data-choice=custom]");
    await setHex(page, "primary", "#fdf6e3");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    assert.equal(await rootVar(page, "--page"), "#fdf6e3");
    await setHex(page, "primary", "#808080");
    const notes = await page.locator("#settings .settings-custom-notes").textContent();
    assert.match(notes, /Primary #808080 was too close to the colour of the words/);
    assert.notEqual(await rootVar(page, "--page"), "#808080");
    await page.context().close();
  });

  await check("the secondary colours the 3D view's sky, and it all survives a reload (worn before the first paint)", async () => {
    const page = await fresh();
    const before = await pixel(page, 700, 130);
    await openSettings(page);
    await page.click("#settings [data-choice=custom]");
    await setHex(page, "primary", "#ffffff");
    await setHex(page, "secondary", "#f4b0d0"); // a pink: Ben's old sky, now on purpose
    await page.click("#settings .close");
    await page.waitForTimeout(700);
    const sky = await pixel(page, 700, 130);
    assert.ok(sky[0] > sky[2], `the sky is pink now: ${sky}`);
    assert.notDeepEqual(sky, before);
    if (shots) await page.screenshot({ path: `${shots}/custom-pink-1280.png` });
    // Reload: the root wears it before the body exists.
    await page.addInitScript(() => {
      window.__customBeforeBody = null;
      new MutationObserver(() => {
        if (window.__customBeforeBody === null && document.documentElement.dataset.customVars) window.__customBeforeBody = document.body === null;
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-custom-vars"] });
    });
    await page.reload();
    await page.waitForSelector("#settings-open", { state: "attached" });
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => window.__customBeforeBody), true, "the custom colours were on before the first paint");
    assert.equal(await rootVar(page, "--page"), "#ffffff");
    const again = await pixel(page, 700, 130);
    assert.ok(again[0] > again[2], `still pink after the reload: ${again}`);
    await page.context().close();
  });

  await check("Reset goes back to the standard colours; Dark and Light take every custom colour off", async () => {
    const page = await fresh();
    await openSettings(page);
    await page.click("#settings [data-choice=custom]");
    await setHex(page, "highlight", "#ff8800");
    await setHex(page, "primary", "#ffffff");
    await page.click("#settings .settings-custom .settings-action");
    assert.equal(await rootVar(page, "--accent"), "#4aa8ff");
    assert.equal(await rootVar(page, "--page"), "#0f141c");
    assert.equal(await hexBox(page, "primary").inputValue(), "#0f141c");
    await setHex(page, "highlight", "#ff8800");
    await page.click("#settings [data-choice=light]");
    assert.equal(await page.evaluate(() => document.documentElement.style.cssText), "", "no inline custom colours left");
    assert.equal(await page.locator("#settings .settings-custom").isVisible(), false);
    assert.equal(await rootVar(page, "--accent"), "#0063bf", "the light theme's own blue");
    await page.context().close();
  });

  await check("375 px: the Custom block fits, no sideways scroll, 44 px pickers", async () => {
    const page = await fresh({ width: 375, height: 667 });
    await openSettings(page);
    await page.click("#settings [data-choice=custom]");
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(scroll <= 0, `sideways scroll ${scroll}`);
    const box = await page.locator("#settings .settings-custom-picker").first().boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${box.width} x ${box.height}`);
    const hex = await page.locator("#settings .settings-custom-hex").first().boundingBox();
    assert.ok(hex.x + hex.width <= 375, "the hex box is inside the screen");
    if (shots) await page.screenshot({ path: `${shots}/custom-settings-375.png` });
    await page.context().close();
  });
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.log("browser errors:\n  " + [...new Set(errors)].join("\n  "));
  failed = true;
}
process.exit(failed ? 1 : 0);
