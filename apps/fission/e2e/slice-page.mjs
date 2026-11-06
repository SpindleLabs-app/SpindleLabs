// Browser check of the Slice page (Slice as its own page, step 1; slice-page.config.mjs), in a real Chromium.
// - On the normal build (the page is off until released) DESIGN ▾ > Slice still opens the dialog, and #slice shows no page.
//   `npm run e2e:slice-page` builds one with the page on (dist-slice/, E2E_DIST names another) and checks:
// - With a box in the design, the page lists "Body 1" and says "1 body on the plate."; an empty design says nothing is there.
// - Going back to Design and adding a second body, then coming back to Slice, lists both ("2 bodies on the plate.").
// - At 393 px nothing runs off the side; screenshots (SHOTS=<dir>) at 1280 and 393 px in both themes.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { insertPreset, startWithBox } from "./start.mjs";

const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(DIST + "index.html")) throw new Error("build the app first (npm run build, or npm run e2e:slice-page)");
const WITH_PAGE = Boolean(process.env.E2E_DIST);
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
const active = (page, id) => until(page, (w) => document.body.dataset.activeWorkspace === w, id, `${id} shown`);
const plateWords = (page, want) => until(page, (w) => document.querySelector(".slice-page-words")?.textContent?.startsWith(w), want, `the plate saying "${want}"`);
const listed = (page) => page.$$eval(".slice-page-bodies li", (n) => n.map((x) => x.textContent));

async function newPage(width = 1280, touch = false, scheme = "dark") {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#design");
  return { context, page };
}

if (!WITH_PAGE) {
  await check("the shipped build has no Slice page yet: Slice for printing still opens its dialog", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "the placeholder shown");
    assert.equal(await page.locator(".slice-page").count(), 0, "no Slice page on the shipped build");
    await context.close();
  });
} else {
  await check("the page lists the box as Body 1 on the plate", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body on the plate");
    assert.deepEqual(await listed(page), ["Body 1"]);
    await context.close();
  });
  await check("an empty design says there is nothing to print", async () => {
    const { context, page } = await newPage();
    await page.locator("#start-hint").waitFor();
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "Nothing to print yet");
    assert.deepEqual(await listed(page), []);
    await context.close();
  });
  await check("a body added in Design is on the plate when coming back", async () => {
    const { context, page } = await newPage();
    await startWithBox(page);
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "1 body");
    await page.evaluate(() => (location.hash = "#design"));
    await active(page, "design");
    await insertPreset(page, "cylinder");
    await page.evaluate(() => (location.hash = "#slice"));
    await active(page, "slice");
    await plateWords(page, "2 bodies on the plate");
    assert.equal((await listed(page)).length, 2);
    await context.close();
  });
  await check("at 393 px nothing runs off the side; screenshots in both themes", async () => {
    for (const [width, touch] of [[1280, false], [393, true]]) {
      for (const scheme of ["dark", "light"]) {
        const { context, page } = await newPage(width, touch, scheme);
        await startWithBox(page, touch);
        await page.evaluate(() => (location.hash = "#slice"));
        await active(page, "slice");
        await plateWords(page, "1 body");
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${width}px ${scheme}: ${over}px runs off the side`);
        if (shots) await page.screenshot({ path: `${shots}/slice-page-${width}-${scheme}.png` });
        await context.close();
      }
    }
  });
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
