// Browser check of My designs (account features 1), in a real Chromium, against a fake account service answered by
// Playwright that keeps designs the way supabase/migrations/20261105120000_my_designs.sql does (revisions, the
// first-time rules, every person's own rows):
//   - signed out, nothing goes to the account service, and File > My designs… offers Sign in;
//   - signing in where a project is already kept asks first (a shared computer); nothing is sent until the answer;
//     "Keep them" sends it with a picture of the view and the Design tag, and My designs lists it;
//   - a change is sent a few seconds after it is saved, over the same design (its revision named);
//   - a second browser (another device) that says "Not now" sends nothing of its own, lists the design, opens it
//     (the box comes up), and its own change then goes back over that design;
//   - Delete asks first, then deletes it from the account, not from the browser;
//   - the account dialog's delete words name My designs;
//   - at 375 px with touch the dialog fills the screen, every button is 44 px tall, nothing runs off the side.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, insertPreset, startWithBox } from "./start.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const USER_ID = "7f3c2a10-0000-4000-8000-000000000001";
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "my-designs-e2e-"));
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
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4246, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4246/";
const browser = await launch();

/** The account service: sign-in as in e2e/account.mjs, and the designs' requests as the database answers them. */
function fakeService() {
  const svc = { calls: [], saves: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, rows: [], keep: true, ids: 0, versions: new Map() };
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
      const bytes = (r) => r.body.length + (r.picture?.length ?? 0);
      if (req.method() === "GET" && what === "profiles?select=email_opt_in") return json(route, 200, [{ email_opt_in: false }]);
      if (req.method() === "GET" && what === "profiles?select=keep_designs") return json(route, 200, [{ keep_designs: svc.keep }]);
      if (req.method() === "PATCH" && url.pathname === "/rest/v1/profiles") {
        if ("keep_designs" in body) svc.keep = body.keep_designs;
        return route.fulfill({ status: 204, headers: cors });
      }
      if (req.method() === "POST" && what === "rpc/my_designs")
        return json(route, 200, [...svc.rows].reverse().map((r) => ({ id: r.id, name: r.name, source: r.source, picture: r.picture, bytes: bytes(r), saved_at: r.saved_at, updated_at: r.updated_at, revision: r.revision })));
      if (req.method() === "POST" && what === "rpc/my_design_space") return json(route, 200, { designs: svc.rows.length, bytes: svc.rows.reduce((s, r) => s + bytes(r), 0), max_designs: 200, max_bytes: 20971520 });
      if (req.method() === "POST" && what === "rpc/get_design") {
        const r = svc.rows.find((x) => x.id === body.p_id);
        return json(route, 200, r ? { id: r.id, name: r.name, source: r.source, body: r.body, saved_at: r.saved_at, updated_at: r.updated_at, revision: r.revision } : null);
      }
      if (req.method() === "POST" && what === "rpc/design_versions") return json(route, 200, [...(svc.versions.get(body.p_id) ?? [])].reverse().map((v) => ({ saved_at: v.saved_at, bytes: v.body.length })));
      if (req.method() === "POST" && what === "rpc/get_design_version") {
        const v = (svc.versions.get(body.p_id) ?? []).find((x) => Date.parse(x.saved_at) === Date.parse(body.p_saved_at));
        return json(route, 200, v ? { saved_at: v.saved_at, body: v.body } : null);
      }
      if (req.method() === "POST" && what === "rpc/delete_design") {
        const before = svc.rows.length;
        svc.rows = svc.rows.filter((x) => x.id !== body.p_id);
        return json(route, 200, svc.rows.length < before);
      }
      if (req.method() === "POST" && what === "rpc/save_design") {
        svc.saves.push(body);
        if (!svc.keep) return json(route, 200, { status: "off" });
        const now = new Date().toISOString();
        if (body.p_id !== null) {
          const r = svc.rows.find((x) => x.id === body.p_id);
          if (!r) return json(route, 200, { status: "gone" });
          if (r.revision !== body.p_expected) return json(route, 200, { status: "changed", revision: r.revision });
          // Every copy a save replaces is kept as a version here (the 10-minute rule is the database's: test_design_versions.py).
          if (r.body !== body.p_body) svc.versions.set(r.id, [...(svc.versions.get(r.id) ?? []), { saved_at: r.saved_at, body: r.body }]);
          Object.assign(r, { name: body.p_name, source: body.p_source, body: body.p_body, picture: body.p_picture ?? r.picture, saved_at: body.p_saved_at, updated_at: now, revision: r.revision + 1 });
          return json(route, 200, { status: "saved", id: r.id, revision: r.revision, updated_at: now });
        }
        const id = `00000000-0000-4000-8000-${String(++svc.ids).padStart(12, "0")}`;
        svc.rows.push({ id, name: body.p_name, source: body.p_source, body: body.p_body, picture: body.p_picture, saved_at: body.p_saved_at, updated_at: now, revision: 1 });
        return json(route, 200, { status: "saved", id, revision: 1, updated_at: now });
      }
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
}
const rows = (page) => page.$$eval("#my-designs-items .my-design", (els) => els.map((e) => ({ name: e.querySelector(".my-design-name").textContent, tag: e.querySelector(".my-design-tag").textContent, picture: !!e.querySelector("img"), open: e.dataset.open === "true" })));

