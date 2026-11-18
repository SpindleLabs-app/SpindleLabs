// Copy as SVG of a sketch on a face seen from behind (export hunt 2026-11-12, SL #639 item 2): an L drawn on the
// box's bottom face was copied as the mirror image of what was drawn. The check compares where the corners were
// clicked on screen with where the SVG draws them: both are y-down pictures, so a true copy keeps the turning
// sense (the sign of the area) and the way the L's foot and arm point; a mirror image flips the turning sense.
// The top face is the control. Needs `?test-hooks` for the camera.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch, browserName } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseShape, closePanels, gridSnapOn, openPanel, sheetsClearFor, startWithBox, pickPlane } from "./start.mjs";

const server = await preview({ preview: { port: 4399, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4399/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  // The presses the page heard, last 40, for a timed-out wait's report (WebKit's only failure since PR #22 shows no state otherwise).
  await page.addInitScript(() => {
    const log = (window.__presses = []);
    for (const type of ["touchstart", "touchend", "pointerdown", "pointerup", "click"])
      document.addEventListener(type, (e) => {
        const t = e.target instanceof Element ? e.target.id || e.target.getAttribute("class") || e.target.tagName : String(e.target);
        log.push(`${type}@${Math.round(e.clientX ?? e.changedTouches?.[0]?.clientX ?? -1)},${Math.round(e.clientY ?? e.changedTouches?.[0]?.clientY ?? -1)}:${t}`);
        if (log.length > 40) log.shift();
      }, true);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await startWithBox(page); // a new project starts empty (U0c): the 40 × 30 × 20 box, inserted
  return sheetsClearFor(page); // phone: an open sheet (U5) is closed before the timeline, Undo, Redo or the view's buttons are pressed
}

const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
/** What the page shows now, for a timed-out wait's report: the sketch, the tool bar over the view, the sheet, the presses heard. */
const pageState = (page) =>
  page
    .evaluate(() => {
      const v = document.querySelector("#viewport")?.dataset ?? {};
      const bar = document.getElementById("phone-float");
      return JSON.stringify({
        view: { ...v }, status: document.getElementById("sketch-status")?.textContent,
        bar: bar ? `${bar.hidden ? "hidden" : "shown"} ${bar.dataset.kind}: ${bar.textContent}` : null,
        sheet: document.getElementById("properties-toggle")?.getAttribute("aria-expanded"),
        focus: document.activeElement?.id || document.activeElement?.tagName, presses: window.__presses,
      });
    })
    .catch((e) => `(no state: ${e.message})`);
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out; ${await pageState(page)}`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

// The pinhole camera, worked here apart from the app (navigation.mjs's sums): forward = unit(target − position),
// right = unit(forward × up), the screen's up = right × forward; a 45° vertical field of view.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
/** Where a world point is on screen (client pixels) for the camera `cam` and the canvas at `box`. */
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

/** Clicks (or taps) the world point `p` as the camera sees it now; fails if something is over the canvas there. */
async function at(page, p, tap = false) {
  await closePanels(page, tap); // phone: a sheet over the view (U5) is closed to reach the part
  const s = toScreen(await camera(page), await canvasBox(page), p);
  await closePanels(page, tap); // phone: an open sheet covers part of the view (U5b)
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) {
    // A tap a pixel or two from a button goes to the button (Chromium moves a tap onto a control within the finger's
    // reach): the 375 px front-plane check's corner sat 1.4 px under the Finish bar once the phone timeline grew 8 px
    // (phone hunt 11-01) and its tap finished the sketch. So a tapped point needs the canvas for 8 px all round.
    const near = await page.evaluate(([x, y]) => {
      for (let k = 0; k < 16; k++) {
        const e = document.elementFromPoint(x + 8 * Math.cos((k * Math.PI) / 8), y + 8 * Math.sin((k * Math.PI) / 8));
        if (!(e?.tagName === "CANVAS" && e.closest("#viewport"))) return e ? e.id || e.className || e.tagName : "nothing";
      }
      return null;
    }, [s.x, s.y]);
    if (near) throw new Error(`[${p}] is within a finger's 8 px of ${near} on screen, so a tap may land on it`);
    await page.touchscreen.tap(s.x, s.y);
  }
  else await page.mouse.click(s.x, s.y);
}

/** Moves the mouse over the world point `p`, and waits a few frames (hover is looked up once a frame). */
async function hover(page, p) {
  const s = toScreen(await camera(page), await canvasBox(page), p);
  await page.mouse.move(s.x, s.y);
  await page.waitForTimeout(150);
}

/** The WebGL canvas's own pixels (it keeps its drawing buffer). */
async function canvasImage(page) {
  const u = await page.evaluate(() => document.querySelector("#viewport canvas").toDataURL("image/png"));
  return decodePng(Buffer.from(u.slice(u.indexOf(",") + 1), "base64"));
}
/** The canvas pixel under the world point `p`, [r, g, b] (canvas pixels are CSS pixels at device scale 1). */
async function pixelAt(page, p) {
  const box = await canvasBox(page);
  const s = toScreen(await camera(page), box, p);
  const img = await canvasImage(page);
  const [x, y] = [Math.round(s.x - box.x), Math.round(s.y - box.y)];
  const i = 4 * (y * img.width + x);
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}
/**
 * A sketch line's blue (0x6cc4ff: blue well above red) within 1 px of the
 * world point `p`, whole in one pixel or shared by two side by side. A line
 * that falls on the boundary between two pixels is drawn as half its colour
 * in each (multisampling): the line's blue less red is 0xff - 0x6c = 147,
 * the faded box's grey (53, 58, 65) 12, so each half is (147 + 12) / 2 = 79,
 * read as (81, 127, 160) at 1280 px; the two summed are 158. So a pixel, or
 * a pixel and its neighbour, summing to 80 or more is a line; grey beside
 * grey sums to about 24.
 */
async function lineNear(page, img, p) {
  const box = await canvasBox(page);
  const s = toScreen(await camera(page), box, p);
  const [cx, cy] = [Math.round(s.x - box.x), Math.round(s.y - box.y)];
  const blue = (x, y) => {
    const i = 4 * (y * img.width + x);
    return img.data[i + 2] - img.data[i];
  };
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [x, y] = [cx + dx, cy + dy];
      if (blue(x, y) >= 80 || blue(x, y) + blue(x + 1, y) >= 80 || blue(x, y) + blue(x, y + 1) >= 80) return true;
    }
  return false;
}

/** Waits until the page has drawn a whole frame since now (two animation frames: the first may already be under way). */
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * Waits until no rebuild is on its way and a frame has been drawn since. An
 * edit draws the timeline bar and the browser at once, then again (new
 * elements) when the kernel's rebuild lands; a check that reads or taps in
 * between sees the step before, or an element about to go. On CI's runners
 * the rebuild can land late, and E2E_KERNEL_DELAY makes it late here
 * (browser.mjs).
 */
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
  await nextFrame(page);
}

