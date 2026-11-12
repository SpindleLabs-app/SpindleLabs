// Browser check of Undo and Redo over an open sheet on a phone (SL #623 item 6, Undo hunt 2026-11-12 F2): at phone width
// the pair is docked in the view's bottom-right corner, where the Browser and Properties sheets rise, so a size mistyped in
// the open Properties sheet could not be undone until the sheet was shut (a phone has no Ctrl+Z). An open sheet now lifts
// the pair to just above its top edge (undo-lift.ts): both buttons on screen, clear of the sheet, tappable; a tap on Undo
// takes the size back with the sheet left open, so the size can be seen going back; shut, the pair is in its corner again.
// At 375 × 667 and 393 × 852 (the hunt's phones) and 320 × 568 (the narrowest), with taps. Screenshots go to E2E_SHOTS
// when set. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4863, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4863/?test-hooks#design";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
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

/** Each of Undo, Redo and the pair holding them (and History): its box, whether it is all inside the window, whether a tap at its middle lands on it, and how far
 * its bottom is above the top of the sheet `open` names (null when none is named). */
const pair = (page, open = null) =>
  page.evaluate((open) => {
    const top = open === null ? null : document.getElementById(open).getBoundingClientRect().top;
    return ["undo", "redo", "undo-redo"].map((id) => {
      const b = document.getElementById(id);
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id, onScreen: r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tappable: b.contains(hit), clear: top === null ? null : top - r.bottom, bottom: r.bottom, right: r.right };
    });
  }, open);
const sheetOpen = (page, slot, open) => page.waitForFunction(([s, o]) => document.getElementById(`${s}-toggle`).getAttribute("aria-expanded") === String(o), [slot, open]);
const volume = (page, text) => page.waitForFunction((t) => document.querySelector("#volume")?.textContent === t, text);
// Lifting follows the sheet's layout a frame later (a ResizeObserver): wait until it has settled.
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const [width, height] of [[375, 667], [393, 852], [320, 568]]) {
  await check(`${width} × ${height}: Undo and Redo above the open Properties sheet, tappable; Undo takes a typed size back with the sheet still open`, async () => {
    const { page, context } = await open(width, height);
    const shut = await pair(page);
    for (const b of shut) assert.ok(b.onScreen && b.tappable, `${b.id} in its corner with no sheet open`);
    await page.tap("#properties-toggle");
    await sheetOpen(page, "properties", true);
    await page.fill("#width", "50");
    await volume(page, "30,000 mm³");
    await frames(page);
    for (const b of await pair(page, "properties")) {
      assert.ok(b.onScreen, `${b.id} on screen over the open sheet`);
      assert.ok(b.tappable, `${b.id} tappable, nothing over it`);
      // The whole pair (Undo, Redo and History in a column) just above the sheet: 8 px clear of its edge, as from the
      // screen's corner, never floated further up the view.
      if (b.id === "undo-redo") assert.ok(Math.abs(b.clear - 8) <= 1, `the pair's bottom ${b.clear} px above the sheet's top, not 8`);
      else assert.ok(b.clear >= 8 - 1, `${b.id} clear of the sheet (${b.clear} px)`);
    }
    if (shots) await page.screenshot({ path: `${shots}/phone-undo-sheet-${width}.png` });
    await page.tap("#undo");
    await volume(page, "24,000 mm³");
    assert.equal(await page.getAttribute("#properties-toggle", "aria-expanded"), "true", "the sheet stays open, so the size is seen going back");
    assert.equal(await page.inputValue("#width"), "40", "the Width box says 40 again");
    await page.tap("#redo");
    await volume(page, "30,000 mm³");
    // Shut, the pair goes back to its corner.
    await page.tap("#properties-toggle");
    await sheetOpen(page, "properties", false);
    await frames(page);
    assert.deepEqual(await pair(page), shut, "back in the corner once the sheet is shut");
    await context.close();
  });
}

await check("375 × 667: the Browser sheet lifts the pair too", async () => {
  const { page, context } = await open(375, 667);
  await page.tap("#browser-toggle");
  await sheetOpen(page, "browser", true);
  await frames(page);
  for (const b of await pair(page, "browser")) assert.ok(b.onScreen && b.tappable && b.clear >= 7 && (b.id !== "undo-redo" || b.clear <= 9), `${b.id} above the Browser sheet and tappable (${JSON.stringify(b)})`);
  await context.close();
});

await check("1280 px: no lifting, the pair stays on the bar after Save", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  assert.equal(await page.$eval("#undo-redo", (p) => p.classList.contains("docked") || p.style.bottom !== ""), false);
  assert.equal(await page.$eval("#undo-redo", (p) => p.previousElementSibling?.id), "save");
  await context.close();
});

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
