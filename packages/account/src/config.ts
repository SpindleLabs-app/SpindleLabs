// Where the account service lives. Accounts are optional: with no config the
// app has no sign-in at all, and nothing here is ever contacted.

export interface AccountConfig {
  /** The Supabase project's address, e.g. https://abcdefghijklmnopqrst.supabase.co */
  readonly url: string;
  /** The project's public ("anon") key. It is meant to be public; what each user may read is enforced by the database. */
  readonly anonKey: string;
  /** Where the sign-in page sends the browser back to: the app's own address. */
  readonly redirectTo: string;
}

/** Longest anon key accepted (Supabase's are a few hundred characters). */
export const MAX_KEY_LENGTH = 2000;

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** An address the account code may talk to: https, or http only on this computer (tests), with no user name, password, query or fragment. */
function safeOrigin(text: unknown): URL | undefined {
  if (typeof text !== "string" || text.length > 500) return undefined;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return undefined;
  }
  const httpOk = u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname));
  if (!httpOk || u.username || u.password || u.search || u.hash) return undefined;
  return u;
}

/**
 * Checks a config, returning it with the service address normalised (no trailing slash), or the reason it is refused.
 * The service must be a bare origin; the return address must be http(s) on the same rules and may have a path.
 */
export function checkConfig(c: unknown): { ok: true; config: AccountConfig } | { ok: false; reason: string } {
  if (typeof c !== "object" || c === null) return { ok: false, reason: "no account settings" };
  const { url, anonKey, redirectTo } = c as Record<string, unknown>;
  const service = safeOrigin(url);
  if (!service || service.pathname !== "/") return { ok: false, reason: "the account service address is not a plain https address" };
  if (typeof anonKey !== "string" || anonKey.length === 0 || anonKey.length > MAX_KEY_LENGTH || /\s/.test(anonKey)) {
    return { ok: false, reason: "the account service key is missing or malformed" };
  }
  const back = safeOrigin(redirectTo);
  if (!back) return { ok: false, reason: "the return address is not a plain https address" };
  return { ok: true, config: { url: service.origin, anonKey, redirectTo: back.href } };
}
