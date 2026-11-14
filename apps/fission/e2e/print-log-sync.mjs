// Browser check of the print log kept in the account (account features 5), in a real Chromium, against a fake account
// service answered by Playwright that keeps prints the way supabase/migrations/20261113120000_print_log.sql does (the
// later change kept, `since` started afresh when keeping is turned back on, off deleting the account's copy):
//   - a print made while signed out is never sent; signed in, the log's account line offers the box (ticked) and
//     "Keep these in my account" for it;
//   - a print file saved from Slice for printing while signed in reaches the account a few seconds later, the one made
//     signed out only once Keep these in my account is pressed;
//   - a second browser (a new device) brings both on signing in; its Failed (warped) shows on the first, open log and all;
//   - a print deleted on the first goes from the account and then from the second;
//   - unticking the box deletes the account's copy, the prints in each browser stay, and nothing more is sent;
//   - an account service that doesn't keep print logs yet shows no box, and the log still works;
//   - at 375 px with touch the box's row is 44 px tall and nothing runs off the side.
// Run with `npm run e2e` (it builds its own copy with accounts pointed at the fake). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const SERVICE = "https://test-accounts.supabase.co";
const KEY = "test-anon-key";
const USER_ID = "7f3c2a10-0000-4000-8000-000000000001";
const LOOSE = "00000000-0000-4000-8000-00000000000a";
const shots = process.env.SHOTS;
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = mkdtempSync(join(tmpdir(), "print-log-sync-e2e-"));
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
const server = await preview({ root, build: { outDir: dist }, preview: { port: 4923, strictPort: true }, logLevel: "error" });
const URL_ = "http://localhost:4923/";
const browser = await launch();

/** The account service: sign-in as in e2e/account.mjs, and the print log's requests as the database answers them. */
function fakeService() {
  const svc = { calls: [], saves: [], codes: new Map(), live: new Set(), tokens: new Set(), n: 0, rows: new Map(), keep: true, since: 1, missing: false };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer", "access-control-allow-methods": "POST, GET, PATCH, OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  const sinceText = () => new Date(Date.parse("2026-11-13T00:00:00Z") + svc.since).toISOString().replace("Z", "+00:00");
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
      const printLog = ["rpc/my_print_log", "rpc/save_prints", "rpc/delete_prints", "rpc/set_keep_print_log"].includes(what);
      if (printLog && svc.missing) return json(route, 404, { message: "not found" });
      if (what === "rpc/my_print_log") {
        const prints = [...svc.rows.values()].sort((a, b) => Date.parse(b.made_at) - Date.parse(a.made_at));
        return json(route, 200, { keep: svc.keep, since: sinceText(), prints });
      }
      if (what === "rpc/save_prints") {
        svc.saves.push(body);
        if (!svc.keep) return json(route, 200, { status: "off" });
        const list = body.p_prints;
        if (!Array.isArray(list) || list.length > 50) return json(route, 200, { status: "invalid" });
        const saved = [];
        const older = [];
        for (const p of list) {
          const had = svc.rows.get(p.id);
          if (had && Date.parse(p.updated_at) <= Date.parse(had.updated_at)) older.push(p.id);
          else {
            svc.rows.set(p.id, p);
            saved.push(p.id);
          }
        }
        return json(route, 200, { status: "done", saved, older, full: [] });
      }
      if (what === "rpc/delete_prints") {
        let n = 0;
        for (const id of body.p_ids) if (svc.rows.delete(id)) n++;
        return json(route, 200, n);
      }
      if (what === "rpc/set_keep_print_log") {
        const on = body.p_on === true;
        if (on !== svc.keep) svc.since++;
        svc.keep = on;
        if (!on) svc.rows.clear();
        return json(route, 200, on);
      }
      return json(route, 404, {}); // My designs' and settings' requests: this check's account keeps neither
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

async function device(svc, { width = 1280, phone = false, loose = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: phone ? 852 : 800 }, hasTouch: phone, isMobile: phone, acceptDownloads: true });
  await context.route(`${SERVICE}/**`, svc.handle);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // What the dialogs did, for a failure's message: each open and close, by id, with the time since the page loaded.
  const loads = [];
  page.on("load", () => loads.push(page.url()));
  await page.addInitScript(() => {
    const seen = (globalThis.__dialogs = []);
    document.addEventListener("toggle", (e) => e.target instanceof HTMLDialogElement && seen.push(`${Math.round(performance.now())} ${e.target.id} ${e.newState}`), true);
    // Every call that opens or closes one, too: toggle events queued in one go are merged into one.
    for (const name of ["showModal", "show", "close"]) {
      const real = HTMLDialogElement.prototype[name];
      HTMLDialogElement.prototype[name] = function (...args) {
        seen.push(`${Math.round(performance.now())} ${this.id} ${name}()`);
        return real.apply(this, args);
      };
    }
  });
  if (loose)
    // A print made here before anyone signed in, as the app keeps it (owner null).
    await page.addInitScript((id) => {
      if (localStorage.getItem("spindlelabs.print-log")) return;
      const t = "2026-11-12T02:00:00.000Z";
      localStorage.setItem("spindlelabs.print-log", JSON.stringify({ version: 1, prints: [{ id, madeAt: t, name: "Made signed out", settings: "0.2 mm layers", grams: 9.5, minutes: 42, result: "waiting", problem: null, note: "", updatedAt: t, owner: null }] }));
    }, LOOSE);
  await page.goto(URL_);
  await page.waitForSelector("#account-open", { state: "attached" });
  return { page, context, press: (sel) => (phone ? page.tap(sel) : page.click(sel)), phone, loads };
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
async function signIn(d) {
  const { page, phone } = d;
  if (phone) await page.tap("#menu-toggle");
  await d.press("#account-open");
  await d.press("#account .account-google");
  await until(page, () => document.getElementById("account-open")?.textContent === "Ada", undefined, "signed in");
  // A project already kept here makes My designs open to ask (e2e/my-designs.mjs checks that): closed unanswered.
  const asked = await page.waitForFunction(() => document.getElementById("my-designs")?.open, undefined, { timeout: 3000 }).then(() => true, () => false);
  if (asked) await d.press("#my-designs-close");
}
async function openLog(d) {
  await chooseFile(d.page, "file-print-log", d.phone);
  await d.page.waitForSelector("#print-log[open]");
}
const names = (page) => page.$$eval("#print-log-items .print-log-item .print-log-name", (els) => els.map((e) => e.textContent).sort());
/** What coming back to the tab or online does, without waiting a minute. */
const pull = (page) => page.evaluate(() => dispatchEvent(new Event("online")));

