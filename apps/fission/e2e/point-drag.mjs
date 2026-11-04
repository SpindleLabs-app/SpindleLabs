// Browser check of dragging sketch points with the solver (step 47d3), in
// an empty design's XY sketch seen from above, in the engine E2E_BROWSER
// names (Chromium, Firefox or WebKit). Every frame the sketch shows while
// a drag is held is recorded (a MutationObserver on the view's
// data-sketch-points), so the checks are on what the user saw, not only
// where the drag ended.
// 1280 px with a mouse:
// - A rectangle (0, 0)–(20, 15) made horizontal and vertical on its four
//   sides with (0, 0) fixed, dragged by (20, 15) in one jump to (45, 30):
//   the jump arrives in several solved steps; in every frame the corner is
//   on the straight way from where it was pressed to where it was let go
//   (it never jumps), (0, 0) never moves and the sides stay exactly level
//   and upright; it lands with (20, 0) at (x, 0) and (0, 15) at (0, y),
//   exactly, (x, y) the corner within half a pixel of the pointer. The
//   camera never moves. One Ctrl+Z puts the whole drag back.
// - The fixed corner pressed and dragged: refused with the reason, nothing
//   moves, and the camera does not orbit or pan either.
// - A press on a point let go without moving is still a click: Select
//   picks the line there.
// - A 3-point arc (0, 0), (20, 0) through (10, 5) (its centre (10, −7.5)),
//   its end dragged in one jump to (30, 10): in every frame its centre
//   stays on the same side of its chord (the triangle centre, start, end
//   never turns over).
// 375 px: a line's end dragged by a finger (Chromium: touch events; the
// other engines have no way to send a moving finger, so a mouse) lands
// under it and the camera stays; the tools are chosen with taps.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4284, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4284/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  await pinProperties(page);
  return sheetsClearFor(page);
}

