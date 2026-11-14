// Browser check of File ▾ Export 3MF or OBJ… (step 77), at 1280 px with the
// mouse and 375 px with taps: the menu lists it after Export STL (one item,
// so the menu still fits a 375 × 667 phone), it asks which format (Cancel and
// Escape save nothing), each downloads a file named for the part, the note says it was checked
// solid, and the file is right: Python's zip reader opens the 3MF (every
// CRC checked) and finds a 40 × 30 × 20 mm box in millimetres (8 corners,
// 12 triangles, volume 40 · 30 · 20 = 24,000 mm³ by the divergence
// theorem, positive only when every triangle faces out); the OBJ holds the
// same box. It is off, saying why, with nothing built. A design whose Extrude
// Cut failed (failed-hole.spindle, export-failed.mjs) exports the plain box as
// 3MF and OBJ saying Extrude 1 failed and is not in the file, the card amber
// "Not the whole design", never "Checked solid" (#640 1).
// Run with `npm run e2e` (after `npm run build`); `E2E_BROWSER` picks the engine.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { chooseFile, closePanels, fileItem, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4777, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4777/";
const browser = await launch();
const dir = mkdtempSync(join(tmpdir(), "export-3mf-"));
const errors = [];
const shots = process.env.E2E_SHOTS;
const innerHeightOf = (width) => (width < 700 ? 667 : 800);

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

/** What Python reads in the file: "<corners> <triangles> <volume>" for its one body, the 3MF's zip checked first. */
function readBack(file, kind) {
  const script = [
    "import sys, zipfile, re",
    "if sys.argv[2] == '3mf':",
    "  z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None",
    "  m = z.read('3D/3dmodel.model').decode(); assert 'unit=\"millimeter\"' in m",
    "  import xml.etree.ElementTree as ET; root = ET.fromstring(m)",
    "  assert root.tag == '{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}model', root.tag",
    "  assert 'Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"' in z.read('[Content_Types].xml').decode()",
    "  assert 'Target=\"/3D/3dmodel.model\"' in z.read('_rels/.rels').decode()",
    "  c = [tuple(map(float, v)) for v in re.findall(r'<vertex x=\"(.*?)\" y=\"(.*?)\" z=\"(.*?)\"/>', m)]",
    "  t = [tuple(map(int, v)) for v in re.findall(r'<triangle v1=\"(\\d+)\" v2=\"(\\d+)\" v3=\"(\\d+)\"/>', m)]",
    "else:",
    "  ls = [l.split() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]",
    "  c = [tuple(map(float, l[1:])) for l in ls if l[0] == 'v']",
    "  t = [tuple(int(x) - 1 for x in l[1:]) for l in ls if l[0] == 'f']",
    "v = sum(c[a][0]*(c[b][1]*c[d][2]-c[b][2]*c[d][1]) - c[a][1]*(c[b][0]*c[d][2]-c[b][2]*c[d][0]) + c[a][2]*(c[b][0]*c[d][1]-c[b][1]*c[d][0]) for a,b,d in t)/6",
    "print(len(c), len(t), f'{v:.3f}')",
  ].join("\n");
  return execFileSync("python3", ["-I", "-c", script, file, kind], { encoding: "utf8" }).trim();
}

