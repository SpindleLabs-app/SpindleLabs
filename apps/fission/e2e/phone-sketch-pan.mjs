// Browser check of a one-finger drag in a sketch on a phone (SL #648 item 1, phone hunt 2026-11-12; Ben's choice
// 2026-11-12): a drag meant to draw spun the sketch about 112° with no word, since one finger orbits. On a touch screen a
// sketch now opens with the view bar's Pan lit, so one finger slides the sketch and never turns it; Orbit on the bar
// (the bottom bar, unchanged) brings the spin back for that sketch, and Finish Sketch puts Orbit back. Drawing stays by
// taps: a rectangle's two corners still draw it. At 393 × 852 (Ben's iPhone) and 375 × 667 with real touches (CDP);
// at 1280 px with a mouse a sketch keeps Orbit. Screenshots go to E2E_SHOTS when set. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4894, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4894/?test-hooks#design";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n${e.stack}`);
  }
}

async function open(width, height, phone) {
  const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  return { page, context };
}

const sketching = (page, on) => page.waitForFunction((w) => document.querySelector("#viewport").dataset.sketching === String(w), on);
const nav = (page) => page.getAttribute("#viewport", "data-nav");
const lit = (page, mode) => page.getAttribute(`#view-controls [data-nav=${mode}]`, "aria-pressed");
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
/** A point at fractions (fx, fy) of the view left clear between the bar over its top and the view bar at its foot, checked to be the canvas. */
const clear = (page, [fx, fy]) =>
  page.evaluate(([fx, fy]) => {
    const top = Math.max(document.getElementById("phone-float")?.getBoundingClientRect().bottom ?? 0, document.getElementById("viewport").getBoundingClientRect().top);
    const foot = document.getElementById("view-controls").getBoundingClientRect().top;
    const x = innerWidth * fx;
    const y = top + (foot - top) * fy;
    return { x, y, canvas: document.elementFromPoint(x, y)?.tagName === "CANVAS" };
  }, [fx, fy]);

/** One finger dragged 12 steps of (dx, dy) px over the view (CDP touches, as Chromium gets them from a phone). */
async function fingerDrag(page, [dx, dy] = [10, 5]) {
  const from = await clear(page, [0.4, 0.4]);
  assert.ok(from.canvas, `the drag starts on the 3D view (${from.x}, ${from.y})`);
  const cdp = await page.context().newCDPSession(page);
  const at = (k) => ({ x: from.x + dx * k, y: from.y + dy * k });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(0)] });
  for (let k = 1; k <= 12; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at(k)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** The camera's direction (target to position, unit length) and its target. */
const look = (c) => {
  const d = c.position.map((v, k) => v - c.target[k]);
  const n = Math.hypot(...d);
  return { dir: d.map((v) => v / n), target: c.target };
};
/** The angle in degrees between two unit directions. */
const turned = (a, b) => (Math.acos(Math.min(1, Math.max(-1, a.reduce((s, v, k) => s + v * b[k], 0)))) * 180) / Math.PI;

for (const [width, height] of [[393, 852], [375, 667]]) {
  await check(`${width} × ${height}: a sketch opens with Pan lit; one finger slides the sketch without turning it; Orbit on the bar turns it again; Finish Sketch puts Orbit back`, async () => {
    const { page, context } = await open(width, height, true);
    assert.equal(await nav(page), "orbit", "Orbit before the sketch");
    await page.tap("#create-sketch");
    await page.waitForSelector("#float-plane-XY", { state: "visible" });
    await page.tap("#float-plane-XY");
    await sketching(page, true);
    assert.equal(await nav(page), "pan", "one finger pans in the sketch");
    assert.equal(await lit(page, "pan"), "true", "Pan lit on the view bar");
    assert.equal(await lit(page, "orbit"), "false");
    if (shots) await page.screenshot({ path: `${shots}/phone-sketch-pan-${width}.png` });
    // A drag: the camera slides (its target moves) and keeps its direction: the sketch is never turned.
    const before = look(await camera(page));
    await fingerDrag(page, [10, -5]); // partly upward: under Orbit this would tilt the view
    const after = look(await camera(page));
    assert.ok(turned(before.dir, after.dir) < 0.01, `not turned (${turned(before.dir, after.dir).toFixed(3)}°)`);
    const slid = Math.hypot(...after.target.map((v, k) => v - before.target[k]));
    assert.ok(slid > 1, `the view slid (${slid.toFixed(2)} mm)`);
    // Escape belongs to the sketch, not to Pan: Pan stays lit (snap.mjs checks it still ends a line's chain).
    await page.keyboard.press("Escape");
    assert.equal(await nav(page), "pan", "Escape leaves Pan lit");
    // Drawing is by taps, as before: a rectangle's two corners draw it.
    await page.tap("#sketch-tool-rectangle");
    for (const f of [[0.3, 0.3], [0.6, 0.7]]) {
      const p = await clear(page, f);
      assert.ok(p.canvas, `the corner tap lands on the view (${p.x}, ${p.y})`);
      await page.touchscreen.tap(p.x, p.y);
    }
    await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketchPoints?.split(" ").length >= 4);
    // Orbit chosen on the bar: one finger turns the sketch again.
    await page.tap("#view-controls [data-nav=orbit]");
    assert.equal(await nav(page), "orbit");
    const was = look(await camera(page));
    // Upward, so the view tilts off the sketch's top-down look (a sideways drag turns it about the line of sight, keeping the direction).
    await fingerDrag(page, [0, -8]);
    assert.ok(turned(was.dir, look(await camera(page)).dir) > 5, "Orbit turns the view");
    // Pan chosen again, then the sketch finished: Orbit is back for the 3D view.
    await page.tap("#view-controls [data-nav=pan]");
    await page.tap("#float-finish");
    await sketching(page, false);
    assert.equal(await nav(page), "orbit", "Orbit back after Finish Sketch");
    assert.equal(await lit(page, "orbit"), "true");
    // A second sketch opens panning again.
    await page.tap("#create-sketch");
    await page.waitForSelector("#float-plane-XZ", { state: "visible" });
    await page.tap("#float-plane-XZ");
    await sketching(page, true);
    assert.equal(await nav(page), "pan", "the next sketch pans too");
    await context.close();
  });
}

await check("1280 px with a mouse: a sketch keeps Orbit (the left button turns it, as before)", async () => {
  const { page, context } = await open(1280, 800, false);
  await page.click("#create-sketch");
  await page.click("#sketch-plane-XY");
  await sketching(page, true);
  assert.equal(await nav(page), "orbit");
  assert.equal(await lit(page, "orbit"), "true");
  await context.close();
});

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
