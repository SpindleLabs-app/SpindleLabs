// Browser check of selecting and deleting single sketch curves (missing
// basics, Ben 2026-11-04), in an empty design's XY sketch seen from above.
// 1280 px with a mouse: a line from (0, 0) to (20, 0) and a circle round
// (40, 0) of radius 5 are drawn; Escape ends the line's chain, a second
// Escape chooses Select (pressed on the toolbar); a click 3 px off the line
// picks it (1 segment lit, Delete on), Shift+click on the circle's rim adds
// it (64 more), Delete takes both out as one step (the view draws no lines),
// Ctrl+Z puts them back. 375 px with taps: the Select button, a tap by the
// circle's rim, then the toolbar's Delete takes it out. Points on screen
// come from the app's camera (?test-hooks) through the pinhole sums
// snap-control.mjs uses. Screenshots go to E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4271, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4271/?test-hooks";
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
  await page.locator("#start-hint").waitFor();
  await pinProperties(page);
  return sheetsClearFor(page);
}

const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const shown = (page, key, want) => until(page, ([k, w]) => document.querySelector("#viewport").dataset[k] === w, [key, want], `${key} "${want}"`).catch(async (e) => assert.fail(`${e.message} (shown: "${await data(page, key)}")`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();

// The pinhole camera: forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
function toScreen(cam, box, p) {
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const aspect = box.width / box.height;
  const nx = dot(v, right) / (dot(v, forward) * T * aspect);
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}
/** Millimetres per screen pixel on the plane the camera looks straight down at. */
async function mmPerPixel(page) {
  const cam = await camera(page);
  const d = sub(cam.position, cam.target);
  return (2 * Math.sqrt(dot(d, d)) * T) / (await canvasBox(page)).height;
}
/** Clicks (or taps) sketch point (x, y) on XY, with Shift held when `shift`; fails if something is over the canvas there. */
async function at(page, [x, y], { tap = false, shift = false } = {}) {
  const s = toScreen(await camera(page), await canvasBox(page), [x, y, 0]);
  await closePanels(page, tap);
  const on = await page.evaluate(([sx, sy]) => {
    const e = document.elementFromPoint(sx, sy);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${x}, ${y}] is under ${on} on screen, not the canvas`);
  if (tap) return page.touchscreen.tap(s.x, s.y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(s.x, s.y);
  if (shift) await page.keyboard.up("Shift");
}
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((v, k) => Math.abs(v - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

/** An empty design's sketch on XY, looked at from above. */
async function sketchOnXY(page, tap) {
  await press(page, "#create-sketch", tap);
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on XY");
  await settle(page);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
}

/** A line from (0, 0) to (20, 0) and a circle round (40, 0) of radius 5: 1 + 64 segments drawn. */
async function drawBoth(page, tap) {
  await press(page, "#sketch-tool-line", tap);
  await at(page, [0, 0], { tap });
  await at(page, [20, 0], { tap });
  await until(page, () => document.querySelector("#viewport").dataset.sketchLines === "1", null, "the line drawn");
  await press(page, "#sketch-tool-circle", tap);
  await at(page, [40, 0], { tap });
  await at(page, [45, 0], { tap });
  await shown(page, "sketchLines", "65");
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
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

try {
  await check("1280 px: Escape with nothing half drawn chooses Select, a click picks the line, Shift+click adds the circle, Delete takes both out as one step, Ctrl+Z puts them back", async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await drawBoth(page, false);
    // The circle tool is idle after drawing: one Escape chooses Select. (With the line tool, the first Escape ends its chain.)
    await page.keyboard.press("Escape");
    await until(page, () => document.querySelector("#sketch-tool-select")?.getAttribute("aria-pressed") === "true", null, "Select chosen by Escape");
    assert.equal(await page.locator("#sketch-delete").isDisabled(), true, "Delete is off with nothing picked");
    const mm = await mmPerPixel(page);
    // 3 px above the line's middle, inside the 10 px reach.
    await at(page, [10, 3 * mm]);
    await shown(page, "sketchPicked", "1");
    assert.equal(await page.locator("#sketch-delete").isDisabled(), false, "Delete is on with the line picked");
    // Shift on the circle's top, 2 px out: 64 more segments lit.
    await at(page, [40, 5 + 2 * mm], { shift: true });
    await shown(page, "sketchPicked", "65");
    await shot(page, "sketch-select-picked-1280");
    // Delete: both gone, as one step.
    await page.keyboard.press("Delete");
    await shown(page, "sketchLines", "0");
    await shown(page, "sketchPicked", "0");
    await shot(page, "sketch-select-deleted-1280");
    await page.keyboard.press("Control+z");
    await shown(page, "sketchLines", "65");
    await page.context().close();
  });

  await check("375 px with taps: the Select button, a tap by the circle's rim, and the toolbar's Delete take the circle out", async () => {
    const page = await fresh(375, true);
    await sketchOnXY(page, true);
    await drawBoth(page, true);
    // 44 px tall to tap, measured before the tap (a pressed button shrinks a little while held), and on screen without
    // a sideways swipe of the toolbar (app hunt 2026-11-04: page.tap scrolls a button into view, a finger doesn't).
    for (const id of ["#sketch-tool-select", "#sketch-delete"]) {
      const box = await page.locator(id).boundingBox();
      assert.ok(box && box.height >= 44, `${id} is ${box?.height} px tall, under 44`);
      assert.ok(box.x >= 0 && box.x + box.width <= 375, `${id} is off screen at x ${box.x}..${box.x + box.width}`);
    }
    await page.tap("#sketch-tool-select");
    await until(page, () => document.querySelector("#sketch-tool-select")?.getAttribute("aria-pressed") === "true", null, "Select chosen by its button");
    const mm = await mmPerPixel(page);
    await at(page, [40 + 5 + 3 * mm, 0], { tap: true });
    await shown(page, "sketchPicked", "64");
    await shot(page, "sketch-select-picked-375");
    await page.tap("#sketch-delete");
    await shown(page, "sketchLines", "1");
    await shot(page, "sketch-select-deleted-375");
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
