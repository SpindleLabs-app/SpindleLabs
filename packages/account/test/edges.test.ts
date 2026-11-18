// The edges of each limit and each check, one test per way a value can be wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, PENDING_KEY, PENDING_MAX_MS, REFRESH_MARGIN_S, SESSION_KEY, type SmallStore } from "../src/auth.ts";
import { checkConfig } from "../src/config.ts";
import { base64url, isVerifier } from "../src/pkce.ts";
import { sessionFromReply, sessionFromText, sessionToText } from "../src/session.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";

function setup(store: SmallStore & { m?: Map<string, string> } = memoryStore()) {
  let ms = 1_800_000_000_000;
  const clock = { now: () => ms, advance: (d: number) => void (ms += d) };
  const svc = fakeService(() => ms / 1000);
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store, now: clock.now, random: seededRandom(5) });
  return { clock, svc, client, store };
}
async function returnLink(c: ReturnType<typeof setup>) {
  const go = new URL((await c.client.beginSignIn())!);
  return `${APP}?code=${c.svc.approve(go.searchParams.get("code_challenge")!)}`;
}

test("the stored names and limits are what they say (changing a stored name would sign everyone out)", () => {
  assert.equal(SESSION_KEY, "spindle.account.session");
  assert.equal(PENDING_KEY, "spindle.account.pending");
  assert.equal(PENDING_MAX_MS, 600_000); // 10 minutes × 60 s × 1000 ms
  assert.equal(REFRESH_MARGIN_S, 60);
});

test("a sign-in exactly PENDING_MAX_MS old still finishes", async () => {
  const c = setup();
  const back = await returnLink(c);
  c.clock.advance(PENDING_MAX_MS);
  assert.equal((await c.client.finishSignIn(back)).kind, "signed-in");
});

test("a started sign-in whose time is a string is refused", async () => {
  const c = setup();
  const back = await returnLink(c);
  const pending = JSON.parse(c.store.m!.get(PENDING_KEY)!);
  c.store.m!.set(PENDING_KEY, JSON.stringify({ ...pending, at: String(pending.at) }));
  const r = await c.client.finishSignIn(back);
  assert.equal(r.kind === "failed" && r.reason, "expired");
});

test("an empty code is a cancelled sign-in, a code together with a server error is the service's trouble, and both send nothing", async () => {
  for (const [q, reason] of [["code=", "cancelled"], ["code=abc&error=server_error", "unavailable"]] as const) {
    const c = setup();
    await c.client.beginSignIn();
    const r = await c.client.finishSignIn(`${APP}?${q}`);
    assert.equal(r.kind === "failed" && r.reason, reason, q);
    assert.equal(c.svc.calls.length, 0);
  }
});

test("status 500 is the service's own error; 499 is a refusal", async () => {
  for (const [status, reason] of [[500, "unavailable"], [499, "rejected"]] as const) {
    const c = setup();
    const back = await returnLink(c);
    c.svc.mode = status;
    const r = await c.client.finishSignIn(back);
    assert.equal(r.kind === "failed" && r.reason, reason);
  }
});

test("a token with exactly REFRESH_MARGIN_S left is refreshed", async () => {
  const c = setup();
  await c.client.finishSignIn(await returnLink(c));
  c.clock.advance((3600 - REFRESH_MARGIN_S) * 1000);
  const before = c.svc.calls.length;
  await c.client.accessToken();
  assert.equal(c.svc.calls.length, before + 1);
});

test("a refresh answered with junk, or that this browser can't keep, fails without losing the session", async () => {
  {
    const c = setup();
    await c.client.finishSignIn(await returnLink(c));
    c.clock.advance(4000 * 1000);
    c.svc.nextBody = { nope: 1 };
    assert.deepEqual(await c.client.accessToken(), { kind: "failed", reason: "malformed" });
    assert.equal(c.client.state().kind, "signed-in");
  }
  {
    const base = memoryStore();
    let full = false;
    const store: SmallStore & { m: Map<string, string> } = { ...base, setItem: (k, v) => { if (full) throw new Error("full"); base.setItem(k, v); } };
    const c = setup(store);
    await c.client.finishSignIn(await returnLink(c));
    c.clock.advance(4000 * 1000);
    full = true;
    assert.deepEqual(await c.client.accessToken(), { kind: "failed", reason: "storage" });
  }
});

test("a refused refresh when this browser can't remove the session retries once, then says signed out (no endless loop)", async () => {
  const base = memoryStore();
  const store: SmallStore & { m: Map<string, string> } = { ...base, removeItem: () => { throw new Error("denied"); } };
  const c = setup(store);
  await c.client.finishSignIn(await returnLink(c));
  c.clock.advance(4000 * 1000);
  c.svc.liveRefresh.clear();
  const before = c.svc.calls.length;
  assert.deepEqual(await c.client.accessToken(), { kind: "signed-out" });
  assert.equal(c.svc.calls.length - before, 2);
});

