// Optional sign-in with Google, through Supabase's auth service, with no
// library: four plain requests (RFC 7636 PKCE, then refresh and sign-out).
// Every function returns a result and never throws; with no network the app
// carries on exactly as before, signed in or not.

import type { AccountConfig } from "./config.ts";
import { challengeFor, isVerifier, newVerifier } from "./pkce.ts";
import { type AccountUser, parseJson, type Session, sessionFromReply, sessionFromText, sessionToText } from "./session.ts";

/** The part of localStorage the account code uses (localStorage itself in the browser). Any call may throw. */
export interface SmallStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AuthDeps {
  readonly config: AccountConfig;
  readonly fetch: typeof fetch;
  readonly store: SmallStore;
  /** Milliseconds since 1970. */
  readonly now: () => number;
  readonly random: (bytes: Uint8Array) => void;
}

export const SESSION_KEY = "spindle.account.session";
export const PENDING_KEY = "spindle.account.pending";
/** A token this close to running out (seconds) is refreshed before use, so it can't expire on the way to the service. */
export const REFRESH_MARGIN_S = 60;
/** A sign-in started longer ago than this (milliseconds) is refused when it comes back. */
export const PENDING_MAX_MS = 10 * 60 * 1000;
/** How long one request to the service may take (milliseconds). */
export const REQUEST_MS = 15_000;

export type AccountState = { readonly kind: "signed-out" } | { readonly kind: "signed-in"; readonly user: AccountUser };

/** Why a request to the service did not give a session. */
export type Failure =
  | "offline" // no answer at all (no network, or it took too long)
  | "unavailable" // the service answered with an error of its own (5xx, 429)
  | "rejected" // the service refused (a used or forged code, a revoked session)
  | "malformed" // the answer was not the shape the service promises
  | "storage"; // this browser would not keep the session

export type FinishResult =
  | { readonly kind: "none" } // the page was not a return from sign-in
  | { readonly kind: "signed-in"; readonly user: AccountUser; readonly cleanUrl: string }
  | { readonly kind: "failed"; readonly reason: Failure | "cancelled" | "expired"; readonly cleanUrl: string };

export type TokenResult =
  | { readonly kind: "ok"; readonly token: string }
  | { readonly kind: "signed-out" }
  | { readonly kind: "failed"; readonly reason: "offline" | "unavailable" | "malformed" | "storage" };

export type PersonReply =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "signed-out" }
  | { readonly kind: "failed"; readonly reason: "offline" | "unavailable" | "rejected" | "malformed" | "storage" };

type Reply = { ok: true; body: unknown } | { ok: false; reason: "offline" | "unavailable" | "rejected" };

/** The sign-in parameters Supabase adds to the return address; all are removed from the address afterwards. */
const RETURN_PARAMS = ["code", "error", "error_code", "error_description"];

