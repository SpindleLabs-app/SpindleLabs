// Browser check of the question a Cut that removes nothing asks (Ben,
// 11 Nov, SL #506 item 5; cut-ask.ts), with `?combine`, at 1280 px with a
// mouse and 375 px with taps. Worked by hand: Box 1 40 × 30 × 20 at the
// origin (24,000 mm³), Box 2 a 10 mm cube moved (100, 0, 0), so x 100..110
// shares no point with Box 1's x 0..40. Cut Box 2 from Box 1:
// 1. OK asks "The cut removes nothing", naming Body 2 and Body 1, with
//    Delete Body 2 and Cancel (focused). Cancel: the panel stays open,
//    nothing recorded (two Body rows, Undo has no "Combine bodies").
// 2. OK again, Delete Body 2: recorded; one Body row, the STL 24,000 mm³,
//    and Combine 1's row warns "Combine 1: Body 2 removes nothing from
//    Body 1." in words.
// 3. Keep tools on: the button is Record anyway (nothing would be deleted).
// 4. A Cut that bites (Box 2 moved (35, 0, 0), 500 mm³ in common) asks
//    nothing: recorded at once, 23,500 mm³.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4351, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4351/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
const T = 30000;

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

const box = (n, [w, d, h], label) => ({ dependsOn: [], id: `feature-${n}`, intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" }, provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } }, suppressed: false });
const move = (n, of, label, [x, y, z], name) => ({ dependsOn: [of], id: `feature-${n}`, intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move ${label} by (${x}, ${y}, ${z}) mm`, type: "move", bodies: [`body:${of}`] }, provenance: { from: [{ id: of, label, workspace: "design" }], self: { id: `feature-${n}`, label: name, workspace: "design" } }, suppressed: false });
/** Box 1 40 × 30 × 20, and Box 2 a 10 mm cube moved to `to`. */
const design = (to) => ({ formatVersion: 2, links: [], materials: [], name: "check", units: { length: "mm" }, workspaces: { design: { nextId: 4, profiles: [], sketches: [], version: 4, timeline: { features: [box(1, [40, 30, 20], "Box 1"), box(2, [10, 10, 10], "Box 2"), move(3, "feature-2", "Box 2", to, "Move 1")] } } } });

async function fresh(project, phone) {
  const context = await browser.newContext(phone ? { viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true, acceptDownloads: true } : { viewport: { width: 1280, height: 800 }, acceptDownloads: true });
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
/** Picks a body by its Bodies row (the group opened first). */
async function pickRow(page, text, phone) {
  await page.evaluate(() => {
    document.querySelector('#browser details[data-node="bodies"]')?.setAttribute("open", "");
  });
  const row = page.locator('#browser [data-node="bodies"] .tree-row', { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first();
  // On a phone the browser sheet is shut: the row's own click (picking by finger in the view is combine.mjs's part).
  if (phone) await row.evaluate((r) => r.click());
  else await row.click();
}
/** Modify ▾ > Combine, Body 1 then Body 2 picked, Cut, Keep tools as given, then OK pressed. */
async function cutAndOk(page, keep, phone) {
  await page.evaluate(() => document.getElementById("modify-menu").click());
  await page.evaluate(() => document.getElementById("modify-menu-combine").click());
  await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel opened");
  for (const row of ["Body 1", "Body 2"]) await pickRow(page, row, phone);
  await page.selectOption("#combine-operation", "cut");
  if (keep) await page.check("#combine-keep");
  await page.evaluate(() => document.getElementById("combine-ok").click());
}
const askOpen = (page) => until(page, () => document.getElementById("cut-ask")?.open === true, null, "the question opened");

try {
  for (const phone of [false, true]) {
    const width = phone ? 375 : 1280;
    const page = await fresh(design([100, 0, 0]), phone);
    // 1. Asked; Cancel records nothing and leaves the panel open.
    await cutAndOk(page, false, phone);
    await askOpen(page);
    const asked = await page.evaluate(() => ({ heading: document.getElementById("cut-ask-heading").textContent, words: document.getElementById("cut-ask-words").textContent, go: document.getElementById("cut-ask-go").textContent, focus: document.activeElement?.id }));
    assert.equal(asked.heading, "The cut removes nothing");
    assert.match(asked.words, /^Body 2 doesn't reach Body 1, so cutting it removes nothing\. The Combine uses its tools up, so Body 2 would only be deleted\./);
    assert.equal(asked.go, "Delete Body 2");
    assert.equal(asked.focus, "cut-ask-cancel", "Cancel has the focus");
    // The whole box shows on the screen (a phone too), its buttons big enough to tap.
    const r = await page.locator("#cut-ask").boundingBox();
    assert.ok(r.x >= 0 && r.x + r.width <= width && r.y >= 0, `the box fits at ${width} px: ${JSON.stringify(r)}`);
    if (phone) assert.ok((await page.locator("#cut-ask-go").boundingBox()).height >= 44, "a finger-sized button");
    if (shots) await page.screenshot({ path: `${shots}/cut-ask-${width}.png` });
    if (phone) await page.locator("#cut-ask-cancel").tap();
    else await page.click("#cut-ask-cancel");
    await until(page, () => document.getElementById("cut-ask").open === false, null, "Cancel closed it");
    assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), false, "the panel stays open after Cancel");
    assert.deepEqual(await page.$$eval("#timeline li[data-item]", (lis) => lis.map((li) => li.dataset.item)), ["feature-1", "feature-2", "feature-3"], "nothing recorded");
    // 2. OK again, Delete Body 2: recorded, the tool gone, the row warning in words.
    await page.evaluate(() => document.getElementById("combine-ok").click());
    await askOpen(page);
    if (phone) await page.locator("#cut-ask-go").tap();
    else await page.click("#cut-ask-go");
    await until(page, () => document.getElementById("combine-panel").hidden, null, "recorded");
    await rebuilt(page);
    assert.deepEqual(await bodyRows(page), ["Body 1"]);
    assert.equal(await toolbarStl(page), 24000);
    const warned = await page.$eval('#timeline li[data-item="feature-4"]', (li) => ({ warned: li.dataset.warned, title: li.title }));
    assert.equal(warned.warned, "true", "Combine 1's item is marked");
    assert.match(warned.title, /Combine 1: Body 2 removes nothing from Body 1\./);
    if (shots) await page.screenshot({ path: `${shots}/cut-ask-recorded-${width}.png` });
    await page.context().close();
  }
  // 3. Keep tools on: nothing would be deleted, so it says Record anyway.
  {
    const page = await fresh(design([100, 0, 0]), false);
    await cutAndOk(page, true, false);
    await askOpen(page);
    assert.equal(await page.$eval("#cut-ask-go", (b) => b.textContent), "Record anyway");
    await page.keyboard.press("Escape");
    await until(page, () => document.getElementById("cut-ask").open === false, null, "Escape closed it");
    assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), false, "the panel stays open after Escape");
    await page.context().close();
  }
  // 4. A Cut that bites asks nothing: 24,000 − 5 · 10 · 10 = 23,500 mm³.
  {
    const page = await fresh(design([35, 0, 0]), false);
    await cutAndOk(page, false, false);
    await until(page, () => document.getElementById("combine-panel").hidden, null, "recorded at once");
    assert.equal(await page.$eval("#cut-ask", (d) => d.open), false, "no question");
    await rebuilt(page);
    assert.equal(await toolbarStl(page), 23500);
    await page.context().close();
  }
  assert.deepEqual(errors, []);
  console.log("combine-cut-ask: ok");
} finally {
  await browser.close();
  await server.close();
}
