import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, PENDING_KEY, PENDING_MAX_MS, REFRESH_MARGIN_S, SESSION_KEY, type SmallStore } from "../src/auth.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";

function setup(seed = 1) {
  let ms = 1_800_000_000_000;
  const clock = { now: () => ms, advance: (d: number) => void (ms += d) };
  const svc = fakeService(() => ms / 1000);
  const store = memoryStore();
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store, now: clock.now, random: seededRandom(seed) });
  return { clock, svc, store, client };
}

/** What the sign-in page does: read the challenge from the address and send the browser back with a code. */
async function signInPage(client: ReturnType<typeof setup>["client"], svc: ReturnType<typeof setup>["svc"], back = APP) {
  const go = await client.beginSignIn();
  assert.ok(go);
  const u = new URL(go);
  assert.equal(u.origin + u.pathname, `${SERVICE}/auth/v1/authorize`);
  assert.equal(u.searchParams.get("provider"), "google");
  assert.equal(u.searchParams.get("redirect_to"), APP);
  assert.equal(u.searchParams.get("code_challenge_method"), "s256");
  const code = svc.approve(u.searchParams.get("code_challenge")!);
  const ret = new URL(back);
  ret.searchParams.set("code", code);
  return ret.href;
}

test("signing in: the code is swapped for a session, the address loses the code, and only id, email and name are kept", async () => {
  const { svc, store, client } = setup();
  assert.deepEqual(client.state(), { kind: "signed-out" });
  const back = await signInPage(client, svc, `${APP}?tab=slice`);
  const r = await client.finishSignIn(back);
  assert.equal(r.kind, "signed-in");
  if (r.kind !== "signed-in") return;
  assert.equal(r.cleanUrl, `${APP}?tab=slice`);
  assert.deepEqual(r.user, { id: USER.id, email: USER.email, name: "Ada Maker" });
  assert.deepEqual(client.state(), { kind: "signed-in", user: r.user });
  assert.equal(store.m.has(PENDING_KEY), false);
  assert.equal(store.m.get(SESSION_KEY)!.includes("a.png"), false);
  // Every request went to the service only, with its key, never with cookies.
  for (const c of svc.calls) {
    assert.ok(c.url.startsWith(`${SERVICE}/`));
    assert.equal(c.init.credentials, "omit");
    assert.equal(c.init.redirect, "error"); // a redirect would carry the key somewhere else
  }
});

test("a page that is not a return from sign-in is left alone and makes no request", async () => {
  const { svc, client } = setup();
  assert.deepEqual(await client.finishSignIn(`${APP}?tab=design`), { kind: "none" });
  assert.deepEqual(await client.finishSignIn("not a url"), { kind: "none" });
  assert.equal(svc.calls.length, 0);
});

test("a code from someone else's sign-in is refused (login forgery)", async () => {
  // The attacker starts a sign-in in their own browser and sends the victim the return link. The victim's browser
  // holds a different secret (or none), so the code can't be used there.
  const attacker = setup(7);
  const link = await signInPage(attacker.client, attacker.svc);
  const victim = setup(8);
  // No sign-in started in the victim's browser: the code is never even sent.
  const r1 = await victim.client.finishSignIn(link);
  assert.equal(r1.kind === "failed" && r1.reason, "expired");
  assert.equal(victim.svc.calls.length, 0);
  // A sign-in started there, but the code came from the attacker's: the service refuses it.
  await victim.client.beginSignIn();
  // The victim's fake service knows the attacker's code, bound to the attacker's challenge.
  const forged = victim.svc.approve(new URL((await attacker.client.beginSignIn())!).searchParams.get("code_challenge")!);
  const r2 = await victim.client.finishSignIn(`${APP}?code=${forged}`);
  assert.equal(r2.kind === "failed" && r2.reason, "rejected");
  assert.deepEqual(victim.client.state(), { kind: "signed-out" });
});

test("a damaged secret for a fresh sign-in is refused without sending the code", async () => {
  const { clock, svc, store, client } = setup();
  for (const pending of [JSON.stringify({ verifier: "too-short", at: clock.now() }), JSON.stringify({ verifier: "a".repeat(42) + "+", at: clock.now() }), JSON.stringify({ at: clock.now() }), "{oops", "null"]) {
    store.m.set(PENDING_KEY, pending);
    const r = await client.finishSignIn(`${APP}?code=abc`);
    assert.equal(r.kind === "failed" && r.reason, "expired", pending);
  }
  assert.equal(svc.calls.length, 0);
});

