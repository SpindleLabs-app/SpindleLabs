// Browser check of the colour theme (U1b, U2a): Settings > Theme (follow the device, light, dark) is stored and applied, the page wears the
// theme before it first paints, the 3D view's sky follows it, and the guide stays a dark scene in both.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4200, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4200/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
let failed = false;

/** A new page on a device that prefers `scheme`, optionally with a stored Theme choice (kept across reloads of this context). */
async function fresh(scheme, { width = 1280, height = 720, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("theme-e2e-seen")) {
      sessionStorage.setItem("theme-e2e-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
    // When data-theme is first put on the root, was there a body yet? (No body: it ran in the head, before the first paint.)
    window.__themeSetBeforeBody = null;
    new MutationObserver(() => {
      if (window.__themeSetBeforeBody === null && document.documentElement.dataset.theme) window.__themeSetBeforeBody = document.body === null;
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector("#settings-open", { state: "attached" });
  await page.waitForTimeout(1200); // the 3D view's first frames
  return page;
}
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
/** Relative luminance (0 to 1) of the pixel at (x, y) of the page, read from a screenshot. */
async function luminanceAt(page, x, y) {
  const png = decodePng(await page.screenshot({ clip: { x, y, width: 1, height: 1 } }));
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = png.data[i] / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
async function openSettings(page) {
  if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
}
const choice = (page, id) => page.locator(`#settings [data-choice=${id}]`);
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
  await check("a dark device with nothing chosen is dark: Follow device is the ticked choice, the sky and the page are dark", async () => {
    const page = await fresh("dark");
    assert.equal(await theme(page), "dark");
    assert.ok((await luminanceAt(page, 640, 120)) < 0.1, "the sky is dark");
    await openSettings(page);
    assert.equal(await choice(page, "device").getAttribute("aria-checked"), "true");
    assert.equal(await choice(page, "light").getAttribute("aria-checked"), "false");
    await page.context().close();
  });

  await check("a light device with nothing chosen is light before the first paint, and its sky is pale", async () => {
    const page = await fresh("light");
    assert.equal(await theme(page), "light");
    assert.equal(await page.evaluate(() => window.__themeSetBeforeBody), true, "the theme was set while the page was still in its head");
    assert.equal(await page.getAttribute('meta[name="theme-color"]', "content"), "#e6eaf1");
    assert.ok((await luminanceAt(page, 640, 120)) > 0.6, "the sky is pale");
    assert.ok((await luminanceAt(page, 600, 20)) > 0.6, "the top bar is pale");
    if (shots) await page.screenshot({ path: `${shots}/theme-light-1280.png` });
    await page.context().close();
  });

  await check("choosing Light, then Dark: each applies at once, the sky follows, the choice survives a reload against the device", async () => {
    const page = await fresh("dark");
    await openSettings(page);
    await choice(page, "light").click();
    assert.equal(await theme(page), "light");
    assert.equal(await choice(page, "light").getAttribute("aria-checked"), "true");
    assert.equal(await choice(page, "device").getAttribute("aria-checked"), "false");
    await page.click("#settings .close");
    await page.waitForTimeout(400);
    assert.ok((await luminanceAt(page, 640, 120)) > 0.6, "the sky turned pale without a reload");
    await page.reload();
    await page.waitForSelector("#settings-open", { state: "attached" });
    assert.equal(await theme(page), "light", "kept after a reload, though the device is dark");
    await openSettings(page);
    await choice(page, "dark").click();
    assert.equal(await theme(page), "dark");
    await page.click("#settings .close");
    await page.waitForTimeout(400);
    assert.ok((await luminanceAt(page, 640, 120)) < 0.1, "the sky is dark again");
    await page.context().close();
  });

  await check("Follow device tracks the device while it is chosen, and a light or dark choice ignores it", async () => {
    const page = await fresh("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(200);
    assert.equal(await theme(page), "light", "the device turned light");
    await openSettings(page);
    await choice(page, "dark").click();
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(200);
    assert.equal(await theme(page), "dark", "Dark ignores the device");
    await page.context().close();
  });

  await check("the guide stays a dark scene in the light theme (its words and its page)", async () => {
    const page = await fresh("light");
    await page.click("#guide-open");
    await page.waitForSelector(".guide[open]");
    await page.waitForTimeout(600);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".guide")).backgroundColor);
    const [r, g, b] = bg.match(/[\d.]+/g).map(Number);
    assert.ok(r + g + b < 200, `the guide's page is dark, not ${bg}`);
    await page.context().close();
  });

  await check("375 px: the Theme row fits, no sideways scroll, each choice a 44 px target; Light turns the phone light", async () => {
    const page = await fresh("dark", { width: 375, height: 667, touch: true });
    await openSettings(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
    for (const id of ["device", "light", "dark"]) {
      const box = await choice(page, id).boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 375, `${id}: ${JSON.stringify(box)}`);
    }
    await choice(page, "light").tap();
    assert.equal(await theme(page), "light");
    if (shots) await page.screenshot({ path: `${shots}/theme-settings-375.png` });
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
