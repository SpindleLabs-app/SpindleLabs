// A tablet (a touch screen wider than a phone) gets the phone's finger-sized targets (Ben's OK, 2026-11-11): at 768 ×
// 1024 the accessibility pass found 54 of 56 targets under 44 px, as the desktop layout sized them for a mouse. With
// touch (pointer: coarse) at 768 × 1024, 1024 × 768 and 820 × 1180: the toolbar's tools and group names, the view bar's
// buttons and the Bodies row's eye are at least 44 px; the timeline's playback buttons tap in 40 px. With a mouse at the
// same 1024 × 768 they keep their mouse size (the control: the change must be the touch screen's, not the width's).
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4793, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4793/";
const browser = await launch();
const errors = [];

const TARGETS = ["#toolbar .toolbar-group-tool", "#toolbar .toolbar-group-name .menu-button-toggle", ".view-controls button.nav-button", ".browser-row-eye"];

async function sizes(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await startWithBox(page, touch);
  assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), touch, `${width}: pointer coarse is ${touch}`);
  // Open the Bodies folder so its eye is drawn.
  await page.evaluate(() => { for (const d of document.querySelectorAll("#browser details")) d.open = true; });
  const out = {};
  for (const sel of TARGETS) {
    out[sel] = await page.$$eval(sel, (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [e.id || e.getAttribute("aria-label") || e.textContent.trim(), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
  }
  out.playback = await page.$$eval(".timeline-marker-button", (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = getComputedStyle(e, "::before"); return r.content !== "none" && r.content !== "normal"; }));
  await context.close();
  return out;
}

let failed = false;
try {
  for (const [width, height] of [[768, 1024], [1024, 768], [820, 1180]]) {
    const s = await sizes(width, height, true);
    const small = [];
    for (const sel of TARGETS) {
      assert.ok(s[sel].length > 0, `${width}: some ${sel} shown`);
      for (const [name, w, h] of s[sel]) if (h < 44 - 0.5 || (sel !== ".browser-row-eye" && sel.includes("tool") && w < 44 - 0.5)) small.push(`${sel} ${name}: ${w} × ${h}`);
    }
    assert.deepEqual(small, [], `${width} × ${height} with touch: every target a finger's size`);
    assert.ok(s.playback.length > 0 && s.playback.every(Boolean), `${width}: the playback buttons have their 40 px tap areas`);
  }
  // The control: a mouse at the same width keeps the mouse sizes, so the check sees the touch screen, not the width.
  const mouse = await sizes(1024, 768, false);
  assert.ok(mouse["#toolbar .toolbar-group-tool"].some(([, , h]) => h < 44 - 0.5), "with a mouse the toolbar's tools stay mouse-sized");
  assert.deepEqual(errors, [], "no page errors");
  console.log("PASS tablet targets: with touch at 768, 820 and 1024 px every toolbar, view bar and eye target is 44 px; a mouse keeps 36");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);
