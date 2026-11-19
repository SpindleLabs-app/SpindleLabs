// Browser check of the sketch's typed-size boxes in the chosen unit (U2c3): with inches chosen the Length box says
// "in", shows the live length in inches, a typed 1 locks a 25.4 mm line, the Angle box stays degrees, a bad size is
// refused in inches, and a unit change with a length typed shows the same length in the other unit. Millimetres are
// as before (typed-entry.mjs). SL #519: in inches the Grid box shows and reads inches, a dimension's label reads 1 for
// a 25.4 mm line, and in millimetres "1 in" typed in the Length box draws a 25.4 mm line. Run with `npm run e2e` (after
// `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { TOP, clickPlane, screenPoint } from "./sketch-screen.mjs";
import { closePanels, gridSnapOn, openPanel, sheetsClearFor, startWithBox, pickPlane } from "./start.mjs";

const server = await preview({ preview: { port: 4213, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4213/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(() => assert.fail(`${what}: timed out`));
const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("sketch-units-seen")) {
      sessionStorage.setItem("sketch-units-seen", "1");
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
/** A sketch on the ground plane from the top, 1 mm grid with snap, as typed-entry.mjs. */
async function sketch(page) {
  await page.click("#create-sketch");
  await openPanel(page, "properties", false);
  await pickPlane(page, "XY", false);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await gridSnapOn(page);
  await closePanels(page, false);
  await page.waitForTimeout(600);
}
async function hover(page, [x, y]) {
  const box = await page.locator("#viewport canvas").boundingBox();
  const p = screenPoint(box, [x, y, 0], TOP);
  await page.mouse.move(p.x, p.y);
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
  await check("millimetres: the Length box says mm", async () => {
    const page = await fresh();
    await sketch(page);
    await clickPlane(page, [0, 0]);
    await hover(page, [20, 0]);
    await page.locator("#typed-entry").waitFor();
    assert.equal(await page.getAttribute("#typed-length", "aria-label"), "Length (mm)");
    assert.equal(await page.locator("label[data-field=length] .typed-entry-unit").textContent(), "mm");
    await page.context().close();
  });

  await check("inches: Length says in, a typed 1 is a 25.4 mm line, a bad size is refused in inches, a unit change converts", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await sketch(page);
    await clickPlane(page, [0, 0]);
    await hover(page, [20, 0]);
    await page.locator("#typed-entry").waitFor();
    assert.equal(await page.getAttribute("#typed-length", "aria-label"), "Length (in)");
    assert.equal(await page.getAttribute("#typed-angle", "aria-label"), "Angle (°)");
    // A 20 mm line is 0.787 in (20 / 25.4 = 0.7874).
    await until(page, () => document.querySelector("#typed-length")?.getAttribute("placeholder") === "0.787", null, "the live length in inches");
    await page.keyboard.press("1");
    assert.equal(await page.inputValue("#typed-length"), "1");
    assert.equal(await page.isVisible("label[data-field=length] .typed-entry-lock"), true, "the 1 in is locked");
    await until(page, () => document.querySelector("#viewport").dataset.sketchPreview === "0,0 25.4,0", null, "a 25.4 mm preview").catch(async (e) => assert.fail(`${e.message} shown "${await data(page, "sketchPreview")}"`));
    if (shots) await page.screenshot({ path: `${shots}/sketch-inch-1280.png` });
    // A unit change with the box holding 1 in: it holds the same length in millimetres.
    await chooseUnit(page, "mm");
    await page.locator("#typed-entry").waitFor({ state: "attached" });
    if (await page.isVisible("#typed-entry")) assert.equal(await page.inputValue("#typed-length"), "25.4");
    await page.context().close();
  });

  await check("inches: 0 is refused in inches' words and locks nothing", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await sketch(page);
    await clickPlane(page, [0, 0]);
    await hover(page, [20, 0]);
    await page.locator("#typed-entry").waitFor();
    await page.keyboard.press("0");
    await until(page, () => /more than 0 in/.test(document.querySelector("label[data-field=length] .typed-entry-error")?.textContent ?? ""), null, "the refusal in inches");
    await page.context().close();
  });

  await check("SL #519: inches in the Grid box and a dimension's label; '1 in' typed in millimetres", async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await sketch(page);
    // The Grid box: the grid in inches, "in" after it; 0.5 typed is a 12.7 mm grid (0.5 x 25.4), shown 12.7 in mm.
    await openPanel(page, "properties", false);
    assert.match((await page.locator(".sketch-grid").textContent()).trim(), / in$/);
    await page.fill("#sketch-grid", "0.5");
    await page.press("#sketch-grid", "Enter");
    await page.locator("#sketch-grid").blur();
    await until(page, () => document.querySelector("#sketch-grid-error")?.hidden !== false, null, "the 0.5 in grid taken");
    assert.equal(await page.inputValue("#sketch-grid"), "0.5");
    if (shots) await page.screenshot({ path: `${shots}/sketch-grid-inch-1280.png` });
    await chooseUnit(page, "mm");
    await openPanel(page, "properties", false);
    assert.equal(await page.inputValue("#sketch-grid"), "12.7", "the same grid, 12.7 mm");
    assert.match((await page.locator(".sketch-grid").textContent()).trim(), / mm$/);
    // Back to a 1 mm grid, then a line typed "1 in" in millimetres: 25.4 mm (it was "isn't a length").
    await page.fill("#sketch-grid", "1");
    await page.locator("#sketch-grid").blur();
    await closePanels(page, false);
    await page.waitForTimeout(300);
    await clickPlane(page, [0, 0]);
    await hover(page, [20, 0]);
    await page.locator("#typed-entry").waitFor();
    await page.keyboard.type("1 in");
    await until(page, () => document.querySelector("#viewport").dataset.sketchPreview === "0,0 25.4,0", null, "a 25.4 mm preview").catch(async (e) => assert.fail(`${e.message} shown "${await data(page, "sketchPreview")}"`));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    // The line dimensioned as drawn (25.4 mm): in inches its label reads 1, never 25.4.
    await chooseUnit(page, "in");
    await page.click("#sketch-tool-dimension");
    await until(page, () => document.querySelector("#sketch-tool-dimension")?.getAttribute("aria-pressed") === "true", null, "Dimension pressed");
    await hover(page, [12.7, 0]);
    const box = await page.locator("#viewport canvas").boundingBox();
    const mid = screenPoint(box, [12.7, 0, 0], TOP);
    await page.mouse.click(mid.x, mid.y);
    await until(page, () => document.activeElement?.id === "typed-length", null, "the Length box has the keys");
    await page.keyboard.type("1");
    await page.keyboard.press("Enter");
    await until(page, () => [...document.querySelectorAll(".sketch-label")].map((l) => l.textContent).join("|") === "1", null, "the label reads 1").catch(async (e) =>
      assert.fail(`${e.message}: "${await page.evaluate(() => [...document.querySelectorAll(".sketch-label")].map((l) => l.textContent).join("|"))}"`));
    if (shots) await page.screenshot({ path: `${shots}/sketch-label-inch-1280.png` });
    // Choosing millimetres says the same dimension as 25.4.
    await chooseUnit(page, "mm");
    await until(page, () => [...document.querySelectorAll(".sketch-label")].map((l) => l.textContent).join("|") === "25.4", null, "the label reads 25.4 in mm");
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
