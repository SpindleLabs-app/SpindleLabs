// The public library (community C3b): the requests behind publishing a design with a licence, browsing and searching
// it without an account, and downloading it (signed in) through a short signed link
// (supabase/migrations/20261112030000_library.sql). A design's file lives in Supabase Storage's private bucket
// "library" as `<entry id>.spindle`, never named by account. The database and the bucket's policies decide who may do
// what; this checks a draft the same way first (so a dialog can say what is wrong without asking), runs the three
// publishing calls in order, tidies up after one that fails, and checks every answer's shape. Behind the ?share switch.

import type { AuthClient, StorageReply } from "./auth.ts";
import type { DataResult } from "./data.ts";
import { isShareId } from "./shares.ts";

/** The limits, as the database keeps them (library_limits()); checked by test/library.test.ts against the SQL. */
export const LIBRARY_LIMITS = {
  maxEntries: 50,
  maxBytes: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxPictureBytes: 32 * 1024,
  entriesPerDay: 10,
  maxTitle: 100,
  maxDescription: 2000,
  maxTags: 8,
  maxTag: 24,
  uploadMinutes: 60,
  page: 48,
  maxSearch: 200,
} as const;

/** The licences a design can be published under, as SPDX ids, the default first. Must match the database's list. */
export const LICENCES = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC0-1.0"] as const;
export type Licence = (typeof LICENCES)[number];
export const DEFAULT_LICENCE: Licence = "CC-BY-4.0";
export const isLicence = (v: unknown): v is Licence => typeof v === "string" && (LICENCES as readonly string[]).includes(v);

/** Each licence in plain words, for the Publish dialog and an entry's page. */
export const LICENCE_WORDS: Readonly<Record<Licence, { readonly name: string; readonly says: string }>> = {
  "CC-BY-4.0": { name: "CC BY 4.0", says: "Anyone may use, change and share it, even to sell, as long as they name you." },
  "CC-BY-SA-4.0": { name: "CC BY-SA 4.0", says: "Anyone may use, change and share it, naming you, and what they make from it must be shared under the same licence." },
  "CC-BY-NC-4.0": { name: "CC BY-NC 4.0", says: "Anyone may use, change and share it, naming you, but not to make money." },
  "CC0-1.0": { name: "CC0", says: "You give it away: anyone may do anything with it, without naming you." },
};

/** How long a download link lasts (seconds). A takedown stops new links at once; one already made lasts this long. */
export const DOWNLOAD_SECONDS = 600;

/** The file's name in the bucket for entry `id` (library_file_name()). */
export const libraryFileName = (id: string) => `${id}.spindle`;

/** What publishing needs: the open project's file text (already through stripForShare) and what people see. */
export interface LibraryDraft {
  readonly title: string;
  readonly description: string;
  readonly licence: string;
  readonly tags: readonly string[];
  readonly picture: string | null;
  readonly body: string;
}

/** The first thing wrong with a draft, by field, or null when the library would take it. */
export type DraftProblem = "title" | "description" | "licence" | "tags" | "picture" | "too-big" | "empty" | "other";

export type PublishAnswer =
  | { readonly status: "published"; readonly id: string }
  | { readonly status: "bad"; readonly problem: DraftProblem }
  // full: max entries, or (after the upload) over max bytes in all; refused: Storage wouldn't take the file;
  // missing: the service has no size for the uploaded file (see finish_publish)
  | { readonly status: "too-big" | "full" | "daily" | "held" | "off" | "refused" | "missing" | "gone" };

/** Where a page of browsing ends: the next page starts after it. `publishedAt` is the database's own text, never rounded. */
export interface LibraryCursor {
  readonly publishedAt: string;
  readonly id: string;
}

/** An entry as anyone sees it in a list. Never the author's account, only their display name (null without one). */
export interface LibraryCard {
  readonly id: string;
  readonly title: string;
  readonly picture: string | null;
  readonly licence: Licence;
  readonly tags: readonly string[];
  readonly publishedAt: Date;
  readonly author: string | null;
  readonly cursor: LibraryCursor;
}

