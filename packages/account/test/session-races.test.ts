// Regression tests for the sign-in and session bugs found by the account bug hunt of 2026-11-11 (issue #544, items
// 1-9): renewals racing a sign-out or each other, a computer clock that differs from the service's, a long name, two
// sign-ins at once, signing out with a token that ran out, and errors on the return from the sign-in page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, PENDING_KEY, PENDING_LIMIT, PENDING_MAX_MS, SESSION_KEY } from "../src/auth.ts";
import { NAME_MAX, sessionFromReply, sessionFromText, sessionToText } from "../src/session.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";
const HOUR_MS = 3600 * 1000;

/** A service clock, and this computer's clock `skewMs` away from it (negative: slow). */
function setup(skewMs = 0) {
  let ms = 1_800_000_000_000;
  const clock = { now: () => ms + skewMs, advance: (d: number) => void (ms += d), serviceS: () => ms / 1000 };
  const svc = fakeService(() => ms / 1000);
  const store = memoryStore();
  const tab = (seed: number, f: typeof fetch = svc.fetch) =>
    // lock: undefined, so these tabs take no lock whatever the Node version (newer ones have navigator.locks, and a
    // held renewal there would block another tab of the test forever); the two-tab lock tests give their own.
    authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: f, store, now: clock.now, random: seededRandom(seed), lock: undefined });
  return { clock, svc, store, tab, client: tab(1) };
}

type Client = ReturnType<typeof setup>["client"];
type Svc = ReturnType<typeof setup>["svc"];

/** What the sign-in page does: approve the challenge in the address and send the browser back with a code. */
async function signInPage(client: Client, svc: Svc): Promise<string> {
  const go = await client.beginSignIn();
  assert.ok(go);
  const code = svc.approve(new URL(go).searchParams.get("code_challenge")!);
  const back = new URL(APP);
  back.searchParams.set("code", code);
  return back.href;
}

/** A fetch that holds every renewal request until `release()` (a slow network). */
function holdRenewals(inner: typeof fetch) {
  const waiting: (() => void)[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("grant_type=refresh_token")) await new Promise<void>((r) => waiting.push(r));
    return inner(input, init);
  }) as typeof fetch;
  return { fetch: f, release: () => waiting.splice(0).forEach((r) => r()) };
}

/**
 * The service as the real one checks tokens: the data API and sign-out refuse (401) an access token whose expiry by
 * the service's own clock has passed, whatever this computer's clock says.
 */
function strictExpiry(svc: Svc, serviceS: () => number) {
  const expiry = new Map<string, number>();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const bearer = ((init?.headers ?? {}) as Record<string, string>).authorization?.replace(/^Bearer /, "");
    const checked = url.includes("/rest/v1/") || url.includes("/logout");
    if (checked && bearer && (expiry.get(bearer) ?? 0) <= serviceS()) return new Response('{"message":"JWT expired"}', { status: 401 });
    const res = await svc.fetch(input, init);
    if (url.includes("/auth/v1/token") && res.status === 200) {
      const b = await res.clone().json();
      expiry.set(b.access_token, b.expires_at);
    }
    return res;
  }) as typeof fetch;
}

const renewals = (svc: Svc) => svc.calls.filter((c) => c.url.includes("grant_type=refresh_token")).length;

// Item 1
test("signing out while a renewal is on its way stays signed out: the late answer is dropped", async () => {
  const { clock, svc, store, tab } = setup();
  const held = holdRenewals(svc.fetch);
  const client = tab(1, held.fetch);
  assert.equal((await client.finishSignIn(await signInPage(client, svc))).kind, "signed-in");
  clock.advance(HOUR_MS); // the token has run out: the next request renews it first
  const pending = client.accessToken();
  await new Promise((r) => setTimeout(r, 0));
  // Signing out waits for the renewal already on its way (it uses the same refresh token), so it is not awaited here.
  const out = client.signOut();
  assert.equal(client.state().kind, "signed-out", "signed out on this device at once");
  held.release();
  assert.deepEqual(await pending, { kind: "signed-out" });
  await out;
  assert.equal(client.state().kind, "signed-out", "the late renewal answer signed the person back in");
  assert.equal(store.m.has(SESSION_KEY), false);
});

