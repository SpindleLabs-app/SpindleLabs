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
  /** When set, the next successful reply's body is this instead. */
  nextBody?: unknown;
  /** Refresh tokens the service still accepts. */
  readonly liveRefresh: Set<string>;
  /** The service's clock, in seconds. */
  nowS: () => number;
  readonly loggedOut: string[];
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
        codes.delete(body.auth_code); // a code works once
        const hashed = createHash("sha256").update(String(body.code_verifier)).digest("base64url");
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
