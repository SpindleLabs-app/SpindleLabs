// Browser check of the Design defaults (U2b): Settings > Design chooses the grid size and Snap to grid a new sketch starts
// with; a size the kernel won't take (0, empty, text, under 1 µm, over 1 km) is refused in words and the last good one
// stays; the choice is kept through a reload; the AI row takes you to the assistant's provider settings.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { pickPlane, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4216, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4216/";
const browser = await launch();
const errors = [];
let failed = false;

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("defaults-e2e-seen")) {
      sessionStorage.setItem("defaults-e2e-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks#design`);
  await page.locator("#start-hint").waitFor();
  return page;
}
async function openSettings(page) {
  if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
}
async function closeSettings(page) {
  await page.click("#settings .close");
  await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));
}
async function newSketch(page) {
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true", null, { timeout: 5000 });
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
const GRID = "#settings [data-section=design] .grid-size";
const NOTE = "#settings [data-section=design] .grid-note";

try {
  await check("a new sketch starts on the built-in 10 mm grid with snap off", async () => {
    const page = await fresh();
    await startWithBox(page);
    await newSketch(page);
    assert.equal(await page.inputValue("#sketch-grid"), "10");
    assert.equal(await page.isChecked("#sketch-grid-snap"), false);
    await page.context().close();
  });

  await check("a grid size and snap chosen in Settings start every new sketch, and survive a reload", async () => {
    const page = await fresh();
    await openSettings(page);
    assert.equal(await page.inputValue(GRID), "10");
    await page.fill(GRID, "2.5");
    await page.dispatchEvent(GRID, "change");
    await page.check("#settings .grid-snap input");
    await closeSettings(page);
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem("spindlelabs-settings") ?? "{}");
      return s.gridSize === 2.5 && s.gridSnap === true;
    });
    await page.reload();
    await page.locator("#start-hint").waitFor();
    await startWithBox(page);
    await newSketch(page);
    assert.equal(await page.inputValue("#sketch-grid"), "2.5");
    assert.equal(await page.isChecked("#sketch-grid-snap"), true);
    await page.context().close();
  });

  await check("refused sizes keep the last good one and say why; inches show and read in inches", async () => {
    const page = await fresh();
    await openSettings(page);
    for (const [bad, words] of [["0", /more than 0 mm/], ["", /Type the grid size/], ["ten", /Type the grid size/], ["0.0009", /at least 0\.001 mm/], ["1100000", /at most 1000000 mm/]]) {
      await page.fill(GRID, bad);
      await page.dispatchEvent(GRID, "change");
      assert.match(await page.textContent(NOTE), words, `"${bad}"`);
      assert.equal(await page.inputValue(GRID), "10", `"${bad}" kept 10`);
    }
    await page.fill(GRID, "0.0011");
    await page.dispatchEvent(GRID, "change");
    assert.equal(await page.textContent(NOTE), "", "1.1 times the limit is taken");
    await page.fill(GRID, "25.4");
    await page.dispatchEvent(GRID, "change");
    await page.click("#settings [data-unit=in]");
    assert.equal(await page.inputValue(GRID), "1");
    assert.equal(await page.textContent("#settings .grid-unit"), " in");
    await page.fill(GRID, "0.5");
    await page.dispatchEvent(GRID, "change");
    await closeSettings(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gridSize), "12.7");
    await page.context().close();
  });

  await check("the AI row closes Settings and shows the assistant's provider settings", async () => {
    const page = await fresh();
    await openSettings(page);
    await page.click("#settings .settings-ai button");
    await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));
    await page.locator(".ai-settings").waitFor({ state: "visible" });
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
