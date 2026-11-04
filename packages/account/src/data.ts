// What a signed-in person can see and change about their account: the email
// choice, a copy of everything kept, and deleting the account. The database's
// rules (supabase/migrations) decide what each request may touch; this only
// asks and checks the answers.

import type { AuthClient, PersonReply } from "./auth.ts";

type Failed = Exclude<PersonReply, { kind: "ok" }>;
export type DataResult<T> = { readonly kind: "ok"; readonly value: T } | Failed;

/** Where a choice made before signing in waits for the return from the sign-in page. */
export const PENDING_EMAIL_KEY = "spindle.account.email-choice";

export function accountData(client: AuthClient) {
  return {
    /** Whether the person said yes to emails. Off unless they ticked the box. */
    async emailChoice(): Promise<DataResult<boolean>> {
      const r = await client.asPerson("GET", "profiles?select=email_opt_in");
      if (r.kind !== "ok") return r;
      const rows = r.body;
      if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.email_opt_in !== "boolean") return { kind: "failed", reason: "malformed" };
      return { kind: "ok", value: rows[0].email_opt_in };
    },

    /** Records a yes or no to emails; the database stamps when. */
    async setEmailChoice(yes: boolean): Promise<DataResult<boolean>> {
      const state = client.state();
      if (state.kind !== "signed-in") return { kind: "signed-out" };
      const r = await client.asPerson("PATCH", `profiles?id=eq.${encodeURIComponent(state.user.id)}`, { email_opt_in: yes === true });
      return r.kind === "ok" ? { kind: "ok", value: yes } : r;
    },

    /** Everything the service keeps about the person, as JSON text to save. */
    async myData(): Promise<DataResult<string>> {
      const r = await client.asPerson("POST", "rpc/my_data");
      if (r.kind !== "ok") return r;
      if (typeof r.body !== "object" || r.body === null) return { kind: "failed", reason: "malformed" };
      return { kind: "ok", value: JSON.stringify(r.body, null, 2) };
    },

    /** Deletes the account and every row kept about it, then forgets it on this device. Designs on the device are untouched. */
    async deleteAccount(): Promise<DataResult<true>> {
      const r = await client.asPerson("POST", "rpc/delete_my_account");
      if (r.kind !== "ok") return r;
      client.forget();
      return { kind: "ok", value: true };
    },
  };
}

export type AccountData = ReturnType<typeof accountData>;
