// Browser check of the build with offline mode OFF for everyone
// (offline.config.mjs), the one that ships until offline mode is released:
// - No service worker is registered and nothing is cached, and the page has
//   no manifest link, so the browser offers no install.
// - A browser that chooses offline with `?offline` (Ben, 2026-11-13: for a
//   school web filter) gets the offline worker and the manifest link, says
//   so once, opens with no network after (the address without the switch,
//   as an installed app opens), says it is offline there, and `?offline=off`
//   removes everything again. The full offline checks run on this build too
//   with offline chosen (e2e/offline.mjs).
// - A browser that already has the old worker (a copy of the build with the
//   real offline worker, installed and caching, controlling the page) is
//   cleaned: on the next load the worker is gone, its caches are gone, and
//   the page was reloaded once. Without the page's own help, the worker the
//   site now serves as sw.js (the clean-up worker) does the same when the
//   browser looks for an update.
// Needs the normal build (`npm run build`); `npm run e2e:offline` checks the
// build with offline mode on (e2e/offline.mjs).
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { writeServiceWorker } from "../offline.mjs";

// E2E_DIST names another normal build (a private one, as for e2e/offline.mjs).
const DIST = fileURLToPath(new URL(process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : "../dist/", import.meta.url));
if (!existsSync(join(DIST, "sw.js"))) throw new Error("build the app first (npm run build): dist/sw.js is missing");
if (/<link rel="manifest"/.test(readFileSync(join(DIST, "index.html"), "utf8"))) {
  console.log("offline-off: skipped, this build has offline mode on");
  process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), "offline-off-e2e-"));
const KILL = readFileSync(join(DIST, "sw.js"), "utf8");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const site = { root: DIST, server: null, port: 4241 };
function startServer() {
  site.server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(site.root, path.endsWith("/") ? path + "index.html" : path);
    if (!file.startsWith(site.root) || !existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });
  return new Promise((done) => site.server.listen(site.port, "127.0.0.1", done));
}
const app = `http://127.0.0.1:${site.port}/`;

// Driven by Playwright, the full Chromium a sandbox has (/opt/pw-browsers/chromium,
// new headless) holds every service worker update of this app back about 90 s
// (the same Chromium on its own, no Playwright: 13 ms; a page without the app
// script: no hold), so here the checks use its headless shell, the Chromium
// Playwright itself starts headless, as on CI.
if (!process.env.E2E_CHROMIUM && existsSync("/opt/pw-browsers")) {
  for (const d of readdirSync("/opt/pw-browsers").filter((n) => n.startsWith("chromium_headless_shell-")))
    for (const sub of readdirSync(join("/opt/pw-browsers", d))) {
      const shell = join("/opt/pw-browsers", d, sub, "chrome-headless-shell");
      if (existsSync(shell)) process.env.E2E_CHROMIUM = shell;
    }
}
const browser = await launch();
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack?.split("\n").slice(0, 12).join("\n  ")}`);
  }
}
const kernelUp = (page) => page.waitForFunction(() => /kernel v/.test(document.querySelector("#version")?.textContent ?? ""), null, { timeout: 20000 });
const state = (page) =>
  page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    caches: (await caches.keys()).filter((k) => k.startsWith("spindlelabs-")),
    controlled: navigator.serviceWorker.controller !== null,
  }));
/** Waits (up to 20 s) until nothing of the old install is left; the page may be reloading meanwhile. */
async function untilClean(page) {
  let last;
  for (let i = 0; i < 80; i++) {
    try {
      last = await state(page);
      if (last.registrations === 0 && last.caches.length === 0) return;
    } catch {
      // the page is reloading
    }
    await page.waitForTimeout(250);
  }
  assert.fail(`the old install was not removed: ${JSON.stringify(last)}`);
}
const newApp = async (serviceWorkers = "allow") => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  return { context, page };
};
/** The old install: the real offline worker registered and caching, a page controlled by it (the privacy page, which runs no app code, so the app's own clean-up has not run yet). */
async function installOld(page) {
  await page.goto(`${app}privacy.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  const s = await state(page);
  assert.equal(s.registrations, 1);
  // Its version's cache (and its small record, spindlelabs-state, which the clean-up must delete too).
  assert.equal(s.caches.filter((k) => k !== "spindlelabs-state").length, 1, "the old worker's cache exists");
}