test("cancelling on the sign-in page signs nobody in and clears the started sign-in", async () => {
  const { svc, store, client } = setup();
  await client.beginSignIn();
  const r = await client.finishSignIn(`${APP}?error=access_denied&error_code=403&error_description=User+cancelled&tab=design`);
  assert.deepEqual(r, { kind: "failed", reason: "cancelled", cleanUrl: `${APP}?tab=design` });
  assert.equal(store.m.has(PENDING_KEY), false);
  assert.equal(svc.calls.length, 0);
});

test("a return link works once", async () => {
  const { svc, client } = setup();
  const back = await signInPage(client, svc);
  assert.equal((await client.finishSignIn(back)).kind, "signed-in");
  await client.signOut();
  const again = await client.finishSignIn(back);
  assert.equal(again.kind === "failed" && again.reason, "expired");
});

test("a sign-in left for 0.9 × PENDING_MAX_MS still finishes; one left for 1.1 × is refused without a request", async () => {
  {
    const { clock, svc, client } = setup();
    const back = await signInPage(client, svc);
    clock.advance(0.9 * PENDING_MAX_MS); // 9 minutes
    assert.equal((await client.finishSignIn(back)).kind, "signed-in");
  }
  {
    const { clock, svc, client } = setup();
    const back = await signInPage(client, svc);
    clock.advance(1.1 * PENDING_MAX_MS); // 11 minutes
    const r = await client.finishSignIn(back);
    assert.equal(r.kind === "failed" && r.reason, "expired");
    assert.equal(svc.calls.length, 0);
  }
  {
    // A clock put back after starting (negative age) is refused too.
    const { clock, svc, client } = setup();
    const back = await signInPage(client, svc);
    clock.advance(-1000);
    const r = await client.finishSignIn(back);
    assert.equal(r.kind === "failed" && r.reason, "expired");
  }
});

test("each way the service can fail gives its own reason and signs nobody in", async () => {
  for (const [mode, body, reason] of [
    ["down", undefined, "offline"],
    [503, undefined, "unavailable"],
    [429, undefined, "unavailable"],
    [403, undefined, "rejected"],
    ["up", { access_token: "only this" }, "malformed"],
  ] as const) {
    const { svc, client } = setup();
    const back = await signInPage(client, svc);
    svc.mode = mode;
    svc.nextBody = body;
    const r = await client.finishSignIn(back);
    assert.equal(r.kind === "failed" && r.reason, reason, String(mode));
    assert.deepEqual(client.state(), { kind: "signed-out" });
  }
});

test("a reply that is not JSON is malformed", async () => {
  const c = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch, store: memoryStore(), now: () => 1, random: seededRandom(2) });
  await c.beginSignIn();
  const r = await c.finishSignIn(`${APP}?code=x`);
  assert.equal(r.kind === "failed" && r.reason, "malformed");
});

test("a browser that won't keep anything: no sign-in starts, nothing throws", async () => {
  const broken: SmallStore = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  const { svc } = setup();
  const c = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store: broken, now: () => 1, random: seededRandom(1) });
  assert.deepEqual(c.state(), { kind: "signed-out" });
  assert.equal(await c.beginSignIn(), undefined);
  assert.equal((await c.finishSignIn(`${APP}?code=x`)).kind, "failed");
  assert.deepEqual(await c.accessToken(), { kind: "signed-out" });
  assert.deepEqual(await c.signOut(), { ended: true });
});

test("a browser that keeps the started sign-in but not the session says so", async () => {
  const { svc } = setup();
  const store = memoryStore();
  const picky: SmallStore = { ...store, setItem: (k, v) => { if (k === SESSION_KEY) throw new Error("full"); store.setItem(k, v); } };
  const c = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store: picky, now: () => 1_800_000_000_000, random: seededRandom(3) });
  const back = await signInPage(c, svc);
  const r = await c.finishSignIn(back);
  assert.equal(r.kind === "failed" && r.reason, "storage");
});

test("a damaged stored session counts as signed out and is removed", () => {
  const { store, client } = setup();
  store.m.set(SESSION_KEY, "{not json");
  assert.deepEqual(client.state(), { kind: "signed-out" });
  assert.equal(store.m.has(SESSION_KEY), false);
});

test("a token running out in 0.9 × REFRESH_MARGIN_S is refreshed first; one with 1.1 × left is used as it is", async () => {
  const { clock, svc, client } = setup();
  await client.finishSignIn(await signInPage(client, svc));
  const first = await client.accessToken();
  assert.equal(first.kind, "ok");
  // The token lasts 3600 s. Move to 66 s (1.1 × 60) before it runs out: still used as it is, no request.
  clock.advance((3600 - 1.1 * REFRESH_MARGIN_S) * 1000);
  const before = svc.calls.length;
  assert.deepEqual(await client.accessToken(), first);
  assert.equal(svc.calls.length, before);
  // Move to 54 s (0.9 × 60) before: refreshed, a new token.
  clock.advance(0.2 * REFRESH_MARGIN_S * 1000);
  const second = await client.accessToken();
  assert.equal(second.kind, "ok");
  assert.notDeepEqual(second, first);
  assert.equal(svc.calls.at(-1)!.url, `${SERVICE}/auth/v1/token?grant_type=refresh_token`);
});

