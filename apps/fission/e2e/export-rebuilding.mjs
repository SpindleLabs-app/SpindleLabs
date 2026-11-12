// Browser check of SL #675 items 1 and 2 (final Combine hunt 2026-11-12), with `?combine` at 1280 px.
//
// Item 1: an export pressed while the design is still rebuilding (after Redo, or as a file opens) read the new design
// with the last rebuild's failed items, so a Combine the change made fail was taken as built: the body it would have
// used up was left out, nothing said "Combine 1 failed" and the STL was called "Checked solid". The export now waits for
// the rebuild.
// Worked by hand (`export-rebuilding.spindle`): Box 1 is 40 × 30 × 20 at the origin, 24,000 mm³. Box 2 is the same,
// moved (20, 15, 10) by Move 1: they share 20 × 15 × 10 = 3,000 mm³, which Combine 1 (Intersect) leaves as the one
// body. With Move 1 edited to X = 200 they share nothing: Combine 1 fails (red) and the design is two bodies,
// 24,000 + 24,000 = 48,000 mm³, from x 0 to 200 + 40 = 240. The bug saved 24,000 mm³ (Box 1 alone), stamped.
// `export-rebuilding-red.spindle` is that design saved with Move 1 at X = 200.
//
// Item 2: Export 3MF, Export OBJ and the Selection's Download 3MF and Download OBJ with a Move still open saved the
// part where it was. They now refuse as Export STL does (SL #639 item 1).
// Worked by hand (`export-open-move.spindle`): Box 1, 40 wide from x 0, with a notch cut by Combine 1. A Move with
// X = 30 typed shows it at x 30..70; once OK is pressed the 3MF's corners span x 30..70.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseFile } from "./start.mjs";

const PORT = 4417;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/?test-hooks&combine#design`;
const browser = await launch();
const errors = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${String(e.message ?? e).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 30000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const rebuilt = async (page) => {
  await until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false" && !window.fissionTest.historyBusy(), null, "the design rebuilt");
  await page.waitForTimeout(250);
};
const file = (name) => ({ name, mimeType: "application/json", buffer: readFileSync(new URL(`./${name}`, import.meta.url)) });

/** A fresh page; with `name`, that file opened and built. */
async function fresh(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  if (name) {
    await page.setInputFiles("#open-file", file(name));
    await until(page, () => document.querySelectorAll("#timeline li[data-item]").length > 2, null, `${name} opens`);
    await rebuilt(page);
    await pinProperties(page);
  }
  return { page, context };
}

/** A binary STL's volume: signed tetrahedra from the origin. */
function stlVolume(bytes) {
  let six = 0;
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const p = (k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i));
    const [a, b, c] = [p(0), p(1), p(2)];
    six += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return six / 6;
}
/** The least and greatest x of a file's corners, read from its own bytes (the 3MF's model part is stored uncompressed). */
function xRange(bytes, kind) {
  const xs = [];
  if (kind === "stl") for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) xs.push(bytes.readFloatLE(84 + 50 * t + 12 + 12 * k));
  else if (kind === "3mf") for (const m of bytes.toString("latin1").matchAll(/<vertex x="([^"]+)"/g)) xs.push(+m[1]);
  else for (const m of bytes.toString("utf8").matchAll(/^v (\S+) /gm)) xs.push(+m[1]);
  return [Math.min(...xs), Math.max(...xs)];
}
const note = (page) => page.evaluate(() => document.getElementById("action-note")?.textContent ?? "");
const badge = (page) => page.evaluate(() => (document.getElementById("solid-badge")?.hidden === false ? document.getElementById("solid-badge").querySelector("h2")?.textContent : null));

/** The whole design with its Combine failed: both boxes, the failure named, never "Checked solid". */
async function wholeDesign(page, download, what) {
  assert.ok(download, `${what}: a file is saved`);
  const bytes = readFileSync(await download.path());
  assert.ok(Math.abs(stlVolume(bytes) - 48000) < 1, `${what}: 24,000 + 24,000 = 48,000 mm³, got ${Math.round(stlVolume(bytes))}`);
  const [x0, x1] = xRange(bytes, "stl");
  assert.ok(Math.abs(x0) < 1e-3 && Math.abs(x1 - 240) < 1e-3, `${what}: x 0..240, got ${x0}..${x1}`);
  assert.equal(bytes.subarray(0, 80).toString("latin1").includes("checked solid"), false, `${what}: the file is not stamped checked solid`);
  await rebuilt(page);
  const said = await note(page);
  assert.match(said, /Combine 1 failed/, `${what}: the note names the failed Combine, got "${said}"`);
  assert.doesNotMatch(said, /Checked solid/, `${what}: the note never says Checked solid`);
  assert.equal(await badge(page), "Not the whole design", `${what}: the card`);
}

