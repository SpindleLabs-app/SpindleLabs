// Browser check of the clumsy-user hunt's double presses (2026-11-04):
// a double-click (or a mash of five clicks) on Save, or on Slice and
// download, saves one file, not one per click; a separate press later saves
// again, so the guard never eats a real second save. Mouse at 1280 px and
// taps at 375 px. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4301, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4301/";
const browser = await launch();
const errors = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

async function fresh(width, tap) {
  const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await startWithBox(page, tap);
  return page;
}

/** Counts the page's downloads from now on. */
function downloads(page) {
  const names = [];
  page.on("download", (d) => names.push(d.suggestedFilename()));
  return names;
}

/** Long enough for a second file to start, had one been asked for (a box saves in well under this). */
const settle = (page) => page.waitForTimeout(1500);

/** `count` clicks `gap` ms apart at the middle of `sel`, as an impatient hand does: straight at the screen, so a press on a
 * button disabled by the first one does nothing, as for a person (page.click would wait for it to come back). */
async function mash(page, sel, count, gap, tap = false) {
  const b = await page.locator(sel).boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  for (let i = 0; i < count; i++) {
    if (i > 0) await page.waitForTimeout(gap);
    await (tap ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  }
}

// Save sits on the bar at desktop width (on a phone it is in File ▾, which closes on the first tap).
await check("1280 px: a double-click on Save downloads the project once; mashing, or Enter held, too; a press later saves again", async () => {
  const page = await fresh(1280, false);
  try {
    const names = downloads(page);
    await page.dblclick("#save");
    await settle(page);
    assert.equal(names.length, 1, `one file for a double-click: ${names}`);
    await mash(page, "#save", 10, 120);
    await settle(page);
    assert.equal(names.length, 2, `ten clicks 120 ms apart are one more save: ${names}`);
    await page.focus("#save");
    for (let i = 0; i < 20; i++) await page.keyboard.press("Enter", { delay: 30 }); // a held key repeats about every 30 ms
    await settle(page);
    assert.equal(names.length, 3, `Enter held on Save is one more save: ${names}`);
    await page.click("#save");
    await settle(page);
    assert.equal(names.length, 4, `a press on its own saves again: ${names}`);
  } finally {
    await page.context().close();
  }
});

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: a double press, or ten presses 150 ms apart, on Slice and download saves one print file; a press later saves another`, async () => {
    const page = await fresh(width, tap);
    try {
      const names = downloads(page);
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      const saved = () => page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved") && !document.getElementById("slice-print-go").disabled);
      await mash(page, "#slice-print-go", 2, 80, tap);
      await saved();
      await settle(page);
      assert.equal(names.length, 1, `one file for a double press: ${names}`);
      await mash(page, "#slice-print-go", 10, 150, tap);
      await saved();
      await settle(page);
      assert.equal(names.length, 2, `ten quick presses are one more file: ${names}`);
      await (tap ? page.tap("#slice-print-go") : page.click("#slice-print-go"));
      await saved();
      await settle(page);
      assert.equal(names.length, 3, `a press on its own slices and saves again: ${names}`);
    } finally {
      await page.context().close();
    }
  });
}

await browser.close();
await server.close();
if (errors.length) {
  failed++;
  console.log(`not ok - page errors:\n  ${errors.join("\n  ")}`);
}
if (failed) process.exit(1);
