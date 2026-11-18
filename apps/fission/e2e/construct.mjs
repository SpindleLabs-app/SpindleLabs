// Browser check of the Construct menu (step 59a2, construct-view.ts, construct-panel.ts, construct-flag.ts):
// without `?construct` Construct ▾ lists its planes, axes and points greyed as coming soon; with it the menu
// lists the 14 kinds under Plane, Axis and Point, a kind opens its panel, a click (or tap) on a face, edge or
// corner of Box 1 (40 x 30 x 20 at the origin, opened from a file) fills the slot being picked, the kernel's
// answer is asked as it is filled and drawn before OK, and OK (Enter, or the phone bar's Finish Construct)
// records one item with its own bar icon, drawn in the view and gone again with Undo. Worked by hand: an offset
// plane 5 mm from the top face (z = 20, facing up) passes through z = 25 and faces (0, 0, 1); the box's
// corner (40, 0, 20) is a point at (40, 0, 20); the top front edge (y = 0, z = 20) runs along x, so the axis
// along it points (1, 0, 0) or (-1, 0, 0). 1280 px with a mouse and 375 px with taps. Screenshots go to
// E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4965, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4965/";
const browser = await launch();
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


const features = [
  {
    dependsOn: [],
    id: "feature-1",
    intent: { parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm", type: "box" },
    provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Construct check", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const TOP_CENTRE = [20, 15, 20];
const CORNER = [40, 0, 20];
const TOP_FRONT = [20, 0, 20];

async function fresh(width, height, tap, query) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "construct.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "the file open", 15000);
  await rebuilt(page);
  await settle(page);
  return page;
}

const opened = (page) => until(page, () => document.getElementById("construct-panel")?.hidden === false, null, "the Construct panel open");
const closed = (page) => until(page, () => document.getElementById("construct-panel")?.hidden === true, null, "the Construct panel closed");
const items = (page, n) => until(page, (k) => document.querySelectorAll("#timeline li[data-item]").length === k, n, `${n} timeline items`);
const valueSays = (page, slot, want) => until(page, ([s, w]) => document.getElementById(`construct-value-${s}`)?.textContent === w, [slot, want], `${slot} says ${want}`);
const previewSays = (page, re) => until(page, (r) => new RegExp(r).test(document.getElementById("construct-preview")?.textContent ?? "") && document.getElementById("construct-panel").dataset.previewRefused === "false", re, `the preview says ${re}`);
const origin = (page) => page.evaluate(() => [...document.querySelectorAll("[data-origin]")].map((e) => e.dataset.origin).join(" "));
async function menuItems(page, tap) {
  await closePanels(page, tap);
  await press(page, "#construct-menu", tap);
  await until(page, () => !document.getElementById("construct-menu-menu").hidden, null, "Construct ▾ opens");
  const ids = await page.$$eval("#construct-menu-menu [id]", (els) => els.map((e) => e.id).filter((id) => !id.startsWith("construct-menu-menu-")));
  return ids;
}
async function start(page, kind, tap) {
  await menuItems(page, tap);
  await press(page, `#construct-menu-${kind}`, tap);
  await opened(page);
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
  await check("without ?construct Construct ▾ lists its three tools greyed as coming soon and the panel never opens", async () => {
    const page = await fresh(1280, 800, false, "");
    try {
      const ids = await menuItems(page, false);
      assert.ok(ids.includes("coming-plane") && ids.includes("coming-axis") && ids.includes("coming-point"), JSON.stringify(ids));
      assert.ok(!ids.some((id) => id.startsWith("construct-menu-")), JSON.stringify(ids));
      assert.equal(await page.$eval("#construct-panel", (p) => p.hidden), true);
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: the menu lists 14 kinds; an offset plane from the top face, 5 typed, Enter: an item with a plane icon, drawn in the view, one undo step", async () => {
    const page = await fresh(1280, 800, false, "&construct");
    try {
      const ids = await menuItems(page, false);
      assert.equal(ids.filter((id) => id.startsWith("construct-menu-")).length, 14, JSON.stringify(ids));
      await page.keyboard.press("Escape");
      await start(page, "offset-plane", false);
      assert.equal(await page.$eval("#construct-ok", (b) => b.disabled), true, "OK off with nothing picked");
      assert.match(await page.textContent("#construct-hint"), /Offset plane: click a plane/);
      if (shots) await page.screenshot({ path: `${shots}/construct-1280-empty.png` });
      await at(page, TOP_CENTRE);
      await valueSays(page, "plane", "Face of Body 1");
      await previewSays(page, "^A plane through .*facing \\(0, 0, 1\\)");
      assert.match(await origin(page), /construct-preview/, "the preview drawn");
      await page.locator("#construct-number").fill("5");
      await previewSays(page, "^A plane through \\(.*, .*, 25\\)");
      if (shots) await page.screenshot({ path: `${shots}/construct-1280-picked.png` });
      await page.keyboard.press("Enter");
      await closed(page);
      await items(page, 2);
      assert.equal(await page.$eval('#timeline [data-item="feature-2"]', (li) => li.dataset.icon), "plane");
      assert.match(await origin(page), /construct-feature-2/, "the plane drawn");
      assert.doesNotMatch(await origin(page), /construct-preview/);
      await rebuilt(page);
      if (shots) await page.screenshot({ path: `${shots}/construct-1280-done.png` });
      await press(page, "#undo", false);
      await items(page, 1);
      assert.doesNotMatch(await origin(page), /construct-feature-2/, "gone with Undo");
      await press(page, "#redo", false);
      await items(page, 2);
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: a point at a corner and an axis along an edge, each by one click", async () => {
    const page = await fresh(1280, 800, false, "&construct");
    try {
      await start(page, "point-at", false);
      await at(page, CORNER);
      await valueSays(page, "point", "Corner of Body 1");
      await previewSays(page, "^A point at \\(40, 0, 20\\)");
      await page.keyboard.press("Enter");
      await closed(page);
      await items(page, 2);
      assert.equal(await page.$eval('#timeline [data-item="feature-2"]', (li) => li.dataset.icon), "point");
      await start(page, "axis-along", false);
      await at(page, TOP_FRONT);
      await valueSays(page, "line", "Edge of Body 1");
      await previewSays(page, "^An axis through .*along \\(-?1, 0, 0\\)");
      if (shots) await page.screenshot({ path: `${shots}/construct-1280-axis.png` });
      await page.keyboard.press("Enter");
      await closed(page);
      await items(page, 3);
      assert.equal(await page.$eval('#timeline [data-item="feature-3"]', (li) => li.dataset.icon), "axis");
      // A face where a line is wanted is refused in words, nothing filled.
      await start(page, "axis-along", false);
      await at(page, TOP_CENTRE);
      await until(page, () => /a face is not one/.test(document.getElementById("construct-error")?.textContent ?? ""), null, "the face refused in words");
      assert.equal(await page.textContent("#construct-value-line"), "Pick in the view");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps: Offset plane chosen from the list as XY with 7 typed, the bar's Finish Construct records it; Cancel records nothing", async () => {
    const page = await fresh(375, 667, true, "&construct");
    try {
      await start(page, "offset-plane", true);
      const bar = () => page.evaluate(() => {
        const b = document.getElementById("phone-float");
        return b && !b.hidden ? { kind: b.dataset.kind, finish: document.getElementById("float-finish")?.textContent, off: document.getElementById("float-finish")?.disabled } : null;
      });
      assert.deepEqual(await bar(), { kind: "construct", finish: "Finish Construct", off: true });
      await page.waitForTimeout(300);
      if (shots) await page.screenshot({ path: `${shots}/construct-375-empty.png` });
      await page.selectOption("#construct-choose-plane", "XY");
      await valueSays(page, "plane", "XY plane");
      await page.locator("#construct-number").fill("7");
      await previewSays(page, "^A plane through \\(.*, .*, 7\\)");
      if (shots) await page.screenshot({ path: `${shots}/construct-375-picked.png` });
      assert.equal((await bar()).off, false, "Finish on");
      await page.tap("#float-finish");
      await closed(page);
      await items(page, 2);
      assert.equal(await page.$eval('#timeline [data-item="feature-2"]', (li) => li.dataset.icon), "plane");
      if (shots) await page.screenshot({ path: `${shots}/construct-375-done.png` });
      await start(page, "offset-plane", true);
      await page.tap("#float-cancel");
      await closed(page);
      await items(page, 2);
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  await server.close();
}
if (errors.length > 0) {
  console.log(`page errors:\n${errors.join("\n")}`);
  failed++;
}
process.exit(failed === 0 ? 0 : 1);
