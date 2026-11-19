// Browser check of the lost-work leftovers of issue #627 (items 5, 9, 10) and #643 item 3, in a real browser:
// A  storage full, a file opened (a project the store never took), changed, then the page reloaded: the reload shows
//    that file's design, says its changes wait for room, Save writes it, and File > Projects lists it (#627 item 5,
//    #643 item 3: another project opened marked "Saved", Save wrote the wrong design, and no list had it).
// B  two browser tabs on two projects: reloading one opens its own project again, not the other tab's (#627 item 10).
// C  a project opened from a Projects list shown before another tab saved it: its next edit is saved, never "changed
//    in another tab" with only one tab left (#627 item 9: the list's older save time was handed over).
// D  a project never named, saved under a file name chosen in the picker: the file holds that name, and so does the
//    project (Projects lists it by it) (#644 item 3, its save half: the file kept "Untitled" inside).
// Chromium only for A (its quota override makes a real full store); B and C in every engine.
// Run with `npm run e2e` (after `npm run build`). ONLY=<letters> picks checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boot, check, fails, readFile, REAL_FILE_PICKER, savedMark, volumeIs } from "./save-picker-lib.mjs";
import { startWithBox, chooseFile } from "./start.mjs";
import { pinProperties } from "./properties.mjs";
import { browserName, chosen, watchErrors } from "./browser.mjs";

const b = await boot(4802);
const origin = b.url.replace(/\/$/, "");
const want = (k) => chosen(k, (only, key) => only.includes(key));
const mark = (page) => page.textContent("#save-status");
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
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
const openRow = (page, name) => page.locator("#projects-items .project-row", { has: page.locator(".project-row-name", { hasText: name }) }).locator(".project-open").click();

