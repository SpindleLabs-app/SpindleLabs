// Browser check of three phone and window leftovers from the clumsy-human
// hunt of 11-04 (delete-ask.ts, tiny-window.css, keep-typing-visible.ts).
// 1. A finger held on the box opens its menu; the phone turned (upright to
//    sideways and back) left the menu where it was, mostly off the screen.
//    It stays wholly on the screen after the turn, and its first choice
//    can still be tapped.
// 2. A window dragged absurdly small (200 × 150, 100 × 2000, 150 × 150,
//    1280 × 150): the page scrolled 25 to 33 px sideways and the 3D view
//    was 0 px tall. Nothing scrolls the page sideways, and the view keeps
//    at least 120 px (the page scrolls up and down for the rest). A phone
//    upright or sideways (375 × 667, 740 × 360) still never scrolls.
// 3. The phone's keyboard opening (the window getting shorter, as Android
//    does) hid the box being typed in under it. The box with the focus is
//    brought back into the part of the screen still showing, upright in
//    the Properties sheet and sideways in the Properties card.
// Every check was red on the build before these fixes (run with E2E_DIST
// naming another build's folder). Screenshots go to E2E_SHOTS.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel, startWithBox } from "./start.mjs";

const server = await preview({ build: { outDir: process.env.E2E_DIST || "dist" }, preview: { port: 4314, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4314/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
/** A check that records its failure and carries on, so one run shows every red one; the run fails at the end. */
function check(ok, what) {
  if (!ok) failures.push(what);
}

async function open(width, height, touch = true, box = true) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch && browserName !== "firefox" });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  if (box) await startWithBox(page, touch);
  else await page.locator("#start-hint").waitFor();
  return { page, context };
}

/** The menu's box against the window: wholly inside, and its first choice the thing at its own centre. */
async function menuOnScreen(page) {
  return page.evaluate(() => {
    const m = document.getElementById("row-menu");
    const r = m.getBoundingClientRect();
    const first = m.querySelector("button:not([disabled])");
    const f = first.getBoundingClientRect();
    const hit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
    return {
      open: m.open,
      on: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      tappable: hit === first || first.contains(hit),
      at: [r.left, r.top, r.right, r.bottom].map(Math.round).join(","),
      window: `${innerWidth} × ${innerHeight}`,
    };
  });
}

// 1. The held finger's menu, then the phone turned. Chromium only: real touch input through CDP, as view-menu.mjs.
if (browserName === "chromium") {
  for (const [[w0, h0], [w1, h1]] of [[[375, 667], [667, 375]], [[852, 393], [393, 852]]]) {
    const { page, context } = await open(w0, h0);
    await closePanels(page, true);
    const box = await page.locator("#viewport canvas").boundingBox();
    // The view's centre, where Insert framed the box (view-menu.mjs).
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [x, y]);
    check(under === "CANVAS", `${w0} × ${h0}: the view's centre is the canvas (it is ${under})`);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.getElementById("row-menu").open, null, { timeout: 8000 });
    const before = await menuOnScreen(page);
    check(before.on, `${w0} × ${h0}: the held finger's menu on screen before turning (${before.at} in ${before.window})`);
    await page.setViewportSize({ width: w1, height: h1 });
    await page.waitForTimeout(400);
    const after = await menuOnScreen(page);
    if (shots) await page.screenshot({ path: `${shots}/menu-turned-${w0}x${h0}-to-${w1}x${h1}.png` });
    check(after.open, `${w0} × ${h0} turned to ${w1} × ${h1}: the menu stays open`);
    check(after.on, `${w0} × ${h0} turned to ${w1} × ${h1}: the menu wholly on screen (${after.at} in ${after.window})`);
    check(after.tappable, `${w0} × ${h0} turned to ${w1} × ${h1}: the menu's first choice can be tapped`);
    await context.close();
  }
  console.log("checked - a held finger's menu stays on screen when the phone turns");
}

// 2. Absurdly small windows, and real phones' sizes unchanged.
for (const [width, height, touch] of [[200, 150, true], [100, 2000, true], [150, 150, true], [1280, 150, false], [375, 667, true], [740, 360, true]]) {
  const { page, context } = await open(width, height, touch, false);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    scrollTo(1000, 0);
    const sideways = scrollX;
    scrollTo(0, 0);
    const view = document.querySelector("#viewport").getBoundingClientRect();
    return { sideways, wide: document.documentElement.scrollWidth, tall: document.documentElement.scrollHeight, view: Math.round(view.height), inner: innerHeight };
  });
  if (shots) await page.screenshot({ path: `${shots}/tiny-${width}x${height}.png`, fullPage: true });
  const at = `${width} × ${height}`;
  check(r.sideways === 0, `${at}: the page scrolls ${r.sideways} px sideways`);
  check(r.wide <= width, `${at}: the page is ${r.wide} px wide`);
  check(r.view >= 120, `${at}: the 3D view is ${r.view} px tall (at least 120)`);
  // A real phone's page never scrolls (phone-sheet.css); only an absurdly short window does.
  if (height > 300) check(r.tall <= r.inner, `${at}: the page is ${r.tall} px tall in a ${r.inner} px window`);
  await context.close();
}
console.log("checked - tiny windows: no sideways scroll, the 3D view at least 120 px; phones unchanged");

// 3. The keyboard opening over the box with the focus.
for (const [[width, height], keyboardTop] of [[[393, 852], 480], [[852, 393], 200]]) {
  const { page, context } = await open(width, height);
  await openPanel(page, "properties", true);
  // The last size box of the box's parameters, the one lowest down.
  const id = await page.$$eval("#properties input[type=number], #properties input[type=text]", (es) => es.filter((e) => e.getClientRects().length && !e.disabled).map((e) => e.id).pop());
  check(!!id, `${width} × ${height}: a size box to type in`);
  if (id) {
    await page.focus(`#${id}`);
    await page.waitForTimeout(200);
    // The keyboard takes the bottom of the screen: the window gets shorter.
    await page.setViewportSize({ width, height: keyboardTop });
    await page.waitForTimeout(500);
    const r = await page.evaluate((id) => {
      const e = document.getElementById(id);
      const b = e.getBoundingClientRect();
      const v = visualViewport;
      return { focus: document.activeElement?.id, top: Math.round(b.top), bottom: Math.round(b.bottom), shows: b.top >= 0 && b.bottom <= v.height };
    }, id);
    if (shots) await page.screenshot({ path: `${shots}/keyboard-${width}x${height}.png` });
    check(r.focus === id, `${width} × ${height}: ${id} keeps the focus as the keyboard opens (focus on ${r.focus})`);
    check(r.shows, `${width} × ${height} with the keyboard (${keyboardTop} px left): ${id} at ${r.top} to ${r.bottom} px, under the keyboard`);
  }
  await context.close();
}
console.log("checked - the keyboard never hides the box being typed in");

await browser.close();
server.close?.();
assert.deepEqual(failures, [], "phone leftovers");
assert.deepEqual(errors, [], "no page errors");
console.log("ok - phone and window leftovers");
process.exit(0);
