// Browser check of the narrowest phones (app-wide hunt 2026-11-14, issue #764, phone lows), on a file with Box 1
// (40 × 30 × 20) and Box 2 the same moved 50 along x, seen from the top, with `?combine`, by taps:
// 1. 320 × 568: the bar over the view (phone-float.ts) is one row for Combine and for every tool's Finish words, and the
//    tool's hint pill (122 px down the view) lies below it. It was two rows (Finish Combine 149 px + Cancel 64 in a bar
//    of at most 208) and the hint lay over Cancel. 375 px keeps the whole words "Finish Combine".
// 2. 320 × 568: the tap that picks the second body, where Undo lands as the sheet opens by itself (undo-lift.ts), keeps
//    Combine open: the browser's click for that tap used to press Undo, which cancelled the Combine (main.ts drops a
//    press's click that lands on something else than it began on, just after the sheet opened by itself).
// 3. 320 × 568: that sheet covers at most 40% of the view (it was 46 to 51%), with the operation, Keep tools, OK and both
//    fields on screen and on top, and OK records the Combine (one item more in the timeline).
// Deliberate breaks: the narrow rules taken out (the verb shown again, the Combine panel's class removed) must fail
// checks 1 and 3; check 2 was red on the build before. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { assertNoErrors, launch, watchErrors } from "./browser.mjs";
import { preview } from "vite";
import { closePanels } from "./start.mjs";

const PORT = 4992;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
const shots = process.env.E2E_SHOTS;

const box = (n, [w, d, h]) => ({ dependsOn: [], id: `feature-${n}`, intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" }, provenance: { from: [], self: { id: `feature-${n}`, label: `Box ${n}`, workspace: "design" } }, suppressed: false });
const move = { dependsOn: ["feature-2"], id: "feature-3", intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x: 50, y: 0, z: 0 }, summary: "Move Box 2 by (50, 0, 0) mm", type: "move" }, provenance: { from: [{ id: "feature-2", label: "Box 2", workspace: "design" }], self: { id: "feature-3", label: "Move 1", workspace: "design" } }, suppressed: false };
const project = { formatVersion: 2, links: [], materials: [], name: "Two boxes", units: { length: "mm" }, workspaces: { design: { nextId: 4, profiles: [], sketches: [], version: 4, timeline: { features: [box(1, [40, 30, 20]), box(2, [40, 30, 20]), move] } } } };
// Middles of the tops, worked by hand: Box 1 x 0..40, y 0..30, z 20; Box 2 x 50..90.
const TOP1 = [20, 15, 20];
const TOP2 = [70, 15, 20];
const ENDS = ["Finish Sketch", "Finish Extrude", "Finish Rotate", "Finish Scale", "Finish Move", "Finish Combine", "Finish Chamfer", "Finish Shell", "Finish Pattern", "Finish Construct", "Finish Edit"];

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8); // the viewport's 45° vertical field of view
/** The pinhole camera's screen point of world point `p`. */
async function screen(page, p) {
  const [cam, c] = await Promise.all([page.evaluate(() => window.fissionTest.camera()), page.locator("#viewport canvas").boundingBox()]);
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  return { x: c.x + ((dot(v, right) / (dot(v, forward) * T * (c.width / c.height)) + 1) / 2) * c.width, y: c.y + ((1 - dot(v, up) / (dot(v, forward) * T)) / 2) * c.height };
}
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null; }, sel);
const combineOpen = (page) => page.evaluate(() => document.getElementById("combine-panel")?.hidden === false);
const items = (page) => page.evaluate(() => document.querySelectorAll("#timeline li[data-item]").length);
const covered = async (page) => {
  const [sheet, view] = await Promise.all([rect(page, "#properties"), rect(page, "#viewport")]);
  return sheet ? Math.max(0, Math.min(sheet.bottom, view.bottom) - Math.max(sheet.top, view.top)) / view.height : 0;
};

