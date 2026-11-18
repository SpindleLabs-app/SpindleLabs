// Browser check of sketch dimensions (step 47e), in an empty design's XY
// sketch seen from above. 1280 px with a mouse: a line from (0, 0) to
// (20, 6); Dimension, a click on the line: the Length box opens with the
// keys in it; 30 and Enter: its start stays and its end goes on along it to
// 30·(20, 6)/√436 = (28.735, 8.620), the label reading 30. A double-click on
// the label opens the box again; 12 and Enter: the end comes back to 12
// from the start. 40 on the same line fights it: refused, red, nothing
// moves. Escape in the box adds nothing. A circle of radius 5 given
// diameter 16: radius 8, labelled ⌀ 16. Ctrl+Z takes the change back. 375 px
// with taps: the Dimension button on screen and 44 px tall, a tap on a line
// then 25 typed sets its length, and a tap on its label (with Dimension on)
// changes it. Screenshots go to E2E_SHOTS when set. Run with `npm run e2e`
// (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { swipeIntoSight } from "./toolbar-swipe.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, openPanel, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4287, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4287/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  // watchLabels: each press, click and double-click since the last box, with what it landed on, for a failure's message.
  await page.addInitScript(() => {
    window.labelEvents = [];
    for (const type of ["pointerdown", "focusout", "click", "dblclick"])
      addEventListener(type, (e) => {
        const t = e.target instanceof Element ? e.target : null;
        const what = t?.closest(".sketch-label")?.dataset.dimension ? `label ${t.closest(".sketch-label").dataset.dimension}${t.isConnected ? "" : " (gone)"}` : t?.id || t?.tagName || "?";
        window.labelEvents.push(`${type}:${what}`);
      }, true);
  });
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
 * Every point these checks draw is on the 0.5 mm grid.
 */
