// Browser check of Report a bug (Ben, 2026-11-04): Settings > About >
// Report a bug opens the form in place of Settings; Open on GitHub with
// nothing typed says what is missing and opens nothing; with words it
// opens one new tab on SpindleLabs' new-issue page, the title and body
// filled in with the words, the version and the workspace, and closes the
// form. 1280 px with a mouse and 375 px with taps (from Menu, the form on
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
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
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
    await check(`${width} px${tap ? ", taps" : ""}: Settings > About > Report a bug opens a filled-in GitHub issue in a new tab, and refuses an empty report`, async () => {
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
        // Nothing typed: refused in words, no tab.
        await press("#bug-report-go");
        assert.equal(await page.textContent("#bug-report-status"), "Say what went wrong first.");
        assert.equal(await page.evaluate(() => window.__opened.length), 0);
        // On screen whole, the buttons big enough for a finger on a phone.
        const box = await page.locator("#bug-report").boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `the form at ${JSON.stringify(box)}`);
        if (tap) for (const id of ["bug-report-go", "bug-report-cancel"]) assert.ok((await page.locator(`#${id}`).boundingBox()).height >= 44, `${id} 44 px to tap`);
        await page.fill("#bug-report-what", "Extrude & undo lose the sketch");
        await page.fill("#bug-report-steps", "1. Draw a circle\n2. Extrude");
        await press("#bug-report-go");
        const opened = await page.evaluate(() => window.__opened);
        assert.equal(opened.length, 1, "one tab");
        const u = new URL(opened[0].u);
        assert.equal(`${u.origin}${u.pathname}`, "https://github.com/SpindleLabs-app/SpindleLabs/issues/new");
        assert.equal(opened[0].target, "_blank");
        assert.equal(u.searchParams.get("title"), "Bug: Extrude & undo lose the sketch");
        const body = u.searchParams.get("body");
        for (const part of ["### What went wrong\n\nExtrude & undo lose the sketch", "### Steps\n\n1. Draw a circle\n2. Extrude", "- Workspace: design", `- Screen: ${width} × ${height}`]) assert.ok(body.includes(part), `the body lacks ${JSON.stringify(part)}`);
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
