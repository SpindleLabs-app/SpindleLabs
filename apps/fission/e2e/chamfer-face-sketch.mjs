// Browser check of a sketch on a Chamfer's slanted face (Ben, 2026-11-16:
// Create sketch on that face said "there is no solid item feature-19 to
// sketch on"). The design, `chamfer-face-sketch.spindle`: Box 1, 40 × 30 × 20
// at the origin, with Chamfer 1 cutting its top front edge (y = 0, z = 20)
// back 2 mm. Worked by hand: the chamfer's face runs from (x, 2, 20) to
// (x, 0, 18), so its middle is (20, 1, 19) and its outward normal
// (0, −1, 1)/√2. Create sketch, then a click (or tap) there, opens Sketch 1
// on it with no refusal, looking straight at the face from outside; Finish
// Sketch leaves three timeline items, and the sketch survives a reload.
// 1280 px with a mouse and 375 px with taps. Screenshots go to E2E_SHOTS when
// set. Port 4961. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels } from "./start.mjs";

const server = await preview({ preview: { port: 4961, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4961/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
const project = readFileSync(new URL("./chamfer-face-sketch.spindle", import.meta.url));

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const data = (page, key) => page.$eval("#viewport", (v, k) => v.dataset[k] ?? "", key);
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
const items = (page, n) => until(page, (k) => document.querySelectorAll("#timeline li[data-item]").length === k, n, `${n} timeline items`, 15000);

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap });
  const page = await context.newPage();
  // A fresh store on the first visit only, so the reload below finds the project kept.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-fresh") === null) {
      sessionStorage.setItem("e2e-fresh", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&chamfer#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "chamfer-face-sketch.spindle", mimeType: "application/json", buffer: project });
  await items(page, 2);
  await rebuilt(page);
  await settle(page);
  return page;
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

// The chamfer's face's middle and outward normal, worked by hand above.
const MIDDLE = [20, 1, 19];
const OUT = [0, -Math.SQRT1_2, Math.SQRT1_2];

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: Create sketch on the chamfer's slanted face opens Sketch 1 on it, looking at it from outside, kept through Finish Sketch and a reload`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await closePanels(page, tap);
        await press(page, "#create-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
        await at(page, MIDDLE, tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching === "true" || !document.getElementById("sketch-pick-error")?.hidden, null, "sketching or refused");
        const refused = await page.evaluate(() => { const e = document.getElementById("sketch-pick-error"); return e && !e.hidden ? e.textContent : ""; });
        assert.equal(refused, "", "no refusal");
        assert.equal(await data(page, "sketching"), "true");
        assert.equal(await page.textContent("#sketch-name"), "Sketch 1");
        // Looked at square on from outside the body: the camera along the face's outward normal from its target.
        const cam = await settle(page);
        const view = unit(sub(cam.position, cam.target));
        assert.ok(dot(view, OUT) > 1 - 1e-5, `looking along ${view}, not ${OUT}`);
        if (shots) await page.screenshot({ path: `${shots}/chamfer-face-sketch-${width}.png` });
        await closePanels(page, tap);
        await press(page, tap ? "#float-finish" : "#sketch-finish", tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching === "false", null, "sketch finished");
        await items(page, 3);
        await rebuilt(page);
        // The sketch's timeline item names the Chamfer's face.
        const title = await page.$$eval("#timeline li[data-item]", (li) => li.map((x) => x.getAttribute("title") ?? x.textContent ?? "").join(" | "));
        assert.match(title, /Sketch 1/, title);
        // Kept: once the save mark says so, a reload opens the project with the sketch, nothing red.
        await until(page, () => document.getElementById("save-status")?.textContent === "Saved", null, "saved", 15000);
        await page.reload();
        await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 3, null, "3 items after the reload", 15000);
        await rebuilt(page);
        assert.equal(await page.$$eval("#timeline li[data-item][data-failed]", (li) => li.length), 0, "nothing failed after the reload");
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  await server.close();
}
const own = errors.filter((e) => !/favicon/.test(e));
if (own.length > 0) {
  failed++;
  console.log(`not ok - page errors\n  ${own.join("\n  ")}`);
}
if (failed > 0) process.exit(1);
