// Browser checks of the Slice for printing fixes from the slicer hunt (2026-10-31), in a page that behaves like a
// phone, Firefox or Safari (navigator.webdriver false, no save picker, so the name box asks):
//  1. the name box opens ON TOP of the Slice page (it opened behind the old dialog, unreachable, and the slice stuck on Slicing…);
//  2. the print preview gives its WebGL context back: 20 previews later the Design view still draws; closing it puts focus on Preview;
//  3. the preview shows the file that is downloaded (same time and filament as the download's words, not the plain file's);
//  4. leaving the page mid-slice drops the file (nothing downloads); coming back, the page is ready at once;
//     a result is cleared when a choice changes; an engine refusal reads as advice;
//  7. at phone width the preview still says how long and how much plastic;
//  8. a part floating above the plate (a 10 mm cube on the plate, another 20 mm up, sent to the real engine in place of the
//     design's own file) is refused with advice that fits the page, readable at both widths; supports on slice it;
//  9. (slicer hunt 2026-11-04 leftovers) the choices are off while Preview slices, so none changes under it and the preview
//     has no "earlier choices" warning; a project saved as "Garden bracket" names its print files after it, not "spindlelabs-".
// (Moved from the dialog's checks, SP5b2b.) At a desktop width with clicks and a phone's with taps. Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { preview } from "vite";
import { chosen, launch } from "./browser.mjs";
import { openSlice, pick } from "./slice-page-lib.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4197/";
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
let failed = 0;