// Item 2
test("a late renewal for person 1 never replaces person 2's sign-in made meanwhile in another tab", async () => {
  const { clock, svc, store, tab } = setup();
  const held = holdRenewals(svc.fetch);
  const tabA = tab(1, held.fetch);
  await tabA.finishSignIn(await signInPage(tabA, svc));
  clock.advance(HOUR_MS);
  const pending = tabA.accessToken();
  await new Promise((r) => setTimeout(r, 0));
  // Tab B: person 1 signs out, person 2 signs in.
  const tabB = tab(2);
  await tabB.signOut();
  const second = { ...USER, id: "7f3c2a10-0000-4000-8000-000000000002", email: "second@example.com", user_metadata: { full_name: "Bea Second" } };
  svc.nextBody = { access_token: "access-p2", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(clock.serviceS()) + 3600, refresh_token: "refresh-p2", user: second };
  assert.equal((await tabB.finishSignIn(await signInPage(tabB, svc))).kind, "signed-in");
  const p2 = store.m.get(SESSION_KEY);
  held.release();
  // Tab A's caller started as person 1: it never gets person 2's token.
  assert.deepEqual(await pending, { kind: "signed-out" });
  assert.equal(store.m.get(SESSION_KEY), p2, "person 2's stored session was changed");
  assert.equal(sessionFromText(store.m.get(SESSION_KEY))?.user.email, "second@example.com");
});

// Item 3
test("expiry counts from this computer's clock: expires_in is used even when the reply also gives expires_at", () => {
  // Worked by hand: the service says the token lasts 3600 s and, by its clock, ends at 9999 s. This computer's clock
  // reads 1000 s, so by this computer's clock the token ends at 1000 + 3600 = 4600 s.
  const reply = { access_token: "a", refresh_token: "r", expires_in: 3600, expires_at: 9999, user: USER };
  assert.equal(sessionFromReply(reply, 1000)?.expiresAt, 4600);
});

test("a computer clock 2 hours slow: after the first hour requests still work (the token is renewed)", async () => {
  const { clock, svc, tab } = setup(-2 * HOUR_MS);
  const client = tab(1, strictExpiry(svc, clock.serviceS));
  await client.finishSignIn(await signInPage(client, svc));
  assert.equal((await client.asPerson("GET", "profiles?select=email_opt_in")).kind, "ok");
  clock.advance(3700 * 1000); // past the token's hour by both clocks' reckoning of elapsed time
  const r = await client.asPerson("GET", "profiles?select=email_opt_in");
  assert.equal(r.kind, "ok", `after an hour: ${JSON.stringify(r)}`);
  assert.equal(renewals(svc), 1);
});

test("a computer clock 2 hours fast renews once, not on every request", async () => {
  const { svc, client } = setup(2 * HOUR_MS);
  await client.finishSignIn(await signInPage(client, svc));
  for (let i = 0; i < 5; i++) assert.equal((await client.accessToken()).kind, "ok");
  assert.equal(renewals(svc), 0, "5 requests within a second of signing in need no renewal");
});

/** A fetch whose data API refuses (401) any access token in `refused`, as the service does with one it no longer takes. */
function refusing(inner: typeof fetch, refused: Set<string>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const bearer = ((init?.headers ?? {}) as Record<string, string>).authorization?.replace(/^Bearer /, "") ?? "";
    if (String(input).includes("/rest/v1/") && refused.has(bearer)) return new Response('{"message":"JWT expired"}', { status: 401 });
    return inner(input, init);
  }) as typeof fetch;
}

