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
  /**
   * Runs `fn` holding the lock `name`, shared by every tab of this browser (navigator.locks.request when left out and
   * the browser has it). Given as undefined, or with no navigator.locks, renewals take no lock.
   */
  readonly lock?: (<T>(name: string, fn: () => Promise<T>) => Promise<T>) | undefined;
}

type LockFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** The browser's own cross-tab lock, or undefined where there is none (old browsers, Node). */
function browserLock(): LockFn | undefined {
  const locks = (globalThis as { navigator?: { locks?: { request?: (name: string, fn: () => Promise<unknown>) => Promise<unknown> } } }).navigator?.locks;
  if (typeof locks?.request !== "function") return undefined;
  return <T>(name: string, fn: () => Promise<T>) => locks.request!(name, fn) as Promise<T>;
}

export const SESSION_KEY = "spindle.account.session";
export const PENDING_KEY = "spindle.account.pending";
/** A token this close to running out (seconds) is refreshed before use, so it can't expire on the way to the service. */
export const REFRESH_MARGIN_S = 60;
/** A sign-in started longer ago than this (milliseconds) is refused when it comes back. */
export const PENDING_MAX_MS = 10 * 60 * 1000;
/** Most sign-ins kept started at once (two tabs, or Sign in pressed again after going back); the oldest goes first. */
export const PENDING_LIMIT = 3;
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

/** What signing out did at the service: `ended`, or why not (this browser is signed out either way). */
export type SignOutResult = { readonly ended: true } | { readonly ended: false; readonly reason: "offline" | "unavailable" | "rejected" };

type Reply = { ok: true; body: unknown } | { ok: false; reason: "offline" | "unavailable" | "rejected"; status?: number };

/** A renewal's answer: the new session (not yet stored), or why there is none. */
type Renewal = { ok: true; session: Session } | { ok: false; reason: "offline" | "unavailable" | "rejected" | "malformed" };

/** A sign-in started in this browser: its secret, and when (milliseconds). */
type Pending = { verifier: string; at: number };

/** How an error on the return from the sign-in page is reported (RFC 6749 section 4.1.2.1 names the errors). */
function returnError(error: string | null): "cancelled" | "unavailable" | "rejected" {
  if (error === "access_denied") return "cancelled"; // the person said no, or closed the page
  if (error === "server_error" || error === "temporarily_unavailable") return "unavailable";
  return "rejected";
}

/** The sign-in parameters Supabase adds to the return address; all are removed from the address afterwards. */
const RETURN_PARAMS = ["code", "error", "error_code", "error_description"];

