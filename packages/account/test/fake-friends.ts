// An in-memory Friends service answering as supabase/migrations/20261113180000_friends.sql (with the security fixes
// of 20261113200000_account_security.sql) does (the same answers,
// limits, order of checks and lists; the SQL itself is checked on a real PostgreSQL by supabase/test/test_friends.py).
// `answer(user, path, body)` is the database's side, used by the unit tests through `as(user)` and by the browser
// check apps/fission/e2e/friends.mjs through Playwright's routes. IDs come from a seeded counter, not crypto, so
// failures replay.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { CODE_ALPHABET, FRIENDS_LIMITS, friendCodeKey } from "../src/friends.ts";

interface Request {
  id: string;
  from: string;
  to: string;
  code: string;
  sentAt: number;
  declined: boolean;
  /** The asker took it back (or turned Friends off) after it was said no to: hidden from them, still kept. */
  cancelled: boolean;
}

export interface FakeFriends {
  /** Display names by user; a person with none can't turn Friends on. */
  names: Map<string, string>;
  held: Set<string>;
  codes: Map<string, string>;
  requests: Request[];
  friendships: { id: string; a: string; b: string; since: number }[];
  blocks: { id: string; blocker: string; blocked: string; madeAt: number }[];
  tries: { user: string; at: number }[];
  mode: "up" | "down" | "missing";
  calls: string[];
  /** The fake's clock, milliseconds; tests move it. */
  now: number;
  answer(user: string, path: string, body: unknown): unknown;
  as(user: string | null): Pick<AuthClient, "asPerson" | "state">;
}

const DAY = 86_400_000;

