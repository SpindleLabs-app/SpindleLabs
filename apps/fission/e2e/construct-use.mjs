// Browser check of using construction planes (step 59a3, behind ?construct): a file holds Box 1 (40 x 30 x 20 at
// the origin) and Plane 1, offset -30 mm from the YZ plane (x = -30, facing +x). Create sketch offers Plane 1 with
// the origin's planes (data-planes "construct:feature-2"); a click (or tap) on it makes "Sketch 1 on Plane 1", looked
// at straight along x; a 20 x 10 rectangle drawn on it at y 0..20, z 0..10 and extruded 5 mm is x -30..-25 (worked by
// hand: the sketch faces +x). Then the box picked and Modify > Mirror body > Across Plane 1 makes Mirror 1: the box
// mirrored in x = -30 (x -> -60 - x) is x -100..-60, so the STL of everything is x -100..40, y 0..30, z 0..20. The
// Construction folder lists Plane 1 with an eye; shutting it hides the plane from the view and from Create sketch, as
// one undo step. 1280 px with a mouse, 375 px with taps. Screenshots go to E2E_SHOTS when set.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, gridSnapOn, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4966, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4966/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
/** The Design data version the file is written in (26: constructions; the rest is the app's own). */
const DESIGN_FILE_VERSION = 26;

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
  {
    dependsOn: [],
    id: "feature-2",
    intent: { parameters: { make: "offset_plane", inputs: { plane: "YZ" }, distance: -30, answer: { kind: "plane", point: [-30, 0, 0], normal: [1, 0, 0], near: [-30, 0, 0] } }, summary: "Offset plane, -30 mm", type: "construct" },
    provenance: { from: [], self: { id: "feature-2", label: "Plane 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Construct use", units: { length: "mm" }, workspaces: { design: { nextId: 3, profiles: [], sketches: [], version: DESIGN_FILE_VERSION, timeline: { features } } } };

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&construct#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "construct-use.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 2, null, "the file open", 15000);
  await rebuilt(page);
  await settle(page);
  return page;
}

const items = (page, n) => until(page, (k) => document.querySelectorAll("#timeline li[data-item]").length === k, n, `${n} timeline items`);
const near = (got, want, what) => got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-3, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** The toolbar's STL: [min, max] of its corners for x, y and z (mm). */
async function stlBounds(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) pts.push([0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
  return [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]);
}

/** Where Plane 1 is drawn: round its `near`, as the kernel answers it (the file's own answer may be a guess). */
const planeNear = (page) => page.evaluate(() => window.fissionTest.kernelCall("body_construct", { kind: "offset_plane", plane: { plane: { point: [0, 0, 0], normal: [1, 0, 0] } }, distance: -30 }).then((a) => a.near));

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
    const how = `${width} px${tap ? ", taps" : ""}`;
    await check(`${how}: Create sketch offers Plane 1; a sketch on it, a rectangle extruded 5 mm is x -30..-25; Mirror body across Plane 1 is x -100..-60`, async () => {
      const page = await fresh(width, height, tap);
      try {
        const n = await planeNear(page);
        assert.ok(Math.abs(n[0] + 30) < 1e-9, `Plane 1 is drawn on x = -30: ${n}`);
        await closePanels(page, tap);
        await press(page, "#create-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ, construct:feature-2", null, "the origin's planes and Plane 1 offered");
        if (shots) await page.screenshot({ path: `${shots}/construct-use-offered-${width}.png` });
        // The panel offers Plane 1 by name after the origin's planes.
        assert.equal(await page.$eval("#sketch-plane-construct-feature-2", (b) => b.textContent.trim()), "Plane 1");
        // A point of Plane 1's square a little off its middle, away from the box; on a phone the plane is off screen,
        // so the bar's Plane 1 (proxying the panel's button) picks it.
        if (!tap) await at(page, [n[0], n[1] + 4, n[2] + 4]);
        else {
          assert.equal(await page.$eval("#float-plane-construct-feature-2", (b) => b.textContent.trim()), "Plane 1");
          await page.tap("#float-plane-construct-feature-2");
        }
        await items(page, 3);
        const last = () => page.$$eval("#timeline li[data-item]", (lis) => ({ item: lis.at(-1).dataset.item, tip: lis.at(-1).title || lis.at(-1).dataset.tip || lis.at(-1).textContent }));
        const { item, tip } = await last();
        assert.equal(item, "sketch-3");
        assert.match(tip, /Sketch 1/);
        // Looked at straight along the plane's normal (x).
        const cam = await settle(page);
        const f = unit(sub(cam.target, cam.position));
        assert.ok(Math.abs(Math.abs(f[0]) - 1) < 1e-6, `looking along x: ${f}`);
        await openPanel(page, "properties", tap);
        await gridSnapOn(page);
        await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0));
        const corners = [[-30, 0, 0], [-30, 20, 0], [-30, 20, 10], [-30, 0, 10]];
        if (!tap) for (const p of [...corners, corners[0]]) await at(page, p);
        else {
          await page.tap("#sketch-tool-rectangle");
          for (const p of [corners[2], corners[0]]) await at(page, p, true);
        }
        if (shots) await page.screenshot({ path: `${shots}/construct-use-sketch-${width}.png` });
        await openPanel(page, "properties", tap);
        await press(page, "#sketch-extrude", tap);
        await page.fill("#extrude-distance", "5");
        await press(page, "#extrude-ok", tap);
        await items(page, 4);
        await rebuilt(page);
        // The sketch faces +x (the plane's normal): 5 mm from x = -30 is x = -25. The box is x 0..40.
        near(await stlBounds(page, tap), [[-30, 40], [0, 30], [0, 20]], "the STL with the extrude on Plane 1");
        await settle(page);
        // The box picked by its top's middle, then Mirror body across Plane 1.
        await at(page, [20, 15, 20], tap);
        await until(page, () => document.body.dataset.selection === "face:feature-1/top", null, "the box's top picked");
        await closePanels(page, tap);
        await press(page, "#modify-menu", tap);
        await until(page, () => !document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ opens");
        assert.equal(await page.$eval("#modify-menu-mirror-construct-feature-2", (b) => b.textContent.trim()), "Across Plane 1");
        if (shots) await page.screenshot({ path: `${shots}/construct-use-mirror-menu-${width}.png` });
        await press(page, "#modify-menu-mirror-construct-feature-2", tap);
        await items(page, 5);
        await rebuilt(page);
        // Mirrored in x = -30: x -> -60 - x, so the box's 0..40 is -100..-60.
        near(await stlBounds(page, tap), [[-100, 40], [0, 30], [0, 20]], "the STL with the box's mirror across Plane 1");
        if (shots) await page.screenshot({ path: `${shots}/construct-use-mirrored-${width}.png` });
      } finally {
        await page.context().close();
      }
    });

    await check(`${how}: the Construction folder lists Plane 1 with an eye; shut, the plane is gone from the view and from Create sketch, one undo step`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await openPanel(page, "browser", tap);
        const eye = '[data-eye="constructions/feature-2"]';
        await until(page, (sel) => document.querySelector(sel) !== null, eye, "Plane 1's eye");
        assert.equal(await page.$eval(eye, (b) => b.getAttribute("aria-pressed")), "true", "shown at first");
        if (shots) await page.screenshot({ path: `${shots}/construct-use-eye-${width}.png` });
        await press(page, eye, tap);
        await until(page, (sel) => document.querySelector(sel)?.getAttribute("aria-pressed") === "false", eye, "Plane 1 hidden");
        assert.match(await page.getAttribute("#undo", "title"), /Hide Plane 1/);
        await closePanels(page, tap);
        await press(page, "#create-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "only the origin's planes offered");
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  await server.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
