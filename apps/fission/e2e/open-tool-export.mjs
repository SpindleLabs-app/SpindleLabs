// Browser check of SL #639 item 1: Export STL and Slice for printing pressed while a tool is still open. Insert opens a
// Move on the new body by itself; with X = 70 typed and OK not pressed the view shows the body moved, but the export
// would save the design as recorded (the body back where it was). Every export route refuses in words naming the open
// tool, saves nothing and opens no slice dialog; once OK is pressed the STL holds the body where it was shown.
// Worked by hand: the box is 40 × 30 × 20 from the origin, x 0..40. The cylinder Insert adds is 40 across (radius 20)
// round the origin, x −20..20; moved 70 along x it is x 50..90. So, finished, the STL spans x 0..90 (90 wide), y −20..30
// (the cylinder's −20..20 and the box's 0..30) and z 0..20; unmoved it would be x −20..40 (the bug: 60 wide).
// Insert's Move as it opens, moving nothing yet, holds nothing up (the file is the view). The same refusal for Rotate
// (30° typed), Scale (2× typed), Extrude, Edit feature, Combine and a sketch (picking its plane, then drawn). At
// 1280 px with a mouse, then the Move case at 375 px with taps. Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseFile, closePanels, insertPreset, pickPlane, sheetsClearFor, startWithBox } from "./start.mjs";

const PORT = 4416;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

async function fresh(width, height, touch, query = "") {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await page.goto(`${url}${query}#design`);
  await startWithBox(page, touch);
  if (!touch) await pinProperties(page);
  return { page: touch ? sheetsClearFor(page) : page, downloads };
}

/** The cylinder inserted and its Move left open with X = 70 typed (the view shows it at x 50..90); `before` runs while the Move still moves nothing. */
async function cylinderMovedOpen(page, tap, before = async () => {}) {
  await insertPreset(page, "cylinder", tap, true);
  await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "Insert's Move opens");
  await before();
  await page.fill("#move-x", "70");
  await page.press("#move-x", "Tab");
  await page.waitForTimeout(300);
}

/** `route` pressed with a tool open: no file saved, no slice dialog, and the open tool's own error line (`where`) in words naming the tool. */
async function refused(page, downloads, route, tap, want, where) {
  const before = downloads.length;
  await page.evaluate((id) => document.getElementById(id) && (document.getElementById(id).textContent = ""), where); // a word left from the route before
  await route();
  await until(page, ([w, id]) => (document.getElementById(id)?.textContent ?? "").startsWith(w), [want, where], `#${where} says "${want}"`);
  assert.equal(await page.isVisible(`#${where}`), true, `#${where} shows`);
  await page.waitForTimeout(700); // a download would have started by now
  assert.equal(downloads.length, before, "nothing saved while the tool is open");
  assert.equal(await page.evaluate(() => document.getElementById("slice-print-dialog")?.open ?? false), false, "no slice dialog");
}

const routes = (page, tap) => ({
  toolbar: async () => {
    await closePanels(page, tap);
    await press(page, "#toolbar [data-op=export_stl]", tap);
  },
  fileStl: () => chooseFile(page, "file-export-stl", tap),
  slice: () => chooseFile(page, "file-slice-print", tap),
});

/** The toolbar's STL: [min, max] of its corners for x, y and z (mm). */
async function stlBounds(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) pts.push([0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
  return [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]);
}
const near = (got, want, what) => got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-3, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

const MOVE_OPEN = "Move is still open: press OK or Cancel first, then Export STL.";

