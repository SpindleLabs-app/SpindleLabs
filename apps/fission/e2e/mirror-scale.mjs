// Browser check of Scale and Mirror body (step 35e2): Modify ▾ has Scale
// and, under "Mirror body", Across XY, XZ and YZ (off with nothing picked,
// saying why; Mirror body no longer coming soon). With the box (40 × 30 ×
// 20 from the origin) picked, Across YZ makes "Mirror 1" in the timeline
// ("Mirror of Box 1 across the YZ plane"), and the STL holds both, worked
// by hand: the box x 0..40 and its mirror image x −40..0, so x −40..40.
// Undo takes it back, Redo puts it back. On a fresh box, Scale: the panel
// opens as Scale with its factor box (and no distances), 2 about the origin
// typed and OK makes "Scale 1", and the STL is x 0..80, y 0..60, z 0..40
// (the box twice its size, by hand). At 1280 px with
// a mouse and at 375 px with taps. Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";
import { preview } from "vite";
import { closePanels, sheetsClearFor, startWithBox } from "./start.mjs";

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
  }
  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed > 0) process.exit(1);
