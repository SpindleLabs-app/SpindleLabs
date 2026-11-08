// Browser check of projecting a Combine result's edges into a sketch (35f1f2b;
// design-edges.ts): a file with Box 1 (40 × 30 × 20 at the origin), Box 2
// (the same, moved (20, 15, 10) by Move 1) and Combine 1 joining Box 2 to
// Box 1. A sketch on Box 1's top (z 20, picked at (5, 5, 20), clear of Box 2),
// then Project on Box 2's top (z 30, x 20..60, y 15..45, worked from Box 2's
// corner plus its sizes): four projected edges, their ends at (20, 15),
// (60, 15), (60, 45) and (20, 45) seen from above (before 35f1f2b each was
// refused, "it has no name"). Move 1 edited to (30, 15, 10): Box 2's top is
// x 30..70, and opened again the projected corners have followed it to
// (30, 15), (70, 15), (70, 45), (30, 45), with no warning on the sketch's
// row. Reloaded, the same. 1280 px with a mouse and 375 px with taps.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm
// run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4343, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4343/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const feature = (id, type, parameters, summary, label, from = [], dependsOn = []) => ({ id, intent: { type, parameters, summary }, provenance: { self: { workspace: "design", id, label }, from }, dependsOn, suppressed: false });
const MOVE = { turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };
const BOX2 = { workspace: "design", id: "feature-2", label: "Box 2" };
// Made as Design's own functions make it (version 13, read as today's).
const features = [
  feature("feature-1", "box", { width: 40, depth: 30, height: 20 }, "Box: 40 × 30 × 20 mm", "Box 1"),
  feature("feature-2", "box", { width: 40, depth: 30, height: 20 }, "Box: 40 × 30 × 20 mm", "Box 2"),
  feature("feature-3", "move", { x: 20, y: 15, z: 10, ...MOVE, bodies: ["body:feature-2"] }, "Move Box 2 by (20, 15, 10) mm", "Move 1", [BOX2], ["feature-2"]),
  feature("feature-4", "combine", { target: "body:feature-1", tools: ["body:feature-2"], operation: "join", keepTools: false }, "Join Box 2 to Box 1", "Combine 1", [{ workspace: "design", id: "feature-1", label: "Box 1" }, BOX2], ["feature-1", "feature-2"]),
];
const DESIGN = { version: 13, nextId: 5, profiles: [], sketches: [], timeline: { features }, bodies: [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }], nextBody: 3 };
const project = { formatVersion: 2, links: [], materials: [], name: "Combine projection check", units: { length: "mm" }, workspaces: { design: DESIGN } };
const ITEMS = features.map((f) => f.id);
const corners = (x0) => [`${x0},15`, `${x0},15`, `${x0},45`, `${x0},45`, `${x0 + 40},15`, `${x0 + 40},15`, `${x0 + 40},45`, `${x0 + 40},45`].sort();

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
  await nextFrame(page);
}

// The pinhole camera (face-sketch.mjs's sums): forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field of view.
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
/** Clicks (or taps) the world point `p` as the camera sees it now; fails if something is over the canvas there. */
async function at(page, p, tap = false) {
  await closePanels(page, tap);
  const s = toScreen(await camera(page), await canvasBox(page), p);
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}
/** Waits until the camera holds still. */
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

const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const points = async (page) => (await data(page, "sketchPoints")).split(" ").sort();
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  // Storage wiped on the first load only, so the reload below finds the design stored.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("wiped")) return;
    indexedDB.deleteDatabase("fission");
    sessionStorage.setItem("wiped", "1");
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "&combine#design");
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "combine-pins.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open");
  await rebuilt(page);
  return sheetsClearFor(page);
}

/** Finish Sketch (scrolled to the top first: at 375 px the bar is above the fold after a tap). */
async function finish(page, tap) {
  await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
  await press(page, "#finish-sketch", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
}
/** Sketch `id` opened again from its timeline row (a double click, or Edit Sketch in its menu on a phone). */
async function reopen(page, tap, id) {
  await rebuilt(page);
  await closePanels(page, tap);
  const item = page.locator(`#timeline [data-item="${id}"]`);
  await item.scrollIntoViewIfNeeded();
  if (tap) {
    // A phone opens it from its row's menu (its ⋯), Edit Sketch.
    if (!(await page.isVisible(`#timeline [data-more="${id}"]`))) await item.tap();
    await page.tap(`#timeline [data-more="${id}"]`);
    await until(page, () => document.getElementById("row-menu").open, null, "the sketch's menu");
    await page.tap("#row-menu-edit-sketch");
  } else await item.dblclick();
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "the sketch open again").catch(async (e) => {
    if (shots) await page.screenshot({ path: `${shots}/combine-pins-reopen-failed.png` });
    throw e;
  });
  await settle(page);
}
/** Move 1's Edit feature, from its timeline item's menu (right-click, or its ⋯ on a phone). */
async function editMove(page, tap) {
  const item = page.locator('#timeline [data-item="feature-3"]');
  if (tap) {
    if (!(await page.isVisible('#timeline [data-more="feature-3"]'))) await (await closePanels(page, true), item.tap());
    await page.tap('#timeline [data-more="feature-3"]');
  } else await item.click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
  await press(page, "#row-menu-edit", tap);
  await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open");
}
const warned = (page) => page.$$eval("#timeline li[data-item][data-failed], #timeline li[data-item][data-warned]", (rows) => rows.map((r) => r.dataset.item));

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
    await check(`${width} px${tap ? ", taps" : ""}: Box 2's top projected from Combine 1's joined body follows Box 2 when Move 1 changes, and after a reload`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await press(page, "#create-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
        await at(page, [5, 5, 20], tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on Box 1's top");
        await settle(page);
        if (tap) await press(page, "#sketch-tool-project", tap);
        else await page.keyboard.press("p");
        await until(page, () => document.querySelector("#viewport").dataset.sketchPicks === "true", null, "Project on");
        await at(page, [40, 30, 30], tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketchProjected === "4", null, "four edges projected").catch(async (e) => assert.fail(`${e.message}; said: ${await page.evaluate(() => document.querySelector("#sketch-grid-error")?.textContent ?? "")}`));
        assert.deepEqual(await points(page), corners(20), "Box 2's top's corners, seen from above");
        if (shots) await page.screenshot({ path: `${shots}/combine-pins-${width}-projected.png` });
        await finish(page, tap);
        await rebuilt(page);
        assert.deepEqual(await warned(page), [], "no row warns or fails");
        // Move 1 edited to (30, 15, 10): Box 2's top slides 10 along x.
        await editMove(page, tap);
        await page.fill("#move-x", "30");
        await press(page, "#move-ok", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");
        await rebuilt(page);
        assert.deepEqual(await warned(page), [], "no row warns or fails after the edit");
        await reopen(page, tap, "sketch-5");
        assert.deepEqual(await points(page), corners(30), "followed Box 2's top");
        if (shots) await page.screenshot({ path: `${shots}/combine-pins-${width}-followed.png` });
        await finish(page, tap);
        // Stored, then reloaded: the projection still holds Box 2's top where it is now.
        await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
        await page.reload();
        await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, ITEMS.length + 1, "the design back from storage");
        await rebuilt(page);
        assert.deepEqual(await warned(page), [], "no row warns or fails after the reload");
        await reopen(page, tap, "sketch-5");
        assert.deepEqual(await points(page), corners(30), "reloaded");
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  server.httpServer.close();
}

if (errors.length) {
  failed++;
  console.log(`not ok - no page errors\n  ${errors.join("\n  ")}`);
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
