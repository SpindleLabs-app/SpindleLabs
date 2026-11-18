// Browser check of the symmetric extrude (step 53a1): a file with a small box and a 40 × 30 rectangle sketched on XY
// (x −60..−20, y 0..30, 1200 mm²). Extrude, Symmetric pressed: Flip greyed, a typed distance previewed at 1200 × d mm³, the
// arrow dragged to a whole number of mm (each side half of it); OK makes the body, one undo step, and the STL's corners round
// the rectangle span z −d/2..d/2 (worked by hand: half each way from the plane z = 0; a one-way extrude would be 0..d).
// 1280 px with a mouse (10 mm: z −5..5) and 375 px with taps and a finger (8 mm: z −4..4). Screenshots go to E2E_SHOTS when
// set. Run with `npm run e2e` (after `npm run build`). Helpers as extrude-drag.mjs's.
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { closePanels, openPanel, sheetsClearFor } from "./start.mjs";
import { readFileSync } from "node:fs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4267, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4267/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

/** The box (feature-1, 10 × 10 × 10 from the origin): the middle of its top face, and its six faces' names as Extrude offers them. */
const BOX = { top: [5, 5, 10] };
const BOX_FACES = ["bottom", "top", "front", "back", "left", "right"].map((f) => `face:feature-1/${f}`).join(" ");
const RECT = { id: "sketch-2", corners: [[-60, 0], [-20, 0], [-20, 30], [-60, 30]], centre: [-40, 15, 0], area: 1200 };
const item = (id, label) => ({ id, intent: { type: "sketch", parameters: { plane: "XY" }, summary: `${label} on the XY plane` }, provenance: { self: { workspace: "design", id, label }, from: [] }, dependsOn: [], suppressed: false });
const project = {
  formatVersion: 2,
  name: "Extrude drag",
  units: { length: "mm" },
  materials: [],
  links: [],
  workspaces: {
    design: {
      version: 3,
      nextId: 20,
      profiles: [],
      sketches: [
        {
          id: RECT.id,
          points: RECT.corners.map(([x, y], i) => ({ id: `point-${3 + i}`, x, y })),
          curves: RECT.corners.map((_, i) => ({ id: `line-${7 + i}`, kind: "line", start: `point-${3 + i}`, end: `point-${3 + ((i + 1) % 4)}` })),
          constraints: [],
        },
      ],
      timeline: {
        features: [
          { id: "feature-1", intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Feature 1 (box)" }, from: [] }, dependsOn: [], suppressed: false },
          item(RECT.id, "Sketch 1"),
        ],
      },
    },
  },
};

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForSelector("#start-hint", { state: "visible", timeout: 15000 });
  await page.setInputFiles("#open-file", { name: "drag.fission.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await untilBodies(page, 1, "the box built");
  // The kernel holding the box is not the box drawn: wait for the view to frame it and no rebuild to be running,
  // so a pixel read now is the box's and Extrude finds its faces (slow-kernel flake, E2E_KERNEL_DELAY seed 1).
  await page.waitForFunction(() => {
    const v = document.querySelector("#viewport");
    return Number(v.dataset.fits ?? 0) >= 1 && v.dataset.rebuilding !== "true";
  }, null, { timeout: 15000 }).catch(() => assert.fail("the box drawn: timed out"));
  return sheetsClearFor(page); // phone: sheets (U5b) open for what is inside them and close before the view's, Undo's or the timeline's buttons are pressed
}

const until = (page, fn, arg, what, state) =>
  page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out${state ? `; ${await state(page).catch((e) => `(state unreadable: ${e.message})`)}` : ""}`));
/** What the panel and the view show, for a timed-out wait's message: so a flake on CI says what it saw. */
const panelState = (page) =>
  page.evaluate(async () => {
    const q = (s) => document.querySelector(s);
    const panel = q("#extrude-panel");
    return JSON.stringify({
      volume: q("#volume")?.textContent,
      panel: panel?.hidden ? "hidden" : "shown",
      distance: q("#extrude-distance")?.value,
      ok: q("#extrude-ok") ? (q("#extrude-ok").disabled ? "off" : "on") : "gone",
      status: q("#extrude-status")?.textContent,
      error: q("#extrude-error")?.textContent,
      undo: q("#undo")?.title,
      bodies: await window.fissionTest?.bodyCount(),
      rebuilding: q("#viewport")?.dataset.rebuilding,
      offered: q("#viewport")?.dataset.extrudeProfiles,
    });
  });
const view = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const undoTitle = (page) => page.evaluate(() => document.getElementById("undo").title);

/** Where a model point is on screen in the main view: the camera as the viewport keeps it, 45° high, the canvas's aspect. */
async function screen(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const box = await page.locator("#viewport canvas").boundingBox();
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => a.map((x) => x / Math.hypot(...a));
  const fwd = unit(sub(cam.target, cam.position));
  const right = unit(cross(fwd, cam.up));
  const up = cross(right, fwd);
  const v = sub(p, cam.position);
  const t = Math.tan(Math.PI / 8);
  const x = dot(v, right) / (dot(v, fwd) * t * (box.width / box.height));
  const y = dot(v, up) / (dot(v, fwd) * t);
  return { x: box.x + ((x + 1) / 2) * box.width, y: box.y + ((1 - y) / 2) * box.height };
}

/** The pointer moved to a model point; waits until the viewport lights `want` there ("" for nothing). */
async function hoverAt(page, p, want) {
  const s = await screen(page, p);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, s), "CANVAS", `(${p}) is on the view, not under a panel`);
  await page.mouse.move(s.x, s.y);
  await until(page, (w) => (document.querySelector("#viewport").dataset.extrudeHover ?? "") === w, want, `the pointer at (${p}) lights "${want}"`);
  return s;
}

/** The arrow's foot and tip on screen, as the main view says. */
async function arrow(page) {
  // The panel's preview volume is set before the viewer next draws the arrow, so wait for it rather than read at once.
  await until(page, () => (document.querySelector("#viewport").dataset.arrow ?? "") !== "", null, "the arrow drawn");
  const said = await view(page, "arrow");
  assert.ok(said, "the arrow is drawn");
  const [foot, tip] = said.split(" ").map((xy) => xy.split(",").map(Number));
  return { foot, tip };
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

/** A drag of the arrow from 0.6 of the way up it, `along` px further along its line on screen (negative back down), by mouse or by finger. */
async function dragArrow(page, along, touch, during) {
  const ended = Number(await view(page, "arrowDrags")) + 1;
  await sendDrag(page, along, touch, during);
  // The browser may still be handing the page the moves sent (a finger's moves come once a frame):
  // only once the drag's end is heard is the distance the drag's last one (merge-queue flake, 2026-10-26).
  await until(page, (n) => Number(document.querySelector("#viewport").dataset.arrowDrags ?? 0) >= n, ended, "the drag's end heard by the view");
}

/** `during`, if given, runs while the arrow is still held, after the last move. */
async function sendDrag(page, along, touch, during) {
  const { foot, tip } = await arrow(page);
  const len = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
  const u = [(tip[0] - foot[0]) / len, (tip[1] - foot[1]) / len];
  const from = [foot[0] + 0.6 * (tip[0] - foot[0]), foot[1] + 0.6 * (tip[1] - foot[1])];
  const steps = 12;
  const at = (k) => [from[0] + (along * k * u[0]) / steps, from[1] + (along * k * u[1]) / steps];
  if (!touch) {
    await page.mouse.move(...from);
    await until(page, () => document.querySelector("#viewport").dataset.arrowHot === "true", null, "the arrow lit under the pointer");
    await page.mouse.down();
    for (let k = 1; k <= steps; k++) await page.mouse.move(...at(k));
    if (during) await during();
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touchAt = (type, [x, y]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touchAt("touchStart", from);
  for (let k = 1; k <= steps; k++) await touchAt("touchMove", at(k));
  if (during) await during();
  await touchAt("touchEnd", at(steps));
}

/** The camera unmoved: the same to 1e-6 mm (the view works its pose out again each frame, to a few ulps). */
function stayed(now, was, what) {
  const flat = (c) => [...c.position, ...c.target, ...c.up];
  assert.ok(flat(now).every((v, k) => Math.abs(v - flat(was)[k]) <= 1e-6), `${what}: ${JSON.stringify(was)} to ${JSON.stringify(now)}`);
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


/** The toolbar's STL: [min, max] of x, y and z (mm) over the corners left of x = −15 (the extrude, not the box). */
async function extrudeBounds(page, touch) {
  await closePanels(page, touch);
  const [dl] = await Promise.all([page.waitForEvent("download"), touch ? page.tap("#toolbar [data-op=export_stl]") : page.click("#toolbar [data-op=export_stl]")]);
  const bytes = readFileSync(await dl.path());
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) pts.push([0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
  const left = pts.filter((p) => p[0] < -15);
  return [0, 1, 2].map((i) => [Math.min(...left.map((p) => p[i])), Math.max(...left.map((p) => p[i]))]);
}
const nearAll = (got, want, what) => got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-3, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

try {
  for (const { width, touch, d } of [{ width: 1280, touch: false, d: 10 }, { width: 375, touch: true, d: 8 }]) {
    const how = `${width} px${touch ? ", taps and a finger" : ""}`;
    await check(`Symmetric: Flip greyed, the preview at 1200 × d, a dragged arrow, OK makes it half each way from the plane (${how})`, async () => {
      const page = await fresh(width, touch);
      const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
      await press("#extrude");
      await until(page, (want) => document.querySelector("#viewport").dataset.extrudeProfiles === want, `${RECT.id} ${BOX_FACES}`, "the rectangle offered, then the box's faces", panelState);
      assert.equal(await page.textContent("#extrude-profile"), "Sketch 1");
      if (touch) await openPanel(page, "properties", true);
      await page.fill("#extrude-distance", "-6");
      await press("#extrude-symmetric");
      assert.equal(await page.getAttribute("#extrude-symmetric", "aria-pressed"), "true");
      assert.equal(await page.isDisabled("#extrude-flip"), true, "no Flip while symmetric");
      assert.equal(await page.inputValue("#extrude-distance"), "6", "a negative distance made positive");
      await until(page, () => document.querySelector("#extrude-panel").dataset.previewVolume === "7200", null, "the preview at 6 mm", panelState);
      if (shots) await page.screenshot({ path: `${shots}/symmetric-preview-${width}.png` });
      // The arrow stands on the plane, half the thickness long: dragged up, the distance is a whole number of mm, never negative.
      if (touch) await closePanels(page, true);
      // Grabbed and let go on the same spot, nothing was dragged: still 6 (it became 12, then 24: app-wide hunt 2026-11-14, R-2).
      if (!touch) {
        await dragArrow(page, 0, touch);
        assert.equal(await page.inputValue("#extrude-distance"), "6", "the arrow grabbed and let go leaves the distance");
      }
      await dragArrow(page, 60, touch);
      await until(page, () => document.querySelector("#extrude-distance").value !== "6", null, "the distance changed by the drag", panelState);
      const dragged = Number(await page.inputValue("#extrude-distance"));
      assert.ok(Number.isInteger(dragged) && dragged > 0, `dragged to ${dragged} mm`);
      await until(page, (v) => document.querySelector("#extrude-panel").dataset.previewVolume === v, String(1200 * dragged), `the preview at ${dragged} mm`, panelState);
      if (shots) await page.screenshot({ path: `${shots}/symmetric-dragged-${width}.png` });
      // The distance typed, then OK.
      if (touch) await openPanel(page, "properties", true);
      await page.fill("#extrude-distance", String(d));
      await until(page, (v) => document.querySelector("#extrude-panel").dataset.previewVolume === v, String(1200 * d), `the preview at ${d} mm`, panelState);
      await until(page, () => !document.querySelector("#extrude-ok").disabled, null, "OK on");
      await press("#extrude-ok");
      await until(page, (v) => document.querySelector("#volume")?.textContent === v, `${(1200 * d).toLocaleString("en")} mm³`, "the body made", panelState);
      assert.equal(await undoTitle(page), "Undo Extrude Sketch 1 (Ctrl+Z)");
      await untilBodies(page, 2, "the box and the extrude; no preview kept", 8000);
      if (shots) await page.screenshot({ path: `${shots}/symmetric-made-${width}.png` });
      // Half each way from z = 0, the rectangle where it was drawn.
      nearAll(await extrudeBounds(page, touch), [[-60, -20], [0, 30], [-d / 2, d / 2]], "the extrude's STL");
      if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
      await page.context().close();
    });
  }
  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
