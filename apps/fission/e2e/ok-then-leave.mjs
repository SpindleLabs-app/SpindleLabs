// Browser check that a step whose OK is still with the kernel is not lost when the page goes (flat stress hunt
// 2026-11-13, SL #708 item 1; the lost-work family of #627). OK pressed, then the page reloaded or closed before the
// kernel answered: the page went without a word, said "Saved" again, and opened without the Combine. The journal
// (unsaved.ts) can't keep a step that isn't recorded yet, so the page asks before going while an OK is held.
// The design is combine.mjs's: Box 1 40 × 30 × 20, Box 2 the same moved (20, 15, 10), Box 3 10 × 10 × 10 moved 100
// along x. Every kernel request is held back `window.kernelDelay` ms once set (as undo-settle-order.mjs), so the OK
// is surely still being checked when the page is left.
//   - Cut Box 2 from Box 1, OK, then the tab closed at once: the browser asks; staying keeps the page, the Combine
//     lands, and a reload brings it back (six items) without asking, as the page says Saved.
//   - The same with no OK held (the Combine landed and Saved): closing asks nothing (control: only a held OK asks).
// Run with `npm run e2e` (after `npm run build`); `E2E_BROWSER` picks the engine.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const PORT = 4708;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}
const until = (page, fn, arg, what, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));

const box = (n, label, [w, d, h]) => ({
  dependsOn: [],
  id: `feature-${n}`,
  intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" },
  provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } },
  suppressed: false,
});
const move = (n, of, label, moveLabel, [x, y, z]) => ({
  dependsOn: [of],
  id: `feature-${n}`,
  intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move ${label} by (${x}, ${y}, ${z}) mm`, type: "move" },
  provenance: { from: [{ id: of, label, workspace: "design" }], self: { id: `feature-${n}`, label: moveLabel, workspace: "design" } },
  suppressed: false,
});
const features = [box(1, "Box 1", [40, 30, 20]), box(2, "Box 2", [40, 30, 20]), move(3, "feature-2", "Box 2", "Move 1", [20, 15, 10]), box(4, "Box 3", [10, 10, 10]), move(5, "feature-4", "Box 3", "Move 2", [100, 0, 0])];
const PROJECT = { formatVersion: 2, links: [], materials: [], name: "OK then leave", units: { length: "mm" }, workspaces: { design: { nextId: 6, profiles: [], sketches: [], version: 4, timeline: { features } } } };
const ITEMS = features.map((f) => f.id);

const items = (page) => page.$$eval("#timeline li[data-item]", (l) => l.map((li) => li.dataset.item));
const saved = (page) => until(page, () => document.querySelector("#save-status")?.dataset.state === "saved", null, "Saved");
const rebuilt = (page) => until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false" && !window.fissionTest.historyBusy(), null, "the rebuild landed");

/** A page with the design opened and kept, every kernel request held back `window.kernelDelay` ms once set; the dialogs it asks. */
async function opened() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("ok-leave-kept")) {
      indexedDB.deleteDatabase("fission");
      sessionStorage.setItem("ok-leave-kept", "1");
    }
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      const wait = window.kernelDelay ?? 0;
      if (wait > 0 && message?.op !== undefined) return void setTimeout(() => send.call(this, message, ...rest), wait);
      return send.call(this, message, ...rest);
    };
  });
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => (asked.push(d.type()), d.dismiss()));
  await page.goto(`http://localhost:${PORT}/?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "ok-leave.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(PROJECT)) });
  await until(page, (all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ITEMS, "the file open");
  await rebuilt(page);
  await saved(page);
  return { context, page, errors, asked };
}
/** Combine from Modify ▾: Body 1 the target, Body 2 the tool, Cut. */
async function cutReady(page) {
  await page.click("#modify-menu");
  await page.click("#modify-menu-combine");
  await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel open");
  await page.evaluate(() => document.querySelector('#browser details[data-node="bodies"]')?.setAttribute("open", ""));
  const row = (name) => page.locator('#browser [data-node="bodies"] .tree-row', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
  if ((await page.textContent("#combine-target-names")) !== "Body 1") await row("Body 1").click();
  await row("Body 2").click();
  await until(page, () => document.getElementById("combine-tools-names")?.textContent === "Body 2", null, "Body 2 the tool");
  await page.selectOption("#combine-operation", "cut");
}

try {
  await check("Cut, OK, then the tab closed while the kernel checks: the browser asks; staying, the Combine lands and a reload keeps it", async () => {
    const { context, page, errors, asked } = await opened();
    await cutReady(page);
    await page.evaluate(() => (window.kernelDelay = 1500));
    await page.click("#combine-ok");
    await until(page, () => document.getElementById("combine-ok")?.dataset.busy === "1", null, "OK busy while the kernel checks", 5000);
    await page.close({ runBeforeUnload: true });
    for (let i = 0; i < 50 && asked.length === 0 && !page.isClosed(); i++) await page.waitForTimeout(100).catch(() => {});
    assert.equal(page.isClosed(), false, "the page went without asking, the Combine still with the kernel");
    assert.deepEqual(asked, ["beforeunload"], "the browser asks before the held OK is lost");
    // Staying: the OK goes on and records.
    await page.evaluate(() => (window.kernelDelay = 0));
    await until(page, () => document.getElementById("combine-panel")?.hidden === true, null, "the Combine recorded", 30000);
    await rebuilt(page);
    await saved(page);
    assert.deepEqual(await items(page), [...ITEMS, "feature-6"]);
    // Nothing held now and Saved: a reload asks nothing and brings the Combine back.
    await page.reload();
    await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, ITEMS.length + 1, "the Combine back after the reload");
    await rebuilt(page);
    assert.deepEqual(asked, ["beforeunload"], "the saved page asked nothing more");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check("control: the Combine landed and Saved, then the tab closed: nothing asked", async () => {
    const { context, page, errors, asked } = await opened();
    await cutReady(page);
    await page.click("#combine-ok");
    await until(page, () => document.getElementById("combine-panel")?.hidden === true, null, "the Combine recorded", 30000);
    await rebuilt(page);
    await saved(page);
    assert.deepEqual(errors, []);
    await Promise.all([page.waitForEvent("close", { timeout: 15000 }), page.close({ runBeforeUnload: true })]);
    assert.deepEqual(asked, [], "a saved page with nothing held asks nothing");
    await context.close();
  });
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
