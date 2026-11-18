// Browser check of a Pattern round a construction axis (step 59a3b,
// pattern-panel.ts `setAxes`, rebuild.ts `patternRun`), with `?pattern` and
// `?construct`. The design (e2e/pattern-axis.spindle): Box 1, a 10 mm cube at
// the origin; Plane 1, 10 mm out from its right face (x = 20); Axis 1 where
// Plane 1 meets the XZ plane: the line x = 20, y = 0. Worked by hand: turning
// about (20, 0) by a quarter turn sends the cube x 0..10, y 0..10 to x 10..20,
// y −20..−10 or x 20..30, y 10..20, and by a half turn to x 30..40, y −10..0;
// so 4 over a full turn fill x 0..40, y −20..20, 4,000 mm³, and 2 (the cube
// and its half turn) x 0..40, y −10..10, 2,000 mm³; z stays 0..10. The Axis
// list offers Axis 1 after X, Y and Z (never Plane 1), and choosing it hides
// the centre. 1280 px with a mouse and 375 px with taps (the bar's Finish
// Pattern). Screenshots go to E2E_SHOTS when set. Port 4972.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4972, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4972/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed", 15000);
  await nextFrame(page);
}

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
function toScreen(cam, box, p) {
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const aspect = box.width / box.height;
  const nx = dot(v, right) / (dot(v, forward) * T * aspect);
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}
/** Clicks (or taps) the world point `p` as the camera sees it now; fails if something is over the canvas there. */
async function at(page, p, tap = false) {
  await closePanels(page, tap);
  const s = toScreen(await camera(page), await canvasBox(page), p);
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport canvas") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((x, k) => Math.abs(x - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}

/** The toolbar's STL: its enclosed volume (mm³, the sum over triangles of the signed tetrahedra to the origin) and its bounds. */
async function stl(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  let volume = 0;
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += dot(a, cross(b, c)) / 6;
    pts.push(a, b, c);
  }
  return { volume, bounds: [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]) };
}
function near(got, volume, bounds, what) {
  assert.ok(Math.abs(got.volume - volume) <= 0.05, `${what}: volume ${got.volume}, want ${volume}`);
  got.bounds.flat().forEach((x, i) => assert.ok(Math.abs(x - bounds.flat()[i]) <= 1e-3, `${what}: bounds ${JSON.stringify(got.bounds)}, want ${JSON.stringify(bounds)}`));
}

const project = JSON.parse(readFileSync(new URL("./pattern-axis.spindle", import.meta.url), "utf8"));
const CUBE = [[0, 10], [0, 10], [0, 10]];
const FOUR = [[0, 40], [-20, 20], [0, 10]];
const TWO = [[0, 40], [-10, 10], [0, 10]];
const TOP = [5, 5, 10];

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&pattern&construct#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "pattern-axis.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 3, null, "the file open", 15000);
  await rebuilt(page);
  await settle(page);
  return page;
}

async function createItems(page, tap) {
  await closePanels(page, tap);
  await press(page, "#create-menu", tap);
  await until(page, () => !document.getElementById("create-menu-menu").hidden, null, "Create ▾ opens");
  const ids = await page.$$eval("#create-menu-menu [id]", (els) => els.map((e) => e.id).filter((id) => id.startsWith("create-menu-") || id.startsWith("coming-")));
  await page.keyboard.press("Escape");
  return ids;
}
async function openPattern(page, tap) {
  await closePanels(page, tap);
  await press(page, "#create-menu", tap);
  await press(page, "#create-menu-pattern", tap);
  await opened(page);
}
const opened = (page) => until(page, () => document.getElementById("pattern-panel")?.hidden === false, null, "the Pattern panel open");
const closed = (page) => until(page, () => document.getElementById("pattern-panel")?.hidden === true, null, "the Pattern panel closed");
const copiesDrawn = (page, n) => until(page, (w) => (document.getElementById("pattern-panel")?.dataset.previewCopies ?? "") === w, n === null ? "" : String(n), `${n ?? "no"} copies drawn`);
const items = (page, n) => until(page, (k) => document.querySelectorAll("#timeline li[data-item]").length === k, n, `${n} timeline items`);
const bodiesSay = (page, start) => until(page, (w) => document.getElementById("pattern-bodies")?.textContent.startsWith(w), start, `the panel says ${start}…`);

