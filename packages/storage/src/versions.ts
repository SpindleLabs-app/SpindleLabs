// Earlier versions of a kept project (missing basics 3b; audit item 11): each save keeps the state it replaces as a
// version, at most one every VERSION_GAP_MS while the work goes on, and always a state that stood for VERSION_GAP_MS
// before it was replaced (the state a session ended in: issue #628, item 3), the newest VERSION_LIMIT, so a project
// can go back to how it was earlier today even after the undo history is gone (a reload, another project opened).
// Each version is one entry:
//   version/<id>/<ms>  the exact .spindlelabs.json text the project had, <ms> its save time (the summary's `modified`)
// Versions are an extra and never cost a save: one that can't be written is passed over, and a save refused for want
// of room is tried once more after this project's versions, and every project's kept undo steps (undo-steps.ts), are
// given up; versions given up for a retry that is still refused are put back (or held by the tab and written back
// after the next save that goes through: issue #510 item 5). Deleting the project deletes its versions and its undo steps.

import { projectFromJson, projectToJson, type DataReader, type Project } from "@fission/core";
import type { KeyValue } from "./key-value.ts";
import { ProjectChangedError, type ProjectStore } from "./store.ts";
import { stepsStore, type StepsStore } from "./undo-steps.ts";

/** Ten minutes: a version at most this often while the work goes on, so a burst of edits is one version, not twenty; and how long a state must have stood to be kept whatever came before it. */
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
  /** Each kept project's undo steps (step 89), in the same store. */
  readonly steps: StepsStore;
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
 * The newest kept version not saved after `at`, the one a state saved at `at` is measured from; null when there is none.
 * One saved later is passed over: a design brought from a device whose clock is ahead carries that device's save time,
 * and measured from it no state here would be kept until real time caught up (issue #628 item 8).
 */
export function previousKept(kept: readonly number[], at: number): number | null {
  let best: number | null = null;
  for (const t of kept) if (t <= at && (best === null || t > best)) best = t;
  return best;
}

/**
 * `store`, written over `kv`, keeping earlier versions (`gapMs` apart at most, the newest `limit`). `readers` open a
 * version as `open` does.
 */
export function versionedStore(store: ProjectStore, kv: KeyValue, readers: readonly DataReader[], { gapMs = VERSION_GAP_MS, limit = VERSION_LIMIT, steps = stepsStore(kv) } = {}): VersionedStore {
  /**
   * Keeps `text`, saved at `at` and replaced at `replaced` (null when that time can't be read), as a version of `id`
   * when the newest is at least `gapMs` older or it stood for `gapMs`; then the newest `limit` only. Never throws.
   */
  async function keep(id: string, text: string, at: number, replaced: number | null) {
    try {
      const kept = await times(kv, id);
      // A version already kept at that very time stays as it is (two saves in one millisecond).
      const prev = previousKept(kept, at);
      if (!kept.includes(at) && (prev === null || at - prev >= gapMs || (replaced !== null && replaced - at >= gapMs))) {
        await kv.set(prefix(id) + at, text);
        kept.unshift(at);
      }
      for (const old of kept.slice(limit)) await kv.delete(prefix(id) + old);
    } catch {
      // storage full or failing: the save itself went through, which is what matters
    }
  }
  /**
   * Whether keep() could store or trim anything for a state saved at `at` and replaced at `replaced` (the save's own
   * time, `store.save`'s `read`, which keep() reads back from the new summary): false only when it surely does nothing.
   */
  async function wouldKeep(id: string, at: number, replaced: number) {
    const kept = await times(kv, id);
    const prev = previousKept(kept, at);
    return prev === null || at - prev >= gapMs || replaced - at >= gapMs || kept.length > limit;
  }
  async function forgetVersions(id: string) {
    for (const t of await times(kv, id)) await kv.delete(prefix(id) + t);
  }
  /**
   * Versions given up for a retry that was still refused, which the store could not take back either (issue #510 item
   * 5: in Chromium a delete gives its room back only later, so the store stays full): this tab holds them, lists and
   * opens them, and writes them back after the next save that goes through. Gone with the tab, or when the project is
   * deleted.
   */
  const held = new Map<string, Map<number, string>>();
  /** Writes `versions` of `id` back where the store has none at that time; true when that went through. Never throws. */
  async function putBack(id: string, versions: ReadonlyMap<number, string>) {
    const keys = [...versions.keys()].map((t) => prefix(id) + t);
    try {
      await kv.update(keys, (values) => {
        const writes: Record<string, string> = {};
        keys.forEach((k, i) => {
          if (values[i] === undefined) writes[k] = versions.get(Number(k.slice(prefix(id).length))) as string;
        });
        return writes;
      });
      return true;
    } catch {
      return false;
    }
  }
  /** Each project's held versions written back now that a save went through; those still refused stay held. */
  async function writeBackHeld() {
    for (const [id, versions] of [...held]) if (await putBack(id, versions)) held.delete(id);
  }

  return {
    list: () => store.list(),
    open: (id) => store.open(id),
    text: (id) => store.text(id),
    async save(id, project, read, unchangedSince, behind, writer) {
      // The state this save replaces, read first: after the save it is gone. Only when it could become a version: while
      // the newest version is under `gapMs` older than it (most saves, in a burst of edits), keep() would pass it over,
      // so the whole project text is neither read nor written out again just to be compared (a big project's save
      // spent a third of its time on that).
      let before: string | undefined;
      let at: number | null = null;
      let wanted = true;
      try {
        at = savedAt(await kv.get(`summary/${id}`));
        // The new state's save time, which keep() reads back from the summary after the save. A save given none takes
        // the store's clock's, unknown here, so the state it replaces is read as before (the app's saves give theirs).
        const replaced = read?.getTime();
        wanted = at !== null && (replaced === undefined || Number.isNaN(replaced) || (await wouldKeep(id, at, replaced)));
        before = wanted ? await kv.get(`project/${id}`) : undefined;
      } catch {
        before = undefined; // can't read it: no version this time
      }
      try {
        await store.save(id, project, read, unchangedSince, behind, writer);
      } catch (e) {
        if (e instanceof ProjectChangedError || !storageFull(e)) throw e;
        // The refused save wrote nothing, so the state it replaces is still there: read it now if it was passed over,
        // since forgetting this project's versions below makes room for it as one.
        if (!wanted && at !== null) before = await kv.get(`project/${id}`).catch(() => undefined);
        // Refused for want of room, perhaps: this project's versions and kept undo steps give way to its work first, and
        // the save is tried once more; only if that still fails do the other projects' undo steps go too, for one last
        // try (save/load hunt C7: every project's steps went at the first refusal).
        // The versions given up are read first: if the retry is still refused, giving them up bought nothing (in
        // Chromium a delete gives its room back only later), so they are put back, or held by this tab until a save
        // goes through (issue #510 item 5). Only a retry that goes through costs them.
        const given = new Map<number, string>();
        for (const t of await times(kv, id).catch(() => [])) {
          const text = await kv.get(prefix(id) + t).catch(() => undefined);
          if (text !== undefined) given.set(t, text);
        }
        for (const [t, text] of held.get(id) ?? []) if (!given.has(t)) given.set(t, text);
        const giveBack = async () => {
          if (given.size === 0 || (await putBack(id, given))) held.delete(id);
          else held.set(id, given);
        };
        let refusal: unknown = e;
        let saved = false;
        if (given.size > 0 || (await steps.has(id))) {
          await forgetVersions(id).catch(() => {});
          await steps.forget(id);
          try {
            await store.save(id, project, read, unchangedSince, behind, writer);
            saved = true;
            held.delete(id); // the retry went through: the versions gave way for it
          } catch (again) {
            if (again instanceof ProjectChangedError || !storageFull(again)) {
              await giveBack();
              throw again;
            }
            refusal = again;
          }
        }
        if (!saved) {
          if (!(await steps.any())) {
            await giveBack();
            throw refusal;
          }
          await steps.forgetAll();
          try {
            await store.save(id, project, read, unchangedSince, behind, writer);
            held.delete(id);
          } catch (last) {
            await giveBack();
            throw last;
          }
        }
      }
      await writeBackHeld();
      if (before === undefined || at === null) return;
      let now: string;
      try {
        now = projectToJson(project);
      } catch {
        return;
      }
      if (now === before) return; // a save of the same state (brought forward, say) is no new version
      await keep(id, before, at, savedAt(await kv.get(`summary/${id}`).catch(() => undefined)));
    },
    async remove(id) {
      await store.remove(id);
      held.delete(id);
      await forgetVersions(id).catch(() => {}); // left behind, they are only unreachable: the project is gone either way
      await steps.forget(id);
    },
    steps,
    async versions(id) {
      const all = new Set([...(await times(kv, id)), ...(held.get(id)?.keys() ?? [])]);
      return [...all].sort((a, b) => b - a).map((t) => new Date(t));
    },
    async openVersion(id, at) {
      const text = (await kv.get(prefix(id) + at.getTime())) ?? held.get(id)?.get(at.getTime());
      if (text === undefined) throw new Error(`there is no version of this project saved at ${at.toISOString()} in this browser`);
      try {
        return projectFromJson(text, readers);
      } catch (e) {
        throw new Error(`can't open that version: ${message(e)}`);
      }
    },
  };
}
