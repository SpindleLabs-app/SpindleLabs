// Browser check of which bodies a design with Combines has (Combine check
// 2026-11-11, #499, #500, #501), with `?combine`, at 1280 px with a mouse:
// the Bodies rows, the Body panel and the exported STL agree with what is
// drawn. Volumes and bounds are read from the toolbar's STL and worked by hand.
// 1. A piece used as the next Combine's tool (#499). Box 1 a bar
//    100 × 20 × 10; Box 2 a slot 10 × 40 × 20 moved (45, −10, −5); Box 3 a
//    plate 20 × 60 × 4 moved (70, −20, 3), so x 70..90, y −20..40, z 3..7 =
//    4,800 mm³. Combine 1 cuts the slot from the bar: x 0..45 keeps Body 1
//    (45 · 20 · 10 = 9,000) and x 55..100 is a new piece, Body 4 (9,000):
//    22,800 in rows Body 1, Body 3, Body 4. Combine 2 cuts Body 4 (y 0..20)
//    from the plate, which is left as y −20..0 and y 20..40, each
//    20 · 20 · 4 = 1,600; Body 4 is used up: 9,000 + 1,600 + 1,600 = 12,200
//    in three rows (Body 1, Body 3, Body 5), y from −20 to 40. Keeping the
//    tools: four rows, 21,200.
// 2. The second new piece of one Combine (#501). The bar cut by slots at
//    x 45..55 and x 80..90 in one Combine: Body 1 x 0..45 = 9,000, Body 4
//    x 55..80 = 25 · 20 · 10 = 5,000, Body 5 x 90..100 = 2,000. Each row
//    selected, the Body panel shows that body's own volume.
// 3. A Combine that fails after an edit (#500). Box 1 40 × 30 × 20; Box 2
//    the same moved (20, 15, 10); Box 3 10 × 10 × 10 moved (100, 0, 0).
//    Intersect Box 1 with Box 2: 20 · 15 · 10 = 3,000, plus Box 3's 1,000 =
//    4,000. Move 1 edited to x 200: the boxes are apart, the Combine fails
//    and uses up nothing, so three rows and an STL of 24,000 + 24,000 +
//    1,000 = 49,000, from the toolbar and from File > Export STL.
// 4. Undo pressed right after Combine's OK (#503), while the kernel still
//    checks it: the Undo waits and takes back that OK, as for Move and
//    Extrude, never the step before. Scene 3's boxes (49,000 as opened).
//    a. Move 2 edited to y 3 (step 1), then a new Combine cutting Box 2 from
//       Box 1, OK and Ctrl+Z at once: the Combine is taken back and the Move
//       edit kept (49,000, Box 3 at y 3..13, Undo "Edit Move 2", Redo
//       "Combine bodies"); Redo makes the Cut, 24,000 − 3,000 + 1,000 =
//       22,000.
//    b. That Combine edited to Intersect, OK and Ctrl+Z at once: the Cut
//       again (22,000), Redo "Edit Combine 1"; Redo gives 3,000 + 1,000.
// 5. Insert > Box pressed right after Combine's OK (#677 item 4), while the
//    kernel still checks it: the Insert waits, so both are made. Scene 3's
//    boxes; the Cut of Box 2 from Box 1 leaves 24,000 − 3,000 = 21,000,
//    with Box 3's 1,000 and the new 40 × 30 × 20 box's 24,000: 46,000.
// 6. A round tool (#677 item 1): Insert > Cylinder, then Combine cutting it
//    from Box 1 is refused in the app's words, naming the round body.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4298, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4298/";
const browser = await launch();
const errors = [];
const T = 30000;

const until = (page, fn, arg, what, timeout = T) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function rebuilt(page) {
  await page.waitForTimeout(150);
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** A binary STL's triangle count, enclosed volume (the signed tetrahedra to the origin, a · (b × c) / 6, summed) and bounds. */
function parseStl(bytes) {
  let volume = 0;
  const pts = [];
  const n = bytes.readUInt32LE(80);
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    pts.push(a, b, c);
  }
  const r = (x) => Math.round(x * 1000) / 1000;
  return { volume: r(volume), bounds: [0, 1, 2].map((i) => [r(Math.min(...pts.map((p) => p[i]))), r(Math.max(...pts.map((p) => p[i])))]) };
}
/** The download a press starts, read as an STL; fails with what the panel says when none comes. */
async function stlFrom(page, press, what) {
  const coming = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await press();
  const download = await coming;
  if (download === null) assert.fail(`${what} gave no file; the panel says: ${await page.evaluate(() => document.querySelector("#properties")?.innerText.replace(/\s+/g, " ").slice(-200))}`);
  return parseStl(readFileSync(await download.path()));
}
const toolbarStl = (page) => stlFrom(page, () => page.click("#toolbar [data-op=export_stl]"), "the toolbar's STL");

