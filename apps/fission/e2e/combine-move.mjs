// Browser check of moving a Combine's result (35f1f2a; rebuild.ts
// `moveBodies`, the kernel's body_move): a file with Box 1 (40 × 30 × 20 at
// the origin), Box 2 (the same moved (20, 15, 10)), Combine 1 joining Box 2
// to Box 1, and Box 3 (10 × 10 × 10 moved 100 along x). Worked by hand: the
// join spans x 0..60, y 0..45, z 0..30, 24,000 + 24,000 − 20 · 15 · 10 =
// 45,000 mm³; with Box 3 the STL holds 46,000 mm³ in x 0..110. The joined
// body picked with the Move tool (on Box 1's top at (5, 5, 20), clear of Box
// 2) and moved 50 along y: x 0..110 still (Box 3 reaches 110), y 0..95 (the
// join 50..95, Box 3 0..10),
// volume unchanged; no row fails (before 35f1f2a the Move failed "can't
// move a Combine's result yet"). Undo puts it back, Redo moves it again,
// and a reload of the saved design builds it moved. 1280 px with a mouse
// and 375 px with taps. Screenshots go to E2E_SHOTS when set. Run with `npm
// run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4341, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4341/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const feature = (id, type, parameters, summary, label, from = [], dependsOn = []) => ({ id, intent: { type, parameters, summary }, provenance: { self: { workspace: "design", id, label }, from }, dependsOn, suppressed: false });
const MOVE = { turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };
const BOX2 = { workspace: "design", id: "feature-2", label: "Box 2" };
const BOX3 = { workspace: "design", id: "feature-5", label: "Box 3" };
// Made as Design's own functions make it (version 13).
const features = [
  feature("feature-1", "box", { width: 40, depth: 30, height: 20 }, "Box: 40 × 30 × 20 mm", "Box 1"),
  feature("feature-2", "box", { width: 40, depth: 30, height: 20 }, "Box: 40 × 30 × 20 mm", "Box 2"),
  feature("feature-3", "move", { x: 20, y: 15, z: 10, ...MOVE, bodies: ["body:feature-2"] }, "Move Box 2 by (20, 15, 10) mm", "Move 1", [BOX2], ["feature-2"]),
  feature("feature-4", "combine", { target: "body:feature-1", tools: ["body:feature-2"], operation: "join", keepTools: false }, "Join Box 2 to Box 1", "Combine 1", [{ workspace: "design", id: "feature-1", label: "Box 1" }, BOX2], ["feature-1", "feature-2"]),
  feature("feature-5", "box", { width: 10, depth: 10, height: 10 }, "Box: 10 × 10 × 10 mm", "Box 3"),
  feature("feature-6", "move", { x: 100, y: 0, z: 0, ...MOVE, bodies: ["body:feature-5"] }, "Move Box 3 by (100, 0, 0) mm", "Move 2", [BOX3], ["feature-5"]),
];
const DESIGN = { version: 13, nextId: 7, profiles: [], sketches: [], timeline: { features }, bodies: [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }, { id: "body:feature-5", number: 3 }], nextBody: 4 };
const project = { formatVersion: 2, links: [], materials: [], name: "Combine move check", units: { length: "mm" }, workspaces: { design: DESIGN } };
const ITEMS = features.map((f) => f.id);
const AS_MADE = [[0, 110], [0, 45], [0, 30]];
const MOVED = [[0, 110], [0, 95], [0, 30]]; // the join y 50..95, Box 3 still y 0..10

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

const opened = (page) => until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open");
const closed = (page) => until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
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
  await page.setInputFiles("#open-file", { name: "combine-move.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open");
  await rebuilt(page);
  return sheetsClearFor(page);
}


/** The toolbar's STL's enclosed volume (mm³): the sum over its triangles of the signed tetrahedra to the origin. */
async function stlVolume(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  let v = 0;
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    v += dot(a, cross(b, c)) / 6;
  }
  return v;
}
const failedRows = (page) => page.$$eval("#timeline li[data-item][data-failed]", (rows) => rows.map((r) => r.dataset.item));

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
    await check(`${width} px${tap ? ", taps" : ""}: the Move tool moves Combine 1's joined body 50 along y, undone, redone and kept across a reload`, async () => {
      const page = await fresh(width, height, tap);
      try {
        near(await stlBounds(page, tap), AS_MADE, "as made");
        assert.ok(Math.abs((await stlVolume(page, tap)) - 46000) <= 0.05, "46,000 mm³ as made");
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await page.evaluate(() => document.activeElement?.blur());
        if (tap) await press(page, "#move", tap);
        else await page.keyboard.press("m");
        await opened(page);
        await at(page, [5, 5, 20], tap);
        await until(page, () => { const el = document.getElementById("move-bodies"); return !el?.hidden && /^Body: /.test(el?.textContent ?? ""); }, null, "the joined body picked");
        await page.fill("#move-y", "50");
        if (shots) await page.screenshot({ path: `${shots}/combine-move-${width}-panel.png` });
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        assert.deepEqual(await failedRows(page), [], "no row fails");
        near(await stlBounds(page, tap), MOVED, "the join moved 50 along y");
        assert.ok(Math.abs((await stlVolume(page, tap)) - 46000) <= 0.05, "the volume kept");
        if (shots) await page.screenshot({ path: `${shots}/combine-move-${width}-moved.png` });
        await closePanels(page, tap);
        await press(page, "#undo", tap);
        await rebuilt(page);
        near(await stlBounds(page, tap), AS_MADE, "undone");
        await press(page, "#redo", tap);
        await rebuilt(page);
        near(await stlBounds(page, tap), MOVED, "redone");
        // Stored, then reloaded: the design opens from storage with the Combine's result moved.
        await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
        await page.reload();
        await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, ITEMS.length + 1, "the design back from storage");
        await rebuilt(page);
        assert.deepEqual(await failedRows(page), [], "no row fails after the reload");
        near(await stlBounds(page, tap), MOVED, "reloaded");
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
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
  failed++;
}
if (failed) process.exit(1);