try {
  await startServer();
  // The site as it was before: the same build with the real offline worker as sw.js.
  const old = join(work, "old") + "/";
  cpSync(DIST, old, { recursive: true });
  writeServiceWorker(old, "sw.js");

  await check("a visitor with nothing installed: no service worker, no cache, no manifest link", async () => {
    const { context, page } = await newApp();
    try {
      await page.goto(`${app}?test-hooks`);
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
      assert.equal(await page.$('link[rel="manifest"]'), null, "no manifest, so no install offer");
      await page.reload();
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
    } finally {
      await context.close();
    }
  });

  await check("an old install is removed by the page on the next load: worker gone, cache gone, live copy opened", async () => {
    site.root = old;
    const { context, page } = await newApp();
    try {
      await installOld(page);
      site.root = DIST; // the site now ships offline mode off
      // The page's own clean-up first: stop the browser fetching the clean-up worker by blocking sw.js here.
      await page.route("**/sw.js", (route) => route.abort());
      await page.goto(`${app}?test-hooks`); // opened from the old cache: controlled, so it cleans up and reloads once
      await untilClean(page);
      await page.unroute("**/sw.js");
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
    } finally {
      await context.close();
      site.root = DIST;
    }
  });

  await check("an old install is removed by the clean-up worker alone when the browser looks for an update", async () => {
    site.root = old;
    const { context, page } = await newApp();
    try {
      await installOld(page);
      site.root = DIST;
      // What the old page does on every visit: look for a new sw.js. It finds the clean-up worker.
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
      });
      await untilClean(page);
    } finally {
      await context.close();
      site.root = DIST;
    }
  });

  await check("?offline: this browser keeps the app, can install it, opens it with no network and says so; ?offline=off removes it", async () => {
    const { context, page } = await newApp();
    try {
      await page.goto(`${app}?offline&test-hooks`);
      await kernelUp(page);
      // The worker that keeps the app is offline-sw.js (sw.js stays the clean-up worker), and the page links the manifest.
      await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL.endsWith("/offline-sw.js") === true, null, { timeout: 20000, polling: 250 });
      await page.waitForSelector('link[rel="manifest"]', { state: "attached" });
      assert.equal(await page.evaluate(() => localStorage.getItem("spindlelabs.offline")), "on");
      // Said once, with the way to install it.
      await page.waitForSelector('#app-update[data-kind="kept"]', { timeout: 20000 });
      assert.match(await page.textContent("#app-update span"), /^SpindleLabs is now kept on this device, so it opens without internet\. To add it as an app, choose Install/);
      await page.click("#app-update-reload");
      assert.equal(await page.$("#app-update"), null, "OK hides it");
      // No server and no network, opened at the plain address (as an installed app opens): the app and its kernel come from this device.
      site.server.closeAllConnections();
      await new Promise((done) => site.server.close(done));
      await context.setOffline(true);
      await page.goto(`${app}?test-hooks`);
      await kernelUp(page);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/offline-sw.js")), true);
      // Offline is said by a small mark in the top bar (never a notice over the view or the bottom bar); pressed, it says what still works.
      await page.waitForSelector("#topbar #offline-status", { timeout: 10000 });
      assert.equal(await page.textContent("#offline-status"), "Offline");
      assert.equal(await page.$("#app-update"), null, "no notice of its own: the kept notice is said only once, and offline is the mark");
      await page.click("#offline-status");
      await page.waitForSelector('#app-update[data-kind="offline"]');
      assert.equal(await page.textContent("#app-update span"), "You're offline. SpindleLabs still works, and your designs save on this device. Signing in and your account's copies wait until you're back online.");
      if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/offline-chosen-1280.png` });
      await page.click("#app-update-reload");
      // At phone width the mark stays inside the top bar's one row and the bar doesn't scroll sideways.
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 667 });
        const [mark, bar] = await Promise.all([page.$eval("#offline-status", (e) => e.getBoundingClientRect().toJSON()), page.$eval("#topbar", (e) => e.getBoundingClientRect().toJSON())]);
        assert.ok(mark.width > 0 && mark.top >= bar.top && mark.bottom <= bar.bottom && mark.right <= width, `the mark in the top bar at ${width} px: ${JSON.stringify({ mark, bar })}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `nothing wider than the page at ${width} px`);
        // Clear of every other control in the bar but Menu, whose top corner it sits on as a badge.
        const hit = await page.evaluate(() => {
          const m = document.getElementById("offline-status").getBoundingClientRect();
          return [...document.querySelectorAll("#topbar button, #topbar h1")].filter((e) => e.id !== "offline-status" && e.id !== "menu-toggle" && e.offsetParent !== null).map((e) => [e.id || e.textContent, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.left < m.right && m.left < r.right && r.top < m.bottom && m.top < r.bottom).map(([n]) => n);
        });
        assert.deepEqual(hit, [], `the mark covers nothing at ${width} px`);
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/offline-chosen-${width}.png` });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      // Back online the mark goes by itself.
      await context.setOffline(false);
      await page.waitForSelector("#offline-status", { state: "detached", timeout: 10000 });
      await startServer();
      // Turned off: the worker, its caches and the remembered choice all go, and the plain address is the live site again.
      // The page came from the kept copy, so it cleans up and loads once more from the live site: wait for that second load.
      let loads = 0;
      const loaded = () => loads++;
      page.on("load", loaded);
      await page.goto(`${app}?offline=off&test-hooks`);
      await untilClean(page);
      for (let i = 0; i < 80 && loads < 2; i++) await page.waitForTimeout(250);
      page.off("load", loaded);
      assert.equal(loads, 2, "loaded once more from the live site");
      await page.goto(`${app}?test-hooks`);
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
      assert.equal(await page.evaluate(() => localStorage.getItem("spindlelabs.offline")), null);
      assert.equal(await page.$('link[rel="manifest"]'), null);
    } finally {
      await context.close();
      if (!site.server.listening) await startServer();
    }
  });

  await check("the control: without ?offline the same visit keeps nothing, so with no network it doesn't open", async () => {
    const { context, page } = await newApp();
    try {
      await page.goto(`${app}?test-hooks`);
      await kernelUp(page);
      site.server.closeAllConnections();
      await new Promise((done) => site.server.close(done));
      await context.setOffline(true);
      await assert.rejects(page.goto(`${app}?test-hooks`), /ERR_INTERNET_DISCONNECTED|offline|NS_ERROR|Could not connect/i);
    } finally {
      await context.close();
      if (!site.server.listening) await startServer();
    }
  });

  await check("the clean-up worker is the one the build ships as sw.js, and keeps nothing", async () => {
    assert.ok(!KILL.includes("__SPINDLELABS_BUILD__"));
    assert.ok(!/addEventListener\("fetch"/.test(KILL), "no fetch handler: every request goes to the network");
  });
} finally {
  await browser.close();
  if (site.server?.listening) {
    site.server.closeAllConnections();
    site.server.close();
  }
  rmSync(work, { recursive: true, force: true });
}
if (failed) {
  console.log(`${failed} offline-off check(s) failed`);
  process.exit(1);
}
console.log("offline-off: all checks passed");
