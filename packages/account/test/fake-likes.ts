// An in-memory likes service answering as supabase/migrations/20261111170000_likes.sql does, on top of a fake sharing
// service (fake-shares.ts) for the links themselves. The SQL itself is checked on a real PostgreSQL by
// supabase/test/test_likes.py; this answers the same way so the app's side can be tested without one.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { LIKE_LIMITS } from "../src/likes.ts";
import type { FakeShares } from "./fake-shares.ts";

export interface FakeLikes {
  /** Who likes which link. */
  likes: { shareId: string; user: string }[];
  /** Each person's counted changes, oldest first, as clock times (ms). */
  changes: Map<string, number[]>;
  /** Accounts held by moderation. */
  held: Set<string>;
  /** The off switch for every sharing link (share_switch). */
  sharingOn: boolean;
  /** "missing": the service has no likes functions yet (the migration not applied: every likes call is a 404). */
  mode: "up" | "missing";
  clock: number;
  as(user: string | null): Pick<AuthClient, "asPerson" | "asAnyone" | "state">;
}

export function fakeLikes(shares: FakeShares): FakeLikes {
  const f: FakeLikes = {
    likes: [],
    changes: new Map(),
    held: new Set(),
    sharingOn: true,
    mode: "up",
    clock: Date.UTC(2026, 10, 12, 1),
    as(user) {
      const inner = shares.as(user);
      const live = (id: unknown) => shares.rows.find((r) => r.id === id && r.offAt === null && r.removedAt === null);
      // take_like_change: forget changes a day old or older, refuse at the cap, else count one.
      const take = (me: string): boolean => {
        const kept = (f.changes.get(me) ?? []).filter((t) => t > f.clock - 86_400_000);
        f.changes.set(me, kept);
        if (kept.length >= LIKE_LIMITS.changesPerDay) return false;
        kept.push(f.clock);
        return true;
      };
      const run = (path: string, body: unknown, needsPerson: boolean): PersonReply | null => {
        if (!path.startsWith("rpc/like_") && path !== "rpc/i_like" && path !== "rpc/unlike_share") return null;
        shares.calls.push(path);
        if (needsPerson && !user) return { kind: "signed-out" };
        if (shares.mode === "down") return { kind: "failed", reason: "offline" };
        if (f.mode === "missing") return { kind: "failed", reason: "rejected" };
        // Turning a link off deletes its likes (the migration's trigger); a takedown keeps them for if it is put back.
        f.likes = f.likes.filter((l) => shares.rows.find((r) => r.id === l.shareId)?.offAt === null);
        const id = ((body ?? {}) as Record<string, unknown>).p_id;
        const ok = (b: unknown): PersonReply => ({ kind: "ok", body: b });
        const mineNow = () => f.likes.some((l) => l.shareId === id && l.user === user);
        switch (path) {
          case "rpc/like_count": {
            if (!f.sharingOn || !live(id)) return ok(null);
            return ok(f.likes.filter((l) => l.shareId === id && !f.held.has(l.user)).length);
          }
          case "rpc/i_like":
            return ok(f.sharingOn && !!live(id) && mineNow());
          case "rpc/like_share": {
            const me = user as string;
            if (!f.sharingOn) return ok("off");
            const row = live(id);
            if (!row) return ok("gone");
            if (row.user === me) return ok("own");
            if (mineNow()) return ok("already");
            // The held check is the insert's trigger, after the change is taken; the block takes the change back.
            const before = [...(f.changes.get(me) ?? [])];
            if (!take(me)) return ok("daily");
            if (f.held.has(me)) {
              f.changes.set(me, before);
              return ok("held");
            }
            f.likes.push({ shareId: String(id), user: me });
            return ok("liked");
          }
          case "rpc/unlike_share": {
            const me = user as string;
            if (!mineNow()) return ok("not-liked");
            if (!take(me)) return ok("daily");
            f.likes = f.likes.filter((l) => !(l.shareId === id && l.user === me));
            return ok("unliked");
          }
        }
        return { kind: "failed", reason: "rejected" };
      };
      return {
        state: inner.state,
        async asPerson(m, path, body) {
          return run(path, body, true) ?? inner.asPerson(m, path, body);
        },
        async asAnyone(m, path, body) {
          return run(path, body, false) ?? inner.asAnyone(m, path, body);
        },
      };
    },
  };
  return f;
}
