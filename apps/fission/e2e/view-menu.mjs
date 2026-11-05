// Browser check of the menu on a body in the 3D view (missing basics, Ben
// 2026-11-04), on the 40 × 30 × 20 box a fresh design starts with. 1280 px
// with a mouse: a right-click on the box (the view's centre, where Insert
// framed it) selects its face and opens Box 1's menu, Hide first, kept on
// screen; Hide hides Body 1 as one step ("Undo Hide Body 1"), Ctrl+Z shows
// it again; a right-click on empty space opens none. 375 px with a finger:
// a quick tap only selects, one moved first only turns the view; a finger
// held still 0.7 s opens the menu (CDP touch events, as a phone sends them),
// which stays open as it lifts, and its Delete takes the box out. The
// Delete and Backspace keys outside a sketch (round 2 hunt E5) delete the
// selected body's item, or the focused bar item's, the menu's way.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4272, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4272/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await pinProperties(page);
  await startWithBox(page, touch);
  return sheetsClearFor(page);
}

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const menuOpen = (page) => page.evaluate(() => document.getElementById("row-menu").open);
const highlight = (page) => page.evaluate(() => document.querySelector("#viewport").dataset.highlight ?? "");
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

/** A point of the canvas (fx, fy across and down it), checked to be the canvas on screen and not a panel over it. */
async function spot(page, fx, fy, tap = false) {
  await closePanels(page, tap);
  const box = await page.locator("#viewport canvas").boundingBox();
  const s = { x: box.x + fx * box.width, y: box.y + fy * box.height };
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`(${fx}, ${fy}) of the view is under ${on} on screen, not the canvas`);
  return s;
}

/** The open menu's box, checked to be on the screen whole. */
async function menuOnScreen(page, width) {
  const r = await page.locator("#row-menu").boundingBox();
  assert.ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= 800, `the menu is off screen at ${JSON.stringify(r)}`);
}

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
  await check("1280 px: a right-click on the box selects its face and opens Box 1's menu, Hide first; Hide is one step, Ctrl+Z shows it again; none on empty space", async () => {
    const page = await fresh();
    const centre = await spot(page, 0.5, 0.5);
    await page.mouse.click(centre.x, centre.y, { button: "right" });
    await until(page, () => document.getElementById("row-menu").open, null, "the menu");
    assert.equal(await page.getAttribute("#row-menu", "aria-label"), "Box 1");
    const entries = await page.$$eval("#row-menu button", (bs) => bs.map((b) => b.id));
    assert.deepEqual(entries, ["row-menu-hide", "row-menu-edit", "row-menu-marker", "row-menu-suppress", "row-menu-rename", "row-menu-delete"]);
    assert.match(await highlight(page), /^faces \d+ edges $|^faces  edges \d+$/, "one face or edge of the box selected");
    await menuOnScreen(page, 1280);
    await shot(page, "view-menu-1280");
    await page.click("#row-menu-hide");
    await until(page, () => document.getElementById("undo").title === "Undo Hide Body 1 (Ctrl+Z)", null, "Hide recorded");
    assert.equal(await menuOpen(page), false);
    await until(page, () => document.querySelector("#viewport").dataset.highlight === "faces  edges ", null, "nothing selected once hidden").catch(async (e) => assert.fail(`${e.message} (shows "${await highlight(page)}")`));
    // Hidden, the box is not there to right-click: the centre opens nothing.
    await page.mouse.click(centre.x, centre.y, { button: "right" });
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(page), false, "a menu opened on a hidden body's place");
    await page.keyboard.press("Control+z");
    await until(page, () => document.getElementById("undo").title !== "Undo Hide Body 1 (Ctrl+Z)", null, "Hide undone");
    // Empty space: the floor left of the framed box.
    const corner = await spot(page, 0.15, 0.65);
    await page.mouse.click(corner.x, corner.y, { button: "right" });
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(page), false, "a menu opened on empty space");
    await page.context().close();
  });

  await check("375 px with a finger: a quick tap only selects; a finger held still opens the menu on screen, and its Delete takes the box out", async () => {
    const page = await fresh(375, true);
    const centre = await spot(page, 0.5, 0.5, true);
    const cdp = await page.context().newCDPSession(page);
    const touch = async (ms) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x, y: centre.y }] });
      await page.waitForTimeout(ms);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await touch(80);
    await until(page, () => /faces \d/.test(document.querySelector("#viewport").dataset.highlight ?? "") || /edges \d/.test(document.querySelector("#viewport").dataset.highlight ?? ""), null, "the tap's pick");
    assert.equal(await menuOpen(page), false, "a quick tap opened the menu");
    // A finger held as long but moved 30 px first is turning the view, not asking for the menu.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x, y: centre.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: centre.x + 30, y: centre.y }] });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(200);
    assert.equal(await menuOpen(page), false, "a moved finger opened the menu");
    // Held still (the view may have turned: the centre is still on the box), the menu opens and stays open once lifted.
    await touch(700);
    await until(page, () => document.getElementById("row-menu").open, null, "the held finger's menu");
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(page), true, "the menu shut as the finger lifted");
    assert.equal(await page.getAttribute("#row-menu", "aria-label"), "Box 1");
    await menuOnScreen(page, 375);
    await shot(page, "view-menu-375");
    await page.tap("#row-menu-delete");
    await until(page, () => document.getElementById("undo").title === "Undo Delete Box 1 (Ctrl+Z)", null, "Delete recorded");
    // The selection leaves once the rebuild after the delete has run, which can be after Undo's title changes (merge queue, #306).
    await until(page, () => document.querySelector("#viewport").dataset.highlight === "faces  edges ", null, "nothing selected once deleted").catch(async (e) => assert.fail(`${e.message} (shows "${await highlight(page)}")`));
    await page.context().close();
  });
  await check("1280 px, round 2 hunt E5: Delete with the box selected in the view deletes Box 1 as one step, Ctrl+Z brings it back; Backspace on its focused bar item too; with nothing selected the key does nothing", async () => {
    const page = await fresh();
    const items = () => page.$$eval("#timeline [data-item]", (lis) => lis.length);
    const undoTitle = () => page.evaluate(() => document.getElementById("undo").title);
    // Nothing selected, focus on the page: nothing happens.
    await page.evaluate(() => document.activeElement?.blur());
    const before = await undoTitle();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    assert.equal(await items(page), 1, "nothing selected: nothing deleted");
    assert.equal(await undoTitle(), before, "and nothing recorded");
    // The box's face clicked in the view (a click selects it), then Delete: nothing is built from Box 1, so it goes at once.
    const centre = await spot(page, 0.5, 0.5);
    await page.mouse.click(centre.x, centre.y);
    await until(page, () => /faces \d|edges \d/.test(document.querySelector("#viewport").dataset.highlight ?? ""), null, "the face selected");
    await page.keyboard.press("Delete");
    await until(page, () => document.getElementById("undo").title === "Undo Delete Box 1 (Ctrl+Z)", null, "Delete recorded as one step");
    await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 0, null, "Box 1 gone");
    await page.keyboard.press("Control+z");
    await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 1, null, "Ctrl+Z brings it back");
    // Backspace with Box 1's bar item focused (the keyboard's way to a timeline item).
    await page.focus("#timeline [data-item]");
    await page.keyboard.press("Backspace");
    await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 0, null, "Backspace on the bar item deletes it");
    await shot(page, "delete-key-1280");
    await page.context().close();
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
