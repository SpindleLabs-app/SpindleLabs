// Browser check of Friends (account features 6), in a real Chromium against a fake account service answered by
// Playwright with packages/account test/fake-friends.ts, which keeps friends the way
// supabase/migrations/20261113180000_friends.sql does. Ada uses the page; Bo and Cy act on the fake directly.
//   - without ?friends the account dialog has no Friends button;
//   - with it: Friends is off at first and says nobody can find you; turning on with no display name says why;
//     with one, the ID shows as two groups of five and Copy puts exactly that on the clipboard;
//   - Bo's ID typed small with spaces sends a request; "You asked" shows the ID typed and never Bo's name; a bad ID is
//     said without asking the service; Bo saying yes puts Bo Builds in Your friends;
//   - Cy's request shows Cy's name only; Block asks first, then Cy is in Blocked and a later request from Cy never
//     shows; Unblock takes it away;
//   - Remove asks first, then Bo is gone from both lists; Turn off asks first and deletes the ID;
//   - a service without Friends says it isn't ready;
//   - at 375 px with touch every button is 44 px tall and nothing scrolls sideways.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";
import { fakeFriends } from "../../../packages/account/test/fake-friends.ts";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const ADA = "7f3c2a10-0000-4000-8000-000000000001";
const BO = "7f3c2a10-0000-4000-8000-000000000002";
const CY = "7f3c2a10-0000-4000-8000-000000000003";
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "friends-e2e-"));
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
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4931, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4931/";
const browser = await launch();

