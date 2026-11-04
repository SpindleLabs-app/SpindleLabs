// Browser check of the public app's workspace list (Ben, 2026-11-04: "remove
// everything from that list except design and slice. everything else can
// still silently exist but shouldnt be on the public app"; and Slice showed
// greyed as "Coming soon" although slicing works). DESIGN ▾ lists Design and
// Slice only, neither greyed nor "Coming soon"; Slice opens Slice for
// printing on the design (with a box: its dialog; on an empty design: the
// reason why there is nothing to slice, in the file message line). There is
// no Split, as there is no second workspace to put beside Design. The other
// workspaces still open by their links (#image), and `?all-workspaces`, the
// developers' switch, lists all ten as before. A picture dropped or opened
// is refused in plain words rather than opening the hidden Image. 1280 px with a mouse and
// 375 px with a finger. Screenshots go to E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { fileItem, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4273, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4273/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width, touch, at = "#design") {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + at);
  return page;
}

/** The menu's rows as [data-workspace, name, note, greyed (aria-disabled or data-soon)], read with it open, then closed again. */
async function rows(page, tap) {
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  await press("#workspace-menu");
  const listed = await page.$$eval("#workspace-menu-menu [role=menuitem]", (ts) =>
    ts.map((t) => [t.dataset.workspace, t.querySelector(".menu-button-name").textContent, t.querySelector(".menu-button-note")?.textContent ?? "", t.getAttribute("aria-disabled") === "true" || "soon" in t.dataset]),
  );
  await page.keyboard.press("Escape");
  return listed;
}

const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, touch] of [
    [1280, false],
    [375, true],
  ]) {
    const press = (page, sel) => (touch ? page.tap(sel) : page.click(sel));

    await check(`${width} px: DESIGN ▾ lists Design and Slice only, neither greyed nor "Coming soon"; no Split`, async () => {
      const page = await fresh(width, touch);
      await page.locator("#start-hint").waitFor();
      assert.deepEqual(await rows(page, touch), [
        ["design", "Design", "", false],
        ["slice", "Slice", "", false],
      ]);
      await press(page, "#workspace-menu");
      await shot(page, `workspace-list-${width}`);
      await page.keyboard.press("Escape");
      assert.equal(await page.$("#split-toggle"), null, "no Split: nothing else to show beside Design");
      await page.context().close();
    });

    await check(`${width} px: Slice opens Slice for printing on the box, staying in Design`, async () => {
      const page = await fresh(width, touch);
      if (!touch) await pinProperties(page);
      await startWithBox(page, touch);
      await press(page, "#workspace-menu");
      await press(page, '#workspace-menu-menu [data-workspace="slice"]');
      await page.waitForSelector("#slice-print-dialog[open]");
      assert.equal(await page.$eval("body", (b) => b.dataset.activeWorkspace), "design", "Design stays on screen under the dialog");
      assert.equal(await page.textContent("#workspace-menu"), "Design ▾");
      await shot(page, `workspace-list-slice-${width}`);
      await press(page, "#slice-print-close");
      assert.equal(await page.$eval("#slice-print-dialog", (d) => d.open), false);
      await page.context().close();
    });

    await check(`${width} px: Slice on an empty design says there is nothing to slice, and opens no dialog`, async () => {
      const page = await fresh(width, touch);
      await page.locator("#start-hint").waitFor();
      await press(page, "#workspace-menu");
      await press(page, '#workspace-menu-menu [data-workspace="slice"]');
      await page.waitForFunction(() => document.querySelector("#file-status")?.textContent !== "");
      assert.match(await page.textContent("#file-status"), /^There is no body to (download|slice)/);
      assert.equal(await page.$eval("#slice-print-dialog", (d) => d.open), false);
      assert.equal(await page.$eval("body", (b) => b.dataset.activeWorkspace), "design");
      await page.context().close();
    });
  }

  await check("Slice from a workspace reached by its link goes back to Design and opens Slice for printing", async () => {
    const page = await fresh(1280, false);
    await pinProperties(page);
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#laser"));
    await page.waitForFunction(() => document.body.dataset.activeWorkspace === "laser");
    await page.click("#workspace-menu");
    await page.click('#workspace-menu-menu [data-workspace="slice"]');
    await page.waitForSelector("#slice-print-dialog[open]");
    assert.equal(await page.$eval("body", (b) => b.dataset.activeWorkspace), "design");
    await page.context().close();
  });

  await check("a PNG dropped on the view is refused in plain words, naming no hidden workspace, and Open offers no images", async () => {
    const page = await fresh(1280, false);
    await page.locator("#start-hint").waitFor();
    // The 8 bytes every PNG starts with and an IHDR chunk's start: enough to be identified as one (the file is refused before it is read).
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
    const taken = await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "logo.png"));
      const el = document.querySelector("#viewport");
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const d = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(d);
      return d.defaultPrevented;
    }, bytes);
    assert.equal(taken, true, "the drop is taken (not left to the browser, which would leave the app)");
    await page.waitForFunction(() => document.querySelector("#file-status")?.textContent !== "");
    assert.equal(await page.textContent("#file-status"), "Couldn't open “logo.png”: SpindleLabs can't open PNG images yet.");
    assert.equal(await page.$eval("body", (b) => b.dataset.activeWorkspace), "design", "still in Design, not Image");
    const accept = (await page.getAttribute("#open-file", "accept")).split(",");
    assert.deepEqual(accept, [".spindle", ".json"], "Open offers projects only");
    assert.deepEqual(await fileItem(page, "open"), [false, "Open SpindleLabs projects (.spindle)"]);
    await page.context().close();
  });

  await check("the other workspaces still open by their links, unlisted: #image shows Image, named on the button", async () => {
    const page = await fresh(1280, false, "#image");
    await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image");
    assert.equal(await page.textContent("#workspace-menu"), "Image ▾");
    assert.equal(await page.isVisible("#image-open"), true);
    assert.deepEqual(
      (await rows(page, false)).map((r) => r[0]),
      ["design", "slice"],
      "still only Design and Slice listed",
    );
    await page.context().close();
  });

  await check("?all-workspaces (developers) lists all ten as before, with Split; Slice still opens Slice for printing", async () => {
    const page = await fresh(1280, false, "?all-workspaces#design");
    await page.locator("#start-hint").waitFor();
    const soon = "Coming soon";
    assert.deepEqual(await rows(page, false), [
      ["design", "Design", "", false],
      ["render", "Render", soon, true],
      ["simulate", "Simulate", soon, true],
      ["manufacture", "Manufacture", soon, true],
      ["laser", "Laser", soon, true],
      ["slice", "Slice", "", false],
      ["circuit", "Circuit", soon, true],
      ["vector", "Vector", soon, true],
      ["image", "Image", "", false],
      ["layout", "Layout", soon, true],
    ]);
    assert.equal(await page.isVisible("#split-toggle"), true);
    await page.context().close();
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
