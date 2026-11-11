// Browser check of Scale and Mirror body (step 35e2): Modify ▾ has Scale
// and, under "Mirror body", Across XY, XZ and YZ (off with nothing picked,
// saying why; Mirror body no longer coming soon). With the box (40 × 30 ×
// 20 from the origin) picked, Across YZ makes "Mirror 1" in the timeline
// ("Mirror of Box 1 across the YZ plane"), and the STL holds both, worked
// by hand: the box x 0..40 and its mirror image x −40..0, so x −40..40.
// Undo takes it back, Redo puts it back. On a fresh box, Scale: the panel
// opens as Scale with its factor box (and no distances), 2 about the origin
// typed and OK makes "Scale 1", and the STL is x 0..80, y 0..60, z 0..40
// (the box twice its size, by hand). Scale's slider (Ben 11-09): dragged
// (arrow keys with the mouse, a finger at its right end) it sets the factor
// box and the view shows the bigger box at once, before OK (pixel probe off
// the old box's corner); back in the middle it is 1 and drawn as it was;
// OK on 2 from the slider gives the same STL as 2 typed. At 1280 px with
// a mouse and at 375 px with taps. Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";
import { preview } from "vite";
import { closePanels, openPanel, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4627, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4627/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));

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

const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const rebuilt = (page) => until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");

