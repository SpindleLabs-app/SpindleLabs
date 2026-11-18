// An in-memory account for My designs, answering the data API's requests the way
// supabase/migrations/20261105120000_my_designs.sql and 20261105180000_design_versions.sql do (versions: the copy a
// save replaces, when it differs and the newest is versionGapMinutes older, the newest versionsKept; the oldest-first
// room-making is the database's alone, checked by test_design_versions.py) (the same statuses, revisions and limits; the SQL itself is
// checked on a real PostgreSQL by supabase/test/test_designs.py). Byte sizes here are string lengths, which equal
// PostgreSQL's octet_length for the plain ASCII text the tests use.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { LIMITS } from "../src/designs.ts";

export interface Row {
  id: string;
  user: string;
  name: string;
  source: string;
  body: string;
  picture: string | null;
  savedAt: string;
  updatedAt: string;
  revision: number;
}

export interface FakeAccount {
  rows: Row[];
  /** Each design's kept versions, oldest first. */
  versions: Map<string, { savedAt: string; body: string }[]>;
  keep: Map<string, boolean>;
  /** "up" answers; "down" fails as with no network; a function replaces the next answer's body. */
  mode: "up" | "down";
  nextBody?: unknown;
  calls: string[];
  /** A client for person `user`, as AuthClient.asPerson would act for them. */
  as(user: string | null): Pick<AuthClient, "asPerson" | "state">;
}

export function fakeAccount(seed = 1): FakeAccount {
  let n = seed * 1000;
  let clock = Date.UTC(2026, 10, 5, 1);
  const uuid = () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`;
  const bytes = (r: Row) => r.body.length + (r.picture?.length ?? 0);
  const acc: FakeAccount = {
    rows: [],
    versions: new Map(),
    keep: new Map(),
    mode: "up",
    calls: [],
    as(user) {
      return {
        state: () => (user ? { kind: "signed-in", user: { id: user, email: `${user}@example.com`, name: user } } : { kind: "signed-out" }),
        async asPerson(method, path, body): Promise<PersonReply> {
          acc.calls.push(`${method} ${path}`);
          if (!user) return { kind: "signed-out" };
          if (acc.mode === "down") return { kind: "failed", reason: "offline" };
          const answer = (v: unknown): PersonReply => {
            if ("nextBody" in acc) {
              const b = acc.nextBody;
              delete acc.nextBody;
              return { kind: "ok", body: b };
            }
            return { kind: "ok", body: v === undefined ? undefined : JSON.parse(JSON.stringify(v)) };
          };
          const a = (body ?? {}) as Record<string, unknown>;
          const mine = acc.rows.filter((r) => r.user === user);
          switch (`${method} ${path}`) {
            case "POST rpc/my_designs":
              return answer(
                [...mine]
                  .sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : x.id < y.id ? -1 : 1))
                  .map((r) => ({ id: r.id, name: r.name, source: r.source, picture: r.picture, bytes: bytes(r), saved_at: r.savedAt, updated_at: r.updatedAt, revision: r.revision })),
              );
            case "POST rpc/get_design": {
              const r = mine.find((x) => x.id === a.p_id);
              return answer(r ? { id: r.id, name: r.name, source: r.source, body: r.body, saved_at: r.savedAt, updated_at: r.updatedAt, revision: r.revision } : null);
            }
            case "POST rpc/design_versions":
              return answer(mine.some((x) => x.id === a.p_id) ? [...(acc.versions.get(String(a.p_id)) ?? [])].reverse().map((v) => ({ saved_at: v.savedAt, bytes: v.body.length })) : []);
            case "POST rpc/get_design_version": {
              const v = mine.some((x) => x.id === a.p_id) ? acc.versions.get(String(a.p_id))?.find((x) => Date.parse(x.savedAt) === Date.parse(String(a.p_saved_at))) : undefined;
              return answer(v ? { saved_at: v.savedAt, body: v.body } : null);
            }
            case "POST rpc/delete_design": {
              const before = acc.rows.length;
              acc.rows = acc.rows.filter((x) => !(x.user === user && x.id === a.p_id));
              return answer(acc.rows.length < before);
            }
            case "POST rpc/delete_my_designs": {
              const before = acc.rows.length;
              acc.rows = acc.rows.filter((x) => x.user !== user);
              return answer(before - acc.rows.length);
            }
            case "POST rpc/my_design_space":
              return answer({ designs: mine.length, bytes: mine.reduce((s, r) => s + bytes(r), 0), max_designs: LIMITS.maxDesigns, max_bytes: LIMITS.maxBytes });
            case "GET profiles?select=keep_designs":
              return answer([{ keep_designs: acc.keep.get(user) ?? true }]);
            case "POST rpc/save_design": {
              if ((acc.keep.get(user) ?? true) !== true) return answer({ status: "off" });
              const text = String(a.p_body);
              const picture = (a.p_picture as string | null) ?? null;
              if (text.length > LIMITS.maxDesignBytes || (picture?.length ?? 0) > LIMITS.maxPictureBytes) return answer({ status: "too-big" });
              const used = mine.reduce((s, r) => s + bytes(r), 0);
              const now = new Date((clock += 1000)).toISOString();
              if (a.p_id !== null) {
                const r = mine.find((x) => x.id === a.p_id);
                if (!r) return answer({ status: "gone" });
                if (r.revision !== a.p_expected) return answer({ status: "changed", revision: r.revision });
                const after = { ...r, body: text, picture: picture ?? r.picture };
                if (used - bytes(r) + bytes(after) > LIMITS.maxBytes) return answer({ status: "full" });
                if (r.body !== text) {
                  const kept = acc.versions.get(r.id) ?? [];
                  const newest = kept.at(-1);
                  const gap = LIMITS.versionGapMinutes * 60_000;
                  // Kept when the newest version is the gap older, or the copy stood for the gap (20261112140000_design_versions_session_end.sql; by the devices' times here).
                  if (!newest || Date.parse(r.savedAt) - Date.parse(newest.savedAt) >= gap || Date.parse(String(a.p_saved_at)) - Date.parse(r.savedAt) >= gap) kept.push({ savedAt: r.savedAt, body: r.body });
                  acc.versions.set(r.id, kept.slice(-LIMITS.versionsKept));
                }
                Object.assign(r, { name: a.p_name, source: a.p_source, body: text, picture: picture ?? r.picture, savedAt: a.p_saved_at, updatedAt: now, revision: r.revision + 1 });
                return answer({ status: "saved", id: r.id, revision: r.revision, updated_at: now });
              }
              if (mine.length >= LIMITS.maxDesigns) return answer({ status: "full" });
              if (used + text.length + (picture?.length ?? 0) > LIMITS.maxBytes) return answer({ status: "full" });
              const r: Row = { id: uuid(), user, name: String(a.p_name), source: String(a.p_source), body: text, picture, savedAt: String(a.p_saved_at), updatedAt: now, revision: 1 };
              acc.rows.push(r);
              return answer({ status: "saved", id: r.id, revision: 1, updated_at: now });
            }
          }
          if (method === "PATCH" && path === `profiles?id=eq.${user}`) {
            acc.keep.set(user, (body as { keep_designs: boolean }).keep_designs);
            return answer(undefined);
          }
          return { kind: "failed", reason: "rejected" };
        },
      };
    },
  };
  return acc;
}
