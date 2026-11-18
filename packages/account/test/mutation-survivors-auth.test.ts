// Tests for what the account mutation run (SpindleLabs #596 restarted it) found no test noticing in auth.ts: the
// browser's lock, asAnyone, the address left after a sign-in, which secrets a return tries, sign-out's renewal and
// its retry, a token another tab already renewed, a lock that finds someone else signed in, and the 401 retry of a
// request. Each test names the change it catches; each was shown red with that change planted by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, PENDING_KEY, PENDING_LIMIT, REFRESH_MARGIN_S, SESSION_KEY, type AuthDeps, type SmallStore } from "../src/auth.ts";
import { sessionToText, type Session } from "../src/session.ts";
import { newVerifier } from "../src/pkce.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";
const T0 = 1_800_000_000_000;

type Fetch = typeof fetch;
/** A fetch in front of the fake service: `answer` may give a reply of its own for a request, or undefined to pass it on. */
type Answer = (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>;

function setup(o: { answer?: Answer; store?: SmallStore & { m?: Map<string, string> }; lock?: AuthDeps["lock"]; noLockKey?: boolean } = {}) {
  let ms = T0;
  const clock = { now: () => ms, advance: (d: number) => void (ms += d) };
  const svc = fakeService(() => ms / 1000);
  const store = o.store ?? memoryStore();
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url.slice(SERVICE.length));
    const mine = o.answer ? await o.answer(url, init ?? {}) : undefined;
    return mine ?? svc.fetch(input, init);
  }) as Fetch;
  const deps: AuthDeps = { config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch, store, now: clock.now, random: seededRandom(1) };
  const client = authClient(o.noLockKey ? deps : { ...deps, lock: o.lock });
  return { clock, svc, store, client, calls };
}

/** Signs `client` in through the fake sign-in page; the session lasts an hour from now. */
async function signIn(t: ReturnType<typeof setup>): Promise<Session> {
  const go = await t.client.beginSignIn();
  const code = t.svc.approve(new URL(go!).searchParams.get("code_challenge")!);
  const r = await t.client.finishSignIn(`${APP}?code=${code}`);
  assert.equal(r.kind, "signed-in");
  return JSON.parse(t.store.getItem(SESSION_KEY)!) as Session;
}

/** A stored session as sessionToText writes it. */
function stored(accessToken: string, refreshToken: string, expiresAt: number, id = USER.id): string {
  return sessionToText({ accessToken, refreshToken, expiresAt, user: { id, email: USER.email, name: "Ada Maker" } });
}

const refreshes = (calls: string[]) => calls.filter((c) => c.includes("grant_type=refresh_token")).length;
const logouts = (calls: string[]) => calls.filter((c) => c.startsWith("/auth/v1/logout")).length;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** A lock that runs `fn` at once, as one tab alone holding navigator.locks would. */
const plainLock: NonNullable<AuthDeps["lock"]> = (_name, fn) => fn();

// --- the browser's own lock (browserLock) ---

test("with no lock given, renewals hold the browser's navigator.locks lock named for the person; with none, they take no lock", async (t) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => (had ? Object.defineProperty(globalThis, "navigator", had) : delete (globalThis as { navigator?: unknown }).navigator));
  const names: string[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: (name: string, fn: () => Promise<unknown>) => (names.push(name), fn()) } } });
  const a = setup({ noLockKey: true });
  const s = await signIn(a);
  a.clock.advance((s.expiresAt - T0 / 1000 - REFRESH_MARGIN_S + 1) * 1000); // within the margin: renewed first
  const tok = await a.client.accessToken();
  assert.equal(tok.kind, "ok"); // the lock's own answer is the renewal's (a lock that answered nothing would break this)
  assert.notEqual(tok.kind === "ok" && tok.token, s.accessToken);
  assert.deepEqual(names, [`spindle.account.renew.${USER.id}`]);

  // A browser with no navigator at all, or locks without request: the client still starts and renews.
  for (const nav of [undefined, { locks: {} }, {}]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav });
    const b = setup({ noLockKey: true });
    const sb = await signIn(b);
    b.clock.advance((sb.expiresAt - T0 / 1000) * 1000);
    assert.equal((await b.client.accessToken()).kind, "ok", JSON.stringify(nav));
  }
});

