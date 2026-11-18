// Browser check of the hidden Shell tool (step 35h2c-app2, shell-panel.ts,
// shell-tool.ts, shell-preview.ts, shell-flag.ts): without `?shell` Modify ▾
// has only the greyed coming-soon line; with it, Shell opens its panel, a
// click (or tap) on a face opens it, the hollow is previewed by the kernel
// before OK (the panel notes the volume drawn), picking goes on over the
// preview, a thickness the walls can't take is refused in the kernel's words,
// and OK (Enter, or the phone bar's Finish Shell) records one undo step; Edit
// feature changes the thickness. The design: Box 1, 40 × 30 × 20 at the
// origin, opened from a file; every volume is worked out by hand beside it.
// 1280 px with a mouse and 375 px with taps. Screenshots go to E2E_SHOTS when
// set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4987, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4987/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

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

/** The toolbar's STL: its enclosed volume (mm³, the sum over triangles of the signed tetrahedra to the origin) and its bounds. */
async function stl(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  let volume = 0;
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    volume += dot(a, cross(b, c)) / 6;
    pts.push(a, b, c);
  }
  return { volume, bounds: [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]) };
}
function near(got, volume, bounds, what) {
  assert.ok(Math.abs(got.volume - volume) <= 0.05, `${what}: volume ${got.volume}, want ${volume}`);
  got.bounds.flat().forEach((x, i) => assert.ok(Math.abs(x - bounds.flat()[i]) <= 1e-3, `${what}: bounds ${JSON.stringify(got.bounds)}, want ${JSON.stringify(bounds)}`));
}

