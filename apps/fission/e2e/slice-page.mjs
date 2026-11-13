// Browser check of the Slice page (Slice as its own page, step 1; slice-page.config.mjs), in a real Chromium.
// - On the normal build (the page is off until released) DESIGN ▾ > Slice still opens the dialog, and #slice shows no page.
//   `npm run e2e:slice-page` builds one with the page on (dist-slice/, E2E_DIST names another) and checks:
// - With a box in the design, the page lists "Body 1" and says "1 body on the plate."; an empty design says nothing is there.
// - Slice on the page slices the box through the registry's exact files: 100 layers, then 125 at 0.16 mm (20 / 0.16).
// - Going back to Design and adding a second body, then coming back to Slice, lists both ("2 bodies on the plate.").
// - A Combine's result (35f1f2d, behind ?combine): a file with Box 2 joined to Box 1 lists "Body 1", "1 body on the plate.", and
//   none unread; one with a bar cut in three by two slabs lists three bodies (the two pieces of one Combine each its own).
// - At 393 px nothing runs off the side; screenshots (SHOTS=<dir>) at 1280 and 393 px in both themes.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { insertPreset, startWithBox } from "./start.mjs";

const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(DIST + "index.html")) throw new Error("build the app first (npm run build, or npm run e2e:slice-page)");
const WITH_PAGE = Boolean(process.env.E2E_DIST);
const PORT = 4618;
const server = await preview({ build: { outDir: DIST }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
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
const active = (page, id) => until(page, (w) => document.body.dataset.activeWorkspace === w, id, `${id} shown`);
const plateWords = (page, want) => until(page, (w) => document.querySelector(".slice-page-words")?.textContent?.startsWith(w), want, `the plate saying "${want}"`);
const listed = (page) => page.$$eval(".slice-page-bodies li", (n) => n.map((x) => x.textContent));

async function newPage(width = 1280, touch = false, scheme = "dark") {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#design");
  return { context, page };
}

if (!WITH_PAGE) {
  await check("the shipped build has no Slice page yet: Slice for printing still opens its dialog", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "the placeholder shown");
    assert.equal(await page.locator(".slice-page").count(), 0, "no Slice page on the shipped build");
    await context.close();
  });
} else {
  await check("the page lists the box as Body 1 on the plate", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body on the plate");
    assert.deepEqual(await listed(page), ["Body 1"]);
    await context.close();
  });
  await check("Slice on the page slices the box: 100 layers on the defaults (a 20 mm box at 0.2 mm), 125 at 0.16 mm (20 / 0.16)", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body");
    await page.click("#slice-page-slice");
    await until(page, () => /^100 layers, /.test(document.querySelector(".slice-page-slice-words")?.textContent ?? ""), null, "the slice saying 100 layers", 60000);
    // Quality is the first choice: pick the Detailed 0.16 mm layers (its option label names the height).
    await page.evaluate(() => {
      const select = document.querySelector(".slice-page-print select");
      const fine = [...select.options].find((o) => o.textContent.includes("0.16"));
      select.value = fine.value;
      select.dispatchEvent(new Event("change"));
    });
    await page.click("#slice-page-slice");
    await until(page, () => /^125 layers, /.test(document.querySelector(".slice-page-slice-words")?.textContent ?? ""), null, "the slice saying 125 layers", 60000);
    if (shots) await page.screenshot({ path: `${shots}/slice-page-sliced.png` });
    await context.close();
  });
  await check("Slice and download on the page saves the box's P1S print file named as the dialog names it", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body");
    const [file] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.click("#slice-page-download")]);
    assert.equal(file.suggestedFilename(), "spindlelabs-0.2mm-2w-15pc-textured.gcode.3mf"); // the dialog's name on the same defaults (e2e/slice-print.mjs)
    await until(page, () => /^Saved .*\.gcode\.3mf: 100 layers, /.test(document.querySelector(".slice-page-slice-words")?.textContent ?? ""), null, "the words saying saved and 100 layers", 60000);
    const bytes = readFileSync(await file.path());
    assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "a zip (3MF) package");
    // The weight and cost line shows (a 40 × 30 × 20 mm box in PLA), and the file went into the print log.
    assert.match(await page.textContent(".slice-page-cost-words"), /^About \d+(\.\d)? g of PLA, A\$\d+\.\d\d, /);
    assert.match(await page.textContent(".slice-page-slice-words"), /Added to your print log\.$/);
    const logged = await page.evaluate(() => Object.keys(localStorage).filter((k) => /print/i.test(k)));
    assert.ok(logged.length > 0, `the print log is in this browser's storage: ${logged}`);
    assert.ok(bytes.length > 2000, `a real package: ${bytes.length} bytes`);
    await context.close();
  });
  await check("Preview on the page opens the print preview of the box (100 layers) and plays it, then closes back to the page", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body");
    await page.click("#slice-page-preview");
    await page.waitForSelector("#print-preview[open] #print-preview-view canvas", { timeout: 90000 });
    assert.equal(await page.getAttribute("#print-preview-layers", "max"), "100", "20 mm / 0.2 mm");
    assert.equal(await page.textContent("#print-preview-layer-words"), "Layer 100 of 100 · 20.00 mm");
    assert.match(await page.textContent("#print-preview-words"), /^100 layers, /, "the slice's own words over the view");
    // Play moves the clock on: the scrubber passes where it was set (layer 50).
    await page.$eval("#print-preview-layers", (r) => {
      r.value = "50";
      r.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = Number(await page.inputValue("#print-preview-scrub"));
    await page.selectOption("#print-preview-speed", "10");
    await page.click("#print-preview-play");
    assert.equal(await page.textContent("#print-preview-play"), "Pause");
    await until(page, (b) => Number(document.getElementById("print-preview-scrub").value) > b, before, "the time-lapse moving the clock on", 20000);
    await page.click("#print-preview-play");
    if (shots) await page.screenshot({ path: `${shots}/slice-page-preview.png` });
    await page.click("#print-preview-close");
    await page.waitForFunction(() => !document.querySelector("#print-preview[open]"), null, { timeout: 5000 });
    assert.equal(await page.locator("#slice-page-preview").isEnabled(), true);
    await context.close();
  });
  await check("an empty design says there is nothing to print", async () => {
    const { context, page } = await newPage();
    await page.locator("#start-hint").waitFor();
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "Nothing to print yet");
    assert.deepEqual(await listed(page), []);
    await context.close();
  });
  await check("a body added in Design is on the plate when coming back", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body");
    await page.evaluate(() => (location.hash = "#design"));
    await active(page, "design");
    await insertPreset(page, "cylinder");
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "2 bodies on the plate");
    assert.equal((await listed(page)).length, 2);
    await context.close();
  });
  // Made as Design's own functions make it (version 13, read as today's); the cubes' corners give each body.
  const feature = (id, type, parameters, label, dependsOn = []) => ({ id, intent: { type, parameters, summary: label }, provenance: { self: { workspace: "design", id, label }, from: [] }, dependsOn, suppressed: false });
  const MOVE = { y: -5, z: -5, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };
  const combineFile = (features, bodies) => ({
    formatVersion: 2,
    links: [],
    materials: [],
    name: "Combine on the plate",
    units: { length: "mm" },
    workspaces: { design: { version: 13, nextId: features.length + 1, profiles: [], sketches: [], timeline: { features }, bodies: bodies.map((id, k) => ({ id, number: k + 1 })), nextBody: bodies.length + 1 } },
  });
  // Box 2 (40 × 30 × 20) moved (20, 15, 10) and joined to Box 1: one body.
  const JOINED = combineFile(
    [
      feature("feature-1", "box", { width: 40, depth: 30, height: 20 }, "Box 1"),
      feature("feature-2", "box", { width: 40, depth: 30, height: 20 }, "Box 2"),
      feature("feature-3", "move", { ...MOVE, x: 20, y: 15, z: 10, bodies: ["body:feature-2"] }, "Move 1", ["feature-2"]),
      feature("feature-4", "combine", { target: "body:feature-1", tools: ["body:feature-2"], operation: "join", keepTools: false }, "Combine 1", ["feature-1", "feature-2"]),
    ],
    ["body:feature-1", "body:feature-2"],
  );
  // A bar 50 × 10 × 10 with two slabs 10 × 20 × 20 at x 10..20 and 30..40 cut from it: three pieces, x 0..10, 20..30, 40..50.
  const THREE = combineFile(
    [
      feature("feature-1", "box", { width: 50, depth: 10, height: 10 }, "Box 1"),
      feature("feature-2", "box", { width: 10, depth: 20, height: 20 }, "Box 2"),
      feature("feature-3", "box", { width: 10, depth: 20, height: 20 }, "Box 3"),
      feature("feature-4", "move", { ...MOVE, x: 10, bodies: ["body:feature-2"] }, "Move 1", ["feature-2"]),
      feature("feature-5", "move", { ...MOVE, x: 30, bodies: ["body:feature-3"] }, "Move 2", ["feature-3"]),
      feature("feature-6", "combine", { target: "body:feature-1", tools: ["body:feature-2", "body:feature-3"], operation: "cut", keepTools: false }, "Combine 1", ["feature-1", "feature-2", "feature-3"]),
    ],
    ["body:feature-1", "body:feature-2", "body:feature-3"],
  );
  for (const [name, file, words, count] of [
    ["joined", JOINED, "1 body on the plate.", 1],
    ["cut in three", THREE, "3 bodies on the plate.", 3],
  ])
    await check(`a Combine's result on the plate (${name}): ${words}, none unread`, async () => {
      const { context, page } = await newPage();
      await page.goto(url + "?combine#design");
      await page.locator("#start-hint").waitFor();
      await page.setInputFiles("#open-file", { name: "combine.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
      await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, file.workspaces.design.timeline.features.length, "the file open");
      await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
      await page.evaluate(() => (location.hash = "#slice"));
      await active(page, "slice");
      await plateWords(page, words);
      const said = await page.locator(".slice-page-words").textContent();
      assert.ok(!said.includes("could not be read"), said);
      assert.equal((await listed(page)).length, count);
      if (shots) await page.screenshot({ path: `${shots}/slice-page-combine-${count}.png` });
      await context.close();
    });
  await check("at 393 px nothing runs off the side; screenshots in both themes", async () => {
    for (const [width, touch] of [[1280, false], [393, true]]) {
      for (const scheme of ["dark", "light"]) {
        const { context, page } = await newPage(width, touch, scheme);
        await startWithBox(page, touch);
        await page.evaluate(() => (location.hash = "#slice"));
        await active(page, "slice");
        await plateWords(page, "1 body");
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${width}px ${scheme}: ${over}px runs off the side`);
        if (shots) await page.screenshot({ path: `${shots}/slice-page-${width}-${scheme}.png` });
        await context.close();
      }
    }
  });
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