// --- asAnyone ---

test("asAnyone: signed out it sends the public key alone; signed in it adds the person's token; the path, body and answers are passed on", async () => {
  const seen: { url: string; auth: string | undefined; body: unknown }[] = [];
  let refuse = false;
  const answer: Answer = (url, init) => {
    if (!url.includes("/rest/v1/rpc/open_link")) return undefined;
    if (refuse) return new Response("{}", { status: 403 });
    const headers = init.headers as Record<string, string>;
    seen.push({ url: url.slice(SERVICE.length), auth: headers.authorization, body: JSON.parse(String(init.body)) });
    return json({ title: "Bracket" });
  };
  const t = setup({ answer });
  assert.deepEqual(await t.client.asAnyone("POST", "rpc/open_link", { link: "abc" }), { kind: "ok", body: { title: "Bracket" } });
  assert.deepEqual(await t.client.asAnyone("POST", "rpc/open_link"), { kind: "ok", body: { title: "Bracket" } });
  const s = await signIn(t);
  assert.deepEqual(await t.client.asAnyone("POST", "rpc/open_link", { link: "def" }), { kind: "ok", body: { title: "Bracket" } });
  assert.deepEqual(seen, [
    { url: "/rest/v1/rpc/open_link", auth: undefined, body: { link: "abc" } },
    { url: "/rest/v1/rpc/open_link", auth: undefined, body: {} }, // no body: an empty object, as PostgREST takes
    { url: "/rest/v1/rpc/open_link", auth: `Bearer ${s.accessToken}`, body: { link: "def" } },
  ]);
  // The service's refusal comes back as it is.
  refuse = true;
  assert.deepEqual(await t.client.asAnyone("POST", "rpc/open_link", {}), { kind: "failed", reason: "rejected" });
});

test("asAnyone: a token that can't be had offline or with the service down still sends the request anonymously; one this browser can't keep, or a garbled renewal, stops it", async () => {
  for (const [refreshReply, expected, sent] of [
    [() => { throw new TypeError("Failed to fetch"); }, { kind: "ok", body: "anon" }, true],
    [() => new Response("{}", { status: 503 }), { kind: "ok", body: "anon" }, true],
    [() => json({ access_token: "x" }), { kind: "failed", reason: "malformed" }, false],
  ] as const) {
    const auths: (string | undefined)[] = [];
    const t = setup({
      answer: (url, init) => {
        if (url.includes("grant_type=refresh_token")) return refreshReply();
        if (url.includes("/rest/v1/rpc/report_link")) return auths.push((init.headers as Record<string, string>).authorization), json("anon");
        return undefined;
      },
    });
    const s = await signIn(t);
    t.clock.advance((s.expiresAt - T0 / 1000) * 1000); // ran out: a renewal is needed first
    assert.deepEqual(await t.client.asAnyone("POST", "rpc/report_link", { why: "spam" }), expected);
    assert.deepEqual(auths, sent ? [undefined] : []);
  }
  // Renewed but this browser won't keep it: "storage", and nothing is sent.
  const m = new Map<string, string>();
  let full = false;
  const store = { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { if (full) throw new Error("QuotaExceededError"); m.set(k, v); }, removeItem: (k: string) => void m.delete(k) };
  let sent = 0;
  const t = setup({ store, answer: (url) => (url.includes("/rest/v1/rpc/report_link") ? (sent++, json("anon")) : undefined) });
  const s = await signIn(t);
  t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
  full = true;
  assert.deepEqual(await t.client.asAnyone("POST", "rpc/report_link", {}), { kind: "failed", reason: "storage" });
  assert.equal(sent, 0);
});

// --- finishSignIn: the address left, and which secrets are tried ---

test("the address after a sign-in keeps the app's own # part, and loses only the sign-in's error from it", async () => {
  const t = setup();
  const go = await t.client.beginSignIn();
  const code = t.svc.approve(new URL(go!).searchParams.get("code_challenge")!);
  const ok = await t.client.finishSignIn(`${APP}?code=${code}#design`);
  assert.equal(ok.kind === "signed-in" && ok.cleanUrl, `${APP}#design`); // not "#design=" from the hash rewritten as parameters
  await t.client.beginSignIn();
  const r = await t.client.finishSignIn(`${APP}#error=access_denied&error_description=no&tab=slice`);
  assert.deepEqual(r, { kind: "failed", reason: "cancelled", cleanUrl: `${APP}#tab=slice` });
});