const box = (n, [w, d, h], label) => ({ dependsOn: [], id: `feature-${n}`, intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" }, provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } }, suppressed: false });
const move = (n, of, label, [x, y, z], name) => ({ dependsOn: [of], id: `feature-${n}`, intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move ${label} by (${x}, ${y}, ${z}) mm`, type: "move", bodies: [`body:${of}`] }, provenance: { from: [{ id: of, label, workspace: "design" }], self: { id: `feature-${n}`, label: name, workspace: "design" } }, suppressed: false });
/** A project of boxes, each [size, where it is moved to or null]: Box k makes Body k. */
function design(boxes) {
  const features = [];
  let n = 1;
  let moves = 1;
  boxes.forEach(([size, to], k) => {
    const id = n;
    features.push(box(n++, size, `Box ${k + 1}`));
    if (to) features.push(move(n++, `feature-${id}`, `Box ${k + 1}`, to, `Move ${moves++}`));
  });
  return { formatVersion: 2, links: [], materials: [], name: "check", units: { length: "mm" }, workspaces: { design: { nextId: n, profiles: [], sketches: [], version: 4, timeline: { features } } } };
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
  await page.setInputFiles("#open-file", { name: "check.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ids, "the file opened");
  await rebuilt(page);
  return page;
}
const bodyRows = (page) => page.$$eval('#browser [data-node="bodies"] .tree-row', (rows) => rows.filter((r) => r.dataset.node !== "bodies").map((r) => r.textContent.trim()));
async function clickRow(page, text) {
  await page.evaluate(() => document.querySelector('#browser details[data-node="bodies"]')?.setAttribute("open", ""));
  await page.locator('#browser [data-node="bodies"] .tree-row', { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
}
/** Modify ▾ > Combine, the target and tools picked by their Bodies rows, OK (unless `ok` is false: the panel is left ready); fails with the panel's words when it is refused. */
async function combine(page, target, tools, operation, keep = false, ok = true) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.click("#modify-menu");
  await page.click("#modify-menu-combine");
  await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel opened");
  for (const row of [target, ...tools]) await clickRow(page, row);
  await page.selectOption("#combine-operation", operation);
  if (keep) await page.check("#combine-keep");
  if (!ok) return;
  await page.click("#combine-ok");
  await until(page, () => document.getElementById("combine-panel").hidden || !document.getElementById("combine-error").hidden, null, "OK answered");
  assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), true, `the Combine was refused: ${await page.$eval("#combine-error", (e) => e.textContent)}`);
  await rebuilt(page);
}

try {
  // 1. A piece used as the next Combine's tool.
  for (const keep of [false, true]) {
    const page = await fresh(design([[[100, 20, 10], null], [[10, 40, 20], [45, -10, -5]], [[20, 60, 4], [70, -20, 3]]]));
    await combine(page, "Body 1", ["Body 2"], "cut");
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 3", "Body 4"]);
    assert.equal((await toolbarStl(page)).volume, 9000 + 9000 + 4800);
    await combine(page, "Body 3", ["Body 4"], "cut", keep);
    assert.deepEqual(await bodyRows(page), keep ? ["Body 1", "Body 3", "Body 4", "Body 5"] : ["Body 1", "Body 3", "Body 5"], `keep tools ${keep}: the Bodies rows`);
    const made = await toolbarStl(page);
    assert.equal(made.volume, 9000 + 1600 + 1600 + (keep ? 9000 : 0), `keep tools ${keep}: the STL's volume`);
    assert.deepEqual(made.bounds, [[0, keep ? 100 : 90], [-20, 40], [0, 10]], `keep tools ${keep}: the STL's bounds`);
    await page.context().close();
  }

  // 2. The second new piece of one Combine.
  {
    const page = await fresh(design([[[100, 20, 10], null], [[10, 40, 20], [45, -10, -5]], [[10, 40, 20], [80, -10, -5]]]));
    await combine(page, "Body 1", ["Body 2", "Body 3"], "cut");
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 4", "Body 5"]);
    assert.equal((await toolbarStl(page)).volume, 9000 + 5000 + 2000);
    for (const [row, volume] of [["Body 1", "9,000 mm³"], ["Body 4", "5,000 mm³"], ["Body 5", "2,000 mm³"]]) {
      await page.keyboard.press("Escape");
      await clickRow(page, row);
      await until(page, (v) => document.getElementById("volume")?.textContent === v, volume, `${row} selected: the Body panel shows ${volume}, not ${await page.$eval("#volume", (e) => e.textContent).catch(() => "nothing")}`, 10000);
    }
    await page.context().close();
  }

  // 3. A Combine that fails after an edit uses up nothing.
  {
    const page = await fresh(design([[[40, 30, 20], null], [[40, 30, 20], [20, 15, 10]], [[10, 10, 10], [100, 0, 0]]]));
    await combine(page, "Body 1", ["Body 2"], "intersect");
    assert.equal((await toolbarStl(page)).volume, 3000 + 1000);
    await page.click('#timeline [data-item="feature-3"]', { button: "right" });
    await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
    await page.click("#row-menu-edit");
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel opened");
    await page.fill("#move-x", "200");
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel").hidden, null, "the Move edit was taken");
    await rebuilt(page);
    assert.equal(await page.$eval('#timeline [data-item="feature-6"]', (li) => li.dataset.failed !== undefined), true, "Combine 1 fails with its bodies apart");
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 2", "Body 3"]);
    const all = await toolbarStl(page);
    assert.equal(all.volume, 24000 + 24000 + 1000);
    assert.deepEqual(all.bounds, [[0, 240], [0, 45], [0, 30]]);
    const menu = await stlFrom(page, async () => { await page.click("#file-menu"); await page.click("#file-export-stl"); }, "File > Export STL");
    assert.equal(menu.volume, 49000);
    await page.context().close();
  }
  // 4. Undo pressed right after Combine's OK.
  {
    const page = await fresh(design([[[40, 30, 20], null], [[40, 30, 20], [20, 15, 10]], [[10, 10, 10], [100, 0, 0]]]));
    const editItem = async (id, panel) => {
      await page.click(`#timeline [data-item="${id}"]`, { button: "right" });
      await until(page, () => document.getElementById("row-menu").open, null, `${id}'s menu`);
      await page.click("#row-menu-edit");
      await until(page, (p) => document.getElementById(p)?.hidden === false, panel, `${panel} opened`);
    };
    const buttons = () => page.evaluate(() => ["undo", "redo"].map((id) => document.getElementById(id).title));
    /** OK pressed and, with nothing between, Ctrl+Z; then everything settled. */
    const okThenUndo = async () => {
      await page.click("#combine-ok");
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(3000);
      await rebuilt(page);
    };
    await editItem("feature-5", "move-panel");
    await page.fill("#move-y", "3");
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel").hidden, null, "the Move edit was taken");
    await rebuilt(page);
    await page.waitForTimeout(1100); // past the history's merging of quick steps
    // a. A new Combine.
    await combine(page, "Body 1", ["Body 2"], "cut", false, false);
    await okThenUndo();
    assert.deepEqual(await buttons(), ["Undo Edit Move 2 (Ctrl+Z)", "Redo Combine bodies (Ctrl+Shift+Z)"], "a: the Combine was taken back, not Move 2's edit");
    let now = await toolbarStl(page);
    assert.equal(now.volume, 49000);
    assert.deepEqual(now.bounds[1], [0, 45], "Box 2 reaches y 45; Box 3 at y 3..13 is inside that");
    assert.equal(await page.$$eval("#timeline li[data-item]", (l) => l.length), 5, "a: no Combine in the timeline");
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(500);
    await rebuilt(page);
    assert.equal((await toolbarStl(page)).volume, 22000, "a: Redo makes the Cut");
    await page.waitForTimeout(1100);
    // b. An edit of that Combine.
    await editItem("feature-6", "combine-panel");
    await page.selectOption("#combine-operation", "intersect");
    await okThenUndo();
    assert.deepEqual(await buttons(), ["Undo Combine bodies (Ctrl+Z)", "Redo Edit Combine 1 (Ctrl+Shift+Z)"], "b: the edit was taken back, not the Combine");
    assert.equal((await toolbarStl(page)).volume, 22000, "b: the Cut again");
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(500);
    await rebuilt(page);
    assert.equal((await toolbarStl(page)).volume, 4000, "b: Redo makes the Intersect");
    await page.context().close();
  }
  // 5. Insert > Box pressed right after Combine's OK.
  {
    const page = await fresh(design([[[40, 30, 20], null], [[40, 30, 20], [20, 15, 10]], [[10, 10, 10], [100, 0, 0]]]));
    await combine(page, "Body 1", ["Body 2"], "cut", false, false);
    await page.evaluate(() => {
      document.getElementById("combine-ok").click();
      document.getElementById("insert").click();
      document.getElementById("insert-box").click();
    });
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the new box's Move panel opened");
    await page.click("#move-cancel");
    await rebuilt(page);
    assert.deepEqual(await page.$$eval("#timeline li[data-item]", (l) => l.map((li) => li.textContent.trim().split("\n")[0]).slice(5)), ["6. Combine 1", "7. Box 4"], "5: the Combine is in the timeline, before the new box");
    assert.equal((await toolbarStl(page)).volume, 21000 + 1000 + 24000, "5: the Cut and the new box");
    await page.context().close();
  }
  // 6. A round tool is refused in the app's words.
  {
    const page = await fresh(design([[[40, 30, 20], null]]));
    await page.click("#insert");
    await page.click("#insert-cylinder");
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the cylinder's Move panel opened");
    await page.click("#move-cancel");
    await rebuilt(page);
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 2"]);
    await combine(page, "Body 1", ["Body 2"], "cut", false, false);
    await page.click("#combine-ok");
    await until(page, () => !document.getElementById("combine-error").hidden, null, "6: OK answered with words");
    assert.equal(await page.$eval("#combine-error", (e) => e.textContent), "Combine 1 can't be made: a tool body has a round face. Cut, Join and Intersect work on flat-sided shapes for now; round shapes are coming.");
    await page.context().close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("combine-check: ok");
} finally {
  await browser.close();
  await server.httpServer.close();
}
