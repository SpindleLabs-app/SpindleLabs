// Browser check of the home screen (U6b, home.config.mjs), in a real Chromium.
// - On the normal build (the home screen is off until released) there is no #home and File has no Home entry; that is all
//   it checks there. `npm run e2e:home` builds one with the screen on (dist-home/, E2E_DIST names another) and checks:
// - A first visit opens on the home screen with no card and says nothing is kept; "Back to my project" shows the empty design.
// - After three projects were kept (a box, "Bracket", "Gear Box"), a reload opens on the screen with the card "Carry on with
//   Gear Box" (the last opened), the three listed most recently used first, each with its DESIGN chip; Carry on shows the
//   project as it was (24,000 mm³).
// - Search "brack" lists only Bracket; the Design filter lists all three; a search matching nothing says so.
// - Open on Bracket opens it (body project id is its id); Rename changes its name for good (reload); an empty name is
//   refused in words; Delete asks, Keep it keeps, Delete removes it for good; the open project has no Rename or Delete.
// - New project shows the empty design; Open file… asks for a file; the guide link opens the guide; File ▾ Home brings the
//   screen back; Escape goes back to the project.
// - At 393 px with taps: nothing runs off the side, every button is 44 px tall; screenshots (SHOTS=<dir>) at 1280 and 393 px
//   in both themes.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(DIST + "index.html")) throw new Error("build the app first (npm run build, or npm run e2e:home)");
const WITH_HOME = Boolean(process.env.E2E_DIST);
const PORT = 4617;
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
const homeShown = (page) => until(page, () => { const h = document.getElementById("home"); return h && !h.hidden && document.querySelectorAll("#home-items .home-row, #home-status:not(:empty)").length > 0; }, null, "the home screen");
const homeGone = (page) => until(page, () => document.getElementById("home")?.hidden === true, null, "the home screen going");
const names = (page) => page.$$eval("#home-items .home-row-name", (n) => n.map((x) => x.textContent));
const volume = (page, want) => until(page, (w) => document.querySelector("#volume")?.textContent === w, want, `the volume ${want}`);
const openFile = (page, name, file) => page.setInputFiles("#open-file", { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });

async function newPage(width = 1280, touch = false, scheme = "dark", stored) {
  const context = stored ?? (await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 800 }, hasTouch: touch, isMobile: touch, colorScheme: scheme }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#design");
  return { context, page };
}

