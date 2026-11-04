// Earlier versions of a kept project (missing basics 3b; audit item 11): each save keeps the state it replaces as a
// version, at most one every VERSION_GAP_MS and the newest VERSION_LIMIT, so a project can go back to how it was
// earlier today even after the undo history is gone (a reload, another project opened). Each version is one entry:
//   version/<id>/<ms>  the exact .spindlelabs.json text the project had, <ms> its save time (the summary's `modified`)
// Versions are an extra and never cost a save: one that can't be written is passed over, and a save refused for want
// of room is tried once more after this project's versions are given up. Deleting the project deletes its versions.

import { projectFromJson, projectToJson, type DataReader, type Project } from "@fission/core";
import type { KeyValue } from "./key-value.ts";
import { ProjectChangedError, type ProjectStore } from "./store.ts";

/** Ten minutes: a version at most this often, so a burst of edits is one version, not twenty. */
export const VERSION_GAP_MS = 10 * 60_000;
/** The newest twenty are kept: three hours or more of steady work. */
export const VERSION_LIMIT = 20;

const VERSION = "version/";
const prefix = (id: string) => `${VERSION}${id}/`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A refusal for want of room: indexeddb.ts's words for QuotaExceededError, or the error itself. */
export const storageFull = (e: unknown) => /^browser storage is full\b|QuotaExceeded/.test(message(e)) || (e instanceof Error && e.name === "QuotaExceededError");

/** A store that also keeps earlier versions. */
export interface VersionedStore extends ProjectStore {
  /** When each kept version of `id` was saved, newest first (none for a project with none, or one not stored). */
  versions(id: string): Promise<Date[]>;
  /** Reads and upgrades version `at` of `id`, as `open` does; refuses one that is not kept or can't be read. */
  openVersion(id: string, at: Date): Promise<Project>;
}

/** The save time a summary entry holds, or null when it can't be read. */
function savedAt(summary: string | undefined): number | null {
  try {
    const t = new Date((JSON.parse(summary ?? "") as { modified?: unknown }).modified as string).getTime();
    return Number.isSafeInteger(t) && t >= 0 ? t : null;
  } catch {
    return null;
  }
}

/** The kept versions' times of `id`, newest first; keys that aren't a time are left out. */
async function times(kv: KeyValue, id: string): Promise<number[]> {
  const p = prefix(id);
  return (await kv.keys(p))
    .map((k) => k.slice(p.length))
    .filter((t) => /^\d{1,15}$/.test(t))
    .map(Number)
    .sort((a, b) => b - a);
}

/**
 * `store`, written over `kv`, keeping earlier versions (`gapMs` apart at most, the newest `limit`). `readers` open a
 * version as `open` does.
 */
export function versionedStore(store: ProjectStore, kv: KeyValue, readers: readonly DataReader[], { gapMs = VERSION_GAP_MS, limit = VERSION_LIMIT } = {}): VersionedStore {
  /** Keeps `text`, saved at `at`, as a version of `id` when the newest is at least `gapMs` older; then the newest `limit` only. Never throws. */
  async function keep(id: string, text: string, at: number) {
    try {
      const kept = await times(kv, id);
      if (kept.length === 0 || at - kept[0] >= gapMs) {
        await kv.set(prefix(id) + at, text);
        kept.unshift(at);
      }
      for (const old of kept.slice(limit)) await kv.delete(prefix(id) + old);
    } catch {
      // storage full or failing: the save itself went through, which is what matters
    }
  }
  async function forgetVersions(id: string) {
    for (const t of await times(kv, id)) await kv.delete(prefix(id) + t);
  }

  return {
    list: () => store.list(),
    open: (id) => store.open(id),
    async save(id, project, read, unchangedSince, behind, writer) {
      // The state this save replaces, read first: after the save it is gone.
      let before: string | undefined;
      let at: number | null = null;
      try {
        [before, at] = [await kv.get(`project/${id}`), savedAt(await kv.get(`summary/${id}`))];
      } catch {
        before = undefined; // can't read it: no version this time
      }
      try {
        await store.save(id, project, read, unchangedSince, behind, writer);
      } catch (e) {
        if (e instanceof ProjectChangedError || !storageFull(e) || (await times(kv, id).catch(() => [])).length === 0) throw e;
        // Refused for want of room, perhaps: this project's versions give way to its work, and the save is tried once more.
        await forgetVersions(id).catch(() => {});
        await store.save(id, project, read, unchangedSince, behind, writer);
      }
      if (before === undefined || at === null) return;
      let now: string;
      try {
        now = projectToJson(project);
      } catch {
        return;
      }
      if (now !== before) await keep(id, before, at); // a save of the same state (brought forward, say) is no new version
    },
    async remove(id) {
      await store.remove(id);
      await forgetVersions(id).catch(() => {}); // left behind, they are only unreachable: the project is gone either way
    },
    async versions(id) {
      return (await times(kv, id)).map((t) => new Date(t));
    },
    async openVersion(id, at) {
      const text = await kv.get(prefix(id) + at.getTime());
      if (text === undefined) throw new Error(`there is no version of this project saved at ${at.toISOString()} in this browser`);
      try {
        return projectFromJson(text, readers);
      } catch (e) {
        throw new Error(`can't open that version: ${message(e)}`);
      }
    },
  };
}
