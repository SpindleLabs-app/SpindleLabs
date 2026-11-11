// The display name (community C6b): the one thing a profile shows. The database (supabase/migrations/20261111130000_display_names.sql)
// decides what a name may be, who has it and when it may change; this asks, checks the answers have the shape the database
// promises, and says each refusal in words. Nothing here is needed for CAD or saving.

import type { AuthClient } from "./auth.ts";
import type { DataResult } from "./data.ts";

/** The limits, as display_name_limits() gives them. Checked against the migration by test/names.test.ts. */
export const NAME_LIMITS = { minLength: 3, maxLength: 30, changeGapSeconds: 604_800 } as const;

/** What set_display_name answers; never raises for these. */
export const NAME_ANSWERS = ["saved", "bad", "blocked", "taken", "held", "too-soon"] as const;
export type NameAnswer = (typeof NAME_ANSWERS)[number];

export interface MyName {
  readonly name: string;
  readonly changedAt: Date;
  /** The first moment the name may change again. */
  readonly nextChangeAt: Date;
}

function time(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function myNameFrom(v: unknown): MyName | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const changedAt = time(r.changed_at);
  const nextChangeAt = time(r.next_change_at);
  if (typeof r.name !== "string" || !changedAt || !nextChangeAt) return null;
  return { name: r.name, changedAt, nextChangeAt };
}

/** The day, spelled out so nobody reads 03/04 the wrong way round: "18 Nov 2026" (in `timeZone`, the browser's when left out). */
export function nameDate(d: Date, timeZone?: string): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", ...(timeZone ? { timeZone } : {}) });
}

/** Each answer in plain words. `next` is when the name may change again (for "too-soon"). */
export function nameWords(answer: Exclude<NameAnswer, "saved">, next?: Date | null): string {
  switch (answer) {
    case "bad":
      return `Use ${NAME_LIMITS.minLength} to ${NAME_LIMITS.maxLength} letters, digits, spaces, dots, dashes or underscores, from one writing system, starting and ending with a letter or digit.`;
    case "blocked":
      return "That name can't be used. Please pick another.";
    case "taken":
      return "Someone already has that name, or one that looks the same. Please pick another.";
    case "held":
      return "Your account is on hold, so the name can't change right now.";
    case "too-soon":
      return next ? `You changed your name recently. You can change it again on ${nameDate(next)}.` : "You changed your name recently. You can change it once a week.";
  }
}

export function namesApi(client: Pick<AuthClient, "asPerson">) {
  return {
    /** The person's name and when it may change; `null` when they have none yet. */
    async mine(): Promise<DataResult<MyName | null>> {
      const r = await client.asPerson("POST", "rpc/my_display_name");
      if (r.kind !== "ok") return r;
      if (r.body === null || r.body === undefined) return { kind: "ok", value: null };
      const m = myNameFrom(r.body);
      return m ? { kind: "ok", value: m } : { kind: "failed", reason: "malformed" };
    },

    /** Asks for `name`; the database answers one of NAME_ANSWERS (trimming is the person's job: spaces at the ends are "bad"). */
    async set(name: string): Promise<DataResult<NameAnswer>> {
      const r = await client.asPerson("POST", "rpc/set_display_name", { p_name: name });
      if (r.kind !== "ok") return r;
      return typeof r.body === "string" && (NAME_ANSWERS as readonly string[]).includes(r.body) ? { kind: "ok", value: r.body as NameAnswer } : { kind: "failed", reason: "malformed" };
    },
  };
}

export type NamesApi = ReturnType<typeof namesApi>;
