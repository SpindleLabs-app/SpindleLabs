// Browser check of Duplicate and Mirror body of a Combine's result (35f1f2c;
// rebuild.ts `copyBody`, built-body.ts `copiedFaceName`): a file with Box 1
// (40 × 30 × 20 at the origin), Box 2 (the same, moved (20, 15, 10) by Move 1)
// and Combine 1 joining Box 2 to Box 1: x 0..60, y 0..45, z 0..30, worked
// from the boxes' corners. The joined body picked by its Bodies row, then
// Modify ▾ Mirror body across YZ makes Mirror 1 (before 35f1f2c it failed
// "can't mirror a Combine's result yet"): the STL holds the join and its
// mirror image x −60..0, so x −60..60, and no row fails. A sketch is then
// made on the mirror's copy of Box 2's top (z 30, clicked at (−40, 30, 30)),
// and Move 1 edited to (20, 15, 15): Box 2 goes 5 higher, on the join and on
// its mirror alike, so the STL reaches z 35, and the sketch's row neither
// fails nor warns (its face followed). Undo and Redo, then a reload, keep it.
// Then Duplicate of the joined body: a copy on top of it, its own body in
// the Browser, no row failing. 1280 px with a mouse and 375 px with taps.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm
// run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4344, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4344/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const feature = (id, type, parameters, summary, label, from = [], dependsOn = []) => ({ id, intent: { type, parameters, summary }, provenance: { self: { workspace: "design", id, label }, from }, dependsOn, suppressed: false });
const MOVE = { turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };
const BOX2 = { workspace: "design", id: "feature-2", label: "Box 2" };
const features = [
  feature("feature-1", "box", { width: 40, depth: 30, height: 20 }, "Box: 40 × 30 × 20 mm", "Box 1"),
  feature("feature-2", "box", { width: 40, depth: 30, height: 20 }, "Box: 40 × 30 × 20 mm", "Box 2"),
  feature("feature-3", "move", { x: 20, y: 15, z: 10, ...MOVE, bodies: ["body:feature-2"] }, "Move Box 2 by (20, 15, 10) mm", "Move 1", [BOX2], ["feature-2"]),
  feature("feature-4", "combine", { target: "body:feature-1", tools: ["body:feature-2"], operation: "join", keepTools: false }, "Join Box 2 to Box 1", "Combine 1", [{ workspace: "design", id: "feature-1", label: "Box 1" }, BOX2], ["feature-1", "feature-2"]),
];
const DESIGN = { version: 13, nextId: 5, profiles: [], sketches: [], timeline: { features }, bodies: [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }], nextBody: 3 };
const project = { formatVersion: 2, links: [], materials: [], name: "Combine copy check", units: { length: "mm" }, workspaces: { design: DESIGN } };
const ITEMS = features.map((f) => f.id);

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
  await page.setInputFiles("#open-file", { name: "combine-copy.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open");
  await rebuilt(page);
  return sheetsClearFor(page);
}

const failedRows = (page) => page.$$eval("#timeline li[data-item][data-failed], #timeline li[data-item][data-warned]", (rows) => rows.map((r) => r.dataset.item));
const items = (page) => page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.dataset.item));

/** The joined body picked by its row in the Browser's Bodies. */
async function pickJoined(page, tap) {
  await openPanel(page, "browser", tap);
  await press(page, '#browser [data-node="bodies"] .tree-row', tap);
  await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the joined body picked").catch(async (e) => assert.fail(`${e.message} (picked: ${await page.evaluate(() => document.body.dataset.selection)})`));
  await closePanels(page, tap);
}
async function modify(page, tap, entry) {
  await press(page, "#modify-menu", tap);
  await until(page, () => !document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ opens");
  assert.notEqual(await page.getAttribute(entry, "aria-disabled"), "true", `${entry} on with the body picked`);
  await press(page, entry, tap);
  await rebuilt(page);
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
    await check(`${width} px${tap ? ", taps" : ""}: Mirror body of Combine 1's joined body across YZ, a sketch on the mirror's face following an edit of Move 1, undo, redo, reload; then Duplicate`, async () => {
      const page = await fresh(width, height, tap);
      try {
        near(await stlBounds(page, tap), [[0, 60], [0, 45], [0, 30]], "as made");
        await pickJoined(page, tap);
        await modify(page, tap, "#modify-menu-mirror-yz");
        assert.deepEqual(await items(page), [...ITEMS, "feature-5"]);
        assert.deepEqual(await failedRows(page), [], "no row fails");
        // The join and its mirror image across YZ (x → −x): x −60..60.
        near(await stlBounds(page, tap), [[-60, 60], [0, 45], [0, 30]], "the join and its mirror");
        // A sketch on the mirror's copy of Box 2's top: z 30 over x −60..−20, y 15..45; clicked at (−40, 30, 30).
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await press(page, "#create-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
        await at(page, [-40, 30, 30], tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on the mirror's top");
        if (shots) await page.screenshot({ path: `${shots}/combine-copy-${width}-sketch.png` });
        await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
        await press(page, "#finish-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
        await rebuilt(page);
        assert.deepEqual(await items(page), [...ITEMS, "feature-5", "sketch-6"]);
        // Move 1 to (20, 15, 15): Box 2 is z 15..35 on the join and its mirror, and the sketch on the mirror's top follows it.
        await editMove(page, tap);
        await page.fill("#move-z", "15");
        await press(page, "#move-ok", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");
        await rebuilt(page);
        assert.deepEqual(await failedRows(page), [], "no row fails or warns after the edit: the sketch's face followed");
        near(await stlBounds(page, tap), [[-60, 60], [0, 45], [0, 35]], "Box 2 higher on both");
        if (shots) await page.screenshot({ path: `${shots}/combine-copy-${width}-moved.png` });
        await closePanels(page, tap);
        await press(page, "#undo", tap);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[-60, 60], [0, 45], [0, 30]], "undone");
        await press(page, "#redo", tap);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[-60, 60], [0, 45], [0, 35]], "redone");
        await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
        await page.reload();
        await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, ITEMS.length + 2, "the design back from storage");
        await rebuilt(page);
        assert.deepEqual(await failedRows(page), [], "no row fails or warns after the reload");
        near(await stlBounds(page, tap), [[-60, 60], [0, 45], [0, 35]], "reloaded");
        // Duplicate of the joined body: a copy in the same place, a body of its own.
        await pickJoined(page, tap);
        await modify(page, tap, "#modify-menu-duplicate");
        assert.deepEqual(await failedRows(page), [], "no row fails after Duplicate");
        await openPanel(page, "browser", tap);
        assert.equal(await page.locator('#browser [data-node="bodies"] .tree-row').count(), 3, "the join, its mirror and its copy");
        await closePanels(page, tap);
        near(await stlBounds(page, tap), [[-60, 60], [0, 45], [0, 35]], "the copy on the join");
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
