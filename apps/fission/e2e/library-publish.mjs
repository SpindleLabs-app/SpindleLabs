// Browser check of publishing to the public library (community C3c), in a real Chromium against a fake account service
// answered by Playwright that keeps library entries and the private bucket the way
// supabase/migrations/20261112030000_library.sql does:
//   - without ?share there is no Publish to the library… in File ▾;
//   - signed out, it offers Sign in and asks the service nothing;
//   - signed in, the dialog starts from the design's name with CC BY 4.0 and its sentence; an empty title turns Publish
//     off and says why; publishing sends the typed title, tags (lowercased) and licence, then the design's own text to
//     Storage (no overwrite flag), then finishes; a daily refusal is said and the form stays;
//   - the account dialog has exactly one My library and one My links (a merge once built My links twice: the
//     deliberate break, the old code fails here); My library lists the design, Take down asks first, Keep it changes
//     nothing, Take down turns it off and deletes its file;
//   - at 375 px the boxes and buttons are 44 px tall and nothing scrolls sideways.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
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
if (shots) mkdirSync(shots, { recursive: true });
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "library-publish-e2e-"));
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
const PORT = 4431;
const server = await preview({ root, build: { outDir: dist }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
const URL_ = `http://localhost:${PORT}/`;
const browser = await launch();

function fakeService() {
  const svc = { calls: [], uploads: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, entries: [], objects: new Map(), refuse: null };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer", "access-control-allow-methods": "POST, GET, PATCH, DELETE, OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  const time = () => new Date().toISOString().replace("Z", "123+00:00"); // microseconds, as PostgreSQL writes them
  const card = (e) => ({ id: e.id, title: e.title, picture: e.picture, licence: e.licence, tags: e.tags, published_at: e.published_at, author: null });
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
    const token = (req.headers().authorization ?? "").replace("Bearer ", "");
    const me = svc.tokens.has(token) ? USER_ID : null;
    if (url.pathname.startsWith("/storage/v1/")) {
      const what = `${req.method()} ${url.pathname.slice("/storage/v1/".length)}`;
      svc.calls.push(what);
      if (!me) return json(route, 400, { statusCode: "403", error: "Unauthorized", message: "jwt malformed" });
      const upload = /^POST object\/library\/(.+)$/.exec(what);
      if (upload) {
        const name = upload[1];
        const e = svc.entries.find((x) => `${x.id}.spindle` === name && x.state === "uploading");
        svc.uploads.push({ name, type: req.headers()["content-type"], upsert: req.headers()["x-upsert"] ?? null, body: req.postData() });
        if (!e) return json(route, 400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
        if (svc.objects.has(name)) return json(route, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
        svc.objects.set(name, req.postData());
        return json(route, 200, { Key: `library/${name}` });
      }
      if (what === "DELETE object/library") {
        const names = (req.postDataJSON()?.prefixes ?? []).filter((n) => svc.objects.delete(n));
        return json(route, 200, names.map((name) => ({ name, bucket_id: "library" })));
      }
      return json(route, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    }
    const body = req.postDataJSON() ?? {};
    if (url.pathname.startsWith("/rest/v1/")) {
      const what = url.pathname.slice("/rest/v1/".length) + url.search;
      svc.calls.push(what);
      if (!me) return json(route, 401, { message: "JWT invalid" });
      if (what === "rpc/begin_publish") {
        if (svc.refuse) return json(route, 200, { status: svc.refuse });
        const id = `20000000-0000-4000-8000-${String(++svc.n).padStart(12, "0")}`;
        svc.entries.push({ id, title: body.p_title, description: body.p_description, licence: body.p_licence, tags: body.p_tags, picture: body.p_picture, state: "uploading", created_at: time(), published_at: null, removed_at: null });
        return json(route, 200, { status: "ready", id, file: `${id}.spindle` });
      }
      if (what === "rpc/finish_publish") {
        const e = svc.entries.find((x) => x.id === body.p_id && x.state === "uploading");
        if (!e) return json(route, 200, "gone");
        if (!svc.objects.has(`${e.id}.spindle`)) return json(route, 200, "missing");
        Object.assign(e, { state: "live", published_at: time() });
        return json(route, 200, "live");
      }
      if (what === "rpc/unpublish") {
        const e = svc.entries.find((x) => x.id === body.p_id && x.state !== "off");
        if (!e) return json(route, 200, null);
        e.state = "off";
        return json(route, 200, true);
      }
      if (what === "rpc/my_library") {
        const file = (e) => svc.objects.get(`${e.id}.spindle`);
        const rows = svc.entries.filter((e) => e.state !== "off" || file(e) !== undefined).reverse();
        return json(route, 200, rows.map((e) => ({ ...card(e), state: e.state, removed_at: e.removed_at, created_at: e.created_at, file: `${e.id}.spindle`, bytes: file(e) === undefined ? null : Buffer.byteLength(file(e)) })));
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

async function device(svc, search, width = 1280, phone = false) {
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
  await until(page, () => document.getElementById("my-designs")?.open || Object.keys(localStorage).some((k) => k.startsWith("spindle.account.designs/")), undefined, "My designs asked, or nothing to ask");
  if (await page.evaluate(() => document.getElementById("my-designs")?.open)) await page.click("#my-designs-close");
  if (await page.evaluate(() => document.getElementById("account")?.open)) await page.click("#account .account-close");
}

try {
  const svc = fakeService();

  const off = await device(svc, "");
  await check("without ?share there is no Publish to the library… in File ▾", async () => {
    await startWithBox(off.page);
    await off.page.click("#file-menu");
    assert.equal(await off.page.$("#file-publish"), null);
    await off.page.keyboard.press("Escape");
  });
  await off.context.close();

  const a = await device(svc, "?share");
  await check("signed out, Publish to the library… offers Sign in and asks the service nothing", async () => {
    await startWithBox(a.page);
    await chooseFile(a.page, "file-publish");
    await until(a.page, () => document.getElementById("account")?.open && /Sign in to publish a design to the library/.test(document.querySelector("#account .account-note")?.textContent ?? ""), undefined, "sign-in offered");
    assert.deepEqual(svc.calls, []);
    await a.page.click("#account .account-close");
  });

  await check("signed in: the form starts from the name with CC BY 4.0; an empty title turns Publish off and says why", async () => {
    await signIn(a.page);
    await chooseFile(a.page, "file-publish");
    await until(a.page, () => document.getElementById("publish")?.open, undefined, "dialog");
    assert.equal(await a.page.inputValue("#publish-name"), "Untitled");
    assert.equal(await a.page.inputValue("#publish-licence"), "CC-BY-4.0");
    assert.match(await a.page.textContent("#publish-licence-says"), /as long as they name you/);
    assert.match(await a.page.textContent("#publish-terms"), /Placeholder terms, not yet checked by a lawyer/);
    await a.page.fill("#publish-name", "");
    assert.equal(await a.page.isDisabled("#publish-go"), true);
    assert.match(await a.page.textContent("#publish-problem"), /Give it a title/);
  });

  await check("Publish sends the title, lowercased tags and licence, then the design's own text to Storage, then finishes", async () => {
    await a.page.fill("#publish-name", "Cable clip");
    await a.page.fill("#publish-description", "Clips onto a desk edge.");
    await a.page.fill("#publish-tags", "Desk, clip");
    await a.page.selectOption("#publish-licence", "CC0-1.0");
    assert.match(await a.page.textContent("#publish-licence-says"), /without naming you/);
    if (shots) await a.page.screenshot({ path: `${shots}/publish-1280.png` });
    await a.page.click("#publish-go");
    await until(a.page, () => /^Published\./.test(document.getElementById("publish-status")?.textContent ?? ""), undefined, "published");
    assert.equal(await a.page.isVisible("#publish-form"), false);
    const order = svc.calls.filter((c) => /begin_publish|object\/library\/|finish_publish/.test(c));
    assert.deepEqual(order.map((c) => c.replace(/\d{12}/, "N")), ["rpc/begin_publish", "POST object/library/20000000-0000-4000-8000-N.spindle", "rpc/finish_publish"]);
    const e = svc.entries[0];
    assert.deepEqual([e.title, e.description, e.licence, e.tags, e.state], ["Cable clip", "Clips onto a desk edge.", "CC0-1.0", ["desk", "clip"], "live"]);
    const up = svc.uploads[0];
    assert.equal(up.type, "application/json");
    assert.equal(up.upsert, null, "never asks to overwrite");
    const sent = JSON.parse(up.body);
    assert.ok(sent.formatVersion >= 1, "the design's own project text");
    // The box the check started with (40 × 30 × 20) is in it.
    assert.equal(sent.workspaces.design.timeline.features.length, 1, "one feature: the box");
    assert.match(JSON.stringify(sent.workspaces.design.timeline.features[0]), /box/i);
    if (shots) await a.page.screenshot({ path: `${shots}/published-1280.png` });
    await a.page.click("#publish-close");
    await until(a.page, () => !document.getElementById("publish")?.open, undefined, "closed");
  });

  await check("a daily refusal is said in the dialog and the form stays to try again", async () => {
    svc.refuse = "daily";
    await chooseFile(a.page, "file-publish");
    await until(a.page, () => document.getElementById("publish")?.open, undefined, "dialog");
    await a.page.click("#publish-go");
    await until(a.page, () => /published 10 designs today/.test(document.getElementById("publish-status")?.textContent ?? ""), undefined, "daily said");
    assert.equal(await a.page.isVisible("#publish-form"), true);
    assert.equal(svc.entries.length, 1, "nothing more made");
    svc.refuse = null;
    await a.page.click("#publish-close");
  });

  await check("the account dialog has one My library and one My links; Take down asks first, then turns it off and deletes its file", async () => {
    await a.page.click("#account-open");
    await until(a.page, () => document.getElementById("account")?.open, undefined, "account open");
    assert.equal(await a.page.locator("#account .account-my-links").count(), 1, "one My links button");
    assert.equal(await a.page.locator("#account .account-my-library").count(), 1, "one My library button");
    await a.page.click("#account .account-my-library");
    await until(a.page, () => document.getElementById("my-library")?.open && !document.getElementById("account")?.open, undefined, "My library open, account closed");
    await until(a.page, () => document.querySelectorAll("#my-library-items .share-item").length === 1, undefined, "listed");
    assert.equal(await a.page.textContent("#my-library-items .share-item-name"), "Cable clip");
    assert.match(await a.page.textContent("#my-library-items .share-item-when"), /^In the library · published/);
    await a.page.click("#my-library .publish-take-down");
    assert.match(await a.page.textContent("#my-library .share-item-question"), /Take “Cable clip” out of the library\?/);
    await a.page.click("#my-library .publish-keep");
    assert.equal(svc.entries[0].state, "live", "Keep it changes nothing");
    await a.page.click("#my-library .publish-take-down");
    if (shots) await a.page.screenshot({ path: `${shots}/my-library-ask-1280.png` });
    await a.page.click("#my-library .publish-take-down-sure");
    await until(a.page, () => document.getElementById("my-library-status")?.textContent?.startsWith("You haven't published"), undefined, "emptied");
    assert.equal(svc.entries[0].state, "off");
    assert.equal(svc.objects.size, 0, "its file deleted");
    await a.page.click("#my-library-close");
  });
  await check("at 375 px the boxes and buttons are 44 px tall and nothing scrolls sideways", async () => {
    await a.page.setViewportSize({ width: 375, height: 852 });
    await chooseFile(a.page, "file-publish");
    await until(a.page, () => document.getElementById("publish")?.open, undefined, "dialog");
    const sizes = await a.page.evaluate(() => ({
      heights: ["publish-name", "publish-licence", "publish-tags", "publish-go", "publish-close"].map((id) => [id, Math.round(document.getElementById(id).getBoundingClientRect().height)]),
      width: Math.round(document.getElementById("publish").getBoundingClientRect().width),
      scroll: document.documentElement.scrollWidth > innerWidth || document.getElementById("publish").scrollWidth > document.getElementById("publish").clientWidth,
    }));
    for (const [id, h] of sizes.heights) assert.ok(h >= 44, `${id} ${h} px tall`);
    assert.equal(sizes.width, 375, "a full-width sheet");
    assert.equal(sizes.scroll, false);
    if (shots) await a.page.screenshot({ path: `${shots}/publish-375.png` });
  });
  await a.context.close();

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
