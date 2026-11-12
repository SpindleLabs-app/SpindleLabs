// Browser check of Laser step L1b3a (behind ?laser): the part picked on the laser bed is the one selection, so it is
// the sketch picked in DesignLab, and a sketch picked in DesignLab is the part picked on the bed.
// - Two rectangles sketched (Sketch 1 and Sketch 2). In Laser a click on Sketch 2's part selects "outline:<its id>"
//   (what DesignLab's own Sketches row selects); back in DesignLab its Timeline and Sketches rows are lit.
// - Sketch 1's row clicked in DesignLab: in Laser, Sketch 1's part is picked and its numbers shown.
// - Escape in Laser lets it go everywhere: nothing selected, no row lit in DesignLab.
// - At 375 px with taps: a tap on a part selects it.
// Port 4634.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { clickPlane, TOP } from "./sketch-screen.mjs";
import { gridSnapOn, pickPlane, startWithBox } from "./start.mjs";

const PORT = 4634;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/?laser`;
const browser = await launch();
const errors = [];
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");
const pickedOnBed = (page) => page.evaluate(() => document.querySelector(".laser-flat")?.dataset.picked ?? null);
const litRows = (page) => page.$$eval("#browser .tree-row[aria-current=true]", (rows) => rows.map((r) => r.dataset.node));

/** A rectangle sketched on the XY plane from `a` to `b` (mm), by the rectangle tool on the grid. */
async function sketchRectangle(page, a, b) {
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await gridSnapOn(page);
  await page.click("#sketch-tool-rectangle");
  for (const p of [a, b]) await clickPlane(page, p, TOP);
  await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.", null, "a closed rectangle");
  await page.click("#finish-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
}

const show = async (page, id) => {
  await page.evaluate((h) => (location.hash = `#${h}`), id);
  await until(page, (h) => document.body.dataset.activeWorkspace === h, id, `${id} shown`);
};

/** The parts' ids in Design, by their names in Laser's list. */
const partIds = (page) =>
  page.$$eval(".laser-page-parts input[data-part]", (boxes) => Object.fromEntries(boxes.map((b) => [b.closest("label").textContent.trim().split(",")[0], b.dataset.part])));

/** Clicks (or taps) the middle of part `id` on the bed. */
async function pickPart(page, id, tap = false) {
  const box = await page.locator(`.laser-flat path.laser-flat-part[data-part="${id}"]`).boundingBox();
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  if (tap) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function setUp(width, tap) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 667 : 800 }, hasTouch: tap, isMobile: tap });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}#design`);
  return { context, page };
}

try {
  await check("1280 px: a part picked on the bed is the sketch picked in DesignLab, and back; Escape lets it go in both", async () => {
    const { context, page } = await setUp(1280, false);
    await startWithBox(page);
    await sketchRectangle(page, [0, 0], [40, 30]);
    await sketchRectangle(page, [-40, 0], [-20, 20]);
    await show(page, "laser");
    await until(page, () => document.querySelector(".laser-page-words")?.textContent?.startsWith("2 parts on the bed."), null, "both parts on the bed");
    const ids = await partIds(page);
    assert.deepEqual(Object.keys(ids).sort(), ["Sketch 1", "Sketch 2"]);

    // Picked in Laser: the selection holds what DesignLab's own row for that sketch selects.
    await pickPart(page, ids["Sketch 2"]);
    await until(page, (id) => document.querySelector(".laser-flat")?.dataset.picked === id, ids["Sketch 2"], "Sketch 2 picked on the bed");
    assert.equal(await selection(page), `outline:${ids["Sketch 2"]}`);
    await show(page, "design");
    await until(page, (id) => document.querySelector(`#browser .tree-row[data-node="sketches/${id}"]`)?.getAttribute("aria-current") === "true", ids["Sketch 2"], "Sketch 2's row lit in DesignLab");
    // Lit as when its own row is clicked: its Timeline row and its Sketches row, nothing else.
    assert.deepEqual((await litRows(page)).sort(), [ids["Sketch 2"], `sketches/${ids["Sketch 2"]}`]);

    // Picked in DesignLab, by Sketch 1's row: the part picked on the bed.
    await page.evaluate(() => document.querySelectorAll("#browser details").forEach((d) => (d.open = true)));
    await page.click(`#browser .tree-row[data-node="sketches/${ids["Sketch 1"]}"]`);
    assert.equal(await selection(page), `outline:${ids["Sketch 1"]}`);
    await show(page, "laser");
    await until(page, (id) => document.querySelector(".laser-flat")?.dataset.picked === id, ids["Sketch 1"], "Sketch 1 picked on the bed");
    assert.equal(await page.textContent(".laser-page-part legend"), "Sketch 1");

    // Escape lets it go here and in DesignLab.
    await page.locator(".laser-flat svg.laser-flat-sheet").focus();
    await page.keyboard.press("Escape");
    await until(page, () => document.querySelector(".laser-flat")?.dataset.picked === undefined, null, "nothing picked on the bed");
    assert.equal(await selection(page), "");
    await show(page, "design");
    assert.deepEqual(await litRows(page), []);
    await context.close();
  });

  await check("375 px with taps: a tap on a part selects it", async () => {
    const { context, page } = await setUp(375, true);
    await startWithBox(page, true);
    await show(page, "laser");
    // The box is no flat shape: nothing to pick yet. Back to Design for a rectangle drawn with the mouse's helpers.
    await show(page, "design");
    await sketchRectangle(page, [0, 0], [40, 30]);
    await show(page, "laser");
    await until(page, () => document.querySelector(".laser-page-words")?.textContent?.startsWith("1 part on the bed."), null, "the part on the bed");
    const ids = await partIds(page);
    await pickPart(page, ids["Sketch 1"], true);
    await until(page, (id) => document.body.dataset.selection === `outline:${id}`, ids["Sketch 1"], "Sketch 1 selected by a tap");
    assert.equal(await pickedOnBed(page), ids["Sketch 1"]);
    await context.close();
  });

  await check("no page errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) process.exit(1);
