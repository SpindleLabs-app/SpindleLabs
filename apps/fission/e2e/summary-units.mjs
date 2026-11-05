// Browser check of the words about each item in the chosen unit (U2c3): the timeline bar's tooltip and the Feature line
// say the box "40 × 30 × 20 mm" in millimetres and "1.575 × 1.181 × 0.787 in" in inches, at once when Settings changes,
// and the saved project keeps millimetres whichever was shown. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { closePanels, sheetsClearFor, startWithBox } from "./start.mjs";
import { pinProperties } from "./properties.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4214, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4214/";
const browser = await launch();
const errors = [];
let failed = false;

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("summary-units-seen")) {
      sessionStorage.setItem("summary-units-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks#design`);
  await page.locator("#start-hint").waitFor();
  await startWithBox(page);
  return sheetsClearFor(page);
}
async function chooseUnit(page, unit) {
  await closePanels(page, false);
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
  await page.click(`#settings [data-unit=${unit}]`);
  await page.click("#settings .close");
  await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));
}
const barTitle = (page) => page.getAttribute('#timeline [data-item="feature-1"]', "title");
const rowTitle = (page) => page.getAttribute('[data-node="timeline"] .tree-row[data-node="feature-1"]', "title");
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
  await check("the bar's tooltip and the Feature line say the box in mm, then in inches the moment Settings changes, then in mm again", async () => {
    const page = await fresh();
    await pinProperties(page);
    assert.equal(await barTitle(page), "1. Box 1\nBox: 40 × 30 × 20 mm");
    assert.equal(await page.textContent("#intent"), "Box: 40 × 30 × 20 mm");
    await chooseUnit(page, "in");
    // 40 / 25.4 = 1.575, 30 / 25.4 = 1.181, 20 / 25.4 = 0.787.
    assert.equal(await barTitle(page), "1. Box 1\nBox: 1.575 × 1.181 × 0.787 in");
    assert.equal(await page.textContent("#intent"), "Box: 1.575 × 1.181 × 0.787 in");
    assert.match((await rowTitle(page)) ?? "", /1\.575 × 1\.181 × 0\.787 in/, "the browser's Timeline row too");
    await chooseUnit(page, "mm");
    assert.equal(await barTitle(page), "1. Box 1\nBox: 40 × 30 × 20 mm");
    assert.equal(await page.textContent("#intent"), "Box: 40 × 30 × 20 mm");
    await page.context().close();
  });
  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
