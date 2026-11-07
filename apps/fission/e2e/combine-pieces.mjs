// Browser check of a Combine's pieces kept by their faces (hunt 11-06), with
// `?combine`. Box 1 is a bar 100 × 20 × 10; Box 2 and Box 3 are slots
// 10 × 40 × 20, Move 1 putting Box 2 at x 20..30 and Move 2 Box 3 at
// x 50..60 (y −10..30, z −5..15). Combine 1 cuts the bar with both: near
// x 0..20 keeps Body 1's id (4,000 mm³), the far piece x 60..100 (8,000) is
// piece 1, Body 4, and the middle x 30..50 (4,000) piece 2, Body 5. Box 4
// 10 × 10 × 10, Move 3 at (95, 5, 5), is joined to piece 1 by Combine 2:
// 8,000 + 1,000 − 250 (overlap x 95..100, y 5..15, z 5..10) = 8,750. The
// file holds each piece's faces as the app saves them. As opened the STL
// holds 4,000 + 4,000 + 8,750 = 16,750 mm³.
// 1. Move 2 edited to x 80: middle x 30..80 (10,000), far x 90..100
//    (2,000). By rank the middle is first now, but piece 1 stays on the far
//    piece by its faces, still joined with Box 4: 4,000 + 10,000 + 2,750 =
//    16,750, no warning (on the middle piece it would be 17,000).
// 2. Move 2 edited to (50, 5): the slot only notches the bar, which is in two
//    pieces, near and the rest (x 30..100 less x 50..60, y 5..20:
//    14,000 − 1,500 = 12,500); no piece has piece 1's faces, so piece 1 goes
//    to the rest by rank, joined with Box 4 (13,250), and Combine 1 warns:
//    4,000 + 13,250 = 17,250.
// 3. Combine 1 edited, Keep tools on: the person confirms the pieces, the
//    warning goes, and the slots stay as bodies: 17,250 + 2 · 8,000 =
//    33,250. Edited again, Keep tools off: 17,250, still no warning.
// 1280 px with a mouse and 375 px with taps. Screenshots go to E2E_SHOTS when
// set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels } from "./start.mjs";

const server = await preview({ preview: { port: 4328, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4328/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed", 15000);
  await nextFrame(page);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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

// Made by Design's own functions and saved as the app saves it (version 12: each piece's faces).
const DESIGN = {"version": 12, "nextId": 10, "profiles": [], "sketches": [], "timeline": {"features": [{"id": "feature-1", "intent": {"type": "box", "parameters": {"width": 100, "depth": 20, "height": 10}, "summary": "Box: 100 \u00d7 20 \u00d7 10 mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-1", "label": "Box 1"}, "from": []}, "dependsOn": [], "suppressed": false}, {"id": "feature-2", "intent": {"type": "box", "parameters": {"width": 10, "depth": 40, "height": 20}, "summary": "Box: 10 \u00d7 40 \u00d7 20 mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-2", "label": "Box 2"}, "from": []}, "dependsOn": [], "suppressed": false}, {"id": "feature-3", "intent": {"type": "move", "parameters": {"x": 20, "y": -10, "z": -5, "turnX": 0, "turnY": 0, "turnZ": 0, "pivotX": 0, "pivotY": 0, "pivotZ": 0, "bodies": ["body:feature-2"]}, "summary": "Move Box 2 by (20, -10, -5) mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-3", "label": "Move 1"}, "from": [{"workspace": "design", "id": "feature-2", "label": "Box 2"}]}, "dependsOn": ["feature-2"], "suppressed": false}, {"id": "feature-4", "intent": {"type": "box", "parameters": {"width": 10, "depth": 40, "height": 20}, "summary": "Box: 10 \u00d7 40 \u00d7 20 mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-4", "label": "Box 3"}, "from": []}, "dependsOn": [], "suppressed": false}, {"id": "feature-5", "intent": {"type": "move", "parameters": {"x": 50, "y": -10, "z": -5, "turnX": 0, "turnY": 0, "turnZ": 0, "pivotX": 0, "pivotY": 0, "pivotZ": 0, "bodies": ["body:feature-4"]}, "summary": "Move Box 3 by (50, -10, -5) mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-5", "label": "Move 2"}, "from": [{"workspace": "design", "id": "feature-4", "label": "Box 3"}]}, "dependsOn": ["feature-4"], "suppressed": false}, {"id": "feature-6", "intent": {"type": "combine", "parameters": {"target": "body:feature-1", "tools": ["body:feature-2", "body:feature-4"], "operation": "cut", "keepTools": false}, "summary": "Cut Box 2 and Box 3 from Box 1"}, "dependsOn": ["feature-1", "feature-2", "feature-4"], "provenance": {"self": {"workspace": "design", "id": "feature-6", "label": "Combine 1"}, "from": [{"workspace": "design", "id": "feature-1", "label": "Box 1"}, {"workspace": "design", "id": "feature-2", "label": "Box 2"}, {"workspace": "design", "id": "feature-4", "label": "Box 3"}]}, "suppressed": false}, {"id": "feature-7", "intent": {"type": "box", "parameters": {"width": 10, "depth": 10, "height": 10}, "summary": "Box: 10 \u00d7 10 \u00d7 10 mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-7", "label": "Box 4"}, "from": []}, "dependsOn": [], "suppressed": false}, {"id": "feature-8", "intent": {"type": "move", "parameters": {"x": 95, "y": 5, "z": 5, "turnX": 0, "turnY": 0, "turnZ": 0, "pivotX": 0, "pivotY": 0, "pivotZ": 0, "bodies": ["body:feature-7"]}, "summary": "Move Box 4 by (95, 5, 5) mm"}, "provenance": {"self": {"workspace": "design", "id": "feature-8", "label": "Move 3"}, "from": [{"workspace": "design", "id": "feature-7", "label": "Box 4"}]}, "dependsOn": ["feature-7"], "suppressed": false}, {"id": "feature-9", "intent": {"type": "combine", "parameters": {"target": "body:feature-6/piece:1", "tools": ["body:feature-7"], "operation": "join", "keepTools": false}, "summary": "Join Box 4 to a piece of Combine 1"}, "dependsOn": ["feature-6", "feature-7"], "provenance": {"self": {"workspace": "design", "id": "feature-9", "label": "Combine 2"}, "from": [{"workspace": "design", "id": "feature-6", "label": "Combine 1"}, {"workspace": "design", "id": "feature-7", "label": "Box 4"}]}, "suppressed": false}]}, "bodies": [{"id": "body:feature-1", "number": 1}, {"id": "body:feature-2", "number": 2}, {"id": "body:feature-4", "number": 3}, {"id": "body:feature-6/piece:1", "number": 4, "faces": ["face:feature-1/back", "face:feature-1/bottom", "face:feature-1/front", "face:feature-1/right", "face:feature-1/top", "face:feature-4/right"]}, {"id": "body:feature-6/piece:2", "number": 5, "faces": ["face:feature-1/back", "face:feature-1/bottom", "face:feature-1/front", "face:feature-1/top", "face:feature-2/right", "face:feature-4/left"]}, {"id": "body:feature-7", "number": 6}], "nextBody": 7};
const PROJECT = { formatVersion: 2, links: [], materials: [], name: "Combine pieces check", units: { length: "mm" }, workspaces: { design: DESIGN } };
const ITEMS = DESIGN.timeline.features.map((f) => f.id);
const WORDS = "Combine 1's pieces changed since they were numbered, so Body 4 may now be another piece: check the items that use it, then edit Combine 1 to keep its pieces as they are now.";

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "pieces.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(PROJECT)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open", 15000);
  await rebuilt(page);
  return page;
}