if (!WITH_HOME) {
  await check("the shipped build has no home screen yet (off until released)", async () => {
    const { context, page } = await newPage();
    await page.locator("#start-hint").waitFor();
    assert.equal((await page.$("#home")) === null, true);
    await page.click("#file-menu");
    assert.equal((await page.$("#file-home")) === null, true);
    await context.close();
  });
} else {
  /** A browser with three kept projects: a box, "Bracket" and "Gear Box" (the last opened). */
  async function withThree(width = 1280, touch = false, scheme = "dark") {
    const { context, page } = await newPage(width, touch, scheme);
    await homeShown(page);
    await page.click("#home-close");
    await startWithBox(page, touch);
    await saved(page);
    const [download] = await Promise.all([page.waitForEvent("download"), touch ? chooseFile(page, "file-save", true) : page.click("#save")]);
    const file = JSON.parse(readFileSync(await download.path(), "utf8"));
    for (const name of ["Bracket", "Gear Box"]) {
      await openFile(page, `${name}.spindle`, { ...file, name });
      await volume(page, "24,000 mm³");
      await saved(page);
      await page.waitForTimeout(300);
    }
    return { context, page, file };
  }
  const reload = async (page) => (await page.reload(), await homeShown(page));

  await check("a first visit opens on the home screen with nothing kept, and Back shows the empty design", async () => {
    const { context, page } = await newPage();
    await homeShown(page);
    assert.equal(await page.isHidden("#home-card"), true);
    assert.match(await page.textContent("#home-status"), /Nothing is kept in this browser yet/);
    await page.click("#home-close");
    await homeGone(page);
    await page.locator("#start-hint").waitFor();
    await context.close();
  });

  await check("kept projects: the card, the list most recent first, search, filter and carrying on", async () => {
    const { context, page } = await withThree();
    await reload(page);
    assert.match(await page.textContent("#home-card"), /Carry on with\s*Gear Box/);
    assert.deepEqual(await names(page), ["Gear Box", "Bracket", "Untitled"]);
    assert.equal(await page.$$eval("#home-items .home-chip", (c) => c.filter((x) => x.textContent === "Design").length), 3);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "home-carry-on", "keyboard focus starts on the card");
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("#home")), true, `Tab ${i + 1} stays on the home screen (or leaves the page, never into the app behind it)`);
    }
    await page.fill("#home-search", "brack");
    assert.deepEqual(await names(page), ["Bracket"]);
    await page.fill("#home-search", "zzz");
    assert.match(await page.textContent("#home-status"), /No project matches/);
    await page.fill("#home-search", "");
    await page.selectOption("#home-filter", "design");
    assert.equal((await names(page)).length, 3);
    await page.click("#home-carry-on");
    await homeGone(page);
    await volume(page, "24,000 mm³");
    await context.close();
  });

  await check("Open, Rename (refusal in words), Delete (asks first) and the open project's missing buttons", async () => {
    const { context, page } = await withThree();
    await reload(page);
    assert.equal(await page.$('#home-items .home-row[data-open="true"] .home-rename'), null);
    assert.equal(await page.$('#home-items .home-row[data-open="true"] .home-delete'), null);
    // Rename "Untitled" to "Lid"; an empty name is refused.
    const row = (n) => page.locator("#home-items .home-row", { has: page.locator(".home-row-name", { hasText: new RegExp(`^${n}$`) }) });
    await row("Untitled").locator(".home-rename").click();
    await page.fill(".home-rename-box", "");
    await page.click(".home-rename-ok");
    await until(page, () => /needs a name/.test(document.getElementById("home-status").textContent), null, "the refusal");
    await row("Untitled").locator(".home-rename").click();
    await page.fill(".home-rename-box", "Lid");
    await page.click(".home-rename-ok");
    await until(page, () => [...document.querySelectorAll(".home-row-name")].some((n) => n.textContent === "Lid"), null, "Lid");
    await reload(page);
    assert.deepEqual((await names(page)).sort(), ["Bracket", "Gear Box", "Lid"]);
    // Delete: Keep it keeps, Delete removes for good.
    await row("Bracket").locator(".home-delete").click();
    assert.match(await row("Bracket").locator(".home-row-question").textContent(), /Delete “Bracket” from this browser\? This can't be undone\./);
    await row("Bracket").locator(".home-keep").click();
    assert.equal((await names(page)).length, 3);
    await row("Bracket").locator(".home-delete").click();
    await row("Bracket").locator(".home-delete-sure").click();
    await until(page, () => document.querySelectorAll("#home-items .home-row").length === 2, null, "the delete");
    await reload(page);
    assert.deepEqual((await names(page)).sort(), ["Gear Box", "Lid"]);
    // Open Lid: it becomes the open project.
    const id = await row("Lid").getAttribute("data-id");
    await row("Lid").locator(".home-open").click();
    await homeGone(page);
    await volume(page, "24,000 mm³");
    assert.equal(await page.evaluate(() => document.body.dataset.projectId), id);
    await context.close();
  });

  await check("New project, Open file, the guide, File > Home and Escape", async () => {
    const { context, page } = await withThree();
    await reload(page);
    await page.click("#home-new");
    await homeGone(page);
    await page.locator("#start-hint").waitFor();
    await chooseFile(page, "file-home");
    await homeShown(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#home-open-file")]);
    assert.ok(chooser);
    await homeGone(page);
    await chooseFile(page, "file-home");
    await homeShown(page);
    await page.click("#home-guide");
    await homeGone(page);
    await until(page, () => document.querySelector("dialog[open]") !== null || document.getElementById("guide-open").getAttribute("aria-pressed") === "true", null, "the guide");
    await context.close();
    const second = await newPage();
    await homeShown(second.page);
    await second.page.keyboard.press("Escape");
    await homeGone(second.page);
    await second.context.close();
  });

  for (const [label, width, touch] of [["1280 px", 1280, false], ["393 px with taps", 393, true]]) {
    await check(`fits the screen at ${label}, both themes (screenshots with SHOTS)`, async () => {
      for (const scheme of ["dark", "light"]) {
        const { context, page } = await withThree(width, touch, scheme);
        await reload(page);
        const over = await page.evaluate(() => [...document.querySelectorAll("#home *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className || e.tagName));
        assert.deepEqual(over, [], "nothing runs off the side");
        if (touch) {
          const small = await page.$$eval("#home button", (b) => b.filter((x) => x.getBoundingClientRect().height < 44 && !x.classList.contains("home-link")).map((x) => x.textContent));
          assert.deepEqual(small, [], "every button is 44 px tall");
        }
        if (shots) await page.screenshot({ path: `${shots}/home-${width}-${scheme}.png` });
        await (touch ? page.tap("#home-carry-on") : page.click("#home-carry-on"));
        await homeGone(page);
        await context.close();
      }
    });
  }
}

await browser.close();
await server.close();
if (errors.length) {
  console.log("page errors:", errors);
  failed++;
}
process.exit(failed ? 1 : 0);
