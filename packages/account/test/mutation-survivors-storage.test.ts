// Tests for what the nightly account mutation run found no test noticing in auth.ts's file storage requests (issue
// #744): asPersonStorage (the token, its renewal after a refusal, and the request's own headers), storageRequest's
// reading of Storage's answers (its code in the body of a 400, which messages mean the token ran out), and
// getSignedFile (how it fetches, and each way it fails). Each test names the change it catches; each was shown red
// with that change planted by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, FILE_MS, SESSION_KEY, type AuthDeps, type StorageReply } from "../src/auth.ts";
import { sessionToText, type Session } from "../src/session.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";
const T0 = 1_800_000_000_000;

type Fetch = typeof fetch;
/** A fetch in front of the fake service: `answer` may give a reply of its own for a request, or undefined to pass it on. */
type Answer = (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>;

function setup(answer?: Answer) {
  let ms = T0;
  const clock = { now: () => ms, advance: (d: number) => void (ms += d) };
  const svc = fakeService(() => ms / 1000);
  const store = memoryStore();
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url: url.slice(SERVICE.length), init: init ?? {} });
    const mine = answer ? await answer(url, init ?? {}) : undefined;
    return mine ?? svc.fetch(input, init);
  }) as Fetch;
  const deps: AuthDeps = { config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch, store, now: clock.now, random: seededRandom(1) };
  return { clock, svc, store, client: authClient(deps), calls };
}

async function signIn(t: ReturnType<typeof setup>): Promise<Session> {
  const go = await t.client.beginSignIn();
  const code = t.svc.approve(new URL(go!).searchParams.get("code_challenge")!);
  const r = await t.client.finishSignIn(`${APP}?code=${code}`);
  assert.equal(r.kind, "signed-in");
  return JSON.parse(t.store.getItem(SESSION_KEY)!) as Session;
}

const stored = (accessToken: string, refreshToken: string, expiresAt: number) => sessionToText({ accessToken, refreshToken, expiresAt, user: { id: USER.id, email: USER.email, name: "Ada Maker" } });
const storageCalls = (t: ReturnType<typeof setup>) => t.calls.filter((c) => c.url.startsWith("/storage/v1/"));
const refreshes = (t: ReturnType<typeof setup>) => t.calls.filter((c) => c.url.includes("grant_type=refresh_token")).length;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// --- asPersonStorage ---

