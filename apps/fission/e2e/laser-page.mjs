// Browser check of the Laser page (Laser steps L1a and L1a2, behind ?laser), in a real Chromium.
// - Without ?laser, #laser is still the placeholder: no page.
// - With ?laser: a 40 × 30 rectangle sketched in Design is listed as "Sketch 1, 40 × 30 mm", "1 part on the bed.", drawn
//   flat from above; Save SVG downloads the bed (400 × 400 mm) with the rectangle 3 mm in from the lower-left corner, Save DXF
//   the same as an R12 polyline in mm. Turning the part off empties the bed and is kept when the page comes back.
// - The view is flat (L1a2): the bed and the part are outlines at one true scale, named, clear of the parts list; the 3D
//   view's buttons and view cube are away and nothing turns; the wheel zooms about the pointer, a drag slides, Fit
//   brings the bed back; Design gets its 3D view back as it was.
// - A bed too small for the part leaves it off in words; an unusable size is refused in words.
// - Layers (L1c): an engraving on a cut part is not an overlap, is drawn filled with a key, and the files carry it.
// - At 375 px nothing runs off the side and nothing lies on anything else. Screenshots: e2e/laser-page-1280.png, laser-page-375.png.
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
const listed = (page) => page.$$eval(".laser-page-parts li", (n) => n.map((x) => (x.querySelector("label") ?? x).textContent.trim()));

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

/** Where a thing is on screen, px: [left, top, right, bottom], or null when it is not drawn. */
const boxOf = (page, selector) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e || getComputedStyle(e).display === "none" || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? null : [r.left, r.top, r.right, r.bottom];
  }, selector);
const scaleNow = (page) => page.$eval(".laser-flat", (e) => Number(e.dataset.scale));
const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
const closeTo = (got, want, slack, what) => assert.ok(Math.abs(got - want) <= slack, `${what}: got ${got}, want ${want} (within ${slack})`);

