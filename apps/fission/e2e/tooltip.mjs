// Browser check of the instant tooltips and quick info (Ben, 2026-11-04). A mouse over a toolbar icon shows a
// box in the app's look at once (not after the browser's second), with the browser's own tooltip held back; the
// box follows the theme (light and dark); a right-click on an icon opens the quick info with the whole title, and
// Escape closes it; a right-click on the 3D view still opens the body menu with no tooltip; a finger shows no
// hover box. Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4201, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4201/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

async function fresh(scheme, { width = 1280, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await pinProperties(page);
  await startWithBox(page, touch);
  await sheetsClearFor(page);
  return page;
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
const box = (page) => page.locator("#tooltip");

for (const scheme of ["dark", "light"]) {
  await check(`${scheme}: hover shows the box at once, in the theme, with the browser's own tooltip held back`, async () => {
    const page = await fresh(scheme);
    const title = await page.getAttribute("#extrude", "title");
    assert.ok(title && title.includes(": "), `Extrude has a title with a name and words: ${title}`);
    await page.hover("#extrude");
    // Within one frame or two: far under the browser's own second.
    await page.waitForSelector("#tooltip:not([hidden])", { timeout: 300 });
    assert.equal(await page.getAttribute("#extrude", "title"), null, "the browser's tooltip would show too");
    assert.equal(await box(page).locator(".words").textContent(), "Extrude");
    // The box wears the theme: its background is the surface token, its text the text token.
    const [bg, surface, fg, text] = await page.evaluate(() => {
      const paint = (prop, value) => {
        const d = document.createElement("div");
        d.style[prop] = value;
        document.body.append(d);
        const c = getComputedStyle(d)[prop];
        d.remove();
        return c;
      };
      const cs = getComputedStyle(document.getElementById("tooltip"));
      return [cs.backgroundColor, paint("backgroundColor", "var(--surface)"), cs.color, paint("color", "var(--text)")];
    });
    assert.equal(bg, surface);
    assert.equal(fg, text);
    // On screen, under the icon.
    const [t, i] = await Promise.all([box(page).boundingBox(), page.locator("#extrude").boundingBox()]);
    assert.ok(t.y >= i.y + i.height - 1 || t.y + t.height <= i.y + 1, "not over the icon");
    assert.ok(t.x >= 0 && t.x + t.width <= 1280, "inside the page");
    if (shots) await page.screenshot({ path: `${shots}/tooltip-${scheme}.png` });
    await page.mouse.move(5, 400);
    await page.waitForSelector("#tooltip", { state: "hidden", timeout: 300 });
    assert.equal(await page.getAttribute("#extrude", "title"), title, "the title comes back");
    await page.context().close();
  });

  await check(`${scheme}: right-click on an icon opens the quick info, Escape closes it`, async () => {
    const page = await fresh(scheme);
    const title = await page.getAttribute("#extrude", "title");
    await page.click("#extrude", { button: "right" });
    await page.waitForSelector("#tooltip.pinned");
    assert.equal(await box(page).locator(".words").textContent(), title);
    if (shots) await page.screenshot({ path: `${shots}/quick-info-${scheme}.png` });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#tooltip", { state: "hidden" });
    assert.equal(await page.getAttribute("#extrude", "title"), title);
    // Moving the mouse away from the pinned box does not close it; a click elsewhere does.
    await page.click("#extrude", { button: "right" });
    await page.mouse.move(600, 400);
    assert.equal(await box(page).isVisible(), true);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForSelector("#tooltip", { state: "hidden" });
    await page.context().close();
  });
}

await check("a right-click on the body in the 3D view still opens its own menu, with no tooltip", async () => {
  const page = await fresh("dark");
  const v = page.viewportSize();
  await page.mouse.click(v.width / 2, v.height / 2, { button: "right" });
  await page.waitForTimeout(400);
  assert.equal(await box(page).isVisible(), false);
  assert.ok((await page.locator("[role=menu]:visible").count()) >= 1, "the body menu opened");
  await page.context().close();
});

await check("a right-click on a text field keeps the browser's menu and shows no quick info", async () => {
  const page = await fresh("dark");
  const field = page.locator("input:visible").first();
  if (await field.count()) {
    await field.click({ button: "right" });
    assert.equal(await box(page).isVisible(), false);
  }
  await page.context().close();
});

await check("375 px with a finger: a tap shows no hover box", async () => {
  const page = await fresh("dark", { width: 375, touch: true });
  const target = page.locator("button[title]:visible").first();
  await target.tap();
  await page.waitForTimeout(300);
  assert.equal(await box(page).isVisible(), false);
  await page.context().close();
});

await browser.close();
await server.close();
if (errors.length) {
  console.log("page errors:", errors.slice(0, 5));
  failed = true;
}
process.exit(failed ? 1 : 0);