/** An entry's own page. `mine`: the signed-in person published it. */
export interface LibraryEntry extends LibraryCard {
  readonly description: string;
  readonly bytes: number;
  readonly mine: boolean;
}

export type EntryState = "uploading" | "live" | "off";

/** One of the person's own entries. `bytes` is the size of its file in the bucket, null when there is none. */
export interface MyEntry {
  readonly id: string;
  readonly title: string;
  readonly picture: string | null;
  readonly licence: Licence;
  readonly tags: readonly string[];
  readonly state: EntryState;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
  /** Set when the people who run SpindleLabs took it down after a report. */
  readonly removedAt: Date | null;
  readonly bytes: number | null;
}

export interface BrowsePage {
  readonly cards: readonly LibraryCard[];
  /** The cursor for the next page, null when this page was the last. */
  readonly next: LibraryCursor | null;
}

const PICTURE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const TAG = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN = /^[A-Za-z0-9._~%-]+$/;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** Characters as the database counts them (char_length: code points, so an emoji is one, not two). */
const chars = (s: string) => [...s].length;
/** Bytes as Storage counts them (UTF-8). */
export const fileBytes = (s: string) => new TextEncoder().encode(s).length;
export const isTag = (t: unknown): t is string => typeof t === "string" && TAG.test(t) && t.length >= 2 && t.length <= LIBRARY_LIMITS.maxTag;

/** The first thing the library would refuse in a draft, by the database's own rules (begin_publish, library_tags_ok). */
export function draftProblem(d: LibraryDraft): DraftProblem | null {
  if (d.title.trim() === "" || d.title !== d.title.trim() || chars(d.title) > LIBRARY_LIMITS.maxTitle) return "title";
  if (chars(d.description) > LIBRARY_LIMITS.maxDescription) return "description";
  if (!isLicence(d.licence)) return "licence";
  if (d.tags.length > LIBRARY_LIMITS.maxTags || !d.tags.every(isTag) || new Set(d.tags).size !== d.tags.length) return "tags";
  if (d.picture !== null && (!PICTURE.test(d.picture) || d.picture.length > LIBRARY_LIMITS.maxPictureBytes)) return "picture";
  if (d.body === "") return "empty";
  if (fileBytes(d.body) > LIBRARY_LIMITS.maxFileBytes) return "too-big";
  return null;
}

function time(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const tagsFrom = (v: unknown): string[] | null => (Array.isArray(v) && v.every(isTag) ? v : null);
const pictureFrom = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" && PICTURE.test(v) ? v : undefined);
const authorFrom = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : typeof v === "string" ? v : undefined);

export function libraryCardFrom(v: unknown): LibraryCard | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const publishedAt = time(r.published_at);
  const tags = tagsFrom(r.tags);
  const picture = pictureFrom(r.picture);
  const author = authorFrom(r.author);
  if (!isShareId(r.id) || typeof r.title !== "string" || picture === undefined || !isLicence(r.licence) || !tags || !publishedAt || author === undefined) return null;
  return { id: r.id, title: r.title, picture, licence: r.licence, tags, publishedAt, author, cursor: { publishedAt: r.published_at as string, id: r.id } };
}

export function libraryEntryFrom(v: unknown): LibraryEntry | null {
  const card = libraryCardFrom(v);
  if (!card) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.description !== "string" || !isCount(r.bytes) || r.file !== libraryFileName(card.id) || typeof r.mine !== "boolean") return null;
  return { ...card, description: r.description, bytes: r.bytes, mine: r.mine };
}

