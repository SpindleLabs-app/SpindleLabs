// Browser check of the History kept across a reload (step 89, Ben's ask 2026-11-09): a box, its width typed 60 and its
// height 10, the height undone, then the page reloaded: the History panel lists the same four steps with the height a
// redo away, Redo and three Undos walk them (volumes worked by hand), and a project opened again from File > Projects
// in this browser gets its own steps back while a new one starts with none. The control: the same reload with the kept
// steps taken out of the store starts afresh, so the check can fail. 1280 px with a mouse, 393 × 852 with taps.
// Run with `npm run e2e` (after `npm run build`). E2E_SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, sheetsClearFor, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4231, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4231/?test-hooks#design";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = 0;

const CLEAR = ["#timeline", "#undo", "#redo", "#history", "#view-controls", "[data-view"];
async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, colorScheme: "dark" });
  const page = await context.newPage();
  // A fresh store for this context's first page only: a reload must find what the visit kept.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-cleared")) return;
    sessionStorage.setItem("e2e-cleared", "1");
    indexedDB.deleteDatabase("fission");
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, tap);
  await sheetsClearFor(page, CLEAR);
  return { context, page };
}
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => assert.fail(`${what}: timed out`));
const volume = (page, text) => until(page, (t) => document.querySelector("#volume")?.textContent === t, text, text);
async function openHistory(page, tap) {
  if (await page.isHidden("#history-panel")) await (tap ? page.tap("#history") : page.click("#history"));
  await page.waitForSelector("#history-panel:not([hidden])");
}
async function closeHistory(page) {
  if (await page.isVisible("#history-panel")) await page.keyboard.press("Escape");
  await page.waitForSelector("#history-panel", { state: "hidden" });
}
const rows = (page) => page.$$eval("#history-panel .history-list li", (li) => li.map((l) => [l.dataset.state, l.querySelector(".history-name").textContent]));
const press = (page, id, tap) => (tap ? page.tap(id) : page.click(id));
/** Saved, and the steps' quiet moment (300 ms) past, so what a reload finds is settled. */
async function settled(page) {
  await until(page, () => document.querySelector("#save-status")?.dataset.state === "saved", null, "Saved");
  await page.waitForTimeout(600);
}
async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#volume")?.textContent || !document.querySelector("#start-hint")?.hidden);
  await sheetsClearFor(page, CLEAR);
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
/** The box (40 × 30 × 20 = 24,000 mm³), its width typed 60 (60 · 30 · 20 = 36,000), its height 10 (60 · 30 · 10 = 18,000). */
async function threeSteps(page) {
  await pinProperties(page);
  await page.fill("#width", "60");
  await volume(page, "36,000 mm³");
  await page.waitForTimeout(1100); // past the merge time, so the height is a step of its own
  await page.fill("#height", "10");
  await volume(page, "18,000 mm³");
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [393, 852, true]]) {
    await check(`${width} px: after a reload the History lists the same steps, the undone one a redo away, and Undo and Redo walk them`, async () => {
      const { context, page } = await fresh(width, height, tap);
      try {
        await threeSteps(page);
        await press(page, "#undo", tap); // the height undone: 36,000 mm³
        await volume(page, "36,000 mm³");
        await openHistory(page, tap);
        const before = await rows(page);
        // Newest first: the height (undone), the width (current), the box, Before these steps.
        assert.deepEqual(before.map((r) => r[0]), ["undone", "current", "done", "done"], JSON.stringify(before));
        await closeHistory(page);
        await settled(page);
        await reload(page);
        await volume(page, "36,000 mm³");
        await openHistory(page, tap);
        assert.deepEqual(await rows(page), before, "the same rows after the reload");
        if (shots) await page.screenshot({ path: `${shots}/kept-history-${width}.png` });
        await closeHistory(page);
        await press(page, "#redo", tap);
        await volume(page, "18,000 mm³");
        await press(page, "#undo", tap);
        await volume(page, "36,000 mm³");
        await press(page, "#undo", tap); // the width: back to the box as inserted
        await volume(page, "24,000 mm³");
        await press(page, "#undo", tap); // the box: the empty design
        await page.waitForSelector("#start-hint");
        assert.equal(await page.isDisabled("#undo"), true, "nothing older");
        // Redone and reloaded again: the steps written after the first reload are the ones kept.
        await press(page, "#redo", tap);
        await volume(page, "24,000 mm³");
        await settled(page);
        await reload(page);
        await volume(page, "24,000 mm³");
        assert.equal(await page.isDisabled("#undo"), false);
        assert.equal(await page.isDisabled("#redo"), false, "the width and height still a redo away");
      } finally {
        await context.close();
      }
    });

    await check(`${width} px: the control: with the kept steps taken out of the store, the same reload starts the History afresh`, async () => {
      const { context, page } = await fresh(width, height, tap);
      try {
        await threeSteps(page);
        await settled(page);
        const gone = await page.evaluate(
          () =>
            new Promise((done, fail) => {
              const open = indexedDB.open("fission");
              open.onerror = () => fail(open.error);
              open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction(db.objectStoreNames[0], "readwrite");
                const store = tx.objectStore(db.objectStoreNames[0]);
                const keys = store.getAllKeys();
                keys.onsuccess = () => {
                  const steps = keys.result.filter((k) => String(k).startsWith("steps"));
                  for (const k of steps) store.delete(k);
                  tx.oncomplete = () => (db.close(), done(steps.length));
                };
              };
            }),
        );
        assert.equal(gone, 2, "steps/<id> and steps-at/<id> were kept");
        await reload(page);
        await volume(page, "18,000 mm³");
        assert.equal(await page.isDisabled("#undo"), true, "nothing to undo");
        assert.equal(await page.isHidden("#history"), true, "History has nothing to list");
      } finally {
        await context.close();
      }
    });
  }

  await check("a project opened again from File > Projects in this browser gets its own steps back; another project opened starts with none", async () => {
    const { context, page } = await fresh(1280, 800, false);
    try {
      await threeSteps(page);
      await settled(page);
      // Another project: the saved file under another name, opened in its place (kept as a project of its own).
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      const other = { ...JSON.parse(readFileSync(await download.path(), "utf8")), name: "Other" };
      await page.setInputFiles("#open-file", { name: "other.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)) });
      await until(page, () => document.querySelector("#save-status")?.dataset.state === "saved" && document.querySelector("#undo")?.disabled, null, "Other opened, nothing to undo");
      await settled(page);
      await chooseFile(page, "file-projects");
      await until(page, () => document.querySelectorAll("#projects-items .project-row").length >= 2, null, "the list").catch(async (e) => {
        throw new Error(`${e.message}: ${await page.evaluate(() => document.querySelector("#projects")?.outerHTML.slice(0, 1500))}`);
      });
      await page.locator("#projects-items .project-row:not([data-open]) .project-open").click(); // the other one: the 18,000 mm³ box
      await volume(page, "18,000 mm³");
      await settled(page);
      await openHistory(page, false);
      const back = await rows(page);
      assert.deepEqual(back.map((r) => r[0]), ["current", "done", "done", "done"], JSON.stringify(back));
      await closeHistory(page);
      await press(page, "#undo", false);
      await volume(page, "36,000 mm³");
    } finally {
      await context.close();
    }
  });
} finally {
  await browser.close();
  await server.close();
}
const real = errors.filter((e) => !/Failed to load resource/.test(e));
if (real.length > 0) {
  failed++;
  console.log(`not ok - no page errors\n  ${real.join("\n  ")}`);
}
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("kept history: all passed");