test("a data request refused as unauthorised (401) is renewed once and tried again", async () => {
  const { svc, tab } = setup();
  const refused = new Set<string>();
  const client = tab(1, refusing(svc.fetch, refused));
  await client.finishSignIn(await signInPage(client, svc));
  // The service stops taking this token early (its clock jumped ahead), though this computer still thinks it is good.
  const t = await client.accessToken();
  assert.equal(t.kind, "ok");
  refused.add(t.kind === "ok" ? t.token : "");
  assert.deepEqual(await client.asPerson("GET", "profiles?select=email_opt_in"), { kind: "ok", body: [{ email_opt_in: false }] });
  assert.equal(renewals(svc), 1);
  assert.notDeepEqual(await client.accessToken(), t, "the renewed token is kept");
});

test("a data request refused again after the renewal is reported as refused, after exactly one renewal", async () => {
  const { svc, tab } = setup();
  const refuseAll = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).includes("/rest/v1/") ? new Response('{"message":"permission denied"}', { status: 401 }) : svc.fetch(input, init)) as typeof fetch;
  const client = tab(1, refuseAll);
  await client.finishSignIn(await signInPage(client, svc));
  assert.deepEqual(await client.asPerson("GET", "profiles?select=email_opt_in"), { kind: "failed", reason: "rejected" });
  assert.equal(renewals(svc), 1);
  assert.equal(client.state().kind, "signed-in", "a refused data request never signs out");
});

test("a 403 from the data API is not a token problem: no renewal, reported as refused", async () => {
  const { svc, tab } = setup();
  const forbid = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).includes("/rest/v1/") ? new Response("{}", { status: 403 }) : svc.fetch(input, init)) as typeof fetch;
  const client = tab(1, forbid);
  await client.finishSignIn(await signInPage(client, svc));
  assert.deepEqual(await client.asPerson("GET", "profiles?select=email_opt_in"), { kind: "failed", reason: "rejected" });
  assert.equal(renewals(svc), 0);
});

test("a server function refused as unauthorised (401) is renewed once and tried again too", async () => {
  const { svc, tab } = setup();
  let first = "";
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).includes("/functions/v1/")) return svc.fetch(input, init);
    const bearer = ((init?.headers ?? {}) as Record<string, string>).authorization ?? "";
    return bearer === `Bearer ${first}` ? new Response("{}", { status: 401 }) : new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  const client = tab(1, fn);
  await client.finishSignIn(await signInPage(client, svc));
  const t = await client.accessToken();
  first = t.kind === "ok" ? t.token : "";
  assert.deepEqual(await client.asPersonFunction("billing"), { kind: "ok", body: { ok: true } });
  assert.equal(renewals(svc), 1);
});

// Item 4
test("a Google name whose 100th character is a space: the person stays signed in after signing in", async () => {
  const { svc, client, clock } = setup();
  const long = `${"A".repeat(99)} Bartholomew`; // 99 letters, a space as character 100, more after
  svc.nextBody = { access_token: "access-x", token_type: "bearer", expires_in: 3600, refresh_token: "refresh-x", user: { ...USER, user_metadata: { full_name: long } }, expires_at: Math.floor(clock.serviceS()) + 3600 };
  const r = await client.finishSignIn(await signInPage(client, svc));
  assert.equal(r.kind, "signed-in");
  // Worked by hand: cutting to 100 characters keeps the 99 A's and the space; the space at the end is then trimmed.
  assert.equal(r.kind === "signed-in" && r.user.name, "A".repeat(99));
  assert.equal(client.state().kind, "signed-in", "the stored session was refused on the very next read");
});

test("every name survives being stored and read back (300 seeded names of spaces, letters, emoji and control characters)", () => {
  const random = seededRandom(544);
  const byte = () => {
    const b = new Uint8Array(1);
    random(b);
    return b[0]!;
  };
  const pieces = [" ", "\t", "\n", " ", "　", "A", "é", "🙂", "\u0007", "‮", "‏", " x"];
  for (let i = 0; i < 300; i++) {
    // Lengths around NAME_MAX, where the cut falls: from NAME_MAX - 10 to NAME_MAX + 117.
    const n = NAME_MAX - 10 + (byte() >> 1);
    let raw = "";
    for (let k = 0; k < n; k++) raw += pieces[byte() % pieces.length];
    const s = sessionFromReply({ access_token: "a", refresh_token: "r", expires_in: 60, user: { ...USER, user_metadata: { full_name: raw } } }, 1000);
    assert.ok(s);
    assert.ok([...s.user.name].length <= NAME_MAX);
    assert.equal(s.user.name, s.user.name.trim(), `name ${JSON.stringify(raw)} kept with space at an end`);
    assert.deepEqual(sessionFromText(sessionToText(s)), s, `name ${JSON.stringify(raw)} did not survive storing`);
  }
});

