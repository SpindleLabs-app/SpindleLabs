// Sharing links (community C2): the requests behind a frozen copy of a design that anyone with its link can open
// (supabase/migrations/20261111120000_shares.sql). The database decides who may do what; this only asks and checks that
// every answer has the shape the database promises. The app keeps all of it behind the ?share switch until its legal check.

import type { AuthClient } from "./auth.ts";
import type { DataResult } from "./data.ts";

/** The limits, as the database keeps them (share_limits()). Checked there; here only to say them in words. */
export const SHARE_LIMITS = { maxLinks: 50, maxBytes: 20 * 1024 * 1024, maxShareBytes: 5 * 1024 * 1024, maxPictureBytes: 32 * 1024, linksPerDay: 20, reportsPerPerson: 5, reportsPerLink: 200, maxReason: 1000 } as const;

/** The reasons a report can give. Must match the database's own list. */
export const REPORT_KINDS = ["copied", "weapon", "sexual", "hateful", "illegal", "not-a-design", "personal-info", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const isReportKind = (k: unknown): k is ReportKind => typeof k === "string" && (REPORT_KINDS as readonly string[]).includes(k);

/** A link as its owner sees it (no file text). */
export interface ShareRow {
  readonly id: string;
  readonly name: string;
  readonly picture: string | null;
  readonly bytes: number;
  readonly createdAt: Date;
  /** Set when the people who run SpindleLabs took it down after a report. */
  readonly removedAt: Date | null;
}

/** What opening a link gives. Never says who shared it. */
export interface OpenedShare {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly picture: string | null;
  readonly createdAt: Date;
}

export type ShareAnswer =
  | { readonly status: "shared"; readonly id: string; readonly createdAt: Date }
  | { readonly status: "too-big" | "full" | "daily" };

export type ReportAnswer = "kept" | "gone" | "enough" | "bad";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PICTURE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export const isShareId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isPicture = (v: unknown): v is string | null => v === null || (typeof v === "string" && PICTURE.test(v));
function time(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function shareRowFrom(v: unknown): ShareRow | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const createdAt = time(r.created_at);
  const removedAt = r.removed_at === null ? null : time(r.removed_at);
  if (!isShareId(r.id) || typeof r.name !== "string" || !isPicture(r.picture) || !isCount(r.bytes) || !createdAt || (r.removed_at !== null && !removedAt)) return null;
  return { id: r.id, name: r.name, picture: r.picture, bytes: r.bytes, createdAt, removedAt };
}

export function shareAnswerFrom(v: unknown): ShareAnswer | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.status === "shared") {
    const createdAt = time(r.created_at);
    return isShareId(r.id) && createdAt ? { status: "shared", id: r.id, createdAt } : null;
  }
  if (r.status === "too-big" || r.status === "full" || r.status === "daily") return { status: r.status };
  return null;
}

const malformed = { kind: "failed", reason: "malformed" } as const;

export function sharesApi(client: AuthClient) {
  return {
    /** Makes a link to a frozen copy of `body` (a project file's text) with an optional small picture. */
    async share(name: string, body: string, picture: string | null): Promise<DataResult<ShareAnswer>> {
      const r = await client.asPerson("POST", "rpc/share_design", { p_name: name.slice(0, 200), p_body: body, p_picture: picture });
      if (r.kind !== "ok") return r;
      const a = shareAnswerFrom(r.body);
      return a ? { kind: "ok", value: a } : malformed;
    },

    /** The copy behind a link, for anyone; null when the link is off, taken down or was never made. */
    async open(id: string): Promise<DataResult<OpenedShare | null>> {
      if (!isShareId(id)) return { kind: "ok", value: null };
      const r = await client.asAnyone("POST", "rpc/open_share", { p_id: id });
      if (r.kind !== "ok") return r;
      if (r.body === null) return { kind: "ok", value: null };
      const b = r.body as Record<string, unknown> | undefined;
      const createdAt = time(b?.created_at);
      if (typeof b !== "object" || b === null || b.id !== id || typeof b.name !== "string" || typeof b.body !== "string" || !isPicture(b.picture) || !createdAt) return malformed;
      return { kind: "ok", value: { id, name: b.name, body: b.body, picture: b.picture, createdAt } };
    },

    /** The person's links that are on, newest first. */
    async list(): Promise<DataResult<ShareRow[]>> {
      const r = await client.asPerson("POST", "rpc/my_shares");
      if (r.kind !== "ok") return r;
      if (!Array.isArray(r.body)) return malformed;
      const rows = r.body.map(shareRowFrom);
      return rows.every((x): x is ShareRow => x !== null) ? { kind: "ok", value: rows } : malformed;
    },

    /** Turns a link off for good; false when it was already off or isn't the person's. */
    async unshare(id: string): Promise<DataResult<boolean>> {
      if (!isShareId(id)) return { kind: "ok", value: false };
      const r = await client.asPerson("POST", "rpc/unshare", { p_id: id });
      if (r.kind !== "ok") return r;
      return typeof r.body === "boolean" ? { kind: "ok", value: r.body } : malformed;
    },

    /** Reports a link, signed in or not. */
    async report(id: string, kind: ReportKind, reason: string): Promise<DataResult<ReportAnswer>> {
      if (!isShareId(id)) return { kind: "ok", value: "gone" };
      const r = await client.asAnyone("POST", "rpc/report_share", { p_id: id, p_kind: kind, p_reason: reason });
      if (r.kind !== "ok") return r;
      return r.body === "kept" || r.body === "gone" || r.body === "enough" || r.body === "bad" ? { kind: "ok", value: r.body } : malformed;
    },
  };
}

export type SharesApi = ReturnType<typeof sharesApi>;
