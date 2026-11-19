// Browser check of the public app's workspace list (Ben, 2026-11-04: "remove
// everything from that list except design and slice. everything else can
// still silently exist but shouldnt be on the public app"; and Slice showed
// greyed as "Coming soon" although slicing works). DESIGN ▾ lists Design and
// Slice only, neither greyed nor marked with a date; Slice opens Slice for
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

    await check(`${width} px: DESIGN ▾ lists Design and Slice only, neither greyed nor marked with a date; no Split`, async () => {
      const page = await fresh(width, touch);
      await page.locator("#start-hint").waitFor();
      assert.deepEqual(await rows(page, touch), [
        ["design", "DesignLab", "", false],
        ["slice", "SliceLab", "", false],
      ]);
      await press(page, "#workspace-menu");
      await shot(page, `workspace-list-${width}`);
      await page.keyboard.press("Escape");
      assert.equal(await page.$("#split-toggle"), null, "no Split: nothing else to show beside Design");
      await page.context().close();
    });

    await check(`${width} px: Slice shows the Slice page, listing the box as Body 1 on the plate`, async () => {
      const page = await fresh(width, touch);
      if (!touch) await pinProperties(page);
      await startWithBox(page, touch);
      await press(page, "#workspace-menu");
      await press(page, '#workspace-menu-menu [data-workspace="slice"]');
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "slice");
      await page.waitForFunction(() => /^1 body on the plate\./.test(document.querySelector(".slice-page-words")?.textContent ?? ""));
      assert.equal(await page.locator("#slice-print-dialog[open]").count(), 0, "no dialog: the page is the screen");
      assert.equal(await page.textContent("#workspace-menu"), "SliceLab ▾");
      await shot(page, `workspace-list-slice-${width}`);
      await page.context().close();
    });

    await check(`${width} px: Slice on an empty design shows the page saying there is nothing to print`, async () => {
      const page = await fresh(width, touch);
      await page.locator("#start-hint").waitFor();
      await press(page, "#workspace-menu");
      await press(page, '#workspace-menu-menu [data-workspace="slice"]');
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "slice");
      await page.waitForFunction(() => /^Nothing to print yet: the design has no body shown\./.test(document.querySelector(".slice-page-words")?.textContent ?? ""));
      assert.equal(await page.locator("#slice-print-dialog[open]").count(), 0);
      await page.context().close();
    });
  }

  await check("Slice from a workspace reached by its link shows the Slice page", async () => {
    const page = await fresh(1280, false);
    await pinProperties(page);
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#laser"));
    await page.waitForFunction(() => document.body.dataset.activeWorkspace === "laser");
    await page.click("#workspace-menu");
    await page.click('#workspace-menu-menu [data-workspace="slice"]');
    await page.waitForFunction(() => document.body.dataset.activeWorkspace === "slice");
    assert.equal(await page.locator(".slice-page").count() > 0, true);
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
    assert.equal(await page.textContent("#workspace-menu"), "ImageLab ▾");
    assert.equal(await page.isVisible("#image-open"), true);
    assert.deepEqual(
      (await rows(page, false)).map((r) => r[0]),
      ["design", "slice"],
      "still only Design and Slice listed",
    );
    await page.context().close();
  });

  await check("?all-workspaces (developers) lists all ten as before, with Split; Slice is the Slice page", async () => {
    const page = await fresh(1280, false, "?all-workspaces#design");
    await page.locator("#start-hint").waitFor();
    const late = "Late 2027", later = "2028";
    assert.deepEqual(await rows(page, false), [
      ["design", "DesignLab", "", false],
      ["render", "RenderLab", late, true],
      ["simulate", "TestLab", later, true],
      ["manufacture", "CNCLab", later, true],
      ["laser", "LaserLab", late, true],
      ["slice", "SliceLab", "", false],
      ["circuit", "PCBLab", later, true],
      ["vector", "VectorLab", late, true],
      ["image", "ImageLab", "", false],
      ["layout", "LayoutLab", later, true],
    ]);
    assert.equal(await page.isVisible("#split-toggle"), true);
    await page.context().close();
  });

  // Ben, 2026-11-19: on ?all TestLab still showed greyed with "2028" though its page opened.
  // ?all turns on ?testlab and ?laser, so both are listed as working, with no date; the rest stay greyed.
  for (const [width, touch] of [
    [1280, false],
    [375, true],
  ]) {
    await check(`${width} px: ?all lists TestLab and LaserLab as working (no date), the placeholders still greyed`, async () => {
      const page = await fresh(width, touch, "?all#design");
      // ?all opens on the home screen too: close it first (its Close), then the empty design's hint.
      await page.locator("#home-close").waitFor({ state: "visible" });
      await (touch ? page.tap("#home-close") : page.click("#home-close"));
      await page.locator("#start-hint").waitFor();
      const late = "Late 2027", later = "2028";
      assert.deepEqual(await rows(page, touch), [
        ["design", "DesignLab", "", false],
        ["render", "RenderLab", late, true],
        ["simulate", "TestLab", "", false],
        ["manufacture", "CNCLab", later, true],
        ["laser", "LaserLab", "", false],
        ["slice", "SliceLab", "", false],
        ["circuit", "PCBLab", later, true],
        ["vector", "VectorLab", late, true],
        ["image", "ImageLab", "", false],
        ["layout", "LayoutLab", later, true],
      ]);
      await (touch ? page.tap("#workspace-menu") : page.click("#workspace-menu"));
      await page.locator("#workspace-simulate").waitFor({ state: "visible" });
      if (shots) await page.waitForTimeout(600); // the menu's fade, for the screenshot only
      await shot(page, `workspace-list-all-${width}`);
      await (touch ? page.tap("#workspace-simulate") : page.click("#workspace-simulate"));
      // TestLab's own page, not the placeholder (at 375 px it sits in the folded Properties sheet, so attached, not seen).
      await page.locator(".testlab-page").first().waitFor({ state: "attached" });
      assert.equal(await page.getAttribute("#workspace-menu", "data-active"), "simulate");
      await page.context().close();
    });
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
