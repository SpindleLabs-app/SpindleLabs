// The moderation function (supabase/functions/moderation/index.ts, community C5b) against a fake sign-in service and
// database. The database functions themselves are checked on a real PostgreSQL in supabase/test/test_moderation.py;
// here the point is who may call them and with what: only accounts on the MODERATORS list, checked on the server,
// with the moderator's name taken from that list, and every value checked before it reaches the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFile } from "./repo-file.ts";

const { moderation, readModerators, MAX_NOTE_CHARS, MAX_REQUEST_BYTES, MAX_HOLD_DAYS, MAX_MODERATOR_CHARS, REVIEW_ORIGINS } = (await import(repoFile("supabase/functions/moderation/index.ts").href)) as typeof import("../../../supabase/functions/moderation/index.ts");

const PAGE = REVIEW_ORIGINS[0];
const BEN = "0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const MALLORY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const LINK = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
const NOW = Date.UTC(2026, 10, 11, 4, 0, 0);
const ENV = { SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", MODERATORS: `${BEN}=Ben` };

type Call = { method: string; url: string; headers: Headers; body: string };

function world(o: { env?: Record<string, string | undefined>; signedIn?: string | null; db?: "down"; rows?: Record<string, unknown[]>; rpc?: unknown } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    calls.push({ method: init.method ?? "GET", url, headers, body: String(init.body ?? "") });
    if (url === "https://db.test/auth/v1/user") {
      const who = o.signedIn === undefined ? BEN : o.signedIn;
      if (!who || headers.get("authorization") !== "Bearer good-token") return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ id: who, email: "x@example.com" }), { status: 200 });
    }
    if (o.db === "down") return new Response("{}", { status: 500 });
    if (url.startsWith("https://db.test/auth/v1/admin/users/")) return new Response(JSON.stringify({ email: "owner@example.com" }), { status: 200 });
    if (url.startsWith("https://db.test/rest/v1/rpc/")) return new Response(JSON.stringify(o.rpc ?? true), { status: 200 });
    const table = /\/rest\/v1\/([a-z_]+)\?/.exec(url)?.[1] ?? "";
    return new Response(JSON.stringify(o.rows?.[table] ?? []), { status: 200 });
  }) as typeof fetch;
  const handle = moderation({ env: { ...ENV, ...o.env }, fetch: fakeFetch, now: () => NOW, log: (l) => logs.push(l) });
  const db = () => calls.filter((c) => !c.url.endsWith("/auth/v1/user"));
  return { handle, calls, db, logs };
}

const ask = (body: unknown, o: { origin?: string; token?: string | null; raw?: string } = {}) => {
  const headers: Record<string, string> = { origin: o.origin ?? PAGE, "content-type": "application/json" };
  if (o.token !== null) headers.authorization = `Bearer ${o.token ?? "good-token"}`;
  return new Request("https://db.test/functions/v1/moderation", { method: "POST", headers, body: o.raw ?? JSON.stringify(body) });
};