/** Sign-in as in e2e/display-name.mjs; Friends' requests answered by the fake as the database does, for Ada. */
function fakeService() {
  const svc = { calls: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, missing: false, friends: fakeFriends(7) };
  svc.friends.now = Date.now();
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
      if (what === "profiles?select=email_opt_in") return json(route, 200, [{ email_opt_in: false }]);
      if (what === "profiles?select=keep_designs") return json(route, 200, [{ keep_designs: false }]);
      if (/^rpc\/(my_friends|set_friends|new_friend_code|send_friend_request|accept_friend_request|decline_friend_request|cancel_friend_request|remove_friend|block_friend|unblock_friend)$/.test(what)) {
        if (svc.missing) return json(route, 404, { message: "not found" });
        svc.friends.now = Date.now();
        return json(route, 200, svc.friends.answer(ADA, what, body));
      }
      return json(route, 404, {});
    }
    const issue = () => {
      const refresh = `refresh-${++svc.n}`;
      svc.live.add(refresh);
      svc.tokens.add(`access-${svc.n}`);
      return json(route, 200, { access_token: `access-${svc.n}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: { id: ADA, email: "ada@example.com", user_metadata: { full_name: "Ada Maker" } } });
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

async function device(svc, address, width = 1280, phone = false) {
  const context = await browser.newContext({ viewport: { width, height: phone ? 852 : 800 }, hasTouch: phone, colorScheme: "dark" });
  if (!phone) await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL_ });
  await context.route(`${SERVICE}/**`, svc.handle);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL_ + address);
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
async function openAccount(page, tap = false) {
  if (!(await page.evaluate(() => document.getElementById("account")?.open))) {
    if (tap) await page.tap("#menu-toggle");
    await (tap ? page.tap("#account-open") : page.click("#account-open"));
  }
  await until(page, () => document.getElementById("account")?.open, undefined, "account dialog");
}
/** Opens Friends from the account dialog and waits until it has read the service. */
async function openFriends(page, tap = false) {
  if (await page.evaluate(() => document.getElementById("friends")?.open)) await page.click("#friends .account-close");
  await openAccount(page, tap);
  await (tap ? page.tap("#account .account-friends") : page.click("#account .account-friends"));
  await until(page, () => document.getElementById("friends")?.open && !/Loading…/.test(document.getElementById("friends").textContent), undefined, "friends read");
}
const text = (page) => page.evaluate(() => document.getElementById("friends").textContent.replace(/\s+/g, " "));
const noteIs = (page, re, what) => until(page, (src) => new RegExp(src).test(document.querySelector("#friends .friends-note")?.textContent ?? ""), re.source, what);
/** Presses the button `label` in the row naming `who`. */
async function inRow(page, who, label) {
  const row = page.locator("#friends .friends-row", { hasText: who });
  await row.getByRole("button", { name: label, exact: true }).first().click();
}

try {
  await check("without ?friends the account dialog has no Friends button", async () => {
    const svc = fakeService();
    const x = await device(svc, "");
    await signIn(x.page);
    await openAccount(x.page);
    assert.equal(await x.page.locator("#account .account-friends").count(), 0);
    assert.equal(svc.calls.filter((c) => c.includes("friend")).length, 0, "nothing about friends was asked");
    await x.context.close();
  });

  const svc = fakeService();
  const f = svc.friends;
  const a = await device(svc, "?friends");
  await signIn(a.page);

  await check("Friends starts off and says nobody can find you; turning on with no display name says why", async () => {
    await openFriends(a.page);
    const words = await text(a.page);
    assert.match(words, /Nobody can search for you or find you any other way/);
    assert.match(words, /never your email/);
    await a.page.click("#friends .friends-turn-on");
    await noteIs(a.page, /needs a display name/, "no name");
    assert.equal(f.codes.has(ADA), false);
  });

  await check("with a display name it turns on: the ID in two groups of five, Copy gives exactly that", async () => {
    f.names.set(ADA, "Ada M");
    await a.page.click("#friends .friends-turn-on");
    await noteIs(a.page, /Friends is on/, "on");
    const shown = await a.page.textContent("#friends-code");
    assert.equal(shown, `${f.codes.get(ADA).slice(0, 5)}-${f.codes.get(ADA).slice(5)}`);
    await a.page.click("#friends .friends-copy");
    await noteIs(a.page, /Copied/, "copied");
    assert.equal(await a.page.evaluate(() => navigator.clipboard.readText()), shown);
    if (shots) await a.page.screenshot({ path: `${shots}/friends-on-1280.png` });
  });

  await check("a bad ID is said without asking the service; Bo's ID typed small with spaces asks Bo, and Ada sees only the ID", async () => {
    f.names.set(BO, "Bo Builds");
    f.answer(BO, "rpc/set_friends", { p_on: true });
    const bo = f.codes.get(BO);
    const before = svc.calls.length;
    await a.page.fill("#friends-input", "12345");
    await a.page.click("#friends .friends-send");
    await noteIs(a.page, /A profile ID is 10 letters and digits/, "bad");
    assert.equal(svc.calls.slice(before).filter((c) => c.endsWith("send_friend_request")).length, 0, "not sent");
    await a.page.fill("#friends-input", ` ${bo.slice(0, 5).toLowerCase()} ${bo.slice(5).toLowerCase()} `);
    await a.page.click("#friends .friends-send");
    await noteIs(a.page, /Request sent/, "sent");
    const words = await text(a.page);
    assert.match(words, new RegExp(`You asked \\(1\\).*${bo.slice(0, 5)}-${bo.slice(5)}`));
    assert.equal(words.includes("Bo Builds"), false, "Bo's name is not shown before Bo says yes");
    assert.equal(await a.page.inputValue("#friends-input"), "", "the box empties once sent");
  });

  await check("Bo says yes: Bo Builds is in Your friends, and the request is gone", async () => {
    const req = f.answer(BO, "rpc/my_friends", {}).asking_me[0];
    assert.equal(req.name, "Ada M", "Bo sees Ada's display name");
    assert.equal(f.answer(BO, "rpc/accept_friend_request", { p_id: req.id }), "friends");
    await openFriends(a.page);
    const words = await text(a.page);
    assert.match(words, /Your friends \(1\).*Bo Builds.*Friends since/);
    assert.equal(/You asked/.test(words), false);
  });

  await check("Cy's request shows Cy's name only; Block asks first, then Cy is blocked and a later request never shows", async () => {
    f.names.set(CY, "Cy3D");
    f.answer(CY, "rpc/set_friends", { p_on: true });
    assert.equal(f.answer(CY, "rpc/send_friend_request", { p_code: f.codes.get(ADA) }), "sent");
    await openFriends(a.page);
    assert.match(await text(a.page), /Asking you \(1\).*Cy3D.*Asked/);
    await inRow(a.page, "Cy3D", "Block");
    await until(a.page, () => document.querySelector("#friends .friends-question"), undefined, "asked first");
    assert.match(await text(a.page), /Block Cy3D\? They can't ask you again and aren't told\./);
    assert.equal(f.blocks.length, 0, "nothing blocked before the answer");
    if (shots) await a.page.screenshot({ path: `${shots}/friends-block-ask-1280.png` });
    await a.page.locator("#friends .friends-question").getByRole("button", { name: "Block", exact: true }).click();
    await noteIs(a.page, /^Blocked\.$/, "blocked");
    assert.match(await text(a.page), /Blocked \(1\).*Cy3D/);
    assert.equal(f.answer(CY, "rpc/send_friend_request", { p_code: f.codes.get(ADA) }), "sent", "Cy is never told");
    await openFriends(a.page);
    assert.match(await text(a.page), /Nobody is asking right now/);
    await inRow(a.page, "Cy3D", "Unblock");
    await noteIs(a.page, /Unblocked/, "unblocked");
    assert.equal(f.blocks.length, 0);
    assert.match(await text(a.page), /Nobody is asking right now/, "a request sent while blocked never shows");
  });

  await check("Remove asks first, then Bo is gone from both lists", async () => {
    await inRow(a.page, "Bo Builds", "Remove");
    await until(a.page, () => document.querySelector("#friends .friends-question"), undefined, "asked first");
    await a.page.locator("#friends .friends-question").getByRole("button", { name: "Cancel" }).click();
    await until(a.page, () => !document.querySelector("#friends .friends-question"), undefined, "cancelled");
    assert.equal(f.friendships.length, 1, "Cancel kept the friend");
    await inRow(a.page, "Bo Builds", "Remove");
    await a.page.locator("#friends .friends-question").getByRole("button", { name: "Remove", exact: true }).click();
    await noteIs(a.page, /^Removed\.$/, "removed");
    assert.match(await text(a.page), /No friends yet/);
    assert.deepEqual(f.answer(BO, "rpc/my_friends", {}).friends, []);
  });

  await check("Make a new ID asks first and the old ID stops working", async () => {
    const old = f.codes.get(ADA);
    await a.page.click("#friends .friends-new-code");
    await until(a.page, () => document.querySelector("#friends .friends-question"), undefined, "asked first");
    await a.page.locator("#friends .friends-question").getByRole("button", { name: "Make a new ID" }).click();
    await noteIs(a.page, /new profile ID is ready/, "new");
    assert.notEqual(f.codes.get(ADA), old);
    assert.equal(f.answer(BO, "rpc/send_friend_request", { p_code: old }), "not-found");
  });

  await check("Turn off asks first, then the ID and requests are deleted", async () => {
    await a.page.click("#friends .friends-turn-off");
    await until(a.page, () => document.querySelector("#friends .friends-question"), undefined, "asked first");
    assert.match(await text(a.page), /People you blocked stay blocked/);
    await a.page.locator("#friends .friends-question").getByRole("button", { name: "Turn off", exact: true }).click();
    await noteIs(a.page, /Friends is off/, "off");
    assert.equal(f.codes.has(ADA), false);
    assert.equal(await a.page.locator("#friends .friends-turn-on").count(), 1);
  });

  await check("a service without Friends says it isn't ready", async () => {
    svc.missing = true;
    await openFriends(a.page);
    assert.match(await text(a.page), /isn't ready on the account service yet/);
    svc.missing = false;
    await a.page.click("#friends .account-close");
  });
  await a.context.close();

  await check("at 375 px with touch every button is 44 px tall and nothing scrolls sideways", async () => {
    const s2 = fakeService();
    const g = s2.friends;
    for (const [id, name] of [[ADA, "Ada M"], [BO, "Bo Builds"], [CY, "A rather long display name"]]) {
      g.names.set(id, name);
      g.answer(id, "rpc/set_friends", { p_on: true });
    }
    g.answer(BO, "rpc/send_friend_request", { p_code: g.codes.get(ADA) });
    g.answer(CY, "rpc/send_friend_request", { p_code: g.codes.get(ADA) });
    g.answer(ADA, "rpc/accept_friend_request", { p_id: g.answer(ADA, "rpc/my_friends", {}).asking_me.find((r) => r.name === "Bo Builds").id });
    const p = await device(s2, "?friends", 375, true);
    await signIn(p.page, true);
    await openFriends(p.page, true);
    const m = await p.page.evaluate(() => {
      const dlg = document.getElementById("friends");
      const short = [...dlg.querySelectorAll("button, input")].map((b) => [b.textContent || b.id, Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44);
      const body = dlg.querySelector(".account-body");
      const bb = dlg.querySelector(".account-body"); const br = bb.getBoundingClientRect(); const wide = [`body ${br.left}-${br.right} sw ${bb.scrollWidth} cw ${bb.clientWidth} dlg ${dlg.getBoundingClientRect().width}`, ...[...bb.querySelectorAll("*")].map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.right > br.right - 20 || r.width > 300).map(([e, r]) => `${e.tagName}.${e.className} ${Math.round(r.left)}-${Math.round(r.right)} sw${e.scrollWidth}`)];
      return { wide, short, sideways: dlg.scrollWidth > dlg.clientWidth || body.scrollWidth > body.clientWidth, right: Math.max(...[...dlg.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right)), width: innerWidth };
    });
    assert.deepEqual(m.short, [], "every button and box 44 px tall");
    assert.equal(m.sideways, false, JSON.stringify(m.wide));
    assert.ok(m.right <= m.width, JSON.stringify(m));
    if (shots) await p.page.screenshot({ path: `${shots}/friends-375.png` });
    await p.page.locator("#friends .friends-row", { hasText: "A rather long" }).getByRole("button", { name: "Accept" }).tap();
    await noteIs(p.page, /You're friends with A rather long display name now/, "accepted by tap");
    await p.context.close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
