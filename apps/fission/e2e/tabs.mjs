// Browser check of the design tabs (tabs step 1; they are part of the home screen's switch, home.config.mjs), in a real
// Chromium. On the normal build (home screen off until released) there is no strip; `npm run e2e:tabs` builds one with the
// switch on (dist-home/, E2E_DIST names another) and checks:
// - A first visit shows one tab, "Untitled" with a DESIGN chip; "+" opens a second tab with a new empty design while the first
//   keeps its box (24,000 mm³) and comes back when chosen.
// - A tab says what it is for: after Slice is chosen in the second tab its chip reads SLICE and the first still reads DESIGN;
//   choosing a tab shows the workspace that tab was in.
// - × on a tab that is not on screen only takes it off the strip; × on the one on screen brings up its neighbour; × on the
//   last tab leaves one new empty design.
// - A reload brings the tabs back, in order, with the same one on screen.
// - At 393 px (taps) nothing runs off the side and every strip button is at least 44 px tall; screenshots (SHOTS=<dir>) at
//   1280 and 393 px in both themes.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { startWithBox } from "./start.mjs";

const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(DIST + "index.html")) throw new Error("build the app first (npm run build, or npm run e2e:tabs)");
const WITH_TABS = Boolean(process.env.E2E_DIST);
const PORT = 4618;
const server = await preview({ build: { outDir: DIST }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
let failed = 0;
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const saved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
const volume = (page, want) => until(page, (w) => document.querySelector("#volume")?.textContent === w, want, `the volume ${want}`);
const tabsOf = (page) => page.$$eval(".design-tabs-tab", (t) => t.map((x) => ({ name: x.querySelector(".design-tabs-name").textContent, kind: x.querySelector(".design-tabs-kind").textContent, on: x.dataset.active === "true" })));
const tabsAre = (page, want, what) =>
  until(
    page,
    (w) => JSON.stringify([...document.querySelectorAll(".design-tabs-tab")].map((x) => `${x.querySelector(".design-tabs-name").textContent}|${x.querySelector(".design-tabs-kind").textContent}|${x.dataset.active === "true" ? "on" : ""}`)) === JSON.stringify(w),
    want,
    what,
  );
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

async function newPage(width = 1280, touch = false, scheme = "dark") {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#design");
  return { context, page };
}
/** Past the home screen, which a build with the tabs also has. */
async function pastHome(page) {
  await page.locator("#home-close").waitFor({ state: "visible" });
  await page.click("#home-close");
  await page.locator("#home").waitFor({ state: "hidden" });
}

if (!WITH_TABS) {
  await check("the shipped build has no design tabs yet (off until released)", async () => {
    const { context, page } = await newPage();
    await page.locator("#start-hint").waitFor();
    assert.equal(await page.$("#design-tabs"), null);
    await context.close();
  });
} else {
  /** Two tabs: the first holds the box, the second is a new empty design. */
  async function two(width = 1280, touch = false, scheme = "dark") {
    const { context, page } = await newPage(width, touch, scheme);
    await pastHome(page);
    await startWithBox(page, touch);
    await saved(page);
    await press(page, "#design-tabs-add", touch);
    await tabsAre(page, ["Untitled|DESIGN|", "Untitled|DESIGN|on"], "two tabs, the new one on screen");
    await page.locator("#start-hint").waitFor();
    return { context, page };
  }

  await check("a first visit has one DESIGN tab; + opens a new design in a second tab and the first keeps its box", async () => {
    const { context, page } = await newPage();
    await pastHome(page);
    await page.locator("#start-hint").waitFor();
    assert.deepEqual(await tabsOf(page), [{ name: "Untitled", kind: "DESIGN", on: true }]);
    await context.close();
    const t = await two();
    await t.page.click(".design-tabs-tab:first-child .design-tabs-main");
    await tabsAre(t.page, ["Untitled|DESIGN|on", "Untitled|DESIGN|"], "the first tab on screen");
    await volume(t.page, "24,000 mm³");
    await t.page.click(".design-tabs-tab:last-child .design-tabs-main");
    await t.page.locator("#start-hint").waitFor();
    await t.context.close();
  });

  await check("a tab says what it is for: SLICE after Slice is chosen in the tab with the box, and choosing a tab shows the workspace it was in", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    // In the public app DESIGN ▾'s Slice opens a dialog over Design; the Slice page itself is reached by its link (#slice).
    await page.evaluate(() => (location.hash = "#slice"));
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "Slice shown");
    await tabsAre(page, ["Untitled|SLICE|on", "Untitled|DESIGN|"], "the first tab reads SLICE, the second still DESIGN");
    await page.click(".design-tabs-tab:last-child .design-tabs-main");
    await page.locator("#start-hint").waitFor();
    assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "Slice shown again for the first tab");
    await tabsAre(page, ["Untitled|SLICE|on", "Untitled|DESIGN|"], "chips unchanged after switching");
    await context.close();
  });

  await check("× takes a tab off the strip; the last one leaves a new empty design", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-close"); // not on screen: just leaves the strip
    await tabsAre(page, ["Untitled|DESIGN|on"], "one tab left");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    await page.click(".design-tabs-tab .design-tabs-close"); // the last one
    await tabsAre(page, ["Untitled|DESIGN|on"], "one new tab");
    await page.locator("#start-hint").waitFor();
    await context.close();
  });

  await check("closing the tab on screen brings up its neighbour (the box comes back)", async () => {
    const { context, page } = await two();
    await saved(page);
    await page.click(".design-tabs-tab:last-child .design-tabs-close");
    await tabsAre(page, ["Untitled|DESIGN|on"], "the first tab, on screen");
    await volume(page, "24,000 mm³");
    await context.close();
  });

  await check("a reload brings the tabs back in order, the same one on screen", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    await saved(page);
    await page.waitForTimeout(500);
    await page.reload();
    await pastHome(page);
    await volume(page, "24,000 mm³");
    await tabsAre(page, ["Untitled|DESIGN|on", "Untitled|DESIGN|"], "both tabs back");
    await context.close();
  });

  for (const [scheme, width, touch] of [["dark", 1280, false], ["light", 1280, false], ["dark", 393, true], ["light", 393, true]]) {
    await check(`${width} px ${scheme}: the strip fits, targets are big enough${touch ? " (taps)" : ""}`, async () => {
      const { context, page } = await two(width, touch, scheme);
      await press(page, ".design-tabs-tab:first-child .design-tabs-main", touch);
      await volume(page, "24,000 mm³");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "nothing runs off the side");
      const small = await page.$$eval(".design-tabs button", (b) => b.map((x) => x.getBoundingClientRect().height).filter((h) => h < (innerWidth <= 640 ? 44 : 30)));
      assert.deepEqual(small, [], "every strip button is tall enough");
      if (shots) await page.screenshot({ path: `${shots}/tabs-${width}-${scheme}.png` });
      await context.close();
    });
  }
}

await browser.close();
await server.close();
if (errors.length) {
  console.log(`page errors:\n${errors.join("\n")}`);
  failed++;
}
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
