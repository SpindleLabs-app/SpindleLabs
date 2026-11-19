// Browser check of SL #759 item 4 (the owner's call 2026-11-19, "make it follow"): a block drawn on a part pulled out of
// Box 1's face follows Box 1 when Box 1's Move is edited, as a new body (live) and joined level with Box 1's top
// (?combine). Each opens a real version 29 file saved by main cd89748 (workspaces/design/test/files), so it also checks
// that an old file opens with nothing moved. Worked by hand: Box 1 40 × 30 × 20 moved 10 along x is x 10..50, the part
// pulled 20 out of its right face x 50..70, the 10 × 10 × 5 block on the part's top x 55..65, y 10..20, z 20..25: the
// whole x 10..70, y 0..30, z 0..25. Move 1 edited from x 10 to x −40 takes everything 50 back: Box 1 x −40..0, the part
// x 0..20, the block x 5..15, so the whole x −40..20 (left behind, the block would reach x 65). 1280 px with a mouse and 375 px
// with taps. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4300, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4300/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
  await nextFrame(page);
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

/** Move 1's Edit feature, from its timeline item's menu (right-click, or its ⋯ on a phone). */
async function editMove(page, tap) {
  const item = page.locator('#timeline [data-item="feature-2"]');
  if (tap) {
    if (!(await page.isVisible('#timeline [data-more="feature-2"]'))) await (await closePanels(page, true), item.tap());
    await page.tap('#timeline [data-more="feature-2"]');
  } else await item.click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
  await press(page, "#row-menu-edit", tap);
  await opened(page);
}


const file = (name) => JSON.parse(readFileSync(new URL(`../../../workspaces/design/test/files/${name}`, import.meta.url), "utf8"));

async function fresh(width, height, touch, name, combine) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}${combine ? "&combine" : ""}#design`);
  await page.locator("#start-hint").waitFor();
  const project = { formatVersion: 2, links: [], materials: [], name: "check", units: { length: "mm" }, workspaces: { design: file(name) } };
  await page.setInputFiles("#open-file", { name: "check.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 6, null, "the file opened");
  await rebuilt(page);
  return sheetsClearFor(page);
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
  for (const [name, combine, what] of [["v29-block-on-pulled-new.json", false, "pulled out as a new body"], ["v29-block-on-pulled-join.json", true, "pulled out and joined (?combine)"]])
    for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
      await check(`${width} px${tap ? ", taps" : ""}, ${what}: the old file opens as saved, and the block follows Box 1's Move`, async () => {
        const page = await fresh(width, height, tap, name, combine);
        try {
          near(await stlBounds(page, tap), [[10, 70], [0, 30], [0, 25]], "as saved");
          await editMove(page, tap);
          await page.fill("#move-x", "-40");
          await press(page, "#move-ok", tap);
          await closed(page);
          await rebuilt(page);
          near(await stlBounds(page, tap), [[-40, 20], [0, 30], [0, 25]], "moved with Box 1 (left behind it would reach x 65)");
          if (shots) await page.screenshot({ path: `${shots}/pulled-face-follow-${combine ? "join" : "new"}-${width}.png` });
        } finally {
          await page.context().close();
        }
      });
    }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  failed++;
  console.log(`not ok - no page errors\n  ${errors.join("\n  ")}`);
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
