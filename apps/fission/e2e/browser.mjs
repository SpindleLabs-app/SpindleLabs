// The one launcher every browser test uses: Chromium by default, or the
// engine E2E_BROWSER names (chromium, firefox or webkit), so CI runs the
// same tests in all three (testing catch-up TC4). In this sandbox Chromium
// comes from /opt/pw-browsers; elsewhere Playwright's own builds are used
// (`npx playwright install --with-deps chromium firefox webkit`).
import { existsSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const ENGINES = { chromium, firefox, webkit };
export const browserName = process.env.E2E_BROWSER || "chromium";
if (!(browserName in ENGINES)) throw new Error(`E2E_BROWSER must be chromium, firefox or webkit, not ${browserName}`);

/**
 * Waits until the kernel holds `n` bodies (`window.fissionTest.bodyCount()`,
 * `?test-hooks`), polling from here: Playwright's waitForFunction takes the
 * Promise an async predicate returns as true at once, so it never waited
 * on a count. Fails naming the count it saw last.
 */
export async function untilBodies(page, n, what = `${n} bodies in the kernel`, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const count = await page.evaluate(() => window.fissionTest?.bodyCount() ?? null);
    if (count === n) return;
    if (Date.now() > end) throw new Error(`${what}: the kernel holds ${count} bodies, not ${n}`);
    await page.waitForTimeout(50);
  }
}

/**
 * Errors seen on the pages and contexts given to `watchErrors` (test audit 2026-11-18 E-7: several checks collected page
 * errors and never read them, or never listened at all, so an uncaught exception after the feature had done its visible
 * part passed). Each entry names its kind: an uncaught exception or unhandled rejection, a console.error, a request
 * that failed (one aborted by a navigation or a closed page, net::ERR_ABORTED, is not an error).
 */
const watched = [];
/**
 * Records every error of `target` (a page, or a context: each of its pages, now and later) less the ones `allow` names
 * (strings found in the text, or RegExps), which a check causes on purpose. Returns `target`. Every file that calls it
 * calls `assertNoErrors()` once its checks are done (e2e/checks.test.mjs holds them to it).
 */
export function watchErrors(target, allow = []) {
  const allowed = (text) => allow.some((a) => (a instanceof RegExp ? a.test(text) : text.includes(a)));
  const note = (kind, text) => !allowed(text) && watched.push(`${kind}: ${text}`);
  const page = (p) => {
    p.on("pageerror", (e) => note("uncaught", process.env.STACKS ? (e.stack ?? e.message) : e.message));
    p.on("console", (m) => m.type() === "error" && note("console.error", m.text()));
    p.on("requestfailed", (r) => {
      const why = r.failure()?.errorText ?? "";
      if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(why)) note("request failed", `${r.url()} ${why}`);
    });
  };
  if (typeof target.newPage === "function") {
    for (const p of target.pages()) page(p);
    target.on("page", page);
  } else page(target);
  return target;
}
/** Every error `watchErrors` recorded so far (a copy). */
export const errorsSeen = () => [...watched];
/** Fails, listing them, if `watchErrors` recorded any error; then starts afresh. */
export function assertNoErrors(what = "no page errors, console errors or failed requests") {
  const seen = watched.splice(0);
  if (seen.length) throw new Error(`${what}, but ${seen.length}:\n  ${seen.join("\n  ")}`);
}

/** Checks chosen under ONLY so far in this file. */
let chosenCount = 0;
let onlyArmed = false;
/**
 * Whether the check `name` runs: always, unless ONLY is set, then when `match(ONLY, name)` (by default, its name holds
 * ONLY). With ONLY set, a file in which no check was chosen fails as it exits ("ONLY matched nothing"), so a stray ONLY
 * (an env file, a matrix variable) never runs zero checks and reads "all passed" (test audit 2026-11-18 E-11).
 */
export function chosen(name, match = (only, n) => n.includes(only)) {
  const only = process.env.ONLY;
  if (!only) return true;
  if (!onlyArmed) {
    onlyArmed = true;
    process.on("exit", () => {
      if (chosenCount > 0) return;
      console.log(`not ok - ONLY=${JSON.stringify(only)} matched no check in this file: nothing was tested`);
      process.exitCode = 1;
    });
  }
  const yes = Boolean(match(only, name));
  if (yes) chosenCount++;
  return yes;
}

