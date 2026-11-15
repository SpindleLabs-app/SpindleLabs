// Browser check of Undo while something is open (app bug hunt 2026-11-11, issue #520), as Fusion behaves:
// 1. Inside a sketch opened again with Edit Sketch, Undo covers only that sketch's own edits: with none, Ctrl+Z and the
//    button do nothing (the button is off) and the extrude made before stays; a line drawn in it is undone, and then
//    nothing more.
// 2. Undo while a tool's panel is open (Edit feature, Move, the Extrude panel opened from a sketch) cancels just that
//    tool, taking back no older step; the button says so. Redo is off meanwhile, and a History jump is refused in
//    words, the panel kept as typed.
// 3. File > New, then Undo, brings back the file too: Save offers plate.spindle again, and Redo lets it go again.
// Volumes by hand: a 20 × 10 rectangle extruded 5 mm is 20 · 10 · 5 = 1,000 mm³; the 40 × 30 × 20 box typed 60 wide is
// 60 · 30 · 20 = 36,000 mm³; typed 10 deep, 40 · 10 · 20 = 8,000 mm³.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseFile, closePanels, insertPreset, openPanel, pickPlane, startWithBox } from "./start.mjs";
import { EMPTY_TOP, screenPoint } from "./sketch-screen.mjs";

const server = await preview({ preview: { port: 4361, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4361/?test-hooks#design";
const browser = await launch();
const errors = [];
/** UNDO_OPEN_ONLY=2b runs only that part (to see one go red). */
const only = process.env.UNDO_OPEN_ONLY;

async function fresh({ box = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  if (box) await startWithBox(page);
  await pinProperties(page);
  return page;
}
const until = (page, fn, arg, what, timeout = 15000) =>
  page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`timed out waiting for ${what}`));
/** Waits for no rebuild running, then a moment more for anything it starts. */
const settle = async (page, ms = 600) => {
  await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, { timeout: 20000 });
  await page.waitForTimeout(ms);
};
const volume = (page, text) => until(page, (t) => document.querySelector("#volume")?.textContent === t, text, `volume ${text}`);
const items = (page) => page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.dataset.item));
const undoButton = (page) => page.evaluate(() => ({ off: document.getElementById("undo").disabled, title: document.getElementById("undo").title }));
const redoButton = (page) => page.evaluate(() => ({ off: document.getElementById("redo").disabled, title: document.getElementById("redo").title }));
const ctrlZ = async (page) => {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press("Control+z");
  await settle(page, 800);
};
const sketching = (page) => page.evaluate(() => document.querySelector("#viewport").dataset.sketching === "true");

/** An empty design: a 20 × 10 rectangle on XY from (0, 0), closed, the sketch still open. */
async function rectangle(page) {
  await page.click("#create-sketch");
  await openPanel(page, "properties", false);
  await pickPlane(page, "XY", false);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "the sketch");
  await closePanels(page, false);
  await page.click("#sketch-tool-rectangle");
  const box = await page.locator("#viewport canvas").boundingBox();
  for (const xy of [[0, 0], [20, 10]]) {
    const p = screenPoint(box, [...xy, 0], EMPTY_TOP);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
  }
  await until(page, () => /closed/.test(document.querySelector("#sketch-status")?.textContent ?? ""), null, "a closed rectangle");
  return box;
}

// 1. Edit Sketch, then Ctrl+Z with nothing drawn: the extrude stays.
if (!only || only === "1") {
  const page = await fresh({ box: false });
  const box = await rectangle(page);
  await page.click("#sketch-extrude");
  await page.fill("#extrude-distance", "5");
  await until(page, () => document.querySelector("#extrude-ok")?.disabled === false && (document.getElementById("extrude-panel")?.dataset.previewVolume ?? "") !== "", null, "the extrude preview");
  await page.click("#extrude-ok");
  await volume(page, "1,000 mm³");
  await settle(page, 1200);
  const made = await items(page);
  assert.equal(made.length, 2, `a sketch and its extrude: ${made}`);
  await page.locator(`#timeline [data-item="${made[0]}"]`).click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "the item menu");
  await page.click("#row-menu-edit-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "Edit Sketch");
  await settle(page, 800);
  const inSketch = await undoButton(page);
  assert.ok(inSketch.off, `Undo is off in a sketch opened with nothing drawn: ${JSON.stringify(inSketch)}`);
  await ctrlZ(page);
  assert.ok(await sketching(page), "still in the sketch after Ctrl+Z");
  assert.deepEqual(await items(page), made, "Ctrl+Z in the sketch took back nothing from outside it");
  // The button pressed does nothing too (it is off).
  await page.locator("#undo").click({ force: true });
  await settle(page, 800);
  assert.deepEqual(await items(page), made, "the Undo button in the sketch took back nothing from outside it");
  // A line drawn in it is the sketch's own: undone, and then nothing more.
  await page.click("#sketch-tool-line");
  for (const xy of [[30, 0], [40, 0]]) {
    const p = screenPoint(box, [...xy, 0], EMPTY_TOP);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  await until(page, () => /^Undo Draw line/.test(document.getElementById("undo").title), null, "Undo Draw line");
  await ctrlZ(page);
  assert.ok(await sketching(page), "still in the sketch after undoing its line");
  assert.ok((await undoButton(page)).off, "nothing left to undo in the sketch once its line is undone");
  await ctrlZ(page);
  assert.deepEqual(await items(page), made, "a second Ctrl+Z took back nothing from outside the sketch");
  await page.click("#finish-sketch");
  await settle(page, 1200);
  await volume(page, "1,000 mm³");
  const after = await undoButton(page);
  assert.ok(!after.off && /Extrude Sketch 1/.test(after.title), `out of the sketch, Undo reaches the extrude again: ${JSON.stringify(after)}`);
  await page.context().close();
}

// 2a. Edit feature open with a height typed: Ctrl+Z cancels it and takes back no step.
if (!only || only === "2a") {
  const page = await fresh();
  await page.fill("#width", "60");
  await volume(page, "36,000 mm³");
  await settle(page, 1200);
  await insertPreset(page, "cylinder");
  await settle(page, 800);
  const before = await items(page);
  const label = (await undoButton(page)).title;
  await page.locator(`#timeline [data-item="${before[0]}"]`).click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "the item menu");
  await page.click("#row-menu-edit");
  await until(page, () => document.getElementById("feature-edit")?.hidden === false, null, "Edit feature");
  await page.fill("#edit-height", "35");
  await page.waitForTimeout(600);
  const open = await undoButton(page);
  assert.ok(!open.off && /cancel/i.test(open.title) && /Edit feature/.test(open.title), `Undo says it cancels Edit feature: ${JSON.stringify(open)}`);
  assert.ok((await redoButton(page)).off, "Redo is off while a tool is open");
  await ctrlZ(page);
  assert.ok(await page.evaluate(() => document.getElementById("feature-edit")?.hidden === true), "Ctrl+Z closed Edit feature");
  assert.deepEqual(await items(page), before, "Ctrl+Z with Edit feature open took back no step (the cylinder stays)");
  assert.equal((await undoButton(page)).title, label, "Undo reads as before the tool opened");
  await page.context().close();
}