test("offline, an old token keeps the person signed in; a session ended elsewhere signs this browser out", async () => {
  const { clock, svc, client } = setup();
  await client.finishSignIn(await signInPage(client, svc));
  clock.advance(4000 * 1000); // past the hour
  svc.mode = "down";
  assert.deepEqual(await client.accessToken(), { kind: "failed", reason: "offline" });
  assert.equal(client.state().kind, "signed-in");
  svc.mode = "up";
  svc.liveRefresh.clear(); // signed out of everywhere from another device
  assert.deepEqual(await client.accessToken(), { kind: "signed-out" });
  assert.equal(client.state().kind, "signed-out");
});

test("a refresh refused because another tab already refreshed keeps that tab's session", async () => {
  const { clock, svc, store, client } = setup();
  await client.finishSignIn(await signInPage(client, svc));
  clock.advance(4000 * 1000);
  const otherTab = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store, now: clock.now, random: seededRandom(9) });
  // Both read the same old session; the other tab's refresh wins, so ours is refused.
  const oldText = store.m.get(SESSION_KEY)!;
  const t = await otherTab.accessToken();
  assert.equal(t.kind, "ok");
  const fresh = store.m.get(SESSION_KEY)!;
  // Put the old text back only for our read, as if we read it before the other tab wrote.
  let first = true;
  const racing: SmallStore = { getItem: (k) => (k === SESSION_KEY && first ? ((first = false), oldText) : store.getItem(k)), setItem: store.setItem, removeItem: store.removeItem };
  const ours = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store: racing, now: clock.now, random: seededRandom(10) });
  assert.deepEqual(await ours.accessToken(), t);
  assert.equal(store.m.get(SESSION_KEY), fresh);
});

test("signing out works offline at once, and online also ends the session at the service", async () => {
  {
    const { svc, client } = setup();
    await client.finishSignIn(await signInPage(client, svc));
    svc.mode = "down";
    assert.deepEqual(await client.signOut(), { ended: false, reason: "offline" });
    assert.equal(client.state().kind, "signed-out");
  }
  {
    const { svc, client } = setup();
    await client.finishSignIn(await signInPage(client, svc));
    const token = await client.accessToken();
    assert.deepEqual(await client.signOut(), { ended: true });
    assert.deepEqual(svc.loggedOut, [`Bearer ${token.kind === "ok" && token.token}`]);
    assert.equal(client.state().kind, "signed-out");
  }
});

test("seeded sessions against a plain model: signed in exactly when the model says, never a throw", async () => {
  // The model: signed in after a good return while the service is up; signed out after sign-out, after a refresh the
  // service refuses, or never if the return failed. Network down never changes it.
  const reached = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    let r = seed;
    const pick = (n: number) => ((r = (r * 1103515245 + 12345) >>> 0) >>> 8) % n;
    const { clock, svc, client } = setup(seed);
    let model = false;
    let pendingBack: string | undefined;
    for (let step = 0; step < 40; step++) {
      const op = pick(7);
      if (op === 0) {
        pendingBack = await signInPage(client, svc);
        reached.add("begin");
      } else if (op === 1 && pendingBack) {
        const res = await client.finishSignIn(pendingBack);
        pendingBack = undefined;
        if (res.kind === "signed-in") model = true;
        reached.add(`finish-${res.kind}-${svc.mode}`);
      } else if (op === 2) {
        clock.advance(pick(5000) * 1000);
      } else if (op === 3) {
        svc.mode = svc.mode === "up" ? "down" : "up";
      } else if (op === 4) {
        const t = await client.accessToken();
        if (t.kind === "signed-out") model = false;
        reached.add(`token-${t.kind}`);
      } else if (op === 5) {
        await client.signOut();
        model = false;
        reached.add("signout");
      } else if (op === 6) {
        svc.liveRefresh.clear();
      }
      assert.equal(client.state().kind === "signed-in", model, `seed ${seed} step ${step}`);
    }
  }
  for (const want of ["begin", "finish-signed-in-up", "finish-failed-down", "token-ok", "token-signed-out", "token-failed", "signout"]) {
    assert.ok(reached.has(want), `never reached ${want}`);
  }
});