for (const [width, tap] of [[1280, false], [375, true]]) {
  await check(`${width} px${tap ? ", taps" : ""}: Export 3MF and Export OBJ download the box, checked solid, and read back as 8 corners, 12 triangles, 24,000 mm³`, async () => {
    const context = await browser.newContext({ viewport: { width, height: innerHeightOf(width) }, hasTouch: tap, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(url);
      // Nothing built yet: both off, saying why.
      await page.locator("#start-hint").waitFor();
      assert.equal((await fileItem(page, "file-export-mesh"))[0], true, "off with no body");
      await startWithBox(page, tap);
      // The menu: the two new exports straight after Export STL.
      await (tap ? page.tap("#file-menu") : page.click("#file-menu"));
      const ids = await page.$$eval("[id^='file-export-'], #file-save-picture", (els) => els.map((e) => e.id));
      assert.deepEqual(ids.slice(0, 3), ["file-export-stl", "file-export-mesh", "file-save-picture"]);
      // Every item of the menu can be reached: Slice for printing, the last, is inside the screen (scrolled to if need be) and on top there.
      await page.waitForTimeout(600); // the sheet's opening slide
      await page.locator("#file-slice-print").scrollIntoViewIfNeeded();
      const last = await page.$eval("#file-slice-print", (b) => {
        const r = b.getBoundingClientRect();
        return { inside: r.top >= 0 && r.bottom <= innerHeight, onTop: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("#file-slice-print") !== null };
      });
      assert.deepEqual(last, { inside: true, onTop: true });
      if (shots) await page.screenshot({ path: join(shots, `export-3mf-menu-${width}.png`) });
      await (tap ? page.tap("#file-menu") : page.click("#file-menu"));
      // Cancel, then Escape: the box closes and nothing downloads.
      let downloads = 0;
      page.on("download", () => downloads++);
      await chooseFile(page, "file-export-mesh", tap);
      await page.locator("#export-choice-dialog").waitFor();
      if (shots) await page.screenshot({ path: join(shots, `export-3mf-choice-${width}.png`) });
      await (tap ? page.tap("#export-choice-cancel") : page.click("#export-choice-cancel"));
      await chooseFile(page, "file-export-mesh", tap);
      await page.locator("#export-choice-dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("#export-choice-dialog").waitFor({ state: "hidden" });
      await page.waitForTimeout(300);
      assert.equal(downloads, 0);
      for (const kind of ["3mf", "obj"]) {
        await chooseFile(page, "file-export-mesh", tap);
        // The box fits the screen with both choices in it.
        const box = await page.$eval("#export-choice-dialog", (d) => d.getBoundingClientRect().toJSON());
        assert.ok(box.left >= 0 && box.right <= width && box.bottom <= innerHeightOf(width), JSON.stringify(box));
        const [download] = await Promise.all([page.waitForEvent("download"), tap ? page.tap(`#export-choice-${kind}`) : page.click(`#export-choice-${kind}`)]);
        assert.equal(download.suggestedFilename(), `spindlelabs-box.${kind}`);
        const file = join(dir, `${width}-box.${kind}`);
        await download.saveAs(file);
        assert.equal(readBack(file, kind), "8 12 24000.000");
        await page.waitForFunction((k) => document.getElementById("action-note")?.textContent?.startsWith(`Exported spindlelabs-box.${k}. Checked solid.`), kind);
      }
      assert.match(await page.textContent("#action-note"), /OBJ files carry no units: these numbers are millimetres/);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

const holed = readFileSync(new URL("./failed-hole.spindle", import.meta.url));
for (const [width, tap] of [[1280, false], [375, true]]) {
  await check(`${width} px${tap ? ", taps" : ""}: a failed Extrude Cut is named by Export 3MF and OBJ, the card "Not the whole design", the file the plain box`, async () => {
    const context = await browser.newContext({ viewport: { width, height: innerHeightOf(width) }, hasTouch: tap, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
      await page.goto(url);
      await page.waitForSelector("#open-file", { state: "attached" });
      await page.setInputFiles("#open-file", { name: "failed-hole.spindle", mimeType: "application/octet-stream", buffer: holed });
      await page.waitForFunction(() => [...document.querySelectorAll("#timeline li[data-item]")].some((li) => li.dataset.failed === "true"), null, { timeout: 20000 });
      if (tap) await closePanels(page, tap);
      for (const [kind, name] of [["3mf", "3MF"], ["obj", "OBJ"]]) {
        await chooseFile(page, "file-export-mesh", tap);
        const [download] = await Promise.all([page.waitForEvent("download"), tap ? page.tap(`#export-choice-${kind}`) : page.click(`#export-choice-${kind}`)]);
        const file = join(dir, `${width}-holed.${kind}`);
        await download.saveAs(file);
        // The Cut is not in the file: the plain 40 × 30 × 20 box, 24,000 mm³ (the design is 24,000 − π · 25 · 10 = 23,214.6).
        assert.equal(readBack(file, kind), "8 12 24000.000");
        await page.waitForFunction(() => document.getElementById("solid-badge")?.hidden === false);
        const missing = `Extrude 1 failed, so it is not in the ${name}: the part is saved without it. Fix it in the timeline (red) to include it.`;
        await page.waitForFunction((k) => document.getElementById("action-note")?.textContent?.startsWith(`Exported spindlelabs-box.${k}.`), kind);
        const note = await page.textContent("#action-note");
        assert.ok(note.startsWith(`Exported spindlelabs-box.${kind}. ${missing} What was built is checked solid.`), note);
        assert.ok(!note.includes("Checked solid"), note);
        const b = await page.evaluate(() => {
          const el = document.getElementById("solid-badge");
          return { state: el.dataset.state, title: el.querySelector("h2").textContent };
        });
        assert.deepEqual(b, { state: "missing", title: "Not the whole design" });
        if (shots) await page.screenshot({ path: join(shots, `export-3mf-failed-${kind}-${width}.png`) });
        await (tap ? page.tap("#solid-badge-close") : page.click("#solid-badge-close"));
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