export function myEntryFrom(v: unknown): MyEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const createdAt = time(r.created_at);
  const publishedAt = r.published_at === null ? null : time(r.published_at);
  const removedAt = r.removed_at === null ? null : time(r.removed_at);
  const tags = tagsFrom(r.tags);
  const picture = pictureFrom(r.picture);
  const state = r.state === "uploading" || r.state === "live" || r.state === "off" ? r.state : null;
  if (!isShareId(r.id) || typeof r.title !== "string" || picture === undefined || !isLicence(r.licence) || !tags || !state || !createdAt) return null;
  if ((r.published_at !== null && !publishedAt) || (r.removed_at !== null && !removedAt) || (r.bytes !== null && !isCount(r.bytes)) || r.file !== libraryFileName(r.id)) return null;
  if (state === "live" && publishedAt === null) return null; // a live entry always has its day
  return { id: r.id, title: r.title, picture, licence: r.licence, tags, state, createdAt, publishedAt, removedAt, bytes: r.bytes as number | null };
}

const malformed = { kind: "failed", reason: "malformed" } as const;
const ok = <T>(value: T) => ({ kind: "ok", value }) as const;

type LibraryClient = Pick<AuthClient, "asPerson" | "asAnyone" | "asPersonStorage" | "getSignedFile">;

