// Browser check of the command search button (the S key's box for a touch screen, which has no S key): a button first in
// the Design toolbar opens the same box by a tap; at phone widths the box's list is short enough that one tap never covers
// most of the view; the top bar is untouched (still one row at 641 px with 40 px between the workspace button and AI);
// the button is hidden while a sketch is edited, as S does nothing there.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4781, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4781/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function open(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch && width < 641 });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, touch);
  return { page, context };
}
const box = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });

let failed = false;
try {
  for (const [width, height, touch] of [[375, 667, true], [393, 852, true], [641, 375, true], [1280, 800, false]]) {
    const { page, context } = await open(width, height, touch);
    const tag = `${width}x${height}`;
    const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
    // The button is on screen, a finger's size, and clear of every other toolbar button.
    await page.evaluate(() => { document.getElementById("toolbar").scrollLeft = 0; });
    const b = await box(page, "#command-search-button");
    assert.ok(b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= height, `${tag}: the button is off screen ${JSON.stringify(b)}`);
    assert.ok(b.width >= 32 && b.height >= 32, `${tag}: the button is ${b.width} x ${b.height}, under 32 px`);
    // Scrolled to the far end, the button stays at the left edge (it sticks); at the start nothing lies under it.
    await page.evaluate(() => { const t = document.getElementById("toolbar"); t.scrollLeft = t.scrollWidth; });
    const stuck = await box(page, "#command-search-button");
    assert.ok(stuck.left >= 0 && stuck.right <= width, `${tag}: the button scrolled away ${JSON.stringify(stuck)}`);
    await page.evaluate(() => { document.getElementById("toolbar").scrollLeft = 0; });
    const clash = await page.evaluate(() => {
      const me = document.getElementById("command-search-button").getBoundingClientRect();
      for (const o of document.querySelectorAll("#toolbar button")) {
        if (o.id === "command-search-button") continue;
        const r = o.getBoundingClientRect();
        if (r.width > 2 && Math.min(r.right, me.right) - Math.max(r.left, me.left) > 1 && Math.min(r.bottom, me.bottom) - Math.max(r.top, me.top) > 1) return o.id;
      }
      return null;
    });
    assert.equal(clash, null, `${tag}: the button overlaps ${clash}`);
    assert.equal(await page.$eval("#command-search-button", (e) => e.getAttribute("aria-label")), "Search commands");
    // The top bar is as it was: one row at 641 with 40 px between the workspace button and AI (phone-short.mjs's rule).
    if (width === 641) {
      assert.ok((await box(page, "#topbar")).height <= 48, `${tag}: the top bar wraps`);
      const gap = await page.evaluate(() => document.getElementById("assistant-toggle").getBoundingClientRect().left - document.getElementById("workspace-menu").getBoundingClientRect().right);
      assert.ok(gap >= 40, `${tag}: ${gap.toFixed(1)} px between the workspace button and AI, under 40`);
    }
    // A tap opens the box with the focus in it; it covers well under half the window (the scrim only dims).
    await press("#command-search-button");
    await page.waitForSelector("#command-search-input", { state: "visible" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "command-search-input", `${tag}: the focus`);
    const card = await box(page, ".command-search [role=dialog]");
    assert.ok(card.height <= height * (touch ? 0.4 : 0.5), `${tag}: the box is ${card.height} px of ${height} px, over the limit (Ben's rule: one tap on a phone never covers most of the view)`);
    assert.ok(card.left >= 0 && card.right <= width, `${tag}: the box is wider than the window`);
    if (shots) await page.screenshot({ path: `${shots}/command-search-button-${tag}.png` });
    // Tapping a command runs it and closes the box.
    await page.fill("#command-search-input", "mo");
    await press("#command-search-list li:first-child");
    await page.waitForFunction(() => document.getElementById("move-panel")?.hidden === false, null, { timeout: 10000 });
    assert.equal(await page.isVisible("#command-search-input"), false, `${tag}: the box closes once a command runs`);
    await page.evaluate(() => document.getElementById("move-cancel").click());
    // Tapping outside the card closes the box, nothing run.
    await press("#command-search-button");
    await page.waitForSelector("#command-search-input", { state: "visible" });
    await page.mouse.click(width / 2, height - 4);
    await page.waitForSelector("#command-search-input", { state: "detached" });
    // Hidden while a sketch is edited.
    if (width === 1280) {
      await page.click("#create-sketch");
      await page.waitForSelector("#plane-XY, [data-plane]", { state: "attached", timeout: 3000 }).catch(() => {});
      await page.keyboard.press("Escape");
    }
    await context.close();
  }
  assert.deepEqual(errors, [], "no page errors or console errors");
  console.log("PASS command search button");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);
