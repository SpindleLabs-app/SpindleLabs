// Browser check of the Move and Rotate boxes in the chosen unit (U2c3): with inches chosen the distance and pivot
// boxes say "in" (the angles stay degrees), the pivot of the box (20, 15, 10 mm) reads 0.787, 0.591, 0.394, a typed
// 1 in along X moves the body 25.4 mm (the STL's x runs 25.4 to 65.4), the same Move reopened by Edit feature shows
// 1, and a unit change in the open panel shows the same lengths in the other unit. Millimetres are as before.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";
import { closePanels, sheetsClearFor, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4212, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4212/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(() => assert.fail(`${what}: timed out`));

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("move-units-seen")) {
      sessionStorage.setItem("move-units-seen", "1");
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
async function pickBox(page) {
  await closePanels(page, false);
  const box = await page.locator("#viewport canvas").boundingBox();
  const s = screenPoint(box, [6, 4, 20], HOME); // near a corner of the top: the handles stand at the middle
  await page.mouse.click(s.x, s.y);
  await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked");
}
const boxes = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#move-panel input")].map((i) => [i.id.slice(5), i.value])));
const legends = (page) => page.$$eval("#move-panel .move-panel-legend", (e) => e.map((x) => x.textContent));
async function stlX(page) {
  await closePanels(page, false);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#toolbar [data-op=export_stl]")]);
  const bytes = readFileSync(await dl.path());
  const xs = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) xs.push(bytes.readFloatLE(84 + 50 * t + 12 + 12 * k));
  return [Math.min(...xs), Math.max(...xs)];
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
  await check("millimetres: Move's legends say mm, the pivot is 20, 15, 10, as before", async () => {
    const page = await fresh();
    await page.click("#move");
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel");
    await pickBox(page);
    assert.deepEqual(await legends(page), ["Distance (mm)", "Angle (°)", "Pivot (mm)"]);
    const b = await boxes(page);
    assert.deepEqual([b.pivotX, b.pivotY, b.pivotZ], ["20", "15", "10"]);
    await page.context().close();
  });

  await check("inches: pivot reads 0.787, 0.591, 0.394; a typed 1 in moves the body 25.4 mm; a unit change keeps the same lengths; Edit feature shows 1", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await page.click("#move");
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel");
    await pickBox(page);
    assert.deepEqual(await legends(page), ["Distance (in)", "Angle (°)", "Pivot (in)"]);
    const b = await boxes(page);
    // 20 / 25.4 = 0.7874, 15 / 25.4 = 0.5906, 10 / 25.4 = 0.3937 (inches to 3 decimals).
    assert.deepEqual([b.pivotX, b.pivotY, b.pivotZ], ["0.787", "0.591", "0.394"]);
    await page.fill("#move-x", "1");
    if (shots) await page.screenshot({ path: `${shots}/move-inch-1280.png` });
    await chooseUnit(page, "mm");
    assert.equal(await page.inputValue("#move-x"), "25.4", "1 in is 25.4 mm");
    assert.equal((await boxes(page)).pivotX, "20", "the pivot is exact in mm again, not 20.0002");
    await chooseUnit(page, "in");
    assert.equal(await page.inputValue("#move-x"), "1");
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");
    await until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");
    const [lo, hi] = await stlX(page);
    assert.ok(Math.abs(lo - 25.4) < 1e-3 && Math.abs(hi - 65.4) < 1e-3, `x ${lo}..${hi}, want 25.4..65.4`);
    // Edit feature on the Move: the box shows 1 in again.
    await page.locator('#timeline [data-item="feature-2"]').click({ button: "right" });
    await until(page, () => document.getElementById("row-menu").open, null, "the item's menu");
    await page.click("#row-menu-edit");
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel on the Move");
    assert.equal(await page.inputValue("#move-x"), "1");
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