test("hand-worked: a moderator takes a link down; the record names them from the list, never from the request", async () => {
  const { handle, calls } = world();
  const res = await handle(ask({ do: "decide", share: LINK, decision: "take-down", note: "Rude name", moderator: "Somebody else", p_moderator: "Mallory" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { done: true });
  assert.equal(res.headers.get("access-control-allow-origin"), PAGE);
  assert.equal(res.headers.get("cache-control"), "no-store");
  // 1. The sign-in, checked with the sign-in service (the public key with the caller's token).
  assert.equal(calls[0].url, "https://db.test/auth/v1/user");
  assert.equal(calls[0].headers.get("apikey"), "anon");
  assert.equal(calls[0].headers.get("authorization"), "Bearer good-token");
  // 2. The C5a function, as the server, with exactly these arguments: "Ben" is MODERATORS' name for BEN's id.
  assert.equal(calls[1].url, "https://db.test/rest/v1/rpc/decide_share");
  assert.equal(calls[1].headers.get("authorization"), "Bearer service");
  assert.deepEqual(JSON.parse(calls[1].body), { p_id: LINK, p_action: "take-down", p_moderator: "Ben", p_note: "Rude name" });
  assert.equal(calls.length, 2);
});

test("nobody is a moderator until MODERATORS is set, and a malformed list locks everyone out", async () => {
  for (const MODERATORS of [undefined, "", "   ", `${BEN}`, `${BEN}=`, `not-an-id=Ben`, `${BEN}=Ben,${BEN}=Ben again`, `${BEN}=Ben,`]) {
    const { handle, calls } = world({ env: { MODERATORS } });
    const res = await handle(ask({ do: "queue" }));
    assert.equal(res.status, 503, `MODERATORS=${JSON.stringify(MODERATORS)}`);
    assert.equal(calls.length, 0, "nothing contacted");
  }
});

test("readModerators: worked by hand, ids folded to lower case; the name's length at 0.9x and 1.1x of 100", () => {
  const list = readModerators(` ${BEN.toUpperCase()} = Ben , ${MALLORY}=Sam P`);
  assert.deepEqual([...(list ?? [])], [[BEN, "Ben"], [MALLORY, "Sam P"]]);
  assert.equal(MAX_MODERATOR_CHARS, 100);
  assert.ok(readModerators(`${BEN}=${"n".repeat(90)}`));
  assert.ok(readModerators(`${BEN}=${"n".repeat(100)}`));
  assert.equal(readModerators(`${BEN}=${"n".repeat(110)}`), null);
});

test("no sign-in, or one the sign-in service refuses: 401, and the database is never asked", async () => {
  for (const token of [null, "bad-token"]) {
    const { handle, db } = world();
    const res = await handle(ask({ do: "queue" }, { token }));
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "sign-in" });
    assert.deepEqual(db(), []);
  }
  const { handle, calls } = world();
  const res = await handle(new Request("https://db.test/functions/v1/moderation", { method: "POST", headers: { origin: PAGE, authorization: "Basic good-token" }, body: "{}" }));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0, "a header that isn't a bearer token isn't even sent on");
});

test("a signed-in account not on the list: 403, nothing of its request read, the database never asked, and it is logged", async () => {
  const { handle, db, logs } = world({ signedIn: MALLORY });
  for (const d of ["me", "queue", "decide", "hold", "notice", "design"]) {
    const res = await handle(ask({ do: d, share: LINK, user: BEN, decision: "take-down", note: "x" }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "not-a-moderator" });
  }
  // An oversized body from a non-moderator gets the same answer: nothing of the request is read before who is known.
  const big = await handle(ask(null, { raw: "x".repeat(MAX_REQUEST_BYTES * 2) }));
  assert.equal(big.status, 403);
  assert.deepEqual(db(), []);
  assert.ok(logs.every((l) => l === `refused: account ${MALLORY} is not on the moderators' list`));
});

test("a moderator's id in another case on the list, and a sign-in for a different account than the list's, are told apart", async () => {
  // The list holds BEN in capitals: still Ben (ids are compared folded).
  const one = world({ env: { MODERATORS: `${BEN.toUpperCase()}=Ben` } });
  assert.equal((await one.handle(ask({ do: "me" }))).status, 200);
  // An account whose id differs from BEN's by one character is not BEN.
  const near = `${BEN.slice(0, -1)}e`;
  const two = world({ signedIn: near });
  assert.equal((await two.handle(ask({ do: "me" }))).status, 403);
});

