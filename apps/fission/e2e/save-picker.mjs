// Browser check of Save and Save As to a file through the real keys and buttons (export hunt 2026-11-12, SL #644),
// with a stand-in save picker whose files are real browser files (the page's private file system, so createWritable,
// write and close behave as the browser's own; save-picker-lib.mjs). The file holds what is on screen; a failed
// write says why and never harms the good file, and a file that can't be written again with no other place chosen
// says nothing was saved (item 6); Save writes the kept file only for the same project; Ctrl+S pressed again while a
// save is asking gives one question and one file, with a picker or the name box (item 4); a project that opens
// while a save is asking does not inherit the picked file (item 5). ONLY=<letters> picks checks.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { browserName } from "./browser.mjs";
import { boot, check, fails, REAL_FILE_PICKER, NO_PICKER, readFile, shapeOf, status } from "./save-picker-lib.mjs";
import { startWithBox, chooseFile, insertPreset } from "./start.mjs";
import { pinProperties } from "./properties.mjs";

// Chromium only: the stand-in picker's files need the private file system's createWritable, which WebKit lacks, and
// Firefox and Safari have no save picker at all (their path, the name box, is check E here and in files.mjs).
if (browserName !== "chromium") {
  console.log(`save-picker: skipped in ${browserName} (needs Chromium's file system access)`);
  process.exit(0);
}
const TMP = mkdtempSync(tmpdir() + "/save-picker-");
const b = await boot();
const only = process.env.ONLY;
const want = (k) => !only || only.includes(k);
async function fresh(init = REAL_FILE_PICKER, extra = null) {
  const context = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await context.addInitScript(init);
  if (extra) await context.addInitScript(extra);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  PAGE ERROR", e.message));
  await page.goto(b.url + "#design");
  await startWithBox(page);
  await pinProperties(page);
  return { context, page };
}
const params = (text) => JSON.stringify(JSON.parse(text).workspaces.design.timeline.features.map((f) => f.intent.parameters));
const picks = (page) => page.evaluate(() => window.__picks.length);
const saveKey = (page) => page.keyboard.press("Control+s");
const settle = (page, ms = 400) => page.waitForTimeout(ms);

