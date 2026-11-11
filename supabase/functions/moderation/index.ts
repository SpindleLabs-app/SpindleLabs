// SpindleLabs' moderation function (a Supabase Edge Function, Deno): what the review page
// (supabase/review/, run on a moderator's own computer, never part of the app) asks for, so
// the people who run SpindleLabs can act on reports without the SQL editor (community step
// C5b). One file with no imports, so it can be pasted into the Supabase dashboard's editor as
// it is. Deploy it with "Verify JWT" OFF: every request is checked here, and the browser's
// CORS check (OPTIONS) carries no sign-in.
//
//   POST /moderation   { do: "<what>", ... }  with  authorization: Bearer <the moderator's sign-in>
//
// Who may use it: ONLY the accounts named in the secret MODERATORS, checked here on the server
// for every request (the page itself decides nothing). The caller's sign-in is checked with
// Supabase's sign-in service, then its account id must be on the list. The name kept in the
// moderation record is the list's name for that account, never anything the request says. With
// MODERATORS unset or malformed nobody may use it (fail closed).
//
// What it does is only the C5a database functions (supabase/migrations/20261111160000_moderation.sql)
// and plain reads of the rows they work on, run as the server (service_role).
//
// Secrets (Supabase dashboard > Edge Functions > Secrets; never in the code or the chat):
//   MODERATORS   comma-separated  <account id>=<name>  pairs, e.g. "0b7c…-…=Ben". The account id is
//                the one under Authentication > Users. The name (1 to 100 characters) goes in the record.
// Supabase itself provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
// EXTRA_ORIGINS (comma-separated) adds pages allowed to call it, beside the review page's own.
// Tested in node by packages/account/test/moderation-function.test.ts against a fake sign-in service and database.

export type Env = Record<string, string | undefined>;
export type Deps = { env: Env; fetch: typeof fetch; now?: () => number; log?: (line: string) => void };

/** Where the review page runs: the moderator's own computer (supabase/review/serve.mjs). Never the app's pages. */
export const REVIEW_ORIGINS = ["http://localhost:8765", "http://127.0.0.1:8765"];
/** The largest request read at all, in bytes: the longest claim with every character escaped, and the rest. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** The longest note (why), as the moderation record allows. */
export const MAX_NOTE_CHARS = 2000;
/** The longest hold reason, shown to the person in Download my data, as account_holds allows. */
export const MAX_REASON_CHARS = 500;
/** Longest claimant and contact, and work described, as takedown_claims allows. */
export const MAX_CLAIMANT_CHARS = 200;
export const MAX_WORK_CHARS = 2000;
/** The longest moderator name, as the moderation record allows. */
export const MAX_MODERATOR_CHARS = 100;
/** Rows of the moderation record answered at once. */
export const LOG_PAGE = 100;
/** The longest hold with an end, in days (longer is a closed account: no end). */
export const MAX_HOLD_DAYS = 3650;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The allow-list in `text` ("id=Name,id=Name"), or null when it is missing or any entry is malformed (so a typo
 * never half-works: it locks everyone out until fixed). Ids are compared in lower case.
 */
export function readModerators(text: string | undefined): Map<string, string> | null {
  if (!text || !text.trim()) return null;
  const list = new Map<string, string>();
  for (const entry of text.split(",")) {
    const at = entry.indexOf("=");
    if (at < 0) return null;
    const id = entry.slice(0, at).trim().toLowerCase();
    const name = entry.slice(at + 1).trim();
    if (!UUID.test(id) || name.length < 1 || name.length > MAX_MODERATOR_CHARS || list.has(id)) return null;
    list.set(id, name);
  }
  return list;
}

/** The request's text, reading no further than MAX_REQUEST_BYTES (null past it), whatever its length header says. */
async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(all);
}

type Ask = Record<string, unknown>;
class Bad extends Error {}