try {
  const svc = fakeService();
  const a = await device(svc, { loose: true });

  await check("signed out: the print made here is in the log and nothing is sent", async () => {
    await openLog(a);
    assert.deepEqual(await names(a.page), ["Made signed out"]);
    assert.equal(await a.page.$eval("#print-log-account", (e) => e.childElementCount), 0, "no account line signed out");
    await a.press("#print-log-close");
    assert.deepEqual(svc.calls, []);
  });

  await check("signed in: the box is ticked, the print made signed out stays here until Keep these in my account", async () => {
    await signIn(a);
    await untilNode(() => svc.calls.some((c) => c.endsWith("my_print_log")), "a first round");
    await openLog(a);
    await until(a.page, () => document.getElementById("print-log-keep")?.checked === true, undefined, "the box ticked");
    assert.match(await a.page.textContent("#print-log-others"), /^1 print in this browser was made while signed out, so it is kept only here\. On a shared computer it may be someone else's\./);
    assert.equal(svc.rows.size, 0, "not sent without asking");
    if (shots) await a.page.screenshot({ path: `${shots}/print-log-sync-1280.png` });
    await a.press("#print-log-close");
  });

  let sliced = "";
  await check("a print file saved while signed in reaches the account a few seconds later", async () => {
    await startWithBox(a.page);
    await chooseFile(a.page, "file-slice-print");
    await a.page.waitForSelector("#slice-print-dialog[open]");
    await Promise.all([a.page.waitForEvent("download"), a.page.click("#slice-print-go")]);
    await a.page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
    await a.page.click("#slice-print-close");
    const kept = await a.page.evaluate(() => JSON.parse(localStorage.getItem("spindlelabs.print-log")).prints.find((p) => p.owner !== null));
    assert.equal(kept.owner, USER_ID, "the print is marked as Ada's");
    sliced = kept.id;
    await untilNode(() => svc.rows.has(sliced), "sent");
    assert.equal(svc.rows.has(LOOSE), false, "the one made signed out is still not sent");
    assert.equal(svc.rows.get(sliced).owner, undefined, "no owner sent");
  });

  await check("Keep these in my account sends the print made signed out", async () => {
    await openLog(a);
    await until(a.page, () => !!document.getElementById("print-log-claim"), undefined, "the button");
    await a.press("#print-log-claim");
    await untilNode(() => svc.rows.has(LOOSE), "sent");
    await until(a.page, () => !document.getElementById("print-log-others"), undefined, "the line gone");
    await a.press("#print-log-close");
  });

  const b = await device(svc);
  await check("a new device brings both on signing in; its Failed shows on the first, log open", async () => {
    await signIn(b);
    await until(b.page, () => (JSON.parse(localStorage.getItem("spindlelabs.print-log") ?? "{}").prints ?? []).length === 2, undefined, "both brought");
    await openLog(b);
    assert.deepEqual(await names(b.page), ["Made signed out", "Untitled"]);
    const row = `.print-log-item:has(.print-log-name:text-is("Untitled"))`;
    await b.press(`${row} .print-log-failed`);
    await b.page.selectOption(`${row} .print-log-problem`, "warped");
    await untilNode(() => svc.rows.get(sliced)?.problem === "warped", "B's change sent");
    await openLog(a);
    await pull(a.page);
    await until(a.page, () => document.querySelector(".print-log-item .print-log-problem")?.value === "warped", undefined, "A shows Failed (warped)");
    await b.press("#print-log-close");
  });

  await check("a print deleted on the first goes from the account and then from the second", async () => {
    const row = `.print-log-item:has(.print-log-name:text-is("Made signed out"))`;
    await a.press(`${row} .print-log-delete`);
    await a.press(".print-log-delete-sure");
    await untilNode(() => !svc.rows.has(LOOSE), "deleted from the account");
    await pull(b.page);
    await until(b.page, () => (JSON.parse(localStorage.getItem("spindlelabs.print-log")).prints ?? []).length === 1, undefined, "deleted on B");
    await openLog(b);
    assert.deepEqual(await names(b.page), ["Untitled"]);
    await b.press("#print-log-close");
  });

  await check("unticking the box deletes the account's copy; each browser keeps its prints and sends nothing more", async () => {
    await until(a.page, () => document.getElementById("print-log-keep")?.disabled === false, undefined, "box ready");
    await a.press("#print-log-keep");
    await untilNode(() => !svc.keep && svc.rows.size === 0, "deleted from the account");
    await pull(b.page);
    await openLog(b);
    await until(b.page, () => document.getElementById("print-log-keep")?.checked === false, undefined, "B's box unticked");
    assert.deepEqual(await names(b.page), ["Untitled"], "B keeps its print");
    const saves = svc.saves.length;
    await b.press(".print-log-item .print-log-well");
    await b.page.waitForTimeout(6000); // longer than the 4 s wait before a send
    assert.equal(svc.saves.length, saves, "nothing sent once off");
    assert.equal(await a.page.evaluate(() => JSON.parse(localStorage.getItem("spindlelabs.print-log")).prints.length), 1, "A keeps its print");
    // A print made now is nobody's account's.
    assert.equal(await b.page.evaluate(() => localStorage.getItem("spindlelabs.print-log-owner")), null);
  });
  await a.context.close();
  await b.context.close();

  await check("an account service that doesn't keep print logs yet shows no box, and the log still works", async () => {
    const old = fakeService();
    old.missing = true;
    const c = await device(old, { loose: true });
    await signIn(c);
    await untilNode(() => old.calls.some((x) => x.endsWith("my_print_log")), "asked once");
    await openLog(c);
    await c.page.waitForTimeout(1000);
    assert.equal(await c.page.$("#print-log-keep"), null);
    await c.press(".print-log-item .print-log-well");
    assert.equal(await c.page.evaluate(() => JSON.parse(localStorage.getItem("spindlelabs.print-log")).prints[0].result), "well");
    await c.context.close();
  });

  await check("375 px with touch: the box's row is 44 px tall and nothing runs off the side", async () => {
    const phoneSvc = fakeService();
    const p = await device(phoneSvc, { width: 375, phone: true, loose: true });
    await signIn(p);
    await openLog(p);
    await until(p.page, () => document.getElementById("print-log-keep")?.disabled === false, undefined, "box ready");
    // The row and, for a failure's message, everything around it measured in the same moment: each box from the row up
    // to the page (display and size), whether the log is open, the window, and what the dialogs did; then the row again
    // a frame later, to tell a passing state from a lasting one.
    const seen = await p.page.evaluate(async () => {
      const label = document.querySelector("#print-log-account label");
      const row = label.getBoundingClientRect().toJSON();
      const up = [];
      for (let e = label; e; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        up.push(`${e.id || e.className || e.tagName} ${getComputedStyle(e).display} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      const at = { t: Math.round(performance.now()), up, connected: label.isConnected, open: document.getElementById("print-log")?.open, shown: [...document.querySelectorAll("dialog[open], :popover-open")].map((e) => e.id || e.className), window: `${innerWidth}x${innerHeight} ${document.visibilityState}` };
      await new Promise((r) => requestAnimationFrame(() => r()));
      const again = document.querySelector("#print-log-account label");
      return { row, at, later: { same: again === label, height: again?.getBoundingClientRect().height, dialogs: globalThis.__dialogs } };
    });
    const { row } = seen;
    assert.ok(row.height >= 44, `the box's row is ${row.height} px tall (${JSON.stringify({ ...seen, loads: p.loads })})`);
    assert.ok(row.right <= 375, `the row ends at ${row.right} px`);
    const claim = await p.page.$eval("#print-log-claim", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(claim.height >= 44 && claim.right <= 375, `Keep these: ${JSON.stringify(claim)}`);
    assert.ok(await p.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");
    if (shots) await p.page.screenshot({ path: `${shots}/print-log-sync-375.png` });
    await p.press("#print-log-claim");
    await untilNode(() => phoneSvc.rows.has(LOOSE), "sent by a tap");
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
