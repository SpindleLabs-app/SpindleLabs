// The signed-in session kept in this browser, and the checks on everything
// the account service sends back. Nothing from the network is trusted: a
// reply of the wrong shape is refused, never half-used.

/** What the app keeps about the person signed in: no picture, nothing else from their Google account. */
export interface AccountUser {
  readonly id: string;
  readonly email: string;
  /** Their name as Google gives it, cut to NAME_MAX characters; empty when there is none. */
  readonly name: string;
}

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** When the access token stops working, in seconds since 1970 (the service's own unit). */
  readonly expiresAt: number;
  readonly user: AccountUser;
}

export const NAME_MAX = 100;
const TOKEN_MAX = 8000;
const EMAIL_MAX = 320; // RFC 5321: 64 + 1 + 255

function token(v: unknown): string | undefined {
  return typeof v === "string" && v.length <= TOKEN_MAX && !/\s/.test(v) ? v : undefined;
}

function user(v: unknown): AccountUser | undefined {
  if (v === null || v === undefined) return undefined;
  const r = v as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== "string" || !/^[0-9a-fA-F-]{1,64}$/.test(id)) return undefined;
  const email = typeof r.email === "string" && r.email.length <= EMAIL_MAX ? r.email : "";
  const meta = (r.user_metadata ?? {}) as Record<string, unknown>;
  const raw = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : "";
  // Control and direction-changing characters could spoof the UI; drop them before cutting the length.
  const name = [...raw.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim()].slice(0, NAME_MAX).join("");
  return { id, email, name };
}

/**
 * The session in a token reply from the service, or undefined when the reply is not one.
 * `nowS` is the time now in seconds, used when the reply gives only `expires_in`.
 */
export function sessionFromReply(reply: unknown, nowS: number): Session | undefined {
  if (reply === null || reply === undefined) return undefined;
  const r = reply as Record<string, unknown>;
  const accessToken = token(r.access_token);
  const refreshToken = token(r.refresh_token);
  const u = user(r.user);
  let expiresAt: number | undefined;
  if (Number.isFinite(r.expires_at)) expiresAt = r.expires_at as number;
  else if (Number.isFinite(r.expires_in) && (r.expires_in as number) >= 0) expiresAt = nowS + (r.expires_in as number);
  if (!accessToken || !refreshToken || !u || expiresAt === undefined) return undefined;
  return { accessToken, refreshToken, expiresAt, user: u };
}

/** `text` read as JSON, or undefined when it is not JSON (or not a string). */
export function parseJson(text: string | null | undefined): unknown {
  try {
    return JSON.parse(text as string);
  } catch {
    return undefined;
  }
}

const VERSION = 1;

export function sessionToText(s: Session): string {
  return JSON.stringify({ v: VERSION, accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt, user: s.user });
}

/** The session stored as `text`, or undefined when it is missing or damaged (a damaged one is never half-used). */
export function sessionFromText(text: string | null | undefined): Session | undefined {
  const r = parseJson(text) as Record<string, unknown> | null | undefined;
  const u = r?.user as Record<string, unknown> | null | undefined;
  const s = sessionFromReply({ access_token: r?.accessToken, refresh_token: r?.refreshToken, expires_at: r?.expiresAt, user: u == null ? u : { id: u.id, email: u.email, user_metadata: { full_name: u.name } } }, 0);
  // Only exactly what sessionToText wrote is read back: another version, or a value changed by hand, is refused whole.
  return s && sessionToText(s) === text ? s : undefined;
}
