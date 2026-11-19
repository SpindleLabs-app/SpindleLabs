// SL #819 D-10 (app bug hunt 2026-11-18): when an edit makes the part outgrow the view, Design fits it again by
// itself (workspace.ts needsRefit). That fit turned the camera back to the home three-quarter angle, so a person
// working in Top was spun round. As the Fit button does since PR #801, it now keeps the angle the person looks from;
// only a new part (another shape) is framed from the home view.
// By hand: a 40 × 30 × 20 box seen from Top looks straight down, the camera's direction from the target (0, 0, 1).
// Width 400 makes the box ten times wider, past the view: the camera moves back along (0, 0, 1) and stays looking
// down. Width 45 still fits, so the camera does not move at all (the control).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4419, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4419/?test-hooks";
const browser = await launch();
const errors = [];
let failed = 0;

const features = [{ dependsOn: [], id: "feature-1", intent: { parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm", type: "box" }, provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } }, suppressed: false }];
const project = { formatVersion: 2, links: [], materials: [], name: "Refit", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
/** The unit direction from the camera's target to the camera. */
const direction = (c) => {
  const d = c.position.map((x, i) => x - c.target[i]);
  const n = Math.hypot(...d);
  return d.map((x) => x / n);
};
/** The camera once it has stopped moving (a view change animates). */
async function still(page) {
  let last = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last !== null && same(now, last)) return now;
    last = now;
  }
  assert.fail("the camera never came to rest");
}
/** Two cameras within a micrometre of each other (a view change's last frames). */
const same = (a, b) => ["position", "target"].every((k) => a[k].every((x, i) => Math.abs(x - b[k][i]) < 1e-3));
const near = (a, b, what) => assert.ok(a.every((x, i) => Math.abs(x - b[i]) < 1e-4), `${what}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "refit.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "the file open");
  await sheetsClearFor(page);
  return page;
}
async function typeWidth(page, value) {
  await pinProperties(page);
  await page.fill("#width", String(value));
  await page.press("#width", "Enter");
  await until(page, (v) => (document.querySelector("#volume")?.textContent ?? "").replace(/[^0-9]/g, "") === String(v), value * 30 * 20, `the volume ${value * 600} mm³`);
}

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
    await check(`${width} px${tap ? ", taps" : ""}: a width typed past the view keeps the Top view; one that fits leaves the camera`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await still(page);
        await press(page, '[data-view="top"]', tap);
        const top = await still(page);
        near(direction(top), [0, 0, 1], "Top looks straight down");
        const fits = await page.evaluate(() => document.querySelector("#viewport").dataset.fits);
        await typeWidth(page, 45);
        const kept = await still(page);
        assert.ok(same(kept, top), `45 still fits: the camera stays where it was (${JSON.stringify(kept)} against ${JSON.stringify(top)})`);
        await typeWidth(page, 400);
        const after = await still(page);
        assert.notEqual(await page.evaluate(() => document.querySelector("#viewport").dataset.fits), fits, "400 is past the view: it was fitted again");
        near(direction(after), [0, 0, 1], "and still looks straight down, as Top does");
        assert.ok(Math.hypot(...after.position.map((x, i) => x - after.target[i])) > Math.hypot(...top.position.map((x, i) => x - top.target[i])), "from further back");
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/refit-angle-${width}.png` });
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  server.httpServer.close();
}

if (errors.length) {
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
  failed++;
}
if (failed) process.exit(1);
