// SpindleLabs' bug-report function (a Supabase Edge Function, Deno): lets people
// report a bug from the app without a GitHub account. One file with no imports, so
// it can be pasted into the Supabase dashboard's editor as it is. Deploy it with
// "Verify JWT" OFF: anyone using the app may report, signed in or not.
//
//   POST /bug-report   { title, body, design: { name, text } | null }  ->  { issue: n }
//
// Each report becomes an issue in a PRIVATE GitHub repository (BUG_REPORT_REPO), and
// its design, when the person left "Include my design" ticked, a file in that
// repository the issue links to. Private, because designs are people's own work.
// Spam and runaway loops stay cheap: only the app's pages may send, sizes are capped
// (the request is never read past its limit), and the database allows 5 reports an
// hour and 15 a day per sender, 200 a day in all and 100 MiB of designs a day
// (bug_report_allowed, supabase/migrations/20261111010000_bug_report_limits.sql). A
// sender is a salted hash of the caller's address (`senderAddress`: never a value the
// caller can choose; IPv6 by its /64); the address itself is never stored.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets; never in the code or the chat):
//   GITHUB_BUG_TOKEN  a fine-grained token for BUG_REPORT_REPO only: Issues and Contents, read and write
//   BUG_REPORT_REPO   "owner/name" of the private repository
//   BUG_REPORT_SALT   any long random text, so a sender's hash can't be turned back into an address
// Supabase itself provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. EXTRA_ORIGINS
// (comma-separated) adds pages allowed to send, as for billing.
// Tested in node by packages/account/test/bug-report-function.test.ts against a fake GitHub and database.

export type Env = Record<string, string | undefined>;
export type Deps = { env: Env; fetch: typeof fetch; now: () => number; id?: () => string };

