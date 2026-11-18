// Browser check of the preview switches (@fission/core preview.ts; Ben, 2026-11-15): on the shipped build,
//   - with no switch nothing unreleased shows: no Combine, Share, Publish or Home in the menus, no tabs strip, no
//     Split, two workspaces listed (Design and Slice), Laser and Simulate their placeholders; the Slice page is on for
//     everyone (switched on 2026-11-18, SP5b1), so it shows without a switch;
//   - `?community` shows Share… and Publish to the library… in File ▾ (the server still opens them only to its testers),
//     and nothing else unreleased;
//   - `?all` shows every one: Combine in Modify ▾, Share, Publish and Home in File ▾, the home screen, the tabs strip,
//     Split, all ten workspaces, the Slice page, the Laser page and the TestLab page; remembered for the tab across a
//     reload, and `?all=off` puts it all away again;
// at 1280 px with a mouse and 375 px with taps. Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`); E2E_DIST names another build's folder.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ build: { outDir: process.env.E2E_DIST || "dist" }, preview: { port: 4941, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4941/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const until = (page, fn, arg, what, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page };
}

/** Opens `address` (after the site's root) and waits for the app: the home screen closed when it shows, then the empty design's hint. */
async function open(page, address, tap) {
  await page.goto(url + address);
  await until(page, () => !!document.getElementById("start-hint") || document.getElementById("home")?.hidden === false, null, "the app started");
  if (await page.evaluate(() => document.getElementById("home")?.hidden === false)) {
    await page.locator("#home-close").waitFor({ state: "visible" });
    await (tap ? page.tap("#home-close") : page.click("#home-close"));
  }
  await page.locator("#start-hint").waitFor();
}

/** Every id inside a menu, read with it open (opened by its button, a tap on a phone), then closed again. */
async function menuIds(page, button, menu, tap, rows = "[id]") {
  await (tap ? page.tap(button) : page.click(button));
  await until(page, (m) => document.getElementById(m) && !document.getElementById(m).hidden, menu, `${button} opens`);
  const ids = await page.$$eval(`#${menu} ${rows}`, (els) => els.map((e) => e.id || e.dataset.workspace));
  await page.keyboard.press("Escape");
  return ids;
}

/** What shows of the unreleased features. */
async function seen(page, tap) {
  const file = await menuIds(page, "#file-menu", "file-menu-menu", tap);
  const modify = await menuIds(page, "#modify-menu", "modify-menu-menu", tap);
  const workspaces = (await menuIds(page, "#workspace-menu", "workspace-menu-menu", tap, "[role=menuitem]")).length;
  return {
    combine: modify.includes("modify-menu-combine"),
    share: file.includes("file-share"),
    publish: file.includes("file-publish"),
    home: file.includes("file-home"),
    tabs: (await page.$("#design-tabs")) !== null,
    split: (await page.$("#split-toggle")) !== null,
    workspaces: workspaces === 10 ? true : workspaces === 2 ? false : `${workspaces} listed`,
  };
}

const none = { combine: false, share: false, publish: false, home: false, tabs: false, split: false, workspaces: false };

/** The page a workspace's link shows: its own page's class, or the placeholder. */
async function pageOf(page, hash, own) {
  await page.evaluate((h) => (location.hash = h), hash);
  await until(page, (o) => !!document.querySelector(`.${o}`) || !!document.querySelector(".placeholder"), own, `${hash} shown`);
  return (await page.$(`.${own}`)) !== null;
}

try {
  for (const [width, tap] of [[1280, false], [375, true]]) {
    await check(`${width} px: with no switch nothing unreleased shows`, async () => {
      const { context, page } = await fresh(width, tap);
      await open(page, "#design", tap);
      assert.deepEqual(await seen(page, tap), none);
      assert.equal(await pageOf(page, "#slice", "slice-page"), true, "the Slice page is released: it shows with no switch");
      assert.equal(await pageOf(page, "#laser", "laser-page"), false);
      assert.equal(await pageOf(page, "#simulate", "testlab-page"), false);
      await shot(page, `preview-none-${width}`);
      await context.close();
    });

    await check(`${width} px: ?community shows sharing and the library only`, async () => {
      const { context, page } = await fresh(width, tap);
      await open(page, "?community#design", tap);
      assert.deepEqual(await seen(page, tap), { ...none, share: true, publish: true });
      assert.equal(await pageOf(page, "#laser", "laser-page"), false);
      await shot(page, `preview-community-${width}`);
      await context.close();
    });

    await check(`${width} px: ?all shows every unreleased feature, kept across a reload, and ?all=off puts them away`, async () => {
      const { context, page } = await fresh(width, tap);
      await open(page, "?all#design", tap);
      const all = { combine: true, share: true, publish: true, home: true, tabs: true, split: true, workspaces: true };
      assert.deepEqual(await seen(page, tap), all);
      await shot(page, `preview-all-${width}`);
      assert.equal(await pageOf(page, "#slice", "slice-page"), true);
      assert.equal(await pageOf(page, "#laser", "laser-page"), true);
      assert.equal(await pageOf(page, "#simulate", "testlab-page"), true);
      await shot(page, `preview-all-testlab-${width}`);
      await open(page, "#design", tap); // the switch remembered for the tab
      assert.deepEqual(await seen(page, tap), all);
      await open(page, "?all=off#design", tap);
      assert.deepEqual(await seen(page, tap), none);
      await context.close();
    });
  }
  // Deliberately broken: a switch that is no switch (`?al`) must show nothing, or the checks above prove nothing.
  await check("control: a mistyped ?al shows nothing", async () => {
    const { context, page } = await fresh(1280, false);
    await open(page, "?al#design", false);
    assert.deepEqual(await seen(page, false), none);
    await context.close();
  });
  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
