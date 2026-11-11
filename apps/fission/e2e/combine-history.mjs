// Browser check of what a Combine leaves behind straight after OK (hunt
// 2026-11-06, workspace.ts showBuilt and finishCombine), with `?combine`:
// 1. A Cut that splits its target in two lists both halves as Body rows at
//    once (the halves' numbers come from the rebuild after OK; the rows were
//    drawn from the design before them, so the second half had no row until
//    an Undo and Redo or a reload). Box 1 40 × 30 × 20 at the origin, Box 2
//    10 × 40 × 30 moved (15, −5, −5) so it runs right through Box 1 at
//    x 15..25, Box 3 10 × 10 × 10 moved 100 along x. Cut Box 2 from Box 1:
//    two halves x 0..15 and x 25..40, each 15 · 30 · 20 = 9,000 mm³, Box 2
//    used up, Box 3's 1,000 kept: the STL holds 9,000 + 9,000 + 1,000 =
//    19,000 mm³ and the rows are Body 1, Body 3 and the new half Body 4.
//    1280 px with a mouse and 375 px with taps.
// 2. With a slow kernel (E2E_KERNEL_DELAY), a choice changed after OK while
//    the kernel still checks (the operation switched to Join, a tool clicked
//    out) records nothing and says so with the panel open; OK again records
//    the new choice. Same bodies as combine.mjs: Box 1 40 × 30 × 20, Box 2
//    the same moved (20, 15, 10) (overlap 20 · 15 · 10 = 3,000 mm³), Box 3
//    10 × 10 × 10 moved 100 along x: as made 24,000 + 24,000 + 1,000 =
//    49,000 mm³. Box 2 joined to Box 1: 48,000 − 3,000 + 1,000 = 46,000.
//    Box 2 alone cut from Box 1: 21,000 + 1,000 = 22,000 (with Box 3 cut too,
//    Box 3 would be used up: 21,000). 1280 px with a mouse.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

// The slow kernel for check 2: browser.mjs reads E2E_KERNEL_DELAY when it loads, so a second copy of it is loaded
// with the delay set (a delay CI already gives both is kept).
const delayWas = process.env.E2E_KERNEL_DELAY;
process.env.E2E_KERNEL_DELAY ||= "800";
const { launch: launchSlow } = await import("./browser.mjs?slow-kernel");
if (delayWas === undefined) delete process.env.E2E_KERNEL_DELAY;
else process.env.E2E_KERNEL_DELAY = delayWas;

