// Browser check of Through all (Ben 2026-11-14, Design data version 23;
// extrude-panel.ts, extrude-through.ts), shown with Extrude's Operation row
// (`?combine`). The design, as extrude-operation.mjs's: Box 1, 10 × 10 × 10
// moved 5 mm down (x 0..10, y 0..10, z −5..5), and Sketch 1 on XY, the
// square x 2..6, y 2..6 (16 mm²). Worked by hand: Cut through all from
// z = 0 goes to the box's top, so the box keeps 1,000 − 16 × 5 = 920 mm³;
// the preview runs 1 mm past the top, z 0..6, 16 × 6 = 96 mm³. Box 1 made
// 30 high (z −5..25, 3,000 mm³): the hole still goes right through,
// 3,000 − 16 × 25 = 2,600 mm³. Through all let go in Edit feature: back to
// the 20 mm typed, z 0..20, 3,000 − 16 × 20 = 2,680 mm³ (the hole now
// stops 5 mm short of the top). 1280 px with a mouse, and 375 px with taps
// (the Cut through all, then OK). Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4331, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4331/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed", 15000);
  await nextFrame(page);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The toolbar's STL: its enclosed volume (mm³, the sum over triangles of the signed tetrahedra to the origin) and its bounds. */
async function stl(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  let volume = 0;
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += dot(a, cross(b, c)) / 6;
    pts.push(a, b, c);
  }
  return { volume, bounds: [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]) };
}
function near(got, volume, bounds, what) {
  assert.ok(Math.abs(got.volume - volume) <= 0.05, `${what}: volume ${got.volume}, want ${volume}`);
  got.bounds.flat().forEach((x, i) => assert.ok(Math.abs(x - bounds.flat()[i]) <= 1e-3, `${what}: bounds ${JSON.stringify(got.bounds)}, want ${JSON.stringify(bounds)}`));
}

const corners = [[2, 2], [6, 2], [6, 6], [2, 6]];
const project = {
  formatVersion: 2,
  name: "Through all",
  units: { length: "mm" },
  materials: [],
  links: [],
  workspaces: {
    design: {
      version: 4,
      nextId: 20,
      profiles: [],
      sketches: [
        {
          id: "sketch-3",
          points: corners.map(([x, y], i) => ({ id: `point-${4 + i}`, x, y })),
          curves: corners.map((_, i) => ({ id: `line-${8 + i}`, kind: "line", start: `point-${4 + i}`, end: `point-${4 + ((i + 1) % 4)}` })),
          constraints: [],
        },
      ],
      timeline: {
        features: [
          { id: "feature-1", intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Box 1" }, from: [] }, dependsOn: [], suppressed: false },
          {
            id: "feature-2",
            intent: { type: "move", parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x: 0, y: 0, z: -5 }, summary: "Move Box 1 by (0, 0, −5) mm" },
            provenance: { self: { workspace: "design", id: "feature-2", label: "Move 1" }, from: [{ workspace: "design", id: "feature-1", label: "Box 1" }] },
            dependsOn: ["feature-1"],
            suppressed: false,
          },
          { id: "sketch-3", intent: { type: "sketch", parameters: { plane: "XY" }, summary: "Sketch 1 on the XY plane" }, provenance: { self: { workspace: "design", id: "sketch-3", label: "Sketch 1" }, from: [] }, dependsOn: [], suppressed: false },
        ],
      },
    },
  },
};
const ITEMS = ["feature-1", "feature-2", "sketch-3"];
async function fresh(width, height, tap, query) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "operations.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open", 15000);
  await rebuilt(page);
  return page;
}

/** Extrude opened on Sketch 1 (the newest, chosen by itself), 20 mm typed, its preview built. */
async function extrude(page, tap) {
  await closePanels(page, tap);
  await press(page, "#extrude", tap);
  await until(page, () => document.getElementById("extrude-panel")?.hidden === false, null, "the Extrude panel");
  await until(page, () => /Sketch 1 makes a closed outline/.test(document.getElementById("extrude-status")?.textContent ?? ""), null, "Sketch 1 closed");
  // At phone width the panel waits in the shut sheet: opened, as a person would.
  if (tap) await openPanel(page, "properties", true);
  await page.fill("#extrude-distance", "20");
  await until(page, () => !document.getElementById("extrude-ok").disabled, null, "OK on at 20 mm");
}
const timeline = (page) => page.$$eval("#timeline li[data-item]", (els) => els.map((li) => li.dataset.item));
const previewVolume = (page) => page.$eval("#extrude-panel", (p) => Number(p.dataset.previewVolume));

