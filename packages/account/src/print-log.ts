// The print log kept in the account (account features 5; supabase/migrations/20261113120000_print_log.sql). Each
// browser keeps its own log (@fission/print print-log.ts); the prints in it that belong to this person (`owner`) are
// kept in their account too, so every device they sign in on shows the same log.
//
// A round compares three things: this browser's prints of this person, the account's, and the prints this browser
// last saw both sides hold (`PRINT_LOG_SEEN_PREFIX` + user id, with the account copy's `since`). A print on one side only
// is new there when it was never seen (sent, or brought here), and deleted on the other side when it was (deleted
// there, or here). A print on both sides takes the later change. When the account's copy was started afresh
// (keeping turned back on, or deleted: `since` changed), nothing seen counts, so a print is never deleted here because a
// fresh copy lacks it; the person's prints here are sent again.

import type { AuthClient, SmallStore } from "./auth.ts";
import type { DataResult } from "./data.ts";

/** The limits, as the database keeps them (print_log_limits()); checked by test/print-log.test.ts. */
export const PRINT_LOG_ACCOUNT_LIMITS = { maxPrints: 500, maxBatch: 50, maxName: 100, maxSettings: 200, maxNote: 500 } as const;

/** Where this browser keeps, per person, the prints it last saw both sides hold (never sent anywhere). */
export const PRINT_LOG_SEEN_PREFIX = "spindle.account.print-log/";

export type PrintOutcome = "waiting" | "well" | "failed";

/** One print, as the browser's log keeps it (@fission/print PrintEntry). */
export interface LoggedPrint {
  readonly id: string;
  readonly madeAt: string;
  readonly name: string;
  readonly settings: string;
  readonly grams: number | null;
  readonly minutes: number | null;
  readonly result: PrintOutcome;
  readonly problem: string | null;
  readonly note: string;
  readonly updatedAt: string;
  readonly owner: string | null;
}

/** One print as the account gives it (no owner: it is the person's). */
export type AccountPrint = Omit<LoggedPrint, "owner">;

export interface AccountLog {
  readonly keep: boolean;
  /** When the account's copy was last started afresh, as the account says it (compared as text). */
  readonly since: string;
  readonly prints: readonly AccountPrint[];
}

export interface SavePrintsAnswer {
  readonly status: "done";
  readonly saved: readonly string[];
  readonly older: readonly string[];
  readonly full: readonly string[];
}

const malformed = { kind: "failed", reason: "malformed" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isTime = (t: unknown): t is string => typeof t === "string" && Number.isFinite(Date.parse(t));
const amount = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** One print as the account sends it (snake case, PostgreSQL's times), or null. */
export function accountPrintFrom(v: unknown): AccountPrint | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID.test(r.id) || !isTime(r.made_at) || !isTime(r.updated_at)) return null;
  if (typeof r.name !== "string" || typeof r.settings !== "string" || typeof r.note !== "string") return null;
  if (!amount(r.grams) || !amount(r.minutes)) return null;
  if (r.result !== "waiting" && r.result !== "well" && r.result !== "failed") return null;
  if (r.problem !== null && typeof r.problem !== "string") return null;
  // Times as the browser writes them (toISOString), so the same moment always reads as the same text here.
  return { id: r.id, madeAt: new Date(r.made_at).toISOString(), name: r.name, settings: r.settings, grams: r.grams as number | null, minutes: r.minutes as number | null, result: r.result, problem: r.problem as string | null, note: r.note, updatedAt: new Date(r.updated_at).toISOString() };
}

export function accountLogFrom(v: unknown): AccountLog | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.keep !== "boolean" || typeof r.since !== "string" || !Array.isArray(r.prints)) return null;
  const prints: AccountPrint[] = [];
  for (const p of r.prints) {
    const one = accountPrintFrom(p);
    if (!one) return null;
    prints.push(one);
  }
  return { keep: r.keep, since: r.since, prints };
}

const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

export function savePrintsAnswerFrom(v: unknown): SavePrintsAnswer | "invalid" | "off" | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.status === "invalid" || r.status === "off") return r.status;
  if (r.status !== "done") return null;
  const saved = ids(r.saved);
  const older = ids(r.older);
  const full = ids(r.full);
  return saved && older && full ? { status: "done", saved, older, full } : null;
}