/** The Axis list's options as [value, words], and whether the centre row shows. */
const axisList = (page) => page.evaluate(() => ({ options: [...document.getElementById("pattern-axis").options].map((o) => [o.value, o.textContent]), centre: !document.getElementById("pattern-centre-row").hidden }));
const AXES = [["X", "X"], ["Y", "Y"], ["Z", "Z"], ["construct:feature-3", "Axis 1"]];

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  await check("1280 px: the cube picked, Round an axis with Axis 1 (offered after X, Y and Z, the centre hidden), 4 in a full turn: 3 copies previewed, OK makes 4,000 mm³ at x 0..40, y −20..20 as one undo step; Edit feature to 2: 2,000 mm³", async () => {
    const page = await fresh(1280, 800, false);
    try {
      near(await stl(page, false), 1000, CUBE, "as made");
      await openPattern(page, false);
      await at(page, TOP);
      await bodiesSay(page, "Repeating ");
      await page.selectOption("#pattern-kind", "circular");
      assert.deepEqual(await axisList(page), { options: AXES, centre: true }, "X, Y, Z and Axis 1; Plane 1 is no axis");
      await page.selectOption("#pattern-axis", "construct:feature-3");
      assert.equal((await axisList(page)).centre, false, "Axis 1 says where it turns: no centre");
      await page.locator("#pattern-count3").fill("4");
      await copiesDrawn(page, 3);
      if (shots) await page.screenshot({ path: `${shots}/pattern-axis-1280-preview.png` });
      await page.click("#pattern-ok");
      await closed(page);
      await rebuilt(page);
      await items(page, 4);
      if (shots) await page.screenshot({ path: `${shots}/pattern-axis-1280-done.png` });
      near(await stl(page, false), 4000, FOUR, "4 round Axis 1");
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), 1000, CUBE, "undone in one step");
      await press(page, "#redo", false);
      await rebuilt(page);
      near(await stl(page, false), 4000, FOUR, "redone");
      await closePanels(page, false);
      await page.click('#timeline [data-item="feature-4"]', { button: "right" });
      await until(page, () => document.getElementById("row-menu")?.open, null, "Pattern 1's menu");
      await page.click("#row-menu-edit");
      await opened(page);
      assert.equal(await page.$eval("#pattern-axis", (s) => s.value), "construct:feature-3", "it opens on Axis 1");
      assert.equal((await axisList(page)).centre, false);
      await page.locator("#pattern-count3").fill("2");
      await copiesDrawn(page, 1);
      await page.locator("#pattern-count3").press("Enter");
      await closed(page);
      await rebuilt(page);
      near(await stl(page, false), 2000, TWO, "the cube and its half turn");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps: the cube tapped, Axis 1 chosen, 2 typed, the bar's Finish Pattern: 2,000 mm³ at x 0..40, y −10..10", async () => {
    const page = await fresh(375, 667, true);
    try {
      await openPattern(page, true);
      await at(page, TOP, true);
      await bodiesSay(page, "Repeating ");
      await page.waitForTimeout(300);
      await page.selectOption("#pattern-kind", "circular");
      await page.selectOption("#pattern-axis", "construct:feature-3");
      assert.deepEqual(await axisList(page), { options: AXES, centre: false });
      await page.locator("#pattern-count3").tap();
      await page.locator("#pattern-count3").fill("2");
      await copiesDrawn(page, 1);
      if (shots) await page.screenshot({ path: `${shots}/pattern-axis-375-picked.png` });
      await page.tap("#float-finish");
      await closed(page);
      await rebuilt(page);
      await items(page, 4);
      near(await stl(page, true), 2000, TWO, "2 round Axis 1");
      if (shots) await page.screenshot({ path: `${shots}/pattern-axis-375-done.png` });
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  server.httpServer.close();
}

if (errors.length) {
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
  failed++;
}
if (failed) process.exit(1);
