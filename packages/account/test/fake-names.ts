// An in-memory display-name service answering as supabase/migrations/20261111130000_display_names.sql does (same answers,
// limits and one-a-week gap; the SQL itself is checked on a real PostgreSQL by supabase/test/test_display_names.py). Only the
// look-alike folding is a short form: accents, case, punctuation and the digit/letter swaps of display_name_key.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { NAME_LIMITS } from "../src/names.ts";

export interface FakeNames {
  rows: { user: string; name: string; key: string; changedAt: number }[];
  held: Set<string>;
  mode: "up" | "down" | "missing";
  calls: string[];
  /** The fake's clock, milliseconds; tests move it. */
  now: number;
  as(user: string | null): Pick<AuthClient, "asPerson" | "state">;
}

const BLOCKED = [
  { word: "spindlelabs", anywhere: true },
  { word: "spindle", anywhere: false },
  { word: "admin", anywhere: false },
  { word: "moderator", anywhere: false },
  { word: "official", anywhere: false },
  { word: "support", anywhere: false },
];

/** display_name_key, short form: accents off, lower case, letters and digits only, then 0 1 3 4 5 i -> o l e a s l. */
export function fakeKey(name: string): string {
  const folded = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return [...folded].map((c) => ({ "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", i: "l" })[c as "0"] ?? c).join("");
}

export function fakeNames(): FakeNames {
  const s: FakeNames = {
    rows: [],
    held: new Set(),
    mode: "up",
    calls: [],
    now: Date.UTC(2026, 10, 11, 1),
    as(user) {
      return {
        state: () => (user ? { kind: "signed-in", user: { id: user, email: `${user}@example.com`, name: "" } } : { kind: "signed-out" }),
        asPerson: async (_method, path, body): Promise<PersonReply> => {
          s.calls.push(path);
          if (!user) return { kind: "signed-out" };
          if (s.mode === "down") return { kind: "failed", reason: "offline" };
          if (s.mode === "missing") return { kind: "failed", reason: "rejected" };
          const mine = s.rows.find((r) => r.user === user);
          if (path === "rpc/my_display_name") {
            return { kind: "ok", body: mine ? { name: mine.name, changed_at: new Date(mine.changedAt).toISOString(), next_change_at: new Date(mine.changedAt + NAME_LIMITS.changeGapSeconds * 1000).toISOString() } : null };
          }
          if (path !== "rpc/set_display_name") return { kind: "failed", reason: "rejected" };
          const name = (body as { p_name?: unknown } | undefined)?.p_name;
          const bad = typeof name !== "string" || name.length < NAME_LIMITS.minLength || name.length > NAME_LIMITS.maxLength || !/^[\p{L}\p{N}]([\p{L}\p{N} _.-]*[\p{L}\p{N}])?$/u.test(name) || name.includes("  ");
          if (bad) return { kind: "ok", body: "bad" };
          const key = fakeKey(name);
          if (key.length < NAME_LIMITS.minLength) return { kind: "ok", body: "bad" };
          if (BLOCKED.some((w) => key === fakeKey(w.word) || key.startsWith(fakeKey(w.word)) || key.endsWith(fakeKey(w.word)) || (w.anywhere && key.includes(fakeKey(w.word))))) return { kind: "ok", body: "blocked" };
          if (mine?.name === name) return { kind: "ok", body: "saved" };
          if (mine && mine.changedAt > s.now - NAME_LIMITS.changeGapSeconds * 1000) return { kind: "ok", body: "too-soon" };
          if (s.rows.some((r) => r.key === key && r.user !== user)) return { kind: "ok", body: "taken" };
          if (s.held.has(user)) return { kind: "ok", body: "held" };
          if (mine) Object.assign(mine, { name, key, changedAt: s.now });
          else s.rows.push({ user, name, key, changedAt: s.now });
          return { kind: "ok", body: "saved" };
        },
      };
    },
  };
  return s;
}