try {
  const svc = fakeService();
  const a = await device(svc);
  let volumeA = "";

  await check("signed out: nothing is sent, and File > My designs… offers Sign in", async () => {
    await startWithBox(a.page);
    await until(a.page, () => document.getElementById("save-status")?.dataset.state === "saved", undefined, "saved");
    await a.page.waitForTimeout(500);
    assert.deepEqual(svc.calls, [], "no request to the account service");
    await chooseFile(a.page, "file-my-designs");
    await until(a.page, () => document.getElementById("account")?.open && /Sign in to keep your designs/.test(document.querySelector("#account .account-note")?.textContent ?? ""), undefined, "sign-in offered");
    assert.match(await a.page.textContent("#account .account-gives"), /My designs: your designs kept in your account/);
    await a.page.click("#account .account-close");
  });

  await check("signing in where a project is kept asks first; Keep them sends it with a picture and the Design tag", async () => {
    await a.page.click("#account-open");
    await a.page.click("#account .account-google");
    await until(a.page, () => document.getElementById("my-designs")?.open, undefined, "My designs opens to ask");
    await until(a.page, () => /1 project was in this browser before you signed in/.test(document.getElementById("my-designs-others")?.textContent ?? ""), undefined, "the question");
    assert.equal(svc.saves.length, 0, "nothing sent before the answer");
    if (shots) await a.page.screenshot({ path: `${shots}/my-designs-ask-1280.png` });
    await a.page.click(".my-designs-keep-others");
    await until(a.page, () => document.querySelectorAll("#my-designs-items .my-design").length === 1, undefined, "listed");
    assert.equal(svc.saves.length, 1);
    const sent = svc.saves[0];
    assert.equal(sent.p_id, null);
    assert.equal(sent.p_source, "design");
    assert.match(sent.p_picture, /^data:image\/(webp|jpeg|png);base64,/);
    assert.ok(sent.p_picture.length <= 32 * 1024, `picture ${sent.p_picture.length} bytes`);
    assert.match(sent.p_body, /"formatVersion"/);
    assert.deepEqual(await rows(a.page), [{ name: "Untitled", tag: "DesignLab", picture: true, open: true }]);
    assert.match(await a.page.textContent("#my-designs-space"), /^1 of 200 designs · \d+ kB of 20\.0 MB used$/);
    if (shots) await a.page.screenshot({ path: `${shots}/my-designs-1280.png` });
    await a.page.click("#my-designs-close");
  });

  await check("a change is sent soon after it is saved, over the same design", async () => {
    await insertPreset(a.page, "cylinder");
    for (let i = 0; i < 100 && svc.saves.length < 2; i++) await a.page.waitForTimeout(100);
    assert.equal(svc.saves.length, 2, "sent once more");
    assert.equal(svc.saves[1].p_id, svc.rows[0].id);
    assert.equal(svc.saves[1].p_expected, 1);
    assert.equal(svc.rows[0].revision, 2);
    volumeA = await a.page.textContent("#volume");
    assert.notEqual(volumeA, "24,000 mm³", "the cylinder added to the box");
  });

  const b = await device(svc);
  await check("another device: Not now sends nothing of its own; it opens the design, and its change goes back over it", async () => {
    await startWithBox(b.page); // device B's own work, from before signing in
    await until(b.page, () => document.getElementById("save-status")?.dataset.state === "saved" && document.body.dataset.projectId, undefined, "kept");
    const ownB = await b.page.evaluate(() => document.body.dataset.projectId);
    await signIn(b.page);
    await until(b.page, () => document.getElementById("my-designs")?.open, undefined, "My designs opens to ask");
    await b.page.click(".my-designs-leave-others");
    await until(b.page, () => /aren't kept in your account|isn't kept in your account/.test(document.getElementById("my-designs-others")?.textContent ?? ""), undefined, "left out");
    assert.equal(svc.rows.length, 1, "nothing of device B's sent");
    assert.deepEqual((await rows(b.page)).map((r) => r.open), [false]);
    await b.page.click("#my-designs-items .my-design-open");
    await until(b.page, () => !document.getElementById("my-designs")?.open, undefined, "closes");
    // The box and cylinder from device A, opened as a project of B's own (not over B's box).
    await until(b.page, (v) => document.querySelector("#volume")?.textContent === v, volumeA, `device A's design opened (${volumeA})`, 30000);
    assert.notEqual(await b.page.evaluate(() => document.body.dataset.projectId), ownB, "a new project in this browser");
    const saves = svc.saves.length;
    await insertPreset(b.page, "sphere");
    await until(b.page, () => document.getElementById("save-status")?.dataset.state === "saved", undefined, "saved");
    for (let i = 0; i < 100 && svc.saves.length === saves; i++) await b.page.waitForTimeout(100);
    assert.equal(svc.saves.at(-1).p_id, svc.rows[0].id, "over the same design");
    assert.equal(svc.saves.at(-1).p_expected, 2);
    assert.equal(svc.rows.length, 1);
    assert.equal(svc.rows[0].revision, 3);
  });

  await check("Earlier versions on device B lists the account's too, and restores one saved on device A; Undo takes it back", async () => {
    // The account kept device A's first save (the box alone) when its second replaced it; device B never had it.
    const first = svc.versions.get(svc.rows[0].id)?.[0];
    assert.ok(first, "the account kept device A's first save");
    const now = await b.page.textContent("#volume");
    await chooseFile(b.page, "file-versions");
    await until(b.page, () => document.querySelector('#versions-items .project-row[data-where="account"]'), undefined, "an account version listed").catch(async (e) => {
      throw new Error(`${e.message}; dialog: ${await b.page.textContent("#versions")}; calls: ${svc.calls.slice(-6).join(", ")}`);
    });
    const accountRows = await b.page.$$eval('#versions-items .project-row[data-where="account"]', (rs) => rs.map((r) => [Number(r.dataset.at), r.querySelector(".version-account-tag")?.textContent]));
    assert.ok(accountRows.some(([at, tag]) => at === Date.parse(first.saved_at) && tag === "From your account"), JSON.stringify(accountRows));
    assert.match(await b.page.textContent("#versions .project-list-note"), /Your account keeps them too/);
    if (shots) await b.page.screenshot({ path: `${shots}/versions-account-1280.png` });
    await b.page.click(`#versions-items .project-row[data-at="${Date.parse(first.saved_at)}"] .version-restore`);
    await until(b.page, () => !document.getElementById("versions")?.open, undefined, "closes");
    await until(b.page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", undefined, "device A's first save: the box alone", 30000);
    assert.match(await b.page.textContent("#file-status"), /Restored the version from/);
    await b.page.keyboard.press("Control+z");
    await until(b.page, (v) => document.querySelector("#volume")?.textContent === v, now, `Undo takes it back (${now})`, 30000);
  });

  await check("a version the account no longer keeps says so, and nothing changes", async () => {
    const now = await b.page.textContent("#volume");
    await chooseFile(b.page, "file-versions");
    await until(b.page, () => document.querySelector('#versions-items .project-row[data-where="account"]'), undefined, "an account version listed");
    const at = await b.page.$eval('#versions-items .project-row[data-where="account"]', (r) => r.dataset.at);
    svc.versions.set(svc.rows[0].id, []); // given up for room since the list was read
    await b.page.click(`#versions-items .project-row[data-at="${at}"] .version-restore`);
    await until(b.page, () => /no longer kept in your account/.test(document.getElementById("versions-status")?.textContent ?? ""), undefined, "said so");
    assert.equal(await b.page.evaluate(() => document.getElementById("versions").open), true, "stays open");
    assert.equal(await b.page.textContent("#volume"), now);
    await b.page.click("#versions-close");
  });

  await check("device A, behind, keeps its own change beside device B's as a copy", async () => {
    await insertPreset(a.page, "plate");
    await until(a.page, () => document.getElementById("save-status")?.dataset.state === "saved", undefined, "saved");
    for (let i = 0; i < 100 && svc.rows.length < 2; i++) await a.page.waitForTimeout(100);
    assert.deepEqual(svc.rows.map((r) => r.name).sort(), ["Untitled", "Untitled (copy)"]);
    await chooseFile(a.page, "file-my-designs");
    await until(a.page, () => /changed on another device too/.test(document.getElementById("my-designs-status")?.textContent ?? ""), undefined, "said so");
  });

  await check("Delete asks first, then deletes from the account only", async () => {
    const before = svc.rows.length;
    await a.page.click("#my-designs-items .my-design:first-child .my-design-delete");
    assert.match(await a.page.textContent("#my-designs-items .my-design:first-child .my-design-question"), /from your account\? The copy in this browser, if there is one, stays/);
    await a.page.click("#my-designs-items .my-design:first-child .my-design-delete-sure");
    await until(a.page, (n) => document.querySelectorAll("#my-designs-items .my-design").length === n, before - 1, "one fewer");
    assert.equal(svc.rows.length, before - 1);
    await a.page.click("#my-designs-close");
    await chooseFile(a.page, "file-projects");
    await until(a.page, () => document.querySelectorAll("#projects-items .project-row").length >= 1, undefined, "still in this browser");
    await a.page.click("#projects-close");
  });

  await check("the account's delete words name My designs", async () => {
    await a.page.click("#account-open");
    await a.page.click("#account .account-danger");
    assert.match(await a.page.textContent("#account .account-body"), /every design kept in your account \(My designs\)/);
    await a.page.click("#account .account-yours .account-action:not(.account-danger)");
    await a.page.click("#account .account-close");
  });

  await check("375 px with touch: the dialog fills the screen, buttons are 44 px, nothing runs off the side", async () => {
    const p = await device(svc, 375, true);
    await signIn(p.page, true);
    await until(p.page, () => document.getElementById("my-designs")?.open, undefined, "asks");
    const box = await p.page.locator("#my-designs").boundingBox();
    assert.ok(box.width >= 374 && box.x <= 1, `dialog ${JSON.stringify(box)}`);
    for (const b of await p.page.$$("#my-designs button")) {
      const r = await b.boundingBox();
      if (!r) continue;
      assert.ok(r.height >= 44, `a button ${r.height} px tall`);
      assert.ok(r.x >= 0 && r.x + r.width <= 375.5, "inside the screen");
    }
    assert.equal(await p.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
    if (shots) await p.page.screenshot({ path: `${shots}/my-designs-375.png` });
    await p.context.close();
  });

  await check("the service ends the session: the next change says so at the foot of the page, and the button offers Sign in (issue #628 item 4)", async () => {
    // The account's sessions ended from the service's side: its tokens are refused, and so is their renewal.
    svc.tokens.clear();
    svc.live.clear();
    assert.doesNotMatch(await a.page.textContent("#account-open"), /^Sign in$/, "signed in until now");
    const sent = svc.saves.length;
    // A new project, so the round has something to send (the one open was deleted from the account above).
    await chooseFile(a.page, "start-fresh");
    await a.page.click("#start-fresh-confirm");
    await a.page.locator("#start-hint").waitFor();
    await insertPreset(a.page, "sphere");
    await until(a.page, () => document.querySelector('#app-update[data-kind="signed-out"]') !== null, undefined, "the signed-out notice");
    assert.equal(await a.page.textContent("#app-update span"), "You're signed out, so your changes are no longer kept in your account. Sign in again to keep them.");
    assert.equal(svc.saves.length, sent, "nothing reached the account");
    assert.match(await a.page.textContent("#account-open"), /Sign in/, "the button no longer shows the name");
    if (shots) await a.page.screenshot({ path: `${shots}/signed-out-notice-1280.png` });
    await a.page.click("#app-update-reload");
    await until(a.page, () => document.querySelector("#account")?.open === true && document.querySelector("#app-update") === null, undefined, "the sign-in dialog, the notice gone");
    await a.page.click("#account .account-close");
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  await a.context.close();
  await b.context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  rmSync(dist, { recursive: true, force: true });
}
if (failed) process.exit(1);
