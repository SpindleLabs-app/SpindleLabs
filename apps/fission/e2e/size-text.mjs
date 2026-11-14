// Browser check of issue #518 (bug hunt 2026-11-11): the Properties size boxes were number boxes, so the browser threw
// away a typed unit or decimal comma and the part was built at another size without a word ("1,5" built 15 mm, "2.5 cm"
// 2.5 mm, "25.4mm" with inches chosen 25.4 in); and a size typed key by key that ended up refused went back to its
// half-typed part (2000000 left 200000 mm, "1e7" 1 mm), not to the size from before the edit.
// Now a unit or decimal comma is read, a comma that could separate thousands is refused in words, and a refused size
// goes back to the one the box had before the edit, the part built at it again.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4362, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4362/";
const browser = await launch();
const errors = [];
let failed = false;

async function fresh(locale = "en-GB") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("size-text-seen")) {
      sessionStorage.setItem("size-text-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks#design`);
  await startWithBox(page);
  await pinProperties(page);
  return page;
}
async function chooseUnit(page, unit) {
  if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
  await page.click(`#settings [data-unit=${unit}]`);
  await page.click("#settings .close");
  await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));
}
/** Types `text` into the Width box one key at a time, as a person does, then leaves it with Tab. */
async function typeWidth(page, text) {
  await page.click("#width", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 30 });
  await page.keyboard.press("Tab");
}
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10_000 }).catch(async () => {
  const seen = await page.evaluate(() => [document.querySelector("#width").value, document.querySelector("#intent").textContent, document.querySelector("#error").textContent]);
  throw new Error(`${what}: width box, intent, error = ${JSON.stringify(seen)}`);
});
const intentIs = (page, want, what) => until(page, (w) => document.querySelector("#intent")?.textContent === w, want, what);
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  await check("the size boxes are text boxes with a decimal keypad", async () => {
    const page = await fresh();
    for (const id of ["width", "depth", "height"]) assert.deepEqual(await page.$eval(`#${id}`, (e) => [e.type, e.inputMode]), ["text", "decimal"], id);
    await page.context().close();
  });

  for (const locale of ["en-GB", "de-DE"]) {
    await check(`${locale}, millimetres: "1,5" builds 1.5 mm, "2.5 cm" 25 mm, "1in" 25.4 mm, "0,04 m" 40 mm`, async () => {
      const page = await fresh(locale);
      // Worked by hand: a decimal comma is a point (1.5, never 15); 2.5 cm × 10 = 25 mm; 1 in = 25.4 mm; 0.04 m × 1000 = 40 mm.
      for (const [typed, width] of [["1,5", "1.5"], ["2.5 cm", "25"], ["1in", "25.4"], ["0,04 m", "40"]]) {
        await typeWidth(page, typed);
        await intentIs(page, `Box: ${width} × 30 × 20 mm`, `${typed} built ${width} mm wide`);
        await until(page, () => document.querySelector("#error").textContent === "", null, `${typed}: nothing refused`);
      }
      await page.context().close();
    });
  }

  await check('inches chosen: "25.4mm" builds 25.4 mm (1 in), not 25.4 in', async () => {
    const page = await fresh();
    await chooseUnit(page, "in");
    await typeWidth(page, "25.4mm");
    // 25.4 mm = 1 in; 30 mm = 1.181 in; 20 mm = 0.787 in.
    await intentIs(page, "Box: 1 × 1.181 × 0.787 in", "25.4mm in inches");
    await chooseUnit(page, "mm");
    assert.equal(await page.inputValue("#width"), "25.4");
    await page.context().close();
  });

  await check('"1,000" could mean 1000 or 1: refused in words, and Width goes back to 40', async () => {
    const page = await fresh();
    await typeWidth(page, "1,000");
    await until(page, () => /^The width: "1,000" could mean thousands or a decimal: .* It is back to 40 mm\.$/.test(document.querySelector("#error").textContent), null, "the comma refused, saying so");
    assert.equal(await page.inputValue("#width"), "40");
    assert.equal(await page.textContent("#intent"), "Box: 40 × 30 × 20 mm");
    await page.context().close();
  });

  await check('"2.5 cx" is refused, never built as 2.5 mm', async () => {
    const page = await fresh();
    await typeWidth(page, "2.5 cx");
    await until(page, () => document.querySelector("#error").textContent === "Type the width in mm. It is back to 40 mm.", null, "an unknown unit refused");
    assert.equal(await page.inputValue("#width"), "40");
    assert.equal(await page.textContent("#intent"), "Box: 40 × 30 × 20 mm");
    await page.context().close();
  });

  await check("a too-big size typed key by key goes back to the size before the edit, not a half-typed one", async () => {
    const page = await fresh();
    const undoTitle = () => page.evaluate(() => document.getElementById("undo").title);
    const before = await undoTitle();
    // 2000000 mm is over the 1,000,000 mm (1 km) the modeller works at; 200000, typed on the way, is not, and was built.
    for (const typed of ["2000000", "1e7"]) {
      await typeWidth(page, typed);
      await until(page, () => document.querySelector("#width").value === "40", null, `${typed}: Width back to 40`);
      await intentIs(page, "Box: 40 × 30 × 20 mm", `${typed}: the box built 40 wide again`);
      await page.waitForFunction(() => document.querySelector("#volume").textContent === "24,000 mm³");
      await until(page, () => /^The width can be at most 1000000 mm \(1 km\).* It is back to 40 mm\.$/.test(document.querySelector("#error").textContent), null, `${typed}: refused, saying it is back to 40`);
      // The half-typed sizes built on the way and the way back fold into nothing: Undo still undoes what came before.
      assert.equal(await undoTitle(), before, `${typed}: no undo step left by the refused edit`);
    }
    await page.context().close();
  });

  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