try {
  await check("Redo that makes Combine 1 fail, Export STL pressed in the same moment: both boxes, the failure named", async () => {
    const { page, context } = await fresh("export-rebuilding.spindle");
    await page.dblclick('#timeline li[data-item="feature-3"]'); // Move 1, Box 2's
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "Move 1 opens");
    await page.fill("#move-x", "200");
    await page.press("#move-x", "Tab");
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move's OK");
    await rebuilt(page);
    // The control: settled, the export is the whole design.
    const settled = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await page.click("#toolbar [data-op=export_stl]");
    await wholeDesign(page, await settled, "settled");
    for (let run = 1; run <= 3; run++) {
      await page.click("#undo");
      await rebuilt(page);
      const got = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
      await page.evaluate(() => (document.getElementById("redo").click(), document.querySelector("#toolbar [data-op=export_stl]").click()));
      await wholeDesign(page, await got, `run ${run}`);
    }
    await context.close();
  });

  await check("a file with a failed Combine opened, Export STL pressed as soon as its button is on: both boxes, the failure named", async () => {
    for (let run = 1; run <= 2; run++) {
      const { page, context } = await fresh(null);
      await page.evaluate(() => {
        const timer = setInterval(() => {
          const button = document.querySelector("#toolbar [data-op=export_stl]");
          if (document.querySelectorAll("#timeline li[data-item]").length > 2 && button && !button.disabled) {
            clearInterval(timer);
            button.click();
          }
        }, 1);
      });
      const got = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
      await page.setInputFiles("#open-file", file("export-rebuilding-red.spindle"));
      await wholeDesign(page, await got, `run ${run}`);
      await context.close();
    }
  });

  await check("3MF and OBJ with a Move still open save nothing and say so in the Move's panel; after OK the 3MF is where the view shows it", async () => {
    const { page, context } = await fresh("export-open-move.spindle");
    const downloads = [];
    page.on("download", (d) => downloads.push(d));
    await page.keyboard.press("m");
    await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "Move opens");
    await page.click('#browser [data-node="body-1"]');
    await page.fill("#move-x", "30");
    await page.press("#move-x", "Tab");
    await page.waitForTimeout(500);
    const routes = {
      "Export 3MF": async () => (await chooseFile(page, "file-export-mesh"), page.click("#export-choice-3mf")),
      "Export OBJ": async () => (await chooseFile(page, "file-export-mesh"), page.click("#export-choice-obj")),
      "Download 3MF": () => page.click('#properties button:has-text("Download 3MF")'),
      "Download OBJ": () => page.click('#properties button:has-text("Download OBJ")'),
    };
    for (const [name, press] of Object.entries(routes)) {
      const verb = name.replace("Download", "Export");
      await page.evaluate(() => (document.getElementById("move-error").textContent = ""));
      await press();
      const want = `Move is still open: press OK or Cancel first, then ${verb}.`;
      await until(page, (w) => (document.getElementById("move-error")?.textContent ?? "").startsWith(w), want, `${name}: the Move's panel says "${want}"`, 8000);
      await page.waitForTimeout(700); // a download would have started by now
      assert.equal(downloads.length, 0, `${name}: nothing is saved`);
      assert.equal(await page.isVisible("#move-panel"), true, `${name}: the Move stays open`);
    }
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move's OK");
    await rebuilt(page);
    for (const [kind, id] of [["3mf", "#export-choice-3mf"], ["obj", "#export-choice-obj"]]) {
      const got = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
      await chooseFile(page, "file-export-mesh");
      await page.click(id);
      const download = await got;
      assert.ok(download, `after OK the ${kind} is saved`);
      const [x0, x1] = xRange(readFileSync(await download.path()), kind);
      assert.ok(Math.abs(x0 - 30) < 1e-3 && Math.abs(x1 - 70) < 1e-3, `after OK the ${kind} spans x 30..70, got ${x0}..${x1}`);
    }
    await context.close();
  });

  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed++;
  console.log(`not ok - ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) {
  console.log(`FAILED: ${failed}`);
  process.exit(1);
}
console.log("PASS export-rebuilding");
