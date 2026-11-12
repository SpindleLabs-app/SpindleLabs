// Browser check of a store that is really full (export hunt 2026-11-12, SL #643): Chromium's quota for the page is
// capped a little over what it uses (CDP Storage.overrideQuotaForOrigin) and a filler database takes the rest, so the
// next write of any size gets a real QuotaExceededError. Then the ways out a person would try:
// - deleting an old project from File > Projects in this browser makes room (item 2: it was refused, in the words of
//   a save, because a full store refuses any step that writes, even one that makes it smaller).
// Chromium only: the other engines have no quota override (the storage package's unit tests cover the rule there).
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { browserName, launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

if (browserName !== "chromium") {
  console.log(`storage-full: skipped in ${browserName} (needs Chromium's quota override)`);
  process.exit(0);
}
const PORT = 4795;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const origin = `http://localhost:${PORT}`;
const browser = await launch();
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${String(e.message ?? e).split("\n").join("\n  ")}`);
  }
}

const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const saved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
const notSaved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "error", null, "Not saved", 30000);
const volume = (page, want) => until(page, (w) => document.querySelector("#volume")?.textContent === w, want, `the volume ${want}`);
const status = (page) => page.$eval("#save-status", (e) => e.textContent);
async function typeWidth(page, value) {
  await page.click("#width");
  await page.fill("#width", value);
}
async function saveFile(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  return readFileSync(await download.path(), "utf8");
}
const showList = async (page) => {
  await chooseFile(page, "file-projects");
  await until(page, () => document.querySelector("#projects")?.open && document.querySelectorAll("#projects-items .project-row").length > 0, null, "the projects list");
};
const rows = (page) => page.$$eval("#projects-items .project-row", (rs) => rs.map((r) => `${r.querySelector(".project-row-name").textContent}${r.dataset.open !== undefined ? " (open)" : ""}`));

/** A fresh page with two kept projects: "Untitled" (the box 50 wide, 30,000 mm³) and "Second" (45 wide, 27,000 mm³), Second open. */
async function twoProjects() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/?test-hooks#design`);
  await startWithBox(page);
  await pinProperties(page);
  await saved(page);
  await typeWidth(page, "50");
  await volume(page, "30,000 mm³");
  await page.waitForTimeout(1300);
  await saved(page);
  const file = await saveFile(page);
  await page.setInputFiles("#open-file", { name: "second.spindle", mimeType: "application/json", buffer: Buffer.from(file.replace(/"width": ?50/, '"width": 45').replace(/"name": ?"[^"]*"/, '"name": "Second"')) });
  await volume(page, "27,000 mm³");
  await page.waitForTimeout(1500);
  await saved(page);
  await pinProperties(page);
  return { context, page, errors, cdp: await context.newCDPSession(page) };
}

/** Caps the page's quota a little over what it uses and fills the rest, so the next write of any size is refused. */
async function fillStorage(page, cdp, headroom = 300_000) {
  const { usage } = await cdp.send("Storage.getUsageAndQuota", { origin });
  await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: usage + headroom });
  await page.evaluate(async () => {
    const db = await new Promise((ok) => {
      const r = indexedDB.open("filler", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("f");
      r.onsuccess = () => ok(r.result);
    });
    let n = 0;
    for (const size of [50_000, 5_000, 500, 50])
      for (;;) {
        const s = Array.from({ length: size }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join("");
        const ok = await new Promise((done) => {
          const tx = db.transaction("f", "readwrite");
          tx.objectStore("f").put(s, "k" + n++);
          tx.oncomplete = () => done(true);
          tx.onabort = () => done(false);
        });
        if (!ok) break;
      }
    db.close();
  });
}

try {
  await check("storage full: an edit says Not saved, and deleting the other project from the list makes room and is not refused", async () => {
    const { context, page, errors, cdp } = await twoProjects();
    await fillStorage(page, cdp);
    await typeWidth(page, "60");
    await volume(page, "36,000 mm³");
    await notSaved(page);
    assert.match(await status(page), /^Not saved: browser storage is full/);
    await showList(page);
    assert.deepEqual(await rows(page), ["Second (open)", "Untitled"]);
    const other = page.locator("#projects-items .project-row:not([data-open])").first();
    await other.locator(".project-delete").click();
    await other.locator(".project-delete-sure").click();
    await until(page, () => document.querySelectorAll("#projects-items .project-row").length === 1, null, "the deleted project leaving the list").catch(async (e) => {
      assert.fail(`${e.message}; the dialog says "${await page.$eval("#projects-status", (s) => s.textContent)}"`);
    });
    assert.deepEqual(await rows(page), ["Second (open)"]);
    assert.equal(await page.$eval("#projects-status", (s) => s.textContent), "", "no refusal is shown");
    // It is gone from the store itself, not only from the list: its text and its listing.
    const left = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("fission");
          r.onsuccess = () => {
            const q = r.result.transaction("kv").objectStore("kv").getAllKeys();
            q.onsuccess = () => {
              r.result.close();
              resolve(q.result.filter((k) => String(k).startsWith("project/")).length);
            };
          };
        }),
    );
    assert.equal(left, 1, "one project's text is left in the store");
    assert.deepEqual(errors, []);
    await context.close();
  });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