/** A page with a kept project "Untitled", the box 50 wide (30,000 mm³), saved; its file text. */
async function onePage(context) {
  const page = await context.newPage();
  await page.goto(`${b.url}?test-hooks#design`);
  await startWithBox(page);
  await pinProperties(page);
  await savedMark(page);
  await typeWidth(page, "50");
  await volumeIs(page, "30,000 mm³");
  await page.waitForTimeout(1300);
  await savedMark(page);
  return { page, file: await saveFile(page) };
}
const named = (file, width, name) => Buffer.from(file.replace(/"width": ?50/, `"width": ${width}`).replace(/"name": ?"[^"]*"/, `"name": "${name}"`));
/** Caps the page's quota a little over what it uses and fills the rest, so the next write of any size is refused (as storage-full.mjs). */
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
  if (want("A") && browserName === "chromium") await check("A  storage full: a file opened and changed, then a reload: its design shows, Save writes it, and Projects lists it", async () => {
    const context = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    watchErrors(context, [/QuotaExceeded|storage is full/]);
    const { page, file } = await onePage(context);
    const cdp = await context.newCDPSession(page);
    await fillStorage(page, cdp);
    await page.setInputFiles("#open-file", { name: "bracket.spindle", mimeType: "application/json", buffer: named(file, 45, "Bracket") });
    await volumeIs(page, "27,000 mm³");
    await pinProperties(page);
    await typeWidth(page, "70");
    await volumeIs(page, "42,000 mm³");
    await page.waitForTimeout(1500);
    page.on("dialog", (d) => void d.accept());
    await page.reload({ waitUntil: "load" });
    await until(page, () => /mm³/.test(document.querySelector("#volume")?.textContent ?? ""), null, "a design after the reload");
    await page.waitForTimeout(1500);
    console.log(`  after the reload: ${await page.textContent("#volume")} | ${await mark(page)}`);
    assert.equal(await page.textContent("#volume"), "42,000 mm³", "the Bracket 70 wide the person last saw (it opened the other project)");
    assert.match(await mark(page), /^Not saved: (browser storage is full|this browser's storage had no room for your latest changes)/, "never Saved");
    assert.match(await saveFile(page), /"width": ?70/, "Save to a file holds the width 70");
    await showList(page);
    assert.deepEqual(await rows(page), ["Bracket (open)", "Untitled"]);
    await context.close();
  });

  if (want("B")) await check("B  two tabs on two projects: reloading the first opens its own project again", async () => {
    const context = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    watchErrors(context);
    const { page: first, file } = await onePage(context);
    const second = await context.newPage();
    await second.goto(`${b.url}?test-hooks#design`);
    await volumeIs(second, "30,000 mm³");
    await second.setInputFiles("#open-file", { name: "q.spindle", mimeType: "application/json", buffer: named(file, 40, "Q") });
    await volumeIs(second, "24,000 mm³");
    await pinProperties(second);
    await typeWidth(second, "48");
    await volumeIs(second, "28,800 mm³");
    await second.waitForTimeout(1500);
    await savedMark(second); // Q is now the project saved last in this browser
    await first.reload({ waitUntil: "load" });
    await until(first, () => /mm³/.test(document.querySelector("#volume")?.textContent ?? ""), null, "a design after the reload");
    await first.waitForTimeout(1000);
    console.log(`  the first tab after its reload: ${await first.textContent("#volume")}`);
    assert.equal(await first.textContent("#volume"), "30,000 mm³", "the first tab's own Untitled, 50 wide (it showed the other tab's Q)");
    await pinProperties(first);
    await typeWidth(first, "52");
    await volumeIs(first, "31,200 mm³");
    await first.waitForTimeout(1300);
    await savedMark(first);
    await context.close();
  });

  if (want("C")) await check("C  a project opened from a list shown before another tab saved it: the next edit is saved", async () => {
    const context = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    watchErrors(context);
    const { page: first, file } = await onePage(context);
    // A second project, so the list has another row to open: "Second" (45 wide), open in the first tab.
    await first.setInputFiles("#open-file", { name: "second.spindle", mimeType: "application/json", buffer: named(file, 45, "Second") });
    await volumeIs(first, "27,000 mm³");
    await first.waitForTimeout(1500);
    await savedMark(first);
    await showList(first); // the list as it is now: Untitled saved when it was 50 wide
    const other = await context.newPage();
    await other.goto(`${b.url}?test-hooks#design`);
    await volumeIs(other, "27,000 mm³");
    await showList(other);
    await openRow(other, "Untitled");
    await volumeIs(other, "30,000 mm³");
    await pinProperties(other);
    await typeWidth(other, "55"); // the other tab saves Untitled after the first tab's list was read
    await volumeIs(other, "33,000 mm³");
    await other.waitForTimeout(1500);
    await savedMark(other);
    await other.close();
    await openRow(first, "Untitled");
    await volumeIs(first, "33,000 mm³");
    await first.waitForTimeout(1500);
    await pinProperties(first);
    await typeWidth(first, "56");
    await volumeIs(first, "33,600 mm³");
    await first.waitForTimeout(1500);
    console.log(`  after the edit: ${await mark(first)}`);
    assert.doesNotMatch(await mark(first), /changed in another tab/, "one tab left, and it holds the newest state");
    await savedMark(first);
    await context.close();
  });

  if (want("D")) await check("D  a project never named, saved as Bracket: the file and the project are called Bracket", async () => {
    const context = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    await context.addInitScript(REAL_FILE_PICKER);
    watchErrors(context);
    const page = await context.newPage();
    await page.goto(`${b.url}?test-hooks#design`);
    await startWithBox(page);
    await savedMark(page);
    await page.evaluate(() => (window.__chosen = "Bracket.spindle"));
    await page.click("#save");
    await until(page, () => window.__writes.includes("Bracket.spindle"), null, "the file written");
    const text = await readFile(page, "Bracket.spindle");
    assert.equal(JSON.parse(text).name, "Bracket", "the name inside the file");
    await page.waitForTimeout(1500);
    await savedMark(page);
    await showList(page);
    assert.deepEqual(await rows(page), ["Bracket (open)"]);
    // A name of its own is never replaced: saved again as Other.spindle, the file still says Bracket.
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.__chosen = "Other.spindle"));
    await chooseFile(page, "file-save-as");
    await until(page, () => window.__writes.includes("Other.spindle"), null, "the second file written");
    assert.equal(JSON.parse(await readFile(page, "Other.spindle")).name, "Bracket", "named once, it keeps its name");
    await context.close();
  });
} finally {
  await b.close();
}
process.exit(fails() ? 1 : 0);
