// Browser check of extruding several profiles at once (Ben, 2026-11-11, as
// Fusion's Ctrl-click). A file with a 10 mm box and Sketch 1 on XY: two
// 10 mm squares side by side (x 20..30 and 30..40, sharing the side
// x = 30) and one apart (x 50..60), all y 0..10. 1280 px with a mouse: a
// click picks the left square, Ctrl-clicks add the other two, the panel
// says "3 selected", the preview at 5 mm is 3 × 10 × 10 × 5 = 1,500 mm³
// (the kernel's volumes added), OK makes one timeline item and two bodies
// (the touching pair one body, the square apart another), so the Bodies
// group lists three with the box; Ctrl-click on a picked square takes it
// away. 375 px with taps: Pick several (a phone has no Ctrl), two taps,
// "2 selected", OK makes one body of 20 × 10 × 3 = 600 mm³. Screenshots go
// to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, openPanel, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4317/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const square = (n, x0, x1) => [[x0, 0], [x1, 0], [x1, 10], [x0, 10]].map(([x, y], i) => ({ id: `point-${n + i}`, x, y }));
// The pair shares the corners (30, 0) and (30, 10) and one line between them.
const pts = [...square(3, 20, 30), { id: "point-7", x: 40, y: 0 }, { id: "point-8", x: 40, y: 10 }, ...square(9, 50, 60)];
const line = (id, a, b) => ({ id: `line-${id}`, kind: "line", start: `point-${a}`, end: `point-${b}` });
const lines = [line(13, 3, 4), line(14, 4, 7), line(15, 7, 8), line(16, 8, 5), line(17, 5, 6), line(18, 6, 3), line(19, 4, 5), line(20, 9, 10), line(21, 10, 11), line(22, 11, 12), line(23, 12, 9)];
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
  await until(page, () => !document.querySelector("#extrude-panel")?.hidden && (document.querySelector("#viewport").dataset.extrudeProfiles ?? "").split(" ").length >= 3, null, "the Extrude panel with the three squares offered");
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
  await check("1280 px: Ctrl-clicks add two squares to the first, 3 selected, 1,500 mm³ previewed; OK makes one item and two bodies; Ctrl-click takes one away", async () => {
    const page = await opened(1280, false);
    await openExtrude(page, false);
    await at(page, [25, 5]);
    await until(page, () => document.querySelector("#viewport").dataset.extrudeChosen !== "" && document.querySelector("#viewport").dataset.extrudeChosen !== undefined && document.querySelector("#viewport").dataset.extrudeChosen.includes("#"), null, "the left square chosen");
    const left = await data(page, "extrudeChosen");
    await at(page, [35, 5], { ctrl: true });
    await at(page, [55, 5], { ctrl: true });
    await profileSays(page, "3 selected");
    assert.equal((await data(page, "extrudeAlso")).split(" ").length, 2, "two more drawn chosen");
    assert.equal(await data(page, "extrudeChosen"), left, "the left square still first");
    await typeDistance(page, 5, false);
    // 3 squares × 10 × 10 × 5 mm.
    await previewIs(page, 1500);
    await shot(page, "several-picked-1280");
    // Ctrl-click on the far square takes it away: 2 selected, 1,000 mm³.
    await at(page, [55, 5], { ctrl: true });
    await profileSays(page, "2 selected");
    await previewIs(page, 1000);
    // And again adds it back.
    await at(page, [55, 5], { ctrl: true });
    await profileSays(page, "3 selected");
    await previewIs(page, 1500);
    await page.click("#extrude-ok");
    await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel closed");
    // The box, the joined pair and the square apart.
    await until(page, () => document.querySelectorAll('#browser [data-eye^="body-"]').length === 3, null, "three Body rows").catch(async (e) => assert.fail(`${e.message} (${await bodyRows(page)})`));
    await shot(page, "several-made-1280");
    await page.context().close();
  });

  await check("1280 px: a plain click after Ctrl-clicks picks only that square", async () => {
    const page = await opened(1280, false);
    await openExtrude(page, false);
    await at(page, [25, 5]);
    await at(page, [55, 5], { ctrl: true });
    await profileSays(page, "2 selected");
    await at(page, [35, 5]);
    await profileSays(page, "Sketch 1");
    assert.equal(await data(page, "extrudeAlso"), "", "no others drawn chosen");
    await page.context().close();
  });

  await check("375 px with taps: Pick several, two taps, 2 selected; OK makes the touching pair one 600 mm³ body", async () => {
    const page = await opened(375, true);
    await openExtrude(page, true);
    await openPanel(page, "properties", true);
    await page.tap("#extrude-several");
    assert.equal(await page.getAttribute("#extrude-several", "aria-pressed"), "true");
    const box = await page.locator("#extrude-several").boundingBox();
    assert.ok(box.height >= 44, `Pick several is ${box.height} px tall, at least 44 to tap`);
    await at(page, [25, 5], { tap: true });
    await at(page, [35, 5], { tap: true });
    await openPanel(page, "properties", true);
    await profileSays(page, "2 selected");
    await typeDistance(page, 3, true);
    // 20 × 10 × 3 mm.
    await previewIs(page, 600);
    await shot(page, "several-picked-375");
    await page.tap("#extrude-ok");
    await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel closed");
    await openPanel(page, "browser", true);
    await until(page, () => document.querySelectorAll('#browser [data-eye^="body-"]').length === 2, null, "two Body rows: the box and the pair").catch(async (e) => assert.fail(`${e.message} (${await bodyRows(page)})`));
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