export function libraryApi(client: LibraryClient) {
  /** The signed link's path for `file`, or null when Storage refused (not allowed: not live, taken down, held, off; or no file). */
  async function signedPath(file: string): Promise<DataResult<string | null>> {
    const r = await client.asPersonStorage("POST", `object/sign/library/${file}`, { json: { expiresIn: DOWNLOAD_SECONDS } });
    if (r.kind === "failed" && r.reason === "rejected") return r.code === 400 || r.code === 403 || r.code === 404 ? ok(null) : { kind: "failed", reason: "rejected" };
    if (r.kind !== "ok") return r;
    const b = r.body as Record<string, unknown> | null | undefined;
    const path = typeof b === "object" && b !== null ? b.signedURL : undefined;
    const start = `/object/sign/library/${file}?token=`;
    // Storage gives the path under /storage/v1; check it names this file and nothing else.
    if (typeof path !== "string" || !path.startsWith(start) || !TOKEN.test(path.slice(start.length))) return malformed;
    return ok(path);
  }

  /** Deletes the bucket's file for entry `id`; true when there was one (only its author may). */
  async function deleteFile(id: string): Promise<DataResult<boolean>> {
    const file = libraryFileName(id);
    const r = await client.asPersonStorage("DELETE", "object/library", { json: { prefixes: [file] } });
    if (r.kind === "failed" && r.reason === "rejected") return { kind: "failed", reason: "rejected" };
    if (r.kind !== "ok") return r;
    if (!Array.isArray(r.body)) return malformed;
    return ok(r.body.some((o) => typeof o === "object" && o !== null && (o as Record<string, unknown>).name === file));
  }

  async function unpublish(id: string): Promise<DataResult<boolean>> {
    if (!isShareId(id)) return ok(false);
    const r = await client.asPerson("POST", "rpc/unpublish", { p_id: id });
    if (r.kind !== "ok") return r;
    // PostgREST gives a set-returning function that returned no row as null.
    return r.body === true ? ok(true) : r.body === null || r.body === false ? ok(false) : malformed;
  }

  /** Best effort after a publish that can't finish: turn the waiting entry off and delete any file sent, so neither counts. */
  async function abandon(id: string): Promise<void> {
    await unpublish(id);
    await deleteFile(id);
  }

  return {
    /**
     * Publishes a draft: begin_publish makes a waiting entry and names its file, the file goes to Storage, then
     * finish_publish checks its size and puts it live. A draft the library would refuse asks nothing. When the upload
     * or the finish is refused, the waiting entry is turned off and any file sent deleted. When the finish gets no
     * answer at all, nothing is undone (it may have gone live): My library shows which.
     */
    async publish(d: LibraryDraft): Promise<DataResult<PublishAnswer>> {
      const problem = draftProblem(d);
      if (problem === "too-big") return ok({ status: "too-big" });
      if (problem) return ok({ status: "bad", problem });
      const begun = await client.asPerson("POST", "rpc/begin_publish", { p_title: d.title, p_description: d.description, p_licence: d.licence, p_tags: [...d.tags], p_picture: d.picture });
      if (begun.kind !== "ok") return begun;
      const b = begun.body as Record<string, unknown> | null | undefined;
      if (typeof b !== "object" || b === null) return malformed;
      if (b.status === "bad") return ok({ status: "bad", problem: "other" }); // the local check passed, so the database's rules differ: never guess which field
      if (b.status === "full" || b.status === "daily" || b.status === "held" || b.status === "off") return ok({ status: b.status });
      if (b.status !== "ready" || !isShareId(b.id) || b.file !== libraryFileName(b.id)) return malformed;
      const id = b.id;
      const sent: StorageReply = await client.asPersonStorage("POST", `object/library/${libraryFileName(id)}`, { file: d.body, type: "application/json" });
      // 409: a file is already there. Only this person could have sent it, to this new entry: an earlier try whose answer was lost.
      if (sent.kind === "failed" && !(sent.reason === "rejected" && sent.code === 409)) {
        await abandon(id);
        if (sent.reason === "rejected") return ok({ status: sent.code === 413 ? "too-big" : "refused" });
        return sent;
      }
      if (sent.kind === "signed-out") return sent; // signed out between the calls: the waiting entry closes by itself within the hour
      const done = await client.asPerson("POST", "rpc/finish_publish", { p_id: id });
      if (done.kind !== "ok") return done;
      if (done.body === "live") return ok({ status: "published", id });
      if (done.body === "missing" || done.body === "too-big" || done.body === "full" || done.body === "gone" || done.body === "held" || done.body === "off") {
        await abandon(id);
        return ok({ status: done.body });
      }
      return malformed;
    },

    /**
     * A page of the library for anyone, newest first: `search` words (empty for all), one `tag` (null for all), the
     * page after `after`. Null while sharing is off. A tag that can't exist, or search text over `maxSearch`
     * characters, finds nothing without asking (the database answers the same).
     */
    async browse(search: string, tag: string | null, after: LibraryCursor | null = null): Promise<DataResult<BrowsePage | null>> {
      if ((tag !== null && !isTag(tag)) || chars(search.trim()) > LIBRARY_LIMITS.maxSearch) return ok({ cards: [], next: null });
      const r = await client.asAnyone("POST", "rpc/browse_library", {
        p_search: search.trim(),
        p_tag: tag,
        p_before: after?.publishedAt ?? null,
        p_before_id: after?.id ?? null,
        p_limit: LIBRARY_LIMITS.page,
      });
      if (r.kind !== "ok") return r;
      if (r.body === null) return ok(null);
      if (!Array.isArray(r.body) || r.body.length > LIBRARY_LIMITS.page) return malformed;
      const cards = r.body.map(libraryCardFrom);
      if (!cards.every((c): c is LibraryCard => c !== null)) return malformed;
      for (let i = 1; i < cards.length; i++) {
        const [p, c] = [cards[i - 1] as LibraryCard, cards[i] as LibraryCard];
        // Newest first, as asked: a page out of order would make the next one skip or repeat cards. Times the same to the
        // millisecond (the database keeps microseconds) are ordered by id only when their text is the same too.
        if (c.publishedAt > p.publishedAt) return malformed;
        if (c.cursor.publishedAt === p.cursor.publishedAt && c.id >= p.id) return malformed;
      }
      const last = cards[cards.length - 1];
      return ok({ cards, next: cards.length === LIBRARY_LIMITS.page && last ? last.cursor : null });
    },

    /** One entry's page for anyone; null when it isn't in the library (taken down, its author held, sharing off, never was). */
    async entry(id: string): Promise<DataResult<LibraryEntry | null>> {
      if (!isShareId(id)) return ok(null);
      const r = await client.asAnyone("POST", "rpc/library_entry", { p_id: id });
      if (r.kind !== "ok") return r;
      if (r.body === null) return ok(null);
      const e = libraryEntryFrom(r.body);
      return e && e.id === id ? ok(e) : malformed;
    },

    /** The person's own entries, newest first (off ones only while their file is still there to delete). */
    async mine(): Promise<DataResult<MyEntry[]>> {
      const r = await client.asPerson("POST", "rpc/my_library");
      if (r.kind !== "ok") return r;
      if (!Array.isArray(r.body)) return malformed;
      const rows = r.body.map(myEntryFrom);
      return rows.every((x): x is MyEntry => x !== null) ? ok(rows) : malformed;
    },

    /** Takes the person's entry out of the library for good; false when it isn't theirs or was already off. */
    unpublish,

    /** Deletes the file of the person's entry; true when there was one. */
    deleteFile,

    /** Takes the entry down and deletes its file (Take down in My library): both, the file even when the entry was already off. */
    async remove(id: string): Promise<DataResult<{ readonly wasOn: boolean; readonly fileDeleted: boolean }>> {
      if (!isShareId(id)) return ok({ wasOn: false, fileDeleted: false });
      const off = await unpublish(id);
      if (off.kind !== "ok") return off;
      const gone = await deleteFile(id);
      if (gone.kind !== "ok") return gone;
      return ok({ wasOn: off.value, fileDeleted: gone.value });
    },

    /** A design's file text for the signed-in person; null when the library won't give it (not live, taken down, sharing off). */
    async download(id: string): Promise<DataResult<string | null>> {
      if (!isShareId(id)) return ok(null);
      const link = await signedPath(libraryFileName(id));
      if (link.kind !== "ok" || link.value === null) return link;
      const f = await client.getSignedFile(link.value, LIBRARY_LIMITS.maxFileBytes);
      if (f.kind === "ok") return ok(f.text);
      if (f.reason === "too-big") return malformed; // the bucket never keeps one this big
      if (f.reason === "rejected") return ok(null); // the link ran out or the file went meanwhile
      return { kind: "failed", reason: f.reason };
    },
  };
}

