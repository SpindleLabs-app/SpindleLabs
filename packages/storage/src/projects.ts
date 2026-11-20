// Every project kept in this browser, reachable (U6a's list; round 2 hunt A2 and A3): File > Projects in this
// browser lists them (packages/ui project-list.ts) and opens or deletes one. Two steps the shell needs beyond the
// store's own list/open/save/remove:
//   bringForward  a project opened from the list becomes the one a reload opens: it is stored again as it is, with the
//                 same save time and a new save number (store.ts `order`), so nothing else about it changes, and only
//                 when the store still holds the state it was opened as (another tab's newer save is left alone).
//   rename        gives a stored project a new name (the home screen's rename), refusing an empty name or one longer
//                 than the name box takes, and not overwriting another tab's newer save.
//   forget        deletes a project and its journal entries (unsaved.ts): an entry left behind would be put back by
//                 the next visit's recovery, bringing the deleted project back.
//   listWithHeld  the store's list plus the projects only the journal holds (storage full: recovery couldn't store
//                 them), each placed by when it was written (issue #627 item 5, #643 item 3).
//   openAsStored  a project with the save time of exactly the state read (issue #627 item 9).

import { ProjectChangedError, type ProjectStore } from "./store.ts";
import type { Project } from "@fission/core";
import type { ProjectSummary } from "./store.ts";
import { asideKeysOf, heldProjects, keptEntry, NEWER_PREFIX, unreadableKeysOf, unsavedKey, type JournalStorage } from "./unsaved.ts";

/**
 * Stores project `id` again as the store holds it, with its save time `at` (the summary's `modified` when it was
 * opened) and a new save number, so it lists first and a reload opens it. True when it did; false when the store
 * holds another state since (this tab's autosave or another tab saved it: that save already listed it first, or is
 * newer work that must not be touched). Any other failure (storage full, gone) is thrown, for the shell to say.
 */
export async function bringForward(store: ProjectStore, id: string, at: Date): Promise<boolean> {
  const project = await store.open(id);
  try {
    await store.save(id, project, at, at);
    return true;
  } catch (e) {
    if (e instanceof ProjectChangedError) return false;
    throw e;
  }
}

/**
 * Deletes project `id` from `store`, then its journal entries, so the next visit can't put it back. Throws, leaving
 * everything as it was, when the store refuses (an id it doesn't hold, storage failing). A journal that can't be
 * written is passed over: storage that is off holds no entry either.
 */
export async function forget(store: ProjectStore, journal: JournalStorage | null, id: string): Promise<void> {
  try {
    await store.remove(id);
  } catch (e) {
    // A project only the journal holds (storage full when it was opened) is deleted by deleting its entries.
    const listed = (await store.list().catch(() => [])).some((s) => s.id === id);
    if (listed || keptEntry(journal, id) === null) throw e;
  }
  let aside: string[] = [];
  try {
    aside = journal ? [...asideKeysOf(journal, id), ...unreadableKeysOf(journal, id)] : []; // another tab's change to it, put aside (clumsy hunt 2026-11-04), and changes kept for a build that reads them
  } catch {
    // storage off: nothing was kept there to come back
  }
  for (const key of [unsavedKey(id), NEWER_PREFIX + id, ...aside]) {
    try {
      journal?.removeItem(key);
    } catch {
      // storage off: nothing was kept there to come back
    }
  }
}

/** The longest project name, as the name box takes it (its `maxlength`). */
export const MAX_PROJECT_NAME = 100;

/**
 * Renames stored project `id` to `name` (trimmed). It is stored again with the rename's own time as its save time and
 * a new save number, so it lists first. Throws when the name is empty or over `MAX_PROJECT_NAME` characters, or the id
 * is not stored; throws `ProjectChangedError` when another save changed it since it was read here (nothing written).
 */
export async function rename(store: ProjectStore, id: string, name: string, at: Date = new Date()): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("a project needs a name");
  if (trimmed.length > MAX_PROJECT_NAME) throw new Error(`a project name can be at most ${MAX_PROJECT_NAME} characters`);
  const summary = (await store.list()).find((s) => s.id === id);
  if (summary === undefined || summary.problem !== undefined) throw new Error(`there is no stored project "${id}" in this browser`);
  const project = await store.open(id);
  await store.save(id, { ...project, name: trimmed }, at, summary.modified);
}

/**
 * The store's list (`store.list()`), plus each project only the journal holds (`heldProjects`: recovery couldn't
 * store it, storage full), placed before the first listed project last touched before it was written, and marked
 * `held`. Such a project was in no list, so a reload opened another one while the app said its changes were shown
 * (issue #627 item 5) and File > Projects never showed it (#643 item 3). Throws only as `store.list()` does.
 */
export async function listWithHeld(store: ProjectStore, journal: JournalStorage | null): Promise<(ProjectSummary & { held?: true })[]> {
  const listed: (ProjectSummary & { held?: true })[] = await store.list();
  const ids = new Set(listed.map((s) => s.id));
  for (const h of heldProjects(journal)) {
    if (ids.has(h.id)) continue; // a stored project's newer state: it opens in its place already (keptEntry)
    const at = listed.findIndex((s) => s.held === undefined && (s.touched ?? s.modified).getTime() < h.written.getTime());
    const row = { id: h.id, name: h.name, modified: h.written, order: 0, held: true as const };
    if (at === -1) listed.push(row);
    else listed.splice(at, 0, row);
  }
  return listed;
}

/**
 * Project `id` as the store holds it, with the save time of that very state: the time read before and after the
 * project and taken only when they agree (tried three times), so a save landing in between (this tab's last project's
 * save, or another tab's) is never paired with the other state. A caller that handed over the time its list showed
 * earlier made every later save of the newest state "changed in another tab" (issue #627 item 9). `modified` is null
 * when the summary can't be read. Throws as `store.open` does, and when the time moved at each of three tries.
 */
export async function openAsStored(store: ProjectStore, id: string): Promise<{ project: Project; modified: Date | null }> {
  const timeOf = async () => {
    const s = (await store.list()).find((x) => x.id === id);
    return s === undefined || s.problem !== undefined ? null : s.modified.getTime();
  };
  for (let tries = 0; tries < 3; tries++) {
    const before = await timeOf();
    const project = await store.open(id);
    const after = await timeOf();
    if (before === after) return { project, modified: after === null ? null : new Date(after) };
  }
  throw new Error("it kept being saved by another tab while it opened; try again");
}
