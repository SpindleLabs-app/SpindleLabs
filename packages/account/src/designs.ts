// My designs: the requests behind copies of a person's designs kept in their account
// (supabase/migrations/20261105120000_my_designs.sql). The database decides what each request may touch; this only
// asks and checks that every answer has the shape the database promises. Nothing here runs unless the person is
// signed in and keeping designs in their account is on.

import type { AuthClient } from "./auth.ts";
import type { DataResult } from "./data.ts";

/** The workspaces a design can come from: the tag on My designs. Must match the database's own list. */
export const SOURCES = ["design", "render", "simulate", "manufacture", "laser", "slice", "circuit", "vector", "image", "layout"] as const;
export type Source = (typeof SOURCES)[number];
export const isSource = (s: unknown): s is Source => typeof s === "string" && (SOURCES as readonly string[]).includes(s);

/** The limits, as the database keeps them (design_limits()). Checked there; here only to say them in words. */
export const LIMITS = { maxDesigns: 200, maxBytes: 20 * 1024 * 1024, maxDesignBytes: 5 * 1024 * 1024, maxPictureBytes: 32 * 1024 } as const;

/** One design in the account, as My designs lists it (no file text). */
export interface DesignRow {
  readonly id: string;
  readonly name: string;
  readonly source: Source;
  /** A data: address of a small picture, or null. */
  readonly picture: string | null;
  readonly bytes: number;
  /** When it was saved on the device it came from. */
  readonly savedAt: Date;
  /** When it reached the account. */
  readonly updatedAt: Date;
  readonly revision: number;
}

export interface DesignFile {
  readonly id: string;
  readonly name: string;
  readonly source: Source;
  readonly body: string;
  readonly savedAt: Date;
  readonly revision: number;
}

export interface SaveDesign {
  /** The account's id for it, or null to add a new design. */
  readonly id: string | null;
  /** The revision this device last saw (ignored when adding). */
  readonly expected: number | null;
  readonly name: string;
  readonly source: Source;
  readonly body: string;
  /** A new picture, or null to keep the one it has. */
  readonly picture: string | null;
  readonly savedAt: Date;
}

export type SaveAnswer =
  | { readonly status: "saved"; readonly id: string; readonly revision: number }
  | { readonly status: "changed"; readonly revision: number }
  | { readonly status: "gone" | "too-big" | "full" | "off" };

export interface Space {
  readonly designs: number;
  readonly bytes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PICTURE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isRevision = (v: unknown): v is number => isCount(v) && v >= 1;
function time(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A listed design, or null when the row isn't the shape the database gives. */
export function rowFrom(v: unknown): DesignRow | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const savedAt = time(r.saved_at);
  const updatedAt = time(r.updated_at);
  if (!isId(r.id) || typeof r.name !== "string" || !isSource(r.source) || !isCount(r.bytes) || !isRevision(r.revision) || !savedAt || !updatedAt) return null;
  if (r.picture !== null && !(typeof r.picture === "string" && PICTURE.test(r.picture))) return null;
  return { id: r.id, name: r.name, source: r.source, picture: r.picture, bytes: r.bytes, savedAt, updatedAt, revision: r.revision };
}

export function saveAnswerFrom(v: unknown): SaveAnswer | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.status === "saved") return isId(r.id) && isRevision(r.revision) ? { status: "saved", id: r.id, revision: r.revision } : null;
  if (r.status === "changed") return isRevision(r.revision) ? { status: "changed", revision: r.revision } : null;
  if (r.status === "gone" || r.status === "too-big" || r.status === "full" || r.status === "off") return { status: r.status };
  return null;
}

const malformed = { kind: "failed", reason: "malformed" } as const;

export function designsApi(client: AuthClient) {
  return {
    /** The person's designs, newest first. */
    async list(): Promise<DataResult<DesignRow[]>> {
      const r = await client.asPerson("POST", "rpc/my_designs");
      if (r.kind !== "ok") return r;
      if (!Array.isArray(r.body)) return malformed;
      const rows = r.body.map(rowFrom);
      return rows.every((x): x is DesignRow => x !== null) ? { kind: "ok", value: rows } : malformed;
    },

    /** One design with its file text; null when the account has no such design (deleted, maybe on another device). */
    async get(id: string): Promise<DataResult<DesignFile | null>> {
      if (!isId(id)) return { kind: "ok", value: null };
      const r = await client.asPerson("POST", "rpc/get_design", { p_id: id });
      if (r.kind !== "ok") return r;
      if (r.body === null) return { kind: "ok", value: null };
      const b = r.body as Record<string, unknown> | undefined;
      const savedAt = time(b?.saved_at);
      if (typeof b !== "object" || b === null || b.id !== id || typeof b.name !== "string" || !isSource(b.source) || typeof b.body !== "string" || !isRevision(b.revision) || !savedAt) return malformed;
      return { kind: "ok", value: { id, name: b.name, source: b.source, body: b.body, savedAt, revision: b.revision } };
    },

    async save(d: SaveDesign): Promise<DataResult<SaveAnswer>> {
      const r = await client.asPerson("POST", "rpc/save_design", {
        p_id: d.id,
        p_expected: d.id === null ? null : d.expected,
        p_name: d.name.slice(0, 200),
        p_source: d.source,
        p_body: d.body,
        p_picture: d.picture,
        p_saved_at: d.savedAt.toISOString(),
      });
      if (r.kind !== "ok") return r;
      const a = saveAnswerFrom(r.body);
      return a ? { kind: "ok", value: a } : malformed;
    },

    /** Deletes one design from the account; false when it was already gone. */
    async remove(id: string): Promise<DataResult<boolean>> {
      if (!isId(id)) return { kind: "ok", value: false };
      const r = await client.asPerson("POST", "rpc/delete_design", { p_id: id });
      if (r.kind !== "ok") return r;
      return typeof r.body === "boolean" ? { kind: "ok", value: r.body } : malformed;
    },

    /** Deletes every design in the account; how many went. */
    async removeAll(): Promise<DataResult<number>> {
      const r = await client.asPerson("POST", "rpc/delete_my_designs");
      if (r.kind !== "ok") return r;
      return isCount(r.body) ? { kind: "ok", value: r.body } : malformed;
    },

    async space(): Promise<DataResult<Space>> {
      const r = await client.asPerson("POST", "rpc/my_design_space");
      if (r.kind !== "ok") return r;
      const b = r.body as Record<string, unknown> | null;
      return b && isCount(b.designs) && isCount(b.bytes) ? { kind: "ok", value: { designs: b.designs, bytes: b.bytes } } : malformed;
    },

    /** Whether keeping designs in the account is on (it is unless the person turned it off, on any device). */
    async keeping(): Promise<DataResult<boolean>> {
      const r = await client.asPerson("GET", "profiles?select=keep_designs");
      if (r.kind !== "ok") return r;
      const rows = r.body;
      return Array.isArray(rows) && rows.length === 1 && typeof rows[0]?.keep_designs === "boolean" ? { kind: "ok", value: rows[0].keep_designs } : malformed;
    },

    async setKeeping(yes: boolean): Promise<DataResult<boolean>> {
      const state = client.state();
      if (state.kind !== "signed-in") return { kind: "signed-out" };
      const r = await client.asPerson("PATCH", `profiles?id=eq.${encodeURIComponent(state.user.id)}`, { keep_designs: yes === true });
      return r.kind === "ok" ? { kind: "ok", value: yes === true } : r;
    },
  };
}

export type DesignsApi = ReturnType<typeof designsApi>;