// Item 5
test("two requests in one tab that both need a renewal at once share one renewal: both get the same new token", async () => {
  const { clock, svc, store, client } = setup();
  await client.finishSignIn(await signInPage(client, svc));
  clock.advance(HOUR_MS);
  const removed: string[] = [];
  const orig = store.removeItem;
  store.removeItem = (k: string) => {
    if (k === SESSION_KEY) removed.push(k);
    orig(k);
  };
  // At start the app runs My designs' send and the settings sync together; both find the token running out.
  const [a, b] = await Promise.all([client.accessToken(), client.accessToken()]);
  assert.equal(a.kind, "ok");
  assert.deepEqual(b, a);
  assert.equal(renewals(svc), 1);
  assert.deepEqual(removed, [], "the session was removed from storage meanwhile (other tabs would show Sign in)");
  assert.equal(client.state().kind, "signed-in");
});

test("a renewal shared by two requests that the service refuses signs out once, and both are told", async () => {
  const { clock, svc, client } = setup();
  await client.finishSignIn(await signInPage(client, svc));
  clock.advance(HOUR_MS);
  svc.liveRefresh.clear(); // signed out of everywhere from another device
  const [a, b] = await Promise.all([client.accessToken(), client.accessToken()]);
  assert.deepEqual([a, b], [{ kind: "signed-out" }, { kind: "signed-out" }]);
  assert.equal(renewals(svc), 1);
  assert.equal(client.state().kind, "signed-out");
});

/** A lock shared by every tab of one browser, as navigator.locks is: one holder per name at a time, in order. */
function sharedLock() {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  const lock = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    names.push(name);
    const run = (tails.get(name) ?? Promise.resolve()).then(fn);
    tails.set(name, run.catch(() => undefined));
    return run;
  };
  return { lock, names };
}

test("two tabs that both need a renewal at once: one renews, the other uses its answer, and neither is signed out", async () => {
  const { clock, svc, store } = setup();
  const { lock, names } = sharedLock();
  const tabOf = (seed: number) =>
    authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store, now: clock.now, random: seededRandom(seed), lock });
  const tabA = tabOf(1);
  await tabA.finishSignIn(await signInPage(tabA, svc));
  const tabB = tabOf(2);
  clock.advance(HOUR_MS);
  const removed: string[] = [];
  const orig = store.removeItem;
  store.removeItem = (k: string) => {
    if (k === SESSION_KEY) removed.push(k);
    orig(k);
  };
  // The fake service rotates refresh tokens strictly: a second renewal with the same one is refused.
  const [a, b] = await Promise.all([tabA.accessToken(), tabB.accessToken()]);
  assert.deepEqual([a.kind, b.kind], ["ok", "ok"]);
  assert.deepEqual(b, a, "both tabs use the one new token");
  assert.equal(renewals(svc), 1, "the second tab renewed again instead of using the first tab's answer");
  assert.deepEqual(removed, [], "the session was removed from storage (other tabs got a storage event and showed Sign in)");
  assert.equal(tabB.state().kind, "signed-in");
  assert.deepEqual(names, [`spindle.account.renew.${USER.id}`, `spindle.account.renew.${USER.id}`], "one lock per person");
});