test("asPersonStorage sends JSON with the person's token, content type application/json and no redirects, once when it works", async () => {
  const t = setup((url) => (url.includes("/storage/v1/object/list/designs") ? json([{ name: "a.spindle" }]) : undefined));
  const s = await signIn(t);
  assert.deepEqual(await t.client.asPersonStorage("POST", "object/list/designs", { json: { prefix: "u/" } }), { kind: "ok", body: [{ name: "a.spindle" }] });
  // reply.kind === "token" => true would renew and send it again although the first answer was fine.
  assert.equal(storageCalls(t).length, 1);
  assert.equal(refreshes(t), 0);
  const { init } = storageCalls(t)[0];
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${s.accessToken}`);
  assert.equal(headers["content-type"], "application/json"); // "application/json" => ""
  assert.equal(headers.apikey, KEY);
  assert.equal(init.body, JSON.stringify({ prefix: "u/" }));
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error"); // "error" => "" (a redirect could carry the token elsewhere)
  assert.equal(init.credentials, "omit");
});

test("asPersonStorage: a file goes as it is with its own type", async () => {
  const t = setup((url) => (url.includes("/storage/v1/object/designs/") ? json({ Key: "designs/u/a" }) : undefined));
  await signIn(t);
  assert.deepEqual(await t.client.asPersonStorage("POST", "object/designs/u/a", { file: "{\"v\":1}", type: "application/x-spindle" }), { kind: "ok", body: { Key: "designs/u/a" } });
  const { init } = storageCalls(t)[0];
  assert.equal((init.headers as Record<string, string>)["content-type"], "application/x-spindle");
  assert.equal(init.body, "{\"v\":1}");
});

test("asPersonStorage: refused for its token (401) it renews once and sends again with the new token; refused again it is rejected with 401", async () => {
  let refusals = 1;
  const t = setup((url) => {
    if (!url.includes("/storage/v1/")) return undefined;
    if (refusals > 0) return refusals--, json({ message: "Invalid JWT" }, 401);
    return json({ done: true });
  });
  const s = await signIn(t);
  assert.deepEqual(await t.client.asPersonStorage("DELETE", "object/designs", { json: { prefixes: ["u/a"] } }), { kind: "ok", body: { done: true } });
  assert.equal(refreshes(t), 1);
  const bearers = storageCalls(t).map((c) => (c.init.headers as Record<string, string>).authorization);
  assert.equal(bearers.length, 2);
  assert.equal(bearers[0], `Bearer ${s.accessToken}`);
  assert.notEqual(bearers[1], bearers[0]); // the renewed token, not the refused one

  // Refused both times: rejected with 401, after one renewal and two sends, never a loop.
  refusals = 5;
  const before = storageCalls(t).length;
  assert.deepEqual(await t.client.asPersonStorage("DELETE", "object/designs", { json: {} }), { kind: "failed", reason: "rejected", code: 401 });
  assert.equal(storageCalls(t).length - before, 2);
});

test("asPersonStorage: a 401 whose renewal fails says why and sends nothing more", async () => {
  // t.kind !== "ok" => false would send again with no token after the renewal failed.
  let down = false;
  const t = setup((url) => {
    if (url.includes("grant_type=refresh_token") && down) return new Response("{}", { status: 503 });
    if (url.includes("/storage/v1/")) return json({ message: "Invalid JWT" }, 401);
    return undefined;
  });
  await signIn(t);
  down = true;
  assert.deepEqual(await t.client.asPersonStorage("POST", "object/list/designs", { json: {} }), { kind: "failed", reason: "unavailable" });
  assert.equal(storageCalls(t).length, 1);
  // Signed out: nothing is sent at all.
  const out = setup();
  assert.deepEqual(await out.client.asPersonStorage("POST", "object/list/designs", { json: {} }), { kind: "signed-out" });
  assert.equal(storageCalls(out).length, 0);
});

test("asPersonStorage: a renewal refused while another tab stored a fresh session of the same person goes on with that one", async () => {
  // Both token(true) calls may retry once: token(true) => token(false) at either gives up signed out instead.
  for (const first401 of [false, true]) {
    let failedOnce = !first401;
    const t = setup((url) => {
      if (url.includes("grant_type=refresh_token")) {
        t.store.setItem(SESSION_KEY, stored("access-tab2", "refresh-tab2", T0 / 1000 + 7200));
        return new Response('{"error":"invalid_grant"}', { status: 400 }); // its refresh token was used by the other tab
      }
      if (url.includes("/storage/v1/")) {
        if (!failedOnce) return (failedOnce = true), json({ message: "Invalid JWT" }, 401);
        return json("done");
      }
      return undefined;
    });
    const s = await signIn(t);
    if (!first401) t.clock.advance((s.expiresAt - T0 / 1000) * 1000); // run out: renewed before the first send
    assert.deepEqual(await t.client.asPersonStorage("POST", "object/list/designs", { json: {} }), { kind: "ok", body: "done" }, `first401 ${first401}`);
    assert.equal((storageCalls(t).at(-1)!.init.headers as Record<string, string>).authorization, "Bearer access-tab2");
  }
});

// --- storageRequest: Storage's answers ---

/** The reply to one storage request answered `status` with `body` (raw text when a string), never renewed again. */
async function answered(status: number, body: unknown): Promise<{ reply: StorageReply; renewed: boolean }> {
  let first = true;
  const t = setup((url) => {
    if (!url.includes("/storage/v1/")) return undefined;
    if (!first) return json("after renewal");
    first = false;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  await signIn(t);
  const reply = await t.client.asPersonStorage("POST", "object/list/designs", { json: {} });
  return { reply, renewed: refreshes(t) > 0 };
}
const renews = { reply: { kind: "ok", body: "after renewal" }, renewed: true };
const rejected = (code: number) => ({ reply: { kind: "failed", reason: "rejected", code }, renewed: false });
const unavailable = { reply: { kind: "failed", reason: "unavailable" }, renewed: false };

test("Storage's code in the body of a 400 is used when it is a whole number from 400 to 599, given as text or a number", async () => {
  // Hand-worked from the rule: HTTP 400 with statusCode "404" is a 404; 404 as a number too (typeof "number" => false,
  // !== "number", "number" => "" lose it); 399 and 600 are no HTTP error codes, so the answer stays a 400 (inBody >= 400
  // => true, inBody < 600 => true or <= 600: 600 would read as a server error, "unavailable"); 404.5 is no code.
  assert.deepEqual(await answered(400, { statusCode: "404", error: "not_found" }), rejected(404));
  assert.deepEqual(await answered(400, { statusCode: 404 }), rejected(404));
  assert.deepEqual(await answered(400, { statusCode: "399" }), rejected(400));
  assert.deepEqual(await answered(400, { statusCode: 600 }), rejected(400));
  assert.deepEqual(await answered(400, { statusCode: "599" }), unavailable); // the top of the range is a code, a server error
  assert.deepEqual(await answered(400, { statusCode: "404.5" }), rejected(400));
  // A list is no code: Number(["404"]) is 404, which the typeof test keeps out (=> true lets it in).
  assert.deepEqual(await answered(400, { statusCode: ["404"] }), rejected(400));
  // Only an HTTP 400's body is read: a 403 saying 404 stays a 403 (res.status === 400 => true, or && turned ||, lose it).
  assert.deepEqual(await answered(403, { statusCode: "404" }), rejected(403));
  assert.deepEqual(await answered(403, { statusCode: 404, message: "nope" }), rejected(403));
});

test("a refusal for the token (401 itself, or Storage's 401 in a 400) renews and sends again", async () => {
  assert.deepEqual(await answered(401, ""), renews);
  // HTTP 400 whose body says 401 (code === 401 => false, or || turned &&, miss it).
  assert.deepEqual(await answered(400, { statusCode: "401", error: "Unauthorized" }), renews);
});

test("a 400 or 403 whose message or error says the token ran out renews; the same words with another code don't", async () => {
  assert.deepEqual(await answered(400, { statusCode: "400", message: "jwt malformed" }), renews);
  assert.deepEqual(await answered(400, { message: "jwt malformed" }), renews); // code === 400 => false or !== 400 miss it
  assert.deepEqual(await answered(403, { message: "JWT expired" }), renews);
  // In `error` when there is no `message` (typeof a.message === "string" => true reads undefined; typeof a.error ===
  // "string" => false, !== "string" or "string" => "" read nothing).
  assert.deepEqual(await answered(403, { error: "jwt expired" }), renews);
  // Words with something between (token.*expired => token.expired, exp.*claim => exp.claim need exactly one).
  assert.deepEqual(await answered(403, { message: "token has expired" }), renews);
  assert.deepEqual(await answered(400, { message: "\"exp\" claim timestamp check failed" }), renews);
  // Another code with those words is no token refusal (code === 400 || code === 403 => true would renew).
  assert.deepEqual(await answered(400, { statusCode: "404", message: "jwt expired" }), rejected(404));
  // An `error` that is not text is not read as words (typeof a.error === "string" => true would read ["jwt"] as "jwt").
  assert.deepEqual(await answered(403, { error: ["jwt"] }), rejected(403));
  // No words at all: a plain refusal.
  assert.deepEqual(await answered(403, {}), rejected(403));
  assert.deepEqual(await answered(403, "not json"), rejected(403));
});

test("429 and 5xx (in the status or a 400's body) are unavailable; anything else is rejected with its code", async () => {
  assert.deepEqual(await answered(429, {}), unavailable);
  assert.deepEqual(await answered(400, { statusCode: "429" }), unavailable); // code === 429 => false
  assert.deepEqual(await answered(500, {}), unavailable);
  assert.deepEqual(await answered(409, { error: "Duplicate" }), rejected(409));
});

// --- getSignedFile ---

function fileSetup(answer: (init: RequestInit) => Response | Promise<Response>) {
  return setup((url, init) => (url.startsWith(`${SERVICE}/storage/v1/object/sign/`) ? answer(init) : undefined));
}
const PATH = "/object/sign/library/a.spindle?token=abc";

test("getSignedFile fetches the signed link with GET, no cookies or account headers, no redirects and the file time limit", async (t) => {
  const timeouts: number[] = [];
  const real = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => (timeouts.push(ms), real.call(AbortSignal, ms));
  t.after(() => void (AbortSignal.timeout = real));
  const s = fileSetup(() => new Response("hello"));
  assert.deepEqual(await s.client.getSignedFile(PATH, 100), { kind: "ok", text: "hello" });
  const { url, init } = storageCalls(s)[0];
  assert.equal(url, `/storage/v1${PATH}`);
  // The options object emptied, or "GET", "omit", "error" emptied, would let the browser choose.
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers, undefined); // the link is the permission: no token goes with it
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(timeouts, [FILE_MS]);
});

test("getSignedFile: no network, or the connection breaking on the way, is offline", async () => {
  // The catch blocks emptied ({} => undefined) or their answers emptied ({}, "failed" => "", "offline" => "").
  const thrown = fileSetup(() => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(await thrown.client.getSignedFile(PATH, 100), { kind: "failed", reason: "offline" });
  const broken = fileSetup(() => {
    const r = new Response("hello");
    Object.defineProperty(r, "arrayBuffer", { value: () => Promise.reject(new TypeError("network error")) });
    return r;
  });
  assert.deepEqual(await broken.client.getSignedFile(PATH, 100), { kind: "failed", reason: "offline" });
});

test("getSignedFile: 429 and 500 or more are unavailable, other refusals rejected, a link not from Storage malformed", async () => {
  const status = async (code: number) => (await fileSetup(() => new Response("x", { status: code })).client.getSignedFile(PATH, 100));
  assert.deepEqual(await status(429), { kind: "failed", reason: "unavailable" }); // res.status === 429 => false
  assert.deepEqual(await status(500), { kind: "failed", reason: "unavailable" }); // >= 500 => > 500
  assert.deepEqual(await status(499), { kind: "failed", reason: "rejected" });
  assert.deepEqual(await status(400), { kind: "failed", reason: "rejected" });
  const s = fileSetup(() => new Response("x"));
  assert.deepEqual(await s.client.getSignedFile("/object/public/library/a", 100), { kind: "failed", reason: "malformed" });
  assert.equal(storageCalls(s).length, 0);
});

test("getSignedFile: exactly maxBytes is kept, one byte more is too big, by the length said and by the bytes that came", async () => {
  // Boundary: maxBytes 5. "hello" is 5 bytes: kept (said > maxBytes => >= and byteLength > maxBytes => >= refuse it).
  const said = (len: string | null, text: string) =>
    fileSetup(() => {
      const r = new Response(text);
      if (len !== null) r.headers.set("content-length", len);
      return r;
    }).client.getSignedFile(PATH, 5);
  assert.deepEqual(await said("5", "hello"), { kind: "ok", text: "hello" });
  assert.deepEqual(await said("6", "hello"), { kind: "failed", reason: "too-big" }); // said more than allowed: not read
  assert.deepEqual(await said(null, "hello"), { kind: "ok", text: "hello" });
  assert.deepEqual(await said(null, "hello!"), { kind: "failed", reason: "too-big" }); // said nothing, sent 6 bytes
  assert.deepEqual(await said("5", "hello!"), { kind: "failed", reason: "too-big" }); // said 5, sent 6
  // Not UTF-8: malformed.
  const bad = fileSetup(() => new Response(new Uint8Array([0xff, 0xfe])));
  assert.deepEqual(await bad.client.getSignedFile(PATH, 5), { kind: "failed", reason: "malformed" });
});
