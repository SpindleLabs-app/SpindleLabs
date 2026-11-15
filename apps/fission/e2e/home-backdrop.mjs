// Browser check of the home screen's living background (packages/ui home-backdrop.ts), in a real Chromium, on the normal
// build with `?all` (which turns the home screen on; E2E_DIST names another build). Without it there is no home screen and
// no background.
// - A first visit: the background moves (two pictures 600 ms apart differ), paints something, and turns the neutral cube,
//   which builds up from the floor, has a ripple of light run through it, and has its top face pulled out and let back
//   (the story's stages in order, within 30 s).
// - With a project kept and reopened under the screen, the background turns that project's own edges within 3 s.
// - The tab hidden: nothing is drawn (two pictures the same); shown again, it moves again.
// - The screen closed: the background stops (mode off).
// - Reduced motion: one still picture (mode still, two pictures the same), still with the project's shape.
// - A weak machine (2 cores): the still picture too.
// - It never takes a press: the card's button under the picture still works; the words keep their contrast (the title's
//   colour against the scrim at its place, 4.5 : 1 or more).
// - At 375 px: nothing runs off the side.
// Screenshots (SHOTS=<dir>) at 1280 and 375 px in both themes; STL=<file> opens that STL as the project shown.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { startWithBox } from "./start.mjs";

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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const homeShown = (page) => until(page, () => { const h = document.getElementById("home"); return h && !h.hidden && document.querySelectorAll("#home-items .home-row, #home-status:not(:empty)").length > 0; }, null, "the home screen");
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

/** A page; `cores` is what the machine says it has (8 unless given, so a small CI runner still shows the moving picture). */
async function newPage({ width = 1280, scheme = "dark", reduce = false, cores = 8, all = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 812 }, hasTouch: width < 700, isMobile: width < 700, colorScheme: scheme, reducedMotion: reduce ? "reduce" : "no-preference" });
  await context.addInitScript((n) => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => n }), cores);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(process.env.STACKS ? e.stack : e.message));
  await page.goto(url + (all ? "?all&test-hooks#design" : "#design"));
  return { context, page };
}

/**
 * The edges of a binary STL's solid as pairs of x y z points: every triangle side whose two triangles don't lie in one
 * plane (normals more than 1° apart) or that has only one. The app can't open STL yet, so a screenshot run with STL=
 * shows that design through the test hook in place of the box's (the box is still kept and checked first).
 */
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
async function withProject(page, tap = false) {
  await homeShown(page);
  await page.click("#home-close");
  await startWithBox(page, tap);
  await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
  await page.waitForTimeout(400);
  await page.reload();
  await homeShown(page);
}