test("an empty code with an error reports the error, not a cancel", async () => {
  // RFC 6749 4.1.2.1: server_error and temporarily_unavailable are the service's own trouble.
  const t = setup();
  await t.client.beginSignIn();
  const r = await t.client.finishSignIn(`${APP}?code=&error=server_error`);
  assert.equal(r.kind === "failed" && r.reason, "unavailable");
  await t.client.beginSignIn();
  const c = await t.client.finishSignIn(`${APP}?code=`);
  assert.equal(c.kind === "failed" && c.reason, "cancelled");
});

test("a return tries the next secret only after a refusal: with no network it stops at the first", async () => {
  const t = setup();
  await t.client.beginSignIn();
  await t.client.beginSignIn();
  t.svc.mode = "down";
  const r = await t.client.finishSignIn(`${APP}?code=code-99`);
  assert.equal(r.kind === "failed" && r.reason, "offline");
  assert.equal(t.calls.filter((c) => c.includes("grant_type=pkce")).length, 1);
});

test("only the newest PENDING_LIMIT secrets kept are tried, and a started time given as text is not a time", async () => {
  const t = setup();
  const verifiers = Array.from({ length: PENDING_LIMIT + 2 }, (_, i) => newVerifier(seededRandom(100 + i)));
  t.store.setItem(PENDING_KEY, JSON.stringify(verifiers.map((verifier) => ({ verifier, at: T0 }))));
  const { createHash } = await import("node:crypto");
  const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");
  // The code belongs to the oldest secret, past the limit: it is never tried.
  const old = t.svc.approve(challengeOf(verifiers[0]!));
  const r = await t.client.finishSignIn(`${APP}?code=${old}`);
  assert.equal(r.kind === "failed" && r.reason, "rejected");
  assert.equal(t.calls.filter((c) => c.includes("grant_type=pkce")).length, PENDING_LIMIT);

  const u = setup();
  const v = newVerifier(seededRandom(200));
  u.store.setItem(PENDING_KEY, JSON.stringify([{ verifier: v, at: String(T0) }]));
  const r2 = await u.client.finishSignIn(`${APP}?code=${u.svc.approve(challengeOf(v))}`);
  assert.equal(r2.kind === "failed" && r2.reason, "expired");
  assert.equal(u.calls.length, 0);
  // A list holding null is a damaged list, not a crash.
  u.store.setItem(PENDING_KEY, "[null]");
  assert.equal((await u.client.finishSignIn(`${APP}?code=x`)).kind, "failed");
});

// --- signOut ---

test("sign-out renews a token within the margin first (exactly REFRESH_MARGIN_S left counts), holding the lock though this browser's copy is gone", async () => {
  // Exactly at the margin: renewed (<=). With a lock, the renewal must not re-read the store, which sign-out just cleared.
  const t = setup({ lock: plainLock });
  const s = await signIn(t);
  t.clock.advance((s.expiresAt - T0 / 1000 - REFRESH_MARGIN_S) * 1000);
  assert.deepEqual(await t.client.signOut(), { ended: true });
  assert.equal(refreshes(t.calls), 1);
  assert.equal(t.svc.loggedOut.length, 1);
  assert.notEqual(t.svc.loggedOut[0], `Bearer ${s.accessToken}`); // the renewed token, not the old one
});

test("sign-out's renewal: offline or a garbled answer keeps the session open there (garbled says unavailable); refused means it is over", async () => {
  for (const [reply, expected] of [
    [() => { throw new TypeError("Failed to fetch"); }, { ended: false, reason: "offline" }],
    [() => json({ nonsense: true }), { ended: false, reason: "unavailable" }],
    [() => new Response("{}", { status: 400 }), { ended: true }],
  ] as const) {
    const t = setup({ answer: (url) => (url.includes("grant_type=refresh_token") ? reply() : undefined) });
    const s = await signIn(t);
    t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
    assert.deepEqual(await t.client.signOut(), expected);
    assert.equal(logouts(t.calls), 0);
  }
});

