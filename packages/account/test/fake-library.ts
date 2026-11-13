// An in-memory library answering as supabase/migrations/20261112030000_library.sql and its Storage bucket do (same
// answers, limits and policies; the SQL itself is checked on a real PostgreSQL by supabase/test/test_library.py).
// Storage is faked from its published behaviour: a private bucket, a 5 MiB file limit (413), no overwrite (409), policies
// that hide what a person may not see (404 "Object not found" as Storage's older 400 answers carry it), signed links
// that run out, and the bulk delete answering the objects it deleted. Times are kept to the microsecond as PostgreSQL
// writes them, so a cursor rounded to milliseconds would be caught.

import type { AuthClient, FileReply, PersonReply, StorageBody, StorageReply } from "../src/auth.ts";
import { LIBRARY_LIMITS, LICENCES } from "../src/library.ts";

export interface EntryFake {
  id: string;
  user: string;
  title: string;
  description: string;
  licence: string;
  tags: string[];
  picture: string | null;
  state: "uploading" | "live" | "off";
  fileBytes: number | null;
  /** Microseconds since 1970. */
  createdAt: number;
  publishedAt: number | null;
  offAt: number | null;
  removedAt: number | null;
}

export interface FakeLibrary {
  entries: EntryFake[];
  /** The bucket: file name -> its text (and whether Storage wrote its size into the metadata). */
  objects: Map<string, { text: string; sized: boolean }>;
  held: Set<string>;
  names: Map<string, string>;
  sharingOn: boolean;
  /** Whether Storage writes metadata.size (the unknown finish_publish relies on; false: every finish says missing). */
  writesSize: boolean;
  /** "missing": the migration isn't applied (every library call is refused, as PostgREST's 404). */
  mode: "up" | "down" | "missing";
  /** Microseconds since 1970; every call moves it on by `tick`. */
  clock: number;
  tick: number;
  calls: string[];
  /** When set, the next Storage reply is this instead (the request still happens). */
  nextStorage?: StorageReply;
  /** When set, the next data reply's body is this instead. */
  nextBody?: { path: string; body: unknown };
  as(user: string | null): Pick<AuthClient, "asPerson" | "asAnyone" | "asPersonStorage" | "getSignedFile" | "state">;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PICTURE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const chars = (s: string) => [...s].length;

/** PostgreSQL's text for a timestamptz in jsonb: microseconds, trailing zeros dropped, "+00:00". */
export function pgTime(us: number): string {
  const ms = Math.floor(us / 1000);
  const base = new Date(ms).toISOString().slice(0, 19);
  const frac = String(us % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${base}${frac ? `.${frac}` : ""}+00:00`;
}

export function fakeLibrary(seed = 1): FakeLibrary {
  let n = seed * 1000;
  const uuid = () => `20000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`;
  let signed = 0;
  const links = new Map<string, { file: string; until: number }>(); // token -> file, until (us)
  const s: FakeLibrary = {
    entries: [],
    objects: new Map(),
    held: new Set(),
    names: new Map(),
    sharingOn: true,
    writesSize: true,
    mode: "up",
    clock: Date.UTC(2026, 10, 12, 3) * 1000,
    tick: 1_234,
    calls: [],
    as(user) {
      const now = () => (s.clock += s.tick);
      const day = 86_400_000_000;
      const hour = LIBRARY_LIMITS.uploadMinutes * 60_000_000;
      const fileOf = (id: string) => `${id}.spindle`;
      const entryOf = (name: string) => (/^[0-9a-f-]{36}\.spindle$/.test(name) && UUID.test(name.slice(0, 36)) ? s.entries.find((e) => e.id === name.slice(0, 36)) : undefined);
      const isPublic = (e: EntryFake) => e.state === "live" && e.removedAt === null && !s.held.has(e.user) && s.sharingOn;
      const sizeOf = (e: EntryFake) => {
        const o = s.objects.get(fileOf(e.id));
        return o && o.sized ? bytes(o.text) : null;
      };
      const bytesOf = (me: string) => s.entries.filter((e) => e.user === me).reduce((t, e) => t + (sizeOf(e) ?? 0), 0);
      const closeStale = (me: string) => {
        const t = now();
        for (const e of s.entries) if (e.user === me && e.state === "uploading" && e.createdAt <= t - hour) Object.assign(e, { state: "off", offAt: t });
      };
      const card = (e: EntryFake) => ({ id: e.id, title: e.title, picture: e.picture, licence: e.licence, tags: [...e.tags], published_at: e.publishedAt === null ? null : pgTime(e.publishedAt), author: s.names.get(e.user) ?? null });
      const newestFirst = (a: EntryFake, b: EntryFake) => ((b.publishedAt ?? 0) - (a.publishedAt ?? 0)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
      const tagsOk = (t: unknown) =>
        Array.isArray(t) && t.length <= LIBRARY_LIMITS.maxTags && t.every((x) => typeof x === "string" && /^[a-z0-9][a-z0-9-]*$/.test(x) && x.length >= 2 && x.length <= LIBRARY_LIMITS.maxTag) && new Set(t).size === t.length;
      /** Parses PostgreSQL's timestamptz text back to microseconds (all six digits kept). */
      const parseTime = (v: string) => {
        const m = /^(.{19})(?:\.(\d{1,6}))?\+00:00$/.exec(v);
        if (!m) throw new Error(`fake: not a time ${v}`);
        return Date.parse(`${m[1]}Z`) * 1000 + Number((m[2] ?? "").padEnd(6, "0"));
      };

      const data = (path: string, body: unknown, needsPerson: boolean): PersonReply => {
        s.calls.push(path);
        if (needsPerson && !user) return { kind: "signed-out" };
        if (s.mode === "down") return { kind: "failed", reason: "offline" };
        if (s.mode === "missing") return { kind: "failed", reason: "rejected" };
        const reply = (b: unknown): PersonReply => {
          if (s.nextBody && s.nextBody.path === path) {
            const over = s.nextBody.body;
            s.nextBody = undefined;
            return { kind: "ok", body: over };
          }
          return { kind: "ok", body: b === undefined ? null : JSON.parse(JSON.stringify(b)) };
        };
        const a = (body ?? {}) as Record<string, unknown>;
        const mine = s.entries.filter((e) => e.user === user);
        switch (path) {
          case "rpc/begin_publish": {
            if (!s.sharingOn) return reply({ status: "off" });
            const title = a.p_title;
            const description = a.p_description;
            const picture = a.p_picture;
            if (typeof title !== "string" || title.trim() === "" || title !== title.trim() || chars(title) > LIBRARY_LIMITS.maxTitle || typeof description !== "string" || chars(description) > LIBRARY_LIMITS.maxDescription || !(LICENCES as readonly unknown[]).includes(a.p_licence) || !tagsOk(a.p_tags) || (picture !== null && (typeof picture !== "string" || !PICTURE.test(picture) || picture.length > LIBRARY_LIMITS.maxPictureBytes)))
              return reply({ status: "bad" });
            closeStale(user as string);
            if (mine.filter((e) => e.state !== "off").length >= LIBRARY_LIMITS.maxEntries) return reply({ status: "full" });
            // 20261113200000_library_limits.sql: files in the bucket plus the largest file for each entry still waiting.
            const waiting = mine.filter((e) => e.state === "uploading" && sizeOf(e) === null).length;
            if (bytesOf(user as string) + LIBRARY_LIMITS.maxFileBytes * waiting > LIBRARY_LIMITS.maxBytes) return reply({ status: "full" });
            const t = now();
            if (mine.filter((e) => e.createdAt > t - day).length >= LIBRARY_LIMITS.entriesPerDay) return reply({ status: "daily" });
            if (s.held.has(user as string)) return reply({ status: "held" });
            const e: EntryFake = { id: uuid(), user: user as string, title, description, licence: a.p_licence as string, tags: [...(a.p_tags as string[])], picture: picture as string | null, state: "uploading", fileBytes: null, createdAt: t, publishedAt: null, offAt: null, removedAt: null };
            s.entries.push(e);
            return reply({ status: "ready", id: e.id, file: fileOf(e.id) });
          }
          case "rpc/finish_publish": {
            if (!s.sharingOn) return reply("off");
            if (s.held.has(user as string)) return reply("held");
            closeStale(user as string);
            const e = mine.find((x) => x.id === a.p_id && x.state === "uploading");
            if (!e) return reply("gone");
            const size = sizeOf(e);
            if (size === null) return reply("missing");
            if (size > LIBRARY_LIMITS.maxFileBytes) return reply("too-big");
            if (mine.reduce((t, x) => t + (sizeOf(x) ?? 0), 0) > LIBRARY_LIMITS.maxBytes) return reply("full");
            Object.assign(e, { state: "live", fileBytes: size, publishedAt: now() });
            return reply("live");
          }
          case "rpc/unpublish": {
            const e = mine.find((x) => x.id === a.p_id && x.state !== "off");
            if (!e) return reply(null);
            Object.assign(e, { state: "off", offAt: now() });
            return reply(true);
          }
          case "rpc/browse_library": {
            if (!s.sharingOn) return reply(null);
            if (chars(typeof a.p_search === "string" ? a.p_search : "") > LIBRARY_LIMITS.maxSearch || chars(typeof a.p_tag === "string" ? a.p_tag : "") > LIBRARY_LIMITS.maxTag) return reply([]);
            const words = typeof a.p_search === "string" ? a.p_search.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
            const before = a.p_before === null ? null : parseTime(a.p_before as string);
            const beforeId = (a.p_before_id as string | null) ?? "ffffffff-ffff-ffff-ffff-ffffffffffff";
            const limit = Math.max(1, Math.min(Number(a.p_limit ?? 48), LIBRARY_LIMITS.page));
            const hits = s.entries
              .filter(isPublic)
              .filter((e) => words.every((w) => `${e.title} ${e.tags.join(" ")} ${e.description}`.toLowerCase().split(/[^a-z0-9]+/).includes(w)))
              .filter((e) => a.p_tag === null || e.tags.includes(a.p_tag as string))
              .filter((e) => before === null || (e.publishedAt as number) < before || ((e.publishedAt as number) === before && e.id < beforeId))
              .sort(newestFirst)
              .slice(0, limit);
            return reply(hits.map(card));
          }
          case "rpc/library_entry": {
            const e = s.entries.find((x) => x.id === a.p_id);
            if (!e || !isPublic(e)) return reply(null);
            return reply({ ...card(e), description: e.description, bytes: e.fileBytes, file: fileOf(e.id), mine: e.user === user });
          }
          case "rpc/my_library":
            return reply(
              mine
                .filter((e) => e.state !== "off" || s.objects.has(fileOf(e.id)))
                .sort((x, y) => y.createdAt - x.createdAt || (x.id < y.id ? 1 : -1))
                .map((e) => ({ ...card(e), state: e.state, removed_at: e.removedAt === null ? null : pgTime(e.removedAt), created_at: pgTime(e.createdAt), file: fileOf(e.id), bytes: sizeOf(e) })),
            );
        }
        return { kind: "failed", reason: "rejected" };
      };

      const storage = (method: string, path: string, body: StorageBody): StorageReply => {
        if (!user) return { kind: "signed-out" }; // the real client sends nothing then
        s.calls.push(`storage ${method} ${path}`);
        if (s.mode === "down") return { kind: "failed", reason: "offline" };
        if (s.nextStorage) {
          const over = s.nextStorage;
          s.nextStorage = undefined;
          return over;
        }
        const refused = (code: number): StorageReply => ({ kind: "failed", reason: "rejected", code });
        const json = "json" in body ? (body.json as Record<string, unknown>) : {};
        const upload = /^object\/library\/([^/]+)$/.exec(path);
        if (method === "POST" && upload && "file" in body) {
          const name = upload[1] as string;
          if (body.type !== "application/json") return refused(415);
          if (bytes(body.file) > LIBRARY_LIMITS.maxFileBytes) return refused(413);
          const e = entryOf(name);
          const may = e && e.user === user && e.state === "uploading" && e.createdAt > now() - hour && s.sharingOn && !s.held.has(user) && bytesOf(user) <= LIBRARY_LIMITS.maxBytes;
          if (!may) return refused(403); // "new row violates row-level security policy"
          if (s.objects.has(name)) return refused(409);
          s.objects.set(name, { text: body.file, sized: s.writesSize });
          return { kind: "ok", body: { Key: `library/${name}`, Id: "obj" } };
        }
        const sign = /^object\/sign\/library\/([^/]+)$/.exec(path);
        if (method === "POST" && sign) {
          const name = sign[1] as string;
          const e = entryOf(name);
          const may = e !== undefined && (e.user === user || isPublic(e));
          if (!may || !s.objects.has(name)) return refused(404);
          const token = `tok${++signed}.${seed}`;
          links.set(token, { file: name, until: now() + Number(json.expiresIn) * 1_000_000 });
          return { kind: "ok", body: { signedURL: `/object/sign/library/${name}?token=${token}` } };
        }
        if (method === "DELETE" && path === "object/library") {
          const names = Array.isArray(json.prefixes) ? (json.prefixes as string[]) : [];
          const gone = names.filter((name) => {
            const e = entryOf(name);
            return e !== undefined && e.user === user && s.objects.delete(name);
          });
          return { kind: "ok", body: gone.map((name) => ({ name, bucket_id: "library" })) };
        }
        return refused(400);
      };

      const file = (signedPath: string, maxBytes: number): FileReply => {
        s.calls.push(`get ${signedPath}`);
        if (s.mode === "down") return { kind: "failed", reason: "offline" };
        const m = /^\/object\/sign\/library\/([^/?]+)\?token=(.+)$/.exec(signedPath);
        const link = m ? links.get(m[2] as string) : undefined;
        if (!m || !link || link.file !== m[1] || link.until < now()) return { kind: "failed", reason: "rejected" };
        const o = s.objects.get(link.file);
        if (!o) return { kind: "failed", reason: "rejected" };
        return bytes(o.text) > maxBytes ? { kind: "failed", reason: "too-big" } : { kind: "ok", text: o.text };
      };

      return {
        state: () => (user ? { kind: "signed-in", user: { id: user, email: `${user}@example.com`, name: user } } : { kind: "signed-out" }),
        async asPerson(_m, path, body) {
          return data(path, body, true);
        },
        async asAnyone(_m, path, body) {
          return data(path, body, false);
        },
        async asPersonStorage(method, path, body) {
          return storage(method, path, body);
        },
        async getSignedFile(path, max) {
          return file(path, max);
        },
      };
    },
  };
  return s;
}
