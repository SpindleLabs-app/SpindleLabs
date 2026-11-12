// Projects kept in this browser (19b): list, open, save, remove, written
// over a KeyValue. Each project is two entries:
//   project/<id>  the exact text of its .spindlelabs.json file (projectToJson)
//   summary/<id>  {"name", "modified", "order", "writer", "touched", "works"} for the list, so listing never reads whole
//                 projects ("touched": when the save was made by the clock, "works": the workspaces holding work, U6a)
//                 ("writer": the autosave that made the save, when it named itself, own-save.test.ts)
// A deleted project leaves its deletion mark (hunt C2, C3): the delete writes, in one transaction,
//   summary/<id>  {"deleted": "<ISO time>"}, never listed or opened: a save made from the deleted state (one expecting a
//                 save time) is refused as ProjectDeletedError, where a missing summary (site data cleared) is stored
//                 again (B4); a save expecting nothing (a new project, recovery) replaces the mark
// and deletes project/<id> in that same transaction.
// And one entry for them all:
//   order         the number of the last save, counted up by each one: the summary's "order" puts the list in the
//                 order the saves happened, whatever the device's clock said (real-use hunt B5)
// Opening goes through projectFromJson, so an old project migrates exactly
// as an opened file would, and a corrupt one is refused with a message.

import { projectFromJson, projectToJson, workspacesWithWork, type DataReader, type Project, type WorkspaceId } from "@fission/core";
import type { KeyValue } from "./key-value.ts";

export interface ProjectSummary {
  id: string;
  name: string;
  modified: Date;
  /** The save's number, counted up across every project (0 for one saved before saves were counted). */
  order: number;
  /**
   * The autosave that made the last save, when it named itself (`save`'s `writer`): recovery knows a journal entry by
   * that same writer has no other tab's work under it (unsaved.ts, own-save.test.ts). Left out otherwise.
   */
  writer?: string;
  /**
   * When the last save was made, by the clock (`modified` is the time of the state, which a project brought forward
   * from the list keeps): the home screen's "last opened". Left out for a project saved before this was kept.
   */
  touched?: Date;
  /** The workspaces holding work in it (`workspacesWithWork`); left out for a project saved before this was kept. */
  works?: WorkspaceId[];
  /** Set when this entry's summary can't be read; the project may still open. */
  problem?: string;
}

export interface ProjectStore {
  /** Every stored project, most recently saved first: by the saves' order, then (for projects saved before saves were counted) by save time. */
  list(): Promise<ProjectSummary[]>;
  /** Reads and upgrades a stored project; refuses a missing or corrupt one with a message. */
  open(id: string): Promise<Project>;
  /**
   * Stores the project under `id`, replacing what was there. `read` is when
   * the project was in that state (autosave reads it, a journal entry was
   * written), kept as its save time: the next visit compares it with a
   * journal entry's time (unsaved.ts). Left out, it is now. Given
   * `unchangedSince`, the save time of the stored project as this tab last
   * read or wrote it, the save is refused with a ProjectChangedError when
   * the store's is another (another tab saved since), so a stale tab never
   * overwrites newer work. `behind` lists it after every project saved
   * in order (save number 0, the count left as it was): a stale tab's change
   * kept as a separate project (unsaved.ts), so the project the user last
   * saw stored is still the one the app opens (real-use hunt S1). `writer`
   * names the autosave saving (`ProjectSummary.writer`; one that isn't a
   * `writerId` is left out).
   */
  save(id: string, project: Project, read?: Date, unchangedSince?: Date, behind?: boolean, writer?: string): Promise<void>;
  /**
   * Forgets a stored project, in one step, leaving its deletion mark (a later save made from it is refused as
   * ProjectDeletedError); refuses an id that is not stored.
   */
  remove(id: string): Promise<void>;
}

/** A save refused because another tab stored the project since this one last read or wrote it (app sweep 2026-10-28, finding 2). */
export class ProjectChangedError extends Error {
  constructor() {
    super("This project was changed in another tab. Reload to see the newer version.");
    this.name = "ProjectChangedError";
  }
}

/**
 * A save refused because the project was deleted (by this site: home screen or File > Projects, in another tab) since
 * this tab last read or wrote it (hunt C2). A ProjectChangedError, so everything that keeps a stale tab's change apart
 * as "(kept copy)" (autosave's `leaving` and `finish`, recovery) keeps this one too, rather than storing it again.
 */