test("without a lock, a refused renewal never removes a newer session the same person's other tab stored meanwhile", async () => {
  const { clock, svc, store } = setup();
  const held = holdRenewals(svc.fetch);
  const tabOf = (seed: number, f: typeof fetch) =>
    authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: f, store, now: clock.now, random: seededRandom(seed), lock: undefined });
  const tabA = tabOf(1, svc.fetch);
  await tabA.finishSignIn(await signInPage(tabA, svc));
  const tabB = tabOf(2, held.fetch);
  clock.advance(HOUR_MS);
  const late = tabB.accessToken(); // tab B's renewal is slow...
  await new Promise((r) => setTimeout(r, 0));
  const a = await tabA.accessToken(); // ...tab A renews first and stores the new session
  const newer = store.m.get(SESSION_KEY);
  held.release();
  assert.deepEqual(await late, a, "tab B's refused renewal falls back to tab A's newer session");
  assert.equal(store.m.get(SESSION_KEY), newer);
});

// Item 6
test("two sign-ins started in two tabs before the first returns: the later one still finishes", async () => {
  const { svc, tab } = setup();
  const tab1 = tab(1);
  const tab2 = tab(2);
  const back1 = await signInPage(tab1, svc); // tab 1 goes to the sign-in page...
  const back2 = await signInPage(tab2, svc); // ...and before it returns, tab 2 starts one too
  const r1 = await tab1.finishSignIn(back1);
  const r2 = await tab2.finishSignIn(back2);
  assert.equal(r2.kind, "signed-in", `sign-ins ended as ${JSON.stringify([r1, r2].map((r) => (r.kind === "failed" ? r.reason : r.kind)))}`);
});

test("two sign-ins started in two tabs both finish with a service that keeps a code after a wrong secret", async () => {
  const { svc, tab } = setup();
  svc.keepCodeOnWrongSecret = true;
  const tab1 = tab(1);
  const tab2 = tab(2);
  const back1 = await signInPage(tab1, svc);
  const back2 = await signInPage(tab2, svc);
  assert.equal((await tab1.finishSignIn(back1)).kind, "signed-in");
  assert.equal((await tab2.finishSignIn(back2)).kind, "signed-in");
});

test("an abandoned sign-in followed by a new one: the new one finishes and the old secret is gone", async () => {
  const { svc, store, client } = setup();
  await client.beginSignIn(); // went to the sign-in page, came back with Back
  const back = await signInPage(client, svc); // pressed Sign in again
  assert.equal((await client.finishSignIn(back)).kind, "signed-in");
  const left = JSON.parse(store.m.get(PENDING_KEY) ?? "[]");
  assert.equal(left.length, 1, "only the abandoned one is left, until it is too old");
});

test("started sign-ins are kept at most PENDING_LIMIT at a time, and ones older than PENDING_MAX_MS are dropped", async () => {
  const { clock, store, client } = setup();
  for (let i = 0; i < PENDING_LIMIT + 3; i++) await client.beginSignIn();
  assert.equal(JSON.parse(store.m.get(PENDING_KEY)!).length, PENDING_LIMIT);
  // 1.1 × the limit later, every one of them is too old: starting another keeps only the new one.
  clock.advance(1.1 * PENDING_MAX_MS);
  await client.beginSignIn();
  assert.equal(JSON.parse(store.m.get(PENDING_KEY)!).length, 1);
});

test("a sign-in kept from before this change (one secret, not a list) still finishes", async () => {
  const { svc, store, client } = setup();
  const back = await signInPage(client, svc);
  const [only] = JSON.parse(store.m.get(PENDING_KEY)!);
  store.m.set(PENDING_KEY, JSON.stringify(only)); // the old shape: { verifier, at }
  assert.equal((await client.finishSignIn(back)).kind, "signed-in");
  assert.equal(store.m.has(PENDING_KEY), false);
});