/** The addresses the app is served from; only these may send a report. */
export const APP_ORIGINS = ["https://spindlelabs.app", "https://www.spindlelabs.app", "https://spindlelabs-app.github.io"];
/** The largest design, in bytes (UTF-8): 5 MiB, as the app's own limit. */
export const MAX_DESIGN_BYTES = 5 * 1024 * 1024;
/** The longest issue body, in characters (GitHub takes 65,536; room is kept for the design's line). */
export const MAX_BODY_CHARS = 60_000;
/** The longest title, in characters. */
export const MAX_TITLE_CHARS = 200;
/** The largest request read at all, in bytes: a design at its limit with every character escaped in JSON, and the rest. */
export const MAX_REQUEST_BYTES = 2 * MAX_DESIGN_BYTES + 4 * MAX_BODY_CHARS + 4096;

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64 of the UTF-8 bytes of `text`, in pieces so a large design doesn't overflow the call stack. */
function base64(text: string): string {
  const bytes = enc.encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The body as filed, so a report never pings anyone: every "&" written as "&amp;" (so "&#64;name" and "&commat;name"
 * show as typed rather than becoming an @), then "@name" with a zero-width space (U+200B) after the @.
 */
export const quiet = (text: string) => text.replace(/&/g, "&amp;").replace(/@(?=[A-Za-z0-9_-])/g, "@​");

/** `text` with every character Markdown gives a meaning to escaped, so a design's name is only ever its name. */
const plain = (text: string) => text.replace(/[\\`*_{}[\]()<>#+!|~&-]/g, (c) => `\\${c}`);

/**
 * Who is sending, for the limits: the address Cloudflare (in front of Supabase) puts in cf-connecting-ip, which a
 * caller can't set, else the LAST x-forwarded-for entry (the one the proxy added; the ones before it are the
 * caller's own words). An IPv6 address counts by its /64, since one home or host is given a whole /64.
 */
export function senderAddress(headers: Headers): string {
  const cf = (headers.get("cf-connecting-ip") ?? "").trim();
  const address = cf || (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop() || "unknown";
  return address.includes(":") ? ipv6Prefix(address) : address;
}

/** The first four groups of an IPv6 address (its /64), written out in full: "2001:db8:1:2::1" is "2001:0db8:0001:0002::/64". */
export function ipv6Prefix(address: string): string {
  const bare = address.replace(/^\[|\](:\d+)?$/g, "").split("%")[0].toLowerCase();
  const gap = bare.includes("::");
  const [head, tail = ""] = bare.split("::");
  const left = head ? head.split(":") : [];
  const right = gap && tail ? tail.split(":") : [];
  const groups = gap ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
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

/** A design's file name as the app makes it: no folders, ends in .spindle.json. */
const NAME = /^[^/\\\u0000-\u001f]{1,120}\.spindle\.json$/;

type Report = { title: string; body: string; design: { name: string; text: string } | null };

/** The report in `raw`, or the status and error to answer. */
function readReport(raw: string): Report | { status: number; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { status: 400, error: "body" };
  }
  const r = v as Record<string, unknown> | null;
  if (typeof r !== "object" || r === null || typeof r.title !== "string" || typeof r.body !== "string" || r.title.trim() === "") return { status: 400, error: "body" };
  const d = r.design as Record<string, unknown> | null | undefined;
  if (d != null && (typeof d !== "object" || typeof d.name !== "string" || typeof d.text !== "string" || d.name.includes("..") || !NAME.test(d.name))) return { status: 400, error: "design" };
  // The body is measured as it will be filed (after quiet(), which makes it longer), so GitHub never refuses it
  // after the design is stored and a place used.
  if (r.title.length > MAX_TITLE_CHARS || quiet(r.body).length > MAX_BODY_CHARS) return { status: 413, error: "too-long" };
  if (d != null && enc.encode(d.text as string).length > MAX_DESIGN_BYTES) return { status: 413, error: "design-too-big" };
  return { title: r.title, body: r.body, design: d == null ? null : { name: d.name as string, text: d.text as string } };
}

export function bugReport(deps: Deps) {
  const env = deps.env;
  const origins = [...APP_ORIGINS, ...(env.EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  const newId = deps.id ?? (() => crypto.randomUUID().slice(0, 8));

  function cors(req: Request): Record<string, string> {
    const o = req.headers.get("origin");
    return o && origins.includes(o)
      ? { "access-control-allow-origin": o, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" }
      : {};
  }
  const reply = (req: Request, status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });

  /** A GitHub API request on the reports repository; the answer's JSON, or null on any failure. */
  async function github(method: "POST" | "PUT", path: string, body: unknown): Promise<Record<string, unknown> | null> {
    try {
      const res = await deps.fetch(`https://api.github.com/repos/${env.BUG_REPORT_REPO}/${path}`, {
        method,
        headers: { authorization: `Bearer ${env.GITHUB_BUG_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "spindlelabs-bug-report" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const answer = await res.json();
      return typeof answer === "object" && answer !== null ? answer : null;
    } catch {
      return null;
    }
  }

  /** Whether the database allows this sender a report now; undefined when it can't be asked. */
  async function allowed(sender: string, bytes: number): Promise<boolean | undefined> {
    try {
      const res = await deps.fetch(`${env.SUPABASE_URL}/rest/v1/rpc/bug_report_allowed`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "", authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ p_sender: sender, p_bytes: bytes }),
      });
      if (!res.ok) return undefined;
      const answer = await res.json();
      return typeof answer === "boolean" ? answer : undefined;
    } catch {
      return undefined;
    }
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== "POST") return reply(req, 405, { error: "method" });
    if (!env.GITHUB_BUG_TOKEN || !env.BUG_REPORT_REPO || !env.BUG_REPORT_SALT || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(req, 503, { error: "not-set-up" });
    if (!origins.includes(req.headers.get("origin") ?? "")) return reply(req, 403, { error: "origin" });
    if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return reply(req, 413, { error: "too-big" });
    const raw = await readCapped(req);
    if (raw === null) return reply(req, 413, { error: "too-big" });
    const r = readReport(raw);
    if ("status" in r) return reply(req, r.status, { error: r.error });
    const sender = hex(await crypto.subtle.digest("SHA-256", enc.encode(`${env.BUG_REPORT_SALT}|${senderAddress(req.headers)}`)));
    const ok = await allowed(sender, r.design ? enc.encode(r.design.text).length : 0);
    if (ok === undefined) return reply(req, 502, { error: "unavailable" });
    if (!ok) return reply(req, 429, { error: "slow-down" });
    let designLine = "";
    if (r.design) {
      const day = new Date(deps.now()).toISOString().slice(0, 10);
      const path = `reports/${day}/${newId()}-${r.design.name}`;
      const stored = await github("PUT", `contents/${path.split("/").map(encodeURIComponent).join("/")}`, { message: `Design for a bug report (${day})`, content: base64(r.design.text) });
      const link = (stored?.content as { html_url?: unknown } | undefined)?.html_url;
      if (typeof link !== "string") return reply(req, 502, { error: "unavailable" });
      designLine = `\n\n---\nDesign file: [${plain(r.design.name)}](${link})`;
    }
    const issue = await github("POST", "issues", { title: r.title.trim(), body: quiet(r.body) + designLine });
    if (!issue || typeof issue.number !== "number") return reply(req, 502, { error: "unavailable" });
    return reply(req, 200, { issue: issue.number });
  };
}

// In Supabase (Deno) only: serve. Node's tests import bugReport() without starting anything.
const deno = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): void; env: { toObject(): Env } } }).Deno;
if (deno) deno.serve(bugReport({ env: deno.env.toObject(), fetch: (i, o) => fetch(i, o), now: () => Date.now() }));
