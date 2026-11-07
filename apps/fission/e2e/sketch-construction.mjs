// Browser check of construction lines (step 47f), in an empty design's XY
// sketch seen from above. 1280 px with a mouse: a 20 × 10 rectangle from
// (0, 0) and its diagonal, which splits it, so the sketch makes no outline;
// Select, a click on the diagonal, X: it is a construction line (drawn
// apart from the lines, dashed) and the rectangle is a closed outline; Ctrl+Z
// turns it back; the toolbar's Construction button does it again. 375 px
// with taps: the Construction button on screen and 44 px tall, a tap on the
// diagonal and on the button turns it. Screenshots go to E2E_SHOTS when
// set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4288, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4288/?test-hooks";
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


const points = (page) => data(page, "sketchPoints");

/** A line from `a` to `b`, the line tool's chain ended with Escape. */
async function line(page, a, b, tap) {
  const before = Number(await data(page, "sketchLines"));
  await press(page, "#sketch-tool-line", tap);
  await at(page, a, { tap });
  await at(page, b, { tap });
  await shown(page, "sketchLines", String(before + 1));
  if (!tap) await page.keyboard.press("Escape");
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
const status = (page) => page.evaluate(() => document.querySelector("#sketch-status")?.textContent ?? "");
const statusSays = (page, re, what) => until(page, (r) => new RegExp(r).test(document.querySelector("#sketch-status")?.textContent ?? ""), re.source, what).catch(async (e) => assert.fail(`${e.message} (status: "${await status(page)}")`));

/** The rectangle and its diagonal, the diagonal picked with Select. */
async function rectangleAndDiagonal(page, tap) {
  await press(page, "#sketch-tool-rectangle", tap);
  await at(page, [0, 0], { tap });
  await at(page, [20, 10], { tap });
  await shown(page, "sketchLines", "4");
  await line(page, [0, 0], [20, 10], tap);
  await shown(page, "sketchLines", "5");
  await statusSays(page, /5 lines, not closed/, "the diagonal splits it");
  await press(page, "#sketch-tool-select", tap);
  // The diagonal's middle (10, 5): 5 from the nearest side, so the diagonal is picked.
  await at(page, [10, 5], { tap });
  await shown(page, "sketchPicked", "1");
}

try {
  await check("1280 px: X makes the picked diagonal a construction line, the rectangle closes, Ctrl+Z turns it back, the button again", async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await rectangleAndDiagonal(page, false);
    await page.keyboard.press("x");
    await shown(page, "sketchLines", "4");
    assert.ok(Number(await data(page, "sketchConstruction")) > 1, "the diagonal drawn dashed");
    await statusSays(page, /4 lines and 1 construction curve, a closed outline/, "the rectangle closes");
    await shot(page, "construction-1280");
    await page.keyboard.press("Control+z");
    await shown(page, "sketchLines", "5");
    await shown(page, "sketchConstruction", "0");
    await statusSays(page, /5 lines, not closed/, "back to five lines");
    // The picks stayed: the button turns it again.
    await at(page, [10, 5]);
    await shown(page, "sketchPicked", "1");
    await page.click("#sketch-construction");
    await shown(page, "sketchLines", "4");
    await statusSays(page, /a closed outline/, "closed again");
    await page.context().close();
  });

  await check("375 px with taps: the Construction button is on screen and big enough, and a tap turns the picked diagonal", async () => {
    const page = await fresh(375, true);
    await sketchOnXY(page, true);
    await rectangleAndDiagonal(page, true);
    const box = await page.locator("#sketch-construction").boundingBox();
    assert.ok(box && box.height >= 44, `Construction is ${box?.height} px tall, under 44`);
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `Construction is off screen at x ${box.x}..${box.x + box.width}`);
    await page.tap("#sketch-construction");
    await shown(page, "sketchLines", "4");
    assert.ok(Number(await data(page, "sketchConstruction")) > 1, "drawn dashed");
    await shot(page, "construction-375");
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