test("config: http on [::1] is this computer; other protocols there, an address as an object, and a key that is not text are refused", () => {
  const good = { url: "https://x.supabase.co", anonKey: "k", redirectTo: APP };
  assert.ok(checkConfig({ ...good, url: "http://[::1]:54321" }).ok);
  assert.equal(checkConfig({ ...good, url: "ftp://127.0.0.1" }).ok, false);
  assert.equal(checkConfig({ ...good, url: new URL("https://x.supabase.co") }).ok, false);
  assert.equal(checkConfig({ ...good, anonKey: 12345 }).ok, false);
});

test("config: a return address of 500 characters is accepted, 501 refused", () => {
  const good = { url: "https://x.supabase.co", anonKey: "k" };
  const at = (n: number) => APP + "p".repeat(n - APP.length);
  assert.equal(at(500).length, 500);
  assert.ok(checkConfig({ ...good, redirectTo: at(500) }).ok);
  assert.equal(checkConfig({ ...good, redirectTo: at(501) }).ok, false);
});

test("pkce: a verifier must be text, and every padding character goes", () => {
  assert.equal(isVerifier(["a".repeat(43)]), false);
  // One byte 0x00 -> 000000 00(0000) -> "AA" + "==" padding: both "=" go.
  assert.equal(base64url(new Uint8Array([0])), "AA");
});

const reply = (over: Record<string, unknown> = {}, userOver: Record<string, unknown> = {}) => ({ access_token: "a", refresh_token: "r", expires_at: 10, ...over, user: { ...USER, ...userOver } });

test("session: token length 8000 is kept, 8001 refused", () => {
  assert.ok(sessionFromReply(reply({ access_token: "t".repeat(8000) }), 0));
  assert.equal(sessionFromReply(reply({ access_token: "t".repeat(8001) }), 0), undefined);
});

test("session: a missing or null user, or an id with anything after the hex digits, gives no session", () => {
  assert.equal(sessionFromReply({ ...reply(), user: null }, 0), undefined);
  assert.equal(sessionFromReply({ ...reply(), user: undefined }, 0), undefined);
  assert.equal(sessionFromReply(reply({}, { id: "7f3c/../x" }), 0), undefined);
  assert.equal(sessionFromReply(undefined, 0), undefined);
});

test("session: an email of 320 characters is kept; a longer one, a missing one or one that is not text is left empty", () => {
  const long = "a".repeat(308) + "@example.com"; // 308 + 12 = 320
  assert.equal(sessionFromReply(reply({}, { email: long }), 0)?.user.email, long);
  assert.equal(sessionFromReply(reply({}, { email: "a" + long }), 0)?.user.email, "");
  assert.equal(sessionFromReply(reply({}, { email: undefined }), 0)?.user.email, "");
  assert.equal(sessionFromReply(reply({}, { email: ["x@y.z"] }), 0)?.user.email, "");
});

test("session: the name falls back to `name`, and to nothing when there are no details or they are null", () => {
  assert.equal(sessionFromReply(reply({}, { user_metadata: { name: "Bo" } }), 0)?.user.name, "Bo");
  assert.equal(sessionFromReply(reply({}, { user_metadata: null }), 0)?.user.name, "");
  assert.equal(sessionFromReply(reply({}, { user_metadata: undefined }), 0)?.user.name, "");
});

test("session: expires_in of 0 runs out now; a negative one, or one that is not a number, is refused", () => {
  const { expires_at: _, ...noAt } = reply();
  assert.equal(sessionFromReply({ ...noAt, expires_in: 0 }, 500)?.expiresAt, 500);
  assert.equal(sessionFromReply({ ...noAt, expires_in: -1 }, 500), undefined);
  assert.equal(sessionFromReply({ ...noAt, expires_in: "60" }, 500), undefined);
  assert.equal(sessionFromReply({ ...noAt, expires_in: NaN }, 500), undefined);
});

test("session: stored text with a null user, a number for the name, or extra spaces is refused", () => {
  const text = sessionToText(sessionFromReply(reply(), 0)!);
  const o = JSON.parse(text);
  for (const bad of [{ ...o, user: null }, { ...o, user: { ...o.user, name: 5 } }, { ...o, user: { ...o.user, email: 5 } }, 5, "x"]) {
    assert.equal(sessionFromText(JSON.stringify(bad)), undefined, JSON.stringify(bad));
  }
  assert.equal(sessionFromText(text.replace("{", "{ ")), undefined);
});
