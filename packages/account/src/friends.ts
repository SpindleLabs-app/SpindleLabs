// Friends by profile ID (account features 6). The database (supabase/migrations/20261113180000_friends.sql) decides
// everything: who has an ID, who may ask whom, what each person sees. This asks, checks every answer has the shape
// the database promises, and says each answer in plain words. Nobody can be searched for or suggested: the only way
// to reach a person is their exact ID. Nothing here is needed for CAD or saving.

import type { AuthClient } from "./auth.ts";
import type { DataResult } from "./data.ts";

/** The limits, as friends_limits() gives them. Checked against the migration by test/friends.test.ts. */
export const FRIENDS_LIMITS = { maxFriends: 200, maxWaiting: 20, triesADay: 20, requestDays: 30, codeLength: 10 } as const;

/** The 32 characters an ID is made of (Crockford's base 32: no I, L, O or U). */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** What send_friend_request answers; never raises for these. */
export const ASK_ANSWERS = ["sent", "friends", "waiting", "already", "self", "not-found", "bad", "blocked", "off", "held", "too-many", "full"] as const;
export type AskAnswer = (typeof ASK_ANSWERS)[number];

/** What set_friends answers. */
export const TURN_ANSWERS = ["on", "off", "no-name", "held"] as const;
export type TurnAnswer = (typeof TURN_ANSWERS)[number];

/** What accept_friend_request answers. */
export const ACCEPT_ANSWERS = ["friends", "gone", "full"] as const;
export type AcceptAnswer = (typeof ACCEPT_ANSWERS)[number];