/** A click or tap on model point `p` in the view the box opens in, the sheets put away first. */
async function pressAt(page, p, tap) {
  await closePanels(page, tap);
  const s = screenPoint(await page.locator("#viewport canvas").boundingBox(), p, HOME);
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y]), "CANVAS", `(${p}) is on the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
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

/** Modify ▾ opened, and its Scale and Mirror items' states. */
async function modifyItems(page, tap) {
  await press(page, "#modify-menu", tap);
  await until(page, () => !document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ opens");
  return page.evaluate(() => {
    const state = (id) => {
      const b = document.getElementById(id);
      return b === null ? null : { off: b.getAttribute("aria-disabled") === "true", title: b.title };
    };
    return { scale: state("modify-menu-scale"), xy: state("modify-menu-mirror-xy"), xz: state("modify-menu-mirror-xz"), yz: state("modify-menu-mirror-yz"), coming: document.getElementById("coming-mirror") !== null };
  });
}

/** The box's top picked: the middle of its top, (20, 15, 20), picks its top face, which stands for the box. */
async function pickBox(page, tap) {
  await pressAt(page, [20, 15, 20], tap);
  await until(page, () => document.body.dataset.selection === "face:feature-1/top", null, "the box's top picked").catch(async (e) => assert.fail(`${e.message} (picked: ${await page.evaluate(() => document.body.dataset.selection)})`));
}

/** The 3D view's pixels (every 4th in each direction, RGB), after a frame or two to paint. */
async function viewPixels(page) {
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const src = document.querySelector("#viewport canvas");
    const c = document.createElement("canvas");
    [c.width, c.height] = [src.width, src.height];
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out = [];
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) out.push(...d.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 3));
    return out;
  });
}
/** The share of the view's pixels that differ by more than 12 in a channel. */
function changed(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 3) if ([0, 1, 2].some((k) => Math.abs(a[i + k] - b[i + k]) > 12)) n++;
  return n / (a.length / 3);
}

const items = (page) => page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.dataset.item));
const undoTitle = (page) => page.getAttribute("#undo", "title");

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
    const at = `${width} px${tap ? ", taps" : ""}`;
    await check(`${at}: Mirror body is off with nothing picked; across YZ it makes Mirror 1, the STL by hand; Undo and Redo`, async () => {
      const page = await fresh(width, height, tap);
      try {
        const off = "Pick one or more bodies first, then Mirror.";
        const none = await modifyItems(page, tap);
        assert.deepEqual([none.xy, none.xz, none.yz].map((i) => i?.off), [true, true, true], "nothing picked: Mirror body off");
        assert.equal(none.yz.title, off);
        assert.equal(none.coming, false, "Mirror body is no longer coming soon");
        assert.equal(none.scale?.off, false, "Scale opens with nothing picked, as Move does");
        await page.keyboard.press("Escape");
        await until(page, () => document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ closed");
        await pickBox(page, tap);
        const picked = await modifyItems(page, tap);
        assert.equal(picked.yz.off, false, "on once a body is picked");
        if (shots) await page.screenshot({ path: `${shots}/mirror-menu-${width}.png` });
        await press(page, "#modify-menu-mirror-yz", tap);
        await rebuilt(page);
        assert.match(await undoTitle(page), /Mirror bodies/);
        assert.deepEqual(await items(page), ["feature-1", "feature-2"]);
        assert.equal(await page.getAttribute('#timeline [data-item="feature-2"]', "title"), "2. Mirror 1\nMirror of Box 1 across the YZ plane");
        assert.equal(await page.evaluate(() => document.body.dataset.selection), "body:feature-2", "the mirror image picked");
        assert.equal(await page.evaluate(() => document.getElementById("move-panel")?.hidden !== false), true, "no Move opened: the mirror is already off the box");
        // The box x 0..40 and its mirror image across YZ (x → −x) x −40..0.
        near(await stlBounds(page, tap), [[-40, 40], [0, 30], [0, 20]], "the STL with the box and its mirror");
        if (shots) await page.screenshot({ path: `${shots}/mirror-done-${width}.png` });
        await press(page, "#undo", tap);
        await rebuilt(page);
        assert.deepEqual(await items(page), ["feature-1"]);
        near(await stlBounds(page, tap), [[0, 40], [0, 30], [0, 20]], "after Undo");
        await press(page, "#redo", tap);
        await rebuilt(page);
        assert.deepEqual(await items(page), ["feature-1", "feature-2"]);
      } finally {
        await page.context().close();
      }
    });
    await check(`${at}: Scale opens as Scale with its factor box; 2× about the origin makes Scale 1, the STL by hand`, async () => {
      const page = await fresh(width, height, tap);
      try {
        // A fresh box (the view as it opens, so its top is where pickBox looks), picked; Modify ▾ Scale.
        await pickBox(page, tap);
        await modifyItems(page, tap);
        await press(page, "#modify-menu-scale", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the panel open as Scale");
        const panel = await page.evaluate(() => ({
          kind: document.getElementById("move-panel").dataset.kind,
          title: document.getElementById("move-title").textContent,
          factor: document.getElementById("move-scale")?.value,
          scaleRow: !document.getElementById("move-scale").closest(".move-panel-row").hidden,
          distances: !document.getElementById("move-distance").hidden,
          snap: !document.getElementById("move-snap").hidden,
        }));
        assert.deepEqual(panel, { kind: "scale", title: "Scale", factor: "1", scaleRow: true, distances: false, snap: false });
        assert.equal(await page.textContent("#move-bodies"), "Body: Box 1");
        // On a phone the bar over the view finishes the tool by its own name.
        if (tap) await until(page, () => /Finish Scale/.test(document.getElementById("phone-float")?.textContent ?? ""), null, "the phone's bar says Finish Scale");
        // About the origin (the pivot opened on the box's middle): open the pivot fold and type 0, 0, 0; factor 2.
        await page.evaluate(() => (document.getElementById("move-pivot-fold").open = true));
        for (const k of ["X", "Y", "Z"]) await page.fill(`#move-pivot${k}`, "0");
        await page.fill("#move-scale", "2");
        if (shots) await page.screenshot({ path: `${shots}/scale-panel-${width}.png` });
        await press(page, "#move-ok", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the panel closed");
        await rebuilt(page);
        assert.match(await undoTitle(page), /Scale bodies/);
        assert.deepEqual(await items(page), ["feature-1", "feature-2"]);
        assert.equal(await page.getAttribute('#timeline [data-item="feature-2"]', "title"), "2. Scale 1\nScale Box 1 by 2× about (0, 0, 0) mm");
        // The box twice its size about the origin: x 0..80, y 0..60, z 0..40.
        near(await stlBounds(page, tap), [[0, 80], [0, 60], [0, 40]], "the STL after Scale");
        if (shots) await page.screenshot({ path: `${shots}/scale-done-${width}.png` });
      } finally {
        await page.context().close();
      }
    });
    await check(`${at}: Scale's slider sets the factor and the view shows it at once, before OK; back to the middle is 1`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await pickBox(page, tap);
        await modifyItems(page, tap);
        await press(page, "#modify-menu-scale", tap);
        await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the panel open as Scale");
        if (tap) await closePanels(page, tap); // the sheet put away, the tool still open
        // Before any drag (1×): the view as it is now, the box as it was.
        const before = await viewPixels(page);
        if (tap) {
          // A finger at the slider's right end: well over 5×.
          await openPanel(page, "properties", tap);
          const b = await page.locator("#scale-slider").boundingBox();
          await page.tap("#scale-slider", { position: { x: b.width - 4, y: b.height / 2 } });
          await until(page, () => Number(document.getElementById("move-scale")?.value) > 5, null, "the factor set by the finger");
          if (shots) await page.screenshot({ path: `${shots}/scale-slider-sheet-${width}.png` });
          await closePanels(page, tap);
        } else {
          // 30 steps right is 10^0.3, two decimals 2 (scale-slider.ts, by hand).
          await page.focus("#scale-slider");
          for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
          assert.equal(await page.inputValue("#move-scale"), "2");
        }
        if (shots) await page.screenshot({ path: `${shots}/scale-slider-${width}.png` });
        // The box twice (or, by the finger, over five times) its size about its middle covers far more of the view: at 2× its
        // drawn outline is four times the area, at 1280 × 800 about a sixth of the view before, so well over 10% of the pixels change.
        const grown = changed(await viewPixels(page), before);
        assert.ok(grown > 0.1, `previewed before OK: ${(grown * 100).toFixed(1)}% of the view changed`);
        assert.equal(await items(page).then((l) => l.length), 1, "nothing recorded yet");
        // Back to the middle: 1, drawn as it was.
        await page.evaluate(() => {
          const s = document.getElementById("scale-slider");
          s.value = "0";
          s.dispatchEvent(new Event("input", { bubbles: true }));
        });
        assert.equal(await page.inputValue("#move-scale"), "1");
        if (tap) await closePanels(page, tap);
        const back = changed(await viewPixels(page), before);
        assert.ok(back < 0.005, `back to 1×: drawn as it was (${(back * 100).toFixed(2)}% of the view changed)`);
        if (!tap) {
          // 2 from the slider about the origin, OK: the same STL as 2 typed (x 0..80, y 0..60, z 0..40 by hand).
          await page.evaluate(() => (document.getElementById("move-pivot-fold").open = true));
          for (const k of ["X", "Y", "Z"]) await page.fill(`#move-pivot${k}`, "0");
          await page.focus("#scale-slider");
          for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
          await press(page, "#move-ok", tap);
          await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the panel closed");
          await rebuilt(page);
          near(await stlBounds(page, tap), [[0, 80], [0, 60], [0, 40]], "the STL after Scale by the slider");
        }
      } finally {
        await page.context().close();
      }
    });
  }
  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed > 0) process.exit(1);