/** A print as the account takes it. */
export const wirePrint = (p: AccountPrint) => ({ id: p.id, made_at: p.madeAt, name: p.name, settings: p.settings, grams: p.grams, minutes: p.minutes, result: p.result, problem: p.problem, note: p.note, updated_at: p.updatedAt });

export function printLogApi(client: Pick<AuthClient, "asPerson">) {
  return {
    /** The prints kept in the account, newest made first, and whether keeping them is on. */
    async read(): Promise<DataResult<AccountLog>> {
      const r = await client.asPerson("POST", "rpc/my_print_log");
      if (r.kind !== "ok") return r;
      const log = accountLogFrom(r.body);
      return log ? { kind: "ok", value: log } : malformed;
    },
    /** Keeps these prints (at most 50) in the account; the later change of two is kept. */
    async save(prints: readonly AccountPrint[]): Promise<DataResult<SavePrintsAnswer | "invalid" | "off">> {
      const r = await client.asPerson("POST", "rpc/save_prints", { p_prints: prints.map(wirePrint) });
      if (r.kind !== "ok") return r;
      const a = savePrintsAnswerFrom(r.body);
      return a ? { kind: "ok", value: a } : malformed;
    },
    /** Deletes these prints (at most 500) from the account; gives how many there were. */
    async remove(printIds: readonly string[]): Promise<DataResult<number>> {
      const r = await client.asPerson("POST", "rpc/delete_prints", { p_ids: printIds });
      if (r.kind !== "ok") return r;
      return typeof r.body === "number" && Number.isSafeInteger(r.body) && r.body >= 0 ? { kind: "ok", value: r.body } : malformed;
    },
    /** Turns keeping the print log on or off on every device; off deletes the prints kept in the account. */
    async setKeeping(on: boolean): Promise<DataResult<boolean>> {
      const r = await client.asPerson("POST", "rpc/set_keep_print_log", { p_on: on === true });
      if (r.kind !== "ok") return r;
      return typeof r.body === "boolean" ? { kind: "ok", value: r.body } : malformed;
    },
  };
}

export type PrintLogApi = ReturnType<typeof printLogApi>;

/** This browser's log, as the round needs it. */
export interface LocalPrints {
  /** Every print kept here (any owner), or null when the log can't be read. */
  read(): readonly LoggedPrint[] | null;
  /**
   * Puts these prints in (replacing one with the same id only when it hasn't changed here since: its `updatedAt` not
   * later than the one put) and deletes these ids (only while unchanged since `asOf`, the `updatedAt` the round read),
   * reading the log afresh first; false when the log can't be written.
   */
  apply(put: readonly LoggedPrint[], drop: readonly { id: string; asOf: string }[]): boolean;
}

export interface PrintLogSyncDeps {
  readonly api: Pick<PrintLogApi, "read" | "save" | "remove">;
  readonly userId: string;
  /** Where the prints seen both sides are kept. */
  readonly store: SmallStore;
  readonly local: LocalPrints;
  /** Runs `fn` while no other tab of this browser is syncing the print log. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
  /** False once this person signed out here: a round still running then writes nothing here. */
  current?(): boolean;
}

export type PrintLogReport =
  /** sent: prints kept in the account this round; brought: prints put here; deleted: here or there; full: prints the account had no room for. */
  | { readonly kind: "done"; readonly sent: number; readonly brought: number; readonly deleted: number; readonly full: number }
  | { readonly kind: "off" }
  | Exclude<DataResult<never>, { kind: "ok" }>;

interface Seen {
  since: string;
  ids: string[];
}

/** The prints this browser last saw both sides hold for `userId`, when the account's copy began at `since`. */
export function readSeen(store: SmallStore, userId: string): Seen | null {
  try {
    const v = JSON.parse(store.getItem(PRINT_LOG_SEEN_PREFIX + userId) ?? "null") as Partial<Seen> | null;
    return v && typeof v.since === "string" && Array.isArray(v.ids) && v.ids.every((x) => typeof x === "string") ? { since: v.since, ids: v.ids } : null;
  } catch {
    return null;
  }
}

