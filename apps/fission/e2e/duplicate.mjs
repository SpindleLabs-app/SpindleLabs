// Browser check of Duplicate body (step 35e2, duplicate.ts): Modify ▾'s
// Duplicate is off, saying why, with nothing picked; with the box picked it
// makes "Copy 1" in the timeline ("Copy of Box 1", Body 2) and opens the
// Move panel on the copy, as Insert does on a new body. Moved 50 along X
// and OK, the exported STL holds both, worked by hand: the box x 0..40, the
// copy x 50..90. Undo takes the Move back (the copy back on the box), then
// the Duplicate (one body again). At 1280 px with a mouse and at 375 px with
// taps. With the keys (1280 px): Ctrl+C on the box puts it on the clipboard
// and Ctrl+V pastes a copy (Move opens on it), Ctrl+D duplicates the copy,
// and another design's copied bodies don't paste. Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";
import { preview } from "vite";
import { closePanels, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4618, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4618/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await startWithBox(page, touch);
  return sheetsClearFor(page);
}

const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const rebuilt = (page) => until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");

/** A click or tap on model point `p` in the view the box opens in, the sheets put away first. */
async function pressAt(page, p, tap) {
  await closePanels(page, tap);
  const s = screenPoint(await page.locator("#viewport canvas").boundingBox(), p, HOME);
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y]), "CANVAS", `(${p}) is on the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}

/** The toolbar's STL: [min, max] of its corners for x, y and z (mm). */
async function stlBounds(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) pts.push([0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
  return [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]);
}
const near = (got, want, what) => got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-3, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** Modify ▾ opened, and Duplicate's state in it: off (with its reason) or on. */
async function duplicateItem(page, tap) {
  await press(page, "#modify-menu", tap);
  await until(page, () => !document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ opens");
  return page.evaluate(() => {
    const b = document.getElementById("modify-menu-duplicate");
    return b === null ? null : { off: b.getAttribute("aria-disabled") === "true", title: b.title, coming: document.getElementById("coming-duplicate") !== null };
  });
}

const items = (page) => page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.dataset.item));
const undoTitle = (page) => page.getAttribute("#undo", "title");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    const at = `${width} px${tap ? ", taps" : ""}`;
    await check(`${at}: Duplicate is off with nothing picked; with the box picked it makes Copy 1 and opens Move on it; the STL has both, by hand; Undo takes each step back`, async () => {
      const page = await fresh(width, height, tap);
      try {
        let item = await duplicateItem(page, tap);
        assert.deepEqual(item, { off: true, title: "Pick one or more bodies first, then Duplicate.", coming: false }, "nothing picked: off, saying why, and no longer coming soon");
        await page.keyboard.press("Escape");
        await until(page, () => document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ closed");
        // The middle of the box's top, (20, 15, 20): picks its top face, which stands for the box.
        await pressAt(page, [20, 15, 20], tap);
        await until(page, () => document.body.dataset.selection === "face:feature-1/top", null, "the box's top picked");
        item = await duplicateItem(page, tap);
        assert.equal(item.off, false, "on once a body is picked");
        await press(page, "#modify-menu-duplicate", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open on the copy");
        await rebuilt(page);
        assert.match(await undoTitle(page), /Duplicate bodies/);
        assert.deepEqual(await items(page), ["feature-1", "feature-2"]);
        assert.equal(await page.getAttribute('#timeline [data-item="feature-2"]', "title"), "2. Copy 1\nCopy of Box 1");
        assert.equal(await page.evaluate(() => document.body.dataset.selection), "body:feature-2", "the copy picked for the Move");
        assert.equal(await page.textContent("#move-bodies"), "Body: Copy 1");
        if (shots) await page.screenshot({ path: `${shots}/duplicate-move-${width}.png` });
        // Slid 50 along X: the copy x 50..90 beside the box's 0..40, so the STL spans x 0..90.
        await page.fill("#move-x", "50");
        await press(page, "#move-ok", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");
        await rebuilt(page);
        assert.deepEqual(await items(page), ["feature-1", "feature-2", "feature-3"]);
        near(await stlBounds(page, tap), [[0, 90], [0, 30], [0, 20]], "the STL with the box and its copy moved");
        if (shots) await page.screenshot({ path: `${shots}/duplicate-done-${width}.png` });
        // Undo: the Move goes (the copy on the box again, x 0..40), then the Duplicate (one body, still 0..40).
        await press(page, "#undo", tap);
        await rebuilt(page);
        assert.deepEqual(await items(page), ["feature-1", "feature-2"]);
        near(await stlBounds(page, tap), [[0, 40], [0, 30], [0, 20]], "after one Undo");
        await press(page, "#undo", tap);
        await rebuilt(page);
        assert.deepEqual(await items(page), ["feature-1"]);
      } finally {
        await page.context().close();
      }
    });
  }
  await check("1280 px, keys: Ctrl+C then Ctrl+V pastes a copy of the box and opens Move on it, Ctrl+D duplicates the copy, and another design's bodies don't paste", async () => {
    const page = await fresh(1280, 800, false);
    try {
      await pressAt(page, [20, 15, 20], false);
      await until(page, () => document.body.dataset.selection === "face:feature-1/top", null, "the box's top picked");
      await page.keyboard.press("Control+c");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(copied, /^SpindleLabs bodies [a-z0-9]+: body:feature-1=box%20Box%201$/);
      await page.keyboard.press("Control+v");
      await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "Move open on the pasted copy");
      await rebuilt(page);
      assert.deepEqual(await items(page), ["feature-1", "feature-2"]);
      assert.equal(await page.getAttribute('#timeline [data-item="feature-2"]', "title"), "2. Copy 1\nCopy of Box 1");
      assert.equal(await page.evaluate(() => document.body.dataset.selection), "body:feature-2");
      assert.match(await undoTitle(page), /Duplicate bodies/);
      await page.click("#move-cancel");
      await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "Move cancelled");
      // The copy still picked: Ctrl+D copies it in turn.
      assert.equal(await page.evaluate(() => document.body.dataset.selection), "body:feature-2");
      await page.keyboard.press("Control+d");
      await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "Move open on the copy's copy");
      await rebuilt(page);
      assert.deepEqual(await items(page), ["feature-1", "feature-2", "feature-3"]);
      assert.equal(await page.getAttribute('#timeline [data-item="feature-3"]', "title"), "3. Copy 2\nCopy of Copy 1");
      await page.click("#move-cancel");
      await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "Move cancelled");
      // Bodies copied from another design (another token) are not pasted here, nor is other text.
      for (const text of [copied.replace(/bodies [a-z0-9]+:/, "bodies zz9:"), "body:feature-1"]) {
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
        await page.keyboard.press("Control+v");
        await page.waitForTimeout(200); // a paste taken would have opened Move by now
        assert.equal(await page.evaluate(() => document.getElementById("move-panel")?.hidden), true, text);
        assert.deepEqual(await items(page), ["feature-1", "feature-2", "feature-3"], text);
      }
      // The first copy pastes again (the clipboard put back): Copy 3, the box's.
      await page.evaluate((t) => navigator.clipboard.writeText(t), copied);
      await page.keyboard.press("Control+v");
      await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "Move open on the paste");
      await rebuilt(page);
      assert.equal(await page.getAttribute('#timeline [data-item="feature-4"]', "title"), "4. Copy 3\nCopy of Box 1");
      if (shots) await page.screenshot({ path: `${shots}/duplicate-keys-1280.png` });
    } finally {
      await page.context().close();
    }
  });
  assert.deepEqual(errors, [], "no errors in the page");
} catch (e) {
  failed++;
  console.log(`not ok - ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
