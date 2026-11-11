// Browser check of Report a bug (Ben, 2026-11-04; easier 2026-11-11):
// Settings > About > Report a bug opens the form in place of Settings, one
// optional box and Include my design ticked. With the design unticked and
// nothing typed, Open on GitHub says what is missing and opens nothing;
// ticked with nothing typed, it opens one new tab on SpindleLabs' new-issue
// page (the title naming the workspace, the body the version, screen and how
// to attach the design) and downloads the design, the project as saved.
// With words, the title is their first line. The form closes each time.
// (No report service in this build: the GitHub route.) 1280 px with a mouse and 375 px with taps (from Menu, the form on
// screen whole, its buttons finger-sized). Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4303, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4303/";
const browser = await launch();
const errors = [];
let failed = false;

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("fission");
    // The tab the form would open, kept instead (no network in the check).
    window.__opened = [];
    window.open = (u, target, features) => (window.__opened.push({ u, target, features }), null);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await page.waitForSelector("#settings-open", { state: "attached" });
  return page;
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: Settings > About > Report a bug opens a filled-in GitHub issue in a new tab with the design downloaded, and refuses an empty report`, async () => {
      const page = await fresh(width, height, tap);
      const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
      try {
        if (tap) await press("#menu-toggle");
        await press("#settings-open");
        await page.locator("#settings-report-bug").scrollIntoViewIfNeeded();
        await press("#settings-report-bug");
        assert.equal(await page.evaluate(() => document.getElementById("settings").open), false, "Settings closes");
        assert.equal(await page.evaluate(() => document.getElementById("bug-report").open), true, "the form opens");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "bug-report-what", "the first box has the keys");
        assert.equal(await page.locator("#bug-report textarea").count(), 1, "one box");
        assert.equal(await page.isChecked("#bug-report-design"), true, "the design is ticked");
        assert.equal(await page.textContent("#bug-report-go"), "Open on GitHub");
        // Nothing typed and the design unticked: refused in words, no tab.
        await press("#bug-report-design");
        await press("#bug-report-go");
        assert.equal(await page.textContent("#bug-report-status"), "Say what happened, or include your design.");
        assert.equal(await page.evaluate(() => window.__opened.length), 0);
        // On screen whole, the buttons and the tick big enough for a finger on a phone.
        const box = await page.locator("#bug-report").boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `the form at ${JSON.stringify(box)}`);
        if (tap) for (const sel of ["#bug-report-go", "#bug-report-cancel", ".bug-report-tick"]) assert.ok((await page.locator(sel).boundingBox()).height >= 44, `${sel} 44 px to tap`);
        // Ticked again, nothing typed: the issue opens and the design downloads.
        await press("#bug-report-design");
        const [download] = await Promise.all([page.waitForEvent("download"), press("#bug-report-go")]);
        assert.equal(download.suggestedFilename(), "Untitled.spindle.json");
        const saved = JSON.parse(await (await import("node:fs/promises")).readFile(await download.path(), "utf8"));
        assert.equal(typeof saved, "object", "the design is the project's JSON");
        let opened = await page.evaluate(() => window.__opened);
        assert.equal(opened.length, 1, "one tab");
        let u = new URL(opened[0].u);
        assert.equal(`${u.origin}${u.pathname}`, "https://github.com/SpindleLabs-app/SpindleLabs/issues/new");
        assert.equal(opened[0].target, "_blank");
        assert.equal(u.searchParams.get("title"), "Bug report from design");
        let body = u.searchParams.get("body");
        for (const part of ["### What happened\n\n(not given)", "- Workspace: design", `- Screen: ${width} × ${height}`, "Your design was downloaded as Untitled.spindle.json (", "KB): drag it into this issue"]) assert.ok(body.includes(part), `the body lacks ${JSON.stringify(part)}`);
        assert.equal(await page.evaluate(() => document.getElementById("bug-report").open), false, "the form closes");
        // Again with words: the title is their first line.
        if (tap) await press("#menu-toggle");
        await press("#settings-open");
        await page.locator("#settings-report-bug").scrollIntoViewIfNeeded();
        await press("#settings-report-bug");
        await page.fill("#bug-report-what", "Extrude & undo lose the sketch\nThen it came back");
        await Promise.all([page.waitForEvent("download"), press("#bug-report-go")]);
        opened = await page.evaluate(() => window.__opened);
        assert.equal(opened.length, 2, "a second tab");
        u = new URL(opened[1].u);
        assert.equal(u.searchParams.get("title"), "Bug: Extrude & undo lose the sketch");
        body = u.searchParams.get("body");
        assert.ok(body.includes("### What happened\n\nExtrude & undo lose the sketch\nThen it came back"), body.slice(0, 200));
        assert.equal(await page.evaluate(() => document.getElementById("bug-report").open), false, "the form closes");
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
console.log("all passed");
