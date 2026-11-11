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
// Spam and runaway loops stay cheap: only the app's pages may send, sizes are capped,
// and the database allows 5 reports an hour per sender and 200 a day in all
// (bug_report_allowed, supabase/migrations/20261111000000_bug_reports.sql). A sender
// is a salted hash of the caller's address; the address itself is never stored.
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

/** "@name" with a zero-width space after the @, so a report never pings anyone. */
const quiet = (text: string) => text.replace(/@(?=[A-Za-z0-9_-])/g, "@​");

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
  if (r.title.length > MAX_TITLE_CHARS || r.body.length > MAX_BODY_CHARS) return { status: 413, error: "too-long" };
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
  async function allowed(sender: string): Promise<boolean | undefined> {
    try {
      const res = await deps.fetch(`${env.SUPABASE_URL}/rest/v1/rpc/bug_report_allowed`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "", authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ p_sender: sender }),
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
    const raw = await req.text();
    if (raw.length > MAX_REQUEST_BYTES) return reply(req, 413, { error: "too-big" });
    const r = readReport(raw);
    if ("status" in r) return reply(req, r.status, { error: r.error });
    // The first address in x-forwarded-for is the caller's (Supabase's proxy adds its own after it).
    const address = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const sender = hex(await crypto.subtle.digest("SHA-256", enc.encode(`${env.BUG_REPORT_SALT}|${address}`)));
    const ok = await allowed(sender);
    if (ok === undefined) return reply(req, 502, { error: "unavailable" });
    if (!ok) return reply(req, 429, { error: "slow-down" });
    let designLine = "";
    if (r.design) {
      const day = new Date(deps.now()).toISOString().slice(0, 10);
      const path = `reports/${day}/${newId()}-${r.design.name}`;
      const stored = await github("PUT", `contents/${path.split("/").map(encodeURIComponent).join("/")}`, { message: `Design for a bug report (${day})`, content: base64(r.design.text) });
      const link = (stored?.content as { html_url?: unknown } | undefined)?.html_url;
      if (typeof link !== "string") return reply(req, 502, { error: "unavailable" });
      designLine = `\n\n---\nDesign file: [${r.design.name}](${link})`;
    }
    const issue = await github("POST", "issues", { title: r.title.trim(), body: quiet(r.body) + designLine });
    if (!issue || typeof issue.number !== "number") return reply(req, 502, { error: "unavailable" });
    return reply(req, 200, { issue: issue.number });
  };
}

// In Supabase (Deno) only: serve. Node's tests import bugReport() without starting anything.
const deno = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): void; env: { toObject(): Env } } }).Deno;
if (deno) deno.serve(bugReport({ env: deno.env.toObject(), fetch: (i, o) => fetch(i, o), now: () => Date.now() }));