export class ProjectDeletedError extends ProjectChangedError {
  constructor() {
    super();
    this.message = "This project was deleted in another tab, so changes here aren't stored in it. They're kept as a separate project, \"(kept copy)\", when you reload or open another project.";
    this.name = "ProjectDeletedError";
  }
}

/** A refusal for want of room: indexeddb.ts's words for QuotaExceededError, or the error itself (as versions.ts's `storageFull`, which imports this file). */
const storageFull = (e: unknown) => e instanceof Error && (/^browser storage is full\b|QuotaExceeded/.test(e.message) || e.name === "QuotaExceededError");

const PROJECT = "project/";
const SUMMARY = "summary/";
const ORDER = "order";

/** A stored count, or 0 for none or anything else: a count that can't be read starts again, behind no save counted since. */
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A writer id a summary and a journal entry's head can hold: 1 to 64 letters, digits, "-" or "_" (a random UUID fits). */
export const writerId = (w: unknown): string | null => (typeof w === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(w) ? w : null);

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) throw new Error("a stored project needs a non-empty id");
  return id;
}

/** A summary entry that is a deletion mark (`remove`), not a project's summary. */
function deletionMark(text: string | undefined): boolean {
  if (text === undefined) return false;
  try {
    const s: unknown = JSON.parse(text);
    return typeof s === "object" && s !== null && !Array.isArray(s) && typeof (s as Record<string, unknown>).deleted === "string" && !("name" in s);
  } catch {
    return false;
  }
}

/** Reads a summary entry; anything odd becomes a problem on the entry, never a thrown error. */
function readSummary(id: string, text: string | undefined): ProjectSummary {
  try {
    const s: unknown = JSON.parse(text ?? "");
    if (typeof s !== "object" || s === null) throw new Error("not an object");
    const { name, modified, order, writer, touched, works } = s as Record<string, unknown>;
    const when = typeof modified === "string" ? new Date(modified) : new Date(NaN);
    if (typeof name !== "string") throw new Error("no name");
    if (Number.isNaN(when.getTime())) throw new Error("no save time");
    const by = writerId(writer);
    const base: ProjectSummary = { id, name, modified: when, order: count(order) };
    if (by !== null) base.writer = by;
    // Optional details: one that can't be read is left out, never a reason to refuse the project (U6a).
    const at = typeof touched === "string" ? new Date(touched) : null;
    if (at !== null && !Number.isNaN(at.getTime())) base.touched = at;
    if (Array.isArray(works) && works.every((w) => typeof w === "string")) base.works = works as WorkspaceId[];
    return base;
  } catch (e) {
    return { id, name: id, modified: new Date(0), order: 0, problem: `this project's summary can't be read (${message(e)})` };
  }
}

/**
 * A ProjectStore over `kv`. `readers` are the workspace plugins (each one's
 * readData upgrades its own part on open); `now` is the clock, so tests can
 * fix the save time.
 */