/** Extrude opened on Sketch 1, 20 mm typed, Cut chosen with Box 1 ticked, then Through all pressed. */
async function throughCut(page, tap) {
  await closePanels(page, tap);
  await press(page, "#extrude", tap);
  await until(page, () => document.getElementById("extrude-panel")?.hidden === false, null, "the Extrude panel");
  await until(page, () => /Sketch 1 makes a closed outline/.test(document.getElementById("extrude-status")?.textContent ?? ""), null, "Sketch 1 closed");
  if (tap) await openPanel(page, "properties", true);
  await page.fill("#extrude-distance", "20");
  await until(page, () => !document.getElementById("extrude-ok").disabled, null, "OK on at 20 mm");
  assert.equal(await page.isDisabled("#extrude-through"), true, "Through all off for a new body");
  await page.selectOption("#extrude-operation", "cut");
  await until(page, () => document.querySelectorAll("#extrude-bodies input[type=checkbox]").length === 1, null, "Box 1 listed");
  await press(page, "#extrude-through", tap);
  assert.equal(await page.getAttribute("#extrude-through", "aria-pressed"), "true");
  assert.equal(await page.isVisible("#extrude-distance"), false, "the box steps aside");
  assert.equal(await page.isVisible("#extrude-through-words"), true);
  assert.equal(await page.isDisabled("#extrude-symmetric"), true, "no Symmetric with Through all");
  // The preview: z 0..6, 16 × 6 = 96 mm³.
  await until(page, () => Math.abs(Number(document.getElementById("extrude-panel").dataset.previewVolume) - 96) < 1e-6, null, "the preview through the box");
  near({ volume: await previewVolume(page), bounds: [] }, 96, [], "preview");
}

async function editItem(page, item) {
  await page.click(`#timeline [data-item="${item}"]`, { button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "the item's menu");
  await page.click("#row-menu-edit");
  await until(page, () => document.getElementById("feature-edit")?.hidden === false, null, "Edit feature open");
}
async function editOk(page) {
  await page.click("#feature-edit-ok");
  await until(page, () => document.getElementById("feature-edit")?.hidden !== false, null, "Edit feature closes");
  await rebuilt(page);
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
  await check("1280 px: Cut through all, then Box 1 made 30 high: the hole still goes right through; let go, it stops at 20 mm", async () => {
    const page = await fresh(1280, 800, false, "&combine");
    try {
      await throughCut(page, false);
      if (shots) await page.screenshot({ path: `${shots}/extrude-through-1280-preview.png` });
      await press(page, "#extrude-ok", false);
      await until(page, () => document.getElementById("extrude-panel")?.hidden === true, null, "the panel closes");
      await rebuilt(page);
      near(await stl(page, false), 920, [[0, 10], [0, 10], [-5, 5]], "cut through all");
      const cut = (await timeline(page)).at(-1);
      assert.match(await page.$eval(`#timeline [data-item="${cut}"]`, (li) => li.title || li.textContent), /through all/, "the item says through all");
      // Box 1 made 30 high: z −5..25.
      await editItem(page, "feature-1");
      await page.fill("#edit-height", "30");
      await editOk(page);
      near(await stl(page, false), 2600, [[0, 10], [0, 10], [-5, 25]], "Box 1 30 high, through all");
      if (shots) await page.screenshot({ path: `${shots}/extrude-through-1280-thicker.png` });
      // Edit the Cut: Through all ticked, the distance greyed; let go, it is the 20 mm typed again.
      await editItem(page, cut);
      await until(page, () => document.getElementById("edit-through")?.checked === true && !document.getElementById("edit-through").disabled, null, "Through all ticked in Edit feature");
      assert.equal(await page.isDisabled("#edit-height"), true, "the distance greyed");
      // The tick boxes drawn as tick boxes, in line with each other (bug hunt 2026-11-18 D-9: the size boxes' 6em width made
      // Symmetric and Through all 80 px wide, their words far from the box).
      const ticks = await page.$$eval("#feature-edit input[type=checkbox]", (all) => all.filter((t) => t.checkVisibility()).map((t) => `${t.id} ${Math.round(t.getBoundingClientRect().width)}`));
      assert.ok(ticks.length >= 2 && ticks.every((t) => Number(t.split(" ")[1]) <= 30), `tick boxes at most 30 px wide: ${ticks.join(", ")}`);
      if (shots) await page.screenshot({ path: `${shots}/extrude-through-1280-edit.png` });
      await page.uncheck("#edit-through");
      await editOk(page);
      near(await stl(page, false), 2680, [[0, 10], [0, 10], [-5, 25]], "let go: 20 mm");
      // One undo step: back through all.
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), 2600, [[0, 10], [0, 10], [-5, 25]], "undone: through all again");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px with taps: Cut through all", async () => {
    const page = await fresh(375, 667, true, "&combine");
    try {
      await throughCut(page, true);
      if (shots) await page.screenshot({ path: `${shots}/extrude-through-375-preview.png` });
      await press(page, "#extrude-ok", true);
      await until(page, () => document.getElementById("extrude-panel")?.hidden === true, null, "the panel closes");
      await rebuilt(page);
      near(await stl(page, true), 920, [[0, 10], [0, 10], [-5, 5]], "cut through all at 375 px");
      if (shots) await page.screenshot({ path: `${shots}/extrude-through-375-done.png` });
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  await server.close();
}
const unexpected = errors.filter((e) => !/favicon/.test(e));
if (unexpected.length > 0) {
  console.log(`not ok - no page errors\n  ${unexpected.join("\n  ")}`);
  failed++;
}
process.exit(failed > 0 ? 1 : 0);