/** Waits until the camera holds still (two reads 100 ms apart within a nanometre). */
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((x, k) => Math.abs(x - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}

/** Create sketch from the toolbar, the planes and faces on offer. */
async function createSketch(page, tap = false) {
  await press(page, "#create-sketch", tap);
  await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
}

/**
 * A closed rectangle on the sketch's plane through four world corners
 * (grid snap on, so each lands exactly): with a mouse, the line tool round
 * them, the last click on the first corner; with taps, the rectangle tool
 * from the third corner to the first (the typed boxes float right of and
 * below the last tap, so the second tap goes up and left of it).
 */
async function rectangle(page, corners, tap = false) {
  await openPanel(page, "properties", tap); // phone: the sketch's panel is a sheet, closed until its toggle (U5); `at` closes it again to reach the part
  await gridSnapOn(page);
  await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0)); // ticking it scrolled the panel into view at phone width
  if (!tap) for (const p of [...corners, corners[0]]) await at(page, p);
  else {
    await page.tap("#sketch-tool-rectangle");
    for (const p of [corners[2], corners[0]]) await at(page, p, true);
  }
}

/** Extrude from the sketch panel by `distance`, OK. */
async function extrude(page, distance, tap = false) {
  await openPanel(page, "properties", tap); // phone: the Extrude button and its box are in the Properties sheet (U5)
  await press(page, "#sketch-extrude", tap);
  await page.fill("#extrude-distance", String(distance));
  await press(page, "#extrude-ok", tap);
}

const near = (a, b, eps, what) => assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= eps), `${what}: [${a.map((x) => x.toFixed(4))}] vs [${b}]`);

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