export function authClient(deps: AuthDeps) {
  const { config, store } = deps;
  const nowS = () => deps.now() / 1000;

  function read(key: string): string | null {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  }
  function write(key: string, value: string): boolean {
    try {
      store.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  function remove(key: string): void {
    try {
      store.removeItem(key);
    } catch {
      // Nothing more can be done; the next read checks the value anyway.
    }
  }

  function session(): Session | undefined {
    const text = read(SESSION_KEY);
    const s = sessionFromText(text);
    if (!s) remove(SESSION_KEY); // damaged: drop it rather than keep failing on it (removing nothing does nothing)
    return s;
  }

  const post = (path: string, body: unknown, bearer?: string) => request("POST", path, body, bearer);

  async function request(method: "GET" | "POST" | "PATCH", path: string, body: unknown, bearer?: string, extra: Record<string, string> = {}): Promise<Reply> {
    const headers: Record<string, string> = { ...extra, apikey: config.anonKey, "content-type": "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    let res: Response;
    try {
      res = await deps.fetch(`${config.url}${path}`, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(body),
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_MS),
      });
    } catch {
      return { ok: false, reason: "offline" };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, reason: "unavailable" };
    if (!res.ok) return { ok: false, reason: "rejected" };
    // A body that is not JSON reads as undefined, which no caller takes for a session.
    return { ok: true, body: await res.json().catch(() => undefined) };
  }

  const client = {
    /**
     * A request to the service's data API as the signed-in person (`path` under /rest/v1/), with a token refreshed first
     * when needed. The database's row level security decides what it may read or change.
     */
    async asPerson(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<PersonReply> {
      const t = await client.accessToken();
      if (t.kind !== "ok") return t;
      const reply = await request(method, `/rest/v1/${path}`, body ?? {}, t.token, method === "PATCH" ? { prefer: "return=minimal" } : {});
      return reply.ok ? { kind: "ok", body: reply.body } : { kind: "failed", reason: reply.reason };
    },

    /** Forgets the session on this device without asking the service (after the account itself was deleted). */
    forget(): void {
      remove(SESSION_KEY);
      remove(PENDING_KEY);
    },

    /** Who is signed in, from this browser alone (no network). */
    state(): AccountState {
      const s = session();
      return s ? { kind: "signed-in", user: s.user } : { kind: "signed-out" };
    },

    /** The address of Google's sign-in page (through the service) to send the browser to, or undefined when this browser can't keep the sign-in's secret. */
    async beginSignIn(): Promise<string | undefined> {
      try {
        const verifier = newVerifier(deps.random);
        const challenge = await challengeFor(verifier);
        if (!write(PENDING_KEY, JSON.stringify({ verifier, at: deps.now() }))) return undefined;
        const q = new URLSearchParams({ provider: "google", redirect_to: config.redirectTo, code_challenge: challenge, code_challenge_method: "s256" });
        return `${config.url}/auth/v1/authorize?${q}`;
      } catch {
        return undefined;
      }
    },

    /**
     * Finishes a sign-in when `pageUrl` is the return from the sign-in page. The started sign-in's secret is used once and
     * removed, whatever happens. `cleanUrl` is the page address without the sign-in parameters, for history.replaceState,
     * so the code never stays in the address bar or history.
     */
    async finishSignIn(pageUrl: string): Promise<FinishResult> {
      let url: URL;
      try {
        url = new URL(pageUrl);
      } catch {
        return { kind: "none" };
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (code === null && error === null) return { kind: "none" };
      for (const p of RETURN_PARAMS) url.searchParams.delete(p);
      const cleanUrl = url.href;
      const pendingText = read(PENDING_KEY);
      remove(PENDING_KEY);
      if (error !== null || !code) return { kind: "failed", reason: "cancelled", cleanUrl };
      const pending = parseJson(pendingText) as { verifier?: unknown; at?: unknown } | null | undefined;
      const verifier = pending?.verifier;
      const at = pending?.at;
      const age = typeof at === "number" ? deps.now() - at : NaN;
      // No secret from this browser, or a stale one: never send the code (a code from someone else's sign-in can't be used here).
      if (!isVerifier(verifier) || !(age >= 0 && age <= PENDING_MAX_MS)) return { kind: "failed", reason: "expired", cleanUrl };
      const reply = await post("/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
      if (!reply.ok) return { kind: "failed", reason: reply.reason, cleanUrl };
      const s = sessionFromReply(reply.body, nowS());
      if (!s) return { kind: "failed", reason: "malformed", cleanUrl };
      if (!write(SESSION_KEY, sessionToText(s))) return { kind: "failed", reason: "storage", cleanUrl };
      return { kind: "signed-in", user: s.user, cleanUrl };
    },

    /**
     * A working access token for a request to the service, refreshed first when it runs out within REFRESH_MARGIN_S.
     * A refusal of the refresh means the session was ended elsewhere: this browser then signs out too. With no network
     * the session is kept for later.
     */
    accessToken(): Promise<TokenResult> {
      return token(true);
    },

    /**
     * Signs out of this browser at once (works offline), then asks the service to end this browser's session there too,
     * so its refresh token stops working. `ended` says whether the service confirmed; when it didn't, the access token
     * still runs out within the hour. Other devices stay signed in.
     */
    async signOut(): Promise<{ ended: boolean }> {
      const s = session();
      remove(SESSION_KEY);
      remove(PENDING_KEY);
      if (!s) return { ended: true };
      const reply = await post("/auth/v1/logout?scope=local", {}, s.accessToken);
      return { ended: reply.ok };
    },
  };

  return client;

  async function token(mayRetry: boolean): Promise<TokenResult> {
    const s = session();
    if (!s) return { kind: "signed-out" };
    if (s.expiresAt - nowS() > REFRESH_MARGIN_S) return { kind: "ok", token: s.accessToken };
    const reply = await post("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refreshToken });
    if (!reply.ok) {
      if (reply.reason === "rejected") {
        // Only when the stored session is still the one refreshed: another tab may have refreshed it meanwhile.
        if (read(SESSION_KEY) === sessionToText(s)) remove(SESSION_KEY);
        return mayRetry && session() ? token(false) : { kind: "signed-out" };
      }
      return { kind: "failed", reason: reply.reason };
    }
    const next = sessionFromReply(reply.body, nowS());
    if (!next) return { kind: "failed", reason: "malformed" };
    if (!write(SESSION_KEY, sessionToText(next))) return { kind: "failed", reason: "storage" };
    return { kind: "ok", token: next.accessToken };
  }
}

export type AuthClient = ReturnType<typeof authClient>;
