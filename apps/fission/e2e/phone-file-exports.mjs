// Browser check of the phone File sheet's exports (SL #648 item 2, phone hunt 2026-11-12): at phone width File ▾ is a bottom
// sheet capped at 34% of the window (phone-sheet.css, Ben's rule that one tap never covers most of the view), and its
// exports came after the nine project items (New, Open…, Projects in this browser…, Earlier versions…, My designs…, Save,
// Save As…), so Export STL, Save picture and Slice for printing sat below the sheet's fold until scrolled to. On a phone the
// exports now come first (file-menu.ts): each is wholly inside the sheet as it opens, unscrolled, and on top at its middle,
// and a tap on Export STL downloads the box's STL. The project items still follow, each reachable by scrolling. At 320 × 568,
// 375 × 667, 393 × 852 and 430 × 932 with taps; at 1280 px the menu keeps its order, project items first. Screenshots go to
// E2E_SHOTS when set. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4893, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4893/#design";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n${e.stack}`);
  }
}

async function open(width, height, phone) {
  const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { hasTouch: true, isMobile: true } : {}), acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, phone);
  return { page, context };
}

/** Each item of the open File menu, in order: its words, whether it lies wholly inside the sheet's shown part without
 * scrolling, and whether a tap at its middle lands on it. */
const items = (page) =>
  page.evaluate(() => {
    const menu = document.getElementById("file-menu").closest(".menu-button").querySelector(".menu-button-menu");
    menu.scrollTop = 0;
    const m = menu.getBoundingClientRect();
    return [...menu.querySelectorAll(".menu-button-item")].map((item) => {
      const r = item.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { name: item.querySelector(".menu-button-name")?.textContent.trim() ?? item.textContent.trim(), shown: r.top >= m.top - 0.5 && r.bottom <= m.bottom + 0.5 && r.bottom <= innerHeight, onTop: !!hit && item.contains(hit) };
    });
  });
const EXPORTS = ["Export STL", "Export 3MF or OBJ…", "Save picture (PNG)", "Slice for printing"];

for (const [width, height] of [[320, 568], [375, 667], [393, 852], [430, 932]]) {
  await check(`${width} × ${height}: File's exports in sight as the sheet opens, before the project items; Export STL downloads the box`, async () => {
    const { page, context } = await open(width, height, true);
    await page.tap("#file-menu");
    await page.waitForSelector("#file-menu[aria-expanded=true]");
    const list = await items(page);
    for (const name of EXPORTS) {
      const it = list.find((i) => i.name === name);
      assert.ok(it, `${name} is in File (${list.map((i) => i.name).join(", ")})`);
      assert.ok(it.shown && it.onTop, `${name} is in sight and on top without scrolling (${JSON.stringify(it)})`);
    }
    const first = list.findIndex((i) => EXPORTS.includes(i.name));
    assert.equal(first, 0, "the exports come first");
    assert.deepEqual(list.slice(EXPORTS.length).map((i) => i.name).slice(0, 2), ["New", "Open…"], "then the project items, New and Open… first");
    if (shots) await page.screenshot({ path: `${shots}/phone-file-exports-${width}.png` });
    const download = page.waitForEvent("download");
    await page.tap("#file-export-stl");
    const file = await download;
    assert.match(file.suggestedFilename(), /\.stl$/i, "an STL file");
    await context.close();
  });
}

await check("1280 px: File keeps its order, the project items first and the exports after", async () => {
  const { page, context } = await open(1280, 800, false);
  await page.click("#file-menu");
  await page.waitForSelector("#file-menu[aria-expanded=true]");
  const names = (await items(page)).map((i) => i.name);
  assert.equal(names[0], "New");
  assert.ok(names.indexOf("Export STL") > names.indexOf("Save"), `Export STL after Save (${names.join(", ")})`);
  await context.close();
});

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
