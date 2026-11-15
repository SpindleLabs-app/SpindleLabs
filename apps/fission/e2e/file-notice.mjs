// Browser check of the notice under the top bar (Ben, 2026-11-15): a refused STL left its yellow notice up until
// Dismiss, even after a whole new part was designed. A passing notice now goes at the next change to the project,
// and its words say plainly that STL files can't be opened yet. At 1280 and 375 px wide. Screenshots go to
// /mnt/project-files/file-notice/ when that folder exists. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { insertPreset, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4189, strictPort: true }, logLevel: "error" });
const browser = await launch();
const errors = [];
const shots = existsSync("/mnt/project-files/") ? "/mnt/project-files/file-notice/" : null;
if (shots) (await import("node:fs")).mkdirSync(shots, { recursive: true });

const dropStl = (page) =>
  page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new TextEncoder().encode("solid cube\n")], "fancyskull.stl"));
    const el = document.querySelector("#viewport");
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
const notice = (page) => page.textContent("#file-status");

let failed = false;
for (const width of [1280, 375]) {
  try {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 700 : 800 } });
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4189/");
    await startWithBox(page);
    await dropStl(page);
    await page.waitForFunction(() => document.querySelector("#file-status").textContent.startsWith("Couldn't open"));
    assert.equal(await notice(page), "Couldn't open “fancyskull.stl”: SpindleLabs can't open STL meshes yet. Opening them is planned for DesignLab, as mesh bodies.");
    if (shots) await page.screenshot({ path: `${shots}notice-shown-${width}.png` });
    await insertPreset(page, "cylinder"); // a new part: the notice was about a file that is not part of it
    await page.waitForFunction(() => document.querySelector("#file-status").textContent === "", null, { timeout: 5000 });
    if (shots) await page.screenshot({ path: `${shots}notice-gone-${width}.png` });
    await page.close();
    console.log(`PASS notice goes at the next edit (${width})`);
  } catch (e) {
    failed = true;
    console.log(`FAIL (${width})\n  ${e.stack ?? e}`);
  }
}
try {
  assert.deepEqual(errors, []);
} catch (e) {
  failed = true;
  console.log(`FAIL page errors\n  ${e}`);
}
await browser.close();
await new Promise((r) => server.httpServer.close(r));
if (failed) process.exit(1);
console.log("file notice checks passed");