/** A text field of 1..max characters (after trimming), or Bad. */
function text(a: Ask, key: string, max: number): string {
  const v = a[key];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) throw new Bad(key);
  return v.trim();
}
function uuid(a: Ask, key: string): string {
  const v = a[key];
  if (typeof v !== "string" || !UUID.test(v.toLowerCase())) throw new Bad(key);
  return v.toLowerCase();
}
function oneOf<T extends string>(a: Ask, key: string, allowed: readonly T[]): T {
  const v = a[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new Bad(key);
  return v as T;
}

export function moderation(deps: Deps) {
  const env = deps.env;
  const origins = [...REVIEW_ORIGINS, ...(env.EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];

  function cors(req: Request): Record<string, string> {
    const o = req.headers.get("origin");
    return o && origins.includes(o)
      ? { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" }
      : {};
  }
  // no-store: answers hold reports and accounts, never kept by a browser or proxy.
  const reply = (req: Request, status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json", "cache-control": "no-store" } });

  /** The account id behind the request's sign-in, checked with Supabase's sign-in service; null when there is none. */
  async function caller(req: Request): Promise<string | null> {
    const m = /^Bearer (\S{1,4096})$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return null;
    try {
      const res = await deps.fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY ?? "", authorization: `Bearer ${m[1]}` } });
      if (!res.ok) return null;
      const u = await res.json();
      return typeof u?.id === "string" && UUID.test(u.id.toLowerCase()) ? u.id.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  const server = () => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "", authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" });

  /** A C5a database function run as the server. Throws on any failure (answered 502). */
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await deps.fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: server(), body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`rpc ${name} ${res.status}`);
    return res.json();
  }

  /** Rows read as the server; `query` is built here from checked values only. Throws on any failure. */
  async function rows(table: string, query: string): Promise<Record<string, unknown>[]> {
    const res = await deps.fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: server() });
    if (!res.ok) throw new Error(`read ${table} ${res.status}`);
    const v = await res.json();
    if (!Array.isArray(v)) throw new Error(`read ${table}: not a list`);
    return v;
  }

  /** The account's email, from Supabase's sign-in service (admin); null when it has none or is gone. */
  async function emailOf(user: string): Promise<string | null> {
    const res = await deps.fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${user}`, { headers: server() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`user ${res.status}`);
    const u = await res.json();
    return typeof u?.email === "string" && u.email ? u.email : null;
  }

  const LINK_FIELDS = "id,name,user_id,created_at,off_at,removed_at,bytes,picture";

  /** What each `do` answers, given the checked request and the moderator's name from the allow-list. */
  const actions: Record<string, (a: Ask, moderator: string) => Promise<unknown>> = {
    me: async (_a, moderator) => ({ moderator }),
    queue: async () => ({ queue: await rpc("review_queue", {}) }),
    // One link: the link itself (never its file, see "design"), every report on it, its claims and its record.
    link: async (a) => {
      const id = uuid(a, "share");
      const [link] = await rows("shares", `id=eq.${id}&select=${LINK_FIELDS}`);
      const reports = await rows("share_reports", `share_id=eq.${id}&select=id,kind,reason,reporter,created_at,reviewed_at&order=created_at.desc&limit=500`);
      const claims = await rows("takedown_claims", `share_id=eq.${id}&select=id,received_at,claimant,contact,work,outcome,took_down,decided_at&order=id.desc`);
      const record = await rows("moderation_log", `share_id=eq.${id}&select=id,at,action,moderator,note&order=id.desc&limit=${LOG_PAGE}`);
      return { link: link ?? null, reports, claims, record };
    },
    // The link's file as shared, to look at in the app (opened by hand; nothing here runs it).
    design: async (a) => {
      const id = uuid(a, "share");
      const [row] = await rows("shares", `id=eq.${id}&select=name,body`);
      return { design: row ?? null };
    },
    // One person: their name, hold, links and the decisions about them.
    person: async (a) => {
      const user = uuid(a, "user");
      const [name] = await rows("display_names", `user_id=eq.${user}&select=name`);
      const [hold] = await rows("account_holds", `user_id=eq.${user}&select=since,until,reason`);
      const links = await rows("shares", `user_id=eq.${user}&select=id,name,created_at,off_at,removed_at&order=created_at.desc&limit=200`);
      const record = await rows("moderation_log", `user_id=eq.${user}&select=id,at,action,share_id,moderator,note&order=id.desc&limit=${LOG_PAGE}`);
      return { name: (name?.name as string | undefined) ?? null, hold: hold ?? null, links, record };
    },
    decide: async (a, moderator) => ({ done: await rpc("decide_share", { p_id: uuid(a, "share"), p_action: oneOf(a, "decision", ["take-down", "put-back", "dismiss"] as const), p_moderator: moderator, p_note: text(a, "note", MAX_NOTE_CHARS) }) }),
    "reset-name": async (a, moderator) => ({ done: await rpc("moderate_name", { p_user: uuid(a, "user"), p_moderator: moderator, p_note: text(a, "note", MAX_NOTE_CHARS) }) }),
    hold: async (a, moderator) => {
      // days: a whole number of days from now, or null for a closed account (no end).
      const days = a.days;
      if (!(days === null || (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_HOLD_DAYS))) throw new Bad("days");
      if (typeof a.take_links !== "boolean") throw new Bad("take_links");
      const until = days === null ? null : new Date((deps.now ?? Date.now)() + days * 86_400_000).toISOString();
      return { done: await rpc("hold_account", { p_user: uuid(a, "user"), p_until: until, p_reason: text(a, "reason", MAX_REASON_CHARS), p_take_links: a.take_links, p_moderator: moderator, p_note: text(a, "note", MAX_NOTE_CHARS) }) };
    },
    "end-hold": async (a, moderator) => ({ done: await rpc("end_hold", { p_user: uuid(a, "user"), p_moderator: moderator, p_note: text(a, "note", MAX_NOTE_CHARS) }) }),
    claim: async (a, moderator) => ({
      claim: await rpc("record_claim", { p_share: uuid(a, "share"), p_claimant: text(a, "claimant", MAX_CLAIMANT_CHARS), p_contact: text(a, "contact", MAX_CLAIMANT_CHARS), p_work: text(a, "work", MAX_WORK_CHARS), p_moderator: moderator }),
    }),
    "decide-claim": async (a, moderator) => {
      const claim = a.claim;
      if (typeof claim !== "number" || !Number.isSafeInteger(claim) || claim < 1) throw new Bad("claim");
      return { done: await rpc("decide_claim", { p_claim: claim, p_outcome: oneOf(a, "outcome", ["upheld", "rejected"] as const), p_moderator: moderator, p_note: text(a, "note", MAX_NOTE_CHARS) }) };
    },
    claims: async () => ({ claims: await rows("takedown_claims", "outcome=eq.open&select=id,received_at,share_id,claimant,contact,work,took_down&order=id") }),
    // The newest decisions, LOG_PAGE at a time; `before` (a record id) for the page after.
    log: async (a) => {
      const before = a.before;
      if (!(before === undefined || (typeof before === "number" && Number.isSafeInteger(before) && before >= 1))) throw new Bad("before");
      return { record: await rows("moderation_log", `select=id,at,action,share_id,user_id,moderator,note&order=id.desc&limit=${LOG_PAGE}${before === undefined ? "" : `&id=lt.${before}`}`) };
    },
    // Who to tell that their link was taken down: the owner's email, only for a link that is down. The wording is
    // the page's (a PLACEHOLDER until the legal check); the moderator sends it.
    notice: async (a) => {
      const id = uuid(a, "share");
      const [link] = await rows("shares", `id=eq.${id}&select=name,user_id,removed_at`);
      if (!link || link.removed_at == null) return { email: null };
      return { email: await emailOf(String(link.user_id)), name: link.name };
    },
  };

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== "POST") return reply(req, 405, { error: "method" });
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(req, 503, { error: "not-set-up" });
    const moderators = readModerators(env.MODERATORS);
    if (!moderators) return reply(req, 503, { error: "not-set-up" });
    if (!origins.includes(req.headers.get("origin") ?? "")) return reply(req, 403, { error: "origin" });
    // Who first: nothing of the request is read before the caller is known to be a moderator.
    const who = await caller(req);
    if (!who) return reply(req, 401, { error: "sign-in" });
    const moderator = moderators.get(who);
    if (!moderator) {
      deps.log?.(`refused: account ${who} is not on the moderators' list`);
      return reply(req, 403, { error: "not-a-moderator" });
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return reply(req, 413, { error: "too-big" });
    const raw = await readCapped(req);
    if (raw === null) return reply(req, 413, { error: "too-big" });
    let a: Ask;
    try {
      const v = JSON.parse(raw);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
      a = v;
    } catch {
      return reply(req, 400, { error: "body" });
    }
    const act = typeof a.do === "string" && Object.hasOwn(actions, a.do) ? actions[a.do] : undefined;
    if (!act) return reply(req, 400, { error: "do" });
    try {
      return reply(req, 200, await act(a, moderator));
    } catch (e) {
      if (e instanceof Bad) return reply(req, 400, { error: e.message });
      deps.log?.(`failed: ${String(a.do)}: ${e instanceof Error ? e.message : "?"}`);
      return reply(req, 502, { error: "unavailable" });
    }
  };
}

// In Supabase (Deno) only: serve. Node's tests import moderation() without starting anything.
const deno = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): void; env: { toObject(): Env } } }).Deno;
if (deno) deno.serve(moderation({ env: deno.env.toObject(), fetch: (i, o) => fetch(i, o), log: (line) => console.log(line) }));