export function projectStore(kv: KeyValue, readers: readonly DataReader[], now: () => Date = () => new Date()): ProjectStore {
  return {
    async list() {
      const ids = (await kv.keys(SUMMARY)).map((k) => k.slice(SUMMARY.length));
      const texts = await Promise.all(ids.map(async (id) => [id, await kv.get(SUMMARY + id)] as const));
      const all = texts.filter(([, text]) => !deletionMark(text)).map(([id, text]) => readSummary(id, text)); // a deleted project is never listed (C2)
      // By order first: a project saved while the clock ran ahead must not stay newest once it is put right (B5).
      return all.sort((a, b) => b.order - a.order || b.modified.getTime() - a.modified.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    async open(id) {
      checkId(id);
      const text = await kv.get(PROJECT + id);
      if (text === undefined) throw new Error(`there is no stored project "${id}" in this browser`);
      try {
        return projectFromJson(text, readers);
      } catch (e) {
        throw new Error(`can't open the stored project "${id}": ${message(e)}`);
      }
    },
    async save(id, project, read, unchangedSince, behind = false, writer) {
      checkId(id);
      const text = projectToJson(project); // refuses NaN and the like before anything is written
      // The save time is when the state was read, never when the writes finish: a journal entry written while
      // they run holds a newer state, and must not look older than this one (unsaved.ts).
      const when = read ?? now();
      if (Number.isNaN(when.getTime())) throw new Error("a stored project needs a valid save time");
      const modified = when.toISOString();
      const by = writerId(writer);
      const touched = read === undefined ? modified : now().toISOString(); // the clock is read once more only when the state's own time was handed in
      const works = workspacesWithWork(project);
      const summaryOf = (order: number) => JSON.stringify(by === null ? { name: project.name, modified, order, touched, works } : { name: project.name, modified, order, writer: by, touched, works });
      // The check and both writes in one step (KeyValue.update): no other tab's save lands between them, and a tab
      // killed mid-save leaves both entries or neither (real-use hunt B6, B7).
      await kv.update([SUMMARY + id, ORDER], ([summary, last]) => {
        // No summary at all: the browser emptied the store under this tab (site data cleared), so this tab's state is
        // the only copy left and is stored again, rather than taken for another tab's change (real-use hunt B4).
        // A deletion mark: deleted by this site since this tab read it, never stored again under it (hunt C2).
        if (unchangedSince !== undefined && deletionMark(summary)) throw new ProjectDeletedError();
        if (unchangedSince !== undefined && summary !== undefined) {
          const holds = readSummary(id, summary);
          if (holds.problem !== undefined || holds.modified.getTime() !== unchangedSince.getTime()) throw new ProjectChangedError();
        }
        if (behind) return { [PROJECT + id]: text, [SUMMARY + id]: summaryOf(0) };
        const order = count(last === undefined ? undefined : Number(last)) + 1;
        return { [PROJECT + id]: text, [SUMMARY + id]: summaryOf(order), [ORDER]: String(order) };
      });
    },
    async remove(id) {
      checkId(id);
      // The check, the project's text deleted and its summary replaced by the deletion mark, as one step: a delete cut
      // short leaves the project whole or deleted, never a listed one that can't be opened (hunt C3), and the mark is
      // there the moment the project is gone, so another tab's save made from it is refused (C2).
      const there = (p: string | undefined, s: string | undefined) => {
        const project = p !== undefined;
        const summary = s !== undefined && !deletionMark(s);
        if (!project && !summary) throw new Error(`there is no stored project "${id}" to remove`);
      };
      const mark = () => {
        const at = now();
        return JSON.stringify({ deleted: Number.isNaN(at.getTime()) ? "" : at.toISOString() });
      };
      try {
        await kv.update([PROJECT + id, SUMMARY + id], ([p, s]) => {
          there(p, s);
          return { [PROJECT + id]: null, [SUMMARY + id]: mark() };
        });
      } catch (e) {
        if (!storageFull(e)) throw e;
        // A full store refuses any step that writes, even this one that makes it smaller, and only a step of deletes
        // alone goes through (Chromium, measured in the export hunt 2026-11-12, SL #643 item 2): so deleting an old
        // project, the one way to make room from inside the app, was refused. The text and the listing are deleted
        // together first (still whole or deleted, never half), which frees the room; then the mark is written. If
        // even the mark is refused it is left out: no summary reads as "not there" everywhere, and only a tab that
        // still shows the project could store it again.
        try {
          await kv.update([PROJECT + id, SUMMARY + id], ([p, s]) => {
            there(p, s);
            return { [PROJECT + id]: null, [SUMMARY + id]: null };
          });
        } catch (again) {
          throw storageFull(again) ? new Error("browser storage is full: can't delete this project") : again;
        }
        try {
          await kv.update([SUMMARY + id], ([s]) => (s === undefined ? { [SUMMARY + id]: mark() } : {}));
        } catch {
          // no room even for the mark: the project is deleted all the same
        }
      }
    },
  };
}

/**
 * The stored project that holds exactly `project` (compared as read, so a file's spacing or an older version doesn't
 * matter), the one saved last when there are several; none when no stored project does. Open reuses it rather than
 * storing the same file again as a new copy no one can reach (real-use hunt B3). A stored project that can't be read
 * is passed over. Only projects of the same name are read.
 */
export async function storedCopy(store: ProjectStore, project: Project): Promise<ProjectSummary | undefined> {
  const text = projectToJson(project);
  for (const summary of await store.list()) {
    if (summary.problem !== undefined || summary.name !== project.name) continue;
    try {
      if (projectToJson(await store.open(summary.id)) === text) return summary;
    } catch {
      // can't be read: not a copy of anything
    }
  }
  return undefined;
}
