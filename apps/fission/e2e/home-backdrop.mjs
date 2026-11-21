// Browser check of the home screen's living background (packages/ui home-backdrop.ts), in a real Chromium, on the normal
// build with `?all` (which turns the home screen on; E2E_DIST names another build). Without it there is no home screen and
// no background.
// - A first visit: the background moves (two pictures 600 ms apart differ), paints something, and turns the neutral cube,
//   which opens already built with a ripple of light running through it within 3 s (never a build first: Ben, 2026-11-21),
//   has its top face pulled out and let back, then the next story builds the next part up from the floor (in order).
// - With a project kept and reopened under the screen, the background turns that project's own shape, painted solid (its
//   faces, the lines behind them hidden), and is unseen until it is ready: from the first frame it shows that shape at
//   the one place and size it keeps (Ben, 2026-11-16: it showed bigger and shrank a second later).
// - The tab hidden: nothing is drawn (two pictures the same); shown again, it moves again.
// - The screen closed: the background stops (mode off).
// - Reduced motion: it moves gently (two pictures apart differ), always built and at rest for 13 s (never a build, ripple or
//   pulled face); Pause (an icon beside the guide's book) keeps one still picture, remembered over a reload; Settings >
//   General's Full gives the whole story, and Auto the gentle one again (Ben, 2026-11-16: Windows' animations off).
// - Gentle motion suggested only once the picture was too slow (the computer slowed 40 times after it showed), taken and
//   kept; never on a quick one.
// - A weak machine (2 cores): the lightest moving picture, at 1 pixel a CSS pixel. Each frame taking 10 ms to draw: still the
//   full moving picture; 20 ms: stepped down to a still one, marked slow.
// - Motion is read on Playwright's paused clock (each draw then takes 0 ms, so a busy runner never steps it down): the
//   turntable's angle grows by exactly the frames drawn × the frame's time ÷ a turn's (40 s, gently 60 s).
// - It never takes a press: the card's button under the picture still works; the words keep their contrast (the title, the
//   guide link and Pause the background against the worst pixel behind them, 4.5 : 1 or more).
// - At 375 px: nothing runs off the side.
// - Fold (Ben, 2026-11-16): the screen fades away but for Pause and Fold, which stay put; the design glides to the middle;
//   Tab reaches only the icons; Pause still works; the same icon, a press on the picture or Escape brings it back; 1280 px
//   with a mouse and 375 px with taps.
// Screenshots (SHOTS=<dir>) at 1280 and 375 px in both themes; STL=<file> opens that STL as the project shown (its
// triangles painted, its sharp edges drawn).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chosen, launch } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(DIST + "index.html")) throw new Error("build the app first (npm run build)");
const PORT = 4619;
const server = await preview({ build: { outDir: DIST }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.SHOTS;
const stl = process.env.STL;
const errors = [];
let failed = 0;
async function check(name, fn) {
  if (!chosen(name)) return;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
/**
 * Pages whose clock is Playwright's, paused (E-5 of the 2026-11-18 test audit): time moves only by `runFor`, so a frame's
 * measured draw takes 0 ms and the picture never steps down to a still one on a busy runner, and every motion is read
 * exactly. Waits on such a page move its clock 100 ms at a time; on other pages they are real waits.
 */
const paused = new WeakSet();
async function until(page, fn, arg, what, timeout = 15000) {
  if (!paused.has(page)) return page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
  for (let t = 0; ; t += 100) {
    if (await page.evaluate(fn, arg)) return;
    if (t >= timeout) assert.fail(`${what}: not within ${timeout} ms of the page's clock`);
    await page.clock.runFor(100);
  }
}
/** Lets `ms` pass: the page's own clock when it is paused, else real time. */
const wait = (page, ms) => (paused.has(page) ? page.clock.runFor(ms) : page.waitForTimeout(ms));
/** Pauses the page's clock (installed by newPage) where it is now; the picture then reports its angle and frames. */
async function pause(page) {
  // A moment ahead of the page's clock, which runs on while this is asked (pausing in its past is refused).
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  paused.add(page);
}
/** The turntable's angle (radians) and the moving frames drawn so far, as the picture reports them under ?test-hooks. */
const turn = (page) => page.$eval("#home .home-backdrop", (c) => ({ yaw: Number(c.dataset.yaw), frames: Number(c.dataset.frames ?? 0) }));
/**
 * Runs the paused clock `ms` and checks the turntable turned exactly as far as the frames drawn say. Worked by hand: a
 * frame is drawn on a 16 ms animation tick once 1000/fps - 1 ms have passed since the last, so every `frameMs` (48 ms at
 * 30 a second: the third tick; 64 ms at 20 a second: the fourth), and a whole turn takes `turnSeconds`. So in `ms` there
 * are floor or ceil of ms / frameMs frames, and the angle grows by frames × frameMs / 1000 / turnSeconds × 2π (the
 * angle is reported to 5 decimals, so within 1e-4). A turntable that stopped, or turned at another speed, fails.
 */
async function turnsFor(page, ms, turnSeconds, frameMs) {
  await page.clock.runFor(frameMs * 2); // a frame or two drawn since the angle was first asked for
  const a = await turn(page);
  await page.clock.runFor(ms);
  const b = await turn(page);
  const frames = b.frames - a.frames;
  assert.ok(frames >= Math.floor(ms / frameMs) && frames <= Math.ceil(ms / frameMs), `${frames} frames in ${ms} ms, one every ${frameMs} ms`);
  const want = ((frames * frameMs) / 1000 / turnSeconds) * Math.PI * 2;
  assert.ok(Math.abs(b.yaw - a.yaw - want) < 1e-4, `turned ${(b.yaw - a.yaw).toFixed(5)} rad in ${frames} frames, ${want.toFixed(5)} worked by hand`);
}
const homeShown = (page) => until(page, () => { const h = document.getElementById("home"); return h && !h.hidden && document.querySelectorAll("#home-items .home-row, #home-status:not(:empty)").length > 0; }, null, "the home screen");
/** Waits for the picture to be marked ready (the list painted, the design here). */
const ready = (page) => until(page, () => document.querySelector("#home .home-backdrop")?.dataset.ready === "yes", null, "the picture ready", 8000);
const mode = (page) => page.$eval("#home .home-backdrop", (c) => c.dataset.backdrop);
const shape = (page) => page.$eval("#home .home-backdrop", (c) => c.dataset.shape ?? "");
const picture = (page) => page.$eval("#home .home-backdrop", (c) => c.toDataURL());
/** How many of the canvas's pixels have any paint on them (a sample every 4th pixel each way). */
const painted = (page) =>
  page.$eval("#home .home-backdrop", (c) => {
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) if (data[(y * c.width + x) * 4 + 3] > 0) n++;
    return n;
  });

/**
 * A page; `cores` is what the machine says it has (8 unless given, so a small CI runner still shows the moving picture).
 * `clock`: Playwright's clock installed (still running), so `pause` can stop it; "paused" pauses it once the page has loaded.
 */
async function newPage({ width = 1280, scheme = "dark", reduce = false, cores = 8, all = true, clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 812 }, hasTouch: width < 700, isMobile: width < 700, colorScheme: scheme, reducedMotion: reduce ? "reduce" : "no-preference" });
  await context.addInitScript((n) => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => n }), cores);
  // Every change of the picture's place, shape and readiness, as it happens (the jump check reads them).
  await context.addInitScript(() => {
    window.__picture = [];
    const watch = () =>
      new MutationObserver((changes) => {
        for (const c of changes) {
          const el = c.target;
          if (!el.classList?.contains("home-backdrop")) continue;
          window.__picture.push({ at: performance.now(), what: c.attributeName, ready: el.dataset.ready ?? null, place: el.dataset.place ?? null, shape: el.dataset.shape ?? null, opacity: getComputedStyle(el).opacity });
        }
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-place", "data-ready", "data-shape"] });
    if (document.documentElement) watch();
    else document.addEventListener("DOMContentLoaded", watch);
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(process.env.STACKS ? e.stack : e.message));
  if (clock) await page.clock.install();
  await page.goto(url + (all ? "?all&test-hooks#design" : "#design"));
  if (clock === "paused") await pause(page);
  if (clock && all) await page.evaluate(() => window.fissionTest.backdropCost(0));
  return { context, page };
}

/**
 * A binary STL's solid for the picture: its edges as pairs of x y z points (every triangle side whose two triangles don't
 * lie in one plane, normals more than 1° apart, or that has only one) and its triangles (`positions`, `indices`). The app
 * can't open STL yet, so a screenshot run with STL= shows that design through the test hook in place of the box's (the
 * box is still kept and checked first).
 */
function stlSolid(buffer) {
  const count = buffer.readUInt32LE(80);
  const positions = [];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) positions.push(buffer.readFloatLE(84 + 50 * i + 12 + 12 * k + 4 * j));
  return { lines: stlEdges(buffer), surface: { positions, indices: Array.from({ length: count * 3 }, (_, i) => i) } };
}
function stlEdges(buffer) {
  const count = buffer.readUInt32LE(80);
  const sides = new Map();
  for (let i = 0; i < count; i++) {
    const at = 84 + 50 * i;
    const v = [0, 1, 2].map((k) => [0, 1, 2].map((j) => buffer.readFloatLE(at + 12 + 12 * k + 4 * j)));
    const u = v[1].map((x, j) => x - v[0][j]);
    const w = v[2].map((x, j) => x - v[0][j]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const key = [v[a], v[b]].map((p) => p.map((x) => x.toFixed(4)).join(",")).sort().join("|");
      const side = sides.get(key) ?? { ends: [v[a], v[b]], normals: [] };
      side.normals.push(n.map((x) => x / len));
      sides.set(key, side);
    }
  }
  const out = [];
  for (const { ends, normals } of sides.values()) {
    const flat = normals.length === 2 && normals[0].reduce((s, x, j) => s + x * normals[1][j], 0) > Math.cos(Math.PI / 180);
    if (!flat) out.push(...ends[0], ...ends[1]);
  }
  return out;
}

/** Keeps a project (the box) and reloads, so the screen opens over it. */
/**
 * The words (or icon) of element `id` against the brightest pixel behind them, read from a screenshot with them made
 * invisible: 4.5 : 1 or more.
 */
async function readable(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  const colour = await page.$eval(`#${id}`, (e) => getComputedStyle(e).color);
  // A rounded button's corners lie outside its plate, so the moving picture shows there; no word or icon is ever drawn
  // there, so those pixels are not its ground (they made the Fold icon fail now and then at 3.0 : 1 as a line passed).
  const radius = await page.$eval(`#${id}`, (e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0);
  await page.$eval(`#${id}`, (e) => (e.style.color = "transparent"));
  const ground = decodePng(await page.screenshot({ clip: box, animations: "disabled" }));
  await page.$eval(`#${id}`, (e) => (e.style.color = ""));
  const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const text = lum(colour.match(/[\d.]+/g).map(Number));
  let worst = Infinity;
  let where = -1;
  const scale = ground.width / box.width;
  const outside = (i) => {
    const x = ((i / 4) % ground.width) / scale, y = Math.floor(i / 4 / ground.width) / scale;
    const dx = x < radius ? radius - x : x > box.width - radius ? x - (box.width - radius) : 0;
    const dy = y < radius ? radius - y : y > box.height - radius ? y - (box.height - radius) : 0;
    return dx > 0 && dy > 0 && Math.hypot(dx - 0.5, dy - 0.5) > radius - 1; // pixel centres; the 1 px edge is the plate's antialiased rim
  };
  for (let i = 0; i < ground.data.length; i += 4) {
    if (outside(i)) continue;
    const l = lum([ground.data[i], ground.data[i + 1], ground.data[i + 2]]);
    const [hi, lo] = text > l ? [text, l] : [l, text];
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < worst) (worst = ratio), (where = i);
  }
  const spot = `(${box.x + ((where / 4) % ground.width) / (ground.width / box.width)}, ${box.y + Math.floor(where / 4 / ground.width) / (ground.height / box.height)}) rgb ${[...ground.data.slice(where, where + 3)]}`;
  assert.ok(worst >= 4.5, `${id} contrast ${worst.toFixed(2)} : 1 at its worst pixel, ${spot}`);
}

/** Keeps a project (the box) and reloads, so the screen opens over it; on a page with Playwright's clock, paused from the reload on. */
async function withProject(page, tap = false, { clock = true } = {}) {
  await homeShown(page);
  await page.click("#home-close");
  await startWithBox(page, tap);
  await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
  await page.waitForTimeout(400);
  if (clock) await pause(page);
  await page.reload();
  if (clock) await page.evaluate(() => window.fissionTest.backdropCost(0));
  await homeShown(page);
  await ready(page);
}

await check("without ?all there is no home screen, so no background", async () => {
  const { context, page } = await newPage({ all: false });
  await page.locator("#start-hint").waitFor();
  if (!process.env.E2E_DIST) assert.equal(await page.$(".home-backdrop"), null); // a build with the screen switched on has one
  await context.close();
});
{
  await check("a first visit: the background moves, paints, and turns the neutral cube", async () => {
    const { context, page } = await newPage({ clock: "paused" });
    await homeShown(page);
    await ready(page);
    // Opened on the cube already built, and a ripple within 3 s (the story below).
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.build !== undefined, null, "the first frame", 1000);
    const opened = await page.$eval("#home .home-backdrop", (c) => Number(c.dataset.build));
    assert.ok(opened >= 0.9, `built from the first frame (built ${opened})`);
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.stage === "ripple", null, "a ripple within 3 s", 3000);
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.build), "1.0");
    assert.equal(await mode(page), "live");
    assert.equal(await shape(page), "neutral");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.faces), "6", "the cube's six faces painted");
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.hides === "yes", null, "the cube's back lines hidden behind its faces", 12000);
    // The turntable turns at 9° a second (TURN_SECONDS 40), a frame every 48 ms (30 a second).
    await turnsFor(page, 600, 40, 48);
    const a = await picture(page);
    await wait(page, 600);
    assert.ok((await picture(page)) !== a, "two pictures 600 ms apart differ");
    assert.ok((await painted(page)) > 200, "something is painted");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.getAttribute("aria-hidden")), "true");
    // The story opens on the cube already built (OPEN_AT, Ben 2026-11-21: the build first held every motion back for
    // 10.8 s, like a slow load): it is drawn at least 0.9 built from the first frame, and a ripple runs through it within
    // 3 s of the picture being ready (it starts 1.98 s in: story 9.9 s to 11.88 s). Then the top face is pulled out (out by
    // 0.24 of its size, 20.9 to 24.5 s) and let back (by 27.4 s), and the next story builds from the floor (half built at
    // 41.4 s: 36 + 5.4). Before the change the first ripple came 12 s after ready.
    const stage = () => document.querySelector("#home .home-backdrop").dataset.stage;
    const words = () => document.querySelector("#home .home-backdrop").dataset.words;
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.extrude === "0.24", null, "the top face pulled out", 14000);
    assert.equal(await page.evaluate(stage), "extrude");
    assert.equal(await page.evaluate(words), "Extrude top face");
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.extrude === "0.00", null, "the top face back", 10000);
    // The next story builds the next simple part (the L-bracket) from the floor, as every story after the first does.
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.build === "0.5" && document.querySelector("#home .home-backdrop").dataset.stage === "building", null, "half built", 20000);
    assert.equal(await page.evaluate(stage), "building");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.part), "1");
    // Printed: the slice laid down now is drawn (the bracket's six walls cut, so 6 or more pieces), and the words under it
    // say so, with no layer numbers for a sample part, which is named as one (round 10).
    assert.equal(await page.evaluate(words), "Printing preview");
    assert.ok(Number(await page.$eval("#home .home-backdrop", (c) => c.dataset.slice)) >= 6, "the slice drawn");
    if (shots) {
      await page.screenshot({ path: `${shots}/home-empty-1280.png` });
      // The bracket part way up.
      await until(page, () => document.querySelector("#home .home-backdrop").dataset.part === "1" && document.querySelector("#home .home-backdrop").dataset.build === "0.7", null, "the bracket building", 10000);
      await page.screenshot({ path: `${shots}/home-empty-1280-build.png` });
    }
    await context.close();
  });

  for (const [width, scheme] of [[1280, "dark"], [1280, "light"], [375, "dark"], [375, "light"]]) {
    await check(`${width} px ${scheme}: the project's own shape turns behind the screen, and the screen still works over it`, async () => {
      const { context, page } = await newPage({ width, scheme, clock: true });
      await withProject(page, width < 700);
      // From its first frame (marked ready) it is the project's shape, at one place and size, kept for the next 3 s.
      assert.match(await shape(page), /^project \d+$/);
      assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.faces), "6", "the box's six faces painted");
      await until(page, () => document.querySelector("#home .home-backdrop").dataset.build !== undefined, null, "the first frame", 1000);
      assert.ok(Number(await page.$eval("#home .home-backdrop", (c) => c.dataset.build)) >= 0.9, "the project built from the first frame (OPEN_AT)");
      await wait(page, 3000);
      const seen = await page.evaluate(() => window.__picture);
      const first = seen.findIndex((e) => e.ready === "yes");
      assert.ok(first >= 0, "marked ready");
      assert.ok(seen.slice(0, first).every((e) => e.place === null), "nothing drawn before it was ready");
      assert.ok(seen.slice(0, first).every((e) => e.opacity === "0"), "unseen before it was ready");
      const after = seen.slice(first).filter((e) => e.place !== null);
      assert.ok(after.length > 0, "drawn once ready");
      assert.ok(after.every((e) => e.place === after[0].place), `one place and size: ${[...new Set(after.map((e) => e.place))].join(" then ")}`);
      assert.ok(seen.slice(first).every((e) => /^project \d+$/.test(e.shape ?? "")), "the project's shape from the first frame");
      assert.equal(await mode(page), "live");
      // Nothing runs off the side.
      assert.equal(await page.evaluate(() => document.getElementById("home").scrollWidth <= window.innerWidth), true);
      // The words straight on the picture (the title, the guide link) against the brightest pixel behind them, read from a
      // screenshot with the words made invisible: 4.5 : 1 or more.
      for (const id of ["home-title", "home-guide", "home-motion", "home-fold"]) await readable(page, id);
      if (shots) {
        if (stl) {
          await page.evaluate(({ lines, surface }) => window.fissionTest.homeStandIn(lines, surface), stlSolid(readFileSync(stl)));
          await until(page, () => /^project \d+$/.test(document.querySelector("#home .home-backdrop")?.dataset.shape ?? ""), null, "the STL's shape", 3000);
        }
        // Opened built: the first ripple (within 3 s of opening), the top face pulled out, then the next story's build.
        await until(page, () => document.querySelector("#home .home-backdrop").dataset.stage === "ripple", null, "a ripple", 20000);
        await wait(page, 1500);
        await page.screenshot({ path: `${shots}/home-${width}-${scheme}.png` });
        if (scheme === "dark") {
          await until(page, () => document.querySelector("#home .home-backdrop").dataset.extrude === "0.24", null, "the top face held pulled out", 20000);
          await page.screenshot({ path: `${shots}/home-${width}-${scheme}-extrude.png` });
        }
        await until(page, () => document.querySelector("#home .home-backdrop").dataset.build === "0.6" && document.querySelector("#home .home-backdrop").dataset.stage === "building", null, "part built", 45000);
        await page.screenshot({ path: `${shots}/home-${width}-${scheme}-build.png` });
      }
      // The words under the design while it prints: the box is 20 mm tall, so 100 layers of 0.2 mm (round 10).
      if (!stl) await until(page, () => /^Printing preview · layer \d+ of 100$/.test(document.querySelector("#home .home-backdrop").dataset.words ?? ""), null, "the layer words", 45000);
      // The picture takes no press: the card's button works.
      await page.click("#home-carry-on");
      await until(page, () => document.getElementById("home").hidden, null, "the home screen going");
      assert.equal(await mode(page), "off", "closed: the background stops");
      await context.close();
    });
  }

  await check("a hidden tab draws nothing, and moves again once shown", async () => {
    const { context, page } = await newPage({ clock: "paused" });
    await homeShown(page);
    await ready(page);
    await wait(page, 200);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const a = await picture(page);
    const before = await turn(page);
    await wait(page, 600);
    assert.ok((await picture(page)) === a, "hidden: the same picture");
    assert.deepEqual(await turn(page), before, "hidden: no frame drawn, the turntable where it was");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wait(page, 600);
    assert.ok((await picture(page)) !== a, "shown again: it moves");
    await turnsFor(page, 600, 40, 48);
    await context.close();
  });

  await check("reduced motion: it moves gently; Pause gives a still picture, remembered; Settings' Full gives the whole story and Auto the gentle one", async () => {
    const { context, page } = await newPage({ reduce: true, clock: true });
    await withProject(page);
    await until(page, () => /^project \d+$/.test(document.querySelector("#home .home-backdrop")?.dataset.shape ?? ""), null, "the project's shape", 3000);
    const data = (key) => page.$eval("#home .home-backdrop", (c, k) => c.dataset[k] ?? "", key);
    const named = (id) => page.$eval(`#${id}`, (b) => (b.hidden ? "(hidden)" : b.getAttribute("aria-label")));
    assert.equal(await mode(page), "live");
    assert.equal(await data("motion"), "gentle");
    assert.equal(await data("still"), "", "no still picture");
    // Gently: 6° a second (GENTLE_TURN 60), a frame every 64 ms (20 a second).
    await turnsFor(page, 700, 60, 64);
    const a = await picture(page);
    await wait(page, 700);
    assert.ok((await picture(page)) !== a, "two pictures 700 ms apart differ: it moves");
    assert.ok((await painted(page)) > 200, "painted");
    assert.equal(await named("home-motion"), "Pause the background");
    assert.equal(await named("home-guide"), "How SpindleLabs works (the guide)");
    assert.equal(await page.$("#home-full-motion"), null, "full and gentle motion are Settings' choices");
    assert.equal(await page.$eval("#home-motion-tip", (t) => t.hidden), true, "nothing slow: no suggestion");
    // 13 s: past where the full story builds (to 10.8 s) and its first ripple starts (11.9 s). Gently: built and at rest.
    const states = new Set();
    for (let t = 0; t < 13000; t += 100) {
      states.add(await page.$eval("#home .home-backdrop", (c) => `${c.dataset.stage} ${c.dataset.build} ${c.dataset.extrude}`));
      await wait(page, 100);
    }
    assert.deepEqual([...states], ["rest 1.0 0.00"], "only ever built and at rest");
    if (shots) await page.screenshot({ path: `${shots}/home-gentle-1280.png` });
    // Pause: one still picture, the icon saying Play, remembered over a reload.
    await page.click("#home-motion");
    assert.equal(await mode(page), "still");
    assert.equal(await data("still"), "paused");
    assert.equal(await named("home-motion"), "Play the background");
    const b = await picture(page);
    const still = await turn(page);
    await wait(page, 700);
    assert.ok((await picture(page)) === b, "paused: the same picture");
    assert.deepEqual(await turn(page), still, "paused: no frame drawn");
    await page.reload();
    await homeShown(page);
    await ready(page);
    assert.equal(await mode(page), "still", "paused remembered");
    // Settings > General > Home screen background > Full: the whole story, even with less motion asked for (Ben, 2026-11-16).
    const pick = async (choice) => {
      await page.click("#home-close");
      await page.click("#settings-open");
      await page.click(`#settings [data-motion="${choice}"]`);
      await page.click("#settings .close");
      await chooseFile(page, "file-home");
      await homeShown(page);
      await ready(page);
    };
    await pick("full");
    assert.equal(await mode(page), "live");
    assert.equal(await data("motion"), "full");
    // Shown again it opens on the design built, with a ripple running through it within 3 s (OPEN_AT).
    assert.ok(Number(await data("build")) >= 0.9, "built from the first frame");
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.stage === "ripple", null, "the full story's ripple", 3000);
    // Auto: gentle again, as the computer asks.
    await pick("system");
    assert.equal(await data("motion"), "gentle");
    await context.close();
  });

  await check("gentle motion suggested only once the picture was too slow here: taken, it moves gently and is kept", async () => {
    const { context, page } = await newPage();
    await homeShown(page);
    await ready(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 40 });
    await until(page, () => document.querySelector("#home-motion-tip")?.hidden === false, null, "the suggestion (slowed 40 times)", 30000);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const state = await page.$eval("#home .home-backdrop", (c) => ({ quality: c.dataset.quality, cost: c.dataset.cost }));
    console.log(`  (slowed 40×: ${JSON.stringify(state)})`);
    assert.match(await page.$eval("#home-motion-tip", (t) => t.textContent), /slowing this computer down/);
    if (shots) await page.screenshot({ path: `${shots}/home-suggest-1280.png` });
    await page.click("#home-gentle");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.motion), "gentle");
    assert.equal(await page.$eval("#home-motion-tip", (t) => t.hidden), true);
    await page.reload();
    await homeShown(page);
    await ready(page);
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.motion), "gentle", "kept over a reload");
    await context.close();
  });

  await check("full motion: Pause keeps one still picture, Play moves the whole story again", async () => {
    const { context, page } = await newPage({ clock: "paused" });
    await homeShown(page);
    await ready(page);
    await wait(page, 3000); // past the 20 untimed frames and a timed window of 30, each taking 0 ms of the paused clock
    assert.equal(await page.$eval("#home-motion-tip", (t) => t.hidden), true, "a quick computer: no suggestion");
    await page.click("#home-motion");
    assert.equal(await mode(page), "still");
    await page.click("#home-motion");
    assert.equal(await mode(page), "live");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.motion), "full");
    await wait(page, 200);
    await turnsFor(page, 600, 40, 48);
    const a = await picture(page);
    await wait(page, 600);
    assert.ok((await picture(page)) !== a, "moving again");
    await context.close();
  });

  for (const width of [1280, 375]) {
    await check(`${width} px: Fold puts the screen away to watch the picture, the design gliding to the middle and the icons staying put; the same icon, Escape or a press brings it back`, async () => {
      const tap = width < 700;
      const press = (selector) => (tap ? page.tap(selector) : page.click(selector));
      const { context, page } = await newPage({ width });
      await withProject(page, tap, { clock: false });
      const home = () => page.$eval("#home", (h) => ({ shown: !h.hidden, folded: h.classList.contains("home-folded") }));
      const place = () => page.$eval("#home .home-backdrop", (c) => c.dataset.place.split(" ").map(Number));
      const icons = () => Promise.all(["#home-motion", "#home-fold"].map((s) => page.locator(s).boundingBox()));
      await page.waitForTimeout(1500); // settled in its place under the list
      const [, cyBefore, scaleBefore] = await place();
      const before = await icons();
      const title = await page.locator("#home-title").boundingBox();
      await press("#home-fold");
      assert.deepEqual(await home(), { shown: true, folded: true });
      await page.waitForTimeout(400); // the fade (0.3 s)
      // Everything but the picture and the two icons hidden: not seen, not pressed, not reached by Tab.
      for (const id of ["home-title", "home-card", "home-new", "home-search", "home-items", "home-guide", "home-close"]) {
        assert.equal(await page.$eval(`#${id}`, (e) => getComputedStyle(e).visibility), "hidden", `${id} hidden`);
      }
      assert.equal(await page.$eval("#home .home-scrim", (e) => getComputedStyle(e).opacity), "0", "the scrim gone");
      assert.deepEqual(await icons(), before, "Pause and Fold stay where they were");
      assert.equal(await page.$eval("#home-fold", (b) => b.getAttribute("aria-label")), "Bring the screen back");
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: title.x + title.width / 2, y: title.y + title.height / 2 }), "home", "the title's place takes no press of its own");
      if (!tap) {
        for (let k = 0; k < 3; k++) {
          await page.keyboard.press("Tab");
          const at = await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.id}`);
          // (After the last icon Tab leaves the page for the browser's own controls, as it does unfolded: BODY.)
          assert.ok(["BUTTON home-motion", "BUTTON home-fold", "BODY "].includes(at), `Tab reaches only the icons: ${at}`);
        }
      }
      // The design glides to the window's middle, a little bigger (placeShape with the whole window as its room).
      await page.waitForTimeout(2500);
      const [, cyAfter, scaleAfter] = await place();
      assert.ok(cyAfter < cyBefore && scaleAfter > scaleBefore, `glided up and grew: ${cyBefore} ${scaleBefore} to ${cyAfter} ${scaleAfter}`);
      // The icons still readable with no scrim behind them (read with no focus ring or hover on them, as everywhere here).
      await page.evaluate(() => document.activeElement?.blur());
      if (!tap) await page.mouse.move(2, 2);
      for (const id of ["home-motion", "home-fold"]) await readable(page, id);
      if (shots) await page.screenshot({ path: `${shots}/home-folded-${width}.png` });
      // Pause while folded: paused, still folded.
      await press("#home-motion");
      assert.equal(await mode(page), "still");
      assert.deepEqual(await home(), { shown: true, folded: true });
      await press("#home-motion");
      // The same icon brings it back, there to read and press at once (it fades in, but never waits hidden: CI read the
      // title hidden just after the press while it faded hidden both ways).
      assert.equal(await page.evaluate(() => (document.getElementById("home-fold").click(), getComputedStyle(document.getElementById("home-title")).visibility)), "visible", "back at once");
      assert.deepEqual(await home(), { shown: true, folded: false });
      await press("#home-fold");
      await page.waitForTimeout(400);
      await press("#home-fold");
      assert.deepEqual(await home(), { shown: true, folded: false });
      assert.equal(await page.$eval("#home-title", (e) => getComputedStyle(e).visibility), "visible");
      // A press on the picture brings it back (the card's Carry on is under it unfolded, so this is not a press on it).
      await press("#home-fold");
      if (tap) await page.touchscreen.tap(width / 2, 760);
      else await page.mouse.click(width / 2, 760);
      assert.deepEqual(await home(), { shown: true, folded: false });
      // Escape brings it back without leaving the screen; then Escape leaves as before.
      if (!tap) {
        await page.click("#home-fold");
        await page.keyboard.press("Escape");
        assert.deepEqual(await home(), { shown: true, folded: false });
        assert.equal(await page.evaluate(() => document.activeElement?.id), "home-fold");
        await page.keyboard.press("Escape");
        await until(page, () => document.getElementById("home").hidden, null, "the home screen going");
      }
      await context.close();
    });
  }

  await check("a 2-core machine: the lightest moving picture, not a still one (Ben's laptop)", async () => {
    const { context, page } = await newPage({ cores: 2, clock: true });
    await withProject(page);
    await until(page, () => /^project \d+$/.test(document.querySelector("#home .home-backdrop")?.dataset.shape ?? ""), null, "the project's shape", 3000);
    assert.equal(await mode(page), "live");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.dataset.quality), "2");
    await turnsFor(page, 600, 40, 64); // the lightest version: 20 frames a second
    const a = await picture(page);
    await wait(page, 600);
    assert.ok((await picture(page)) !== a, "it moves");
    // Drawn at 1 pixel a CSS pixel: the canvas is the window's width.
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.width), 1280);
    await context.close();
  });

  // A slow computer stood in for by each frame's measured draw (the clock paused, so a draw takes 0 ms plus the hook's
  // extra): 10 ms is under SLOW_MS (14), so every timed window passes and the full picture keeps moving; 20 ms is over it,
  // so each window steps down: 20 untimed then 30 timed frames a step, at 48, 48 and 64 ms a frame (30, 30 and 20 a
  // second), 2.4 + 2.4 + 3.2 = 8 s from the start to a still picture marked slow. 12 s leaves room for a window already
  // part way when the cost was set. (packages/ui/test/home-backdrop.test.ts works the stepping itself by hand.)
  for (const [cost, want] of [[10, { mode: "live", quality: "0", still: "" }], [20, { mode: "still", quality: "2", still: "slow" }]]) {
    await check(`each frame taking ${cost} ms to draw: ${want.mode === "live" ? "the full picture keeps moving" : "it steps down to a still picture"}`, async () => {
      const { context, page } = await newPage({ clock: "paused" });
      await homeShown(page);
      await ready(page);
      await page.evaluate((ms) => window.fissionTest.backdropCost(ms), cost);
      await wait(page, 12000);
      const state = await page.$eval("#home .home-backdrop", (c) => ({ mode: c.dataset.backdrop, quality: c.dataset.quality, still: c.dataset.still ?? "" }));
      assert.deepEqual(state, want);
      const a = await turn(page);
      await wait(page, 600);
      if (want.mode === "live") await turnsFor(page, 600, 40, 48);
      else assert.deepEqual(await turn(page), a, "still: no frame drawn");
      await context.close();
    });
  }
}

await browser.close();
await server.close();
if (errors.length) {
  failed++;
  console.log(`not ok - page errors:\n  ${errors.join("\n  ")}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
