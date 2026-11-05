// Browser check of the sketch constraint tools (step 47d2), in an empty
// design's XY sketch seen from above. 1280 px with a mouse: a line from
// (0, 0) to (20, 6); Horizontal, a click on the line: its start stays and
// its end comes level, (20, 0), one constraint marked. Vertical on the same
// line would make it a point: refused with the reason, nothing moves. Fix
// on (0, 0); a second line (30, 4)–(40, 10); Coincident from (20, 0) to
// (30, 4): the second line's start lands on (20, 0). Fix (40, 10), then
// Coincident (0, 0) to (40, 10): two fixed points can't meet, refused, the
// ones that fight drawn red. Ctrl+Z takes the last constraint off and its
// point goes back; Select picks a constraint's mark and Delete takes it off. 375 px with taps: the Horizontal button on screen and
// 44 px tall, a tap on a line makes it level. Screenshots go to E2E_SHOTS
// when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, openPanel, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4283, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4283/?test-hooks";
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
  await halfMillimetreGrid(page, tap);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
}

/**
 * Grid snap on a 0.5 mm grid, so a click lands exactly on the point it aims at in every engine: Firefox and WebKit
 * send the pointer on whole pixels, and the nearest round number within half a pixel of that can be 0.1 mm off (19.9 for 20).
 * Every point these checks draw is on the 0.5 mm grid. Drags are not snapped (they follow the pointer).
 */
async function halfMillimetreGrid(page, tap) {
  await openPanel(page, "properties", tap);
  await page.fill("#sketch-grid", "0.5");
  await page.press("#sketch-grid", "Enter");
  await page.check("#sketch-grid-snap");
  await closePanels(page, tap);
}


const points = (page) => data(page, "sketchPoints");
const error = (page) => page.evaluate(() => document.querySelector("#sketch-grid-error")?.textContent ?? "");

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

try {
  await check("1280 px: horizontal, a refused vertical, fix, coincident, a refused conflict in red, and undo", async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await line(page, [0, 0], [20, 6], false);
    await shown(page, "sketchPoints", "0,0 20,6");
    await page.click("#sketch-tool-horizontal");
    await until(page, () => document.querySelector("#sketch-tool-horizontal")?.getAttribute("aria-pressed") === "true", null, "Horizontal pressed");
    // The line's middle (10, 3): 10 from either end, so the line is picked; its start (0, 0) stays, its end comes to (20, 0).
    await at(page, [10, 3]);
    await shown(page, "sketchConstraints", "1");
    await shown(page, "sketchPoints", "0,0 20,0");
    await shot(page, "constraints-horizontal-1280");
    // Vertical on the same line: both ends would be one point.
    await page.click("#sketch-tool-vertical");
    await at(page, [10, 0]);
    await until(page, () => /shrink line-\d+ to almost nothing/.test(document.querySelector("#sketch-grid-error")?.textContent ?? ""), null, "the vertical refused");
    assert.equal(await points(page), "0,0 20,0", "nothing moved");
    assert.equal(await data(page, "sketchConstraints"), "1");
    await shot(page, "constraints-refused-1280");
    // Fix the start.
    await page.click("#sketch-tool-fix");
    await at(page, [0, 0]);
    await shown(page, "sketchConstraints", "2");
    // A second line, and its start made coincident with the first line's end.
    await line(page, [30, 4], [40, 10], false);
    await page.click("#sketch-tool-coincident");
    await at(page, [20, 0]);
    await at(page, [30, 4]);
    await shown(page, "sketchConstraints", "3");
    await shown(page, "sketchPoints", "0,0 20,0 20,0 40,10");
    // Fix the far end, then try to bring the two fixed points together.
    await page.click("#sketch-tool-fix");
    await at(page, [40, 10]);
    await shown(page, "sketchConstraints", "4");
    await page.click("#sketch-tool-coincident");
    await at(page, [0, 0]);
    await at(page, [40, 10]);
    await until(page, () => /fights the ones shown in red/.test(document.querySelector("#sketch-grid-error")?.textContent ?? ""), null, "the conflict refused");
    assert.ok(Number(await data(page, "sketchFighting")) > 0, "the fixes that fight are drawn red");
    assert.equal(await data(page, "sketchConstraints"), "4");
    await shot(page, "constraints-conflict-1280");
    // Undo takes the last fix off; again, the coincident, and the second line's start goes back.
    await page.keyboard.press("Control+z");
    await shown(page, "sketchConstraints", "3");
    await page.keyboard.press("Control+z");
    await shown(page, "sketchConstraints", "2");
    await shown(page, "sketchPoints", "0,0 20,0 30,4 40,10");
    // Select picks the horizontal's mark, a bar 10 px above the middle of (0, 0) and (20, 0); Delete takes it off, and nothing moves.
    await page.click("#sketch-tool-select");
    const mm = await mmPerPixel(page);
    await at(page, [10, 10 * mm]);
    await until(page, () => document.querySelector("#viewport").dataset.sketchPicked !== "0", null, "the mark picked");
    await page.keyboard.press("Delete");
    await shown(page, "sketchConstraints", "1");
    assert.equal(await points(page), "0,0 20,0 30,4 40,10", "nothing moved");
    await page.context().close();
  });

  await check("375 px with taps: the Horizontal button is on screen and big enough, and a tap on a line makes it level", async () => {
    const page = await fresh(375, true);
    await sketchOnXY(page, true);
    await line(page, [0, 0], [20, 6], true);
    const box = await page.locator("#sketch-tool-horizontal").boundingBox();
    assert.ok(box && box.height >= 44, `Horizontal is ${box?.height} px tall, under 44`);
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `Horizontal is off screen at x ${box.x}..${box.x + box.width}`);
    await page.tap("#sketch-tool-horizontal");
    await at(page, [10, 3], { tap: true });
    await shown(page, "sketchConstraints", "1");
    await shown(page, "sketchPoints", "0,0 20,0");
    await shot(page, "constraints-horizontal-375");
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
