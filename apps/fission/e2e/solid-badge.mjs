// Browser check of the export badge (Ben 2026-11-05): Download STL has the
// kernel check the saved file's own bytes. A box alone is solid: the card
// says "Checked solid" with its triangles and volume, and the file's header
// says it was checked. A cylinder inserted over it (two bodies overlapping,
// not combined, each solid alone) makes a file whose surfaces cross: the
// card says the bodies overlap and offers Combine > Join (never "Not solid",
// export hunt 2026-11-12 D), the places are drawn over the model, and the file is still saved,
// unstamped, and taps go through the card to the view. ✕ puts the card
// and the marks away; so does an edit. At 1280
// and 375 px (a tap on the phone). SHOTS=<dir> also saves screenshots.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { chooseFile, insertPreset, startWithBox, closePanels } from "./start.mjs";

const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4183/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

const header = (bytes) => bytes.subarray(0, 80).toString("latin1").trimEnd();
const badge = (page) => page.evaluate(() => {
  const el = document.getElementById("solid-badge");
  return el && !el.hidden ? { state: el.dataset.state, title: el.querySelector("h2").textContent, detail: el.querySelector(".solid-badge-detail").textContent, items: [...el.querySelectorAll("li")].map((li) => li.textContent) } : null;
});
const places = (page) => page.evaluate(() => document.querySelector("[data-overlay-places]")?.dataset.overlayPlaces ?? "");

async function exportStl(page, tap) {
  const [download] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl", tap)]);
  await page.waitForFunction(() => document.getElementById("solid-badge")?.hidden === false);
  return readFileSync(await download.path());
}

try {
  for (const width of [1280, 375]) {
    const tap = width < 700;
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, acceptDownloads: true });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await startWithBox(page, tap);
    if (tap) await closePanels(page, tap);

    await check(`a box alone exports checked solid, and its file says so (${width} px)`, async () => {
      const bytes = await exportStl(page, tap);
      // The box's 12 triangles: 80 + 4 + 12 · 50 = 684 bytes.
      assert.equal(bytes.length, 684);
      assert.equal(header(bytes), "SpindleLabs STL, checked solid: box");
      const b = await badge(page);
      assert.equal(b.state, "solid");
      assert.equal(b.title, "Checked solid");
      // 40 · 30 · 20 = 24,000 mm³ = 24 cm³.
      assert.match(b.detail, /12 triangles, 24 cm³\.$/);
      // The panel's note is never squeezed under the heading after it (a long note drew over "Parameters").
      if (!tap) assert.ok(await page.evaluate(() => document.getElementById("action-note").getBoundingClientRect().bottom <= [...document.querySelectorAll("#properties h2")].find((h) => h.textContent === "Parameters").getBoundingClientRect().top));
      assert.equal(await places(page), "");
      if (shots) await page.screenshot({ path: `${shots}/solid-${width}.png` });
    });

    await check(`✕ puts the card away (${width} px)`, async () => {
      await (tap ? page.tap("#solid-badge-close") : page.click("#solid-badge-close"));
      assert.equal(await badge(page), null);
    });

    await check(`a cylinder over the box exports as overlapping bodies, saved unstamped, its crossings marked (${width} px)`, async () => {
      await insertPreset(page, "cylinder", tap);
      if (tap) await closePanels(page, tap);
      const bytes = await exportStl(page, tap);
      assert.ok(!header(bytes).includes("checked solid"), header(bytes));
      const b = await badge(page);
      assert.equal(b.state, "touching");
      assert.equal(b.title, "The 2 bodies touch or overlap");
      assert.match(b.detail, /^Each body is solid on its own, .* Combine > Join makes them one part\.$/);
      assert.match(await places(page), /^points [1-9]/);
      // A tap on the card's middle goes through to the view under it (only ✕ takes taps), so a card left open never
      // stops the next pick.
      assert.ok(await page.evaluate(() => {
        const r = document.getElementById("solid-badge").getBoundingClientRect();
        const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return under !== null && !under.closest("#solid-badge");
      }), "the card's middle is the view's, not the card's");
      if (shots) await page.screenshot({ path: `${shots}/not-solid-${width}.png` });
    });

    await check(`an edit puts the card and its marks away (${width} px)`, async () => {
      await (tap ? page.tap("#undo") : page.click("#undo"));
      await page.waitForFunction(() => document.getElementById("solid-badge")?.hidden === true);
      // The marks go with the next frame drawn.
      await page.waitForFunction(() => !document.querySelector("[data-overlay-places]"), null, { timeout: 5000 });
    });
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.log(`FAIL no page errors\n  ${errors.join("\n  ")}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
