// Browser check (SL #583 item 1, Combine break-it hunt 4): a Cut or Join
// whose new wall lies level with a wall an earlier Cut made is no false
// "removes nothing". The kernel lists the tool among the merged face's
// other origins (`also`), which the app's kernel client used to drop, so
// the app never saw the tool reach the body. With `?combine`, 1280 px.
// Worked by hand: Box 1 30 × 20 × 10 at the origin (6,000 mm³); Box 2
// 10 × 10 × 20 moved (20, 0, −5), x 20..30 y 0..10 z −5..15, through Box 1;
// Combine 1 (in the file) cuts it: the notch is 10 × 10 × 10 = 1,000, so
// Body 1 is 5,000, with a wall at x = 20 for y 0..10.
// 1. Box 3 10 × 10 × 20 moved (20, 10, −5) cut from Body 1 with the panel:
//    no question, recorded at once; 5,000 − 1,000 = 4,000 mm³; its new
//    wall at x = 20, y 10..20 merges with Combine 1's into one face; no
//    warning.
// 2. The same second notch as an Extrude Cut (a square x 20..30 y 10..20
//    on XY, 10 up, cut from Box 1), opened from a file: 4,000, no warning.
// 3. An Extrude Join filling Combine 1's notch (the square x 20..30
//    y 0..10, 10 up): 5,000 + 1,000 = 6,000, one body, no warning; every
//    face round the notch merges with Box 1's.
// Each fails on the client that drops `also` (the question opens, and the
// rows warn "removes nothing", "cuts nothing" or "adds nothing").
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4357, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4357/";
const browser = await launch();
const errors = [];
const T = 30000;
let failed = 0;