async function check(name, fn) {
  if (!chosen(name)) return;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

/** A page like a phone's browser: not driven (webdriver false), no save picker; contexts counted; slices can be held. */
async function fresh(width, tap) {
  const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("fission");
    localStorage.setItem("spindlelabs.slice.settings-open", "open"); // the printer settings start closed; this check uses them
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    delete window.showSaveFilePicker;
    window.__ctx = [];
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) {
      const c = get.call(this, t, ...r);
      if (c && /webgl/.test(t) && !window.__ctx.includes(c)) window.__ctx.push(c);
      return c;
    };
    // Hold the kernel's slice calls for window.kernelDelay ms.
    const send = Worker.prototype.postMessage;
    // Two 10 mm cubes as a binary STL (12 triangles each): one on the plate at x 0..10, one 20 mm up at x 30..40.
    const cubes = () => {
      const faces = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]];
      const out = new DataView(new ArrayBuffer(84 + 50 * 24));
      out.setUint32(80, 24, true);
      let t = 0;
      for (const [x, z] of [[0, 0], [30, 20]]) {
        const corner = (i) => [x + (i & 1) * 10, ((i >> 1) & 1) * 10, z + ((i >> 2) & 1) * 10];
        for (const f of faces) {
          [f[0], f[2], f[1]].forEach((i, c) => corner(i).forEach((v, k) => out.setFloat32(84 + t * 50 + 12 + c * 12 + k * 4, v, true)));
          t++;
        }
      }
      return new Uint8Array(out.buffer);
    };
    Worker.prototype.postMessage = function (m, ...rest) {
      if (window.floatingParts && m && (m.op === "slice_stl" || m.op === "print_file_stl")) m = { ...m, args: [cubes(), ...m.args.slice(1)] };
      const wait = window.kernelDelay ?? 0;
      if (wait > 0 && m && (m.op === "slice_stl" || m.op === "print_file_stl")) return void setTimeout(() => send.call(this, m, ...rest), wait);
      return send.call(this, m, ...rest);
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await startWithBox(page, tap);
  return page;
}
const open = openSlice;

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: the name box is on top of the Slice page and saves under the name typed`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await open(page, tap);
      press("#slice-page-download");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      const top = await page.evaluate(() => {
        const r = document.querySelector(".save-name input").getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const ok = document.querySelector(".save-name .ok").getBoundingClientRect();
        const hitOk = document.elementFromPoint(ok.x + ok.width / 2, ok.y + ok.height / 2);
        return { input: hit?.closest(".save-name") !== null, ok: hitOk?.closest(".save-name") !== null };
      });
      assert.deepEqual(top, { input: true, ok: true }, "the box, not the page, is under the finger");
      if (shots) await page.screenshot({ path: `${shots}/slice-page-fixes-${width}-name-box.png` });
      await page.fill(".save-name input", "My box");
      const [download] = await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      assert.equal(download.suggestedFilename(), "My box.gcode.3mf");
      await page.waitForFunction(() => document.getElementById("slice-page-status")?.textContent.startsWith("Saved My box.gcode.3mf"));
    } finally {
      await page.context().close();
    }
  });

  await check(`${at}: the preview shows the file that is downloaded (the same time and plastic), and a closed preview gives its WebGL context back`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await open(page, tap);
      press("#slice-page-download");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      await page.waitForFunction(() => document.getElementById("slice-page-status")?.textContent.startsWith("Saved"));
      const saved = await page.textContent("#slice-page-status");
      const words = (s) => s.match(/(\d+ layers?, .*?filament\), about .*? of printing)/)?.[1];
      assert.ok(words(saved), saved);
      await press("#slice-page-preview");
      await page.waitForSelector("#print-preview[open]", { timeout: 60000 });
      const shown = await page.textContent("#print-preview-words");
      assert.equal(words(shown), words(saved), "the preview says what the saved file says");
      assert.equal(await page.$eval("#print-preview-words", (e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0), true, "and shows it, at any width");
      assert.match(await page.textContent("#print-preview-legend"), /Support \(none\)/);
      if (shots) await page.screenshot({ path: `${shots}/slice-page-fixes-${width}-preview.png` });
      // 20 previews: before the fix Chrome dropped the oldest WebGL context at the 17th, the Design view's.
      for (let i = 0; i < 20; i++) {
        await page.click("#print-preview-close");
        await page.waitForSelector("#print-preview", { state: "detached" });
        await press("#slice-page-preview");
        await page.waitForSelector("#print-preview[open]", { timeout: 60000 });
      }
      await page.click("#print-preview-close");
      await page.waitForSelector("#print-preview", { state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "slice-page-preview", "focus goes back to Preview, the button that opened it");
      const lost = await page.evaluate(() => {
        const c = document.querySelector("#viewport canvas");
        const x = window.__ctx.find((k) => k.canvas === c);
        return { tracked: !!x, mainLost: x ? x.isContextLost() : null, live: window.__ctx.filter((k) => !k.isContextLost()).length };
      });
      assert.equal(lost.tracked, true);
      assert.equal(lost.mainLost, false, "the Design view still draws");
      assert.ok(lost.live <= 4, `the previews' contexts were let go: ${lost.live} live`);
    } finally {
      await page.context().close();
    }
  });

  await check(`${at}: leaving the page mid-slice stops it and drops the file; back on the page it is ready at once; a changed choice clears a result`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      const downloads = [];
      page.on("download", (d) => downloads.push(d.suggestedFilename()));
      await open(page, tap);
      await page.evaluate(() => (window.kernelDelay = 2500));
      await press("#slice-page-download");
      assert.equal(await page.$eval("#slice-page-preview", (b) => b.disabled), true, "Preview is off while Slice and download runs");
      assert.equal(await page.$eval("#slice-page-walls", (b) => b.disabled), true, "and so are the choices");
      // Going to Design while it slices: the file is dropped, not saved behind the user's back (a name box or a download
      // appearing in Design), and the page is ready when it is shown again.
      await page.evaluate(() => (location.hash = "#design"));
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "design");
      await page.waitForTimeout(3500);
      assert.equal((await page.$(".save-name")) === null, true, "no name box for a dropped slice"); // (a failing assert on a handle would dump the whole page object)
      assert.deepEqual(downloads, [], "nothing downloaded");
      await open(page, tap);
      await page.waitForFunction(() => !document.getElementById("slice-page-download").disabled, null, { timeout: 5000 });
      assert.equal(await page.textContent("#slice-page-status"), "");
      // A result, then a changed choice.
      await page.evaluate(() => (window.kernelDelay = 0));
      press("#slice-page-download");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      await page.waitForFunction(() => document.getElementById("slice-page-status")?.textContent.startsWith("Saved"));
      await pick(page, "infill", "25");
      assert.equal(await page.textContent("#slice-page-status"), "", "the old result is gone");
    } finally {
      await page.context().close();
    }
  });

  await check(`${at}: the choices are off while Preview slices (so the preview never shows earlier ones); a saved project names its print files`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await open(page, tap);
      await page.evaluate(() => (window.kernelDelay = 1500));
      await press("#slice-page-preview");
      assert.equal(await page.$eval("#slice-page-walls", (s) => s.disabled), true, "no choice can change while the preview slices");
      await page.waitForSelector("#print-preview[open]", { timeout: 60000 });
      assert.equal(await page.$("#print-preview-warning"), null, "so no warning of earlier choices");
      await page.click("#print-preview-close");
      await page.waitForSelector("#print-preview", { state: "detached" });
      // Previewed again with nothing changed: the plain words.
      await page.evaluate(() => (window.kernelDelay = 0));
      // Saved as "Garden bracket" (the project itself stays "Untitled" inside): the next print file is named after it.
      await page.evaluate(() => (location.hash = "#design"));
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "design");
      await chooseFile(page, "file-save", tap);
      await page.waitForSelector(".save-name input");
      await page.fill(".save-name input", "Garden bracket");
      await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      await open(page, tap);
      press("#slice-page-download");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      assert.equal(await page.inputValue(".save-name input"), "Garden bracket-0.2mm-2w-15pc-textured");
      if (shots) await page.screenshot({ path: `${shots}/slice-page-fixes-${width}-named.png` });
    } finally {
      await page.context().close();
    }
  });

  await check(`${at}: a part floating above the plate is refused with advice, readable; supports on slice it`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await open(page, tap);
      await page.evaluate(() => (window.floatingParts = true));
      await pick(page, "supports", "Off");
      await press("#slice-page-download");
      await page.waitForFunction(() => /hangs in the air/.test(document.getElementById("slice-page-status")?.textContent ?? ""), null, { timeout: 20000 }).catch(async () => assert.fail("status: " + (await page.textContent("#slice-page-status"))));
      assert.equal(await page.textContent("#slice-page-status"), "Part of the model hangs in the air 20 mm above the plate, around (35, 5) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.");
      const fits = await page.$eval("#slice-page-status", (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1 && r.height > 0; });
      assert.equal(fits, true, "the advice fits the page");
      const seen = await page.$eval("#slice-page-status", (e) => {
        e.scrollIntoView({ block: "nearest" });
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      });
      assert.equal(seen, true, "the advice can be scrolled into view");
      if (shots) await page.screenshot({ path: `${shots}/slice-page-fixes-${width}-floating.png` });
      await pick(page, "supports", "Normal");
      await press("#slice-page-download");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
    } finally {
      await page.context().close();
    }
  });
}

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
await browser.close();
server.httpServer.close();
if (failed || errors.length) process.exit(1);
