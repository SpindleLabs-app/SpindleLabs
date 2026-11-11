// An in-memory sharing service answering as supabase/migrations/20261111120000_shares.sql does (same statuses and
// limits; the SQL itself is checked on a real PostgreSQL by supabase/test/test_shares.py). Sizes are string lengths.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { REPORT_KINDS, SHARE_LIMITS } from "../src/shares.ts";

export interface ShareRowFake {
  id: string;
  user: string;
  name: string;
  body: string;
  picture: string | null;
  createdAt: string;
  offAt: string | null;
  removedAt: string | null;
}

export interface FakeShares {
  rows: ShareRowFake[];
  reports: { shareId: string; reporter: string | null; kind: string; reason: string }[];
  mode: "up" | "down";
  calls: string[];
  /** A client for `user` (null: not signed in), with the same two calls the real client has. */
  as(user: string | null): Pick<AuthClient, "asPerson" | "asAnyone" | "state">;
}

export function fakeShares(seed = 1): FakeShares {
  let n = seed * 1000;
  let clock = Date.UTC(2026, 10, 11, 1);
  const uuid = () => `10000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`;
  const size = (r: ShareRowFake) => r.body.length + (r.picture?.length ?? 0);
  const s: FakeShares = {
    rows: [],
    reports: [],
    mode: "up",
    calls: [],
    as(user) {
      const run = (path: string, body: unknown, needsPerson: boolean): PersonReply => {
        s.calls.push(path);
        if (needsPerson && !user) return { kind: "signed-out" };
        if (s.mode === "down") return { kind: "failed", reason: "offline" };
        const ok = (b: unknown): PersonReply => ({ kind: "ok", body: b === undefined ? undefined : JSON.parse(JSON.stringify(b)) });
        const a = (body ?? {}) as Record<string, unknown>;
        const live = (r: ShareRowFake) => r.offAt === null && r.removedAt === null;
        const mine = s.rows.filter((r) => r.user === user);
        switch (path) {
          case "rpc/share_design": {
            const text = typeof a.p_body === "string" ? a.p_body : "";
            const picture = (a.p_picture as string | null) ?? null;
            if (text === "" || text.length > SHARE_LIMITS.maxShareBytes || (picture?.length ?? 0) > SHARE_LIMITS.maxPictureBytes) return ok({ status: "too-big" });
            if (mine.filter((r) => Date.parse(r.createdAt) > clock - 86_400_000).length >= SHARE_LIMITS.linksPerDay) return ok({ status: "daily" });
            const on = mine.filter(live);
            if (on.length >= SHARE_LIMITS.maxLinks || on.reduce((t, r) => t + size(r), 0) + text.length + (picture?.length ?? 0) > SHARE_LIMITS.maxBytes) return ok({ status: "full" });
            const row: ShareRowFake = { id: uuid(), user: user as string, name: String(a.p_name ?? ""), body: text, picture, createdAt: new Date((clock += 1000)).toISOString(), offAt: null, removedAt: null };
            s.rows.push(row);
            return ok({ status: "shared", id: row.id, created_at: row.createdAt });
          }
          case "rpc/open_share": {
            const r = s.rows.find((x) => x.id === a.p_id && live(x));
            return ok(r ? { id: r.id, name: r.name, body: r.body, picture: r.picture, created_at: r.createdAt } : null);
          }
          case "rpc/my_shares":
            return ok([...mine].filter((r) => r.offAt === null).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)).map((r) => ({ id: r.id, name: r.name, picture: r.picture, bytes: size(r), created_at: r.createdAt, removed_at: r.removedAt })));
          case "rpc/unshare": {
            const r = mine.find((x) => x.id === a.p_id && x.offAt === null);
            if (!r) return ok(false);
            Object.assign(r, { offAt: new Date((clock += 1000)).toISOString(), body: "", picture: null });
            return ok(true);
          }
          case "rpc/report_share": {
            const kind = String(a.p_kind);
            const reason = typeof a.p_reason === "string" ? a.p_reason : "";
            if (!(REPORT_KINDS as readonly string[]).includes(kind) || reason.length > SHARE_LIMITS.maxReason) return ok("bad");
            if (!s.rows.some((x) => x.id === a.p_id && live(x))) return ok("gone");
            const here = s.reports.filter((x) => x.shareId === a.p_id);
            if (here.length >= SHARE_LIMITS.reportsPerLink || (user !== null && here.filter((x) => x.reporter === user).length >= SHARE_LIMITS.reportsPerPerson)) return ok("enough");
            s.reports.push({ shareId: String(a.p_id), reporter: user, kind, reason });
            return ok("kept");
          }
        }
        return { kind: "failed", reason: "rejected" };
      };
      return {
        state: () => (user ? { kind: "signed-in", user: { id: user, email: `${user}@example.com`, name: user } } : { kind: "signed-out" }),
        async asPerson(_m, path, body) {
          return run(path, body, true);
        },
        async asAnyone(_m, path, body) {
          return run(path, body, false);
        },
      };
    },
  };
  return s;
}
