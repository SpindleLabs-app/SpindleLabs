// SpindleLabs' billing function (a Supabase Edge Function, Deno): the only code
// that talks to Stripe. One file with no imports, so it can be pasted into the
// Supabase dashboard's editor as it is. Deploy it with "Verify JWT" OFF: Stripe's
// webhook carries no Supabase token, so every route checks who is calling itself.
//
//   POST /billing/checkout        signed in: a Stripe Checkout page for Pro, monthly or yearly
//   POST /billing/portal          signed in: Stripe's page to change or cancel Pro
//   POST /billing/delete-account  signed in: deletes the Stripe customer (ending any
//                                 subscription at once), then the account
//   POST /billing/webhook         Stripe only (signed): keeps public.plans in step with Stripe
//
// TEST MODE ONLY until the lawyer's review and the hosting move: a live secret key
// or a live event is refused unless ALLOW_LIVE is "yes".
//
// Secrets (Supabase dashboard > Edge Functions > Secrets; never in the code or the chat):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY,
//   STRIPE_COUPON_FIRST_YEAR. Supabase itself provides SUPABASE_URL, SUPABASE_ANON_KEY
//   and SUPABASE_SERVICE_ROLE_KEY.
// Tested in node by packages/account/test/billing.test.ts against a fake Stripe and Supabase.

export type Env = Record<string, string | undefined>;
export type Deps = { env: Env; fetch: typeof fetch; now: () => number };

/** The addresses the app is served from; a checkout returns only to one of these. */
export const APP_ORIGINS = ["https://spindlelabs.app", "https://www.spindlelabs.app", "https://spindlelabs-app.github.io"];
/** Stripe's API version these requests are written for (subscriptions carry current_period_end). */
export const STRIPE_VERSION = "2024-06-20";
/** How old a webhook's signed time may be, in seconds (Stripe's own default). */
export const SIGNATURE_TOLERANCE_S = 300;
/** Stripe's subscription statuses that keep Pro (the database maps them the same way). */
export const PRO_STATUSES = ["active", "trialing", "past_due"];
/** Stripe's statuses of a subscription that was never paid: the first try's card was never confirmed. */
export const NEVER_PAID_STATUSES = ["incomplete", "incomplete_expired"];

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Equal strings, compared in time that doesn't depend on where they differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Stripe's v1 signature: HMAC-SHA256 of "<t>.<body>" with the endpoint's secret, as hex. */
export async function stripeSignature(secret: string, t: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)));
}

/** Whether a Stripe-Signature header signs `body` with `secret`, made within the tolerance of `nowS`. */
export async function signatureOk(header: string | null, body: string, secret: string, nowS: number): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k, v]) => k === "v1" && typeof v === "string").map(([, v]) => v as string);
  if (!t || !/^\d{1,12}$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowS - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
  const want = await stripeSignature(secret, t, body);
  return sigs.some((s) => sameText(s, want));
}

/** A return address that is one of the app's own pages, or the app's home page. */
export function returnAddress(asked: unknown, allowed: readonly string[]): string {
  if (typeof asked === "string") {
    try {
      const u = new URL(asked);
      if (allowed.includes(u.origin) && !u.username && !u.password) return u.origin + u.pathname;
    } catch {
      // not an address: the home page
    }
  }
  return `${allowed[0]}/`;
}

