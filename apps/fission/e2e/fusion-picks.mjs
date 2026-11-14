// Browser check of SL #524 items 1, 3 and 4 (app bug hunt 2026-11-11), Fusion's way:
// 1. Box 1 mirrored, then renamed Base: the Mirror's row says "Mirror of Base across the YZ plane" in its tooltip.
// 3. Ctrl+click on Body 2's row adds it to Body 1 already selected (it replaced it); Ctrl+click again takes it out.
// 4. In a sketch with Select, a click (or tap) on a dimension's number picks the dimension, and Delete deletes it.
// 1280 px with a mouse; item 4 also at 375 px with taps. Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves
// screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, insertPreset, openPanel, pickPlane, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4361, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4361/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => assert.fail(`${what}: timed out`));
const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const shown = (page, key, want) => until(page, ([k, w]) => document.querySelector("#viewport").dataset[k] === w, [key, want], `${key} "${want}"`).catch(async (e) => assert.fail(`${e.message} (shown: "${await data(page, key)}")`));
const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  await pinProperties(page);
  return sheetsClearFor(page);
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
const openBodies = (page) => page.evaluate(() => document.querySelectorAll("#browser details").forEach((d) => d.setAttribute("open", "")));

// The pinhole camera (45° field), as sketch-dimensions.mjs works it: a sketch point on XY to the screen.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
async function screen(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const box = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub([p[0], p[1], 0], cam.position);
  const nx = dot(v, right) / (dot(v, forward) * T * (box.width / box.height));
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}
async function settle(page) {
  let last = "";
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = JSON.stringify(await page.evaluate(() => window.fissionTest.camera()));
    if (now === last) return;
    last = now;
  }
}
async function at(page, p, tap) {
  const s = await screen(page, p);
  await closePanels(page, tap);
  return tap ? page.touchscreen.tap(s.x, s.y) : page.mouse.click(s.x, s.y);
}
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

try {
  await check("1280 px: Ctrl+click on a Bodies row adds it to the selection, and takes it out again", async () => {
    const page = await fresh();
    await startWithBox(page);
    await insertPreset(page, "box");
    await openBodies(page);
    await page.click('#browser .tree-row[data-node="body-1"]');
    await until(page, () => document.body.dataset.selection === "body:feature-1", null, "Body 1 selected");
    await page.click('#browser .tree-row[data-node="body-2"]', { modifiers: ["Control"] });
    await until(page, () => (document.body.dataset.selection ?? "").split(" ").length === 2, null, "Ctrl+click adds Body 2").catch(async (e) => assert.fail(`${e.message}: "${await selection(page)}"`));
    assert.match(await selection(page), /^body:feature-1 body:feature-\d+$/);
    if (shots) await page.screenshot({ path: `${shots}/fusion-ctrl-rows-1280.png` });
    await page.click('#browser .tree-row[data-node="body-2"]', { modifiers: ["Control"] });
    await until(page, () => document.body.dataset.selection === "body:feature-1", null, "Ctrl+click again takes Body 2 out");
    // A plain click still selects only its row.
    await page.click('#browser .tree-row[data-node="body-2"]');
    await until(page, () => (document.body.dataset.selection ?? "").split(" ").length === 1 && document.body.dataset.selection !== "body:feature-1", null, "a plain click selects only Body 2");
    await page.context().close();
  });

  await check("1280 px: Box 1 mirrored and renamed Base: the Mirror's description says Base", async () => {
    const page = await fresh();
    await startWithBox(page);
    await openBodies(page);
    await page.click('#browser .tree-row[data-node="body-1"]');
    await page.click("#modify-menu");
    await page.click("#modify-menu-mirror-yz");
    await until(page, () => [...document.querySelectorAll("#browser .tree-row")].some((r) => /Mirror of Box 1 across the YZ plane/.test(r.dataset.tip ?? "")), null, "the Mirror made").catch(async (e) =>
      assert.fail(`${e.message}: ${await page.evaluate(() => [...document.querySelectorAll("#browser .tree-row")].map((r) => r.dataset.tip).join(" | "))}`));
    const item = page.locator('#timeline [data-item="feature-1"]').first();
    await item.click({ button: "right" });
    await until(page, () => document.getElementById("row-menu").open, null, "Box 1's menu");
    await page.click("#row-menu-rename");
    await page.locator("#rename-input").waitFor();
    await page.fill("#rename-input", "Base");
    await page.keyboard.press("Enter");
    await until(page, () => [...document.querySelectorAll("#browser .tree-row")].some((r) => /Mirror of Base across the YZ plane/.test(r.dataset.tip ?? "")), null, "the Mirror's description names Base").catch(async (e) =>
      assert.fail(`${e.message}: ${await page.evaluate(() => [...document.querySelectorAll("#browser .tree-row")].map((r) => r.dataset.tip).join(" | "))}`));
    await page.context().close();
  });

  for (const [width, tap] of [[1280, false], [375, true]]) {
    await check(`${width} px: with Select, a ${tap ? "tap" : "click"} on a dimension's number picks it and Delete deletes it`, async () => {
      const page = await fresh(width, tap);
      await press(page, "#create-sketch", tap);
      await pickPlane(page, "XY", tap);
      await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
      await settle(page);
      await openPanel(page, "properties", tap);
      await page.fill("#sketch-grid", "1");
      await page.press("#sketch-grid", "Enter");
      await page.check("#sketch-grid-snap");
      await closePanels(page, tap);
      await press(page, "#sketch-tool-line", tap);
      await at(page, [0, 0], tap);
      await at(page, [20, 0], tap);
      await shown(page, "sketchLines", "1");
      if (!tap) await page.keyboard.press("Escape");
      // The line drawn along the grid may come with constraints of its own (a horizontal one, since auto-constraints
      // landed after this check was written): the dimension adds one more, and Delete takes only that one away.
      const before = Number(await data(page, "sketchConstraints") || 0);
      await press(page, "#sketch-tool-dimension", tap);
      await at(page, [10, 0], tap);
      await until(page, () => document.activeElement?.id === "typed-length" || !document.querySelector("#typed-entry")?.hidden, null, "the Length box");
      if (tap) await page.locator("#typed-length").focus();
      await page.keyboard.type("30");
      await page.keyboard.press("Enter");
      await shown(page, "sketchConstraints", String(before + 1));
      await shown(page, "sketchLabels", "30");
      await press(page, "#sketch-tool-select", tap);
      const label = page.locator(".sketch-label", { hasText: "30" }).first();
      await settle(page);
      await (tap ? label.tap() : label.click());
      await until(page, () => Number(document.querySelector("#viewport").dataset.sketchPicked) > 0, null, "the dimension picked (its line drawn lit)").catch(async (e) =>
        assert.fail(`${e.message}: picked "${await data(page, "sketchPicked")}"`));
      if (shots) await page.screenshot({ path: `${shots}/fusion-label-picked-${width}.png` });
      await press(page, "#sketch-delete", tap);
      await shown(page, "sketchConstraints", String(before));
      assert.equal(await page.locator(".sketch-label").count(), 0, "its label gone");
      assert.equal(await data(page, "sketchLines"), "1", "the line kept");
      await page.context().close();
    });
  }

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
