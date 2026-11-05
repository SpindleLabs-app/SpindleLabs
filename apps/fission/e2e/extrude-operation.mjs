// Browser check of Extrude's Operation row (Fusion's New body, Join, Cut,
// Intersect; extrude-panel.ts, extrude-operation.ts), which shows only with
// `?combine`. The design (opened from a file): Box 1, 10 × 10 × 10 moved
// 5 mm down, so x 0..10, y 0..10, z −5..5, and Sketch 1 on XY, a square
// x 2..6, y 2..6 (16 mm²). Extruded 20 mm up (z 0..20), worked by hand:
// Cut leaves 1,000 − 16 × 5 = 920 mm³ (the part inside the box, z 0..5),
// Join makes 1,000 + 16 × 15 = 1,240 mm³ (the part above it), Intersect
// keeps 16 × 5 = 80 mm³. Each is one Extrude item, one undo step, and
// leaves Box 1 the only body (Body 1). Box 1 unticked, OK is off. Without
// `?combine` there is no Operation row and the extrude is a new body, as
// before. 1280 px with a mouse and 375 px with taps. Screenshots go to
// E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4297, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4297/";
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
  name: "Extrude operations",
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
const AS_MADE = { volume: 1000, bounds: [[0, 10], [0, 10], [-5, 5]] };
const RESULTS = {
  cut: { volume: 920, bounds: [[0, 10], [0, 10], [-5, 5]] },
  join: { volume: 1240, bounds: [[0, 10], [0, 10], [-5, 20]] },
  intersect: { volume: 80, bounds: [[2, 6], [2, 6], [0, 5]] },
};

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
const ticks = (page) => page.$$eval("#extrude-bodies input[type=checkbox]", (els) => els.map((e) => `${e.parentElement.textContent.trim()}:${e.checked}`));
const timeline = (page) => page.$$eval("#timeline li[data-item]", (els) => els.map((li) => li.dataset.item));
const bodyRows = (page) => page.$$eval("[data-body-row], #browser [data-row^='body-']", (els) => els.map((e) => e.textContent.trim()));

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
  await check("without ?combine Extrude has no Operation row and makes a new body, as before", async () => {
    const page = await fresh(1280, 800, false, "");
    try {
      await extrude(page, false);
      assert.equal(await page.$("#extrude-operation"), null, "no Operation row");
      assert.equal(await page.textContent("#extrude-what"), "The extrude is a new body, put in the timeline at the marker.");
      await press(page, "#extrude-ok", false);
      await until(page, () => document.getElementById("extrude-panel")?.hidden === true, null, "the panel closes");
      await rebuilt(page);
      // Two bodies: the box's 1,000 and the new extrude's 16 × 20 = 320, overlapping (z 0..5) but not joined: 1,320 in the STL.
      near(await stl(page, false), 1320, [[0, 10], [0, 10], [-5, 20]], "a new body");
    } finally {
      await page.context().close();
    }
  });

  for (const [width, height, tap, operation] of [[1280, 800, false, "cut"], [1280, 800, false, "intersect"], [375, 667, true, "join"]]) {
    await check(`${width} px${tap ? ", taps" : ""}: ${operation} picked in the Operation row, Box 1 listed and ticked, OK makes one Extrude item, Undo takes it back`, async () => {
      const page = await fresh(width, height, tap, "&combine");
      try {
        near(await stl(page, tap), AS_MADE.volume, AS_MADE.bounds, "as made");
        await extrude(page, tap);
        assert.equal(await page.$eval("#extrude-operation", (s) => s.value), "new", "New body first");
        assert.equal(await page.$eval("#extrude-bodies", (f) => f.hidden), true, "no list for a new body");
        if (shots) await page.screenshot({ path: `${shots}/extrude-operation-${width}-new.png` });
        await page.selectOption("#extrude-operation", operation);
        await until(page, () => document.querySelectorAll("#extrude-bodies input[type=checkbox]").length === 1, null, "Box 1 listed");
        assert.deepEqual(await ticks(page), ["Body 1:true"]);
        const words = { cut: "The extrude is cut from Body 1.", join: "The extrude is joined to Body 1.", intersect: "Only what Body 1 shares with the extrude is kept." }[operation];
        assert.equal(await page.textContent("#extrude-what"), words);
        assert.equal(await page.isDisabled("#extrude-ok"), false);
        // Unticked: OK is off and the panel says why; ticked again, on.
        await press(page, "#extrude-bodies input[type=checkbox]", tap);
        await until(page, () => document.getElementById("extrude-ok").disabled, null, "OK off with nothing ticked");
        assert.match(await page.textContent("#extrude-what"), /^Tick a body to /);
        await press(page, "#extrude-bodies input[type=checkbox]", tap);
        await until(page, () => !document.getElementById("extrude-ok").disabled, null, "OK on again");
        if (shots) await page.screenshot({ path: `${shots}/extrude-operation-${width}-${operation}.png` });
        await press(page, "#extrude-ok", tap);
        await until(page, () => document.getElementById("extrude-panel")?.hidden === true, null, "the panel closes");
        await rebuilt(page);
        const items = await timeline(page);
        assert.equal(items.length, 4, JSON.stringify(items));
        near(await stl(page, tap), RESULTS[operation].volume, RESULTS[operation].bounds, operation);
        if (shots) await page.screenshot({ path: `${shots}/extrude-operation-${width}-${operation}-done.png` });
        await closePanels(page, tap);
        await press(page, "#undo", tap);
        await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, 3, "Undo takes the extrude back");
        await rebuilt(page);
        near(await stl(page, tap), AS_MADE.volume, AS_MADE.bounds, "undone");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("1280 px: at 0 mm the list waits for a distance and OK is off; going down 2 mm the box is still reached", async () => {
    const page = await fresh(1280, 800, false, "&combine");
    try {
      await closePanels(page, false);
      await press(page, "#extrude", false);
      await until(page, () => /Sketch 1 makes a closed outline/.test(document.getElementById("extrude-status")?.textContent ?? ""), null, "Sketch 1 closed");
      await page.selectOption("#extrude-operation", "cut");
      await until(page, () => /^Type a distance or drag the arrow/.test(document.getElementById("extrude-what")?.textContent ?? ""), null, "waits for a distance");
      assert.equal(await page.isDisabled("#extrude-ok"), true);
      // The sketch's plane z = 0 is inside the box (z −5..5), so going down (z 0..−2) reaches it too.
      await page.fill("#extrude-distance", "-2");
      await until(page, () => document.querySelectorAll("#extrude-bodies input[type=checkbox]").length === 1, null, "Box 1 listed going down too");
      assert.equal(await page.isDisabled("#extrude-ok"), false);
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
