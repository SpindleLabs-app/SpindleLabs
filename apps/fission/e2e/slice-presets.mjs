// Browser check of the slicer's printer presets (slice-presets.ts, Ben 2026-11-04): with the 40 × 30 × 20 mm box
// built, Slice for printing's Preset list starts on No preset; the settings changed and saved as "home P1S" are kept
// in this browser's storage; another set saved as "work P2S"; picking each puts its settings back, and the file
// downloaded is named by them (so the slice used them); Update, Rename and Delete (asked first) change what is kept;
// and after a reload of the page the dialog opens on the preset picked last, with its settings. The bar shares the
// heading's line at a desktop width (the dialog grows no taller) and every control in it is on screen at a phone's.
// At a desktop width with clicks and a phone's with taps. Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4190, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4190/";
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

const KEY = "spindlelabs.slice.presets";

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: save two presets, pick each (its file named by its settings), update, rename, delete, and open on the last one picked after a reload`, async () => {
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
    const page = await context.newPage();
    // A new design each load; the browser's other storage (the presets) is kept across the reload.
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    const open = async () => {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
    };
    const list = () => page.$$eval("#slice-presets-list option", (os) => os.map((o) => o.textContent));
    const shown = () => page.$$eval("#slice-print-dialog .slice-print-choices select, #slice-print-dialog .slice-print-choices input", (es) => es.map((e) => (e.type === "checkbox" ? e.checked : e.value)));
    const kept = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
    const status = () => page.textContent("#slice-print-status");
    const name = async (text) => {
      await page.fill("#slice-presets-name", text);
      await press("#slice-presets-name-ok");
    };
    const download = async () => {
      const [d] = await Promise.all([page.waitForEvent("download"), press("#slice-print-go")]);
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
      return d.suggestedFilename();
    };
    try {
      await page.goto(url);
      await startWithBox(page, tap);
      await open();
      assert.deepEqual(await list(), ["No preset"]);
      assert.equal(await page.$eval("#slice-presets-edit", (b) => b.disabled), true, "Edit is off with no preset");
      // The bar is on screen, and at a desktop width on the heading's line.
      for (const id of ["slice-presets-list", "slice-presets-save-as", "slice-presets-edit"]) {
        const r = await page.$eval(`#${id}`, (e) => e.getBoundingClientRect().toJSON());
        assert.ok(r.left >= 0 && r.right <= width && r.top >= 0, `${id} on screen: ${JSON.stringify(r)}`);
      }
      if (!tap) {
        const [h, l] = await Promise.all(["#slice-print-heading", "#slice-presets-list"].map((s) => page.$eval(s, (e) => e.getBoundingClientRect().toJSON())));
        assert.ok(Math.abs(h.top + h.height / 2 - (l.top + l.height / 2)) < 4, `the list beside the heading: ${JSON.stringify([h, l])}`);
      }
      if (shots) await page.screenshot({ path: `${shots}/presets-${width}-none.png` });

      // home P1S: 0.16 mm, 3 walls, 25 %, the smooth plate.
      await page.selectOption("#slice-print-quality", "0.16");
      await page.selectOption("#slice-print-walls", "3");
      await page.selectOption("#slice-print-infill", "25");
      await page.selectOption("#slice-print-plate", "smooth");
      await press("#slice-presets-save-as");
      if (shots) await page.screenshot({ path: `${shots}/presets-${width}-naming.png` });
      await name("home P1S");
      assert.equal(await status(), "Saved the preset home P1S.");
      assert.deepEqual(await list(), ["No preset", "home P1S"]);
      const home = (await kept()).presets[0];
      assert.deepEqual(home.settings, { layerHeight: 0.16, walls: 3, infill: 25, supports: "off", warmUp: true, betterGrip: false, format: "p1s", plate: "smooth", nozzle: "standard" });
      assert.equal(home.printer, "bambu-p1s");

      // work P2S: Fast, tree supports, Better grip, the textured plate. A repeated name is refused first.
      await page.selectOption("#slice-print-quality", "0.28");
      await page.selectOption("#slice-print-supports", "tree");
      await page.selectOption("#slice-print-plate", "textured");
      await press("#slice-print-grip");
      assert.deepEqual(await list(), ["No preset", "home P1S (changed)"]);
      await press("#slice-presets-save-as");
      await name("Home p1s");
      assert.match(await status(), /^There is already a preset called home P1S/);
      await name("work P2S");
      assert.deepEqual(await list(), ["No preset", "home P1S", "work P2S"]);
      const work = (await kept()).presets.find((p) => p.name === "work P2S");
      if (shots) await page.screenshot({ path: `${shots}/presets-${width}-saved.png` });

      // Picking home puts its settings back, and Slice and download uses them.
      await page.selectOption("#slice-presets-list", home.id);
      assert.deepEqual(await shown(), ["p1s", "smooth", "standard", "0.16", "3", "25", "off", true, false]);
      assert.equal(await download(), "spindlelabs-0.16mm-3w-25pc-smooth.gcode.3mf");
      await page.selectOption("#slice-presets-list", work.id);
      assert.deepEqual(await shown(), ["p1s", "textured", "standard", "0.28", "3", "25", "tree", true, true]);
      assert.equal(await download(), "spindlelabs-0.28mm-3w-25pc-tree-supports-grip-textured.gcode.3mf");

      // Update work with 40 % infill.
      await page.selectOption("#slice-print-infill", "40");
      await press("#slice-presets-edit");
      if (shots) await page.screenshot({ path: `${shots}/presets-${width}-edit.png` });
      await press("#slice-presets-update");
      assert.equal(await status(), "Updated the preset work P2S with these settings.");
      assert.equal((await kept()).presets.find((p) => p.id === work.id).settings.infill, 40);
      // Rename it.
      await press("#slice-presets-edit");
      await press("#slice-presets-rename");
      await name("garage P1S");
      assert.deepEqual(await list(), ["No preset", "garage P1S", "home P1S"]);

      // A reload: the dialog opens on garage P1S, with its settings.
      await page.reload();
      await startWithBox(page, tap);
      await open();
      assert.equal(await page.$eval("#slice-presets-list", (s) => s.value), work.id);
      assert.deepEqual(await list(), ["No preset", "garage P1S", "home P1S"]);
      assert.deepEqual(await shown(), ["p1s", "textured", "standard", "0.28", "3", "40", "tree", true, true]);
      if (shots) await page.screenshot({ path: `${shots}/presets-${width}-reloaded.png` });

      // Delete it: asked first (Keep keeps it), then gone; the settings stay.
      await press("#slice-presets-edit");
      await press("#slice-presets-delete");
      assert.equal(await page.textContent("#slice-presets-ask"), "Delete garage P1S?");
      if (shots) await page.screenshot({ path: `${shots}/presets-${width}-delete-ask.png` });
      await press("#slice-presets-delete-no");
      assert.equal((await kept()).presets.length, 2);
      await press("#slice-presets-delete");
      await press("#slice-presets-delete-yes");
      assert.deepEqual(await list(), ["No preset", "home P1S"]);
      assert.deepEqual((await kept()).presets.map((p) => p.name), ["home P1S"]);
      assert.deepEqual(await shown(), ["p1s", "textured", "standard", "0.28", "3", "40", "tree", true, true]);
      // Escape in the name box leaves naming, not the dialog.
      await press("#slice-presets-save-as");
      await page.press("#slice-presets-name", "Escape");
      assert.equal(await page.$eval("#slice-print-dialog", (d) => d.open), true, "the dialog stays open");
      assert.equal(await page.$eval("#slice-presets-list", (s) => s.checkVisibility()), true, "back on the list");
    } finally {
      await context.close();
    }
  });
}

await browser.close();
await server.close();
if (errors.length) {
  failed++;
  console.log(`not ok - page errors:\n  ${errors.join("\n  ")}`);
}
if (failed) process.exit(1);