test("sign-out refused with 401: renewed once and asked again; a refused renewal ends it; never renewed twice; other errors are not retried", async () => {
  // 401 then refused renewal: over at the service, with no second logout.
  const a = setup({ answer: (url) => (url.includes("/logout") ? new Response("{}", { status: 401 }) : url.includes("grant_type=refresh_token") ? new Response("{}", { status: 400 }) : undefined) });
  await signIn(a);
  assert.deepEqual(await a.client.signOut(), { ended: true });
  assert.equal(logouts(a.calls), 1);
  // Renewed first (ran out), then a 401 anyway: not renewed a second time.
  const b = setup({ answer: (url) => (url.includes("/logout") ? new Response("{}", { status: 401 }) : undefined) });
  const s = await signIn(b);
  b.clock.advance((s.expiresAt - T0 / 1000) * 1000);
  assert.deepEqual(await b.client.signOut(), { ended: false, reason: "rejected" });
  assert.equal(refreshes(b.calls), 1);
  assert.equal(logouts(b.calls), 1);
  // A fresh token and the service down (503): no renewal, no retry.
  const c = setup({ answer: (url) => (url.includes("/logout") ? new Response("{}", { status: 503 }) : undefined) });
  await signIn(c);
  assert.deepEqual(await c.client.signOut(), { ended: false, reason: "unavailable" });
  assert.equal(refreshes(c.calls), 0);
  assert.equal(logouts(c.calls), 1);
});

// --- token(): another tab, another person ---

test("a token refused (401) after another tab already renewed is used as it is, not renewed again", async () => {
  let once = true;
  const t = setup({
    answer: (url) => {
      if (once && url.includes("/rest/v1/profiles")) {
        once = false;
        // Another tab renewed meanwhile: the store holds a newer session the service takes.
        t.store.setItem(SESSION_KEY, stored("access-other-tab", "refresh-other-tab", T0 / 1000 + 3600));
        return new Response("{}", { status: 401 });
      }
      if (url.includes("/rest/v1/profiles")) return json([{ email_opt_in: true }]);
      return undefined;
    },
  });
  await signIn(t);
  assert.deepEqual(await t.client.asPerson("GET", "profiles?select=email_opt_in"), { kind: "ok", body: [{ email_opt_in: true }] });
  assert.equal(refreshes(t.calls), 0);
});

test("a renewal refused while another tab stored a fresh session of the same person: the request goes on with that one", async () => {
  // Both asPerson's first token and its 401 retry may retry once (token(true)): the other tab's session is used.
  for (const first401 of [false, true]) {
    let refreshed = false;
    let failedOnce = !first401;
    const t = setup({
      answer: (url) => {
        if (url.includes("grant_type=refresh_token")) {
          refreshed = true;
          t.store.setItem(SESSION_KEY, stored("access-tab2", "refresh-tab2", T0 / 1000 + 7200));
          return new Response('{"error":"invalid_grant"}', { status: 400 }); // its refresh token was used by the other tab
        }
        if (url.includes("/rest/v1/thing")) {
          if (!failedOnce) return (failedOnce = true), new Response("{}", { status: 401 });
          return json("done");
        }
        return undefined;
      },
    });
    const s = await signIn(t);
    if (!first401) t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
    assert.deepEqual(await t.client.asPerson("GET", "thing"), { kind: "ok", body: "done" }, `first401 ${first401}`);
    assert.ok(refreshed);
  }
});

test("a refused renewal whose stored copy can't be removed ends signed out after one retry, not in a loop", async () => {
  const m = new Map<string, string>();
  const store = { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: () => { throw new Error("blocked"); } };
  let n = 0;
  const t = setup({
    store,
    answer: (url) => {
      if (!url.includes("grant_type=refresh_token")) return undefined;
      n++;
      if (n > 5) throw new Error("renewing in a loop");
      // Another tab stored another session of the same person, run out too, whose refresh token is also used up.
      m.set(SESSION_KEY, stored(`access-x${n}`, `refresh-x${n}`, T0 / 1000));
      return new Response("{}", { status: 400 });
    },
  });
  const s = await signIn(t);
  t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
  assert.deepEqual(await t.client.accessToken(), { kind: "signed-out" });
  assert.equal(n, 2);
});