async function halfMillimetreGrid(page, tap) {
  await openPanel(page, "properties", tap);
  await page.fill("#sketch-grid", "0.5");
  await page.press("#sketch-grid", "Enter");
  await page.check("#sketch-grid-snap");
  await closePanels(page, tap);
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
/** The sketch's points, as numbers. */
const pointList = async (page) => (await points(page)).split(" ").filter(Boolean).map((p) => p.split(",").map(Number));
const nearly = (got, want, what, tol = 1e-4) => assert.ok(got.length === want.length && got.every((v, k) => Math.abs(v - want[k]) <= tol), `${what}: ${got.join(", ")}, not ${want.join(", ")}`);
/** The box a dimension's value is typed in, waited for with the keys in it; `step` names the wait in a failure, with the label events since the last (watchLabels). */
async function boxFor(page, field, step) {
  await until(page, (f) => document.activeElement?.id === `typed-${f}`, field, `${step}: the ${field} box has the keys`).then(() => page.evaluate(() => (window.labelEvents = []))).catch(async (e) =>
    assert.fail(`${e.message} (events ${await page.evaluate(() => (window.labelEvents ?? []).join(" "))}; focus on ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}, error "${await page.evaluate(() => document.querySelector("#sketch-grid-error")?.textContent ?? "")}", boxes ${await page.evaluate(() => document.querySelector("#typed-entry")?.hidden)})`));
}
/** The label showing `text`, its centre on screen once it has stopped moving (the view may still be settling after a solve:
 * a slow machine tapped where the label was a moment before, and hit the view). */
async function labelAt(page, text) {
  const el = page.locator(".sketch-label", { hasText: text }).first();
  await el.waitFor();
  let b = await el.boundingBox();
  for (let k = 0; k < 50; k++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const now = await el.boundingBox();
    if (now && b && now.x === b.x && now.y === b.y) break;
    b = now;
  }
  return { el, x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

try {
  await check("1280 px: a line's length typed, changed from its label, a size that fights refused, a circle's diameter, undo", async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await line(page, [0, 0], [20, 6], false);
    await page.click("#sketch-tool-dimension");
    await until(page, () => document.querySelector("#sketch-tool-dimension")?.getAttribute("aria-pressed") === "true", null, "Dimension pressed");
    // The line's middle (10, 3): the line is picked and its length waits in the box, the keys in it.
    await at(page, [10, 3]);
    await boxFor(page, "length", "the line picked");
    assert.equal(await page.locator("#typed-length").getAttribute("placeholder"), "20.881", "the box starts at the length as drawn, √436 = 20.881");
    // The box opens by the line's label, not off in the view's corner (the solver bug hunt, 2026-11-06).
    const middle = toScreen(await camera(page), await canvasBox(page), [10, 3, 0]);
    const opened = await page.locator("#typed-entry").boundingBox();
    assert.ok(opened && Math.hypot(opened.x - middle.x, opened.y - middle.y) < 150, `the box at ${opened?.x}, ${opened?.y}, the line's middle at ${middle.x}, ${middle.y}`);
    await shot(page, "dimensions-box-1280");
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
    await shown(page, "sketchConstraints", "1");
    await shown(page, "sketchLabels", "30");
    // Its start held, the end moves on along the line: 30·(20, 6)/√436.
    let p = await pointList(page);
    nearly(p[0], [0, 0], "the start");
    nearly(p[1], [(30 * 20) / Math.sqrt(436), (30 * 6) / Math.sqrt(436)], "the end");
    await shot(page, "dimensions-length-1280");
    // A double-click on the label opens its box again; 12 and Enter.
    const l = await labelAt(page, "30");
    await page.mouse.dblclick(l.x, l.y);
    await boxFor(page, "length", "the label double-clicked");
    // The label stays put while its box is open: it was sized for the pointer's last move, so a camera that had moved since
    // jumped it 13 px on the first click, and Firefox's second click missed it (47e).
    const still = await page.locator(".sketch-label", { hasText: "30" }).first().boundingBox();
    assert.ok(still && Math.abs(still.x - l.box.x) <= 0.5 && Math.abs(still.y - l.box.y) <= 0.5, `the label moved from ${l.box.x}, ${l.box.y} to ${still?.x}, ${still?.y} when clicked`);
    await page.keyboard.type("12");
    await page.keyboard.press("Enter");
    await shown(page, "sketchLabels", "12");
    p = await pointList(page);
    nearly(p[1], [(12 * 20) / Math.sqrt(436), (12 * 6) / Math.sqrt(436)], "the end after the change");
    assert.equal(await data(page, "sketchConstraints"), "1", "a change adds no dimension");
    // 40 on the same line fights the 12: refused with the reason, the 12 drawn red, nothing moves.
    await at(page, [6, 1.8]);
    await boxFor(page, "length", "40 on the same line");
    await page.keyboard.type("40");
    await page.keyboard.press("Enter");
    await until(page, () => /That dimension fights the ones shown in red/.test(document.querySelector("#sketch-grid-error")?.textContent ?? ""), null, "the fight refused");
    assert.ok(Number(await data(page, "sketchFighting")) > 0, "the dimension that fights is drawn red");
    assert.equal(await page.locator(".sketch-label-fighting").count(), 1, "its label red");
    nearly((await pointList(page))[1], p[1], "nothing moved");
    // The box stays open with the 40 typed, so it can be corrected (the solver bug hunt, 2026-11-06: it closed and lost it).
    await until(page, () => document.querySelector("#typed-entry")?.hidden === false && document.querySelector("#typed-length")?.getAttribute("placeholder") === "40", null, "the refused box open again with 40");
    await shot(page, "dimensions-fight-1280");
    await page.keyboard.press("Escape");
    // Escape in the box: nothing added.
    await at(page, [6, 1.8]);
    await boxFor(page, "length", "the line picked again, for Escape");
    await page.keyboard.type("5");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await data(page, "sketchConstraints"), "1", "Escape added nothing");
    // A circle round (0, -15) of radius 5, then its diameter 16: radius 8.
    await press(page, "#sketch-tool-circle", false);
    await at(page, [0, -15]);
    await at(page, [5, -15]);
    await until(page, () => Number(document.querySelector("#viewport").dataset.sketchLines) > 1, null, "the circle drawn");
    await page.click("#sketch-tool-dimension");
    await at(page, [0, -10]);
    await boxFor(page, "diameter", "the circle picked");
    assert.equal(await page.locator("#typed-diameter").getAttribute("placeholder"), "10");
    await page.keyboard.type("16");
    await page.keyboard.press("Enter");
    await shown(page, "sketchLabels", "12 | ⌀ 16");
    assert.equal(await data(page, "sketchConstraints"), "2");
    await shot(page, "dimensions-diameter-1280");
    // Ctrl+Z takes the diameter off, then the circle, then the change: back to 30, the end where 30 put it.
    await page.keyboard.press("Control+z");
    await shown(page, "sketchLabels", "12");
    await page.keyboard.press("Control+z");
    await until(page, () => document.querySelector("#viewport").dataset.sketchLines === "1", null, "the circle gone");
    await page.keyboard.press("Control+z");
    await shown(page, "sketchLabels", "30");
    nearly((await pointList(page))[1], [(30 * 20) / Math.sqrt(436), (30 * 6) / Math.sqrt(436)], "the end back where 30 put it");
    await page.context().close();
  });

  await check("375 px with taps: the Dimension button is on screen and big enough, a tap and a typed size set a length, a tap on the label changes it", async () => {
    const page = await fresh(375, true);
    await sketchOnXY(page, true);
    await line(page, [0, 0], [20, 6], true);
    // The toolbar is one row a finger swipes (UI audit 2026-11-12): swiped to, the button is wholly on screen.
    const box = await swipeIntoSight(page, "#sketch-tool-dimension");
    assert.ok(box && box.height >= 44, `Dimension is ${box?.height} px tall, under 44`);
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `Dimension is off screen at x ${box.x}..${box.x + box.width}`);
    await page.tap("#sketch-tool-dimension");
    await at(page, [10, 3], { tap: true });
    await boxFor(page, "length", "the line tapped");
    await page.keyboard.type("25");
    await page.keyboard.press("Enter");
    await shown(page, "sketchLabels", "25");
    nearly((await pointList(page))[1], [(25 * 20) / Math.sqrt(436), (25 * 6) / Math.sqrt(436)], "the end");
    await shot(page, "dimensions-length-375");
    // The label is big enough for a finger, and a tap on it (Dimension still on) changes it.
    const l = await labelAt(page, "25");
    assert.ok(l.box.height >= 28, `the label is ${l.box.height} px tall`);
    await page.touchscreen.tap(l.x, l.y);
    await boxFor(page, "length", "the label tapped");
    await page.keyboard.type("8");
    await page.keyboard.press("Enter");
    await shown(page, "sketchLabels", "8");
    await shot(page, "dimensions-changed-375");
    await page.context().close();
  });
  await check("1280 px: on a closed shape the size box stays by the side picked, even with a reason under it, not in the view's corner", async () => {
    // The solver bug hunt (2026-11-06): the box moved off the sketch's points, so on any small shape it jumped to the far corner.
    const page = await fresh();
    await sketchOnXY(page, false);
    await press(page, "#sketch-tool-rectangle", false);
    await at(page, [0, 0]);
    await at(page, [30, 20]);
    await until(page, () => document.querySelector("#viewport").dataset.sketchLines === "4", null, "the rectangle drawn");
    await page.click("#sketch-tool-dimension");
    await at(page, [15, 0]);
    await boxFor(page, "length", "the bottom side picked");
    // Text it can't read: the reason shows under the box, making it taller, which is what made it cover a corner and jump.
    await page.keyboard.type("10+30");
    await page.keyboard.press("Enter");
    await until(page, () => /isn't a length/.test(document.querySelector("#typed-entry")?.textContent ?? ""), null, "the text refused");
    await page.waitForTimeout(300);
    const side = toScreen(await camera(page), await canvasBox(page), [15, 0, 0]);
    const opened = await page.locator("#typed-entry").boundingBox();
    assert.ok(opened && Math.hypot(opened.x - side.x, opened.y - side.y) < 150, `the box at ${opened?.x}, ${opened?.y}, the side's middle at ${side.x}, ${side.y}`);
    await shot(page, "dimensions-small-box-1280");
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
