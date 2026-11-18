// Browser check of the mass in Body facts (step 66a): the default 40 × 30 × 20 box is 24,000 mm³ = 24 cm³, so in PLA
// (1.24 g/cm³) 29.76 g, shown "29.8 g"; in A36 steel (7.8 g/cm³) 187.2 g, shown "187 g". The material picked is kept in
// the browser through a reload and records no undo step (Undo stays as it was). At 1280 × 800 with the mouse and at
// 375 × 667 with taps, where the Material choice and the mass must sit inside the Properties sheet on screen.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4266, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4266/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function open(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, tap);
  return { page, context };
}

/** Presses Body facts until its numbers show (the insert may already have shown the panel, and the button toggles). */
async function showFacts(page, tap) {
  for (let i = 0; i < 2 && !(await page.isVisible("#mass")); i++) {
    if (tap) await page.tap("#inspect-facts");
    else await page.click("#inspect-facts");
    await page.waitForTimeout(300);
  }
  await page.locator("#mass").scrollIntoViewIfNeeded();
  assert.equal(await page.isVisible("#mass"), true, "Body facts shows the mass");
}

/** The element's box, checked inside the window. */
async function onScreen(page, sel, width, height) {
  const r = await page.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
  assert.ok(r.width > 0 && r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= height, `${sel} on screen at ${width} × ${height}: ${JSON.stringify(r)}`);
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    const { page, context } = await open(width, height, tap);
    try {
      await showFacts(page, tap);
      assert.equal(await page.textContent("#volume"), "24,000 mm³");
      // 24 cm³ × 1.24 g/cm³ = 29.76 g.
      assert.equal(await page.textContent("#mass"), "29.8 g", "PLA by default");
      assert.match(await page.getAttribute("#mass", "title"), /infill weighs less/);
      await onScreen(page, "#mass", width, height);
      await onScreen(page, "#mass-material", width, height);
      if (shots) await page.screenshot({ path: `${shots}/mass-pla-${width}.png` });
      const undoBefore = await page.getAttribute("#undo", "title").catch(() => null);
      await page.selectOption("#mass-material", "steel-a36");
      // 24 cm³ × 7.8 g/cm³ = 187.2 g.
      await page.waitForFunction(() => document.querySelector("#mass")?.textContent === "187 g");
      assert.equal(await page.getAttribute("#undo", "title").catch(() => null), undoBefore, "picking a material records no undo step");
      if (shots) await page.screenshot({ path: `${shots}/mass-steel-${width}.png` });
      // Kept in the browser: a reload (a new empty project, U0c) with the box again still says steel.
      await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
      await page.reload();
      await startWithBox(page, tap);
      await showFacts(page, tap);
      assert.equal(await page.inputValue("#mass-material"), "steel-a36");
      assert.equal(await page.textContent("#mass"), "187 g");
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("body-mass: ok");
} finally {
  await browser.close();
  await server.close();
}