export function billing(deps: Deps) {
  const { env } = deps;
  const origins = [...APP_ORIGINS, ...(env.EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  const liveAllowed = env.ALLOW_LIVE === "yes";

  function cors(req: Request): Record<string, string> {
    const o = req.headers.get("origin");
    return o && origins.includes(o)
      ? { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" }
      : {};
  }
  const reply = (req: Request, status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });

  /** A Stripe API request, form-encoded; null on any failure. */
  async function stripe(method: "GET" | "POST" | "DELETE", path: string, form?: Record<string, string>): Promise<Record<string, unknown> | null> {
    try {
      const res = await deps.fetch(`https://api.stripe.com/v1/${path}`, {
        method,
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "stripe-version": STRIPE_VERSION, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body === "object" && body !== null ? body : null;
    } catch {
      return null;
    }
  }

  /** A database function run as the server (service_role); undefined on failure. */
  async function rpc(name: string, args: Record<string, unknown>, bearer = env.SUPABASE_SERVICE_ROLE_KEY, key = env.SUPABASE_SERVICE_ROLE_KEY): Promise<unknown> {
    try {
      const res = await deps.fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: key ?? "", authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) return undefined;
      const text = await res.text();
      return text === "" ? null : JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** The signed-in person making the request, checked with Supabase's sign-in service. */
  async function person(req: Request): Promise<{ id: string; email: string; token: string } | null> {
    const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return null;
    try {
      const res = await deps.fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY ?? "", authorization: `Bearer ${m[1]}` } });
      if (!res.ok) return null;
      const u = await res.json();
      return typeof u?.id === "string" && /^[0-9a-f-]{36}$/.test(u.id) ? { id: u.id, email: typeof u.email === "string" ? u.email : "", token: m[1] } : null;
    } catch {
      return null;
    }
  }

  /** The person's Stripe customer, made and linked the first time. */
  async function customerFor(who: { id: string; email: string }): Promise<string | null> {
    const known = await rpc("billing_customer", { p_user: who.id });
    if (typeof known === "string") return known;
    if (known === undefined) return null;
    const made = await stripe("POST", "customers", { email: who.email, "metadata[user_id]": who.id });
    if (typeof made?.id !== "string") return null;
    const kept = await rpc("link_stripe_customer", { p_user: who.id, p_customer: made.id });
    // Two checkouts at once each made a customer and the other's was linked: this one is deleted at Stripe, so no
    // customer carrying the person's email is left there with no account pointing at it (deleting the account
    // deletes only the linked one).
    if (typeof kept === "string" && kept !== made.id) await stripe("DELETE", `customers/${encodeURIComponent(made.id)}`);
    return typeof kept === "string" ? kept : null;
  }

  async function checkout(req: Request): Promise<Response> {
    const who = await person(req);
    if (!who) return reply(req, 401, { error: "signed-out" });
    const body = await req.json().catch(() => ({}));
    const yearly = body?.plan === "yearly";
    if (body?.plan !== "monthly" && !yearly) return reply(req, 400, { error: "plan" });
    const price = yearly ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
    if (!price || (yearly && !env.STRIPE_COUPON_FIRST_YEAR)) return reply(req, 503, { error: "not-set-up" });
    const customer = await customerFor(who);
    if (!customer) return reply(req, 502, { error: "unavailable" });
    // Never a second subscription: someone already paying manages it in the portal instead.
    const current = await stripe("GET", `subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100`);
    if (!Array.isArray(current?.data)) return reply(req, 502, { error: "unavailable" });
    const statuses: unknown[] = current.data.map((s: { status?: unknown }) => s?.status);
    if (statuses.some((s) => typeof s === "string" && PRO_STATUSES.includes(s))) return reply(req, 409, { error: "already-pro" });
    // The first-year coupon only while this customer never had a subscription that got past its first payment (one
    // ended, cancelled or paid monthly counts; a first try whose card was never confirmed doesn't). More than a page
    // of subscriptions counts as having had one.
    const firstYear = current.has_more !== true && statuses.every((s) => typeof s === "string" && NEVER_PAID_STATUSES.includes(s));
    const back = returnAddress(body?.returnTo, origins);
    const form: Record<string, string> = {
      mode: "subscription",
      customer,
      client_reference_id: who.id,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][user_id]": who.id,
      success_url: `${back}?checkout=done`,
      cancel_url: `${back}?checkout=cancelled`,
    };
    // Yearly: US$36 off the first year only (US$54, then US$90 a year).
    if (yearly && firstYear) form["discounts[0][coupon]"] = env.STRIPE_COUPON_FIRST_YEAR!;
    const session = await stripe("POST", "checkout/sessions", form);
    return typeof session?.url === "string" && session.url.startsWith("https://checkout.stripe.com/")
      ? reply(req, 200, { url: session.url })
      : reply(req, 502, { error: "unavailable" });
  }

  async function portal(req: Request): Promise<Response> {
    const who = await person(req);
    if (!who) return reply(req, 401, { error: "signed-out" });
    const customer = await rpc("billing_customer", { p_user: who.id });
    if (customer === undefined) return reply(req, 502, { error: "unavailable" });
    if (typeof customer !== "string") return reply(req, 404, { error: "no-payments" });
    const body = await req.json().catch(() => ({}));
    const session = await stripe("POST", "billing_portal/sessions", { customer, return_url: returnAddress(body?.returnTo, origins) });
    return typeof session?.url === "string" && session.url.startsWith("https://billing.stripe.com/")
      ? reply(req, 200, { url: session.url })
      : reply(req, 502, { error: "unavailable" });
  }

  async function deleteAccount(req: Request): Promise<Response> {
    const who = await person(req);
    if (!who) return reply(req, 401, { error: "signed-out" });
    const customer = await rpc("billing_customer", { p_user: who.id });
    if (customer === undefined) return reply(req, 502, { error: "unavailable" });
    if (typeof customer === "string") {
      // Deleting the customer at Stripe cancels every subscription at once, so nothing is charged after the account goes.
      // A customer Stripe already deleted answers 404, which is just as good.
      const gone = await deps.fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customer)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "stripe-version": STRIPE_VERSION },
      }).then((r) => r.ok || r.status === 404, () => false);
      if (!gone) return reply(req, 502, { error: "unavailable" });
      if ((await rpc("forget_billing", { p_user: who.id })) === undefined) return reply(req, 502, { error: "unavailable" });
    }
    // The database's own deletion, as the person (the same rule as deleting without payments).
    const done = await rpc("delete_my_account", {}, who.token, env.SUPABASE_ANON_KEY);
    return done === undefined ? reply(req, 502, { error: "unavailable" }) : reply(req, 200, { deleted: true });
  }

  /**
   * Reads the subscription back from Stripe (never trusting the event's copy, which may be stale or out of order),
   * then sets the plan from all of its customer's subscriptions, not this one alone: a customer with one that keeps
   * Pro stays Pro (the one ending last), whatever a dead one's late event says (an abandoned first try expiring a
   * day after a second checkout was paid).
   */
  async function sync(subscriptionId: string): Promise<boolean> {
    const sub = await stripe("GET", `subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!sub || typeof sub.id !== "string" || typeof sub.customer !== "string" || typeof sub.status !== "string") return false;
    if (sub.livemode === true && !liveAllowed) return true; // never acted on while in test mode
    const all = await stripe("GET", `subscriptions?customer=${encodeURIComponent(sub.customer)}&status=all&limit=100`);
    if (!Array.isArray(all?.data)) return false;
    type Sub = { id: string; status: string; current_period_end?: unknown; cancel_at_period_end?: unknown; livemode?: unknown };
    const pro = (all.data as Sub[])
      .filter((s) => typeof s?.id === "string" && typeof s.status === "string" && PRO_STATUSES.includes(s.status) && (s.livemode !== true || liveAllowed))
      .sort((a, b) => (typeof b.current_period_end === "number" ? b.current_period_end : 0) - (typeof a.current_period_end === "number" ? a.current_period_end : 0));
    const best: Sub = pro[0] ?? (sub as Sub);
    const end = typeof best.current_period_end === "number" ? new Date(best.current_period_end * 1000).toISOString() : null;
    const known = await rpc("set_plan_from_stripe", { p_customer: sub.customer, p_subscription: best.id, p_status: best.status, p_renews_at: end, p_cancels: best.cancel_at_period_end === true });
    if (known === undefined) return false;
    // A subscription whose person no longer has an account: end it so it is never charged again.
    if (known === false && PRO_STATUSES.includes(sub.status)) return (await stripe("DELETE", `subscriptions/${encodeURIComponent(sub.id)}`)) !== null;
    return true;
  }

  async function webhook(req: Request): Promise<Response> {
    const raw = await req.text();
    if (!(await signatureOk(req.headers.get("stripe-signature"), raw, env.STRIPE_WEBHOOK_SECRET ?? "", Math.floor(deps.now() / 1000)))) return reply(req, 400, { error: "signature" });
    let event: { type?: unknown; livemode?: unknown; data?: { object?: Record<string, unknown> } };
    try {
      event = JSON.parse(raw);
    } catch {
      return reply(req, 400, { error: "body" });
    }
    if (event.livemode === true && !liveAllowed) return reply(req, 200, { ignored: "live" });
    const obj = event.data?.object ?? {};
    let subId: unknown;
    if (event.type === "checkout.session.completed") subId = obj.subscription;
    else if (typeof event.type === "string" && event.type.startsWith("customer.subscription.")) subId = obj.id;
    else return reply(req, 200, { ignored: event.type });
    if (typeof subId !== "string" || !subId.startsWith("sub_")) return reply(req, 200, { ignored: "no subscription" });
    // A failure answers 500 so Stripe tries again later.
    return (await sync(subId)) ? reply(req, 200, { ok: true }) : reply(req, 500, { error: "retry" });
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== "POST") return reply(req, 405, { error: "method" });
    const key = env.STRIPE_SECRET_KEY ?? "";
    if (!key) return reply(req, 503, { error: "not-set-up" });
    if (!/^(sk|rk)_test_/.test(key) && !liveAllowed) return reply(req, 503, { error: "test-mode-only" });
    const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
    try {
      if (route === "checkout") return await checkout(req);
      if (route === "portal") return await portal(req);
      if (route === "delete-account") return await deleteAccount(req);
      if (route === "webhook") return await webhook(req);
    } catch {
      return reply(req, 500, { error: "retry" });
    }
    return reply(req, 404, { error: "route" });
  };
}

// In Supabase (Deno) only: serve. Node's tests import billing() without starting anything.
const deno = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): void; env: { toObject(): Env } } }).Deno;
if (deno) deno.serve(billing({ env: deno.env.toObject(), fetch: (i, o) => fetch(i, o), now: () => Date.now() }));
