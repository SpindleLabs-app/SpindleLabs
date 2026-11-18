// Browser check of Chamfer's drag arrow and its red "won't cut" wedge (Ben,
// 2026-11-16: no more "type a number and blind guess"; workspaces/design
// chamfer-arrow.ts). Box 1, 40 × 30 × 20 at the origin, opened from a file
// with `?chamfer`. Worked by hand: a chamfer of d along the top front edge
// (y = 0, z = 20, x 0..40) takes a right triangle's prism, 40 · d · d / 2, so
// the preview's volume is 24,000 − 20 d²; the arrow stands on one of the
// edge's two faces, its foot d back from the edge's middle (20, 0, 20), so a
// drag along it changes the Distance box (in 0.1 mm steps) and the preview
// follows the box. At 25 mm the chamfer is wider than the 20 mm front face:
// the kernel refuses it, the panel says why in red and the view draws the
// wedge it would cut in see-through red, reaching below the box (z = −5),
// where nothing else is red; at 2 mm none is. An L-bracket's inside corner
// (refused by the kernel) shows its wedge red too. 1280 px with a mouse,
// 375 px with a finger. Screenshots go to E2E_SHOTS when set.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, insertPreset } from "./start.mjs";

const server = await preview({ preview: { port: 4957, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4957/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const view = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
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
const screen = async (page, p) => toScreen(await camera(page), await canvasBox(page), p);
/** Clicks (or taps) the world point `p` as the camera sees it now; fails if something is over the canvas there. */
async function at(page, p, tap = false) {
  await closePanels(page, tap);
  const s = await screen(page, p);
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
/** The canvas's colour at a point on screen (client pixels), a moment after it settles. */
async function pixel(page, { x, y }) {
  await page.waitForTimeout(300);
  return page.evaluate(({ x, y }) => {
    const src = document.querySelector("#viewport canvas");
    const r = src.getBoundingClientRect();
    const dpr = src.width / r.width;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    return Array.from(ctx.getImageData(Math.round((x - r.x) * dpr), Math.round((y - r.y) * dpr), 1, 1).data.slice(0, 3));
  }, { x, y });
}
/** The toolbar's STL's enclosed volume (mm³, the sum over triangles of the signed tetrahedra to the origin). */
async function stlVolume(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  let volume = 0;
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}
/** Red as the refused wedge is drawn (0xff6b6b over the dark view, see-through): red well above green and blue. */
const reddish = ([r, g, b]) => r > g + 40 && r > b + 40;

const features = [
  {
    dependsOn: [],
    id: "feature-1",
    intent: { parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm", type: "box" },
    provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Chamfer arrow check", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const chamfered = (d) => 24000 - (40 * d * d) / 2;
const TOP_FRONT = [20, 0, 20];
const BOTTOM_FRONT = [20, 0, 0];
// Inside the 25 mm wedge's cross-section (y ≥ 0, z ≤ 20, y/25 + (20 − z)/25 ≤ 1: 1/25 + 22/25 = 0.92) and below the box.
const UNDER_BOX = [20, 1, -2];

async function fresh(width, height, tap, file = true) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&chamfer#design`);
  await page.locator("#start-hint").waitFor();
  if (file) {
    await page.setInputFiles("#open-file", { name: "chamfer.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "the file open", 15000);
  }
  await rebuilt(page);
  await settle(page);
  return page;
}
const opened = (page) => until(page, () => document.getElementById("chamfer-panel")?.hidden === false, null, "the Chamfer panel open");
const closed = (page) => until(page, () => document.getElementById("chamfer-panel")?.hidden === true, null, "the Chamfer panel closed");
const edgesSay = (page, want) => until(page, (w) => document.getElementById("chamfer-edges")?.textContent === w, want, `the panel says ${want}`);
const previewSays = (page, volume) => until(page, (w) => (document.getElementById("chamfer-panel")?.dataset.previewVolume ?? "") === w, volume === null ? "" : volume.toFixed(3), `the preview draws ${volume ?? "nothing"}`);
const refusedSays = (page, on) => until(page, (w) => document.getElementById("chamfer-panel")?.dataset.previewRefused === w, String(on), `the preview ${on ? "refused" : "not refused"}`);
const distance = (page) => page.$eval("#chamfer-distance", (b) => b.value);
async function openChamfer(page, tap) {
  await closePanels(page, tap);
  await press(page, "#modify-menu", tap);
  await press(page, "#modify-menu-chamfer", tap);
  await opened(page);
}

/** The arrow's foot and tip on screen, as the main view says. */
async function arrow(page) {
  await until(page, () => (document.querySelector("#viewport").dataset.arrow ?? "") !== "", null, "the arrow drawn");
  const [foot, tip] = (await view(page, "arrow")).split(" ").map((xy) => xy.split(",").map(Number));
  return { foot, tip };
}
/** A drag of the arrow from 0.6 of the way up it, `along` px further along its line on screen, by mouse or finger; waits for the view to hear its end. */
async function dragArrow(page, along, touch) {
  const ended = Number((await view(page, "arrowDrags")) || 0) + 1;
  const { foot, tip } = await arrow(page);
  const len = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
  const u = [(tip[0] - foot[0]) / len, (tip[1] - foot[1]) / len];
  const from = [foot[0] + 0.6 * (tip[0] - foot[0]), foot[1] + 0.6 * (tip[1] - foot[1])];
  const steps = 12;
  const step = (k) => [from[0] + (along * k * u[0]) / steps, from[1] + (along * k * u[1]) / steps];
  if (!touch) {
    await page.mouse.move(...from);
    await until(page, () => document.querySelector("#viewport").dataset.arrowHot === "true", null, "the arrow lit under the pointer");
    await page.mouse.down();
    for (let k = 1; k <= steps; k++) await page.mouse.move(...step(k));
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    const touchAt = (type, [x, y]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touchAt("touchStart", from);
    for (let k = 1; k <= steps; k++) await touchAt("touchMove", step(k));
    await touchAt("touchEnd", step(steps));
  }
  await until(page, (n) => Number(document.querySelector("#viewport").dataset.arrowDrags ?? 0) >= n, ended, "the drag's end heard by the view");
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
  for (const { width, height, touch } of [{ width: 1280, height: 800, touch: false }, { width: 375, height: 667, touch: true }]) {
    const how = `${width} px${touch ? ", taps and a finger" : ", a mouse"}`;
    await check(`${how}: the arrow on the picked edge, dragged out sets the Distance in 0.1 mm steps with the preview following; dragged back stops at 0.1 mm; picking still works; Enter or Finish makes the size dragged`, async () => {
      const page = await fresh(width, height, touch);
      try {
        await openChamfer(page, touch);
        assert.equal(await view(page, "arrow"), "", "no arrow with no edge");
        await at(page, TOP_FRONT, touch);
        await edgesSay(page, "1 edge");
        await previewSays(page, chamfered(1));
        const { foot, tip } = await arrow(page);
        // The arrow's foot is 1 mm back from the edge's middle along one of its faces: (20, 1, 20) or (20, 0, 19) on screen.
        const near = (a, b) => Math.hypot(a[0] - b.x, a[1] - b.y);
        const footOk = Math.min(near(foot, await screen(page, [20, 1, 20])), near(foot, await screen(page, [20, 0, 19])));
        assert.ok(footOk < 3, `the foot ${foot} is ${footOk.toFixed(1)} px from where it should be`);
        if (shots) await page.screenshot({ path: `${shots}/chamfer-arrow-${width}-picked.png` });
        // Dragged out along itself: the Distance grows, a multiple of 0.1, and the preview is the kernel's at that size.
        await dragArrow(page, touch ? 40 : 60, touch);
        const d = Number(await distance(page));
        assert.ok(d > 1 && d < 15, `the dragged distance ${d}`);
        assert.ok(Math.abs(d * 10 - Math.round(d * 10)) < 1e-9, `${d} is in 0.1 mm steps`);
        await previewSays(page, chamfered(d));
        await refusedSays(page, false);
        if (shots) await page.screenshot({ path: `${shots}/chamfer-arrow-${width}-dragged.png` });
        // Back past the edge: it stops at 0.1 mm, never 0 or less.
        await dragArrow(page, -(touch ? 400 : 900), touch);
        assert.equal(await distance(page), "0.1");
        await previewSays(page, chamfered(0.1));
        // Typed, the arrow follows the box: at 3 mm its foot is 3 mm back.
        if (touch && (await page.getAttribute("#properties-toggle", "aria-expanded")) !== "true") await page.tap("#properties-toggle");
        await page.locator("#chamfer-distance").fill("3");
        await previewSays(page, chamfered(3));
        await until(page, () => document.querySelector("#viewport").dataset.extrudeDistance === "3", null, "the arrow at 3 mm");
        // Picking goes on with the arrow shown: the bottom front edge added (24,000 − 2 · 40 · 9 / 2 = 23,640).
        await at(page, BOTTOM_FRONT, touch);
        if (shots) await page.screenshot({ path: `${shots}/chamfer-arrow-${width}-two.png` });
        await edgesSay(page, "2 edges");
        await previewSays(page, 24000 - 2 * ((40 * 3 * 3) / 2));
        // Taken out again by its chamfer's face as drawn, (8, 1.5, 1.5) halfway across the 3 mm cut (the edge itself is cut
        // away), away from the arrow, which now stands on this edge's middle and takes a press near it as a drag.
        await at(page, [8, 1.5, 1.5], touch);
        await edgesSay(page, "1 edge");
        await previewSays(page, chamfered(3));
        // A drag, then OK: the size dragged is recorded.
        await dragArrow(page, touch ? 20 : 30, touch);
        const made = Number(await distance(page));
        assert.ok(made > 3, `dragged on to ${made}`);
        await previewSays(page, chamfered(made));
        if (touch) await page.tap("#float-finish");
        else await page.keyboard.press("Enter");
        await closed(page);
        await rebuilt(page);
        await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 2, null, "Chamfer 1 recorded");
        assert.equal(await view(page, "arrow"), "", "the arrow goes with the tool");
        const got = await stlVolume(page, touch);
        assert.ok(Math.abs(got - chamfered(made)) <= 0.05, `the STL holds ${got}, want ${chamfered(made)} for ${made} mm`);
      } finally {
        await page.context().close();
      }
    });

    await check(`${how}: a chamfer too wide for the 20 mm front face is drawn as a red wedge reaching below the box, with the kernel's words in red; a size that fits draws none`, async () => {
      const page = await fresh(width, height, touch);
      try {
        await openChamfer(page, touch);
        await at(page, TOP_FRONT, touch);
        await edgesSay(page, "1 edge");
        await previewSays(page, chamfered(1));
        const probe = await screen(page, UNDER_BOX);
        assert.ok(!reddish(await pixel(page, probe)), "no red below the box at 1 mm");
        if (touch && (await page.getAttribute("#properties-toggle", "aria-expanded")) !== "true") await page.tap("#properties-toggle");
        await page.locator("#chamfer-distance").fill("25");
        await refusedSays(page, true);
        await previewSays(page, null);
        assert.equal(await view(page, "extrudePreview"), "true", "the wedge drawn");
        const words = await page.$eval("#chamfer-preview-why", (p) => ({ hidden: p.hidden, text: p.textContent, bad: p.classList.contains("bad"), colour: getComputedStyle(p).color }));
        assert.equal(words.hidden, false);
        assert.ok(words.bad && words.text.length > 10, JSON.stringify(words));
        if (touch) await closePanels(page, true);
        const red = await pixel(page, probe);
        assert.ok(reddish(red), `red below the box at 25 mm: ${red}`);
        if (shots) await page.screenshot({ path: `${shots}/chamfer-arrow-${width}-too-wide.png` });
        // Back to 2: no wedge, no red words, no red below the box.
        if (touch && (await page.getAttribute("#properties-toggle", "aria-expanded")) !== "true") await page.tap("#properties-toggle");
        await page.locator("#chamfer-distance").fill("2");
        await previewSays(page, chamfered(2));
        await refusedSays(page, false);
        assert.equal(await view(page, "extrudePreview"), "false", "no wedge");
        assert.equal(await page.$eval("#chamfer-preview-why", (p) => p.hidden), true);
        if (touch) await closePanels(page, true);
        assert.ok(!reddish(await pixel(page, probe)), "no red below the box at 2 mm");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("1280 px: an L-bracket's inside corner, which the kernel refuses, is drawn as a red wedge in the empty corner with its words", async () => {
    const page = await fresh(1280, 800, false, false);
    try {
      // The L-bracket 40 × 30 × 20: its inside edge is the upright one at (12, 9), z 0..20.
      await insertPreset(page, "l-bracket");
      await rebuilt(page);
      await settle(page);
      // Orbited round to look into the L's inside corner (the home view sees the L from outside): a left drag across empty space.
      await page.mouse.move(300, 650);
      await page.mouse.down();
      await page.mouse.move(800, 650, { steps: 20 });
      await page.mouse.up();
      await settle(page);
      await openChamfer(page, false);
      await at(page, [12, 9, 10]);
      await edgesSay(page, "1 edge");
      await refusedSays(page, true);
      assert.match(await page.textContent("#chamfer-preview-why"), /inside corner/);
      assert.equal(await view(page, "extrudePreview"), "true", "the wedge drawn");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-arrow-1280-inside-corner.png` });
      // The 1 mm wedge lies in the empty corner, its cross-section (12, 9), (13, 9), (12, 10) or so: its middle,
      // (12.33, 9.33, 10), is drawn redder than grey (a thin strip, so less red than the 25 mm wedge), and grey once Cancel
      // takes it away (the control).
      const probe = await screen(page, [12.33, 9.33, 10]);
      const red = await pixel(page, probe);
      assert.ok(red[0] > red[1] + 15 && red[0] > red[2] + 10, `red in the corner: ${red}`);
      // OK refuses in the same words and records nothing.
      await page.keyboard.press("Enter");
      await until(page, () => /inside corner/.test(document.getElementById("chamfer-error")?.textContent ?? ""), null, "OK refuses in words");
      assert.equal(await page.$$eval("#timeline li[data-item]", (l) => l.length), 1);
      await page.click("#chamfer-cancel");
      await closed(page);
      const grey = await pixel(page, probe);
      assert.ok(Math.abs(grey[0] - grey[1]) < 12, `grey in the corner once cancelled: ${grey}`);
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  server.httpServer.close();
}

if (errors.length) {
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
  failed++;
}
if (failed) process.exit(1);