/** The 3D camera once it has stopped moving (two reads 200 ms apart the same), as text. */
async function cameraAtRest(page) {
  let last = "";
  for (let i = 0; i < 50; i++) {
    const now = await page.evaluate(() => JSON.stringify(window.fissionTest.camera()));
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(200);
  }
  assert.fail("the 3D camera never came to rest");
}

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
    // What is on screen is the file's own path: the part's outline as the SVG file writes it.
    assert.deepEqual(await page.$$eval(".laser-flat path.laser-flat-part", (ps) => ps.map((p) => p.getAttribute("d"))), ["M3 -3L43 -3L43 -33L3 -33Z"]);
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

  await check("the view is flat: the bed and the part as outlines at one true scale, no 3D controls; the wheel zooms about the pointer, a drag slides, Fit brings the bed back; Design's 3D view comes back", async () => {
    const { context, page } = await newPage("?laser&test-hooks");
    await sketchRectangle(page);
    const designCamera = await cameraAtRest(page);
    await toLaser(page);
    await words(page, "1 part on the bed.");
    await page.locator(".laser-flat path.laser-flat-part").waitFor();
    // Nothing of the 3D view is left to confuse: its row of buttons (Orbit, Top, Front, Right…) and the view cube are away,
    // and the viewport is in its empty 2D view (no body, no 3D grid).
    assert.equal(await boxOf(page, "#view-controls"), null);
    assert.equal(await boxOf(page, "#viewport .view-cube"), null);
    assert.equal(await page.getAttribute("#viewport", "data-image"), "none");
    assert.equal(await page.getAttribute("#viewport", "aria-label"), "Laser bed, flat view");
    assert.deepEqual(await page.$$eval(".laser-flat-bar button", (bs) => bs.filter((b) => b.offsetParent !== null).map((b) => b.getAttribute("aria-label"))), ["Zoom out", "Zoom in", "Fit"]);
    assert.deepEqual(await page.$$eval("#viewport button", (bs) => bs.filter((b) => b.offsetParent !== null).map((b) => b.getAttribute("aria-label"))), ["Zoom out", "Zoom in", "Fit"]);
    // True scale: the bed is 400 mm and the part 40 × 30 mm, drawn by one scale (px per mm), the part 3 mm in from the
    // bed's lower-left corner. Boxes include half of each 1.5 px line, hence the 2 px of slack.
    const scale = await scaleNow(page);
    const bed = await boxOf(page, ".laser-flat-bed");
    const part = await boxOf(page, ".laser-flat path.laser-flat-part");
    closeTo(bed[2] - bed[0], 400 * scale, 2, "the bed's width on screen");
    closeTo(bed[3] - bed[1], 400 * scale, 2, "the bed's height on screen");
    closeTo(part[2] - part[0], 40 * scale, 2, "the part's width on screen");
    closeTo(part[3] - part[1], 30 * scale, 2, "the part's height on screen");
    closeTo(part[0] - bed[0], 3 * scale, 2, "the part, 3 mm in from the bed's left side");
    closeTo(bed[3] - part[3], 3 * scale, 2, "the part, 3 mm up from the bed's bottom side");
    // The whole bed is in the view, clear of the parts list and of the row of buttons, and each is named.
    const view = await boxOf(page, ".laser-flat");
    assert.ok(bed[0] >= view[0] && bed[1] >= view[1] && bed[2] <= view[2] && bed[3] <= view[3], `the bed ${bed} inside the view ${view}`);
    assert.ok(apart(bed, await boxOf(page, "#browser")), "the bed clear of the parts list");
    assert.ok(apart(bed, await boxOf(page, ".laser-flat-bar")), "the bed clear of the row of buttons");
    assert.deepEqual(await page.$$eval(".laser-flat text.laser-flat-bed-name, .laser-flat text.laser-flat-part-name", (t) => t.map((x) => x.textContent)), ["Bed 400 × 400 mm", "Sketch 1"]);
    assert.ok(apart(await boxOf(page, ".laser-flat text.laser-flat-bed-name"), await boxOf(page, "#browser")), "the bed's name clear of the parts list");
    assert.deepEqual(await page.$$eval(".laser-flat text.laser-flat-mark", (t) => t.slice(0, 9).map((x) => x.textContent)), ["0", "50", "100", "150", "200", "250", "300", "350", "400"]);
    await page.screenshot({ path: "e2e/laser-page-1280.png" });

    // The wheel, one notch away over the part's middle: closer by e^0.2, and the part's middle stays under the pointer.
    const mid = [(part[0] + part[2]) / 2, (part[1] + part[3]) / 2];
    await page.mouse.move(mid[0], mid[1]);
    await page.mouse.wheel(0, -100);
    await until(page, (s) => Number(document.querySelector(".laser-flat").dataset.scale) > s, scale, "the wheel zooming in");
    closeTo(await scaleNow(page), scale * Math.exp(0.2), 1e-6, "one notch of the wheel");
    const closer = await boxOf(page, ".laser-flat path.laser-flat-part");
    closeTo((closer[0] + closer[2]) / 2, mid[0], 1, "the part's middle stays under the pointer, across");
    closeTo((closer[1] + closer[3]) / 2, mid[1], 1, "the part's middle stays under the pointer, down");
    // A drag slides the view by the drag, and never turns it: the bed's box moves 120 px left and 80 px up, the same size.
    const before = await boxOf(page, ".laser-flat-bed");
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(540, 360, { steps: 4 });
    await page.mouse.move(480, 320, { steps: 4 });
    await page.mouse.up();
    const after = await boxOf(page, ".laser-flat-bed");
    closeTo(after[0] - before[0], -120, 0.5, "slid across");
    closeTo(after[1] - before[1], -80, 0.5, "slid up");
    closeTo(after[2] - after[0], before[2] - before[0], 0.5, "the same size after the drag");
    // The buttons: Zoom in is ×1.25, Fit shows the whole bed again where it was.
    await page.click('.laser-flat-bar button[data-view="zoom-in"]');
    closeTo(await scaleNow(page), scale * Math.exp(0.2) * 1.25, 1e-6, "Zoom in");
    await page.click('.laser-flat-bar button[data-view="fit"]');
    closeTo(await scaleNow(page), scale, 1e-9, "Fit");
    const fitted = await boxOf(page, ".laser-flat-bed");
    for (let i = 0; i < 4; i++) closeTo(fitted[i], bed[i], 0.5, `Fit puts the bed back (${i})`);
    // The keyboard: + zooms in, 0 fits.
    await page.focus(".laser-flat-sheet");
    await page.keyboard.press("+");
    closeTo(await scaleNow(page), scale * 1.25, 1e-9, "the + key");
    await page.keyboard.press("0");
    closeTo(await scaleNow(page), scale, 1e-9, "the 0 key");

    // Back in Design the 3D view is as it was left: its buttons, the view cube, the body, the camera.
    await page.evaluate(() => (location.hash = "#design"));
    await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
    assert.equal(await page.locator(".laser-flat").count(), 0);
    assert.notEqual(await boxOf(page, "#view-controls"), null);
    assert.notEqual(await boxOf(page, "#viewport .view-cube"), null);
    assert.equal(await page.getAttribute("#viewport", "data-image"), null);
    assert.equal(await page.getAttribute("#viewport", "aria-label"), "3D view");
    assert.equal(await cameraAtRest(page), designCamera);
    // And Laser again: flat, the whole bed in view.
    await toLaser(page);
    await page.locator(".laser-flat path.laser-flat-part").waitFor();
    closeTo(await scaleNow(page), scale, 1e-9, "the bed fitted again");

    // The window made phone-sized: the untouched view fits the bed again by itself, under the app's Browser and Properties
    // buttons; the part is still drawn at the bed's scale, without its name (30 px is too narrow for it).
    await page.setViewportSize({ width: 375, height: 800 });
    await until(page, (s) => Number(document.querySelector(".laser-flat").dataset.scale) < s, scale, "the bed fitted to the phone-sized view");
    const small = await scaleNow(page);
    const phoneBed = await boxOf(page, ".laser-flat-bed");
    const phonePart = await boxOf(page, ".laser-flat path.laser-flat-part");
    assert.ok(phoneBed[0] >= 0 && phoneBed[2] <= 375, `the bed ${phoneBed} inside the screen`);
    assert.ok(apart(phoneBed, await boxOf(page, "#panel-toggles")), "the bed clear of the app's buttons");
    closeTo(phonePart[2] - phonePart[0], 40 * small, 2, "the part's width on the phone-sized view");
    assert.deepEqual(await page.$$eval(".laser-flat text.laser-flat-part-name", (t) => t.map((x) => x.textContent)), []);
    await page.screenshot({ path: "e2e/laser-page-375-part.png" });
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

  await check("at 375 px nothing runs off the side, the bed is in view under the app's buttons, and nothing lies on anything else", async () => {
    const { context, page } = await newPage("?laser", 375);
    await page.locator("#start-hint").waitFor();
    await toLaser(page);
    await page.locator(".laser-page-words").waitFor({ state: "attached" });
    await page.locator(".laser-flat .laser-flat-bed").waitFor();
    const wide = await page.evaluate(() => [document.documentElement, document.body].some((e) => e.scrollWidth > e.clientWidth));
    assert.equal(wide, false);
    const view = await boxOf(page, ".laser-flat");
    const bed = await boxOf(page, ".laser-flat-bed");
    const name = await boxOf(page, ".laser-flat text.laser-flat-bed-name");
    const bar = await boxOf(page, ".laser-flat-bar");
    assert.ok(bed[0] >= view[0] && bed[2] <= view[2] && bed[1] >= view[1] && bed[3] <= view[3], `the bed ${bed} inside the view ${view}`);
    closeTo(bed[2] - bed[0], 400 * (await scaleNow(page)), 2, "the bed's width on screen");
    // The app's Browser and Properties buttons lie over the top of the view, Undo and Redo over its bottom-right corner.
    for (const other of ["#panel-toggles", "#undo-redo", ".laser-flat-bar"]) {
      const box = await boxOf(page, other);
      assert.notEqual(box, null, other);
      assert.ok(apart(bed, box), `the bed clear of ${other}`);
      assert.ok(apart(name, box), `the bed's name clear of ${other}`);
    }
    assert.ok(apart(bar, await boxOf(page, "#undo-redo")), "the row of buttons clear of Undo and Redo");
    assert.ok(bar[0] >= 0 && bar[2] <= 375, "the row of buttons inside the screen");
    // Each button is a full finger's target (44 px).
    // (Turn is away while no part is picked; the check of a picked part below measures it.)
    const shown = await page.$$eval(".laser-flat-bar button", (bs) => bs.filter((b) => !b.closest("[hidden]")).map((b) => [b.dataset.view, b.offsetWidth, b.offsetHeight]));
    assert.deepEqual(shown.map((b) => b[0]), ["zoom-out", "zoom-in", "fit"]);
    for (const size of shown) assert.ok(size[1] >= 44 && size[2] >= 44, `a ${size} px button`);
    assert.equal(await boxOf(page, "#view-controls"), null);
    assert.deepEqual(await page.$$eval(".laser-flat text.laser-flat-note", (t) => t.map((x) => x.textContent)), ["Nothing to cut yet.", "Closed sketches from DesignLab appear here."]);
    await page.screenshot({ path: "e2e/laser-page-375.png" });
    // A sheet opened over the fitted bed fits the bed again in the room left above it (here the bed keeps its size and
    // moves up to the middle of that room), and closing the sheet puts it back exactly.
    const fitted = await scaleNow(page);
    await page.click("#browser-toggle");
    await until(page, () => document.querySelector("#browser-toggle").getAttribute("aria-expanded") === "true", null, "the Browser sheet open");
    await until(page, (top) => document.querySelector(".laser-flat-bed").getBoundingClientRect().top < top - 1, bed[1], "the bed moved up as the sheet opened");
    const sheet = await boxOf(page, "#browser");
    const raised = await boxOf(page, ".laser-flat-bed");
    assert.ok(raised[3] <= sheet[1] - 12, `the bed ${raised} clear of the sheet ${sheet}`);
    assert.ok(apart(raised, await boxOf(page, "#panel-toggles")), "and still clear of the app's buttons");
    closeTo(raised[2] - raised[0], 400 * (await scaleNow(page)), 2, "the bed's width on screen, sheet open");
    await page.click("#browser-toggle");
    await until(page, (top) => Math.abs(document.querySelector(".laser-flat-bed").getBoundingClientRect().top - top) < 0.5, bed[1], "the bed back where it was once the sheet is closed");
    assert.equal(await scaleNow(page), fitted);
    await context.close();
  });

  await check("a part is dragged on the bed and lands on whole mm, kept in the project; turned, typed off the bed it is warned about, and Arrange puts it back in the rows", async () => {
    const { context, page } = await newPage("?laser");
    await sketchRectangle(page);
    await toLaser(page);
    await words(page, "1 part on the bed.");
    const part = ".laser-flat path.laser-flat-part";
    const value = (name) => page.$eval(`.laser-page input[name="${name}"]`, (i) => Number(i.value));
    const pathOf = (x, y, w, h) => `M${x} ${-y}L${x + w} ${-y}L${x + w} ${-(y + h)}L${x} ${-(y + h)}Z`;
    const scale = await scaleNow(page);
    const before = await boxOf(page, part);
    assert.equal(await boxOf(page, ".laser-page-part"), null, "no part's numbers before one is picked");
    // Dragged 80 px right and 60 px up by its middle: its corner, at (3, 3) mm, lands on the nearest whole mm.
    const from = [(before[0] + before[2]) / 2, (before[1] + before[3]) / 2];
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(from[0] + 30, from[1] - 20, { steps: 3 });
    await page.mouse.move(from[0] + 80, from[1] - 60, { steps: 4 });
    assert.equal(await page.$eval(".laser-flat", (e) => e.dataset.moving), await page.$eval(part, (e) => e.dataset.part), "the part is being moved");
    assert.equal(await scaleNow(page), scale, "the view did not move with the part");
    await page.mouse.up();
    const [x, y] = [Math.round(3 + 80 / scale), Math.round(3 + 60 / scale)];
    await until(page, (d) => document.querySelector(".laser-flat path.laser-flat-part")?.getAttribute("d") === d, pathOf(x, y, 40, 30), `the part drawn at (${x}, ${y})`);
    // The part is picked: its numbers show, under its own name.
    assert.equal(await page.textContent(".laser-page-part legend"), "Sketch 1");
    assert.deepEqual([await value("x"), await value("y"), await value("angle")], [x, y, 0]);
    const after = await boxOf(page, part);
    closeTo(after[0] - before[0], (x - 3) * scale, 1.5, "moved right on screen");
    closeTo(before[3] - after[3], (y - 3) * scale, 1.5, "moved up on screen");
    assert.match(await page.$eval(part, (e) => e.getAttribute("class")), /laser-flat-part-picked/);
    // The file has it where it was put.
    assert.ok((await save(page, "svg")).text.includes(`d="${pathOf(x, y, 40, 30)}"`), "the saved SVG has the part where it was put");
    // Kept: to Design and back, it is still there.
    await page.evaluate(() => (location.hash = "#design"));
    await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
    await toLaser(page);
    await until(page, (d) => document.querySelector(".laser-flat path.laser-flat-part")?.getAttribute("d") === d, pathOf(x, y, 40, 30), "the part where it was left");
    // Picked again by a click, then Turn: a quarter turn about its middle, 30 wide and 40 tall.
    const now = await boxOf(page, part);
    await page.mouse.click((now[0] + now[2]) / 2, (now[1] + now[3]) / 2);
    await page.locator('.laser-flat-bar button[data-view="turn"]').click();
    await until(page, () => document.querySelector('.laser-page input[name="angle"]')?.value === "90", null, "the angle saying 90");
    const turned = await boxOf(page, part);
    closeTo(turned[2] - turned[0], 30 * scale, 1.5, "30 mm wide on screen");
    closeTo(turned[3] - turned[1], 40 * scale, 1.5, "40 mm tall on screen");
    closeTo((turned[0] + turned[2]) / 2, (now[0] + now[2]) / 2, 1.5, "turned on the spot");
    await page.screenshot({ path: "e2e/laser-page-1280-placed.png" });
    // Typed 20 mm past the right side (30 wide from 390 reaches 420 on a 400 bed): said in words and marked, not moved back.
    await page.fill('.laser-page input[name="x"]', "390");
    await page.locator('.laser-page input[name="x"]').blur();
    await until(page, () => document.querySelector(".laser-page-words")?.textContent === "1 part on the bed. Sketch 1 is off the bed: 20 mm past the right side.", null, "the off-bed warning in words");
    assert.match(await page.$eval(part, (e) => e.getAttribute("class")), /laser-flat-part-warn/);
    const colours = await page.$eval(part, (e) => [getComputedStyle(e).stroke, getComputedStyle(e).strokeDasharray, getComputedStyle(document.documentElement).getPropertyValue("--warn").trim()]);
    assert.notEqual(colours[1], "none", "the warned part is dashed");
    assert.equal(await page.isDisabled(".laser-page button[data-save=svg]"), false); // the file can still be saved: the warning is the person's to act on
    // The arrows move it a mm at a time, back onto the bed side.
    await page.focus(".laser-flat svg");
    await page.keyboard.press("ArrowLeft");
    await until(page, () => document.querySelector('.laser-page input[name="x"]')?.value === "389", null, "one mm left");
    // Arrange in rows: back to the lower-left corner, unturned.
    await page.click(".laser-page button[data-arrange]");
    await until(page, (d) => document.querySelector(".laser-flat path.laser-flat-part")?.getAttribute("d") === d, "M3 -3L43 -3L43 -33L3 -33Z", "the part back in the rows");
    await words(page, "1 part on the bed.");
    assert.equal(await boxOf(page, ".laser-page button[data-arrange]"), null);
    // One Undo brings the hand-made layout back.
    await page.click("#undo");
    await until(page, () => /^M\d+ /.test(document.querySelector(".laser-flat path.laser-flat-part")?.getAttribute("d") ?? "") && document.querySelector(".laser-flat path.laser-flat-part").getAttribute("d") !== "M3 -3L43 -3L43 -33L3 -33Z", null, "Undo bringing the placed part back");
    await context.close();
  });

  await check("a part put over another is warned about in words and on both parts, by the kernel's own answer; sharing an edge is said as a touch; clear of it nothing is said", async () => {
    const { context, page } = await newPage("?laser");
    await sketchRectangle(page);
    // A second sketch: a 20 × 20 square.
    await page.click("#create-sketch");
    await pickPlane(page, "XY", false);
    await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching again");
    await gridSnapOn(page);
    await page.click("#sketch-tool-rectangle");
    for (const p of [[-30, 0], [-10, 20]]) await clickPlane(page, p, TOP);
    await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.", null, "a closed square");
    await page.click("#finish-sketch");
    await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the second sketch finished");
    await toLaser(page);
    await words(page, "2 parts on the bed.");
    assert.deepEqual(await listed(page), ["Sketch 1, 40 × 30 mm", "Sketch 2, 20 × 20 mm"]);
    // In the rows: Sketch 1 from (3, 3), Sketch 2 right of it from (46, 3). Sketch 2 is picked and typed to X = 20:
    // (20, 3) to (40, 23), wholly inside Sketch 1's (3, 3) to (43, 33).
    const second = '.laser-flat path.laser-flat-part[data-part]:nth-of-type(2)';
    const box = await boxOf(page, second);
    await page.mouse.click((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    await until(page, () => document.querySelector(".laser-page-part legend")?.textContent === "Sketch 2", null, "Sketch 2 picked");
    const typeX = async (v) => {
      await page.fill('.laser-page input[name="x"]', v);
      await page.locator('.laser-page input[name="x"]').blur();
    };
    await typeX("20");
    await words(page, "2 parts on the bed. Sketch 1 and Sketch 2 overlap.");
    assert.deepEqual(await page.$$eval(".laser-flat path.laser-flat-part", (ps) => ps.map((p) => p.classList.contains("laser-flat-part-warn"))), [true, true]);
    assert.deepEqual(await page.$$eval(".laser-flat path.laser-flat-part title", (ts) => ts.map((t) => t.textContent)), ["Sketch 1, cut, 40 × 30 mm, overlaps Sketch 2", "Sketch 2, cut, 20 × 20 mm, overlaps Sketch 1"]);
    await page.screenshot({ path: "e2e/laser-page-1280-overlap.png" });
    // Layers (L1c): Sketch 2 engraved on Sketch 1 is what an engraving is for: the warning goes, Sketch 2 is drawn filled,
    // the key names both layers, and the files carry them (engrave first).
    await page.selectOption('.laser-page select[data-op] >> nth=1', "engrave");
    await until(page, () => document.querySelector(".laser-page-words")?.textContent === "2 parts on the bed.", null, "no overlap warning for an engraving on a cut part");
    assert.deepEqual(await page.$$eval(".laser-flat path.laser-flat-part", (ps) => ps.map((p) => p.getAttribute("class"))), ["laser-flat-part laser-flat-part-cut", "laser-flat-part laser-flat-part-engrave laser-flat-part-picked"]);
    const look = await page.$eval(".laser-flat path.laser-flat-part-engrave", (e) => getComputedStyle(e).fill);
    assert.notEqual(look, "none", "an engraving is drawn filled");
    assert.notEqual(look, await page.$eval(".laser-flat path.laser-flat-part-cut", (e) => getComputedStyle(e).fill), "and not as a cut part is");
    assert.deepEqual(await page.$$eval(".laser-flat text.laser-flat-key", (t) => t.map((x) => x.textContent)), ["Cut", "Engrave"]);
    assert.ok(apart(await boxOf(page, ".laser-flat text.laser-flat-key-engrave"), await boxOf(page, ".laser-flat text.laser-flat-bed-name")), "the key clear of the bed's name");
    await page.screenshot({ path: "e2e/laser-page-1280-layers.png" });
    const layered = await save(page, "svg");
    assert.deepEqual([...layered.text.matchAll(/<g id="(\w+)">/g)].map((m) => m[1]), ["engrave", "cut"]);
    assert.match(layered.text, /<g id="engrave"><title>Engrave<\/title>\n<path id="part-[^"]+" d="M20 -3L40 -3L40 -23L20 -23Z" fill-rule="evenodd" fill="#000" stroke="none">/);
    const layeredDxf = await save(page, "dxf");
    assert.deepEqual([...layeredDxf.text.matchAll(/0\nPOLYLINE\n8\n(\w+)\n/g)].map((m) => m[1]), ["ENGRAVE", "CUT"]);
    // Kept in the project: after Design and back, still engraved. Then back to cut for the checks below.
    await page.evaluate(() => (location.hash = "#design"));
    await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
    await toLaser(page);
    await until(page, () => document.querySelectorAll(".laser-page select[data-op]")[1]?.value === "engrave", null, "the layer kept");
    await page.selectOption('.laser-page select[data-op] >> nth=1', "cut");
    await words(page, "2 parts on the bed. Sketch 1 and Sketch 2 overlap.");
    // At X = 43 its left side lies on Sketch 1's right side: a shared line and no shared area.
    await typeX("43");
    await words(page, "2 parts on the bed. Sketch 1 and Sketch 2 touch: their cuts would share a line.");
    assert.deepEqual(await page.$$eval(".laser-flat path.laser-flat-part", (ps) => ps.map((p) => p.classList.contains("laser-flat-part-warn"))), [false, false]);
    // Half a mm clear: nothing to say.
    await typeX("43.5");
    await until(page, () => document.querySelector(".laser-page-words")?.textContent === "2 parts on the bed.", null, "no warning once the parts are apart");
    await context.close();
  });

  await check("at 375 px a tap picks a part and a finger then moves it; Turn joins the row of buttons without leaving the screen or covering Undo", async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    // The sketch is drawn at desktop width (the sketch tools' own phone checks are elsewhere), then the window is a phone's.
    await page.goto(`${url}?laser#design`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await sketchRectangle(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await toLaser(page);
    await words(page, "1 part on the bed.");
    const part = ".laser-flat path.laser-flat-part";
    await page.locator(".laser-flat .laser-flat-bed").waitFor();
    // Zoom in on the part so a finger can take it: twice the Zoom in button, then it is found again.
    const scale0 = await scaleNow(page);
    const cdp = await context.newCDPSession(page);
    const touch = (type, at) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: at[0], y: at[1] }] });
    const middle = async () => { const b = await boxOf(page, part); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
    // A finger dragged across the part before it is picked slides the view, and the part stays at (3, 3).
    let at = await middle();
    await touch("touchStart", at);
    await touch("touchMove", [at[0] + 20, at[1] - 30]);
    await touch("touchMove", [at[0] + 40, at[1] - 60]);
    await touch("touchEnd", at);
    assert.equal(await page.$eval(part, (e) => e.getAttribute("d")), "M3 -3L43 -3L43 -33L3 -33Z");
    assert.equal(await scaleNow(page), scale0);
    const slid = await middle();
    closeTo(slid[0] - at[0], 40, 2, "the view slid with the finger, across");
    closeTo(slid[1] - at[1], -60, 2, "and up");
    // A tap picks it; Turn appears in the row, inside the screen and clear of Undo and Redo.
    at = slid;
    await touch("touchStart", at);
    await touch("touchEnd", at);
    await until(page, () => document.querySelector(".laser-flat")?.dataset.picked !== undefined, null, "the part picked by a tap");
    const bar = await boxOf(page, ".laser-flat-bar");
    assert.ok(bar[0] >= 0 && bar[2] <= 375, `the row of buttons ${bar} inside the screen`);
    assert.ok(apart(bar, await boxOf(page, "#undo-redo")), "the row clear of Undo and Redo");
    const turn = await page.$eval('.laser-flat-bar button[data-view="turn"]', (b) => [b.offsetWidth, b.offsetHeight]);
    assert.ok(turn[0] >= 44 && turn[1] >= 44, `Turn is a ${turn} px button`);
    assert.equal(await boxOf(page, "#properties"), null, "picking opens no sheet over the view");
    // Now the same finger moves the part: 46 px right and 46 px up is 59.9 mm each way at this zoom, landing on whole mm.
    await touch("touchStart", at);
    await touch("touchMove", [at[0] + 20, at[1] - 20]);
    await touch("touchMove", [at[0] + 46, at[1] - 46]);
    await touch("touchEnd", at);
    const [x, y] = [Math.round(3 + 46 / scale0), Math.round(3 + 46 / scale0)];
    await until(page, (d) => document.querySelector(".laser-flat path.laser-flat-part")?.getAttribute("d") === d, `M${x} ${-y}L${x + 40} ${-y}L${x + 40} ${-(y + 30)}L${x} ${-(y + 30)}Z`, `the part moved to (${x}, ${y}) by a finger`);
    await page.screenshot({ path: "e2e/laser-page-375-placed.png" });
    await context.close();
  });

  await check("in the second pane, where Laser is still shown as coming soon, no bed is drawn over the words", async () => {
    const { context, page } = await newPage("?laser&all-workspaces");
    await page.locator("#start-hint").waitFor();
    await page.click("#split-toggle");
    await page.waitForSelector("#split-choice");
    await page.selectOption("#split-choice", "laser");
    await until(page, () => document.body.dataset.split === "laser", null, "Laser in the second pane");
    await until(page, () => /Coming soon/.test(document.querySelector("#split-viewport .split-soon")?.textContent ?? ""), null, "the pane saying Coming soon");
    assert.equal(await page.evaluate(() => document.querySelector("#split-viewport").dataset.drawing), "off");
    assert.equal(await boxOf(page, "#split-viewport .laser-flat"), null, "no flat view over the words");
    // The words are what a press in the pane's middle lands on.
    const hit = await page.evaluate(() => { const r = document.querySelector("#split-viewport").getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".split-soon, .laser-flat")?.className; });
    assert.equal(hit, "split-soon");
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