/** Forgets what this browser saw of `userId`'s account log (deleting the account here). */
export function forgetPrintLogSeen(store: SmallStore, userId: string): void {
  try {
    store.removeItem(PRINT_LOG_SEEN_PREFIX + userId);
  } catch {
    // Storage blocked: nothing was kept either.
  }
}

const later = (a: string, b: string) => Date.parse(a) > Date.parse(b);
const chunks = <T>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function printLogSync(deps: PrintLogSyncDeps) {
  const { api, store, userId, local } = deps;
  const current = () => deps.current?.() ?? true;

  async function once(): Promise<PrintLogReport> {
    const read = await api.read();
    if (read.kind !== "ok") return read;
    const account = read.value;
    if (!account.keep) {
      forgetPrintLogSeen(store, userId);
      return { kind: "off" };
    }
    const all = local.read();
    if (all === null) return { kind: "failed", reason: "malformed" };
    const seenThen = readSeen(store, userId);
    const seen = new Set(seenThen && seenThen.since === account.since ? seenThen.ids : []);
    const here = new Map(all.filter((p) => p.owner === userId).map((p) => [p.id, p]));
    const there = new Map(account.prints.map((p) => [p.id, p]));

    const send: AccountPrint[] = [];
    const dropHere: { id: string; asOf: string }[] = [];
    const deleteThere: string[] = [];
    const bring: LoggedPrint[] = [];
    for (const p of here.values()) {
      const t = there.get(p.id);
      if (!t) {
        if (seen.has(p.id)) dropHere.push({ id: p.id, asOf: p.updatedAt }); // deleted on another device
        else send.push(withoutOwner(p)); // new here
      } else if (later(p.updatedAt, t.updatedAt)) send.push(withoutOwner(p));
      else if (later(t.updatedAt, p.updatedAt)) bring.push({ ...t, owner: userId });
    }
    for (const t of there.values()) {
      if (here.has(t.id)) continue;
      // Another account's print with the same id here is left alone; it can't be this person's.
      if (seen.has(t.id)) deleteThere.push(t.id); // deleted here
      else if (!all.some((p) => p.id === t.id)) bring.push({ ...t, owner: userId }); // new from another device
    }

    let deleted = 0;
    for (const part of chunks(deleteThere, PRINT_LOG_ACCOUNT_LIMITS.maxPrints)) {
      const r = await api.remove(part);
      if (r.kind !== "ok") return r;
      deleted += part.length;
    }
    const kept = new Set<string>();
    let full = 0;
    for (const part of chunks(send, PRINT_LOG_ACCOUNT_LIMITS.maxBatch)) {
      const r = await api.save(part);
      if (r.kind !== "ok") return r;
      if (r.value === "off") return { kind: "off" };
      if (r.value === "invalid") return { kind: "failed", reason: "malformed" };
      for (const id of r.value.saved) kept.add(id);
      full += r.value.full.length;
    }
    if (!current()) return { kind: "signed-out" };
    if ((bring.length || dropHere.length) && !local.apply(bring, dropHere)) return { kind: "failed", reason: "malformed" };
    // Seen both sides now: what the account holds and wasn't deleted, and what was just kept there.
    const both = [...there.keys()].filter((id) => !deleteThere.includes(id)).concat([...kept]);
    try {
      store.setItem(PRINT_LOG_SEEN_PREFIX + userId, JSON.stringify({ since: account.since, ids: [...new Set(both)] }));
    } catch {
      // Storage blocked: the next round sees nothing as seen, so it only sends and brings, never deletes.
    }
    return { kind: "done", sent: kept.size, brought: bring.length, deleted: deleted + dropHere.length, full };
  }

  return {
    /** One round, while no other tab of this browser runs one. */
    round: (): Promise<PrintLogReport> => deps.lock(once),
  };
}

export type PrintLogSync = ReturnType<typeof printLogSync>;

function withoutOwner(p: LoggedPrint): AccountPrint {
  const { owner: _owner, ...rest } = p;
  return rest;
}