// Item 7
test("signing out after the access token ran out renews it first, so the session is ended at the service", async () => {
  const { clock, svc, tab } = setup();
  const client = tab(1, strictExpiry(svc, clock.serviceS));
  await client.finishSignIn(await signInPage(client, svc));
  clock.advance(2 * HOUR_MS); // came back the next morning, opened Account, pressed Sign out
  const before = [...svc.liveRefresh];
  assert.deepEqual(await client.signOut(), { ended: true });
  // The logout carried the renewed token: the old refresh token was used up by the renewal, and the new one is the
  // one the logout ends at the service.
  assert.equal(renewals(svc), 1);
  assert.deepEqual(before.filter((t) => svc.liveRefresh.has(t)), []);
  // Worked by hand from the fake's one counter: the sign-in page's code is code-1, the sign-in gives access-2 and
  // refresh-2, the renewal gives access-3. The logout must carry access-3, not the expired access-2.
  assert.deepEqual(svc.loggedOut, ["Bearer access-3"]);
  assert.equal(client.state().kind, "signed-out");
});

test("signing out says why the service didn't end the session: offline, having trouble, or refused", async () => {
  for (const [mode, reason] of [["down", "offline"], [503, "unavailable"], [403, "rejected"]] as const) {
    const { svc, tab } = setup();
    // Only the logout is answered this way; the sign-in before it works.
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes("/logout")) return svc.fetch(input, init);
      if (mode === "down") throw new TypeError("Failed to fetch");
      return new Response("{}", { status: mode });
    }) as typeof fetch;
    const client = tab(1, f);
    await client.finishSignIn(await signInPage(client, svc));
    assert.deepEqual(await client.signOut(), { ended: false, reason }, String(mode));
    assert.equal(client.state().kind, "signed-out");
  }
});

test("a logout refused as unauthorised (401) with a token this computer thinks is good is renewed once and asked again", async () => {
  const { svc, tab } = setup();
  let refuse = 1;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("/logout") && refuse-- > 0) return new Response("{}", { status: 401 });
    return svc.fetch(input, init);
  }) as typeof fetch;
  const client = tab(1, f);
  await client.finishSignIn(await signInPage(client, svc));
  assert.deepEqual(await client.signOut(), { ended: true });
  assert.equal(renewals(svc), 1);
  assert.equal(svc.loggedOut.length, 1);
});

test("signing out with a token that ran out and a service that refuses the renewal: the session can't be renewed any more", async () => {
  const { clock, svc, client } = setup();
  await client.finishSignIn(await signInPage(client, svc));
  clock.advance(2 * HOUR_MS);
  svc.liveRefresh.clear(); // already ended at the service (signed out everywhere from another device)
  assert.deepEqual(await client.signOut(), { ended: true });
  assert.equal(svc.loggedOut.length, 0);
});

// Item 8
test("an error from the service itself on the return is not reported as the person cancelling", async () => {
  const cases = [
    ["server_error", "unavailable"],
    ["temporarily_unavailable", "unavailable"],
    ["invalid_request", "rejected"],
    ["unauthorized_client", "rejected"],
    ["access_denied", "cancelled"],
  ] as const;
  for (const [error, reason] of cases) {
    const { client } = setup();
    const r = await client.finishSignIn(`${APP}?error=${error}&error_code=unexpected_failure&error_description=Database+error+saving+new+user`);
    assert.deepEqual(r, { kind: "failed", reason, cleanUrl: APP }, error);
  }
});

// Item 9
test("an error the service puts in the address's # part is read, and taken out of the address", async () => {
  // Supabase's redirect-URL guide: on a failed sign-in "the user will still be redirected", with the error details in
  // the URL fragment (its example reads window.location.hash).
  const { svc, store, client } = setup();
  await signInPage(client, svc); // a sign-in was started
  const r = await client.finishSignIn(`${APP}?tab=slice#error=server_error&error_code=500&error_description=Unable+to+exchange+external+code`);
  assert.deepEqual(r, { kind: "failed", reason: "unavailable", cleanUrl: `${APP}?tab=slice` });
  assert.equal(store.m.has(PENDING_KEY), false, "the started sign-in's secret is used up");
});

test("the app's own # page is never taken for a sign-in return", async () => {
  const { svc, client } = setup();
  assert.deepEqual(await client.finishSignIn(`${APP}#design`), { kind: "none" });
  assert.deepEqual(await client.finishSignIn(`${APP}#errors`), { kind: "none" });
  assert.equal(svc.calls.length, 0);
});