const features = [
  {
    dependsOn: [],
    id: "feature-1",
    intent: { parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm", type: "box" },
    provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Shell check", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const BOUNDS = [[0, 40], [0, 30], [0, 20]];
const AS_MADE = 24000;
// Walls t thick inside the 40 × 30 × 20 box take away the box moved in by t on every closed face:
// top open (40 − 2t)(30 − 2t)(20 − t); top and front open (40 − 2t)(30 − t)(20 − t); sealed (40 − 2t)(30 − 2t)(20 − 2t).
const topOpen = (t) => AS_MADE - (40 - 2 * t) * (30 - 2 * t) * (20 - t);
const topFrontOpen = (t) => AS_MADE - (40 - 2 * t) * (30 - t) * (20 - t);
const sealed = (t) => AS_MADE - (40 - 2 * t) * (30 - 2 * t) * (20 - 2 * t);
// The middle of the top face, of the front face (y = 0), and a point on the front face 1 mm above the floor (left as a rim once the front is open with 2 mm walls).
const TOP = [20, 15, 20];
const FRONT = [20, 0, 10];
const FRONT_RIM = [20, 0, 1];
// A point on the top's rim (y 0..3) once the top is open with 3 mm walls.
const TOP_RIM = [20, 1.5, 20];

async function fresh(width, height, tap, query) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "shell.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "the file open", 15000);
  await rebuilt(page);
  await settle(page);
  return page;
}

/** Modify ▾'s items' ids, the menu opened and shut again. */
async function modifyItems(page, tap) {
  await closePanels(page, tap);
  await press(page, "#modify-menu", tap);
  await until(page, () => !document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ opens");
  const ids = await page.$$eval("#modify-menu-menu [id]", (els) => els.map((e) => e.id).filter((id) => id.startsWith("modify-menu-") || id.startsWith("coming-")));
  await page.keyboard.press("Escape");
  return ids;
}
const opened = (page) => until(page, () => document.getElementById("shell-panel")?.hidden === false, null, "the Shell panel open");
const closed = (page) => until(page, () => document.getElementById("shell-panel")?.hidden === true, null, "the Shell panel closed");
const facesSay = (page, want) => until(page, (w) => document.getElementById("shell-faces")?.textContent === w, want, `the panel says ${want}`);
const previewSays = (page, volume) => until(page, (w) => (document.getElementById("shell-panel")?.dataset.previewVolume ?? "") === w, volume === null ? "" : volume.toFixed(3), `the preview draws ${volume ?? "nothing"}`);
const items = (page, n) => until(page, (k) => document.querySelectorAll("#timeline li[data-item]").length === k, n, `${n} timeline items`);
const shot = async (page, name) => shots && (await page.screenshot({ path: `${shots}/${name}.png` }));

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
  await check("without ?shell there is no Shell: Modify ▾ shows it greyed as coming soon, and the panel never opens", async () => {
    const page = await fresh(1280, 800, false, "");
    try {
      const ids = await modifyItems(page, false);
      assert.ok(!ids.includes("modify-menu-shell"), JSON.stringify(ids));
      assert.ok(ids.includes("coming-shell"), JSON.stringify(ids));
      assert.equal(await page.$eval("#shell-panel", (p) => p.hidden), true);
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: Shell opens the top, previews 3,784 mm³ at 1 mm and 7,152 at 2, opens the front too (5,856), a click on the front's rim closes it again, a thickness the walls can't take is refused in the kernel's words, Enter records 7,152 mm³ as one undo step", async () => {
    const page = await fresh(1280, 800, false, "&shell");
    try {
      near(await stl(page, false), AS_MADE, BOUNDS, "as made");
      const ids = await modifyItems(page, false);
      assert.ok(ids.includes("modify-menu-shell") && !ids.includes("coming-shell"), JSON.stringify(ids));
      await press(page, "#modify-menu", false);
      await press(page, "#modify-menu-shell", false);
      await opened(page);
      await facesSay(page, "Click the faces to leave open");
      assert.equal(await page.$eval("#shell-ok", (b) => b.disabled), true, "OK off with nothing picked");
      assert.equal(await page.$eval("#shell-hint", (h) => [h.hidden, h.textContent].join()), "false,Shell: click or tap the faces to leave open");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "shell-thickness", "a mouse gets the typing");
      await shot(page, "shell-1280-empty");
      await at(page, TOP);
      await facesSay(page, "1 face open");
      assert.equal(await page.$eval("#shell-hint", (h) => h.hidden), true, "the hint goes with a face picked");
      // 24,000 − 38 · 28 · 19 = 3,784 drawn before OK; the box round the drawing still 40 × 30 × 20.
      await previewSays(page, topOpen(1));
      assert.equal(await page.$eval("#viewport", (v) => v.dataset.drawnBox), "0.000 0.000 0.000 40.000 30.000 20.000");
      await page.locator("#shell-thickness").fill("2");
      // 24,000 − 36 · 26 · 18 = 7,152.
      await previewSays(page, topOpen(2));
      await shot(page, "shell-1280-preview");
      // Picking goes on over the drawn preview: the front opens too, 24,000 − 36 · 28 · 18 = 5,856.
      await at(page, FRONT);
      await facesSay(page, "2 faces open");
      await previewSays(page, topFrontOpen(2));
      await shot(page, "shell-1280-two-open");
      // The front's rim as drawn (1 mm above the floor, inside the 2 mm wall's bottom strip) is the front face: a click closes it again.
      await at(page, FRONT_RIM);
      await facesSay(page, "1 face open");
      await previewSays(page, topOpen(2));
      // 16 mm walls in a 30 mm deep box run into each other: nothing drawn, the kernel's refusal in red.
      await page.locator("#shell-thickness").fill("16");
      await previewSays(page, null);
      await until(page, () => document.getElementById("shell-panel")?.dataset.previewRefused === "true" && document.getElementById("shell-preview-why")?.hidden === false, null, "the refusal said in red");
      await shot(page, "shell-1280-refused");
      await page.keyboard.press("Enter");
      await until(page, () => document.getElementById("shell-error")?.hidden === false, null, "OK refused in words");
      await items(page, 1);
      await page.locator("#shell-thickness").fill("2");
      await previewSays(page, topOpen(2));
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      assert.equal(await page.$eval('#timeline [data-item="feature-2"]', (li) => li.dataset.icon), "shell");
      near(await stl(page, false), topOpen(2), BOUNDS, "shelled, 2 mm walls");
      await shot(page, "shell-1280-done");
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), AS_MADE, BOUNDS, "undone in one step");
      await press(page, "#redo", false);
      await rebuilt(page);
      near(await stl(page, false), topOpen(2), BOUNDS, "redone");
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: a face selected before Shell opens starts open; clicked again the body is shelled sealed (4,848 mm³ at 1 mm); then Edit feature from the bar: Escape keeps it, 3 typed previews and records 24,000 − 34 · 24 · 14 = 12,576 as Edit Shell 1", async () => {
    const page = await fresh(1280, 800, false, "&shell");
    try {
      await at(page, TOP);
      // A face selected before Shell opens: it starts with that face open; clicked again it closes, leaving the body sealed.
      await press(page, "#modify-menu", false);
      await press(page, "#modify-menu-shell", false);
      await opened(page);
      await facesSay(page, "1 face open");
      await previewSays(page, topOpen(1));
      // The top's middle is the opening now: a click there lands on an inside wall, which opens nothing, said in words.
      await at(page, TOP);
      await until(page, () => document.getElementById("shell-error")?.textContent.startsWith("That is an inside wall"), null, "an inside wall opens nothing");
      await facesSay(page, "1 face open");
      // The top's rim as drawn (y 0..3 with 3 mm walls: 24,000 − 34 · 24 · 17 = 10,128) is the top face: a click closes it
      // again, leaving the body sealed; back to 1 mm.
      await page.locator("#shell-thickness").fill("3");
      await previewSays(page, topOpen(3));
      await at(page, TOP_RIM);
      await facesSay(page, "No face open: sealed, hollow inside");
      await previewSays(page, sealed(3));
      await page.locator("#shell-thickness").fill("1");
      // Sealed, 1 mm: 24,000 − 38 · 28 · 18 = 4,848.
      await previewSays(page, sealed(1));
      await shot(page, "shell-1280-sealed");
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      near(await stl(page, false), sealed(1), BOUNDS, "sealed");
      const edit = async () => {
        await closePanels(page, false);
        await page.click('#timeline [data-item="feature-2"]', { button: "right" });
        await until(page, () => document.getElementById("row-menu")?.open, null, "Shell 1's menu");
        assert.equal(await page.$eval("#row-menu-edit", (b) => b.disabled), false, "Edit feature is on");
        await page.click("#row-menu-edit");
        await opened(page);
      };
      await edit();
      assert.equal(await page.textContent("#shell-title"), "Edit Shell 1");
      await facesSay(page, "No face open: sealed, hollow inside");
      assert.equal(await page.$eval("#shell-edit-note", (n) => n.hidden), false);
      assert.equal(await page.$eval("#shell-thickness", (b) => b.value), "1");
      await previewSays(page, sealed(1));
      await page.locator("#shell-thickness").fill("3");
      await previewSays(page, sealed(3));
      await page.keyboard.press("Escape");
      await closed(page);
      near(await stl(page, false), sealed(1), BOUNDS, "Escape changed nothing");
      await edit();
      await page.locator("#shell-thickness").fill("3");
      await previewSays(page, sealed(3));
      await shot(page, "shell-1280-edit");
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      near(await stl(page, false), sealed(3), BOUNDS, "edited to 3 mm");
      await until(page, () => /^Undo Edit Shell 1/.test(document.getElementById("undo")?.getAttribute("title") ?? ""), null, "Undo names the edit");
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), sealed(1), BOUNDS, "the edit undone in one step");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps: the top tapped opens the sheet on the box, 2 typed, the bar's Finish Shell records 7,152 mm³; Cancel from the bar records nothing; the bottom bar stays in place", async () => {
    const page = await fresh(375, 667, true, "&shell");
    try {
      const barBox = await page.locator("#timeline").boundingBox();
      await closePanels(page, true);
      await press(page, "#modify-menu", true);
      await press(page, "#modify-menu-shell", true);
      await opened(page);
      const bar = () => page.evaluate(() => {
        const b = document.getElementById("phone-float");
        return b && !b.hidden ? { kind: b.dataset.kind, finish: document.getElementById("float-finish")?.textContent, off: document.getElementById("float-finish")?.disabled, cancel: !!document.getElementById("float-cancel") } : null;
      });
      assert.deepEqual(await bar(), { kind: "shell", finish: "Finish Shell", off: true, cancel: true }, "the bar, Finish off with nothing picked");
      assert.notEqual(await page.evaluate(() => document.activeElement?.id), "shell-thickness", "no keyboard over the view on a touch screen");
      await shot(page, "shell-375-empty");
      await at(page, TOP, true);
      await facesSay(page, "1 face open");
      await page.waitForTimeout(300);
      assert.equal(await page.getAttribute("#properties-toggle", "aria-expanded"), "true", "the sheet opened on the box");
      await page.locator("#shell-thickness").tap();
      await page.locator("#shell-thickness").fill("2");
      await previewSays(page, topOpen(2));
      await shot(page, "shell-375-picked");
      assert.deepEqual(await bar(), { kind: "shell", finish: "Finish Shell", off: false, cancel: true }, "Finish on");
      await page.tap("#float-finish");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      assert.equal(await bar(), null, "the bar goes with the tool");
      near(await stl(page, true), topOpen(2), BOUNDS, "shelled 2 mm");
      await shot(page, "shell-375-done");
      const after = await page.locator("#timeline").boundingBox();
      assert.deepEqual([after.y, after.height].map(Math.round), [barBox.y, barBox.height].map(Math.round), "the bottom bar where it was");
      await press(page, "#modify-menu", true);
      await press(page, "#modify-menu-shell", true);
      await opened(page);
      await page.tap("#float-cancel");
      await closed(page);
      await items(page, 2);
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
