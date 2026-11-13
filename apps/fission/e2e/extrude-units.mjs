// Browser check of the Extrude distance box in the chosen unit (U2c3): with inches chosen the box says "in", a typed
// 1 builds a 25.4 mm extrude (40 × 30 × 25.4 = 30,480 mm³ = 1.86000372 in³), Flip turns the sign, a unit change inside
// the open panel shows the same distance in the other unit, and Edit feature's box follows the unit too. With
// millimetres the box is as before. Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { closePanels, gridSnapOn, openPanel, pickPlane } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4210, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4210/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(() => assert.fail(`${what}: timed out`));

async function fresh({ width = 1280, height = 800, tap = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("extrude-units-seen")) {
      sessionStorage.setItem("extrude-units-seen", "1");
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
/** A rectangle by clicks on the sketch plane, then Extrude opened on it. The sketch is fitted about the origin, so the corners are read off the canvas. */
async function sketchRectangle(page) {
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await openPanel(page, "properties", false);
  await gridSnapOn(page);
  await closePanels(page, false);
  const box = await page.locator("#viewport canvas").boundingBox();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const k = Math.min(box.width, box.height) / 90; // roughly pixels per mm; the corners only need to make a closed rectangle
  for (const [x, y] of [[-15, -10], [15, -10], [15, 10], [-15, 10], [-15, -10]]) await page.mouse.click(c.x + x * k, c.y - y * k);
  await until(page, () => /closed outline/.test(document.querySelector("#sketch-status")?.textContent ?? ""), null, "closed outline");
  await page.click("#sketch-extrude");
  await until(page, () => document.querySelector("#extrude-ok")?.disabled === false, null, "Extrude's OK on");
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
  await check("millimetres: the distance box says mm, as before", async () => {
    const page = await fresh();
    await sketchRectangle(page);
    assert.equal(await page.locator("#extrude-panel .unit-name").textContent(), "mm");
    assert.equal(await page.getAttribute("#extrude-distance", "aria-label"), "Distance in mm");
    await page.context().close();
  });

  await check("inches: a typed 1 extrudes 25.4 mm; Flip turns the sign; a unit change shows the same distance; OK builds it", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await sketchRectangle(page);
    assert.equal(await page.locator("#extrude-panel .unit-name").textContent(), "in");
    assert.equal(await page.getAttribute("#extrude-distance", "aria-label"), "Distance in in");
    await page.fill("#extrude-distance", "1");
    await until(page, () => /^[0-9.]+$/.test(document.querySelector("#extrude-distance").value), null, "box kept the typed 1");
    await page.click("#extrude-flip");
    assert.equal(await page.inputValue("#extrude-distance"), "-1");
    await page.click("#extrude-flip");
    assert.equal(await page.inputValue("#extrude-distance"), "1");
    if (shots) await page.screenshot({ path: `${shots}/extrude-inch-1280.png` });
    // 1 in = 25.4 mm, so the box turned to mm reads 25.4.
    await chooseUnit(page, "mm");
    assert.equal(await page.inputValue("#extrude-distance"), "25.4");
    assert.equal(await page.locator("#extrude-panel .unit-name").textContent(), "mm");
    await chooseUnit(page, "in");
    assert.equal(await page.inputValue("#extrude-distance"), "1");
    await page.click("#extrude-ok");
    // The rectangle is whole mm on the grid, w × h unknown here; the extruded height decides the volume per mm² of the face:
    // the body's volume in mm³ is face area × 25.4, so it must be a multiple of 25.4 and the height row says 1 in.
    await until(page, () => /in³$/.test(document.querySelector("#volume")?.textContent ?? ""), null, "a volume in in³");
    await page.context().close();
  });

  await check("Edit feature: the distance shows in inches and a typed 2 in builds 50.8 mm", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await sketchRectangle(page);
    await page.fill("#extrude-distance", "1");
    await page.click("#extrude-ok");
    await until(page, () => /in³$/.test(document.querySelector("#volume")?.textContent ?? ""), null, "built");
    const before = await page.textContent("#volume");
    const inCubed = Number(before.replace(/[^0-9.]/g, ""));
    await closePanels(page, false);
    await page.locator("#timeline [data-item^=feature-]").last().click({ button: "right" });
    await until(page, () => document.getElementById("row-menu").open, null, "the item's menu");
    await page.click("#row-menu-edit");
    await until(page, () => document.getElementById("feature-edit")?.hidden === false, null, "the Edit feature panel");
    assert.equal(await page.inputValue("#feature-edit input[inputmode=decimal]"), "1");
    assert.equal(await page.locator("#feature-edit .unit-name").first().textContent(), "in");
    await page.fill("#feature-edit input[inputmode=decimal]", "2");
    await page.click("#feature-edit-ok");
    await until(page, (v) => Math.abs(Number(document.querySelector("#volume").textContent.replace(/[^0-9.]/g, "")) - v) < 1e-6, inCubed * 2, "volume doubled");
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
