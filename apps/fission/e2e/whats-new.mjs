// Browser check of What's new (Settings > About > What's new): it opens over the app with every version the build
// lists (whats-new.mjs, the same answer the build got), newest first, the whole history down to 0.0.0, in plain
// words with nothing about tests, CI or the geometry engine's inside; the list scrolls under a header that stays
// put; it fits a phone with Close a 44 px target at the top; Close and Escape go back to Settings with the focus on
// its Show. At 1280 px with the mouse and 375 px with taps.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { whatsNew } from "../whats-new.mjs";

const server = await preview({ preview: { port: 4254, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4254/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
let failed = false;

// What the build was given: the versions and their first lines, worked out here the same way.
const built = whatsNew();
const headings = [...built.text.matchAll(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/gm)].map((m) => m[1]);

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector("#settings-open", { state: "attached" });
  return page;
}
const isOpen = (page, id) => page.evaluate((id) => document.getElementById(id)?.open ?? false, id);
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: What's new lists every version in plain words, fits, and goes back to Settings`, async () => {
      const page = await fresh(width, height, tap);
      const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
      if (tap) await press("#menu-toggle");
      await press("#settings-open");
      assert.equal(await isOpen(page, "settings"), true, "Settings opens");
      const row = await page.textContent("#settings [data-section=about] .settings-row:has(#settings-whats-new) span");
      assert.equal(row, "What's new");
      await press("#settings-whats-new");
      assert.equal(await isOpen(page, "settings"), false, "Settings steps aside");
      assert.equal(await isOpen(page, "whats-new"), true, "What's new is open");

      // Every version the build listed, in its order, the newest first and the first version last.
      const shown = await page.$$eval("#whats-new section", (s) => s.map((x) => x.dataset.version));
      assert.deepEqual(shown, headings);
      assert.equal(shown.at(-1), "0.0.0");
      const first = await page.textContent("#whats-new section:first-child h3");
      assert.match(first, new RegExp(`^${headings[0].replace(/\./g, "\\.")} \\d{1,2} [A-Z][a-z]{2} \\d{4}$`));
      // A line from early on, under its own version, as a person reads it.
      assert.equal(await page.textContent('#whats-new section[data-version="0.13.0"] li'), "Download your part as an STL file.");
      const note = await page.textContent("#whats-new .whats-new-note");
      if (built.version) assert.match(note, new RegExp(`^You have SpindleLabs ${built.version.replace(/\./g, "\\.")}\\.`));
      // Nothing about how SpindleLabs is made: the words the changelog's check keeps out of public lines.
      const words = await page.textContent("#whats-new .whats-new-body");
      assert.doesNotMatch(words, /\b(CI|kernel|nightly|fuzz\w*|mutants?|tolerances?|refactor\w*|XSS|vulnerab\w*)\b|\.rs\b|unit tests?|browser tests?/i);

      // It fits: no sideways scroll, the dialog on the screen, Close on the screen (44 px at the top on a phone).
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
      const box = await page.locator("#whats-new").boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0 && box.y + box.height <= height + 0.5, `on screen: ${JSON.stringify(box)}`);
      const close = await page.locator("#whats-new .close").boundingBox();
      assert.ok(close.x + close.width <= width && close.y >= 0, "Close is on screen");
      if (tap) assert.ok(close.height >= 44 && close.y < 80, `Close is a 44 px target at the top (height ${close.height}, y ${close.y})`);
      if (shots) await page.screenshot({ path: `${shots}/whats-new-${width}.png` });

      // The list scrolls inside the dialog, and the title and Close stay where they were.
      const scroll = await page.$eval("#whats-new .whats-new-body", (b) => ({ top: b.scrollTop, room: b.scrollHeight - b.clientHeight }));
      assert.equal(scroll.top, 0, "opens at the newest");
      assert.ok(scroll.room > 0, "the list is longer than the screen, so it scrolls");
      if (tap) await page.locator('#whats-new section[data-version="0.0.0"]').scrollIntoViewIfNeeded();
      else {
        await page.mouse.move(width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 4000);
        await page.waitForFunction(() => document.querySelector("#whats-new .whats-new-body").scrollTop > 0);
      }
      assert.ok((await page.$eval("#whats-new .whats-new-body", (b) => b.scrollTop)) > 0, "the list scrolled");
      assert.equal(await page.evaluate(() => window.scrollY), 0, "the page under it did not");
      const after = await page.locator("#whats-new .close").boundingBox();
      assert.ok(Math.abs(after.y - close.y) < 1, `Close stays put (${close.y} then ${after.y})`);
      if (shots) await page.screenshot({ path: `${shots}/whats-new-${width}-scrolled.png` });

      // Close goes back to Settings with the focus on What's new's Show; Escape does too.
      await press("#whats-new .close");
      assert.equal(await isOpen(page, "whats-new"), false, "Close closes it");
      await page.waitForFunction(() => document.getElementById("settings")?.open, null, { timeout: 5000 }).catch(() => {});
      assert.equal(await isOpen(page, "settings"), true, "and goes back to Settings");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-whats-new", "focus back on Show");
      await press("#settings-whats-new");
      assert.equal(await isOpen(page, "whats-new"), true, "opens again");
      assert.equal(await page.$eval("#whats-new .whats-new-body", (b) => b.scrollTop), 0, "at the newest again");
      await page.keyboard.press("Escape");
      assert.equal(await isOpen(page, "whats-new"), false, "Escape closes it");
      await page.waitForFunction(() => document.getElementById("settings")?.open, null, { timeout: 5000 }).catch(() => {});
      assert.equal(await isOpen(page, "settings"), true, "and goes back to Settings too");
      await page.context().close();
    });
  }
  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