test("only the review page's own addresses may call it; the app's pages may not", async () => {
  for (const origin of ["https://spindlelabs.app", "https://spindlelabs-app.github.io", "http://localhost:8766", "null", ""]) {
    const { handle, calls } = world();
    const res = await handle(ask({ do: "me" }, { origin }));
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(calls.length, 0);
  }
  const { handle } = world();
  const pre = await handle(new Request("https://db.test/functions/v1/moderation", { method: "OPTIONS", headers: { origin: REVIEW_ORIGINS[1] } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), REVIEW_ORIGINS[1]);
  assert.match(pre.headers.get("access-control-allow-headers") ?? "", /authorization/);
  const get = await handle(new Request("https://db.test/functions/v1/moderation", { method: "GET", headers: { origin: PAGE } }));
  assert.equal(get.status, 405);
});

test("me answers the list's name; an unknown or inherited `do` is refused", async () => {
  const { handle, db } = world();
  assert.deepEqual(await (await handle(ask({ do: "me" }))).json(), { moderator: "Ben" });
  for (const d of ["nope", "__proto__", "constructor", "toString", "hasOwnProperty", 5, null]) {
    const res = await handle(ask({ do: d }));
    assert.equal(res.status, 400, String(d));
    assert.deepEqual(await res.json(), { error: "do" });
  }
  for (const raw of ["", "not json", "[]", "null", "5"]) assert.equal((await handle(ask(null, { raw }))).status, 400, raw);
  assert.deepEqual(db(), []);
});

test("ids are checked before they reach a query: anything but a plain UUID is refused, nothing sent", async () => {
  const { handle, db } = world();
  for (const share of [`${LINK}&user_id=neq.x`, `${LINK},id.neq.0`, "*", "", 5, null, `${LINK} `, LINK.replace(/-/g, "")]) {
    const res = await handle(ask({ do: "link", share }));
    assert.equal(res.status, 400, String(share));
    assert.deepEqual(await res.json(), { error: "share" });
  }
  assert.equal((await handle(ask({ do: "person", user: "me" }))).status, 400);
  assert.deepEqual(db(), []);
});

test("every decision needs a note; its length at 0.9x and 1.1x of the record's 2,000", async () => {
  assert.equal(MAX_NOTE_CHARS, 2000);
  const { handle, db } = world();
  for (const note of [undefined, "", "   ", 5]) assert.equal((await handle(ask({ do: "decide", share: LINK, decision: "dismiss", note }))).status, 400);
  assert.equal((await handle(ask({ do: "decide", share: LINK, decision: "dismiss", note: "n".repeat(2200) }))).status, 400);
  assert.equal(db().length, 0);
  assert.equal((await handle(ask({ do: "decide", share: LINK, decision: "dismiss", note: "n".repeat(1800) }))).status, 200);
  assert.equal((await handle(ask({ do: "decide", share: LINK, decision: "dismiss", note: "n".repeat(2000) }))).status, 200);
  assert.equal(db().length, 2);
});

test("decisions and outcomes come from fixed lists", async () => {
  const { handle, db } = world();
  for (const decision of ["delete", "TAKE-DOWN", "", null]) assert.equal((await handle(ask({ do: "decide", share: LINK, decision, note: "x" }))).status, 400);
  for (const outcome of ["open", "accepted", null]) assert.equal((await handle(ask({ do: "decide-claim", claim: 3, outcome, note: "x" }))).status, 400);
  for (const claim of [0, -1, 1.5, "3", null, 2 ** 53]) assert.equal((await handle(ask({ do: "decide-claim", claim, outcome: "upheld", note: "x" }))).status, 400, String(claim));
  assert.deepEqual(db(), []);
  assert.equal((await handle(ask({ do: "decide-claim", claim: 3, outcome: "rejected", note: "not theirs" }))).status, 200);
  assert.deepEqual(JSON.parse(db()[0].body), { p_claim: 3, p_outcome: "rejected", p_moderator: "Ben", p_note: "not theirs" });
});

test("hand-worked: a 7-day hold ends 7 x 86,400 s after now; a closed account has no end; days at the edges", async () => {
  const { handle, db } = world();
  const res = await handle(ask({ do: "hold", user: BEN, days: 7, reason: "Spam links", take_links: true, note: "three reports" }));
  assert.equal(res.status, 200);
  // NOW is 2026-11-11 04:00 UTC; seven days on is 2026-11-18 04:00 UTC.
  assert.deepEqual(JSON.parse(db()[0].body), { p_user: BEN, p_until: "2026-11-18T04:00:00.000Z", p_reason: "Spam links", p_take_links: true, p_moderator: "Ben", p_note: "three reports" });
  await handle(ask({ do: "hold", user: BEN, days: null, reason: "Closed", take_links: false, note: "x" }));
  assert.equal(JSON.parse(db()[1].body).p_until, null);
  assert.equal(MAX_HOLD_DAYS, 3650);
  for (const days of [0, -1, 1.5, 3651, "7", undefined]) assert.equal((await handle(ask({ do: "hold", user: BEN, days, reason: "r", take_links: false, note: "x" }))).status, 400, String(days));
  assert.equal((await handle(ask({ do: "hold", user: BEN, days: 3650, reason: "r", take_links: false, note: "x" }))).status, 200);
  assert.equal((await handle(ask({ do: "hold", user: BEN, days: 1, reason: "r", take_links: "yes", note: "x" }))).status, 400);
  assert.equal((await handle(ask({ do: "hold", user: BEN, days: 1, reason: "r".repeat(501), take_links: false, note: "x" }))).status, 400);
});

test("the request is read no further than 64 KiB: 0.9x passes the size check, 1.1x is refused", async () => {
  const { handle } = world();
  const padded = (bytes: number) => {
    const base = JSON.stringify({ do: "me", pad: "" });
    return JSON.stringify({ do: "me", pad: "p".repeat(bytes - base.length) });
  };
  assert.equal((await handle(ask(null, { raw: padded(Math.floor(MAX_REQUEST_BYTES * 0.9)) }))).status, 200);
  assert.equal((await handle(ask(null, { raw: padded(Math.floor(MAX_REQUEST_BYTES * 1.1)) }))).status, 413);
});

test("a link's view reads only that link's rows, never its file; the file only when asked", async () => {
  const { handle, db } = world({ rows: { shares: [{ id: LINK, name: "Bracket" }] } });
  const res = await handle(ask({ do: "link", share: LINK }));
  assert.equal(res.status, 200);
  const urls = db().map((c) => c.url);
  assert.ok(urls.every((u) => u.includes(`share_id=eq.${LINK}`) || u.includes(`id=eq.${LINK}`)), urls.join("\n"));
  assert.ok(!urls[0].includes("body"), "the link's file isn't sent with the list");
  assert.ok(db().every((c) => c.method === "GET" && c.headers.get("authorization") === "Bearer service"));
  await handle(ask({ do: "design", share: LINK }));
  assert.match(db().at(-1)!.url, /select=name,body$/);
});

test("the owner's email is given only for a link that is down", async () => {
  const up = world({ rows: { shares: [{ name: "Bracket", user_id: BEN, removed_at: null }] } });
  assert.deepEqual(await (await up.handle(ask({ do: "notice", share: LINK }))).json(), { email: null });
  assert.ok(!up.db().some((c) => c.url.includes("/admin/")), "no account read for a link that is up");
  const down = world({ rows: { shares: [{ name: "Bracket", user_id: BEN, removed_at: "2026-11-11T03:00:00Z" }] } });
  assert.deepEqual(await (await down.handle(ask({ do: "notice", share: LINK }))).json(), { email: "owner@example.com", name: "Bracket" });
  assert.equal(down.db().at(-1)!.url, `https://db.test/auth/v1/admin/users/${BEN}`);
});

test("the record pages back by id; a `before` that isn't a whole number is refused", async () => {
  const { handle, db } = world();
  await handle(ask({ do: "log" }));
  await handle(ask({ do: "log", before: 250 }));
  assert.ok(!db()[0].url.includes("id=lt."));
  assert.ok(db()[1].url.endsWith("&id=lt.250"));
  for (const before of [0, "250", 1.5, "1&id=gt.0"]) assert.equal((await handle(ask({ do: "log", before }))).status, 400);
});

test("a database that fails is said as unavailable, with nothing of the failure sent to the page", async () => {
  const { handle, logs } = world({ db: "down" });
  const res = await handle(ask({ do: "queue" }));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "unavailable" });
  assert.deepEqual(logs, ["failed: queue: rpc review_queue 500"]);
});

test("a person's view gives their display name from the name column, and null with none", async () => {
  const named = world({ rows: { display_names: [{ name: "Bo P" }] } });
  assert.equal(((await (await named.handle(ask({ do: "person", user: BEN }))).json()) as { name: unknown }).name, "Bo P");
  const none = world();
  assert.deepEqual(await (await none.handle(ask({ do: "person", user: BEN }))).json(), { name: null, hold: null, links: [], record: [] });
});
