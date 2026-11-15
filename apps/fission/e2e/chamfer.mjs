// Browser check of the hidden Chamfer tool (step 44a-app2, chamfer-panel.ts,
// chamfer-tool.ts, chamfer-flag.ts): without `?chamfer` Modify ▾ has only the
// greyed coming-soon line; with it, Chamfer opens its panel, a click (or tap)
// on an edge picks it, the size is typed (with a mouse straight away, the box
// having the typing as the panel opens), an edge meeting the picked one at a
// corner is refused in words, and OK (Enter, or the phone bar's Finish
// Chamfer) records one undo step. The design: Box 1, 40 × 30 × 20 at the
// origin, opened from a file. Worked by hand: a chamfer of d along the top
// front edge (y = 0, z = 20, x 0..40) takes a right triangle's prism,
// 40 · d · d / 2, so d = 2 leaves 24,000 − 80 = 23,920 mm³ and d = 3 leaves
// 24,000 − 180 = 23,820 mm³, the box's bounds unchanged. 1280 px with a
// mouse and 375 px with taps. Screenshots go to E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`). 44a-app3 adds the cut previewed
// before OK (the panel notes the volume drawn) and Edit feature on a Chamfer
// from its bar item, at both widths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4953, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4953/";
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
const project = { formatVersion: 2, links: [], materials: [], name: "Chamfer check", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const BOUNDS = [[0, 40], [0, 30], [0, 20]];
const AS_MADE = 24000;
const chamfered = (d) => 24000 - (40 * d * d) / 2;
// The middles of the top front edge (y = 0, z = 20) and the top right edge (x = 40, z = 20), which meet at (40, 0, 20).
const TOP_FRONT = [20, 0, 20];
const TOP_RIGHT = [40, 15, 20];
// The middle of the bottom front edge (y = 0, z = 0), which meets neither.
const BOTTOM_FRONT = [20, 0, 0];
const CORNER_WORDS = "That edge meets an edge already picked at a corner";

async function fresh(width, height, tap, query) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "chamfer.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
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
const opened = (page) => until(page, () => document.getElementById("chamfer-panel")?.hidden === false, null, "the Chamfer panel open");
const closed = (page) => until(page, () => document.getElementById("chamfer-panel")?.hidden === true, null, "the Chamfer panel closed");
const edgesSay = (page, want) => until(page, (w) => document.getElementById("chamfer-edges")?.textContent === w, want, `the panel says ${want}`);
/** The volume the Chamfer's preview draws (44a-app3), as the panel notes it: "" when none is drawn. */
const drawnVolume = (page) => page.$eval("#chamfer-panel", (p) => p.dataset.previewVolume ?? "");
const previewSays = (page, volume) => until(page, (w) => (document.getElementById("chamfer-panel")?.dataset.previewVolume ?? "") === w, volume === null ? "" : volume.toFixed(3), `the preview draws ${volume ?? "nothing"}`);
const items = (page, n) => until(page, (k) => document.querySelectorAll("#timeline li[data-item]").length === k, n, `${n} timeline items`);

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
  await check("without ?chamfer there is no Chamfer: Modify ▾ shows it greyed as coming soon, and the panel never opens", async () => {
    const page = await fresh(1280, 800, false, "");
    try {
      const ids = await modifyItems(page, false);
      assert.ok(!ids.includes("modify-menu-chamfer"), JSON.stringify(ids));
      assert.ok(ids.includes("coming-chamfer"), JSON.stringify(ids));
      assert.equal(await page.$eval("#chamfer-panel", (p) => p.hidden), true);
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: Chamfer picks the top front edge, refuses the top right one at their corner, takes 2 typed straight away and Enter: 23,920 mm³ as one undo step", async () => {
    const page = await fresh(1280, 800, false, "&chamfer");
    try {
      near(await stl(page, false), AS_MADE, BOUNDS, "as made");
      const ids = await modifyItems(page, false);
      assert.ok(ids.includes("modify-menu-chamfer") && !ids.includes("coming-chamfer"), JSON.stringify(ids));
      await press(page, "#modify-menu", false);
      await press(page, "#modify-menu-chamfer", false);
      await opened(page);
      await edgesSay(page, "Click the edges to chamfer");
      assert.equal(await page.$eval("#chamfer-ok", (b) => b.disabled), true, "OK off with no edge");
      assert.equal(await page.$eval("#chamfer-hint", (h) => [h.hidden, h.textContent].join()), "false,Chamfer: click or tap the straight edges to cut back");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-empty.png` });
      await at(page, TOP_FRONT);
      await edgesSay(page, "1 edge");
      assert.equal(await page.$eval("#chamfer-hint", (h) => h.hidden), true, "the hint goes with an edge picked");
      // The edge lit as selected: one edge in the selection.
      // A second edge meeting it at (40, 0, 20): refused in words, still one edge.
      await at(page, TOP_RIGHT);
      await until(page, (w) => document.getElementById("chamfer-error")?.textContent.startsWith(w), CORNER_WORDS, "the corner refused in words");
      await edgesSay(page, "1 edge");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-refused.png` });
      // With a mouse the Distance box has the typing: its 1 selected, so "2" replaces it.
      await page.locator("#chamfer-distance").click();
      await page.locator("#chamfer-distance").fill("2");
      await until(page, () => document.getElementById("chamfer-error")?.hidden === true, null, "typing put the refusal away");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-picked.png` });
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-after-ok.png` });
      near(await stl(page, false), chamfered(2), BOUNDS, "chamfered 2 mm");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-done.png` });
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), AS_MADE, BOUNDS, "undone in one step");
      await press(page, "#redo", false);
      await rebuilt(page);
      near(await stl(page, false), chamfered(2), BOUNDS, "redone");
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px: the size typed as the panel opens goes straight into the Distance box", async () => {
    const page = await fresh(1280, 800, false, "&chamfer");
    try {
      await at(page, TOP_FRONT); // selected before Chamfer opens: it starts with this edge
      await press(page, "#modify-menu", false);
      await press(page, "#modify-menu-chamfer", false);
      await opened(page);
      await edgesSay(page, "1 edge");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "chamfer-distance");
      await page.keyboard.type("2");
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      near(await stl(page, false), chamfered(2), BOUNDS, "2 typed, Enter");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps: an edge tapped opens the sheet on the size boxes, 3 typed, the bar's Finish Chamfer records it: 23,820 mm³; Escape-free Cancel records nothing", async () => {
    const page = await fresh(375, 667, true, "&chamfer");
    try {
      await closePanels(page, true);
      await press(page, "#modify-menu", true);
      await press(page, "#modify-menu-chamfer", true);
      await opened(page);
      const bar = () => page.evaluate(() => {
        const b = document.getElementById("phone-float");
        return b && !b.hidden ? { kind: b.dataset.kind, finish: document.getElementById("float-finish")?.textContent, off: document.getElementById("float-finish")?.disabled, cancel: !!document.getElementById("float-cancel") } : null;
      });
      assert.deepEqual(await bar(), { kind: "chamfer", finish: "Finish Chamfer", off: true, cancel: true }, "the bar, Finish off with no edge");
      assert.notEqual(await page.evaluate(() => document.activeElement?.id), "chamfer-distance", "no keyboard over the view on a touch screen");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-375-empty.png` });
      await at(page, TOP_FRONT, true);
      await edgesSay(page, "1 edge");
      await page.waitForTimeout(300);
      assert.equal(await page.getAttribute("#properties-toggle", "aria-expanded"), "true", "the sheet opened on the boxes");
      await page.locator("#chamfer-distance").tap();
      await page.locator("#chamfer-distance").fill("3");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-375-picked.png` });
      assert.deepEqual(await bar(), { kind: "chamfer", finish: "Finish Chamfer", off: false, cancel: true }, "Finish on");
      await page.tap("#float-finish");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      assert.equal(await bar(), null, "the bar goes with the tool");
      near(await stl(page, true), chamfered(3), BOUNDS, "chamfered 3 mm");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-375-done.png` });
      // Again, cancelled from the bar: nothing recorded.
      await press(page, "#modify-menu", true);
      await press(page, "#modify-menu-chamfer", true);
      await opened(page);
      await page.tap("#float-cancel");
      await closed(page);
      await items(page, 2);
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px (44a-app3): the cut previewed before OK (23,920 mm³ at 2, 23,820 at 3), the bar's chamfer icon, then Edit feature on it: Escape keeps it, 3 typed and Enter makes it 23,820 mm³ as one undo step", async () => {
    const page = await fresh(1280, 800, false, "&chamfer");
    try {
      await press(page, "#modify-menu", false);
      await press(page, "#modify-menu-chamfer", false);
      await opened(page);
      assert.equal(await drawnVolume(page), "", "nothing drawn with no edge");
      await at(page, TOP_FRONT);
      await edgesSay(page, "1 edge");
      // Picked at 1 mm: 24,000 − 40 · 1 · 1 / 2 = 23,980 drawn before OK, the box round the drawing still 40 × 30 × 20.
      await previewSays(page, chamfered(1));
      await page.locator("#chamfer-distance").fill("2");
      await previewSays(page, chamfered(2));
      assert.equal(await page.$eval("#viewport", (v) => v.dataset.drawnBox), "0.000 0.000 0.000 40.000 30.000 20.000");
      // Picking goes on over the drawn preview: the bottom front edge (y = 0, z = 0) is added, 24,000 − 2 · 80 = 23,840; then a
      // click on its chamfer's face as drawn, (20, 1, 1) halfway across the 2 mm cut, takes it out again (the edge itself is cut away).
      await at(page, BOTTOM_FRONT);
      await edgesSay(page, "2 edges");
      await previewSays(page, 24000 - 2 * ((40 * 2 * 2) / 2));
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-preview.png` });
      await at(page, [20, 1, 1]);
      await edgesSay(page, "1 edge");
      await previewSays(page, chamfered(2));
      // Too big for the 20 mm front face: nothing drawn, and OK says the kernel's words.
      await page.locator("#chamfer-distance").fill("25");
      await previewSays(page, null);
      await page.locator("#chamfer-distance").fill("2");
      await previewSays(page, chamfered(2));
      // Enter records it.
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      assert.equal(await page.$eval('#timeline [data-item="feature-2"]', (li) => li.dataset.icon), "chamfer");
      // Edit feature from its bar item's menu.
      const edit = async () => {
        await closePanels(page, false);
        await page.click('#timeline [data-item="feature-2"]', { button: "right" });
        await until(page, () => document.getElementById("row-menu")?.open, null, "Chamfer 1's menu");
        assert.equal(await page.$eval("#row-menu-edit", (b) => b.disabled), false, "Edit feature is on");
        await page.click("#row-menu-edit");
        await opened(page);
      };
      await edit();
      assert.equal(await page.textContent("#chamfer-title"), "Edit Chamfer 1");
      await edgesSay(page, "1 edge");
      assert.equal(await page.$eval("#chamfer-edit-note", (n) => n.hidden), false);
      assert.equal(await page.$eval("#chamfer-distance", (b) => b.value), "2");
      await previewSays(page, chamfered(2));
      await page.locator("#chamfer-distance").fill("3");
      await previewSays(page, chamfered(3));
      // Escape: nothing changes, the body drawn as it is.
      await page.keyboard.press("Escape");
      await closed(page);
      near(await stl(page, false), chamfered(2), BOUNDS, "Escape changed nothing");
      await edit();
      await page.locator("#chamfer-distance").fill("3");
      await previewSays(page, chamfered(3));
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-edit.png` });
      await page.keyboard.press("Enter");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      near(await stl(page, false), chamfered(3), BOUNDS, "edited to 3 mm");
      await until(page, () => /^Undo Edit Chamfer 1/.test(document.getElementById("undo")?.getAttribute("title") ?? ""), null, "Undo names the edit");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-1280-edited.png` });
      await press(page, "#undo", false);
      await rebuilt(page);
      near(await stl(page, false), chamfered(2), BOUNDS, "the edit undone in one step");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps (44a-app3): Edit feature from the bar item's ⋯, the preview at 4 mm (23,680 mm³), the bar's Finish Chamfer records it", async () => {
    const page = await fresh(375, 667, true, "&chamfer");
    try {
      await closePanels(page, true);
      await press(page, "#modify-menu", true);
      await press(page, "#modify-menu-chamfer", true);
      await opened(page);
      await at(page, TOP_FRONT, true);
      await edgesSay(page, "1 edge");
      await previewSays(page, chamfered(1));
      await page.tap("#float-finish");
      await closed(page);
      await rebuilt(page);
      await items(page, 2);
      near(await stl(page, true), chamfered(1), BOUNDS, "chamfered 1 mm");
      await closePanels(page, true);
      await page.locator('#timeline [data-item="feature-2"]').tap();
      await page.tap('#timeline [data-more="feature-2"]');
      await until(page, () => document.getElementById("row-menu")?.open, null, "Chamfer 1's menu");
      await page.tap("#row-menu-edit");
      await opened(page);
      assert.equal(await page.textContent("#chamfer-title"), "Edit Chamfer 1");
      await page.waitForTimeout(300);
      if ((await page.getAttribute("#properties-toggle", "aria-expanded")) !== "true") await page.tap("#properties-toggle");
      await page.locator("#chamfer-distance").tap();
      await page.locator("#chamfer-distance").fill("4");
      // 24,000 − 40 · 4 · 4 / 2 = 23,680.
      await previewSays(page, chamfered(4));
      if (shots) await page.screenshot({ path: `${shots}/chamfer-375-edit.png` });
      await page.tap("#float-finish");
      await closed(page);
      await rebuilt(page);
      near(await stl(page, true), chamfered(4), BOUNDS, "edited to 4 mm");
      if (shots) await page.screenshot({ path: `${shots}/chamfer-375-edited.png` });
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
