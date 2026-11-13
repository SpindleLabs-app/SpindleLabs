// A fake of the account service's four auth requests, written from Supabase's
// published behaviour and RFC 7636, with its own SHA-256 (node:crypto) so it
// checks the app's PKCE independently. Tests drive "Google" by calling
// `approve(challenge)`, which is what the sign-in page does in real life.

import { createHash } from "node:crypto";

export const SERVICE = "https://abcdefghijklmnopqrst.supabase.co";
export const KEY = "anon-key-for-tests";

export interface FakeService {
  fetch: typeof fetch;
  /** Every request made, in order. */
  readonly calls: { url: string; init: RequestInit }[];
  /** The code the sign-in page would hand back for a sign-in that sent `challenge`. */
  approve(challenge: string): string;
  /** "up" answers; "down" throws as fetch does with no network; a number answers every request with that status. */
  mode: "up" | "down" | number;
  /** When true, a sign-in code sent with the wrong secret is refused but stays usable (by default a code works once, whatever happens). */
  keepCodeOnWrongSecret?: boolean;
  /** When set, the next successful reply's body is this instead. */
  nextBody?: unknown;
  /** Refresh tokens the service still accepts. */
  readonly liveRefresh: Set<string>;
  /** The service's clock, in seconds. */
  nowS: () => number;
  readonly loggedOut: string[];
  /** The data API's rows for the one test user, or undefined once the account is deleted. */
  profile?: { email_opt_in: boolean };
  /** When set, the next data request's reply body is this instead. */
  nextData?: unknown;
  /** A service from before Download my data's limit: no download_my_data (a 404). */
  oldData?: boolean;
  /** The time download_my_data says to wait until, once; the next call answers again. */
  dataWait?: string;
}

export const USER = { id: "7f3c2a10-0000-4000-8000-000000000001", email: "maker@example.com", user_metadata: { full_name: "Ada Maker", avatar_url: "https://lh3.example/a.png" } };

export function fakeService(nowS: () => number): FakeService {
  const codes = new Map<string, string>(); // code -> challenge
  let n = 0;
  const svc: FakeService = {
    calls: [],
    mode: "up",
    liveRefresh: new Set(),
    loggedOut: [],
    profile: { email_opt_in: false },
    nowS,
    approve(challenge) {
      const code = `code-${++n}`;
      codes.set(code, challenge);
      return code;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      svc.calls.push({ url, init: init ?? {} });
      if (svc.mode === "down") throw new TypeError("Failed to fetch");
      if (typeof svc.mode === "number") return new Response("{}", { status: svc.mode });
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.startsWith(`${SERVICE}/rest/v1/`)) return data(url.slice(`${SERVICE}/rest/v1/`.length), init ?? {}, headers);
      if (init?.method !== "POST") return new Response("{}", { status: 405 });
      if (headers["content-type"] !== "application/json") return new Response("{}", { status: 415 });
      if (headers.apikey !== KEY) return new Response('{"error":"no api key"}', { status: 401 });
      const body = JSON.parse(String(init?.body ?? "{}"));
      const issue = () => {
        const refresh = `refresh-${++n}`;
        svc.liveRefresh.add(refresh);
        const reply = svc.nextBody ?? { access_token: `access-${n}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(svc.nowS()) + 3600, refresh_token: refresh, user: USER };
        svc.nextBody = undefined;
        return new Response(JSON.stringify(reply), { status: 200 });
      };
      // Only sign-out carries the session's token; a token request never should.
      if (url.includes("/token?") && "authorization" in headers) return new Response('{"error":"unexpected token"}', { status: 400 });
      if (url === `${SERVICE}/auth/v1/token?grant_type=pkce`) {
        const challenge = codes.get(body.auth_code);
        const hashed = createHash("sha256").update(String(body.code_verifier)).digest("base64url");
        if (!(svc.keepCodeOnWrongSecret && challenge !== undefined && hashed !== challenge)) codes.delete(body.auth_code); // a code works once
        if (challenge === undefined || hashed !== challenge) return new Response('{"error":"invalid_grant"}', { status: 400 });
        return issue();
      }
      if (url === `${SERVICE}/auth/v1/token?grant_type=refresh_token`) {
        if (!svc.liveRefresh.delete(body.refresh_token)) return new Response('{"error":"invalid_grant"}', { status: 400 });
        return issue();
      }
      if (url === `${SERVICE}/auth/v1/logout?scope=local`) {
        if (!headers.authorization?.startsWith("Bearer access-")) return new Response("{}", { status: 401 });
        svc.loggedOut.push(headers.authorization ?? "");
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  };
  const live = new Set<string>();
  const realIssueTokens = svc.fetch;
  // Every access token the service gave out still works for the data API until the account is deleted.
  svc.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await realIssueTokens(input, init);
    if (res.status === 200 && String(input).includes("/auth/v1/token")) {
      const copy = await res.clone().json();
      if (typeof copy.access_token === "string") live.add(copy.access_token);
    }
    return res;
  }) as typeof fetch;
  // The data API, as the database's rules allow it for the one test user.
  function data(path: string, init: RequestInit, headers: Record<string, string>): Response {
    // As fetch does in a browser: a GET can't carry a body.
    if (init.method === "GET" && init.body !== undefined) throw new TypeError("Request with GET/HEAD method cannot have body.");
    if (svc.mode === "down") throw new TypeError("Failed to fetch");
    if (typeof svc.mode === "number") return new Response("{}", { status: svc.mode });
    const token = headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (headers.apikey !== KEY || !live.has(token) || !svc.profile) return new Response('{"message":"JWT invalid"}', { status: 401 });
    const reply = (body: unknown, status = 200) => {
      const b = svc.nextData !== undefined ? svc.nextData : body;
      svc.nextData = undefined;
      return new Response(status === 204 ? null : JSON.stringify(b), { status });
    };
    if (init.method === "GET" && path === "profiles?select=email_opt_in") return reply([{ email_opt_in: svc.profile.email_opt_in }]);
    if (init.method === "PATCH" && path.startsWith("profiles?id=eq.")) {
      if (decodeURIComponent(path.slice("profiles?id=eq.".length)) === USER.id && headers.prefer === "return=minimal") {
        svc.profile.email_opt_in = JSON.parse(String(init.body)).email_opt_in;
      }
      return reply(null, 204);
    }
    // PostgREST leaves the body out when asked for return=minimal.
    if (init.method === "POST" && path === "rpc/my_data" && headers.prefer === "return=minimal") return reply(null, 204);
    if (init.method === "POST" && path === "rpc/download_my_data" && !svc.oldData) {
      if (svc.dataWait) {
        const at = svc.dataWait;
        svc.dataWait = undefined;
        return reply({ status: "wait", retry_at: at });
      }
      return reply({ account: { id: USER.id, email: USER.email }, profile: svc.profile, plan: { plan: "free" }, data_downloads: [] });
    }
    if (init.method === "POST" && path === "rpc/my_data" && svc.oldData) return reply({ account: { id: USER.id, email: USER.email }, profile: svc.profile, plan: { plan: "free" } });
    if (init.method === "POST" && path === "rpc/delete_my_account") {
      svc.profile = undefined;
      svc.liveRefresh.clear();
      live.clear();
      return reply(null, 204);
    }
    return new Response("{}", { status: 404 });
  }
  return svc;
}

export function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** A seeded random-byte source (mulberry32), so every verifier is the same on every run. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      bytes[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
    }
  };
}
