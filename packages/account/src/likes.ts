// Likes on sharing links (community C7b): the requests behind the like button and count on an opened link
// (supabase/migrations/20261111170000_likes.sql). The database decides who may like what and keeps the daily cap; this only
// asks and checks that every answer has the shape the database promises. Who liked a design is never asked for: the
// database doesn't let anyone read it. The app keeps all of it behind the ?share switch with the rest of sharing.

import type { AuthClient } from "./auth.ts";
import type { DataResult } from "./data.ts";
import { isShareId } from "./shares.ts";

/** The limits, as the database keeps them (like_limits()). Checked there; here only to say them in words. */
export const LIKE_LIMITS = { changesPerDay: 300 } as const;

/** like_share's answers. Must match the migration's list. */
export const LIKE_ANSWERS = ["liked", "already", "gone", "own", "held", "daily", "off"] as const;
export type LikeAnswer = (typeof LIKE_ANSWERS)[number];
/** unlike_share's answers. Must match the migration's list. */
export const UNLIKE_ANSWERS = ["unliked", "not-liked", "daily"] as const;
export type UnlikeAnswer = (typeof UNLIKE_ANSWERS)[number];

const isLikeAnswer = (v: unknown): v is LikeAnswer => typeof v === "string" && (LIKE_ANSWERS as readonly string[]).includes(v);
const isUnlikeAnswer = (v: unknown): v is UnlikeAnswer => typeof v === "string" && (UNLIKE_ANSWERS as readonly string[]).includes(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** A refusal said in plain words (the answers that leave the like as it was). */
export const LIKE_WORDS: Readonly<Record<Exclude<LikeAnswer, "liked" | "already"> | "daily-unlike", string>> = {
  gone: "This design can't be liked: its link was turned off or taken down.",
  own: "You shared this design yourself, so you can't like it.",
  held: "Your account is on hold while the people who run SpindleLabs look at a report, so you can't like designs for now.",
  daily: `You've changed your likes ${LIKE_LIMITS.changesPerDay} times today. Try again tomorrow.`,
  "daily-unlike": `You've changed your likes ${LIKE_LIMITS.changesPerDay} times today. You can take this like back tomorrow.`,
  off: "Likes are switched off for now.",
};

const malformed = { kind: "failed", reason: "malformed" } as const;

export function likesApi(client: Pick<AuthClient, "asPerson" | "asAnyone">) {
  return {
    /** How many people like a link, for anyone; null when the link is off, taken down or never was, or sharing is off. */
    async count(id: string): Promise<DataResult<number | null>> {
      if (!isShareId(id)) return { kind: "ok", value: null };
      const r = await client.asAnyone("POST", "rpc/like_count", { p_id: id });
      if (r.kind !== "ok") return r;
      return r.body === null || isCount(r.body) ? { kind: "ok", value: r.body } : malformed;
    },

    /** Whether the signed-in person likes the link (false for one they can't open). */
    async mine(id: string): Promise<DataResult<boolean>> {
      if (!isShareId(id)) return { kind: "ok", value: false };
      const r = await client.asPerson("POST", "rpc/i_like", { p_id: id });
      if (r.kind !== "ok") return r;
      return typeof r.body === "boolean" ? { kind: "ok", value: r.body } : malformed;
    },

    /** Likes a link as the signed-in person. */
    async like(id: string): Promise<DataResult<LikeAnswer>> {
      if (!isShareId(id)) return { kind: "ok", value: "gone" };
      const r = await client.asPerson("POST", "rpc/like_share", { p_id: id });
      if (r.kind !== "ok") return r;
      return isLikeAnswer(r.body) ? { kind: "ok", value: r.body } : malformed;
    },

    /** Takes the signed-in person's like off a link. */
    async unlike(id: string): Promise<DataResult<UnlikeAnswer>> {
      if (!isShareId(id)) return { kind: "ok", value: "not-liked" };
      const r = await client.asPerson("POST", "rpc/unlike_share", { p_id: id });
      if (r.kind !== "ok") return r;
      return isUnlikeAnswer(r.body) ? { kind: "ok", value: r.body } : malformed;
    },
  };
}

export type LikesApi = ReturnType<typeof likesApi>;