// 2b. Move open with X typed: a History jump is refused in words, the Undo button cancels just the Move.
if (!only || only === "2b") {
  const page = await fresh();
  await page.fill("#width", "60");
  await volume(page, "36,000 mm³");
  await settle(page, 1200);
  const before = await items(page);
  const label = (await undoButton(page)).title;
  await page.click("#move");
  await page.click('#browser .tree-row[data-node="body-1"]');
  await until(page, () => !!document.getElementById("viewport").dataset.moveHandles, null, "Move's handles");
  await page.fill("#move-x", "10");
  await page.waitForTimeout(600);
  await page.click("#history");
  await page.locator("#history-panel:not([hidden])").waitFor();
  await page.click('#history-panel button[data-step="1"]');
  await settle(page, 1000);
  assert.ok(await page.evaluate(() => document.getElementById("move-panel")?.hidden === false), "the jump left Move open");
  assert.equal(await page.inputValue("#move-x"), "10", "the jump kept what was typed");
  await volume(page, "36,000 mm³");
  assert.match(await page.textContent("#file-status"), /Move/, "the jump says why it waits");
  if (await page.isVisible("#history-panel")) await page.click("#history"); // put away (Escape would cancel the Move too)
  assert.ok(await page.evaluate(() => document.getElementById("move-panel")?.hidden === false), "Move still open");
  const open = await undoButton(page);
  assert.ok(/cancel Move/i.test(open.title), `Undo says it cancels Move: ${JSON.stringify(open)}`);
  await page.click("#undo");
  await settle(page, 1000);
  assert.ok(await page.evaluate(() => document.getElementById("move-panel")?.hidden === true), "Undo closed Move");
  await volume(page, "36,000 mm³");
  assert.deepEqual(await items(page), before, "Undo with Move open took back no step (the width stays 60)");
  assert.equal((await undoButton(page)).title, label, "Undo reads as before Move opened");
  await page.context().close();
}

// 2c. The Extrude panel opened from a sketch: Ctrl+Z cancels the Extrude and keeps the rectangle.
if (!only || only === "2c") {
  const page = await fresh({ box: false });
  await rectangle(page);
  const label = (await undoButton(page)).title;
  assert.match(label, /rectangle/i, "the rectangle is the last step");
  await page.click("#sketch-extrude");
  await until(page, () => document.getElementById("extrude-panel")?.hidden === false, null, "the Extrude panel");
  await page.fill("#extrude-distance", "5");
  await page.waitForTimeout(600);
  await ctrlZ(page);
  assert.ok(await page.evaluate(() => document.getElementById("extrude-panel")?.hidden !== false), "Ctrl+Z closed the Extrude panel");
  assert.equal((await undoButton(page)).title, label, "the rectangle is still the last step: nothing was undone");
  await page.context().close();
}

// 3. File > New, then Undo: the design and its file come back; Redo lets the file go again.
if (!only || only === "3") {
  const page = await fresh();
  await settle(page, 1200);
  const [first] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click("#save")]);
  const saved = await (await import("node:fs")).promises.readFile(await first.path(), "utf8");
  await page.setInputFiles("#open-file", { name: "plate.spindle", mimeType: "application/json", buffer: Buffer.from(saved) });
  await volume(page, "24,000 mm³");
  await settle(page, 1500);
  const saveName = async () => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#save")]);
    return dl.suggestedFilename();
  };
  assert.equal(await saveName(), "plate.spindle", "Save offers the file opened");
  await pinProperties(page);
  await page.fill("#depth", "10");
  await volume(page, "8,000 mm³");
  await settle(page, 1200);
  await chooseFile(page, "start-fresh");
  await until(page, () => document.getElementById("start-fresh-dialog").open, null, "New's question");
  await page.click("#start-fresh-confirm");
  await settle(page, 1200);
  await page.click("#undo");
  await settle(page, 1200);
  await volume(page, "8,000 mm³");
  assert.equal(await saveName(), "plate.spindle", "after New and Undo, Save offers plate.spindle again");
  await page.click("#redo");
  await settle(page, 1200);
  await page.click("#undo");
  await settle(page, 1200);
  await volume(page, "8,000 mm³");
  assert.equal(await saveName(), "plate.spindle", "after Redo and Undo again, still plate.spindle");
  await page.context().close();
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
console.log("undo-open-tool: ok");
