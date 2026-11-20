// Browser check of a Move's words for a Combine's piece (SL #507 "Pieces are named three ways"): a file with Box 1
// (30 × 10 × 10 at the origin), Box 2 (4 × 20 × 20 moved (13, −5, −5), so it spans x 13..17 through all of Box 1)
// and Combine 1 cutting Box 2 from Box 1. Worked by hand: two chunks are left, x 0..13 and x 17..30; one keeps Box 1's
// body, the other is a piece of Combine 1. With the Move tool each chunk is clicked on its top (z = 10) from the Top view:
// the Box 1 chunk's panel line says "Body: Box 1" and the piece's "Body: a piece of Combine 1", as Copy, Combine,
// Extrude and Chamfer name a piece (before, Move alone said "Body: Combine 1"). Moved 50 up, the new timeline row's
// words are "Move a piece of Combine 1 by (0, 0, 50) mm". 1280 px with a mouse and 375 px with taps. Screenshots go to
// E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4342, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4342/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const feature = (id, type, parameters, summary, label, from = [], dependsOn = []) => ({ id, intent: { type, parameters, summary }, provenance: { self: { workspace: "design", id, label }, from }, dependsOn, suppressed: false });
const MOVE = { turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };
const BOX1 = { workspace: "design", id: "feature-1", label: "Box 1" };
const BOX2 = { workspace: "design", id: "feature-2", label: "Box 2" };
// Made as Design's own functions make it (version 13).
const features = [
  feature("feature-1", "box", { width: 30, depth: 10, height: 10 }, "Box: 30 × 10 × 10 mm", "Box 1"),
  feature("feature-2", "box", { width: 4, depth: 20, height: 20 }, "Box: 4 × 20 × 20 mm", "Box 2"),
  feature("feature-3", "move", { x: 13, y: -5, z: -5, ...MOVE, bodies: ["body:feature-2"] }, "Move Box 2 by (13, -5, -5) mm", "Move 1", [BOX2], ["feature-2"]),
  feature("feature-4", "combine", { target: "body:feature-1", tools: ["body:feature-2"], operation: "cut", keepTools: false }, "Cut Box 2 from Box 1", "Combine 1", [BOX1, BOX2], ["feature-1", "feature-2"]),
];
const DESIGN = { version: 13, nextId: 5, profiles: [], sketches: [], timeline: { features }, bodies: [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }], nextBody: 3 };
const project = { formatVersion: 2, links: [], materials: [], name: "Move piece words check", units: { length: "mm" }, workspaces: { design: DESIGN } };
const ITEMS = features.map((f) => f.id);
const CHUNKS = [[6.5, 5, 10], [23.5, 5, 10]]; // the middles of the two chunks' tops: x 0..13 and 17..30

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
  await page.setInputFiles("#open-file", { name: "move-piece-words.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
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

const bodiesLine = (page) => page.evaluate(() => { const el = document.getElementById("move-bodies"); return el && !el.hidden ? el.textContent : ""; });
const lineIs = (page, words, what) => until(page, (w) => { const el = document.getElementById("move-bodies"); return !!el && !el.hidden && el.textContent === w; }, words, what).catch(async (e) => assert.fail(`${e.message}: the line says ${JSON.stringify(await bodiesLine(page))}`));

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: Move names Box 1's chunk "Box 1" and the other "a piece of Combine 1", in its panel and its timeline row`, async () => {
      const page = await fresh(width, height, tap);
      try {
        assert.deepEqual(await failedRows(page), [], "no row fails as opened");
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await page.evaluate(() => document.activeElement?.blur());
        if (tap) await press(page, "#move", tap);
        else await page.keyboard.press("m");
        await opened(page);
        // Each chunk once: whichever keeps Box 1's body says Box 1, the other the piece's words.
        const said = [];
        for (const p of CHUNKS) {
          await at(page, p, tap);
          await until(page, () => { const el = document.getElementById("move-bodies"); return !!el && !el.hidden && /^Body: /.test(el.textContent ?? ""); }, null, `the chunk at [${p}] picked`);
          said.push(await bodiesLine(page));
          await at(page, p, tap); // picked again: let go
          await until(page, () => document.getElementById("move-bodies")?.hidden !== false || document.getElementById("move-bodies")?.textContent === "", null, `the chunk at [${p}] let go`);
        }
        assert.deepEqual([...said].sort(), ["Body: Box 1", "Body: a piece of Combine 1"], `the two chunks' lines: ${JSON.stringify(said)}`);
        const piece = CHUNKS[said.indexOf("Body: a piece of Combine 1")];
        await at(page, piece, tap);
        await lineIs(page, "Body: a piece of Combine 1", "the piece picked again");
        await page.fill("#move-z", "50");
        if (shots) await page.screenshot({ path: `${shots}/move-piece-words-${width}-panel.png` });
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        assert.deepEqual(await failedRows(page), [], "no row fails after the Move");
        const tip = () => page.evaluate(() => { const li = [...document.querySelectorAll("#timeline li[data-item]")].at(-1); return `${li?.title ?? ""} ${li?.dataset.tip ?? ""}`; });
        await until(page, () => { const li = [...document.querySelectorAll("#timeline li[data-item]")].at(-1); return /Move a piece of Combine 1 by \(0, 0, 50\) mm/.test(`${li?.title ?? ""} ${li?.dataset.tip ?? ""}`); }, null, "the Move's row words").catch(async (e) => assert.fail(`${e.message}: ${await tip()}`));
        if (shots) await page.screenshot({ path: `${shots}/move-piece-words-${width}-moved.png` });
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