/** Item `id`'s Edit feature, from its timeline item's menu (right-click, or its ⋯ on a phone), until `panel` opens. */
async function edit(page, id, panel, tap) {
  await closePanels(page, tap);
  const item = page.locator(`#timeline [data-item="${id}"]`);
  if (tap) {
    if (!(await page.isVisible(`#timeline [data-more="${id}"]`))) await item.tap();
    await page.tap(`#timeline [data-more="${id}"]`);
  } else await item.click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, `${id}'s menu`);
  await press(page, "#row-menu-edit", tap);
  await until(page, (p) => document.getElementById(p)?.hidden === false, panel, `the ${panel} open`);
}
const shut = (page, panel) => until(page, (p) => document.getElementById(p)?.hidden === true, panel, `the ${panel} closed`, 20000);
/** Move 2 (feature-5) set to (x, y, −5) through its panel. */
async function moveSlot(page, tap, x, y) {
  await edit(page, "feature-5", "move-panel", tap);
  await page.fill("#move-x", String(x));
  await page.fill("#move-y", String(y));
  await press(page, "#move-ok", tap);
  await shut(page, "move-panel");
  await rebuilt(page);
}
/** Combine 1 (feature-6) with Keep tools set to `keep` through its panel. */
async function keepTools(page, tap, keep) {
  await edit(page, "feature-6", "combine-panel", tap);
  if ((await page.$eval("#combine-keep", (c) => c.checked)) !== keep) await press(page, "#combine-keep", tap);
  await press(page, "#combine-ok", tap);
  await shut(page, "combine-panel");
  await rebuilt(page);
}
/** The warning shown, and Combine 1's browser row's and timeline item's words and marks. */
const warned = (page) =>
  page.evaluate(() => {
    const w = document.getElementById("kept-warning");
    const row = [...document.querySelectorAll("#browser .tree-row")].find((r) => r.dataset.node === "feature-6");
    return { panel: w.hidden ? null : w.textContent, row: row?.classList.contains("kept") ? row.title : null };
  });

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
    await check(`${width} px${tap ? ", taps" : ""}: Combine 2 stays on the far piece when a slot moves; a piece no longer there is warned about, and editing Combine 1 confirms it`, async () => {
      const page = await fresh(width, height, tap);
      try {
        assert.deepEqual(await warned(page), { panel: null, row: null }, "as opened");
        await volumeIs(page, tap, 16750, "as opened");
        await moveSlot(page, tap, 80, -10);
        assert.deepEqual(await warned(page), { panel: null, row: null }, "slot at 80");
        await volumeIs(page, tap, 16750, "slot at 80: Box 4 still joined to the far piece (17,000 on the middle one)");
        await moveSlot(page, tap, 50, 5);
        assert.deepEqual(await warned(page), { panel: WORDS, row: WORDS }, "slot notching the bar");
        if (shots) await page.screenshot({ path: `${shots}/combine-pieces-${width}-warned.png` });
        await volumeIs(page, tap, 17250, "slot notching: the rest joined with Box 4");
        await keepTools(page, tap, true);
        assert.deepEqual(await warned(page), { panel: null, row: null }, "Combine 1 edited: confirmed");
        await volumeIs(page, tap, 33250, "the slots kept as bodies");
        await keepTools(page, tap, false);
        assert.deepEqual(await warned(page), { panel: null, row: null }, "Combine 1 edited back");
        await volumeIs(page, tap, 17250, "as before the edits of Combine 1");
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
