// Browser check of issue #517 (app bug hunt 2026-11-11, A2): a rectangle
// drawn from a body's corner keeps its sides square. On the XY plane over
// the 40 × 30 × 20 box at the origin, a rectangle from (0, 0), the box's
// corner, to (20, 10): its corner (20, 0) lands on the front bottom edge's
// middle, so both bottom corners are pinned to the box. Before the fix it
// kept 1 of its 4 Horizontal and Vertical constraints; now 3 (the bottom
// side lies on the box's edge, both its ends held by the box). Extruded 10
// it is 20 × 10 × 10 = 2,000 mm³; the box typed 60 wide moves the edge's
// middle to (30, 0) and the block follows as a rectangle, 30 × 10 × 10 =
// 3,000 mm³ (before: a trapezoid of (30 + 20) / 2 × 10 × 10 = 2,500).
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { clickPlane } from "./sketch-screen.mjs";
import { pinProperties } from "./properties.mjs";
import { gridSnapOn, pickPlane, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4198/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) =>
  page.waitForFunction(fn, arg, { timeout: 10000 }).catch(async () => {
    const shown = await page.evaluate(() => `status "${document.querySelector("#sketch-status")?.textContent}", points "${document.querySelector("#viewport").dataset.sketchPoints}", constraints "${document.querySelector("#viewport").dataset.sketchConstraints}", volume "${document.querySelector("#volume")?.textContent}"`);
    assert.fail(`${what}: timed out; the page shows ${shown}`);
  });
const volume = (page, want, what) => until(page, (w) => Math.abs(parseFloat((document.querySelector("#volume")?.textContent ?? "").replace(/,/g, "")) - w) < 1e-3, want, what);
const row = (page, body) => page.locator(`#browser .tree-row[data-node="body-${body}"], #browser .tree-row[data-node="bodies/body-${body}"]`).first();

let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await startWithBox(page);
  await pinProperties(page);
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await gridSnapOn(page);
  await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0));
  await page.click("#sketch-tool-rectangle");
  await clickPlane(page, [0, 0]);
  await clickPlane(page, [20, 10]);
  await until(page, () => document.querySelector("#viewport").dataset.sketchPoints === "0,0 20,0 20,10 0,10", null, "the rectangle drawn");
  // Three of its four sides squared: the bottom one lies on the box's edge, both ends held by the box.
  await until(page, () => document.querySelector("#viewport").dataset.sketchConstraints === "3", null, "3 constraints kept (1 before the fix)");
  if (shots) await page.screenshot({ path: `${shots}/face-corner-rectangle-1280.png` });
  await page.keyboard.press("Escape");
  await page.click("#sketch-extrude");
  await until(page, () => document.querySelector("#extrude-ok")?.disabled === false, null, "Extrude's OK on");
  await page.fill("#extrude-distance", "10");
  await page.click("#extrude-ok");
  await volume(page, 2000, "the block 20 × 10 × 10");
  // The box typed 60 wide: the front edge's middle goes to (30, 0), and the block with it.
  await page.evaluate(() => document.querySelectorAll("#browser details").forEach((d) => (d.open = true)));
  await row(page, 1).click();
  await page.fill("#width", "60");
  await page.press("#width", "Enter");
  await volume(page, 36000, "the box 60 × 30 × 20");
  await row(page, 2).click();
  await volume(page, 3000, "the block 30 × 10 × 10, a rectangle still (a trapezoid's 2,500 before the fix)");
  if (shots) await page.screenshot({ path: `${shots}/face-corner-followed-1280.png` });
  console.log("PASS a rectangle from the box's corner keeps 3 sides squared and follows the box made 60 wide as a rectangle (3,000 mm³)");
  await context.close();
} catch (e) {
  failed = true;
  console.log(`FAIL a rectangle from the box's corner\n  ${e.message.split("\n").join("\n  ")}`);
}

try {
  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
}
await browser.close();
await server.close();
if (failed) process.exit(1);
console.log("PASS face corner constraints");