/** A friend: their display name (null when they have none now) and since when. `id` is the friendship's. */
export interface Friend {
  readonly id: string;
  readonly name: string | null;
  readonly since: Date;
}
/** A request to the person: the asker's display name only. */
export interface AskingMe {
  readonly id: string;
  readonly name: string | null;
  readonly sentAt: Date;
}
/** A request the person sent: only the ID they typed, never whose it is. */
export interface IAsked {
  readonly id: string;
  readonly code: string;
  readonly sentAt: Date;
}
export interface Blocked {
  readonly id: string;
  readonly name: string | null;
  readonly since: Date;
}
export interface MyFriends {
  readonly on: boolean;
  /** The person's ID, as kept (10 characters), or null when Friends is off. */
  readonly code: string | null;
  readonly friends: readonly Friend[];
  readonly askingMe: readonly AskingMe[];
  readonly iAsked: readonly IAsked[];
  readonly blocked: readonly Blocked[];
  readonly triesLeft: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEPT_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * An ID as typed, the way the database keeps it, or null when it can't be one (friend_code_key): spaces and dashes
 * dropped, capitals, O read as 0 and I or L as 1. The database decides again; this only lets the dialog say "that
 * isn't an ID" without a request.
 */
export function friendCodeKey(typed: string): string | null {
  const k = typed.replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return KEPT_CODE.test(k) ? k : null;
}

/** An ID as shown: two groups of five, "7KX2M-QD9TA", easier to read out and copy. */
export function friendCodeShown(code: string): string {
  return code.length === FRIENDS_LIMITS.codeLength ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

function time(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isName = (v: unknown): v is string | null => v === null || typeof v === "string";

function rows<T>(v: unknown, keys: readonly string[], each: (r: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const r = item as Record<string, unknown>;
    // Exactly the keys the database promises: an extra one (say, an account ID) is refused, not passed on.
    if (Object.keys(r).length !== keys.length || !keys.every((k) => k in r)) return null;
    const t = each(r);
    if (t === null) return null;
    out.push(t);
  }
  return out;
}

/** my_friends' answer checked whole, or null. */
export function myFriendsFrom(v: unknown): MyFriends | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.on !== "boolean") return null;
  if (!(r.code === null || (typeof r.code === "string" && KEPT_CODE.test(r.code))) || (r.code === null) === r.on) return null;
  if (typeof r.tries_left !== "number" || !Number.isInteger(r.tries_left) || r.tries_left < 0 || r.tries_left > FRIENDS_LIMITS.triesADay) return null;
  const friends = rows(r.friends, ["id", "name", "since"], (x) => {
    const since = time(x.since);
    return isId(x.id) && isName(x.name) && since ? { id: x.id, name: x.name, since } : null;
  });
  const askingMe = rows(r.asking_me, ["id", "name", "sent_at"], (x) => {
    const sentAt = time(x.sent_at);
    return isId(x.id) && isName(x.name) && sentAt ? { id: x.id, name: x.name, sentAt } : null;
  });
  const iAsked = rows(r.i_asked, ["id", "code", "sent_at"], (x) => {
    const sentAt = time(x.sent_at);
    return isId(x.id) && typeof x.code === "string" && KEPT_CODE.test(x.code) && sentAt ? { id: x.id, code: x.code, sentAt } : null;
  });
  const blocked = rows(r.blocked, ["id", "name", "since"], (x) => {
    const since = time(x.since);
    return isId(x.id) && isName(x.name) && since ? { id: x.id, name: x.name, since } : null;
  });
  if (!friends || !askingMe || !iAsked || !blocked) return null;
  return { on: r.on, code: r.code as string | null, friends, askingMe, iAsked, blocked, triesLeft: r.tries_left };
}

/** Each answer to a request, in plain words. */
export function askWords(answer: AskAnswer): string {
  switch (answer) {
    case "sent":
      return "Request sent. You'll see them in your friends once they say yes.";
    case "friends":
      return "They had already asked you, so you're friends now.";
    case "waiting":
      return "You've already asked them. It's waiting for their answer.";
    case "already":
      return "You're already friends.";
    case "self":
      return "That's your own profile ID.";
    case "not-found":
      return "Nobody has that profile ID. Check it with them: IDs can be changed.";
    case "bad":
      return `A profile ID is ${FRIENDS_LIMITS.codeLength} letters and digits, like 7KX2M-QD9TA.`;
    case "blocked":
      return "You've blocked this person. Unblock them first.";
    case "off":
      return "Turn on Friends first.";
    case "held":
      return "Your account is on hold, so you can't send requests right now.";
    case "too-many":
      return `You can type ${FRIENDS_LIMITS.triesADay} profile IDs a day. Try again tomorrow.`;
    case "full":
      return `You can have ${FRIENDS_LIMITS.maxFriends} friends and ${FRIENDS_LIMITS.maxWaiting} requests waiting. Remove one or take a request back first.`;
  }
}

/** Each refusal to turn Friends on, in plain words. */
export function turnWords(answer: Exclude<TurnAnswer, "on" | "off">): string {
  return answer === "no-name"
    ? "Friends needs a display name, because that's what people see when you ask them. Pick one above first."
    : "Your account is on hold, so Friends can't be turned on right now.";
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

export function friendsApi(client: Pick<AuthClient, "asPerson">) {
  async function call<T>(path: string, body: Record<string, unknown> | undefined, read: (b: unknown) => T | null): Promise<DataResult<T>> {
    const r = await client.asPerson("POST", `rpc/${path}`, body);
    if (r.kind !== "ok") return r;
    const v = read(r.body);
    return v === null ? { kind: "failed", reason: "malformed" } : { kind: "ok", value: v };
  }
  const yesNo = (b: unknown) => (typeof b === "boolean" ? b : null);
  return {
    /** Everything Friends shows the person. */
    read: () => call("my_friends", undefined, myFriendsFrom),
    /** Turns Friends on (an ID made) or off (ID, friends and requests deleted; blocks kept). */
    turn: (on: boolean) => call("set_friends", { p_on: on }, (b) => (oneOf(TURN_ANSWERS, b) ? b : null)),
    /** A fresh ID in place of the old one; null when Friends is off. */
    newCode: () => call("new_friend_code", undefined, (b) => (b === null ? { code: null } : typeof b === "string" && KEPT_CODE.test(b) ? { code: b } : null)),
    /** Asks the person whose ID is `typed` (as typed: the database reads it the way friendCodeKey does). */
    ask: (typed: string) => call("send_friend_request", { p_code: typed }, (b) => (oneOf(ASK_ANSWERS, b) ? b : null)),
    accept: (id: string) => call("accept_friend_request", { p_id: id }, (b) => (oneOf(ACCEPT_ANSWERS, b) ? b : null)),
    decline: (id: string) => call("decline_friend_request", { p_id: id }, yesNo),
    cancel: (id: string) => call("cancel_friend_request", { p_id: id }, yesNo),
    remove: (id: string) => call("remove_friend", { p_id: id }, yesNo),
    /** Blocks the other person of a friendship or of a request to the person, by that row's id. */
    block: (id: string) => call("block_friend", { p_id: id }, yesNo),
    unblock: (id: string) => call("unblock_friend", { p_id: id }, yesNo),
  };
}

export type FriendsApi = ReturnType<typeof friendsApi>;