try {
  if (want("A")) await check("A  a width typed and Ctrl+S at once (no wait): the file holds the width on screen; then Undo and Ctrl+S at once: the file holds the old width", async () => {
    const { context, page } = await fresh();
    await page.fill("#width", "60");
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 1);
    await settle(page);
    console.log("  file after typing 60 + Ctrl+S:", params(await readFile(page, "Untitled.spindle")));
    assert.match(params(await readFile(page, "Untitled.spindle")), /"width":60/);
    await page.click("#viewport"); // out of the box
    await page.keyboard.press("Control+z");
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 2);
    await settle(page);
    console.log("  file after Undo + Ctrl+S:", params(await readFile(page, "Untitled.spindle")), "box shows", await page.inputValue("#width"));
    assert.match(params(await readFile(page, "Untitled.spindle")), /"width":40/);
    // half typed: "7" of "75"
    await page.click("#width");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("7");
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 3);
    await settle(page);
    console.log("  file with the box half typed (7):", params(await readFile(page, "Untitled.spindle")), "box shows", await page.inputValue("#width"));
    assert.match(params(await readFile(page, "Untitled.spindle")), /"width":7[,}]/);
    await context.close();
  });

  if (want("B")) await check("B  first Save whose write fails says so, keeps no file for the next Save; a later Save whose file can't be written asks again and never harms the good file", async () => {
    const { context, page } = await fresh();
    await page.evaluate(() => (window.__fault = { at: "write", times: 1 }));
    await saveKey(page);
    await page.waitForFunction(() => document.querySelector("#file-status").textContent !== "");
    console.log("  first save, write fails:", await status(page), "| file:", JSON.stringify((await readFile(page, "Untitled.spindle")).slice(0, 30)));
    assert.match(await status(page), /^Couldn't write "Untitled\.spindle": /);
    assert.doesNotMatch(await status(page), /ERRORED/, "the write's own reason, not 'Cannot close a ERRORED writable stream'");
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 1);
    await settle(page);
    assert.equal(await picks(page), 2, "the next Save asks again");
    assert.equal(await status(page), "");
    const good = await readFile(page, "Untitled.spindle");
    assert.match(params(good), /"width":40/);
    for (const at of ["create", "write", "close"]) {
      await page.fill("#width", at === "create" ? "51" : at === "write" ? "52" : "53");
      const before = await picks(page);
      await page.evaluate((at) => ((window.__fault = { at, times: 1 }), (window.__abortNext = true)), at);
      await saveKey(page);
      await page.waitForFunction((n) => window.__picks.length === n + 1, before);
      await settle(page);
      const now = await readFile(page, "Untitled.spindle");
      console.log(`  later save, ${at} fails, the picker that follows is closed: message ${JSON.stringify(await status(page))}; the file still holds ${params(now)}`);
      // The reason is said, and that nothing was saved (it said nothing at all: SL #644 item 6).
      assert.match(await status(page), /^Couldn't write "Untitled\.spindle" again: .+\. No other place was chosen, so nothing was saved\.$/);
      if (at === "write") assert.doesNotMatch(await status(page), /ERRORED/, "the write's own reason, not the close's");
      assert.equal(JSON.parse(now).formatVersion, 2, "the file on disk is still a whole project");
    }
    // and after all that a Save goes through
    await saveKey(page);
    await settle(page, 800);
    console.log("  then a clean Save:", params(await readFile(page, "Untitled.spindle")), "picks", await picks(page));
    await context.close();
  });

  if (want("C")) await check("C  Save writes the kept file again only for the same project: after New, after Open and after Projects in this browser it asks", async () => {
    const { context, page } = await fresh();
    await page.evaluate(() => (window.__chosen = "A.spindle"));
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 1);
    await settle(page);
    const a = await readFile(page, "A.spindle");
    writeFileSync(TMP + "/A.spindle", a);
    const bText = a.replace('"width": 40', '"width": 77').replace('"name": "Untitled"', '"name": "Bee"');
    writeFileSync(TMP + "/B.spindle", bText);
    // New
    await page.evaluate(() => (window.__chosen = "afterNew.spindle"));
    await chooseFile(page, "start-fresh");
    await page.waitForTimeout(300);
    const confirm = await page.$("dialog[open] button.ok, dialog[open] [data-answer=yes], #start-fresh-confirm");
    console.log("  New asked:", await page.evaluate(() => document.querySelector("dialog[open]")?.textContent?.slice(0, 120) ?? "(no dialog)"));
    if (confirm) await confirm.click();
    else await page.evaluate(() => [...(document.querySelector("dialog[open]")?.querySelectorAll("button") ?? [])].find((x) => /new|start|yes|ok/i.test(x.textContent))?.click());
    await page.locator("#start-hint").waitFor();
    await saveKey(page);
    await page.waitForFunction(() => window.__picks.length === 2);
    await settle(page);
    assert.equal(await readFile(page, "A.spindle"), a, "A's file untouched after New + Save");
    // Undo the New: A's design is back; Save now goes to afterNew.spindle (the last file), not A
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³");
    await saveKey(page);
    await settle(page, 600);
    console.log("  New, Save (afterNew.spindle), Undo, Save: picks", await picks(page), "afterNew holds", params(await readFile(page, "afterNew.spindle")), "| A untouched:", (await readFile(page, "A.spindle")) === a);
    // Open B
    await page.evaluate(() => (window.__chosen = "afterOpen.spindle"));
    await page.setInputFiles("#open-file", TMP + "/B.spindle");
    await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "46,200 mm³");
    const n = await picks(page);
    await saveKey(page);
    await page.waitForFunction((n) => window.__picks.length === n + 1, n);
    await settle(page);
    console.log("  after Open of B.spindle, Save offered:", await page.evaluate(() => window.__picks.at(-1)));
    assert.equal(await page.evaluate(() => window.__picks.at(-1)), "B.spindle");
    assert.equal(await readFile(page, "A.spindle"), a);
    // Projects in this browser: open the other one
    await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
    await chooseFile(page, "file-projects");
    await page.waitForSelector("dialog[open] .project-open, dialog[open] [data-action=open], dialog[open] button");
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("dialog[open] button")].find((x) => /^open/i.test(x.textContent.trim()));
      btn?.click();
      return Boolean(btn);
    });
    assert.ok(opened, "a project to open in the list");
    await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³", null, { timeout: 15000 });
    const m = await picks(page);
    await page.evaluate(() => (window.__chosen = "afterList.spindle"));
    await saveKey(page);
    await page.waitForFunction((n) => window.__picks.length === n + 1, m);
    await settle(page);
    console.log("  after Projects > Open, Save offered:", await page.evaluate(() => window.__picks.at(-1)), "| afterOpen.spindle still B:", /"width":77/.test(params(await readFile(page, "afterOpen.spindle"))));
    assert.match(params(await readFile(page, "afterOpen.spindle")), /"width":77/);
    await context.close();
  });

  if (want("D")) await check("D  Ctrl+S pressed again while the save picker is still open: one question, one file", async () => {
    const { context, page } = await fresh();
    await page.evaluate(() => (window.__hold = true));
    await saveKey(page);
    await page.waitForFunction(() => window.__picks.length === 1);
    await saveKey(page);
    await settle(page, 300);
    const boxes = await page.evaluate(() => document.querySelectorAll(".save-name").length);
    console.log("  picker open, Ctrl+S again: pickers asked", await picks(page), "| 'Name this file' boxes on the page:", boxes, "| message:", JSON.stringify(await status(page)));
    await page.evaluate(() => window.__release());
    await settle(page);
    assert.equal(boxes, 0, "no second question behind the picker");
    await context.close();
  });

  if (want("E")) await check("E  no save picker (Firefox, Safari): Ctrl+S three times quickly gives ONE name box and one file", async () => {
    const { context, page } = await fresh(NO_PICKER);
    const downloads = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await saveKey(page);
    await page.waitForSelector(".save-name");
    await saveKey(page);
    await saveKey(page);
    await settle(page, 300);
    const boxes = await page.evaluate(() => document.querySelectorAll(".save-name").length);
    console.log("  name boxes on the page after 3 x Ctrl+S:", boxes);
    for (let i = 0; i < boxes; i++) { await page.keyboard.press("Enter"); await settle(page, 300); }
    console.log("  Enter on each: files downloaded:", JSON.stringify(downloads));
    assert.equal(boxes, 1);
    await context.close();
  });

  if (want("F")) await check("F  a file that finishes opening while the save picker is still up: the picked file is not kept as the NEW project's file", async () => {
    const { context, page } = await fresh();
    await page.evaluate(() => ((window.__chosen = "A.spindle"), (window.__hold = true)));
    await saveKey(page);
    await page.waitForFunction(() => window.__picks.length === 1);
    const a0 = readFileSync(TMP + "/B.spindle", "utf8");
    await page.setInputFiles("#open-file", TMP + "/B.spindle"); // arrives behind the picker (a drop, a paste, a slow read)
    await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "46,200 mm³");
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__writes.length === 1);
    await settle(page);
    const first = params(await readFile(page, "A.spindle"));
    await page.evaluate(() => (window.__hold = false));
    await saveKey(page);
    await settle(page, 800);
    const second = params(await readFile(page, "A.spindle"));
    console.log("  A.spindle after the held save:", first, "| after the next Ctrl+S (project B on screen):", second, "| pickers asked:", await picks(page));
    assert.equal(await picks(page), 2, "Save on project B asks where");
    await context.close();
  });
  // App-wide hunt 2026-11-14, R-3. Hand working: the file last saved to is B (Save As let A go), so the last Ctrl+S
  // writes B: B holds 75 and A, the copy left behind, still holds the 40 it was saved at. The Undo back to the design
  // A was saved at put A back as the project's file: A was written over without a question and B missed the work.
  if (want("G")) await check("G  Save to A (width 40); width 60; Save As B; Undo to 40; width 75; Ctrl+S: B holds 75, A still 40, no question", async () => {
    const { context, page } = await fresh();
    const width = async (name) => JSON.parse(await readFile(page, name)).workspaces.design.timeline.features[0].intent.parameters.width;
    const typeWidth = async (w) => {
      await page.fill("#width", String(w));
      await page.click("#viewport");
      await settle(page, 1300); // past the merge window, so each typed size is its own undo step
    };
    await page.evaluate(() => (window.__chosen = "A.spindle"));
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 1);
    await settle(page);
    assert.equal(await width("A.spindle"), 40, "A saved at width 40");
    await typeWidth(60);
    await page.evaluate(() => (window.__chosen = "B.spindle"));
    await page.keyboard.press("Control+Shift+s");
    await page.waitForFunction(() => window.__writes.length === 2);
    await settle(page);
    assert.equal(await width("B.spindle"), 60, "B saved (Save As) at width 60");
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => document.querySelector("#width").value === "40");
    await settle(page);
    await typeWidth(75);
    const asked = await picks(page);
    await saveKey(page);
    await page.waitForFunction(() => window.__writes.length === 3);
    await settle(page);
    console.log("  files written in order:", (await page.evaluate(() => window.__writes)).join(", "));
    assert.equal(await width("A.spindle"), 40, "A, left behind by Save As, is not written over");
    assert.equal(await width("B.spindle"), 75, "B, the file last saved to, holds the work");
    assert.equal(await picks(page), asked, "Save writes B again without asking");
    await context.close();
  });
} finally {
  await b.close();
}
console.log(fails() ? `${fails()} FAILED` : "all ok");
process.exit(fails() ? 1 : 0);
