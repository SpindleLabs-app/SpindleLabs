// Browser check of the hidden Combine tool (step 35f1c, combine-panel.ts,
// combine-flag.ts): without `?combine` Modify ▾ has no Combine, only the
// greyed coming-soon line; with it, Combine opens its panel, a click (or
// tap) on a body fills the target, then the tools, OK records one undo step
// "Combine bodies", and the STL is what the kernel made, worked by hand.
// The design (opened from a file): Box 1 40 × 30 × 20 at the origin, Box 2
// the same moved (20, 15, 10), so they share x 20..40, y 15..30, z 10..20
// = 20 · 15 · 10 = 3,000 mm³, and Box 3 10 × 10 × 10 moved 100 along x,
// touching nothing. Cut Box 2 from Box 1: Box 1 keeps 24,000 − 3,000 =
// 21,000 mm³, Box 2 is used up, Box 3's 1,000 stays, so the STL holds
// 22,000 mm³. Combine 1 edited to Intersect: 3,000 + 1,000 = 4,000 mm³. An
// Intersect of Box 1 with Box 3 is refused with the kernel's words and
// records nothing. The flag stays on for the tab across a reload and goes
// with `?combine=off`. 1280 px with a mouse and 375 px with taps.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4271, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4271/";
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

const box = (n, [w, d, h]) => ({
  dependsOn: [],
  id: `feature-${n}`,
  intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" },
  provenance: { from: [], self: { id: `feature-${n}`, label: `Box ${n === 1 ? 1 : n === 2 ? 2 : 3}`, workspace: "design" } },
  suppressed: false,
});
const move = (n, of, label, [x, y, z]) => ({
  dependsOn: [of],
  id: `feature-${n}`,
  intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move ${label} by (${x}, ${y}, ${z}) mm`, type: "move" },
  provenance: { from: [{ id: of, label, workspace: "design" }], self: { id: `feature-${n}`, label: `Move ${n === 3 ? 1 : 2}`, workspace: "design" } },
  suppressed: false,
});
// Box 1 (feature-1), Box 2 (feature-2), Move 1 (feature-3: Box 2 by (20, 15, 10)), Box 3 (feature-4), Move 2 (feature-5: Box 3 by (100, 0, 0)).
const features = [box(1, [40, 30, 20]), box(2, [40, 30, 20]), move(3, "feature-2", "Box 2", [20, 15, 10]), box(4, [10, 10, 10]), move(5, "feature-4", "Box 3", [100, 0, 0])];
features[3].provenance.self.label = "Box 3";
const project = { formatVersion: 2, links: [], materials: [], name: "Combine check", units: { length: "mm" }, workspaces: { design: { nextId: 6, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const ITEMS = features.map((f) => f.id);
// Worked by hand: Box 1 x 0..40, y 0..30, z 0..20; Box 2 x 20..60, y 15..45, z 10..30; Box 3 x 100..110, y 0..10, z 0..10.
const AS_MADE = { volume: 24000 + 24000 + 1000, bounds: [[0, 110], [0, 45], [0, 30]] };
const CUT = { volume: 21000 + 1000, bounds: [[0, 110], [0, 30], [0, 20]] }; // Box 2 used up
const INTERSECTED = { volume: 3000 + 1000, bounds: [[20, 110], [0, 30], [0, 20]] }; // Box 1 now x 20..40, y 15..30, z 10..20
// Where each box's top shows in the top view, clear of the others.
const TOP1 = [5, 5, 20];
const TOP2 = [50, 40, 30];
const TOP3 = [105, 5, 10];

async function fresh(width, height, tap, query) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "combine.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open", 15000);
  await rebuilt(page);
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

const opened = (page) => until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel open");
const closed = (page) => until(page, () => document.getElementById("combine-panel")?.hidden === true, null, "the Combine panel closed");
const fields = (page, want, what) =>
  until(page, (w) => [document.getElementById("combine-target-names")?.textContent, document.getElementById("combine-tools-names")?.textContent].join(" | ") === w, want, what);

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
  await check("without ?combine there is no Combine: Modify ▾ shows it greyed as coming soon, and the panel never opens", async () => {
    const page = await fresh(1280, 800, false, "");
    try {
      const ids = await modifyItems(page, false);
      assert.ok(!ids.includes("modify-menu-combine"), JSON.stringify(ids));
      assert.ok(ids.includes("coming-combine"), JSON.stringify(ids));
      assert.equal(await page.$eval("#coming-combine", (b) => b.disabled || b.getAttribute("aria-disabled") === "true"), true, "greyed");
      assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), true);
    } finally {
      await page.context().close();
    }
  });

  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: Combine cuts Box 2 from Box 1, picked target then tool, as one undo step`, async () => {
      const page = await fresh(width, height, tap, "&combine");
      try {
        near(await stl(page, tap), AS_MADE.volume, AS_MADE.bounds, "as made");
        const ids = await modifyItems(page, tap);
        assert.ok(ids.includes("modify-menu-combine") && !ids.includes("coming-combine"), JSON.stringify(ids));
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await page.evaluate(() => document.activeElement?.blur());
        await press(page, "#modify-menu", tap);
        await press(page, "#modify-menu-combine", tap);
        await opened(page);
        // Nothing picked: the target field picks, the hint over the view says what to do, OK is off.
        await fields(page, "Click the body to change | Click the bodies to use as tools", "both fields empty");
        assert.equal(await page.$eval("#combine-target", (b) => b.getAttribute("aria-pressed")), "true");
        assert.equal(await page.$eval("#combine-ok", (b) => b.disabled), true);
        assert.equal(await page.$eval("#combine-hint", (h) => [h.hidden, h.textContent].join()), "false,Combine: click or tap the body to change");
        if (shots) await page.screenshot({ path: `${shots}/combine-${width}-empty.png` });
        await at(page, TOP1, tap);
        await fields(page, "Body 1 | Click the bodies to use as tools", "Box 1 the target");
        const sheetOpen = () => page.evaluate(() => [document.getElementById("properties-toggle")?.getAttribute("aria-expanded") === "true", (document.getElementById("combine-operation")?.getBoundingClientRect().height ?? 0) > 0]);
        // At phone width the view stays clear while the bodies are picked: the sheet is still shut with only the target.
        if (tap) assert.deepEqual(await sheetOpen(), [false, false], "the sheet waits for a tool");
        assert.equal(await page.$eval("#combine-tools", (b) => b.getAttribute("aria-pressed")), "true", "the tools field picks next");
        await at(page, TOP2, tap);
        await fields(page, "Body 1 | Body 2", "Box 2 a tool");
        // Then it opens by itself on the operation and OK (35f1d: the monkey found them out of reach in the shut sheet).
        if (tap) {
          await page.waitForTimeout(300);
          assert.deepEqual(await sheetOpen(), [true, true], "the sheet opens once a tool is picked");
        }
        assert.equal(await page.$eval("#combine-hint", (h) => h.hidden), true, "the hint goes once both are picked");
        // A third body clicked in and out again: in the tools, then gone.
        await at(page, TOP3, tap);
        await fields(page, "Body 1 | Body 2, Body 3", "Box 3 a second tool");
        await at(page, TOP3, tap);
        await fields(page, "Body 1 | Body 2", "Box 3 taken out");
        await openPanel(page, "properties", tap);
        await page.selectOption("#combine-operation", "cut");
        if (shots) await page.screenshot({ path: `${shots}/combine-${width}-picked.png` });
        if (tap) {
          // One tap never covers most of the view (Ben's phone rule): the open sheet with the panel at most 40% of it.
          const covered = () =>
            Promise.all([page.locator("#properties").boundingBox(), page.locator("#viewport").boundingBox()]).then(([sheet, view]) => Math.max(0, Math.min(sheet.y + sheet.height, view.y + view.height) - Math.max(sheet.y, view.y)) / view.height);
          await page.waitForTimeout(300);
          const c = await covered();
          assert.ok(c <= 0.4, `the sheet covers ${(c * 100).toFixed(0)}% of the view`);
          for (const id of ["combine-target", "combine-tools", "combine-operation", "combine-ok", "combine-cancel"]) assert.ok(await page.isVisible(`#${id}`), `${id} in the sheet`);
          // The check can fail: with the panel's phone rule off (the rest of the properties under it), the sheet grows past 40%.
          await page.evaluate(() => document.getElementById("combine-panel").classList.remove("combine-panel"));
          await page.waitForTimeout(300);
          const grown = await covered();
          assert.ok(grown > 0.4, `without the rule the sheet covers ${(grown * 100).toFixed(0)}%: the check can fail`);
          await page.evaluate(() => document.getElementById("combine-panel").classList.add("combine-panel"));
        }
        await press(page, "#combine-ok", tap);
        await closed(page);
        await rebuilt(page);
        await until(page, () => [...document.querySelectorAll("#timeline li[data-item]")].length === 6, null, "Combine 1 in the timeline");
        near(await stl(page, tap), CUT.volume, CUT.bounds, "Box 2 cut from Box 1");
        // Undo takes the whole Combine back in one step; Redo puts it back.
        await closePanels(page, tap);
        await press(page, "#undo", tap);
        await rebuilt(page);
        near(await stl(page, tap), AS_MADE.volume, AS_MADE.bounds, "undone");
        await press(page, "#redo", tap);
        await rebuilt(page);
        near(await stl(page, tap), CUT.volume, CUT.bounds, "redone");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("1280 px: Combine 1 edited to Intersect, Escape leaves without a change, an Intersect of bodies apart is refused, and the flag stays for the tab", async () => {
    const page = await fresh(1280, 800, false, "&combine");
    try {
      await page.click('[data-view="top"]');
      await settle(page);
      await page.evaluate(() => document.activeElement?.blur());
      // Box 1 selected first: Combine opens with it as the target.
      await at(page, TOP1);
      await page.click("#modify-menu");
      await page.click("#modify-menu-combine");
      await opened(page);
      await fields(page, "Body 1 | Click the bodies to use as tools", "the selection the target");
      await at(page, TOP2);
      await page.selectOption("#combine-operation", "cut");
      await page.click("#combine-ok");
      await closed(page);
      await rebuilt(page);
      // Edited from its timeline item: its bodies shown and off, Intersect chosen, OK.
      await page.click('#timeline [data-item="feature-6"]', { button: "right" });
      await until(page, () => document.getElementById("row-menu").open, null, "Combine 1's menu");
      await page.click("#row-menu-edit");
      await opened(page);
      assert.equal(await page.textContent("#combine-title"), "Edit Combine 1");
      await fields(page, "Body 1 | Body 2", "the edit shows its bodies");
      assert.equal(await page.$eval("#combine-tools", (b) => b.disabled), true);
      assert.equal(await page.$eval("#combine-operation", (s) => s.value), "cut");
      // Escape: nothing changes.
      await page.keyboard.press("Escape");
      await closed(page);
      near(await stl(page, false), CUT.volume, CUT.bounds, "Escape changed nothing");
      await page.click('#timeline [data-item="feature-6"]', { button: "right" });
      await until(page, () => document.getElementById("row-menu").open, null, "Combine 1's menu again");
      await page.click("#row-menu-edit");
      await opened(page);
      await page.selectOption("#combine-operation", "intersect");
      if (shots) await page.screenshot({ path: `${shots}/combine-1280-edit.png` });
      await page.click("#combine-ok");
      await closed(page);
      await rebuilt(page);
      near(await stl(page, false), INTERSECTED.volume, INTERSECTED.bounds, "edited to Intersect");
      // Undo the edit and the Combine: back as made. Then Box 1 intersected with Box 3, 60 mm away: refused, nothing recorded.
      await page.click("#undo");
      await rebuilt(page);
      await page.click("#undo");
      await rebuilt(page);
      near(await stl(page, false), AS_MADE.volume, AS_MADE.bounds, "both undone");
      await page.click('[data-view="top"]');
      await settle(page);
      await page.evaluate(() => document.activeElement?.blur());
      await page.click("#modify-menu");
      await page.click("#modify-menu-combine");
      await opened(page);
      await at(page, TOP1);
      await at(page, TOP3);
      await fields(page, "Body 1 | Body 3", "Box 1 and Box 3");
      await page.selectOption("#combine-operation", "intersect");
      await page.click("#combine-ok");
      await until(page, () => !document.getElementById("combine-error").hidden, null, "the refusal");
      const said = await page.textContent("#combine-error");
      assert.match(said, /^Combine 1 can't be made: /, said);
      assert.equal(await page.$eval("#combine-panel", (p) => p.hidden), false, "the panel stays open");
      assert.equal(await page.$$eval("#timeline li[data-item]", (l) => l.length), 5, "nothing recorded");
      if (shots) await page.screenshot({ path: `${shots}/combine-1280-refused.png` });
      await page.click("#combine-cancel");
      await closed(page);
      // Reloaded without ?combine: still on in this tab. With ?combine=off: gone, and still gone on the next load.
      await page.goto(`${url}?test-hooks#design`);
      await page.locator("#start-hint").waitFor();
      assert.ok((await modifyItems(page, false)).includes("modify-menu-combine"), "kept for the tab");
      await page.goto(`${url}?test-hooks&combine=off#design`);
      await page.locator("#start-hint").waitFor();
      assert.ok(!(await modifyItems(page, false)).includes("modify-menu-combine"), "off");
      await page.goto(`${url}?test-hooks#design`);
      await page.locator("#start-hint").waitFor();
      assert.ok(!(await modifyItems(page, false)).includes("modify-menu-combine"), "still off");
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