async function fresh(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  watchErrors(page);
  await page.goto(`http://localhost:${PORT}/?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "two-boxes.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 3, null, "the file open", 15000);
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "built", 15000);
  await page.tap('[data-view="top"]');
  await page.waitForTimeout(1200); // the camera's half-second glide
  await page.tap("#modify-menu");
  await page.tap("#modify-menu-combine");
  await until(page, () => document.getElementById("combine-panel")?.hidden === false && !document.getElementById("phone-float")?.hidden, null, "Combine open with its bar");
  return page;
}
/** Taps world point `p`, failing when anything but the canvas is there now. */
async function tapAt(page, p) {
  const s = await screen(page, p);
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport canvas") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  assert.equal(on, "canvas", `[${p}] is under ${on}, not the canvas`);
  await page.touchscreen.tap(s.x, s.y);
  return s;
}
/** The bar's height and the hint's place with each tool's Finish words put on the green button in turn. */
const eachEnd = (page) =>
  page.evaluate((ends) => {
    const word = document.querySelector("#float-finish .tool-word");
    const before = [...word.childNodes].map((n) => n.cloneNode(true));
    const out = {};
    for (const label of ends) {
      const verb = word.querySelector(".phone-float-verb");
      if (verb) word.lastChild.textContent = label.slice("Finish ".length);
      else word.textContent = label;
      out[label] = Math.round(document.getElementById("phone-float").getBoundingClientRect().height);
    }
    word.replaceChildren(...before);
    return out;
  }, ENDS);

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
  await check("320 × 568: the bar over the view is one row for every tool, below it the hint, and the check fails with the whole words", async () => {
    const page = await fresh(320, 568);
    try {
      const bar = await rect(page, "#phone-float");
      const hint = await rect(page, "#combine-hint");
      const cancel = await rect(page, "#float-cancel");
      const finish = await rect(page, "#float-finish");
      if (shots) await page.screenshot({ path: `${shots}/narrow-320-bar.png` });
      const all = JSON.stringify({ bar, hint, cancel, finish });
      assert.ok(bar.height <= 60, `one row (a 44 px button, 6 px padding and the edges): ${all}`);
      assert.equal(Math.round(cancel.top), Math.round(finish.top), `Cancel beside the green button: ${all}`);
      assert.ok(hint.top >= bar.bottom, `the hint below the bar, not over Cancel: ${all}`);
      assert.equal(await page.textContent("#float-finish"), "Finish Combine", "its words are still the whole label");
      assert.equal(await page.getAttribute("#float-finish", "aria-label"), "Finish Combine", "and so is its name");
      for (const [label, h] of Object.entries(await eachEnd(page))) assert.ok(h <= 60, `${label} and Cancel in one row: ${h} px`);
      // Break: "Finish" shown again at 320 px, the bar wraps.
      await page.addStyleTag({ content: ".phone-float .phone-float-verb { display: inline !important; } .phone-float button { padding: 0 12px !important; }" });
      const broken = await rect(page, "#phone-float");
      assert.ok(broken.height > 60, `with the whole words the bar wraps (${broken.height} px): the check can fail`);
    } finally {
      await page.context().close();
    }
  });

  await check("375 × 667: the bar keeps the whole words Finish Combine in one row", async () => {
    const page = await fresh(375, 667);
    try {
      const bar = await rect(page, "#phone-float");
      assert.ok(bar.height <= 60, `one row: ${JSON.stringify(bar)}`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#float-finish .phone-float-verb")).display), "inline", "Finish shown");
    } finally {
      await page.context().close();
    }
  });

  await check("320 × 568: picking the tool body keeps Combine open, its sheet covers at most 40% of the view, and OK records it", async () => {
    let page = await fresh(320, 568);
    try {
      const pickTarget = async () => {
        await tapAt(page, TOP1);
        await until(page, () => document.getElementById("combine-target-names")?.textContent === "Body 1", null, "Box 1 the target");
        await closePanels(page, true);
      };
      const opened = () => until(page, () => document.getElementById("properties-toggle")?.getAttribute("aria-expanded") === "true", null, "the sheet opens by itself");
      // A first page, to see where Undo stands once the sheet is open (lifted over it, undo-lift.ts); then the same afresh.
      await pickTarget();
      await tapAt(page, TOP2);
      await opened();
      await page.waitForTimeout(600);
      const undo = await rect(page, "#undo");
      await page.context().close();
      page = await fresh(320, 568);
      await pickTarget();
      // Then Box 2 tapped where Undo will stand: the middle of where Box 2's top (x 50..90, y 0..30 by hand) and Undo overlap.
      const [a, b] = await Promise.all([screen(page, [50, 0, 20]), screen(page, [90, 30, 20])]);
      const left = Math.max(Math.min(a.x, b.x), undo.left + 4), right = Math.min(Math.max(a.x, b.x), undo.right - 4);
      const top = Math.max(Math.min(a.y, b.y), undo.top + 4), bottom = Math.min(Math.max(a.y, b.y), undo.bottom - 4);
      assert.ok(left < right && top < bottom, `Box 2 reaches where Undo will stand: box ${JSON.stringify([a, b])}, Undo ${JSON.stringify(undo)}`);
      const tapped = { x: (left + right) / 2, y: (top + bottom) / 2 };
      assert.equal(await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport canvas") ? "canvas" : document.elementFromPoint(x, y)?.id), [tapped.x, tapped.y]), "canvas", "the view under the finger as it taps");
      await page.touchscreen.tap(tapped.x, tapped.y);
      await opened();
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.id ?? "", [tapped.x, tapped.y]), "undo", "Undo now stands where the finger tapped");
      assert.equal(await combineOpen(page), true, "Combine still open after the tap that picked its tool");
      assert.equal(await page.textContent("#combine-tools-names"), "Body 2", "Box 2 the tool");
      assert.equal(await items(page), 3, "nothing undone or recorded");
      const c = await covered(page);
      if (shots) await page.screenshot({ path: `${shots}/narrow-320-sheet.png` });
      assert.ok(c <= 0.4, `the sheet covers ${(c * 100).toFixed(0)}% of the view`);
      for (const id of ["combine-operation", "combine-target", "combine-tools", "combine-ok", "combine-keep"]) {
        const r = await rect(page, `#${id}`);
        assert.ok(r && r.right <= 320 && r.bottom <= 568, `${id} on screen: ${JSON.stringify(r)}`);
        const top = await page.evaluate(([s, x, y]) => document.elementFromPoint(x, y)?.closest(s) !== null, [`#${id}, label:has(#${id})`, r.left + r.width / 2, r.top + r.height / 2]);
        assert.ok(top, `${id} on top`);
      }
      const ok = await rect(page, "#combine-ok");
      assert.ok(ok.width >= 44 && ok.height >= 44, `OK is a 44 px target: ${JSON.stringify(ok)}`);
      // Break: the panel's phone rules off, the sheet grows past 40%.
      await page.evaluate(() => document.getElementById("combine-panel").classList.remove("combine-panel"));
      await page.waitForTimeout(300);
      const grown = await covered(page);
      assert.ok(grown > 0.4, `without the rules the sheet covers ${(grown * 100).toFixed(0)}%: the check can fail`);
      await page.evaluate(() => document.getElementById("combine-panel").classList.add("combine-panel"));
      await page.waitForTimeout(300);
      await page.tap("#combine-ok");
      await until(page, () => document.getElementById("combine-panel")?.hidden === true, null, "the Combine panel closed");
      await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 4, null, "Combine 1 in the timeline");
    } finally {
      await page.context().close();
    }
  });
  try {
    assertNoErrors();
  } catch (e) {
    failed++;
    console.log(`not ok - no page errors\n  ${e.message}`);
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.log(`phone-narrow: ${failed} failed`);
  process.exit(1);
}
console.log("phone-narrow ok");