try {
  // 1280 px, a mouse: Insert's Move left open, every export route.
  {
    const { page, downloads } = await fresh(1280, 800, false, "?combine");
    // Insert's Move as it opens moves nothing, so the view is the design as recorded: the export goes ahead, the Move
    // stays open. By hand: the box x 0..40, the cylinder unmoved x −20..20 and y −20..20, so x −20..40, y −20..30, z 0..20.
    await cylinderMovedOpen(page, false, async () => {
      near(await stlBounds(page, false), [[-20, 40], [-20, 30], [0, 20]], "the STL with Insert's Move open and still");
      assert.equal(await page.isVisible("#move-panel"), true, "the Move is still open after the export");
    });
    const r = routes(page, false);
    await refused(page, downloads, r.toolbar, false, MOVE_OPEN, "move-error");
    if (shots) await page.screenshot({ path: `${shots}/open-tool-1280.png` });
    await refused(page, downloads, r.fileStl, false, MOVE_OPEN, "move-error");
    await refused(page, downloads, r.slice, false, "Move is still open: press OK or Cancel first, then Slice for printing.", "move-error");
    assert.equal(await page.isVisible("#move-panel"), true, "the Move stays open, its numbers kept");
    assert.equal(await page.inputValue("#move-x"), "70");
    // Finished: the file is where the view showed it (by hand, above).
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "OK closes the Move");
    await until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");
    near(await stlBounds(page, false), [[0, 90], [-20, 30], [0, 20]], "the STL after OK: box x 0..40, cylinder x 50..90");
    // And Slice for printing opens its dialog again.
    await chooseFile(page, "file-slice-print");
    await until(page, () => document.getElementById("slice-print-dialog")?.open === true, null, "the slice dialog opens with no tool open");
    await page.click("#slice-print-close");
    await until(page, () => document.getElementById("slice-print-dialog")?.open === false, null, "the slice dialog closes");

    // Every other tool that changes the bodies: Rotate, Scale, Extrude, Edit feature, Combine, a sketch.
    const tools = [
      // Rotate and Scale with a value typed: one that still moves nothing holds no export up, as Insert's Move above.
      ["Rotate", async () => (await page.click("#rotate"), await page.fill("#move-turnZ", "30"), page.press("#move-turnZ", "Tab")), "move"],
      ["Scale", async () => (await page.click("#modify-menu"), await page.click("#modify-menu-scale"), await page.fill("#move-scale", "2"), page.press("#move-scale", "Tab")), "move"],
      ["Extrude", () => page.click("#extrude"), "extrude"],
      ["Edit Box 1", () => page.dblclick('#timeline [data-item="feature-1"]'), "feature-edit"],
      ["Combine", async () => (await page.click("#modify-menu"), page.click("#modify-menu-combine")), "combine"],
    ];
    for (const [name, open, panel] of tools) {
      await open();
      await page.waitForTimeout(400);
      await refused(page, downloads, r.toolbar, false, `${name} is still open: press OK or Cancel first, then Export STL.`, `${panel}-error`);
      await refused(page, downloads, r.slice, false, `${name} is still open: press OK or Cancel first, then Slice for printing.`, `${panel}-error`);
      const cancel = `#${panel}-cancel`;
      await page.click(cancel);
      await page.waitForTimeout(300);
    }
    await page.click("#create-sketch");
    await refused(page, downloads, r.toolbar, false, "Sketch is still open: pick its plane or press Cancel first, then Export STL.", "action-note");
    await pickPlane(page, "XY", false);
    await until(page, () => !!document.getElementById("finish-sketch") && !document.getElementById("finish-sketch").closest("[hidden]"), null, "the sketch opens");
    await refused(page, downloads, r.fileStl, false, "Sketch 1 is still open: press Finish sketch first, then Export STL.", "sketch-grid-error"); // the sketch's own toolbar has no STL
    await refused(page, downloads, r.slice, false, "Sketch 1 is still open: press Finish sketch first, then Slice for printing.", "sketch-grid-error");
    await page.click("#finish-sketch");
    await until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");
    near(await stlBounds(page, false), [[0, 90], [-20, 30], [0, 20]], "every tool put away: the STL as before");
    await page.context().close();
  }
  // 375 px, taps: the same refusal for the Move, read on the phone.
  {
    const { page, downloads } = await fresh(375, 740, true);
    await cylinderMovedOpen(page, true);
    const r = routes(page, true);
    await refused(page, downloads, r.toolbar, true, MOVE_OPEN, "move-error");
    // The words are on screen: the Properties sheet opens to them, in the Move's panel.
    const seen = await page.evaluate(() => {
      const e = document.getElementById("move-error");
      const r = e.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
      return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && e.contains(at);
    });
    if (shots) await page.screenshot({ path: `${shots}/open-tool-375.png` });
    assert.ok(seen, "the refusal is on screen at 375 px");
    await refused(page, downloads, r.slice, true, "Move is still open: press OK or Cancel first, then Slice for printing.", "move-error");
    await page.context().close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("open-tool-export: ok");
} finally {
  await browser.close();
  await server.close();
}
