// Browser check of the print log (account features 5), with no account: Slice for printing's Slice and download
// adds the saved file to File ▾ > Print log… (the result says so), with the slicer's choices and the weight and time
// it worked out; Failed shows what went wrong, the pick and a note are kept through a reload; Printed well takes the
// problem away; Delete asks first. A second tab sees a change made in the first. At 1280 px with clicks and 375 px
// with taps (the dialog a full-width sheet, nothing spilling sideways). Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4921, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4921/";
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

async function fresh(context) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return page;
}

/** The log's rows as [name, result, settings, amount]. */
const rows = (page) => page.$$eval("#print-log-items .print-log-item", (items) => items.map((li) => [li.querySelector(".print-log-name").textContent, li.dataset.result, li.querySelector(".print-log-settings").textContent, li.querySelector(".print-log-amount")?.textContent ?? ""]));

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: a saved print file goes into the log; failed with a problem and a note, kept through a reload; well; delete asks`, async () => {
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
    const page = await fresh(context);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
      await page.goto(url);
      await startWithBox(page, tap);
      // Nothing yet.
      await chooseFile(page, "file-print-log", tap);
      await page.waitForSelector("#print-log[open]");
      assert.equal(await page.textContent("#print-log-summary"), "No prints yet. Each time you save a print file from Slice for printing, it is added here.");
      await press("#print-log-close");
      // Slice and download: saved, and the result says it went into the log.
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      await Promise.all([page.waitForEvent("download"), press("#slice-print-go")]);
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
      assert.match(await page.textContent("#slice-print-status"), /Added to your print log: say how it printed from File, Print log….$/);
      await press("#slice-print-close");
      await chooseFile(page, "file-print-log", tap);
      await page.waitForSelector("#print-log[open]");
      const [first] = await rows(page);
      assert.deepEqual(first.slice(0, 3), ["Untitled", "waiting", "0.2 mm layers, 2 walls, 15% infill, no supports, standard nozzle"]);
      assert.match(first[3], /^About \d+(\.\d)? g, (under a minute|\d+ min|\d+ h( \d+ min)?)$/, "the weight and time the slicer worked out");
      assert.equal(await page.textContent("#print-log-summary"), "1 print: 1 not said yet.");
      const box = await page.$eval("#print-log", (d) => d.getBoundingClientRect().toJSON());
      assert.ok(box.left >= 0 && box.right <= width, `on screen: ${JSON.stringify(box)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "nothing spills sideways");
      // Failed: the list shows; pick a problem and type a note, then leave the box.
      await press(".print-log-item .print-log-failed");
      await page.selectOption(".print-log-item .print-log-problem", "warped");
      await press(".print-log-item .print-log-note-box");
      await page.keyboard.type("Corner lifted at layer 12");
      await press("#print-log-title");
      if (shots) await page.screenshot({ path: `${shots}/print-log-${width}.png` });
      await page.reload();
      await page.waitForSelector("#file-menu");
      await chooseFile(page, "file-print-log", tap);
      await page.waitForSelector("#print-log[open]");
      assert.deepEqual((await rows(page)).map((r) => r[1]), ["failed"]);
      assert.equal(await page.$eval(".print-log-problem", (s) => s.value), "warped");
      assert.equal(await page.$eval(".print-log-note-box", (t) => t.value), "Corner lifted at layer 12");
      assert.equal(await page.textContent("#print-log-summary"), "1 print: 1 failed.");
      // Printed well after all: the problem goes, the note stays.
      await press(".print-log-item .print-log-well");
      assert.equal(await page.$(".print-log-problem"), null);
      assert.equal(await page.textContent("#print-log-summary"), "1 print: 1 printed well.");
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("spindlelabs.print-log")).prints[0]);
      assert.deepEqual([stored.result, stored.problem, stored.note, stored.owner], ["well", null, "Corner lifted at layer 12", null], "kept in this browser, no account");
      // Delete asks; Keep it keeps it; Delete deletes.
      await press(".print-log-item .print-log-delete");
      assert.match(await page.textContent(".print-log-question"), /^Delete this print of “Untitled” from the log\?/);
      await press(".print-log-keep");
      assert.equal((await rows(page)).length, 1);
      await press(".print-log-item .print-log-delete");
      await press(".print-log-delete-sure");
      assert.equal((await rows(page)).length, 0);
      assert.equal(await page.textContent("#print-log-summary"), "No prints yet. Each time you save a print file from Slice for printing, it is added here.");
    } finally {
      await context.close();
    }
  });
}

await check("1280 px: another tab's change shows in an open log", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const one = await fresh(context);
  try {
    // A print put in the store as the app keeps it, so no slicing is needed for this check.
    await one.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const t = "2026-11-13T02:00:00.000Z";
      localStorage.setItem("spindlelabs.print-log", JSON.stringify({ version: 1, prints: [{ id: "00000000-0000-4000-8000-000000000001", madeAt: t, name: "Bracket", settings: "0.2 mm layers", grams: 9.5, minutes: 42, result: "waiting", problem: null, note: "", updatedAt: t, owner: null }] }));
    });
    await one.goto(url);
    await one.waitForSelector("#file-menu");
    const two = await fresh(context);
    await two.goto(url);
    await two.waitForSelector("#file-menu");
    await chooseFile(one, "file-print-log");
    await one.waitForSelector("#print-log[open]");
    assert.deepEqual(await rows(one), [["Bracket", "waiting", "0.2 mm layers", "About 9.5 g, 42 min"]]);
    await chooseFile(two, "file-print-log");
    await two.waitForSelector("#print-log[open]");
    await two.click(".print-log-item .print-log-well");
    await one.waitForFunction(() => document.querySelector(".print-log-item")?.dataset.result === "well");
  } finally {
    await context.close();
  }
});

await browser.close();
await server.close();
const unexpected = errors.filter((e) => !/WebGL|GPU stall|Failed to load resource/.test(e));
if (unexpected.length) {
  failed++;
  console.log(`not ok - page errors\n  ${unexpected.join("\n  ")}`);
}
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
