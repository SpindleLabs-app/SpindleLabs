// Browser check of settings that follow you (account features 3), in a real Chromium, against a fake account service
// answered by Playwright that keeps settings the way supabase/migrations/20261106000000_settings.sql does (one row per
// person, a revision every save must name, the off switch deleting the row):
//   - signed out, changing the theme sends nothing;
//   - signed in, a theme picked in Settings and a slicer nozzle reach the account a few seconds later, never an AI key;
//   - a second browser (a new device) takes them on signing in: the page turns light at once, no reload, and the
//     account dialog's box is ticked;
//   - its own change (units to inches) reaches the first browser, which shows inches at once, even with Settings open;
//   - unticking the box deletes the settings from the account, and later changes are not sent;
//   - an account service that doesn't keep settings yet shows no box, and nothing breaks;
//   - at 375 px with touch the box is 44 px tall and nothing runs off the side.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const USER_ID = "7f3c2a10-0000-4000-8000-000000000001";
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "settings-follow-e2e-"));
const errors = [];
let failed = false;

async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}

Object.assign(process.env, { SPINDLE_ACCOUNTS: "1", SPINDLE_ACCOUNT_URL: SERVICE, SPINDLE_ACCOUNT_KEY: KEY });
await build({ root, logLevel: "error", build: { outDir: dist, emptyOutDir: true } });
for (const k of ["SPINDLE_ACCOUNTS", "SPINDLE_ACCOUNT_URL", "SPINDLE_ACCOUNT_KEY"]) delete process.env[k];
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4327, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4327/";
const browser = await launch();

