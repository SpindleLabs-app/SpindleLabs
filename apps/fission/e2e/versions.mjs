// Browser check of File > Earlier versions… (missing basics 3b), in a real Chromium, the clock moved on by the test
// (page.clock.setSystemTime: Date.now jumps, timers run as normal):
//   versions are kept as you work (the state each save replaces, at most one every ten minutes), listed newest first;
//   Restore puts one back as ONE undo step: Undo takes it back, Redo again, and a reload keeps what was restored;
//   a version that can't be read is refused in the dialog with why, and the project stays as it was;
//   a project with none says so; at 375 px with touch the dialog fills the screen with 44 px buttons and restores by tap.
// Screenshots (SHOTS=<dir>) at 1280 and 375 px. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseFile, openPanel, startWithBox } from "./start.mjs";

const PORT = 4616;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
const MIN = 60_000;

let failed = 0;
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const volume = async (page, want) => {
  try {
    await page.waitForFunction((w) => document.querySelector("#volume")?.textContent === w, want, { timeout: 15000 });
  } catch {
    assert.fail(`the volume ${want}: timed out, showing ${await page.textContent("#volume")}`);
  }
};
const saved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
const shot = (page, name) => (shots ? page.screenshot({ path: `${shots}/${name}.png` }) : null);

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 667 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setSystemTime(new Date(2026, 10, 4, 9, 0)); // 09:00 here, moved on by the test
  await page.goto(url + "#design");
  await startWithBox(page, touch); // 40 · 30 · 20 = 24,000 mm³
  await pinProperties(page);
  await saved(page);
  return { context, page };
}
/** Sets the width and waits for it to be stored; the clock first moved on `minutes`. */
async function widthAt(page, minutes, value, want, tap = false) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(new Date(now + minutes * MIN));
  await openPanel(page, "properties", tap);
  await page.click("#width");
  await page.fill("#width", String(value));
  await volume(page, want);
  await saved(page);
}
/**
 * The working that every check starts from (each state's volume is width · 30 · 20):
 *   09:00 the box, 40 wide (24,000 mm³), the project's first save: nothing before it, no version;
 *   09:00 50 wide (30,000): replaces the 40-wide state, and there is no version yet, so 40 is kept;
 *   09:11 60 wide (36,000): replaces 50 (saved 09:00), 0 minutes after the newest version: not kept;
 *   09:22 70 wide (42,000): replaces 60 (saved 09:11), 11 minutes after it: kept.
 * So two versions, newest first: 60 wide (09:11), then 40 wide (09:00).
 */
async function worked(page, tap = false) {
  await widthAt(page, 0, 50, "30,000 mm³", tap);
  await widthAt(page, 11, 60, "36,000 mm³", tap);
  await widthAt(page, 11, 70, "42,000 mm³", tap);
}
const showList = async (page, tap = false) => {
  await chooseFile(page, "file-versions", tap);
  await until(page, () => document.querySelector("#versions")?.open && (document.querySelectorAll("#versions-items .project-row").length > 0 || document.querySelector("#versions-status").textContent !== ""), null, "the list");
};
const listed = (page) => page.$$eval("#versions-items .project-row", (rows) => rows.map((r) => r.querySelector(".project-row-when").textContent));
const restore = (page, n) => page.locator("#versions-items .project-row").nth(n).locator(".version-restore");

try {
  await check("versions kept as you work, newest first; Restore is one undo step; a reload keeps it", async () => {
    const { context, page } = await fresh();
    await worked(page);
    await showList(page);
    // Seen at 09:22: the 60-wide state saved 09:11 is 11 minutes old, the 40-wide one 22.
    assert.deepEqual(await listed(page), ["Saved 11 minutes ago", "Saved 22 minutes ago"]);
    assert.match(await page.textContent("#versions-title"), /^Earlier versions of “/);
    await shot(page, "versions-list-1280");
    await restore(page, 1).click(); // the 40-wide box
    await volume(page, "24,000 mm³");
    assert.equal(await page.$eval("#versions", (d) => d.open), false);
    assert.match(await page.textContent("#file-status"), /^Restored the version from .+\. Undo takes it back\.$/);
    await saved(page);
    await page.click("#undo"); // one step back: 70 wide, as before the restore
    await volume(page, "42,000 mm³");
    await page.click("#redo");
    await volume(page, "24,000 mm³");
    await saved(page);
    await page.reload();
    await volume(page, "24,000 mm³");
    // The state the restore replaced (70 wide, 09:22) is a version now too: 22 − 11 = 11 minutes after the newest.
    await showList(page);
    assert.equal((await listed(page)).length, 3);
    await context.close();
  });

  await check("a version that can't be read is refused with why; the project stays as it was", async () => {
    const { context, page } = await fresh();
    await worked(page);
    await page.evaluate(
      () =>
        new Promise((done, fail) => {
          const r = indexedDB.open("fission", 1);
          r.onsuccess = () => {
            const tx = r.result.transaction("kv", "readwrite");
            const kv = tx.objectStore("kv");
            const all = kv.getAllKeys();
            all.onsuccess = () => {
              for (const k of all.result) if (k.startsWith("version/")) kv.put("{ not a project", k);
            };
            tx.oncomplete = () => (r.result.close(), done());
            tx.onerror = () => fail(tx.error);
          };
        }),
    );
    await showList(page);
    await restore(page, 0).click();
    await until(page, () => /^Can't open that version: /.test(document.querySelector("#versions-status").textContent), null, "the refusal");
    assert.equal(await page.$eval("#versions", (d) => d.open), true);
    await volume(page, "42,000 mm³");
    assert.equal(await page.isDisabled("#undo"), false);
    await page.keyboard.press("Escape");
    await page.click("#undo"); // Undo takes back the last width typed, not a restore that never happened
    await volume(page, "36,000 mm³");
    await context.close();
  });

  await check("a project with no versions yet says so", async () => {
    const { context, page } = await fresh();
    await showList(page);
    assert.equal(await page.textContent("#versions-status"), "No earlier versions yet: one is kept once you have worked on this project for ten minutes or so.");
    assert.equal(await page.$$eval("#versions-items .project-row", (r) => r.length), 0);
    await context.close();
  });

  await check("375 px with touch: fills the screen, 44 px buttons, nothing off the side; restores by tap", async () => {
    const { context, page } = await fresh(375, true);
    await worked(page, true);
    await showList(page, true);
    const fit = await page.evaluate(() => {
      const d = document.querySelector("#versions").getBoundingClientRect();
      const buttons = [...document.querySelectorAll("#versions button")].map((b) => b.getBoundingClientRect());
      return { left: d.left, right: d.right, short: buttons.filter((b) => b.height < 44).length, off: buttons.filter((b) => b.left < 0 || b.right > innerWidth).length, scrolls: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(fit, { left: 0, right: 375, short: 0, off: 0, scrolls: false });
    await shot(page, "versions-list-375");
    await restore(page, 0).tap(); // the 60-wide state
    await volume(page, "36,000 mm³");
    await saved(page);
    await page.reload();
    await volume(page, "36,000 mm³");
    await context.close();
  });

  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed++;
  console.log(`not ok - ${e.message}`);
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("versions: all ok");