const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const shown = (page, key, want) => until(page, ([k, w]) => document.querySelector("#viewport").dataset[k] === w, [key, want], `${key} "${want}"`).catch(async (e) => assert.fail(`${e.message} (shown: "${await data(page, key)}")`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();

// The pinhole camera: forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field.
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
/** Millimetres per screen pixel on the plane the camera looks straight down at. */
async function mmPerPixel(page) {
  const cam = await camera(page);
  const d = sub(cam.position, cam.target);
  return (2 * Math.sqrt(dot(d, d)) * T) / (await canvasBox(page)).height;
}
/** Where sketch point (x, y) on XY is on screen; fails if something is over the canvas there. */
async function screenAt(page, [x, y], tap = false) {
  const s = toScreen(await camera(page), await canvasBox(page), [x, y, 0]);
  await closePanels(page, tap);
  const on = await page.evaluate(([sx, sy]) => {
    const e = document.elementFromPoint(sx, sy);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${x}, ${y}] is under ${on} on screen, not the canvas`);
  return s;
}
/** Clicks (or taps) sketch point (x, y) on XY. */
async function at(page, p, tap = false) {
  const s = await screenAt(page, p, tap);
  if (tap) return page.touchscreen.tap(s.x, s.y);
  await page.mouse.click(s.x, s.y);
}
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((v, k) => Math.abs(v - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

/** An empty design's sketch on XY, looked at from above. */
async function sketchOnXY(page, tap) {
  await press(page, "#create-sketch", tap);
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on XY");
  await settle(page);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
}

const error = (page) => page.evaluate(() => document.querySelector("#sketch-grid-error")?.textContent ?? "");
/** The edited sketch's points as the view shows them, as [x, y] pairs. */
const pointsOf = (text) => (text === "" ? [] : text.split(" ").map((p) => p.split(",").map(Number)));
const points = async (page) => pointsOf(await data(page, "sketchPoints"));

/** Constraint tool `kind` on what is at sketch point `p` (a line's middle, or a point), waiting for the count to go up. */
async function constrain(page, kind, picks, tap = false) {
  const before = Number(await data(page, "sketchConstraints"));
  await press(page, `#sketch-tool-${kind}`, tap);
  for (const p of picks) await at(page, p, tap);
  await shown(page, "sketchConstraints", String(before + 1));
}

/**
 * Starts recording every frame the view draws of the edited sketch's points
 * (window.dragFrames), and drags from sketch point `from` to `to` in one
 * jump (`moves` pointer moves along the way, 1 for a jump), by mouse or,
 * with `finger` in Chromium, by touch; waits until the workspace says the
 * drag has ended. Gives the frames, the pointer's press and release on
 * screen, and the solved steps the drag took.
 */
async function drag(page, from, to, { moves = 1, finger = false } = {}) {
  const a = await screenAt(page, from, finger);
  const b = await screenAt(page, to, finger);
  const ended = Number((await data(page, "pointDrags")) || 0) + 1;
  const solvesBefore = Number((await data(page, "dragSolves")) || 0);
  await page.evaluate(() => {
    const view = document.querySelector("#viewport");
    window.dragFrames = [view.dataset.sketchPoints];
    window.dragWatch?.disconnect();
    window.dragWatch = new MutationObserver(() => window.dragFrames.push(view.dataset.sketchPoints));
    window.dragWatch.observe(view, { attributes: true, attributeFilter: ["data-sketch-points"] });
  });
  // A few pixels first, past a click's slop, so the press is a drag; then the jump.
  const path = [[a.x + 6, a.y], ...Array.from({ length: moves }, (_, k) => [a.x + 6 + ((b.x - a.x - 6) * (k + 1)) / moves, a.y + ((b.y - a.y) * (k + 1)) / moves])];
  if (finger && browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const touchAt = (type, [x, y]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touchAt("touchStart", [a.x, a.y]);
    for (const p of path) await touchAt("touchMove", p);
    await touchAt("touchEnd", path.at(-1));
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (const p of path) await page.mouse.move(p[0], p[1]);
    await page.mouse.up();
  }
  await until(page, (n) => Number(document.querySelector("#viewport").dataset.pointDrags ?? 0) >= n, ended, "the drag's end heard by the workspace");
  const frames = await page.evaluate(() => (window.dragWatch.disconnect(), window.dragFrames));
  return { frames: frames.map(pointsOf), steps: Number((await data(page, "dragSolves")) || 0) - solvesBefore };
}

/** Twice the signed area of the triangle a, b, c. */
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (p, q) => p[0] === q[0] && p[1] === q[1];
const near = (p, q, tol) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
/** The camera unmoved: the same to 1e-6 mm (a phone's view works its pose out again to a few ulps). */
function stayed(now, was) {
  const flat = (c) => [...c.position, ...c.target, ...c.up];
  assert.ok(flat(now).every((v, k) => Math.abs(v - flat(was)[k]) <= 1e-6), `the camera moved: ${JSON.stringify(was)} to ${JSON.stringify(now)}`);
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
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

try {
  await check(`${browserName} 1280 px: a rectangle with a corner fixed, dragged by the far corner in one jump, lands exactly in steps; one undo`, async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await page.click("#sketch-tool-rectangle");
    await at(page, [0, 0]);
    await at(page, [20, 15]);
    await shown(page, "sketchPoints", "0,0 20,0 20,15 0,15");
    await page.keyboard.press("Escape");
    // Level bottom and top, upright sides (a click on each side's middle), and (0, 0) fixed.
    await constrain(page, "horizontal", [[10, 0]]);
    await constrain(page, "horizontal", [[10, 15]]);
    await constrain(page, "vertical", [[20, 7.5]]);
    await constrain(page, "vertical", [[0, 7.5]]);
    await constrain(page, "fix", [[0, 0]]);
    await page.click("#sketch-tool-select");
    const cam = await camera(page);
    const mm = await mmPerPixel(page);
    const { frames, steps } = await drag(page, [20, 15], [45, 30]);
    // The jump from (20, 15) to (45, 30), √(25² + 15²) ≈ 29.2 mm, at most 8 px a step: at least ⌈29.2 / (8 · mm)⌉ − 1 solves (the
    // first 6 px move takes one of its own, and the jump starts from there), at most 32; and the 6 px move one more.
    const least = Math.min(32, Math.ceil(Math.hypot(25, 15) / (8 * mm)) - 1);
    assert.ok(least >= 4, `the test's jump is only ${least} steps at ${mm} mm a pixel: too short to tell`);
    assert.ok(steps >= least, `the jump took ${steps} solved steps at ${mm} mm a pixel, under ${least}`);
    // Every frame: (0, 0) still; the sides exactly level and upright; the corner on the way from (20, 15) to where it was let go.
    const last = frames.at(-1);
    const end = last[2];
    for (const [k, f] of frames.entries()) {
      assert.ok(same(f[0], [0, 0]), `frame ${k}: the fixed corner moved to ${f[0]}`);
      assert.ok(f[1][1] === 0 && f[1][0] === f[2][0] && f[3][0] === 0 && f[3][1] === f[2][1], `frame ${k}: a side is no longer level or upright: ${JSON.stringify(f)}`);
      // (Up to 6 px off it: the first move is 6 px to the right, past a click's slop, before the jump.)
      const away = Math.abs(turn([20, 15], end, f[2])) / Math.hypot(end[0] - 20, end[1] - 15);
      assert.ok(away <= 6 * mm + 1e-9, `frame ${k}: the corner ${f[2]} is ${away / mm} px off the way it was dragged`);
    }
    // It lands under the pointer, within half a pixel (the pointer's ray meets the plane between pixels).
    assert.ok(near(end, [45, 30], 0.5 * mm + 1e-9), `the corner landed at ${end}, not under the pointer at (45, 30)`);
    assert.ok(same(last[1], [end[0], 0]) && same(last[3], [0, end[1]]), `the rectangle landed as ${JSON.stringify(last)}`);
    stayed(await camera(page), cam);
    await shot(page, "point-drag-rectangle-1280");
    // One undo step for the whole drag.
    await page.keyboard.press("Control+z");
    await shown(page, "sketchPoints", "0,0 20,0 20,15 0,15");
    await page.context().close();
  });

  await check(`${browserName} 1280 px: a fixed point can't be dragged, the camera stays; a press let go still is a click`, async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await page.click("#sketch-tool-line");
    await at(page, [0, 0]);
    await at(page, [20, 10]);
    await shown(page, "sketchLines", "1");
    await page.keyboard.press("Escape");
    await constrain(page, "fix", [[0, 0]]).catch(async (e) => assert.fail(`${e.message}: ${await error(page)}`));
    await page.click("#sketch-tool-select");
    const cam = await camera(page);
    const before = await data(page, "sketchPoints");
    const { frames } = await drag(page, [0, 0], [10, -10]);
    assert.match(await error(page), /This point is fixed/);
    assert.ok(frames.every((f) => f.join(" ") === pointsOf(before).join(" ")), "nothing moved");
    stayed(await camera(page), cam);
    await shot(page, "point-drag-fixed-1280");
    // A press on (20, 10) let go without moving: the line there is picked, as any click would.
    await at(page, [20, 10]);
    await shown(page, "sketchPicked", "1");
    assert.equal(await data(page, "sketchPoints"), before, "a click moves nothing");
    await page.context().close();
  });

  await check(`${browserName} 1280 px: an arc's end dragged in one jump never turns the arc over`, async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await page.click("#sketch-tool-arc");
    await at(page, [0, 0]);
    await at(page, [20, 0]);
    await at(page, [10, 5]);
    // Ends (0, 0) and (20, 0) and its centre (10, −7.5): 10² + y² = (5 − y)² gives y = −7.5.
    // Its ends stored anticlockwise, (20, 0) first, then its centre.
    await shown(page, "sketchPoints", "20,0 0,0 10,-7.5");
    await page.click("#sketch-tool-select");
    const { frames, steps } = await drag(page, [20, 0], [30, 10]);
    assert.ok(steps >= 2, `the jump took ${steps} solved steps`);
    // turn(centre, start, end) = (10)(7.5) − (7.5)(−10) = 150 at first: it stays above 0 in every frame.
    for (const [k, [s, e, c]] of frames.entries()) assert.ok(turn(c, s, e) > 0, `frame ${k}: the arc turned over: start ${s}, end ${e}, centre ${c}`);
    const [s, e, c] = frames.at(-1);
    assert.ok(Math.abs(Math.hypot(s[0] - c[0], s[1] - c[1]) - Math.hypot(e[0] - c[0], e[1] - c[1])) <= 1e-5, "its ends are on one circle within LINEAR");
    assert.ok(!same(s, [20, 0]), "the dragged end moved");
    await shot(page, "point-drag-arc-1280");
    await page.context().close();
  });

  await check(`${browserName} 375 px: a line's end dragged by a finger lands under it; the camera stays`, async () => {
    const page = await fresh(375, true);
    await sketchOnXY(page, true);
    await page.tap("#sketch-tool-line");
    await at(page, [0, 0], true);
    await at(page, [10, 5], true);
    await shown(page, "sketchLines", "1");
    await page.tap("#sketch-tool-select");
    const cam = await camera(page);
    const mm = await mmPerPixel(page);
    const { frames } = await drag(page, [10, 5], [5, 12], { moves: 3, finger: true });
    const end = frames.at(-1)[1];
    assert.ok(near(end, [5, 12], 0.5 * mm + 1e-9), `the end landed at ${end}, not under the finger at (5, 12)`);
    assert.ok(same(frames.at(-1)[0], [0, 0]), "the start stayed");
    stayed(await camera(page), cam);
    await shot(page, "point-drag-375");
    await page.context().close();
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
