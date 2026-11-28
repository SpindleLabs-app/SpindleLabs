// Browser check of Combine on round bodies (curved Combine, kernel 0.33.88), with `?combine`.
// 1. 1280 px with a mouse, `round-combine.spindle`: Box 1 20 × 20 × 10 with Cylinder 1 (Ø6 × 30, moved to stand
//    round (10, 10) from z −10 to 20) and Box 2, a 40 × 40 × 3.5 slab at x 60..100, with Cylinder 2 (Ø10 × 40 turned
//    60° about Y round its middle and moved there to the slab's middle, (80, 20, 1.75)). Combine cuts Body 2 from
//    Body 1: the drilled box is 20·20·10 − π·3²·10 = 4,000 − 90π = 3,717.256661 mm³ in Body facts; then Body 4 from
//    Body 3: every slice of the slanted rod parallel to the slab is an ellipse of π·5² / cos 60° = 50π, so it takes
//    out 50π · 3.5 = 175π and the slab is 40·40·3.5 − 175π = 5,600 − 175π = 5,050.221286 mm³. Both rods used up: two
//    Bodies rows. The timeline bar stays whole along the bottom.
// 2. 1280 px and 375 px with taps, `round-refused.spindle`: the drilled box made by Combine 1 (built), and Combine 2
//    cutting a ball Ø10 from a 20 mm cube (the kernel's booleans take no sphere yet): Combine 2's row is red, its
//    reason the app's words ("a tool body has a sphere face ... spheres are coming"), never the kernel's ("part of a
//    sphere"), the same in the Edit Combine panel, which fits the screen; Combine 1's row is not red.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { closePanels } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4996, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4996/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
const T = 30000;
const SPHERE_WORDS = "a tool body has a sphere face. Cut, Join and Intersect work on flat and cylinder-shaped bodies for now; spheres are coming.";

