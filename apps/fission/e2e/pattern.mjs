// Browser check of the hidden Pattern tool (step 61c, pattern-panel.ts,
// pattern-tool.ts, pattern-flag.ts): without `?pattern` Create ▾ has only the
// greyed coming-soon line; with it, Create ▾ Pattern opens its panel, a click
// (or tap) on the cube picks it, the copies are previewed before OK, a count
// that makes no pattern is refused in words before the kernel, and OK records
// one undo step; Edit feature on it changes the spacing. The design: Box 1,
// a 10 mm cube at the origin, opened from a file. Worked by hand: the start
// spacing is the cube's 10 mm along X plus 5 = 15, so a row of 3 is the cube
// and copies at x 15..25 and 30..40: 3,000 mm³, x 0..40; spaced 20, x 0..50;
// a row of 4 at 15, x 0..55 and 4,000 mm³. 1280 px with a mouse and 375 px
// with taps (the phone bar's Finish Pattern). Screenshots go to E2E_SHOTS when
// set. Run with `npm run e2e` (after `npm run build`). Port 4967.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4967, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4967/";
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

const features = [
  {
    dependsOn: [],
    id: "feature-1",
    intent: { parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm", type: "box" },
    provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Pattern check", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const CUBE = [[0, 10], [0, 10], [0, 10]];
const row = (n, s) => [[0, (n - 1) * s + 10], [0, 10], [0, 10]];
const TOP = [5, 5, 10];

async function fresh(width, height, tap, query) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "pattern.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "the file open", 15000);
  await rebuilt(page);
  await settle(page);
  return page;
}

/** Create ▾'s items' ids, the menu opened and shut again. */
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
  await check("without ?pattern there is no Pattern: Create ▾ shows it greyed as coming soon, and the panel never opens", async () => {
    const page = await fresh(1280, 800, false, "");
    try {
      const ids = await createItems(page, false);
      assert.ok(!ids.includes("create-menu-pattern"), JSON.stringify(ids));
      assert.ok(ids.includes("coming-pattern"), JSON.stringify(ids));
      assert.equal(await page.$eval("#pattern-panel", (p) => p.hidden), true);
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: Pattern picks the cube by a click, starts 15 apart, previews 2 copies, refuses a count of 1 in words, OK makes 3,000 mm³ at x 0..40 as one undo step; Edit feature spaces them 20 (x 0..50)", async () => {
    const page = await fresh(1280, 800, false, "&pattern");
    try {
      near(await stl(page, false), 1000, CUBE, "as made");
      const ids = await createItems(page, false);
      assert.ok(ids.includes("create-menu-pattern") && !ids.includes("coming-pattern"), JSON.stringify(ids));
      await openPattern(page, false);
      assert.equal(await page.$eval("#pattern-ok", (b) => b.disabled), true, "OK off with no body");
      assert.equal(await page.$eval("#pattern-hint", (h) => [h.hidden, h.textContent].join()), "false,Pattern: click the bodies to repeat");
      await copiesDrawn(page, null);
      if (shots) await page.screenshot({ path: `${shots}/pattern-1280-empty.png` });
      await at(page, TOP);
      await bodiesSay(page, "Repeating ");
      assert.equal(await page.$eval("#pattern-hint", (h) => h.hidden), true, "the hint goes with a body picked");
      // The cube 10 long along X and 5 between: 15.
      assert.equal(await page.$eval("#pattern-spacing", (b) => b.value), "15");
      await copiesDrawn(page, 2);
      if (shots) await page.screenshot({ path: `${shots}/pattern-1280-preview.png` });
      // A count of 1 makes no pattern: said before the kernel, nothing drawn.
      await page.locator("#pattern-count").fill("1");
      await until(page, () => document.getElementById("pattern-preview-why")?.textContent === "A pattern needs at least 2, the body and one copy.", null, "the count refused in words");
      await copiesDrawn(page, null);
      await page.locator("#pattern-count").fill("3");
      await copiesDrawn(page, 2);
      await page.click("#pattern-ok");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      assert.equal(await page.$eval('#timeline [data-item="feature-2"]', (li) => li.dataset.icon), "pattern");
      if (shots) await page.screenshot({ path: `${shots}/pattern-1280-done.png` });
      near(await stl(page, false), 3000, row(3, 15), "a row of 3, 15 apart");
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), 1000, CUBE, "undone in one step");
      await press(page, "#redo", false);
      await rebuilt(page);
      near(await stl(page, false), 3000, row(3, 15), "redone");
      // Edit feature from its bar item's menu.
      await closePanels(page, false);
      await page.click('#timeline [data-item="feature-2"]', { button: "right" });
      await until(page, () => document.getElementById("row-menu")?.open, null, "Pattern 1's menu");
      assert.equal(await page.$eval("#row-menu-edit", (b) => b.disabled), false, "Edit feature is on");
      await page.click("#row-menu-edit");
      await opened(page);
      assert.equal(await page.textContent("#pattern-title"), "Edit Pattern 1");
      assert.equal(await page.$eval("#pattern-edit-note", (n) => n.hidden), false);
      assert.equal(await page.$eval("#pattern-spacing", (b) => b.value), "15");
      await copiesDrawn(page, 2);
      await page.locator("#pattern-spacing").fill("20");
      await copiesDrawn(page, 2);
      if (shots) await page.screenshot({ path: `${shots}/pattern-1280-edit.png` });
      await page.locator("#pattern-spacing").press("Enter");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      near(await stl(page, false), 3000, row(3, 20), "spaced 20");
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), 3000, row(3, 15), "the edit undone in one step");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps: the cube tapped opens the sheet on the boxes, 4 typed, the bar's Finish Pattern records it: 4,000 mm³ at x 0..55; Cancel from the bar records nothing", async () => {
    const page = await fresh(375, 667, true, "&pattern");
    try {
      await openPattern(page, true);
      const bar = () => page.evaluate(() => {
        const b = document.getElementById("phone-float");
        return b && !b.hidden ? { kind: b.dataset.kind, finish: document.getElementById("float-finish")?.textContent, off: document.getElementById("float-finish")?.disabled, cancel: !!document.getElementById("float-cancel") } : null;
      });
      assert.deepEqual(await bar(), { kind: "pattern", finish: "Finish Pattern", off: true, cancel: true }, "the bar, Finish off with no body");
      assert.equal(await page.$eval("#pattern-hint", (h) => [h.hidden, h.textContent].join()), "false,Pattern: tap the bodies to repeat");
      if (shots) await page.screenshot({ path: `${shots}/pattern-375-empty.png` });
      await at(page, TOP, true);
      await bodiesSay(page, "Repeating ");
      await copiesDrawn(page, 2);
      await page.waitForTimeout(300);
      assert.equal(await page.getAttribute("#properties-toggle", "aria-expanded"), "true", "the sheet opened on the boxes");
      // Alone in the sheet: nothing else of the properties shows under it.
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("#pattern-panel ~ *")].every((e) => getComputedStyle(e).display === "none")), true);
      await page.locator("#pattern-count").tap();
      await page.locator("#pattern-count").fill("4");
      await copiesDrawn(page, 3);
      if (shots) await page.screenshot({ path: `${shots}/pattern-375-picked.png` });
      assert.deepEqual(await bar(), { kind: "pattern", finish: "Finish Pattern", off: false, cancel: true }, "Finish on");
      await page.tap("#float-finish");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      assert.equal(await bar(), null, "the bar goes with the tool");
      near(await stl(page, true), 4000, row(4, 15), "a row of 4, 15 apart");
      if (shots) await page.screenshot({ path: `${shots}/pattern-375-done.png` });
      // Again, cancelled from the bar: nothing recorded.
      await openPattern(page, true);
      await page.tap("#float-cancel");
      await closed(page);
      await items(page, 2);
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
