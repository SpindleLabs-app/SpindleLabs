// Ben's rule on a phone: one tap never covers most of the view. The ▾ menus covered 63–88% of the 3D view at 375 and
// 393 px (accessibility pass, 2026-11-11), and Ben OK'd capping them: each menu is a bottom sheet of at most 34% of the
// window less 8 px, its items in two columns, the rest scrolling. This checks, at 320, 375, 393 and 430 px upright with
// taps, that every ▾ menu and the History panel leave at least 60% of the view
// uncovered (a 12 × 12 grid of points over #viewport, each covered when what is on top there is outside it; the floating
// pills count too), that every item of every menu can still be reached by scrolling the sheet and is a finger's height
// (44 px), and that the check fails with the old 70% menu sheet put back.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4791, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4791/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
const LIMIT = 0.4;
const MENUS = ["file-menu", "workspace-menu", "create-menu", "modify-menu", "construct-menu", "inspect-menu", "insert"];

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, true);
  return { page, context };
}

/** The share of the 3D view covered: 144 points over #viewport, each covered when the element on top is outside it. */
const covered = (page) =>
  page.evaluate(() => {
    const v = document.getElementById("viewport").getBoundingClientRect();
    let n = 0;
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++) {
        const hit = document.elementFromPoint(v.left + ((i + 0.5) * v.width) / 12, v.top + ((j + 0.5) * v.height) / 12);
        if (!hit || !hit.closest("#viewport")) n++;
      }
    return n / 144;
  });

/** Every item of the open menu `id`: scrolled into its sheet, it is the element on top at its own centre, and 44 px tall. */
const unreachable = (page, id) =>
  page.evaluate((id) => {
    const menu = document.getElementById(id).closest(".menu-button").querySelector(".menu-button-menu");
    const out = [];
    for (const item of menu.querySelectorAll(".menu-button-item")) {
      item.scrollIntoView({ block: "nearest" });
      const r = item.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !item.contains(hit)) out.push(`${item.id || item.textContent}: not on top once scrolled to`);
      if (r.height < 44 - 0.5) out.push(`${item.id || item.textContent}: ${r.height.toFixed(1)} px tall`);
    }
    menu.scrollTop = 0;
    return out;
  }, id);

async function tapMenu(page, id) {
  await page.tap(`#${id}`);
  await page.waitForFunction((id) => document.getElementById(id).getAttribute("aria-expanded") === "true", id, { timeout: 5000 });
  await page.waitForTimeout(150);
}
async function closeMenu(page, id) {
  await page.keyboard.press("Escape");
  await page.waitForFunction((id) => document.getElementById(id).getAttribute("aria-expanded") !== "true", id, { timeout: 5000 });
}

let failed = false;
try {
  for (const [width, height] of [[320, 568], [375, 667], [393, 852], [430, 932]]) {
    const { page, context } = await open(width, height);
    const tag = `${width}x${height}`;
    for (const id of MENUS) {
      await tapMenu(page, id);
      const c = await covered(page);
      if (shots && width === 393) await page.screenshot({ path: `${shots}/phone-menu-${id}-${tag}.png` });
      assert.ok(c <= LIMIT, `${tag} ${id}: one tap covers ${(c * 100).toFixed(0)}% of the view, over ${LIMIT * 100}%`);
      assert.deepEqual(await unreachable(page, id), [], `${tag} ${id}: every item reachable and a finger's height`);
      await closeMenu(page, id);
    }
    // History (beside Undo): one tap, the same limit. (The Browser and Properties sheets stay at 45% of the workspace,
    // phone-sheet.mjs: a tool's panel fills the Properties sheet and must not scroll.)
    for (const [toggle, shut] of [["history", "#history-panel .history-close"]]) {
      await page.tap(`#${toggle}`);
      await page.waitForTimeout(400);
      const c = await covered(page);
      assert.ok(c <= LIMIT, `${tag} ${toggle}: one tap covers ${(c * 100).toFixed(0)}% of the view, over ${LIMIT * 100}%`);
      await page.tap(shut);
      await page.waitForTimeout(300);
    }
    // The check can fail: the old 70% menu sheet put back covers more than 40% with Modify ▾ (12 items) open.
    if (width === 393) {
      const old = await page.addStyleTag({ content: ".phone-sheet .menu-button > .menu-button-menu:not(#none):not(#no-such-id):not(#no-such-id2) { max-height: 70dvh; }" });
      await tapMenu(page, "modify-menu");
      const c = await covered(page);
      assert.ok(c > LIMIT, `the planted 70% sheet should cover over ${LIMIT * 100}%, it covers ${(c * 100).toFixed(0)}%`);
      await closeMenu(page, "modify-menu");
      await old.evaluate((s) => s.remove());
    }
    await context.close();
  }
  assert.deepEqual(errors, [], "no page errors or console errors");
  console.log("PASS phone menus: every ▾ menu and History cover at most 40% of the view at 320–430 px, every item reachable");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);
