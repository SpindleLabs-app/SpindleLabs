// Browser check of optional accounts (src/account.ts, accounts.config.mjs).
// - The normal build (`npm run build`, switch on since the privacy policy went
//   live) points at SpindleLabs' own account service, from accounts.config.mjs.
// - A build with the switch off (SPINDLE_ACCOUNTS=0, built here) has no account
//   code, no Sign in button and contacts no account service.
// - A build with the switch on (built here into a temporary folder, against a
//   fake service answered by Playwright) shows Sign in before Settings, sends
//   nothing to the service until the person signs in, signs in with Google
//   through the real redirect and RFC 7636 checks (the fake hashes the secret
//   with node:crypto), keeps the open design across the trip, takes the code
//   out of the address, stays signed in after a reload with no request,
//   signs out, and says in plain words when the person cancels or the
//   service can't be reached. At 375 px the button sits behind Menu and the
//   dialog fits the width.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";
import { startWithBox } from "./start.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const shipped = join(root, "dist");
const offDist = mkdtempSync(join(tmpdir(), "account-e2e-off-"));
const onDist = mkdtempSync(join(tmpdir(), "account-e2e-"));
const errors = [];
let failed = false;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

// The build with accounts off.
process.env.SPINDLE_ACCOUNTS = "0";
await build({ root, logLevel: "error", build: { outDir: offDist, emptyOutDir: true } });
// The build with accounts on, pointed at the fake service.
Object.assign(process.env, { SPINDLE_ACCOUNTS: "1", SPINDLE_ACCOUNT_URL: SERVICE, SPINDLE_ACCOUNT_KEY: KEY });
await build({ root, logLevel: "error", build: { outDir: onDist, emptyOutDir: true } });
for (const k of ["SPINDLE_ACCOUNTS", "SPINDLE_ACCOUNT_URL", "SPINDLE_ACCOUNT_KEY"]) delete process.env[k];

const off = await preview({ root, build: { outDir: offDist }, preview: { port: 4244, strictPort: true }, logLevel: "error" });
const on = await preview({ root, build: { outDir: onDist }, preview: { port: 4245, strictPort: true }, logLevel: "error" });
const OFF_URL = "http://localhost:4244/";
const ON_URL = "http://localhost:4245/";
const browser = await launch();

/** The fake account service: Supabase's four auth requests, checked as the real one checks them. */
function fakeService() {
  const svc = { calls: [], codes: new Map(), live: new Set(), mode: "up", authorize: "approve", n: 0, loggedOut: [], fullName: "Ada Maker", profile: { email_opt_in: false }, tokens: new Set(), profileHeld: Promise.resolve() };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer", "access-control-allow-methods": "POST, GET, PATCH, OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  svc.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    svc.calls.push(`${req.method()} ${url.pathname}${url.search.startsWith("?grant_type") || url.pathname.startsWith("/rest/") ? url.search : ""}`);
    if (url.pathname === "/auth/v1/authorize") {
      const back = new URL(url.searchParams.get("redirect_to"));
      assert.equal(url.searchParams.get("provider"), "google");
      assert.equal(url.searchParams.get("code_challenge_method"), "s256");
      if (svc.authorize === "cancel") back.searchParams.set("error", "access_denied");
      else {
        const code = `code-${++svc.n}`;
        svc.codes.set(code, url.searchParams.get("code_challenge"));
        back.searchParams.set("code", code);
      }
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }
    if (svc.mode === "down") return route.abort("internetdisconnected");
    if (req.headers().apikey !== KEY) return json(route, 401, { error: "no key" });
    const body = req.postDataJSON() ?? {};
    if (url.pathname.startsWith("/rest/v1/")) {
      // The data API, as the database's rules allow it for the one signed-in person.
      if (!svc.profile || !svc.tokens.has((req.headers().authorization ?? "").replace("Bearer ", ""))) return json(route, 401, { message: "JWT invalid" });
      const what = url.pathname.slice("/rest/v1/".length);
      if (req.method() === "GET" && what === "profiles") {
        await svc.profileHeld; // a slow service, for the check that the last choice seen shows at once
        return json(route, 200, [{ email_opt_in: svc.profile.email_opt_in }]);
      }
      if (req.method() === "PATCH" && what === "profiles" && url.searchParams.get("id") === "eq.7f3c2a10-0000-4000-8000-000000000001") {
        svc.profile.email_opt_in = body.email_opt_in;
        return route.fulfill({ status: 204, headers: cors });
      }
      if (req.method() === "POST" && what === "rpc/my_data") return json(route, 200, { account: { email: "ada@example.com" }, profile: svc.profile, plan: { plan: "free" } });
      if (req.method() === "POST" && what === "rpc/delete_my_account") {
        svc.profile = undefined;
        svc.live.clear();
        svc.tokens.clear();
        return route.fulfill({ status: 204, headers: cors });
      }
      return json(route, 404, {});
    }
    const issue = () => {
      const refresh = `refresh-${++svc.n}`;
      svc.live.add(refresh);
      svc.tokens.add(`access-${svc.n}`);
      return json(route, 200, { access_token: `access-${svc.n}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: { id: "7f3c2a10-0000-4000-8000-000000000001", email: "ada@example.com", user_metadata: { full_name: svc.fullName, avatar_url: "https://lh3.example/a.png" } } });
    };
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      const challenge = svc.codes.get(body.auth_code);
      svc.codes.delete(body.auth_code);
      const hashed = createHash("sha256").update(String(body.code_verifier)).digest("base64url");
      return challenge !== undefined && hashed === challenge ? issue() : json(route, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      return svc.live.delete(body.refresh_token) ? issue() : json(route, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/auth/v1/logout") {
      svc.loggedOut.push(req.headers().authorization);
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(route, 404, {});
  };
  return svc;
}

async function fresh(base, width = 1280, phone = false) {
  const context = await browser.newContext({ viewport: { width, height: phone ? 852 : 800 }, hasTouch: phone });
  const svc = fakeService();
  const elsewhere = [];
  await context.route(`${SERVICE}/**`, svc.handle);
  const page = await context.newPage();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname.endsWith("supabase.co") && !u.hostname.startsWith("test-accounts")) elsewhere.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(base);
  await page.waitForSelector("#settings-open", { state: "attached" });
  return { page, svc, context, elsewhere };
}
/** The first two top-bar items that overlap by more than 1 px (as e2e/phone-short.mjs reads them), or null. */
const topBarOverlap = (page) =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll("#topbar > *:not([hidden]), #topbar #topbar-actions > *, #topbar .app-bar > *, #topbar button")]
      .filter((e) => e.children.length === 0 || e.tagName === "BUTTON" || e.tagName === "H1")
      .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 12), e, r: e.getBoundingClientRect() }))
      .filter((b) => b.r.width > 2 && b.r.height > 2);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1 && !boxes[i].e.contains(boxes[j].e) && !boxes[j].e.contains(boxes[i].e)) return `${boxes[i].id} overlaps ${boxes[j].id}`;
      }
    return null;
  });