/** The account service: sign-in as in e2e/account.mjs, and the settings' requests as the database answers them. */
function fakeService() {
  const svc = { calls: [], saves: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, row: null, keep: true, missing: false };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer", "access-control-allow-methods": "POST, GET, PATCH, OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  svc.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    svc.calls.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/auth/v1/authorize") {
      const back = new URL(url.searchParams.get("redirect_to"));
      const code = `code-${++svc.n}`;
      svc.codes.set(code, url.searchParams.get("code_challenge"));
      back.searchParams.set("code", code);
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }
    if (req.headers().apikey !== KEY) return json(route, 401, { error: "no key" });
    const body = req.postDataJSON() ?? {};
    if (url.pathname.startsWith("/rest/v1/")) {
      if (!svc.tokens.has((req.headers().authorization ?? "").replace("Bearer ", ""))) return json(route, 401, { message: "JWT invalid" });
      const what = url.pathname.slice("/rest/v1/".length) + url.search;
      if (req.method() === "GET" && what === "profiles?select=email_opt_in") return json(route, 200, [{ email_opt_in: false }]);
      if (req.method() === "GET" && what === "profiles?select=keep_designs") return json(route, 200, [{ keep_designs: false }]);
      if (what.startsWith("rpc/") && /settings/.test(what) && svc.missing) return json(route, 404, { message: "not found" });
      if (req.method() === "POST" && what === "rpc/my_settings") return json(route, 200, { keep: svc.keep, revision: svc.row?.revision ?? 0, settings: svc.row?.settings ?? {} });
      if (req.method() === "POST" && what === "rpc/save_settings") {
        svc.saves.push(body);
        if (!svc.keep) return json(route, 200, { status: "off" });
        const s = body.p_settings;
        if (typeof s !== "object" || s === null || Object.entries(s).some(([k, v]) => typeof v !== "string" || !/^spindlelabs[A-Za-z0-9./_-]*$/.test(k))) return json(route, 200, { status: "invalid" });
        if ((svc.row?.revision ?? 0) !== body.p_expected) return json(route, 200, { status: "changed", revision: svc.row?.revision ?? 0 });
        svc.row = { settings: s, revision: body.p_expected + 1 };
        return json(route, 200, { status: "saved", revision: svc.row.revision });
      }
      if (req.method() === "POST" && what === "rpc/set_keep_settings") {
        svc.keep = body.p_on === true;
        if (!svc.keep) svc.row = null;
        return json(route, 200, svc.keep);
      }
      return json(route, 404, {}); // My designs' requests: this check's account keeps no designs
    }
    const issue = () => {
      const refresh = `refresh-${++svc.n}`;
      svc.live.add(refresh);
      svc.tokens.add(`access-${svc.n}`);
      return json(route, 200, { access_token: `access-${svc.n}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: { id: USER_ID, email: "ada@example.com", user_metadata: { full_name: "Ada Maker" } } });
    };
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      const challenge = svc.codes.get(body.auth_code);
      svc.codes.delete(body.auth_code);
      const hashed = createHash("sha256").update(String(body.code_verifier)).digest("base64url");
      return challenge !== undefined && hashed === challenge ? issue() : json(route, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") return svc.live.delete(body.refresh_token) ? issue() : json(route, 400, { error: "invalid_grant" });
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: cors });
    return json(route, 404, {});
  };
  return svc;
}

async function device(svc, width = 1280, phone = false) {
  const context = await browser.newContext({ viewport: { width, height: phone ? 852 : 800 }, hasTouch: phone, colorScheme: "dark" });
  await context.route(`${SERVICE}/**`, svc.handle);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL_);
  await page.waitForSelector("#account-open", { state: "attached" });
  return { page, context };
}
const until = (page, fn, arg, what, timeout = 25000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function untilNode(fn, what, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`${what}: timed out`);
}
async function signIn(page, tap = false) {
  if (tap) {
    await page.tap("#menu-toggle");
    await page.tap("#account-open");
    await page.tap("#account .account-google");
  } else {
    await page.click("#account-open");
    await page.click("#account .account-google");
  }
  await until(page, () => document.getElementById("account-open")?.textContent === "Ada", undefined, "signed in");
  // A project already kept here makes My designs open to ask whether it is this person's (e2e/my-designs.mjs checks
  // that; this fake keeps no designs): closed unanswered, so nothing of it is sent.
  const asked = await page.waitForFunction(() => document.getElementById("my-designs")?.open, undefined, { timeout: 3000 }).then(() => true, () => false);
  if (asked) await page[tap ? "tap" : "click"]("#my-designs-close");
}
async function pick(page, selector) {
  await page.click("#settings-open");
  await page.click(`#settings ${selector}`);
  await page.click("#settings .close");
}
const ui = (svc) => JSON.parse(svc.row?.settings?.["spindlelabs-settings"] ?? "{}");

try {
  const svc = fakeService();
  const a = await device(svc);

  await check("signed out: changing the theme sends nothing", async () => {
    await pick(a.page, '[data-choice="light"]');
    await pick(a.page, '[data-choice="dark"]');
    await a.page.waitForTimeout(10000); // longer than a look and a send together
    assert.deepEqual(svc.calls, [], "no request to the account service");
  });

  await check("signed in: the theme and the nozzle reach the account a few seconds later, and an AI key never does", async () => {
    await signIn(a.page);
    await a.page.evaluate(() => {
      localStorage.setItem("spindlelabs.slice.nozzle", "high-flow");
      localStorage.setItem("fission.ai.key.anthropic", "sk-ant-secret"); // stands in for any setting not listed
    });
    await pick(a.page, '[data-choice="light"]');
    await untilNode(() => ui(svc).theme === "light" && svc.row.settings["spindlelabs.slice.nozzle"] === "high-flow", "sent");
    assert.equal(await a.page.evaluate(() => document.documentElement.dataset.theme), "light");
    assert.ok(!JSON.stringify(svc.saves).includes("sk-ant-secret"), "the AI key is never sent");
    assert.deepEqual(Object.keys(svc.row.settings).sort(), ["spindlelabs-settings", "spindlelabs.slice.nozzle"]);
  });

  const b = await device(svc);
  await check("a new device takes them on signing in: light at once, no reload, and the box is ticked", async () => {
    assert.equal(await b.page.evaluate(() => document.documentElement.dataset.theme), "dark", "dark before signing in");
    const loads = [];
    b.page.on("load", () => loads.push(1));
    await signIn(b.page);
    loads.length = 0; // the return from the sign-in page is a load; none may follow
    await until(b.page, () => document.documentElement.dataset.theme === "light", undefined, "light on the new device");
    assert.equal(await b.page.evaluate(() => localStorage.getItem("spindlelabs.slice.nozzle")), "high-flow");
    assert.deepEqual(loads, [], "no reload");
    await b.page.click("#account-open");
    await until(b.page, () => document.getElementById("account-settings-keep")?.checked === true && !document.getElementById("account-settings-keep").disabled, undefined, "box ticked");
    if (shots) await b.page.screenshot({ path: `${shots}/settings-follow-box-1280.png` });
    await b.page.click("#account .account-close");
  });

  await check("its own change reaches the first browser, which shows inches at once, even with Settings open", async () => {
    await pick(b.page, '[data-unit="in"]');
    await untilNode(() => ui(svc).unit === "in", "units sent");
    assert.equal(ui(svc).theme, "light", "the theme is still there: merged, not replaced");
    await a.page.click("#settings-open");
    await a.page.evaluate(() => dispatchEvent(new Event("online"))); // what coming back to the tab does, without waiting a minute
    await until(a.page, () => document.documentElement.dataset.unit === "in", undefined, "inches on the first browser");
    await until(a.page, () => document.querySelector('#settings [data-unit="in"]')?.getAttribute("aria-checked") === "true", undefined, "Settings shows inches");
    if (shots) await a.page.screenshot({ path: `${shots}/settings-follow-open-1280.png` });
    await a.page.click("#settings .close");
  });

  await check("unticking the box deletes the settings from the account, and later changes are not sent", async () => {
    await a.page.click("#account-open");
    await until(a.page, () => document.getElementById("account-settings-keep")?.disabled === false, undefined, "box ready");
    await a.page.click("#account-settings-keep");
    await untilNode(() => svc.keep === false && svc.row === null, "deleted from the account");
    await until(a.page, () => /deleted/.test(document.querySelector(".account-settings-keep [role=status]")?.textContent ?? ""), undefined, "says so");
    await a.page.click("#account .account-close");
    const saves = svc.saves.length;
    await pick(a.page, '[data-choice="dark"]');
    await a.page.waitForTimeout(10000);
    assert.equal(svc.saves.length, saves, "nothing sent once off");
    assert.equal(await a.page.evaluate(() => document.documentElement.dataset.unit), "in", "this browser keeps its own settings");
  });
  await a.context.close();
  await b.context.close();

  await check("an account service that doesn't keep settings yet shows no box, and nothing breaks", async () => {
    const old = fakeService();
    old.missing = true;
    const c = await device(old);
    await signIn(c.page);
    await c.page.click("#account-open");
    await c.page.waitForTimeout(1500);
    assert.equal(await c.page.isVisible("#account .account-settings-keep"), false);
    await c.page.click("#account .account-close");
    await pick(c.page, '[data-choice="light"]');
    assert.equal(await c.page.evaluate(() => document.documentElement.dataset.theme), "light");
    await c.context.close();
  });

  await check("375 px with touch: the box is 44 px tall and nothing runs off the side", async () => {
    const phoneSvc = fakeService();
    const p = await device(phoneSvc, 375, true);
    await signIn(p.page, true);
    if (!(await p.page.isVisible("#account-open"))) await p.page.tap("#menu-toggle");
    await p.page.tap("#account-open");
    await until(p.page, () => document.getElementById("account-settings-keep")?.disabled === false, undefined, "box ready");
    const box = await p.page.$eval("#account .account-settings-keep", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(box.height >= 44, `the box's row is ${box.height} px tall`);
    assert.ok(box.right <= 375, `the box ends at ${box.right} px`);
    assert.ok(await p.page.evaluate(() => document.querySelector("#account .account-body").scrollWidth <= document.querySelector("#account .account-body").clientWidth), "no sideways scroll");
    if (shots) await p.page.screenshot({ path: `${shots}/settings-follow-box-375.png` });
    await p.context.close();
  });

  await check("no page errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  rmSync(dist, { recursive: true, force: true });
}
if (failed) process.exit(1);
