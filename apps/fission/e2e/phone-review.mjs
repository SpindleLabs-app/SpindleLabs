// Browser check of the phone-width UI review fixes (2026-11-18, findings 10 to 12), 375 × 667 with taps, 1280 px as before:
// 10. Menu's Settings row says "Settings" beside its gear, as AI, Guide and Community do (it was a gear alone);
// 11. Settings' "Follow device" stays on one line (it broke over two), the theme choices under the row's name instead;
// 12. the Design toolbar, one row you swipe at phone width, fades at its right edge while tools lie past it (cut off at
//     "MODIF…" with no sign it scrolled), not once scrolled to its end, and not while one of its menus is open (the fade
//     would clip the menu). At 1280 px nothing changes: the gear an icon alone, no fade.
// Each check was red on the build before (the word 1 px wide, the button two lines tall, no mask). SHOTS=dir saves screenshots.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4977, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4977/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  return page;
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
/** The toolbar's fade: its data-more and whether a mask is drawn. */
const fade = (page) => page.evaluate(() => {
  const bar = document.getElementById("toolbar");
  const mask = getComputedStyle(bar).maskImage || getComputedStyle(bar).webkitMaskImage || "none";
  return { more: bar.dataset.more, masked: mask !== "none" };
});

try {
  await check("375 px, taps: Menu's Settings row says Settings beside its gear", async () => {
    const page = await fresh(375, 667, true);
    await page.tap("#menu-toggle");
    const word = page.locator("#settings-open .tool-word");
    const box = await word.boundingBox();
    // "Settings" at the menu's 13–14 px text is about 55 px wide; hidden it was the 1 × 1 px name kept for screen readers.
    assert.ok(box && box.width > 30 && box.height > 10, `the word drawn ${JSON.stringify(box)}`);
    assert.equal((await word.textContent()).trim(), "Settings");
    const row = await page.locator("#settings-open").boundingBox();
    assert.ok(row.x >= 0 && row.x + row.width <= 375, "the row inside the screen");
    if (shots) await page.screenshot({ path: `${shots}/menu-375.png` });
    await page.context().close();
  });

  await check("375 px, taps: Settings' Follow device on one line", async () => {
    const page = await fresh(375, 667, true);
    await page.tap("#menu-toggle");
    await page.tap("#settings-open");
    const choice = (name) => page.locator(".settings .settings-choice", { hasText: name }).first().boundingBox();
    // The words' own line boxes: the button keeps its 44 px however many lines it holds, so its height can't tell.
    const lines = await page.evaluate(() => {
      const button = [...document.querySelectorAll(".settings .settings-choice")].find((b) => b.textContent.trim() === "Follow device");
      const range = document.createRange();
      range.selectNodeContents(button);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    assert.equal(lines, 1, "Follow device on one line");
    const follow = await choice("Follow device");
    const light = await choice("Light");
    assert.ok(Math.abs(follow.y - light.y) < 1, "the four choices one row");
    const custom = await choice("Custom");
    assert.ok(custom.x + custom.width <= 375, "the row of choices on the screen");
    if (shots) await page.screenshot({ path: `${shots}/settings-375.png` });
    await page.context().close();
  });

  await check("375 px, taps: the Design toolbar fades at its right edge while tools lie past it", async () => {
    const page = await fresh(375, 667, true);
    assert.deepEqual(await fade(page), { more: "right", masked: true }, "unscrolled: tools past the right edge");
    await page.evaluate(() => { document.getElementById("toolbar").scrollLeft = 300; });
    await page.waitForFunction(() => document.getElementById("toolbar").dataset.more === "left right");
    assert.equal((await fade(page)).masked, true, "in the middle: still more to the right");
    await page.evaluate(() => { const bar = document.getElementById("toolbar"); bar.scrollLeft = bar.scrollWidth; });
    await page.waitForFunction(() => document.getElementById("toolbar").dataset.more === "left");
    assert.equal((await fade(page)).masked, false, "at the end: nothing past it, no fade");
    // A menu opened from the row is drawn below it; the row's mask would clip it away, so the fade stops while it is open.
    await page.evaluate(() => { document.getElementById("toolbar").scrollLeft = 0; });
    await page.waitForFunction(() => document.getElementById("toolbar").dataset.more === "right");
    await page.locator("#toolbar [aria-expanded]:visible").first().tap();
    await page.waitForFunction(() => document.querySelector('#toolbar [aria-expanded="true"]') !== null);
    assert.equal((await fade(page)).masked, false, "a menu open: no fade");
    if (shots) await page.screenshot({ path: `${shots}/toolbar-menu-375.png` });
    await page.context().close();
  });

  await check("375 px: another workspace's toolbar is watched too (Laser's fits: no fade), and Design's again on return", async () => {
    const page = await fresh(375, 667, true);
    await page.goto(url + "?all#laser");
    await page.waitForFunction(() => document.getElementById("toolbar")?.classList.contains("scroll-more"));
    const laser = await fade(page);
    assert.equal(laser.masked, laser.more?.includes("right") ?? false, "a fade only with tools past the edge");
    await page.goto(url + "?all#design");
    await page.waitForFunction(() => document.getElementById("toolbar")?.dataset.more === "right");
    await page.context().close();
  });

  await check("1280 px: as before, the gear an icon alone and no fade", async () => {
    const page = await fresh(1280, 800, false);
    const word = await page.locator("#settings-open .tool-word").boundingBox();
    assert.ok(!word || word.width <= 1, "the gear's word kept out of sight");
    assert.deepEqual(await fade(page), { more: "", masked: false });
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
