// Browser check of the History panel (Ben's go-ahead 2026-11-05): a clock button beside Undo and Redo opens a list of every step, newest
// first; a click on a step puts the project back as it was then (and forward again), the steps after it stay, dimmed;
// Escape, Close and a press elsewhere put it away. At phone width (393 x 852) it is a docked 48 px button and a bottom
// sheet of at most 45 % of the screen that closes after a jump. Run with `npm run e2e` (after `npm run build`). E2E_SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { sheetsClearFor, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4209, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4209/?test-hooks#design";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = 0;

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, tap);
  return sheetsClearFor(page, ["#timeline", "#undo", "#redo", "#history", "#view-controls", "[data-view"]);
}
/** Opens the panel with its button, unless it is open. */
async function openHistory(page, tap) {
  if (await page.isHidden("#history-panel")) await (tap ? page.tap("#history") : page.click("#history"));
  await page.waitForSelector("#history-panel:not([hidden])");
}
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(() => assert.fail(`${what}: timed out`));
const rows = (page) => page.$$eval("#history-panel .history-list li", (li) => li.map((l) => ({ state: l.dataset.state, name: l.querySelector(".history-name").textContent })));
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
/** Two edits after the box: the width typed 60 (24,000 → 36,000 mm³), then the height 10 (→ 18,000 mm³). */
async function twoEdits(page, tap) {
  await pinProperties(page);
  await page.fill("#width", "60");
  await until(page, () => document.querySelector("#volume")?.textContent === "36,000 mm³", null, "36,000 mm³");
  await page.waitForTimeout(1100); // past the merge time, so the height is a step of its own
  await page.fill("#height", "10");
  await until(page, () => document.querySelector("#volume")?.textContent === "18,000 mm³", null, "18,000 mm³");
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [393, 852, true]]) {
    await check(`${width} px: History lists the steps newest first; a click goes back to any step and forward again; the later steps stay, dimmed`, async () => {
      const page = await fresh(width, height, tap);
      await twoEdits(page, tap);
      assert.equal(await page.isHidden("#history-panel"), true, "closed at first");
      await openHistory(page, tap);
      assert.equal(await page.getAttribute("#history", "aria-expanded"), "true");
      const open = await rows(page);
      // Start of the project, the box inserted, the width, the height: four, the height on top and current.
      assert.equal(open.length, 4, JSON.stringify(open));
      assert.deepEqual(open.map((r) => r.state), ["current", "done", "done", "done"]);
      assert.equal(open[3].name, "Start of the project");
      assert.match(open[0].name, /height/i);
      assert.match(open[1].name, /width/i);
      if (shots) await page.screenshot({ path: `${shots}/history-open-${width}.png` });
      // Back to the box as inserted (the second row from the bottom): 24,000 mm³, and the two later steps are dimmed, not gone.
      await page.click('#history-panel button[data-step="1"]');
      if (tap) await page.waitForSelector("#history-panel", { state: "hidden" }); // the phone sheet closes after a jump
      else await until(page, () => document.querySelector('#history-panel li[data-state="current"] button')?.dataset.step === "1", null, "the list follows");
      await until(page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", null, "24,000 mm³");
      assert.equal(await page.isDisabled("#redo"), false, "a jump back is a redo away");
      await openHistory(page, tap);
      assert.deepEqual((await rows(page)).map((r) => r.state), ["undone", "undone", "current", "done"]);
      if (shots) await page.screenshot({ path: `${shots}/history-back-${width}.png` });
      // Forward again to the last step.
      await openHistory(page, tap);
      await page.click('#history-panel button[data-step="3"]');
      await until(page, () => document.querySelector("#volume")?.textContent === "18,000 mm³", null, "18,000 mm³ again");
      if (!tap) assert.equal(await page.getAttribute("#history-panel li[data-state=current] button", "data-step"), "3");
      // Back to the very start: an empty design (its hint shows) and nothing to undo.
      await openHistory(page, tap);
      await page.click('#history-panel button[data-step="0"]');
      await page.locator("#start-hint").waitFor();
      assert.equal(await page.isDisabled("#undo"), true, "at the start");
      await page.context().close();
    });

    await check(`${width} px: Escape, Close, a press elsewhere and the button again put it away; the new step after a jump drops the ones ahead`, async () => {
      const page = await fresh(width, height, tap);
      const hit = (sel) => (tap ? page.tap(sel) : page.click(sel));
      await hit("#history");
      await page.waitForSelector("#history-panel:not([hidden])");
      await page.keyboard.press("Escape");
      await page.waitForSelector("#history-panel", { state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "history", "focus goes back to the button");
      await hit("#history");
      await hit("#history-panel .history-close");
      await page.waitForSelector("#history-panel", { state: "hidden" });
      if (!tap) {
        // The button again closes it (on a phone the sheet covers the button: Close is the way).
        await hit("#history");
        await page.waitForSelector("#history-panel:not([hidden])");
        await hit("#history");
        await page.waitForSelector("#history-panel", { state: "hidden" });
      }
      await hit("#history");
      await page.waitForSelector("#history-panel:not([hidden])");
      await page.mouse.click(5, 300);
      await page.waitForSelector("#history-panel", { state: "hidden" });
      await twoEdits(page, tap);
      await hit("#history");
      await page.waitForSelector("#history-panel:not([hidden])");
      await hit('#history-panel button[data-step="2"]'); // back to the width step
      await until(page, () => document.querySelector("#volume")?.textContent === "36,000 mm³", null, "36,000 mm³");
      if (!tap) await page.keyboard.press("Escape");
      await pinProperties(page);
      await page.fill("#depth", "10"); // a new step: what was ahead (the height) is dropped
      await until(page, () => document.querySelector("#volume")?.textContent === "12,000 mm³", null, "12,000 mm³");
      await hit("#history");
      await page.waitForSelector("#history-panel:not([hidden])");
      const after = await rows(page);
      assert.equal(after.length, 4, JSON.stringify(after));
      assert.deepEqual(after.map((r) => r.state), ["current", "done", "done", "done"], "nothing undone is left ahead");
      assert.doesNotMatch(after.map((r) => r.name).join("|"), /height/i);
      await page.context().close();
    });
  }

  await check("393 px: the button is a 48 px round one in the docked group; the sheet sits at the bottom, 45 % of the screen at most, with Close and 44 px rows", async () => {
    const page = await fresh(393, 852, true);
    await twoEdits(page, true);
    const b = await page.locator("#history").boundingBox();
    assert.ok(Math.abs(b.width - 48) <= 1 && Math.abs(b.height - 48) <= 1, `48 px: ${b.width} x ${b.height}`);
    assert.ok(b.x + b.width <= 393 && b.y + b.height <= 852, "on the screen");
    const others = await Promise.all(["#undo", "#redo"].map((id) => page.locator(id).boundingBox()));
    for (const o of others) assert.ok(b.y + b.height <= o.y + 0.5 || o.y + o.height <= b.y + 0.5, "the three buttons do not overlap");
    await page.tap("#history");
    await page.waitForSelector("#history-panel:not([hidden])");
    const sheet = await page.locator("#history-panel").boundingBox();
    assert.ok(sheet.height <= 0.45 * 852 + 1, `the sheet is at most 45 % tall: ${sheet.height}`);
    assert.ok(Math.abs(sheet.y + sheet.height - 852) <= 1, "at the bottom");
    assert.ok(sheet.width >= 392, "full width");
    const row = await page.locator("#history-panel .history-list button").first().boundingBox();
    assert.ok(row.height >= 44, `rows are 44 px: ${row.height}`);
    assert.ok((await page.locator("#history-panel .history-close").boundingBox()).height >= 44, "Close is 44 px");
    if (shots) await page.screenshot({ path: `${shots}/history-sheet-393.png` });
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} history check(s) failed` : "history checks passed");
process.exit(failed ? 1 : 0);
