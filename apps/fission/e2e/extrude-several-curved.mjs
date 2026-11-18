// Browser check of SL #611 C1 (hunt 2026-11-12 C): a 10 mm box, and Sketch 1 on XY with a 10 mm square
// (x 20..30, y 0..10) and a circle r 5 at (55, 5), apart. 1280 px with a mouse: click the square, Ctrl-click the
// circle, 5 mm: the preview is 500 + 125pi mm³; OK records it with no red error and the Bodies group lists the box,
// the square's body and the circle's (the kernel's booleans take flat faces only, so before the fix the whole item
// failed). Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, openPanel, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4411, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4411/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const pts = [{ id: "point-3", x: 20, y: 0 }, { id: "point-4", x: 30, y: 0 }, { id: "point-5", x: 30, y: 10 }, { id: "point-6", x: 20, y: 10 }, { id: "point-7", x: 55, y: 5 }];
const line = (id, a, b) => ({ id: `line-${id}`, kind: "line", start: `point-${a}`, end: `point-${b}` });
const lines = [line(13, 3, 4), line(14, 4, 5), line(15, 5, 6), line(16, 6, 3), { id: "circle-17", kind: "circle", centre: "point-7", radius: 5 }];
const file = {
  formatVersion: 2,
  name: "Three squares",
  units: { length: "mm" },
  materials: [],
  links: [],
  workspaces: {
    design: {
      version: 3,
      nextId: 30,
      profiles: [],
      sketches: [{ id: "sketch-2", points: pts, curves: lines, constraints: [] }],
      timeline: {
        features: [
          { id: "feature-1", intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Feature 1 (box)" }, from: [] }, dependsOn: [], suppressed: false },
          { id: "sketch-2", intent: { type: "sketch", parameters: { plane: "XY" }, summary: "Sketch 1 on the XY plane" }, provenance: { self: { workspace: "design", id: "sketch-2", label: "Sketch 1" }, from: [] }, dependsOn: [], suppressed: false },
        ],
      },
    },
  },
};

async function opened(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 812 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  await pinProperties(page);
  await sheetsClearFor(page);
  await page.setInputFiles("#open-file", { name: "squares.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await until(page, () => document.querySelector("#viewport").dataset.rebuilding !== "true" && /Box/.test(document.querySelector("#timeline")?.textContent ?? ""), null, "the file opened");
  await settle(page);
  return page;
}

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => assert.fail(`${what}: timed out`));
const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
/** Where the pinhole camera (45° field) puts world point `p` on the screen. */
function toScreen(cam, box, p) {
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const nx = dot(v, right) / (dot(v, forward) * T * (box.width / box.height));
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
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
/** Clicks or taps sketch point (x, y) on XY, Control held when `ctrl`; fails if something is over the canvas there. */
async function at(page, [x, y], { tap = false, ctrl = false } = {}) {
  await closePanels(page, tap);
  const s = toScreen(await camera(page), await canvasBox(page), [x, y, 0]);
  const on = await page.evaluate(([sx, sy]) => {
    const e = document.elementFromPoint(sx, sy);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${x}, ${y}] is under ${on} on screen, not the canvas`);
  if (tap) return page.touchscreen.tap(s.x, s.y);
  if (ctrl) await page.keyboard.down("Control");
  await page.mouse.click(s.x, s.y);
  if (ctrl) await page.keyboard.up("Control");
}
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const profileSays = (page, want) => until(page, (w) => document.querySelector("#extrude-profile")?.textContent === w, want, `the profile row "${want}"`).catch(async (e) => assert.fail(`${e.message} (it says "${await page.textContent("#extrude-profile")}")`));
const previewIs = (page, want) => until(page, ([w]) => Math.abs(Number(document.querySelector("#extrude-panel")?.dataset.previewVolume || "NaN") - w) <= 1e-6 * w, [want], `the preview ${want} mm³`).catch(async (e) => assert.fail(`${e.message} (preview ${await page.evaluate(() => document.querySelector("#extrude-panel")?.dataset.previewVolume)})`));
const bodyRows = (page) => page.$$eval('#browser [data-eye^="body-"]', (es) => es.length);

async function openExtrude(page, tap) {
  await press(page, "#extrude", tap);
  await until(page, () => !document.querySelector("#extrude-panel")?.hidden && (document.querySelector("#viewport").dataset.extrudeProfiles ?? "").split(" ").length >= 2, null, "the Extrude panel with the square and the circle offered");
}
async function typeDistance(page, d, tap) {
  if (tap) await openPanel(page, "properties", true);
  await page.fill("#extrude-distance", String(d));
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
  await check("hunt C1, 1280 px: a square and a circle apart, Ctrl-picked, 5 mm, OK: the box and two new bodies, no red error", async () => {
    const page = await opened(1280, false);
    await openExtrude(page, false);
    await at(page, [25, 5]);
    await at(page, [55, 5], { ctrl: true });
    await profileSays(page, "2 selected");
    await typeDistance(page, 5, false);
    // 10 x 10 x 5 = 500 plus pi 25 x 5 = 125pi.
    await previewIs(page, 500 + 125 * Math.PI);
    await shot(page, "hunt-c1-preview");
    await page.click("#extrude-ok");
    await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel closed (OK recorded it)");
    await page.waitForTimeout(1500);
    await shot(page, "hunt-c1-after-ok");
    const err = await page.evaluate(() => document.querySelector("#error")?.textContent ?? "");
    const rows = await bodyRows(page);
    console.log(`  after OK: ${rows} Body rows; error line: ${JSON.stringify(err)}`);
    assert.equal(err, "", "no red error after OK");
    assert.equal(rows, 3, "the box, the square's body and the circle's body");
    await page.context().close();
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
