// The billing function (supabase/functions/billing/index.ts) against a fake Stripe
// and a fake Supabase. The database's own rules are checked on a real PostgreSQL in
// supabase/test; here the fake database is a plain model of the same four functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { repoFile } from "./repo-file.ts";

const { billing, returnAddress, signatureOk, SIGNATURE_TOLERANCE_S, stripeSignature } = (await import(repoFile("supabase/functions/billing/index.ts").href)) as typeof import("../../../supabase/functions/billing/index.ts");

const ADA = "11111111-1111-4111-8111-111111111111";
const WHSEC = "whsec_test_secret";
const NOW = 1_800_000_000_000;

type Sub = { id: string; customer: string; status: string; current_period_end: number; cancel_at_period_end: boolean; livemode?: boolean };

function world(envOver: Record<string, string | undefined> = {}) {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_MONTHLY: "price_M",
    STRIPE_PRICE_YEARLY: "price_Y",
    STRIPE_COUPON_FIRST_YEAR: "coupon_FY",
    SUPABASE_URL: "https://db.test",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    ...envOver,
  };
  const s = {
    customers: new Map<string, { email: string; user: string }>(),
    subs: new Map<string, Sub>(),
    sessions: [] as Record<string, string>[],
    billing: new Map<string, { customer: string; sub?: string; status?: string }>(),
    plans: new Map<string, { plan: string; renews_at: string | null; cancels: boolean }>([[ADA, { plan: "free", renews_at: null, cancels: false }]]),
    users: new Set([ADA]),
    stripeDown: false,
    calls: [] as string[],
  };
  let n = 0;
  const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const h = new Headers(init.headers);
    s.calls.push(`${method} ${url.host}${url.pathname}`);
    if (url.host === "api.stripe.com") {
      if (s.stripeDown) return json(500, { error: {} });
      assert.equal(h.get("authorization"), `Bearer ${env.STRIPE_SECRET_KEY}`);
      const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
      const path = url.pathname.replace("/v1/", "");
      if (path === "customers" && method === "POST") {
        const id = `cus_${++n}`;
        s.customers.set(id, { email: form.email!, user: form["metadata[user_id]"]! });
        return json(200, { id });
      }
      if (path.startsWith("customers/") && method === "DELETE") {
        const id = path.slice(10);
        if (!s.customers.delete(id)) return json(404, {});
        for (const sub of s.subs.values()) if (sub.customer === id) sub.status = "canceled";
        return json(200, { id, deleted: true });
      }
      if (path === "subscriptions" && method === "GET") return json(200, { data: [...s.subs.values()].filter((x) => x.customer === url.searchParams.get("customer")) });
      if (path.startsWith("subscriptions/")) {
        const sub = s.subs.get(path.slice(14));
        if (!sub) return json(404, {});
        if (method === "DELETE") sub.status = "canceled";
        return json(200, sub);
      }
      if (path === "checkout/sessions") {
        s.sessions.push(form);
        return json(200, { url: `https://checkout.stripe.com/c/pay/cs_test_${s.sessions.length}` });
      }
      if (path === "billing_portal/sessions") return json(200, { url: "https://billing.stripe.com/p/session/test_1" });
      return json(404, {});
    }
    assert.equal(url.host, "db.test");
    if (url.pathname === "/auth/v1/user") return h.get("authorization") === "Bearer ada-token" && s.users.has(ADA) ? json(200, { id: ADA, email: "ada@example.com" }) : json(401, {});
    const fn = url.pathname.replace("/rest/v1/rpc/", "");
    const a = JSON.parse(String(init.body ?? "{}"));
    const asServer = h.get("authorization") === "Bearer service";
    if (fn === "delete_my_account") {
      if (h.get("authorization") !== "Bearer ada-token") return json(401, {});
      if (s.billing.has(ADA)) return json(400, { message: "payments linked" });
      s.users.delete(ADA);
      s.plans.delete(ADA);
      return json(204, undefined);
    }
    if (!asServer) return json(401, {});
    if (fn === "billing_customer") return json(200, s.billing.get(a.p_user)?.customer ?? null);
    if (fn === "link_stripe_customer") {
      if (!s.billing.has(a.p_user)) s.billing.set(a.p_user, { customer: a.p_customer });
      return json(200, s.billing.get(a.p_user)!.customer);
    }
    if (fn === "forget_billing") {
      s.billing.delete(a.p_user);
      return json(204, undefined);
    }
    if (fn === "set_plan_from_stripe") {
      const who = [...s.billing.entries()].find(([, b]) => b.customer === a.p_customer)?.[0];
      if (!who) return json(200, false);
      const pro = ["active", "trialing", "past_due"].includes(a.p_status);
      s.plans.set(who, { plan: pro ? "pro" : "free", renews_at: pro ? a.p_renews_at : null, cancels: pro && a.p_cancels });
      return json(200, true);
    }
    return json(404, {});
  };
  const handle = billing({ env, fetch: fakeFetch as typeof fetch, now: () => NOW });
  const call = (route: string, body: unknown = {}, token: string | null = "ada-token", headers: Record<string, string> = {}) =>
    handle(new Request(`https://db.test/functions/v1/billing/${route}`, { method: "POST", headers: { origin: "https://spindlelabs.app", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  async function webhook(event: unknown, at = NOW / 1000, secret = WHSEC) {
    const raw = JSON.stringify(event);
    const t = String(Math.floor(at));
    return call("webhook", raw, null, { "stripe-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}` });
  }
  /** Stripe making a subscription for the customer, as paying on the checkout page does. */
  function paid(customer: string, status = "active"): Sub {
    const sub = { id: `sub_${++n}`, customer, status, current_period_end: 1_802_563_200, cancel_at_period_end: false };
    s.subs.set(sub.id, sub);
    return sub;
  }
  return { s, env, call, webhook, paid, handle };
}

// Signatures

test("the webhook signature is HMAC-SHA256 of '<t>.<body>', matching node's own HMAC", async () => {
  // An independent implementation (node:crypto rather than WebCrypto) over Stripe's documented signed payload.
  const want = createHmac("sha256", WHSEC).update('1800000000.{"id":"evt_1"}').digest("hex");
  assert.equal(await stripeSignature(WHSEC, "1800000000", '{"id":"evt_1"}'), want);
});

test("a signature is accepted within the tolerance and refused just outside it (0.9× and 1.1×)", async () => {
  const body = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  const header = `t=${t},v1=${await stripeSignature(WHSEC, String(t), body)}`;
  assert.equal(await signatureOk(header, body, WHSEC, t + 0.9 * SIGNATURE_TOLERANCE_S), true); // 270 s late
  assert.equal(await signatureOk(header, body, WHSEC, t - 0.9 * SIGNATURE_TOLERANCE_S), true); // a clock 270 s fast
  assert.equal(await signatureOk(header, body, WHSEC, t + 1.1 * SIGNATURE_TOLERANCE_S), false); // 330 s late: a replay
  assert.equal(await signatureOk(header, body, WHSEC, t - 1.1 * SIGNATURE_TOLERANCE_S), false);
});

test("a forged, altered, unsigned or wrongly keyed webhook is refused", async () => {
  const body = '{"id":"evt_1"}';
  const t = "1800000000";
  const good = await stripeSignature(WHSEC, t, body);
  const now = 1_800_000_000;
  assert.equal(await signatureOk(`t=${t},v1=${good}`, body, WHSEC, now), true);
  assert.equal(await signatureOk(`t=${t},v1=${good}`, body.replace("1", "2"), WHSEC, now), false, "body changed");
  assert.equal(await signatureOk(`t=1800000001,v1=${good}`, body, WHSEC, now), false, "time changed");
  assert.equal(await signatureOk(`t=${t},v1=${await stripeSignature("whsec_other", t, body)}`, body, WHSEC, now), false, "other secret");
  assert.equal(await signatureOk(`t=${t},v0=${good}`, body, WHSEC, now), false, "only v1 counts");
  assert.equal(await signatureOk(null, body, WHSEC, now), false);
  assert.equal(await signatureOk(`t=${t},v1=${good}`, body, "", now), false, "no secret set: nothing is accepted");
  assert.equal(await signatureOk(`t=${t},v1=bad,v1=${good}`, body, WHSEC, now), true, "one good signature among several (Stripe rolling a secret)");
});

test("a checkout returns only to the app's own pages", () => {
  const allowed = ["https://spindlelabs.app", "https://spindlelabs-app.github.io"];
  assert.equal(returnAddress("https://spindlelabs.app/?x=1#y", allowed), "https://spindlelabs.app/");
  assert.equal(returnAddress("https://spindlelabs-app.github.io/SpindleLabs/", allowed), "https://spindlelabs-app.github.io/SpindleLabs/");
  assert.equal(returnAddress("https://evil.example/", allowed), "https://spindlelabs.app/");
  assert.equal(returnAddress("https://spindlelabs.app.evil.example/", allowed), "https://spindlelabs.app/");
  assert.equal(returnAddress("https://u:p@spindlelabs.app/", allowed), "https://spindlelabs.app/");
  assert.equal(returnAddress(42, allowed), "https://spindlelabs.app/");
});

// Test mode only

test("a live secret key is refused while test mode is the rule", async () => {
  const w = world({ STRIPE_SECRET_KEY: "sk_live_abc" });
  const r = await w.call("checkout", { plan: "monthly" });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: "test-mode-only" });
  assert.deepEqual(w.s.calls, [], "nothing was contacted");
  assert.equal((await world({ STRIPE_SECRET_KEY: "sk_live_abc", ALLOW_LIVE: "yes" }).call("checkout", { plan: "monthly" })).status, 200);
});

test("a live event is ignored in test mode, even correctly signed", async () => {
  const w = world();
  const sub = w.paid("cus_x");
  const r = await w.webhook({ type: "customer.subscription.updated", livemode: true, data: { object: { id: sub.id } } });
  assert.deepEqual(await r.json(), { ignored: "live" });
});

test("with no secret key set, every route says it isn't set up", async () => {
  const r = await world({ STRIPE_SECRET_KEY: undefined }).call("checkout", { plan: "monthly" });
  assert.deepEqual([r.status, await r.json()], [503, { error: "not-set-up" }]);
});

// Checkout

test("monthly checkout: one customer linked to the person, the US$9 price, no coupon", async () => {
  const w = world();
  const r = await w.call("checkout", { plan: "monthly", returnTo: "https://spindlelabs.app/" });
  assert.equal(r.status, 200);
  assert.match((await r.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://spindlelabs.app");
  const [form] = w.s.sessions;
  assert.equal(form!["line_items[0][price]"], "price_M");
  assert.equal(form!["discounts[0][coupon]"], undefined);
  assert.equal(form!.client_reference_id, ADA);
  assert.equal(form!.success_url, "https://spindlelabs.app/?checkout=done");
  assert.equal(w.s.billing.get(ADA)?.customer, "cus_1");
  assert.equal(w.s.customers.get("cus_1")?.user, ADA);
  // A second try reuses the same customer.
  await w.call("checkout", { plan: "monthly" });
  assert.equal(w.s.customers.size, 1);
});

test("yearly checkout: the US$90 price with the first-year coupon", async () => {
  const w = world();
  assert.equal((await w.call("checkout", { plan: "yearly" })).status, 200);
  assert.equal(w.s.sessions[0]!["line_items[0][price]"], "price_Y");
  assert.equal(w.s.sessions[0]!["discounts[0][coupon]"], "coupon_FY");
});

test("someone already on Pro gets no second subscription", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  w.paid("cus_1");
  const r = await w.call("checkout", { plan: "yearly" });
  assert.deepEqual([r.status, await r.json()], [409, { error: "already-pro" }]);
  assert.equal(w.s.sessions.length, 1);
});

test("checkout needs a signed-in person and a real plan", async () => {
  const w = world();
  assert.equal((await w.call("checkout", { plan: "monthly" }, null)).status, 401);
  assert.equal((await w.call("checkout", { plan: "monthly" }, "forged-token")).status, 401);
  assert.equal((await w.call("checkout", { plan: "lifetime" })).status, 400);
  assert.equal((await w.call("checkout", "not json")).status, 400);
  assert.equal(w.s.customers.size, 0);
});

test("Stripe being down answers 'unavailable', never a half-made checkout", async () => {
  const w = world();
  w.s.stripeDown = true;
  const r = await w.call("checkout", { plan: "monthly" });
  assert.deepEqual([r.status, await r.json()], [502, { error: "unavailable" }]);
  assert.equal(w.s.billing.size, 0);
});

// Webhook

test("paying makes the person Pro; cancelling keeps Pro to the period's end; the end makes them free", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  const sub = w.paid("cus_1");
  assert.equal((await w.webhook({ type: "checkout.session.completed", data: { object: { subscription: sub.id } } })).status, 200);
  // current_period_end 1,802,563,200 s / 86,400 = 20,863 days. 1970 to 2027 is 57 years with 14 leap days (1972..2024),
  // so 2027-01-01 is day 57×365 + 14 = 20,819; plus 31 for January = 20,850 (1 Feb); plus 13 = 20,863: 2027-02-14T00:00Z.
  assert.deepEqual(w.s.plans.get(ADA), { plan: "pro", renews_at: "2027-02-14T00:00:00.000Z", cancels: false });
  sub.cancel_at_period_end = true;
  await w.webhook({ type: "customer.subscription.updated", data: { object: { id: sub.id, status: "active" } } });
  assert.deepEqual(w.s.plans.get(ADA), { plan: "pro", renews_at: "2027-02-14T00:00:00.000Z", cancels: true });
  sub.status = "canceled";
  await w.webhook({ type: "customer.subscription.deleted", data: { object: { id: sub.id } } });
  assert.deepEqual(w.s.plans.get(ADA), { plan: "free", renews_at: null, cancels: false });
});

test("the plan follows what Stripe says now, not the event's stale copy", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  const sub = w.paid("cus_1", "canceled");
  // An old "active" event arriving after the cancellation must not give Pro back.
  await w.webhook({ type: "customer.subscription.updated", data: { object: { id: sub.id, status: "active" } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
});

test("a badly signed webhook changes nothing", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  const sub = w.paid("cus_1");
  const r = await w.webhook({ type: "customer.subscription.created", data: { object: { id: sub.id } } }, NOW / 1000, "whsec_guess");
  assert.equal(r.status, 400);
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
  const old = await w.webhook({ type: "customer.subscription.created", data: { object: { id: sub.id } } }, NOW / 1000 - 1.1 * SIGNATURE_TOLERANCE_S);
  assert.equal(old.status, 400);
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
});

test("a subscription whose person has no account any more is cancelled at Stripe", async () => {
  const w = world();
  const sub = w.paid("cus_orphan");
  assert.equal((await w.webhook({ type: "customer.subscription.updated", data: { object: { id: sub.id } } })).status, 200);
  assert.equal(sub.status, "canceled");
});

test("a failure asks Stripe to send the event again; other events are ignored", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  const sub = w.paid("cus_1");
  w.s.stripeDown = true;
  assert.equal((await w.webhook({ type: "customer.subscription.updated", data: { object: { id: sub.id } } })).status, 500);
  w.s.stripeDown = false;
  assert.deepEqual(await (await w.webhook({ type: "invoice.paid", data: { object: {} } })).json(), { ignored: "invoice.paid" });
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
});

// Portal and deleting

test("the portal is for people who have paid", async () => {
  const w = world();
  assert.equal((await w.call("portal")).status, 404);
  await w.call("checkout", { plan: "monthly" });
  const r = await w.call("portal", { returnTo: "https://spindlelabs.app/" });
  assert.match((await r.json()).url, /^https:\/\/billing\.stripe\.com\//);
  assert.equal((await w.call("portal", {}, null)).status, 401);
});

test("deleting an account with Pro ends the subscription at Stripe first, then deletes the account", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  const sub = w.paid("cus_1");
  const r = await w.call("delete-account");
  assert.deepEqual([r.status, await r.json()], [200, { deleted: true }]);
  assert.equal(sub.status, "canceled");
  assert.equal(w.s.customers.size, 0);
  assert.equal(w.s.users.has(ADA), false);
});

test("if Stripe can't be reached, the account is kept (so nothing is charged after it's gone)", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  w.paid("cus_1");
  w.s.stripeDown = true;
  assert.equal((await w.call("delete-account")).status, 502);
  assert.equal(w.s.users.has(ADA), true);
  assert.equal(w.s.billing.has(ADA), true);
});

test("deleting an account that never paid needs no Stripe at all", async () => {
  const w = world();
  assert.equal((await w.call("delete-account")).status, 200);
  assert.equal(w.s.calls.some((c) => c.includes("stripe")), false);
  assert.equal(w.s.users.has(ADA), false);
});

test("unknown routes, other methods and other sites' preflights get nothing useful", async () => {
  const w = world();
  assert.equal((await w.call("refund")).status, 404);
  const get = await w.handle(new Request("https://db.test/functions/v1/billing/checkout"));
  assert.equal(get.status, 405);
  const pre = await w.handle(new Request("https://db.test/functions/v1/billing/checkout", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
  assert.equal(pre.headers.get("access-control-allow-origin"), null);
});

// Security hunt 2026-11-13 (SpindleLabs-app/bug-reports#3), billing C1-C3.

test("the first-year coupon is given once, never again to someone who cancels and takes yearly again (C1)", async () => {
  const w = world();
  assert.equal((await w.call("checkout", { plan: "yearly" })).status, 200);
  assert.equal(w.s.sessions[0]!["discounts[0][coupon]"], "coupon_FY", "the first year has it");
  const first = w.paid("cus_1");
  await w.webhook({ type: "customer.subscription.created", data: { object: { id: first.id } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "pro");
  // The year ends (cancelled at period end): Stripe says canceled.
  first.status = "canceled";
  await w.webhook({ type: "customer.subscription.deleted", data: { object: { id: first.id } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
  // Year two: the same person, the same Stripe customer, takes yearly again: US$90, not US$54.
  assert.equal((await w.call("checkout", { plan: "yearly" })).status, 200);
  assert.equal(w.s.sessions[1]!.customer, "cus_1");
  assert.equal(w.s.sessions[1]!["discounts[0][coupon]"], undefined, "the second year of the same customer has no first-year coupon");
});

test("a first attempt that was never paid doesn't use up the first-year coupon (C1)", async () => {
  const w = world();
  await w.call("checkout", { plan: "yearly" });
  // The card's confirmation was closed: Stripe keeps the subscription incomplete, then expires it.
  const tried = w.paid("cus_1", "incomplete");
  tried.status = "incomplete_expired";
  assert.equal((await w.call("checkout", { plan: "yearly" })).status, 200);
  assert.equal(w.s.sessions[1]!["discounts[0][coupon]"], "coupon_FY", "nothing was ever paid, so the first year is still to come");
  // A monthly subscription paid once counts as having paid: yearly after it has no first-year coupon.
  w.paid("cus_1", "canceled");
  assert.equal((await w.call("checkout", { plan: "yearly" })).status, 200);
  assert.equal(w.s.sessions[2]!["discounts[0][coupon]"], undefined);
});

test("an abandoned first attempt expiring a day later doesn't take Pro from the subscription that is paid (C2)", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  // First try: the card needed a confirmation that was never given. Stripe keeps the subscription "incomplete".
  const tried = w.paid("cus_1", "incomplete");
  await w.webhook({ type: "customer.subscription.created", data: { object: { id: tried.id } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
  // Checkout again is allowed (incomplete is not Pro), and this one is paid.
  assert.equal((await w.call("checkout", { plan: "monthly" })).status, 200);
  const good = w.paid("cus_1", "active");
  await w.webhook({ type: "customer.subscription.created", data: { object: { id: good.id } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "pro");
  // 23 hours later Stripe expires the first try and says so.
  tried.status = "incomplete_expired";
  assert.equal((await w.webhook({ type: "customer.subscription.updated", data: { object: { id: tried.id } } })).status, 200);
  assert.equal(w.s.plans.get(ADA)?.plan, "pro", "the paying customer stays Pro");
  assert.equal(w.s.plans.get(ADA)?.renews_at, new Date(good.current_period_end * 1000).toISOString(), "and renews when the paid one does");
});

test("a late event for a dead subscription, after the paid one's, doesn't take Pro either (C2, the other order)", async () => {
  const w = world();
  await w.call("checkout", { plan: "monthly" });
  const dead = w.paid("cus_1", "incomplete_expired");
  const good = w.paid("cus_1", "active");
  await w.webhook({ type: "customer.subscription.created", data: { object: { id: good.id } } });
  await w.webhook({ type: "customer.subscription.created", data: { object: { id: dead.id } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "pro");
  // When the paid one ends, every subscription is dead: free.
  good.status = "canceled";
  await w.webhook({ type: "customer.subscription.deleted", data: { object: { id: good.id } } });
  assert.equal(w.s.plans.get(ADA)?.plan, "free");
});

test("checkout pressed several times at once leaves one Stripe customer (C3)", async () => {
  const w = world();
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => w.call("checkout", { plan: "monthly" })));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal(w.s.customers.size, 1, `${w.s.customers.size} Stripe customers for one account (one linked, the rest orphans)`);
  assert.deepEqual([...new Set(w.s.sessions.map((x) => x.customer))], [[...w.s.customers.keys()][0]], "every checkout for the linked one");
});