export type LibraryApi = ReturnType<typeof libraryApi>;

/** Each publishing refusal in plain words. */
export const PUBLISH_WORDS: Readonly<Record<Exclude<PublishAnswer["status"], "published" | "bad">, string>> & { readonly bad: Readonly<Record<DraftProblem, string>> } = {
  "too-big": `This design's file is over ${LIBRARY_LIMITS.maxFileBytes / 1024 / 1024} MB, the most the library takes for one design.`,
  full: `You've used all your library space: ${LIBRARY_LIMITS.maxEntries} designs or ${LIBRARY_LIMITS.maxBytes / 1024 / 1024} MB in all. Take one down in My library to make room.`,
  daily: `You've published ${LIBRARY_LIMITS.entriesPerDay} designs today. Try again tomorrow.`,
  held: "Your account is on hold while the people who run SpindleLabs look at a report, so you can't publish for now.",
  off: "The library is switched off for now.",
  refused: "The library didn't take the file. Try again.",
  missing: "The library couldn't check the file's size, so it wasn't published. Try again later.",
  gone: "Publishing took too long and was stopped. Try again.",
  bad: {
    title: `Give it a title of up to ${LIBRARY_LIMITS.maxTitle} characters, with no spaces at either end.`,
    description: `The description can be up to ${LIBRARY_LIMITS.maxDescription} characters.`,
    licence: "Pick one of the licences.",
    tags: `Up to ${LIBRARY_LIMITS.maxTags} different tags, each 2 to ${LIBRARY_LIMITS.maxTag} lowercase letters, digits or dashes, starting with a letter or digit.`,
    picture: "The picture is too big or isn't a picture.",
    empty: "There's nothing in this design to publish.",
    "too-big": `This design's file is over ${LIBRARY_LIMITS.maxFileBytes / 1024 / 1024} MB.`,
    other: "The library didn't take these details. Check the title, description and tags, then try again.",
  },
};