/** Launches the chosen browser; `args`, command-line switches for Chromium (e2e/kernel-restart.mjs caps WebAssembly memory). */
export function launch(args = []) {
  // E2E_CHROMIUM runs the Chromium checks on another build, for example CI's
  // (Playwright's own, "Chrome for Testing", a newer Chrome than a sandbox
  // may have); otherwise a sandbox's preinstalled Chromium, else Playwright's.
  const sandboxChromium = process.env.E2E_CHROMIUM || "/opt/pw-browsers/chromium";
  const options = browserName === "chromium" && existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {};
  // Headless Firefox on a CI machine with no graphics card refuses WebGL
  // ("AllowWebgl2:false restricts context creation"), so nothing would be
  // drawn; these let it use its software renderer, as Chromium does.
  // Headless, it still found no GL driver ("Exhausted GL driver options"),
  // so CI runs it with a window on a virtual screen (xvfb-run, E2E_HEADED=1)
  // and Mesa's software GL.
  if (browserName === "firefox") options.firefoxUserPrefs = { "webgl.force-enabled": true, "webgl.disabled": false, "webgl.enable-webgl2": true };
  if (process.env.E2E_HEADED) options.headless = false;
  if (browserName === "chromium" && args.length) options.args = args;
  return ENGINES[browserName].launch(options).then(underTestCSP);
}

/**
 * The app's Content Security Policy (index.html, audit S10) refuses strings
 * run as script, and Playwright's waitForFunction polls by evaluating one in
 * the page, so every context these tests open bypasses the policy unless it
 * passes `bypassCSP: false`. e2e/framing.mjs does, and checks the app under
 * the real policy there (the kernel's WebAssembly, what it refuses).
 * WebKit's bypassCSP ignores a policy given in a <meta> tag, so there the
 * app's page is served with that tag taken out instead.
 *
 * They also emulate a device that prefers dark (`colorScheme: "dark"`; Playwright's own default is light, which would turn the app light under
 * its default "follow the device" theme): the checks were written against the dark theme, and e2e/theme.mjs names the scheme it wants.
 *
 * They block the app's service worker too (offline mode) unless given
 * `serviceWorkers: "allow"`: requests it answers never reach page.route,
 * which many checks use. e2e/offline.mjs allows it and checks it.
 */
function underTestCSP(browser) {
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (options = {}) => {
    const { tooltips, ...rest } = options;
    options = rest;
    const context = await newContext({ bypassCSP: true, serviceWorkers: "block", colorScheme: "dark", ...options });
    if (context && !tooltips) await noTooltips(context);
    if (context && options.bypassCSP !== false && STRIP_META_CSP) await stripMetaCSP(context);
    if (context) await slowKernel(context);
    return context;
  };
  browser.newPage = async (options = {}) => {
    const { tooltips, ...rest } = options;
    options = rest;
    const page = await newPage({ bypassCSP: true, serviceWorkers: "block", colorScheme: "dark", ...options });
    if (!tooltips) await noTooltips(page.context());
    if (options.bypassCSP !== false && STRIP_META_CSP) await stripMetaCSP(page.context());
    await slowKernel(page.context());
    return page;
  };
  return browser;
}

/**
 * The app's instant tooltips (packages/ui tooltip.ts) keep an element's title from the browser while the pointer is on it, which is exactly where
 * many checks read it (the Undo button after a click). So every context starts with them off (the app's test build honours `window.__noTooltips`);
 * e2e/tooltip.mjs asks for them with `tooltips: true`.
 */
const quiet = new WeakSet();
async function noTooltips(context) {
  if (quiet.has(context)) return;
  quiet.add(context);
  await context.addInitScript(() => (window.__noTooltips = true));
}

const STRIP_META_CSP = browserName === "webkit";
const META_CSP = /<meta http-equiv="Content-Security-Policy"[^>]*>/;

/** Serves the app's HTML pages to `context` without the CSP <meta> tag. */
function stripMetaCSP(context) {
  return context.route(
    (url) => url.protocol.startsWith("http") && (url.pathname.endsWith("/") || url.pathname.endsWith(".html")),
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: body.replace(META_CSP, "") });
    },
  );
}

/**
 * E2E_KERNEL_DELAY=ms holds each kernel worker answer back a random 0 to ms
 * milliseconds (seeded by E2E_KERNEL_SEED, in order: never overtaking the
 * one before), so the app's rebuilds land at the moments a slow CI runner
 * sees. Checks must pass under it: a check that reads the page while a
 * rebuild is still on its way and passes only when it lands first has a race.
 */
const KERNEL_DELAY = Number(process.env.E2E_KERNEL_DELAY || 0);
const KERNEL_SEED = Number(process.env.E2E_KERNEL_SEED || 1);
const delayed = new WeakSet();
async function slowKernel(context) {
  if (!(KERNEL_DELAY > 0) || delayed.has(context)) return;
  delayed.add(context);
  await context.addInitScript(([max, seed]) => {
    let s = seed >>> 0 || 1;
    const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const Real = window.Worker;
    window.Worker = class extends Real {
      constructor(...args) {
        super(...args);
        let last = 0;
        let handler = null;
        super.onmessage = (event) => {
          const at = Math.max(last, performance.now() + random() * max);
          last = at;
          setTimeout(() => handler?.call(this, event), at - performance.now());
        };
        Object.defineProperty(this, "onmessage", { get: () => handler, set: (f) => (handler = f) });
      }
    };
  }, [KERNEL_DELAY, KERNEL_SEED]);
}
