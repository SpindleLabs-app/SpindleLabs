// Tests written to kill the mutants StrykerJS found surviving in the browser's
// side of billing (data.ts: plan, checkout, manage, deleting through the
// billing function; auth.ts: asPersonFunction) once the account target could
// run again. Each test names the change it catches. Nothing here talks to a
// network: the service is a stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, type AuthClient, type PersonReply } from "../src/auth.ts";
import { accountData } from "../src/data.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";

/** A stand-in client: `fn` answers server functions, `rest` the data API; every call is recorded. */
function stub(fn: (path: string, body: unknown) => PersonReply, rest: (method: string, path: string) => PersonReply = () => ({ kind: "failed", reason: "unavailable" })) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let forgotten = 0;
  const client = {
    state: () => ({ kind: "signed-in", user: { id: "u1" } }),
    async asPerson(method: string, path: string) {
      calls.push(`${method} ${path}`);
      return rest(method, path);
    },
    async asPersonFunction(path: string, body?: unknown) {
      calls.push(`fn ${path}`);
      bodies.push(body);
      return fn(path, body);
    },
    forget() {
      forgotten++;
    },
  } as unknown as AuthClient;
  return { data: accountData(client), calls, bodies, forgotten: () => forgotten };
}
const ok = (body: unknown): PersonReply => ({ kind: "ok", body });
const malformed = { kind: "failed", reason: "malformed" };

// ---------- deleteAccount ----------

test("deleting goes through the billing function first; signed out there stops at once", async () => {
  // Kills "billing/delete-account" => "", `viaBilling.kind === "signed-out"` => false and its "signed-out" => "".
  const s = stub(() => ({ kind: "signed-out" }), () => ok(null));
  assert.deepEqual(await s.data.deleteAccount(), { kind: "signed-out" });
  assert.deepEqual(s.calls, ["fn billing/delete-account"]);
  assert.equal(s.forgotten(), 0);
});

test("deleting: when billing succeeds the database is not asked again; when it fails the database's own delete runs", async () => {
  // Kills `viaBilling.kind !== "ok"` => true and its "ok" => "".
  const done = stub(() => ok({}), () => assert.fail("the database is not asked when billing deleted the account"));
  assert.deepEqual(await done.data.deleteAccount(), { kind: "ok", value: true });
  assert.deepEqual(done.calls, ["fn billing/delete-account"]);
  assert.equal(done.forgotten(), 1);

  const fallback = stub(() => ({ kind: "failed", reason: "unavailable" }), () => ok(null));
  assert.deepEqual(await fallback.data.deleteAccount(), { kind: "ok", value: true });
  assert.deepEqual(fallback.calls, ["fn billing/delete-account", "POST rpc/delete_my_account"]);
  assert.equal(fallback.forgotten(), 1);

  const neither = stub(() => ({ kind: "failed", reason: "unavailable" }), () => ({ kind: "failed", reason: "rejected" }));
  assert.deepEqual(await neither.data.deleteAccount(), { kind: "failed", reason: "rejected" });
  assert.equal(neither.forgotten(), 0, "nothing is forgotten while the account still exists");
});

// ---------- plan ----------

test("the plan is read from one row: its plan, renewal date or none, and whether it cancels", async () => {
  // Kills the path, `r.kind !== "ok"`, the row checks and the result object being emptied.
  const row = { plan: "pro", renews_at: "2026-12-06T00:00:00Z", cancels_at_period_end: false };
  const s = stub(() => assert.fail(), () => ok([row]));
  assert.deepEqual(await s.data.plan(), { kind: "ok", value: { plan: "pro", renewsAt: "2026-12-06T00:00:00Z", cancels: false } });
  assert.deepEqual(s.calls, ["GET plans?select=plan,renews_at,cancels_at_period_end"]);
  assert.deepEqual(await stub(() => assert.fail(), () => ok([{ plan: "free", renews_at: null, cancels_at_period_end: true }])).data.plan(), { kind: "ok", value: { plan: "free", renewsAt: null, cancels: true } });
  assert.deepEqual(await stub(() => assert.fail(), () => ok([{ ...row, plan: "team" }])).data.plan(), { kind: "ok", value: { plan: "team", renewsAt: row.renews_at, cancels: false } });
  assert.deepEqual(await stub(() => assert.fail(), () => ({ kind: "failed", reason: "offline" })).data.plan(), { kind: "failed", reason: "offline" });
});

