// Browser check of the Display name row in the Account dialog (community C6b), in a real Chromium against a fake account
// service answered by Playwright that gives the answers supabase/migrations/20261111130000_display_names.sql does:
//   - a service without the names function (not applied yet) leaves the row out;
//   - signed in with no name, the row says so; "  Ada L " is sent trimmed, saved, and the row then shows the name and the day
//     it may change next (7 days on, from the service's own time) with the box and button off;
//   - each refusal is said in words and keeps what was typed: too short, a name another person has (written differently),
//     a blocked word, and a "too soon" the service gives when the page's clock was behind (the deliberate break: the page
//     trusts the service, not its own date);
//   - a service that cannot be reached says so and leaves the box off;
//   - at 375 px with touch the box and button are 44 px tall and the dialog doesn't scroll sideways.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const USER_ID = "7f3c2a10-0000-4000-8000-000000000001";
const GAP_MS = 604_800_000;
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "display-name-e2e-"));
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
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4777, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4777/";
const browser = await launch();

const key = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");

function fakeService() {
  const svc = { calls: [], sets: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, missing: false, down: false, tooSoon: false, mine: null, other: "Ada L", blocked: ["admin"] };
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
      const what = url.pathname.slice("/rest/v1/".length) + url.search;
      const token = (req.headers().authorization ?? "").replace("Bearer ", "");
      if (!svc.tokens.has(token)) return json(route, 401, { message: "JWT invalid" });
      if (what === "rpc/my_display_name") {
        if (svc.missing) return json(route, 404, { message: "not found" });
        if (svc.down) return json(route, 503, {});
        return json(route, 200, svc.mine && { name: svc.mine.name, changed_at: new Date(svc.mine.at).toISOString(), next_change_at: new Date(svc.mine.at + GAP_MS).toISOString() });
      }
      if (what === "rpc/set_display_name") {
        svc.sets.push(body.p_name);
        const n = body.p_name;
        if (n.length < 3 || n.length > 30 || n !== n.trim()) return json(route, 200, "bad");
        if (svc.blocked.some((w) => key(n).startsWith(w))) return json(route, 200, "blocked");
        if (svc.tooSoon) return json(route, 200, "too-soon");
        if (key(n) === key(svc.other)) return json(route, 200, "taken");
        svc.mine = { name: n, at: Date.now() };
        return json(route, 200, "saved");
      }
      if (what === "profiles?select=email_opt_in") return json(route, 200, [{ email_opt_in: false }]);
      if (what === "profiles?select=keep_designs") return json(route, 200, [{ keep_designs: false }]);
      return json(route, 404, {});
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
const until = (page, fn, arg, what, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
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
  await page.waitForTimeout(500);
  if (await page.evaluate(() => document.getElementById("my-designs")?.open)) await page.click("#my-designs-close");
}
const openAccount = async (page, tap = false) => {
  if (!(await page.evaluate(() => document.getElementById("account")?.open))) {
    if (tap) await page.tap("#menu-toggle");
    await page.click("#account-open");
  }
  await until(page, () => document.getElementById("account")?.open, undefined, "account dialog");
};
const hint = (page) => page.textContent("#account .display-name-hint");
const visible = (page) => page.evaluate(() => { const r = document.querySelector("#account .display-name"); return !!r && !r.hidden && r.getBoundingClientRect().height > 0; });

try {
  const svc = fakeService();

  const a = await device(svc);
  await signIn(a.page);

  await check("a service without the names function leaves the row out", async () => {
    svc.missing = true;
    await a.page.click("#account-open");
    await a.page.waitForTimeout(500);
    assert.ok(svc.calls.includes("POST /rest/v1/rpc/my_display_name"), "it asked");
    assert.equal(await visible(a.page), false);
    await a.page.click("#account .account-close");
    svc.missing = false;
  });

  await check("no name yet: the row says how names work; a name typed with spaces is sent trimmed and saved, then the row waits a week", async () => {
    await openAccount(a.page);
    await until(a.page, () => document.querySelector("#account .display-name:not([hidden])"), undefined, "row shown");
    assert.match(await hint(a.page), /isn't your real name.*once a week/);
    await a.page.fill("#display-name", "  Ada L2 ");
    await a.page.click("#account .display-name-save");
    await until(a.page, () => /^Saved\./.test(document.querySelector("#account .display-name-hint")?.textContent ?? ""), undefined, "saved");
    assert.deepEqual(svc.sets, ["Ada L2"], "trimmed before it was sent");
    // The day comes from the service's own time: saved now + 7 days (604,800,000 ms).
    await a.page.click("#account .account-close");
    await openAccount(a.page);
    await until(a.page, () => /again on/.test(document.querySelector("#account .display-name-hint")?.textContent ?? ""), undefined, "next date");
    const want = await a.page.evaluate((t) => `You can change it again on ${new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.`, svc.mine.at + GAP_MS);
    assert.equal(await hint(a.page), want);
    assert.equal(await a.page.inputValue("#display-name"), "Ada L2");
    assert.equal(await a.page.isDisabled("#display-name"), true);
    assert.equal(await a.page.isDisabled("#account .display-name-save"), true);
    if (shots) await a.page.screenshot({ path: `${shots}/display-name-1280.png` });
    await a.page.click("#account .account-close");
  });

  const svc2 = fakeService();
  svc2.other = "Ada L";
  const c = await device(svc2);
  await signIn(c.page);
  await openAccount(c.page);
  await until(c.page, () => document.querySelector("#account .display-name:not([hidden])"), undefined, "row shown");
  const tryName = async (name, re) => {
    await c.page.fill("#display-name", name);
    await c.page.click("#account .display-name-save");
    await until(c.page, (src) => new RegExp(src).test(document.querySelector("#account .display-name-hint")?.textContent ?? ""), re.source, `refusal for ${name}`);
    assert.equal(await c.page.inputValue("#display-name"), name, "what was typed stays to be fixed");
    assert.equal(await c.page.isDisabled("#display-name"), false);
  };
  await check("too short, taken (written differently), blocked: each refused in words, nothing saved", async () => {
    await tryName("ab", /Use 3 to 30 letters/);
    await tryName("ADA_l", /Someone already has that name/);
    await tryName("Admin Bob", /can't be used/);
    assert.equal(svc2.mine, null);
    if (shots) await c.page.screenshot({ path: `${shots}/display-name-refused-1280.png` });
  });

  await check("the service says too soon although the page thought it could change: the page believes the service (deliberate break)", async () => {
    svc2.tooSoon = true;
    await tryName("Fresh Name", /changed your name recently/);
    assert.equal(svc2.mine, null);
    svc2.tooSoon = false;
  });

  await c.context.close();

  const svc3 = fakeService();
  svc3.down = true;
  const e = await device(svc3);
  await check("a service that can't be reached says so and leaves the box off", async () => {
    await signIn(e.page);
    await openAccount(e.page);
    await until(e.page, () => /couldn't be read/.test(document.querySelector("#account .display-name-hint")?.textContent ?? ""), undefined, "said");
    assert.equal(await e.page.isDisabled("#display-name"), true);
    assert.equal(svc3.sets.length, 0);
  });
  await e.context.close();

  const d = await device(fakeService(), 375, true);
  await check("at 375 px with touch the box and button are 44 px tall and nothing scrolls sideways", async () => {
    await signIn(d.page, true);
    if (!(await d.page.evaluate(() => document.getElementById("account")?.open))) await openAccount(d.page, true);
    await until(d.page, () => document.querySelector("#account .display-name:not([hidden])"), undefined, "row shown");
    const m = await d.page.evaluate(() => {
      const h = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
      const dlg = document.getElementById("account");
      return { input: h("#display-name"), save: h("#account .display-name-save"), sideways: dlg.scrollWidth > dlg.clientWidth };
    });
    assert.ok(m.input >= 44 && m.save >= 44, JSON.stringify(m));
    assert.equal(m.sideways, false);
    if (shots) await d.page.screenshot({ path: `${shots}/display-name-375.png` });
  });
  await d.context.close();

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