export function authClient(deps: AuthDeps) {
  const { config, store } = deps;
  const nowS = () => deps.now() / 1000;
  /** Renewals on their way, by the refresh token they use: requests needing one at once share it (a refresh token works once). */
  const renewing = new Map<string, Promise<Renewal>>();
  const lock: LockFn | undefined = "lock" in deps ? deps.lock : browserLock();

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
    if (!res.ok) return { ok: false, reason: "rejected", status: res.status };
    // A body that is not JSON reads as undefined, which no caller takes for a session.
    return { ok: true, body: await res.json().catch(() => undefined) };
  }

  const client = {
    /**
     * A request to the service's data API as the signed-in person (`path` under /rest/v1/), with a token refreshed first
     * when needed. The database's row level security decides what it may read or change.
     */
    async asPerson(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<PersonReply> {
      return asPersonTo(method, `/rest/v1/${path}`, body, method === "PATCH" ? { prefer: "return=minimal" } : {});
    },

    /**
     * A request to the data API for something anyone may do (opening or reporting a sharing link): as the signed-in
     * person when there is one (so the database knows who reported), otherwise with the public key alone. Never
     * answers signed-out.
     */
    async asAnyone(method: "POST", path: string, body?: unknown): Promise<PersonReply> {
      const t = await client.accessToken();
      if (t.kind === "failed" && t.reason !== "offline" && t.reason !== "unavailable") return { kind: "failed", reason: t.reason };
      const reply = await request(method, `/rest/v1/${path}`, body ?? {}, t.kind === "ok" ? t.token : undefined);
      return reply.ok ? { kind: "ok", body: reply.body } : { kind: "failed", reason: reply.reason };
    },

    /**
     * A request to one of the service's server functions (`path` under /functions/v1/) as the signed-in person, token
     * refreshed first. The function checks the token itself.
     */
    async asPersonFunction(path: string, body?: unknown): Promise<PersonReply> {
      return asPersonTo("POST", `/functions/v1/${path}`, body, {});
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
        const started = [...pendingSignIns(), { verifier, at: deps.now() }].slice(-PENDING_LIMIT);
        if (!write(PENDING_KEY, JSON.stringify(started))) return undefined;
        const q = new URLSearchParams({ provider: "google", redirect_to: config.redirectTo, code_challenge: challenge, code_challenge_method: "s256" });
        return `${config.url}/auth/v1/authorize?${q}`;
      } catch {
        return undefined;
      }
    },

    /**
     * Finishes a sign-in when `pageUrl` is the return from the sign-in page. The return does not say which started
     * sign-in it belongs to, so each secret kept is tried, newest first, until the service takes one; the one taken is
     * removed. A refused return removes the secret only when it was the only one (it was surely that one's); others
     * stay until used or older than PENDING_MAX_MS. An error may come in the query or, as Supabase's redirect guide
     * says, in the # part. `cleanUrl` is the page address without the sign-in parameters, for history.replaceState,
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
      const inHash = new URLSearchParams(url.hash.slice(1));
      const hashError = inHash.get("error") || null; // the app's own pages (#design) carry no error
      const error = url.searchParams.get("error") ?? hashError;
      if (code === null && error === null) return { kind: "none" };
      for (const p of RETURN_PARAMS) url.searchParams.delete(p);
      if (hashError !== null) {
        for (const p of RETURN_PARAMS) inHash.delete(p);
        const rest = inHash.toString();
        url.hash = rest ? `#${rest}` : "";
      }
      const cleanUrl = url.href;
      const started = pendingSignIns();
      if (started.length === 1) remove(PENDING_KEY); // surely this return's: used once, whatever happens
      if (error !== null || !code) return { kind: "failed", reason: code === "" && error === null ? "cancelled" : returnError(error), cleanUrl };
      // No secret from this browser, or only stale ones: never send the code (a code from someone else's sign-in can't be used here).
      if (started.length === 0) {
        remove(PENDING_KEY);
        return { kind: "failed", reason: "expired", cleanUrl };
      }
      let failed: Failure = "rejected";
      for (const { verifier } of [...started].reverse()) {
        const reply = await post("/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
        if (!reply.ok) {
          failed = reply.reason;
          if (reply.reason === "rejected") continue; // not this one's code (or not a code at all): try the next
          break;
        }
        keepPendingSignIns(pendingSignIns().filter((p) => p.verifier !== verifier));
        const s = sessionFromReply(reply.body, nowS());
        if (!s) return { kind: "failed", reason: "malformed", cleanUrl };
        if (!write(SESSION_KEY, sessionToText(s))) return { kind: "failed", reason: "storage", cleanUrl };
        return { kind: "signed-in", user: s.user, cleanUrl };
      }
      return { kind: "failed", reason: failed, cleanUrl };
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
     * so its refresh token stops working. The service takes that only with a working access token, so one that ran out
     * (or is being renewed by another request) is renewed first, and the new session is never stored. `ended` says
     * whether the session is over at the service (it confirmed, or refused a renewal: the session can't go on); when
     * not, `reason` says why, and the refresh token may still work there. Other devices stay signed in.
     */
    async signOut(): Promise<SignOutResult> {
      const s = session();
      remove(SESSION_KEY);
      remove(PENDING_KEY);
      if (!s) return { ended: true };
      let access = s.accessToken;
      let renewed = false;
      const viaRenewal = async (): Promise<SignOutResult | undefined> => {
        const r = await renew(s, false); // this browser's copy is already removed: renew what was read
        renewed = true;
        if (r.ok) {
          access = r.session.accessToken;
          return undefined;
        }
        if (r.reason === "rejected") return { ended: true };
        return { ended: false, reason: r.reason === "malformed" ? "unavailable" : r.reason };
      };
      if (s.expiresAt - nowS() <= REFRESH_MARGIN_S || renewing.has(s.refreshToken)) {
        const done = await viaRenewal();
        if (done) return done;
      }
      let reply = await post("/auth/v1/logout?scope=local", {}, access);
      if (!reply.ok && reply.status === 401 && !renewed) {
        // The service's clock says the token ran out though this computer's didn't: renew once and ask again.
        const done = await viaRenewal();
        if (done) return done;
        reply = await post("/auth/v1/logout?scope=local", {}, access);
      }
      return reply.ok ? { ended: true } : { ended: false, reason: reply.reason };
    },
  };

  return client;

  /**
   * A working access token. `refused` is a token the service just refused (401): that one is renewed whatever its
   * expiry says. The renewal's answer is stored (by renew) only while the stored session is still exactly the one renewed;
   * otherwise (signed out meanwhile, another tab renewed, someone else signed in) it is dropped, and the stored session
   * is used instead only when it is the same person's.
   */
  async function token(mayRetry: boolean, refused?: string): Promise<TokenResult> {
    const s = session();
    if (!s) return { kind: "signed-out" };
    const good = refused === undefined ? s.expiresAt - nowS() > REFRESH_MARGIN_S : s.accessToken !== refused;
    if (good) return { kind: "ok", token: s.accessToken };
    const r = await renew(s);
    const renewedText = sessionToText(s);
    const stored = read(SESSION_KEY);
    const samePerson = () => mayRetry && session()?.user.id === s.user.id;
    if (!r.ok) {
      if (r.reason === "rejected") {
        // Only when the stored session is still the one refreshed: another tab may have refreshed it meanwhile.
        if (stored === renewedText) remove(SESSION_KEY);
        return samePerson() ? token(false) : { kind: "signed-out" };
      }
      return { kind: "failed", reason: r.reason };
    }
    // The renewal stored its answer over the session renewed (or another tab's answer was used).
    if (stored === sessionToText(r.session)) return { kind: "ok", token: r.session.accessToken };
    if (stored === renewedText) return { kind: "failed", reason: "storage" }; // this browser wouldn't keep it
    return samePerson() ? token(false) : { kind: "signed-out" };
  }

  /**
   * The renewal of `s`, shared with any request in this tab already renewing it. Its answer is not stored here. With a
   * lock, tabs renew one at a time per person; holding it, the stored session is read again (unless `fromStore` is
   * false): another tab that renewed meanwhile has stored a session with a new refresh token, which is then used as
   * the answer instead of renewing again (the old refresh token is used up). A stored session of another person, or
   * none, means there is nothing left to renew.
   */
  function renew(s: Session, fromStore = true): Promise<Renewal> {
    const already = renewing.get(s.refreshToken);
    if (already) return already;
    const ask = async (): Promise<Renewal> => {
      if (lock && fromStore) {
        const now = session();
        if (!now || now.user.id !== s.user.id) return { ok: false, reason: "rejected" };
        if (now.refreshToken !== s.refreshToken) return { ok: true, session: now };
      }
      const reply = await post("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refreshToken });
      if (!reply.ok) return { ok: false, reason: reply.reason };
      const next = sessionFromReply(reply.body, nowS());
      if (!next) return { ok: false, reason: "malformed" };
      // Stored still holding the lock, so the next tab's re-read sees it; only over exactly the session renewed.
      if (fromStore && read(SESSION_KEY) === sessionToText(s)) write(SESSION_KEY, sessionToText(next));
      return { ok: true, session: next };
    };
    const p = (async (): Promise<Renewal> => {
      if (!lock) return ask();
      try {
        return await lock(`spindle.account.renew.${s.user.id}`, ask);
      } catch {
        return ask(); // the lock itself failed (not the renewal, which never throws): renew without it
      }
    })();
    renewing.set(s.refreshToken, p);
    void p.then(() => renewing.delete(s.refreshToken));
    return p;
  }

  /** A request as the signed-in person; one refused as unauthorised (401) is renewed once and sent again. */
  async function asPersonTo(method: "GET" | "POST" | "PATCH", path: string, body: unknown, extra: Record<string, string>): Promise<PersonReply> {
    let t = await token(true);
    if (t.kind !== "ok") return t;
    let reply = await request(method, path, body ?? {}, t.token, extra);
    if (!reply.ok && reply.status === 401) {
      t = await token(true, t.token);
      if (t.kind !== "ok") return t;
      reply = await request(method, path, body ?? {}, t.token, extra);
    }
    return reply.ok ? { kind: "ok", body: reply.body } : { kind: "failed", reason: reply.reason };
  }

  /** The sign-ins started in this browser that may still come back (a damaged value, or an old one, counts as none). */
  function pendingSignIns(): Pending[] {
    const v = parseJson(read(PENDING_KEY));
    const list: unknown[] = Array.isArray(v) ? v : v !== null && typeof v === "object" ? [v] : []; // one object: kept before lists
    const now = deps.now();
    const live = list.filter((p): p is Pending => {
      const r = p as Partial<Pending> | null;
      return typeof r === "object" && r !== null && isVerifier(r.verifier) && typeof r.at === "number" && now - r.at >= 0 && now - r.at <= PENDING_MAX_MS;
    });
    return live.slice(-PENDING_LIMIT).map(({ verifier, at }) => ({ verifier, at }));
  }

  function keepPendingSignIns(list: Pending[]): void {
    if (list.length === 0) remove(PENDING_KEY);
    else write(PENDING_KEY, JSON.stringify(list));
  }
}

export type AuthClient = ReturnType<typeof authClient>;
