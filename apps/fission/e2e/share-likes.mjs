// Browser check of likes on a sharing link (community C7b), in a real Chromium against a fake account service answered by
// Playwright that keeps links and likes the way supabase/migrations/20261111120000_shares.sql and
// 20261111170000_likes.sql do:
//   - signed out, a link someone else shared with two likes shows "2 likes"; Like says to sign in and asks nothing;
//   - signed in, Like makes it "Liked" and 3 likes (2 + 1), kept at the service and after a reload; pressed again it is
//     2 likes and not pressed;
//   - the person's own link refuses the like in words, and the count stays;
//   - a service without the likes functions yet (the migration not applied: a 404) shows no like row, and the shared
//     design still opens (the deliberate break: the row must not be there);
//   - at 375 px with touch the like button is 44 px tall and nothing scrolls sideways.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const USER_ID = "7f3c2a10-0000-4000-8000-000000000001";
const OTHER = "7f3c2a10-0000-4000-8000-000000000002";
const LINK = "10000000-0000-4000-8000-000000000001";
const OWN = "10000000-0000-4000-8000-000000000002";
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "share-likes-e2e-"));
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
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4249, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4249/";
const browser = await launch();

function fakeService() {
  const svc = { calls: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, likesMissing: false, shares: [], likes: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer", "access-control-allow-methods": "POST, GET, PATCH, OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  svc.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
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
      svc.calls.push(what);
      const token = (req.headers().authorization ?? "").replace("Bearer ", "");
      const anyone = what === "rpc/open_share" || what === "rpc/report_share" || what === "rpc/like_count";
      if (!anyone && !svc.tokens.has(token)) return json(route, 401, { message: "JWT invalid" });
      const me = svc.tokens.has(token) ? USER_ID : null;
      const share = svc.shares.find((x) => x.id === body.p_id);
      if (what.startsWith("rpc/like_") || what === "rpc/i_like" || what === "rpc/unlike_share") {
        if (svc.likesMissing) return json(route, 404, { message: "Could not find the function" });
        const mine = () => svc.likes.some((l) => l.share === body.p_id && l.user === me);
        if (what === "rpc/like_count") return json(route, 200, share ? svc.likes.filter((l) => l.share === body.p_id).length : null);
        if (what === "rpc/i_like") return json(route, 200, !!share && mine());
        if (what === "rpc/like_share") {
          if (!share) return json(route, 200, "gone");
          if (share.user === me) return json(route, 200, "own");
          if (mine()) return json(route, 200, "already");
          svc.likes.push({ share: body.p_id, user: me });
          return json(route, 200, "liked");
        }
        if (what === "rpc/unlike_share") {
          if (!mine()) return json(route, 200, "not-liked");
          svc.likes = svc.likes.filter((l) => !(l.share === body.p_id && l.user === me));
          return json(route, 200, "unliked");
        }
      }
      if (what === "rpc/open_share") return json(route, 200, share ? { id: share.id, name: share.name, body: share.body, picture: null, created_at: share.created_at } : null);
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
  await page.goto(URL_ + "?share");
  await page.waitForSelector("#account-open", { state: "attached" });
  return { page, context };
}
const until = (page, fn, arg, what, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function signIn(page) {
  await page.click("#account-open");
  await page.click("#account .account-google");
  await until(page, () => document.getElementById("account-open")?.textContent === "Ada", undefined, "signed in");
  await until(page, () => document.getElementById("my-designs")?.open || Object.keys(localStorage).some((k) => k.startsWith("spindle.account.designs/")), undefined, "My designs asked, or nothing to ask");
  if (await page.evaluate(() => document.getElementById("my-designs")?.open)) await page.click("#my-designs-close");
  if (await page.evaluate(() => document.getElementById("account")?.open)) await page.click("#account .account-close");
}
async function openLink(page, id) {
  await page.goto(`${URL_}?share=${id}`);
  await until(page, () => document.getElementById("shared")?.open, undefined, "shared view");
}
const countText = (page) => page.evaluate(() => document.getElementById("shared-like-count")?.textContent ?? "");
const pressed = (page) => page.evaluate(() => document.getElementById("shared-like")?.getAttribute("aria-pressed"));

try {
  const svc = fakeService();
  // The file text is never opened here (e2e/share.mjs opens one): likes are about the link.
  const body = JSON.stringify({ formatVersion: 1 });
  const at = new Date().toISOString();
  svc.shares.push({ id: LINK, user: OTHER, name: "Bracket", body, created_at: at }, { id: OWN, user: USER_ID, name: "Mine", body, created_at: at });
  // Two other people already like the bracket.
  svc.likes.push({ share: LINK, user: "a" }, { share: LINK, user: "b" });

  const a = await device(svc);
  await check("signed out: the count shows (2 likes); Like says to sign in and asks nothing", async () => {
    await openLink(a.page, LINK);
    await until(a.page, () => document.getElementById("shared-like-count")?.textContent === "2 likes", undefined, "count shown");
    assert.equal(await pressed(a.page), "false");
    const before = svc.calls.filter((c) => c === "rpc/like_share").length;
    await a.page.click("#shared-like");
    await until(a.page, () => /Sign in to like designs/.test(document.getElementById("shared-like-status")?.textContent ?? ""), undefined, "sign-in said");
    assert.equal(svc.calls.filter((c) => c === "rpc/like_share").length, before, "no like sent");
    assert.equal(svc.calls.includes("rpc/i_like"), false, "nobody signed in: never asked whose like");
    if (shots) await a.page.screenshot({ path: `${shots}/likes-signed-out-1280.png` });
    await a.page.click("#shared-close");
  });

  await check("signed in: Like makes it Liked and 3 likes (2 + 1), kept after a reload; again it is 2 and not pressed", async () => {
    await signIn(a.page);
    await openLink(a.page, LINK);
    await until(a.page, () => document.getElementById("shared-like-count")?.textContent === "2 likes", undefined, "count shown");
    await a.page.click("#shared-like");
    await until(a.page, () => document.getElementById("shared-like-count")?.textContent === "3 likes", undefined, "3 likes");
    assert.equal(await pressed(a.page), "true");
    assert.match(await a.page.textContent("#shared-like"), /Liked/);
    assert.ok(svc.likes.some((l) => l.share === LINK && l.user === USER_ID), "kept at the service");
    if (shots) await a.page.screenshot({ path: `${shots}/likes-liked-1280.png` });
    await openLink(a.page, LINK);
    await until(a.page, () => document.getElementById("shared-like-count")?.textContent === "3 likes", undefined, "3 after a reload");
    assert.equal(await pressed(a.page), "true");
    await a.page.click("#shared-like");
    await until(a.page, () => document.getElementById("shared-like-count")?.textContent === "2 likes", undefined, "2 likes again");
    assert.equal(await pressed(a.page), "false");
    await a.page.click("#shared-close");
  });

  await check("the person's own link refuses the like in words; the count stays at none", async () => {
    await openLink(a.page, OWN);
    await until(a.page, () => document.getElementById("shared-like-count")?.textContent === "No likes yet", undefined, "count shown");
    await a.page.click("#shared-like");
    await until(a.page, () => /shared this design yourself/.test(document.getElementById("shared-like-status")?.textContent ?? ""), undefined, "own said");
    assert.equal(await countText(a.page), "No likes yet");
    assert.equal(await pressed(a.page), "false");
    await a.page.click("#shared-close");
  });

  await check("a service without the likes functions shows no like row, and the shared design still opens", async () => {
    svc.likesMissing = true;
    await openLink(a.page, LINK);
    await a.page.waitForTimeout(1000);
    assert.equal(await a.page.isVisible("#shared-like-row"), false, "no like row");
    assert.equal(await a.page.isVisible("#shared-open"), true, "Open my own copy is there");
    svc.likesMissing = false;
    await a.page.click("#shared-close");
  });
  await a.context.close();

  await check("at 375 px with touch the like button is 44 px tall and nothing scrolls sideways", async () => {
    const p = await device(svc, 375, true);
    await openLink(p.page, LINK);
    await until(p.page, () => document.getElementById("shared-like-count")?.textContent === "2 likes", undefined, "count shown");
    const box = await p.page.evaluate(() => ({ h: Math.round(document.getElementById("shared-like").getBoundingClientRect().height), scroll: document.documentElement.scrollWidth > innerWidth }));
    assert.ok(box.h >= 44, `like button ${box.h} px tall`);
    assert.equal(box.scroll, false);
    await p.page.tap("#shared-like");
    await until(p.page, () => /Sign in to like designs/.test(document.getElementById("shared-like-status")?.textContent ?? ""), undefined, "sign-in said");
    if (shots) await p.page.screenshot({ path: `${shots}/likes-375.png` });
    await p.context.close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
