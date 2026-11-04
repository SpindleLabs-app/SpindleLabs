// Browser check of changing which bodies an edited Move moves (35e2i): Box
// 1 (40 × 30 × 20 at the origin) and Cylinder 1 (⌀40 × 20 standing on the
// origin), Move 1 sliding Box 1 50 along x; then Move 1 edited, the
// cylinder clicked (or tapped) in, the box clicked out, OK. The STL's
// bounds, worked by hand: before the edit the box spans x 50..90, y 0..30
// and the cylinder x −20..20, y −20..20, so x −20..90, y −20..30, z 0..20;
// after it the box is back at x 0..40 and the cylinder slid to x 30..70,
// so x 0..70, y −20..30 (with the bodies kept it would stay −20..90). 1280
// px with a mouse and 375 px with taps. Screenshots go to E2E_SHOTS when
// set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, insertPreset, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4253, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4253/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
  await nextFrame(page);
}

// The pinhole camera (face-sketch.mjs's sums): forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field of view.
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
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}
/** Waits until the camera holds still. */
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

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await startWithBox(page, touch);
  return sheetsClearFor(page);
}

/** Move 1's Edit feature, from its timeline item's menu (right-click, or its ⋯ on a phone). */
async function editMove(page, tap) {
  const item = page.locator('#timeline [data-item="feature-3"]');
  if (tap) {
    if (!(await page.isVisible('#timeline [data-more="feature-3"]'))) await (await closePanels(page, true), item.tap());
    await page.tap('#timeline [data-more="feature-3"]');
  } else await item.click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
  await press(page, "#row-menu-edit", tap);
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

const named = (page, want, what) => until(page, (w) => { const el = document.getElementById("move-bodies"); return !el?.hidden && el?.textContent === w; }, want, what);

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: an edited Move takes the cylinder in and the box out, and OK builds that`, async () => {
      const page = await fresh(width, height, tap);
      try {
        // Cylinder 1 inserted beside Box 1: 24,000 + π · 20² · 20 ≈ 49,133 mm³.
        await insertPreset(page, "cylinder", tap);
        await until(page, () => document.querySelector("#volume")?.textContent !== "24,000 mm³", null, "the cylinder built");
        await rebuilt(page);
        near(await stlBounds(page, tap), [[-20, 40], [-20, 30], [0, 20]], "both as made");
        // Move 1: Box 1 picked in the top view (its corner (35, 25) is outside the cylinder's circle), 50 along x.
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await page.evaluate(() => document.activeElement?.blur());
        if (tap) await press(page, "#move", tap);
        else await page.keyboard.press("m");
        await opened(page);
        await at(page, [35, 25, 20], tap);
        await named(page, "Body: Box 1", "Box 1 picked");
        await page.fill("#move-x", "50");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[-20, 90], [-20, 30], [0, 20]], "Box 1 slid 50");
        // Move 1 edited: the cylinder clicked in (its top at (−10, −10)), drawn slid before OK; the box clicked out (its top at (80, 20)).
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await editMove(page, tap);
        await named(page, "Body: Box 1", "the edit opens on Box 1");
        await at(page, [-10, -10, 20], tap);
        await named(page, "Bodies: Box 1, Cylinder 1", "the cylinder put in");
        await at(page, [80, 20, 20], tap);
        await named(page, "Body: Cylinder 1", "the box taken out");
        if (shots) await page.screenshot({ path: `${shots}/move-bodies-${width}.png` });
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[0, 70], [-20, 30], [0, 20]], "the box back at the origin, the cylinder slid 50 (with the bodies kept it would reach −20..90)");
      } finally {
        await page.context().close();
      }
    });
  }
  // Bug hunt 2026-11-04 (E1): Snap in an edited Move onto a body just clicked out of it. Move 1 slides both bodies
  // 100 along x; edited, the cylinder clicked out (the preview draws it back at the origin); Snap, the box's top,
  // then the cylinder's top where it is drawn. Worked by hand: a face lands on a face facing it, so the box is turned
  // half a turn about X and its top centre lands on the cylinder's top centre (0, 0, 20): the box spans x −20..20,
  // y −15..15, z 20..40, the cylinder (out of the Move) x −20..20, y −20..20, z 0..20; together x −20..20, y −20..20,
  // z 0..40. Before the fix the box landed where Move 1 had put the cylinder, x 80..120.
  await check("1280 px: Snap in an edited Move onto a body taken out of it lands on that body where it is drawn", async () => {
    const page = await fresh(1280, 800, false);
    try {
      await insertPreset(page, "cylinder", false);
      await until(page, () => document.querySelector("#volume")?.textContent !== "24,000 mm³", null, "the cylinder built");
      await rebuilt(page);
      await page.click('[data-view="top"]');
      await settle(page);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("m");
      await opened(page);
      await at(page, [35, 25, 20]);
      await named(page, "Body: Box 1", "Box 1 picked");
      await at(page, [-10, -10, 20]);
      await named(page, "Bodies: Box 1, Cylinder 1", "the cylinder picked too");
      await page.fill("#move-x", "100");
      await page.click("#move-ok");
      await closed(page);
      await rebuilt(page);
      await page.click('[data-view="top"]');
      await settle(page);
      await editMove(page, false);
      await named(page, "Bodies: Box 1, Cylinder 1", "the edit opens on both");
      await at(page, [90, -10, 20]); // the cylinder where Move 1 put it
      await named(page, "Body: Box 1", "the cylinder clicked out");
      await nextFrame(page);
      // Zoomed out so the origin, where the cylinder is drawn now, is on screen too.
      const b = await canvasBox(page);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 300);
      await settle(page);
      await page.click("#move-snap");
      await at(page, [120, 15, 20]); // the box's top, drawn still slid 100
      await at(page, [0, 0, 20]); // the cylinder's top, drawn back at the origin
      await page.click("#move-ok");
      await closed(page);
      await rebuilt(page);
      near(await stlBounds(page, false), [[-20, 20], [-20, 20], [0, 40]], "the box upside down on the cylinder where the cylinder ends up");
    } finally {
      await page.context().close();
    }
  });
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
