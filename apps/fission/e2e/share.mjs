// Browser check of sharing links (community C2c, C2d), in a real Chromium against a fake account service answered by
// Playwright that keeps links the way supabase/migrations/20261111120000_shares.sql does:
//   - without ?share there is no Share… in File ▾ (the switch is off until the legal check);
//   - with ?share, signed out, Share… offers Sign in; after signing in (the switch survives the trip) Make a link gives
//     `?share=<id>`, the service holds the design's file text, Turn off asks first and then the link is gone;
//   - another browser, signed out, opens the link: the frozen copy with its name, Open my own copy makes a new project
//     (the box's 24,000 mm³), the request carried no sign-in token, and the address loses the link but keeps the switch;
//   - Report sends the chosen reason and says so; a turned-off link says it opens nothing; a damaged shared file is
//     refused in the dialog and changes nothing (the deliberate break);
//   - at 375 px with touch the shared view fills the screen and every button is 44 px tall.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const USER_ID = "7f3c2a10-0000-4000-8000-000000000001";
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "share-e2e-"));
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
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4247, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4247/";
const browser = await launch();

function fakeService() {
  const svc = { calls: [], anonymous: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, shares: [], reports: [], ids: 0 };
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
      const anyone = what === "rpc/open_share" || what === "rpc/report_share";
      if (anyone && token === "") svc.anonymous.push(what);
      if (!anyone && !svc.tokens.has(token)) return json(route, 401, { message: "JWT invalid" });
      const live = (r) => r.off === false;
      if (what === "rpc/open_share") {
        const r = svc.shares.find((x) => x.id === body.p_id && live(x));
        return json(route, 200, r ? { id: r.id, name: r.name, body: r.body, picture: r.picture, created_at: r.created_at } : null);
      }
      if (what === "rpc/report_share") {
        if (!svc.shares.some((x) => x.id === body.p_id && live(x))) return json(route, 200, "gone");
        svc.reports.push({ kind: body.p_kind, reason: body.p_reason });
        return json(route, 200, "kept");
      }
      if (what === "rpc/share_design") {
        const id = `10000000-0000-4000-8000-${String(++svc.ids).padStart(12, "0")}`;
        const created_at = new Date().toISOString();
        svc.shares.push({ id, name: body.p_name, body: body.p_body, picture: body.p_picture, created_at, off: false });
        return json(route, 200, { status: "shared", id, created_at });
      }
      if (what === "rpc/my_shares") return json(route, 200, svc.shares.filter(live).map((r) => ({ id: r.id, name: r.name, picture: r.picture, bytes: r.body.length, created_at: r.created_at, removed_at: null })));
      if (what === "rpc/unshare") {
        const r = svc.shares.find((x) => x.id === body.p_id && live(x));
        if (r) Object.assign(r, { off: true, body: "", picture: null });
        return json(route, 200, !!r);
      }
      // What the app asks of the account around sign-in that sharing doesn't care about.
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

async function device(svc, search = "", width = 1280, phone = false) {
  const context = await browser.newContext({ viewport: { width, height: phone ? 852 : 800 }, hasTouch: phone, colorScheme: "dark" });
  await context.route(`${SERVICE}/**`, svc.handle);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL_ + search);
  await page.waitForSelector("#account-open", { state: "attached" });
  return { page, context };
}
const until = (page, fn, arg, what, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function signIn(page) {
  await page.click("#account-open");
  await page.click("#account .account-google");
  await until(page, () => document.getElementById("account-open")?.textContent === "Ada", undefined, "signed in");
  await page.waitForTimeout(500);
  // Signing in where a project is already kept may open My designs to ask about it: not what is checked here.
  if (await page.evaluate(() => document.getElementById("my-designs")?.open)) await page.click("#my-designs-close");
}

try {
  const svc = fakeService();
  let link = "";

  const off = await device(svc);
  await check("without ?share there is no Share… in File ▾", async () => {
    await startWithBox(off.page);
    await off.page.click("#file-menu");
    assert.equal(await off.page.$("#file-share"), null);
    await off.page.keyboard.press("Escape");
  });
  await off.context.close();

  const a = await device(svc, "?share");
  await check("signed out, Share… offers Sign in and asks the service nothing", async () => {
    await startWithBox(a.page);
    await chooseFile(a.page, "file-share");
    await until(a.page, () => document.getElementById("account")?.open && /Sign in to make a sharing link/.test(document.querySelector("#account .account-note")?.textContent ?? ""), undefined, "sign-in offered");
    assert.deepEqual(svc.calls, []);
    await a.page.click("#account .account-close");
  });

  await check("signed in (the switch survives the trip), Make a link gives ?share=<id> and the service holds the file text", async () => {
    await signIn(a.page);
    await chooseFile(a.page, "file-share");
    await until(a.page, () => document.getElementById("share")?.open, undefined, "dialog");
    assert.match(await a.page.textContent("#share-terms"), /Placeholder terms, not yet checked by a lawyer/);
    await a.page.click("#share-make");
    await until(a.page, () => document.getElementById("share-address"), undefined, "link made");
    link = await a.page.inputValue("#share-address");
    assert.match(link, /^http:\/\/localhost:4247\/\?share=10000000-0000-4000-8000-\d{12}$/);
    assert.equal(svc.shares.length, 1);
    assert.match(svc.shares[0].body, /"formatVersion"/);
    assert.match(svc.shares[0].picture ?? "data:image/png;base64,", /^data:image\//);
    await until(a.page, () => document.querySelectorAll("#share-items .share-item").length === 1, undefined, "listed");
    if (shots) await a.page.screenshot({ path: `${shots}/share-1280.png` });
    await a.page.click("#share-close");
  });

  const b = await device(svc);
  await check("another browser, signed out, opens the link: the frozen copy, no sign-in token, then Open my own copy", async () => {
    await b.page.goto(link);
    await until(b.page, () => document.getElementById("shared")?.open, undefined, "shared view");
    assert.equal(await b.page.textContent("#shared-name"), "Untitled");
    assert.ok(svc.anonymous.includes("rpc/open_share"), "asked with the public key alone");
    assert.deepEqual(await b.page.evaluate(() => document.getElementById("account-open")?.textContent), await b.page.textContent("#account-open"));
    if (shots) await b.page.screenshot({ path: `${shots}/shared-1280.png` });
    await b.page.click("#shared-open");
    await until(b.page, () => !document.getElementById("shared")?.open, undefined, "closed");
    await until(b.page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", undefined, "the box opened (40 × 30 × 20 = 24,000)", 30000);
    const search = await b.page.evaluate(() => location.search);
    assert.equal(search, "?share=", "the link leaves the address, the switch stays");
  });

  await check("Report sends the reason and says so; a second dialog is not left behind", async () => {
    await b.page.goto(link);
    await until(b.page, () => document.getElementById("shared")?.open, undefined, "shared view");
    await b.page.click("#shared-report");
    await b.page.selectOption("#shared-report-kind", "weapon");
    await b.page.fill("#shared-report-reason", "a gun part");
    await b.page.click("#shared-report-send");
    await until(b.page, () => /sent for review/.test(document.getElementById("shared-status")?.textContent ?? ""), undefined, "report said");
    assert.deepEqual(svc.reports, [{ kind: "weapon", reason: "a gun part" }]);
    await b.page.click("#shared-close");
    assert.equal(await b.page.$("#shared"), null, "the view is removed once closed");
  });

  await check("Turn off asks first (Keep it on leaves it), then the link opens nothing", async () => {
    await chooseFile(a.page, "file-share");
    await until(a.page, () => document.querySelectorAll("#share-items .share-item").length === 1, undefined, "listed");
    await a.page.click(".share-item-off");
    assert.match(await a.page.textContent(".share-item-question"), /Turn off the link to “Untitled”\?/);
    await a.page.click(".share-item-keep");
    assert.equal(svc.shares[0].off, false);
    await a.page.click(".share-item-off");
    await a.page.click(".share-item-off-sure");
    await until(a.page, () => document.querySelectorAll("#share-items .share-item").length === 0, undefined, "gone from the list");
    assert.equal(svc.shares[0].off, true);
    assert.equal(svc.shares[0].body, "", "the copy is deleted");
    await b.page.goto(link);
    await until(b.page, () => document.getElementById("account")?.open && /doesn't open anything/.test(document.querySelector("#account .account-note")?.textContent ?? ""), undefined, "said");
    assert.equal(await b.page.$("#shared"), null);
  });

  await check("a damaged shared file is refused in the dialog and changes nothing (deliberate break)", async () => {
    svc.shares.push({ id: "10000000-0000-4000-8000-000000000099", name: "Broken", body: "this is not a project", picture: null, created_at: new Date().toISOString(), off: false });
    await b.page.goto(`${URL_}?share=10000000-0000-4000-8000-000000000099`);
    await until(b.page, () => document.getElementById("shared")?.open, undefined, "shared view");
    const volume = () => b.page.evaluate(() => document.querySelector("#volume")?.textContent ?? "");
    await until(b.page, () => (document.querySelector("#volume")?.textContent ?? "") !== "", undefined, "the page settled");
    await b.page.waitForTimeout(1500);
    const was = await b.page.evaluate(() => document.getElementById("save-status")?.dataset.projectId ?? document.body.dataset.projectId ?? "");
    const before = await volume();
    await b.page.click("#shared-open");
    await until(b.page, () => /couldn't be opened/.test(document.getElementById("shared-status")?.textContent ?? ""), undefined, "refusal said");
    assert.equal(await b.page.evaluate(() => document.getElementById("shared")?.open), true, "the dialog stays");
    assert.equal(await volume(), before, "nothing was opened");
    assert.equal(await b.page.evaluate(() => document.body.dataset.projectId ?? ""), was, "still the same project");
  });

  await check("at 375 px with touch the shared view fills the screen and every button is 44 px tall", async () => {
    const p = await device(svc, `?share=10000000-0000-4000-8000-000000000099`, 375, true);
    await until(p.page, () => document.getElementById("shared")?.open, undefined, "shared view");
    const box = await p.page.evaluate(() => {
      const r = document.getElementById("shared").getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), scroll: document.documentElement.scrollWidth > innerWidth, buttons: [...document.querySelectorAll("#shared button")].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0) };
    });
    assert.equal(box.w, 375);
    assert.equal(box.scroll, false);
    assert.ok(box.buttons.length >= 3 && box.buttons.every((h) => h >= 44), `buttons ${box.buttons}`);
    if (shots) await p.page.screenshot({ path: `${shots}/shared-375.png` });
    await p.context.close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