// The proof compares the corners where the person clicked them on screen with the corners the SVG draws.
// Both are y-down pictures, so a faithful copy is the screen picture moved and scaled (same turning sense);
// a mirror image has the opposite turning sense (the signed area changes sign).
const shoelace = (pts) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;
async function lCopy(page, which) {
  // An L in the world's x, y on the face plane z, on the 10 mm grid: long arm along y, foot at small y towards +x.
  const z = which === "bottom" ? 0 : 20;
  const L = [[10, 0], [30, 0], [30, 10], [20, 10], [20, 30], [10, 30]].map(([x, y]) => [x, y, z]);
  const cam = await settle(page);
  const canvas = await canvasBox(page);
  const onScreen = L.map((p) => toScreen(cam, canvas, p)).map((s) => [s.x, s.y]);
  await rectangle(page, L);
  await until(page, () => document.querySelector("#sketch-status")?.textContent === "6 lines, a closed outline.", null, "closed");
  if (shots) await page.screenshot({ path: `${shots}/svg-${which}-drawn.png` });
  await page.click("#finish-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "finished");
  await page.evaluate(() => document.querySelectorAll("#browser details").forEach((d) => d.setAttribute("open", "")));
  const row = await page.$$eval("#browser [data-node^='sketches/']", (r) => r.map((e) => e.dataset.node));
  await page.click(`#browser [data-node="${row[0]}"]`);
  await page.click("#selection-actions [data-action='design.copy-svg']");
  await page.waitForFunction(() => document.querySelector("#action-note")?.textContent?.startsWith("Copied"));
  const svg = await page.evaluate(() => navigator.clipboard.readText());
  const d = /<path d="([^"]+)"/.exec(svg)[1];
  // My own reader of the path: M/L pairs only (the L has straight sides).
  const inSvg = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  console.log(`  ${which}: note "${await page.textContent("#action-note")}"`);
  console.log(`  ${which}: clicked on screen (px): ${onScreen.map((p) => p.map((v) => Math.round(v)).join(",")).join(" ")}`);
  console.log(`  ${which}: SVG path: ${d}`);
  const [a, b] = [shoelace(onScreen), shoelace(inSvg)];
  console.log(`  ${which}: turning sense on screen ${Math.sign(a)} (area ${a.toFixed(0)} px²), in the SVG ${Math.sign(b)} (area ${b} mm², by hand 20·10 + 10·20 = 400)`);
  // Where the foot points: on screen, the foot's tip (30, 5..10) relative to the long arm (10..15).
  const footScreen = Math.sign(onScreen[1][0] - onScreen[0][0]), armScreen = Math.sign(onScreen[5][1] - onScreen[0][1]);
  const footSvg = Math.sign(inSvg[1][0] - inSvg[0][0]), armSvg = Math.sign(inSvg[5][1] - inSvg[0][1]);
  console.log(`  ${which}: on screen the foot points ${footScreen > 0 ? "right" : "left"} and the arm runs ${armScreen > 0 ? "down" : "up"}; in the SVG the foot points ${footSvg > 0 ? "right" : "left"} and the arm runs ${armSvg > 0 ? "down" : "up"}`);
  assert.equal(Math.sign(b), Math.sign(a), `the SVG of the sketch on the ${which} face is the MIRROR IMAGE of what was drawn on screen`);
  // By hand: the L is 20 wide and 30 high with arms 10 wide, 20·10 + 10·20 = 400 mm².
  assert.equal(Math.abs(b), 400, "the L's area in the SVG, mm²");
  assert.deepEqual([footSvg, armSvg], [footScreen, armScreen], `on the ${which} face the L's foot and arm point the same way in the SVG as on screen`);
}
try {
  await check("control: an L drawn on the TOP face copies as SVG the way it looks on screen", async () => {
    const page = await fresh();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await createSketch(page);
    await hover(page, [20, 15, 20]);
    await at(page, [20, 15, 20]);
    await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
    await lCopy(page, "top");
    await page.context().close();
  });
  await check("an L drawn on the BOTTOM face copies as SVG the way it looks on screen", async () => {
    const page = await fresh();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 15 * k);
    await page.mouse.up();
    await settle(page);
    await createSketch(page);
    await hover(page, [20, 15, 0]);
    await at(page, [20, 15, 0]);
    await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
    await lCopy(page, "bottom");
    await page.context().close();
  });
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
