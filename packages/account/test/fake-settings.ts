// An in-memory account for settings that follow you, answering the settings API's requests the way
// supabase/migrations/20261106000000_settings.sql does (the same statuses, revisions, names and limits; the SQL itself
// is checked on a real PostgreSQL by supabase/test/test_settings.py). Byte sizes here are string lengths, which equal
// PostgreSQL's octet_length for the plain ASCII text the tests use.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { SETTING_NAME, SETTINGS_LIMITS } from "../src/settings.ts";

export interface FakeSettingsAccount {
  rows: Map<string, { settings: Record<string, string>; revision: number }>;
  keep: Map<string, boolean>;
  mode: "up" | "down" | "missing";
  /** Replaces the next answer's body. */
  nextBody?: unknown;
  /** Runs before the next save is answered (another device saving in between, say). */
  beforeSave?: () => void;
  calls: string[];
  as(user: string | null): Pick<AuthClient, "asPerson" | "state">;
  /** What another device would save directly, for crossing saves. */
  put(user: string, settings: Record<string, string>): void;
}

export function fakeSettingsAccount(): FakeSettingsAccount {
  const acc: FakeSettingsAccount = {
    rows: new Map(),
    keep: new Map(),
    mode: "up",
    calls: [],
    put(user, settings) {
      const row = acc.rows.get(user);
      acc.rows.set(user, { settings: { ...settings }, revision: (row?.revision ?? 0) + 1 });
    },
    as(user) {
      return {
        state: () => (user ? { kind: "signed-in", user: { id: user, email: `${user}@example.com`, name: user } } : { kind: "signed-out" }),
        async asPerson(method, path, body): Promise<PersonReply> {
          acc.calls.push(`${method} ${path}`);
          if (!user) return { kind: "signed-out" };
          if (acc.mode === "down") return { kind: "failed", reason: "offline" };
          if (acc.mode === "missing") return { kind: "failed", reason: "rejected" }; // the migration not run yet: 404
          const answer = (v: unknown): PersonReply => {
            if ("nextBody" in acc) {
              const b = acc.nextBody;
              delete acc.nextBody;
              return { kind: "ok", body: b };
            }
            return { kind: "ok", body: JSON.parse(JSON.stringify(v)) };
          };
          const keep = acc.keep.get(user) ?? true;
          const b = (body ?? {}) as Record<string, unknown>;
          if (path === "rpc/my_settings") {
            const row = acc.rows.get(user);
            return answer({ keep, revision: row?.revision ?? 0, settings: row?.settings ?? {} });
          }
          if (path === "rpc/save_settings") {
            const hook = acc.beforeSave;
            acc.beforeSave = undefined;
            hook?.();
            if (!(acc.keep.get(user) ?? true)) return answer({ status: "off" });
            const s = b.p_settings;
            const expected = b.p_expected;
            if (typeof s !== "object" || s === null || Array.isArray(s) || typeof expected !== "number" || expected < 0) return answer({ status: "invalid" });
            const entries = Object.entries(s);
            if (entries.some(([k, v]) => typeof v !== "string" || !SETTING_NAME.test(k) || k.length > SETTINGS_LIMITS.maxName)) return answer({ status: "invalid" });
            const bytes = entries.reduce((n, [k, v]) => n + k.length + (v as string).length, 0);
            if (entries.length > SETTINGS_LIMITS.maxSettings || bytes > SETTINGS_LIMITS.maxBytes) return answer({ status: "too-big" });
            const row = acc.rows.get(user);
            if ((row?.revision ?? 0) !== expected) return answer({ status: "changed", revision: row?.revision ?? 0 });
            acc.rows.set(user, { settings: { ...(s as Record<string, string>) }, revision: expected + 1 });
            return answer({ status: "saved", revision: expected + 1 });
          }
          if (path === "rpc/set_keep_settings") {
            const on = b.p_on === true;
            acc.keep.set(user, on);
            if (!on) acc.rows.delete(user);
            return answer(on);
          }
          return { kind: "failed", reason: "rejected" };
        },
      };
    },
  };
  return acc;
}
