// Browser check of SL #764 item 2 (P-2, app-wide hunt 2026-11-14): a sideways finger swipe on a bar or a sheet is never
// the browser's Back. On Chromium's touch screens (phones, school Chromebooks, touch laptops) a swipe of about 250 px to
// the right that no scroller under the finger could take (the sketch toolbar at its start, the top bar, the timeline,
// the view bar, the Properties sheet) went back in the browser's history: the app was left with no question, and a
// half-drawn shape or a typed value was gone after Forward. The page root now ends every sideways chain with
// overscroll-behavior none (packages/ui theme.css), and no scroller inside ends one itself (Chromium navigated when the
// chain stopped at a scroller set to contain sideways, as the sheet and the view bar were).
// For each place: the page still holds the app after the swipe, and what was under way (a sketch, its first corner) is
// still there. Control: a swipe over the 3D view, an orbit. Red on the build before the fix for every place but the
// control (run with E2E_DIST naming that build's folder). Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const PORT = 4917;
const server = await preview({ build: { outDir: process.env.E2E_DIST || "dist" }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
const errors = [];
let failed = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n${e.stack}`);
  }
}

/** A fresh page on a touch screen (`phone`: a phone, else a touch laptop), opened from a blank page so Back has somewhere to go. */
async function opened(width, height, phone) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, ...(phone ? { isMobile: true, deviceScaleFactor: 2 } : {}) });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("about:blank");
  await page.goto(`http://localhost:${PORT}/#design`);
  await page.locator("#create-sketch").waitFor();
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) });
  /** One finger from (x, y) `dx` px to the right in 15 steps over about 300 ms, as a quick swipe. */
  const swipe = async ([x, y], dx = 250) => {
    await touch("touchStart", [[x, y]]);
    for (let k = 1; k <= 15; k++) {
      await touch("touchMove", [[Math.min(width - 8, x + (dx * k) / 15), y + 2]]);
      await page.waitForTimeout(20);
    }
    await touch("touchEnd", []);
    await page.waitForTimeout(1200);
  };
  return { page, context, swipe };
}

/** Where a finger goes down on `selector`: near its left end (at most 30 px in), half way down. */
const fingerOn = (page, selector) => page.$eval(selector, (e) => { const r = e.getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 30), r.top + r.height / 2]; });
const inApp = (page) => page.url().startsWith(`http://localhost:${PORT}/`);
const sketching = (page) => page.evaluate(() => document.querySelector("#viewport")?.dataset.sketching === "true");

/** A sketch on XY with the Rectangle tool's first corner tapped (what a swipe that leaves the app loses). */
async function halfRectangle(page) {
  await page.tap("#create-sketch");
  await page.waitForTimeout(300);
  await page.tap((await page.isVisible("#float-plane-XY")) ? "#float-plane-XY" : "#sketch-plane-XY");
  await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.sketching === "true", null, { timeout: 10000 });
  await page.tap("#sketch-tool-rectangle");
  const c = await page.$eval("#viewport canvas", (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.4]; });
  await page.touchscreen.tap(c[0], c[1]);
  await page.waitForTimeout(300);
}

const PHONE = [
  ["the 3D view (control: an orbit)", null, async (page) => page.$eval("#viewport canvas", (e) => { const r = e.getBoundingClientRect(); return [r.left + 20, r.top + r.height * 0.6]; })],
  ["the top bar", null, (page) => fingerOn(page, "#file-menu")],
  ["the main toolbar at its start", null, (page) => fingerOn(page, "#create-menu")],
  ["the view bar", null, (page) => fingerOn(page, ".view-controls button")],
  ["the timeline bar", null, (page) => fingerOn(page, "#timeline")],
  ["the sketch toolbar at its start, a rectangle half drawn", halfRectangle, (page) => fingerOn(page, "#sketch-create")],
  [
    "the Properties sheet open over a sketch",
    async (page) => {
      await halfRectangle(page);
      if ((await page.getAttribute("#properties-toggle", "aria-expanded")) !== "true") await page.tap("#properties-toggle");
      await page.waitForTimeout(400);
    },
    (page) => fingerOn(page, "#properties"),
  ],
];

for (const [width, height] of [[375, 667], [393, 852]])
  for (const [where, setup, from] of PHONE)
    await check(`${width} × ${height} phone: a 250 px swipe right on ${where} stays in the app`, async () => {
      const { page, context, swipe } = await opened(width, height, true);
      if (setup) await setup(page);
      const wasSketching = await sketching(page);
      await swipe(await from(page));
      assert.ok(inApp(page), `the swipe left the app for ${page.url()}`);
      assert.equal(await sketching(page), wasSketching, "what was under way is still under way");
      await context.close();
    });

const LAPTOP = [
  ["the toolbar", (page) => fingerOn(page, "#create-menu")],
  ["the top bar", (page) => fingerOn(page, "#file-menu")],
  ["the Browser panel", (page) => fingerOn(page, "#browser")],
  ["the timeline bar", (page) => fingerOn(page, "#timeline")],
];
for (const [where, from] of LAPTOP)
  await check(`1280 × 800 touch laptop: a 300 px finger swipe right on ${where} stays in the app`, async () => {
    const { page, context, swipe } = await opened(1280, 800, false);
    await swipe(await from(page), 300);
    assert.ok(inApp(page), `the swipe left the app for ${page.url()}`);
    await context.close();
  });

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
