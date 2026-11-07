// Browser check of the mouse presets (U2d): Settings shows the Mouse choice with a table of what each button and key
// does; with SpindleLabs's own preset a left drag turns the view (Orbit lit); with the Fusion-style one the left button
// only picks (no bar tool lit), the middle button pans, Shift + middle orbits, the bar's Orbit gives the left button the
// turn and pressing it again puts it away, Escape puts a lit tool away, and the choice survives a reload.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { closePanels, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4215, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4215/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;

async function fresh(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("mouse-presets-seen")) {
      sessionStorage.setItem("mouse-presets-seen", "1");
      indexedDB.deleteDatabase("fission");
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks#design`);
  await page.locator("#start-hint").waitFor();
  await startWithBox(page);
  await settle(page);
  return page;
}
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
/** Waits for the camera's damping to finish. */
async function settle(page) {
  let last = null;
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((x, k) => Math.abs(x - [...last.position, ...last.target][k]) < 1e-6)) return;
    last = now;
  }
  throw new Error("the camera never settled");
}
const moved = (a, b) => [...a.position, ...a.target].some((x, i) => Math.abs(x - [...b.position, ...b.target][i]) > 1e-3);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const forward = (c) => {
  const v = c.target.map((t, i) => t - c.position[i]);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
async function drag(page, [x, y], [dx, dy], button = "left", keys = []) {
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up({ button });
  for (const k of keys) await page.keyboard.up(k);
  await settle(page);
}
async function choosePreset(page, id) {
  await closePanels(page, false);
  await page.click("#settings-open");
  await page.waitForSelector("#settings[open]");
  await page.click(`#settings [data-mouse=${id}]`);
  await page.click("#settings .close");
  await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));
}
const lit = (page, mode) => page.getAttribute(`#view-controls [data-nav=${mode}]`, "aria-pressed");
const at = async (page) => {
  const box = await page.locator("#viewport canvas").boundingBox();
  return [box.x + 0.7 * box.width, box.y + 0.25 * box.height]; // off the body, which sits in the middle
};
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
  await check("Settings shows the Mouse choice with SpindleLabs's table; the left drag turns the view and Orbit is lit", async () => {
    const page = await fresh();
    await closePanels(page, false);
    await page.click("#settings-open");
    await page.waitForSelector("#settings[open]");
    assert.equal(await page.getAttribute("#settings [data-mouse=spindle]", "aria-checked"), "true");
    assert.equal(await page.getAttribute("#settings [data-mouse=fusion]", "aria-checked"), "false");
    assert.equal(await page.locator("#settings .settings-mouse tr").count(), 8);
    assert.equal(await page.locator("#settings .settings-mouse tr").nth(1).locator("td").textContent(), "Turns the view (orbit), unless the bar's Pan or Zoom is lit");
    if (shots) await page.screenshot({ path: `${shots}/mouse-settings-1280.png` });
    await page.click("#settings .close");
    assert.equal(await lit(page, "orbit"), "true");
    const before = await camera(page);
    await drag(page, await at(page), [80, 0]);
    assert.ok(moved(before, await camera(page)), "a left drag turned the view");
    await page.context().close();
  });

  await check("Fusion-style: the left button only picks, middle pans, Shift + middle orbits, Orbit and Escape, kept through a reload", async () => {
    const page = await fresh();
    await choosePreset(page, "fusion");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mouse), "fusion");
    assert.equal(await page.getAttribute("#viewport", "data-nav"), "select");
    for (const m of ["orbit", "pan", "zoom"]) assert.equal(await lit(page, m), "false", `${m} is not lit at rest`);
    // The table in Settings is Fusion-style's.
    await closePanels(page, false);
    await page.click("#settings-open");
    await page.waitForSelector("#settings[open]");
    assert.equal(await page.getAttribute("#settings [data-mouse=fusion]", "aria-checked"), "true");
    assert.equal(await page.locator("#settings .settings-mouse tr").nth(1).locator("td").textContent(), "Nothing, unless the bar's Orbit, Pan or Zoom is lit");
    await page.click("#settings .close");
    await page.waitForFunction(() => !document.querySelector("#settings")?.hasAttribute("open"));

    const p = await at(page);
    let before = await camera(page);
    await drag(page, p, [80, 0]);
    assert.ok(!moved(before, await camera(page)), "a left drag moves nothing");
    await drag(page, p, [80, 0], "left", ["Shift"]);
    assert.ok(!moved(before, await camera(page)), "nor with Shift");
    // Middle pans: the target moves, the direction does not.
    await drag(page, p, [60, 40], "middle");
    let after = await camera(page);
    assert.ok(moved(before, after), "the middle button pans");
    assert.ok(dot(forward(before), forward(after)) > 0.9999, "panning keeps the view's direction");
    // Shift + middle orbits.
    before = after;
    await drag(page, p, [90, 0], "middle", ["Shift"]);
    after = await camera(page);
    assert.ok(dot(forward(before), forward(after)) < 0.99, "Shift + middle turns the view");
    // The bar's Orbit gives the left button the turn; pressed again it puts it away.
    await page.click("#view-controls [data-nav=orbit]");
    assert.equal(await lit(page, "orbit"), "true");
    before = await camera(page);
    await drag(page, p, [80, 0]);
    assert.ok(dot(forward(before), forward(await camera(page))) < 0.99, "with Orbit lit a left drag turns the view");
    await page.click("#view-controls [data-nav=orbit]");
    assert.equal(await page.getAttribute("#viewport", "data-nav"), "select", "Orbit pressed again is put away");
    assert.equal(await lit(page, "orbit"), "false");
    // Escape puts a lit Pan away.
    await page.click("#view-controls [data-nav=pan]");
    assert.equal(await lit(page, "pan"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await page.getAttribute("#viewport", "data-nav"), "select", "Escape leaves Pan for the resting picker");
    assert.equal(await lit(page, "pan"), "false");
    if (shots) await page.screenshot({ path: `${shots}/mouse-fusion-1280.png` });
    // Kept through a reload.
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("spindlelabs-settings") ?? "{}").mouse === "fusion");
    await page.reload();
    await page.waitForFunction(() => document.getElementById("viewport")?.dataset.nav !== undefined);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mouse), "fusion");
    assert.equal(await page.getAttribute("#viewport", "data-nav"), "select");
    await page.context().close();
  });

  await check("a click still picks with the Fusion-style preset, and going back to SpindleLabs's own gives the left drag its turn at once", async () => {
    const page = await fresh();
    await choosePreset(page, "fusion");
    const box = await page.locator("#viewport canvas").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.match(await page.evaluate(() => document.body.dataset.selection ?? ""), /^(body|face|edge)/, "a click picked what is under it");
    await choosePreset(page, "spindle");
    assert.equal(await page.getAttribute("#viewport", "data-nav"), "orbit");
    assert.equal(await lit(page, "orbit"), "true");
    const before = await camera(page);
    await drag(page, await at(page), [80, 0]);
    assert.ok(moved(before, await camera(page)));
    await page.context().close();
  });

  await check("375 px: the Mouse table fits the Settings card, no sideways scroll", async () => {
    const page = await fresh(375);
    await closePanels(page, false);
    if (await page.locator("#menu-toggle").isVisible()) await page.click("#menu-toggle");
    await page.click("#settings-open");
    await page.waitForSelector("#settings[open]");
    const fits = await page.evaluate(() => {
      const card = document.querySelector("#settings [data-section=general]");
      const table = card.querySelector(".settings-mouse table");
      return { card: card.clientWidth, table: table.getBoundingClientRect().width, scroll: card.scrollWidth };
    });
    assert.ok(fits.table <= fits.card && fits.scroll <= fits.card, `table ${fits.table}px in a ${fits.card}px card (scroll ${fits.scroll})`);
    if (shots) await page.screenshot({ path: `${shots}/mouse-settings-375.png` });
    await page.context().close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