export function fakeFriends(seed = 1): FakeFriends {
  let n = 0;
  let rand = seed >>> 0 || 1;
  const nextId = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
  const nextCode = () => {
    let c = "";
    for (let i = 0; i < FRIENDS_LIMITS.codeLength; i++) {
      rand = (Math.imul(rand, 1103515245) + 12345) >>> 0;
      c += CODE_ALPHABET[(rand >>> 16) % 32];
    }
    return c;
  };
  const iso = (t: number) => new Date(t).toISOString();
  const s: FakeFriends = {
    names: new Map(),
    held: new Set(),
    codes: new Map(),
    requests: [],
    friendships: [],
    blocks: [],
    tries: [],
    mode: "up",
    calls: [],
    now: Date.UTC(2026, 10, 13, 9),
    answer(me, path, body) {
      const b = (body ?? {}) as Record<string, unknown>;
      const tidy = () => {
        s.requests = s.requests.filter((r) => r.sentAt >= s.now - FRIENDS_LIMITS.requestDays * DAY);
        s.tries = s.tries.filter((t) => t.at >= s.now - DAY);
      };
      const give = (user: string) => {
        let c = nextCode();
        while ([...s.codes.values()].includes(c)) c = nextCode();
        s.codes.set(user, c);
        return c;
      };
      const count = (u: string) => s.friendships.filter((f) => f.a === u || f.b === u).length;
      const pair = (x: string, y: string) => s.friendships.find((f) => (f.a === x && f.b === y) || (f.a === y && f.b === x));
      const blocked = (by: string, who: string) => s.blocks.some((k) => k.blocker === by && k.blocked === who);
      const join = (x: string, y: string) => {
        s.requests = s.requests.filter((r) => !((r.from === x && r.to === y) || (r.from === y && r.to === x)));
        if (!pair(x, y)) s.friendships.push({ id: nextId(), a: x, b: y, since: s.now });
      };
      const other = (f: { a: string; b: string }) => (f.a === me ? f.b : f.a);
      const name = (u: string) => s.names.get(u) ?? null;
      switch (path) {
        case "rpc/my_friends": {
          tidy();
          const mine = s.codes.get(me) ?? null;
          const newest = <T>(list: T[], at: (x: T) => number) => [...list].sort((x, y) => at(y) - at(x));
          return {
            on: mine !== null,
            code: mine,
            friends: newest(s.friendships.filter((f) => f.a === me || f.b === me), (f) => f.since).map((f) => ({ id: f.id, name: name(other(f)), since: iso(f.since) })),
            asking_me: mine === null ? [] : newest(s.requests.filter((r) => r.to === me && !r.declined && !blocked(me, r.from)), (r) => r.sentAt).map((r) => ({ id: r.id, name: name(r.from), sent_at: iso(r.sentAt) })),
            i_asked: newest(s.requests.filter((r) => r.from === me && !r.cancelled), (r) => r.sentAt).map((r) => ({ id: r.id, code: r.code, sent_at: iso(r.sentAt) })),
            blocked: newest(s.blocks.filter((k) => k.blocker === me), (k) => k.madeAt).map((k) => ({ id: k.id, name: name(k.blocked), since: iso(k.madeAt) })),
            tries_left: Math.max(0, FRIENDS_LIMITS.triesADay - s.tries.filter((t) => t.user === me).length),
          };
        }
        case "rpc/set_friends": {
          if (b.p_on !== true) {
            s.codes.delete(me);
            s.friendships = s.friendships.filter((f) => f.a !== me && f.b !== me);
            s.requests = s.requests.filter((r) => r.to !== me && (r.from !== me || r.declined));
            for (const r of s.requests) if (r.from === me) r.cancelled = true;
            return "off";
          }
          if (s.codes.has(me)) return "on";
          if (s.held.has(me)) return "held";
          if (!s.names.has(me)) return "no-name";
          give(me);
          return "on";
        }
        case "rpc/new_friend_code":
          return s.codes.has(me) ? give(me) : null;
        case "rpc/send_friend_request": {
          const mine = s.codes.get(me);
          if (!mine) return "off";
          if (s.held.has(me)) return "held";
          const key = typeof b.p_code === "string" ? friendCodeKey(b.p_code) : null;
          if (key === null) return "bad";
          tidy();
          if (s.tries.filter((t) => t.user === me).length >= FRIENDS_LIMITS.triesADay) return "too-many";
          s.tries.push({ user: me, at: s.now });
          if (key === mine) return "self";
          const them = [...s.codes].find(([, c]) => c === key)?.[0];
          if (!them) return "not-found";
          if (blocked(me, them)) return "blocked";
          if (pair(me, them)) return "already";
          if (s.requests.some((r) => r.from === me && r.to === them && !r.cancelled)) return "waiting";
          if (s.requests.some((r) => r.from === them && r.to === me && !r.cancelled) && !blocked(them, me)) {
            if (count(me) >= FRIENDS_LIMITS.maxFriends || count(them) >= FRIENDS_LIMITS.maxFriends) return "full";
            join(me, them);
            return "friends";
          }
          if (count(me) >= FRIENDS_LIMITS.maxFriends || s.requests.filter((r) => r.from === me && !r.cancelled).length >= FRIENDS_LIMITS.maxWaiting) return "full";
          // A request taken back after a no, asked again: still declined, waiting from now on the asker's side.
          const back = s.requests.find((r) => r.from === me && r.to === them);
          if (back) Object.assign(back, { cancelled: false, sentAt: s.now, code: key });
          else s.requests.push({ id: nextId(), from: me, to: them, code: key, sentAt: s.now, declined: false, cancelled: false });
          return "sent";
        }
        case "rpc/accept_friend_request": {
          if (!s.codes.has(me)) return "gone";
          tidy();
          const r = s.requests.find((x) => x.id === b.p_id && x.to === me && !x.declined && !blocked(me, x.from));
          if (!r) return "gone";
          if (count(me) >= FRIENDS_LIMITS.maxFriends || count(r.from) >= FRIENDS_LIMITS.maxFriends) return "full";
          join(me, r.from);
          return "friends";
        }
        case "rpc/decline_friend_request": {
          const r = s.requests.find((x) => x.id === b.p_id && x.to === me && !x.declined);
          if (r) r.declined = true;
          return !!r;
        }
        case "rpc/cancel_friend_request": {
          const r = s.requests.find((x) => x.id === b.p_id && x.from === me && !x.cancelled);
          if (!r) return false;
          if (r.declined) r.cancelled = true;
          else s.requests = s.requests.filter((x) => x !== r);
          return true;
        }
        case "rpc/remove_friend": {
          const f = s.friendships.find((x) => x.id === b.p_id && (x.a === me || x.b === me));
          if (f) s.friendships = s.friendships.filter((x) => x !== f);
          return !!f;
        }
        case "rpc/block_friend": {
          const f = s.friendships.find((x) => x.id === b.p_id && (x.a === me || x.b === me));
          const them = f ? other(f) : s.requests.find((x) => x.id === b.p_id && x.to === me)?.from;
          if (!them) return false;
          if (!blocked(me, them)) s.blocks.push({ id: nextId(), blocker: me, blocked: them, madeAt: s.now });
          s.friendships = s.friendships.filter((x) => x !== pair(me, them));
          s.requests = s.requests.filter((x) => !(x.from === me && x.to === them));
          for (const x of s.requests) if (x.from === them && x.to === me) x.declined = true;
          return true;
        }
        case "rpc/unblock_friend": {
          const k = s.blocks.find((x) => x.id === b.p_id && x.blocker === me);
          if (!k) return false;
          s.blocks = s.blocks.filter((x) => x !== k);
          for (const x of s.requests) if (x.from === k.blocked && x.to === me) x.declined = true;
          return true;
        }
      }
      return undefined;
    },
    as(user) {
      return {
        state: () => (user ? { kind: "signed-in", user: { id: user, email: `${user}@example.com`, name: "" } } : { kind: "signed-out" }),
        asPerson: async (_method, path, body): Promise<PersonReply> => {
          s.calls.push(path);
          if (!user) return { kind: "signed-out" };
          if (s.mode === "down") return { kind: "failed", reason: "offline" };
          if (s.mode === "missing") return { kind: "failed", reason: "rejected" };
          const got = s.answer(user, path, body);
          return got === undefined ? { kind: "failed", reason: "rejected" } : { kind: "ok", body: got };
        },
      };
    },
  };
  return s;
}