await check("without ?all there is no home screen, so no background", async () => {
  const { context, page } = await newPage({ all: false });
  await page.locator("#start-hint").waitFor();
  if (!process.env.E2E_DIST) assert.equal(await page.$(".home-backdrop"), null); // a build with the screen switched on has one
  await context.close();
});
{
  await check("a first visit: the background moves, paints, and turns the neutral cube", async () => {
    const { context, page } = await newPage();
    await homeShown(page);
    assert.equal(await mode(page), "live");
    assert.equal(await shape(page), "neutral");
    const a = await picture(page);
    await page.waitForTimeout(600);
    assert.ok((await picture(page)) !== a, "two pictures 600 ms apart differ");
    assert.ok((await painted(page)) > 200, "something is painted");
    assert.equal(await page.$eval("#home .home-backdrop", (c) => c.getAttribute("aria-hidden")), "true");
    // The story: it builds up from the floor (half built 5.4 s in), a ripple runs through it (12 to 17.6 s), then the top
    // face is pulled out (the cube's top, out by 0.24 of its size, 20.9 to 24.5 s) and let back (by 27.4 s).
    const stage = () => document.querySelector("#home .home-backdrop").dataset.stage;
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.build === "0.5", null, "half built", 12000);
    assert.equal(await page.evaluate(stage), "building");
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.stage === "ripple", null, "a ripple", 14000);
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.extrude === "0.24", null, "the top face pulled out", 14000);
    assert.equal(await page.evaluate(stage), "extrude");
    await until(page, () => document.querySelector("#home .home-backdrop").dataset.extrude === "0.00", null, "the top face back", 10000);
    if (shots) {
      await page.screenshot({ path: `${shots}/home-empty-1280.png` });
      // The next story builds the next simple part (the L-bracket), part way up.
      await until(page, () => document.querySelector("#home .home-backdrop").dataset.part === "1" && document.querySelector("#home .home-backdrop").dataset.build === "0.7", null, "the bracket building", 45000);
      await page.screenshot({ path: `${shots}/home-empty-1280-build.png` });
    }
    await context.close();
  });

  for (const [width, scheme] of [[1280, "dark"], [1280, "light"], [375, "dark"], [375, "light"]]) {
    await check(`${width} px ${scheme}: the project's own shape turns behind the screen, and the screen still works over it`, async () => {
      const { context, page } = await newPage({ width, scheme });
      await withProject(page, width < 700);
      await until(page, () => /^project \d+$/.test(document.querySelector("#home .home-backdrop")?.dataset.shape ?? ""), null, "the project's shape", 3000);
      assert.equal(await mode(page), "live");
      // Nothing runs off the side.
      assert.equal(await page.evaluate(() => document.getElementById("home").scrollWidth <= window.innerWidth), true);
      // The words straight on the picture (the title, the guide link) against the brightest pixel behind them, read from a
      // screenshot with the words made invisible: 4.5 : 1 or more.
      for (const id of ["home-title", "home-guide"]) {
        const box = await page.locator(`#${id}`).boundingBox();
        const colour = await page.$eval(`#${id}`, (e) => getComputedStyle(e).color);
        await page.$eval(`#${id}`, (e) => (e.style.color = "transparent"));
        const ground = decodePng(await page.screenshot({ clip: box, animations: "disabled" }));
        await page.$eval(`#${id}`, (e) => (e.style.color = ""));
        const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const text = lum(colour.match(/[\d.]+/g).map(Number));
        let worst = Infinity;
        for (let i = 0; i < ground.data.length; i += 4) {
          const l = lum([ground.data[i], ground.data[i + 1], ground.data[i + 2]]);
          const [hi, lo] = text > l ? [text, l] : [l, text];
          worst = Math.min(worst, (hi + 0.05) / (lo + 0.05));
        }
        assert.ok(worst >= 4.5, `${id} contrast ${worst.toFixed(2)} : 1 at its worst pixel`);
      }
      if (shots) {
        if (stl) {
          await page.evaluate((lines) => window.fissionTest.homeStandIn(lines), stlEdges(readFileSync(stl)));
          await until(page, () => /^project \d+$/.test(document.querySelector("#home .home-backdrop")?.dataset.shape ?? ""), null, "the STL's shape", 3000);
        }
        // Part way through building (the next story's, if this one's has gone by), then the ripple and the extrude.
        await until(page, () => document.querySelector("#home .home-backdrop").dataset.build === "0.6" && document.querySelector("#home .home-backdrop").dataset.stage === "building", null, "part built", 45000);
        await page.screenshot({ path: `${shots}/home-${width}-${scheme}-build.png` });
        await until(page, () => document.querySelector("#home .home-backdrop").dataset.stage === "ripple", null, "a ripple", 20000);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${shots}/home-${width}-${scheme}.png` });
        if (scheme === "dark") {
          await until(page, () => document.querySelector("#home .home-backdrop").dataset.extrude === "0.24", null, "the top face held pulled out", 20000);
          await page.screenshot({ path: `${shots}/home-${width}-${scheme}-extrude.png` });
        }
      }
      // The picture takes no press: the card's button works.
      await page.click("#home-carry-on");
      await until(page, () => document.getElementById("home").hidden, null, "the home screen going");
      assert.equal(await mode(page), "off", "closed: the background stops");
      await context.close();
    });
  }

  await check("a hidden tab draws nothing, and moves again once shown", async () => {
    const { context, page } = await newPage();
    await homeShown(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const a = await picture(page);
    await page.waitForTimeout(600);
    assert.ok((await picture(page)) === a, "hidden: the same picture");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(600);
    assert.ok((await picture(page)) !== a, "shown again: it moves");
    await context.close();
  });

  for (const [what, opts] of [["reduced motion", { reduce: true }], ["a 2-core machine", { cores: 2 }]]) {
    await check(`${what}: one still picture, with the project's shape`, async () => {
      const { context, page } = await newPage(opts);
      await withProject(page);
      await until(page, () => /^project \d+$/.test(document.querySelector("#home .home-backdrop")?.dataset.shape ?? ""), null, "the project's shape", 3000);
      assert.equal(await mode(page), "still");
      const a = await picture(page);
      await page.waitForTimeout(700);
      assert.ok((await picture(page)) === a, "no motion");
      assert.ok((await painted(page)) > 200, "the still picture is painted");
      if (shots && opts.reduce) await page.screenshot({ path: `${shots}/home-still-1280.png` });
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