const until = (page, fn, arg, what, timeout = T) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function rebuilt(page) {
  await page.waitForTimeout(150);
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** A binary STL's enclosed volume: the signed tetrahedra to the origin, a · (b × c) / 6, summed. */
function stlVolume(bytes) {
  let volume = 0;
  const n = bytes.readUInt32LE(80);
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.round(volume * 1000) / 1000;
}
async function toolbarStl(page) {
  const coming = page.waitForEvent("download", { timeout: 15000 });
  await page.click("#toolbar [data-op=export_stl]");
  return stlVolume(readFileSync(await (await coming).path()));
}

const box = (n, [w, d, h]) => ({ dependsOn: [], id: `feature-${n}`, intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" }, provenance: { from: [], self: { id: `feature-${n}`, label: `Box ${n}`, workspace: "design" } }, suppressed: false });
const move = (id, of, [x, y, z], name) => ({ dependsOn: [of], id, intent: { parameters: { bodies: [`body:${of}`], pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move by (${x}, ${y}, ${z}) mm`, type: "move" }, provenance: { from: [{ id: of, label: `Box ${of.slice(8)}`, workspace: "design" }], self: { id, label: name, workspace: "design" } }, suppressed: false });
const combine1 = { dependsOn: ["feature-1", "feature-2"], id: "feature-20", intent: { parameters: { target: "body:feature-1", tools: ["body:feature-2"], operation: "cut", keepTools: false }, summary: "Cut Box 2 from Box 1", type: "combine" }, provenance: { from: [{ id: "feature-1", label: "Box 1", workspace: "design" }, { id: "feature-2", label: "Box 2", workspace: "design" }], self: { id: "feature-20", label: "Combine 1", workspace: "design" } }, suppressed: false };
/** A square x0..x1 by y0..y1 on XY extruded 10 up, joined to or cut from Box 1: its sketch and the extrude. */
function squareExtrude([x0, y0, x1, y1], operation) {
  const p = (i) => `point-${30 + i}`;
  const l = (i) => `line-${35 + i}`;
  const sketch = { constraints: [], curves: [0, 1, 2, 3].map((i) => ({ end: p((i + 1) % 4), id: l(i), kind: "line", start: p(i) })), id: "sketch-21", points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y], i) => ({ id: p(i), x, y })) };
  const item = { dependsOn: [], id: "sketch-21", intent: { parameters: { plane: "XY" }, summary: "Sketch 1 on the XY plane", type: "sketch" }, provenance: { from: [], self: { id: "sketch-21", label: "Sketch 1", workspace: "design" } }, suppressed: false };
  const extrude = { dependsOn: ["sketch-21", "feature-1"], id: "feature-22", intent: { parameters: { bodies: ["body:feature-1"], operation, distance: 10, region: { centroid: [(x0 + x1) / 2, (y0 + y1) / 2], outer: [0, 1, 2, 3].map((i) => ({ curve: l(i), reversed: false })) }, sketch: "sketch-21" }, summary: `Extrude Sketch 1 by 10 mm, ${operation} ${operation === "cut" ? "from" : "to"} Box 1`, type: "extrude" }, provenance: { from: [{ id: "sketch-21", label: "Sketch 1", workspace: "design" }, { id: "feature-1", label: "Box 1", workspace: "design" }], self: { id: "feature-22", label: "Extrude 1", workspace: "design" } }, suppressed: false };
  return { sketch, items: [item, extrude] };
}
/** Box 1, Box 2 moved through it, Combine 1 cutting it; then `more` items (and sketches). */
function design(more = [], sketches = []) {
  const features = [box(1, [30, 20, 10]), box(2, [10, 10, 20]), move("feature-10", "feature-2", [20, 0, -5], "Move 1"), combine1, ...more];
  return { formatVersion: 2, links: [], materials: [], name: "level-walls", units: { length: "mm" }, workspaces: { design: { nextId: 50, profiles: [], sketches, version: 16, ...(sketches.length > 0 && { hidden: sketches.map((s) => s.id) }), timeline: { features } } } };
}

async function fresh(project) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(T);
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  const ids = project.workspaces.design.timeline.features.map((f) => f.id);
  await page.setInputFiles("#open-file", { name: "level-walls.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ids, "the file opened").catch(async (e) => {
    throw new Error(`${e.message}: ${await page.evaluate(() => document.body.innerText.match(/.*(refus|can't|cannot|not ).*/gi)?.slice(0, 3).join(" | "))}`);
  });
  await rebuilt(page);
  return page;
}
const bodyRows = (page) => page.$$eval('#browser [data-node="bodies"] .tree-row', (rows) => rows.filter((r) => r.dataset.node !== "bodies").map((r) => r.textContent.trim()));
/** Every timeline row that warns or fails, with its words. */
const warned = (page) => page.$$eval("#timeline li[data-item]", (lis) => lis.filter((li) => li.dataset.failed !== undefined || li.dataset.warned !== undefined).map((li) => `${li.dataset.item}: ${li.getAttribute("title") ?? ""}`));
async function pickRow(page, text) {
  await page.evaluate(() => document.querySelector('#browser details[data-node="bodies"]')?.setAttribute("open", ""));
  await page.locator('#browser [data-node="bodies"] .tree-row', { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${String(e.message ?? e).split("\n").join("\n  ")}`);
  }
}

try {
  await check("a Combine Cut whose new wall lies level with Combine 1's asks nothing: 4,000 mm³, no warning", async () => {
    const page = await fresh(design([box(3, [10, 10, 20]), move("feature-11", "feature-3", [20, 10, -5], "Move 2")]));
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 3"]);
    await page.evaluate(() => document.getElementById("modify-menu").click());
    await page.evaluate(() => document.getElementById("modify-menu-combine").click());
    await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel opened");
    for (const row of ["Body 1", "Body 3"]) await pickRow(page, row);
    await page.selectOption("#combine-operation", "cut");
    await page.evaluate(() => document.getElementById("combine-ok").click());
    // Recorded at once: Combine 2 on the timeline, the question never opened.
    await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 7, null, "Combine 2 recorded with no question");
    assert.equal(await page.evaluate(() => document.getElementById("cut-ask")?.open ?? false), false, "no question");
    await rebuilt(page);
    assert.equal(await toolbarStl(page), 4000);
    assert.deepEqual(await warned(page), []);
    await page.context().close();
  });
  await check("an Extrude Cut of the second notch, level with Combine 1's wall: 4,000 mm³, no warning", async () => {
    const { sketch, items } = squareExtrude([20, 10, 30, 20], "cut");
    const page = await fresh(design(items, [sketch]));
    assert.equal(await toolbarStl(page), 4000);
    assert.deepEqual(await warned(page), []);
    await page.context().close();
  });
  await check("an Extrude Join filling Combine 1's notch: 6,000 mm³ in one body, no warning", async () => {
    const { sketch, items } = squareExtrude([20, 0, 30, 10], "join");
    const page = await fresh(design(items, [sketch]));
    assert.equal(await toolbarStl(page), 6000);
    assert.deepEqual(await bodyRows(page), ["Body 1"]);
    assert.deepEqual(await warned(page), []);
    await page.context().close();
  });
  await check("no errors on the page", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) {
  console.log(`${failed} combine-level-walls check(s) failed`);
  process.exit(1);
}
console.log("combine-level-walls: all checks passed");
