// Browser check of the sketch toolbar on a phone as one row (UI audit 2026-11-12, Ben's choice 2026-11-12): the tools
// wrapped to three rows at 375 and 393 px (149 px, about a quarter of an iPhone's view) and five at 320 px (195 px), so
// a sketch was drawn in what was left. Now every button sits in one row the toolbar scrolls sideways, the view gets the
// rows back, and a finger's swipe along the toolbar brings the far tools (the constraints, Snap, Finish Sketch) into
// sight. At 320 × 568, 375 × 667 and 393 × 852 with taps: one row no taller than a 44 px button and its padding, the
// page itself never scrolling sideways, every button reachable (scrolled to, on screen and the one a tap there hits),
// a swipe along the toolbar moving it, Rectangle and Dimension each lit by a tap, the Create menu wholly on screen.
// At 1280 px nothing changes (the toolbar one row, no scroll). Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4895, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4895/#design";
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

async function sketchOpen(width, height, phone) {
  const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  if (phone) {
    await page.tap("#create-sketch");
    await page.tap("#float-plane-XY");
  } else {
    await page.click("#create-sketch");
    await page.click("#sketch-plane-XY");
  }
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
  return { page, context };
}

/** The toolbar's height, how many rows its shown buttons make, their ids, the view's height and whether the page scrolls sideways. */
const layout = (page) =>
  page.evaluate(() => {
    const bar = document.getElementById("toolbar");
    const shown = [...bar.querySelectorAll("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().width > 0);
    // Rows: the buttons' middles sorted top to bottom, a new row wherever one sits 20 px or more below the last (buttons in
    // one row differ in height, so their tops differ by a few pixels; a second row starts a whole button lower).
    const mids = shown.map((b) => { const r = b.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
    const rows = { size: mids.filter((m, k) => k === 0 || m - mids[k - 1] >= 20).length };
    return {
      height: bar.getBoundingClientRect().height,
      rows: rows.size,
      ids: shown.map((b) => b.id).filter(Boolean),
      view: document.getElementById("viewport").getBoundingClientRect().height,
      pageScrolls: document.scrollingElement.scrollWidth > innerWidth,
      barScrolls: bar.scrollWidth > bar.clientWidth,
    };
  });

/** Scrolled into the toolbar's sight, is the button wholly in the window (to within a pixel: the last one ends a fraction of a pixel past the edge, its width being fractional) and the element a tap at its middle hits? */
const reach = (page, id) =>
  page.evaluate((id) => {
    const b = document.getElementById(id);
    b.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { r: [r.left, r.right, r.top, r.bottom, innerWidth], onScreen: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight, hits: hit === b || b.contains(hit), height: r.height };
  }, id);

// The 3D view's height with a sketch open before the change (measured on main 2026-11-12, the toolbar wrapped to 5, 3
// and 3 rows: 195, 149 and 149 px). One row of at most 60 px gives back at least 195 − 60 = 135 and 149 − 60 = 89 px.
const VIEW_BEFORE = { 320: [289, 135], 375: [434, 89], 393: [619, 89] };

for (const [width, height] of [[320, 568], [375, 667], [393, 852]]) {
  await check(`${width} × ${height} with taps: the sketch toolbar is one row that a swipe scrolls; every button reachable, the view taller`, async () => {
    const { page, context } = await sketchOpen(width, height, true);
    const l = await layout(page);
    assert.equal(l.rows, 1, `one row of buttons (${l.rows} rows, the toolbar ${l.height} px)`);
    // One row: a 44 px button and the toolbar's padding, never a second row's 44 px more.
    assert.ok(l.height <= 60, `the toolbar ${l.height} px tall, at most 60`);
    assert.equal(l.pageScrolls, false, "the page never scrolls sideways");
    const [before, gain] = VIEW_BEFORE[width];
    assert.ok(l.view >= before + gain, `the view ${l.view} px tall, at least ${before} + ${gain}`);
    assert.ok(l.barScrolls, "the toolbar scrolls sideways (more tools than the screen is wide)");
    for (const id of ["sketch-tool-line", "sketch-tool-dimension", "sketch-create", "sketch-snap", "finish-sketch"]) assert.ok(l.ids.includes(id), `${id} shown`);
    for (const id of l.ids) {
      const r = await reach(page, id);
      assert.ok(r.onScreen && r.hits, `${id} scrolled into sight is on screen and the one a tap hits (${JSON.stringify(r)})`);
      assert.ok(r.height >= 44, `${id} is 44 px tall to tap (${r.height})`);
    }
    // A finger's swipe from right to left along the toolbar scrolls it (CDP touches, as a phone sends them).
    await page.evaluate(() => (document.getElementById("toolbar").scrollLeft = 0));
    const bar = await page.$eval("#toolbar", (b) => { const r = b.getBoundingClientRect(); return { y: r.top + r.height / 2, x: r.right - 20 }; });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bar.x, y: bar.y }] });
    for (let k = 1; k <= 10; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bar.x - 20 * k, y: bar.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.getElementById("toolbar").scrollLeft > 50, null, { timeout: 3000 }).catch(() => assert.fail("a swipe along the toolbar scrolls it"));
    // Taps choose tools at both ends of the row.
    await page.tap("#sketch-tool-rectangle");
    assert.equal(await page.getAttribute("#sketch-tool-rectangle", "aria-pressed"), "true", "Rectangle lit by a tap");
    await page.tap("#sketch-tool-dimension");
    assert.equal(await page.getAttribute("#sketch-tool-dimension", "aria-pressed"), "true", "Dimension lit by a tap");
    // The Create menu opens wholly on screen from its scrolled button.
    await page.tap("#sketch-create");
    const menu = await page.$eval("#sketch-create-menu", (m) => { const r = m.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
    assert.ok(menu, "the Create menu wholly on screen");
    await context.close();
  });
}

await check("1280 px with a mouse: the sketch toolbar is one row with nothing to scroll, as before", async () => {
  const { page, context } = await sketchOpen(1280, 800, false);
  const l = await layout(page);
  assert.equal(l.rows, 1, `one row (${l.rows})`);
  assert.equal(l.barScrolls, false, "nothing hidden past the edge");
  await context.close();
});

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