// --- renew(): the lock ---

test("holding the lock, a renewal that finds another person (or nobody) stored now gives no token at all", async () => {
  for (const replacement of [stored("access-bob", "refresh-bob", T0 / 1000 + 3600, "00000000-0000-4000-8000-0000000000b0"), null]) {
    let t: ReturnType<typeof setup>;
    const lock: NonNullable<AuthDeps["lock"]> = (_n, fn) => {
      // Waiting for the lock, another tab signed out and someone else (or no one) signed in.
      if (replacement === null) t.store.removeItem(SESSION_KEY);
      else t.store.setItem(SESSION_KEY, replacement);
      return fn();
    };
    t = setup({ lock });
    const s = await signIn(t);
    t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
    assert.deepEqual(await t.client.accessToken(), { kind: "signed-out" }, String(replacement));
    assert.equal(refreshes(t.calls), 0);
  }
});

test("a lock that fails renews without it", async () => {
  const t = setup({ lock: () => Promise.reject(new Error("lock manager gone")) });
  const s = await signIn(t);
  t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
  const r = await t.client.accessToken();
  assert.equal(r.kind, "ok");
  assert.equal(refreshes(t.calls), 1);
});

// --- asPersonTo: the 401 retry ---

test("a 401 whose renewal fails says why and sends nothing more; a retried request carries the same body", async () => {
  const bodies: unknown[] = [];
  let first = true;
  const a = setup({
    answer: (url, init) => {
      if (url.includes("grant_type=refresh_token")) return new Response("{}", { status: 503 });
      if (url.includes("/rest/v1/profiles")) return bodies.push(init.body), new Response("{}", { status: 401 });
      return undefined;
    },
  });
  await signIn(a);
  assert.deepEqual(await a.client.asPerson("PATCH", "profiles?id=eq.x", { email_opt_in: true }), { kind: "failed", reason: "unavailable" });
  assert.equal(bodies.length, 1);

  const b = setup({
    answer: (url, init) => {
      if (!url.includes("/rest/v1/profiles")) return undefined;
      bodies.push(JSON.parse(String(init.body)));
      if (first) return (first = false), new Response("{}", { status: 401 });
      return new Response(null, { status: 204 });
    },
  });
  await signIn(b);
  bodies.length = 0;
  assert.equal((await b.client.asPerson("PATCH", "profiles?id=eq.x", { email_opt_in: true })).kind, "ok");
  assert.deepEqual(bodies, [{ email_opt_in: true }, { email_opt_in: true }]);
});

test("a renewal that worked while another tab stored yet another session retries once, then gives up signed out (no loop)", async () => {
  let n = 0;
  const t = setup({
    answer: async (url, init) => {
      if (!url.includes("grant_type=refresh_token")) return undefined;
      n++;
      if (n > 5) throw new Error("renewing in a loop");
      const real = await t.svc.fetch(url, init); // the renewal itself works (it is stored over the session renewed)...
      const body = await real.json();
      // ...but meanwhile another tab stored another session of the same person, already run out.
      t.svc.liveRefresh.add(`refresh-y${n}`); // and the service still takes its refresh token
      queueMicrotask(() => t.store.setItem(SESSION_KEY, stored(`access-y${n}`, `refresh-y${n}`, T0 / 1000)));
      await new Promise((r) => setTimeout(r, 0));
      return json(body);
    },
  });
  const s = await signIn(t);
  t.clock.advance((s.expiresAt - T0 / 1000) * 1000);
  assert.deepEqual(await t.client.accessToken(), { kind: "signed-out" });
  assert.equal(n, 2);
});

test("a name's leading spaces don't count against its NAME_MAX characters", async () => {
  // Trimmed before the cut: 10 spaces then 100 letters keeps all 100 letters (cut first, it would keep 90).
  const { sessionFromReply, NAME_MAX } = await import("../src/session.ts");
  const r = sessionFromReply({ access_token: "a", refresh_token: "r", expires_in: 60, user: { id: "abc", email: "e@x", user_metadata: { full_name: " ".repeat(10) + "a".repeat(NAME_MAX) } } }, 0);
  assert.equal(r?.user.name, "a".repeat(NAME_MAX));
});