const until = (page, fn, arg, what, timeout = T) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function rebuilt(page) {
  await page.waitForTimeout(150);
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
/** Body facts' words for a volume (formatQuantity: ten significant figures, en-GB). */
const volumeWords = (v) => `${v.toLocaleString("en-GB", { maximumSignificantDigits: 10 })} mm³`;

async function fresh(file, width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(T);
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  const project = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const ids = project.workspaces.design.timeline.features.map((f) => f.id);
  await page.setInputFiles("#open-file", { name: file, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ids, "the file opened");
  await rebuilt(page);
  return page;
}
const bodyRows = (page) => page.$$eval('#browser [data-node="bodies"] .tree-row', (rows) => rows.filter((r) => r.dataset.node !== "bodies").map((r) => r.textContent.trim()));
async function clickRow(page, text) {
  await page.evaluate(() => document.querySelector('#browser details[data-node="bodies"]')?.setAttribute("open", ""));
  await page.locator('#browser [data-node="bodies"] .tree-row', { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
}
/** Modify ▾ > Combine, target and tools by their Bodies rows, Cut, OK; fails with the panel's words when refused. */
async function cut(page, target, tools) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.click("#modify-menu");
  await page.click("#modify-menu-combine");
  await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel opened");
  for (const row of [target, ...tools]) await clickRow(page, row);
  await page.selectOption("#combine-operation", "cut");
  await page.click("#combine-ok");
  await until(page, () => document.getElementById("combine-panel").hidden || !document.getElementById("combine-error").hidden, null, "OK answered");
  assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), true, `the Combine was refused: ${await page.$eval("#combine-error", (e) => e.textContent)}`);
  await rebuilt(page);
}
/** The timeline bar is on screen along the bottom, wholly inside the window, and on top at its middle. */
async function barWhole(page, what) {
  const bar = await page.evaluate(() => {
    const el = document.querySelector("#timeline-bar, .timeline-bar, #timeline");
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { left: r.left, right: r.right, bottom: r.bottom, height: r.height, onTop: el.contains(top), w: innerWidth, h: innerHeight };
  });
  assert.ok(bar.height > 0 && bar.left >= 0 && bar.right <= bar.w + 0.5 && bar.bottom <= bar.h + 0.5 && bar.bottom > bar.h - 120, `${what}: the timeline bar along the bottom (${JSON.stringify(bar)})`);
  assert.ok(bar.onTop, `${what}: nothing covers the timeline bar`);
}

try {
  // 1. The drilled box and the slanted cut.
  {
    const page = await fresh("round-combine.spindle", 1280, 800, false);
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 2", "Body 3", "Body 4"]);
    await cut(page, "Body 1", ["Body 2"]);
    await cut(page, "Body 3", ["Body 4"]);
    assert.deepEqual(await bodyRows(page), ["Body 1", "Body 3"], "both rods used up");
    for (const [row, v] of [["Body 1", 4000 - 90 * Math.PI], ["Body 3", 5600 - 175 * Math.PI]]) {
      await page.keyboard.press("Escape");
      await clickRow(page, row);
      await until(page, (w) => document.getElementById("volume")?.textContent === w, volumeWords(v), `${row}: Body facts shows ${volumeWords(v)}, not ${await page.$eval("#volume", (e) => e.textContent).catch(() => "nothing")}`, 10000);
    }
    assert.equal(await page.$$eval("#timeline li[data-failed=true]", (l) => l.length), 0, "nothing red");
    await barWhole(page, "1280 after both cuts");
    if (shots) await page.screenshot({ path: `${shots}/combine-round-cuts-1280.png` });
    await page.context().close();
  }
  // 2. A ball refused in the app's words, at both widths.
  for (const [width, height, tap] of [[1280, 800, false], [375, 812, true]]) {
    const page = await fresh("round-refused.spindle", width, height, tap);
    const rows = await page.$$eval("#timeline li[data-item]", (l) => Object.fromEntries(l.map((li) => [li.dataset.item, { failed: li.dataset.failed, title: li.title }])));
    assert.notEqual(rows["feature-4"].failed, "true", `${width}: Combine 1 (the drilled box) builds`);
    assert.equal(rows["feature-9"].failed, "true", `${width}: Combine 2 (the ball) is red`);
    const why = rows["feature-9"].title.match(/\(failed: (.+)\)/)?.[1];
    assert.equal(why, `Combine 2 can't be made: ${SPHERE_WORDS}`, `${width}: the row's reason (${rows["feature-9"].title})`);
    await barWhole(page, `${width} opened`);
    await closePanels(page, tap);
    await page.evaluate(() => document.querySelector('#timeline li[data-item="feature-9"]').click());
    await page.evaluate(() => document.querySelector('#timeline [data-more="feature-9"]').click());
    await until(page, () => document.getElementById("row-menu")?.open, null, `${width}: the row's menu`);
    if (tap) await page.locator("#row-menu-edit").tap();
    else await page.locator("#row-menu-edit").click();
    await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, `${width}: Edit Combine open`);
    await until(page, () => !document.getElementById("combine-why").hidden, null, `${width}: the Edit panel says why`);
    const said = await page.evaluate(() => {
      const el = document.getElementById("combine-why");
      const r = el.getBoundingClientRect();
      return { text: el.textContent, left: r.left, right: r.right, w: innerWidth, spill: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(said.text, `Couldn't be made: Combine 2 can't be made: ${SPHERE_WORDS}`, `${width}: the Edit panel's words`);
    assert.doesNotMatch(said.text, /part of a sphere|facts of a boolean|step \d/, `${width}: never the kernel's words`);
    assert.ok(said.left >= 0 && said.right <= said.w + 0.5 && !said.spill, `${width}: the words fit the screen (${JSON.stringify(said)})`);
    await page.locator("#combine-why").scrollIntoViewIfNeeded();
    if (shots) await page.screenshot({ path: `${shots}/combine-round-refused-${width}.png` });
    if (tap) await page.locator("#combine-cancel").tap().catch(() => page.locator(".phone-float [data-cancel], #phone-float-cancel").first().tap());
    else await page.locator("#combine-cancel").click();
    await until(page, () => document.getElementById("combine-panel").hidden, null, `${width}: Cancel shuts the panel`);
    await closePanels(page, tap);
    await barWhole(page, `${width} after Cancel`);
    await page.context().close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("combine-round: ok");
} finally {
  await browser.close();
  await server.httpServer.close();
}
