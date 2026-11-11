// Browser check of the Laser page (Laser step L1a, behind ?laser), in a real Chromium.
// - Without ?laser, #laser is still the placeholder: no page.
// - With ?laser: a 40 × 30 rectangle sketched in Design is listed as "Sketch 1, 40 × 30 mm", "1 part on the bed.", drawn
//   from above; Save SVG downloads the bed (400 × 400 mm) with the rectangle 3 mm in from the lower-left corner, Save DXF
//   the same as an R12 polyline in mm. Turning the part off empties the bed and is kept when the page comes back.
// - A bed too small for the part leaves it off in words; an unusable size is refused in words.
// - At 375 px nothing runs off the side. Screenshots: e2e/laser-page-1280.png, laser-page-375.png.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { clickPlane, TOP } from "./sketch-screen.mjs";
import { gridSnapOn, pickPlane, startWithBox } from "./start.mjs";

const PORT = 4631;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
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
const words = (page, want) => until(page, (w) => document.querySelector(".laser-page-words")?.textContent?.startsWith(w), want, `the bed saying "${want}"`);
const listed = (page) => page.$$eval(".laser-page-parts li", (n) => n.map((x) => x.textContent.trim()));

async function newPage(query = "", width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}${query}#design`);
  return { context, page };
}

/** Sketch 1: a 40 × 30 rectangle from (0, 0) on the XY plane, by the rectangle tool on the grid. */
async function sketchRectangle(page) {
  await startWithBox(page);
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await gridSnapOn(page);
  await page.click("#sketch-tool-rectangle");
  for (const p of [[0, 0], [40, 30]]) await clickPlane(page, p, TOP);
  await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.", null, "a closed rectangle");
  await page.click("#finish-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
}

const toLaser = async (page) => {
  await page.evaluate(() => (location.hash = "#laser"));
  await until(page, () => document.body.dataset.activeWorkspace === "laser", null, "Laser shown");
};

const save = async (page, which) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(`.laser-page button[data-save=${which}]`)]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), "utf8") };
};

try {
  await check("without ?laser, Laser is still the placeholder", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await toLaser(page);
    assert.equal(await page.locator(".laser-page").count(), 0);
    await context.close();
  });

  await check("a sketched rectangle is on the bed, drawn from above, and saved as SVG and DXF at true size", async () => {
    const { context, page } = await newPage("?laser");
    await sketchRectangle(page);
    await toLaser(page);
    await words(page, "1 part on the bed.");
    assert.deepEqual(await listed(page), ["Sketch 1, 40 × 30 mm"]);
    await page.screenshot({ path: "e2e/laser-page-1280.png" });
    const svg = await save(page, "svg");
    assert.match(svg.name, /\.svg$/);
    // The page is the 400 × 400 mm bed; the rectangle sits 3 mm in from the lower-left corner: (3,3) (43,3) (43,33) (3,33),
    // written with y flipped.
    assert.match(svg.text, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400mm" height="400mm" viewBox="0 -400 400 400">/);
    assert.match(svg.text, /d="M3 -3L43 -3L43 -33L3 -33Z"/);
    const dxf = await save(page, "dxf");
    assert.match(dxf.name, /\.dxf$/);
    assert.match(dxf.text, /\$INSUNITS\n70\n4\n/);
    const corners = [...dxf.text.matchAll(/VERTEX\n8\nCUT\n10\n([^\n]+)\n20\n([^\n]+)\n/g)].map((m) => [Number(m[1]), Number(m[2])]);
    // The sketch's own corner order (the rectangle tool's), each corner once.
    assert.deepEqual([...corners].sort((a, b) => a[0] - b[0] || a[1] - b[1]), [[3, 3], [3, 33], [43, 3], [43, 33]]);
    assert.match(await page.textContent(".laser-page-words"), /^Saved .+\.dxf: 1 part on the bed\.$/);
    await context.close();
  });

  await check("turning the part off empties the bed and is kept; a bed too small leaves it off in words; a bad size is refused", async () => {
    const { context, page } = await newPage("?laser");
    await sketchRectangle(page);
    await toLaser(page);
    await words(page, "1 part on the bed.");
    await page.click(".laser-page-parts input[type=checkbox]");
    await words(page, "No parts on the bed.");
    assert.equal(await page.isDisabled(".laser-page button[data-save=svg]"), true);
    await page.evaluate(() => (location.hash = "#design"));
    await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
    await toLaser(page);
    await words(page, "No parts on the bed.");
    assert.equal(await page.isChecked(".laser-page-parts input[type=checkbox]"), false);
    await page.click(".laser-page-parts input[type=checkbox]");
    await words(page, "1 part on the bed.");
    // 40 wide does not fit a 45 mm bed less two 3 mm gaps (39).
    await page.fill('.laser-page input[name="width"]', "45");
    await page.press('.laser-page input[name="width"]', "Enter");
    await page.locator('.laser-page input[name="width"]').blur();
    await words(page, "No parts on the bed. Sketch 1 is left off: it is 40 × 30 mm, bigger than the bed (45 × 400 mm, 3 mm in from each edge).");
    await page.fill('.laser-page input[name="width"]', "0");
    await page.locator('.laser-page input[name="width"]').blur();
    await words(page, "The bed's width must be a number of mm above 0.");
    await context.close();
  });

  await check("at 375 px nothing runs off the side", async () => {
    const { context, page } = await newPage("?laser", 375);
    await page.locator("#start-hint").waitFor();
    await toLaser(page);
    await page.locator(".laser-page-words").waitFor({ state: "attached" });
    const wide = await page.evaluate(() => [document.documentElement, document.body].some((e) => e.scrollWidth > e.clientWidth));
    assert.equal(wide, false);
    await page.screenshot({ path: "e2e/laser-page-375.png" });
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