const accountText = (page) => page.locator("#account-open").textContent();

const scripts = (dist) => readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dist, "assets", f), "utf8")).join("");

try {
  await check("the shipped build has accounts on, pointed at SpindleLabs' own account service", async () => {
    const { ACCOUNT_SERVICE } = await import("../accounts.config.mjs");
    const code = scripts(shipped);
    assert.match(ACCOUNT_SERVICE.url, /^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
    assert.ok(code.includes(ACCOUNT_SERVICE.url), "the service address is in the shipped build");
    assert.ok(code.includes(ACCOUNT_SERVICE.anonKey), "the public key is in the shipped build");
  });

  await check("switch off: no account code in the build, no Sign in button, no request to an account service", async () => {
    const code = scripts(offDist);
    assert.equal(code.includes("auth/v1"), false, "no sign-in requests in the switched-off build");
    assert.equal(code.includes("spindle.account"), false);
    const { page, svc, context } = await fresh(OFF_URL);
    await startWithBox(page);
    assert.equal(await page.locator("#account-open").count(), 0);
    assert.deepEqual(svc.calls, []);
    await context.close();
  });

  await check("switch on, 1280 px: Sign in sits before Settings and nothing is sent until it is used", async () => {
    const { page, svc, context } = await fresh(ON_URL);
    await page.locator("#account-open").waitFor();
    assert.equal(await accountText(page), "Sign in");
    assert.equal(await page.evaluate(() => document.getElementById("account-open").nextElementSibling?.id), "settings-open");
    await startWithBox(page);
    assert.deepEqual(svc.calls, [], "a visit with no account contacts nothing");
    await page.click("#account-open");
    assert.equal(await page.locator("#account-title").textContent(), "Sign in to SpindleLabs");
    const gives = await page.$$eval("#account .account-gives li", (l) => l.map((x) => x.textContent));
    assert.equal(gives.length, 2);
    if (shots) await page.screenshot({ path: `${shots}/account-signed-out-1280.png` });
    assert.deepEqual(svc.calls, [], "opening the dialog contacts nothing");
    await context.close();
  });

  await check("switch on: signing in keeps the design, cleans the address, survives a reload, and signs out", async () => {
    const { page, svc, context, elsewhere } = await fresh(ON_URL);
    await page.locator("#account-open").waitFor();
    await startWithBox(page);
    await page.waitForTimeout(1500); // let autosave store the box before leaving for the sign-in page
    await page.click("#account-open");
    await page.click("#account .account-google");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Ada");
    assert.equal(new URL(page.url()).search, "", "the code is gone from the address");
    await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³");
    assert.deepEqual(svc.calls, ["GET /auth/v1/authorize", "POST /auth/v1/token?grant_type=pkce"], "an unticked email box sends no email choice");
    const stored = await page.evaluate(() => localStorage.getItem("spindle.account.session"));
    assert.equal(stored.includes("a.png"), false, "the picture address is not kept");
    await page.reload();
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Ada");
    assert.equal(svc.calls.length, 2, "a reload with a fresh session sends nothing");
    await page.click("#account-open");
    await page.waitForFunction(() => document.getElementById("account-emails")?.disabled === false);
    assert.equal(await page.isChecked("#account-emails"), false, "the email choice is no until ticked");
    assert.equal(await page.locator("#account-title").textContent(), "Your account");
    assert.match(await page.locator("#account .account-who").textContent(), /Ada Maker.*ada@example\.com/);
    await page.click("#account .account-action");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Sign in");
    assert.deepEqual(svc.loggedOut, ["Bearer access-2"]);
    assert.match(await page.locator("#account .account-note").textContent(), /^Signed out\.$/);
    assert.equal(await page.evaluate(() => localStorage.getItem("spindle.account.session")), null);
    assert.deepEqual(elsewhere, []);
    await context.close();
  });

  await check("switch on: cancelling, and a service that can't be reached, each say so in plain words and sign nobody in", async () => {
    for (const [setup, words] of [
      [(svc) => (svc.authorize = "cancel"), /^Sign-in was cancelled\. You can carry on without an account\.$/],
      [(svc) => (svc.mode = "down"), /^Couldn't reach the sign-in service\. Check your internet connection and try again\.$/],
    ]) {
      const { page, svc, context } = await fresh(ON_URL);
      await page.locator("#account-open").waitFor();
      setup(svc);
      await page.click("#account-open");
      await page.click("#account .account-google");
      await page.waitForSelector("#account[open] .account-note");
      assert.match(await page.locator("#account .account-note").textContent(), words);
      assert.equal(await accountText(page), "Sign in");
      assert.equal(new URL(page.url()).search, "", "the address is clean");
      // The app still works.
      await page.keyboard.press("Escape");
      await startWithBox(page);
      await context.close();
    }
  });

  await check("switch on, 375 px: Sign in is behind Menu, the dialog fits, and the Google button is a 44 px target", async () => {
    const { page, context } = await fresh(ON_URL, 375, true);
    await page.locator("#account-open").waitFor({ state: "attached" });
    await page.tap("#menu-toggle");
    await page.tap("#account-open");
    const go = await page.locator("#account .account-google").boundingBox();
    assert.ok(go.height >= 44, `height ${go.height}`);
    assert.ok(go.x >= 0 && go.x + go.width <= 375);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
    if (shots) await page.screenshot({ path: `${shots}/account-signed-out-375.png` });
    await context.close();
  });

  await check("switch on: the email box starts unticked; ticked before signing in, the yes is saved; it can be changed later", async () => {
    const { page, svc, context } = await fresh(ON_URL);
    await page.locator("#account-open").waitFor();
    await page.click("#account-open");
    assert.equal(await page.isChecked("#account-emails"), false, "never ticked for the person");
    await page.check("#account-emails");
    await page.click("#account .account-google");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Ada");
    await page.waitForFunction(() => !localStorage.getItem("spindle.account.email-choice"));
    for (let i = 0; i < 50 && !svc.profile.email_opt_in; i++) await new Promise((r) => setTimeout(r, 100)); // the yes is sent after the return
    assert.deepEqual(svc.profile, { email_opt_in: true });
    assert.ok(svc.calls.includes("PATCH /rest/v1/profiles?id=eq.7f3c2a10-0000-4000-8000-000000000001"));
    await page.click("#account-open");
    await page.waitForFunction(() => document.getElementById("account-emails")?.checked === true && !document.getElementById("account-emails").disabled);
    await page.uncheck("#account-emails");
    await page.waitForFunction(() => /no emails/.test(document.querySelector("#account .account-emails .account-small")?.textContent ?? ""));
    assert.deepEqual(svc.profile, { email_opt_in: false });
    if (shots) await page.screenshot({ path: `${shots}/account-signed-in-1280.png` });
    await context.close();
  });

  await check("switch on: reopened, the email box shows the last choice seen at once, then the service's answer puts it right", async () => {
    // Owner's report: the box showed unticked for a moment on every open until the service answered.
    const { page, svc, context } = await fresh(ON_URL);
    await page.locator("#account-open").waitFor();
    await page.click("#account-open");
    await page.click("#account .account-google");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Ada");
    await page.click("#account-open");
    await page.waitForFunction(() => document.getElementById("account-emails")?.disabled === false);
    await page.check("#account-emails");
    await page.waitForFunction(() => /you'll get emails/.test(document.querySelector("#account .account-emails .account-small")?.textContent ?? ""));
    await page.click("#account .account-close");
    // The service now answers slowly. Reopening shows the yes straight away, before any answer.
    let release;
    svc.profileHeld = new Promise((r) => (release = r));
    await page.click("#account-open");
    assert.equal(await page.isChecked("#account-emails"), true, "the last choice seen shows at once");
    assert.equal(await page.isDisabled("#account-emails"), false, "and can be changed at once");
    // Changed to no on another device: when the answer comes, the box follows it.
    svc.profile.email_opt_in = false;
    release();
    await page.waitForFunction(() => document.getElementById("account-emails")?.checked === false);
    // Signing out forgets it, so the next person on this browser never sees it.
    await page.click("#account .account-action:text('Sign out')");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Sign in");
    assert.equal(await page.evaluate(() => localStorage.getItem("spindle.account.email-seen")), null);
    await context.close();
  });

  // Regression: at 761 to 899 px Sign in pushed "Saving…" under DESIGN ▾ (CI's phone-short.mjs at 844 × 390).
  for (const width of [761, 844, 900, 999, 1000, 1100]) {
    await check(`switch on, ${width} px: signed out and signed in with a long name, the top bar is one row with nothing overlapping`, async () => {
      const { page, svc, context } = await fresh(ON_URL, width, width < 900);
      svc.fullName = "Maximilianus Wolfeschlegel";
      await page.locator("#account-open").waitFor();
      await startWithBox(page);
      await page.evaluate(() => { const s = document.getElementById("save-status"); if (s) s.textContent = "Saving…"; }); // the widest status
      assert.equal(await topBarOverlap(page), null, "signed out");
      assert.equal(await page.$eval("#topbar", (e) => Math.round(e.getBoundingClientRect().height)), 44, "signed out: one row");
      await page.click("#account-open");
      await page.click("#account .account-google");
      await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Maximilianus");
      await page.evaluate(() => { const s = document.getElementById("save-status"); if (s) s.textContent = "Saving…"; });
      assert.equal(await topBarOverlap(page), null, "signed in");
      assert.equal(await page.$eval("#topbar", (e) => Math.round(e.getBoundingClientRect().height)), 44, "signed in: one row");
      if (shots) await page.screenshot({ path: `${shots}/account-bar-${width}.png`, clip: { x: 0, y: 0, width, height: 60 } });
      await context.close();
    });
  }

  await check("switch on: Download my data saves the account's JSON; Delete asks once more, then deletes and signs out, keeping the design", async () => {
    const { page, svc, context } = await fresh(ON_URL);
    await page.locator("#account-open").waitFor();
    await page.click("#account-open");
    await page.click("#account .account-google");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Ada");
    await startWithBox(page);
    await page.click("#account-open");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("text=Download my data")]);
    assert.equal(download.suggestedFilename(), "spindlelabs-account.json");
    const saved = JSON.parse(readFileSync(await download.path(), "utf8"));
    assert.equal(saved.account.email, "ada@example.com");
    await page.click("#account .account-danger");
    assert.equal(await page.locator("#account-title").textContent(), "Delete your account?");
    if (shots) await page.screenshot({ path: `${shots}/account-delete-1280.png` });
    await page.click("text=Keep my account");
    assert.equal(await page.locator("#account-title").textContent(), "Your account");
    assert.notEqual(svc.profile, undefined, "keeping it deletes nothing");
    await page.click("#account .account-danger");
    await page.click("#account .account-yours .account-danger");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Sign in");
    assert.equal(svc.profile, undefined);
    assert.match(await page.locator("#account .account-note").textContent(), /^Your account was deleted\. Designs on this device are still here\.$/);
    assert.equal(await page.evaluate(() => localStorage.getItem("spindle.account.session")), null);
    assert.equal(await page.locator("#volume").textContent(), "24,000 mm³");
    await context.close();
  });

  await check("switch on: a delete the service can't reach keeps the account and says so", async () => {
    const { page, svc, context } = await fresh(ON_URL);
    await page.locator("#account-open").waitFor();
    await page.click("#account-open");
    await page.click("#account .account-google");
    await page.waitForFunction(() => document.getElementById("account-open")?.textContent === "Ada");
    await page.click("#account-open");
    svc.mode = "down";
    await page.click("#account .account-danger");
    await page.click("#account .account-yours .account-danger");
    await page.waitForSelector("#account .account-note");
    assert.match(await page.locator("#account .account-note").textContent(), /^Your account was not deleted\. Couldn't reach the sign-in service/);
    assert.equal(await accountText(page), "Ada");
    await context.close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await off.httpServer.close();
  await on.httpServer.close();
  rmSync(onDist, { recursive: true, force: true });
  rmSync(offDist, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
