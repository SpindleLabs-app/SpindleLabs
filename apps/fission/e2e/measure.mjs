// Browser check of Measure (step 35e2l2, measure-view.ts): Inspect ▾
// Measure opens its panel; a click (or tap) on a face picks it and selects
// nothing; a second gives the exact distance, drawn as a line in the view;
// Settings ▸ Units shows the same numbers in inches; Escape closes it.
// The design (opened from a file): Box 1 20 × 20 × 10 at the origin, Box 2
// 10 × 10 × 10 moved 40 along x. Worked by hand: Box 1's top is z = 10 over
// x 0..20, y 0..20 (400 mm²); Box 2's top is z = 10 over x 40..50, y 0..10.
// Both tops lie in z = 10 and face the same way (0°); the nearest points
// are Box 1's edge x = 20 and Box 2's x = 40, so 20 mm apart, all along x;
// in inches 20 / 25.4 = 0.7874 → 0.787 in. At 1280 px with a mouse and at
// 375 px with taps, where the Properties sheet stays shut while picking
// (the view clear) and opens on the distance, covering under half the view.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels } from "./start.mjs";

const server = await preview({ preview: { port: 4281, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4281/";
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
async function at(page, p, tap) {
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

const box = (n, label, [w, d, h]) => ({
  dependsOn: [],
  id: `feature-${n}`,
  intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" },
  provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } },
  suppressed: false,
});
const features = [
  box(1, "Box 1", [20, 20, 10]),
  box(2, "Box 2", [10, 10, 10]),
  {
    dependsOn: ["feature-2"],
    id: "feature-3",
    intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x: 40, y: 0, z: 0 }, summary: "Move Box 2 by (40, 0, 0) mm", type: "move" },
    provenance: { from: [{ id: "feature-2", label: "Box 2", workspace: "design" }], self: { id: "feature-3", label: "Move 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Measure check", units: { length: "mm" }, workspaces: { design: { nextId: 4, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const TOP1 = [10, 10, 10];
const TOP2 = [45, 5, 10];

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "measure.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 3, null, "the file open", 15000);
  await rebuilt(page);
  return page;
}

/** Inspect ▾ Measure: the toolbar's button where it shows, else the Inspect menu's item. */
async function measureTool(page, tap) {
  if (await page.isVisible("#inspect-measure")) return press(page, "#inspect-measure", tap);
  await press(page, "#inspect-menu", tap);
  await page.locator("#inspect-menu-measure").waitFor();
  await press(page, "#inspect-menu-measure", tap);
}
const text = (page, id) => page.evaluate((i) => document.getElementById(i)?.textContent ?? null, id);
const picks = (page) => page.evaluate(() => [document.getElementById("measure-first-name")?.textContent, document.getElementById("measure-second-name")?.textContent].join(" | "));
const legend = (page) => page.$$eval(".overlay-legend:not([hidden]) li", (ls) => ls.map((l) => l.textContent));
const sheetOpen = (page) => page.evaluate(() => document.getElementById("properties-toggle")?.getAttribute("aria-expanded") === "true");

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
    await check(`${width} px${tap ? ", taps" : ""}: Measure gives the 20 mm between two box tops, drawn in the view, in inches too, and Escape closes it`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await closePanels(page, tap);
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await page.evaluate(() => document.activeElement?.blur());
        const undoBefore = await page.getAttribute("#undo", "title");
        await measureTool(page, tap);
        await until(page, () => document.getElementById("measure-panel")?.hidden === false, null, "the panel open");
        assert.equal(await page.getAttribute("#inspect-measure", "aria-pressed"), "true");
        assert.equal(await text(page, "measure-view-hint"), "Measure: click or tap a face, edge or body");
        if (tap) {
          assert.equal(await sheetOpen(page), false, "a phone's sheet stays shut while picking");
          await closePanels(page, tap);
        }
        await at(page, TOP1, tap);
        await until(page, () => document.getElementById("measure-first-area")?.textContent === "400 mm²", null, "Box 1's top measured: 20 × 20 = 400 mm²");
        assert.equal(await picks(page), "Flat face of Body 1 | Nothing picked");
        assert.equal(await text(page, "measure-view-hint"), "Now click or tap a second thing");
        if (tap) assert.equal(await sheetOpen(page), false, "still shut with one pick");
        // A click while measuring selects nothing: no Body facts change, no row selected in the browser.
        assert.equal(await page.$$eval("#browser .tree-row[aria-selected=true]", (rs) => rs.length), 0, "nothing selected");
        await at(page, TOP2, tap);
        await until(page, () => document.getElementById("measure-distance")?.textContent === "20 mm", null, "the distance: 40 − 20 = 20 mm");
        assert.equal(await picks(page), "Flat face of Body 1 | Flat face of Body 2");
        assert.equal(await text(page, "measure-angle"), "0°");
        assert.equal(await page.isVisible("#measure-view-hint"), false, "two picked: the hint goes");
        assert.deepEqual(await legend(page), ["Distance 20 mm"]);
        if (!tap) assert.equal(await text(page, "measure-dx"), "20 mm");
        if (tap) {
          assert.equal(await sheetOpen(page), true, "the distance opens the phone's sheet");
          assert.equal(await page.isVisible("#measure-distance"), true);
          assert.equal(await page.isVisible("#measure-first-area"), false, "a pick's own facts stay off the phone's short sheet");
          const sheet = await page.locator("#properties").boundingBox();
          const view = await canvasBox(page);
          const covered = Math.max(0, Math.min(sheet.y + sheet.height, view.y + view.height) - Math.max(sheet.y, view.y));
          assert.ok(covered < view.height / 2, `the sheet covers ${covered} of the view's ${view.height} px: under half`);
        }
        if (shots) await page.screenshot({ path: `${shots}/measure-${width}.png` });
        assert.equal(await page.getAttribute("#undo", "title"), undoBefore, "measuring records no undo step");
        if (!tap) {
          // Settings ▸ Units: inches. 20 / 25.4 = 0.787; 400 / 645.16 = 0.62 in².
          await page.click("#settings-open");
          await page.waitForSelector("#settings[open]");
          await page.click("#settings [data-unit=in]");
          await page.click("#settings .close");
          await until(page, () => document.getElementById("measure-distance")?.textContent === "0.787 in", null, "the distance in inches");
          assert.equal(await text(page, "measure-first-area"), "0.62 in²");
          assert.deepEqual(await legend(page), ["Distance 0.787 in"]);
          if (shots) await page.screenshot({ path: `${shots}/measure-${width}-inches.png` });
        }
        // Escape (from the view) closes it: the panel, the line and the hint go.
        if (tap) await closePanels(page, tap);
        await page.keyboard.press("Escape");
        await until(page, () => document.getElementById("measure-panel")?.hidden === true, null, "the panel closed");
        assert.deepEqual(await legend(page), []);
        assert.equal(await page.getAttribute("#inspect-measure", "aria-pressed"), "false");
      } finally {
        await page.context().close();
      }
    });
  }
  await check("Measure is listed in Inspect ▾ and no longer as coming soon", async () => {
    const page = await fresh(1280, 800, false);
    try {
      await press(page, "#inspect-menu", false);
      await until(page, () => !document.getElementById("inspect-menu-menu").hidden, null, "Inspect ▾ opens");
      const ids = await page.$$eval("#inspect-menu-menu [id]", (els) => els.map((e) => e.id));
      assert.ok(ids.includes("inspect-menu-measure") && !ids.includes("coming-measure"), JSON.stringify(ids));
    } finally {
      await page.context().close();
    }
  });
  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed++;
  console.log(`not ok - ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) process.exit(1);
