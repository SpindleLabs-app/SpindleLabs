// What a signed-in person can see and change about their account: the email
// choice, a copy of everything kept, and deleting the account. The database's
// rules (supabase/migrations) decide what each request may touch; this only
// asks and checks the answers.

import type { AuthClient, PersonReply, SmallStore } from "./auth.ts";

type Failed = Exclude<PersonReply, { kind: "ok" }>;
export type DataResult<T> = { readonly kind: "ok"; readonly value: T } | Failed;

/** Where a choice made before signing in waits for the return from the sign-in page. */
export const PENDING_EMAIL_KEY = "spindle.account.email-choice";

/**
 * The email choice this browser last read or saved, so the account dialog can show it at once instead of an unticked
 * box while the service answers: `<user id>:yes` or `<user id>:no`. Only a copy: the service's answer always wins.
 */
export const SEEN_EMAIL_KEY = "spindle.account.email-seen";

/** `store` keeps the last email choice seen (SEEN_EMAIL_KEY); without one nothing is remembered. */
export function accountData(client: AuthClient, store?: SmallStore) {
  function remember(userId: string, yes: boolean): void {
    try {
      store?.setItem(SEEN_EMAIL_KEY, `${userId}:${yes ? "yes" : "no"}`);
    } catch {
      // Storage blocked: the dialog just waits for the service, as before.
    }
  }
  function forgetSeen(): void {
    try {
      store?.removeItem(SEEN_EMAIL_KEY);
    } catch {
      // Storage blocked: nothing was kept.
    }
  }
  return {
    /**
     * The email choice last seen in this browser for the person signed in now, without asking the service: true, false,
     * or null when none was seen (another person's, a damaged value, signed out, storage blocked).
     */
    lastEmailChoice(): boolean | null {
      const state = client.state();
      if (state.kind !== "signed-in") return null;
      let kept: string | null = null;
      try {
        kept = store?.getItem(SEEN_EMAIL_KEY) ?? null;
      } catch {
        return null;
      }
      if (kept === `${state.user.id}:yes`) return true;
      if (kept === `${state.user.id}:no`) return false;
      return null;
    },

    /** Forgets the last email choice seen (signing out, deleting the account). */
    forgetEmailChoice: forgetSeen,

    /** Whether the person said yes to emails. Off unless they ticked the box. Remembered as the last choice seen. */
    async emailChoice(): Promise<DataResult<boolean>> {
      const state = client.state();
      const r = await client.asPerson("GET", "profiles?select=email_opt_in");
      if (r.kind !== "ok") return r;
      const rows = r.body;
      if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.email_opt_in !== "boolean") return { kind: "failed", reason: "malformed" };
      if (state.kind === "signed-in") remember(state.user.id, rows[0].email_opt_in);
      return { kind: "ok", value: rows[0].email_opt_in };
    },

    /** Records a yes or no to emails; the database stamps when. Remembered as the last choice seen once saved. */
    async setEmailChoice(yes: boolean): Promise<DataResult<boolean>> {
      const state = client.state();
      if (state.kind !== "signed-in") return { kind: "signed-out" };
      const r = await client.asPerson("PATCH", `profiles?id=eq.${encodeURIComponent(state.user.id)}`, { email_opt_in: yes === true });
      if (r.kind !== "ok") return r;
      remember(state.user.id, yes === true);
      return { kind: "ok", value: yes };
    },

    /** Everything the service keeps about the person, as JSON text to save. */
    async myData(): Promise<DataResult<string>> {
      const r = await client.asPerson("POST", "rpc/my_data");
      if (r.kind !== "ok") return r;
      if (typeof r.body !== "object" || r.body === null) return { kind: "failed", reason: "malformed" };
      return { kind: "ok", value: JSON.stringify(r.body, null, 2) };
    },

    /**
     * Deletes the account and every row kept about it, then forgets it on this device. Designs on the device are untouched.
     * The billing function goes first: it ends any Stripe subscription before deleting, so nothing is charged afterwards.
     * If it can't be reached, the database's own deletion is tried, which refuses while payments are linked.
     */
    async deleteAccount(): Promise<DataResult<true>> {
      const viaBilling = await client.asPersonFunction("billing/delete-account");
      if (viaBilling.kind === "signed-out") return viaBilling;
      if (viaBilling.kind !== "ok") {
        const r = await client.asPerson("POST", "rpc/delete_my_account");
        if (r.kind !== "ok") return r;
      }
      client.forget();
      forgetSeen();
      return { kind: "ok", value: true };
    },

    /** The person's plan as the server last set it (the browser can only read it). */
    async plan(): Promise<DataResult<Plan>> {
      const r = await client.asPerson("GET", "plans?select=plan,renews_at,cancels_at_period_end");
      if (r.kind !== "ok") return r;
      const row = Array.isArray(r.body) && r.body.length === 1 ? r.body[0] : undefined;
      if (!row || !PLANS.includes(row.plan) || !(row.renews_at === null || typeof row.renews_at === "string") || typeof row.cancels_at_period_end !== "boolean") return { kind: "failed", reason: "malformed" };
      return { kind: "ok", value: { plan: row.plan, renewsAt: row.renews_at, cancels: row.cancels_at_period_end } };
    },

    /** The address of Stripe's checkout page for Pro, monthly or yearly, returning to `returnTo` afterwards. */
    checkout(which: "monthly" | "yearly", returnTo: string): Promise<DataResult<string>> {
      return stripePage("billing/checkout", { plan: which, returnTo }, "https://checkout.stripe.com/");
    },

    /** The address of Stripe's page to change or cancel Pro. */
    manage(returnTo: string): Promise<DataResult<string>> {
      return stripePage("billing/portal", { returnTo }, "https://billing.stripe.com/");
    },
  };

  async function stripePage(path: string, body: unknown, mustStart: string): Promise<DataResult<string>> {
    const r = await client.asPersonFunction(path, body);
    if (r.kind !== "ok") return r;
    const url = (r.body as { url?: unknown } | undefined)?.url;
    // Only ever Stripe's own pages: a wrong answer never sends the person somewhere else.
    return typeof url === "string" && url.startsWith(mustStart) ? { kind: "ok", value: url } : { kind: "failed", reason: "malformed" };
  }
}

const PLANS = ["free", "pro", "team"] as const;
export type Plan = { readonly plan: (typeof PLANS)[number]; readonly renewsAt: string | null; readonly cancels: boolean };

export type AccountData = ReturnType<typeof accountData>;