test("a plan answer that isn't exactly one well-formed row is malformed", async () => {
  // Kills each part of the row check: an array of one, a known plan, a renewal date that is null or text, a yes/no cancel.
  const row = { plan: "pro", renews_at: null, cancels_at_period_end: false };
  const bad: unknown[] = [
    row, // not a list
    [],
    [row, row],
    [null],
    [{ ...row, plan: "gold" }],
    [{ ...row, plan: undefined }],
    [{ ...row, renews_at: 5 }],
    [{ ...row, renews_at: undefined }],
    [{ ...row, cancels_at_period_end: "no" }],
    [{ plan: "pro", renews_at: null }],
  ];
  for (const body of bad) assert.deepEqual(await stub(() => assert.fail(), () => ok(body)).data.plan(), malformed, JSON.stringify(body));
});

// ---------- checkout and manage ----------

test("checkout asks the billing function for Stripe's checkout page and only ever returns one", async () => {
  // Kills "billing/checkout" => "", { plan: which, returnTo } => {}, "https://checkout.stripe.com/" => "",
  // and the url checks (typeof, &&, startsWith => endsWith, the ok result emptied, `?.url` => `.url`).
  const page = "https://checkout.stripe.com/c/pay/cs_test_1";
  const s = stub(() => ok({ url: page }));
  assert.deepEqual(await s.data.checkout("yearly", APP), { kind: "ok", value: page });
  assert.deepEqual(s.calls, ["fn billing/checkout"]);
  assert.deepEqual(s.bodies, [{ plan: "yearly", returnTo: APP }]);
  for (const body of [{ url: "https://evil.example/" }, { url: "https://evil.example/?https://checkout.stripe.com/" }, { url: "https://billing.stripe.com/p/1" }, { url: 7 }, {}, undefined, null]) {
    assert.deepEqual(await stub(() => ok(body)).data.checkout("monthly", APP), malformed, JSON.stringify(body));
  }
  assert.deepEqual(await stub(() => ({ kind: "signed-out" })).data.checkout("monthly", APP), { kind: "signed-out" });
});

test("manage asks for Stripe's billing page and only ever returns one", async () => {
  // Kills "billing/portal" => "", { returnTo } => {}, "https://billing.stripe.com/" => "" and the block emptied.
  const page = "https://billing.stripe.com/p/session/1";
  const s = stub(() => ok({ url: page }));
  assert.deepEqual(await s.data.manage(APP), { kind: "ok", value: page });
  assert.deepEqual(s.calls, ["fn billing/portal"]);
  assert.deepEqual(s.bodies, [{ returnTo: APP }]);
  assert.deepEqual(await stub(() => ok({ url: "https://checkout.stripe.com/c/1" })).data.manage(APP), malformed);
});

// ---------- auth.ts: asPersonFunction ----------

test("a server function is POSTed to /functions/v1/ with the person's token and the body, or {} when none", async () => {
  // Kills "POST" => "", `/functions/v1/${path}` => ``, `body ?? {}` => `body && {}`, and each reply object or its kind emptied.
  const ms = 1_800_000_000_000;
  const svc = fakeService(() => ms / 1000);
  const seen: { url: string; method?: string; body?: unknown; auth?: string }[] = [];
  let status = 200;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(`${SERVICE}/functions/v1/`)) return svc.fetch(input, init);
    seen.push({ url, method: init?.method, body: init?.body, auth: (init?.headers as Record<string, string>).authorization });
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), { status });
  }) as typeof globalThis.fetch;
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch, store: memoryStore(), now: () => ms, random: seededRandom(5) });
  const go = new URL((await client.beginSignIn())!);
  assert.equal((await client.finishSignIn(`${APP}?code=${svc.approve(go.searchParams.get("code_challenge")!)}`)).kind, "signed-in");

  assert.deepEqual(await client.asPersonFunction("billing/checkout", { plan: "monthly" }), { kind: "ok", body: { url: "https://checkout.stripe.com/x" } });
  assert.deepEqual(await client.asPersonFunction("billing/delete-account"), { kind: "ok", body: { url: "https://checkout.stripe.com/x" } });
  assert.deepEqual(seen.map((s) => [s.url, s.method, s.body]), [
    [`${SERVICE}/functions/v1/billing/checkout`, "POST", '{"plan":"monthly"}'],
    [`${SERVICE}/functions/v1/billing/delete-account`, "POST", "{}"],
  ]);
  assert.ok(seen.every((s) => s.auth?.startsWith("Bearer access-")), "sent as the signed-in person");
  status = 503;
  assert.deepEqual(await client.asPersonFunction("billing/portal", {}), { kind: "failed", reason: "unavailable" });
});
