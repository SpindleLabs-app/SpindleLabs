// Browser check of the Units setting (U2c2): Settings > General > Units chooses mm or inches; the Properties size
// boxes, their label and the body's volume and area follow it at once, a size typed in inches builds the right body in
// millimetres, the choice survives a reload, and with millimetres every box is as before.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4208, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4208/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

async function fresh({ width = 1280, height = 720 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("units-e2e-seen")) {
      sessionStorage.setItem("units-e2e-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks#design`);
  await page.locator("#start-hint").waitFor();
  return page;
}
async function chooseUnit(page, unit) {
  if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
  await page.click(`#settings [data-unit=${unit}]`);
  await page.click("#settings .close");
  await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));
}
const sizes = (page) => page.evaluate(() => ["width", "depth", "height"].map((id) => document.getElementById(id).value));
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
  await check("Settings shows the Units choice, millimetres chosen, and the boxes say mm", async () => {
    const page = await fresh();
    await startWithBox(page);
    await pinProperties(page);
    assert.deepEqual(await sizes(page), ["40", "30", "20"]);
    assert.equal(await page.locator("#width-row .unit-name").textContent(), "mm");
    if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
    await page.click("#settings-open");
    await page.waitForSelector("#settings[open]");
    assert.equal(await page.getAttribute("#settings [data-unit=mm]", "aria-checked"), "true");
    assert.equal(await page.getAttribute("#settings [data-unit=in]", "aria-checked"), "false");
    assert.equal(await page.locator("#settings [data-section=general] .settings-empty").count(), 0, "no longer says units are coming");
    await page.context().close();
  });

  await check("inches: the 40 × 30 × 20 mm box shows 1.575 × 1.181 × 0.787 in, and the volume and area follow", async () => {
    const page = await fresh();
    await startWithBox(page);
    await pinProperties(page);
    await chooseUnit(page, "in");
    assert.deepEqual(await sizes(page), ["1.575", "1.181", "0.787"]);
    assert.equal(await page.locator("#height-row .unit-name").textContent(), "in");
    // 24,000 mm³ / 25.4³ (16,387.064) = 1.464569858 in³ (ten figures, as in mm); the surface 2 (40·30 + 40·20 + 30·20) = 5200 mm² / 645.16 = 8.060016120 in².
    assert.equal(await page.textContent("#volume"), "1.464569858 in³");
    assert.equal(await page.textContent("#area"), "8.06001612 in²");
    if (shots) await page.screenshot({ path: `${shots}/units-inch-1280.png` });
    await chooseUnit(page, "mm");
    assert.deepEqual(await sizes(page), ["40", "30", "20"]);
    assert.equal(await page.textContent("#volume"), "24,000 mm³");
    await page.context().close();
  });

  await check("a width of 2 typed in inches builds a 50.8 mm body (volume 50.8 × 30 × 20 = 30,480 mm³), and nothing is lost on the way back", async () => {
    const page = await fresh();
    await startWithBox(page);
    await pinProperties(page);
    await chooseUnit(page, "in");
    await page.fill("#width", "2");
    // 30,480 mm³ / 16,387.064 = 1.860003720 in³.
    await page.waitForFunction(() => document.getElementById("volume").textContent === "1.86000372 in³");
    await chooseUnit(page, "mm");
    assert.deepEqual(await sizes(page), ["50.8", "30", "20"]);
    assert.equal(await page.textContent("#volume"), "30,480 mm³");
    await page.context().close();
  });

  await check("a size too small is refused in inches, in the same words; millimetres keep the old words", async () => {
    const page = await fresh();
    await startWithBox(page);
    await pinProperties(page);
    await page.fill("#width", "0.0001");
    await page.waitForFunction(() => /at least 0\.001 mm/.test(document.getElementById("error").textContent));
    await page.fill("#width", "40");
    await chooseUnit(page, "in");
    await page.fill("#width", "0.00001"); // 0.00001 in = 0.000254 mm, under the smallest piece
    await page.waitForFunction(() => /at least 0\.0000394 in/.test(document.getElementById("error").textContent));
    assert.doesNotMatch(await page.textContent("#error"), /\bmm\b/);
    await page.context().close();
  });

  await check("the choice is kept through a reload", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("spindlelabs-settings") ?? "{}").unit === "in");
    await page.reload();
    await page.locator("#start-hint").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.unit), "in");
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