const server = await preview({ preview: { port: 4311, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4311/";
const browser = await launch();
const slowBrowser = await launchSlow();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed", 15000);
  await nextFrame(page);
}

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
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport canvas") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}
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

/** The toolbar's STL's enclosed volume (mm³, the sum over triangles of the signed tetrahedra to the origin). */
async function stlVolume(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  let volume = 0;
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}
async function volumeIs(page, tap, want, what) {
  const got = await stlVolume(page, tap);
  assert.ok(Math.abs(got - want) <= 0.05, `${what}: volume ${got}, want ${want}`);
}

const box = (n, label, [w, d, h]) => ({
  dependsOn: [],
  id: `feature-${n}`,
  intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" },
  provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } },
  suppressed: false,
});
const move = (n, of, label, moveLabel, [x, y, z]) => ({
  dependsOn: [of],
  id: `feature-${n}`,
  intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move ${label} by (${x}, ${y}, ${z}) mm`, type: "move" },
  provenance: { from: [{ id: of, label, workspace: "design" }], self: { id: `feature-${n}`, label: moveLabel, workspace: "design" } },
  suppressed: false,
});
/** Box 1 (feature-1), Box 2 (feature-2) moved by `shift` (feature-3), Box 3 (feature-4) moved (100, 0, 0) (feature-5). */
const design = (box2, shift) => {
  const features = [box(1, "Box 1", [40, 30, 20]), box(2, "Box 2", box2), move(3, "feature-2", "Box 2", "Move 1", shift), box(4, "Box 3", [10, 10, 10]), move(5, "feature-4", "Box 3", "Move 2", [100, 0, 0])];
  return { formatVersion: 2, links: [], materials: [], name: "Combine history check", units: { length: "mm" }, workspaces: { design: { nextId: 6, profiles: [], sketches: [], version: 4, timeline: { features } } } };
};
const ITEMS = ["feature-1", "feature-2", "feature-3", "feature-4", "feature-5"];
// Check 1: Box 2 a slab through Box 1 (x 15..25, y −5..35, z −5..25).
const SPLIT = design([10, 40, 30], [15, -5, -5]);
// Check 2: combine.mjs's bodies.
const OVERLAP = design([40, 30, 20], [20, 15, 10]);
// Where each box's top shows in the top view, clear of the others.
const TOP1 = [5, 5, 20];
const SLAB_TOP = [20, 30, 25];
const TOP2 = [50, 40, 30];
const TOP3 = [105, 5, 10];
const CHANGED = "The bodies or choices changed while the Combine was checked: nothing was changed. Press OK again.";

async function fresh(on, width, height, tap, project) {
  const context = await on.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "combine.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open", 15000);
  await rebuilt(page);
  return page;
}

const opened = (page) => until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel open");
const closed = (page) => until(page, () => document.getElementById("combine-panel")?.hidden === true, null, "the Combine panel closed", 20000);
const fields = (page, want, what) =>
  until(page, (w) => [document.getElementById("combine-target-names")?.textContent, document.getElementById("combine-tools-names")?.textContent].join(" | ") === w, want, what);
const items = (page) => page.$$eval("#timeline li[data-item]", (l) => l.map((li) => li.dataset.item));
// What Undo says of the project's steps: with a tool open its title says it cancels the tool (issue #520).
const undoTitle = (page) => page.getAttribute("#undo", "data-project-step");
/** The Body rows: each row's node and name. */
async function bodyRows(page) {
  await page.evaluate(() => document.querySelector('#browser [data-node="bodies"]')?.closest("details")?.setAttribute("open", ""));
  return page.$$eval('#browser [data-node="bodies"] .tree-row', (rows) => rows.map((r) => `${r.dataset.node} ${r.textContent.trim()}`));
}

/** The top view, then Combine from Modify ▾ with the target and tools picked and the operation chosen. */
async function picked(page, tap, target, tools, operation) {
  await closePanels(page, tap);
  await press(page, '[data-view="top"]', tap);
  await settle(page);
  await page.evaluate(() => document.activeElement?.blur());
  await press(page, "#modify-menu", tap);
  await press(page, "#modify-menu-combine", tap);
  await opened(page);
  await at(page, target, tap);
  for (const t of tools) await at(page, t, tap);
  await openPanel(page, "properties", tap);
  await page.selectOption("#combine-operation", operation);
}
/** OK pressed; resolves once the kernel is checking (OK busy). */
async function okBusy(page) {
  await page.click("#combine-ok");
  await until(page, () => document.getElementById("combine-ok")?.dataset.busy === "1", null, "OK busy while the kernel checks", 5000);
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
    await check(`${width} px${tap ? ", taps" : ""}: a Cut that splits Box 1 in two lists both halves as Body rows straight after OK`, async () => {
      const page = await fresh(browser, width, height, tap, SPLIT);
      try {
        assert.deepEqual(await bodyRows(page), ["body-1 Body 1", "body-2 Body 2", "body-3 Body 3"], "as made");
        await picked(page, tap, TOP1, [SLAB_TOP], "cut");
        await fields(page, "Body 1 | Body 2", "Box 1 the target, the slab the tool");
        await press(page, "#combine-ok", tap);
        await closed(page);
        await rebuilt(page);
        // Box 2 used up; Body 1 keeps one half, the other half is the next number, Body 4 (Box 3 is Body 3).
        await until(page, () => document.querySelectorAll('#browser [data-node="bodies"] .tree-row').length === 3, null, "three Body rows", 5000).catch(() => {});
        assert.deepEqual((await bodyRows(page)).sort(), ["body-1 Body 1", "body-3 Body 3", "body-4 Body 4"], "both halves have rows at once");
        if (shots) await page.screenshot({ path: `${shots}/combine-history-${width}-split.png` });
        await volumeIs(page, tap, 19000, "the halves 9,000 + 9,000 and Box 3's 1,000");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("1280 px, slow kernel: the operation switched to Join after OK records nothing and says so; OK again joins", async () => {
    const page = await fresh(slowBrowser, 1280, 800, false, OVERLAP);
    try {
      await picked(page, false, TOP1, [TOP2], "cut");
      await fields(page, "Body 1 | Body 2", "Box 1 and Box 2");
      await okBusy(page);
      await page.selectOption("#combine-operation", "join");
      await until(page, (w) => document.getElementById("combine-error")?.hidden === false && document.getElementById("combine-error").textContent === w, CHANGED, "the changed choice said", 20000);
      assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), false, "the panel stays open");
      if (shots) await page.screenshot({ path: `${shots}/combine-history-1280-changed.png` });
      assert.equal(await undoTitle(page), "Nothing to undo", "nothing recorded");
      assert.deepEqual(await items(page), ITEMS, "no Combine in the timeline");
      await page.click("#combine-ok");
      await closed(page);
      await rebuilt(page);
      assert.equal(await undoTitle(page), "Undo Combine bodies (Ctrl+Z)");
      assert.deepEqual(await items(page), [...ITEMS, "feature-6"]);
      await volumeIs(page, false, 46000, "Box 2 joined to Box 1, Box 3 kept");
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px, slow kernel: a tool clicked out after OK records nothing and says so; OK again cuts only the tool left", async () => {
    const page = await fresh(slowBrowser, 1280, 800, false, OVERLAP);
    try {
      await picked(page, false, TOP1, [TOP2, TOP3], "cut");
      await fields(page, "Body 1 | Body 2, Body 3", "Box 1, then Box 2 and Box 3");
      await volumeIs(page, false, 49000, "as made");
      await okBusy(page);
      await at(page, TOP3);
      await fields(page, "Body 1 | Body 2", "Box 3 taken out");
      await until(page, (w) => document.getElementById("combine-error")?.hidden === false && document.getElementById("combine-error").textContent === w, CHANGED, "the changed choice said", 20000);
      assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), false, "the panel stays open");
      assert.equal(await undoTitle(page), "Nothing to undo", "nothing recorded");
      assert.deepEqual(await items(page), ITEMS, "no Combine in the timeline");
      await volumeIs(page, false, 49000, "still as made");
      await page.click("#combine-ok");
      await closed(page);
      await rebuilt(page);
      assert.equal(await undoTitle(page), "Undo Combine bodies (Ctrl+Z)");
      assert.deepEqual(await items(page), [...ITEMS, "feature-6"]);
      await volumeIs(page, false, 22000, "only Box 2 cut: 21,000 + Box 3's 1,000");
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  await slowBrowser.close();
  server.httpServer.close();
}

if (errors.length) {
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
  failed++;
}
if (failed) process.exit(1);
