// An in-memory account for the print log, answering the print log API's requests the way
// supabase/migrations/20261113120000_print_log.sql does (the same checks, the later change kept, 500 a person, 50 a
// save, `since` starting afresh when keeping is turned back on or the copy deleted; the SQL itself is checked on a real
// PostgreSQL by supabase/test/test_print_log.py). Times are compared as moments, as PostgreSQL does.

import type { AuthClient, PersonReply } from "../src/auth.ts";
import { PRINT_LOG_ACCOUNT_LIMITS as LIM } from "../src/print-log.ts";

type Row = { id: string; made_at: string; name: string; settings: string; grams: number | null; minutes: number | null; result: string; problem: string | null; note: string; updated_at: string };

export interface FakePrintLogAccount {
  rows: Map<string, Map<string, Row>>;
  keep: Map<string, boolean>;
  since: Map<string, number>;
  mode: "up" | "down" | "missing";
  /** The server's clock, in ms. */
  now: number;
  /** Runs before the next save is answered (another device saving in between, say). */
  beforeSave?: () => void;
  calls: string[];
  as(user: string | null): Pick<AuthClient, "asPerson">;
}

const PROBLEMS = ["came-off", "warped", "stringing", "layer-shift", "spaghetti", "supports", "gaps", "wrong-size", "stopped", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isTime = (t: unknown) => typeof t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(t) && Number.isFinite(Date.parse(t));
const chars = (s: string) => [...s].length;

function valid(p: unknown): p is Row {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return false;
  const r = p as Record<string, unknown>;
  if (Object.keys(r).some((k) => !["id", "made_at", "name", "settings", "grams", "minutes", "result", "problem", "note", "updated_at"].includes(k))) return false;
  if (typeof r.id !== "string" || !UUID.test(r.id) || !isTime(r.made_at) || !isTime(r.updated_at)) return false;
  if (typeof r.name !== "string" || chars(r.name) < 1 || chars(r.name) > LIM.maxName) return false;
  if (typeof r.settings !== "string" || chars(r.settings) > LIM.maxSettings || typeof r.note !== "string" || chars(r.note) > LIM.maxNote) return false;
  for (const [k, max] of [["grams", 100000], ["minutes", 100000]] as const) {
    const v = r[k] ?? null;
    if (v !== null && (typeof v !== "number" || v < 0 || v > max || (k === "minutes" && !Number.isInteger(v)))) return false;
  }
  if (r.result !== "waiting" && r.result !== "well" && r.result !== "failed") return false;
  const problem = r.problem ?? null;
  if (problem !== null && (r.result !== "failed" || !PROBLEMS.includes(problem as string))) return false;
  return true;
}

export function fakePrintLogAccount(): FakePrintLogAccount {
  const acc: FakePrintLogAccount = {
    rows: new Map(),
    keep: new Map(),
    since: new Map(),
    mode: "up",
    now: Date.parse("2026-11-13T00:00:00Z"),
    calls: [],
    as(user) {
      return {
        async asPerson(method, path, body): Promise<PersonReply> {
          acc.calls.push(`${method} ${path}`);
          if (!user) return { kind: "signed-out" };
          if (acc.mode === "down") return { kind: "failed", reason: "offline" };
          if (acc.mode === "missing") return { kind: "failed", reason: "rejected" };
          const ok = (v: unknown): PersonReply => ({ kind: "ok", body: JSON.parse(JSON.stringify(v)) });
          const mine = acc.rows.get(user) ?? new Map<string, Row>();
          acc.rows.set(user, mine);
          const keep = acc.keep.get(user) ?? true;
          const since = () => new Date(acc.since.get(user) ?? Date.parse("2026-11-01T00:00:00Z")).toISOString().replace("Z", "+00:00");
          const restart = () => acc.since.set(user, ++acc.now);
          const b = (body ?? {}) as Record<string, unknown>;
          if (path === "rpc/my_print_log") {
            const prints = [...mine.values()].sort((a, c) => Date.parse(c.made_at) - Date.parse(a.made_at) || (a.id < c.id ? -1 : 1));
            // PostgreSQL's way of writing times: "+00:00", not "Z".
            return ok({ keep, since: since(), prints: prints.map((p) => ({ ...p, made_at: p.made_at.replace("Z", "+00:00"), updated_at: p.updated_at.replace("Z", "+00:00") })) });
          }
          if (path === "rpc/save_prints") {
            const hook = acc.beforeSave;
            acc.beforeSave = undefined;
            hook?.();
            if (!(acc.keep.get(user) ?? true)) return ok({ status: "off" });
            const list = b.p_prints;
            if (!Array.isArray(list) || list.length > LIM.maxBatch || !list.every(valid) || new Set(list.map((p) => p.id)).size !== list.length) return ok({ status: "invalid" });
            const saved: string[] = [];
            const older: string[] = [];
            const full: string[] = [];
            for (const p of list) {
              const clamp = (t: string) => new Date(Math.min(Date.parse(t), acc.now)).toISOString();
              const row: Row = { ...p, grams: p.grams ?? null, minutes: p.minutes ?? null, problem: p.problem ?? null, made_at: clamp(p.made_at), updated_at: clamp(p.updated_at) };
              const had = mine.get(p.id);
              if (had) {
                if (Date.parse(row.updated_at) > Date.parse(had.updated_at)) {
                  mine.set(p.id, row);
                  saved.push(p.id);
                } else older.push(p.id);
              } else if (mine.size >= LIM.maxPrints) full.push(p.id);
              else {
                mine.set(p.id, row);
                saved.push(p.id);
              }
            }
            return ok({ status: "done", saved, older, full });
          }
          if (path === "rpc/delete_prints") {
            const list = b.p_ids;
            if (!Array.isArray(list) || list.length > LIM.maxPrints) return { kind: "failed", reason: "rejected" };
            let n = 0;
            for (const id of new Set(list as string[])) if (mine.delete(id)) n++;
            return ok(n);
          }
          if (path === "rpc/set_keep_print_log") {
            const on = b.p_on === true;
            if (on !== keep) restart();
            acc.keep.set(user, on);
            if (!on) mine.clear();
            return ok(on);
          }
          if (path === "rpc/delete_my_print_log") {
            const had = mine.size > 0;
            mine.clear();
            if (had) restart();
            return ok(had);
          }
          return { kind: "failed", reason: "rejected" };
        },
      };
    },
  };
  return acc;
}
